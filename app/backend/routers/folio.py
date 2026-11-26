"""Folio business API: resumes, candidates, chat editing, versions, avatars, publishing, LLM settings."""

from __future__ import annotations

import base64
import binascii
import json
import logging
import mimetypes
import re
import secrets
import string
import uuid
from contextvars import ContextVar
from typing import Any, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from dependencies.auth import get_current_user
from models.llm_settings import LlmSettings
from models.publications import Publications
from models.resume_candidates import ResumeCandidates
from models.resume_messages import ResumeMessages
from models.resume_versions import ResumeVersions
from models.resumes import Resumes
from schemas.auth import UserResponse
from schemas.storage import FileUpDownRequest
from services import folio_llm as llm
from services.folio_profile import apply_operations, normalize_profile, rule_edit, rule_intake
from services.folio_render import (
    AVATAR_TOKEN,
    STYLE_ORDER,
    STYLES,
    initials_avatar,
    base_of,
    find_custom,
    preview_style,
    render,
    render_style,
    sanitize_html,
    style_label,
    theme_for_style,
    upsert_theme_style,
    validate_html,
)
from services.folio_sample import SAMPLE_SOURCE
from services.folio_styles import MAX_CUSTOM_STYLES, normalize_spec, preset_spec

logger = logging.getLogger(__name__)
_CURRENT_MESSAGE: ContextVar[str] = ContextVar("folio_current_message", default="")
router = APIRouter(prefix="/api/v1/folio", tags=["folio"])

BUCKET = "folio-avatars"
MAX_AVATAR_BYTES = 3 * 1024 * 1024
AVATAR_TYPES = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif"}
SLUG_ALPHABET = string.ascii_letters + string.digits


# ================================================================ schemas
class GenerateBody(BaseModel):
    source_text: str = Field(min_length=1, max_length=60000)
    count: int = Field(default=3, ge=2, le=3)
    resume_id: Optional[int] = None


class SelectBody(BaseModel):
    style: str


class StyleBody(BaseModel):
    description: str = Field(min_length=1, max_length=500)


class ChatBody(BaseModel):
    message: str = Field(min_length=1, max_length=8000)


class ProfileBody(BaseModel):
    profile: dict[str, Any]
    title: Optional[str] = None


class HtmlBody(BaseModel):
    html: str = Field(min_length=1, max_length=600000)


class AvatarBody(BaseModel):
    data_url: str = Field(min_length=20, max_length=5_000_000)


class SettingsBody(BaseModel):
    base_url: str = ""
    token: Optional[str] = None
    model: str = ""
    clear_token: bool = False


class ProbeBody(BaseModel):
    base_url: str = ""
    token: Optional[str] = None
    model: str = ""


# ================================================================ helpers
def _loads(text: Optional[str]) -> dict[str, Any]:
    try:
        data = json.loads(text or "{}")
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        return {}


def _iso(dt) -> Optional[str]:
    return dt.isoformat() if dt else None


def _resume_title(profile: dict[str, Any]) -> str:
    parts = [x for x in (profile.get("name"), profile.get("title")) if x]
    return " · ".join(parts)[:120] or "未命名简历"


async def _own_resume(db: AsyncSession, resume_id: int, user_id: str) -> Resumes:
    row = await db.scalar(select(Resumes).where(Resumes.id == resume_id))
    if row is None:
        raise HTTPException(status_code=404, detail="简历不存在")
    if row.user_id != user_id:
        raise HTTPException(status_code=403, detail="无权访问此简历")
    return row


async def _llm_config(db: AsyncSession, user_id: str) -> Optional[tuple[str, str, str]]:
    row = await db.scalar(
        select(LlmSettings).where(LlmSettings.user_id == user_id).order_by(LlmSettings.id.desc()).limit(1)
    )
    if not row:
        return None
    token = llm.decrypt_token(row.token_encrypted)
    if row.base_url and token and row.llm_model:
        return row.base_url, token, row.llm_model
    return None


async def _settings_row(db: AsyncSession, user_id: str) -> Optional[LlmSettings]:
    return await db.scalar(
        select(LlmSettings).where(LlmSettings.user_id == user_id).order_by(LlmSettings.id.desc()).limit(1)
    )


def _storage():
    from services.storage import StorageService

    return StorageService()


async def _avatar_url(key: Optional[str], name: Optional[str]) -> str:
    if key:
        try:
            res = await _storage().create_download_url(FileUpDownRequest(bucket_name=BUCKET, object_key=key))
            if res.download_url:
                return res.download_url
        except Exception as exc:  # noqa: BLE001
            logger.warning("avatar url failed: %s", type(exc).__name__)
    return initials_avatar(name)


async def _avatar_data_uri(key: Optional[str], name: Optional[str]) -> str:
    if key:
        url = await _avatar_url(key, name)
        if url.startswith("http"):
            try:
                async with httpx.AsyncClient(timeout=30) as client:
                    resp = await client.get(url)
                if resp.status_code < 400 and resp.content:
                    ctype = resp.headers.get("content-type", "").split(";")[0]
                    if not ctype.startswith("image/"):
                        ctype = mimetypes.guess_type(key)[0] or "image/png"
                    return f"data:{ctype};base64," + base64.b64encode(resp.content).decode()
            except httpx.HTTPError as exc:
                logger.warning("avatar fetch failed: %s", type(exc).__name__)
    return initials_avatar(name)


async def _upload_avatar(user_id: str, scope: str, data_url: str) -> str:
    m = re.match(r"^data:(image/[a-z+]+);base64,(.+)$", data_url, re.S)
    if not m or m.group(1) not in AVATAR_TYPES:
        raise HTTPException(status_code=400, detail="仅支持 PNG、JPG、WebP 或 GIF 图片")
    try:
        raw = base64.b64decode(m.group(2), validate=False)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(status_code=400, detail="图片数据无效") from exc
    if len(raw) > MAX_AVATAR_BYTES:
        raise HTTPException(status_code=400, detail="头像不能超过 3MB")
    key = f"avatars/{user_id}/{scope}/{uuid.uuid4().hex}.{AVATAR_TYPES[m.group(1)]}"
    try:
        res = await _storage().create_upload_url(FileUpDownRequest(bucket_name=BUCKET, object_key=key))
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.put(res.upload_url, content=raw, headers={"Content-Type": m.group(1)})
            if resp.status_code >= 400:
                resp = await client.put(res.upload_url, content=raw)
        if resp.status_code >= 400:
            raise HTTPException(status_code=502, detail=f"头像上传失败（HTTP {resp.status_code}）")
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        logger.error("avatar upload error: %s", exc)
        raise HTTPException(status_code=502, detail="头像上传失败，请稍后重试") from exc
    return key


def _render_candidates(profile: dict[str, Any], count: int) -> list[dict[str, str]]:
    out = [{"style_key": k, "name": STYLES[k]["name"], "description": STYLES[k]["description"],
            "html": preview_style(profile, k)} for k in STYLE_ORDER[:count]]
    for spec in profile.get("custom_styles") or []:
        out.append({"style_key": spec["key"], "name": spec["name"], "description": spec["description"],
                    "html": preview_style(profile, spec["key"])})
    return out


async def _replace_candidates(db: AsyncSession, resume: Resumes, profile: dict[str, Any], count: Optional[int] = None):
    if count is None:
        existing = (await db.scalars(select(ResumeCandidates.style_key).where(
            ResumeCandidates.resume_id == resume.id))).all()
        builtin = [k for k in existing if k in STYLES]
        count = max(2, min(3, len(builtin) or 3))
    await db.execute(delete(ResumeCandidates).where(ResumeCandidates.resume_id == resume.id))
    for c in _render_candidates(profile, count):
        db.add(ResumeCandidates(resume_id=resume.id, user_id=resume.user_id, **c))


def _add_message(db: AsyncSession, resume: Resumes, role: str, content: str) -> None:
    db.add(ResumeMessages(resume_id=resume.id, user_id=resume.user_id, role=role, content=content[:20000]))


def _add_version(db: AsyncSession, resume: Resumes, label: str) -> None:
    profile = _loads(resume.profile_json)
    profile["_status"] = resume.status
    db.add(ResumeVersions(
        resume_id=resume.id, user_id=resume.user_id, label=label[:120],
        profile_json=json.dumps(profile, ensure_ascii=False), html=resume.current_html,
        style_key=resume.current_style, avatar_key=resume.avatar_key,
    ))


async def _state(db: AsyncSession, resume: Resumes) -> dict[str, Any]:
    cands = (await db.scalars(select(ResumeCandidates).where(ResumeCandidates.resume_id == resume.id)
                              .order_by(ResumeCandidates.id))).all()
    msgs = (await db.scalars(select(ResumeMessages).where(ResumeMessages.resume_id == resume.id)
                             .order_by(ResumeMessages.id))).all()
    vers = (await db.scalars(select(ResumeVersions).where(ResumeVersions.resume_id == resume.id)
                             .order_by(ResumeVersions.id.desc()))).all()
    pub = await db.scalar(select(Publications).where(Publications.resume_id == resume.id).limit(1))
    order = {k: i for i, k in enumerate(STYLE_ORDER)}
    profile = normalize_profile(_loads(resume.profile_json))
    names = {c.style_key: c.name for c in cands}
    custom_keys = {s["key"] for s in profile.get("custom_styles") or []}
    data = {
        "resume": {
            "id": resume.id, "title": resume.title, "source_text": resume.source_text or "",
            "profile": profile, "current_html": resume.current_html or "",
            "current_style": resume.current_style or "", "status": resume.status or "draft",
            "current_style_name": style_label(profile, resume.current_style) or names.get(resume.current_style or "", ""),
            "has_avatar": bool(resume.avatar_key), "updated_at": _iso(resume.updated_at),
        },
        "candidates": sorted([{"id": c.id, "style_key": c.style_key, "name": c.name, "description": c.description,
                               "html": c.html, "is_custom": c.style_key in custom_keys} for c in cands],
                             key=lambda c: (order.get(c["style_key"], 9), c["id"])),
        "messages": [{"id": m.id, "role": m.role, "content": m.content, "created_at": _iso(m.created_at)} for m in msgs],
        "versions": [{"id": v.id, "label": v.label, "style_key": v.style_key,
                      "style_name": STYLES.get(v.style_key or "", {}).get("name") or names.get(v.style_key or "", "自定义样式"),
                      "created_at": _iso(v.created_at)} for v in vers],
        "publication": {"slug": pub.slug, "updated_at": _iso(pub.updated_at)} if pub else None,
    }
    avatar_key, name = resume.avatar_key, profile.get("name")
    await db.commit()
    data["avatar_url"] = await _avatar_url(avatar_key, name)
    return data


async def _intake(cfg: Optional[tuple[str, str, str]], source: str) -> tuple[dict[str, Any], list[str], str]:
    """Returns (profile, questions, note)."""
    if cfg:
        def validate(d: dict[str, Any]) -> Optional[str]:
            if not isinstance(d.get("sections"), list):
                return "缺少 sections 数组"
            return None
        try:
            data = await llm.chat_json(*cfg, [
                {"role": "system", "content": llm.load_prompt("resume-intake.md")},
                {"role": "user", "content": f"以下是用户提供的全部材料：\n\n{source}"},
            ], validate)
            qs = [str(q) for q in data.get("questions") or [] if q][:3]
            return normalize_profile(data), qs, ""
        except llm.LLMError as exc:
            parsed = rule_intake(source)
            return parsed, parsed.pop("questions", []), f"（模型调用未成功：{exc}。已改用内置规则梳理。）"
    parsed = rule_intake(source)
    return parsed, parsed.pop("questions", []), ""


def _intake_reply(profile: dict[str, Any], questions: list[str], count: int, note: str) -> str:
    secs = "、".join(s["title"] for s in profile["sections"]) or "暂无栏目"
    lines = [f"已梳理出 {profile.get('name') or '（未识别姓名）'} 的简历资料：{secs}。",
             f"基于同一份资料生成了 {count} 套候选样式，点击卡片可查看完整页面，选好后点「使用此样式」。"]
    if note:
        lines.append(note)
    if questions:
        lines.append("还有几个问题想确认：\n" + "\n".join(f"{i + 1}. {q}" for i, q in enumerate(questions)))
    return "\n".join(lines)


# ================================================================ public
@router.get("/public/example")
async def public_example():
    parsed = rule_intake(SAMPLE_SOURCE)
    parsed.pop("questions", None)
    return {"source_text": SAMPLE_SOURCE, "profile": parsed, "candidates": _render_candidates(parsed, 3),
            "avatar_url": initials_avatar(parsed.get("name"))}


@router.get("/public/pages/{slug}")
async def public_page(slug: str, db: AsyncSession = Depends(get_db)):
    pub = await db.scalar(select(Publications).where(Publications.slug == slug))
    if pub is None:
        raise HTTPException(status_code=404, detail="页面不存在或已下线")
    html, key, title = pub.html or "", pub.avatar_key, pub.title
    await db.commit()
    name = (title or "").split(" · ")[0]
    url = await _avatar_url(key, name)
    return {"slug": slug, "title": title, "html": html.replace(AVATAR_TOKEN, url), "avatar_url": url}


# ================================================================ resumes
@router.get("/resumes")
async def list_resumes(user: UserResponse = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    rows = (await db.scalars(select(Resumes).where(Resumes.user_id == user.id)
                             .order_by(Resumes.updated_at.desc(), Resumes.id.desc()))).all()
    pubs = (await db.scalars(select(Publications).where(Publications.user_id == user.id))).all()
    slug_by = {p.resume_id: p.slug for p in pubs}
    return {"items": [{"id": r.id, "title": r.title, "current_style": r.current_style or "",
                       "style_name": style_label(_loads(r.profile_json), r.current_style),
                       "status": r.status or "draft", "updated_at": _iso(r.updated_at),
                       "slug": slug_by.get(r.id)} for r in rows]}


@router.post("/resumes/generate")
async def generate(body: GenerateBody, user: UserResponse = Depends(get_current_user),
                   db: AsyncSession = Depends(get_db)):
    if body.resume_id:
        await _own_resume(db, body.resume_id, user.id)
    cfg = await _llm_config(db, user.id)
    await db.commit()
    profile, questions, note = await _intake(cfg, body.source_text.strip())
    if body.resume_id:
        resume = await _own_resume(db, body.resume_id, user.id)
        old = _loads(resume.profile_json)
        profile["theme"] = old.get("theme") or {}
        profile["custom_styles"] = old.get("custom_styles") or []
        resume.source_text = body.source_text
    else:
        resume = Resumes(user_id=user.id, title="未命名简历", source_text=body.source_text,
                         status="draft", current_html="", current_style="")
        db.add(resume)
        await db.flush()
    resume.profile_json = json.dumps(profile, ensure_ascii=False)
    resume.title = _resume_title(profile)
    await _replace_candidates(db, resume, profile, body.count)
    _add_message(db, resume, "user", f"📎 提交了材料（{len(body.source_text)} 字）\n\n{body.source_text[:300]}"
                 + ("…" if len(body.source_text) > 300 else ""))
    _add_message(db, resume, "assistant", _intake_reply(profile, questions, body.count, note))
    await db.commit()
    return await _state(db, resume)


@router.get("/resumes/{resume_id}")
async def get_resume(resume_id: int, user: UserResponse = Depends(get_current_user),
                     db: AsyncSession = Depends(get_db)):
    return await _state(db, await _own_resume(db, resume_id, user.id))


@router.delete("/resumes/{resume_id}")
async def delete_resume(resume_id: int, user: UserResponse = Depends(get_current_user),
                        db: AsyncSession = Depends(get_db)):
    resume = await _own_resume(db, resume_id, user.id)
    for model in (ResumeCandidates, ResumeMessages, ResumeVersions, Publications):
        await db.execute(delete(model).where(model.resume_id == resume.id, model.user_id == user.id))
    await db.delete(resume)
    await db.commit()
    return {"ok": True}


@router.post("/resumes/{resume_id}/select")
async def select_style(resume_id: int, body: SelectBody, user: UserResponse = Depends(get_current_user),
                       db: AsyncSession = Depends(get_db)):
    resume = await _own_resume(db, resume_id, user.id)
    profile = normalize_profile(_loads(resume.profile_json))
    spec = find_custom(profile, body.style)
    if body.style not in STYLES and spec is None:
        raise HTTPException(status_code=400, detail="未知样式")
    first = resume.status == "draft" or not resume.current_style
    was_manual = resume.status == "manual"
    profile["theme"] = theme_for_style(profile.get("theme"), spec)
    resume.profile_json = json.dumps(profile, ensure_ascii=False)
    resume.current_html = render(profile, base_of(profile, body.style))
    resume.current_style = body.style
    resume.status = "template"
    name = style_label(profile, body.style)
    _add_version(db, resume, f"{'选用' if first else '切换为'}「{name}」")
    _add_message(db, resume, "assistant", f"已将「{name}」设为当前版本。" + (
        "之前手动修改的 HTML 已保存在版本历史中。" if was_manual else "") + "接下来可以直接在对话里告诉我要怎么改。")
    await db.commit()
    return await _state(db, resume)


def _apply_edit(resume: Resumes, profile: dict[str, Any], ops: list[Any], html_new: Optional[str]):
    """Returns (profile, style, html, status, notes, failures)."""
    p, style2, css, content_changed, failures = apply_operations(profile, ops)
    if style2:
        p["theme"] = theme_for_style(p.get("theme"), find_custom(p, style2))
    if css:
        p["theme"]["custom_css"] = ((p["theme"].get("custom_css") or "") + "\n" + "\n".join(css)).strip()[-20000:]
    theme_changed = p.get("theme") != profile.get("theme")
    notes: list[str] = []
    status = resume.status or "draft"
    if status == "draft":
        return p, None, "", "draft", notes, failures
    style = style2 or resume.current_style or "minimal"
    if html_new:
        html = sanitize_html(html_new)
        html = upsert_theme_style(html, p["theme"]) if theme_changed else html
        status = "manual"
    elif status == "manual" and not style2 and not content_changed:
        html = upsert_theme_style(resume.current_html or "", p["theme"]) if theme_changed else resume.current_html or ""
    else:
        if status == "manual":
            notes.append("已根据简历资料重新排版，之前手动修改的 HTML 保存在版本历史中。")
        html = render_style(p, style)
        status = "template"
    return p, style, html, status, notes, failures


@router.post("/resumes/{resume_id}/chat")
async def chat(resume_id: int, body: ChatBody, user: UserResponse = Depends(get_current_user),
               db: AsyncSession = Depends(get_db)):
    resume = await _own_resume(db, resume_id, user.id)
    profile = normalize_profile(_loads(resume.profile_json))
    history = (await db.scalars(select(ResumeMessages).where(ResumeMessages.resume_id == resume.id)
                                .order_by(ResumeMessages.id.desc()).limit(10))).all()
    hist = [{"role": "assistant" if m.role == "assistant" else "user", "content": (m.content or "")[:2000]}
            for m in reversed(history)]
    status, style, html_now = resume.status or "draft", resume.current_style or "", resume.current_html or ""
    _CURRENT_MESSAGE.set(body.message)
    cfg = await _llm_config(db, user.id)
    await db.commit()
    if STYLE_REQUEST_RE.search(body.message):
        return await _create_style(db, resume_id, user.id, body.message, cfg, from_chat=True)

    ops: list[Any] = []
    html_new: Optional[str] = None
    reply = ""
    error: Optional[str] = None
    if cfg:
        context = {"mode": status, "style": style, "profile": profile,
                   "html": html_now[:60000] if status != "draft" else "（尚未选择样式，只能返回 operations）"}

        def validate(d: dict[str, Any]) -> Optional[str]:
            if not isinstance(d.get("reply"), str):
                return "缺少字符串类型的 reply 字段"
            if d.get("operations") is not None and not isinstance(d.get("operations"), list):
                return "operations 必须是数组"
            if d.get("html"):
                if not isinstance(d["html"], str):
                    return "html 必须是字符串"
                problem = validate_html(sanitize_html(d["html"]))
                if problem:
                    return problem
            return None
        base_msgs = [
            {"role": "system", "content": llm.load_prompt("resume-assistant.md")},
            *hist,
            {"role": "user", "content": "当前上下文：\n" + json.dumps(context, ensure_ascii=False)
             + f"\n\n用户最新消息：{body.message}"},
        ]
        try:
            data = await llm.chat_json(*cfg, base_msgs, validate)
            ops, reply = data.get("operations") or [], data["reply"]
            html_new = data.get("html") if status != "draft" else None
            problem = _dry_run_problem(resume, profile, ops, html_new, html_now)
            if problem:
                logger.info("chat edit retry: %s", problem)
                retry_msgs = base_msgs + [
                    {"role": "assistant", "content": json.dumps(data, ensure_ascii=False)[:12000]},
                    {"role": "user", "content": f"你的上一条结果没有让简历产生任何实际修改：{problem}\n"
                     "请不要征求确认，直接在本次输出中给出可执行的 operations（或完整 html），使修改立即生效。"
                     "修改条目请用 update_item，并用 section 填栏目 id、match 填条目原标题，item 中给出完整的 bullets 数组。"
                     "如果用户的消息只是提问、不需要修改，请返回空的 operations 并在 reply 中回答。只输出 JSON。"},
                ]
                try:
                    data2 = await llm.chat_json(*cfg, retry_msgs, validate)
                    ops2 = data2.get("operations") or []
                    html2 = data2.get("html") if status != "draft" else None
                    if ops2 or html2 or not _dry_run_problem(resume, profile, ops2, html2, html_now):
                        ops, reply, html_new = ops2, data2["reply"], html2
                except llm.LLMError as exc:
                    logger.warning("chat edit retry failed: %s", exc)
        except llm.LLMError as exc:
            error = f"{exc}。已保留上一版，请稍后重试。"
    else:
        ops, notes = rule_edit(body.message, profile)
        if ops:
            reply = "；".join(notes) + "。"
        else:
            reply = ("当前未配置大模型，内置编辑支持：更换主题色（如“换成雾霾蓝主题”）、单独设置区块颜色（如“页脚背景设为 #1E293B”）、"
                     "新增/删除/移动栏目、单栏或双栏布局、字体、间距和切换样式。改写经历等更复杂的修改，请先在「模型设置」中配置模型，"
                     "或在「编辑资料」里直接修改。")

    resume = await _own_resume(db, resume_id, user.id)
    _add_message(db, resume, "user", body.message)
    changed = False
    if not error and (ops or html_new):
        new_profile, new_style, new_html, new_status, notes, failures = _apply_edit(resume, profile, ops, html_new)
        if failures:
            logger.info("chat edit op failures: %s", failures)
        if new_status == "draft":
            changed = new_profile != profile
            if changed:
                resume.profile_json = json.dumps(new_profile, ensure_ascii=False)
                resume.title = _resume_title(new_profile)
                await _replace_candidates(db, resume, new_profile)
                reply += "\n（已同步更新全部候选样式）"
        else:
            problem = validate_html(new_html)
            if problem:
                error = f"修改结果未通过校验：{problem}。已保留上一版，请重试。"
            else:
                changed = new_html != html_now or new_profile != profile
                if changed:
                    resume.profile_json = json.dumps(new_profile, ensure_ascii=False)
                    resume.title = _resume_title(new_profile)
                    resume.current_html, resume.current_style, resume.status = new_html, new_style, new_status
                    _add_version(db, resume, f"对话：{body.message[:40]}")
                if notes:
                    reply += "\n" + "\n".join(notes)
        if not changed and not error and cfg:
            error = "这次没有识别出可执行的修改" + (f"（{failures[0]}）" if failures else "") + "，已保留上一版，请换个说法再试一次。"
    if error:
        _add_message(db, resume, "assistant", f"⚠️ {error}")
    else:
        _add_message(db, resume, "assistant", reply or "好的。")
    await db.commit()
    state = await _state(db, resume)
    state["changed"] = changed
    state["error"] = error
    return state


EDIT_INTENT_RE = re.compile(r"改|换|调|加|增|删|去掉|移|写|润色|突出|精简|扩写|补充|替换|设为|设置|放到|重写|优化|修改|更新|合并|拆分")


def _dry_run_problem(resume: Resumes, profile: dict[str, Any], ops: list[Any], html_new: Optional[str],
                     html_now: str) -> Optional[str]:
    """Simulate an edit without touching the DB; describe why it would not change anything."""
    if not ops and not html_new:
        return "operations 为空且没有返回 html" if EDIT_INTENT_RE.search(_last_user_text(profile)) else None
    snap = Resumes(status=resume.status, current_style=resume.current_style, current_html=html_now)
    new_profile, _st, new_html, new_status, _n, failures = _apply_edit(snap, profile, ops, html_new)
    changed = new_profile != profile if new_status == "draft" else (new_html != html_now or new_profile != profile)
    if failures and not changed:
        return "；".join(failures[:3])
    if not changed:
        return "这些 operations 应用后内容与原来完全相同"
    return None


def _last_user_text(_profile: dict[str, Any]) -> str:
    return _CURRENT_MESSAGE.get()


@router.put("/resumes/{resume_id}/profile")
async def update_profile(resume_id: int, body: ProfileBody, user: UserResponse = Depends(get_current_user),
                         db: AsyncSession = Depends(get_db)):
    resume = await _own_resume(db, resume_id, user.id)
    old = _loads(resume.profile_json)
    profile = normalize_profile({**body.profile, "theme": old.get("theme") or {},
                                 "custom_styles": old.get("custom_styles") or []})
    resume.profile_json = json.dumps(profile, ensure_ascii=False)
    resume.title = (body.title or "").strip()[:120] or _resume_title(profile)
    if (resume.status or "draft") == "draft":
        await _replace_candidates(db, resume, profile)
        _add_message(db, resume, "assistant", "资料已保存，全部候选样式已同步更新。")
    else:
        was_manual = resume.status == "manual"
        resume.current_html = render_style(profile, resume.current_style or "minimal")
        resume.status = "template"
        _add_version(db, resume, "编辑资料")
        _add_message(db, resume, "assistant", "资料已保存并重新排版。" + (
            "之前手动修改的 HTML 保存在版本历史中。" if was_manual else ""))
    await db.commit()
    return await _state(db, resume)


@router.put("/resumes/{resume_id}/html")
async def apply_html(resume_id: int, body: HtmlBody, user: UserResponse = Depends(get_current_user),
                     db: AsyncSession = Depends(get_db)):
    resume = await _own_resume(db, resume_id, user.id)
    if (resume.status or "draft") == "draft":
        raise HTTPException(status_code=400, detail="请先选择一套样式，再编辑源码")
    html = sanitize_html(body.html)
    problem = validate_html(html)
    if problem:
        raise HTTPException(status_code=400, detail=problem)
    resume.current_html = html
    resume.status = "manual"
    _add_version(db, resume, "手动编辑 HTML")
    _add_message(db, resume, "assistant", "已应用你手动编辑的 HTML，后续对话将以这份源码为准。")
    await db.commit()
    return await _state(db, resume)


@router.get("/resumes/{resume_id}/versions/{version_id}")
async def get_version(resume_id: int, version_id: int, user: UserResponse = Depends(get_current_user),
                      db: AsyncSession = Depends(get_db)):
    await _own_resume(db, resume_id, user.id)
    v = await db.scalar(select(ResumeVersions).where(ResumeVersions.id == version_id,
                                                     ResumeVersions.resume_id == resume_id))
    if v is None or v.user_id != user.id:
        raise HTTPException(status_code=404, detail="版本不存在")
    html, key, label = v.html or "", v.avatar_key, v.label
    name = _loads(v.profile_json).get("name")
    await db.commit()
    return {"id": version_id, "label": label, "html": html, "avatar_url": await _avatar_url(key, name)}


@router.post("/resumes/{resume_id}/versions/{version_id}/restore")
async def restore_version(resume_id: int, version_id: int, user: UserResponse = Depends(get_current_user),
                          db: AsyncSession = Depends(get_db)):
    resume = await _own_resume(db, resume_id, user.id)
    v = await db.scalar(select(ResumeVersions).where(ResumeVersions.id == version_id,
                                                     ResumeVersions.resume_id == resume_id))
    if v is None or v.user_id != user.id:
        raise HTTPException(status_code=404, detail="版本不存在")
    profile = _loads(v.profile_json)
    status = profile.pop("_status", None) or "template"
    profile = normalize_profile(profile)
    resume.profile_json = json.dumps(profile, ensure_ascii=False)
    resume.title = _resume_title(profile)
    current = normalize_profile(_loads(resume.profile_json))
    known = {s["key"] for s in profile.get("custom_styles") or []}
    profile["custom_styles"] = profile.get("custom_styles", []) + [
        s for s in current.get("custom_styles") or [] if s["key"] not in known]
    resume.current_html = v.html or render_style(profile, v.style_key or "minimal")
    resume.current_style = v.style_key or "minimal"
    resume.status = status if status in ("template", "manual") else "template"
    resume.avatar_key = v.avatar_key
    _add_version(db, resume, f"恢复自：{v.label}")
    _add_message(db, resume, "assistant", f"已将版本「{v.label}」恢复为当前的新版本。")
    await db.commit()
    return await _state(db, resume)


@router.get("/resumes/{resume_id}/export")
async def export_html(resume_id: int, user: UserResponse = Depends(get_current_user),
                      db: AsyncSession = Depends(get_db)):
    resume = await _own_resume(db, resume_id, user.id)
    if not resume.current_html:
        raise HTTPException(status_code=400, detail="请先选择一套样式")
    html, key = resume.current_html, resume.avatar_key
    profile = _loads(resume.profile_json)
    await db.commit()
    data_uri = await _avatar_data_uri(key, profile.get("name"))
    filename = re.sub(r"[\\/:*?\"<>|\s]+", "-", f"{profile.get('name') or 'resume'}-简历") + ".html"
    return {"filename": filename, "html": html.replace(AVATAR_TOKEN, data_uri)}


@router.post("/resumes/{resume_id}/avatar")
async def upload_resume_avatar(resume_id: int, body: AvatarBody, user: UserResponse = Depends(get_current_user),
                               db: AsyncSession = Depends(get_db)):
    await _own_resume(db, resume_id, user.id)
    await db.commit()
    key = await _upload_avatar(user.id, str(resume_id), body.data_url)
    resume = await _own_resume(db, resume_id, user.id)
    resume.avatar_key = key
    if resume.status in ("template", "manual"):
        _add_version(db, resume, "更换头像")
    await db.commit()
    return await _state(db, resume)


# ================================================================ publishing
def _new_slug() -> str:
    return "".join(secrets.choice(SLUG_ALPHABET) for _ in range(10))


@router.post("/resumes/{resume_id}/publish")
async def publish(resume_id: int, user: UserResponse = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    resume = await _own_resume(db, resume_id, user.id)
    if not resume.current_html:
        raise HTTPException(status_code=400, detail="请先选择一套样式再发布")
    pub = await db.scalar(select(Publications).where(Publications.resume_id == resume.id,
                                                     Publications.user_id == user.id).limit(1))
    if pub is None:
        slug = _new_slug()
        while await db.scalar(select(Publications.id).where(Publications.slug == slug)):
            slug = _new_slug()
        pub = Publications(resume_id=resume.id, user_id=user.id, slug=slug)
        db.add(pub)
    pub.html = resume.current_html
    pub.avatar_key = resume.avatar_key
    pub.title = resume.title
    _add_message(db, resume, "assistant", f"已发布当前版本：/page/{pub.slug}")
    await db.commit()
    return await _state(db, resume)


@router.get("/pages/{slug}/manage")
async def page_manage(slug: str, user: UserResponse = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    pub = await db.scalar(select(Publications).where(Publications.slug == slug))
    if pub is None:
        raise HTTPException(status_code=404, detail="页面不存在")
    return {"is_owner": pub.user_id == user.id, "resume_id": pub.resume_id if pub.user_id == user.id else None}


@router.post("/pages/{slug}/avatar")
async def page_avatar(slug: str, body: AvatarBody, user: UserResponse = Depends(get_current_user),
                      db: AsyncSession = Depends(get_db)):
    pub = await db.scalar(select(Publications).where(Publications.slug == slug))
    if pub is None:
        raise HTTPException(status_code=404, detail="页面不存在")
    if pub.user_id != user.id:
        raise HTTPException(status_code=403, detail="只有发布者可以更换此页面的头像")
    resume_id = pub.resume_id
    await db.commit()
    key = await _upload_avatar(user.id, f"page-{slug}", body.data_url)
    pub = await db.scalar(select(Publications).where(Publications.slug == slug))
    pub.avatar_key = key
    resume = await db.scalar(select(Resumes).where(Resumes.id == resume_id, Resumes.user_id == user.id))
    if resume is not None:
        resume.avatar_key = key
        if resume.status in ("template", "manual"):
            _add_version(db, resume, "从发布页更换头像")
    title = pub.title
    await db.commit()
    return {"ok": True, "avatar_url": await _avatar_url(key, (title or "").split(" · ")[0])}


# ================================================================ llm settings
@router.get("/settings")
async def get_settings(user: UserResponse = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    row = await _settings_row(db, user.id)
    if not row:
        return {"base_url": "", "model": "", "has_token": False, "configured": False}
    has_token = bool(llm.decrypt_token(row.token_encrypted))
    return {"base_url": row.base_url or "", "model": row.llm_model or "", "has_token": has_token,
            "configured": bool(row.base_url and row.llm_model and has_token)}


@router.put("/settings")
async def save_settings(body: SettingsBody, user: UserResponse = Depends(get_current_user),
                        db: AsyncSession = Depends(get_db)):
    base = ""
    if body.base_url.strip():
        try:
            base = llm.normalize_base_url(body.base_url)
        except llm.LLMError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    row = await _settings_row(db, user.id)
    if row is None:
        row = LlmSettings(user_id=user.id)
        db.add(row)
    row.base_url = base
    row.llm_model = body.model.strip()[:200]
    if body.clear_token:
        row.token_encrypted = None
    elif body.token and body.token.strip():
        row.token_encrypted = llm.encrypt_token(body.token.strip())
    await db.commit()
    has_token = bool(llm.decrypt_token(row.token_encrypted))
    return {"base_url": row.base_url, "model": row.llm_model, "has_token": has_token,
            "configured": bool(row.base_url and row.llm_model and has_token)}


async def _probe_creds(body: ProbeBody, user: UserResponse, db: AsyncSession) -> tuple[str, str, str]:
    row = await _settings_row(db, user.id)
    base = body.base_url.strip() or (row.base_url if row else "")
    token = (body.token or "").strip() or (llm.decrypt_token(row.token_encrypted) if row else "")
    model = body.model.strip() or (row.llm_model if row else "")
    await db.commit()
    if not base:
        raise HTTPException(status_code=400, detail="请填写 API Base URL")
    return base, token, model


@router.post("/settings/models")
async def fetch_models(body: ProbeBody, user: UserResponse = Depends(get_current_user),
                       db: AsyncSession = Depends(get_db)):
    base, token, _ = await _probe_creds(body, user, db)
    try:
        return {"models": await llm.list_models(base, token)}
    except llm.LLMError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/settings/test")
async def test_settings(body: ProbeBody, user: UserResponse = Depends(get_current_user),
                        db: AsyncSession = Depends(get_db)):
    base, token, model = await _probe_creds(body, user, db)
    if not token:
        raise HTTPException(status_code=400, detail="请填写 API Token")
    try:
        text = await llm.chat(base, token, model, [{"role": "user", "content": "请只回复“连接成功”四个字。"}],
                              temperature=0, timeout=45)
    except llm.LLMError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "model": model, "reply": text[:200]}


# ================================================================ custom styles
STYLE_REQUEST_RE = re.compile(r"(生成|新建|创建|设计|新增|来|做|加)[^，。,]{0,4}(一套|一个|一款|套|个|种)?[^，。,]{0,14}(样式|风格|模板|皮肤)")


async def _design_style(cfg: Optional[tuple[str, str, str]], profile: dict[str, Any], description: str):
    """Returns (spec, note)."""
    if cfg:
        outline = {"name": profile.get("name"), "title": profile.get("title"),
                   "sections": [{"id": s["id"], "type": s["type"], "title": s["title"], "items": len(s["items"])}
                                for s in profile.get("sections") or []]}

        def validate(d: dict[str, Any]) -> Optional[str]:
            if d.get("base") not in STYLES:
                return "base 必须是 minimal、sidebar 或 cards"
            if not isinstance(d.get("theme", {}), dict):
                return "theme 必须是对象"
            if d.get("css") is not None and not isinstance(d.get("css"), str):
                return "css 必须是字符串"
            if not str(d.get("name") or "").strip():
                return "缺少 name"
            return None
        try:
            data = await llm.chat_json(*cfg, [
                {"role": "system", "content": llm.load_prompt("resume-style.md")},
                {"role": "user", "content": "简历结构概要：" + json.dumps(outline, ensure_ascii=False)
                 + f"\n\n用户想要的样式：{description}"},
            ], validate)
            spec = normalize_spec(data)
            if spec:
                return spec, ""
        except llm.LLMError as exc:
            return preset_spec(description), f"（模型调用未成功：{exc}。已改用内置风格预设生成。）"
    return preset_spec(description), "（当前未配置大模型，已按描述匹配内置风格预设；配置模型后可生成更贴合描述的样式。）"


async def _create_style(db: AsyncSession, resume_id: int, user_id: str, description: str,
                        cfg: Optional[tuple[str, str, str]], from_chat: bool = False):
    resume = await _own_resume(db, resume_id, user_id)
    profile = normalize_profile(_loads(resume.profile_json))
    await db.commit()
    spec, note = await _design_style(cfg, profile, description.strip())
    resume = await _own_resume(db, resume_id, user_id)
    profile = normalize_profile(_loads(resume.profile_json))
    customs = profile.get("custom_styles") or []
    if len(customs) >= MAX_CUSTOM_STYLES:
        customs = [s for s in customs if s["key"] != resume.current_style][-(MAX_CUSTOM_STYLES - 1):]
    existing = {s["name"] for s in customs} | {v["name"] for v in STYLES.values()}
    base_name, n = spec["name"], 2
    while spec["name"] in existing:
        spec["name"] = f"{base_name}{n}"
        n += 1
    profile["custom_styles"] = customs + [spec]
    resume.profile_json = json.dumps(profile, ensure_ascii=False)
    await _replace_candidates(db, resume, profile)
    _add_message(db, resume, "user", description if from_chat else f"🎨 生成新样式：{description}")
    tail = "在「样式方案」中查看，点击「使用此样式」即可应用到当前简历。"
    _add_message(db, resume, "assistant", f"已生成新样式「{spec['name']}」：{spec['description']}。{tail}" + (f"\n{note}" if note else ""))
    await db.commit()
    state = await _state(db, resume)
    state["new_style"] = spec["key"]
    state["changed"] = False
    state["error"] = None
    return state


@router.post("/resumes/{resume_id}/styles")
async def create_style(resume_id: int, body: StyleBody, user: UserResponse = Depends(get_current_user),
                       db: AsyncSession = Depends(get_db)):
    await _own_resume(db, resume_id, user.id)
    cfg = await _llm_config(db, user.id)
    await db.commit()
    return await _create_style(db, resume_id, user.id, body.description, cfg)


@router.delete("/resumes/{resume_id}/styles/{style_key}")
async def delete_style(resume_id: int, style_key: str, user: UserResponse = Depends(get_current_user),
                       db: AsyncSession = Depends(get_db)):
    resume = await _own_resume(db, resume_id, user.id)
    profile = normalize_profile(_loads(resume.profile_json))
    spec = find_custom(profile, style_key)
    if spec is None:
        raise HTTPException(status_code=404, detail="样式不存在")
    if resume.current_style == style_key and resume.status != "draft":
        raise HTTPException(status_code=400, detail="当前正在使用此样式，请先切换到其他样式再删除")
    profile["custom_styles"] = [s for s in profile["custom_styles"] if s["key"] != style_key]
    resume.profile_json = json.dumps(profile, ensure_ascii=False)
    await _replace_candidates(db, resume, profile)
    _add_message(db, resume, "assistant", f"已删除样式「{spec['name']}」。")
    await db.commit()
    return await _state(db, resume)

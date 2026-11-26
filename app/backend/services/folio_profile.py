"""Folio profile model helpers: normalize, rule-based intake, patch operations, rule-based edits."""

from __future__ import annotations

import copy
import re
from typing import Any

from services.folio_render import COLOR_NAMES, STYLES, normalize_color

SECTION_TYPES = {"experience", "projects", "education", "skills", "custom"}
ITEM_FIELDS = ("title", "subtitle", "period", "location", "description", "link")

SECTION_RULES: list[tuple[str, str, str, str]] = [
    ("internship", "experience", "实习经历", r"实习经历|实习经验|实习"),
    ("experience", "experience", "工作经历", r"工作经历|工作经验|职业经历|任职经历|工作"),
    ("projects", "projects", "项目经历", r"项目经历|项目经验|项目|作品集?|作品"),
    ("education", "education", "教育背景", r"教育背景|教育经历|教育|学历"),
    ("skills", "skills", "专业技能", r"专业技能|技能特长|技能|技术栈"),
    ("honors", "custom", "荣誉获奖", r"荣誉获奖|荣誉奖项|获奖经历|荣誉|获奖|奖项"),
    ("certificates", "custom", "证书资质", r"证书资质|证书|资质"),
    ("opensource", "custom", "开源贡献", r"开源贡献|开源"),
    ("summary", "summary", "个人简介", r"个人简介|自我评价|关于我|简介|个人总结|个人优势"),
    ("jd", "jd", "目标岗位", r"目标岗位\s*JD|岗位\s*JD|目标岗位|岗位要求|任职要求|职位描述|岗位职责|职位要求|JD|招聘信息"),
]
PERIOD_RE = re.compile(
    r"(\d{4}\s*[./\-年]\s*\d{1,2}\s*月?|\d{4}\s*年?)\s*(?:[-–—~至到]+)\s*(至今|现在|今|\d{4}\s*[./\-年]\s*\d{1,2}\s*月?|\d{4}\s*年?)"
)
BULLET_RE = re.compile(r"^\s*(?:[-*•·●▪◦]|\d+[.、)）])\s*")
EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
PHONE_RE = re.compile(r"(?<!\d)(?:\+?86[\s-]?)?1[3-9]\d[\s-]?\d{4}[\s-]?\d{4}(?!\d)")
URL_RE = re.compile(r"(?:https?://|www\.)[^\s，,；;）)]+|(?:github|gitee|linkedin)\.com/[^\s，,；;）)]+", re.I)


def _s(v: Any) -> str:
    return str(v).strip() if v is not None else ""


def _slug(text: str, fallback: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9_-]", "", text or "")
    return s[:40] or fallback


# ------------------------------------------------------------- normalize
def normalize_item(raw: Any) -> dict[str, Any]:
    if isinstance(raw, str):
        raw = {"title": raw}
    if not isinstance(raw, dict):
        return {}
    item = {k: _s(raw.get(k)) for k in ITEM_FIELDS}
    bullets = raw.get("bullets") or []
    if isinstance(bullets, str):
        bullets = [BULLET_RE.sub("", ln) for ln in bullets.split("\n")]
    item["bullets"] = [_s(b) for b in bullets if _s(b)] if isinstance(bullets, list) else []
    tags = raw.get("tags") or []
    if isinstance(tags, str):
        tags = re.split(r"[,，、;；/]\s*", tags)
    item["tags"] = [_s(t) for t in tags if _s(t)]
    return item


def normalize_profile(raw: Any) -> dict[str, Any]:
    raw = raw if isinstance(raw, dict) else {}
    contacts = []
    for c in raw.get("contacts") or []:
        if isinstance(c, dict) and _s(c.get("value")):
            contacts.append({"label": _s(c.get("label")) or "联系方式", "value": _s(c.get("value"))})
    sections, used = [], set()
    for i, sec in enumerate(raw.get("sections") or []):
        if not isinstance(sec, dict):
            continue
        stype = _s(sec.get("type")) or "custom"
        stype = stype if stype in SECTION_TYPES else "custom"
        sid = _slug(_s(sec.get("id")), f"sec{i + 1}")
        while sid in used:
            sid = f"{sid}x"
        used.add(sid)
        items = [it for it in (normalize_item(x) for x in sec.get("items") or []) if it and any(
            it.get(k) for k in ("title", "subtitle", "description")) or (it and (it.get("bullets") or it.get("tags")))]
        out = {"id": sid, "type": stype, "title": _s(sec.get("title")) or "自定义栏目", "items": items}
        if _s(sec.get("text")):
            out["text"] = _s(sec.get("text"))
        sections.append(out)
    theme = raw.get("theme") if isinstance(raw.get("theme"), dict) else {}
    return {
        "name": _s(raw.get("name")),
        "title": _s(raw.get("title")),
        "contacts": contacts,
        "summary": _s(raw.get("summary")),
        "sections": sections,
        "theme": copy.deepcopy(theme),
        "custom_styles": _custom_styles(raw.get("custom_styles")),
    }


def _custom_styles(raw: Any) -> list[dict[str, Any]]:
    from services.folio_styles import MAX_CUSTOM_STYLES, normalize_spec

    out, seen = [], set()
    for spec in raw if isinstance(raw, list) else []:
        s = normalize_spec(spec)
        if s and s["key"] not in seen:
            seen.add(s["key"])
            out.append(s)
    return out[-MAX_CUSTOM_STYLES:]


def find_section(profile: dict[str, Any], key: Any) -> int:
    k = _s(key)
    if not k:
        return -1
    secs = profile.get("sections") or []
    for i, s in enumerate(secs):
        if s.get("id") == k or s.get("title") == k:
            return i
    for i, s in enumerate(secs):
        if k in s.get("title", "") or (s.get("title") and s["title"] in k):
            return i
    aliases = {"项目": "projects", "工作": "experience", "实习": "internship", "教育": "education", "技能": "skills"}
    for word, sid in aliases.items():
        if word in k:
            for i, s in enumerate(secs):
                if s.get("id") == sid:
                    return i
    return -1


# ------------------------------------------------------------- rule intake
def _match_header(line: str) -> tuple[str, str, str, str] | None:
    text = re.sub(r"^[#\s【\[《]+|[\]】》：:\s]+$", "", line.strip())
    if not text or len(text) > 14:
        return None
    for rule in SECTION_RULES:
        if re.fullmatch(rf"(?:{rule[3]})", text, re.I):
            return rule
    return None


def _split_header(text: str) -> dict[str, Any]:
    text = re.sub(r"^#+\s*", "", text).strip()
    item: dict[str, Any] = {"bullets": [], "tags": []}
    m = PERIOD_RE.search(text)
    if m:
        item["period"] = re.sub(r"\s+", "", m.group(0)).replace("--", "–").replace("-", " – ").replace("~", " – ")
        text = (text[: m.start()] + " " + text[m.end():]).strip()
    parts = [p.strip() for p in re.split(r"\s*[|｜]\s*|\s{2,}|\s*[，,]\s*(?=\S)", text) if p.strip(" ()（）")]
    if parts:
        item["title"] = parts[0]
    if len(parts) > 1:
        item["subtitle"] = parts[1]
    if len(parts) > 2:
        item["location"] = parts[2]
    return item


def _is_item_header(line: str) -> bool:
    s = line.strip()
    if s.startswith("###"):
        return True
    if BULLET_RE.match(s):
        return False
    return bool(PERIOD_RE.search(s) or ("|" in s or "｜" in s)) and len(s) < 90


def _tokens(text: str) -> set[str]:
    words = {w.lower() for w in re.findall(r"[A-Za-z][A-Za-z0-9+#.]{1,}", text)}
    for w in re.findall(r"[\u4e00-\u9fa5]{2,6}", text):
        words.add(w)
    return words


def rule_intake(source: str) -> dict[str, Any]:
    """Heuristic parser for pasted resume text / markdown. Returns profile with `questions`."""
    lines = [ln.rstrip() for ln in source.replace("\r", "").split("\n")]
    head: list[str] = []
    blocks: list[tuple[tuple[str, str, str, str], list[str]]] = []
    current: list[str] | None = None
    for ln in lines:
        rule = _match_header(ln) if ln.strip() else None
        if rule:
            current = []
            blocks.append((rule, current))
        elif current is None:
            head.append(ln)
        else:
            current.append(ln)

    profile: dict[str, Any] = {"name": "", "title": "", "contacts": [], "summary": "", "sections": []}
    jd_text = ""
    head_text = "\n".join(head)
    for m in EMAIL_RE.findall(source):
        if m not in [c["value"] for c in profile["contacts"]]:
            profile["contacts"].append({"label": "邮箱", "value": m})
    for m in PHONE_RE.findall(head_text or source)[:1]:
        profile["contacts"].append({"label": "电话", "value": re.sub(r"\s", "", m)})
    for m in URL_RE.findall(head_text):
        label = "GitHub" if "github" in m.lower() else ("LinkedIn" if "linkedin" in m.lower() else "主页")
        profile["contacts"].append({"label": label, "value": m if m.startswith("http") else f"https://{m}"})

    summary_parts: list[str] = []
    for ln in head:
        s = re.sub(r"^#+\s*", "", ln.strip())
        if not s:
            continue
        kv = re.match(r"^(姓名|名字|求职意向|目标岗位|应聘岗位|意向岗位|职位|城市|所在地|微信)[：:]\s*(.+)$", s)
        if kv:
            key, val = kv.groups()
            if key in ("姓名", "名字"):
                profile["name"] = val.strip()
            elif key in ("城市", "所在地", "微信"):
                profile["contacts"].append({"label": key, "value": val.strip()})
            else:
                profile["title"] = val.strip()
            continue
        if EMAIL_RE.search(s) or PHONE_RE.search(s) or URL_RE.search(s):
            continue
        cleaned = s.strip(" |｜·,，/")
        if not profile["name"] and cleaned and len(cleaned) <= 12 and not re.search(r"\d", cleaned):
            parts = re.split(r"\s*[|｜·/]\s*|\s+", cleaned)
            profile["name"] = parts[0]
            if len(parts) > 1 and not profile["title"]:
                profile["title"] = parts[1]
            continue
        if not profile["title"] and cleaned and len(cleaned) <= 20 and not summary_parts:
            profile["title"] = cleaned
            continue
        if cleaned and len(cleaned) > 4:
            summary_parts.append(cleaned)
    profile["summary"] = " ".join(summary_parts)

    merged: dict[str, dict[str, Any]] = {}
    for rule, body in blocks:
        sid, stype, title, _ = rule
        if stype == "jd":
            jd_text += "\n" + "\n".join(body)
            for ln in body:
                m = re.match(r"^\s*(?:岗位|职位|岗位名称|目标岗位|职位名称)[：:]\s*(.+)$", ln)
                if m:
                    profile["title"] = profile["title"] or m.group(1).strip()
            continue
        if stype == "summary":
            txt = " ".join(BULLET_RE.sub("", ln).strip() for ln in body if ln.strip())
            profile["summary"] = (profile["summary"] + " " + txt).strip() if profile["summary"] != txt else txt
            continue
        sec = merged.setdefault(sid, {"id": sid, "type": stype, "title": title, "items": []})
        items = sec["items"]
        if stype == "skills":
            for ln in body:
                s = BULLET_RE.sub("", ln).strip()
                if not s:
                    continue
                m = re.match(r"^([^：:]{1,12})[：:]\s*(.+)$", s)
                group, rest = (m.group(1), m.group(2)) if m else ("", s)
                tags = [t.strip() for t in re.split(r"[,，、;；/]|\s{1,}(?=[A-Za-z\u4e00-\u9fa5])", rest) if t.strip()]
                items.append({"title": group, "tags": tags, "bullets": []})
            continue
        cur: dict[str, Any] | None = None
        for ln in body:
            s = ln.strip()
            if not s:
                continue
            if _is_item_header(s):
                cur = _split_header(s)
                existing = next((it for it in items if it.get("title") and it.get("title") == cur.get("title")), None)
                if existing:
                    for k, v in cur.items():
                        if v and not existing.get(k):
                            existing[k] = v
                    cur = existing
                else:
                    items.append(cur)
            elif stype == "custom" and BULLET_RE.match(s):
                txt = BULLET_RE.sub("", s)
                it = _split_header(txt) if PERIOD_RE.search(txt) else {"title": txt, "bullets": [], "tags": []}
                items.append(it)
            else:
                txt = BULLET_RE.sub("", s)
                tm = re.match(r"^(?:技术栈|技术|关键词|Tags?)[：:]\s*(.+)$", txt, re.I)
                if cur is None:
                    cur = {"title": "", "bullets": [], "tags": []}
                    items.append(cur)
                if tm:
                    cur["tags"] = [t.strip() for t in re.split(r"[,，、;；/]", tm.group(1)) if t.strip()]
                elif not BULLET_RE.match(s) and not cur.get("bullets") and not cur.get("description") and cur.get("title"):
                    cur["description"] = txt
                elif txt not in cur["bullets"]:
                    cur["bullets"].append(txt)
    sections = list(merged.values())

    if jd_text.strip():
        jd_tokens = _tokens(jd_text)
        base = {"experience": 1, "internship": 2, "projects": 3, "skills": 4, "education": 6}

        def score(sec: dict[str, Any]) -> float:
            txt = " ".join(" ".join([i.get("title", ""), i.get("description", ""), *i.get("bullets", []), *i.get("tags", [])])
                           for i in sec["items"])
            hits = len(jd_tokens & _tokens(txt))
            return base.get(sec["id"], 5) - min(hits, 6) * 0.4
        sections.sort(key=score)
        for sec in sections:
            if sec["type"] in ("projects", "experience"):
                sec["items"].sort(key=lambda it: -len(jd_tokens & _tokens(" ".join([it.get("title", ""), *it.get("bullets", []), *it.get("tags", [])]))))
    profile["sections"] = sections
    norm = normalize_profile(profile)
    questions: list[str] = []
    if not norm["name"]:
        questions.append("您的姓名是什么？")
    if not norm["contacts"]:
        questions.append("希望在网站上展示哪些联系方式（邮箱、电话或个人主页）？")
    if not norm["title"]:
        questions.append("您的目标岗位是什么？我会据此调整栏目顺序。")
    for sec in norm["sections"]:
        if len(questions) >= 3:
            break
        if sec["type"] in ("experience", "projects"):
            weak = next((it for it in sec["items"] if not it["bullets"] and not it["description"]), None)
            if weak:
                questions.append(f"「{weak['title'] or sec['title']}」中您具体负责了什么？有没有可以公开的结果或数据？")
    if not norm["sections"] and len(questions) < 3:
        questions.append("请补充您的工作、实习或项目经历，可以按“公司 | 职位 | 时间”加要点的格式粘贴。")
    norm["questions"] = questions[:3]
    return norm


# ------------------------------------------------------------- operations
def _place(sections: list[dict[str, Any]], sec: dict[str, Any], op: dict[str, Any], profile: dict[str, Any]) -> None:
    if op.get("after") is not None and find_section(profile, op.get("after")) >= 0:
        sections.insert(find_section(profile, op.get("after")) + 1, sec)
    elif op.get("before") is not None and find_section(profile, op.get("before")) >= 0:
        sections.insert(find_section(profile, op.get("before")), sec)
    elif isinstance(op.get("index"), int):
        sections.insert(max(0, min(len(sections), op["index"])), sec)
    else:
        sections.append(sec)


def merge_theme(theme: dict[str, Any], op: dict[str, Any]) -> dict[str, Any]:
    t = copy.deepcopy(theme or {})
    if normalize_color(op.get("primary")):
        t["primary"] = normalize_color(op["primary"])
        if not op.get("keep_overrides"):
            t["overrides"] = {}
    for key in ("font", "heading_font", "layout"):
        if op.get(key):
            t[key] = str(op[key])
    for key in ("spacing", "radius"):
        if op.get(key) is not None:
            t[key] = op[key]
    if isinstance(op.get("overrides"), dict):
        t["overrides"] = {**(t.get("overrides") or {}),
                          **{k: normalize_color(v) for k, v in op["overrides"].items() if normalize_color(v)}}
    if isinstance(op.get("sections"), dict):
        secs = copy.deepcopy(t.get("sections") or {})
        for name, vals in op["sections"].items():
            if isinstance(vals, dict):
                secs[str(name)] = {**(secs.get(str(name)) or {}),
                                   **{k: normalize_color(v) for k, v in vals.items() if normalize_color(v)}}
        t["sections"] = secs
    return t


OP_ALIASES = {
    "update_section": "upsert_section", "add_section": "upsert_section", "replace_section": "upsert_section",
    "edit_section": "upsert_section", "edit_item": "update_item", "modify_item": "update_item",
    "replace_item": "update_item", "rewrite_item": "update_item", "delete_item": "remove_item",
    "delete_section": "remove_section", "set_theme": "theme", "switch_style": "style", "set_style": "style",
    "set_summary": "set_field", "set_name": "set_field", "set_title": "set_field",
}


def _int(v: Any) -> int | None:
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def _locate_item(items: list[dict[str, Any]], op: dict[str, Any], kind: str) -> int | None:
    """Find an item by `match` (original title) first, then by index."""
    target = _s(op.get("match") or op.get("item_title") or op.get("original_title"))
    if not target and kind != "add_item" and isinstance(op.get("item"), dict) and op.get("index") is None:
        target = _s(op["item"].get("title"))
    if target:
        for k, it in enumerate(items):
            t = it.get("title") or ""
            if t and (t == target or target in t or t in target):
                return k
    i = _int(op.get("index", op.get("item_index")))
    if i is not None and 0 <= i < len(items):
        return i
    return None


def _content(p: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in p.items() if k not in ("theme", "custom_styles")}


def apply_operations(profile: dict[str, Any], ops: list[Any]) -> tuple[dict[str, Any], str | None, list[str], bool, list[str]]:
    """Apply patch ops. Returns (profile, new_style, extra_css, content_changed, failures)."""
    p = normalize_profile(profile)
    original = copy.deepcopy(_content(p))
    new_style: str | None = None
    extra_css: list[str] = []
    failures: list[str] = []
    for raw in ops or []:
        if not isinstance(raw, dict):
            failures.append(f"无法识别的操作 {str(raw)[:60]}")
            continue
        op = dict(raw)
        name = _s(op.get("op"))
        kind = OP_ALIASES.get(name, name)
        if name in ("set_summary", "set_name", "set_title") and not op.get("field"):
            op["field"] = name.replace("set_", "")
        secs = p["sections"]
        sec_key = op.get("section") if not isinstance(op.get("section"), dict) else None
        sec_key = sec_key or op.get("section_id") or (op.get("id") if kind not in ("upsert_section",) else None)
        if kind == "set_field":
            if op.get("field") in ("name", "title", "summary"):
                p[op["field"]] = _s(op.get("value"))
            else:
                failures.append(f"set_field 的 field 只能是 name/title/summary（收到 {op.get('field')}）")
        elif kind == "set_contacts" and isinstance(op.get("contacts"), list):
            p["contacts"] = normalize_profile({"contacts": op["contacts"]})["contacts"]
        elif kind == "upsert_section" and isinstance(op.get("section"), dict):
            new = normalize_profile({"sections": [op["section"]]})["sections"]
            if not new:
                failures.append("upsert_section 的 section 无效")
                continue
            sec = new[0]
            idx = find_section(p, op["section"].get("id")) if op["section"].get("id") else -1
            if idx < 0 and any(s["title"] == sec["title"] for s in secs):
                idx = find_section(p, sec["title"])
            if idx >= 0:
                sec["id"] = secs[idx]["id"]
                if op.get("after") or op.get("before") or op.get("index") is not None:
                    secs.pop(idx)
                    _place(secs, sec, op, p)
                else:
                    secs[idx] = sec
            else:
                while any(s["id"] == sec["id"] for s in secs):
                    sec["id"] += "x"
                _place(secs, sec, op, p)
        elif kind == "remove_section":
            idx = find_section(p, sec_key)
            if idx >= 0:
                secs.pop(idx)
            else:
                failures.append(f"找不到要删除的栏目「{sec_key}」")
        elif kind == "move_section":
            idx = find_section(p, sec_key)
            if idx >= 0:
                sec = secs.pop(idx)
                _place(secs, sec, op, p)
            else:
                failures.append(f"找不到要移动的栏目「{sec_key}」")
        elif kind in ("update_item", "add_item", "remove_item"):
            idx = find_section(p, sec_key)
            if idx < 0:
                failures.append(f"{kind} 找不到栏目「{sec_key}」，可用栏目 id：" + "、".join(s["id"] for s in secs))
                continue
            items = secs[idx]["items"]
            if kind == "add_item":
                if isinstance(op.get("item"), dict):
                    items.append(normalize_item(op["item"]))
                else:
                    failures.append("add_item 缺少 item")
                continue
            i = _locate_item(items, op, kind)
            if i is None:
                titles = "、".join(f"{k}:{it.get('title')}" for k, it in enumerate(items))
                failures.append(f"{kind} 在「{secs[idx]['title']}」中找不到目标条目（现有条目 {titles}），请用 match 填写条目原标题")
            elif kind == "update_item":
                if isinstance(op.get("item"), dict):
                    items[i] = normalize_item({**items[i], **op["item"]})
                else:
                    failures.append("update_item 缺少 item")
            else:
                items.pop(i)
        elif kind == "theme":
            p["theme"] = merge_theme(p.get("theme") or {}, op)
        elif kind == "style":
            if op.get("style") in STYLES or any(s.get("key") == op.get("style") for s in p.get("custom_styles") or []):
                new_style = op["style"]
            else:
                failures.append(f"未知样式 {op.get('style')}")
        elif kind == "css" and _s(op.get("css")):
            extra_css.append(_s(op["css"])[:8000])
        else:
            failures.append(f"无法执行的操作 {name or '(缺少 op)'}")
    return p, new_style, extra_css, _content(p) != original, failures


# ------------------------------------------------------------- rule edit
REGION_WORDS = {"页脚": "footer", "底部": "footer", "页头": "header", "顶部": "header", "头部": "header",
                "侧栏": "header", "简介": "summary"}
COLOR_TOKEN = r"(#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|rgba?\([^)]*\)|" + "|".join(
    sorted(map(re.escape, COLOR_NAMES), key=len, reverse=True)) + ")"


def rule_edit(message: str, profile: dict[str, Any]) -> tuple[list[dict[str, Any]], list[str]]:
    """Understand common edit commands without an LLM."""
    ops: list[dict[str, Any]] = []
    notes: list[str] = []
    text = message.strip()
    clauses = [c for c in re.split(r"[，,。；;\n]+", text) if c.strip()]
    section_theme: dict[str, dict[str, str]] = {}
    for clause in clauses:
        region = next((v for k, v in REGION_WORDS.items() if k in clause), None)
        if not region:
            idx = find_section(profile, re.sub(r"(背景|颜色|色|设为|改成|换成|单独|的|区块|栏目|部分).*$", "", clause).strip())
            if idx >= 0 and re.search(r"背景|颜色|文字", clause) and "主题" not in clause:
                region = profile["sections"][idx]["id"]
        colors = re.findall(COLOR_TOKEN, clause)
        if region and colors and re.search(r"背景|颜色|色|文字|字", clause):
            key = "text" if re.search(r"文字|字色|字体颜色", clause) and "背景" not in clause else "background"
            section_theme.setdefault(region, {})[key] = colors[0]
            notes.append(f"已将{clause.strip()}")
            continue
        if colors and re.search(r"主题|主色|配色|整体|换成|改成|颜色", clause):
            ops.append({"op": "theme", "primary": colors[0]})
            notes.append(f"主题色已换成 {colors[0]}，背景、卡片、文字、链接和按钮已协调调整")
            continue
        m = re.search(r"(?:新增|添加|增加|加上?)[「“\"]?(.+?)[」”\"]?(?:栏目|板块|模块|部分)", clause)
        if m:
            title = m.group(1).strip()
            pos = re.search(r"(?:放到|放在|移到|位于|在)[「“\"]?(.+?)[」”\"]?(?:的)?(后面|之后|后|前面|之前|前)", text)
            sec_id = "honors" if "荣誉" in title or "获奖" in title else _slug("", f"custom{len(profile['sections']) + 1}")
            op: dict[str, Any] = {"op": "upsert_section", "section": {"id": sec_id, "type": "custom", "title": title, "items": []}}
            if pos:
                op["after" if "后" in pos.group(2) else "before"] = pos.group(1)
            ops.append(op)
            notes.append(f"已新增「{title}」栏目" + (f"，位于「{pos.group(1)}」{'之后' if '后' in pos.group(2) else '之前'}" if pos else "")
                         + "，请在对话中或「编辑资料」里补充具体奖项")
            continue
        m = re.search(r"(?:删除|删掉|去掉|移除)[「“\"]?(.+?)[」”\"]?(?:栏目|板块|模块|部分)?$", clause)
        if m and find_section(profile, m.group(1)) >= 0:
            ops.append({"op": "remove_section", "id": m.group(1)})
            notes.append(f"已删除「{m.group(1)}」")
            continue
        m = re.search(r"把?[「“\"]?(.+?)[」”\"]?(?:栏目)?(?:移到|移动到|放到|挪到)[「“\"]?(.+?)[」”\"]?(?:的)?(后面|之后|后|前面|之前|前|最前|顶部)", clause)
        if m and find_section(profile, m.group(1)) >= 0:
            op = {"op": "move_section", "id": m.group(1)}
            if m.group(3) in ("最前", "顶部"):
                op["index"] = 0
            else:
                op["after" if "后" in m.group(3) else "before"] = m.group(2)
            ops.append(op)
            notes.append(f"已移动「{m.group(1)}」")
            continue
        if "单栏" in clause:
            ops.append({"op": "theme", "layout": "single"})
            notes.append("已调整为单栏布局")
        elif "双栏" in clause:
            ops.append({"op": "theme", "layout": "double"})
            notes.append("已调整为双栏布局")
        if re.search(r"衬线|宋体", clause) and "无衬线" not in clause:
            ops.append({"op": "theme", "font": "serif", "heading_font": "serif"})
            notes.append("字体已换成衬线体")
        elif re.search(r"无衬线|黑体", clause):
            ops.append({"op": "theme", "font": "sans", "heading_font": "sans"})
            notes.append("字体已换成无衬线体")
        elif "等宽" in clause:
            ops.append({"op": "theme", "heading_font": "mono"})
            notes.append("标题已换成等宽字体")
        elif "圆体" in clause or "圆润" in clause:
            ops.append({"op": "theme", "font": "rounded", "heading_font": "rounded"})
            notes.append("字体已换成圆体")
        if re.search(r"宽松|间距(?:大|加大|增大)|加大间距|留白多", clause):
            ops.append({"op": "theme", "spacing": 1.35})
            notes.append("间距已加大")
        elif re.search(r"紧凑|间距(?:小|减小|缩小)|减小间距", clause):
            ops.append({"op": "theme", "spacing": 0.8})
            notes.append("间距已收紧")
        if re.search(r"直角|方角", clause):
            ops.append({"op": "theme", "radius": 0})
            notes.append("卡片已改为直角")
        elif "圆角" in clause:
            ops.append({"op": "theme", "radius": 20})
            notes.append("圆角已加大")
        for key, meta in STYLES.items():
            if re.search(r"样式|风格|模板|换成|切换", clause) and (meta["name"] in clause or meta["name"][:2] in clause):
                ops.append({"op": "style", "style": key})
                notes.append(f"已切换为「{meta['name']}」样式")
                break
    if section_theme:
        ops.append({"op": "theme", "sections": section_theme})
    return ops, notes

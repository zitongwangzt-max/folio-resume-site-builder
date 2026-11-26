"""OpenAI-compatible LLM client, token encryption, and JSON extraction for Folio."""

from __future__ import annotations

import base64
import hashlib
import json
import os
import re
from pathlib import Path
from typing import Any

import httpx
from cryptography.fernet import Fernet, InvalidToken

PROMPT_DIR = Path(__file__).resolve().parent.parent / "prompts"


class LLMError(Exception):
    """User-facing LLM failure."""


def load_prompt(name: str) -> str:
    return (PROMPT_DIR / name).read_text(encoding="utf-8")


def _fernet() -> Fernet:
    secret = os.environ.get("JWT_SECRET_KEY") or os.environ.get("MASK_KEY") or "folio-local-dev"
    key = base64.urlsafe_b64encode(hashlib.sha256(f"folio-llm::{secret}".encode()).digest())
    return Fernet(key)


def encrypt_token(token: str) -> str:
    return _fernet().encrypt(token.encode()).decode()


def decrypt_token(value: str | None) -> str:
    if not value:
        return ""
    try:
        return _fernet().decrypt(value.encode()).decode()
    except (InvalidToken, ValueError):
        return ""


def normalize_base_url(url: str) -> str:
    url = (url or "").strip().rstrip("/")
    if not re.match(r"^https?://", url):
        raise LLMError("API Base URL 必须以 http:// 或 https:// 开头")
    for suffix in ("/chat/completions", "/models"):
        if url.endswith(suffix):
            url = url[: -len(suffix)]
    return url


def _err_detail(resp: httpx.Response) -> str:
    try:
        data = resp.json()
        msg = data.get("error", {}).get("message") if isinstance(data.get("error"), dict) else data.get("error") or data.get("detail")
        return str(msg or resp.text)[:300]
    except Exception:  # noqa: BLE001
        return resp.text[:300]


async def list_models(base_url: str, token: str) -> list[str]:
    base = normalize_base_url(base_url)
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get(f"{base}/models", headers=headers)
    except httpx.HTTPError as exc:
        raise LLMError(f"无法连接模型服务：{type(exc).__name__}") from exc
    if resp.status_code >= 400:
        raise LLMError(f"获取模型失败（HTTP {resp.status_code}）：{_err_detail(resp)}")
    try:
        data = resp.json()
    except ValueError as exc:
        raise LLMError("模型服务返回的不是 JSON") from exc
    items = data.get("data") if isinstance(data, dict) else data
    ids = [str(m.get("id")) for m in items or [] if isinstance(m, dict) and m.get("id")]
    return sorted(set(ids))


async def chat(base_url: str, token: str, model: str, messages: list[dict[str, str]],
               temperature: float = 0.3, timeout: float = 180) -> str:
    base = normalize_base_url(base_url)
    if not model:
        raise LLMError("尚未设置模型 ID")
    payload: dict[str, Any] = {"model": model, "messages": messages, "temperature": temperature}
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(f"{base}/chat/completions", headers=headers, json=payload)
    except httpx.TimeoutException as exc:
        raise LLMError("模型响应超时，请稍后重试") from exc
    except httpx.HTTPError as exc:
        raise LLMError(f"无法连接模型服务：{type(exc).__name__}") from exc
    if resp.status_code >= 400:
        raise LLMError(f"模型调用失败（HTTP {resp.status_code}）：{_err_detail(resp)}")
    try:
        data = resp.json()
        content = data["choices"][0]["message"]["content"]
    except (ValueError, KeyError, IndexError, TypeError) as exc:
        raise LLMError("模型返回格式无法识别") from exc
    if isinstance(content, list):
        content = "".join(part.get("text", "") for part in content if isinstance(part, dict))
    return str(content or "")


def extract_json(text: str) -> dict[str, Any] | None:
    """Extract the first JSON object from model output (handles code fences / prose)."""
    if not text:
        return None
    candidates = re.findall(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.S)
    start, end = text.find("{"), text.rfind("}")
    if start >= 0 and end > start:
        candidates.append(text[start:end + 1])
    for c in candidates:
        try:
            data = json.loads(c)
            if isinstance(data, dict):
                return data
        except json.JSONDecodeError:
            continue
    return None


async def chat_json(base_url: str, token: str, model: str, messages: list[dict[str, str]],
                    validate) -> dict[str, Any]:
    """Call the model, parse + validate JSON, repair once on failure."""
    raw = await chat(base_url, token, model, messages)
    data = extract_json(raw)
    problem = "无法解析为 JSON 对象" if data is None else validate(data)
    if not problem:
        return data  # type: ignore[return-value]
    repair = messages + [
        {"role": "assistant", "content": raw[:12000]},
        {"role": "user", "content": f"你上一条输出有格式问题：{problem}。请严格按照规定的 JSON 格式重新输出完整结果，只输出 JSON 对象。"},
    ]
    raw2 = await chat(base_url, token, model, repair)
    data2 = extract_json(raw2)
    problem2 = "无法解析为 JSON 对象" if data2 is None else validate(data2)
    if problem2:
        raise LLMError(f"模型输出格式有误（已尝试修复一次）：{problem2}")
    return data2  # type: ignore[return-value]

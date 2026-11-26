"""User-defined resume styles: spec normalization and built-in presets (used without an LLM)."""

from __future__ import annotations

import re
import secrets
from typing import Any

from services.folio_render import FONT_STACKS, STYLES, clean_css, normalize_color

MAX_CUSTOM_STYLES = 12
PALETTE_KEYS = {"primary", "bg", "surface", "text", "muted", "heading", "link", "button", "button_text", "border",
                "accent_soft", "hero_bg", "hero_text", "aside_bg", "aside_text"}
SECTION_KEYS = {"background", "text", "heading", "link", "card", "border"}


def _s(v: Any) -> str:
    return str(v).strip() if v is not None else ""


def normalize_spec(raw: Any, fallback_name: str = "") -> dict[str, Any] | None:
    """Validate a custom style spec: {key, name, description, base, theme, css}."""
    if not isinstance(raw, dict):
        return None
    key = raw.get("key")
    if not (isinstance(key, str) and re.fullmatch(r"c[a-f0-9]{6,16}", key)):
        key = "c" + secrets.token_hex(4)
    base = raw.get("base") if raw.get("base") in STYLES else "cards"
    th = raw.get("theme") if isinstance(raw.get("theme"), dict) else {}
    theme: dict[str, Any] = {}
    if normalize_color(th.get("primary")):
        theme["primary"] = normalize_color(th["primary"])
    for k in ("font", "heading_font"):
        if th.get(k) in FONT_STACKS:
            theme[k] = th[k]
    try:
        if th.get("spacing") is not None:
            theme["spacing"] = max(0.6, min(1.8, float(th["spacing"])))
    except (TypeError, ValueError):
        pass
    try:
        if th.get("radius") is not None:
            theme["radius"] = max(0, min(32, int(th["radius"])))
    except (TypeError, ValueError):
        pass
    if th.get("layout") in ("single", "double"):
        theme["layout"] = th["layout"]
    overrides = th.get("overrides") if isinstance(th.get("overrides"), dict) else {}
    theme["overrides"] = {k: normalize_color(v) for k, v in overrides.items() if k in PALETTE_KEYS and normalize_color(v)}
    sections: dict[str, dict[str, str]] = {}
    for name, vals in (th.get("sections") or {}).items() if isinstance(th.get("sections"), dict) else []:
        sid = re.sub(r"[^a-zA-Z0-9_-]", "", str(name))
        if sid and isinstance(vals, dict):
            clean = {k: normalize_color(v) for k, v in vals.items() if k in SECTION_KEYS and normalize_color(v)}
            if clean:
                sections[sid] = clean
    theme["sections"] = sections
    name = _s(raw.get("name"))[:16] or _s(fallback_name)[:12] or "自定义样式"
    return {
        "key": key,
        "name": name,
        "description": _s(raw.get("description"))[:60] or "按你的描述生成的样式",
        "base": base,
        "theme": theme,
        "css": clean_css(_s(raw.get("css")))[:12000],
    }


PRESETS: list[tuple[str, dict[str, Any]]] = [
    (r"暗|黑|夜|深色|科技|极客|赛博|程序员|酷", {
        "name": "暗夜科技", "description": "深色背景、霓虹蓝点缀与等宽标题", "base": "cards",
        "theme": {"primary": "#38BDF8", "heading_font": "mono", "radius": 10, "overrides": {
            "bg": "#0B1120", "surface": "#111827", "text": "#CBD5E1", "heading": "#F8FAFC", "muted": "#94A3B8",
            "border": "#1E293B", "accent_soft": "#0C2A43", "link": "#7DD3FC", "hero_bg": "#020617", "hero_text": "#F8FAFC"}},
        "css": (".hero{background:radial-gradient(1200px 400px at 20% 0%,#0C4A6E 0%,#020617 60%) !important}"
                ".hero h1{letter-spacing:.02em}.tag{color:#7DD3FC;border:1px solid #155E75;background:transparent}"
                ".content>.block{box-shadow:0 0 0 1px #1E293B,0 20px 40px rgba(0,0,0,.35)}"
                ".block h2{color:#38BDF8}.footer{border-color:#1E293B}"),
    }),
    (r"杂志|编辑|衬线|优雅|文艺|人文|报刊|高级", {
        "name": "杂志编辑", "description": "大号衬线标题、细线分隔的编辑排版", "base": "minimal",
        "theme": {"primary": "#9F1239", "font": "serif", "heading_font": "serif", "spacing": 1.15,
                  "overrides": {"bg": "#FFFCF7", "text": "#292524", "heading": "#1C1917", "muted": "#78716C",
                                "border": "#E7E5E4", "accent_soft": "#FBEFF2"}},
        "css": (".hero h1{font-size:56px;font-weight:700;letter-spacing:-.02em}"
                ".block h2{font-size:15px;letter-spacing:.3em;border-top:2px solid #1C1917;padding-top:10px}"
                ".summary{font-size:19px;font-style:italic;line-height:1.8}.tag{background:transparent;border:1px solid #D6D3D1}"
                "@media (max-width:640px){.hero h1{font-size:38px}}"),
    }),
    (r"复古|打字机|报纸|旧|怀旧|手稿|纸", {
        "name": "复古打字机", "description": "米色纸张、等宽字体与虚线分隔", "base": "minimal",
        "theme": {"primary": "#3F3F46", "font": "mono", "heading_font": "mono", "radius": 0,
                  "overrides": {"bg": "#F6F1E3", "surface": "#FBF8EF", "text": "#27272A", "heading": "#18181B",
                                "muted": "#52525B", "border": "#D6CFBA", "accent_soft": "#ECE4CC", "link": "#7C2D12"}},
        "css": (".hero{border-bottom:2px dashed #A8A29E}.block h2{text-transform:none;letter-spacing:.05em;color:#7C2D12}"
                ".block h2::before{content:'# '}.item{border-left:2px dashed #D6CFBA;padding-left:14px}"
                ".tag{border-radius:0;border:1px solid #A8A29E;background:transparent}"),
    }),
    (r"清新|薄荷|自然|绿|森林|环保|温柔", {
        "name": "清新薄荷", "description": "薄荷绿侧栏、圆润字体与大圆角", "base": "sidebar",
        "theme": {"primary": "#0F9E79", "font": "rounded", "heading_font": "rounded", "radius": 22,
                  "overrides": {"aside_bg": "#0F766E", "bg": "#F0FBF7", "accent_soft": "#D7F5EA"}},
        "css": (".shell{box-shadow:0 30px 60px rgba(15,118,110,.12)}.aside img.avatar{border-radius:28px}"
                ".main .block h2{color:#0F766E}.tag{background:#D7F5EA;color:#065F46}"),
    }),
    (r"活泼|彩色|多彩|创意|设计师|有趣|年轻|橙|活力", {
        "name": "活力创意", "description": "暖橙页头、大圆角卡片和彩色标签", "base": "cards",
        "theme": {"primary": "#F97316", "font": "rounded", "heading_font": "rounded", "radius": 24,
                  "overrides": {"bg": "#FFF7ED", "hero_bg": "#F97316", "hero_text": "#FFFFFF", "accent_soft": "#FFEDD5"}},
        "css": (".hero{background:linear-gradient(120deg,#F97316,#EC4899) !important}"
                ".tag:nth-child(3n+1){background:#FFEDD5;color:#9A3412}.tag:nth-child(3n+2){background:#FCE7F3;color:#9D174D}"
                ".tag:nth-child(3n){background:#E0F2FE;color:#075985}.grid .card{transform:rotate(-.3deg)}"),
    }),
    (r"商务|专业|稳重|金融|咨询|正式|管理|律师", {
        "name": "商务稳重", "description": "深海军蓝侧栏、衬线标题与直角线条", "base": "sidebar",
        "theme": {"primary": "#1F3A5F", "heading_font": "serif", "radius": 4,
                  "overrides": {"aside_bg": "#13233B", "bg": "#F4F6F9"}},
        "css": (".main .block h2{color:#1F3A5F;border-bottom:1px solid #D5DCE6;padding-bottom:8px}"
                ".aside img.avatar{border-radius:6px}.tag{border-radius:3px}"),
    }),
]


def preset_spec(description: str) -> dict[str, Any]:
    """Pick a built-in preset from keywords; apply any color or layout words in the description."""
    text = description or ""
    raw: dict[str, Any] | None = None
    for pattern, spec in PRESETS:
        if re.search(pattern, text):
            raw = {**spec, "theme": {**spec["theme"]}}
            break
    if raw is None:
        raw = {"name": "", "description": f"按“{text[:24]}”生成", "base": "cards",
               "theme": {"primary": "#1D4ED8", "radius": 16}, "css": ""}
        raw["name"] = re.sub(r"(生成|创建|新建|设计|做|来|一个|一套|一款|帮我|请|的|样式|风格|主题|模板)", "", text)[:10] or "自定义样式"
    from services.folio_render import COLOR_NAMES

    colors = re.findall(r"#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|" + "|".join(
        sorted(map(re.escape, COLOR_NAMES), key=len, reverse=True)), text)
    if colors and normalize_color(colors[0]):
        raw["theme"]["primary"] = normalize_color(colors[0])
    if "单栏" in text:
        raw["base"] = "minimal"
    elif "侧栏" in text or "双栏" in text:
        raw["base"] = "sidebar"
    elif "卡片" in text:
        raw["base"] = "cards"
    return normalize_spec(raw) or {}

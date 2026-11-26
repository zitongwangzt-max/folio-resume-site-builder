"""Folio resume site renderer: profile JSON -> standalone HTML in three styles."""

from __future__ import annotations

import colorsys
import html
import re
from typing import Any

AVATAR_TOKEN = "__FOLIO_AVATAR__"

STYLES: dict[str, dict[str, str]] = {
    "minimal": {"name": "极简单栏", "description": "大量留白、单列阅读，适合内容扎实的简历"},
    "sidebar": {"name": "双栏侧栏", "description": "左侧个人信息与技能，右侧经历，信息密度高"},
    "cards": {"name": "项目卡片", "description": "醒目页头与卡片网格，突出项目成果"},
}
STYLE_ORDER = ["minimal", "sidebar", "cards"]

COLOR_NAMES: dict[str, str] = {
    "雾霾蓝": "#6B8CAE", "灰蓝": "#64748B", "藏青": "#1F3A5F", "海军蓝": "#1E3A8A", "宝蓝": "#1D4ED8",
    "天蓝": "#0EA5E9", "蓝": "#1D4ED8", "墨绿": "#2F5D50", "森林绿": "#166534", "薄荷": "#3EB489",
    "莫兰迪绿": "#7D8F7E", "绿": "#16A34A", "青": "#0F9E99", "酒红": "#8B2E3C", "红": "#DC2626",
    "珊瑚": "#F06A5D", "粉": "#DB2777", "橙": "#EA7A1A", "焦糖": "#B5651D", "金": "#B8860B",
    "紫": "#6D4AFF", "薰衣草": "#8B7FD4", "黑": "#111827", "石墨": "#374151", "灰": "#4B5563",
    "棕": "#7C4A2D", "米": "#C8B79A",
}

FONT_STACKS = {
    "sans": '"Noto Sans SC","PingFang SC","Microsoft YaHei",system-ui,sans-serif',
    "serif": '"Noto Serif SC","Songti SC","SimSun",Georgia,serif',
    "mono": '"JetBrains Mono","SFMono-Regular",Menlo,monospace',
    "rounded": '"Nunito","PingFang SC","Microsoft YaHei",system-ui,sans-serif',
}

DEFAULT_THEME = {"primary": "#1D4ED8", "font": "sans", "heading_font": "sans", "spacing": 1.0,
                 "radius": 12, "layout": "", "overrides": {}, "sections": {}}


# ---------------------------------------------------------------- colors
def normalize_color(value: Any) -> str | None:
    """Return #RRGGBB for hex / rgb() / Chinese color names, else None."""
    if not isinstance(value, str):
        return None
    v = value.strip()
    if v in COLOR_NAMES:
        return COLOR_NAMES[v]
    m = re.fullmatch(r"#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})", v)
    if m:
        h = m.group(1)
        if len(h) == 3:
            h = "".join(c * 2 for c in h)
        return "#" + h.upper()
    m = re.fullmatch(r"rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3}).*\)", v)
    if m:
        r, g, b = (max(0, min(255, int(x))) for x in m.groups())
        return f"#{r:02X}{g:02X}{b:02X}"
    return None


def _rgb(hex_color: str) -> tuple[float, float, float]:
    h = hex_color.lstrip("#")
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))  # type: ignore[return-value]


def _hex(r: float, g: float, b: float) -> str:
    return "#" + "".join(f"{max(0, min(255, round(c * 255))):02X}" for c in (r, g, b))


def luminance(hex_color: str) -> float:
    def ch(c: float) -> float:
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = _rgb(hex_color)
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)


def _with_l(hex_color: str, lightness: float, sat_scale: float = 1.0) -> str:
    r, g, b = _rgb(hex_color)
    h, _l, s = colorsys.rgb_to_hls(r, g, b)
    return _hex(*colorsys.hls_to_rgb(h, lightness, min(1.0, s * sat_scale)))


def contrast_text(bg: str) -> str:
    return "#0F172A" if luminance(bg) > 0.45 else "#FFFFFF"


def derive_palette(theme: dict[str, Any]) -> dict[str, str]:
    """Coordinate page colors from the primary color; explicit overrides win."""
    primary = normalize_color(theme.get("primary")) or DEFAULT_THEME["primary"]
    _h, l, _s = colorsys.rgb_to_hls(*_rgb(primary))
    link = primary if l < 0.55 else _with_l(primary, 0.42)
    pal = {
        "primary": primary,
        "bg": _with_l(primary, 0.975, 0.6),
        "surface": "#FFFFFF",
        "text": _with_l(primary, 0.13, 0.5),
        "muted": _with_l(primary, 0.40, 0.25),
        "heading": _with_l(primary, 0.18, 0.7),
        "link": link,
        "button": primary,
        "button_text": contrast_text(primary),
        "border": _with_l(primary, 0.88, 0.5),
        "accent_soft": _with_l(primary, 0.93, 0.8),
        "hero_bg": primary if l < 0.6 else _with_l(primary, 0.35),
    }
    pal["hero_text"] = contrast_text(pal["hero_bg"])
    pal["aside_bg"] = _with_l(primary, 0.2, 0.7)
    pal["aside_text"] = contrast_text(pal["aside_bg"])
    for key, val in (theme.get("overrides") or {}).items():
        c = normalize_color(val)
        if c and key in pal:
            pal[key] = c
    return pal


def theme_css(theme_in: dict[str, Any] | None) -> str:
    """CSS for <style id="folio-theme">: variables + per-section overrides."""
    theme = {**DEFAULT_THEME, **(theme_in or {})}
    pal = derive_palette(theme)
    font = FONT_STACKS.get(str(theme.get("font")), FONT_STACKS["sans"])
    hfont = FONT_STACKS.get(str(theme.get("heading_font")), font)
    try:
        spacing = max(0.6, min(1.8, float(theme.get("spacing") or 1)))
    except (TypeError, ValueError):
        spacing = 1.0
    try:
        radius = max(0, min(32, int(theme.get("radius") if theme.get("radius") is not None else 12)))
    except (TypeError, ValueError):
        radius = 12
    vars_ = ";".join(f"--{k.replace('_', '-')}:{v}" for k, v in pal.items())
    css = [f":root{{{vars_};--font:{font};--heading-font:{hfont};--space:{spacing};--radius:{radius}px}}"]
    for sec, vals in (theme.get("sections") or {}).items():
        if not isinstance(vals, dict):
            continue
        sel = f'[data-section="{re.sub(r"[^a-zA-Z0-9_-]", "", str(sec))}"]'
        bg = normalize_color(vals.get("background"))
        text = normalize_color(vals.get("text")) or (contrast_text(bg) if bg else None)
        rules = []
        if bg:
            rules.append(f"background:{bg} !important")
        if text:
            rules.append(f"color:{text} !important")
        if rules:
            css.append(f"{sel}{{{';'.join(rules)}}}")
        if text:
            css.append(f"{sel} h1,{sel} h2,{sel} h3,{sel} .muted,{sel} .meta{{color:{text} !important}}")
        for key, prop, sub in (("heading", "color", "h2,{s} h3"), ("link", "color", "a"),
                               ("card", "background", ".card"), ("border", "border-color", ".card")):
            c = normalize_color(vals.get(key))
            if c:
                css.append(f"{sel} {sub.format(s=sel)}{{{prop}:{c} !important}}")
        if text and not normalize_color(vals.get("link")):
            css.append(f"{sel} a{{color:{text} !important}}")
    for key in ("style_css", "custom_css"):
        extra = str(theme.get(key) or "")
        if extra:
            css.append(clean_css(extra))
    return "\n".join(css)


def clean_css(css: str) -> str:
    """Remove constructs that could break out of <style> or load/run external code."""
    out = re.sub(r"</?\s*style[^>]*>|<\s*/?\s*script[^>]*>|expression\s*\(|javascript:|vbscript:|@import|behavior\s*:|-moz-binding",
                 "", css or "", flags=re.I)
    return out.replace("<", "")[:20000]


# ---------------------------------------------------------------- custom styles
def find_custom(profile: dict[str, Any], key: Any) -> dict[str, Any] | None:
    return next((s for s in profile.get("custom_styles") or [] if isinstance(s, dict) and s.get("key") == key), None)


def style_label(profile: dict[str, Any], key: str | None) -> str:
    if key in STYLES:
        return STYLES[key]["name"]
    spec = find_custom(profile, key)
    return spec["name"] if spec else ""


def theme_for_style(theme: dict[str, Any] | None, spec: dict[str, Any] | None) -> dict[str, Any]:
    """Theme to use for a style: built-ins drop style CSS; custom styles apply their own look."""
    import copy

    t = copy.deepcopy(theme or {})
    t.pop("style_css", None)
    if t.pop("_from_style", None):
        # Colors injected by a previous custom style must not leak into another style.
        t["overrides"] = {}
    if not spec:
        return t
    st = spec.get("theme") or {}
    for k in ("primary", "font", "heading_font", "spacing", "radius", "layout"):
        if st.get(k) not in (None, ""):
            t[k] = st[k]
        elif k == "layout":
            t.pop(k, None)
    t["overrides"] = dict(st.get("overrides") or {})
    t["sections"] = {**(t.get("sections") or {}), **(st.get("sections") or {})}
    t["style_css"] = spec.get("css") or ""
    t["_from_style"] = spec.get("key")
    return t


def base_of(profile: dict[str, Any], key: str | None) -> str:
    if key in STYLES:
        return key  # type: ignore[return-value]
    spec = find_custom(profile, key)
    return spec["base"] if spec and spec.get("base") in STYLES else "minimal"


def render_style(profile: dict[str, Any], key: str | None) -> str:
    """Render with the profile's current theme using a built-in or custom style key."""
    return render(profile, base_of(profile, key))


def preview_style(profile: dict[str, Any], key: str) -> str:
    """Candidate preview: apply the style's own look to the current content."""
    spec = None if key in STYLES else find_custom(profile, key)
    p = {**profile, "theme": theme_for_style(profile.get("theme"), spec)}
    return render(p, base_of(profile, key))


def upsert_theme_style(doc: str, theme: dict[str, Any] | None) -> str:
    """Replace or insert <style id="folio-theme"> in arbitrary HTML."""
    block = f'<style id="folio-theme">\n{theme_css(theme)}\n</style>'
    pattern = re.compile(r'<style id="folio-theme">.*?</style>', re.S)
    if pattern.search(doc):
        return pattern.sub(lambda _m: block, doc, count=1)
    if "</head>" in doc:
        return doc.replace("</head>", block + "\n</head>", 1)
    return block + doc


# ---------------------------------------------------------------- html parts
def e(value: Any) -> str:
    return html.escape(str(value or ""), quote=True)


def _link(value: str) -> str:
    v = value.strip()
    if re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", v):
        return f'<a href="mailto:{e(v)}">{e(v)}</a>'
    if re.match(r"https?://", v):
        return f'<a href="{e(v)}" target="_blank" rel="noopener">{e(re.sub(r"^https?://", "", v))}</a>'
    if re.fullmatch(r"(www\.)?[\w-]+(\.[\w-]+)+(/\S*)?", v):
        return f'<a href="https://{e(v)}" target="_blank" rel="noopener">{e(v)}</a>'
    return e(v)


def _contacts(profile: dict[str, Any], cls: str = "contacts") -> str:
    items = [c for c in profile.get("contacts") or [] if isinstance(c, dict) and c.get("value")]
    if not items:
        return ""
    lis = "".join(f'<li><span class="clabel">{e(c.get("label"))}</span>{_link(str(c["value"]))}</li>' for c in items)
    return f'<ul class="{cls}">{lis}</ul>'


def _avatar(profile: dict[str, Any], size_cls: str = "") -> str:
    return (f'<img class="avatar {size_cls}" data-folio-avatar src="{AVATAR_TOKEN}" '
            f'alt="{e(profile.get("name") or "头像")}的头像" title="点击上传或更换头像">')


def _item(item: dict[str, Any], card: bool = False) -> str:
    meta = " · ".join(e(x) for x in (item.get("subtitle"), item.get("location")) if x)
    period = f'<span class="period">{e(item.get("period"))}</span>' if item.get("period") else ""
    desc = f'<p class="desc">{e(item.get("description"))}</p>' if item.get("description") else ""
    bullets = "".join(f"<li>{e(b)}</li>" for b in item.get("bullets") or [] if b)
    bullets = f"<ul class=\"bullets\">{bullets}</ul>" if bullets else ""
    tags = "".join(f"<span class=\"tag\">{e(t)}</span>" for t in item.get("tags") or [] if t)
    tags = f'<div class="tags">{tags}</div>' if tags else ""
    link = f'<p class="ilink">{_link(str(item["link"]))}</p>' if item.get("link") else ""
    title = f'<h3>{e(item.get("title"))}</h3>' if item.get("title") else ""
    cls = "item card" if card else "item"
    return (f'<article class="{cls}"><header class="ihead"><div>{title}'
            f'{f"<p class=meta>{meta}</p>" if meta else ""}</div>{period}</header>{desc}{bullets}{tags}{link}</article>')


def _section(sec: dict[str, Any], card_types: tuple[str, ...] = ()) -> str:
    sid = re.sub(r"[^a-zA-Z0-9_-]", "", str(sec.get("id") or sec.get("type") or "custom")) or "custom"
    items = [i for i in sec.get("items") or [] if isinstance(i, dict)]
    if sec.get("type") == "skills":
        groups = []
        for i in items:
            head = "<h3>" + e(i.get("title")) + "</h3>" if i.get("title") else ""
            tags = "".join('<span class="tag">' + e(t) + "</span>" for t in i.get("tags") or [])
            groups.append('<div class="skillgroup">' + head + '<div class="tags">' + tags + "</div></div>")
        body = "".join(groups)
    else:
        card = sec.get("type") in card_types
        inner = "".join(_item(i, card) for i in items)
        body = f'<div class="grid">{inner}</div>' if card else inner
    if sec.get("text"):
        body = f'<p class="desc">{e(sec.get("text"))}</p>' + body
    return (f'<section class="block" data-section="{sid}" id="sec-{sid}">'
            f'<h2>{e(sec.get("title"))}</h2>{body}</section>')


def _summary(profile: dict[str, Any]) -> str:
    if not profile.get("summary"):
        return ""
    return f'<section class="block" data-section="summary"><h2>个人简介</h2><p class="summary">{e(profile["summary"])}</p></section>'


def _footer(profile: dict[str, Any]) -> str:
    return (f'<footer class="footer" data-section="footer"><p>© {e(profile.get("name") or "")} · '
            f'{e(profile.get("title") or "个人简历")}</p></footer>')


BASE_CSS = """
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--text);font-family:var(--font);font-size:15px;line-height:1.7}
h1,h2,h3{font-family:var(--heading-font);color:var(--heading);margin:0}
a{color:var(--link);text-decoration:none;border-bottom:1px solid currentColor}
img.avatar{display:block;object-fit:cover;border-radius:50%;cursor:pointer;background:var(--accent-soft);border:3px solid var(--surface)}
.contacts{list-style:none;padding:0;margin:0;display:flex;flex-wrap:wrap;gap:calc(6px*var(--space)) calc(16px*var(--space))}
.contacts .clabel{opacity:.65;margin-right:6px;font-size:.85em}
.block{margin:0 0 calc(32px*var(--space))}
.block h2{font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:var(--primary);margin-bottom:calc(14px*var(--space))}
.item{margin-bottom:calc(18px*var(--space))}
.ihead{display:flex;justify-content:space-between;gap:12px;align-items:baseline}
.item h3{font-size:16px}.meta{margin:2px 0 0;color:var(--muted);font-size:14px}
.period{color:var(--muted);font-size:13px;white-space:nowrap;font-variant-numeric:tabular-nums}
.desc{margin:6px 0}.bullets{margin:6px 0 0;padding-left:1.1em}.bullets li{margin:3px 0}
.tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.tag{font-size:12.5px;padding:2px 10px;border-radius:999px;background:var(--accent-soft);color:var(--heading)}
.skillgroup{margin-bottom:12px}.skillgroup h3{font-size:14px}
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:calc(18px*var(--space))}
.footer{padding:28px 20px;text-align:center;color:var(--muted);font-size:13px;border-top:1px solid var(--border)}
.footer p{margin:0}
@media (max-width:640px){body{font-size:14.5px}.ihead{flex-direction:column;gap:2px}}
"""

STYLE_CSS = {
    "minimal": """
.wrap{max-width:760px;margin:0 auto;padding:calc(64px*var(--space)) 24px calc(40px*var(--space))}
.hero{display:flex;gap:28px;align-items:center;margin-bottom:calc(48px*var(--space));padding-bottom:calc(32px*var(--space));border-bottom:1px solid var(--border)}
.hero img.avatar{width:104px;height:104px;flex:none;box-shadow:0 0 0 1px var(--border)}
.hero h1{font-size:40px;line-height:1.15;letter-spacing:-.01em}
.hero .role{margin:6px 0 14px;font-size:18px;color:var(--primary)}
.summary{font-size:16.5px;margin:0}
.layout-double .wrap{max-width:1080px}
@media (min-width:900px){.layout-double .sections{display:grid;grid-template-columns:1fr 1fr;column-gap:56px}}
@media (max-width:640px){.hero{flex-direction:column;align-items:flex-start}.hero h1{font-size:32px}}
""",
    "sidebar": """
.shell{max-width:1120px;margin:calc(32px*var(--space)) auto;display:grid;grid-template-columns:320px 1fr;background:var(--surface);border-radius:var(--radius);overflow:hidden;box-shadow:0 20px 50px rgba(15,23,42,.08)}
.aside{background:var(--aside-bg);color:var(--aside-text);padding:calc(40px*var(--space)) 28px}
.aside h1,.aside h2,.aside h3,.aside .meta,.aside .period{color:var(--aside-text)}
.aside a{color:var(--aside-text)}
.aside .tag{background:rgba(255,255,255,.14);color:var(--aside-text)}
.aside img.avatar{width:132px;height:132px;margin-bottom:20px;border-color:rgba(255,255,255,.3)}
.aside h1{font-size:30px;line-height:1.2}.aside .role{margin:6px 0 24px;opacity:.85}
.aside .contacts{flex-direction:column;margin-bottom:32px}
.aside .block h2{color:var(--aside-text);opacity:.75}
.main{padding:calc(44px*var(--space)) 44px}
.main .block{padding-bottom:calc(8px*var(--space))}
.layout-single .shell{grid-template-columns:1fr}
.layout-single .aside{display:grid;grid-template-columns:auto 1fr;column-gap:28px}
@media (max-width:860px){.shell{grid-template-columns:1fr;margin:0;border-radius:0}.main{padding:28px 22px}}
""",
    "cards": """
.hero{background:var(--hero-bg);color:var(--hero-text);padding:calc(72px*var(--space)) 24px calc(96px*var(--space))}
.hero h1,.hero .role,.hero a{color:var(--hero-text)}
.hero-in{max-width:1080px;margin:0 auto;display:flex;gap:32px;align-items:center}
.hero img.avatar{width:128px;height:128px;flex:none;border-color:rgba(255,255,255,.4)}
.hero h1{font-size:46px;line-height:1.1}.hero .role{margin:8px 0 16px;font-size:19px;opacity:.9}
.hero .contacts .clabel{opacity:.75}
.content{max-width:1080px;margin:calc(-56px*var(--space)) auto 0;padding:0 24px calc(48px*var(--space))}
.content > .block{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:calc(28px*var(--space));box-shadow:0 10px 30px rgba(15,23,42,.05)}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:calc(16px*var(--space))}
.grid .card{margin:0;background:var(--bg)}
.layout-single .grid{grid-template-columns:1fr}
@media (max-width:760px){.grid{grid-template-columns:1fr}.hero-in{flex-direction:column;align-items:flex-start}.hero h1{font-size:34px}}
""",
}


def _doc(profile: dict[str, Any], style: str, body: str) -> str:
    theme = profile.get("theme") or {}
    layout = theme.get("layout") or ""
    title = f'{profile.get("name") or "个人简历"} · {profile.get("title") or "个人网站"}'
    return (
        "<!DOCTYPE html>\n<html lang=\"zh-CN\">\n<head>\n<meta charset=\"utf-8\">\n"
        "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n"
        f"<title>{e(title)}</title>\n<meta name=\"generator\" content=\"Folio\">\n"
        f"<style id=\"folio-base\">{BASE_CSS}{STYLE_CSS[style]}</style>\n"
        f"<style id=\"folio-theme\">\n{theme_css(theme)}\n</style>\n</head>\n"
        f"<body class=\"style-{style}{f' layout-{e(layout)}' if layout else ''}\">\n{body}\n</body>\n</html>\n"
    )


def render(profile: dict[str, Any], style: str) -> str:
    """Render a resume profile with the given style key."""
    style = style if style in STYLES else "minimal"
    sections = [s for s in profile.get("sections") or [] if isinstance(s, dict)]
    name, role = e(profile.get("name") or "未命名"), e(profile.get("title"))
    if style == "minimal":
        body = (f'<main class="wrap"><header class="hero" data-section="header">{_avatar(profile)}<div>'
                f'<h1>{name}</h1>{f"<p class=role>{role}</p>" if role else ""}{_contacts(profile)}</div></header>'
                f'{_summary(profile)}<div class="sections">{"".join(_section(s) for s in sections)}</div></main>'
                f'{_footer(profile)}')
    elif style == "sidebar":
        side_types = ("skills", "education")
        aside = "".join(_section(s) for s in sections if s.get("type") in side_types)
        main = "".join(_section(s) for s in sections if s.get("type") not in side_types)
        body = (f'<div class="shell"><aside class="aside" data-section="header"><div>{_avatar(profile)}'
                f'<h1>{name}</h1>{f"<p class=role>{role}</p>" if role else ""}{_contacts(profile)}</div>'
                f'<div>{aside}</div></aside><main class="main">{_summary(profile)}{main}</main></div>{_footer(profile)}')
    else:
        body = (f'<header class="hero" data-section="header"><div class="hero-in">{_avatar(profile)}<div>'
                f'<h1>{name}</h1>{f"<p class=role>{role}</p>" if role else ""}{_contacts(profile)}</div></div></header>'
                f'<main class="content">{_summary(profile)}'
                f'{"".join(_section(s, ("projects", "experience", "custom")) for s in sections)}</main>{_footer(profile)}')
    return _doc(profile, style, body)


def initials_avatar(name: str | None) -> str:
    """Data-URI SVG avatar with the first character of the name."""
    import base64
    ch = html.escape((name or "我").strip()[:1] or "我")
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#DCE6F8"/>'
           f'<text x="50%" y="54%" font-size="88" text-anchor="middle" dominant-baseline="middle" fill="#1D4ED8" '
           f'font-family="sans-serif">{ch}</text></svg>')
    return "data:image/svg+xml;base64," + base64.b64encode(svg.encode()).decode()


# ---------------------------------------------------------------- sanitize
_DANGEROUS_BLOCKS = re.compile(r"<(script|iframe|object|embed|frame|frameset|applet|noscript)\b.*?(</\1\s*>|$)", re.I | re.S)
_DANGEROUS_SINGLE = re.compile(r"<(script|iframe|object|embed|frame|base|link|meta\s+http-equiv)[^>]*>", re.I)
_EVENT_ATTR = re.compile(r"\s+on[a-z]+\s*=\s*(\"[^\"]*\"|'[^']*'|[^\s>]+)", re.I)
_JS_URL = re.compile(r"(href|src|action|formaction|xlink:href)\s*=\s*([\"']?)\s*(javascript|vbscript|data:text/html)[^\"'>\s]*\2", re.I)
_CSS_JS = re.compile(r"expression\s*\(|javascript:|@import", re.I)


def sanitize_html(doc: str) -> str:
    """Strip scripts, event handlers, and script URLs from generated or user HTML."""
    out = _DANGEROUS_BLOCKS.sub("", doc)
    out = _DANGEROUS_SINGLE.sub("", out)
    out = _EVENT_ATTR.sub("", out)
    out = _JS_URL.sub(r'\1="#"', out)
    out = _CSS_JS.sub("", out)
    out = re.sub(r"<form\b[^>]*>", "<div>", out, flags=re.I)
    out = re.sub(r"</form\s*>", "</div>", out, flags=re.I)
    return out


def validate_html(doc: str) -> str | None:
    """Return error message when the HTML is not a usable full page."""
    if not doc or len(doc) < 80:
        return "HTML 内容为空或过短"
    if len(doc) > 600_000:
        return "HTML 超过 600KB 限制"
    low = doc.lower()
    if "<body" not in low or "</html>" not in low:
        return "HTML 缺少 <body> 或 </html>，不是完整页面"
    return None

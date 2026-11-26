---
last_updated: 2026-11-25T11:30:00Z
---

# Architecture Design

## System Overview
Folio · 简历建站：Atoms Cloud（FuncSea）全栈。前端 Vite/React，后端 FastAPI，路由前缀 /api/v1/folio。私有表的 user_id 都从 JWT 中获取，每个接口校验归属。头像存放在私有 OSS 桶 folio-avatars，由服务端签发下载 URL。

## Tech Stack
React 18 + shadcn/ui + Tailwind；@metagptx/web-sdk（auth / apiCall）；FastAPI + SQLAlchemy async；httpx 调用 OpenAI 兼容的 /models 和 /chat/completions；Fernet 加密 Token。

## Module Design
| Module | Responsibility | Key Files |
|--------|---------------|-----------|
| Render | 资料 JSON → 3 套 HTML（minimal / sidebar / cards）、主题色派生、区块覆盖、HTML 清洗与校验 | backend/services/folio_render.py |
| Profile | 规范化、规则梳理（无 LLM 时使用）、补丁 ops、规则编辑 | backend/services/folio_profile.py |
| LLM | 加密、/models、/chat、提取 JSON 并修复一次 | backend/services/folio_llm.py, backend/prompts/*.md |
| API | 简历、生成、选样式、对话、资料、HTML、版本、导出、头像、发布、公开页、设置 | backend/routers/folio.py |
| Frontend | 首页、示例、我的简历、工作台、公开页 /page/:slug | frontend/src/pages/*, components/folio/* |

## Tech Decisions
| Decision | Choice | Rationale |
|----------|--------|-----------|
| 头像占位 | HTML 中使用 __FOLIO_AVATAR__，预览、发布时替换为签名 URL，导出时替换为 base64 | 版本和快照只保存 key，避免链接过期 |
| 状态 | resumes.status: draft / template / manual | manual 时对话以源码为准 |
| 预览隔离 | iframe sandbox（不允许脚本）+ 服务端清洗 | 防止 XSS |
| 发布 | publications 每份简历一条，slug 固定，重新发布时覆盖快照 | 链接稳定 |

## File Tree Plan
backend/{routers/folio.py, services/folio_*.py, prompts/resume-intake.md, prompts/resume-assistant.md}; frontend/src/{lib/folio.ts, lib/htmlCode.ts, folio.css, components/folio/*, pages/{Index,ExamplePage,ResumesPage,Workspace,PublicPage}.tsx}

## Implementation Guide
新增样式：在 folio_render 的 STYLES、STYLE_ORDER、STYLE_CSS 和 render() 中添加。新增编辑能力：在 apply_operations 中添加对应 op，并同步更新 resume-assistant.md。

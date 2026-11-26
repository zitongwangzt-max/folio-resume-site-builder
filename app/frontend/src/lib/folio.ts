import { client } from './api';

export const AVATAR_TOKEN = '__FOLIO_AVATAR__';

export interface Contact {
  label: string;
  value: string;
}

export interface ResumeItem {
  title: string;
  subtitle: string;
  period: string;
  location: string;
  description: string;
  link: string;
  bullets: string[];
  tags: string[];
}

export interface ResumeSection {
  id: string;
  type: 'experience' | 'projects' | 'education' | 'skills' | 'custom';
  title: string;
  items: ResumeItem[];
  text?: string;
}

export interface Profile {
  name: string;
  title: string;
  contacts: Contact[];
  summary: string;
  sections: ResumeSection[];
  theme?: Record<string, unknown>;
}

export interface Candidate {
  id?: number;
  style_key: string;
  name: string;
  description: string;
  html: string;
  is_custom?: boolean;
}

export interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  created_at?: string;
}

export interface VersionMeta {
  id: number;
  label: string;
  style_key: string;
  style_name?: string;
  created_at?: string;
}

export type ResumeStatus = 'draft' | 'template' | 'manual';

export interface ResumeState {
  resume: {
    id: number;
    title: string;
    source_text: string;
    profile: Profile;
    current_html: string;
    current_style: string;
    current_style_name?: string;
    status: ResumeStatus;
    has_avatar: boolean;
    updated_at?: string;
  };
  candidates: Candidate[];
  messages: ChatMessage[];
  versions: VersionMeta[];
  publication: { slug: string; updated_at?: string } | null;
  avatar_url: string;
  changed?: boolean;
  error?: string | null;
  new_style?: string;
}

export interface ResumeListItem {
  id: number;
  title: string;
  current_style: string;
  style_name: string;
  status: ResumeStatus;
  updated_at?: string;
  slug?: string | null;
}

export interface LlmSettings {
  base_url: string;
  model: string;
  has_token: boolean;
  configured: boolean;
}

export const STYLE_NAMES: Record<string, string> = {
  minimal: '极简单栏',
  sidebar: '双栏侧栏',
  cards: '项目卡片',
};

export function errorMessage(e: unknown, fallback = '请求失败，请稍后重试'): string {
  const err = e as {
    response?: { data?: { detail?: unknown } };
    data?: { detail?: unknown };
    message?: string;
  };
  const detail = err?.response?.data?.detail ?? err?.data?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) return '提交的内容格式不正确';
  return err?.message || fallback;
}

async function call<T>(url: string, method = 'GET', data?: Record<string, unknown>, timeout = 60_000): Promise<T> {
  const response = (await client.apiCall.invoke({ url, method, data, options: { timeout } })) as { data: T };
  return response.data;
}

const BASE = '/api/v1/folio';
const LONG = 300_000;

export const folioApi = {
  example: () =>
    call<{ source_text: string; profile: Profile; candidates: Candidate[]; avatar_url: string }>(`${BASE}/public/example`),
  publicPage: (slug: string) =>
    call<{ slug: string; title: string; html: string; avatar_url: string }>(`${BASE}/public/pages/${encodeURIComponent(slug)}`),
  pageManage: (slug: string) =>
    call<{ is_owner: boolean; resume_id: number | null }>(`${BASE}/pages/${encodeURIComponent(slug)}/manage`),
  pageAvatar: (slug: string, data_url: string) =>
    call<{ ok: boolean; avatar_url: string }>(`${BASE}/pages/${encodeURIComponent(slug)}/avatar`, 'POST', { data_url }, LONG),

  list: () => call<{ items: ResumeListItem[] }>(`${BASE}/resumes`),
  generate: (source_text: string, count: number, resume_id?: number) =>
    call<ResumeState>(`${BASE}/resumes/generate`, 'POST', { source_text, count, resume_id }, LONG),
  get: (id: number) => call<ResumeState>(`${BASE}/resumes/${id}`),
  remove: (id: number) => call<{ ok: boolean }>(`${BASE}/resumes/${id}`, 'DELETE'),
  select: (id: number, style: string) => call<ResumeState>(`${BASE}/resumes/${id}/select`, 'POST', { style }),
  chat: (id: number, message: string) => call<ResumeState>(`${BASE}/resumes/${id}/chat`, 'POST', { message }, LONG),
  saveProfile: (id: number, profile: Profile, title?: string) =>
    call<ResumeState>(`${BASE}/resumes/${id}/profile`, 'PUT', { profile: profile as unknown as Record<string, unknown>, title }),
  applyHtml: (id: number, html: string) => call<ResumeState>(`${BASE}/resumes/${id}/html`, 'PUT', { html }),
  version: (id: number, vid: number) =>
    call<{ id: number; label: string; html: string; avatar_url: string }>(`${BASE}/resumes/${id}/versions/${vid}`),
  restore: (id: number, vid: number) => call<ResumeState>(`${BASE}/resumes/${id}/versions/${vid}/restore`, 'POST', {}),
  exportHtml: (id: number) => call<{ filename: string; html: string }>(`${BASE}/resumes/${id}/export`, 'GET', undefined, LONG),
  avatar: (id: number, data_url: string) => call<ResumeState>(`${BASE}/resumes/${id}/avatar`, 'POST', { data_url }, LONG),
  createStyle: (id: number, description: string) =>
    call<ResumeState>(`${BASE}/resumes/${id}/styles`, 'POST', { description }, LONG),
  deleteStyle: (id: number, key: string) =>
    call<ResumeState>(`${BASE}/resumes/${id}/styles/${encodeURIComponent(key)}`, 'DELETE'),
  publish: (id: number) => call<ResumeState>(`${BASE}/resumes/${id}/publish`, 'POST', {}),

  settings: () => call<LlmSettings>(`${BASE}/settings`),
  saveSettings: (body: { base_url: string; token?: string; model: string; clear_token?: boolean }) =>
    call<LlmSettings>(`${BASE}/settings`, 'PUT', body),
  fetchModels: (body: { base_url: string; token?: string }) =>
    call<{ models: string[] }>(`${BASE}/settings/models`, 'POST', body),
  testSettings: (body: { base_url: string; token?: string; model: string }) =>
    call<{ ok: boolean; model: string; reply: string }>(`${BASE}/settings/test`, 'POST', body, 60_000),
};

export function withAvatar(html: string, avatarUrl: string): string {
  return html ? html.split(AVATAR_TOKEN).join(avatarUrl || '') : '';
}

export function pageUrl(slug: string): string {
  return `${window.location.origin}/page/${slug}`;
}

export function downloadText(filename: string, text: string, type = 'text/html;charset=utf-8') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

/** Read an image file and downscale it to a compact data URL for avatar upload. */
export function fileToAvatarDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) {
      reject(new Error('仅支持 PNG、JPG、WebP 或 GIF 图片'));
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      reject(new Error('图片不能超过 10MB'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.onload = () => {
      const src = String(reader.result);
      if (file.type === 'image/gif') {
        if (file.size > 3 * 1024 * 1024) reject(new Error('GIF 头像不能超过 3MB'));
        else resolve(src);
        return;
      }
      const img = new Image();
      img.onerror = () => reject(new Error('无法解析图片'));
      img.onload = () => {
        const max = 640;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(src);
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.88));
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  });
}

export function pickImageFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp,image/gif';
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}

export function emptyItem(): ResumeItem {
  return { title: '', subtitle: '', period: '', location: '', description: '', link: '', bullets: [], tags: [] };
}

export function formatTime(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Remove workspace-private caches (used on logout / account switch). */
export function clearPrivateCache() {
  const drop = (store: Storage) => {
    Object.keys(store)
      .filter((k) => k.startsWith('folio_') && k !== 'folio_return_to' && k !== 'folio_pending_source')
      .forEach((k) => store.removeItem(k));
  };
  try {
    drop(window.localStorage);
    drop(window.sessionStorage);
  } catch {
    /* storage unavailable */
  }
}

export function rememberReturnTo(path: string) {
  try {
    sessionStorage.setItem('folio_return_to', path);
  } catch {
    /* ignore */
  }
}

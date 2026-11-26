import { FormEvent, KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Check,
  Code2,
  Copy,
  Download,
  ExternalLink,
  Eye,
  FolderOpen,
  History,
  LayoutTemplate,
  Loader2,
  Maximize2,
  MessageSquare,
  Minimize2,
  Monitor,
  PenSquare,
  Rocket,
  Send,
  Settings2,
  Smartphone,
  Trash2,
  WandSparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Logo, RequireAuth } from '@/components/folio/AuthBits';
import CodePanel from '@/components/folio/CodePanel';
import ProfileEditor from '@/components/folio/ProfileEditor';
import SettingsDialog from '@/components/folio/SettingsDialog';
import SitePreview, { SiteThumb } from '@/components/folio/SitePreview';
import VersionsDialog from '@/components/folio/VersionsDialog';
import {
  copyText,
  downloadText,
  errorMessage,
  fileToAvatarDataUrl,
  folioApi,
  LlmSettings,
  pageUrl,
  pickImageFile,
  Profile,
  ResumeState,
  STYLE_NAMES,
} from '@/lib/folio';

type RightView = 'styles' | 'site';
type Device = 'desktop' | 'mobile';

const SUGGESTIONS = [
  '换成雾霾蓝主题，页脚背景单独设为 #1E293B',
  '新增荣誉获奖栏目，放到项目经历后面',
  '调整为双栏布局，间距宽松一些',
  '标题换成衬线字体',
  '生成一套暗夜科技风的样式',
];

function Bubble({ role, content }: { role: string; content: string }) {
  const mine = role === 'user';
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[88%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-sm leading-6 ${
          mine ? 'rounded-br-md bg-[#1D4ED8] text-white' : 'rounded-bl-md border border-[#D6E2F5] bg-white text-[#1E2B45]'
        }`}
      >
        {content}
      </div>
    </div>
  );
}

function WorkspaceInner() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState<ResumeState | null>(null);
  const [loadError, setLoadError] = useState('');
  const [view, setView] = useState<RightView>('styles');
  const [focusStyle, setFocusStyle] = useState('');
  const [codeMode, setCodeMode] = useState(false);
  const [device, setDevice] = useState<Device>('desktop');
  const [fullscreen, setFullscreen] = useState(false);
  const [mobilePane, setMobilePane] = useState<'chat' | 'preview'>('preview');
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState<'' | 'select' | 'avatar' | 'download' | 'publish'>('');
  const [dialog, setDialog] = useState<'' | 'profile' | 'versions' | 'settings' | 'publish'>('');
  const [llm, setLlm] = useState<LlmSettings | null>(null);
  const [styleInput, setStyleInput] = useState('');
  const [creatingStyle, setCreatingStyle] = useState(false);
  const chatEnd = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  const applyState = useCallback((s: ResumeState) => {
    setState(s);
    if (s.resume.status === 'draft') {
      setView('styles');
    }
    setFocusStyle((cur) => cur || s.resume.current_style || s.candidates[0]?.style_key || '');
  }, []);

  useEffect(() => {
    folioApi.settings().then(setLlm).catch(() => setLlm(null));
  }, []);

  useEffect(() => {
    if (id === 'new') {
      if (started.current) return;
      started.current = true;
      navigate('/resumes', { replace: true });
      return;
    }
    const rid = Number(id);
    if (!rid) {
      setLoadError('简历地址无效');
      return;
    }
    if (state?.resume.id === rid) return;
    setLoadError('');
    folioApi
      .get(rid)
      .then((s) => {
        applyState(s);
        setView(s.resume.status === 'draft' ? 'styles' : 'site');
        setFocusStyle(s.resume.current_style || s.candidates[0]?.style_key || '');
      })
      .catch((e) => setLoadError(errorMessage(e, '加载失败')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [state?.messages.length, sending]);

  if (loadError) {
    return (
      <div className="blueprint-grid flex min-h-screen flex-col items-center justify-center px-6 text-center">
        <p className="font-hand text-3xl text-[#1D4ED8]">出了点问题</p>
        <p className="mt-2 max-w-md text-[#5B6B86]">{loadError}</p>
        <div className="mt-6 flex gap-2">
          <Button variant="outline" onClick={() => navigate('/')}>返回首页</Button>
          <Button onClick={() => navigate('/resumes')}>我的简历</Button>
        </div>
      </div>
    );
  }
  if (!state) {
    return (
      <div className="blueprint-grid flex min-h-screen flex-col items-center justify-center px-6 text-center">
        <Loader2 className="h-8 w-8 animate-spin text-[#1D4ED8]" />
        <p className="mt-4 text-lg font-bold text-[#0B1F44]">正在打开简历…</p>
      </div>
    );
  }

  const { resume, candidates, messages, versions, publication, avatar_url: avatarUrl } = state;
  const rid = resume.id;
  const isDraft = resume.status === 'draft';
  const focused = candidates.find((c) => c.style_key === focusStyle) || candidates[0];
  const showingStyles = view === 'styles' || isDraft;
  const previewHtml = showingStyles ? focused?.html || '' : resume.current_html;

  const run = async <T,>(key: typeof busy, fn: () => Promise<T>, ok?: string): Promise<T | undefined> => {
    setBusy(key);
    try {
      const r = await fn();
      if (ok) toast.success(ok);
      return r;
    } catch (e) {
      toast.error(errorMessage(e));
      return undefined;
    } finally {
      setBusy('');
    }
  };

  const selectStyle = async (style: string) => {
    const label = state?.candidates.find((c) => c.style_key === style)?.name || STYLE_NAMES[style] || '自定义样式';
    const s = await run('select', () => folioApi.select(rid, style), `已使用「${label}」`);
    if (s) {
      applyState(s);
      setView('site');
      setCodeMode(false);
    }
  };

  const changeAvatar = async () => {
    const file = await pickImageFile();
    if (!file) return;
    const s = await run(
      'avatar',
      async () => folioApi.avatar(rid, await fileToAvatarDataUrl(file)),
      publication ? '头像已更新。重新发布后，分享页也会更新' : '头像已更新',
    );
    if (s) applyState(s);
  };

  const download = async () => {
    const r = await run('download', () => folioApi.exportHtml(rid));
    if (r) {
      downloadText(r.filename, r.html);
      toast.success('已下载当前版本');
    }
  };

  const publish = async () => {
    const s = await run('publish', () => folioApi.publish(rid), publication ? '发布页已更新为当前版本' : '已发布');
    if (s) applyState(s);
  };

  const send = async (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg || sending) return;
    setInput('');
    setSending(true);
    setState((cur) =>
      cur ? { ...cur, messages: [...cur.messages, { id: -Date.now(), role: 'user', content: msg }] } : cur,
    );
    try {
      const s = await folioApi.chat(rid, msg);
      applyState(s);
      if (s.new_style) {
        setFocusStyle(s.new_style);
        setView('styles');
        setMobilePane('preview');
      } else if (s.error) toast.error('修改未应用，已保留上一版');
      else if (s.changed && s.resume.status !== 'draft') {
        setView('site');
        setMobilePane('preview');
      }
    } catch (e) {
      toast.error(errorMessage(e, '发送失败'));
      setState((cur) =>
        cur
          ? { ...cur, messages: [...cur.messages, { id: -Date.now() - 1, role: 'assistant', content: `⚠️ ${errorMessage(e, '发送失败')}，请重试。` }] }
          : cur,
      );
    } finally {
      setSending(false);
    }
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  const saveProfile = async (p: Profile) => {
    try {
      const s = await folioApi.saveProfile(rid, p);
      applyState(s);
      if (s.resume.status !== 'draft') setView('site');
      toast.success('资料已保存');
    } catch (e) {
      toast.error(errorMessage(e, '保存失败'));
      throw e;
    }
  };

  const applyHtml = async (html: string) => {
    try {
      const s = await folioApi.applyHtml(rid, html);
      applyState(s);
      toast.success('已应用代码，并保存为新版本');
    } catch (e) {
      toast.error(errorMessage(e, '应用失败'));
    }
  };

  const restore = async (vid: number) => {
    try {
      const s = await folioApi.restore(rid, vid);
      applyState(s);
      setView('site');
      setFocusStyle(s.resume.current_style);
      toast.success('已恢复为新的当前版本');
    } catch (e) {
      toast.error(errorMessage(e, '恢复失败'));
      throw e;
    }
  };

  const createStyle = async () => {
    const desc = styleInput.trim();
    if (!desc || creatingStyle) return;
    setCreatingStyle(true);
    try {
      const s = await folioApi.createStyle(rid, desc);
      applyState(s);
      if (s.new_style) setFocusStyle(s.new_style);
      setStyleInput('');
      toast.success('新样式已生成，已加入样式方案');
    } catch (e) {
      toast.error(errorMessage(e, '生成样式失败'));
    } finally {
      setCreatingStyle(false);
    }
  };

  const deleteStyle = async (key: string, name: string) => {
    if (!window.confirm(`删除样式「${name}」？`)) return;
    try {
      const s = await folioApi.deleteStyle(rid, key);
      applyState(s);
      if (focusStyle === key) setFocusStyle(s.resume.current_style || s.candidates[0]?.style_key || '');
      toast.success('样式已删除');
    } catch (e) {
      toast.error(errorMessage(e, '删除失败'));
    }
  };

  const toolbarBtn = 'inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm text-[#1E2B45] hover:bg-[#EAF1FF] disabled:opacity-50';

  const chatPane = (
    <section className="flex h-full min-h-0 flex-col bg-[#F7FAFF]" aria-label="对话">
      <div className="flex items-center gap-2 border-b border-[#D6E2F5] bg-white px-4 py-2.5">
        <MessageSquare className="h-4 w-4 text-[#1D4ED8]" />
        <span className="text-sm font-bold text-[#0B1F44]">对话编辑</span>
        <button
          type="button"
          onClick={() => setDialog('settings')}
          className={`ml-auto rounded-full px-2 py-0.5 text-xs ${llm?.configured ? 'bg-green-50 text-[#15803D]' : 'bg-amber-50 text-[#B45309]'}`}
        >
          {llm?.configured ? `模型：${llm.model}` : '未配置模型 · 内置规则'}
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.map((m) => <Bubble key={m.id} role={m.role} content={m.content} />)}
        {sending && (
          <div className="flex items-center gap-2 text-sm text-[#5B6B86]">
            <Loader2 className="h-4 w-4 animate-spin text-[#1D4ED8]" />正在修改…
          </div>
        )}
        <div ref={chatEnd} />
      </div>
      <div className="border-t border-[#D6E2F5] bg-white p-3">
        {isDraft && (
          <p className="mb-2 rounded-lg bg-[#EAF1FF] px-3 py-2 text-xs text-[#1D4ED8]">先在右侧选一套样式。现在修改资料会同步更新全部候选。</p>
        )}
        <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1">
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" disabled={sending} onClick={() => send(s)} className="shrink-0 rounded-full border border-[#BFD3F2] px-2.5 py-1 text-xs text-[#1D4ED8] hover:bg-[#EAF1FF] disabled:opacity-50">
              {s}
            </button>
          ))}
        </div>
        <form
          className="flex items-end gap-2"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            send();
          }}
        >
          <label htmlFor="chat-input" className="sr-only">输入修改要求</label>
          <textarea
            id="chat-input"
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
            placeholder="告诉我怎么改，例如：把第一段工作经历改得更突出性能优化成果"
            className="max-h-40 min-h-[44px] flex-1 resize-none rounded-[10px] border border-[#D6E2F5] px-3 py-2 text-sm outline-none focus:border-[#1D4ED8] focus:ring-2 focus:ring-[#1D4ED8]/20"
          />
          <Button type="submit" size="icon" className="h-11 w-11 shrink-0" disabled={sending || !input.trim()} aria-label="发送">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </form>
      </div>
    </section>
  );

  const deviceFrame = (
    <div className={`flex min-h-0 flex-1 justify-center overflow-auto bg-[#F3F6FB] ${device === 'mobile' && !fullscreen ? 'py-4' : ''}`}>
      <div className={device === 'mobile' ? 'h-[760px] max-h-full w-[390px] shrink-0 overflow-hidden rounded-[28px] border-8 border-[#0B1F44] bg-white shadow-xl' : 'h-full w-full'}>
        <SitePreview html={previewHtml} avatarUrl={avatarUrl} onAvatarClick={busy === 'avatar' ? undefined : changeAvatar} />
      </div>
    </div>
  );

  const previewPane = (
    <section className={`flex h-full min-h-0 flex-col bg-white ${fullscreen ? 'fixed inset-0 z-50' : ''}`} aria-label="网站预览">
      <div className="flex flex-wrap items-center gap-2 border-b border-[#D6E2F5] px-3 py-2">
        <div className="flex rounded-lg border border-[#D6E2F5] p-0.5 text-sm">
          <button type="button" onClick={() => setView('styles')} className={`rounded-md px-2.5 py-1 ${showingStyles ? 'bg-[#EAF1FF] font-medium text-[#1D4ED8]' : 'text-[#5B6B86]'}`}>
            样式方案
          </button>
          <button type="button" disabled={isDraft} onClick={() => setView('site')} className={`rounded-md px-2.5 py-1 disabled:opacity-40 ${!showingStyles ? 'bg-[#EAF1FF] font-medium text-[#1D4ED8]' : 'text-[#5B6B86]'}`}>
            当前版本
          </button>
        </div>
        {!showingStyles && (
          <div className="flex rounded-lg border border-[#D6E2F5] p-0.5 text-sm">
            <button type="button" onClick={() => setCodeMode(false)} className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 ${!codeMode ? 'bg-[#EAF1FF] font-medium text-[#1D4ED8]' : 'text-[#5B6B86]'}`}>
              <Eye className="h-3.5 w-3.5" />预览
            </button>
            <button type="button" onClick={() => setCodeMode(true)} className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 ${codeMode ? 'bg-[#EAF1FF] font-medium text-[#1D4ED8]' : 'text-[#5B6B86]'}`}>
              <Code2 className="h-3.5 w-3.5" />代码
            </button>
          </div>
        )}
        {!codeMode || showingStyles ? (
          <div className="ml-auto flex items-center gap-1">
            {busy === 'avatar' && <Loader2 className="mr-1 h-4 w-4 animate-spin text-[#1D4ED8]" />}
            <span className="mr-1 hidden text-xs text-[#9AA9C2] xl:inline">点击头像可上传</span>
            <div className="flex rounded-lg border border-[#D6E2F5] p-0.5">
              <button type="button" aria-label="桌面视图" onClick={() => setDevice('desktop')} className={`rounded-md p-1.5 ${device === 'desktop' ? 'bg-[#EAF1FF] text-[#1D4ED8]' : 'text-[#5B6B86]'}`}><Monitor className="h-4 w-4" /></button>
              <button type="button" aria-label="手机视图" onClick={() => setDevice('mobile')} className={`rounded-md p-1.5 ${device === 'mobile' ? 'bg-[#EAF1FF] text-[#1D4ED8]' : 'text-[#5B6B86]'}`}><Smartphone className="h-4 w-4" /></button>
            </div>
            <button type="button" aria-label={fullscreen ? '退出全屏' : '全屏预览'} onClick={() => setFullscreen((f) => !f)} className="rounded-md p-2 text-[#5B6B86] hover:bg-[#EAF1FF]">
              {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
            {!showingStyles && (
              <button type="button" aria-label="下载 HTML" onClick={download} disabled={busy === 'download'} className="rounded-md p-2 text-[#5B6B86] hover:bg-[#EAF1FF]">
                {busy === 'download' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              </button>
            )}
          </div>
        ) : null}
      </div>

      {showingStyles ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 gap-3 overflow-x-auto border-b border-[#D6E2F5] bg-[#F7FAFF] p-3">
            {candidates.map((c) => {
              const current = !isDraft && resume.current_style === c.style_key;
              const active = focused?.style_key === c.style_key;
              return (
                <div key={c.style_key} className="relative shrink-0">
                <button type="button" onClick={() => setFocusStyle(c.style_key)} className={`relative block w-[200px] overflow-hidden rounded-[14px] bg-white text-left transition ${active ? 'ring-2 ring-[#1D4ED8]' : 'border border-[#D6E2F5] hover:border-[#9DB7E6]'}`}>
                  <SiteThumb html={c.html} avatarUrl={avatarUrl} className="h-[110px] w-full" />
                  <div className="border-t border-[#D6E2F5] px-3 py-2">
                    <p className="text-sm font-bold text-[#0B1F44]">{c.name}</p>
                    <p className="truncate text-xs text-[#5B6B86]">{c.description}</p>
                  </div>
                  {current && <span className="absolute right-2 top-2 rounded-full bg-[#1D4ED8] px-2 py-0.5 text-[11px] font-medium text-white">当前</span>}
                  {c.is_custom && <span className="absolute left-2 top-2 rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-medium text-[#1D4ED8] shadow-sm">自定义</span>}
                </button>
                {c.is_custom && !current && (
                  <button type="button" aria-label={`删除样式 ${c.name}`} onClick={() => deleteStyle(c.style_key, c.name)} className="absolute bottom-2 right-2 rounded-md bg-white p-1 text-[#9AA9C2] hover:bg-red-50 hover:text-[#DC2626]">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
                </div>
              );
            })}
            <form
              className="flex w-[240px] shrink-0 flex-col justify-between rounded-[14px] border border-dashed border-[#9DB7E6] bg-white p-3"
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                createStyle();
              }}
            >
              <p className="flex items-center gap-1 text-sm font-bold text-[#0B1F44]"><WandSparkles className="h-4 w-4 text-[#1D4ED8]" />生成新样式</p>
              <label htmlFor="style-desc" className="sr-only">描述想要的样式</label>
              <textarea
                id="style-desc"
                rows={3}
                value={styleInput}
                onChange={(e) => setStyleInput(e.target.value)}
                placeholder="描述风格，如：暗夜科技风 / 日系杂志留白 / 莫兰迪绿、单栏"
                className="mt-2 w-full flex-1 resize-none rounded-lg border border-[#D6E2F5] px-2 py-1.5 text-xs outline-none focus:border-[#1D4ED8]"
              />
              <Button type="submit" size="sm" className="mt-2 w-full" disabled={creatingStyle || !styleInput.trim()}>
                {creatingStyle ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <WandSparkles className="mr-1 h-3.5 w-3.5" />}
                {creatingStyle ? '生成中…' : '生成'}
              </Button>
            </form>
          </div>
          <div className="flex items-center gap-2 border-b border-[#D6E2F5] px-3 py-2">
            <span className="text-sm text-[#5B6B86]">正在查看：<b className="text-[#0B1F44]">{focused?.name}</b></span>
            {!isDraft && resume.current_style !== focused?.style_key && (
              <span className="hidden text-xs text-[#9AA9C2] md:inline">切换后会用当前简历内容套用此样式</span>
            )}
            <Button size="sm" className="ml-auto" disabled={!focused || busy === 'select' || (!isDraft && resume.current_style === focused?.style_key && resume.status === 'template')} onClick={() => focused && selectStyle(focused.style_key)}>
              {busy === 'select' ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Check className="mr-1 h-4 w-4" />}
              {!isDraft && resume.current_style === focused?.style_key && resume.status === 'template' ? '当前使用中' : '使用此样式'}
            </Button>
          </div>
          {deviceFrame}
        </div>
      ) : codeMode ? (
        <div className="min-h-0 flex-1">
          <CodePanel html={resume.current_html} onApply={applyHtml} onDownload={download} downloading={busy === 'download'} />
        </div>
      ) : (
        deviceFrame
      )}
    </section>
  );

  return (
    <div className="flex h-[100dvh] flex-col bg-white">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-[#D6E2F5] px-3 sm:px-4">
        <button type="button" aria-label="返回我的简历" onClick={() => navigate('/resumes')} className="rounded-md p-2 text-[#5B6B86] hover:bg-[#EAF1FF]">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <Logo className="hidden md:inline-flex" />
        <span className="ml-1 min-w-0 truncate text-sm font-medium text-[#0B1F44]" title={resume.title}>{resume.title}</span>
        <span className="hidden shrink-0 rounded-full bg-[#EAF1FF] px-2 py-0.5 text-xs text-[#1D4ED8] sm:inline">
          {isDraft ? '草稿' : resume.current_style_name || STYLE_NAMES[resume.current_style] || '自定义样式'}{resume.status === 'manual' ? ' · 手动 HTML' : ''}
        </span>
        <nav className="ml-auto flex items-center gap-0.5 overflow-x-auto" aria-label="工作台入口">
          <button type="button" className={toolbarBtn} onClick={() => { setView('styles'); setMobilePane('preview'); }}><LayoutTemplate className="h-4 w-4" /><span className="hidden lg:inline">样式方案</span></button>
          <button type="button" className={toolbarBtn} onClick={() => setDialog('profile')}><PenSquare className="h-4 w-4" /><span className="hidden lg:inline">编辑资料</span></button>
          <button type="button" className={toolbarBtn} onClick={() => navigate('/resumes')}><FolderOpen className="h-4 w-4" /><span className="hidden lg:inline">我的简历</span></button>
          <button type="button" className={toolbarBtn} onClick={() => setDialog('versions')}><History className="h-4 w-4" /><span className="hidden lg:inline">版本历史</span></button>
          <button type="button" className={toolbarBtn} onClick={() => setDialog('settings')}><Settings2 className="h-4 w-4" /><span className="hidden lg:inline">模型设置</span></button>
          <Button size="sm" className="ml-1" disabled={isDraft} onClick={() => setDialog('publish')}>
            <Rocket className="h-4 w-4 sm:mr-1" /><span className="hidden sm:inline">发布</span>
          </Button>
        </nav>
      </header>

      <div className="flex shrink-0 border-b border-[#D6E2F5] md:hidden" role="tablist">
        {(['chat', 'preview'] as const).map((p) => (
          <button key={p} type="button" role="tab" aria-selected={mobilePane === p} onClick={() => setMobilePane(p)} className={`flex-1 py-2.5 text-sm font-medium ${mobilePane === p ? 'border-b-2 border-[#1D4ED8] text-[#1D4ED8]' : 'text-[#5B6B86]'}`}>
            {p === 'chat' ? '对话' : '预览'}
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1">
        <div className={`min-h-0 w-full border-r border-[#D6E2F5] md:block md:w-[380px] lg:w-[400px] md:shrink-0 ${mobilePane === 'chat' ? 'block' : 'hidden'}`}>{chatPane}</div>
        <div className={`min-h-0 min-w-0 flex-1 md:block ${mobilePane === 'preview' ? 'block' : 'hidden'}`}>{previewPane}</div>
      </div>

      <ProfileEditor open={dialog === 'profile'} profile={resume.profile} onOpenChange={(o) => setDialog(o ? 'profile' : '')} onSave={saveProfile} />
      <VersionsDialog open={dialog === 'versions'} resumeId={rid} versions={versions} onOpenChange={(o) => setDialog(o ? 'versions' : '')} onRestore={restore} />
      <SettingsDialog open={dialog === 'settings'} onOpenChange={(o) => setDialog(o ? 'settings' : '')} onSaved={setLlm} />
      <Dialog open={dialog === 'publish'} onOpenChange={(o) => setDialog(o ? 'publish' : '')}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>发布简历网站</DialogTitle>
            <DialogDescription>把当前已应用的版本发布为快照，访客无需登录即可查看。之后再次发布会更新同一个链接。</DialogDescription>
          </DialogHeader>
          {publication ? (
            <div className="min-w-0 space-y-3">
              <div className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-[#D6E2F5] bg-[#F7FAFF] p-2">
                <code className="block w-full min-w-0 break-all font-mono-folio text-sm text-[#1D4ED8] sm:w-auto sm:flex-1 sm:truncate sm:break-normal">{pageUrl(publication.slug)}</code>
                <Button size="sm" variant="outline" className="shrink-0" onClick={async () => ((await copyText(pageUrl(publication.slug))) ? toast.success('链接已复制') : toast.error('复制失败'))}>
                  <Copy className="mr-1 h-3.5 w-3.5" />复制
                </Button>
                <Button size="icon" variant="ghost" aria-label="打开发布页" onClick={() => window.open(`/page/${publication.slug}`, '_blank')}><ExternalLink className="h-4 w-4" /></Button>
              </div>
              <Button className="w-full" onClick={publish} disabled={busy === 'publish'}>
                {busy === 'publish' ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Rocket className="mr-1 h-4 w-4" />}用当前版本更新发布页
              </Button>
            </div>
          ) : (
            <Button className="w-full" onClick={publish} disabled={busy === 'publish'}>
              {busy === 'publish' ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Rocket className="mr-1 h-4 w-4" />}发布并生成链接
            </Button>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function Workspace() {
  return (
    <RequireAuth>
      <WorkspaceInner />
    </RequireAuth>
  );
}

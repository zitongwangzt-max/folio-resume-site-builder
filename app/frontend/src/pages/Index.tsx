import { ChangeEvent, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, FileText, FolderOpen, Loader2, LogIn, LogOut, Settings2, Sparkles, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { Logo, login, useLogout } from '@/components/folio/AuthBits';
import SettingsDialog from '@/components/folio/SettingsDialog';
import { errorMessage, folioApi } from '@/lib/folio';

const STEPS = [
  { n: '01', t: '提取经历', d: '识别姓名、联系方式、工作、项目、教育与技能，区分你的经历和岗位要求' },
  { n: '02', t: '生成 2–3 套', d: '同一份事实，极简单栏 / 双栏侧栏 / 项目卡片，版式明显不同' },
  { n: '03', t: '对话编辑', d: '改写经历、增删栏目、换主题色、调布局，也能直接改 HTML' },
  { n: '04', t: '下载或发布', d: '导出单文件 HTML，或生成 /page/ 分享链接' },
];

export function setPendingSource(text: string, count: number) {
  sessionStorage.setItem('folio_pending_source', JSON.stringify({ text, count }));
}

export default function Index() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const logout = useLogout();
  const [text, setText] = useState('');
  const [count, setCount] = useState(3);
  const [loadingSample, setLoadingSample] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (loading || !user) return;
    const back = sessionStorage.getItem('folio_return_to');
    if (back && back !== '/') {
      sessionStorage.removeItem('folio_return_to');
      navigate(back, { replace: true });
    }
  }, [loading, user, navigate]);

  const onFiles = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    const parts: string[] = [];
    for (const f of files) {
      if (!/\.(txt|md|markdown)$/i.test(f.name)) {
        toast.error(`${f.name} 不是 TXT 或 Markdown 文件`);
        continue;
      }
      if (f.size > 1024 * 1024) {
        toast.error(`${f.name} 超过 1MB`);
        continue;
      }
      parts.push(await f.text());
    }
    if (parts.length) {
      setText((t) => [t.trim(), ...parts].filter(Boolean).join('\n\n'));
      toast.success(`已导入 ${parts.length} 个文件`);
    }
  };

  const loadSample = async () => {
    setLoadingSample(true);
    try {
      const ex = await folioApi.example();
      setText(ex.source_text);
    } catch (e) {
      toast.error(errorMessage(e, '示例加载失败'));
    } finally {
      setLoadingSample(false);
    }
  };

  const start = () => {
    const src = text.trim();
    if (src.length < 10) {
      toast.error('请先粘贴简历、项目笔记或目标岗位 JD（至少 10 个字）');
      return;
    }
    setPendingSource(src, count);
    if (user) navigate('/resumes');
    else login('/resumes');
  };

  const navItems = (
    <>
      <a href="#compose" className="flex items-center gap-2 rounded-lg px-3 py-2 font-medium text-[#1D4ED8] hover:bg-[#EAF1FF]">
        <Sparkles className="h-4 w-4" />开始创作
      </a>
      <Link to="/resumes" className="flex items-center gap-2 rounded-lg px-3 py-2 text-[#1E2B45] hover:bg-[#EAF1FF]">
        <FolderOpen className="h-4 w-4" />我的简历
      </Link>
      <Link to="/example" className="flex items-center gap-2 rounded-lg px-3 py-2 text-[#1E2B45] hover:bg-[#EAF1FF]">
        <FileText className="h-4 w-4" />示例
      </Link>
      <button
        type="button"
        onClick={() => (user ? setSettingsOpen(true) : login('/'))}
        className="flex items-center gap-2 rounded-lg px-3 py-2 text-left text-[#1E2B45] hover:bg-[#EAF1FF]"
      >
        <Settings2 className="h-4 w-4" />模型设置
      </button>
    </>
  );

  return (
    <div className="blueprint-grid min-h-screen lg:flex">
      <aside className="sticky top-0 hidden h-screen w-[240px] shrink-0 flex-col border-r border-[#D6E2F5] bg-white/70 px-5 py-8 backdrop-blur-sm lg:flex">
        <Logo />
        <nav className="mt-10 flex flex-col gap-1 text-sm">{navItems}</nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
      <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-[#D6E2F5] bg-white/85 px-4 backdrop-blur-sm sm:px-6">
        <Logo className="lg:hidden" />
        <nav className="ml-auto flex items-center gap-1 text-sm" aria-label="顶部导航">
          <Link to="/example" className="hidden rounded-lg px-3 py-2 text-[#1E2B45] hover:bg-[#EAF1FF] sm:inline-flex">示例</Link>
          <Link to="/resumes" className="hidden rounded-lg px-3 py-2 text-[#1E2B45] hover:bg-[#EAF1FF] sm:inline-flex">我的简历</Link>
          <button
            type="button"
            onClick={() => (user ? setSettingsOpen(true) : login('/'))}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#BFD3F2] bg-white px-3 py-1.5 font-medium text-[#1D4ED8] hover:bg-[#EAF1FF]"
          >
            <Settings2 className="h-4 w-4" />模型设置
          </button>
          {loading ? (
            <span className="ml-1 inline-flex items-center px-2 text-[#9AA9C2]"><Loader2 className="h-4 w-4 animate-spin" /></span>
          ) : user ? (
            <div className="ml-1 flex items-center gap-1 border-l border-[#D6E2F5] pl-2">
              <span className="hidden max-w-[180px] truncate text-[#5B6B86] md:inline" title={user.email || user.name}>
                <span className="mr-1 inline-block h-2 w-2 rounded-full bg-[#15803D]" aria-hidden />
                {user.email || user.name}
              </span>
              <button type="button" onClick={logout} aria-label="退出登录" className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[#5B6B86] hover:bg-red-50 hover:text-[#DC2626]">
                <LogOut className="h-4 w-4" /><span className="hidden sm:inline">退出登录</span>
              </button>
            </div>
          ) : (
            <Button size="sm" className="ml-1" onClick={() => login('/resumes')}>
              <LogIn className="mr-1 h-4 w-4" />登录 / 注册
            </Button>
          )}
        </nav>
      </header>

      <main className="flex min-w-0 flex-1 gap-10 px-5 py-6 sm:px-10 lg:py-6 xl:px-16">
        <div className="mx-auto w-full max-w-[1000px]" id="compose">
          <p className="font-mono-folio text-xs uppercase tracking-[0.3em] text-[#1D4ED8]">Folio · Resume to Website</p>
          <h1 className="mt-3 text-[34px] font-black leading-[1.1] tracking-tight text-[#0B1F44] sm:text-[44px] xl:text-[52px] 2xl:text-[60px]">
            <span className="title-outline block whitespace-nowrap">从一段经历，</span>
            <span className="block whitespace-nowrap text-[#1D4ED8]">到一个网站</span>
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[#5B6B86] sm:text-base">
            粘贴旧简历、项目笔记和目标岗位 JD，Folio 会整理出一份事实准确的简历资料，并生成 2–3 套可以直接发布的个人网站。
          </p>

          <div className="paper-sheet relative mt-5">
            <div className="absolute bottom-6 left-3 top-6 hidden flex-col justify-between sm:flex" aria-hidden>
              {Array.from({ length: 6 }).map((_, i) => (
                <span key={i} className="h-3 w-3 rounded-full border border-[#D6E2F5] bg-[#F3F6FB]" />
              ))}
            </div>
            <label htmlFor="source" className="sr-only">简历材料</label>
            <textarea
              id="source"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={'粘贴简历、项目笔记或目标岗位 JD…\n\n例如：\n张三 · 产品经理\n工作经历\n某某科技 | 产品经理 | 2021.07 - 至今\n- 负责……\n\n目标岗位 JD\n要求：……'}
              className="h-[180px] w-full resize-none bg-transparent px-5 py-3 text-[15px] leading-8 text-[#1E2B45] outline-none placeholder:text-[#9AA9C2] sm:h-[200px] lg:h-[220px] sm:pl-12"
            />
            <span className="absolute bottom-3 right-4 font-mono-folio text-xs text-[#9AA9C2]">{text.length} 字</span>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <input ref={fileRef} type="file" accept=".txt,.md,.markdown,text/plain,text/markdown" multiple hidden onChange={onFiles} />
            <button type="button" onClick={() => fileRef.current?.click()} className="inline-flex h-10 items-center gap-2 rounded-full border border-[#BFD3F2] bg-white px-4 text-sm font-medium text-[#1D4ED8] hover:bg-[#EAF1FF]">
              <Upload className="h-4 w-4" />导入 TXT / Markdown
            </button>
            <button type="button" onClick={loadSample} disabled={loadingSample} className="inline-flex h-10 items-center gap-2 rounded-full border border-[#BFD3F2] bg-white px-4 text-sm font-medium text-[#1D4ED8] hover:bg-[#EAF1FF] disabled:opacity-50">
              {loadingSample ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}从示例开始
            </button>
            <div className="inline-flex h-10 items-center rounded-full border border-[#BFD3F2] bg-white p-1 text-sm" role="radiogroup" aria-label="生成数量">
              {[2, 3].map((n) => (
                <button key={n} type="button" role="radio" aria-checked={count === n} onClick={() => setCount(n)} className={`h-8 rounded-full px-3 font-medium ${count === n ? 'bg-[#1D4ED8] text-white' : 'text-[#1D4ED8]'}`}>
                  {n} 套
                </button>
              ))}
            </div>
            <button type="button" onClick={start} aria-label="生成简历网站" className="ml-auto inline-flex h-14 w-full items-center justify-center gap-2 rounded-full bg-[#1D4ED8] text-base font-bold text-white shadow-[0_12px_28px_rgba(29,78,216,.35)] transition hover:bg-[#1E40AF] sm:h-16 sm:w-16">
              <span className="sm:hidden">生成简历网站</span>
              <ArrowRight className="h-6 w-6 sm:h-7 sm:w-7" />
            </button>
          </div>

          <ol className="mt-8 grid gap-4 sm:grid-cols-2 xl:hidden">
            {STEPS.map((s) => (
              <li key={s.n} className="rounded-xl border border-[#D6E2F5] bg-white/80 p-4">
                <span className="font-mono-folio text-xs text-[#1D4ED8]">{s.n}</span>
                <p className="mt-1 font-bold text-[#0B1F44]">{s.t}</p>
                <p className="mt-1 text-sm text-[#5B6B86]">{s.d}</p>
              </li>
            ))}
          </ol>
        </div>

        <ol className="relative hidden w-[260px] shrink-0 pt-6 xl:block">
          <span className="absolute bottom-10 left-[15px] top-10 border-l border-dashed border-[#9DB7E6]" aria-hidden />
          {STEPS.map((s) => (
            <li key={s.n} className="relative mb-6 pl-12">
              <span className="absolute left-0 top-0 flex h-8 w-8 items-center justify-center rounded-full border border-[#1D4ED8] bg-white font-mono-folio text-xs font-bold text-[#1D4ED8]">{s.n}</span>
              <p className="font-bold text-[#0B1F44]">{s.t}</p>
              <p className="mt-1 text-sm leading-6 text-[#5B6B86]">{s.d}</p>
            </li>
          ))}
          <p className="font-hand pl-12 text-xl text-[#1D4ED8]/70">→ 只写你真的做过的事</p>
        </ol>
      </main>
      </div>
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}

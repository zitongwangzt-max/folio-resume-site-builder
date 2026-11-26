import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Copy, ExternalLink, FilePlus2, Loader2, LogOut, PenLine, Settings2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useAuth } from '@/contexts/AuthContext';
import { Logo, RequireAuth, useLogout } from '@/components/folio/AuthBits';
import SettingsDialog from '@/components/folio/SettingsDialog';
import { copyText, errorMessage, folioApi, formatTime, pageUrl, ResumeListItem } from '@/lib/folio';

const STATUS: Record<string, string> = { draft: '草稿 · 待选样式', template: '已选样式', manual: '已手动编辑' };
const PENDING_KEY = 'folio_pending_source';

type PendingSource = { text: string; count: number };
type GenerationTask = { source: PendingSource; error: string };

function readPending(): PendingSource | null {
  try {
    const p = JSON.parse(sessionStorage.getItem(PENDING_KEY) || 'null');
    return p?.text ? { text: String(p.text), count: Number(p.count) || 3 } : null;
  } catch {
    return null;
  }
}

function GeneratingCard({ task, onRetry, onDiscard }: { task: GenerationTask; onRetry: () => void; onDiscard: () => void }) {
  const failed = !!task.error;
  return (
    <li
      className={`flex flex-col rounded-[14px] border bg-white p-5 ${failed ? 'border-red-200' : 'border-dashed border-[#9DB7E6]'}`}
      aria-live="polite"
      aria-busy={!failed}
    >
      <div className="flex items-center gap-2">
        {failed ? null : <Loader2 className="h-5 w-5 shrink-0 animate-spin text-[#1D4ED8]" />}
        <p className="text-lg font-bold text-[#0B1F44]">{failed ? '生成失败' : '新简历生成中…'}</p>
      </div>
      <p className="mt-2 line-clamp-2 text-xs text-[#5B6B86]">{task.source.text}</p>
      {failed ? (
        <>
          <p className="mt-3 text-sm text-[#DC2626]">{task.error}</p>
          <div className="mt-4 flex gap-2">
            <Button size="sm" onClick={onRetry}>重试</Button>
            <Button size="sm" variant="ghost" onClick={onDiscard}>放弃</Button>
          </div>
        </>
      ) : (
        <p className="mt-3 text-xs text-[#9AA9C2]">正在梳理资料并生成候选样式，完成后会自动打开编辑页（约 30–90 秒）</p>
      )}
    </li>
  );
}

function ResumesInner() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const logout = useLogout();
  const [items, setItems] = useState<ResumeListItem[] | null>(null);
  const [error, setError] = useState('');
  const [pendingDelete, setPendingDelete] = useState<ResumeListItem | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const load = () => {
    setError('');
    folioApi
      .list()
      .then((r) => setItems(r.items))
      .catch((e) => setError(errorMessage(e, '加载失败')));
  };
  useEffect(load, []);

  const [task, setTask] = useState<GenerationTask | null>(null);
  const started = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const runGeneration = (source: PendingSource) => {
    setTask({ source, error: '' });
    folioApi
      .generate(source.text, source.count)
      .then((s) => {
        sessionStorage.removeItem(PENDING_KEY);
        if (mounted.current) navigate(`/app/${s.resume.id}`);
        else toast.success(`「${s.resume.title}」已生成，可在我的简历中打开`);
      })
      .catch((e) => {
        if (mounted.current) setTask({ source, error: errorMessage(e, '生成失败，请稍后重试') });
      });
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const pending = readPending();
    if (pending) runGeneration(pending);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const discardTask = () => {
    sessionStorage.removeItem(PENDING_KEY);
    setTask(null);
  };

  const remove = async () => {
    if (!pendingDelete) return;
    try {
      await folioApi.remove(pendingDelete.id);
      setItems((list) => (list || []).filter((i) => i.id !== pendingDelete.id));
      toast.success('已删除');
    } catch (e) {
      toast.error(errorMessage(e, '删除失败'));
    } finally {
      setPendingDelete(null);
    }
  };

  const last = items?.[0];

  return (
    <div className="min-h-screen bg-[#F7FAFF]">
      <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-[#D6E2F5] bg-white px-5">
        <Logo />
        <span className="ml-2 hidden text-sm font-medium text-[#0B1F44] sm:inline">我的简历</span>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setSettingsOpen(true)}><Settings2 className="mr-1 h-4 w-4" />模型设置</Button>
          <span className="hidden max-w-[200px] truncate text-sm text-[#5B6B86] md:inline">{user?.email}</span>
          <Button variant="ghost" size="sm" onClick={logout} aria-label="退出登录"><LogOut className="h-4 w-4" /></Button>
        </div>
      </header>
      <main className="mx-auto max-w-[1100px] px-5 py-10">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <p className="font-mono-folio text-xs uppercase tracking-[0.3em] text-[#1D4ED8]">My Resumes</p>
            <h1 className="mt-2 text-3xl font-black text-[#0B1F44]">我的简历</h1>
          </div>
          <div className="ml-auto flex gap-2">
            {last && (
              <Button variant="outline" onClick={() => navigate(`/app/${last.id}`)}><PenLine className="mr-2 h-4 w-4" />继续上次编辑</Button>
            )}
            <Button onClick={() => navigate('/')}><FilePlus2 className="mr-2 h-4 w-4" />新建简历</Button>
          </div>
        </div>

        {error && (
          <div className="mt-8 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-[#DC2626]">
            {error} <button type="button" className="ml-2 underline" onClick={load}>重试</button>
          </div>
        )}
        {!items && !error && (
          <div className="mt-16 flex justify-center text-[#5B6B86]"><Loader2 className="mr-2 h-5 w-5 animate-spin" />加载中…</div>
        )}
        {items && items.length === 0 && !task && (
          <div className="blueprint-grid mt-8 rounded-2xl border border-dashed border-[#9DB7E6] p-12 text-center">
            <p className="font-hand text-3xl text-[#1D4ED8]">还没有简历，先写下第一段经历吧</p>
            <Button className="mt-6" onClick={() => navigate('/')}><FilePlus2 className="mr-2 h-4 w-4" />新建简历</Button>
          </div>
        )}
        {items && (items.length > 0 || task) && (
          <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {task && <GeneratingCard task={task} onRetry={() => runGeneration(task.source)} onDiscard={discardTask} />}
            {items.map((r) => (
              <li key={r.id} className="flex flex-col rounded-[14px] border border-[#D6E2F5] bg-white p-5 transition hover:border-[#9DB7E6] hover:shadow-[0_12px_32px_rgba(29,78,216,.08)]">
                <Link to={`/app/${r.id}`} className="text-lg font-bold text-[#0B1F44] hover:text-[#1D4ED8]">{r.title}</Link>
                <p className="mt-1 text-xs text-[#5B6B86]">
                  {STATUS[r.status] || r.status}{r.style_name ? ` · ${r.style_name}` : ''}
                </p>
                <p className="mt-1 text-xs text-[#9AA9C2]">更新于 {formatTime(r.updated_at)}</p>
                {r.slug && (
                  <p className="mt-3 truncate rounded-md bg-[#EAF1FF] px-2 py-1 font-mono-folio text-xs text-[#1D4ED8]">/page/{r.slug}</p>
                )}
                <div className="mt-4 flex flex-wrap gap-2 pt-1">
                  <Button size="sm" onClick={() => navigate(`/app/${r.id}`)}><PenLine className="mr-1 h-3.5 w-3.5" />编辑</Button>
                  {r.slug && (
                    <>
                      <Button size="sm" variant="outline" onClick={async () => (await copyText(pageUrl(r.slug!))) ? toast.success('发布链接已复制') : toast.error('复制失败')}>
                        <Copy className="mr-1 h-3.5 w-3.5" />复制链接
                      </Button>
                      <Button size="sm" variant="ghost" aria-label="打开发布页" onClick={() => window.open(`/page/${r.slug}`, '_blank')}><ExternalLink className="h-3.5 w-3.5" /></Button>
                    </>
                  )}
                  <Button size="sm" variant="ghost" className="ml-auto text-[#DC2626] hover:bg-red-50 hover:text-[#DC2626]" aria-label="删除简历" onClick={() => setPendingDelete(r)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除「{pendingDelete?.title}」？</AlertDialogTitle>
            <AlertDialogDescription>候选样式、对话、版本和发布链接都会被一并删除，且无法恢复。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction className="bg-[#DC2626] text-white hover:bg-red-700" onClick={remove}>删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}

export default function ResumesPage() {
  return (
    <RequireAuth>
      <ResumesInner />
    </RequireAuth>
  );
}

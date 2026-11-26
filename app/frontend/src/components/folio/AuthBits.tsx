import { ReactNode, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, LogIn } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { clearPrivateCache, rememberReturnTo } from '@/lib/folio';

export function Logo({ className = '' }: { className?: string }) {
  return (
    <Link to="/" className={`inline-flex items-baseline gap-1.5 text-[#0B1F44] ${className}`} aria-label="Folio 首页">
      <span className="text-2xl font-black tracking-tight">Folio</span>
      <span className="h-2 w-2 rounded-full bg-[#1D4ED8]" />
      <span className="text-xs font-medium text-[#5B6B86]">简历建站</span>
    </Link>
  );
}

export function login(returnTo?: string) {
  rememberReturnTo(returnTo || window.location.pathname + window.location.search);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  import('@/lib/api').then(({ client }) => (client.auth as any).toLogin());
}

/** Log out and drop every workspace-private cache. */
export function useLogout() {
  const qc = useQueryClient();
  const { logout } = useAuth();
  return async () => {
    clearPrivateCache();
    qc.clear();
    try {
      localStorage.removeItem('folio_uid');
    } catch {
      /* ignore */
    }
    await logout();
    window.location.href = '/';
  };
}

/** Clears private caches when a different account becomes active in this browser. */
export function AccountWatcher() {
  const { user, loading } = useAuth();
  const qc = useQueryClient();
  const handled = useRef<string | null>(null);
  useEffect(() => {
    if (loading) return;
    const uid = user?.id ?? '';
    if (handled.current === uid) return;
    handled.current = uid;
    let prev = '';
    try {
      prev = localStorage.getItem('folio_uid') || '';
    } catch {
      /* ignore */
    }
    if (prev && prev !== uid) {
      clearPrivateCache();
      qc.clear();
    }
    try {
      if (uid) localStorage.setItem('folio_uid', uid);
      else localStorage.removeItem('folio_uid');
    } catch {
      /* ignore */
    }
  }, [user, loading, qc]);
  return null;
}

export function FullLoader({ text = '加载中…' }: { text?: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-white text-[#5B6B86]">
      <Loader2 className="mr-2 h-5 w-5 animate-spin text-[#1D4ED8]" />
      {text}
    </div>
  );
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <FullLoader text="正在确认登录状态…" />;
  if (!user) {
    return (
      <div className="blueprint-grid flex min-h-screen items-center justify-center px-6">
        <div className="paper-sheet w-full max-w-md !bg-none p-8 text-center">
          <Logo />
          <h1 className="mt-6 text-2xl font-black text-[#0B1F44]">登录后进入工作台</h1>
          <p className="mt-2 text-sm text-[#5B6B86]">
            支持邮箱注册、登录、找回密码和 Google 登录。你的简历、版本和发布记录都保存在你的账号下。
          </p>
          <Button className="mt-6 h-11 w-full" onClick={() => login()}>
            <LogIn className="mr-2 h-4 w-4" />登录 / 注册
          </Button>
          <Link to="/" className="mt-4 inline-block text-sm text-[#1D4ED8] hover:underline">
            返回首页
          </Link>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

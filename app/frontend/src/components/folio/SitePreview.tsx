import { useEffect, useMemo, useRef } from 'react';
import { withAvatar } from '@/lib/folio';
import { cn } from '@/lib/utils';

interface SitePreviewProps {
  html: string;
  avatarUrl: string;
  onAvatarClick?: () => void;
  className?: string;
  title?: string;
}

/**
 * Renders resume HTML inside a sandboxed iframe (no scripts). The parent attaches
 * the avatar click handler through same-origin DOM access, so the page itself never runs code.
 */
export default function SitePreview({ html, avatarUrl, onAvatarClick, className, title = '简历网站预览' }: SitePreviewProps) {
  const ref = useRef<HTMLIFrameElement>(null);
  const clickRef = useRef(onAvatarClick);
  clickRef.current = onAvatarClick;
  const doc = useMemo(() => withAvatar(html, avatarUrl), [html, avatarUrl]);

  const bind = () => {
    const d = ref.current?.contentDocument;
    if (!d) return;
    d.querySelectorAll<HTMLElement>('[data-folio-avatar]').forEach((el) => {
      if (clickRef.current) {
        el.style.cursor = 'pointer';
        el.title = '点击上传或更换头像';
        el.addEventListener('click', (e) => {
          e.preventDefault();
          clickRef.current?.();
        });
      } else {
        el.style.cursor = 'default';
        el.removeAttribute('title');
      }
    });
    d.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((a) => {
      if (!a.getAttribute('href')?.startsWith('#')) a.target = '_blank';
    });
  };

  useEffect(() => {
    bind();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);

  return (
    <iframe
      ref={ref}
      title={title}
      srcDoc={doc}
      onLoad={bind}
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      className={cn('block h-full w-full border-0 bg-white', className)}
    />
  );
}

export function SiteThumb({ html, avatarUrl, className }: { html: string; avatarUrl: string; className?: string }) {
  return (
    <div className={cn('relative overflow-hidden bg-white', className)}>
      <div className="pointer-events-none absolute left-0 top-0 h-[1000px] w-[1280px] origin-top-left scale-[0.25]">
        <SitePreview html={html} avatarUrl={avatarUrl} title="样式缩略图" />
      </div>
    </div>
  );
}

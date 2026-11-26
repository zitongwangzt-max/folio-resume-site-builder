import { useEffect, useState } from 'react';
import { History, Loader2, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import SitePreview from '@/components/folio/SitePreview';
import { errorMessage, folioApi, formatTime, STYLE_NAMES, VersionMeta } from '@/lib/folio';

interface Props {
  open: boolean;
  resumeId: number;
  versions: VersionMeta[];
  onOpenChange: (o: boolean) => void;
  onRestore: (versionId: number) => Promise<void>;
}

export default function VersionsDialog({ open, resumeId, versions, onOpenChange, onRestore }: Props) {
  const [active, setActive] = useState<number | null>(null);
  const [preview, setPreview] = useState<{ html: string; avatar_url: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    if (open) setActive(versions[0]?.id ?? null);
  }, [open, versions]);

  useEffect(() => {
    if (!open || active == null) {
      setPreview(null);
      return;
    }
    let alive = true;
    setLoading(true);
    folioApi
      .version(resumeId, active)
      .then((v) => alive && setPreview({ html: v.html, avatar_url: v.avatar_url }))
      .catch((e) => toast.error(errorMessage(e, '读取版本失败')))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [open, active, resumeId]);

  const restore = async () => {
    if (active == null) return;
    setRestoring(true);
    try {
      await onRestore(active);
      onOpenChange(false);
    } finally {
      setRestoring(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85vh] max-w-5xl flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><History className="h-5 w-5 text-[#1D4ED8]" />版本历史</DialogTitle>
          <DialogDescription>每次选用样式、应用修改都会保存一个版本。恢复旧版本时，会把它复制为当前的新版本。</DialogDescription>
        </DialogHeader>
        {versions.length === 0 ? (
          <p className="py-10 text-center text-[#5B6B86]">还没有版本。选用一套样式后会生成第一个版本。</p>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-4 md:flex-row">
            <ul className="max-h-40 shrink-0 space-y-1 overflow-y-auto md:max-h-none md:w-64">
              {versions.map((v, i) => (
                <li key={v.id}>
                  <button type="button" onClick={() => setActive(v.id)} className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${active === v.id ? 'border-[#1D4ED8] bg-[#EAF1FF]' : 'border-transparent hover:bg-[#F3F6FB]'}`}>
                    <p className="truncate font-medium text-[#0B1F44]">{v.label}{i === 0 && <span className="ml-1 text-xs text-[#1D4ED8]">（当前）</span>}</p>
                    <p className="text-xs text-[#5B6B86]">{formatTime(v.created_at)} · {v.style_name || STYLE_NAMES[v.style_key] || '自定义样式'}</p>
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-[#D6E2F5]">
              <div className="relative min-h-0 flex-1 bg-[#F3F6FB]">
                {loading && <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/60"><Loader2 className="h-5 w-5 animate-spin text-[#1D4ED8]" /></div>}
                {preview && <SitePreview html={preview.html} avatarUrl={preview.avatar_url} title="版本预览" />}
              </div>
              <div className="flex justify-end border-t border-[#D6E2F5] p-3">
                <Button onClick={restore} disabled={restoring || active == null || active === versions[0]?.id}>
                  {restoring ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-1 h-4 w-4" />}恢复此版本
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

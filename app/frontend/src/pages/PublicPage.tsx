import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Camera, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { login } from '@/components/folio/AuthBits';
import SitePreview from '@/components/folio/SitePreview';
import { errorMessage, fileToAvatarDataUrl, folioApi, pickImageFile } from '@/lib/folio';

export default function PublicPage() {
  const { slug = '' } = useParams();
  const { user, loading } = useAuth();
  const [page, setPage] = useState<{ html: string; title: string } | null>(null);
  const [error, setError] = useState('');
  const [isOwner, setIsOwner] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    folioApi
      .publicPage(slug)
      .then((p) => {
        setPage({ html: p.html, title: p.title });
        document.title = p.title || '个人简历';
      })
      .catch((e) => setError(errorMessage(e, '页面不存在或已下线')));
  }, [slug]);

  useEffect(() => {
    if (loading || !user) {
      setIsOwner(false);
      return;
    }
    folioApi.pageManage(slug).then((r) => setIsOwner(r.is_owner)).catch(() => setIsOwner(false));
  }, [slug, user, loading]);

  const changeAvatar = async () => {
    const file = await pickImageFile();
    if (!file) return;
    setUploading(true);
    try {
      const dataUrl = await fileToAvatarDataUrl(file);
      await folioApi.pageAvatar(slug, dataUrl);
      const p = await folioApi.publicPage(slug);
      setPage({ html: p.html, title: p.title });
      toast.success('头像已更换，原链接保持不变');
    } catch (e) {
      toast.error(errorMessage(e, '更换失败'));
    } finally {
      setUploading(false);
    }
  };

  if (error) {
    return (
      <div className="blueprint-grid flex min-h-screen flex-col items-center justify-center px-6 text-center">
        <p className="font-hand text-4xl text-[#1D4ED8]">这页纸不见了</p>
        <p className="mt-2 text-[#5B6B86]">{error}</p>
        <a href="/" className="mt-6 text-sm font-medium text-[#1D4ED8] hover:underline">去 Folio 做一个自己的简历网站 →</a>
      </div>
    );
  }
  if (!page) {
    return <div className="flex h-screen items-center justify-center text-[#5B6B86]"><Loader2 className="mr-2 h-5 w-5 animate-spin" />加载中…</div>;
  }
  return (
    <div className="relative h-screen w-full">
      {/* The published HTML already contains the resolved avatar URL; no placeholder token remains. */}
      <SitePreview html={page.html} avatarUrl="" onAvatarClick={isOwner ? changeAvatar : undefined} title={page.title} />
      <div className="fixed bottom-4 right-4 flex items-center gap-2">
        {isOwner && (
          <button type="button" onClick={changeAvatar} disabled={uploading} className="inline-flex h-10 items-center gap-2 rounded-full bg-[#1D4ED8] px-4 text-sm font-medium text-white shadow-lg hover:bg-[#1E40AF] disabled:opacity-60">
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}更换头像
          </button>
        )}
        {!loading && !user && (
          <button type="button" onClick={() => login(`/page/${slug}`)} className="rounded-full border border-[#D6E2F5] bg-white/90 px-3 py-1.5 text-xs text-[#5B6B86] shadow hover:text-[#1D4ED8]">
            我是发布者，登录管理
          </button>
        )}
        <a href="/" className="rounded-full border border-[#D6E2F5] bg-white/90 px-3 py-1.5 text-xs text-[#5B6B86] shadow hover:text-[#1D4ED8]">由 Folio 生成</a>
      </div>
    </div>
  );
}

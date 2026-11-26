import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, Monitor, Smartphone, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { Logo, login } from '@/components/folio/AuthBits';
import SitePreview, { SiteThumb } from '@/components/folio/SitePreview';
import { setPendingSource } from '@/pages/Index';
import { Candidate, errorMessage, folioApi } from '@/lib/folio';

export default function ExamplePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState<{ source_text: string; candidates: Candidate[]; avatar_url: string } | null>(null);
  const [error, setError] = useState('');
  const [active, setActive] = useState(0);
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');

  useEffect(() => {
    folioApi.example().then(setData).catch((e) => setError(errorMessage(e, '示例加载失败')));
  }, []);

  const useSample = () => {
    if (!data) return;
    setPendingSource(data.source_text, 3);
    if (user) navigate('/resumes');
    else login('/resumes');
  };

  return (
    <div className="flex h-screen flex-col bg-[#F3F6FB]">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[#D6E2F5] bg-white px-4">
        <Link to="/" aria-label="返回首页" className="rounded-md p-2 text-[#5B6B86] hover:bg-[#EAF1FF]"><ArrowLeft className="h-4 w-4" /></Link>
        <Logo />
        <span className="hidden text-sm text-[#5B6B86] sm:inline">示例：同一份材料生成的 3 套网站</span>
        <Button className="ml-auto" onClick={useSample} disabled={!data}>
          <Sparkles className="mr-2 h-4 w-4" />用这份示例开始
        </Button>
      </header>
      {error && <p className="p-6 text-[#DC2626]">{error}</p>}
      {!data && !error && (
        <div className="flex flex-1 items-center justify-center text-[#5B6B86]"><Loader2 className="mr-2 h-5 w-5 animate-spin" />加载示例…</div>
      )}
      {data && (
        <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 lg:flex-row">
          <div className="flex shrink-0 gap-3 overflow-x-auto lg:w-[280px] lg:flex-col lg:overflow-y-auto">
            {data.candidates.map((c, i) => (
              <button key={c.style_key} type="button" onClick={() => setActive(i)} className={`w-[220px] shrink-0 overflow-hidden rounded-[14px] border bg-white text-left transition lg:w-full ${active === i ? 'border-2 border-[#1D4ED8]' : 'border-[#D6E2F5] hover:border-[#9DB7E6]'}`}>
                <SiteThumb html={c.html} avatarUrl={data.avatar_url} className="h-[130px] w-full" />
                <div className="border-t border-[#D6E2F5] p-3">
                  <p className="font-bold text-[#0B1F44]">{c.name}</p>
                  <p className="mt-0.5 text-xs text-[#5B6B86]">{c.description}</p>
                </div>
              </button>
            ))}
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[14px] border border-[#D6E2F5] bg-white">
            <div className="flex items-center gap-2 border-b border-[#D6E2F5] px-3 py-2">
              <span className="font-bold text-[#0B1F44]">{data.candidates[active]?.name}</span>
              <div className="ml-auto flex rounded-lg border border-[#D6E2F5] p-0.5">
                <button type="button" aria-label="桌面视图" onClick={() => setDevice('desktop')} className={`rounded-md p-1.5 ${device === 'desktop' ? 'bg-[#EAF1FF] text-[#1D4ED8]' : 'text-[#5B6B86]'}`}><Monitor className="h-4 w-4" /></button>
                <button type="button" aria-label="手机视图" onClick={() => setDevice('mobile')} className={`rounded-md p-1.5 ${device === 'mobile' ? 'bg-[#EAF1FF] text-[#1D4ED8]' : 'text-[#5B6B86]'}`}><Smartphone className="h-4 w-4" /></button>
              </div>
            </div>
            <div className="flex min-h-0 flex-1 justify-center bg-[#F3F6FB]">
              <div className={device === 'mobile' ? 'my-4 w-[390px] overflow-hidden rounded-[28px] border-8 border-[#0B1F44]' : 'h-full w-full'}>
                <SitePreview html={data.candidates[active]?.html || ''} avatarUrl={data.avatar_url} />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

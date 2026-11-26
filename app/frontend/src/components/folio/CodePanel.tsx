import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Download, Loader2, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatHtml, highlightHtml } from '@/lib/htmlCode';

interface CodePanelProps {
  html: string;
  disabled?: boolean;
  onApply: (html: string) => Promise<void>;
  onDownload: () => void;
  downloading?: boolean;
}

export default function CodePanel({ html, disabled, onApply, onDownload, downloading }: CodePanelProps) {
  const [code, setCode] = useState(html);
  const [applying, setApplying] = useState(false);
  const preRef = useRef<HTMLPreElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => setCode(html), [html]);
  const highlighted = useMemo(() => highlightHtml(code), [code]);
  const dirty = code !== html;

  const syncScroll = () => {
    if (preRef.current && taRef.current) {
      preRef.current.scrollTop = taRef.current.scrollTop;
      preRef.current.scrollLeft = taRef.current.scrollLeft;
    }
  };

  const apply = async () => {
    setApplying(true);
    try {
      await onApply(code);
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-[#D6E2F5] px-3 py-2">
        <span className="font-mono-folio text-xs text-[#5B6B86]">index.html{dirty ? ' · 未应用' : ''}</span>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setCode(formatHtml(code))} disabled={disabled}>
            <Wand2 className="mr-1 h-4 w-4" />格式化
          </Button>
          <Button size="sm" onClick={apply} disabled={disabled || applying || !dirty}>
            {applying ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Check className="mr-1 h-4 w-4" />}应用代码
          </Button>
          <Button size="sm" variant="outline" onClick={onDownload} disabled={disabled || downloading}>
            {downloading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Download className="mr-1 h-4 w-4" />}下载 HTML
          </Button>
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        <pre ref={preRef} aria-hidden className="code-hl absolute inset-0 text-[#1E2B45]" dangerouslySetInnerHTML={{ __html: highlighted }} />
        <textarea
          ref={taRef}
          aria-label="HTML 源码"
          spellCheck={false}
          value={code}
          disabled={disabled}
          onChange={(e) => setCode(e.target.value)}
          onScroll={syncScroll}
          className="code-area absolute inset-0 h-full w-full resize-none bg-transparent text-transparent caret-[#1D4ED8] outline-none selection:bg-blue-200/60"
        />
      </div>
    </div>
  );
}

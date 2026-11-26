import { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, PlugZap, RefreshCw, Save } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { errorMessage, folioApi, LlmSettings } from '@/lib/folio';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (s: LlmSettings) => void;
}

export default function SettingsDialog({ open, onOpenChange, onSaved }: Props) {
  const [baseUrl, setBaseUrl] = useState('');
  const [token, setToken] = useState('');
  const [model, setModel] = useState('');
  const [hasToken, setHasToken] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState<'' | 'load' | 'models' | 'save' | 'test'>('');
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setBusy('load');
    setResult(null);
    setToken('');
    folioApi
      .settings()
      .then((s) => {
        setBaseUrl(s.base_url);
        setModel(s.model);
        setHasToken(s.has_token);
      })
      .catch((e) => toast.error(errorMessage(e, '读取设置失败')))
      .finally(() => setBusy(''));
  }, [open]);

  const fetchModels = async () => {
    setBusy('models');
    setResult(null);
    try {
      const r = await folioApi.fetchModels({ base_url: baseUrl, token: token || undefined });
      setModels(r.models);
      if (!r.models.length) setResult({ ok: false, text: '服务返回了空的模型列表，可以手动填写模型 ID。' });
      else {
        setResult({ ok: true, text: `获取到 ${r.models.length} 个模型` });
        if (!model) setModel(r.models[0]);
      }
    } catch (e) {
      setResult({ ok: false, text: errorMessage(e) });
    } finally {
      setBusy('');
    }
  };

  const save = async () => {
    setBusy('save');
    try {
      const s = await folioApi.saveSettings({ base_url: baseUrl, token: token || undefined, model });
      setHasToken(s.has_token);
      setToken('');
      toast.success(s.configured ? '设置已保存，对话将使用该模型' : '设置已保存（尚未完整配置）');
      onSaved?.(s);
    } catch (e) {
      toast.error(errorMessage(e, '保存失败'));
    } finally {
      setBusy('');
    }
  };

  const clearToken = async () => {
    setBusy('save');
    try {
      const s = await folioApi.saveSettings({ base_url: baseUrl, model, clear_token: true });
      setHasToken(s.has_token);
      toast.success('已清除 Token');
      onSaved?.(s);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy('');
    }
  };

  const test = async () => {
    setBusy('test');
    setResult(null);
    try {
      const r = await folioApi.testSettings({ base_url: baseUrl, token: token || undefined, model });
      setResult({ ok: true, text: `连接成功（${r.model}）：${r.reply}` });
    } catch (e) {
      setResult({ ok: false, text: errorMessage(e) });
    } finally {
      setBusy('');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>模型设置</DialogTitle>
          <DialogDescription>
            填写 OpenAI 兼容服务的地址、Token 和模型 ID。Token 在服务端加密保存，只有你的账号可以使用。未配置时，可以用内置规则体验生成和基础编辑。
          </DialogDescription>
        </DialogHeader>
        {busy === 'load' ? (
          <div className="flex items-center py-10 text-[#5B6B86]"><Loader2 className="mr-2 h-4 w-4 animate-spin" />读取中…</div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="llm-base">API Base URL</Label>
              <Input id="llm-base" placeholder="https://api.openai.com/v1" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="llm-token" className="flex items-center gap-2">
                API Token
                <span className={`rounded-full px-2 py-0.5 text-xs ${hasToken ? 'bg-green-50 text-[#15803D]' : 'bg-slate-100 text-[#5B6B86]'}`}>
                  {hasToken ? '已配置' : '未配置'}
                </span>
                {hasToken && (
                  <button type="button" className="ml-auto text-xs text-[#DC2626] hover:underline" onClick={clearToken}>清除</button>
                )}
              </Label>
              <Input id="llm-token" type="password" autoComplete="off" placeholder={hasToken ? '已保存，留空表示不修改' : 'sk-…'} value={token} onChange={(e) => setToken(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="llm-model">模型 ID</Label>
              <div className="flex gap-2">
                <Input id="llm-model" list="llm-models" placeholder="可手动填写，例如 gpt-4o-mini" value={model} onChange={(e) => setModel(e.target.value)} />
                <Button type="button" variant="outline" onClick={fetchModels} disabled={!!busy || !baseUrl}>
                  {busy === 'models' ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1 h-4 w-4" />}获取模型
                </Button>
              </div>
              <datalist id="llm-models">
                {models.map((m) => <option key={m} value={m} />)}
              </datalist>
              {models.length > 0 && (
                <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto pt-1">
                  {models.map((m) => (
                    <button key={m} type="button" onClick={() => setModel(m)} className={`rounded-full border px-2.5 py-0.5 text-xs ${m === model ? 'border-[#1D4ED8] bg-[#EAF1FF] text-[#1D4ED8]' : 'border-[#D6E2F5] text-[#5B6B86] hover:border-[#9DB7E6]'}`}>{m}</button>
                  ))}
                </div>
              )}
            </div>
            {result && (
              <p className={`rounded-lg px-3 py-2 text-sm ${result.ok ? 'bg-green-50 text-[#15803D]' : 'bg-red-50 text-[#DC2626]'}`}>
                {result.ok && <CheckCircle2 className="mr-1 inline h-4 w-4" />}{result.text}
              </p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={test} disabled={!!busy || !baseUrl || !model}>
                {busy === 'test' ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <PlugZap className="mr-1 h-4 w-4" />}测试连接
              </Button>
              <Button onClick={save} disabled={!!busy}>
                {busy === 'save' ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}保存设置
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

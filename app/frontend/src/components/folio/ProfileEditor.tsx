import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Loader2, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { emptyItem, Profile, ResumeItem, ResumeSection } from '@/lib/folio';

interface Props {
  open: boolean;
  profile: Profile;
  onOpenChange: (o: boolean) => void;
  onSave: (p: Profile) => Promise<void>;
}

const TYPE_LABEL: Record<string, string> = {
  experience: '经历', projects: '项目', education: '教育', skills: '技能', custom: '自定义',
};

function move<T>(arr: T[], i: number, d: number): T[] {
  const j = i + d;
  if (j < 0 || j >= arr.length) return arr;
  const next = [...arr];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

export default function ProfileEditor({ open, profile, onOpenChange, onSave }: Props) {
  const [p, setP] = useState<Profile>(profile);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) setP(JSON.parse(JSON.stringify(profile)));
  }, [open, profile]);

  const setSection = (i: number, s: Partial<ResumeSection>) =>
    setP((cur) => ({ ...cur, sections: cur.sections.map((x, k) => (k === i ? { ...x, ...s } : x)) }));
  const setItem = (si: number, ii: number, it: Partial<ResumeItem>) =>
    setP((cur) => ({
      ...cur,
      sections: cur.sections.map((x, k) =>
        k === si ? { ...x, items: x.items.map((y, m) => (m === ii ? { ...y, ...it } : y)) } : x,
      ),
    }));

  const addSection = (type: ResumeSection['type']) => {
    const id = `${type === 'custom' ? 'custom' : type}${Date.now().toString(36).slice(-4)}`;
    const title = { experience: '工作经历', projects: '项目经历', education: '教育背景', skills: '专业技能', custom: '新栏目' }[type];
    setP((cur) => ({ ...cur, sections: [...cur.sections, { id, type, title, items: [emptyItem()] }] }));
  };

  const save = async () => {
    setSaving(true);
    try {
      await onSave(p);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] max-w-3xl flex-col">
        <DialogHeader>
          <DialogTitle>编辑资料</DialogTitle>
          <DialogDescription>修改后保存，当前样式会用新资料重新排版，并记录为一个新版本。</DialogDescription>
        </DialogHeader>
        <div className="-mx-6 min-h-0 flex-1 space-y-6 overflow-y-auto px-6 pb-2">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label htmlFor="pf-name">姓名</Label><Input id="pf-name" value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} /></div>
            <div className="space-y-1.5"><Label htmlFor="pf-title">目标岗位 / 头衔</Label><Input id="pf-title" value={p.title} onChange={(e) => setP({ ...p, title: e.target.value })} /></div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pf-summary">个人简介</Label>
            <Textarea id="pf-summary" rows={3} value={p.summary} onChange={(e) => setP({ ...p, summary: e.target.value })} />
          </div>
          <div className="space-y-2">
            <div className="flex items-center"><Label>联系方式</Label>
              <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setP({ ...p, contacts: [...p.contacts, { label: '', value: '' }] })}><Plus className="mr-1 h-3.5 w-3.5" />添加</Button>
            </div>
            {p.contacts.map((c, i) => (
              <div key={i} className="flex gap-2">
                <Input aria-label="联系方式名称" className="w-28" placeholder="邮箱" value={c.label} onChange={(e) => setP({ ...p, contacts: p.contacts.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)) })} />
                <Input aria-label="联系方式内容" placeholder="name@example.com" value={c.value} onChange={(e) => setP({ ...p, contacts: p.contacts.map((x, k) => (k === i ? { ...x, value: e.target.value } : x)) })} />
                <Button size="icon" variant="ghost" aria-label="删除联系方式" onClick={() => setP({ ...p, contacts: p.contacts.filter((_, k) => k !== i) })}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
          </div>

          {p.sections.map((s, si) => (
            <section key={s.id} className="rounded-xl border border-[#D6E2F5] bg-[#F7FAFF] p-4">
              <div className="flex items-center gap-2">
                <span className="rounded bg-[#EAF1FF] px-2 py-0.5 text-xs text-[#1D4ED8]">{TYPE_LABEL[s.type]}</span>
                <Input aria-label="栏目标题" className="h-9 max-w-[220px] bg-white font-bold" value={s.title} onChange={(e) => setSection(si, { title: e.target.value })} />
                <div className="ml-auto flex">
                  <Button size="icon" variant="ghost" aria-label="上移栏目" onClick={() => setP({ ...p, sections: move(p.sections, si, -1) })}><ArrowUp className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" aria-label="下移栏目" onClick={() => setP({ ...p, sections: move(p.sections, si, 1) })}><ArrowDown className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" aria-label="删除栏目" onClick={() => setP({ ...p, sections: p.sections.filter((_, k) => k !== si) })}><Trash2 className="h-4 w-4 text-[#DC2626]" /></Button>
                </div>
              </div>
              <div className="mt-3 space-y-3">
                {s.items.map((it, ii) => (
                  <div key={ii} className="space-y-2 rounded-lg border border-[#D6E2F5] bg-white p-3">
                    {s.type === 'skills' ? (
                      <div className="grid gap-2 sm:grid-cols-[160px_1fr_auto]">
                        <Input aria-label="技能分组" placeholder="分组，如 前端" value={it.title} onChange={(e) => setItem(si, ii, { title: e.target.value })} />
                        <Input aria-label="技能列表" placeholder="用逗号分隔，如 React, TypeScript" value={it.tags.join(', ')} onChange={(e) => setItem(si, ii, { tags: e.target.value.split(/[,，、]/).map((t) => t.trim()).filter(Boolean) })} />
                        <Button size="icon" variant="ghost" aria-label="删除条目" onClick={() => setSection(si, { items: s.items.filter((_, m) => m !== ii) })}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    ) : (
                      <>
                        <div className="grid gap-2 sm:grid-cols-2">
                          <Input aria-label="名称" placeholder="公司 / 项目 / 学校 / 奖项" value={it.title} onChange={(e) => setItem(si, ii, { title: e.target.value })} />
                          <Input aria-label="角色" placeholder="职位 / 角色 / 专业" value={it.subtitle} onChange={(e) => setItem(si, ii, { subtitle: e.target.value })} />
                          <Input aria-label="时间" placeholder="2022.07 – 至今" value={it.period} onChange={(e) => setItem(si, ii, { period: e.target.value })} />
                          <Input aria-label="链接" placeholder="链接（可选）" value={it.link} onChange={(e) => setItem(si, ii, { link: e.target.value })} />
                        </div>
                        <Input aria-label="一句话描述" placeholder="一句话背景（可选）" value={it.description} onChange={(e) => setItem(si, ii, { description: e.target.value })} />
                        <Textarea aria-label="要点" rows={3} placeholder="每行一条要点：做了什么 → 怎么做 → 结果" value={it.bullets.join('\n')} onChange={(e) => setItem(si, ii, { bullets: e.target.value.split('\n') })} />
                        <div className="flex gap-2">
                          <Input aria-label="标签" placeholder="标签，用逗号分隔" value={it.tags.join(', ')} onChange={(e) => setItem(si, ii, { tags: e.target.value.split(/[,，、]/).map((t) => t.trim()).filter(Boolean) })} />
                          <Button size="icon" variant="ghost" aria-label="上移条目" onClick={() => setSection(si, { items: move(s.items, ii, -1) })}><ArrowUp className="h-4 w-4" /></Button>
                          <Button size="icon" variant="ghost" aria-label="删除条目" onClick={() => setSection(si, { items: s.items.filter((_, m) => m !== ii) })}><Trash2 className="h-4 w-4" /></Button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
                <Button size="sm" variant="outline" onClick={() => setSection(si, { items: [...s.items, emptyItem()] })}><Plus className="mr-1 h-3.5 w-3.5" />添加条目</Button>
              </div>
            </section>
          ))}
          <div className="flex flex-wrap gap-2">
            <span className="self-center text-sm text-[#5B6B86]">新增栏目：</span>
            {(['experience', 'projects', 'education', 'skills', 'custom'] as const).map((t) => (
              <Button key={t} size="sm" variant="outline" onClick={() => addSection(t)}><Plus className="mr-1 h-3.5 w-3.5" />{TYPE_LABEL[t]}</Button>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={save} disabled={saving}>{saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}保存资料</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

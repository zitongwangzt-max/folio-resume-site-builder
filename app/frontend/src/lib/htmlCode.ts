const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function highlightCss(css: string): string {
  let out = '';
  const re = /(\/\*[\s\S]*?\*\/)|([^{}]+)(\{)|([\w-]+)(\s*:\s*)([^;{}]*)(;?)|(\})/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    out += esc(css.slice(last, m.index));
    if (m[1]) out += `<span class="hl-comment">${esc(m[1])}</span>`;
    else if (m[2] !== undefined) out += `<span class="hl-selector">${esc(m[2])}</span>${m[3]}`;
    else if (m[4]) out += `<span class="hl-prop">${esc(m[4])}</span>${esc(m[5])}<span class="hl-value">${esc(m[6])}</span>${m[7]}`;
    else if (m[8]) out += '}';
    last = re.lastIndex;
    if (m[0].length === 0) re.lastIndex++;
  }
  return out + esc(css.slice(last));
}

function highlightTag(tag: string): string {
  if (tag.startsWith('<!--')) return `<span class="hl-comment">${esc(tag)}</span>`;
  const m = /^<(\/?)([\w!-]+)([\s\S]*?)(\/?)>$/.exec(tag);
  if (!m) return esc(tag);
  const attrs = m[3].replace(/([\w:-]+)(\s*=\s*)?("[^"]*"|'[^']*'|[^\s"'>]+)?/g, (_all, name, eq, val) => {
    let s = `<span class="hl-attr">${esc(name)}</span>`;
    if (eq) s += esc(eq);
    if (val) s += `<span class="hl-string">${esc(val)}</span>`;
    return s;
  });
  return `<span class="hl-punct">&lt;${m[1]}</span><span class="hl-tag">${esc(m[2])}</span>${attrs}<span class="hl-punct">${m[4]}&gt;</span>`;
}

/** Return syntax-highlighted HTML markup (HTML tags + embedded CSS). */
export function highlightHtml(src: string): string {
  let out = '';
  const re = /<!--[\s\S]*?-->|<style\b[^>]*>([\s\S]*?)<\/style\s*>|<[^>]+>/gi;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    out += esc(src.slice(last, m.index));
    const whole = m[0];
    if (/^<style/i.test(whole)) {
      const openEnd = whole.indexOf('>') + 1;
      const closeStart = whole.toLowerCase().lastIndexOf('</style');
      out += highlightTag(whole.slice(0, openEnd));
      out += highlightCss(whole.slice(openEnd, closeStart));
      out += highlightTag(whole.slice(closeStart));
    } else {
      out += highlightTag(whole);
    }
    last = re.lastIndex;
  }
  return out + esc(src.slice(last)) + '\n';
}

const INLINE = new Set(['a', 'span', 'strong', 'em', 'b', 'i', 'small', 'code', 'br', 'img', 'sup', 'sub', 'u', 'mark']);
const VOID = new Set(['meta', 'link', 'img', 'br', 'hr', 'input', 'source', '!doctype']);

function formatCss(css: string, pad: string): string {
  const rules: string[] = [];
  const clean = css.replace(/\s+/g, ' ').trim();
  let depth = 0;
  let buf = '';
  for (const ch of clean) {
    if (ch === '{') {
      rules.push(`${pad}${'  '.repeat(depth)}${buf.trim()} {`);
      depth++;
      buf = '';
    } else if (ch === '}') {
      buf
        .split(';')
        .map((d) => d.trim())
        .filter(Boolean)
        .forEach((d) => rules.push(`${pad}${'  '.repeat(depth)}${d};`));
      depth = Math.max(0, depth - 1);
      rules.push(`${pad}${'  '.repeat(depth)}}`);
      buf = '';
    } else {
      buf += ch;
    }
  }
  if (buf.trim()) rules.push(pad + buf.trim());
  return rules.join('\n');
}

/** Pretty-print an HTML document: block tags on their own lines, inline content kept intact, CSS expanded. */
export function formatHtml(src: string): string {
  const parts = src.split(/(<style\b[^>]*>[\s\S]*?<\/style\s*>|<!--[\s\S]*?-->|<[^>]+>)/i).filter((p) => p !== '');
  const lines: string[] = [];
  let depth = 0;
  let line = '';
  const flush = () => {
    if (line.trim()) lines.push('  '.repeat(depth) + line.trim());
    line = '';
  };
  for (const part of parts) {
    if (/^<style/i.test(part)) {
      flush();
      const open = part.slice(0, part.indexOf('>') + 1);
      const body = part.slice(open.length, part.toLowerCase().lastIndexOf('</style'));
      lines.push('  '.repeat(depth) + open);
      lines.push(formatCss(body, '  '.repeat(depth + 1)));
      lines.push('  '.repeat(depth) + '</style>');
      continue;
    }
    const tm = /^<(\/?)([\w!-]+)/.exec(part);
    if (!tm || part.startsWith('<!--')) {
      if (part.startsWith('<!--')) {
        flush();
        lines.push('  '.repeat(depth) + part);
      } else {
        line += part.replace(/\s+/g, ' ');
      }
      continue;
    }
    const name = tm[2].toLowerCase();
    if (INLINE.has(name)) {
      line += part;
      continue;
    }
    flush();
    if (tm[1]) {
      depth = Math.max(0, depth - 1);
      lines.push('  '.repeat(depth) + part);
    } else {
      lines.push('  '.repeat(depth) + part);
      if (!VOID.has(name) && !part.endsWith('/>')) depth++;
    }
  }
  flush();
  return lines.join('\n') + '\n';
}

/*
 * Rendering of stored record text: the v5 renderMarkdownLite subset as Preact elements.
 * No innerHTML anywhere; links are https only. The parsers are pure so they can be tested.
 */
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import type { LogEntry } from '../core/types';
import { fmtDT, KIND_LABEL, refInline, resolveRef } from './refs';

export type Inline =
  | { k: 'text'; v: string }
  | { k: 'bold' | 'italic'; c: Inline[] }
  | { k: 'link'; label: string; url: string }
  | { k: 'tag'; v: string }
  | { k: 'ref'; raw: string; kind: string; ymd: string; hm: string; suffix: string };

export type Block =
  | { k: 'h'; level: 1 | 2 | 3; c: Inline[] }
  | { k: 'quote' | 'ul' | 'p'; c: Inline[] }
  | { k: 'ol'; n: string; c: Inline[] };

const TOKEN = /\*\*([^*\n]+)\*\*|\[([^\]\n]+)\]\((https:\/\/[^\s)]+)\)|@([dq]?)(\d{6})-(\d{4})([a-z]?)|(^|[^*])\*([^*\n]+)\*(?!\*)|#([^\s#，。！？；：、,.!?;:<>&]+)/g;
const TAG_BEFORE = /[\s，。！？；：、,.!?;:]/;

export function parseInline(line: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  const push = (v: string) => { if (v) out.push({ k: 'text', v }); };
  TOKEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  const re = new RegExp(TOKEN.source, 'g');
  while ((m = re.exec(line))) {
    let start = m.index;
    if (m[1] !== undefined) {
      push(line.slice(last, start));
      out.push({ k: 'bold', c: parseInline(m[1]) });
    } else if (m[2] !== undefined) {
      push(line.slice(last, start));
      out.push({ k: 'link', label: m[2], url: m[3] });
    } else if (m[5] !== undefined) {
      push(line.slice(last, start));
      out.push({ k: 'ref', raw: m[0], kind: m[4], ymd: m[5], hm: m[6], suffix: m[7] });
    } else if (m[9] !== undefined) {
      // *italic*: group 8 is the preceding char (kept as text)
      push(line.slice(last, start) + m[8]);
      out.push({ k: 'italic', c: parseInline(m[9]) });
    } else if (m[10] !== undefined) {
      const before = start === 0 ? '' : line[start - 1];
      if (start > 0 && !TAG_BEFORE.test(before)) {
        // not a tag: keep '#' as text and continue scanning after it
        re.lastIndex = start + 1;
        continue;
      }
      push(line.slice(last, start));
      out.push({ k: 'tag', v: m[10] });
    }
    last = re.lastIndex;
    start = last;
  }
  push(line.slice(last));
  return out;
}

export function parseBlocks(text: string): Block[] {
  return String(text || '').split('\n').map((line): Block => {
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) return { k: 'h', level: heading[1].length as 1 | 2 | 3, c: parseInline(heading[2]) };
    const quote = line.match(/^>\s?(.*)$/);
    if (quote) return { k: 'quote', c: parseInline(quote[1]) };
    const bullet = line.match(/^-\s(.*)$/);
    if (bullet) return { k: 'ul', c: parseInline(bullet[1]) };
    const num = line.match(/^(\d+)\.\s(.*)$/);
    if (num) return { k: 'ol', n: num[1], c: parseInline(num[2]) };
    return { k: 'p', c: parseInline(line) };
  });
}

/* ---------------- components ---------------- */

function RefCard({ node, log, onGo }: { node: Extract<Inline, { k: 'ref' }>; log: LogEntry[]; onGo?: (r: LogEntry) => void }) {
  const [open, setOpen] = useState(false);
  const { hit, siblings } = resolveRef(log, node.kind, node.ymd, node.hm, node.suffix);
  if (!hit) {
    return <span class="md-ref gone">{node.raw}<span class="mr-x">这条记录已经不在了</span></span>;
  }
  const kind = KIND_LABEL[hit.type];
  return (
    <span class={`md-ref ${open ? 'open' : ''}`} role="button" tabIndex={0} onClick={() => setOpen(!open)}
      onKeyDown={(e) => { if (e.key === 'Enter') setOpen(!open); }}>
      <span class="mr-d">{fmtDT(hit.t)}{kind ? ' · ' + kind : ''}</span>
      <span class="mr-t">{refInline(log, String(hit.text || '').trim())}</span>
      {open && siblings.length > 1 && <span class="mr-x">这一分钟还有 {siblings.length - 1} 条记录</span>}
      {open && onGo && (
        <button type="button" class="mr-go" onClick={(e) => { e.stopPropagation(); onGo(hit); }}>去那条 →</button>
      )}
    </span>
  );
}

function Inlines({ nodes, log, onGo }: { nodes: Inline[]; log: LogEntry[]; onGo?: (r: LogEntry) => void }): any {
  return nodes.map((n) => {
    switch (n.k) {
      case 'text': return n.v;
      case 'bold': return <b><Inlines nodes={n.c} log={log} onGo={onGo} /></b>;
      case 'italic': return <em><Inlines nodes={n.c} log={log} onGo={onGo} /></em>;
      case 'link': return <a class="md-link" href={n.url} target="_blank" rel="noopener noreferrer">{n.label}</a>;
      case 'tag': return <span class="md-tag">#{n.v}</span>;
      case 'ref': return <RefCard node={n} log={log} onGo={onGo} />;
    }
  });
}

/** Stored text -> elements. `log` resolves @引用 cards. */
export function Markdown({ text, log, onGo, class: cls }: { text: string; log: LogEntry[]; onGo?: (r: LogEntry) => void; class?: string }) {
  const blocks = parseBlocks(text);
  const body = (c: Inline[]): ComponentChildren => (c.length ? <Inlines nodes={c} log={log} onGo={onGo} /> : <br />);
  return (
    <div class={`md ${cls || ''}`}>
      {blocks.map((b) => {
        switch (b.k) {
          case 'h': return <div class={`md-line md-h md-h${b.level}`}>{body(b.c)}</div>;
          case 'quote': return <div class="md-line md-quote">{body(b.c)}</div>;
          case 'ul': return <div class="md-line md-ul">{body(b.c)}</div>;
          case 'ol': return <div class="md-line md-ol" data-marker={b.n + '.'}>{body(b.c)}</div>;
          default: return <div class="md-line">{body(b.c)}</div>;
        }
      })}
    </div>
  );
}

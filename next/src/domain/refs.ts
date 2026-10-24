/*
 * @引用 references and text helpers (port of legacy refToken/resolveRef + v5 displayReferences).
 *
 * Stored text always contains the raw token `@<kind><yymmdd>-<hhmm><suffix>`. Editors show a
 * readable label instead; `storageReferences` swaps labels back before saving.
 * Identity of a reference is minute + type + order inside the minute (legacy, see spec O9).
 */
import type { LogEntry } from '../core/types';
import { pad } from '../core/util';

export type RefMap = Map<string, string>; // readable label -> raw token

const REF_KIND: Record<string, string> = { '': 'note', d: 'done', q: 'ai' };
const KIND_LETTER: Record<string, string> = { note: '', done: 'd', ai: 'q' };
export const KIND_LABEL: Record<string, string> = { note: '', done: '完成', ai: '问一问' };

/** Fresh regex each call (global regexes carry lastIndex state). */
export const refRe = () => /@([dq]?)(\d{6})-(\d{4})([a-z]?)/g;
const RAW_REF = /(^|[^\p{L}\p{N}_@])(@([dq]?)(\d{6})-(\d{4})([a-z]?))(?=$|[^\p{L}\p{N}_])/gu;
const RAW_ONE = /^@([dq]?)(\d{6})-(\d{4})([a-z]?)$/;

export function fmtDT(t: number): string {
  const d = new Date(t);
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Characters excluding reference tokens (legacy charCount). */
export function charCount(text: string): number {
  return Array.from(String(text || '').replace(refRe(), '').trim()).length;
}

export function fmtSpan(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return s + ' 秒';
  const m = Math.floor(s / 60);
  if (m < 60) return m + ' 分钟';
  return Math.floor(m / 60) + ' 小时 ' + (m % 60) + ' 分钟';
}

/** Plain-text excerpt of markdown-ish text (v5 excerptText). */
export function excerptText(value: unknown): string {
  return String(value || '')
    .replace(/!\[[^\]\n]*\]\([^)]*\)/g, '[图片]')
    .replace(/\[([^\]\n]+)\]\(https?:\/\/[^)]+\)/g, '$1')
    .replace(/(^|\n)\s{0,3}(?:#{1,3}\s+|>\s*|[-*]\s+\[[ xX]\]\s*|[-*]\s+|\d+\.\s+)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

export function refMinuteMatches(log: LogEntry[], kind: string, ymd: string, hm: string): LogEntry[] {
  const type = REF_KIND[kind || ''] || 'note';
  const y = 2000 + +ymd.slice(0, 2), mo = +ymd.slice(2, 4), d = +ymd.slice(4, 6), h = +hm.slice(0, 2), mi = +hm.slice(2, 4);
  return log
    .filter((e) => {
      if (e.type !== type) return false;
      const t = new Date(e.t);
      return t.getFullYear() === y && t.getMonth() + 1 === mo && t.getDate() === d && t.getHours() === h && t.getMinutes() === mi;
    })
    .sort((a, b) => a.t - b.t);
}

export function resolveRef(log: LogEntry[], kind: string, ymd: string, hm: string, suffix: string) {
  const siblings = refMinuteMatches(log, kind, ymd, hm);
  const i = suffix && suffix !== 'a' ? suffix.charCodeAt(0) - 97 : 0;
  return { hit: siblings[i] || null, siblings };
}

/** Raw token for a record, or '' for types that cannot be referenced. */
export function refToken(log: LogEntry[], entry: LogEntry): string {
  const k = KIND_LETTER[entry.type];
  if (k === undefined) return '';
  const t = new Date(entry.t);
  const ymd = String(t.getFullYear()).slice(2) + pad(t.getMonth() + 1) + pad(t.getDate());
  const hm = pad(t.getHours()) + pad(t.getMinutes());
  const list = refMinuteMatches(log, k, ymd, hm);
  const i = list.findIndex((x) => x === entry || (!!entry.id && x.id === entry.id));
  return '@' + k + ymd + '-' + hm + (i > 0 ? String.fromCharCode(97 + i) : '');
}

export function resolveToken(log: LogEntry[], raw: string): LogEntry | null {
  const m = RAW_ONE.exec(raw || '');
  return m ? resolveRef(log, m[1], m[2], m[3], m[4]).hit : null;
}

/** Nested-reference rendering inside a quoted record: ⟨引用·MM/DD 完成⟩. */
export function refInline(log: LogEntry[], text: string): string {
  return String(text || '').replace(refRe(), (_all, kd, ymd, hm, sf) => {
    const { hit } = resolveRef(log, kd, ymd, hm, sf);
    return hit ? `⟨引用·${fmtDT(hit.t).slice(0, 5)}${KIND_LABEL[hit.type] ? ' ' + KIND_LABEL[hit.type] : ''}⟩` : '⟨引用·已删除⟩';
  });
}

/** Export wording: （引用MM/DD HH:mm：…）. */
export function stripRefs(log: LogEntry[], text: string): string {
  return String(text || '').replace(refRe(), (_all, kd, ymd, hm, sf) => {
    const { hit } = resolveRef(log, kd, ymd, hm, sf);
    return hit
      ? `（引用${fmtDT(hit.t)}${KIND_LABEL[hit.type] ? ' ' + KIND_LABEL[hit.type] : ''}：${String(hit.text || '').trim().slice(0, 20)}）`
      : '（引用了一条已删除的记录）';
  });
}

function readableReference(log: LogEntry[], raw: string, map: RefMap): string {
  for (const [label, token] of map) if (token === raw) return label;
  const m = RAW_ONE.exec(raw);
  if (!m) return raw;
  const { hit } = resolveRef(log, m[1], m[2], m[3], m[4]);
  const base = hit ? `〔引用 ${fmtDT(hit.t)} · ${excerptText(hit.text).slice(0, 24)}〕` : '〔引用：原记录暂不可用〕';
  let label = base;
  let n = 2;
  while (map.has(label) && map.get(label) !== raw) label = base.slice(0, -1) + ` ${n++}〕`;
  map.set(label, raw);
  return label;
}

/** Raw tokens -> readable labels (mutates `map`). */
export function displayReferences(log: LogEntry[], value: string, map: RefMap): string {
  return String(value || '').replace(RAW_REF, (_all, prefix: string, raw: string) => prefix + readableReference(log, raw, map));
}

/** Readable labels -> raw tokens. */
export function storageReferences(value: string, map: RefMap | Record<string, string> | undefined | null): string {
  let result = String(value || '');
  const entries = map instanceof Map ? [...map] : Object.entries(map || {});
  for (const [label, raw] of entries) result = result.split(label).join(raw);
  return result;
}

/** Records that can be referenced, newest first. */
export function refCandidates(log: LogEntry[], query = '', limit = 30): LogEntry[] {
  const q = query.trim();
  return log
    .filter((r) => ['note', 'done', 'ai'].includes(r.type) && String(r.text || '').trim() && (!q || String(r.text).includes(q)))
    .sort((a, b) => b.t - a.t)
    .slice(0, limit);
}

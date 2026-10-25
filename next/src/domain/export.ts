/*
 * Export center: date-range bundle, Markdown, JSON, print HTML. Pure and read-only.
 * Port of legacy buildExportBundle / buildExportMarkdown (index.html l.4136-4250) plus the
 * v5 additions (messageBox, dailyReviews, 消息盒子索引 / 记录里的清单 / 每日回望).
 * Tokens and AI keys are not part of any Snapshot, so they can never end up here.
 */
import { enoughStatus, enoughSubStatus } from '../core/merge';
import type { LogEntry, Ms, Snapshot } from '../core/types';
import { dayKey, pad } from '../core/util';

export type ExportPart = 'journals' | 'ai' | 'tasks' | 'bottles' | 'events';
export const EXPORT_PARTS: { id: ExportPart; label: string }[] = [
  { id: 'journals', label: '日记记录' },
  { id: 'ai', label: 'AI 整理与总结' },
  { id: 'tasks', label: '今日三件事' },
  { id: 'bottles', label: '瓶子内容' },
  { id: 'events', label: '时间事件' },
];
export type RangeMode = 'day' | 'week' | 'month' | 'custom';

export interface ExportRange { start: Ms; end: Ms; fromKey: string; toKey: string; label: string }

const parseLocalDay = (key: string) => new Date(key + 'T00:00:00');
const endOfLocalDay = (d: Date) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; };

/** Legacy exportRangeInfo. Throws the same user-facing messages. */
export function exportRange(mode: RangeMode, anchorKey: string, fromKey?: string, toKey?: string, nowMs = Date.now()): ExportRange {
  const anchor = anchorKey || dayKey(nowMs);
  let start = parseLocalDay(anchor);
  let end = endOfLocalDay(start);
  if (mode === 'week') {
    const diff = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - diff);
    end = endOfLocalDay(new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6));
  } else if (mode === 'month') {
    start = new Date(start.getFullYear(), start.getMonth(), 1);
    end = endOfLocalDay(new Date(start.getFullYear(), start.getMonth() + 1, 0));
  } else if (mode === 'custom') {
    if (!fromKey || !toKey) throw new Error('请选择开始和结束日期');
    start = parseLocalDay(fromKey);
    end = endOfLocalDay(parseLocalDay(toKey));
    if (start > end) throw new Error('开始日期不能晚于结束日期');
  }
  const f = dayKey(start.getTime());
  const t = dayKey(end.getTime());
  return { start: start.getTime(), end: end.getTime(), fromKey: f, toKey: t, label: f === t ? f : f + '_至_' + t };
}

/* ---------------- text helpers (ports) ---------------- */

const REF_KIND: Record<string, string> = { '': 'note', d: 'done', q: 'ai' };
const KIND_LABEL: Record<string, string> = { note: '', done: '完成', ai: '问一问' };
const refRe = () => /@([dq]?)(\d{6})-(\d{4})([a-z]?)/g;

export const fmtDT = (t: Ms) => {
  const d = new Date(t);
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

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

function refMinuteMatches(log: LogEntry[], kind: string, ymd: string, hm: string): LogEntry[] {
  const type = REF_KIND[kind || ''] || 'note';
  const y = 2000 + +ymd.slice(0, 2), mo = +ymd.slice(2, 4), d = +ymd.slice(4, 6), h = +hm.slice(0, 2), mi = +hm.slice(2, 4);
  return log.filter((e) => {
    if (e.type !== type) return false;
    const t = new Date(e.t);
    return t.getFullYear() === y && t.getMonth() + 1 === mo && t.getDate() === d && t.getHours() === h && t.getMinutes() === mi;
  }).sort((a, b) => a.t - b.t);
}

/** `@d261024-0930` style references become readable text (legacy stripRefs). */
export function stripRefs(log: LogEntry[], text: unknown): string {
  return String(text || '').replace(refRe(), (_all, kd: string, ymd: string, hm: string, sf: string) => {
    const list = refMinuteMatches(log, kd, ymd, hm);
    const i = sf && sf !== 'a' ? sf.charCodeAt(0) - 97 : 0;
    const hit = list[i];
    return hit ? `（引用${fmtDT(hit.t)}${KIND_LABEL[hit.type] ? ' ' + KIND_LABEL[hit.type] : ''}：${String(hit.text || '').trim().slice(0, 20)}）` : '（引用了一条已删除的记录）';
  });
}

export function cleanAIText(raw: unknown): string {
  return String(raw || '')
    .replace(/```[a-zA-Z]*\s*/g, '').replace(/```/g, '')
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+[.)、]\s*/gm, '')
    .replace(/\*\*|__|~~/g, '')
    .replace(/"/g, '')
    .replace(/^[“”]+|[“”]+$/gm, '')
    .split('\n').map((line) => line.trim().replace(/[ \t]+/g, ' ')).join('\n')
    .replace(/\n{3,}/g, '\n\n').trim();
}

function readReviews(s: Snapshot, nowMs: Ms): any[] {
  const raw: any = s.qyx_ai_review;
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  return raw.text ? [{ t: raw.t || nowMs, from: (raw.t || nowMs) - 7 * 864e5, to: raw.t || nowMs, text: raw.text }] : [];
}

const fmtDay = (t: Ms) => { const d = new Date(t); return `${d.getMonth() + 1}月${d.getDate()}日`; };
function reviewRangeText(item: any): string {
  if (!item || !item.from || !item.to) return '';
  const days = Math.max(1, Math.round((item.to - item.from) / 864e5));
  return `${fmtDay(item.from)} – ${fmtDay(item.to)} · 共 ${days} 天`;
}

/** Legacy subCount: how many times a sub-step was done today (log rows) or the stored counter. */
function subCount(log: LogEntry[], sub: any, nowMs: Ms): number {
  const today = dayKey(nowMs);
  const t = String(sub?.text || '').trim();
  const n = log.filter((e) => e.type === 'done' && dayKey(e.t) === today && String(e.text || '').trim() === t && String(e.src || '').startsWith('三件·小项'))
    .reduce((acc, e) => {
      const m = String(e.src || '').match(/^三件·小项 ×(\d+)$/);
      return Math.max(acc, m ? +m[1] || 0 : 1);
    }, 0);
  const legacy = Math.max(0, Math.floor(+sub?.c || 0));
  if (n > 0) return Math.max(n, legacy);
  if (legacy > 0) return legacy;
  return enoughSubStatus(sub) === 'completed' ? 1 : 0;
}

/* ---------------- bundle ---------------- */

export interface ExportContext { version: string; exportedAt: Ms }

export function buildExportBundle(s: Snapshot, range: ExportRange, parts: Set<ExportPart>, ctx: ExportContext): any {
  if (!parts.size) throw new Error('请至少选择一类内容');
  const log = s.qyx_log || [];
  const inside = (t: Ms) => t >= range.start && t <= range.end;
  const entries = [...log].filter((e) => inside(e.t)).sort((a, b) => a.t - b.t);
  const bundle: any = {
    meta: { app: 'chop chop!', version: ctx.version, exportedAt: new Date(ctx.exportedAt).toISOString(), from: range.fromKey, to: range.toKey },
    range,
  };
  const partOf = (e: LogEntry): ExportPart => (e.type === 'note' ? 'journals' : e.type === 'ai' ? 'ai' : 'events');
  const exportedIds = new Set(entries.filter((e) => parts.has(partOf(e))).map((e) => e.id));
  const recordTags = s.qyx_record_tags || {};
  const scopedRecordTags = Object.fromEntries(Object.entries(recordTags).filter(([id]) => exportedIds.has(id)));
  const tagIds = new Set(Object.values(scopedRecordTags).flat());
  const tags = s.qyx_tags || [];
  const byTagId = new Map(tags.map((t) => [t.id, t]));
  for (const id of [...tagIds]) {
    let parent = byTagId.get(id)?.parent_id;
    while (parent && !tagIds.has(parent)) { tagIds.add(parent); parent = byTagId.get(parent)?.parent_id; }
  }
  const pathOf = (id: string) => {
    const out: string[] = [];
    const seen = new Set<string>();
    let t = byTagId.get(id);
    while (t && !seen.has(t.id)) { seen.add(t.id); out.unshift(t.name); t = t.parent_id ? byTagId.get(t.parent_id) : undefined; }
    return out.join('/');
  };
  bundle.tagSystem = {
    tags: tags.filter((t) => tagIds.has(t.id)).map((t) => Object.assign({}, t, { path: pathOf(t.id) })),
    recordTags: scopedRecordTags, goalTags: {}, taskTags: {}, taskGoals: {},
  };
  if (parts.has('journals')) bundle.journals = entries.filter((e) => e.type === 'note').map((e) => Object.assign({}, e, { text: stripRefs(log, e.text) }));
  if (parts.has('ai')) {
    bundle.aiEntries = entries.filter((e) => e.type === 'ai').map((e) => Object.assign({}, e, { text: stripRefs(log, e.text), q: stripRefs(log, e.q || '') }));
    bundle.aiPolish = (s.qyx_polish_history || []).filter((e) => inside(e.t)).sort((a, b) => a.t - b.t)
      .map((e) => Object.assign({}, e, { original: stripRefs(log, e.original || ''), polished: stripRefs(log, e.polished || '') }));
    bundle.aiReviews = readReviews(s, ctx.exportedAt).filter((r) => inside(r.t || 0)).map((r) => Object.assign({}, r, { text: cleanAIText(r.text) }));
  }
  if (parts.has('tasks')) {
    const taskDays: Record<string, any> = {};
    [s.qyx_enough, s.qyx_enough_prev].forEach((src) => {
      if (src && src.d && src.d >= range.fromKey && src.d <= range.toKey) {
        taskDays[src.d] = {
          date: src.d,
          items: (src.items || []).filter((i) => i.text && i.text.trim() && enoughStatus(i) !== 'deleted').map((i) => ({
            text: i.text,
            status: enoughStatus(i) === 'expired' ? 'incomplete' : enoughStatus(i),
            done: enoughStatus(i) === 'completed',
            subs: (i.subs || []).map((sub) => ({ text: sub.text, status: enoughSubStatus(sub), done: enoughSubStatus(sub) === 'completed', c: subCount(log, sub, ctx.exportedAt) })),
          })),
          bonus: [],
        };
      }
    });
    const sums = s.qyx_sums || {};
    Object.keys(sums).filter((k) => k >= range.fromKey && k <= range.toKey).forEach((k) => {
      const sm = sums[k];
      if (!taskDays[k]) taskDays[k] = { date: k, items: sm.three || [], bonus: sm.bonus || [] };
      else taskDays[k].bonus = sm.bonus || [];
    });
    bundle.tasks = Object.values(taskDays).sort((a: any, b: any) => a.date.localeCompare(b.date));
  }
  if (parts.has('bottles')) {
    bundle.bottles = (s.qyx_bottles || []).filter((b) => inside(b.t)).sort((a, b) => a.t - b.t)
      .map((b) => Object.assign({}, b, { text: stripRefs(log, b.text || ''), followups: (b.followups || []).map((f) => Object.assign({}, f, { text: stripRefs(log, f.text || '') })) }));
  }
  if (parts.has('events')) {
    const timeline: any[] = entries.filter((e) => e.type !== 'note' && e.type !== 'ai')
      .map((e) => ({ t: e.t, type: e.type, text: stripRefs(log, e.text), mood: e.mood || null, src: e.src || null }));
    Object.values(s.qyx_months || {}).flat().forEach((g) => (g.hist || []).forEach((h) => {
      if (inside(h.t)) timeline.push({ t: h.t, type: 'goal', text: stripRefs(log, g.text), event: h.ev || '更新' });
    }));
    bundle.events = timeline.sort((a, b) => a.t - b.t);
  }
  // v5 additions
  const ideas = s.qyx_ideas_v5 || { schema: 2, items: [], links: [], events: [], tasks: [] };
  const inRangeDay = (t: Ms) => dayKey(t) >= range.fromKey && dayKey(t) <= range.toKey;
  const recordIds = new Set(log.filter((r) => inRangeDay(r.t) && parts.has(partOf(r))).map((r) => r.id));
  const links = (ideas.links || []).filter((l) => recordIds.has(l.recordId));
  const ideaIds = new Set(links.map((l) => l.ideaId));
  bundle.messageBox = {
    schema: ideas.schema,
    items: (ideas.items || []).filter((i) => ideaIds.has(i.id)),
    links,
    events: (ideas.events || []).filter((e) => ideaIds.has(e.ideaId) && e.t && inRangeDay(e.t)),
    tasks: parts.has('tasks')
      ? (ideas.tasks || []).filter((t) => recordIds.has(t.recordId) || (t.scheduledDate && t.scheduledDate >= range.fromKey && t.scheduledDate <= range.toKey))
      : [],
  };
  bundle.dailyReviews = parts.has('ai') ? (s.qyx_daily_review_v51 || []).filter((r) => r.date >= range.fromKey && r.date <= range.toKey) : [];
  return bundle;
}

/* ---------------- formats ---------------- */

const TAG: Record<string, string> = { dice: '骰子', ai: '问一句', draw: '抽签', note: '记录', done: '完成', bonus: 'bonus' };
const dt = (t: Ms) => new Date(t).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

export function buildExportMarkdown(b: any): string {
  const lines = ['# chop chop! 个人记录', '', '导出范围：' + b.meta.from + ' 至 ' + b.meta.to, '导出时间：' + new Date(b.meta.exportedAt).toLocaleString('zh-CN'), ''];
  if (b.journals) {
    lines.push('## 日记记录', '');
    if (b.journals.length) {
      b.journals.forEach((e: any) => {
        lines.push('- ' + dt(e.t) + (e.mood ? ' ' + e.mood : '') + '　' + e.text);
        if (e.active) lines.push('  （' + charCount(e.text) + ' 字 · 在场 ' + fmtSpan(e.active) + ' · 挂钟 ' + fmtSpan(e.wall || e.active) + '）');
      });
    } else lines.push('这段时间没有日记记录。');
    lines.push('');
  }
  if (b.aiEntries) {
    lines.push('## AI 整理与总结', '');
    (b.aiReviews || []).forEach((r: any) => lines.push('### AI 回望 · ' + reviewRangeText(r), '', cleanAIText(r.text), ''));
    (b.aiPolish || []).forEach((e: any) => lines.push('### ' + dt(e.t) + ' 语音整理', '', '原文：' + e.original, '', '整理后：' + e.polished, ''));
    b.aiEntries.forEach((e: any) => {
      lines.push('### ' + dt(e.t) + ' AI 整理', '');
      if (e.q) lines.push('原始输入：' + e.q, '');
      lines.push(cleanAIText(e.text), '');
    });
    if (!(b.aiReviews || []).length && !b.aiEntries.length) lines.push('这段时间没有 AI 整理内容。', '');
  }
  if (b.tasks) {
    lines.push('## 今日三件事', '');
    if (b.tasks.length) {
      b.tasks.forEach((day: any) => {
        lines.push('### ' + day.date, '');
        (day.items || []).filter((i: any) => enoughStatus(i) !== 'deleted').forEach((i: any) => {
          const status = enoughStatus(i) === 'expired' ? 'incomplete' : enoughStatus(i);
          const label = status === 'completed' ? '已完成' : '未完成';
          lines.push('- [' + (status === 'completed' ? 'x' : ' ') + '] ' + i.text + '（' + label + '）');
          (i.subs || []).forEach((sub: any) => {
            const ss = enoughSubStatus(sub);
            const sl = ss === 'completed' ? '已完成' : ss === 'expired' ? '时间结束' : '未完成';
            const count = Number(sub.c) || 0;
            lines.push('  - [' + (ss === 'completed' ? 'x' : ' ') + '] ' + sub.text + (count >= 2 ? ' ×' + count : '') + '（' + sl + '）');
          });
        });
        (day.bonus || []).forEach((i: any) => lines.push('- Bonus [' + (i.done ? 'x' : ' ') + '] ' + i.text));
        lines.push('');
      });
    } else lines.push('这段时间没有三件事记录。', '');
  }
  if (b.bottles) {
    lines.push('## 瓶子内容', '');
    if (b.bottles.length) {
      b.bottles.forEach((x: any) => {
        lines.push('### ' + dt(x.t), '', x.text, '');
        (x.followups || []).forEach((f: any) => lines.push('- 后续 ' + dt(f.t) + '：' + f.text));
      });
    } else lines.push('这段时间没有瓶子。', '');
  }
  if (b.events) {
    lines.push('## 时间事件', '');
    if (b.events.length) b.events.forEach((e: any) => lines.push('- ' + dt(e.t) + '　[' + (TAG[e.type] || e.type) + '] ' + e.text + (e.src ? ' · ' + e.src : '') + (e.event ? ' · ' + e.event : '')));
    else lines.push('这段时间没有其他时间事件。');
    lines.push('');
  }
  if (b.tagSystem && b.tagSystem.tags.length) {
    lines.push('## 标签索引', '');
    b.tagSystem.tags.forEach((t: any) => lines.push('- #' + t.path));
    lines.push('');
  }
  let s = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  // v5 appendix
  if (b.messageBox) {
    const ideas = b.messageBox.items.filter((i: any) => !i.removedAt);
    if (ideas.length) s += '\n## 消息盒子索引\n\n' + ideas.map((i: any) => '- ' + (i.title || '未命名想法') + (i.status === 'completed' ? ' · 已完成' : '')).join('\n') + '\n';
    const plans = (b.messageBox.tasks || []).filter((t: any) => !t.removedAt);
    if (plans.length) s += '\n## 记录里的清单\n\n' + plans.map((t: any) => '- [' + (t.done ? 'x' : ' ') + '] ' + t.text + (t.scheduledDate ? ' · 安排到 ' + t.scheduledDate : '')).join('\n') + '\n';
  }
  if (b.dailyReviews?.length) {
    s += '\n## 每日回望\n\n' + b.dailyReviews.map((r: any) => '### ' + r.date + '\n\n' + r.paragraphs.map((p: any) => p.text).join('\n\n')).join('\n\n') + '\n';
  }
  return s;
}

/** JSON export = bundle minus `range` (legacy). */
export function exportJson(b: any): string {
  const plain = Object.assign({}, b);
  delete plain.range;
  return JSON.stringify(plain, null, 2);
}

export const exportFileName = (b: any, ext: 'md' | 'json' | 'png') => 'chopchop_' + b.range.label + '.' + ext;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Self-contained print-styled page (the caller opens it and prints). */
export function exportPrintHtml(b: any): string {
  const md = buildExportMarkdown(b);
  return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>chop chop! ' + esc(b.range.label) + '</title>'
    + '<style>@page{margin:18mm}body{font-family:-apple-system,"PingFang SC",sans-serif;color:#34445c;line-height:1.8;max-width:760px;margin:auto}'
    + 'pre{white-space:pre-wrap;word-break:break-word;font:14px/1.85 -apple-system,"PingFang SC",sans-serif}</style></head>'
    + '<body><pre>' + esc(md) + '</pre></body></html>';
}

/** Lines for the PNG long image (headings flagged), capped like legacy (330 wrapped lines is applied by the caller). */
export function imageLines(md: string): { text: string; heading: boolean }[] {
  return md.split('\n').map((line) => {
    const clean = line.replace(/^#{1,3}\s*/, '').replace(/^[-*]\s*/, '• ');
    return { text: clean, heading: /^(日记记录|AI 整理与总结|今日三件事|瓶子内容|时间事件)$/.test(clean) };
  });
}

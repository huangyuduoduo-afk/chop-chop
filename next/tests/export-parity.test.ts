/* 导出中心: bundle + Markdown vs the legacy export (v5-wrapped). Run with TZ=Asia/Shanghai. */
// @ts-ignore plain ESM helper
import { legacyCall } from '../tools/legacy-oracle.mjs';
import {
  buildExportBundle, buildExportMarkdown, exportFileName, exportJson, exportPrintHtml, exportRange, EXPORT_PARTS,
  stripRefs, type ExportPart, type RangeMode,
} from '../src/domain/export';
import { stableId } from '../src/core/util';
import { NOW, T0 } from './helpers/parity';

const DAY = 864e5;
const at = (day: string, hm: string) => Date.parse(`${day}T${hm}:00+08:00`);
const tg = (path: string) => stableId('tag_', path);

const local = {
  qyx_log: [
    { id: 'rec_n1', t: at('2026-10-23', '08:30'), updatedAt: at('2026-10-23', '08:30'), type: 'note', text: '合成 早晨笔记 #学习/英语', mood: '开心', active: 62_000, wall: 90_000 },
    { id: 'rec_n2', t: at('2026-10-23', '21:05'), updatedAt: at('2026-10-23', '21:05'), type: 'note', text: '合成 回看 @261023-0830 和 @d261023-1000 以及 @261001-0900', mood: null },
    { id: 'rec_d1', t: at('2026-10-23', '10:00'), updatedAt: at('2026-10-23', '10:00'), type: 'done', text: '合成 完成一件事', src: '三件' },
    { id: 'rec_a1', t: at('2026-10-23', '12:00'), updatedAt: at('2026-10-23', '12:00'), type: 'ai', text: '**合成** AI 整理\n- 要点一', q: '合成 问题 @261023-0830' },
    { id: 'rec_x1', t: at('2026-10-23', '13:00'), updatedAt: at('2026-10-23', '13:00'), type: 'dice', text: '合成 骰子动作', src: '抽签' },
    { id: 'rec_n3', t: at('2026-10-20', '09:00'), updatedAt: at('2026-10-20', '09:00'), type: 'note', text: '合成 上周笔记 #生活' },
    { id: 'rec_n4', t: at('2026-10-24', '07:00'), updatedAt: at('2026-10-24', '07:00'), type: 'note', text: '合成 今天笔记 #学习' },
  ],
  qyx_tags: [
    { id: tg('学习'), name: '学习', parent_id: null, created_time: 1, updated_time: 1 },
    { id: tg('学习/英语'), name: '英语', parent_id: tg('学习'), created_time: 2, updated_time: 2 },
    { id: tg('生活'), name: '生活', parent_id: null, created_time: 3, updated_time: 3 },
  ],
  qyx_record_tags: { rec_n1: [tg('学习/英语')], rec_n3: [tg('生活')], rec_n4: [tg('学习')] },
  qyx_polish_history: [{ t: at('2026-10-23', '09:00'), original: '合成 原文 @261023-0830', polished: '合成 整理后' }],
  qyx_ai_review: [{ t: at('2026-10-23', '22:00'), from: at('2026-10-16', '22:00'), to: at('2026-10-23', '22:00'), text: '## 合成 回望\n**重点**：测试' }],
  qyx_bottles: [{ id: 1, t: at('2026-10-23', '15:00'), text: '合成 瓶子 @261023-0830', followups: [{ t: at('2026-10-23', '16:00'), text: '合成 后续' }] }, { id: 2, t: at('2026-10-10', '15:00'), text: '合成 旧瓶子', followups: [] }],
  qyx_months: { '2026-10': [{ id: 'g1', text: '合成 本月目标', kind: 'goal', done: false, splits: [], hist: [{ t: at('2026-10-23', '11:00'), ev: '拆小' }, { t: at('2026-10-02', '11:00'), ev: '旧事件' }] }] },
  qyx_enough: { d: '2026-10-24', items: [
    { id: 'task_1', text: '合成 今天甲', done: true, status: 'completed', updatedAt: T0 - 1000, subs: [{ text: '合成 小项', done: true, status: 'completed', updatedAt: T0 - 900, c: 2 }] },
    { id: 'task_2', text: '合成 今天乙', done: false, status: 'expired', updatedAt: T0 - 800, subs: [] },
    { id: 'task_3', text: '', done: false, status: 'incomplete', updatedAt: 0, subs: [] },
  ] },
  qyx_enough_prev: { d: '2026-10-23', items: [
    { id: 'task_p1', text: '合成 昨天甲', done: false, status: 'incomplete', updatedAt: at('2026-10-23', '10:00'), subs: [{ text: '合成 昨天小项', done: false, status: 'expired', updatedAt: 5, c: 0 }] },
    { id: 'task_p2', text: '合成 已删', done: false, status: 'deleted', updatedAt: at('2026-10-23', '10:00'), subs: [] },
    { id: 'task_p3', text: '', done: false, status: 'incomplete', updatedAt: 0, subs: [] },
  ] },
  qyx_sums: { '2026-10-22': { v2: true, stats: { cut: 0, notes: 0, done: 0 }, habits: [], three: [{ text: '合成 前天', status: 'completed', done: true, subs: [] }], bonus: [{ text: '合成 bonus', done: true }] }, '2026-10-23': { v2: true, stats: { cut: 0, notes: 0, done: 0 }, habits: [], three: [], bonus: [{ text: '合成 昨天 bonus', done: false }] } },
  qyx_ideas_v5: {
    schema: 2,
    items: [
      { id: 'idea_1', title: '合成 想法一', icon: 'star', status: 'completed', rootRecordId: 'rec_n1', createdAt: at('2026-10-23', '08:30'), activityAt: at('2026-10-23', '08:30'), updatedAt: at('2026-10-23', '08:30') },
      { id: 'idea_2', title: '合成 想法二', icon: 'star', status: 'open', rootRecordId: 'rec_n3', createdAt: at('2026-10-20', '09:00'), activityAt: at('2026-10-20', '09:00'), updatedAt: at('2026-10-20', '09:00') },
    ],
    links: [
      { id: 'link_rec_n1', ideaId: 'idea_1', recordId: 'rec_n1', role: 'root', linkedAt: 1, updatedAt: 1 },
      { id: 'link_rec_n3', ideaId: 'idea_2', recordId: 'rec_n3', role: 'root', linkedAt: 1, updatedAt: 1 },
    ],
    events: [{ id: 'ev1', ideaId: 'idea_1', event: 'completed', t: at('2026-10-23', '18:00'), updatedAt: 1 }, { id: 'ev2', ideaId: 'idea_2', event: 'open', t: at('2026-10-20', '18:00'), updatedAt: 1 }],
    tasks: [
      { id: 'plan_1', recordId: 'rec_n1', text: '合成 清单项', done: true, scheduledDate: '2026-10-25', order: 0, createdAt: 1, updatedAt: 1 },
      { id: 'plan_2', recordId: 'rec_n3', text: '合成 别的清单', done: false, scheduledDate: null, order: 0, createdAt: 1, updatedAt: 1 },
    ],
  },
  qyx_daily_review_v51: [
    { id: 'daily_1', date: '2026-10-23', t: at('2026-10-23', '23:00'), paragraphs: [{ text: '合成 每日回望第一段' }, { text: '合成 第二段' }] },
    { id: 'daily_2', date: '2026-10-10', t: at('2026-10-10', '23:00'), paragraphs: [{ text: '合成 太早' }] },
  ],
};

interface Case { name: string; mode: RangeMode; anchor?: string; from?: string; to?: string; parts?: ExportPart[] }
const cases: Case[] = [
  { name: 'a day, all parts', mode: 'day', anchor: '2026-10-23' },
  { name: 'a week (Mon–Sun)', mode: 'week', anchor: '2026-10-23' },
  { name: 'a month', mode: 'month', anchor: '2026-10-15' },
  { name: 'custom range', mode: 'custom', from: '2026-10-22', to: '2026-10-24' },
  { name: 'only journals', mode: 'day', anchor: '2026-10-23', parts: ['journals'] },
  { name: 'only ai + events', mode: 'week', anchor: '2026-10-23', parts: ['ai', 'events'] },
  { name: 'only tasks + bottles', mode: 'custom', from: '2026-10-22', to: '2026-10-24', parts: ['tasks', 'bottles'] },
  { name: 'empty day', mode: 'day', anchor: '2026-09-01' },
];

const norm = (b: any) => {
  const o = JSON.parse(JSON.stringify(b));
  delete o.range; delete o.meta.exportedAt; delete o.meta.version;
  return o;
};

describe('export bundle + Markdown match legacy', () => {
  for (const c of cases) {
    it(c.name, async () => {
      const parts = new Set<ExportPart>(c.parts ?? EXPORT_PARTS.map((p) => p.id));
      const res = await legacyCall({
        local, now: NOW,
        fn: (w: any) => {
          const $ = (id: string) => w.document.getElementById(id);
          $('exportRange').value = c.mode;
          if (c.anchor) $('exportAnchor').value = c.anchor;
          if (c.from) $('exportFrom').value = c.from;
          if (c.to) $('exportTo').value = c.to;
          w.document.querySelectorAll('[data-export-part]').forEach((x: any) => { x.checked = parts.has(x.dataset.exportPart); });
          const snap = JSON.parse(w.collectBackup());
          const bundle = w.eval('buildExportBundle()');
          return { snap, bundle: JSON.parse(JSON.stringify(bundle)), md: w.eval('buildExportMarkdown(buildExportBundle())'), label: bundle.range.label };
        },
      });
      expect(res.errors).toEqual([]);
      const { snap, bundle: legacyBundle, md: legacyMd } = res.result;
      const range = exportRange(c.mode, c.anchor || '', c.from, c.to, T0);
      expect(range.label).toBe(res.result.label);
      const mine = buildExportBundle(snap, range, parts, { version: '5.1.3.1', exportedAt: T0 });
      expect(norm(mine)).toEqual(norm(legacyBundle));
      const md = buildExportMarkdown(mine);
      // header line "导出时间" differs only by the frozen-clock tick; compare the rest
      const body = (s: string) => s.split('\n').filter((l) => !l.startsWith('导出时间：')).join('\n');
      expect(body(md)).toBe(body(legacyMd));
    });
  }
});

describe('export details', () => {
  const snap: any = local;
  it('range errors use the legacy messages', () => {
    expect(() => exportRange('custom', '', '', '2026-10-01')).toThrow('请选择开始和结束日期');
    expect(() => exportRange('custom', '', '2026-10-05', '2026-10-01')).toThrow('开始日期不能晚于结束日期');
    expect(exportRange('week', '2026-10-25').label).toBe('2026-10-19_至_2026-10-25');
  });
  it('needs at least one part', () => {
    expect(() => buildExportBundle(snap, exportRange('day', '2026-10-23'), new Set(), { version: 'x', exportedAt: T0 })).toThrow('请至少选择一类内容');
  });
  it('JSON drops range; file names; print html is escaped and self-contained', () => {
    const b = buildExportBundle(snap, exportRange('day', '2026-10-23'), new Set(['journals'] as ExportPart[]), { version: 'x', exportedAt: T0 });
    expect(JSON.parse(exportJson(b)).range).toBeUndefined();
    expect(exportFileName(b, 'md')).toBe('chopchop_2026-10-23.md');
    const html = exportPrintHtml({ ...b, journals: [{ t: T0, text: '合成 <script>x</script>' }] });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
  it('v5 sections: messageBox + dailyReviews follow the selected parts', () => {
    const all = buildExportBundle(snap, exportRange('day', '2026-10-23'), new Set(EXPORT_PARTS.map((p) => p.id)), { version: 'x', exportedAt: T0 });
    expect(all.messageBox.items.map((i: any) => i.id)).toEqual(['idea_1']);
    expect(all.messageBox.tasks.map((t: any) => t.id)).toEqual(['plan_1']);
    expect(all.dailyReviews.map((r: any) => r.id)).toEqual(['daily_1']);
    const md = buildExportMarkdown(all);
    expect(md).toContain('## 消息盒子索引');
    expect(md).toContain('- 合成 想法一 · 已完成');
    expect(md).toContain('- [x] 合成 清单项 · 安排到 2026-10-25');
    expect(md).toContain('## 每日回望');
    const noAi = buildExportBundle(snap, exportRange('day', '2026-10-23'), new Set(['journals'] as ExportPart[]), { version: 'x', exportedAt: T0 });
    expect(noAi.dailyReviews).toEqual([]);
    expect(noAi.messageBox.tasks).toEqual([]);
    expect(buildExportMarkdown(noAi)).not.toContain('## 每日回望');
  });
  it('refs are rendered as text; deleted refs say so', () => {
    expect(stripRefs(snap.qyx_log, '看 @261023-0830')).toBe('看 （引用10/23 08:30：合成 早晨笔记 #学习/英语）');
    expect(stripRefs(snap.qyx_log, '@261001-0900')).toBe('（引用了一条已删除的记录）');
  });
  it('never contains a token or key', () => {
    const s = { ...snap, qyx_ghtoken: 'ghp_SYNTHETIC', qyx_key: 'sk-SYNTHETIC' };
    const b = buildExportBundle(s, exportRange('month', '2026-10-15'), new Set(EXPORT_PARTS.map((p) => p.id)), { version: 'x', exportedAt: T0 });
    expect(JSON.stringify(b) + buildExportMarkdown(b) + exportJson(b)).not.toContain('SYNTHETIC');
  });
});

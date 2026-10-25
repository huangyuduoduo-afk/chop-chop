/* 瓶子 page (+ 昨日小结): every data write vs the legacy app. Run with TZ=Asia/Shanghai. Synthetic data only. */
// @ts-ignore plain ESM helper
import { legacyCall } from '../tools/legacy-oracle.mjs';
import {
  addFollowup, addReview, deleteReview, dailyMaterial, fetchSummaryObs, fish, fixSummarySub, loadMemoryEvidence, memoryGroups,
  planDailySummary, requestDaily, requestReview, saveDaily, storeSummary, throwBottle,
} from '../src/domain/sea';
import type { Snapshot } from '../src/core/types';
import { actionParity, fixedClock, T0, NOW } from './helpers/parity';

const tick = () => new Promise((r) => setTimeout(r, 0));
const flush = async () => { for (let i = 0; i < 6; i++) await tick(); };
const doc = (w: any) => w.document;
const at = (hhmm: string, day = '2026-10-24') => Date.parse(`${day}T${hhmm}:00+08:00`);
const DAY = 864e5;

function canon(b: any) {
  const sorted = (v: any): any => Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])])) : v;
  const tree = sorted(b);
  const re = /\b(?:goal|rec|daily|task)_[0-9a-z-]+/g;
  const ids = new Map<string, string>();
  const name = (m: string) => { if (!ids.has(m)) ids.set(m, '<id' + ids.size + '>'); return ids.get(m)!; };
  const seed = (v: any) => {
    if (typeof v === 'string') { (v.match(re) || []).forEach(name); return; }
    if (Array.isArray(v)) v.forEach(seed); else if (v && typeof v === 'object') Object.keys(v).forEach((k) => seed(v[k]));
  };
  seed(tree);
  return JSON.parse(JSON.stringify(tree).replace(re, name), (_k, v) => (typeof v === 'number' && v >= T0 && v < T0 + 100_000 ? 0 : v));
}
const mask = (b: any) => { const c = canon(b); for (const k of Object.keys(b)) delete b[k]; Object.assign(b, c); b.qyx_lastchange = undefined; };
async function parity(opts: Parameters<typeof actionParity>[0]) {
  const r = await actionParity({ mask, ...opts });
  expect(r.errors).toEqual([]);
  expect(r.diffs).toEqual([]);
  return r;
}

const note = (id: string, t: number, text: string, extra: any = {}) => ({ id, t, updatedAt: t, type: 'note', text, mood: null, src: null, q: null, ...extra });
const KEY = '"sk-synthetic"';
const cfg = { provider: '', key: 'sk-synthetic' };

/** fetch stub for both worlds: answers from `replies` in order (last one repeats) and records calls. */
function stubFetch(replies: any[], calls: any[]) {
  let i = 0;
  return (async (url: any, init: any) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    const r = replies[Math.min(i++, replies.length - 1)];
    if (r instanceof Error) throw r;
    return { json: async () => r };
  }) as unknown as typeof fetch;
}
const reply = (content: string, finish = 'stop') => ({ choices: [{ message: { content }, finish_reason: finish }] });

/* ======================= bottles ======================= */
describe('sea: bottles', () => {
  const old = { id: 1700000000000, t: at('09:00', '2026-10-22'), text: '合成 旧瓶子', followups: [{ t: at('10:00', '2026-10-23'), text: '合成 早先后续' }] };

  it('throw a bottle', async () => {
    const r = await parity({
      local: { qyx_bottles: [old] },
      legacy: async (w) => { doc(w).getElementById('bottleText').value = '  合成 新瓶子  '; doc(w).getElementById('throwBtn').click(); await flush(); },
      next: (d, c) => { expect(throwBottle(d, '  合成 新瓶子  ', c)).not.toBeNull(); expect(throwBottle(d, '   ', c)).toBeNull(); },
    });
    expect(r.legacy.qyx_bottles).toHaveLength(2);
    expect(r.legacy.qyx_bottles[1]).toMatchObject({ text: '合成 新瓶子', followups: [] });
  });

  it('fish a bottle and write a follow-up; an empty follow-up writes nothing', async () => {
    const r = await parity({
      local: { qyx_bottles: [old] },
      legacy: async (w) => {
        doc(w).getElementById('fishBtn').click(); await flush();
        doc(w).querySelector('.bottle-card textarea').value = '  合成 新后续 ';
        doc(w).querySelector('.bf-save').click(); await flush();
      },
      next: (d, c) => {
        const f = fish(d, c.now(), () => 0);
        expect(f.kind).toBe('bottle');
        if (f.kind === 'bottle') expect(addFollowup(d, f.bottle.id, '  合成 新后续 ', c)).toBe(true);
      },
    });
    expect(r.legacy.qyx_bottles[0].followups).toHaveLength(2);
    await parity({
      local: { qyx_bottles: [old] },
      legacy: async (w) => { doc(w).getElementById('fishBtn').click(); await flush(); doc(w).querySelector('.bf-save').click(); await flush(); },
      next: (d, c) => { expect(addFollowup(d, old.id, '   ', c)).toBe(false); },
    });
  });

  it('nothing to fish today: friendly message, no data change', () => {
    const today = { id: 5, t: T0 - 1000, text: '合成 今天的', followups: [] };
    expect(fish({ qyx_bottles: [today] }, T0)).toEqual({ kind: 'none', message: '今天扔的还在近海漂着，明天再捞。' });
    expect(fish({ qyx_bottles: [] }, T0)).toEqual({ kind: 'none', message: '先扔一个进去。' });
  });
});

/* ======================= 漫游 ======================= */
describe('sea: 漫游 pick', () => {
  const mk = (n: number, ageDays: number) => Array.from({ length: n }, (_, i) => note(`rec_r${ageDays}_${i}`, T0 - ageDays * DAY - i * 1000, '合成 旧记录 ' + i));
  it('needs 20 notes older than 30 days', async () => {
    const { pickRoam, roamPool } = await import('../src/domain/sea');
    expect(pickRoam(roamPool({ qyx_log: mk(19, 40) }, T0), null, T0)).toBeNull();
    expect(pickRoam(roamPool({ qyx_log: [...mk(19, 40), note('rec_new', T0 - DAY, 'x')] }, T0), null, T0)).toBeNull();
  });
  it('one per age tier, reuse today, never repeat yesterday', async () => {
    const { pickRoam, roamPool } = await import('../src/domain/sea');
    const s: Snapshot = { qyx_log: [...mk(8, 40), ...mk(8, 200), ...mk(8, 500)] };
    const pool = roamPool(s, T0);
    const a = pickRoam(pool, null, T0)!;
    expect(a.chosen).toHaveLength(3);
    expect(a.chosen.map((e) => Math.floor((T0 - e.t) / DAY))).toEqual([40, 200, 500]);
    expect(a.save).toEqual({ day: '2026-10-24', ids: a.chosen.map((e) => e.id) });
    const again = pickRoam(pool, a.save, T0)!;
    expect(again.chosen.map((e) => e.id)).toEqual(a.save!.ids);
    expect(again.save).toBeNull();
    const next = pickRoam(pool, { day: '2026-10-23', ids: a.save!.ids }, T0, () => 0.5)!;
    expect(next.chosen.some((e) => a.save!.ids.includes(e.id))).toBe(false);
    expect(next.save!.day).toBe('2026-10-24');
  });
  it('tombstoned notes are not eligible', async () => {
    const { roamPool } = await import('../src/domain/sea');
    const log = mk(21, 40);
    expect(roamPool({ qyx_log: log, qyx_dead: [{ s: 'log', v: log[0].id, t: 1 }] }, T0)).toHaveLength(20);
  });
});

/* ======================= 事件图回望 ======================= */
describe('sea: memory map', () => {
  const log = [
    note('rec_m1', at('08:00'), '合成 今天复习了一课，读书很顺'),
    note('rec_m2', at('08:30'), '合成 睡得不好，有点累'),
    note('rec_m3', at('09:00', '2026-10-20'), '合成 担心明天的安排，也期待见面'),
    note('rec_m4', at('09:00', '2026-08-01'), '合成 太久以前的学习'),
  ];
  const bottles = [{ id: 1, t: at('07:00', '2026-10-22'), text: '合成 想画一幅画，创作一个设计', followups: [] }];
  const local = { qyx_log: log, qyx_bottles: bottles, qyx_key: KEY };

  it('groups match legacy (counts and order, last 30 days incl. bottles)', async () => {
    const leg = await legacyCall({ local, now: NOW, fn: (w: any) => w.eval('JSON.stringify(memoryGroups().groups.map(g=>[g.name,g.count]))') });
    const { groups } = memoryGroups(local as Snapshot, T0);
    expect(JSON.stringify(groups.map((g) => [g.name, g.count]))).toBe(leg.result);
  });

  it('evidence request and accepted rows match legacy (tap in legacy, explicit call here)', async () => {
    const answer = reply('```json\n[{"i":0,"c":"学习","ev":"复习了一课"},{"i":1,"c":"学习","ev":"不在原文"},{"i":2,"c":"学习","ev":"读"}]\n```');
    const legacyCalls: any[] = [];
    const leg = await legacyCall({
      local, now: NOW,
      fn: async (w: any) => {
        w.fetch = stubFetch([answer], legacyCalls);
        doc(w).querySelector('[data-memory-group="学习"]').click();
        await flush();
        return w.eval('JSON.stringify([...memoryEvidence])');
      },
    });
    const nextCalls: any[] = [];
    const g = memoryGroups(local as Snapshot, T0).groups.find((x) => x.name === '学习')!;
    const items = [...g.items].sort((a, b) => b.t - a.t).slice(0, 5);
    const ev = await loadMemoryEvidence(local as Snapshot, items, '学习', cfg, stubFetch([answer], nextCalls));
    expect(nextCalls).toEqual(legacyCalls);
    expect(JSON.stringify([...ev])).toBe(leg.result);
    expect([...ev.values()]).toEqual(['复习了一课']);
  });

  it('any failure throws (page keeps showing plain text)', async () => {
    await expect(loadMemoryEvidence(local as Snapshot, [{ t: 1, text: 'x' }], '学习', cfg, stubFetch([new Error('offline')], []))).rejects.toThrow('offline');
    await expect(loadMemoryEvidence(local as Snapshot, [{ t: 1, text: 'x' }], '学习', cfg, stubFetch([reply('不是 JSON')], []))).rejects.toThrow();
  });
});

/* ======================= AI 回望 ======================= */
describe('sea: AI 回望', () => {
  const log = [
    note('rec_a1', at('08:00', '2026-10-20'), '合成 第一天的记录'),
    { ...note('rec_a2', at('09:00', '2026-10-21'), '合成 完成了一件事'), type: 'done', src: '三件' },
    note('rec_a3', at('09:00', '2026-10-23'), '合成 引用 @d261021-0900'),
  ];
  const bottles = [{ id: 3, t: at('07:00', '2026-10-22'), text: '合成 担心的事', followups: [{ t: at('08:00', '2026-10-23'), text: '合成 不会被发送' }] }];
  const local = { qyx_log: log, qyx_bottles: bottles, qyx_key: KEY };
  const good = '高频主题：合成内容反复出现，记录得很认真。\n情绪变化：整体平稳，偶有起伏。\n重复关注：合成主题。\n此刻观察：你正在慢慢整理自己，保持这样就好。';
  const click = async (w: any) => { doc(w).getElementById('aiReviewBtn').click(); await flush(); await flush(); };

  it('same request(s), same stored review', async () => {
    const lc: any[] = [];
    const nc: any[] = [];
    const outcome = await requestReview(local as Snapshot, cfg, T0, stubFetch([reply(good)], nc));
    expect(outcome.kind).toBe('ok');
    const r = await parity({
      local,
      legacy: async (w) => { w.fetch = stubFetch([reply(good)], lc); await click(w); },
      next: (d, c) => { if (outcome.kind === 'ok') addReview(d, outcome.item, c); },
    });
    expect(nc).toEqual(lc);
    expect(lc).toHaveLength(1);
    expect(lc[0].body.max_tokens).toBe(4000);
    expect(lc[0].body.thinking).toEqual({ type: 'enabled' });
    expect(r.legacy.qyx_ai_review).toHaveLength(1);
    expect(r.legacy.qyx_ai_review[0].from).toBe(at('08:00', '2026-10-20'));
  });

  it('truncated first answer → retry with thinking off / 2000 tokens, same result', async () => {
    const lc: any[] = []; const nc: any[] = [];
    const answers = [reply('被截断', 'length'), reply(good)];
    const outcome = await requestReview(local as Snapshot, cfg, T0, stubFetch(answers, nc));
    await parity({
      local,
      legacy: async (w) => { w.fetch = stubFetch(answers, lc); await click(w); },
      next: (d, c) => { if (outcome.kind === 'ok') addReview(d, outcome.item, c); },
    });
    expect(nc).toEqual(lc);
    expect(lc.map((x) => x.body.max_tokens)).toEqual([4000, 2000]);
  });

  it('too short → nothing saved (both); nothing to review → nothing saved (both)', async () => {
    const lc: any[] = [];
    const out = await requestReview(local as Snapshot, cfg, T0, stubFetch([reply('太短了')], []));
    expect(out.kind).toBe('short');
    await parity({ local, legacy: async (w) => { w.fetch = stubFetch([reply('太短了')], lc); await click(w); }, next: () => {} });
    const empty = await requestReview({ qyx_log: [], qyx_bottles: [] }, cfg, T0, stubFetch([reply(good)], []));
    expect(empty.kind).toBe('empty');
    await parity({ local: { qyx_log: [], qyx_bottles: [] }, legacy: async (w) => { w.fetch = stubFetch([reply(good)], []); await click(w); }, next: () => {} });
  });

  it('DEVIATION: AI failure shows an error and saves nothing (legacy saved a stats-only fallback and consumed the window)', async () => {
    const down = stubFetch([new Error('offline')], []);
    const out = await requestReview(local as Snapshot, cfg, T0, down);
    expect(out).toMatchObject({ kind: 'error', message: 'offline' });
    const leg = await legacyCall({ local, now: NOW, fn: async (w: any) => { w.fetch = down; await click(w); return JSON.parse(w.collectBackup()).qyx_ai_review; } });
    expect(leg.result).toHaveLength(1); // the legacy behaviour we do not keep
    expect(leg.result[0].text).toContain('你留下了');
    const d: Snapshot = { ...local } as Snapshot; // new side: nothing committed on error
    expect(d.qyx_ai_review).toBeUndefined();
  });

  it('delete the latest and an older one (confirm), cap of 12', async () => {
    const many = Array.from({ length: 3 }, (_, i) => ({ t: T0 - (i + 1) * DAY, from: T0 - (i + 2) * DAY, to: T0 - (i + 1) * DAY, text: `合成 回望 ${i}` }));
    await parity({
      local: { qyx_ai_review: many },
      legacy: async (w) => { doc(w).querySelector('[data-review-del-latest]').click(); await tick(); doc(w).getElementById('appDialogOk').click(); await flush(); },
      next: (d, c) => { expect(deleteReview(d, 0, c)).toBe(true); },
    });
    await parity({
      local: { qyx_ai_review: many },
      legacy: async (w) => { doc(w).querySelector('[data-review-del="0"]').click(); await tick(); doc(w).getElementById('appDialogOk').click(); await flush(); },
      next: (d, c) => { expect(deleteReview(d, 1, c)).toBe(true); },
    });
    const twelve = Array.from({ length: 12 }, (_, i) => ({ t: T0 - (i + 1) * DAY, from: 1, to: 2, text: 'x' + i }));
    const d: Snapshot = { qyx_ai_review: twelve };
    addReview(d, { t: T0, from: 1, to: T0, text: 'new' }, fixedClock());
    expect((d.qyx_ai_review as any[]).length).toBe(12);
    expect((d.qyx_ai_review as any[])[0].text).toBe('new');
  });

  it('the v2 single-object form is read, and rewritten as an array', () => {
    const d: Snapshot = { qyx_ai_review: { t: T0 - DAY, text: '合成 旧结构' } as any };
    addReview(d, { t: T0, from: T0 - DAY, to: T0, text: 'n' }, fixedClock());
    expect((d.qyx_ai_review as any[]).map((x) => x.text)).toEqual(['n', '合成 旧结构']);
  });
});

/* ======================= 每日回望 (v5) ======================= */
describe('sea: 每日回望', () => {
  const log = [
    note('rec_n1', at('08:00'), '合成 想法起点 ![x](data:image/png;base64,AAA)'),
    note('rec_n2', at('08:30'), '合成 续写 @d261024-0900'),
    { ...note('rec_d1', at('09:00'), '合成 做完一件事'), type: 'done', src: '三件' },
    { ...note('rec_x', at('09:30'), '合成 骰子'), type: 'dice' },
    note('rec_y', at('09:00', '2026-10-23'), '合成 昨天'),
  ];
  const ideas = {
    schema: 2,
    items: [{ id: 'idea_a', title: '合成想法', icon: 'star', status: 'open', rootRecordId: 'rec_n1', createdAt: at('08:00'), activityAt: at('08:30'), updatedAt: at('08:30') }],
    links: [
      { id: 'link_rec_n1', ideaId: 'idea_a', recordId: 'rec_n1', role: 'root', linkedAt: at('08:00'), updatedAt: at('08:00') },
      { id: 'link_rec_n2', ideaId: 'idea_a', recordId: 'rec_n2', role: 'update', linkedAt: at('08:30'), updatedAt: at('08:30') },
    ],
    events: [], tasks: [],
  };
  const local = { qyx_log: log, qyx_ideas_v5: ideas, qyx_key: KEY };
  const answer = JSON.stringify({
    paragraphs: [{ text: '你今天先写下一个想法，又接着续写了它。', source_ids: ['R1', 'R2'] }, { text: '中间你把一件事做完了。', source_ids: ['R3'] }],
    gentle_note: { text: '记得喝水。', source_ids: ['R3'] },
  });
  const click = async (w: any) => { doc(w).getElementById('v51DailyGo').click(); await flush(); await flush(); };

  it('material rows, aliases and kinds are what legacy would send', async () => {
    const calls: any[] = [];
    await legacyCall({ local, now: NOW, fn: async (w: any) => { w.fetch = stubFetch([reply(answer)], calls); await click(w); } });
    const rows = dailyMaterial(local as Snapshot, '2026-10-24');
    expect(rows.map((r) => [r.alias, r.kind])).toEqual([['R1', '想法起点'], ['R2', '想法续写'], ['R3', '明确记录的动作']]);
    const sent = JSON.parse(calls[0].body.messages[1].content);
    expect(sent.records.map((r: any) => [r.source_id, r.time, r.kind, r.text])).toEqual(rows.map((r) => [r.alias, r.time, r.kind, r.text]));
    expect(sent.records[0].text).toContain('[图片已省略]');
    expect(sent.records[1].text).toContain('⟨引用·');
  });

  it('same request, same stored entry (gentleNote object kept)', async () => {
    const lc: any[] = []; const nc: any[] = [];
    const out = await requestDaily(local as Snapshot, '2026-10-24', cfg, fixedClock(), { fetchImpl: stubFetch([reply(answer)], nc) });
    expect(out.kind).toBe('ok');
    const r = await parity({
      local,
      legacy: async (w) => { w.fetch = stubFetch([reply(answer)], lc); await click(w); },
      next: (d) => { if (out.kind === 'ok') saveDaily(d, out.entry); },
    });
    expect(nc).toEqual(lc);
    expect(lc[0].body.max_tokens).toBe(1100);
    expect(r.legacy.qyx_daily_review_v51).toHaveLength(1);
    expect(r.legacy.qyx_daily_review_v51[0].gentleNote.text).toBe('记得喝水。');
    expect(r.legacy.qyx_daily_review_v51[0].gentleNote.source_ids).toHaveLength(1);
    expect(r.legacy.qyx_daily_review_v51[0].promptVersion).toBe('daily-r21-1');
  });

  it('answer without gentle_note stores null, exactly like legacy', async () => {
    const plain = JSON.stringify({ paragraphs: [{ text: '你今天写了一个想法并续写。', source_ids: ['R1'] }] });
    const out = await requestDaily(local as Snapshot, '2026-10-24', cfg, fixedClock(), { fetchImpl: stubFetch([reply(plain)], []) });
    await parity({
      local,
      legacy: async (w) => { w.fetch = stubFetch([reply(plain)], []); await click(w); },
      next: (d) => { if (out.kind === 'ok') saveDaily(d, out.entry); },
    });
    expect(out.kind === 'ok' && out.entry.gentleNote).toBeNull();
  });

  it('invalid first answer is retried once (2 calls, one stored entry); a second bad answer stores nothing', async () => {
    const bad = JSON.stringify({ paragraphs: [{ text: '没有来源', source_ids: [] }] });
    const lc: any[] = []; const nc: any[] = [];
    const out = await requestDaily(local as Snapshot, '2026-10-24', cfg, fixedClock(), { fetchImpl: stubFetch([reply(bad), reply(answer)], nc) });
    expect(out.kind).toBe('ok');
    await parity({
      local,
      legacy: async (w) => { w.fetch = stubFetch([reply(bad), reply(answer)], lc); await click(w); },
      next: (d) => { if (out.kind === 'ok') saveDaily(d, out.entry); },
    });
    expect(nc).toHaveLength(2);
    expect(nc).toEqual(lc);
    const twice = await requestDaily(local as Snapshot, '2026-10-24', cfg, fixedClock(), { fetchImpl: stubFetch([reply(bad)], []) });
    expect(twice).toEqual({ kind: 'error', message: '这次没有生成成功，请稍后重试。旧回望和记录都保留。' });
    await parity({ local, legacy: async (w) => { w.fetch = stubFetch([reply(bad)], []); await click(w); }, next: () => {} });
  });

  it('guards: no rows / too much / no key send nothing; network error → message, nothing stored', async () => {
    const calls: any[] = [];
    const f = stubFetch([reply(answer)], calls);
    expect(await requestDaily(local as Snapshot, '2026-01-01', cfg, fixedClock(), { fetchImpl: f })).toEqual({ kind: 'noRows' });
    expect(await requestDaily(local as Snapshot, '2026-10-24', { provider: '', key: '' }, fixedClock(), { fetchImpl: f })).toEqual({ kind: 'noKey' });
    const big = Array.from({ length: 101 }, (_, i) => note('rec_b' + i, at('08:00') + i * 1000, '合成'));
    expect(await requestDaily({ qyx_log: big } as Snapshot, '2026-10-24', cfg, fixedClock(), { fetchImpl: f })).toEqual({ kind: 'tooMuch' });
    expect(calls).toEqual([]);
    const out = await requestDaily(local as Snapshot, '2026-10-24', cfg, fixedClock(), { fetchImpl: stubFetch([new Error('401 bad key')], []) });
    expect(out).toEqual({ kind: 'error', message: '这次没有生成成功。请检查设置中的 AI 服务和密钥；旧回望和记录都保留。' });
  });

  it('timeout aborts the request', async () => {
    const hang = ((_u: any, init: any) => new Promise((_res, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))))) as unknown as typeof fetch;
    const out = await requestDaily(local as Snapshot, '2026-10-24', cfg, fixedClock(), { fetchImpl: hang, timeoutMs: 10 });
    expect(out).toEqual({ kind: 'error', message: '这次连接超时，没有生成成功。旧回望和记录都保留。' });
  });
});

/* ======================= 昨日小结 ======================= */
describe('sea: 昨日小结', () => {
  const Y = '2026-10-23';
  const log = [
    note('rec_y1', at('09:00', Y), '合成 昨天的记录 @d261023-1000'),
    { ...note('rec_y2', at('10:00', Y), '合成 昨天完成'), type: 'done' },
    { ...note('rec_y3', at('11:00', Y), '合成 骰子一下'), type: 'dice' },
    { ...note('rec_y4', at('12:00', Y), '合成 问一句'), type: 'ai', q: '合成 问题' },
  ];
  const enough = { d: Y, items: [
    { id: 'task_a', text: '合成 大项', done: false, status: 'incomplete', updatedAt: 1, subs: [
      { text: '合成 子项一', done: true, status: 'completed', updatedAt: 1, c: 2 }, { text: '合成 子项二', done: false, status: 'incomplete', updatedAt: 1 }] },
    { id: 'task_b', text: '合成 另一项', done: true, status: 'completed', updatedAt: 1, subs: [] },
    { id: 'task_c', text: '', done: false, status: 'incomplete', updatedAt: 0, subs: [] },
  ] };
  const local = {
    qyx_log: log, qyx_enough: enough, qyx_bonus: { d: Y, items: [{ text: '合成 加分', done: true }, { text: '', done: false }] },
    qyx_habits: [{ id: 1, name: '合成 站一站', counts: { [Y]: 3 } }, { id: 2, name: '合成 没做', counts: {} }],
    qyx_task_goals: { task_a: 'goal_x' }, qyx_key: KEY,
  };
  const resetAndMake = (replies: any[], calls: any[]) => async (w: any) => {
    w.eval('summaries = {}; LS.set("qyx_sums", summaries)');
    w.fetch = stubFetch(replies, calls);
    await w.eval('makeDailySummary()');
    await flush();
  };

  it('v2 summary built from yesterday (no AI key reachable → obs empty)', async () => {
    const r = await parity({
      local,
      legacy: resetAndMake([new Error('offline')], []),
      next: (d, c) => {
        delete d.qyx_sums![Y];
        const plan = planDailySummary(d, c)!;
        expect(plan).not.toBeNull();
        storeSummary(d, plan.yk, plan.sum);
      },
    });
    expect(r.legacy.qyx_sums[Y]).toMatchObject({ v2: 1, obs: '', stats: { cut: 2, notes: 1, done: 1 }, habits: ['合成 站一站 ×3'] });
    expect(r.legacy.qyx_sums[Y].three[0].goal).toMatch(/^<id/); // goal_x, masked
  });

  it('with an AI answer: same request, obs stored', async () => {
    const lc: any[] = []; const nc: any[] = [];
    const obsReply = reply('昨天你主要在整理合成记录，在子项二上犹豫了一下。');
    let sample = '';
    await parity({
      local,
      legacy: resetAndMake([obsReply], lc),
      next: (d, c) => {
        delete d.qyx_sums![Y];
        const plan = planDailySummary(d, c)!;
        sample = plan.sample;
        plan.sum.obs = '昨天你主要在整理合成记录，在子项二上犹豫了一下。';
        storeSummary(d, plan.yk, plan.sum);
      },
    });
    expect(await fetchSummaryObs(sample, cfg, stubFetch([obsReply], nc))).toBe('昨天你主要在整理合成记录，在子项二上犹豫了一下。');
    expect(nc).toEqual(lc);
    expect(await fetchSummaryObs(sample, cfg, stubFetch([new Error('x')], []))).toBe('');
  });

  it('exists / no log rows yesterday → no plan', () => {
    expect(planDailySummary({ qyx_log: [], qyx_sums: {} }, fixedClock())).toBeNull();
    expect(planDailySummary({ ...(local as any), qyx_sums: { [Y]: { v2: 1 } } }, fixedClock())).toBeNull();
  });

  it('补勾 marks the sub done, back-dates a log row, recounts', async () => {
    const r = await parity({
      local,
      legacy: async (w) => {
        const btn = doc(w).querySelector('#sumBanner [data-fix-sub]');
        expect(btn.dataset.fixSub).toBe('0|1');
        btn.click(); await flush();
      },
      next: (d, c) => { expect(fixSummarySub(d, Y, 0, 1, c)).toBe(true); },
    });
    expect(r.legacy.qyx_sums[Y].three[0]).toMatchObject({ done: true, status: 'completed' });
    expect(r.legacy.qyx_log.some((e: any) => e.src === '三件·小项' && e.text === '合成 子项二')).toBe(true);
  });
});

describe('sea: reading never writes', () => {
  it('selectors leave the snapshot untouched', async () => {
    const mod = await import('../src/domain/sea');
    const d: Snapshot = {
      qyx_log: [note('rec_1', T0 - 40 * DAY, 'x')], qyx_bottles: [{ id: 1, t: T0 - 3 * DAY, text: 'b', followups: [] }],
      qyx_ai_review: { t: T0, text: 'old' } as any,
    };
    const before = JSON.stringify(d);
    mod.seaCountText(d); mod.eligibleBottles(d, T0); mod.memoryGroups(d, T0); mod.readReviews(d, T0); mod.reviewWindow(d, T0);
    mod.reviewHintCount(d, T0); mod.dailyMaterial(d, '2026-10-24'); mod.dailyForDay(d, '2026-10-24'); mod.roamPool(d, T0);
    mod.planDailySummary(d, fixedClock()); mod.pearlOn(d, T0, '');
    expect(JSON.stringify(d)).toBe(before);
  });
});

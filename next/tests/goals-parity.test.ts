/* 目标 page: every data write vs the legacy app. Run with TZ=Asia/Shanghai. Synthetic data only. */
// @ts-ignore plain ESM helper
import { legacyCall } from '../tools/legacy-oracle.mjs';
import { buildBackup } from '../src/core/backup';
import {
  addGoal, addHabit, addSplit, applySplitLines, deleteGoal, deleteHabit, deleteSplit, ensureMonth, renameGoal,
  renameHabit, renameSplit, setGoalTags, suggestSplits, tapHabit, tapSitReminder, toggleGoalDone, toggleSplit,
} from '../src/domain/goals';
import { addSubToItem, addToToday, planAddToToday } from '../src/domain/today';
import type { Snapshot } from '../src/core/types';
import { clone } from '../src/core/util';
import { actionParity, fixedClock, diffPaths, T0, NOW } from './helpers/parity';

const YM = '2026-10';
const tick = () => new Promise((r) => setTimeout(r, 0));
const flush = async () => { for (let i = 0; i < 4; i++) await tick(); };

/* ---- masking: ids/times that legitimately differ between the two clocks ---- */
function canon(b: any) {
  const sorted = (v: any): any => Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])])) : v;
  const tree = sorted(b);
  const re = /\b(?:goal|rec|daily|task|done)_[0-9a-z-]+/g;
  const ids = new Map<string, string>();
  const name = (m: string) => { if (!ids.has(m)) ids.set(m, '<id' + ids.size + '>'); return ids.get(m)!; };
  const seed = (v: any) => { // pass 1: ids that appear as values, in document order
    if (typeof v === 'string') { (v.match(re) || []).forEach(name); return; }
    if (Array.isArray(v)) v.forEach(seed); else if (v && typeof v === 'object') Object.keys(v).forEach((k) => seed(v[k]));
  };
  seed(tree);
  const out = JSON.parse(JSON.stringify(tree).replace(re, name), (_k, v) => (typeof v === 'number' && v >= T0 && v < T0 + 100_000 ? 0 : v));
  return out;
}
const mask = (b: any) => { const c = canon(b); for (const k of Object.keys(b)) delete b[k]; Object.assign(b, c); b.qyx_lastchange = undefined; };

const goal = (id: string, text: string, kind: 'goal' | 'watch', extra: any = {}) => ({ id, text, kind, done: false, splits: [], hist: [], ...extra });
const baseMonths = () => ({
  '2026-09': [
    goal('goal_p1', '合成 旧观察', 'watch', { splits: [{ text: '合成 旧小项', done: false }] }),
    goal('goal_p2', '合成 旧目标', 'goal', { done: true }),
  ],
  [YM]: [
    goal('goal_g1', '合成 目标一', 'goal', { splits: [{ text: '合成 小项甲', done: false }, { text: '合成 小项乙', done: true }], hist: [{ t: T0 - 1000, ev: '立下' }] }),
    goal('goal_w1', '合成 观察一', 'watch', { splits: [{ text: '合成 观察小项', done: false }] }),
  ],
});
const local = (extra: Record<string, unknown> = {}) => ({ qyx_months: baseMonths(), qyx_key: '"sk-synthetic"', ...extra });

/* ---- legacy DOM driving ---- */
const doc = (w: any) => w.document;
const cardOf = (w: any, text: string) => [...doc(w).querySelectorAll('#anchorList .anchor')].find((c: any) => c.querySelector('.txt').firstChild.textContent === text) as any;
const dialog = async (w: any, value?: string) => {
  await tick();
  if (value !== undefined) doc(w).getElementById('appDialogLine').value = value;
  doc(w).getElementById('appDialogOk').click();
  await flush();
};
const legacyAdd = async (w: any, text: string, kind: 'goal' | 'watch') => {
  doc(w).getElementById('anchorText').value = text;
  doc(w).getElementById(kind === 'goal' ? 'addGoal' : 'addWatch').click();
  await flush();
};

async function parity(opts: Parameters<typeof actionParity>[0]) {
  const r = await actionParity({ mask, ...opts });
  expect(r.errors).toEqual([]);
  expect(r.diffs).toEqual([]);
  return r;
}
const months = (d: Snapshot) => d.qyx_months![YM];
const G = (d: Snapshot, text: string) => months(d).find((a) => a.text === text)!;

describe('goals: month goals', () => {
  it('add a 观察位 / a 目标位 (and unbury a tombstoned text)', async () => {
    const dead = [{ s: 'anchor:' + YM, v: '合成 新目标', t: T0 - 5000 }];
    const r = await parity({
      local: local({ qyx_dead: dead }),
      legacy: async (w) => { await legacyAdd(w, '合成 新目标', 'goal'); await legacyAdd(w, '合成 新观察', 'watch'); },
      next: (d, c) => { addGoal(d, '合成 新目标', 'goal', c); addGoal(d, '合成 新观察', 'watch', c); },
    });
    expect(r.next.qyx_dead).toEqual([]);
    expect(r.legacy.qyx_months[YM].map((a: any) => a.text)).toEqual(['合成 目标一', '合成 观察一', '合成 新目标', '合成 新观察']);
  });

  it('refusals write nothing: duplicate, goal slots full, month full', async () => {
    const full = { ...baseMonths(), [YM]: Array.from({ length: 12 }, (_, i) => goal('goal_f' + i, '合成 满 ' + i, i < 1 ? 'goal' : 'watch')) };
    const r = await parity({
      local: { qyx_months: full },
      legacy: async (w) => { await legacyAdd(w, '合成 满 3', 'watch'); await legacyAdd(w, '合成 又一条', 'goal'); },
      next: (d, c) => {
        expect(addGoal(d, '合成 满 3', 'watch', c)).toEqual({ ok: false, reason: 'dup' });
        expect(addGoal(d, '合成 又一条', 'goal', c)).toEqual({ ok: false, reason: 'month-full' });
      },
    });
    expect(r.legacy.qyx_months[YM]).toHaveLength(12);
    const two = { ...baseMonths(), [YM]: [goal('goal_a', '甲', 'goal'), goal('goal_b', '乙', 'goal')] };
    const r2 = await parity({
      local: { qyx_months: two },
      legacy: async (w) => { await legacyAdd(w, '合成 第三个', 'goal'); },
      next: (d, c) => { expect(addGoal(d, '合成 第三个', 'goal', c)).toEqual({ ok: false, reason: 'goals-full' }); },
    });
    expect(r2.next.qyx_months[YM]).toHaveLength(2);
  });

  it('complete a goal → done log + hist; un-complete only flips the flag', async () => {
    const r1 = await parity({
      local: local(),
      legacy: async (w) => { w.Element.prototype.animate = () => ({}); cardOf(w, '合成 目标一').querySelector('.achk').click(); await flush(); },
      next: (d, c) => { expect(toggleGoalDone(d, 'goal_g1', c)).toBe(true); },
    });
    expect(r1.legacy.qyx_log.at(-1)).toMatchObject({ type: 'done', text: '合成 目标一', src: '月目标' });
    expect(r1.legacy.qyx_months[YM].find((a: any) => a.id === '<id0>' || a.text === '合成 目标一').hist.at(-1).ev).toBe('完成 ✓');
    await parity({
      local: { qyx_months: { [YM]: [goal('goal_g1', '合成 目标一', 'goal', { done: true })] } },
      legacy: async (w) => { cardOf(w, '合成 目标一').querySelector('.achk').click(); await flush(); },
      next: (d, c) => { expect(toggleGoalDone(d, 'goal_g1', c)).toBe(false); },
    });
  });

  it('rename a goal re-targets split tombstones (renameScope) and buries the old text', async () => {
    const dead = [
      { s: 'split:合成 目标一', v: '合成 已删小项', t: T0 - 9000 },
      { s: 'split:合成 新名字', v: '合成 已删小项', t: T0 - 8000 },
    ];
    const r = await parity({
      local: local({ qyx_dead: dead }),
      legacy: async (w) => { cardOf(w, '合成 目标一').querySelector('.edit').click(); await dialog(w, '合成 新名字'); },
      next: (d, c) => { expect(renameGoal(d, 'goal_g1', '合成 新名字', c)).toEqual({ ok: true }); },
    });
    expect(r.next.qyx_dead.filter((x: any) => x.s === 'split:合成 新名字')).toHaveLength(1);
  });

  it('rename to an existing name is refused', async () => {
    await parity({
      local: local(),
      legacy: async (w) => { cardOf(w, '合成 目标一').querySelector('.edit').click(); await dialog(w, '合成 观察一'); },
      next: (d, c) => { expect(renameGoal(d, 'goal_g1', '合成 观察一', c)).toEqual({ ok: false, reason: 'dup' }); },
    });
  });

  it('delete a goal: unlink tasks, drop tags, bury anchor + split texts', async () => {
    await parity({
      local: local({ qyx_goal_tags: { goal_g1: ['tag_x'] }, qyx_task_goals: { task_a: 'goal_g1', task_b: 'goal_w1' } }),
      legacy: async (w) => { cardOf(w, '合成 目标一').querySelector('.del').click(); await dialog(w); },
      next: (d, c) => { expect(deleteGoal(d, 'goal_g1', c)).toBe(true); },
    });
  });
});

describe('goals: splits', () => {
  const chip = (w: any, goalText: string, spText: string) =>
    [...cardOf(w, goalText).querySelectorAll('.split-chip')].find((c: any) => c.querySelector('.st').textContent === spText) as any;

  it('check a split → done log + hist; uncheck is silent', async () => {
    await parity({
      local: local(),
      legacy: async (w) => { chip(w, '合成 目标一', '合成 小项甲').querySelector('.chk').click(); chip(w, '合成 目标一', '合成 小项乙').querySelector('.chk').click(); await flush(); },
      next: (d, c) => { expect(toggleSplit(d, 'goal_g1', 0, c)).toBe(true); expect(toggleSplit(d, 'goal_g1', 1, c)).toBe(false); },
    });
  });

  it('add a split (unburies), rename a split, delete a split', async () => {
    const dead = [{ s: 'split:合成 目标一', v: '合成 手写小项', t: T0 - 5000 }];
    await parity({
      local: local({ qyx_dead: dead }),
      legacy: async (w) => {
        cardOf(w, '合成 目标一').querySelector('.split-add').click(); await dialog(w, '合成 手写小项');
        chip(w, '合成 目标一', '合成 小项甲').querySelector('.st').click(); await dialog(w, '合成 小项甲改');
        chip(w, '合成 目标一', '合成 小项乙').querySelector('.x').click(); await flush();
      },
      next: (d, c) => {
        expect(addSplit(d, 'goal_g1', '合成 手写小项', c)).toEqual({ ok: true });
        expect(renameSplit(d, 'goal_g1', 0, '合成 小项甲改', c)).toEqual({ ok: true });
        expect(deleteSplit(d, 'goal_g1', 1, c)).toBe(true);
      },
    });
  });

  it('renaming a split onto a sibling is refused', async () => {
    await parity({
      local: local(),
      legacy: async (w) => { chip(w, '合成 目标一', '合成 小项甲').querySelector('.st').click(); await dialog(w, '合成 小项乙'); },
      next: (d, c) => { expect(renameSplit(d, 'goal_g1', 0, '合成 小项乙', c)).toEqual({ ok: false, reason: 'dup' }); },
    });
  });

  it('a watch card has no check', () => {
    const d: Snapshot = { qyx_months: { [YM]: [goal('goal_w1', '观察', 'watch', { splits: [{ text: 'x', done: false }] })] } };
    expect(toggleSplit(d, 'goal_w1', 0, fixedClock())).toBeNull();
    expect(toggleGoalDone(d, 'goal_w1', fixedClock())).toBeNull();
  });
});

describe('goals: AI split (explicit tap, stubbed fetch)', () => {
  const reply = '1. 合成 甲\n- 合成 乙\n合成 小项甲\n\n* 合成 丙\n合成 丁\n合成 戊';
  const body = { choices: [{ message: { content: reply }, finish_reason: 'stop' }] };
  const stub = (calls: any[]) => (async (url: any, init: any) => { calls.push({ url: String(url), body: JSON.parse(init.body) }); return { json: async () => body }; }) as unknown as typeof fetch;

  it('same request, same stored splits (existing text skipped, cap respected, tombstone lifted)', async () => {
    const legacyCalls: any[] = [];
    const dead = [{ s: 'split:合成 目标一', v: '合成 甲', t: T0 - 5000 }];
    const nextCalls: any[] = [];
    const lines = await suggestSplits('合成 目标一', { provider: '', key: 'sk-synthetic' }, stub(nextCalls));
    expect(lines).toEqual(['合成 甲', '合成 乙', '合成 小项甲', '合成 丙', '合成 丁']);
    await parity({
      local: local({ qyx_dead: dead }),
      legacy: async (w) => {
        w.fetch = async (url: any, init: any) => { legacyCalls.push({ url: String(url), body: JSON.parse(init.body) }); return { json: async () => body }; };
        cardOf(w, '合成 目标一').querySelector('.split-btn').click();
        await flush(); await flush();
      },
      next: (d, c) => { expect(applySplitLines(d, 'goal_g1', lines, c)).toBe(4); },
    });
    expect(legacyCalls).toHaveLength(1);
    expect(nextCalls).toEqual(legacyCalls);
  });

  it('failure adds nothing and throws 没拆出来 for an empty answer', async () => {
    const empty = (async () => ({ json: async () => ({ choices: [{ message: { content: ' \n ' } }] }) })) as unknown as typeof fetch;
    await expect(suggestSplits('合成', { provider: '', key: 'k' }, empty)).rejects.toThrow('没拆出来');
    const down = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    await expect(suggestSplits('合成', { provider: '', key: 'k' }, down)).rejects.toThrow('offline');
  });

  it('deviation: a line repeated inside one answer is added once', () => {
    const d: Snapshot = { qyx_months: { [YM]: [goal('goal_g1', '合成 目标一', 'goal')] } };
    expect(applySplitLines(d, 'goal_g1', ['合成 甲', '合成 甲', '合成 乙'], fixedClock())).toBe(2);
    expect(d.qyx_months![YM][0].splits.map((x) => x.text)).toEqual(['合成 甲', '合成 乙']);
  });
});

describe('goals: tags', () => {
  it('关联标签 replaces the goal tag list and creates tag paths', async () => {
    await parity({
      local: local({ qyx_goal_tags: { goal_g1: ['tag_old'] } }),
      legacy: async (w) => { cardOf(w, '合成 目标一').querySelector('.tag-bind').click(); await dialog(w, '#合成/学习 #合成想法'); },
      next: (d, c) => { setGoalTags(d, 'goal_g1', '#合成/学习 #合成想法', c); },
      mask: (b) => { b.qyx_tags.forEach((t: any) => { if (t.created_time >= T0) t.created_time = t.updated_time = 0; }); mask(b); },
    });
  });

  it('empty input clears the list', async () => {
    await parity({
      local: local({ qyx_goal_tags: { goal_g1: ['tag_old'] } }),
      legacy: async (w) => { cardOf(w, '合成 目标一').querySelector('.tag-bind').click(); await dialog(w, ''); },
      next: (d, c) => { setGoalTags(d, 'goal_g1', '', c); },
    });
  });

  it('deviation: the first path revives a buried tag (legacy dropped it)', () => {
    const d: Snapshot = { qyx_dead: [{ s: 'tag', v: 'tag_' + 'x', t: 1 }] };
    // build the real id the same way ensureTagPath does
    const first = setGoalTags(d, 'g', '#合成旧标签', fixedClock());
    expect(first).toHaveLength(1);
    const dead = [{ s: 'tag', v: first[0], t: 1 }];
    const d2: Snapshot = { qyx_tags: d.qyx_tags, qyx_dead: dead };
    expect(setGoalTags(d2, 'g', '#合成旧标签', fixedClock())).toEqual(first);
    expect(d2.qyx_dead).toEqual([]);
  });
});

describe('goals: opening a new month (ensureMonth)', () => {
  it('carries last month 观察位 (and their tags) like monthAnchors(); goals do not carry', async () => {
    const seed = {
      qyx_months: { '2026-09': baseMonths()['2026-09'] },
      qyx_goal_tags: { goal_p1: ['tag_a'], goal_p2: ['tag_b'] },
      qyx_tags: [{ id: 'tag_a', name: 'a', parent_id: null, created_time: 1, updated_time: 1 }],
    };
    const leg = await legacyCall({ local: seed, now: NOW, fn: (w: any) => JSON.parse(w.collectBackup()) });
    const d: Snapshot = clone(seed) as Snapshot;
    ensureMonth(d, fixedClock());
    const next: any = buildBackup(d, 'x', new Date(0));
    expect(leg.errors).toEqual([]);
    const pick = (b: any) => canon({ m: b.qyx_months, g: b.qyx_goal_tags });
    expect(diffPaths(pick(leg.result), pick(next))).toEqual([]);
    expect(next.qyx_months[YM]).toHaveLength(1);
    expect(next.qyx_months[YM][0]).toMatchObject({ kind: 'watch', text: '合成 旧观察', carriedFrom: '2026-09', done: false });
  });

  it('does nothing when the month exists (even if empty) and never regrows', () => {
    const d: Snapshot = { qyx_months: { '2026-09': [goal('p', 'w', 'watch')], [YM]: [] } };
    expect(ensureMonth(d, fixedClock())).toBe(false);
    expect(d.qyx_months![YM]).toEqual([]);
  });

  it('year rollover looks at December', () => {
    const d: Snapshot = { qyx_months: { '2026-12': [goal('p', '年末观察', 'watch')] } };
    ensureMonth(d, fixedClock(Date.parse('2027-01-03T10:00:00+08:00')));
    expect(d.qyx_months!['2027-01'][0]).toMatchObject({ text: '年末观察', carriedFrom: '2026-12' });
  });
});

describe('goals: 排进今天', () => {
  const today = { d: '2026-10-24', items: [
    { id: 'task_1', text: '合成 一件', done: false, status: 'incomplete', updatedAt: 1, subs: [] },
    { id: 'task_2', text: '', done: false, status: 'incomplete', updatedAt: 0, subs: [] },
    { id: 'task_3', text: '', done: false, status: 'incomplete', updatedAt: 0, subs: [] },
  ] };
  const pick = async (w: any, label: string) => {
    await tick();
    const row = [...doc(w).querySelectorAll('#appDialogPick .pick-row')].find((r: any) => r.textContent.includes(label)) as any;
    row.click();
    doc(w).getElementById('appDialogOk').click();
    await flush();
  };
  const chipBtn = (w: any) => cardOf(w, '合成 目标一').querySelectorAll('.split-chip')[0].querySelector('.to-today');

  it('as a new top-level item, linked to the goal', async () => {
    await parity({
      local: local({ qyx_enough: today }),
      legacy: async (w) => { chipBtn(w).click(); await pick(w, '作为新的一件'); },
      next: (d, c) => { expect(addToToday(d, '合成 小项甲', 'goal_g1', c)).toBe('today'); },
    });
  });

  it('under an existing item', async () => {
    await parity({
      local: local({ qyx_enough: today }),
      legacy: async (w) => { chipBtn(w).click(); await pick(w, '放到「合成 一件」下面'); },
      next: (d, c) => { expect(addSubToItem(d, 0, '合成 小项甲', 'goal_g1', c)).toMatchObject({ noted: true, goalConflict: false }); },
    });
  });

  it('already there → plan says exists, nothing to write', () => {
    const d: Snapshot = { qyx_enough: clone(today) as any };
    expect(planAddToToday(d, '合成 一件', fixedClock()).r).toBe('exists');
    expect(planAddToToday(d, '合成 新的', fixedClock())).toMatchObject({ r: 'ask', canTop: true, parents: [{ i: 0, text: '合成 一件' }] });
  });
});

describe('goals: habits', () => {
  const habits = () => [{ id: 1700000000001, name: '合成 站起来', counts: { '2026-10-23': 2 }, updatedAt: T0 - 5000 }];
  const habitBtn = (w: any, name: string) => [...doc(w).querySelectorAll('#habitGrid .habit')].find((h: any) => h.querySelector('.hname').textContent === name) as any;

  it('add (unburies), tap, tap again', async () => {
    const dead = [{ s: 'habit', v: '合成 喝水', t: T0 - 1 }];
    await parity({
      local: { qyx_habits: habits(), qyx_dead: dead },
      legacy: async (w) => {
        doc(w).querySelector('#habitGrid .habit-add').click(); await dialog(w, '合成 喝水');
        habitBtn(w, '合成 站起来').click(); habitBtn(w, '合成 站起来').click(); await flush();
      },
      next: (d, c) => {
        expect(addHabit(d, '合成 喝水', c)).toEqual({ ok: true });
        tapHabit(d, 1700000000001, c); tapHabit(d, 1700000000001, c);
      },
    });
  });

  it('rename buries the old name and unburies the new; delete buries the name', async () => {
    await parity({
      local: { qyx_habits: habits(), qyx_dead: [{ s: 'habit', v: '合成 新名', t: T0 - 1 }] },
      legacy: async (w) => { habitBtn(w, '合成 站起来').querySelector('.hedit').click(); await dialog(w, '合成 新名'); },
      next: (d, c) => { renameHabit(d, 1700000000001, '合成 新名', c); },
    });
    await parity({
      local: { qyx_habits: habits() },
      legacy: async (w) => { habitBtn(w, '合成 站起来').querySelector('.hx').click(); await dialog(w); },
      next: (d, c) => { expect(deleteHabit(d, 1700000000001, c)).toBe(true); },
    });
  });

  it('久坐提醒 counts on the first matching habit, nothing without one', async () => {
    await parity({
      local: { qyx_habits: [{ id: 5, name: '喝水', counts: {}, updatedAt: 1 }, ...habits()] },
      legacy: async (w) => { doc(w).getElementById('habitReminderBtn').click(); await flush(); },
      next: (d, c) => { expect(tapSitReminder(d, c)).toBe(true); },
    });
    await parity({
      local: { qyx_habits: [{ id: 5, name: '喝水', counts: {}, updatedAt: 1 }] },
      legacy: async (w) => { doc(w).getElementById('habitReminderBtn').click(); await flush(); },
      next: (d, c) => { expect(tapSitReminder(d, c)).toBe(false); },
    });
  });

  it('limits: at most 3; rename onto another name refused; deviation: duplicate add refused', () => {
    const d: Snapshot = { qyx_habits: [
      { id: 1, name: 'a', counts: {} }, { id: 2, name: 'b', counts: {} }] };
    const c = fixedClock();
    expect(addHabit(d, 'b', c)).toEqual({ ok: false, reason: 'dup' });
    expect(addHabit(d, 'c', c)).toEqual({ ok: true });
    expect(addHabit(d, 'd', c)).toEqual({ ok: false, reason: 'full' });
    expect(renameHabit(d, 1, 'b', c)).toEqual({ ok: false, reason: 'dup' });
    expect(d.qyx_habits).toHaveLength(3);
  });
});

describe('goals: reading never writes', () => {
  it('selectors do not mutate the snapshot', async () => {
    const mod = await import('../src/domain/goals');
    const d: Snapshot = { qyx_months: baseMonths() as any, qyx_task_goals: {}, qyx_habits: [] };
    const before = JSON.stringify(d);
    const list = mod.monthGoals(d, '2026-11');
    mod.orderedGoals(mod.monthGoals(d, YM));
    mod.pastMonths(d, YM);
    mod.goalTrail(d, d.qyx_months![YM][0]);
    mod.goalTagPaths(d, 'goal_g1');
    mod.needsOpenWrite(d, fixedClock());
    expect(list).toEqual([]);
    expect(JSON.stringify(d)).toBe(before);
  });
});

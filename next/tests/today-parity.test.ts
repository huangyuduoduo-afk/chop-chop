/* 今天 page: every data write vs legacy. Run with TZ=Asia/Shanghai. */
import * as T from '../src/domain/today';
// @ts-ignore plain ESM helper
import { legacyCall } from '../tools/legacy-oracle.mjs';
import { actionParity, NOW, T0 } from './helpers/parity';

const clk = () => ({ now: () => T0, nonce: () => 'n' });

const D = '2026-10-24';
const item = (id: string, text = '', extra: Record<string, unknown> = {}) =>
  ({ id, text, done: false, status: 'incomplete', updatedAt: 0, subs: [], ...extra });
const sub = (text: string, extra: Record<string, unknown> = {}) => ({ text, done: false, status: 'incomplete', updatedAt: 0, ...extra });
const done = (extra: Record<string, unknown> = {}) => ({ done: true, status: 'completed', ...extra });
const rec = (id: string, text: string, src: string, type = 'done') =>
  ({ id, t: T0 - 60_000, updatedAt: T0 - 60_000, type, text, mood: null, src, q: null });
const enoughOf = (...items: any[]) => ({ d: D, items: [...items, ...Array(3 - items.length).fill(0).map((_, k) => item('blank' + k))] });

/* ---- legacy drivers ---- */
const tick = () => new Promise((r) => setTimeout(r, 0));
const type = (w: any, i: number, v: string) => {
  const inp = w.document.querySelector(`#enoughCard input[data-i="${i}"]`);
  inp.value = v; inp.dispatchEvent(new w.Event('input', { bubbles: true }));
};
const click = (w: any, sel: string) => { const el = w.document.querySelector(sel); if (!el) throw new Error('missing ' + sel); el.click(); };
const dialogLine = async (w: any, value: string) => { await tick(); w.document.getElementById('appDialogLine').value = value; w.document.getElementById('appDialogOk').click(); await tick(); };
const confirmDialog = async (w: any) => { await tick(); w.document.getElementById('appDialogOk').click(); await tick(); };

/**
 * Zero what legitimately differs: clocks, nonces, new ids. New log ids become <n1>,<n2>… in order and
 * are renamed in record_tags and `log` tombstones.
 */
function norm(b: any, seedIds: string[] = []) {
  const known = new Set(seedIds);
  let n = 0;
  const rename = new Map<string, string>();
  (b.qyx_log || []).forEach((e: any) => {
    if (known.has(e.id)) return;
    const id = '<n' + ++n + '>'; rename.set(e.id, id); e.id = id; e.t = e.updatedAt = 0;
  });
  if (b.qyx_record_tags) for (const [o, nw] of rename) if (o in b.qyx_record_tags) { b.qyx_record_tags[nw] = b.qyx_record_tags[o]; delete b.qyx_record_tags[o]; }
  (b.qyx_dead || []).forEach((d: any) => { d.t = 0; if (d.s === 'log' && rename.has(d.v)) d.v = rename.get(d.v); });
  for (const k of ['qyx_enough', 'qyx_enough_prev']) (b[k]?.items || []).forEach((i: any) => { i.updatedAt = 0; (i.subs || []).forEach((s: any) => { s.updatedAt = 0; }); });
  (b.qyx_opts_hist || []).forEach((h: any) => { if (h.t >= T0) h.t = 0; });
  if (b.qyx_opts_hist) b.qyx_opts_hist.sort((a: any, c: any) => (a.text < c.text ? -1 : 1));
  (b.qyx_tags || []).forEach((t: any) => { if (t.created_time >= T0) t.created_time = t.updated_time = 0; });
  delete b.qyx_lastchange;
  const ids = (b.qyx_ideas_v5?.items || []);
  ids.forEach((i: any) => { if (i.updatedAt >= T0) i.updatedAt = 0; if (i.statusUpdatedAt >= T0) i.statusUpdatedAt = 0; if (i.completedAt >= T0) i.completedAt = 0; });
  (b.qyx_ideas_v5?.tasks || []).forEach((t: any) => { if (t.updatedAt >= T0) t.updatedAt = 0; });
  (b.qyx_ideas_v5?.events || []).forEach((e: any) => { e.t = e.updatedAt = 0; e.id = '<ev>'; });
}

async function parity(local: Record<string, unknown>, legacy: (w: any) => unknown, next: (d: any, c: any) => unknown, extraMask?: (b: any) => void) {
  const seedIds = ((local.qyx_log as any[]) || []).map((e) => e.id);
  const r = await actionParity({
    local, legacy, next,
    mask: (b) => { norm(b, seedIds); extraMask?.(b); },
  });
  expect(r.errors).toEqual([]);
  return r;
}

describe('三件事 text / status', () => {
  const local = { qyx_enough: enoughOf(item('t1', '合成 一'), item('t2', '合成 二', done()), item('t3')), qyx_log: [rec('d_t2', '合成 二', '三件')] };

  it('type text into a blank row', async () => {
    const r = await parity(local, (w) => type(w, 2, '合成 新事'), (d, c) => T.setEnoughText(d, 2, '合成 新事', c));
    expect(r.diffs).toEqual([]);
  });
  it('edit text of an incomplete row', async () => {
    const r = await parity(local, (w) => type(w, 0, '合成 改'), (d, c) => T.setEnoughText(d, 0, '合成 改', c));
    expect(r.diffs).toEqual([]);
  });
  it('clearing a completed row removes its done log + subs', async () => {
    const r = await parity(local, (w) => type(w, 1, ''), (d, c) => T.setEnoughText(d, 1, '', c));
    expect(r.diffs).toEqual([]);
    expect(r.next.qyx_log).toEqual([]);
  });
  it('circle completes: done log, no subs', async () => {
    const r = await parity(local, (w) => click(w, '#enoughCard .ecirc[data-i="0"]'), (d, c) => T.toggleEnough(d, 0, c));
    expect(r.diffs).toEqual([]);
    expect(r.next.qyx_log.some((e: any) => e.src === '三件' && e.text === '合成 一')).toBe(true);
  });
  it('circle un-completes: done log removed + tombstone', async () => {
    const r = await parity(local, (w) => click(w, '#enoughCard .ecirc[data-i="1"]'), (d, c) => T.toggleEnough(d, 1, c));
    expect(r.diffs).toEqual([]);
    expect(r.next.qyx_dead.some((x: any) => x.s === 'log')).toBe(true);
  });
  it('circle on a blank row does nothing', async () => {
    const r = await parity(local, (w) => click(w, '#enoughCard .ecirc[data-i="2"]'), (d, c) => T.toggleEnough(d, 2, c));
    expect(r.diffs).toEqual([]);
  });
  it('circle on a row with subs only syncs the parent', async () => {
    const l = { ...local, qyx_enough: enoughOf(item('t1', '合成 一', { subs: [sub('合成 小')] })) };
    const r = await parity(l, (w) => click(w, '#enoughCard .ecirc[data-i="0"]'), (d, c) => T.toggleEnough(d, 0, c));
    expect(r.diffs).toEqual([]);
  });
  it('expired status round-trips (setEnoughStatus)', async () => {
    const r = await parity(local, (w) => w.eval('setEnoughStatus(0,"expired")'), (d, c) => T.setEnoughStatus(d, 0, 'expired', c));
    expect(r.diffs).toEqual([]);
  });
});

describe('三件事 delete', () => {
  const local = {
    qyx_enough: enoughOf(item('t1', '合成 一', { subs: [sub('合成 小a'), sub('合成 小b')], status: 'incomplete' })),
    qyx_task_tags: { t1: ['tag_x'] }, qyx_task_goals: { t1: 'g1' },
  };
  it('delete buries subs, clears tags / goal, keeps text', async () => {
    const r = await parity(local, async (w) => { click(w, '#enoughCard [data-task-action="delete"][data-i="0"]'); await confirmDialog(w); },
      (d, c) => T.deleteEnough(d, 0, c));
    expect(r.diffs).toEqual([]);
    expect(r.next.qyx_enough.items[0]).toMatchObject({ status: 'deleted', text: '合成 一', subs: [] });
    expect(r.next.qyx_task_goals.t1).toBeNull();
  });
});

describe('小项', () => {
  const base = enoughOf(item('t1', '合成 一', { subs: [sub('合成 小a'), sub('合成 小b', done({ updatedAt: 1 }))] }));
  const local = { qyx_enough: base, qyx_log: [rec('d_sb', '合成 小b', '三件·小项')] };
  const chip = (si: number, sel: string) => `#enoughCard .esubs[data-i="0"] .esub:nth-child(${si + 1}) ${sel}`;

  it('add one typed sub (拆小项)', async () => {
    const r = await parity(local, async (w) => { click(w, '#enoughCard .esub-add[data-i="0"]'); await dialogLine(w, '合成 小c'); },
      (d, c) => T.addSubs(d, 0, ['合成 小c'], c));
    expect(r.diffs).toEqual([]);
  });
  it('add skips duplicates and unburies', async () => {
    const l = { ...local, qyx_dead: [{ s: 'esub:' + D, v: '合成 小c', t: 5 }] };
    const r = await parity(l, async (w) => { click(w, '#enoughCard .esub-add[data-i="0"]'); await dialogLine(w, '合成 小c'); },
      (d, c) => T.addSubs(d, 0, ['合成 小c', '合成 小a'], c));
    expect(r.diffs).toEqual([]);
    expect(r.next.qyx_dead.some((x: any) => x.s === 'esub:' + D)).toBe(false);
  });
  it('check: incomplete -> completed (done log)', async () => {
    const r = await parity(local, (w) => click(w, chip(0, '.chk')), (d, c) => T.cycleSub(d, 0, 0, c));
    expect(r.diffs).toEqual([]);
  });
  it('check: completed -> expired (log removed)', async () => {
    const r = await parity(local, (w) => click(w, chip(1, '.chk')), (d, c) => T.cycleSub(d, 0, 1, c));
    expect(r.diffs).toEqual([]);
  });
  it('check: expired -> incomplete', async () => {
    const l = { qyx_enough: enoughOf(item('t1', '合成 一', { subs: [sub('合成 小a', { status: 'expired' })] })) };
    const r = await parity(l, (w) => click(w, chip(0, '.chk')), (d, c) => T.cycleSub(d, 0, 0, c));
    expect(r.diffs).toEqual([]);
  });
  it('再做一次 twice builds ×2 / ×3 done logs', async () => {
    const r = await parity(local, (w) => { click(w, chip(1, '.splus')); click(w, chip(1, '.splus')); },
      (d, c) => { T.subAgain(d, 0, 1, c); T.subAgain(d, 0, 1, c); });
    expect(r.diffs).toEqual([]);
    expect(r.next.qyx_log.map((e: any) => e.src)).toEqual(expect.arrayContaining(['三件·小项', '三件·小项 ×2', '三件·小项 ×3']));
  });
  it('×N minus one', async () => {
    const l = { qyx_enough: base, qyx_log: [rec('d1', '合成 小b', '三件·小项'), rec('d2', '合成 小b', '三件·小项 ×2')] };
    const r = await parity(l, (w) => click(w, chip(1, '.scnt')), (d, c) => T.subMinus(d, 0, 1, c));
    expect(r.diffs).toEqual([]);
  });
  it('unchecking a ×3 sub removes all its logs', async () => {
    const l = { qyx_enough: base, qyx_log: [rec('d1', '合成 小b', '三件·小项'), rec('d2', '合成 小b', '三件·小项 ×2'), rec('d3', '合成 小b', '三件·小项 ×3')] };
    const r = await parity(l, (w) => click(w, chip(1, '.chk')), (d, c) => T.cycleSub(d, 0, 1, c));
    expect(r.diffs).toEqual([]);
    expect(r.next.qyx_log).toEqual([]);
  });
  it('edit sub text of a completed sub', async () => {
    const r = await parity(local, async (w) => { click(w, chip(1, '.stx')); await dialogLine(w, '合成 小b2'); },
      (d, c) => T.editSub(d, 0, 1, '合成 小b2', c));
    expect(r.diffs).toEqual([]);
  });
  it('remove sub', async () => {
    const r = await parity(local, (w) => click(w, chip(0, '.x')), (d, c) => T.removeSub(d, 0, 0, c));
    expect(r.diffs).toEqual([]);
  });
  it('sub -> 打转区 (交给随机)', async () => {
    const r = await parity(local, (w) => click(w, chip(0, '.todice')), (d, c) => T.subToOpts(d, 0, 0, c));
    expect(r.diffs).toEqual([]);
  });
});

describe('day rollover (ensureEnough)', () => {
  const yesterday = '2026-10-23';
  const old = {
    d: yesterday,
    items: [
      item('o1', '合成 昨一', { subs: [sub('合成 没做完'), sub('合成 做完了', done()), sub('合成 过期', { status: 'expired' }), sub('合成 被删', {})] }),
      item('o2', '合成 昨二', { status: 'deleted' }),
      item('o3', ''),
    ],
  };
  const local = { qyx_enough: old, qyx_dead: [{ s: 'esub:' + yesterday, v: '合成 被删', t: 5 }] };
  it('rolls over: prev, harvest into opts_hist, fresh three', async () => {
    const r = await parity(local, (w) => w.eval('ensureEnough()'), (d, c) => T.ensureEnough(d, c),
      (b) => { b.qyx_enough.items.forEach((i: any) => { i.id = '<id>'; }); });
    expect(r.diffs).toEqual([]);
    expect(r.next.qyx_enough_prev.d).toBe(yesterday);
    expect(r.next.qyx_opts_hist.map((h: any) => h.text).sort()).toEqual(['合成 没做完', '合成 过期']);
  });
  it('an all-empty previous day leaves qyx_enough_prev alone', async () => {
    const l = { qyx_enough: { d: yesterday, items: [item('a'), item('b'), item('c')] }, qyx_enough_prev: { d: '2026-10-20', items: [item('p', '合成 更早')] } };
    const r = await parity(l, (w) => w.eval('ensureEnough()'), (d, c) => T.ensureEnough(d, c), (b) => { b.qyx_enough.items.forEach((i: any) => { i.id = '<id>'; }); });
    expect(r.diffs).toEqual([]);
    expect(r.next.qyx_enough_prev.d).toBe('2026-10-20');
  });
  it('no stored data at all: three blanks', async () => {
    const r = await parity({}, (w) => w.eval('ensureEnough(); saveEnough()'), (d, c) => T.ensureEnough(d, c), (b) => { b.qyx_enough.items.forEach((i: any) => { i.id = '<id>'; }); });
    expect(r.diffs).toEqual([]);
  });
});

describe('goal / tags binding', () => {
  const months = { '2026-10': [{ id: 'g1', text: '合成 目标', kind: 'goal', done: false, splits: [], hist: [] }] };
  it('bind goal (number 1) writes qyx_task_goals', async () => {
    const l = { qyx_enough: enoughOf(item('t1', '合成 一')), qyx_months: months };
    const r = await parity(l, async (w) => { click(w, '#enoughCard [data-task-goal="0"]'); await dialogLine(w, '1'); },
      (d, c) => { T.ensureMonthAnchors(d, c); T.setTaskGoal(d, 't1', T.goalsOfMonth(d, c)[0].id); });
    expect(r.diffs).toEqual([]);
  });
  it('unbind goal (0)', async () => {
    const l = { qyx_enough: enoughOf(item('t1', '合成 一')), qyx_months: months, qyx_task_goals: { t1: 'g1' } };
    const r = await parity(l, async (w) => { click(w, '#enoughCard [data-task-goal="0"]'); await dialogLine(w, '0'); },
      (d) => T.setTaskGoal(d, 't1', null));
    expect(r.diffs).toEqual([]);
  });
  it('bind tags creates the tag chain and replaces', async () => {
    const l = { qyx_enough: enoughOf(item('t1', '合成 一')), qyx_task_tags: { t1: ['tag_old'] } };
    const r = await parity(l, async (w) => { click(w, '#enoughCard [data-task-tag="0"]'); await dialogLine(w, '#生活/做饭 #想法'); },
      (d, c) => T.setTaskTags(d, 't1', ['生活/做饭', '想法'], c));
    expect(r.diffs).toEqual([]);
  });
  it('lazily creates the month carrying 观察位', async () => {
    const l = { qyx_enough: enoughOf(item('t1', '合成 一')), qyx_months: { '2026-09': [{ id: 'w1', text: '合成 观察', kind: 'watch', done: false, splits: [{ text: '合成 步', done: true }], hist: [] }] }, qyx_goal_tags: { w1: ['tag_a'] } };
    const r = await parity(l, async (w) => { click(w, '#enoughCard [data-task-goal="0"]'); await tick(); w.document.getElementById('appDialogCancel').click(); await tick(); },
      (d, c) => { T.ensureMonthAnchors(d, c); },
      (b) => { b.qyx_months['2026-10'].forEach((a: any) => { delete b.qyx_goal_tags[a.id]; a.id = '<id>'; }); });
    expect(r.diffs).toEqual([]);
  });
});

describe('add to today', () => {
  it('addToToday into the first free slot with a goal', async () => {
    const l = { qyx_enough: enoughOf(item('t1', '合成 一'), item('t2', '合成 二', { status: 'deleted' })) };
    const r = await parity(l, (w) => w.eval('addToToday("合成 新", "g9")'), (d, c) => T.addToToday(d, '合成 新', 'g9', c));
    expect(r.diffs).toEqual([]);
    expect(r.next.qyx_enough.items[1].text).toBe('合成 新');
  });
  it('exists / full', async () => {
    const l = { qyx_enough: enoughOf(item('t1', '合成 一'), item('t2', '合成 二'), item('t3', '合成 三')) };
    const r = await parity(l, (w) => { w.eval('addToToday("合成 一")'); w.eval('addToToday("合成 四")'); }, (d, c) => { T.addToToday(d, '合成 一', null, c); T.addToToday(d, '合成 四', null, c); });
    expect(r.diffs).toEqual([]);
  });
  it('as a sub of a row, goal carried to the parent', async () => {
    const l = { qyx_enough: enoughOf(item('t1', '合成 一', done())) };
    const r = await parity(l, async (w) => {
      const p = w.eval('addToTodaySmart("合成 小新", "g9")'); await tick();
      w.document.querySelector('#appDialogPick [data-pick="1"]').click();
      await p;
    }, (d, c) => { T.addSubToItem(d, 0, '合成 小新', 'g9', c); });
    expect(r.diffs).toEqual([]);
  });
  it('planAddToToday decisions', () => {
    const s: any = { qyx_enough: enoughOf(item('t1', '合成 一', { subs: [sub('合成 小')] })) };
    const c = { now: () => T0, nonce: () => 'n' };
    expect(T.planAddToToday(s, '合成 一', c).r).toBe('exists');
    expect(T.planAddToToday(s, '合成 小', c).r).toBe('exists');
    expect(T.planAddToToday(s, '合成 新', c)).toMatchObject({ r: 'ask', canTop: true, parents: [{ i: 0, text: '合成 一' }] });
    expect(T.planAddToToday({ qyx_enough: enoughOf() } as any, '合成 新', c).r).toBe('direct');
  });
});

describe('抽屉 / 常规', () => {
  const opened = (w: any, sel: string) => { click(w, sel); };
  it('seed drawers from recent summaries (first run)', async () => {
    const l = {
      qyx_enough: enoughOf(item('t1', '合成 在用')),
      qyx_sums: { '2026-10-23': { three: [{ text: '合成 在用' }, { text: '合成 昨一' }] }, '2026-10-20': { three: [{ text: '合成 前一' }] }, '2026-08-01': { three: [{ text: '合成 太旧' }] } },
    };
    const r = await parity(l, (w) => w.eval('ensureDrawers()'), (d, c) => T.ensureDrawers(d, c),
      (b) => { (b.qyx_drawers || []).forEach((x: any) => { x.id = '<id>'; x.updatedAt = 0; }); });
    expect(r.diffs).toEqual([]);
    expect(r.next.qyx_drawers.map((x: any) => x.text)).toEqual(['合成 昨一', '合成 前一']);
  });
  it('add / edit / remove drawer', async () => {
    const l = { qyx_enough: enoughOf(), qyx_drawers: [{ id: 'dr1', text: '合成 抽屉', updatedAt: 1 }] };
    const mask = (b: any) => { (b.qyx_drawers || []).forEach((x: any) => { if (x.id !== 'dr1') x.id = '<id>'; x.updatedAt = 0; }); (b.qyx_dead || []).forEach((x: any) => { x.v = x.v === 'dr1' ? x.v : '<id>'; }); };
    let r = await parity(l, async (w) => { opened(w, '#drawerAdd'); await dialogLine(w, '合成 新抽屉'); }, (d, c) => T.addDrawer(d, '合成 新抽屉', c), mask);
    expect(r.diffs).toEqual([]);
    r = await parity(l, async (w) => { opened(w, '[data-drawer-edit="dr1"]'); await dialogLine(w, '合成 改名'); }, (d, c) => T.editDrawer(d, 'dr1', '合成 改名', c), mask);
    expect(r.diffs).toEqual([]);
    r = await parity(l, (w) => opened(w, '[data-drawer-remove="dr1"]'), (d, c) => T.removeDrawer(d, 'dr1', c), mask);
    expect(r.diffs).toEqual([]);
  });
  it('use a drawer = typing into the first empty row', async () => {
    const l = { qyx_enough: enoughOf(item('t1', '合成 一')), qyx_drawers: [{ id: 'dr1', text: '合成 抽屉', updatedAt: 1 }] };
    const r = await parity(l, (w) => opened(w, '[data-drawer-use="dr1"]'), (d, c) => T.useDrawer(d, '合成 抽屉', c));
    expect(r.diffs).toEqual([]);
  });
  it('add / remove routine', async () => {
    const l = { qyx_enough: enoughOf(), qyx_routines: [{ id: 'ro1', text: '合成 常规', updatedAt: 1 }] };
    const mask = (b: any) => { (b.qyx_routines || []).forEach((x: any) => { if (x.id !== 'ro1') x.id = '<id>'; x.updatedAt = 0; }); (b.qyx_dead || []).forEach((x: any) => { x.v = x.v === 'ro1' ? x.v : '<id>'; }); };
    let r = await parity(l, async (w) => { opened(w, '#routineAdd'); await dialogLine(w, '合成 新常规'); }, (d, c) => T.addRoutine(d, '合成 新常规', c), mask);
    expect(r.diffs).toEqual([]);
    r = await parity(l, (w) => opened(w, '[data-routine-remove="ro1"]'), (d, c) => T.removeRoutine(d, 'ro1', c), mask);
    expect(r.diffs).toEqual([]);
  });
});

describe('打转区 / 待选 / 定过的', () => {
  const l = { qyx_enough: enoughOf(), qyx_opts: ['合成 甲', '合成 乙'], qyx_bench: ['合成 丙'], qyx_dead: [{ s: 'opt', v: '合成 新', t: 5 }] };
  const type_opt = (w: any, v: string) => { w.document.getElementById('optText').value = v; click(w, '#addOpt'); };
  it('add to opts: unburies, remembers', async () => {
    const r = await parity(l, (w) => type_opt(w, '合成 新'), (d, c) => T.addToOpts(d, '合成 新', c));
    expect(r.diffs).toEqual([]);
    expect(r.next.qyx_dead.some((x: any) => x.s === 'opt')).toBe(false);
  });
  it('duplicate is a no-op (but still unburies)', async () => {
    const r = await parity({ ...l, qyx_dead: [{ s: 'opt', v: '合成 甲', t: 5 }] }, (w) => type_opt(w, '合成 甲'), (d, c) => T.addToOpts(d, '合成 甲', c));
    expect(r.diffs).toEqual([]);
  });
  it('full 打转区 overflows to bench', async () => {
    const nine = Array.from({ length: 9 }, (_, i) => '合成 满' + i);
    const r = await parity({ ...l, qyx_opts: nine }, (w) => type_opt(w, '合成 新'), (d, c) => T.addToOpts(d, '合成 新', c));
    expect(r.diffs).toEqual([]);
    expect(r.next.qyx_bench).toContain('合成 新');
  });
  it('⌄ bench it', async () => {
    const r = await parity(l, (w) => click(w, '#optChips .opt-chip:nth-child(1) .bench-it'), (d) => T.benchOpt(d, '合成 甲'));
    expect(r.diffs).toEqual([]);
  });
  it('✕ remove from opts buries', async () => {
    const r = await parity(l, (w) => click(w, '#optChips .opt-chip:nth-child(2) .x'), (d, c) => T.removeOpt(d, '合成 乙', c));
    expect(r.diffs).toEqual([]);
  });
  it('⌃ back from bench / ✕ remove from bench', async () => {
    let r = await parity(l, (w) => click(w, '#benchChips .bench-chip .up'), (d) => T.benchBack(d, '合成 丙'));
    expect(r.diffs).toEqual([]);
    r = await parity(l, (w) => click(w, '#benchChips .bench-chip .x'), (d, c) => T.removeBench(d, '合成 丙', c));
    expect(r.diffs).toEqual([]);
  });
  it('⌃ refuses when full', async () => {
    const nine = Array.from({ length: 9 }, (_, i) => '合成 满' + i);
    const r = await parity({ ...l, qyx_opts: nine }, (w) => click(w, '#benchChips .bench-chip .up'), (d) => T.benchBack(d, '合成 丙'));
    expect(r.diffs).toEqual([]);
  });
  it('complete ongoing: ✓ buries + done log', async () => {
    const o = { qyx_enough: enoughOf(), qyx_ongoing: [{ id: 111, t: T0 - 5, text: '合成 定' }, { id: 222, t: T0 - 9, text: '合成 另一' }] };
    const r = await parity(o, (w) => click(w, '#ongoingChips .ongoing-chip:nth-child(1) .done'), (d, c) => T.completeOngoing(d, 111, c));
    expect(r.diffs).toEqual([]);
  });
  it('resume ongoing = addToOpts', async () => {
    const o = { qyx_enough: enoughOf(), qyx_ongoing: [{ id: 111, t: T0 - 5, text: '合成 定' }] };
    const r = await parity(o, (w) => click(w, '#ongoingChips .ongoing-chip'), (d, c) => T.addToOpts(d, '合成 定', c));
    expect(r.diffs).toEqual([]);
  });
});

describe('dice', () => {
  it('accept (就这个): log + opts + ongoing; only the F1 tombstone differs', async () => {
    const l = { qyx_enough: enoughOf(), qyx_opts: ['合成 甲', '合成 乙'], qyx_ongoing: [{ id: 5, t: T0 - 5, text: '合成 旧' }] };
    const r = await parity(l, (w) => { w.eval('lastDice={text:"合成 甲",from:"opts"}'); click(w, '#acceptDice'); },
      (d, c) => T.acceptDice(d, '合成 甲', c),
      (b) => { b.qyx_ongoing.forEach((o: any) => { if (o.id >= T0) o.id = o.t = 0; }); });
    // legacy leaves no `opt` tombstone; next buries it (fix F1) — everything else must match
    expect(r.diffs.filter((x) => !x.includes('qyx_dead'))).toEqual([]);
    expect(r.next.qyx_dead.filter((x: any) => x.s === 'opt')).toHaveLength(1);
    expect((r.legacy.qyx_dead || []).filter((x: any) => x.s === 'opt')).toHaveLength(0);
  });
  it('accept micro action = dice log only', async () => {
    const r = await parity({ qyx_enough: enoughOf() }, (w) => { w.eval('lastMicro="去洗头"'); click(w, '#acceptMicro'); }, (d, c) => T.acceptMicro(d, '去洗头', c));
    expect(r.diffs).toEqual([]);
  });
  it('microPool = dice pool + this month splits', async () => {
    const local = { qyx_enough: enoughOf(), qyx_dice: ['合成 动作'], qyx_months: { '2026-10': [{ id: 'g', text: 'x', kind: 'goal', done: false, splits: [{ text: '合成 拆', done: false }, { text: '合成 动作', done: true }], hist: [] }], '2026-09': [{ id: 'h', text: 'y', kind: 'goal', done: false, splits: [{ text: '合成 上月', done: false }], hist: [] }] } };
    const legacy = (await legacyCall({ local, now: NOW, fn: (w: any) => w.eval('microPool()') })).result;
    expect(T.microPool(local as any, clk())).toEqual(legacy);
    expect(legacy).toEqual(['合成 动作', '合成 拆']);
    // never saved: the 8 defaults are the pool
    const d0 = (await legacyCall({ local: { qyx_enough: enoughOf() }, now: NOW, fn: (w: any) => w.eval('microPool()') })).result;
    expect(T.microPool({} as any, clk())).toEqual(d0);
  });
});

describe('Bonus', () => {
  const bonus = { d: D, items: [{ text: '合成 奖励', done: false }, { text: '', done: false }] };
  it('type + toggle on logs a bonus record each time', async () => {
    const anim = (w: any) => { w.HTMLElement.prototype.animate = () => ({}); };
    let r = await parity({ qyx_enough: enoughOf(), qyx_bonus: bonus }, (w) => { const i = w.document.querySelector('#bonusCard input[data-b="1"]'); i.value = '合成 二'; i.dispatchEvent(new w.Event('input')); }, (d, c) => T.setBonusText(d, 1, '合成 二', c));
    expect(r.diffs).toEqual([]);
    r = await parity({ qyx_enough: enoughOf(), qyx_bonus: bonus }, (w) => { anim(w); click(w, '#bonusCard .bcirc[data-b="0"]'); }, (d, c) => T.toggleBonus(d, 0, c));
    expect(r.diffs).toEqual([]);
    expect(r.next.qyx_log.filter((e: any) => e.type === 'bonus')).toHaveLength(1);
    r = await parity({ qyx_enough: enoughOf(), qyx_bonus: { ...bonus, items: [{ text: '合成 奖励', done: true }, bonus.items[1]] } }, (w) => click(w, '#bonusCard .bcirc[data-b="0"]'), (d, c) => T.toggleBonus(d, 0, c));
    expect(r.diffs).toEqual([]);
    expect(r.next.qyx_log).toEqual([]);
  });
  it('blank bonus circle does nothing', async () => {
    const r = await parity({ qyx_enough: enoughOf(), qyx_bonus: bonus }, (w) => click(w, '#bonusCard .bcirc[data-b="1"]'), (d, c) => T.toggleBonus(d, 1, c));
    expect(r.diffs).toEqual([]);
  });
  it('rollover keeps yesterday in qyx_bonus_prev', async () => {
    const old = { d: '2026-10-23', items: [{ text: '合成 昨', done: true }, { text: '', done: false }] };
    const r = await parity({ qyx_enough: enoughOf(), qyx_bonus: old }, (w) => w.eval('ensureBonus()'), (d, c) => T.ensureBonus(d, c));
    expect(r.diffs).toEqual([]);
    expect(r.next.qyx_bonus_prev).toEqual(old);
  });
  it('rollover with an empty bonus leaves prev alone', async () => {
    const r = await parity({ qyx_enough: enoughOf(), qyx_bonus: { d: '2026-10-23', items: [{ text: '', done: false }, { text: '', done: false }] } }, (w) => w.eval('ensureBonus()'), (d, c) => T.ensureBonus(d, c));
    expect(r.diffs).toEqual([]);
  });
});

describe('往日写过的事项', () => {
  const hist = [{ t: T0 - 86400000, text: '合成 昨日' }, { t: T0 - 2 * 86400000, text: '合成 前日' }];
  const l = { qyx_enough: enoughOf(), qyx_opts_hist: hist };
  const key = (h: any) => h.t + '|' + h.text;
  it('edit text buries old key', async () => {
    const r = await parity(l, async (w) => { click(w, `[data-ohist-edit="${key(hist[0])}"]`); await dialogLine(w, '合成 改写'); }, (d, c) => T.editOptsHist(d, key(hist[0]), '合成 改写', c));
    expect(r.diffs).toEqual([]);
  });
  it('✕ remove', async () => {
    const r = await parity(l, (w) => click(w, `[data-ohist-remove="${key(hist[1])}"]`), (d, c) => T.removeOptsHist(d, key(hist[1]), c));
    expect(r.diffs).toEqual([]);
  });
  it('past list filtering matches legacy', async () => {
    const full = {
      qyx_enough: enoughOf(item('t1', '合成 在用', { subs: [sub('合成 小在用')] })),
      qyx_opts: ['合成 在打转'], qyx_bench: ['合成 在待选'], qyx_routines: [{ id: 'r', text: '合成 常规', updatedAt: 1 }],
      qyx_log: [rec('dd', '合成 做过', '定过的')],
      qyx_dead: [{ s: 'ohist', v: `${T0 - 3 * 86400000}|合成 被删`, t: 1 }],
      qyx_opts_hist: ['合成 在用', '合成 小在用', '合成 在打转', '合成 在待选', '合成 常规', '合成 做过', '合成 被删', '合成 留下', '合成 留下', '合成 今天'].map((text, i) => ({ t: text === '合成 被删' ? T0 - 3 * 86400000 : text === '合成 今天' ? T0 - 1000 : T0 - (i + 1) * 3600_000 * 30, text })),
    };
    const legacyList = (await legacyCall({ local: full, now: NOW, fn: (w: any) => w.eval('pastOptsHistory()') })).result;
    const mine = T.pastOptsHistory(full as any, { now: () => T0, nonce: () => 'n' });
    expect(mine).toEqual(legacyList);
    expect(mine.map((x) => x.text)).toEqual(['合成 留下']);
  });
});

/* ---------------- v5 mirrors ---------------- */

const ideas = (extra: { task?: Record<string, unknown>; idea?: Record<string, unknown> } = {}) => ({
  schema: 2,
  items: [{ id: 'idea_a', title: '', icon: 'star', status: 'open', rootRecordId: 'rec5_r1', createdAt: T0 - 9e6, activityAt: T0 - 9e6, updatedAt: T0 - 9e6, scheduledDate: D, ...extra.idea }],
  links: [{ id: 'link_rec5_r1', ideaId: 'idea_a', recordId: 'rec5_r1', role: 'root', linkedAt: T0 - 9e6, updatedAt: T0 - 9e6 }],
  events: [],
  tasks: [{ id: 'plan_a', recordId: 'rec5_r1', text: '合成 清单', done: false, scheduledDate: D, order: 0, createdAt: T0 - 9e6, updatedAt: T0 - 8e6, ...extra.task }],
});
const root = { id: 'rec5_r1', t: T0 - 9e6, updatedAt: T0 - 9e6, type: 'note', text: '合成 想法标题。后面的话', mood: null, src: null, q: null };

describe('selecting plans / ideas', () => {
  const local = { qyx_enough: enoughOf(item('t1', '合成 一')), qyx_ideas_v5: ideas(), qyx_log: [root] };
  const openDay = async (_w: any) => {};
  it('select a plan task into a free slot', async () => {
    const r = await parity(local, async (w) => { await openDay(w); click(w, '[data-plan-select="plan_a"]'); await tick(); click(w, '#appDialogPick [data-pick="1"]'); await tick(); },
      (d, c) => T.selectTaskForToday(d, 'plan_a', c, 1));
    expect(r.diffs).toEqual([]);
    expect(r.next.qyx_enough.items[1]).toMatchObject({ id: 'plan_a', v5TaskId: 'plan_a', text: '合成 清单' });
  });
  it('select an idea (derived title becomes the row text)', async () => {
    const r = await parity(local, async (w) => { await openDay(w); click(w, '[data-plan-select-idea="idea_a"]'); await tick(); click(w, '#appDialogPick [data-pick="2"]'); await tick(); },
      (d, c) => T.selectIdeaForToday(d, 'idea_a', c, 2));
    expect(r.diffs).toEqual([]);
    expect(r.next.qyx_enough.items[2].text).toBe('合成 想法标题');
  });
  it('replace a written slot', async () => {
    const r = await parity(local, async (w) => { await openDay(w); click(w, '[data-plan-select="plan_a"]'); await tick(); click(w, '#appDialogPick [data-pick="0"]'); await tick(); await confirmDialog(w); },
      (d, c) => T.selectTaskForToday(d, 'plan_a', c, 0));
    expect(r.diffs).toEqual([]);
  });
  it('day plans list matches the legacy screen', async () => {
    const withMirror = { ...local, qyx_enough: enoughOf(item('plan_a', '合成 清单', { v5TaskId: 'plan_a' })) };
    for (const l of [local, withMirror]) {
      const out = (await legacyCall({ local: l, now: NOW, fn: (w: any) => { w.document.getElementById('v5PlanDate').value = D; return { count: w.document.getElementById('v5PlanCount').textContent, ids: [...w.document.querySelectorAll('#v5PlanList [data-plan-select], #v5PlanList [data-plan-select-idea]')].map((b: any) => b.dataset.planSelect || b.dataset.planSelectIdea) }; } })).result;
      const mine = T.dayPlans(l as any, D);
      expect(mine.ideas.length + mine.tasks.length ? String(mine.ideas.length + mine.tasks.length) : '').toBe(out.count);
      expect([...mine.ideas.map((i) => i.id), ...mine.tasks.map((t) => t.id)].sort()).toEqual(out.ids.slice().sort());
    }
  });
});

describe('mirrored rows push to the plan / idea', () => {
  const task = enoughOf(item('plan_a', '合成 清单', { v5TaskId: 'plan_a', updatedAt: T0 - 7e6 }));
  const idea = enoughOf(item('idea_a', '合成 想法标题', { v5IdeaId: 'idea_a', updatedAt: T0 - 7e6 }));
  const base = { qyx_log: [root], qyx_ideas_v5: ideas() };
  it('edit text of a mirrored plan row', async () => {
    const r = await parity({ ...base, qyx_enough: task }, (w) => type(w, 0, '合成 改了'), (d, c) => T.setEnoughText(d, 0, '合成 改了', c));
    expect(r.diffs).toEqual([]);
    expect(r.next.qyx_ideas_v5.tasks[0].text).toBe('合成 改了');
  });
  it('complete / reopen a mirrored plan row', async () => {
    let r = await parity({ ...base, qyx_enough: task }, (w) => click(w, '#enoughCard .ecirc[data-i="0"]'), (d, c) => T.toggleEnough(d, 0, c));
    expect(r.diffs).toEqual([]);
    expect(r.next.qyx_ideas_v5.tasks[0].done).toBe(true);
    const doneTask = { ...base, qyx_ideas_v5: ideas({ task: { done: true } }), qyx_enough: enoughOf(item('plan_a', '合成 清单', done({ v5TaskId: 'plan_a', updatedAt: T0 - 7e6 }))), qyx_log: [root, rec('d1', '合成 清单', '三件')] };
    r = await parity(doneTask, (w) => click(w, '#enoughCard .ecirc[data-i="0"]'), (d, c) => T.toggleEnough(d, 0, c));
    expect(r.diffs).toEqual([]);
    expect(r.next.qyx_ideas_v5.tasks[0].done).toBe(false);
  });
  it('edit text of a completed mirrored plan row swaps the done log', async () => {
    const l = { qyx_log: [root, rec('d1', '合成 清单', '三件')], qyx_ideas_v5: ideas({ task: { done: true } }), qyx_enough: enoughOf(item('plan_a', '合成 清单', done({ v5TaskId: 'plan_a', updatedAt: T0 - 7e6 }))) };
    const r = await parity(l, (w) => type(w, 0, '合成 新名'), (d, c) => T.setEnoughText(d, 0, '合成 新名', c));
    expect(r.diffs).toEqual([]);
    expect(r.next.qyx_log.filter((e: any) => e.src === '三件').map((e: any) => e.text)).toEqual(['合成 新名']);
  });
  it('complete a mirrored idea row: event + frozen title', async () => {
    const r = await parity({ ...base, qyx_enough: idea }, (w) => click(w, '#enoughCard .ecirc[data-i="0"]'), (d, c) => T.toggleEnough(d, 0, c));
    expect(r.diffs).toEqual([]);
    expect(r.next.qyx_ideas_v5.items[0]).toMatchObject({ status: 'completed', title: '合成 想法标题' });
    expect(r.next.qyx_ideas_v5.events).toHaveLength(1);
  });
  it('delete a mirrored row drops the mirror ids', async () => {
    const r = await parity({ ...base, qyx_enough: task }, async (w) => { click(w, '#enoughCard [data-task-action="delete"][data-i="0"]'); await confirmDialog(w); }, (d, c) => T.deleteEnough(d, 0, c));
    expect(r.diffs).toEqual([]);
    expect(r.next.qyx_enough.items[0].v5TaskId).toBeUndefined();
  });
});

describe('reconcile (render-time pull)', () => {
  // legacy boot already runs renderEnough(); its stored result is the oracle
  const legacyEnough = async (l: any) => (await legacyCall({ local: l, now: NOW, fn: (w: any) => { w.eval('renderEnough()'); return null; } })).ls.qyx_enough;
  const pull = (l: any) => { const d = JSON.parse(JSON.stringify(l)); const c = clk(); const would = T.reconcileToday(d, c, false); T.reconcileToday(d, c); return { d, would, again: T.reconcileToday(d, c, false) }; };
  it('a newer plan task overwrites the row; a missing one drops the mirror', async () => {
    const l = { qyx_log: [root], qyx_ideas_v5: ideas({ task: { text: '合成 别处改的', done: true, updatedAt: T0 - 1e6 } }),
      qyx_enough: enoughOf(item('plan_a', '合成 清单', { v5TaskId: 'plan_a', updatedAt: T0 - 7e6 }), item('gone', '合成 没了', { v5TaskId: 'plan_zz', updatedAt: 1 })) };
    const mine = pull(l);
    expect(mine.would).toBe(true);
    expect(mine.again).toBe(false);
    expect(mine.d.qyx_enough).toEqual(await legacyEnough(l));
    expect(mine.d.qyx_enough.items[0]).toMatchObject({ text: '合成 别处改的', status: 'completed' });
    expect(mine.d.qyx_enough.items[1].v5TaskId).toBeUndefined();
  });
  it('a newer idea status overwrites the row', async () => {
    const l = { qyx_log: [root], qyx_ideas_v5: ideas({ idea: { status: 'completed', statusUpdatedAt: T0 - 1e6 } }),
      qyx_enough: enoughOf(item('idea_a', '合成 旧标题', { v5IdeaId: 'idea_a', updatedAt: T0 - 7e6 })) };
    const mine = pull(l);
    expect(mine.d.qyx_enough).toEqual(await legacyEnough(l));
    expect(mine.d.qyx_enough.items[0]).toMatchObject({ status: 'completed', text: '合成 想法标题' });
  });
  it('nothing to pull = no change (page must not commit)', () => {
    const l = { qyx_log: [root], qyx_ideas_v5: ideas(), qyx_enough: enoughOf(item('plan_a', '合成 清单', { v5TaskId: 'plan_a', updatedAt: T0 - 7e6 })) };
    expect(T.reconcileToday(l as any, clk(), false)).toBe(false);
  });
});

/* ---------------- 问一问 ---------------- */

describe('问一问', () => {
  const key = { qyx_key: JSON.stringify('test-key-not-real') };
  const mk = (replies: string[]) => (w: any, out: any[]) => {
    w.fetch = async (_u: string, init: any) => { out.push(JSON.parse(init.body)); return { json: async () => ({ choices: [{ message: { content: replies.shift() } }] }) }; };
  };
  const local = {
    ...key, qyx_provider: JSON.stringify('deepseek-v4-pro'), qyx_enough: enoughOf(item('t1', '合成 一', done()), item('t2', '合成 二', { status: 'expired' }), item('t3', '合成 三', { status: 'deleted' })),
    qyx_opts: ['合成 甲', '合成 乙'], qyx_rules: [{ id: 1, t: 1, text: '合成 准则' }],
    qyx_log: [{ ...rec('rq', '合成 被引用', '', 'note'), t: Date.parse('2026-10-20T08:15:00+08:00') }],
  };
  it('first round: same system prompt, same user turn, logged with q', async () => {
    const reqs: any[] = [];
    const r = await parity(local, async (w) => {
      mk(['这次按碎片时间算：合成\n做合成。'])(w, reqs);
      w.document.getElementById('aiInput').value = '合成 卡住了 @261020-0815';
      click(w, '#aiSend'); for (let i = 0; i < 6; i++) await tick();
    }, (d, c) => T.logAiFirst(d, '这次按碎片时间算：合成\n做合成。', '合成 卡住了 @261020-0815', c));
    expect(r.diffs).toEqual([]);
    const sys = T.aiFirstSystem(T.aiContext(local as any, clk()));
    // legacy builds `现在是…` from new Date(); the oracle freezes it at the same 09:00
    expect(reqs[0].messages[0]).toEqual({ role: 'system', content: sys });
    expect(reqs[0].messages[1]).toEqual({ role: 'user', content: T.aiFirstUser(local as any, '合成 卡住了 @261020-0815') });
    expect(reqs[0].messages[1].content).toContain('（引用');
    expect(reqs[0].max_tokens).toBe(600);
  });
  it('empty textarea: stand-in turns and q', async () => {
    for (const opts of [local.qyx_opts, []]) {
      const l = { ...local, qyx_opts: opts };
      const reqs: any[] = [];
      const r = await parity(l, async (w) => { mk(['回复'])(w, reqs); click(w, '#aiSend'); for (let i = 0; i < 6; i++) await tick(); }, (d, c) => T.logAiFirst(d, '回复', '', c));
      expect(r.diffs).toEqual([]);
      expect(reqs[0].messages[1].content).toBe(T.aiFirstUser(l as any, ''));
      expect(reqs[0].messages[0].content).toBe(T.aiFirstSystem(T.aiContext(l as any, clk())));
    }
  });
  it('不服: argue system prompt, three-message history, logged with 不服 q', async () => {
    const reqs: any[] = [];
    const r = await parity(local, async (w) => {
      mk(['第一轮', '改判\n做别的。\n下次：先算时间'])(w, reqs);
      w.document.getElementById('aiInput').value = '合成 背景';
      click(w, '#aiSend'); for (let i = 0; i < 6; i++) await tick();
      click(w, '#aiArgue');
      w.document.getElementById('aiAnswer').value = '合成 不服 @261020-0815';
      click(w, '#aiAnswerSend'); for (let i = 0; i < 6; i++) await tick();
    }, (d, c) => { T.logAiFirst(d, '第一轮', '合成 背景', c); T.logAiArgue(d, '改判\n做别的。\n下次：先算时间', '合成 不服 @261020-0815', c); });
    expect(r.diffs).toEqual([]);
    expect(reqs[1].messages[0]).toEqual({ role: 'system', content: T.aiArgueSystem(T.aiContext(local as any, clk())) });
    expect(reqs[1].messages.slice(1)).toEqual([
      { role: 'user', content: T.aiFirstUser(local as any, '合成 背景') },
      { role: 'assistant', content: '第一轮' },
      { role: 'user', content: T.aiArgueUser(local as any, '合成 不服 @261020-0815') },
    ]);
  });
  it('存准则: seed from the 下次 line, newest first, unburies, ignores duplicates', async () => {
    const reply = '改判\n做别的。\n下次：先算时间';
    expect(T.ruleSeed(reply)).toBe('先算时间');
    expect(T.ruleSeed('只有一句')).toBe('只有一句');
    const l = { ...local, qyx_dead: [{ s: 'rule', v: '先算时间', t: 5 }] };
    const r = await parity(l, async (w) => { w.document.getElementById('aiReply').textContent = reply; click(w, '#aiRule'); await tick(); w.document.getElementById('appDialogArea').value = '先算时间'; w.document.getElementById('appDialogOk').click(); await tick(); },
      (d, c) => T.saveRule(d, '先算时间', c), (b) => { (b.qyx_rules || []).forEach((x: any) => { if (x.id >= T0) x.id = x.t = 0; }); });
    expect(r.diffs).toEqual([]);
    expect(r.next.qyx_rules.map((x: any) => x.text)).toEqual(['先算时间', '合成 准则']);
    expect(r.next.qyx_dead.filter((x: any) => x.s === 'rule')).toEqual([]);
    const dup = await parity(local, async (w) => { w.document.getElementById('aiReply').textContent = '合成 准则'; click(w, '#aiRule'); await tick(); w.document.getElementById('appDialogOk').click(); await tick(); }, (d, c) => T.saveRule(d, '合成 准则', c));
    expect(dup.diffs).toEqual([]);
  });
  it('删除准则', async () => {
    const r = await parity(local, async (w) => { w.eval('rules=rules'); w.eval('renderRules()'); click(w, '#rulesList .rule-line .rx'); }, (d, c) => T.removeRule(d, local.qyx_rules[0], c));
    expect(r.diffs).toEqual([]);
  });
});

describe('20 分钟', () => {
  it('logs a note and waitingDays matches', async () => {
    const months = { '2026-10': [{ id: 'g1', text: '合成 目标', kind: 'goal', done: false, splits: [], hist: [] }] };
    const l = {
      qyx_enough: enoughOf(item('t1', '合成 一')), qyx_months: months, qyx_task_goals: { t1: 'g1' },
      qyx_sums: { '2026-10-23': { three: [{ goal: 'g1', done: false }] }, '2026-10-22': { three: [{ goal: 'g1', done: false }] }, '2026-10-21': { three: [{ goal: 'g1', done: true }] } },
    };
    const days = (await legacyCall({ local: l, now: NOW, fn: (w: any) => w.eval('waitingDays("g1")') })).result;
    expect(T.waitingDays(l as any, 'g1', clk())).toBe(days);
    expect(days).toBe(3);
    const r = await parity(l, (w) => { click(w, '#enoughCard [data-start-focus]'); }, (d, c) => T.startTwentyMinutes(d, '合成 一', c));
    expect(r.diffs).toEqual([]);
  });
});

/* 今天 page: deliberate fixes vs legacy, and the select* API other pages call. Run with TZ=Asia/Shanghai. */
import { LocalStore } from '../src/core/storage';
import { mergeSnapshots } from '../src/core/merge';
import type { Snapshot } from '../src/core/types';
import { clone } from '../src/core/util';
import * as T from '../src/domain/today';
import { fixedClock, T0 } from './helpers/parity';

const D = '2026-10-24';
const clock = () => fixedClock(T0);
const item = (id: string, text = '', extra: Record<string, unknown> = {}) => ({ id, text, done: false, status: 'incomplete', updatedAt: 0, subs: [], ...extra });
const enoughOf = (...items: any[]) => ({ d: D, items: [...items, ...Array(3 - items.length).fill(0).map((_, k) => item('blank' + k))] });
const ideas = () => ({
  schema: 2,
  items: [{ id: 'idea_a', title: '', icon: 'star', status: 'open', rootRecordId: 'rec5_r1', createdAt: T0 - 9e6, activityAt: T0 - 9e6, updatedAt: T0 - 9e6, scheduledDate: D }],
  links: [], events: [],
  tasks: [{ id: 'plan_a', recordId: 'rec5_r1', text: '合成 清单', done: false, scheduledDate: D, order: 0, createdAt: T0 - 9e6, updatedAt: T0 - 8e6 }],
});
const root = { id: 'rec5_r1', t: T0 - 9e6, updatedAt: T0 - 9e6, type: 'note', text: '合成 想法标题。后面', mood: null, src: null, q: null };
const base = (): Snapshot => ({ qyx_enough: enoughOf(), qyx_log: [root as any], qyx_ideas_v5: ideas() as any });

describe('F1 dice accept buries the opt tombstone', () => {
  it('and re-adding from 定过的 unburies it again', () => {
    const s: Snapshot = { qyx_opts: ['合成 甲', '合成 乙'] };
    T.acceptDice(s, '合成 甲', clock());
    expect(s.qyx_opts).toEqual(['合成 乙']);
    expect(s.qyx_dead!.filter((d) => d.s === 'opt')).toEqual([{ s: 'opt', v: '合成 甲', t: T0 }]);
    // a second device still holding 甲 loses it on merge instead of re-adding it
    const other: Snapshot = { qyx_opts: ['合成 甲', '合成 乙'] };
    expect(mergeSnapshots(other, s, clock()).snapshot.qyx_opts).toEqual(['合成 乙']);
    T.addToOpts(s, '合成 甲', clock());
    expect(s.qyx_opts).toEqual(['合成 乙', '合成 甲']);
    expect((s.qyx_dead || []).some((d) => d.s === 'opt')).toBe(false);
  });
});

describe('F2 ongoing is unburied on re-add', () => {
  it('complete -> accept again survives a merge', () => {
    const s: Snapshot = { qyx_opts: ['合成 甲'], qyx_ongoing: [{ id: 1, t: 1, text: '合成 甲' }] };
    T.completeOngoing(s, 1, clock());
    expect(s.qyx_dead!.some((d) => d.s === 'ongoing')).toBe(true);
    T.acceptDice(s, '合成 甲', clock());
    expect(s.qyx_ongoing!.map((o) => o.text)).toEqual(['合成 甲']);
    expect(s.qyx_dead!.some((d) => d.s === 'ongoing')).toBe(false);
  });
});

describe('F3 deleted rows stay deleted', () => {
  it('tapping the circle of a deleted row does nothing', () => {
    const s: Snapshot = { qyx_enough: enoughOf(item('t1', '合成 删了', { status: 'deleted' })) };
    expect(T.toggleEnough(s, 0, clock())).toBe('blank');
    expect(T.setEnoughStatus(s, 0, 'completed', clock())).toBe('blank');
    expect(s.qyx_enough!.items[0]).toMatchObject({ status: 'deleted', text: '合成 删了' });
    expect(s.qyx_log || []).toEqual([]);
  });
  it('typing into a deleted row revives it as a fresh row', () => {
    const s: Snapshot = { qyx_enough: enoughOf(item('t1', '合成 删了', { status: 'deleted' })) };
    expect(T.setEnoughText(s, 0, '合成 新的', clock())).toBe(true);
    expect(s.qyx_enough!.items[0]).toMatchObject({ status: 'incomplete', text: '合成 新的' });
  });
  it('rewriting the displayed (empty) value of a deleted row is a no-op', () => {
    const s: Snapshot = { qyx_enough: enoughOf(item('t1', '合成 删了', { status: 'deleted' })) };
    expect(T.setEnoughText(s, 0, '', clock())).toBe(false);
  });
  it('F6: reconcile does not pull a plan back into a deleted row', () => {
    const s = base();
    s.qyx_enough = enoughOf(item('plan_a', '合成 删了', { status: 'deleted', v5TaskId: 'plan_a', updatedAt: 1 }));
    T.reconcileToday(s, clock());
    expect(s.qyx_enough!.items[0]).toMatchObject({ status: 'deleted', text: '合成 删了' });
    expect(s.qyx_enough!.items[0].v5TaskId).toBeUndefined();
  });
});

describe('F4 mirroring does not dirty the plan / idea unless something changed', () => {
  it('selecting a plan and then editing another row leaves qyx_ideas_v5 untouched', () => {
    const s = base();
    const before = JSON.stringify(s.qyx_ideas_v5);
    expect(T.selectTaskForToday(s, 'plan_a', clock())).toBe(true);
    expect(T.selectIdeaForToday(s, 'idea_a', clock())).toBe(true);
    T.setEnoughText(s, 2, '合成 别的', clock());
    expect(JSON.stringify(s.qyx_ideas_v5)).toBe(before);
    expect(s.qyx_ideas_v5!.items[0].title).toBe('');
  });
  it('a real change still pushes', () => {
    const s = base();
    T.selectTaskForToday(s, 'plan_a', clock());
    T.setEnoughText(s, 0, '合成 改名', clock());
    expect(s.qyx_ideas_v5!.tasks[0]).toMatchObject({ text: '合成 改名' });
  });
});

describe('F5 removing an id-less rule', () => {
  it('removes only that rule', () => {
    const s: Snapshot = { qyx_rules: [{ t: 2, text: 'a' }, { t: 1, text: 'b' }, { id: 5, t: 0, text: 'c' }] };
    T.removeRule(s, s.qyx_rules![0], clock());
    expect(s.qyx_rules!.map((r) => r.text)).toEqual(['b', 'c']);
    T.removeRule(s, s.qyx_rules![1], clock());
    expect(s.qyx_rules!.map((r) => r.text)).toEqual(['b']);
  });
});

describe('select* used by other pages', () => {
  it('first free slot, deleted counts as free, idempotent, false when full or gone', () => {
    const s = base();
    s.qyx_enough = enoughOf(item('x', '合成 一'), item('y', '合成 删', { status: 'deleted' }));
    expect(T.selectTaskForToday(s, 'plan_a', clock())).toBe(true);
    expect(s.qyx_enough!.items[1]).toMatchObject({ id: 'plan_a', v5TaskId: 'plan_a', subs: [] });
    expect(T.selectTaskForToday(s, 'plan_a', clock())).toBe(true);
    expect(s.qyx_enough!.items.filter((x) => x.v5TaskId).length).toBe(1);
    expect(T.selectIdeaForToday(s, 'idea_a', clock())).toBe(true);
    expect(s.qyx_enough!.items[2].v5IdeaId).toBe('idea_a');
    const full = base();
    full.qyx_enough = enoughOf(item('a', '1'), item('b', '2'), item('c', '3'));
    expect(T.selectTaskForToday(full, 'plan_a', clock())).toBe(false);
    expect(T.selectTaskForToday(full, 'nope', clock())).toBe(false);
    expect(T.selectIdeaForToday(full, 'idea_a', clock())).toBe(false);
  });
  it('rolls yesterday over first', () => {
    const s = base();
    s.qyx_enough = { d: '2026-10-23', items: [item('o', '合成 昨天')] } as any;
    expect(T.selectTaskForToday(s, 'plan_a', clock())).toBe(true);
    expect(s.qyx_enough!.d).toBe(D);
    expect(s.qyx_enough_prev!.items[0].text).toBe('合成 昨天');
  });
});

describe('page commit guards', () => {
  it('enoughNeedsEnsure / bonusNeedsEnsure are false on a normal day (no commit => no dirty)', () => {
    const s: Snapshot = { qyx_enough: enoughOf(item('a', '合成 一')), qyx_bonus: { d: D, items: [{ text: '', done: false }, { text: '', done: false }] } };
    expect(T.enoughNeedsEnsure(s, clock())).toBe(false);
    expect(T.bonusNeedsEnsure(s, clock())).toBe(false);
    expect(T.enoughNeedsEnsure({ qyx_enough: { d: '2026-10-23', items: [] } }, clock())).toBe(true);
    expect(T.enoughNeedsEnsure({}, clock())).toBe(true);
  });
  it('ensure + persist is idempotent: the second run writes nothing', () => {
    const kv = new Map<string, string>();
    const store = new LocalStore({ getItem: (k) => kv.get(k) ?? null, setItem: (k, v) => void kv.set(k, v), removeItem: (k) => void kv.delete(k) });
    const draft: Snapshot = { qyx_enough: { d: '2026-10-23', items: [item('o', '合成 昨天', { subs: [{ text: '合成 没做', done: false, status: 'incomplete', updatedAt: 0 }] })] } as any };
    T.ensureEnough(draft, clock());
    T.ensureBonus(draft, clock());
    expect(store.writeSnapshot(draft, { userEdit: true, now: T0 }).length).toBeGreaterThan(0);
    const again = clone(store.readSnapshot());
    T.ensureEnough(again, clock());
    expect(store.writeSnapshot(again, { userEdit: true, now: T0 + 1 })).toEqual([]);
    expect(draft.qyx_opts_hist!.map((h) => h.text)).toEqual(['合成 没做']);
  });
  it('viewEnough pads and normalises without mutating', () => {
    const s: Snapshot = { qyx_enough: { d: D, items: [{ id: 'a', text: '合成', subs: ['合成 小'] } as any] } };
    const before = JSON.stringify(s);
    const rows = T.viewEnough(s, clock());
    expect(rows).toHaveLength(3);
    expect(rows[0].subs[0]).toMatchObject({ text: '合成 小', status: 'incomplete' });
    expect(JSON.stringify(s)).toBe(before);
  });
});

/* Deliberate deviations from legacy (docs/DATA-CONTRACT.md D1, D4). Pure, no oracle. */
import { mergeSnapshots, DEFAULT_MERGE_OPTIONS, LEGACY_MERGE_OPTIONS } from '../src/core/merge';
import { dayKey } from '../src/core/util';

const T0 = Date.parse('2026-10-24T09:00:00+08:00');
const clock = () => { let n = 0; return { now: () => T0, nonce: () => 'n' + ++n }; };
const blank = (id: string) => ({ id, text: '', done: false, status: 'incomplete' as const, updatedAt: 0, subs: [] });

describe('D4 strict idea mirror', () => {
  const idea = { id: 'idea_x', title: '合成想法 旧', icon: 'star', status: 'open' as const, rootRecordId: 'rec5_x', createdAt: T0 - 9e6, activityAt: T0 - 9e6, updatedAt: T0 - 60_000, statusUpdatedAt: T0 - 8 * 3.6e6 };
  const side = (text: string, status: 'completed' | 'incomplete', updatedAt: number) => ({
    qyx_enough: { d: dayKey(T0), items: [{ id: 'task_1', text, done: status === 'completed', status, updatedAt, subs: [], v5IdeaId: 'idea_x' }, blank('task_2'), blank('task_3')] },
    qyx_ideas_v5: { schema: 2, items: [idea], links: [], events: [], tasks: [] },
  });
  for (const [remoteText] of [['合成事项 新'], ['合成想法 新']]) {
    it(`newer Today row always lands on the idea (${remoteText})`, () => {
      const out = mergeSnapshots(side('合成事项 旧', 'incomplete', T0 - 8 * 3.6e6), side(remoteText, 'completed', T0 - 600_000), clock(), DEFAULT_MERGE_OPTIONS);
      const merged = out.snapshot.qyx_ideas_v5!.items[0];
      expect(merged.title).toBe(remoteText);
      expect(merged.status).toBe('completed');
      expect(merged.updatedAt).toBeGreaterThan(idea.updatedAt);
    });
  }
});

describe('D1 local tombstones', () => {
  it('a deletion from another device removes the local copy only when enabled', () => {
    const rec = (id: string) => ({ id, t: T0 - 1000, updatedAt: T0 - 1000, type: 'note', text: '合成 ' + id });
    const local = { qyx_log: [rec('rec_a'), rec('rec_b')], qyx_opts: ['合成 打转'] };
    const remote = { qyx_log: [rec('rec_a')], qyx_dead: [{ s: 'log', v: 'rec_b', t: T0 }, { s: 'opt', v: '合成 打转', t: T0 }] };
    const fixed = mergeSnapshots(local, remote, clock(), DEFAULT_MERGE_OPTIONS).snapshot;
    expect(fixed.qyx_log!.map((e) => e.id)).toEqual(['rec_a']);
    expect(fixed.qyx_opts).toEqual([]);
    const legacy = mergeSnapshots(local, remote, clock(), LEGACY_MERGE_OPTIONS).snapshot;
    expect(legacy.qyx_log!.map((e) => e.id)).toEqual(['rec_a', 'rec_b']);
  });
});

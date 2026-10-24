/*
 * End-to-end sync against a fake GitHub: new-engine devices and a device running
 * the real legacy code (via the oracle) share one Gist. Synthetic data only.
 * Run with TZ=Asia/Shanghai.
 */
import { GistClient } from '../src/core/gist';
import { LocalStore } from '../src/core/storage';
import { SyncEngine, findLoss } from '../src/core/sync';
import type { LogEntry, Snapshot } from '../src/core/types';
import type { Clock } from '../src/core/util';
import { FakeGitHub, MemoryKV } from './helpers/fake-github';
// @ts-ignore — plain ESM helper
import { legacyMerge } from '../tools/legacy-oracle.mjs';

const NOW = '2026-10-24T09:00:00+08:00';
const T0 = Date.parse(NOW);

function makeClock(start = T0): Clock & { tick(ms: number): void } {
  let t = start, n = 0;
  return { now: () => t, nonce: () => 'n' + ++n, tick(ms) { t += ms; } };
}

function rec(id: string, minutesAgo: number, text: string, extra: Partial<LogEntry> = {}): LogEntry {
  const t = T0 - minutesAgo * 60_000;
  return { id, t, updatedAt: t, type: 'note', text, mood: null, ...extra };
}

function device(gh: FakeGitHub, clock = makeClock()) {
  const kv = new MemoryKV();
  const store = new LocalStore(kv);
  store.token = gh.token;
  const engine = new SyncEngine({ store, clock, version: '6.0.0-test', makeClient: (t) => new GistClient(t, gh.fetch) });
  const edit = (fn: (s: Snapshot) => void) => {
    const s = store.readSnapshot();
    fn(s);
    clock.tick(1000);
    store.writeSnapshot(s, { userEdit: true, now: clock.now() });
  };
  return { kv, store, engine, clock, edit, log: () => (store.readSnapshot().qyx_log || []) };
}

/** One legacy sync cycle: pull, legacy mergeAll, push collectBackup(). */
async function legacySync(gh: FakeGitHub, gistId: string, local: Record<string, unknown>) {
  const r = await legacyMerge({ local, cloud: gh.read(gistId), now: NOW });
  expect(r.errors).toEqual([]);
  gh.gists.get(gistId)!.content = r.backupRaw;
  return r.ls as Record<string, unknown>;
}

const ids = (log: LogEntry[]) => log.map((e) => e.id).sort();

describe('sync engine', () => {
  it('fresh device pulls everything a legacy device wrote', async () => {
    const gh = new FakeGitHub();
    const base = { qyx_log: [rec('rec_a', 50, '合成 A'), rec('rec_b', 40, '合成 B #合成标签')] };
    const legacyLocal = await legacySync(gh, gh.add(JSON.stringify({})), base);
    const d = device(gh);
    const out = await d.engine.sync();
    expect(out).toMatchObject({ ok: true, pushed: true });
    expect(ids(d.log())).toEqual(['rec_a', 'rec_b']);
    expect(legacyLocal.qyx_log).toBeTruthy();
    // The pushed file is still readable by the legacy engine.
    const back = await legacyMerge({ local: legacyLocal, cloud: gh.read('gist1'), now: NOW });
    expect(back.errors).toEqual([]);
    expect(back.backup.qyx_log.map((e: LogEntry) => e.id).sort()).toEqual(['rec_a', 'rec_b']);
  });

  it('new and legacy devices converge on adds, edits and deletes', async () => {
    const gh = new FakeGitHub();
    const gid = gh.add(JSON.stringify({}));
    let legacyLocal = await legacySync(gh, gid, { qyx_log: [rec('rec_a', 50, '合成 A'), rec('rec_b', 40, '合成 B'), rec('rec_c', 30, '合成 C')] });
    const n = device(gh);
    await n.engine.sync();

    // New device: add D, delete B (tombstone), edit C in place.
    n.edit((s) => {
      s.qyx_log = s.qyx_log!.filter((e) => e.id !== 'rec_b').map((e) => (e.id === 'rec_c' ? { ...e, text: '合成 C 改', updatedAt: n.clock.now() + 1000 } : e));
      s.qyx_log.push(rec('rec_d', 5, '合成 D'));
      s.qyx_dead = [...(s.qyx_dead || []), { s: 'log', v: 'rec_b', t: n.clock.now() }];
    });
    expect(n.store.dirty).toBe(true);
    expect(await n.engine.sync()).toMatchObject({ ok: true });
    expect(n.store.dirty).toBe(false);

    // Legacy device adds E without having seen any of that, then syncs.
    legacyLocal = { ...legacyLocal, qyx_log: [...(legacyLocal.qyx_log as LogEntry[]), rec('rec_e', 2, '合成 E')] };
    legacyLocal = await legacySync(gh, gid, legacyLocal);
    await n.engine.sync();

    expect(ids(n.log())).toEqual(['rec_a', 'rec_c', 'rec_d', 'rec_e']);
    expect(n.log().find((e) => e.id === 'rec_c')!.text).toBe('合成 C 改');
    const cloud = gh.read(gid);
    // Legacy keeps its local copy of B (its old bug) but the tombstone travels with it,
    // so B never comes back on the new device.
    expect(cloud.qyx_dead.some((d: any) => d.s === 'log' && d.v === 'rec_b')).toBe(true);
    expect(cloud.qyx_log.map((e: LogEntry) => e.id)).toEqual(expect.arrayContaining(['rec_c', 'rec_d', 'rec_e']));
  });

  it('two new devices converge after concurrent edits', async () => {
    const gh = new FakeGitHub();
    gh.add(JSON.stringify({ qyx_log: [rec('rec_a', 50, '合成 A')] }));
    const a = device(gh), b = device(gh);
    await a.engine.sync();
    await b.engine.sync();
    a.edit((s) => { s.qyx_log!.push(rec('rec_x', 3, '合成 X')); });
    b.edit((s) => { s.qyx_log!.push(rec('rec_y', 2, '合成 Y')); });
    await a.engine.sync();
    await b.engine.sync();
    await a.engine.sync();
    expect(ids(a.log())).toEqual(['rec_a', 'rec_x', 'rec_y']);
    expect(ids(b.log())).toEqual(ids(a.log()));
  });

  it('reads truncated files through raw_url and folds in sibling gists', async () => {
    const gh = new FakeGitHub();
    gh.truncateAt = 200;
    gh.add(JSON.stringify({ qyx_log: [rec('rec_old', 90, '合成 旧备份')] }));
    gh.add(JSON.stringify({ qyx_log: [rec('rec_new', 10, '合成 新备份'.repeat(20))] }));
    const d = device(gh);
    const out = await d.engine.sync();
    expect(out).toMatchObject({ ok: true, mergedFrom: 2 });
    expect(ids(d.log())).toEqual(['rec_new', 'rec_old']);
  });

  it('queues a sync requested while one is running', async () => {
    const gh = new FakeGitHub();
    gh.add(JSON.stringify({}));
    const d = device(gh);
    const first = d.engine.sync();
    const second = d.engine.sync();
    expect(second).toBe(first);
    await first;
    await new Promise((r) => setTimeout(r, 0));
    while (d.engine.busy) await new Promise((r) => setTimeout(r, 5));
    expect(gh.calls.filter((c) => c.startsWith('PATCH')).length).toBe(2);
  });

  it('reports a missing token instead of throwing', async () => {
    const d = device(new FakeGitHub());
    d.store.token = '';
    expect(await d.engine.sync()).toMatchObject({ ok: false, reason: 'no-token' });
  });

  it('loss guard flags a live remote record missing from the merge', () => {
    const remote = { qyx_log: [rec('rec_a', 5, '合成 A'), rec('rec_b', 4, '合成 B')] };
    expect(findLoss({ qyx_log: [rec('rec_a', 5, '合成 A')] }, remote)).toBe('1 条记录');
    expect(findLoss({ qyx_log: [rec('rec_a', 5, '合成 A')], qyx_dead: [{ s: 'log', v: 'rec_b', t: 1 }] }, remote)).toBeNull();
  });
});

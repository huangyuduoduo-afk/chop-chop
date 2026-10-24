/*
 * Sync against the real GitHub API, opt-in: REAL_GH_TOKEN=… TZ=Asia/Shanghai npx vitest run tests/real-github.test.ts
 *
 * Uses one private gist whose file is TEST_BACKUP_FILE (never chopchop-backup.json, which every
 * real client folds in). Synthetic data only. The gist is reused across runs and reset at start.
 */
import { GistClient, TEST_BACKUP_FILE } from '../src/core/gist';
import { LocalStore } from '../src/core/storage';
import { SyncEngine } from '../src/core/sync';
import type { LogEntry, Snapshot } from '../src/core/types';
import { MemoryKV } from './helpers/fake-github';

const TOKEN = process.env.REAL_GH_TOKEN || '';
const T0 = Date.parse('2026-10-24T09:00:00+08:00');
const client = () => new GistClient(TOKEN, undefined, TEST_BACKUP_FILE, 'chopchop TEST — synthetic data only, safe to delete');

function device(gistId: string) {
  const kv = new MemoryKV();
  const store = new LocalStore(kv);
  store.token = TOKEN;
  store.gistId = gistId;
  let t = T0, n = 0;
  const clock = { now: () => (t += 1000), nonce: () => 'n' + ++n };
  const engine = new SyncEngine({ store, clock, version: '6.0.0-realtest', makeClient: () => client() });
  const edit = (fn: (s: Snapshot) => void) => {
    const s = store.readSnapshot();
    fn(s);
    store.writeSnapshot(s, { userEdit: true, now: clock.now() });
  };
  return { store, engine, edit, ids: () => (store.readSnapshot().qyx_log || []).map((e) => e.id).sort() };
}

const rec = (id: string, i: number, text: string): LogEntry => ({ id, t: T0 - i * 60_000, updatedAt: T0 - i * 60_000, type: 'note', text, mood: null });

describe.skipIf(!TOKEN)('real GitHub sync (synthetic test gist)', () => {
  let gistId = '';

  beforeAll(async () => {
    const c = client();
    gistId = (await c.listBackupGists())[0] || (await c.create('{}'));
    await c.write(gistId, '{}');
  }, 60_000);

  it('two devices converge through the real API, including a >1MB (truncated) file', async () => {
    const a = device(gistId), b = device(gistId);
    // ~1.3MB of synthetic notes so GitHub truncates the API content and raw_url is used.
    a.edit((s) => { s.qyx_log = Array.from({ length: 2600 }, (_, i) => rec('rec_big' + i, i + 10, '合成长记录 ' + i + ' ' + '内容'.repeat(120))); });
    expect(await a.engine.sync()).toMatchObject({ ok: true, pushed: true });
    const pulled = await b.engine.sync();
    expect(pulled).toMatchObject({ ok: true });
    expect(b.ids().length).toBe(2600);

    a.edit((s) => {
      s.qyx_log = s.qyx_log!.filter((e) => e.id !== 'rec_big5');
      s.qyx_log.push(rec('rec_a_new', 1, '合成 A 新增'));
      s.qyx_dead = [...(s.qyx_dead || []), { s: 'log', v: 'rec_big5', t: T0 }];
    });
    b.edit((s) => { s.qyx_log!.push(rec('rec_b_new', 2, '合成 B 新增')); });
    expect(await a.engine.sync()).toMatchObject({ ok: true });
    expect(await b.engine.sync()).toMatchObject({ ok: true });
    expect(await a.engine.sync()).toMatchObject({ ok: true });

    expect(a.ids()).toEqual(b.ids());
    expect(a.ids()).toContain('rec_a_new');
    expect(a.ids()).toContain('rec_b_new');
    expect(a.ids()).not.toContain('rec_big5');
    expect(a.ids().length).toBe(2601);
  }, 180_000);

  it('history revisions are readable', async () => {
    const c = client();
    const revs = await c.revisions(gistId, 5);
    expect(revs.length).toBeGreaterThan(1);
    const old = await c.readRevision(gistId, revs[revs.length - 1].version);
    expect(old).toBeTypeOf('object');
  }, 60_000);

  it('the test gist is invisible to real clients', async () => {
    const real = new GistClient(TOKEN);
    expect(await real.listBackupGists()).not.toContain(gistId);
  }, 60_000);
});

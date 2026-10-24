// Smoke tests for the legacy oracle (next/tools/legacy-oracle.mjs). Synthetic data only.
// Run with: cd next && TZ=Asia/Shanghai npx vitest run tests/oracle.test.ts
// @ts-expect-error plain ESM JS module without types
import { openLegacy, legacyMerge, legacyCall } from '../tools/legacy-oracle.mjs';

const T0 = Date.parse('2026-10-20T10:00:00+08:00');
const rec = (id: string | undefined, t: number, text: string, extra: Record<string, unknown> = {}) => ({
  ...(id ? { id } : {}),
  t,
  type: 'note',
  text,
  ...extra,
});
const cloudOf = (o: Record<string, unknown>) => ({ _ver: '5.1.3.1', _schema: 5, _exported: '2026-10-23T00:00:00.000Z', ...o });
const stripExported = (b: Record<string, unknown>) => {
  const { _exported, ...rest } = b;
  return rest;
};

describe('legacy oracle', () => {
  it('boots with empty storage, no errors, and no successful fetch', async () => {
    const h = await openLegacy();
    try {
      expect(h.errors).toEqual([]);
      expect(h.window.Date.now()).toBeGreaterThanOrEqual(Date.parse('2026-10-24T09:00:00+08:00'));
      expect(new h.window.Date().getTimezoneOffset()).toBe(-480);
      // Boot's update check hits the same origin and is rejected; no GitHub/gist call may be attempted without a token.
      const calls: string[][] = h.window.__fetchCalls;
      expect(calls.every((c) => !/api\.github\.com|gist/.test(c[0]))).toBe(true);
      const ls = h.ls();
      expect(Object.keys(ls).every((k) => k.startsWith('qyx_'))).toBe(true);
      expect(JSON.parse(ls.qyx_log)).toEqual([]);
    } finally {
      h.close();
    }
  });

  it('collectBackup is the v5-wrapped version (_schema 5, qyx_ideas_v5)', async () => {
    const h = await openLegacy();
    try {
      const b = JSON.parse(h.window.collectBackup());
      expect(b._schema).toBe(5);
      expect(b).toHaveProperty('qyx_ideas_v5');
      expect(b._ver).toBe('5.1.3.1');
    } finally {
      h.close();
    }
  });

  it('seeds local storage (objects are JSON.stringified)', async () => {
    const a = rec('rec_local1', T0, 'synthetic L');
    const r = await legacyCall({ local: { qyx_log: [a] }, fn: (w: any) => w.eval('log.map(e=>e.id)') });
    expect(r.errors).toEqual([]);
    expect(r.result).toEqual(['rec_local1']);
  });

  it('merges a new cloud log record into local', async () => {
    const local = rec('rec_local1', T0, 'synthetic B');
    const remote = rec('rec_test1', T0 + 60_000, 'synthetic A', { updatedAt: T0 + 60_000 });
    const r = await legacyMerge({ local: { qyx_log: [local] }, cloud: cloudOf({ qyx_log: [remote] }) });
    expect(r.errors).toEqual([]);
    expect(r.changed).toBe(true);
    expect(r.backup._schema).toBe(5);
    const ids = r.backup.qyx_log.map((e: any) => e.id).sort();
    expect(ids).toEqual(['rec_local1', 'rec_test1']);
    expect(r.ls.qyx_log.map((e: any) => e.id).sort()).toEqual(ids);
  });

  it('does not add a cloud log record that has a tombstone (scope "log", value = logKey = id)', async () => {
    // logKey(e) = e.id || t|type|text ; bury("log", logKey(e)) stores {s:'log', v:<logKey>, t}
    const keep = rec('rec_keep', T0, 'synthetic keep');
    const dead = rec('rec_dead1', T0 + 1000, 'synthetic dead');
    const legacyNoId = rec(undefined, T0 + 2000, 'synthetic dead no id');
    const noIdKey = `${legacyNoId.t}|${legacyNoId.type}|${legacyNoId.text}`;
    const cloud = cloudOf({
      qyx_log: [keep, dead, legacyNoId],
      qyx_dead: [
        { s: 'log', v: 'rec_dead1', t: T0 + 5000 },
        { s: 'log', v: noIdKey, t: T0 + 5000 },
      ],
    });
    const r = await legacyMerge({ local: {}, cloud });
    expect(r.errors).toEqual([]);
    expect(r.backup.qyx_log.map((e: any) => e.id)).toEqual(['rec_keep']);
    // tombstones are merged into local qyx_dead
    expect(r.backup.qyx_dead.map((d: any) => d.v).sort()).toEqual(['rec_dead1', noIdKey].sort());
  });

  it('a local tombstone also blocks resurrection from the cloud', async () => {
    const dead = rec('rec_dead2', T0, 'synthetic gone');
    const r = await legacyMerge({
      local: { qyx_dead: [{ s: 'log', v: 'rec_dead2', t: T0 + 1 }] },
      cloud: cloudOf({ qyx_log: [dead] }),
    });
    expect(r.backup.qyx_log).toEqual([]);
  });

  it('is deterministic: same inputs give identical backups (modulo _exported)', async () => {
    const input = () => ({
      local: { qyx_log: [rec('rec_a', T0, 'synthetic a')] },
      cloud: cloudOf({ qyx_log: [rec('rec_b', T0 + 10, 'synthetic b', { updatedAt: T0 + 10 })] }),
    });
    const r1 = await legacyMerge(input());
    const r2 = await legacyMerge(input());
    expect(JSON.stringify(stripExported(r1.backup))).toBe(JSON.stringify(stripExported(r2.backup)));
    expect(r1.lsRaw).toEqual(r2.lsRaw);
    expect(r1.errors).toEqual([]);
  });
});

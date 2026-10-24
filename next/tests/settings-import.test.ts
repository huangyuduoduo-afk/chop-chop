/* 导入备份 / 历史版本 / 完整备份: wiring vs legacy v5 import handler. Run with TZ=Asia/Shanghai. */
import { buildBackup } from '../src/core/backup';
import { LEGACY_MERGE_OPTIONS, mergeSnapshots } from '../src/core/merge';
import {
  buildFullBackup, collectLocalRecovery, fullBackupFileName, mergeInto, normalizeImport, restorableRecovery, validateImport,
} from '../src/domain/settings';
// @ts-ignore plain ESM helper
import { legacyCall } from '../tools/legacy-oracle.mjs';
import { actionParity, fixedClock, T0 } from './helpers/parity';

const rec = (id: string, t: number, text: string, extra: Record<string, unknown> = {}) => ({ id, t, updatedAt: t, type: 'note', text, mood: null, src: null, q: null, ...extra });
const local = {
  qyx_log: [rec('rec_local1', T0 - 7200_000, '合成 本机记录 #生活')],
  qyx_dice: ['合成 动作甲'],
  qyx_bottles: [{ id: 1, t: T0 - 9e6, text: '合成 本机瓶子', followups: [] }],
};

/** Drive the real legacy file input (v5.js import handler). */
async function legacyImport(w: any, obj: unknown) {
  const input = w.document.getElementById('v5Import');
  const file = { text: async () => JSON.stringify(obj) }; // jsdom's File has no .text()
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  input.dispatchEvent(new w.Event('change'));
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
  return w.document.getElementById('v5BackupStatus').textContent as string;
}

const maskTags = (b: any) => (b.qyx_tags || []).forEach((x: any) => { if (x.created_time >= T0) x.created_time = x.updated_time = 0; });
const nextImport = (raw: unknown) => (d: any, c: any) => {
  const n = normalizeImport(raw);
  validateImport(n.data);
  return mergeInto(d, n.data, c, LEGACY_MERGE_OPTIONS);
};

const cloudFull = {
  qyx_log: [rec('rec_cloud1', T0 - 3600_000, '合成 云端记录 #工作/周报'), rec('rec_local1', T0 - 7200_000, '合成 本机记录 #生活', { updatedAt: T0 - 100, text: '合成 本机记录 改过 #生活' })],
  qyx_dice: ['合成 动作乙'],
  qyx_opts: ['合成 打转'],
  qyx_tags: [{ id: 'tag_x', name: '生活', parent_id: null, created_time: T0, updated_time: T0 }],
  qyx_record_tags: { rec_local1: ['tag_x'] },
  qyx_bottles: [{ id: 1, t: T0 - 9e6, text: '合成 本机瓶子', followups: [{ t: T0 - 8e6, text: '合成 后续' }] }],
  qyx_dead: [{ s: 'opt', v: '合成 已删', t: T0 }],
  qyx_ideas_v5: { schema: 2, items: [{ id: 'idea_a', title: '合成想法', icon: 'star', status: 'open', rootRecordId: 'rec_cloud1', createdAt: T0, activityAt: T0, updatedAt: T0 }], links: [], events: [], tasks: [] },
  qyx_daily_review_v51: [{ id: 'daily_1', date: '2026-10-23', t: T0 - 1e6, paragraphs: [{ text: '合成 回望' }] }],
  _exported: '2026-10-23T00:00:00.000Z', _ver: '5.1.3.1', _schema: 5,
};

describe('import matches the legacy v5 import handler', () => {
  it('full backup (merge, never overwrite)', async () => {
    const r = await actionParity({ local, legacy: async (w) => { await legacyImport(w, cloudFull); }, next: nextImport(cloudFull), mask: maskTags });
    expect(r.errors).toEqual([]);
    expect(r.diffs).toEqual([]);
    expect((r.next as any).qyx_log.map((e: any) => e.id).sort()).toEqual(['rec_cloud1', 'rec_local1']);
  });

  it('legacy recovery.html download (_recovery) with extra local-only keys', async () => {
    const file = { ...cloudFull, _recovery: true, qyx_lastchange: 1, qyx_review_hint: 1, qyx_provider: 'anthropic', qyx_nudge_local: { shown: 1 } };
    const r = await actionParity({ local, legacy: async (w) => { await legacyImport(w, file); }, next: nextImport(file), mask: maskTags });
    expect(r.diffs).toEqual([]);
    expect(normalizeImport(file).kind).toBe('recovery');
  });

  it('v5 range-export JSON', async () => {
    const range = {
      meta: { app: 'chop chop!', version: '5.1.3.1', exportedAt: '2026-10-24T01:00:00.000Z', from: '2026-10-24', to: '2026-10-24' },
      journals: [rec('rec_range1', T0 - 1800_000, '合成 范围导出 #学习/英语')],
      aiEntries: [rec('rec_range2', T0 - 1700_000, '合成 AI 整理', { type: 'ai', q: '合成 问题' })],
      aiPolish: [{ t: T0 - 1600_000, original: '合成 原文', polished: '合成 整理后' }],
      bottles: [{ id: 7, t: T0 - 1500_000, text: '合成 范围瓶子', followups: [] }],
      tagSystem: {
        tags: [{ id: 'tag_e', name: '学习', parent_id: null, created_time: T0, updated_time: T0, path: '学习' }],
        recordTags: { rec_range1: ['tag_e'] }, goalTags: {}, taskTags: {}, taskGoals: {},
      },
      messageBox: { schema: 2, items: [], links: [], events: [], tasks: [] },
      dailyReviews: [],
    };
    const r = await actionParity({ local, legacy: async (w) => { await legacyImport(w, range); }, next: nextImport(range), mask: maskTags });
    expect(r.errors).toEqual([]);
    expect(r.diffs).toEqual([]);
    expect(normalizeImport(range).kind).toBe('range');
    expect((r.next as any).qyx_log.length).toBe(3);
  });

  it('rejects a file that is neither, and bad rows, without touching anything', async () => {
    const bad = { qyx_log: [{ id: 'rec bad id', t: T0, type: 'note', text: '合成' }] };
    let text = '';
    await actionParity({ local, legacy: async (w) => { text = await legacyImport(w, { hello: 1 }); }, next: () => {} });
    expect(text).toBe('导入未完成：请选择 chop chop 完整备份或记录 JSON 导出');
    await actionParity({ local, legacy: async (w) => { text = await legacyImport(w, bad); }, next: () => {} });
    expect(text).toBe('导入未完成：记录格式无效，没有进行合并');
    expect(() => normalizeImport({ hello: 1 })).toThrow('请选择 chop chop 完整备份或记录 JSON 导出');
    expect(() => normalizeImport([1])).toThrow('请选择 chop chop 完整备份或记录 JSON 导出');
    expect(() => validateImport(bad)).toThrow('记录格式无效，没有进行合并');
    expect(() => validateImport({ qyx_log: [{ id: 'rec_a', t: 'x', text: 'a' }] })).toThrow();
    expect(() => validateImport({ qyx_log: [{ id: 'rec_a', t: 1, text: 2 }] })).toThrow();
  });
});

describe('import / history wiring (new engine)', () => {
  it('default options: add-only, provider and secrets never come from the file', () => {
    const d: any = JSON.parse(JSON.stringify({ ...local, qyx_provider: 'anthropic' }));
    const file: any = { ...cloudFull, qyx_provider: 'deepseek-v4-flash', qyx_ghtoken: 'ghp_SYNTHETIC', qyx_key: 'sk-SYNTHETIC' };
    const changed = mergeInto(d, file, fixedClock());
    expect(changed).toBe(true);
    expect(d.qyx_provider).toBe('anthropic');
    expect(JSON.stringify(d)).not.toContain('SYNTHETIC');
    expect(d.qyx_log.map((e: any) => e.id).sort()).toEqual(['rec_cloud1', 'rec_local1']);
    expect(mergeInto(d, file, fixedClock())).toBe(false); // second time: nothing new
  });

  it('a history revision with fewer records never removes local ones', () => {
    const d: any = { qyx_log: [rec('rec_a', T0, '合成 A'), rec('rec_b', T0 + 1, '合成 B')] as any };
    const revision = buildBackup({ qyx_log: [rec('rec_a', T0, '合成 A')] as any }, '6.0.0', new Date(0));
    mergeInto(d, revision, fixedClock());
    expect(d.qyx_log.map((e: any) => e.id)).toEqual(['rec_a', 'rec_b']);
  });

  it('matches mergeSnapshots exactly (same engine as sync)', () => {
    const a: any = JSON.parse(JSON.stringify(local));
    mergeInto(a, cloudFull as any, fixedClock());
    const expected: any = mergeSnapshots(local as any, cloudFull as any, fixedClock()).snapshot;
    // only difference: import also indexes #tags of arriving records (legacy rerenderAll → initTagSystem)
    for (const x of [a, expected]) { delete x.qyx_tags; delete x.qyx_record_tags; }
    expect(JSON.stringify(buildBackup(a, 'v', new Date(0)))).toBe(JSON.stringify(buildBackup(expected, 'v', new Date(0))));
    const b: any = JSON.parse(JSON.stringify(local));
    mergeInto(b, cloudFull as any, fixedClock());
    expect(b.qyx_record_tags.rec_cloud1).toHaveLength(1);
  });
});

describe('full backup', () => {
  const kv = (o: Record<string, string>) => ({ get length() { return Object.keys(o).length; }, key: (i: number) => Object.keys(o)[i] ?? null, getItem: (k: string) => o[k] ?? null });

  it('has the Gist body shape plus localRecovery and no secrets', () => {
    const store = kv({
      'qyx_draft_v5:note': JSON.stringify({ text: '合成 草稿' }),
      'qyx_submit_v5:abc': JSON.stringify({ ok: 1 }),
      qyx_pre5_snapshot: JSON.stringify({ qyx_log: [], qyx_ghtoken: 'ghp_SYNTHETIC', qyx_key: 'sk-SYNTHETIC' }),
      qyx_ghtoken: JSON.stringify('ghp_SYNTHETIC'),
      qyx_key: JSON.stringify('sk-SYNTHETIC'),
      qyx_lastchange: '1',
    });
    const rc = collectLocalRecovery(store);
    expect(Object.keys(rc).sort()).toEqual(['qyx_draft_v5:note', 'qyx_pre5_snapshot', 'qyx_submit_v5:abc']);
    const b: any = buildFullBackup(local as any, '6.0.0', new Date(T0), rc);
    expect(b._schema).toBe(5);
    expect(b.qyx_log).toHaveLength(1);
    expect(b.localRecovery['qyx_draft_v5:note']).toEqual({ text: '合成 草稿' });
    expect(JSON.stringify(b)).not.toContain('SYNTHETIC');
    expect(restorableRecovery(b)).toEqual({ 'qyx_draft_v5:note': { text: '合成 草稿' }, 'qyx_submit_v5:abc': { ok: 1 } });
  });

  it('legacy completeBackup has the same keys', async () => {
    const lb = await legacyCall({
      local: { ...local, 'qyx_draft_v5:note': { text: '合成 草稿' } },
      fn: (w: any) => {
        w.eval('downloadText=function(n,t){window.__dl=[n,t]}');
        w.document.getElementById('v5Backup').click();
        return { name: w.__dl[0], body: JSON.parse(w.__dl[1]) };
      },
    });
    const legacyBody = lb.result.body;
    const mine: any = buildFullBackup(local as any, '5.1.3.1', new Date(0), { 'qyx_draft_v5:note': { text: '合成 草稿' } });
    expect(lb.result.name).toBe('chopchop-full-2026-10-24.json');
    expect(fullBackupFileName(T0)).toBe(lb.result.name);
    expect(Object.keys(mine)).toEqual(Object.keys(legacyBody));
    expect(Object.keys(legacyBody.localRecovery).filter((k) => k !== 'qyx_pre5_snapshot')).toEqual(Object.keys(mine.localRecovery)); // pre5 snapshot is taken by the legacy boot
  });
});

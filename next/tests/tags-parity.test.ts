/* 标签库: 改名/合并 (migrateTag) 和删除 vs legacy. Run with TZ=Asia/Shanghai. */
import { stableId } from '../src/core/util';
import { rewriteTagText, migrateTag, deleteTag, tagTree, tagUsage, tagRecordRows, tagGoalRows, targetInsideSource, tagPath } from '../src/domain/tags';
import { actionParity, fixedClock, T0 } from './helpers/parity';

const tag = (path: string) => {
  const parts = path.split('/');
  return { id: stableId('tag_', path), name: parts.at(-1)!, parent_id: parts.length > 1 ? stableId('tag_', parts.slice(0, -1).join('/')) : null, created_time: T0 - 1e7, updated_time: T0 - 1e7 };
};
const id = (path: string) => stableId('tag_', path);
const rec = (n: number, text: string, extra: Record<string, unknown> = {}) => ({ id: 'rec_' + n, t: T0 - n * 3600_000, updatedAt: T0 - n * 3600_000, type: 'note', text, mood: null, src: null, q: null, ...extra });

const local = {
  qyx_tags: [tag('学习'), tag('学习/高数'), tag('生活'), tag('生活/做饭')],
  qyx_log: [
    rec(1, '合成 #学习 今天'),
    rec(2, '合成 #学习/高数 做题。'),
    rec(3, '合成 #生活 #学习 混合'),
    rec(4, '合成 没有标签', { type: 'done' }),
    rec(5, '合成 #生活/做饭，晚饭'),
  ],
  qyx_record_tags: {
    rec_1: [id('学习')], rec_2: [id('学习/高数')], rec_3: [id('生活'), id('学习')], rec_5: [id('生活/做饭')],
  },
  qyx_goal_tags: { g1: [id('学习/高数')], g2: [id('生活')] },
  qyx_task_tags: { task_1: [id('学习')] },
  qyx_months: { '2026-10': [{ id: 'g1', text: '合成 目标一', kind: 'goal', done: false, splits: [], hist: [] }] },
};

const mask = (b: any) => {
  (b.qyx_dead || []).forEach((x: any) => { x.t = 0; });
  (b.qyx_tags || []).forEach((x: any) => { if (x.created_time >= T0) x.created_time = x.updated_time = 0; });
  (b.qyx_log || []).forEach((e: any) => { e.updatedAt = 0; }); // legacy never bumps it; next does (asserted below)
};
const legacyMigrate = (src: string, target: string) => (w: any) => { w.eval(`migrateTag(${JSON.stringify(id(src))}, ${JSON.stringify(target)})`); };

describe('migrateTag matches legacy (apart from the documented text fix)', () => {
  it('rename with children → new top-level path', async () => {
    const r = await actionParity({ local, legacy: legacyMigrate('学习', '成长/学习'), next: (d, c) => migrateTag(d, id('学习'), '成长/学习', c), mask });
    expect(r.errors).toEqual([]);
    expect(r.diffs).toEqual([]);
    const n: any = r.next;
    expect(n.qyx_log.find((e: any) => e.id === 'rec_2').text).toBe('合成 #成长/学习/高数 做题。');
    expect(n.qyx_dead.filter((x: any) => x.s === 'tag').map((x: any) => x.v)).toEqual([id('学习'), id('学习/高数')]);
  });

  it('merge into an existing tag', async () => {
    const r = await actionParity({ local, legacy: legacyMigrate('学习/高数', '生活/做饭'), next: (d, c) => migrateTag(d, id('学习/高数'), '生活/做饭', c), mask });
    expect(r.diffs).toEqual([]);
    expect((r.next as any).qyx_goal_tags.g1).toEqual([id('生活/做饭')]);
  });

  it('target that was deleted before is revived (unbury)', async () => {
    const withDead = { ...local, qyx_dead: [{ s: 'tag', v: id('新'), t: T0 - 5 }] };
    const r = await actionParity({ local: withDead, legacy: legacyMigrate('生活', '新'), next: (d, c) => migrateTag(d, id('生活'), '新', c), mask });
    expect(r.diffs).toEqual([]);
    expect((r.next as any).qyx_dead.some((x: any) => x.v === id('新'))).toBe(false);
  });
});

describe('deviation: record text rewrite bumps updatedAt and respects tag boundaries', () => {
  it('bumps updatedAt only on rewritten records so other devices receive the rename', () => {
    const d: any = JSON.parse(JSON.stringify(local));
    migrateTag(d, id('学习'), '成长', fixedClock());
    const by = (n: string) => d.qyx_log.find((e: any) => e.id === n);
    expect(by('rec_1').text).toBe('合成 #成长 今天');
    expect(by('rec_1').updatedAt).toBe(T0);
    expect(by('rec_3').updatedAt).toBe(T0);
    expect(by('rec_4').updatedAt).toBe(T0 - 4 * 3600_000); // untouched
    expect(by('rec_5').updatedAt).toBe(T0 - 5 * 3600_000);
    expect(by('rec_1').t).toBe(T0 - 3600_000); // creation time never changes
  });

  it('legacy also mangles #学习笔记; next does not', async () => {
    const l = { ...local, qyx_log: [rec(1, '合成 #学习笔记 和 #学习 和 #学习/高数。'), ...local.qyx_log.slice(1)] };
    const r = await actionParity({ local: l, legacy: legacyMigrate('学习', '成长'), next: (d, c) => migrateTag(d, id('学习'), '成长', c), mask });
    expect((r.legacy as any).qyx_log.find((e: any) => e.id === 'rec_1').text).toBe('合成 #成长笔记 和 #成长 和 #成长/高数。'); // legacy bug
    expect((r.next as any).qyx_log.find((e: any) => e.id === 'rec_1').text).toBe('合成 #学习笔记 和 #成长 和 #成长/高数。');
  });

  it('rewriteTagText handles trailing punctuation and Chinese separators', () => {
    expect(rewriteTagText('#学习，#学习。#学习) #学习/高数！ #学习x', '学习', 'a/b')).toBe('#a/b，#a/b。#a/b) #a/b/高数！ #学习x');
    expect(rewriteTagText('没有标签 学习', '学习', 'x')).toBe('没有标签 学习');
  });

  it('cannot move a tag into its own subtree', () => {
    const d: any = JSON.parse(JSON.stringify(local));
    expect(targetInsideSource(d, id('学习'), '#学习/新')).toBe(true);
    expect(targetInsideSource(d, id('学习'), '学习笔记')).toBe(false);
    expect(() => migrateTag(d, id('学习'), '学习/新', fixedClock())).toThrow('新标签不能放进自己的子层级。');
    expect(d.qyx_tags).toHaveLength(4);
  });
});

describe('deleteTag matches legacy 删除标签', () => {
  it('removes subtree from tags and relations, buries ids, keeps record text', async () => {
    const r = await actionParity({
      local,
      legacy: async (w) => {
        w.eval(`activeTagId=${JSON.stringify(id('学习'))}`);
        w.document.getElementById('deleteTag').click();
        await new Promise((x) => setImmediate(x));
        w.document.getElementById('appDialogOk').click();
        await new Promise((x) => setImmediate(x));
      },
      next: (d, c) => deleteTag(d, id('学习'), c),
      mask,
    });
    expect(r.errors).toEqual([]);
    expect(r.diffs).toEqual([]);
    const n: any = r.next;
    expect(n.qyx_tags.map((t: any) => t.name)).toEqual(['生活', '做饭']);
    expect(n.qyx_log.find((e: any) => e.id === 'rec_1').text).toBe('合成 #学习 今天');
    expect(n.qyx_dead.filter((x: any) => x.s === 'tag')).toHaveLength(2);
  });
});

describe('read helpers', () => {
  it('tree, usage, related rows and goals', () => {
    const s: any = JSON.parse(JSON.stringify(local));
    const tree = tagTree(s, 'count');
    expect(tree.map((n) => n.tag.name)).toEqual(['学习', '生活']); // 学习: r1,r2,r3 = 3 ; 生活: r3,r5 = 2
    expect(tree[0].count).toBe(3);
    expect(tree[0].children.map((n) => n.tag.name)).toEqual(['高数']);
    expect(tagUsage(s, id('学习')).recent).toBe(T0 - 3600_000);
    expect(tagRecordRows(s, id('学习')).map((e) => e.id)).toEqual(['rec_1', 'rec_2', 'rec_3']);
    expect(tagGoalRows(s, id('学习'))).toEqual([{ ym: '2026-10', id: 'g1', text: '合成 目标一' }]);
    expect(tagPath(s, id('学习/高数'))).toBe('学习/高数');
    expect(tagTree(s, 'created')).toHaveLength(2);
  });
});

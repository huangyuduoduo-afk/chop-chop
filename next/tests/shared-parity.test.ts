/* Shared primitives vs legacy. Run with TZ=Asia/Shanghai. */
import { addLog, bury } from '../src/domain/shared';
import { actionParity, T0 } from './helpers/parity';

const base = { qyx_log: [{ id: 'rec_seed', t: T0 - 3600_000, updatedAt: T0 - 3600_000, type: 'note', text: '合成 旧 #旧标签', mood: null, src: null, q: null }] };

describe('shared primitives match legacy', () => {
  it('addLog with #tags', async () => {
    const r = await actionParity({
      local: base,
      legacy: (w) => { w.eval('addLog("note", "合成 新记录 #生活/做饭 #想法", "开心")'); },
      next: (d, c) => addLog(d, { type: 'note', text: '合成 新记录 #生活/做饭 #想法', mood: '开心' }, c),
      mask: (b) => {
        // ids and times come from different clocks/randomness on each side
        const e = b.qyx_log.at(-1); const id = e.id; e.id = '<new>'; e.t = e.updatedAt = 0;
        b.qyx_record_tags['<new>'] = b.qyx_record_tags[id]; delete b.qyx_record_tags[id];
        b.qyx_tags.forEach((t: any) => { if (t.created_time >= T0) t.created_time = t.updated_time = 0; });
        b.qyx_lastchange = undefined;
      },
    });
    expect(r.errors).toEqual([]);
    expect(r.diffs).toEqual([]);
  });

  it('bury', async () => {
    const r = await actionParity({
      local: base,
      legacy: (w) => { w.eval('bury("opt", "合成 打转")'); },
      next: (d, c) => bury(d, 'opt', '合成 打转', c),
      mask: (b) => b.qyx_dead.forEach((x: any) => { x.t = 0; }),
    });
    expect(r.diffs).toEqual([]);
  });
});

import { mergeSnapshots, DEFAULT_MERGE_OPTIONS } from '../src/core/merge';
import type { Snapshot } from '../src/core/types';
import { parseBlocks, parseInline } from '../src/domain/markdown';
import { deleteRecord, editableText, editRecord, extractChecklist, submitRecord, yesterdayReview } from '../src/domain/records';
import { recordTasks } from '../src/domain/ideas';
import { displayReferences, refToken, resolveRef, storageReferences, stripRefs } from '../src/domain/refs';
import { fixedClock, T0 } from './helpers/parity';

const clock = () => fixedClock(T0);

describe('submitRecord', () => {
  it('rec5_<submissionId>, and a repeat submit never adds a second record', () => {
    const s: Snapshot = {};
    const c = clock();
    const a = submitRecord(s, { submissionId: 'sid1', text: '合成记录 1' }, c);
    expect(a).toMatchObject({ ok: true, recordId: 'rec5_sid1', duplicate: false });
    const before = JSON.stringify(s);
    const b = submitRecord(s, { submissionId: 'sid1', text: '合成记录 1' }, c);
    expect(b).toMatchObject({ ok: true, recordId: 'rec5_sid1', duplicate: true });
    expect(JSON.stringify(s)).toBe(before);
    expect(s.qyx_log).toHaveLength(1);
    expect(s.qyx_log![0]).toMatchObject({ id: 'rec5_sid1', submissionId: 'sid1', type: 'note', mood: null, t: T0, updatedAt: T0 });
  });

  it('a retry after the record was deleted does not resurrect it', () => {
    const s: Snapshot = {};
    submitRecord(s, { submissionId: 'sid1', text: '合成' }, clock());
    deleteRecord(s, 'rec5_sid1', clock());
    expect(submitRecord(s, { submissionId: 'sid1', text: '合成' }, clock())).toMatchObject({ duplicate: true });
    expect(s.qyx_log).toHaveLength(0);
  });

  it('a duplicate of a new-idea submit returns the same idea, creating nothing', () => {
    const s: Snapshot = {};
    const a = submitRecord(s, { submissionId: 's2', text: '想法', newIdea: { title: '', icon: 'star' } }, clock());
    const b = submitRecord(s, { submissionId: 's2', text: '想法', newIdea: { title: '', icon: 'star' } }, clock());
    expect(a).toMatchObject({ ideaId: 'idea_s2' });
    expect(b).toMatchObject({ ideaId: 'idea_s2', duplicate: true });
    expect(s.qyx_ideas_v5!.items).toHaveLength(1);
    expect(s.qyx_ideas_v5!.links).toHaveLength(1);
  });

  it('empty text is refused, whitespace-only too', () => {
    expect(submitRecord({}, { submissionId: 'x', text: '  \n ' }, clock())).toEqual({ ok: false, reason: 'empty' });
  });

  it('a removed target idea falls back to 说说 only: the text is kept', () => {
    const s: Snapshot = { qyx_ideas_v5: { schema: 2, items: [{ id: 'idea_gone', title: 't', icon: 'star', status: 'open', rootRecordId: 'r', createdAt: 1, activityAt: 1, updatedAt: 1, removedAt: 5 }], links: [], events: [], tasks: [] } };
    const r = submitRecord(s, { submissionId: 's3', text: '合成', ideaId: 'idea_gone' }, clock());
    expect(r).toMatchObject({ ok: true, ideaId: null });
    expect(s.qyx_log).toHaveLength(1);
    expect(s.qyx_ideas_v5!.links).toHaveLength(0);
  });

  it('checklist-only note keeps text "" and creates tasks (wire-compatible with 5.x)', () => {
    const s: Snapshot = {};
    submitRecord(s, { submissionId: 's4', text: '- [ ] 清单甲\n- [x] 清单乙' }, clock());
    expect(s.qyx_log![0].text).toBe('');
    expect(recordTasks(s, 'rec5_s4').map((t) => [t.text, t.done, t.order])).toEqual([['清单甲', false, 0], ['清单乙', true, 1]]);
    // an empty "- [ ] " line stays in the body
    expect(extractChecklist('- [ ] \n正文', 'r', clock()).text).toBe('- [ ] \n正文');
  });

  it('refs: labels in the editor are stored as raw tokens, #tags are indexed', () => {
    const s: Snapshot = { qyx_log: [{ id: 'rec_old', t: Date.parse('2026-10-20T10:05:30+08:00'), type: 'note', text: '更早的一条' }] };
    const map = new Map<string, string>();
    const shown = displayReferences(s.qyx_log!, '见 ' + refToken(s.qyx_log!, s.qyx_log![0]) + ' 然后 #读书/笔记', map);
    expect(shown).toContain('〔引用 10/20 10:05 · 更早的一条〕');
    submitRecord(s, { submissionId: 's5', text: shown, refs: map }, clock());
    const saved = s.qyx_log!.find((r) => r.id === 'rec5_s5')!;
    expect(saved.text).toBe('见 @261020-1005 然后 #读书/笔记');
    expect(s.qyx_record_tags!['rec5_s5']).toHaveLength(1);
    expect(s.qyx_tags!.map((t) => t.name).sort()).toEqual(['笔记', '读书']);
  });

  it('wall/active only when given; mood kept', () => {
    const s: Snapshot = {};
    submitRecord(s, { submissionId: 's6', text: '合成', mood: '😌', trace: { wall: 5000, active: 3000 } }, clock());
    expect(s.qyx_log![0]).toMatchObject({ mood: '😌', wall: 5000, active: 3000 });
  });
});

describe('editRecord / deleteRecord', () => {
  it('keeps id and t, bumps updatedAt (strictly), v5StableId true', () => {
    const s: Snapshot = {};
    submitRecord(s, { submissionId: 'e1', text: '原文' }, clock());
    editRecord(s, 'rec5_e1', '改过 #新', null, clock());
    const r = s.qyx_log![0];
    expect(r).toMatchObject({ id: 'rec5_e1', t: T0, text: '改过 #新', v5StableId: true });
    expect(r.updatedAt).toBeGreaterThan(T0);
    expect(editRecord(s, 'rec5_e1', '   ', null, clock())).toMatchObject({ ok: false });
  });

  it('the edit box shows checklist lines; editing keeps, adds and removes tasks (O4/O5)', () => {
    const s: Snapshot = {};
    submitRecord(s, { submissionId: 'e2', text: '- [ ] 甲\n- [ ] 乙' }, clock());
    const rec = s.qyx_log![0];
    expect(editableText(s, rec)).toBe('- [ ] 甲\n- [ ] 乙');
    const [a, b] = recordTasks(s, 'rec5_e2');
    // 甲 ticked, 乙 removed, 丙 new
    editRecord(s, 'rec5_e2', '正文\n- [x] 甲\n- [ ] 丙', null, clock());
    const live = recordTasks(s, 'rec5_e2');
    expect(live.map((t) => [t.text, t.done])).toEqual([['甲', true], ['丙', false]]);
    expect(live[0].id).toBe(a.id);
    expect(s.qyx_ideas_v5!.tasks.find((t) => t.id === b.id)!.removedAt).toBeTruthy();
    expect(rec.text).toBe('正文');
  });

  it('delete: tombstone, record_tags cleaned, idea links and tasks retired (soft)', () => {
    const s: Snapshot = {};
    submitRecord(s, { submissionId: 'root', text: '根', newIdea: { title: '', icon: 'star' } }, clock());
    submitRecord(s, { submissionId: 'u1', text: '补充 #t\n- [ ] 清单', ideaId: 'idea_root' }, clock());
    deleteRecord(s, 'rec5_u1', clock());
    expect(s.qyx_log!.map((r) => r.id)).toEqual(['rec5_root']);
    expect(s.qyx_dead).toEqual([{ s: 'log', v: 'rec5_u1', t: T0 }]);
    expect(s.qyx_record_tags!['rec5_u1']).toBeUndefined();
    const st = s.qyx_ideas_v5!;
    expect(st.links.find((l) => l.recordId === 'rec5_u1')!.removedAt).toBe(T0);
    expect(st.tasks.every((t) => t.removedAt)).toBe(true);
    expect(st.items[0].removedAt).toBeUndefined(); // the idea itself stays
  });

  it('wire: a merge with the pre-delete state keeps the record deleted', () => {
    const s: Snapshot = {};
    submitRecord(s, { submissionId: 'm1', text: '合成' }, clock());
    const old = JSON.parse(JSON.stringify(s));
    deleteRecord(s, 'rec5_m1', clock());
    const merged = mergeSnapshots(s, old, fixedClock(T0 + 1000), DEFAULT_MERGE_OPTIONS);
    expect(merged.snapshot.qyx_log ?? []).toHaveLength(0);
  });
});

describe('references', () => {
  const mk = (id: string, t: string, type = 'note') => ({ id, t: Date.parse(t), type, text: '内容 ' + id });
  it('token = kind + yymmdd-hhmm + order suffix within the minute', () => {
    const log = [mk('a', '2026-10-20T10:05:10+08:00'), mk('b', '2026-10-20T10:05:40+08:00'), mk('c', '2026-10-20T10:05:20+08:00', 'done')];
    expect(refToken(log, log[0])).toBe('@261020-1005');
    expect(refToken(log, log[1])).toBe('@261020-1005b');
    expect(refToken(log, log[2])).toBe('@d261020-1005');
    expect(resolveRef(log, '', '261020', '1005', 'b').hit?.id).toBe('b');
    expect(resolveRef(log, '', '261020', '1005', 'a').hit?.id).toBe('a');
    expect(refToken(log, { ...mk('x', '2026-10-20T10:05:10+08:00'), type: 'dice' })).toBe('');
    expect(stripRefs(log, '见@261020-1005b')).toBe('见（引用10/20 10:05：内容 b）');
    expect(stripRefs(log, '见@261020-1111')).toBe('见（引用了一条已删除的记录）');
  });
  it('label <-> token roundtrip is stable and de-duplicates labels', () => {
    const log = [mk('a', '2026-10-20T10:05:10+08:00'), mk('b', '2026-10-20T10:05:40+08:00')];
    const map = new Map<string, string>();
    const shown = displayReferences(log, '@261020-1005 和 @261020-1005b', map);
    expect(map.size).toBe(2);
    expect(storageReferences(shown, map)).toBe('@261020-1005 和 @261020-1005b');
    expect(displayReferences(log, shown, map)).toBe(shown);
  });
});

describe('markdown (no HTML anywhere)', () => {
  it('blocks', () => {
    expect(parseBlocks('# 大\n> 引\n- 点\n1. 序\n平').map((b) => b.k)).toEqual(['h', 'quote', 'ul', 'ol', 'p']);
    expect(parseBlocks('#标签 x')[0].k).toBe('p');
  });
  it('inline: bold, italic, tag, ref, https links only', () => {
    const n = parseInline('a **粗** *斜* #标签 @261020-1005 [好](https://x.cn/a) [坏](javascript:alert(1)) [旧](http://x.cn)');
    expect(n.filter((x) => x.k !== 'text').map((x) => x.k)).toEqual(['bold', 'italic', 'tag', 'ref', 'link']);
    expect(JSON.stringify(n)).not.toContain('javascript:alert(1)","label"');
    expect(n.find((x) => x.k === 'link')).toMatchObject({ url: 'https://x.cn/a' });
  });
  it('a # inside a word is not a tag', () => {
    expect(parseInline('abc#def').every((x) => x.k === 'text')).toBe(true);
  });
  it('script-looking text stays text', () => {
    const n = parseInline('<img src=x onerror=alert(1)>');
    expect(n).toEqual([{ k: 'text', v: '<img src=x onerror=alert(1)>' }]);
  });
});

describe('yesterday card data', () => {
  it('reads prev three, stats, insight fallbacks', () => {
    const y = Date.parse('2026-10-23T12:00:00+08:00');
    const s: Snapshot = {
      qyx_log: [{ id: 'n1', t: y, type: 'note', text: '合成' }, { id: 'd1', t: y + 1, type: 'done', text: '合成' }],
      qyx_enough_prev: { d: '2026-10-23', items: [
        { id: 'a', text: '事项', done: true, status: 'completed', updatedAt: 1, subs: [] },
        { id: 'b', text: '事项二', done: false, status: 'expired', updatedAt: 1, subs: [{ text: '小', done: false, status: 'incomplete', updatedAt: 1 }] },
        { id: 'c', text: '', done: false, status: 'incomplete', updatedAt: 0, subs: [] },
      ] },
    };
    const v = yesterdayReview(s, fixedClock(T0));
    expect(v.dateLabel).toBe('10/23 星期五');
    expect(v.completed).toBe(1);
    expect(v.percent).toBe(33);
    expect(v.items[1]).toMatchObject({ expired: true, status: 'incomplete', progress: 0 });
    expect(v.stats).toEqual({ cut: 0, notes: 1, done: 1 });
    expect(v.insight).toContain('1 笔记录');
    expect(v.canFix).toBe(false);
  });
});

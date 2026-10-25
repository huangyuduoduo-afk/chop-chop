import type { Snapshot } from '../src/core/types';
import {
  addRecordToIdea, addTask, contentTime, createIdeaFromRecord, ideaTitle, listIdeas, moveRecord, ownerOf, readIdeas,
  recordTasks, scheduleIdea, scheduleTask, toggleIdeaStatus, toggleTask, validDay,
} from '../src/domain/ideas';
import { submitRecord } from '../src/domain/records';
import { fixedClock, T0 } from './helpers/parity';

const at = (ms: number) => fixedClock(T0 + ms);

function world(): Snapshot {
  const s: Snapshot = {};
  submitRecord(s, { submissionId: 'a', text: '想法甲。第二句', newIdea: { title: '', icon: 'star' } }, at(0));
  submitRecord(s, { submissionId: 'b', text: '想法乙', newIdea: { title: '乙', icon: 'sprout' } }, at(1000));
  submitRecord(s, { submissionId: 'u', text: '补充甲', ideaId: 'idea_a' }, at(2000));
  submitRecord(s, { submissionId: 'free', text: '自由记录' }, at(3000));
  return s;
}

describe('one owner per record (domain rule)', () => {
  it('a record already owned cannot be added to another idea', () => {
    const s = world();
    expect(ownerOf(s, 'rec5_u')?.ideaId).toBe('idea_a');
    expect(addRecordToIdea(s, 'rec5_u', 'idea_b', at(4000))).toMatchObject({ ok: false });
    expect(addRecordToIdea(s, 'rec5_u', 'idea_a', at(4000))).toEqual({ ok: true }); // already there: no-op
    expect(readIdeas(s).links.filter((l) => l.recordId === 'rec5_u' && !l.removedAt)).toHaveLength(1);
  });

  it('a free record can be added once', () => {
    const s = world();
    expect(addRecordToIdea(s, 'rec5_free', 'idea_b', at(4000))).toEqual({ ok: true });
    expect(ownerOf(s, 'rec5_free')?.ideaId).toBe('idea_b');
    expect(addRecordToIdea(s, 'rec5_free', 'idea_a', at(4001))).toMatchObject({ ok: false });
  });

  it('move retires the old link and revives a retired link instead of duplicating ids', () => {
    const s = world();
    expect(moveRecord(s, 'rec5_u', 'idea_b', at(4000))).toEqual({ ok: true });
    expect(ownerOf(s, 'rec5_u')?.ideaId).toBe('idea_b');
    expect(moveRecord(s, 'rec5_u', 'idea_a', at(5000))).toEqual({ ok: true });
    expect(moveRecord(s, 'rec5_u', 'idea_b', at(6000))).toEqual({ ok: true });
    const ids = readIdeas(s).links.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(readIdeas(s).links.filter((l) => l.recordId === 'rec5_u' && !l.removedAt)).toHaveLength(1);
  });

  it('move heals two concurrent active links (O8): only one survives', () => {
    const s = world();
    readIdeas(s).links.push({ id: 'link_rec5_u_idea_b', ideaId: 'idea_b', recordId: 'rec5_u', role: 'update', linkedAt: 1, updatedAt: 1 });
    expect(moveRecord(s, 'rec5_u', null, at(4000))).toEqual({ ok: true });
    expect(readIdeas(s).links.filter((l) => l.recordId === 'rec5_u' && !l.removedAt)).toHaveLength(0);
  });

  it('a root record cannot move', () => {
    const s = world();
    expect(moveRecord(s, 'rec5_a', 'idea_b', at(4000))).toMatchObject({ ok: false });
    expect(moveRecord(s, 'rec5_a', null, at(4000))).toMatchObject({ ok: false });
  });

  it('a removed idea frees its records', () => {
    const s = world();
    s.qyx_ideas_v5!.items.find((i) => i.id === 'idea_a')!.removedAt = 5;
    expect(ownerOf(s, 'rec5_u')).toBeUndefined();
    expect(addRecordToIdea(s, 'rec5_u', 'idea_b', at(4000))).toEqual({ ok: true });
  });
});

describe('createIdeaFromRecord (fixes O1)', () => {
  it('makes an existing record the root of a new idea; no new record, no tasks', () => {
    const s = world();
    const before = s.qyx_log!.length;
    const r = createIdeaFromRecord(s, 'rec5_free', { title: ' 新 ' }, at(4000));
    expect(r.ok).toBe(true);
    const id = (r as { ideaId: string }).ideaId;
    const i = readIdeas(s).items.find((x) => x.id === id)!;
    expect(i).toMatchObject({ rootRecordId: 'rec5_free', title: '新', status: 'open', icon: 'star' });
    expect(readIdeas(s).links.find((l) => l.id === 'link_rec5_free')).toMatchObject({ ideaId: id, role: 'root' });
    expect(s.qyx_log!.length).toBe(before);
    expect(createIdeaFromRecord(s, 'rec5_free', {}, at(5000))).toMatchObject({ ok: false });
  });
  it('reuses the retired composer link id rather than duplicating it', () => {
    const s = world();
    moveRecord(s, 'rec5_u', null, at(4000));
    const r = createIdeaFromRecord(s, 'rec5_u', {}, at(5000)) as { ideaId: string };
    const same = readIdeas(s).links.filter((l) => l.id === 'link_rec5_u');
    expect(same).toHaveLength(1);
    expect(same[0]).toMatchObject({ ideaId: r.ideaId, role: 'root' });
    expect(same[0].removedAt).toBeUndefined();
  });
});

describe('idea state', () => {
  it('title: stored or first sentence; ids stay unique', () => {
    const s = world();
    expect(ideaTitle(s, readIdeas(s).items[0])).toBe('想法甲');
    expect(ideaTitle(s, readIdeas(s).items[1])).toBe('乙');
  });

  it('every change bumps updatedAt strictly (merge picks it)', () => {
    const s = world();
    const i = readIdeas(s).items[0];
    const before = i.updatedAt;
    scheduleIdea(s, 'idea_a', '2026-11-01', at(0));
    expect(i.updatedAt).toBeGreaterThan(before);
    expect(i.scheduledDate).toBe('2026-11-01');
    expect(scheduleIdea(s, 'idea_a', '2026-13-45', at(9))).toMatchObject({ ok: false });
    expect(i.scheduledDate).toBe('2026-11-01');
    scheduleIdea(s, 'idea_a', null, at(10_000));
    expect(i.scheduledDate).toBeNull();
  });

  it('complete / reopen write events and statusUpdatedAt', () => {
    const s = world();
    toggleIdeaStatus(s, 'idea_a', at(5000));
    const i = readIdeas(s).items[0];
    expect(i).toMatchObject({ status: 'completed', completedAt: T0 + 5000 });
    expect(i.statusUpdatedAt).toBe(i.updatedAt);
    toggleIdeaStatus(s, 'idea_a', at(6000));
    expect(readIdeas(s).events.map((e) => e.event)).toEqual(['completed', 'open']);
    expect(i.status).toBe('open');
  });

  it('list: filter, sort and search', () => {
    const s = world();
    toggleIdeaStatus(s, 'idea_b', at(5000));
    expect(listIdeas(s, { filter: 'open' }).map((i) => i.id)).toEqual(['idea_a']);
    expect(listIdeas(s, { filter: 'completed' }).map((i) => i.id)).toEqual(['idea_b']);
    // idea_a got an update at +2000 (after idea_b was created at +1000)
    expect(listIdeas(s, { order: 'recent' }).map((i) => i.id)).toEqual(['idea_a', 'idea_b']);
    expect(listIdeas(s, { order: 'created-new' }).map((i) => i.id)).toEqual(['idea_b', 'idea_a']);
    expect(listIdeas(s, { order: 'oldest-update' }).map((i) => i.id)).toEqual(['idea_b', 'idea_a']);
    expect(listIdeas(s, { query: '补充甲' }).map((i) => i.id)).toEqual(['idea_a']);
    expect(contentTime(s, readIdeas(s).items[0])).toBe(T0 + 2000);
  });

  it('tasks: toggle bumps updatedAt, bad dates refused', () => {
    const s = world();
    const t = addTask(s, 'rec5_free', '清单', at(4000))!;
    expect(recordTasks(s, 'rec5_free')).toHaveLength(1);
    toggleTask(s, t.id, at(5000));
    expect(t.done).toBe(true);
    expect(t.updatedAt).toBe(T0 + 5000);
    expect(scheduleTask(s, t.id, 'nope', at(6000))).toMatchObject({ ok: false });
    expect(validDay('2026-02-30')).toBe(false);
    expect(validDay('2026-02-28')).toBe(true);
  });
});

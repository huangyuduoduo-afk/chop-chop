/* 记忆瞬间 (6.1 C): material, parsing, stored shape, request with stub fetch, old entries. Run with TZ=Asia/Shanghai. */
import { describe, expect, it } from 'vitest';
import type { DailyReview, LogEntry, Snapshot } from '../src/core/types';
import {
  MOMENTS_SYSTEM, entryMoments, momentsForDay, momentsMaterial, parseMomentsAnswer, requestMoments, saveMoments,
} from '../src/domain/moments-ai';
import { dailyForDay } from '../src/domain/sea';
import { fixedClock } from './helpers/parity';

const at = (hhmm: string, day = '2026-10-24') => Date.parse(`${day}T${hhmm}:00+08:00`);
const DAY = '2026-10-24';
const rec = (id: string, hhmm: string, text: string, extra: Partial<LogEntry> = {}): LogEntry => ({ id, t: at(hhmm), type: 'note', text, ...extra } as LogEntry);
const log: LogEntry[] = [
  rec('rec_1', '08:00', '合成记录 1 早起散步'),
  rec('rec_2', '09:30', '合成记录 2 和朋友吃了早茶 @d261023-1000', { images: [{ id: 'p1', path: 'p', thumb: 't', w: 1, h: 1, bytes: 1, t: 1 } as any] }),
  rec('rec_3', '10:00', '合成记录 3 完成了报告', { type: 'done' }),
  rec('rec_4', '11:00', '合成记录 4 掷骰子', { type: 'dice' }),
  rec('rec_5', '12:00', '合成记录 5 问一句', { type: 'ai' }),
  rec('rec_6', '13:00', '   '),
  rec('rec_7', '14:00', '合成记录 7 ![图](data:image/png;base64,AAAA) 文字 <img src="x"> 结尾'),
  { id: 'rec_o', t: at('09:00', '2026-10-23'), type: 'done', text: '合成 前一天的完成' } as LogEntry,
  { id: 'rec_o2', t: at('10:00', '2026-10-23'), type: 'done', text: '合成 被引用的完成' } as LogEntry,
  rec('rec_8', '23:50', '合成记录 8 晚上看了星星'),
];
const snap = (extra: Partial<Snapshot> = {}) => ({ qyx_log: log, ...extra }) as Snapshot;
const cfg = { provider: 'deepseek-v4-pro', key: 'test-key' };

function stubFetch(replies: any[], calls: any[]) {
  let i = 0;
  return (async (url: any, init: any) => {
    calls.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) });
    const r = replies[Math.min(i++, replies.length - 1)];
    if (r instanceof Error) throw r;
    return { json: async () => r };
  }) as unknown as typeof fetch;
}
const ds = (content: string, finish = 'stop') => ({ choices: [{ message: { content }, finish_reason: finish }] });
const an = (text: string) => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn' });
const answer = (...picks: [string, string][]) => JSON.stringify({ moments: picks.map(([title, id]) => ({ title, id })) });

describe('moments-ai: material', () => {
  const rows = momentsMaterial(snap(), DAY);

  it('has only that day\'s note/done records with text, numbered R1…Rn in time order', () => {
    expect(rows.map((r) => r.alias)).toEqual(['R1', 'R2', 'R3', 'R4', 'R5']);
    expect(rows.map((r) => r.id)).toEqual(['rec_1', 'rec_2', 'rec_3', 'rec_7', 'rec_8']);
    expect(rows.map((r) => r.type)).toEqual(['note', 'note', 'done', 'note', 'note']);
    expect(rows[0].time).toBe('08:00');
  });
  it('strips @references to plain words and drops images', () => {
    expect(rows[1].text).toMatch(/（引用10\/23 10:00 完成：合成 被引用的完成）/);
    expect(rows[1].text).not.toMatch(/@d\d/);
    expect(rows[3].text).not.toMatch(/data:image|<img|!\[/);
    expect(rows[3].text).toContain('文字');
    const all = JSON.stringify(rows);
    expect(all).not.toContain('"images"');
    expect(all).not.toContain('thumb');
  });
  it('caps: at most 80 records (longest win), each clipped, total bounded', () => {
    const many = Array.from({ length: 120 }, (_, i) => ({ ...rec('rec_m' + i, '08:00', '合成' + 'x'.repeat(i)), t: at('08:00') + i * 1000 }));
    const r2 = momentsMaterial(snap({ qyx_log: many }), DAY);
    expect(r2).toHaveLength(80);
    expect(r2[79].alias).toBe('R80');
    expect(r2[0].id).toBe('rec_m40');
    const long = momentsMaterial(snap({ qyx_log: [rec('rec_l', '08:00', '长'.repeat(2000))] }), DAY)[0];
    expect(Array.from(long.text)).toHaveLength(301);
    expect(long.text.endsWith('…')).toBe(true);
    const crowded = momentsMaterial(snap({ qyx_log: Array.from({ length: 80 }, (_, i) => ({ ...rec('rec_c' + i, '08:00', '长'.repeat(500)), t: at('08:00') + i })) }), DAY);
    expect(crowded.reduce((n, r) => n + Array.from(r.text).length, 0)).toBeLessThanOrEqual(12000 + 80);
  });
  it('empty day has no rows', () => expect(momentsMaterial(snap(), '2026-01-01')).toEqual([]));
});

describe('moments-ai: parsing', () => {
  const rows = momentsMaterial(snap(), DAY);
  it('maps aliases to real record ids', () => {
    expect(parseMomentsAnswer(answer(['和朋友吃早茶', 'R2'], ['完成报告', 'R3']), rows)).toEqual([
      { title: '和朋友吃早茶', recordId: 'rec_2' }, { title: '完成报告', recordId: 'rec_3' },
    ]);
  });
  it('drops ids that were not in the input; nothing valid left throws', () => {
    expect(parseMomentsAnswer(answer(['编造的', 'R9'], ['真的', 'R1']), rows)).toEqual([{ title: '真的', recordId: 'rec_1' }]);
    expect(() => parseMomentsAnswer(answer(['编造的', 'R9'], ['rec_1', 'rec_1']), rows)).toThrow();
  });
  it('tolerates prose and code fences around the JSON', () => {
    expect(parseMomentsAnswer('好的，这是结果：\n' + answer(['散步', 'R1']) + '\n希望有帮助', rows)).toHaveLength(1);
    expect(parseMomentsAnswer('```json\n' + answer(['散步', 'r1']) + '\n```', rows)[0].recordId).toBe('rec_1');
  });
  it('rejects non-JSON and wrong shapes', () => {
    expect(() => parseMomentsAnswer('我觉得今天很棒', rows)).toThrow();
    expect(() => parseMomentsAnswer('{"moments":[]}', rows)).toThrow();
    expect(() => parseMomentsAnswer('{"paragraphs":[]}', rows)).toThrow();
  });
  it('keeps at most 3, drops duplicate ids, trims titles to 12 characters', () => {
    const four = parseMomentsAnswer(answer(['一', 'R1'], ['二', 'R2'], ['二重复', 'R2'], ['三', 'R3'], ['四', 'R4']), rows);
    expect(four.map((m) => m.recordId)).toEqual(['rec_1', 'rec_2', 'rec_3']);
    const t = parseMomentsAnswer(answer(['  一二三四五六七八九十甲乙丙丁  ', 'R1']), rows)[0].title;
    expect(Array.from(t)).toHaveLength(12);
    expect(parseMomentsAnswer(answer(['「早茶」。', 'R2']), rows)[0].title).toBe('早茶');
    expect(() => parseMomentsAnswer(answer(['   ', 'R1']), rows)).toThrow();
  });
});

describe('moments-ai: request and stored shape', () => {
  const answerOk = answer(['和朋友吃早茶', 'R2'], ['晚上看星星', 'R5']);

  it('DeepSeek: thinking off, 400 tokens, system prompt + JSON material, text only', async () => {
    const calls: any[] = [];
    const out = await requestMoments(snap(), DAY, cfg, fixedClock(), { fetchImpl: stubFetch([ds(answerOk)], calls) });
    expect(out.kind).toBe('ok');
    expect(calls).toHaveLength(1);
    const b = calls[0].body;
    expect(calls[0].url).toContain('deepseek');
    expect(b.thinking).toEqual({ type: 'disabled' });
    expect(b.max_tokens).toBe(400);
    expect(b.messages[0]).toEqual({ role: 'system', content: MOMENTS_SYSTEM });
    const sent = JSON.parse(b.messages[1].content);
    expect(sent.date).toBe(DAY);
    expect(sent.records.map((r: any) => r.id)).toEqual(['R1', 'R2', 'R3', 'R4', 'R5']);
    expect(Object.keys(sent.records[0]).sort()).toEqual(['id', 'text', 'time', 'type']);
    expect(b.messages[1].content).not.toMatch(/rec_|thumb|data:image/);
  });

  it('Anthropic shape works too', async () => {
    const calls: any[] = [];
    const out = await requestMoments(snap(), DAY, { provider: 'anthropic', key: 'k' }, fixedClock(), { fetchImpl: stubFetch([an(answerOk)], calls) });
    expect(out.kind).toBe('ok');
    expect(calls[0].url).toContain('anthropic.com');
    expect(calls[0].body.system).toBe(MOMENTS_SYSTEM);
    expect(calls[0].body.max_tokens).toBe(400);
  });

  it('stores promptVersion moments-1 with real record ids as source_ids', async () => {
    const clock = fixedClock();
    const out = await requestMoments(snap(), DAY, cfg, clock, { fetchImpl: stubFetch([ds(answerOk)], []) });
    if (out.kind !== 'ok') throw new Error('expected ok');
    expect(out.entry).toMatchObject({
      id: 'daily_nonce1', date: DAY, t: clock.now(), provider: 'deepseek-v4-pro', promptVersion: 'moments-1',
      paragraphs: [{ text: '和朋友吃早茶', source_ids: ['rec_2'] }, { text: '晚上看星星', source_ids: ['rec_8'] }],
    });
    expect(out.entry.fingerprint).toBeTruthy();
    const d = snap(); saveMoments(d, out.entry);
    expect(d.qyx_daily_review_v51).toHaveLength(1);
    const day = momentsForDay(d, DAY);
    expect(day.latest?.id).toBe(out.entry.id);
    expect(day.stale).toBe(false);
    expect(entryMoments(day.latest!)).toEqual([{ title: '和朋友吃早茶', recordId: 'rec_2' }, { title: '晚上看星星', recordId: 'rec_8' }]);
    const changed = { ...d, qyx_log: [...log, rec('rec_new', '15:00', '合成 新记录')] } as Snapshot;
    expect(momentsForDay(changed, DAY).stale).toBe(true);
  });

  it('unparseable first answer is retried once; two bad answers save nothing', async () => {
    const calls: any[] = [];
    const ok = await requestMoments(snap(), DAY, cfg, fixedClock(), { fetchImpl: stubFetch([ds('今天很美好'), ds(answerOk)], calls) });
    expect(ok.kind).toBe('ok');
    expect(calls).toHaveLength(2);
    const calls2: any[] = [];
    const bad = await requestMoments(snap(), DAY, cfg, fixedClock(), { fetchImpl: stubFetch([ds('乱七八糟')], calls2) });
    expect(bad.kind).toBe('error');
    expect(calls2).toHaveLength(2);
  });

  it('guards and failures send/save nothing', async () => {
    const calls: any[] = [];
    const f = stubFetch([ds(answerOk)], calls);
    expect(await requestMoments(snap(), '2026-01-01', cfg, fixedClock(), { fetchImpl: f })).toEqual({ kind: 'noRows' });
    expect(await requestMoments(snap(), DAY, { provider: '', key: '' }, fixedClock(), { fetchImpl: f })).toEqual({ kind: 'noKey' });
    expect(calls).toEqual([]);
    const s = snap();
    const out = await requestMoments(s, DAY, cfg, fixedClock(), { fetchImpl: stubFetch([new Error('network down')], []) });
    expect(out).toEqual({ kind: 'error', message: '没连上：network down' });
    const apiErr = await requestMoments(s, DAY, cfg, fixedClock(), { fetchImpl: stubFetch([{ error: { message: 'invalid x-api-key' } }], []) });
    expect(apiErr.kind === 'error' && apiErr.message).toMatch(/没连上：invalid x-api-key.*设置里/);
    expect(s.qyx_daily_review_v51).toBeUndefined();
  });

  it('timeout aborts', async () => {
    const hang = ((_u: any, init: any) => new Promise((_res, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))))) as unknown as typeof fetch;
    const out = await requestMoments(snap(), DAY, cfg, fixedClock(), { fetchImpl: hang, timeoutMs: 10 });
    expect(out).toMatchObject({ kind: 'error', message: expect.stringContaining('超时') });
  });

  it('换一组 tells the model which records were already shown', async () => {
    const calls: any[] = [];
    await requestMoments(snap(), DAY, cfg, fixedClock(), { fetchImpl: stubFetch([ds(answerOk)], calls), avoidIds: ['rec_2', 'rec_8'] });
    expect(calls[0].body.messages[1].content).toContain('上次已经挑过 R2、R5');
  });
});

describe('moments-ai: old entries stay readable', () => {
  const old: DailyReview = {
    id: 'daily_old', date: DAY, t: at('21:00'), fingerprint: 'x', provider: 'deepseek-v4-pro', promptVersion: 'daily-r21-1',
    paragraphs: [{ text: '合成 旧的回望段落', source_ids: ['rec_1'] }], gentleNote: { text: '合成 小提醒', source_ids: ['rec_1'] },
  };
  it('old-format entries are not the latest moments pick and are listed as older; the legacy reader still works', async () => {
    const d = snap({ qyx_daily_review_v51: [old] });
    expect(momentsForDay(d, DAY)).toMatchObject({ latest: undefined, older: [old], stale: false });
    expect(dailyForDay(d, DAY).latest?.id).toBe('daily_old');
    const out = await requestMoments(d, DAY, cfg, fixedClock(), { fetchImpl: stubFetch([ds(answer(['散步', 'R1']))], []) });
    if (out.kind !== 'ok') throw new Error('expected ok');
    saveMoments(d, out.entry);
    expect(d.qyx_daily_review_v51!.map((e) => e.id).sort()).toEqual(['daily_nonce1', 'daily_old']);
    const day = momentsForDay(d, DAY);
    expect(day.latest?.promptVersion).toBe('moments-1');
    expect(day.older).toEqual([old]);
    expect(d.qyx_daily_review_v51!.find((e) => e.id === 'daily_old')).toEqual(old);
  });
});

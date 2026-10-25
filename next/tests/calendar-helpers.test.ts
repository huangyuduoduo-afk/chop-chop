/* Calendar route parsing, navigation and labels. Run with TZ=Asia/Shanghai. */
import { dayLabel, isDayKey, isMonthKey, monthLabel, parseRecordRoute, shiftDay, shiftMonth } from '../src/pages/record/calendar/nav';

const TODAY = '2026-10-24';

describe('parseRecordRoute', () => {
  it('timeline, with or without a record id', () => {
    expect(parseRecordRoute([], TODAY)).toEqual({ view: 'timeline', target: null });
    expect(parseRecordRoute(['rec5_abc'], TODAY)).toEqual({ view: 'timeline', target: 'rec5_abc' });
    expect(parseRecordRoute(['1760000000000'], TODAY)).toEqual({ view: 'timeline', target: '1760000000000' });
  });
  it('month and day', () => {
    expect(parseRecordRoute(['cal', '2026-02'], TODAY)).toEqual({ view: 'cal', month: '2026-02' });
    expect(parseRecordRoute(['day', '2026-10-01'], TODAY)).toEqual({ view: 'day', day: '2026-10-01' });
  });
  it('malformed month/day fall back to today', () => {
    expect(parseRecordRoute(['cal'], TODAY)).toEqual({ view: 'cal', month: '2026-10' });
    expect(parseRecordRoute(['cal', '2026-13'], TODAY)).toEqual({ view: 'cal', month: '2026-10' });
    expect(parseRecordRoute(['day', '2026-02-30'], TODAY)).toEqual({ view: 'day', day: TODAY });
    expect(parseRecordRoute(['day', 'x'], TODAY)).toEqual({ view: 'day', day: TODAY });
  });
  it('validators', () => {
    expect(isMonthKey('2026-10')).toBe(true);
    expect(isMonthKey('2026-00')).toBe(false);
    expect(isDayKey('2028-02-29')).toBe(true);
    expect(isDayKey('2026-02-29')).toBe(false);
  });
});

describe('navigation', () => {
  it('months cross the year boundary both ways', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-10', 0)).toBe('2026-10');
    expect(shiftMonth('2026-03', -14)).toBe('2025-01');
  });
  it('days cross month and year boundaries', () => {
    expect(shiftDay('2026-10-31', 1)).toBe('2026-11-01');
    expect(shiftDay('2026-01-01', -1)).toBe('2025-12-31');
    expect(shiftDay('2028-02-28', 1)).toBe('2028-02-29');
  });
  it('labels', () => {
    expect(dayLabel('2026-10-24')).toBe('10月24日 星期六');
    expect(dayLabel('2026-10-25')).toBe('10月25日 星期日');
    expect(dayLabel('2026-01-05')).toBe('1月5日 星期一');
    expect(monthLabel('2026-10')).toBe('2026年10月');
  });
});

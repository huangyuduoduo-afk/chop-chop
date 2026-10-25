/* Calendar helpers: route parsing, month/day navigation and labels. Pure; no DOM, no storage. */
import { pad } from '../../../core/util';

export type RecordView =
  | { view: 'timeline'; target: string | null }
  | { view: 'cal'; month: string }
  | { view: 'day'; day: string };

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

export const isMonthKey = (s: string | undefined): s is string => !!s && MONTH_RE.test(s);

export function isDayKey(s: string | undefined): s is string {
  const m = s ? DAY_RE.exec(s) : null;
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(y, mo - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d;
}

/**
 * `#/record` → timeline, `#/record/cal/YYYY-MM` → month, `#/record/day/YYYY-MM-DD` → day,
 * `#/record/<recordId>` → timeline that flashes that record. A malformed cal/day segment falls
 * back to the current month/day (`today` = "YYYY-MM-DD").
 */
export function parseRecordRoute(params: string[], today: string): RecordView {
  const [a, b] = params;
  if (a === 'cal') return { view: 'cal', month: isMonthKey(b) ? b : today.slice(0, 7) };
  if (a === 'day') return { view: 'day', day: isDayKey(b) ? b : today };
  return { view: 'timeline', target: a || null };
}

export const monthOf = (day: string) => day.slice(0, 7);

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(y, m - 1, d + delta);
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

/** "2026年10月" */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${y}年${m}月`;
}

/** "10月24日 星期六" */
export function dayLabel(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return `${m}月${d}日 ${WEEKDAYS[new Date(y, m - 1, d).getDay()]}`;
}

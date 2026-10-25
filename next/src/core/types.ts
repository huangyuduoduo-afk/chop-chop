/*
 * Wire format of Chopchop data.
 *
 * These shapes are what lives in localStorage (qyx_* keys) and in the Gist file
 * `chopchop-backup.json`. Old clients (web 5.1.3.x, iOS 5.1.3.2-ios) read and
 * write the same file, so every field here must stay readable by them.
 * Never rename keys or change a field's meaning; only add optional fields.
 */

export type Ms = number;
export type DayKey = string; // "YYYY-MM-DD", local time
export type MonthKey = string; // "YYYY-MM"

export interface LogEntry {
  id: string; // "rec_<fnv>" | "rec5_<uuid>" | "done_…" | "mark_…"
  t: Ms; // original creation time — never changes on edit
  updatedAt?: Ms;
  type: 'note' | 'done' | 'dice' | 'ai' | 'draw' | 'bonus' | string;
  text: string;
  mood?: string | null;
  src?: string;
  q?: string;
  wall?: unknown;
  active?: unknown;
  est?: unknown;
  act?: unknown;
  mark?: unknown;
  submissionId?: string; // v5: stable identity, bypasses content dedupe
  v5StableId?: string;
  /** 6.1: photos stored in the owner's private GitHub repo. Old clients keep the field untouched. */
  images?: PhotoRef[];
  /** 6.1: marked as a highlight (精选) by the owner; null/absent = not starred. */
  starredAt?: Ms | null;
  [extra: string]: unknown;
}

export interface PhotoRef {
  id: string;
  /** Repo paths: full image and thumbnail, e.g. p/2026/10/<id>.jpg and t/2026/10/<id>.jpg */
  path: string;
  thumb: string;
  w: number;
  h: number;
  bytes: number;
  t: Ms;
}

export interface Tombstone {
  s: string; // scope: log | opt | dice | rule | tag | routine | drawer | ongoing | ohist | habit | nudge | anchor:<ym> | split:<goal text> | esub:<day>
  v: string | number;
  t: Ms;
}

export interface Bottle {
  id: number | string;
  t: Ms;
  text: string;
  followups: { t: Ms; text: string }[];
}

export interface MonthGoal {
  id: string | number;
  text: string;
  kind: 'goal' | 'watch';
  done: boolean;
  splits: { text: string; done: boolean }[];
  hist: { t: Ms; ev: string }[];
  carriedFrom?: string;
  [extra: string]: unknown;
}

export type EnoughStatus = 'completed' | 'incomplete' | 'expired' | 'deleted';
export interface EnoughSub {
  text: string;
  done: boolean;
  status: Exclude<EnoughStatus, 'deleted'>;
  updatedAt: Ms;
  c?: number;
}
export interface EnoughItem {
  id: string;
  text: string;
  done: boolean;
  status: EnoughStatus;
  updatedAt: Ms;
  subs: EnoughSub[];
  v5TaskId?: string; // mirror of a v5 checklist task
  v5IdeaId?: string; // mirror of a v5 idea
  [extra: string]: unknown;
}
export interface EnoughDay {
  d: DayKey;
  items: EnoughItem[];
}

export interface BonusDay {
  d: DayKey;
  items: { text: string; done: boolean }[];
}

export interface Habit {
  id: string | number;
  name: string;
  counts: Record<DayKey, number>;
  updatedAt?: Ms;
}

export interface Tag {
  id: string; // "tag_" + fnv(path)
  name: string;
  parent_id: string | null;
  created_time: Ms;
  updated_time: Ms;
}

export interface AiReview {
  t: Ms;
  from: Ms;
  to: Ms;
  text: string;
}

/* ---- v5 overlay (qyx_ideas_v5) ---- */
export interface Idea {
  id: string; // "idea_<submissionId>"
  title: string;
  icon: string;
  status: 'open' | 'completed';
  rootRecordId: string;
  createdAt: Ms;
  activityAt: Ms;
  updatedAt: Ms;
  statusUpdatedAt?: Ms;
  completedAt?: Ms;
  scheduledDate?: DayKey | null;
  removedAt?: Ms | null;
}
export interface IdeaLink {
  id: string; // "link_<recordId>"
  ideaId: string;
  recordId: string;
  role: 'root' | 'update';
  linkedAt: Ms;
  updatedAt: Ms;
  removedAt?: Ms | null;
}
export interface IdeaEvent {
  id: string;
  ideaId: string;
  event: 'completed' | 'open';
  t: Ms;
  updatedAt: Ms;
}
export interface PlanTask {
  id: string; // "plan_<uuid>"
  recordId: string;
  text: string;
  done: boolean;
  scheduledDate?: DayKey | null;
  order: number;
  createdAt: Ms;
  updatedAt: Ms;
  removedAt?: Ms | null;
}
export interface IdeasState {
  schema: number;
  items: Idea[];
  links: IdeaLink[];
  events: IdeaEvent[];
  tasks: PlanTask[];
}

export interface DailyReview {
  id: string; // "daily_<uuid>"
  date: DayKey;
  t: Ms;
  fingerprint?: string;
  provider?: string;
  promptVersion?: string | number;
  paragraphs: { text: string; source_ids?: string[] }[];
  gentleNote?: unknown; // stored as an object by 5.1.x
}

/** Keys pushed to / merged from the Gist by the legacy engine, in legacy order. */
export const BACKUP_KEYS = [
  'qyx_dice', 'qyx_log', 'qyx_opts', 'qyx_bench', 'qyx_opts_hist', 'qyx_routines', 'qyx_drawers',
  'qyx_ongoing', 'qyx_provider', 'qyx_months', 'qyx_bottles', 'qyx_sums', 'qyx_enough',
  'qyx_enough_prev', 'qyx_habits', 'qyx_bonus', 'qyx_bonus_prev', 'qyx_rules', 'qyx_ai_review',
  'qyx_polish_history', 'qyx_sit_reminder', 'qyx_tags', 'qyx_record_tags', 'qyx_goal_tags',
  'qyx_task_tags', 'qyx_task_goals', 'qyx_dead',
] as const;
export const IDEAS_KEY = 'qyx_ideas_v5';
export const DAILY_KEY = 'qyx_daily_review_v51';
export const SYNCED_KEYS = [...BACKUP_KEYS, IDEAS_KEY, DAILY_KEY] as const;
export type SyncedKey = (typeof SYNCED_KEYS)[number];

export interface Snapshot {
  qyx_dice?: string[] | null;
  qyx_log?: LogEntry[] | null;
  qyx_opts?: string[] | null;
  qyx_bench?: string[] | null;
  qyx_opts_hist?: { t: Ms; text: string }[] | null;
  qyx_routines?: { id: string; text: string; updatedAt?: Ms }[] | null;
  qyx_drawers?: { id: string; text: string; updatedAt?: Ms }[] | null;
  qyx_ongoing?: { id: number | string; t: Ms; text: string }[] | null;
  qyx_provider?: string | null;
  qyx_months?: Record<MonthKey, MonthGoal[]> | null;
  qyx_bottles?: Bottle[] | null;
  qyx_sums?: Record<DayKey, any> | null;
  qyx_enough?: EnoughDay | null;
  qyx_enough_prev?: EnoughDay | null;
  qyx_habits?: Habit[] | null;
  qyx_bonus?: BonusDay | null;
  qyx_bonus_prev?: BonusDay | null;
  qyx_rules?: { id?: unknown; t: Ms; text: string }[] | null;
  qyx_ai_review?: AiReview[] | AiReview | null;
  qyx_polish_history?: { t: Ms; original: string; polished: string; mode?: string }[] | null;
  qyx_sit_reminder?: unknown;
  qyx_tags?: Tag[] | null;
  qyx_record_tags?: Record<string, string[]> | null;
  qyx_goal_tags?: Record<string, string[]> | null;
  qyx_task_tags?: Record<string, string[]> | null;
  qyx_task_goals?: Record<string, string | number | null> | null;
  qyx_dead?: Tombstone[] | null;
  qyx_ideas_v5?: IdeasState | null;
  qyx_daily_review_v51?: DailyReview[] | null;
}

/** Gist file body. `_schema: 5` = contains v5 keys. */
export interface BackupFile extends Snapshot {
  _exported?: string;
  _ver?: string;
  _schema?: number;
}

/*
 * Settings, backup download and import. Pure functions over a draft Snapshot.
 *
 * Secrets: the GitHub token (qyx_ghtoken) and AI key (qyx_key) are never part of a Snapshot and
 * every builder here strips them again defensively, so they cannot reach a backup file.
 */
import { buildBackup } from '../core/backup';
import { DEFAULT_DICE, DEFAULT_MERGE_OPTIONS, mergeSnapshots, type MergeOptions } from '../core/merge';
import { DAILY_KEY, IDEAS_KEY, SYNCED_KEYS, type BackupFile, type Snapshot } from '../core/types';
import { dayKey, type Clock } from '../core/util';
import { bury, indexRecordTags, unbury } from './shared';

export const DEFAULT_SIT_REMINDER = '站起来走走';
const SAFE_ID = /^[-\w:.]+$/;

/* ---------------- settings ---------------- */

export interface SettingsInput {
  provider: string;
  sitReminder: string;
  /** One entry per non-empty line (already trimmed). */
  dicePool: string[];
}

export const parsePoolText = (text: string): string[] => text.split('\n').map((x) => x.trim()).filter(Boolean);

export function currentDicePool(s: Snapshot): string[] {
  return s.qyx_dice ?? [...DEFAULT_DICE];
}

/**
 * Legacy 保存. Every old pool entry missing from the new pool is buried, every new one unburied.
 * Deviation (wire-compatible): clearing the pool falls back to the 8 defaults AND unburies them;
 * legacy left a buried default buried, so the next merge dropped it again.
 */
export function saveSettings(s: Snapshot, input: SettingsInput, clock: Clock) {
  s.qyx_provider = input.provider;
  s.qyx_sit_reminder = input.sitReminder.trim() || DEFAULT_SIT_REMINDER;
  const old = currentDicePool(s);
  const next = input.dicePool;
  old.forEach((v) => { if (!next.includes(v)) bury(s, 'dice', v, clock); });
  next.forEach((v) => unbury(s, 'dice', v));
  if (next.length) s.qyx_dice = next;
  else {
    DEFAULT_DICE.forEach((v) => unbury(s, 'dice', v));
    s.qyx_dice = [...DEFAULT_DICE];
  }
}

/* ---------------- full backup ---------------- */

export interface StorageLike {
  readonly length: number;
  key(i: number): string | null;
  getItem(k: string): string | null;
}

const DRAFT = 'qyx_draft_v5:';
const RECEIPT = 'qyx_submit_v5:';
const RECOVERY_FIXED = ['qyx_voice_recovery_v5', 'qyx_v5_pending', 'qyx_pre5_snapshot'];

const scrub = (v: unknown): unknown => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return v;
  const o: any = { ...(v as any) };
  for (const k of Object.keys(o)) if (k === 'qyx_ghtoken' || k === 'qyx_key') delete o[k];
  return o;
};

/** Drafts, submit receipts and the pre-5 snapshot: things that live only on this device (legacy localRecovery). */
export function collectLocalRecovery(kv: StorageLike): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (let i = 0; i < kv.length; i++) {
    const key = kv.key(i);
    if (!key || !(key.startsWith(DRAFT) || key.startsWith(RECEIPT) || RECOVERY_FIXED.includes(key))) continue;
    try { out[key] = scrub(JSON.parse(kv.getItem(key) as string)); } catch { out[key] = null; }
  }
  return out;
}

/** Legacy completeBackup: the Gist body + localRecovery. */
export function buildFullBackup(s: Snapshot, version: string, at: Date, localRecovery: Record<string, unknown> = {}): BackupFile & { localRecovery: Record<string, unknown> } {
  const b: any = buildBackup(s, version, at);
  b.localRecovery = localRecovery;
  return b;
}

export const fullBackupFileName = (nowMs: number) => 'chopchop-full-' + dayKey(nowMs) + '.json';

/* ---------------- import ---------------- */

/** Turn any accepted file (full backup, recovery.html download, range export) into a merge source. */
export function normalizeImport(raw: unknown): { data: any; kind: 'backup' | 'recovery' | 'range'; rangeSource?: any } {
  const o: any = raw;
  if (o && typeof o === 'object' && !Array.isArray(o) && Array.isArray(o.qyx_log)) {
    return { data: o, kind: o._recovery ? 'recovery' : 'backup' };
  }
  if (!o || typeof o !== 'object' || o.meta?.app !== 'chop chop!' || !Array.isArray(o.journals)) {
    throw new Error('请选择 chop chop 完整备份或记录 JSON 导出');
  }
  const ts = o.tagSystem || {};
  const data = {
    qyx_log: [...(o.journals || []), ...(o.aiEntries || [])],
    qyx_bottles: o.bottles || [],
    qyx_polish_history: o.aiPolish || [],
    qyx_tags: ts.tags || [],
    qyx_record_tags: ts.recordTags || {},
    qyx_goal_tags: ts.goalTags || {},
    qyx_task_tags: ts.taskTags || {},
    [IDEAS_KEY]: o.messageBox || { schema: 2, items: [], links: [], events: [], tasks: [] },
    [DAILY_KEY]: o.dailyReviews || [],
  };
  return { data, kind: 'range', rangeSource: o };
}

export function validateImport(data: any) {
  const bad = (data.qyx_log as any[]).some((r) => !r || typeof r.text !== 'string' || !Number.isFinite(r.t) || (r.id && !SAFE_ID.test(r.id)));
  if (bad) throw new Error('记录格式无效，没有进行合并');
}

/** Replace every synced key of the draft with the merged result (merge is a union: nothing is lost). */
function adopt(draft: Snapshot, merged: Snapshot) {
  for (const k of SYNCED_KEYS) if ((merged as any)[k] !== undefined) (draft as any)[k] = (merged as any)[k];
}

/**
 * Fold a backup into the draft (add-only, same engine as sync). Used by 导入备份 and 历史版本.
 * Never takes qyx_provider / tokens from the file. Returns whether anything changed.
 */
export function mergeInto(draft: Snapshot, data: BackupFile, clock: Clock, options: MergeOptions = DEFAULT_MERGE_OPTIONS): boolean {
  const res = mergeSnapshots(draft, data, clock, options);
  if (!res.changed) return false;
  adopt(draft, res.snapshot);
  // Legacy rerenderAll → initTagSystem: index #tags of the records that just arrived (skips tombstoned tags).
  (draft.qyx_log || []).forEach((e) => { if (e.id) indexRecordTags(draft, e, clock, false); });
  return true;
}

/** Keys of a localRecovery block that may be restored (drafts and receipts only, only if absent on this device). */
export function restorableRecovery(data: any): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data?.localRecovery || {})) {
    if (k.startsWith(DRAFT) || k.startsWith(RECEIPT)) out[k] = v;
  }
  return out;
}

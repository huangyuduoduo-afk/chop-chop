import { BACKUP_KEYS, DAILY_KEY, IDEAS_KEY, type BackupFile, type Snapshot } from './types';
import { emptyIdeas, mergeDaily, mergeIdeas } from './merge';

/**
 * Build the Gist file body. Same key set and order as legacy collectBackup + the
 * v5 wrapper, so old clients can merge it.
 */
export function buildBackup(s: Snapshot, version: string, exportedAt: Date): BackupFile {
  const o: any = {};
  for (const k of BACKUP_KEYS) o[k] = (s as any)[k] ?? null;
  o._exported = exportedAt.toISOString();
  o._ver = version;
  o[IDEAS_KEY] = mergeIdeas(s[IDEAS_KEY] || emptyIdeas(), emptyIdeas());
  o[DAILY_KEY] = mergeDaily(s[DAILY_KEY] || [], []);
  o._schema = 5;
  return o;
}

export const serializeBackup = (b: BackupFile) => JSON.stringify(b, null, 2);

/** Parse a backup file body; throws a user-facing message on anything unusable. */
export function parseBackup(text: string): BackupFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('云端备份内容不完整，请稍后再同步');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('云端备份内容不完整，请稍后再同步');
  return data as BackupFile;
}

/*
 * Sync = pull cloud → merge into local → push the merged whole. Same protocol as
 * legacy syncNow, so old clients writing the same Gist keep converging.
 *
 * Differences from legacy:
 *  - Calls made while a sync runs are queued (one follow-up run), not dropped.
 *  - Before pushing, a loss check refuses to upload a snapshot missing any live
 *    remote record; the push is skipped and the error surfaced instead.
 */
import { buildBackup, serializeBackup } from './backup';
import { GistClient } from './gist';
import { DEFAULT_MERGE_OPTIONS, Tombstones, logKey, mergeSnapshots, type MergeOptions } from './merge';
import type { LocalStore } from './storage';
import type { BackupFile, LogEntry, Snapshot } from './types';
import type { Clock } from './util';

export interface SyncDeps {
  store: LocalStore;
  clock: Clock;
  version: string;
  makeClient?: (token: string) => GistClient;
  mergeOptions?: MergeOptions;
  /** Called after cloud data changed local state, so the UI can refresh. */
  onMerged?: (s: Snapshot) => void;
}

export type SyncOutcome =
  | { ok: true; pushed: boolean; mergedFrom: number; records: number }
  | { ok: false; reason: 'no-token' | 'error' | 'loss-guard'; message: string };

export class SyncEngine {
  private running: Promise<SyncOutcome> | null = null;
  private again = false;
  private siblingsChecked = false;

  constructor(private deps: SyncDeps) {}

  get busy() { return this.running !== null; }

  /** `full` also folds in sibling gists (first sync per session, or manual sync). */
  sync(opts: { full?: boolean } = {}): Promise<SyncOutcome> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = this.run(opts.full || !this.siblingsChecked).finally(() => {
      this.running = null;
      if (this.again) {
        this.again = false;
        void this.sync();
      }
    });
    return this.running;
  }

  private async run(full: boolean): Promise<SyncOutcome> {
    const { store, clock, version } = this.deps;
    const token = store.token;
    if (!token) return { ok: false, reason: 'no-token', message: '先在设置里贴 GitHub token。' };
    const client = (this.deps.makeClient ?? ((t) => new GistClient(t)))(token);
    const options = this.deps.mergeOptions ?? DEFAULT_MERGE_OPTIONS;
    const changeAtStart = store.lastChange;
    try {
      let gistId = store.gistId;
      let primary: BackupFile | null = null;
      if (gistId) primary = await client.read(gistId);
      if (!primary) {
        gistId = (await client.listBackupGists())[0] || '';
        primary = gistId ? await client.read(gistId) : null;
        store.gistId = primary ? gistId : '';
      }

      const remotes: BackupFile[] = primary ? [primary] : [];
      if (full) {
        try {
          const siblings = (await client.listBackupGists()).filter((id) => id !== gistId).slice(0, 3);
          for (const id of siblings) {
            try {
              const b = await client.read(id);
              if (b) remotes.push(b);
            } catch { /* a broken sibling must not block the main sync */ }
          }
          this.siblingsChecked = true;
        } catch { /* listing failed; try again next full sync */ }
      }

      let snapshot = store.readSnapshot();
      let changed = false;
      for (const r of remotes) {
        const res = mergeSnapshots(snapshot, r, clock, options);
        snapshot = res.snapshot;
        changed = changed || res.changed;
      }
      if (changed) {
        store.writeSnapshot(snapshot, { userEdit: false, now: clock.now() });
        this.deps.onMerged?.(snapshot);
      }

      const loss = remotes.map((r) => findLoss(snapshot, r)).find(Boolean);
      if (loss) return { ok: false, reason: 'loss-guard', message: '合并结果少了云端记录（' + loss + '），已停止上传。' };

      const content = serializeBackup(buildBackup(snapshot, version, new Date(clock.now())));
      if (gistId) await client.write(gistId, content);
      else store.gistId = await client.create(content);

      const changeAtEnd = store.lastChange;
      store.lastBackup = changeAtEnd > changeAtStart ? Math.max(store.lastBackup, changeAtStart) : clock.now();
      if (store.dirty) this.again = true;
      return { ok: true, pushed: true, mergedFrom: remotes.length, records: (snapshot.qyx_log || []).length };
    } catch (e) {
      return { ok: false, reason: 'error', message: (e as Error).message || String(e) };
    }
  }
}

/**
 * Every live remote record must survive the merge: same id, or (content dedupe of
 * pre-id duplicates) same creation time and type. Returns a short reason or null.
 */
export function findLoss(merged: Snapshot, remote: BackupFile): string | null {
  const dead = new Tombstones(merged.qyx_dead);
  const ids = new Set<string>();
  const origins = new Set<string>();
  (merged.qyx_log || []).forEach((e) => { ids.add(logKey(e)); origins.add(e.t + '|' + e.type); });
  const missing = (remote.qyx_log || []).filter(
    (e: LogEntry) => !dead.has('log', logKey(e)) && !ids.has(logKey(e)) && !origins.has(e.t + '|' + e.type),
  );
  if (missing.length) return `${missing.length} 条记录`;
  const remoteIdeas = remote.qyx_ideas_v5;
  if (remoteIdeas && Array.isArray(remoteIdeas.items)) {
    const have = new Set((merged.qyx_ideas_v5?.items || []).map((x) => x.id));
    const lost = remoteIdeas.items.filter((x) => x && typeof x.id === 'string' && /^[-\w:.]+$/.test(x.id) && !have.has(x.id));
    if (lost.length) return `${lost.length} 个想法`;
  }
  return null;
}

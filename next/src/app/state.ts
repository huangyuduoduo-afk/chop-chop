/*
 * App state: one reactive snapshot of all synced data, persisted through LocalStore.
 *
 * Every user change goes through `commit`, which applies a domain function to a draft,
 * writes changed keys, marks the device dirty and schedules a sync. Pages never touch
 * localStorage directly.
 */
import { signal, computed } from '@preact/signals';
import { LocalStore, type KV } from '../core/storage';
import { SyncEngine, type SyncOutcome } from '../core/sync';
import type { Snapshot } from '../core/types';
import { clone, dayKey, systemClock, type Clock } from '../core/util';

export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '6.0.0-dev';

export type SyncStatus = 'idle' | 'busy' | 'ok' | 'error' | 'no-token';

export interface AppState {
  store: LocalStore;
  clock: Clock;
  engine: SyncEngine;
}

export const snapshot = signal<Snapshot>({});
export const syncStatus = signal<SyncStatus>('idle');
export const syncMessage = signal('');
export const dirty = signal(false);
/** Ticks once a minute so date-dependent views (today, rollover) refresh. */
export const now = signal(Date.now());
export const today = computed(() => dayKey(now.value));

let app: AppState | null = null;
let syncTimer: ReturnType<typeof setTimeout> | undefined;

export function initState(kv: KV, clock: Clock = systemClock): AppState {
  const store = new LocalStore(kv);
  const engine = new SyncEngine({
    store,
    clock,
    version: APP_VERSION,
    onMerged: (s) => { snapshot.value = s; },
  });
  app = { store, clock, engine };
  snapshot.value = store.readSnapshot();
  dirty.value = store.dirty;
  return app;
}

export function getApp(): AppState {
  if (!app) throw new Error('state not initialised');
  return app;
}

/** Reload from storage (another tab wrote, or after import). */
export function reloadFromStorage() {
  const { store } = getApp();
  snapshot.value = store.readSnapshot();
  dirty.value = store.dirty;
}

/**
 * Apply a change. `mutate` receives a deep copy it may modify freely and the clock.
 * Returns whatever `mutate` returns (e.g. a new record id).
 */
export function commit<T>(mutate: (draft: Snapshot, clock: Clock) => T, opts: { sync?: boolean } = {}): T {
  const { store, clock } = getApp();
  const draft = clone(snapshot.value);
  const result = mutate(draft, clock);
  const written = store.writeSnapshot(draft, { userEdit: true, now: clock.now() });
  if (written.length) {
    snapshot.value = draft;
    dirty.value = store.dirty;
    if (opts.sync !== false) scheduleSync();
  }
  return result;
}

export function scheduleSync(delay = 1200) {
  const { store } = getApp();
  if (!store.token) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => void syncNow(), delay);
}

export async function syncNow(opts: { full?: boolean } = {}): Promise<SyncOutcome> {
  const { engine, store } = getApp();
  clearTimeout(syncTimer);
  syncStatus.value = 'busy';
  const out = await engine.sync(opts);
  if (out.ok) {
    syncStatus.value = 'ok';
    syncMessage.value = `已同步 · 共 ${out.records} 条记录`;
  } else {
    syncStatus.value = out.reason === 'no-token' ? 'no-token' : 'error';
    syncMessage.value = out.message;
  }
  dirty.value = store.dirty;
  return out;
}

/** AI settings: key is local-only, provider is a synced setting. */
export function aiConfig() {
  const { store } = getApp();
  return { key: store.get<string>('qyx_key', ''), provider: snapshot.value.qyx_provider ?? store.get<string>('qyx_provider', '') };
}

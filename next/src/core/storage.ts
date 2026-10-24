import { SYNCED_KEYS, type Snapshot } from './types';

/** Minimal Storage surface (window.localStorage, or the iOS native mirror). */
export interface KV {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Local-only keys. Never synced; token and AI key never leave the device. */
export const META = {
  lastChange: 'qyx_lastchange',
  lastBackup: 'qyx_lastbackup',
  gistId: 'qyx_gistid',
  ghToken: 'qyx_ghtoken',
  aiKey: 'qyx_key',
} as const;

export class LocalStore {
  constructor(private kv: KV) {}

  get<T>(key: string, fallback: T): T {
    try {
      const v = this.kv.getItem(key);
      return v === null ? fallback : (JSON.parse(v) as T);
    } catch {
      return fallback;
    }
  }

  setRaw(key: string, value: unknown) {
    this.kv.setItem(key, JSON.stringify(value));
  }

  readSnapshot(): Snapshot {
    const s: any = {};
    for (const k of SYNCED_KEYS) {
      const v = this.get<unknown>(k, undefined);
      if (v !== undefined) s[k] = v;
    }
    return s;
  }

  /**
   * Persist only keys whose JSON changed. `userEdit` marks the device dirty
   * (qyx_lastchange) so the next sync pushes; merges from the cloud do not.
   */
  writeSnapshot(next: Snapshot, opts: { userEdit: boolean; now: number }): string[] {
    const written: string[] = [];
    for (const k of SYNCED_KEYS) {
      const v = (next as any)[k];
      if (v === undefined) continue;
      const json = JSON.stringify(v);
      if (this.kv.getItem(k) === json) continue;
      this.kv.setItem(k, json);
      written.push(k);
    }
    if (opts.userEdit && written.length) this.setRaw(META.lastChange, opts.now);
    return written;
  }

  get lastChange(): number { return this.get(META.lastChange, 0); }
  get lastBackup(): number { return this.get(META.lastBackup, 0); }
  set lastBackup(v: number) { this.setRaw(META.lastBackup, v); }
  get dirty(): boolean { return this.lastChange > this.lastBackup; }

  get gistId(): string { return this.get(META.gistId, ''); }
  set gistId(v: string) { if (v) this.setRaw(META.gistId, v); else this.kv.removeItem(META.gistId); }
  get token(): string { return this.get(META.ghToken, ''); }
  set token(v: string) { this.setRaw(META.ghToken, v); }
}

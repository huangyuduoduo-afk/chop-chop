import { parseBackup } from './backup';
import type { BackupFile } from './types';

export const BACKUP_FILE = 'chopchop-backup.json';
const API = 'https://api.github.com';

type Fetch = typeof fetch;

export class GistError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

interface GistFile { content?: string; truncated?: boolean; raw_url?: string }
interface GistSummary { id: string; updated_at?: string; files?: Record<string, GistFile> }

export class GistClient {
  constructor(private token: string, private fetchImpl: Fetch = (...a) => fetch(...a)) {}

  private async api<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!this.token) throw new GistError('先填 GitHub token');
    const res = await this.fetchImpl(API + path, {
      ...init,
      headers: {
        Authorization: 'Bearer ' + this.token,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        ...(init.headers || {}),
      },
    });
    if (!res.ok) throw new GistError(res.status === 401 ? 'token 无效或过期' : 'GitHub: ' + res.status, res.status);
    return res.json() as Promise<T>;
  }

  /** Every gist that holds a backup file, newest first (as GitHub lists them). */
  async listBackupGists(maxPages = 3): Promise<string[]> {
    const ids: string[] = [];
    for (let page = 1; page <= maxPages; page++) {
      const list = await this.api<GistSummary[]>(`/gists?per_page=100&page=${page}`);
      list.forEach((g) => { if (g.files && g.files[BACKUP_FILE]) ids.push(g.id); });
      if (list.length < 100) break;
    }
    return ids;
  }

  /** Read the backup; large files come back truncated from the API, so fetch raw_url. */
  private async readFile(file: GistFile | undefined): Promise<BackupFile> {
    if (!file) throw new GistError('云端备份文件不存在');
    let content = file.content || '';
    if ((file.truncated || !content) && file.raw_url) {
      const join = file.raw_url.includes('?') ? '&' : '?';
      const res = await this.fetchImpl(file.raw_url + join + 'nocache=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) throw new GistError('完整云端备份读取失败：' + res.status, res.status);
      content = await res.text();
    }
    return parseBackup(content);
  }

  /** null when the gist no longer exists. */
  async read(id: string): Promise<BackupFile | null> {
    try {
      const g = await this.api<GistSummary>(`/gists/${id}`);
      return await this.readFile(g.files?.[BACKUP_FILE]);
    } catch (e) {
      if (e instanceof GistError && e.status === 404) return null;
      throw e;
    }
  }

  async write(id: string, content: string): Promise<void> {
    await this.api(`/gists/${id}`, { method: 'PATCH', body: JSON.stringify({ files: { [BACKUP_FILE]: { content } } }) });
  }

  async create(content: string): Promise<string> {
    const g = await this.api<GistSummary>('/gists', {
      method: 'POST',
      body: JSON.stringify({ description: 'chop chop! backup', public: false, files: { [BACKUP_FILE]: { content } } }),
    });
    return g.id;
  }

  async revisions(id: string, perPage = 20): Promise<{ version: string; committed_at: string }[]> {
    return this.api(`/gists/${id}/commits?per_page=${perPage}`);
  }

  async readRevision(id: string, version: string): Promise<BackupFile> {
    const g = await this.api<GistSummary>(`/gists/${id}/${version}`);
    return this.readFile(g.files?.[BACKUP_FILE]);
  }
}

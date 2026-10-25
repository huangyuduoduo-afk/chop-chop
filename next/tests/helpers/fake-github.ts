/** In-memory GitHub Gist API, enough for GistClient. Synthetic data only. */
export interface FakeGist { id: string; content: string; history: string[] }

export class FakeGitHub {
  gists = new Map<string, FakeGist>();
  calls: string[] = [];
  private seq = 0;
  /** Files longer than this come back truncated from the API, like real GitHub (1MB). */
  truncateAt = 1_000_000;

  constructor(readonly token = 'synthetic-token') {}

  add(content: string): string {
    const id = 'gist' + ++this.seq;
    this.gists.set(id, { id, content, history: [content] });
    return id;
  }
  read(id: string) { return JSON.parse(this.gists.get(id)!.content); }

  fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input));
    const method = init.method || 'GET';
    this.calls.push(method + ' ' + url.pathname);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (url.host === 'raw.example') {
      const g = this.gists.get(url.pathname.slice(1));
      return g ? new Response(g.content) : new Response('', { status: 404 });
    }
    const auth = new Headers(init.headers).get('Authorization');
    if (auth !== 'Bearer ' + this.token) return json({}, 401);
    const file = (g: FakeGist) => {
      const truncated = g.content.length > this.truncateAt;
      return { 'chopchop-backup.json': { content: truncated ? g.content.slice(0, this.truncateAt) : g.content, truncated, raw_url: `https://raw.example/${g.id}` } };
    };
    const m = url.pathname.match(/^\/gists(?:\/([^/]+))?$/);
    if (!m) return json({}, 404);
    const id = m[1];
    if (!id && method === 'GET') {
      if (url.searchParams.get('page') && url.searchParams.get('page') !== '1') return json([]);
      return json([...this.gists.values()].reverse().map((g) => ({ id: g.id, files: { 'chopchop-backup.json': {} } })));
    }
    if (!id && method === 'POST') {
      const body = JSON.parse(String(init.body));
      const newId = this.add(body.files['chopchop-backup.json'].content);
      return json({ id: newId }, 201);
    }
    const g = this.gists.get(id!);
    if (!g) return json({}, 404);
    if (method === 'GET') return json({ id: g.id, files: file(g) });
    if (method === 'PATCH') {
      const body = JSON.parse(String(init.body));
      g.content = body.files['chopchop-backup.json'].content;
      g.history.push(g.content);
      return json({ id: g.id, files: file(g) });
    }
    return json({}, 405);
  };
}

export class MemoryKV {
  map = new Map<string, string>();
  getItem(k: string) { return this.map.has(k) ? this.map.get(k)! : null; }
  setItem(k: string, v: string) { this.map.set(k, v); }
  removeItem(k: string) { this.map.delete(k); }
}

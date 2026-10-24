/*
 * AI calls. Only ever on an explicit user action. Same providers, models and request
 * shapes as 5.1.3.1: DeepSeek (default) or Anthropic, key from local-only `qyx_key`,
 * provider from `qyx_provider`.
 */
export type Provider = 'deepseek-v4-pro' | 'deepseek-v4-flash' | 'anthropic' | string;
export interface AiMessage { role: 'user' | 'assistant'; content: string }
export interface AiOptions { thinking?: boolean; maxTokens?: number; signal?: AbortSignal }
export interface AiResult { text: string; truncated: boolean }

export function normalizeProvider(saved: string | null | undefined): Provider {
  const p = saved || 'deepseek-v4-pro';
  return p === 'deepseek' ? 'deepseek-v4-flash' : p === 'deepseek-r1' ? 'deepseek-v4-pro' : p;
}

export class AiError extends Error {}

export async function runAI(
  cfg: { provider: string | null | undefined; key: string },
  system: string,
  messages: AiMessage[],
  opts: AiOptions = {},
  fetchImpl: typeof fetch = (...a) => fetch(...a),
): Promise<AiResult> {
  const provider = normalizeProvider(cfg.provider);
  if (provider === 'deepseek-v4-flash' || provider === 'deepseek-v4-pro') {
    if (!cfg.key) throw new AiError('DeepSeek 需要在设置里填 key');
    const res = await fetchImpl('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      signal: opts.signal,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.key },
      body: JSON.stringify({
        model: provider,
        thinking: { type: opts.thinking ? 'enabled' : 'disabled' },
        max_tokens: opts.maxTokens || 600,
        messages: [{ role: 'system', content: system }, ...messages],
      }),
    });
    const data = await res.json();
    if (data.error) throw new AiError(data.error.message || 'API 错误');
    const choice = data.choices?.[0] || {};
    return { text: (choice.message?.content || '').trim(), truncated: choice.finish_reason === 'length' };
  }
  if (!cfg.key) throw new AiError('需要在设置里填 AI key');
  const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal: opts.signal,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': cfg.key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: opts.maxTokens || 300, system, messages }),
  });
  const data = await res.json();
  if (data.error) throw new AiError(data.error.message || 'API 错误');
  const text = (data.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('').trim();
  return { text, truncated: data.stop_reason === 'max_tokens' };
}

/** User-facing error text, with the provider/key mismatch hint legacy showed. */
export function aiErrorText(e: unknown): string {
  const m = (e as Error)?.message || String(e);
  return '没连上：' + m + (/invalid x-api-key/i.test(m) ? '（key 和服务对不上——设置里把「服务」切到对应家）' : '');
}

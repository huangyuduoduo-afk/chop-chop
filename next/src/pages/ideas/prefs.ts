/* View preferences (local only), same key as 5.x: qyx_v51_view. */
export interface ViewPrefs {
  order: 'recent' | 'oldest-update' | 'created-new' | 'created-old';
  detailOrder: 'oldest' | 'newest';
  detailFrom: string;
  detailTo: string;
  detailKind: 'all' | 'plan';
}
const KEY = 'qyx_v51_view';
const DEFAULTS: ViewPrefs = { order: 'recent', detailOrder: 'oldest', detailFrom: '', detailTo: '', detailKind: 'all' };

export function readPrefs(): ViewPrefs {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    const out = { ...DEFAULTS, ...(v && typeof v === 'object' ? v : {}) };
    if (out.detailKind !== 'plan') out.detailKind = 'all'; // 5.x "含图片" matched nothing; treat as all
    return out;
  } catch { return { ...DEFAULTS }; }
}
export function writePrefs(patch: Partial<ViewPrefs>): ViewPrefs {
  const next = { ...readPrefs(), ...patch };
  try {
    const old = JSON.parse(localStorage.getItem(KEY) || 'null');
    localStorage.setItem(KEY, JSON.stringify({ ...(old && typeof old === 'object' ? old : {}), ...next }));
  } catch { /* ignore */ }
  return next;
}

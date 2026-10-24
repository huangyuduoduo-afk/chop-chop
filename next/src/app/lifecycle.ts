/*
 * When to sync and when to pick up a new version. Mirrors legacy triggers:
 * boot, back to foreground (≥30 s apart), leaving with unsynced edits, coming online,
 * edits in other tabs.
 */
import { APP_VERSION, getApp, now, reloadFromStorage, scheduleSync, syncNow } from './state';

let lastForegroundSync = 0;
let lastUpdateCheck = 0;

export function startLifecycle(opts: { hasUnsavedDraft: () => boolean }) {
  const { store } = getApp();
  void syncNow({ full: true });

  document.addEventListener('visibilitychange', () => {
    if (!store.token) return;
    if (document.visibilityState === 'visible') {
      now.value = Date.now();
      if (Date.now() - lastForegroundSync > 30_000) {
        lastForegroundSync = Date.now();
        void syncNow();
      }
      void checkUpdate(opts.hasUnsavedDraft);
    } else if (store.dirty) {
      void syncNow();
    }
  });
  window.addEventListener('online', () => scheduleSync(500));
  window.addEventListener('storage', (e) => { if (e.key && e.key.startsWith('qyx_')) reloadFromStorage(); });
  setInterval(() => { now.value = Date.now(); }, 60_000);
}

/** Reload when the deployed page carries a different APP_VERSION and nothing is being typed. */
async function checkUpdate(hasUnsavedDraft: () => boolean) {
  if (Date.now() - lastUpdateCheck < 60_000) return;
  lastUpdateCheck = Date.now();
  try {
    const res = await fetch(location.pathname + '?nocache=' + Date.now(), { cache: 'no-store' });
    const m = (await res.text()).match(/APP_VERSION\s*=\s*"([^"]+)"/);
    if (!m || m[1] === APP_VERSION) return;
    if (hasUnsavedDraft() || document.querySelector('.sheet-bg')) return;
    if (sessionStorage.getItem('qyx_reload_for') === m[1]) return;
    sessionStorage.setItem('qyx_reload_for', m[1]);
    await syncNow();
    location.reload();
  } catch { /* offline: try again next time */ }
}

/* Hash router: #/today, #/ideas/<ideaId>, … Keeps the back button and reloads on the same page. */
import { signal } from '@preact/signals';

export type PageId = 'ideas' | 'today' | 'record' | 'goals' | 'sea' | 'settings';
export const PAGES: { id: PageId; label: string; icon: 'inbox' | 'sun' | 'pen' | 'target' | 'bottle' }[] = [
  { id: 'ideas', label: '消息盒子', icon: 'inbox' },
  { id: 'today', label: '今天', icon: 'sun' },
  { id: 'record', label: '说说', icon: 'pen' },
  { id: 'goals', label: '目标', icon: 'target' },
  { id: 'sea', label: '瓶子', icon: 'bottle' },
];
export const DEFAULT_PAGE: PageId = 'record';

export interface Route { page: PageId; params: string[] }

function parse(hash: string): Route {
  const [page, ...params] = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const known = ['ideas', 'today', 'record', 'goals', 'sea', 'settings'];
  return known.includes(page) ? { page: page as PageId, params } : { page: DEFAULT_PAGE, params: [] };
}

export const route = signal<Route>(parse(typeof location === 'undefined' ? '' : location.hash));

export function navigate(page: PageId, ...params: string[]) {
  const hash = '#/' + [page, ...params].map(encodeURIComponent).join('/');
  if (location.hash !== hash) location.hash = hash;
  else route.value = parse(hash);
}

export function startRouter() {
  window.addEventListener('hashchange', () => {
    route.value = parse(location.hash);
    window.scrollTo(0, 0);
  });
}

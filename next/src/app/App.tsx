import { Icon } from '../ui/icons';
import { DialogHost, ToastHost, confirmAsk } from '../ui/kit';
import IdeasPage from '../pages/ideas';
import TodayPage from '../pages/today';
import RecordPage from '../pages/record';
import GoalsPage from '../pages/goals';
import SeaPage from '../pages/sea';
import SettingsPage from '../pages/settings';
import { PAGES, navigate, route, type PageId } from './router';
import { IS_PREVIEW, dirty, syncMessage, syncNow, syncStatus } from './state';
import { seedDemo } from '../dev/seed';
import './app.css';

const VIEWS: Record<PageId, () => preact.JSX.Element> = {
  ideas: IdeasPage, today: TodayPage, record: RecordPage, goals: GoalsPage, sea: SeaPage, settings: SettingsPage,
};

function SyncButton() {
  const st = syncStatus.value;
  const label = st === 'busy' ? '正在同步' : st === 'error' ? '同步失败：' + syncMessage.value
    : st === 'no-token' ? '还没连上云端' : dirty.value ? '有改动未同步' : syncMessage.value || '同步';
  return (
    <button type="button" class={`sync-btn ${st} ${dirty.value ? 'dirty' : ''}`} aria-label={label} title={label}
      onClick={() => (st === 'no-token' ? navigate('settings') : void syncNow({ full: true }))}>
      <Icon name="sync" size={19} />
    </button>
  );
}

export function App() {
  const r = route.value;
  const View = VIEWS[r.page];
  return (
    <div class="shell">
      <header class="topbar">
        <a class="wordmark" href="#/record" aria-label="chop chop 首页">chop chop<b>!</b></a>
        <div class="topbar-actions">
          <SyncButton />
          <button type="button" class="icon-btn" aria-label="设置" onClick={() => navigate('settings')}><Icon name="gear" /></button>
        </div>
      </header>
      {IS_PREVIEW && (
        <div class="preview-banner" role="note">
          <span>预览版 · 示例数据 · 不连云端</span>
          <button type="button" onClick={async () => {
            if (await confirmAsk('恢复示例数据？', '预览里的改动会被清掉。正式数据不受影响。')) { seedDemo(); location.reload(); }
          }}>恢复示例</button>
        </div>
      )}
      <main class="page" id={'page-' + r.page}>
        <View />
      </main>
      <nav class="tabbar" aria-label="主导航">
        {PAGES.map((p) => (
          <a href={'#/' + p.id} class={r.page === p.id ? 'on' : ''} aria-current={r.page === p.id ? 'page' : undefined}>
            <Icon name={p.icon} size={21} />
            <span>{p.label}</span>
          </a>
        ))}
      </nav>
      <ToastHost />
      <DialogHost />
    </div>
  );
}

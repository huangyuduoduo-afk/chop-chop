import { render } from 'preact';
import './ui/tokens.css';
import { App } from './app/App';
import { startLifecycle } from './app/lifecycle';
import { startRouter } from './app/router';
import { IS_PREVIEW, initState } from './app/state';
import { seedDemo } from './dev/seed';
import { hasUnsavedDraft } from './app/drafts';
import { startHousekeeping } from './app/housekeeping';
import { startPhotoUploads } from './app/photos';

const hasData = () => { try { return localStorage.getItem('qyx_log') !== null; } catch { return false; } };
if (IS_PREVIEW && !hasData()) seedDemo();
if (import.meta.env.DEV && new URLSearchParams(location.search).get('seed') === 'demo') {
  seedDemo();
  history.replaceState(null, '', location.pathname + location.hash);
}
initState(window.localStorage);
startRouter();
render(<App />, document.getElementById('app')!);
startLifecycle({ hasUnsavedDraft });
startHousekeeping();
startPhotoUploads();

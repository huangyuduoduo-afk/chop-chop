import { render } from 'preact';
import './ui/tokens.css';
import { App } from './app/App';
import { startLifecycle } from './app/lifecycle';
import { startRouter } from './app/router';
import { initState } from './app/state';
import { hasUnsavedDraft } from './app/drafts';
import { startHousekeeping } from './app/housekeeping';

if (import.meta.env.DEV && new URLSearchParams(location.search).get('seed') === 'demo') {
  const { seedDemo } = await import('./dev/seed');
  seedDemo();
  history.replaceState(null, '', location.pathname + location.hash);
}
initState(window.localStorage);
startRouter();
render(<App />, document.getElementById('app')!);
startLifecycle({ hasUnsavedDraft });
startHousekeeping();

/* Settings area: #/settings, #/settings/export[/<day>], #/settings/tags[/<tagId>]. */
import { route } from '../../app/router';
import ExportCenter from './ExportCenter';
import SettingsMain from './SettingsMain';
import { TagDetail, TagLibrary } from './TagLibrary';

export default function SettingsPage() {
  const [sub, arg] = route.value.params;
  if (sub === 'export') return <ExportCenter presetDay={arg} />;
  if (sub === 'tags') return arg ? <TagDetail tagId={arg} /> : <TagLibrary />;
  return <SettingsMain />;
}

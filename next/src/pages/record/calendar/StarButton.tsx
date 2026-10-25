/* Small star toggle on a record (精选). Only on things she wrote or finished, never on ai/dice rows. */
import { commit } from '../../../app/state';
import { toggleStar } from '../../../domain/moments';
import type { LogEntry } from '../../../core/types';
import { Icon } from '../../../ui/icons';

const STARRABLE = new Set(['note', 'done', 'bonus']);

export function StarButton({ record }: { record: LogEntry }) {
  if (!record.id || !STARRABLE.has(record.type)) return null;
  const on = !!record.starredAt;
  return (
    <button
      type="button"
      class={`star-btn ${on ? 'on' : ''}`}
      aria-pressed={on}
      aria-label={on ? '取消精选' : '设为精选'}
      title={on ? '取消精选' : '设为精选'}
      onClick={() => commit((d, c) => toggleStar(d, record.id!, c))}
    >
      <Icon name="star" size={20} />
    </button>
  );
}

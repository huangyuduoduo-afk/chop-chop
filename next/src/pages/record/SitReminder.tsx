import { commit, snapshot, today } from '../../app/state';
import { sitHabit, tapSitReminder } from '../../domain/goals';
import { toast } from '../../ui/kit';

/** 久坐提醒: a small nudge at the bottom of 说说; counts today on the first walking-type habit. */
export function SitReminder() {
  const s = snapshot.value;
  const text = typeof s.qyx_sit_reminder === 'string' && s.qyx_sit_reminder.trim() ? s.qyx_sit_reminder : '站起来走走';
  const n = (sitHabit(s)?.counts || {})[today.value] || 0;
  return (
    <aside class="sit-reminder" aria-label="久坐提醒">
      <span class="sit-label">久坐提醒</span>
      <p>{n ? `今天已经活动 ${n} 次，身体会记得。` : '坐久了，身体也想换口气。'}</p>
      <button type="button" class="btn btn-soft btn-sm" onClick={() => { commit((d, c) => tapSitReminder(d, c)); toast('好，起来动一动。'); }}>{text}</button>
    </aside>
  );
}

/* Bonus · 想挑战就写一个 */
import { commit, getApp, snapshot } from '../../app/state';
import * as T from '../../domain/today';
import { Card, Check } from '../../ui/kit';
import { SavedInput } from './SavedInput';

export function BonusCard() {
  const s = snapshot.value;
  const clock = getApp().clock;
  const items = s.qyx_bonus && !T.bonusNeedsEnsure(s, clock) ? s.qyx_bonus.items : [{ text: '', done: false }, { text: '', done: false }];
  const holders = ['比如：收拾房间', '第二个（可不写）'];
  return (
    <Card title="Bonus · 想挑战就写一个" sub="做不做都可以。" icon="star" tone="star" class="bonus-card">
      {items.map((it, i) => (
        <div class="erow-main">
          <Check checked={it.done} label={it.text.trim() ? `${it.text}：${it.done ? '已完成' : '点一下标记完成'}` : `Bonus ${i + 1}：先写下来`}
            onToggle={() => { commit((d, c) => T.toggleBonus(d, i, c)); }} />
          <SavedInput class={`today-input ${it.done ? 'is-done' : ''}`} value={it.text} placeholder={holders[i]} aria-label={`Bonus ${i + 1}`} maxLength={200}
            onSave={(v) => { commit((d, c) => T.setBonusText(d, i, v, c)); }} />
        </div>
      ))}
    </Card>
  );
}

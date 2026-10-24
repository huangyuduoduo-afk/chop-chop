/* 设置: 保存 (dice pool, sit reminder, provider) vs legacy button. Run with TZ=Asia/Shanghai. */
import { DEFAULT_DICE } from '../src/core/merge';
import { saveSettings, parsePoolText, currentDicePool } from '../src/domain/settings';
import { isDead } from '../src/domain/shared';
import { actionParity, fixedClock, T0 } from './helpers/parity';

const legacySave = (w: any, v: { provider: string; sit: string; pool: string }) => {
  const $ = (id: string) => w.document.getElementById(id);
  $('gearBtn').click();
  $('provider').value = v.provider;
  $('sitReminderText').value = v.sit;
  $('dicePool').value = v.pool;
  $('saveSettings').click();
};
const maskTimes = (b: any) => { (b.qyx_dead || []).forEach((x: any) => { x.t = 0; }); };

describe('settings save matches legacy', () => {
  it('custom pool: removed entries buried, new ones unburied', async () => {
    const local = {
      qyx_dice: ['合成 动作甲', '合成 动作乙', '合成 动作丙'],
      qyx_dead: [{ s: 'dice', v: '合成 动作丁', t: T0 - 1000 }],
      qyx_sit_reminder: '合成 旧提醒',
    };
    const r = await actionParity({
      local,
      legacy: (w) => legacySave(w, { provider: 'anthropic', sit: '  合成 喝水  ', pool: '合成 动作甲\n\n  合成 动作丁 \n合成 动作戊' }),
      next: (d, c) => saveSettings(d, { provider: 'anthropic', sitReminder: '  合成 喝水  ', dicePool: parsePoolText('合成 动作甲\n\n  合成 动作丁 \n合成 动作戊') }, c),
      mask: maskTimes,
    });
    expect(r.errors).toEqual([]);
    expect(r.diffs).toEqual([]);
    expect((r.next as any).qyx_dice).toEqual(['合成 动作甲', '合成 动作丁', '合成 动作戊']);
  });

  it('device that never saved a pool starts from the 8 defaults; blank reminder falls back', async () => {
    const r = await actionParity({
      local: { qyx_log: [] },
      legacy: (w) => legacySave(w, { provider: 'deepseek-v4-flash', sit: '', pool: DEFAULT_DICE.slice(0, 3).join('\n') }),
      next: (d, c) => saveSettings(d, { provider: 'deepseek-v4-flash', sitReminder: '', dicePool: DEFAULT_DICE.slice(0, 3) }, c),
      mask: maskTimes,
    });
    expect(r.diffs).toEqual([]);
    expect((r.next as any).qyx_sit_reminder).toBe('站起来走走');
    expect((r.next as any).qyx_dead.filter((x: any) => x.s === 'dice')).toHaveLength(5);
  });
});

describe('deviation: clearing the pool restores defaults AND unburies them', () => {
  it('legacy leaves buried defaults buried; next does not', async () => {
    const local = { qyx_dice: [DEFAULT_DICE[0], '合成 动作甲'] };
    const r = await actionParity({
      local,
      legacy: (w) => legacySave(w, { provider: 'deepseek-v4-pro', sit: '', pool: '' }),
      next: (d, c) => saveSettings(d, { provider: 'deepseek-v4-pro', sitReminder: '', dicePool: [] }, c),
      mask: maskTimes,
    });
    expect((r.legacy as any).qyx_dice).toEqual(DEFAULT_DICE);
    expect((r.next as any).qyx_dice).toEqual(DEFAULT_DICE);
    expect((r.legacy as any).qyx_dead.some((x: any) => x.v === DEFAULT_DICE[0])).toBe(true); // the legacy bug
    expect((r.next as any).qyx_dead.some((x: any) => x.v === DEFAULT_DICE[0])).toBe(false); // fixed
    expect((r.next as any).qyx_dead.some((x: any) => x.v === '合成 动作甲')).toBe(true);
    // everything else is identical
    expect(r.diffs.filter((d) => !d.startsWith('.qyx_dead'))).toEqual([]);
  });

  it('pure helpers', () => {
    const d: any = { qyx_dice: null };
    expect(currentDicePool(d)).toEqual(DEFAULT_DICE);
    saveSettings(d, { provider: 'anthropic', sitReminder: ' x ', dicePool: ['合成 a'] }, fixedClock());
    expect(d.qyx_dice).toEqual(['合成 a']);
    expect(d.qyx_sit_reminder).toBe('x');
    expect(isDead(d, 'dice', DEFAULT_DICE[0])).toBe(true);
  });
});

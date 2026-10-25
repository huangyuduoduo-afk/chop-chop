/*
 * Once-a-day data chores that legacy ran at boot and at day rollover.
 * Each runs inside commit only when it would change something.
 */
import { effect } from '@preact/signals';
import { planDailySummary, storeSummary } from '../domain/sea';
import { commit, getApp, snapshot, today } from './state';

export function startHousekeeping() {
  effect(() => {
    today.value; // re-run on day change
    const plan = planDailySummary(snapshot.peek(), getApp().clock);
    if (!plan) return;
    // Legacy also asked the AI for a one-line observation here, unprompted. AI now runs only on
    // an explicit tap, so the summary is stored without it (`obs: ''`, a shape legacy also writes
    // when the AI call fails).
    commit((d) => storeSummary(d, plan.yk, plan.sum));
  });
}

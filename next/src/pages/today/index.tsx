/* 今天: 三件事 → 安排到这一天 → Bonus → 问一问 → 交给随机. */
import { useEffect } from 'preact/hooks';
import { commit, getApp, now, snapshot, today } from '../../app/state';
import * as T from '../../domain/today';
import { AskCard } from './Ask';
import { BonusCard } from './Bonus';
import { PlansCard } from './Plans';
import { RandomCard } from './Random';
import { ThreeCard } from './Three';
import './today.css';

/** Everything that must be true before the page is drawn; true = something would be written. */
function needsWork(s: ReturnType<typeof snapshot.peek>, clock: ReturnType<typeof getApp>['clock']): boolean {
  return T.enoughNeedsEnsure(s, clock) || T.bonusNeedsEnsure(s, clock) || T.drawersNeedSeed(s, clock) || T.reconcileToday(s, clock, false);
}

export default function TodayPage() {
  const snap = snapshot.value;
  const day = today.value;
  now.value;
  const clock = getApp().clock;

  // Day change / first view: roll over, seed, and pull plan / idea changes into today's rows.
  // Commits only when that really changes data, so just looking at the page never marks the device dirty.
  useEffect(() => {
    if (!needsWork(snapshot.peek(), clock)) return;
    commit((d, c) => {
      T.ensureEnough(d, c);
      T.ensureBonus(d, c);
      if (T.drawersNeedSeed(d, c)) T.ensureDrawers(d, c);
      T.reconcileToday(d, c);
    });
  }, [day, snap]);

  return (
    <>
      <header class="page-title">
        <h1>今天</h1>
        <p>先理清，再把注意力放回眼前。</p>
      </header>
      <ThreeCard />
      <PlansCard />
      <BonusCard />
      <AskCard />
      <RandomCard />
    </>
  );
}

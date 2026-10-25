# Brief for agents building Chopchop 6.x pages

Worktree: `/Users/xixi/Documents/Codex/2026-07-19/new-chat/work/chop-chop-next` (branch `claude/next`).
New app lives in `next/` (Vite + Preact + @preact/signals + TypeScript). Legacy app = `legacy/index.html`
+ `legacy/assets/v5.js` (served at /legacy/ as a fallback) — read it, never edit it.

## Hard rules
- Edit only the paths your task assigns. Never edit `next/src/core/**`, `next/src/ui/**`,
  `next/src/app/**`, `next/src/domain/shared.ts`, other areas' folders, or legacy files. Need
  something shared changed? Put a local version in your folder and say so in your report.
- No git commands. No network calls. No real user data — synthetic text only (e.g. `合成记录 3`).
- Never print or write secrets.

## Read first
1. `next/docs/DATA-CONTRACT.md` — wire format promise; old clients keep writing the same Gist.
2. Your area spec in `next/docs/features/*.md` (exhaustive inventory of the legacy features,
   data effects, file:line refs, OBSERVATIONS = known legacy bugs).
3. `next/src/core/types.ts`, `next/src/domain/shared.ts` (bury/unbury/isDead, addLog, tags),
   `next/src/core/merge.ts` (enough/today helpers are exported there),
   `next/src/app/state.ts` (`snapshot`, `commit`, `today`, `now`, `aiConfig`),
   `next/src/app/drafts.ts` (`useDraft` — use for every free-text input worth keeping),
   `next/src/app/router.ts` (`navigate`, `route.value.params`),
   `next/src/ui/kit.tsx` + `kit.css` + `tokens.css` + `icons.tsx`, `next/src/core/ai.ts`.

## Architecture
- **Domain** `next/src/domain/<area>.ts`: pure functions `(draft: Snapshot, args…, clock: Clock) => result`
  that mutate the draft. All data writes live here. No DOM, no storage, no `Date.now()` — use `clock`.
- **Pages** `next/src/pages/<area>/`: Preact components that read `snapshot.value` and call
  `commit((d, c) => domainFn(d, …, c))`. `index.tsx` default-exports the page. Page CSS goes in a
  `.css` file next to it, imported by the component, using tokens only (no raw colours).
- AI: `runAI(aiConfig(), system, messages, opts)` from `core/ai.ts`, only on explicit user taps.
  Await the AI, then `commit` the result. Show `aiErrorText(e)` on failure; never save a fallback
  text as if it were an AI result.

## Data parity (required)
For every action that writes data, add a test in `next/tests/<area>-parity.test.ts` using
`next/tests/helpers/parity.ts` → `actionParity({ local, legacy: w => …, next: (d, c) => …, mask })`.
Drive legacy by calling its functions via `w.eval('…')` (top-level `let`/`const` like `log`,
`enough` are reachable through `w.eval`) or by setting inputs and clicking its buttons in `w.document`.
`diffs` must be `[]`; mask only values that legitimately differ (generated ids, timestamps).
See `next/tests/shared-parity.test.ts` for the pattern.
Deliberate fixes of OBSERVATIONS are allowed only if old clients can still merge the result;
assert the new behaviour in the test and list each one in your report.

## Product principles (the owner decided these — don't re-ask)
- Recording comes first: low friction, saving must be reliable. Don't force notes into tasks.
- 消息盒子: one idea = one card, by time, filter/sort; tapping opens that idea's full timeline.
  Later updates never become separate cards.
- Low-frequency actions (edit, delete, move, tag, link…) live in the "…" `Menu`, not as always-visible buttons.
- Soft, rounded, clean: blue-white base, pink/star accents sparingly. No green/orange leftovers.
- No new features beyond the spec. Keep existing Chinese wording unless it is clearly broken.
- Mobile first: 375px wide, 16px gutter, no horizontal scroll, touch targets ≥ 38px, aria labels.
- Data with zero real-world use (`qyx_polish_history`, `qyx_rules`, `qyx_bench` are empty in
  production) may get a minimal UI or be tucked away — but their data must still merge.

## Done means
`cd next && npx tsc --noEmit` clean · `TZ=Asia/Shanghai npx vitest run tests/<yours>` green ·
`npx vite build` ok. Report (≤300 words): files, deviations from legacy, anything skipped, questions.

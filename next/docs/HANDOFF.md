# Chopchop — handoff for the next session

Read this first, then only the files the task needs. Keep sessions short and task-sized.

## Where things are
- Repo `huangyuduoduo-afk/chop-chop` (public code, no user data). GitHub Pages serves `main` at `/`.
- App source: `next/` (Vite + Preact + signals + TS). Root `index.html` + `assets/` = release build.
  5.1.3.1 kept at `/legacy/` as fallback (never edit; tests use it as the reference implementation).
- Local worktree: `/Users/xixi/Documents/Codex/2026-07-19/new-chat/work/chop-chop-next`.
  The older `chop-chop-v3-production` checkout is stale — don't commit from it.
- Data: browser localStorage `qyx_*` ↔ private Gists holding `chopchop-backup.json` (two exist: web +
  iOS; clients merge siblings). Photos: private repo `chopchop-photos` via the GitHub contents API.

## Docs (read the one you need)
- `next/docs/DATA-CONTRACT.md` — wire format, merge rules, deliberate deviations. Read before touching data.
- `next/docs/AGENT-BRIEF.md` — rules for subagents building UI (parity tests, file ownership).
- `next/docs/features/*.md` — legacy feature inventories + the 6.1 photos/calendar spec.
- `next/docs/CUTOVER.md` — release and rollback.

## Commands (run in `next/`)
- Tests: `TZ=Asia/Shanghai npx vitest run` (≈1.2k tests; parity tests boot the legacy app in jsdom).
- Real GitHub (opt-in): `REAL_GH_TOKEN="$(gh auth token)" npx vitest run tests/real-github.test.ts tests/real-photos.test.ts`
  — uses file `chopchop-TEST-synthetic.json`; **never** create a test gist containing `chopchop-backup.json`
  (every client merges all such gists into real data).
- Dev: `npx vite` then open `/?seed=demo` (synthetic data). Preview artifact: `node tools/build-preview.mjs <file>`.
- Release: bump `version` in `package.json`, `node tools/release.mjs`, commit on a branch, PR into `main`.
  Merging = production; the owner confirms each release.

## Owner's standing rules
- Minimal interruptions; ask only at real decisions, batched. Release to production only after her yes.
- Never print/commit tokens or her record text. Read production data only as structure/counts.
- Never write production gists without explicit OK. Backups: `~/Documents/Chopchop备份/<date>/`.
- AI only on explicit taps; photos never go to AI. Low-frequency actions live in "…". Calm, soft UI.
- Save tokens: Sonnet subagents for UI/bulk work, the main model for data/sync design and review.

## Open items (2026-10-25)
1. iOS app (`chopchop-ios` worktree, branch `codex/chopchop-ios-personal`, Capacitor 8) still wraps
   5.1.3.2 by string-patching the legacy `index.html` (`mobile/scripts/prepare-web.mjs`). Either retire it
   in favour of the home-screen web app, or rebuild its web layer from `next/dist` (native storage
   mirror, Keychain token, native voice/share/tab bar must be re-hooked; install needs her iPhone).
2. Confirm the first real photo upload landed in `chopchop-photos` (settings → 图片 card shows 0 pending).
3. Day view rows are compact (no tags/tasks/idea chip); 「去写一笔」 doesn't focus the composer.
4. `ideas.ts` and `today.ts` each keep a today-mirror reconcile (both parity-tested) — could be unified.

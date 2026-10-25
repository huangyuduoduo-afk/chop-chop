# 6.0 cutover runbook

GitHub Pages serves branch `main`, path `/` (legacy build type). The release puts the 6.x build
at the repo root and keeps the 5.1.3.1 app at `/legacy/`. Both run on the same origin, so they share
localStorage (records, drafts, token) and write the same Gist in the same format.

## Before
1. Owner's go-ahead (production change).
2. Full backup of both production gists to a local folder the owner owns (read-only fetch, no writes).
3. `node next/tools/release.mjs` → `index.html`, `assets/index-*.{js,css}`, icons, `recovery.html`,
   `.nojekyll` at the root. `APP_VERSION = "6.0.0"` must appear in `index.html`.
4. Tests green: `cd next && TZ=Asia/Shanghai npx vitest run`.

## Switch
- Merge the release PR into `main` (squash). Pages rebuilds in ~1 min.
- Open 5.x pages poll `index.html` for `APP_VERSION`, see `6.0.0`, sync, then reload into 6.0
  (only when no draft is being typed and no dialog is open).

## Rehearsed locally (2026-10-25, same origin, synthetic data)
1. 5.1.3.1 served at `/chop-chop/` wrote a note.
2. Site swapped to the release; the open 5.x page's own update check reloaded it into 6.0.0 and the
   note was there.
3. A note written in 6.0 showed up in `/legacy/` (5.1.3.1), which stays on 5.1.3.1. No console errors.

## After
- Open the site on phone and computer; check records count, today's three, ideas, a fresh note
  synced to the other device.
- iOS app keeps working on 5.1.3.2 against the same Gist until it is rebuilt from 6.x.

## Rollback
- Immediate: open `/legacy/` — the old app on the same data.
- Full: revert the merge commit on `main`. No data migration happened, so nothing to undo in data.
  Gist revision history keeps every pushed version.

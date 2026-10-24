# Chopchop data contract (6.x rewrite)

The rewrite keeps the existing data format **unchanged**. Old clients — web 5.1.3.x and the
iOS app 5.1.3.2-ios — keep reading and writing the same Gist file during and after cutover,
so everything below is a compatibility promise, not a design choice we can revisit freely.

Source of truth for shapes: `src/core/types.ts`. Merge rules: `src/core/merge.ts`.

## Storage

- localStorage keys `qyx_*`, JSON-encoded. Synced set = legacy `BACKUP_KEYS` (27 keys)
  + `qyx_ideas_v5` + `qyx_daily_review_v51`.
- Local-only: `qyx_ghtoken`, `qyx_key` (never leave the device), `qyx_gistid`,
  `qyx_lastchange` / `qyx_lastbackup` (dirty = lastchange > lastbackup), UI prefs.
- Gist file `chopchop-backup.json`, private gist. Body = all synced keys (missing → `null`)
  + `_exported`, `_ver`, `_schema: 5`. Large files come back truncated from the API;
  read `raw_url`.
- There may be several gists holding the file (currently two: one written by iOS, one by
  web). Each device keeps its own `qyx_gistid` and folds in up to 3 siblings on its first
  sync per session and on manual sync, so they converge.

## Rules that must hold

1. **Never shrink silently.** Merge is a union; removal only happens through a tombstone
   in `qyx_dead` (`{s: scope, v: value, t}`). Sync refuses to push if a live remote record
   is missing from the merged result (`findLoss`).
2. **Stable identity.** Log records are keyed by `id` (`logKey`). Edits keep the id and bump
   `updatedAt`; `t` (creation time) never changes. Newer `updatedAt || t` wins.
3. **Unbury on add.** Any path that (re)creates a value in a text-keyed scope (opt, dice,
   rule, habit, anchor:<ym>, split:<goal>, esub:<day>, ohist) must remove a matching
   tombstone first, otherwise the next merge drops it.
4. **Today's three** (`qyx_enough`) rows may mirror a v5 checklist task (`v5TaskId`) or idea
   (`v5IdeaId`). The mirror is reconciled by newer `updatedAt` (`statusUpdatedAt` for ideas).
   Old clients rely on these fields; keep writing them.
5. **v5 ideas** (`qyx_ideas_v5`): rows merged by `id`, newer `updatedAt` wins, tie →
   lexically larger JSON. Soft delete via `removedAt`. Ids and refs must match `/^[-\w:.]+$/`.
6. Day boundaries use **local time** (`dayKey`).

## Deliberate deviations from legacy (all wire-compatible)

| # | Legacy behaviour | 6.x behaviour | Switch |
|---|---|---|---|
| D1 | Tombstones filtered only the *remote* side for log, opts, bench, dice, ongoing, rules, month goals/splits — a deletion on one device never removed the copy on another, which kept re-pushing it. | Tombstones also remove the local copy. | `MergeOptions.filterLocalTombstones` (default on) |
| D2 | A sync requested while one is running was dropped. | Queued: one follow-up run. | — |
| D3 | No safety check before upload. | Loss guard (rule 1). | — |
| D4 | A newer Today row mirrored onto an idea could be silently reverted: if the idea's `updatedAt` was already ≥ the row's, the follow-up merge picked the stale copy by JSON tie-break (outcome depended on the text). | The idea's `updatedAt` strictly increases when the mirror applies, so the newer status wins everywhere. | `MergeOptions.strictIdeaMirror` (default on) |

`LEGACY_MERGE_OPTIONS` turns all switches off and reproduces 5.1.3.1 exactly; parity tests use it.
Known legacy quirk kept as-is: legacy's `changed` flag can be `true` with identical data (same root
cause as D4); the port reports `changed` from a data comparison.

## Verification

- `tests/oracle.test.ts` — the legacy app runs headless in jsdom as an executable oracle
  (`tools/legacy-oracle.mjs`).
- `tests/merge-diff.test.ts` — randomized synthetic states: new merge must equal legacy merge
  (D1 off), and with D1 on every difference must be explained by a tombstone.
- `tests/sync.test.ts` — fake GitHub; new devices and a real-legacy device share a Gist.
- `tests/real-data.test.ts` — opt-in, prints only paths/counts. 2026-10-24: both production
  backups (1371 records) merged in both directions → 0 differing paths vs legacy.

## Cutover notes

- Old open pages poll `index.html` for `APP_VERSION = "…"` and reload when it changes; the new
  build must keep that literal in its HTML so stale tabs pick up the new app.
- The iOS app's `mobile/scripts/prepare-web.mjs` string-patches the legacy `index.html`;
  it has to be pointed at the new build before the iOS app can move to 6.x.
- 3 synthetic test records exist in production `qyx_log` (`r21-synthetic-record`,
  `v513-ai-synthetic-1/2`). Removing them is a production write — needs the owner's OK.

## Behaviour changes in the 6.x pages (all wire-compatible, each asserted in tests)

- 说说/消息盒子: "作为新想法" works (was broken); editing keeps the record id; deleting a record also
  soft-removes its idea links and checklist tasks; one owner per record enforced in data; mood
  survives reload; links render for https only, never as raw HTML.
- 今天: accepting a dice result tombstones the opt; re-adding to 定过的 unburies it; a deleted row's
  circle does nothing; selecting a plan/idea into today only writes when something differs;
  reconcile never revives a deleted row.
- 目标/瓶子: rendering never writes (month creation moved to an explicit page-open step);
  failed AI 回望 saves nothing (legacy saved a fallback as a real review); memory-map AI evidence
  is behind its own button; duplicate habit names refused.
- Settings: tag rename bumps `updatedAt` and matches whole tags only; clearing the dice pool
  unburies the defaults; import/history restore go through the merge (add-only) and mark dirty.
- Daily summary (`qyx_sums`) is still created at boot / day change, but without the unprompted AI
  observation (`obs: ''`); AI runs only on explicit taps.
- Not rebuilt (data kept and merged): 语音整理/polish UI, nudge card, typed `@`/`#` suggest boxes
  (inserted from the Aa panel instead), buddy animation/confetti.

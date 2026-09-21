# 5.0 baseline — 2026-09-21

Actual product: `work/chop-chop-v3-production/index.html`, mirrored preview in `work/chop-chop-v3-preview`. Public repository: huangyuduoduo-afk/chop-chop, main, baseline deployment commit f588022bdc949de401adcf577f22757f48472ede, blob e83d58498ad3a52cc805d7ffdbb79706cc1a771c. APP_VERSION 4.5.8 verified remotely. Workspace parent commit 5f57eac is an unrelated Sites starter; product work files are ignored by its Git rules. Untracked examples/ belongs to user and is untouched.

The product also has its own historical `.git` checkout at e40e056 (July 19). Its existing uncommitted upgrades predate this task. Compare this task against the saved 4.5.8 baseline, NOT that older checkout commit; do not reset or force-push the historical checkout.

Static HTML/CSS/JavaScript, no build needed. Serve product folder over localhost for isolated tests. Production is GitHub Pages at https://huangyuduoduo-afk.github.io/chop-chop/. No project-specific AGENTS.md found. The parent Sites hosting configuration does not deploy this GitHub Pages product.

## Existing capabilities

| Old entry | 5.0 entry | Verification |
|---|---|---|
| 记录 | 说说 | save/edit/delete, Markdown, tags, references, mood, word/time counts |
| 昨日总结 | 说说 folded summary | expand, bonus, questions, insight, backdated completion |
| 今天 | 今天 | three things, subtasks, drawers, routines, bonus, ask, dice, ongoing/history |
| 目标 | 目标 | monthly goals, observation slots, habit tracking, tags, history |
| 瓶子 | 瓶子 | create, draw, followups, AI review, tag library/hierarchy |
| 设置 | 设置 | keys/providers, sync, revision recovery, export, reminder |
| 导出中心 | same + full backup | date range Markdown/JSON/print PDF/image |
| 长按语音 | shared point-to-start voice dialog | browser recognition pause/resume/finish/cancel |

Storage is localStorage (qyx_* keys), cloud backups are GitHub Gist snapshots. Existing mergeAll/bury/unbury/done-log dedupe are preserved byte-for-byte. No Service Worker, offline upload queue or app-managed composer draft storage found in baseline. Browser form restoration/BFCache can restore textarea values; observed bug is consistent with this path, but not reproduced on user's iPhone. No audio Blob recorder/upload/transcription service exists: SpeechRecognition/webkitSpeechRecognition only. No existing record attachment uploader or backup-file importer found; references to attachments in the handbook are conditional.

## Protection and rollback

Code snapshot: docs/v5/baseline/index-4.5.8.html. This is NOT a snapshot of user records. 5.0 must create a local pre-upgrade data snapshot before new data writes and expose full backup download. Tests use isolated origin and synthetic data. New idea relations and local draft receipts are additive, not replacement schemas. A raw 4.5.8 rollback cannot write new idea keys; export full 5.0 data before rollback, and use read-only recovery rather than allowing older clients to overwrite cloud backups. Actual user data backup is NOT VERIFIED at development time.

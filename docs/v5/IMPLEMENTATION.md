# 5.0 implementation

Incremental extension: precise changes in index.html load assets/v5-preflight.js before legacy initialization, v5.css after the existing styles, and v5.js after original declarations but before boot. No framework migration. Original mergeAll, bury/unbury, syncNow, BACKUP_KEYS and protected completion/history helpers remain byte-identical to the 4.5.8 snapshot.

## One body, multiple views

qyx_log remains the source of record bodies. New records use stable submission-derived IDs and retain original timestamps on editing. qyx_ideas_v5 contains schema 1 items, ID-only links and status events. Link IDs derive from record IDs, imposing one active owner. Completion/reopen events do not create notes. Unlinking leaves notes. Item removal keeps metadata with removedAt. Deleting a root uses existing deletion markers and shows a placeholder; other updates survive.

LWW merging of new entities happens at the backup reader boundary; collectBackup adds the new key and schema marker. No token, provider or remote destination change. Original content-deduplication repair remains for legacy rows, but stable 5.0 submissions/edits bypass text-based deduplication. Two intentional equal texts are separate records. Dates use epoch milliseconds and existing local date presentation.

## Drafts and failure recovery

Contexts: note, new-idea, new-from:record ID, idea:item ID, edit:record ID. qyx_draft_v5:* holds revision and submission ID; qyx_submit_v5:* stores successful receipts. qyx_v5_pending holds the in-flight record/relationships before persistence; restart or retry finishes it idempotently. A failed write retains text. Successful submission removes only the matching draft revision. pageshow restores persisted context rather than browser-restored stale form content. Storage events observe receipts and log changes from other same-origin tabs.

Baseline had no application-managed composer draft cache. Browser form/BFCache restoration is a plausible path, but the user’s iPhone bug was NOT directly reproduced; do not state it as the confirmed sole cause. No cache clearing, logout or domain change is required.

## Backup and rollback

Preflight creates qyx_pre5_snapshot before legacy initialization; it excludes credentials and is local only. This must succeed before new 5.0 note submissions are allowed. This is a guard, not evidence that the user's actual device has successfully backed up. Settings offers complete JSON export/import. Full local export includes draft receipts and recovery metadata; cloud backup contains record/idea data through the existing Gist path. Before import, a separate snapshot is saved.

Old full Gist-format JSON can be imported. Date-range JSON journal exports also restore the records actually present; their original source is retained in qyx_range_import_v5. Such old range exports omit some task IDs and reference text, so they are not full-state backups and cannot recreate missing fields. Do not fabricate those fields.

recovery.html is a same-origin read-only fallback with no network calls or storage writes. It can download the current browser's full data. Do not roll back to a writable 4.5.8 client after using new fields: an old client does not know how to export them. Keep all devices on the same version.

## Actual voice capability

Shared dialog uses the existing SpeechRecognition/webkitSpeechRecognition service, NOT MediaRecorder or stored audio. Pause stops recognition; resume starts a new ordered segment. Active time excludes pause. Finish waits for recognition end, appends into the original draft and does not publish. Cancel aborts and ignores old callbacks. Errors remain visible; recognized text is recoverable locally after an interruption. Original note AI keep/tidy/polish/discard controls remain.

There is no captured audio Blob, so failed unheard audio cannot be replayed or recovered. No new transcription vendor or key has been added. Automated tests simulate recognition callbacks; actual microphone and iPhone background/lock-screen behavior remain separate unverified tests.

# 5.0 acceptance evidence

Environment: macOS, local isolated Google Chrome via agent-browser 0.38.1, http://127.0.0.1:5185. No real account tokens or private records used. See verify.cjs and test-results.json for executable evidence. The script intentionally resets only its isolated synthetic fixture, never a production origin.

## PASS

- JavaScript syntax for inline scripts and extension.
- Protected legacy sync/deletion/history functions byte-identical to baseline.
- Ten independent ideas; title/icon optional; root and append use one shared note each.
- Intentional identical text creates different records; same submission and sync replay do not duplicate.
- Edit retains ID/date, updates tags; completion/reopen does not increment note count.
- Search reaches historical append text. Past record association retains old date; unlink preserves the note.
- New full-backup merge preserves IDs, text, dates and relationships; legacy backup imports with attachment metadata preserved.
- Save interrupted between note and relation persistence recovers on retry exactly once.
- Deleting a linked root yields a placeholder; removing an idea retains recovery metadata and notes.
- Unpublished draft survives reload; a saved draft does not return on reload.
- Old primary module entries render; bottle creation and followup still operate.
- Required screen widths have no document horizontal overflow.
- Voice callback SIMULATION: pause/resume/finish, cancel/late result, permission rejection.

## NOT_TESTED / limits (not PASS)

- Physical iPhone Safari microphone, lock screen, calls, keyboard/IME and true BFCache behavior.
- Real spoken audio and actual browser-provider network interruption. Callback simulation is not an audio test.
- Live multi-device Gist convergence with the user's credentials; no private cloud data was accessed or changed during development.
- Simultaneous writers across different browser processes, browser storage eviction, all quota-failure locations.
- Live paid AI-provider calls. Existing providers and prompts were not replaced.
- Exhaustive legacy functions such as every historical goal editing combination, print PDF and downloaded long image visual comparison. Protected source checks supplement, not replace, those functional tests.

The brief's full acceptance matrix is not claimed universally passed. Real-device spot check: in updated Safari, type a short unsent sentence, start voice, pause/resume, finish, confirm the original text remains; save manually, reopen and confirm the composer is clear. No need to clear website data.

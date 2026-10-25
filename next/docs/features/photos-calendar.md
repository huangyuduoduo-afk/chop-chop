# 6.1 spec: photos, calendar, memory moments

Owner's goal: looking back should not feel blank — records should leave visible "memory
moments". Decisions already made by the owner (don't re-ask): photos stored in her private GitHub
repo; calendar highlights = her own stars + simple rules (no AI picking); the AI daily review must
stop paraphrasing ("空话套话、复述流水账") — AI only *picks* moments and quotes her words.

Foundation (done, read it): `src/core/photos.ts` (PhotoService: stage → outbox → drain, url();
preparePhoto() compresses in the browser), `src/app/photos.ts` (`photos()`, `drainPhotos()`,
`photoStatus` signal, `usePhotoUrl(path)`), `src/domain/moments.ts` (attachPhotos, detachPhoto,
movePhoto, toggleStar, dayEntries, dayHighlights, monthGrid), `LogEntry.images` / `starredAt` in
`src/core/types.ts`. Stubs already wired into pages — fill them, don't move them.

## A. Photos UI
- Composer (`pages/record/Composer.tsx`): a 图片 button next to Aa/心情/语音: `<input type=file
  accept="image/*" multiple>`; on desktop also paste and drag-and-drop onto the composer. Each picked
  file → `preparePhoto(file, uuid, now)` → show thumbnail preview immediately; remove (×) and reorder
  (◀ ▶ in a small "…" or long-press — keep it calm) before saving. Max 9 per record.
- Saving must stay one tap and never lose anything: picked photos are staged (`photos().stage(ref,
  full, thumb)`) *before* the record commit; then `commit(addLog…)` and `attachPhotos(d, id, refs, c)`
  in the same commit; then `void drainPhotos()`. Text-only save path unchanged. If staging fails (e.g.
  storage full) keep the draft and show the error; never save the record half-done.
- Draft persistence: selected photo refs survive reload (store refs in the draft; blobs are already in
  IndexedDB once prepared — stage on pick, not on save, so reload keeps them). Discarding a draft
  discards its staged photos.
- Edit sheet (EditRecordSheet): add more photos, remove one (detachPhoto → `photos().discard(ref)`),
  reorder (movePhoto).
- `RecordPhotos` (pages/record/photos/RecordPhotos.tsx): 1 photo = wide, 2–4 = 2-col grid, more =
  3-col grid; thumbnails via `usePhotoUrl(ref.thumb)`; soft placeholder while loading ("图片还在路上"
  if not yet uploaded by the other device). Tap → full-screen viewer (full image via
  `usePhotoUrl(ref.path)`, swipe/arrow keys between photos, close with × / Esc / tap backdrop).
- `PhotoSettings` (pages/settings/PhotoSettings.tsx): card 「图片」: shows `photoStatus` (待上传 N 张 ·
  last error) + 立即上传 button; short help: photos live in the private repo `chopchop-photos`; if the
  error says 权限, explain the token needs Contents read/write on that repo (fine-grained token:
  Repository access → only chopchop-photos, Contents: Read and write; Account permissions → Gists:
  Read and write) and link https://github.com/settings/personal-access-tokens/new . Never show the token.
- Photos are never sent to AI and never included in AI material.

## B. Calendar + stars
- `StarButton` (pages/record/calendar/StarButton.tsx): small ☆/★ icon button on each note row
  (not on ai/dice rows); `commit((d,c) => toggleStar(d, r.id, c))`; aria-pressed; star colour = --star.
- 说说 page (`pages/record/index.tsx`, you own it now): segmented 时间线｜月历 under the greeting.
  Routes: `#/record` timeline (existing), `#/record/cal/YYYY-MM` month, `#/record/day/YYYY-MM-DD` day.
  Keep the existing `#/record/<recordId>` flash behaviour (record ids never look like cal/day).
- Month view: header ‹ 2026年10月 › + 今天; 7 columns 一…日 (Monday first, `monthGrid`). Cell: day
  number; cover thumbnail (`usePhotoUrl(cover.thumb)`) filling the cell softly when present; small dot
  scale for record count; ★ if starred > 0; today ringed; out-of-month days faded. Fits 375px.
  Below the grid: the month's starred records list (精选) newest first, compact.
- Day view: 「10月24日 星期六」 header with ‹ › day navigation; section 精选瞬间 (`dayHighlights`; ★ vs
  "自动" badge; each shows time, text excerpt, photos); then `<DailyMoments day={day} />` (AI, other
  agent's component — just place it); then the full day in time order (all `dayEntries`, compact rows
  with RecordPhotos, StarButton, RecordMenu). Empty day: gentle empty state + "去写一笔" button.
- Rendering never writes data.

## C. AI memory moments (replaces the 每日回望 paragraphs)
- `DailyMoments({ day })` in pages/sea/Moments.tsx, also used by the existing 每日回望 card on 瓶子
  (replace DailyCard's internals or make DailyCard render DailyMoments for the chosen day).
- One tap 「挑出今天的瞬间」 → AI gets that day's note/done records (text only, refs stripped, as R1…Rn
  with time) and returns JSON `{"moments":[{"title":"≤12字的小标题","id":"R3"}]}`, 1–3 items, most
  memorable first. System prompt (Chinese): pick the moments the person would most want to remember
  later; title is a plain label of what happened (no evaluation, no advice, no feelings she did not
  write, no "你"); never invent; prefer concrete events, people, places, firsts; skip routine logs.
- Display: for each moment: title, then her original record text quoted verbatim (excerpt + 展开),
  time, photos (RecordPhotos). No AI-written paragraphs at all. Buttons: 换一组 (re-run), 收起.
- Store in `qyx_daily_review_v51` (same key, same merge): `{id:'daily_'+uuid, date, t, provider,
  promptVersion:'moments-1', fingerprint, paragraphs:[{text:title, source_ids:[recordId]}]}` —
  `source_ids` hold real record ids. Older entries (promptVersion daily-r21-*) still render as before
  under 「以前的回望」 collapsed.
- Errors: show `aiErrorText`; save nothing on failure. Only on explicit tap.

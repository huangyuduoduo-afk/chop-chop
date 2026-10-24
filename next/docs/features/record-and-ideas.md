# Spec: 说说/记录 page and 消息盒子 (ideas)

Scope: legacy `#v-log` (nav label renamed to **说说** by v5) and v5 `#v-ideas` (**消息盒子**).
Source read: `index.html` (legacy inline script) = **L:<line>**, `assets/v5.js` = **V:<line>**. Shapes: `next/src/core/types.ts`.
Live behaviour = legacy + v5 monkeypatches. Where v5 replaces a legacy handler, the **v5 behaviour is the contract**; the legacy one is listed only when it still runs or matters for data.

Conventions
- `LS.set` (L:1291) = write + `qyx_lastchange=now` (marks **dirty**) + `scheduleAutoBackup()` (200 ms debounce -> `syncNow(true)` if `qyx_ghtoken` exists). Not dirty for keys `qyx_lastbackup/lastchange/gistid/sumseen/ghtoken/key/provider`.
- `LS.setSilent` (L:1299) = write only (not dirty, no sync). Used by merge and by tag bookkeeping.
- `raw write` = V `write()` (V:7) = `localStorage.setItem(JSON)` only. Not dirty. Used for drafts, receipts, pending tx, view prefs, voice recovery.
- `bury(scope,val)` (L:4294): push `{s,v,t:now}` unless same s+v exists; if >1200 rows keep newest 250 per scope; `LS.set("qyx_dead")` (dirty). `unbury(scope,val)` (L:4316): remove all matching s+v, `LS.set` only if something was removed. `isDead` (L:4320).
- `stableId(prefix,v)` (L:1349) = FNV-1a: `h=2166136261; for(ch of String(v)) {h^=ch.charCodeAt(0); h=imul(h,16777619)}; prefix+(h>>>0).toString(36)`. NOTE iterates code *points* but XORs only the first UTF-16 unit of each (astral chars use the high surrogate only). `next/src/core/util.ts` copies this exactly; the comment there says "code units" but behaviour is as described here.
- `uid()` = `crypto.randomUUID()` (V:5).
- `dayKey(t)` local `YYYY-MM-DD` (L:3828). `fmtDT(t)` = `MM/DD HH:mm` (L:1683). V `date(t)` = `toLocaleString('zh-CN',{month,day,hour,minute 2-digit})` (V:115).
- `ready` (V:8): false if the `qyx_pre5_snapshot` could not be written (preflight V:9-15 / assets/v5-preflight.js). While false: `persist()` throws, `submitComposer` refuses ("请先导出完整备份，当前浏览器空间不足。").

---

## 0. Record object shapes (`qyx_log` rows) created/changed by this area

| Path | Shape | Notes |
|---|---|---|
| v5 note / idea composer (V:447) | `{id:"rec5_"+submissionId, t:now, updatedAt:now, type:"note", text, mood: (context==="note"?selectedMood:null), submissionId, [wall, active]}` | `text` is *after* checklist extraction and ref-label->token restore. `wall/active` (ms) only for context `note` when a typing trace exists. No `src`/`q` keys. |
| v5 edit (V:512) | same row; `text=parsed.text`, `updatedAt=now`, `v5StableId=true` (boolean; types.ts says string) | `id`, `t`, `mood`, `submissionId` unchanged. |
| legacy `addLog(type,text,mood,src,q)` (L:1470) | `{id:"rec_"+fnv36(now+"\|"+Math.random()), t:now, updatedAt:now, type, text, mood:mood\|\|null, src:src\|\|null, q:q\|\|null}` | Used by Today-three done logs (`addDoneLogOnce(text,"三件")`) triggered from idea/task status changes (see 4.6/4.7). Calls `indexRecordTags(entry,true)`, `saveTagData(true)`, `LS.set("qyx_log")`, `markNudgeActed()` for note/done. |
| nudge mark (L:1717) | `{id:"mark_"+fnv36(now), t:now, type:"mark", mark:"light"\|"trash", text:refToken(entry), updatedAt:now}` | `LS.set("qyx_log")`. Shown in list with badge 有启发 / 不再出现. |
| yesterday 补勾 (L:3553) | `{id:"done_"+fnv36(yk+"\|"+text), t:Date(yk+"T23:59:00"), type:"done", text, src:"三件·小项", updatedAt:now}` | Only if no same-day done with same src+text. `LS.set("qyx_log")`. |

Identity rule (contract): `logKey(r) = r.id || t+"|"+type+"|"+text` (L:3806). Merge by logKey, newer `updatedAt||t` wins, tombstone scope `log` value = logKey. `t` never changes on edit.

`dedupeByContent` is overridden (V:49): rows with `submissionId` or `v5StableId` are exempt from legacy same-(t,type,text) content dedupe; legacy rows are deduped by the old function; result sorted by `t` asc. (Two intentional identical texts from v5 stay separate records.)

---

## 1. 说说 page layout (what the user sees, top to bottom)

`#v-log` (L:1082-1156). Bottom nav order after v5: **消息盒子, 今天, 说说, 目标, 瓶子** (V:225-228). Page default view = v-log.

1. Header block (`.buddy-row`): v5 removes the SVG fish and puts `assets/avatar-v5.jpg` (alt "陪你记录的头像") before `#logSay` (V:640-642). Greeting `#logSay` = session-stable random line by hour (`logGreet`, L:3873): 5-11 "早。今天从哪一笔开始？/早上好。/醒了？先记一笔。", 11-14 "中午好。/吃了吗？顺手记一笔。", 14-18 "下午了。/下午好，记点什么？", 18-22 "晚上好。/今天过得怎么样，写两句？", 22-29(+24 if hr<5) "夜里了，写完早点睡。/还没睡？记完就收。"; appended " 今天已记 N 笔。" where N = **all** log rows of today, any type (OBSERVATION: counts done/dice/mark too). `sessionGreet` reset at day rollover (L:4990 interval).
2. 昨日总结 card (see 2).
3. `#cloudBanner` (new-version banner, sync area), `#sumBanner` (昨天 summary card with ✕; ✕ sets `qyx_sumseen=yesterdayKey` via raw localStorage, local-only).
4. Composer "letter" (see 3). Date stamp `#letterDate` = `MM DD 'YY  HH:mm` (L:3893 area, refreshed in renderLog).
5. `#habitReminder` aside (habit feature, other spec).
6. "最近事件" header + button `查看全部记录` / `收起较早记录`; list; bottom button `查看全部记录　›` / `收起较早记录　⌃`.
7. List (see 5).

---

## 2. 昨日总结 card (yesterday card)

- UI: `#yesterdayReview`, title "昨日总结", subtitle `MM/DD 星期X` of yesterday (`renderV3Yesterday`, L:3646). Collapsed by default; button `展开`/`收起`; clicking anywhere on the card toggles too (L:3633-3645). State `yesterdayExpanded` is memory only.
- Expanded body (read-only derived, nothing stored): "`N / 3 完成`", "完成率 X%" (N/3), each of up to 3 items from `qyx_enough_prev` if `prev.d===yesterdayKey` else `qyx_sums[yk].three`, skipping blank/deleted; progress ring (completed=100 and "✓", expired "×" shown as incomplete, else sub-item %); sub-items with `✓/×/○ text [×count]` and button **补勾** for non-completed subs; empty -> "昨天没有留下三件事。空白也算一天。".
  Extras: "切 {dice+ai} · 记 {note} · 划掉 {done}" (counts of yesterday's `qyx_log` by type); **Bonus** (from `qyx_bonus_prev` if d matches else `sum.bonus`; empty -> "昨天没有留下 Bonus。"); **问一问** (last 2 `type==="ai"&&q` rows of yesterday: q small + `cleanAIText(text)`; empty -> "昨天没有使用问一问。"); **AI 回望 · 洞察** = `sum.obs` || "昨天你用“问一问”梳理了 N 次，也把当时的选择过程留下来了。" || "昨天你留下了 N 笔记录，先把当时的自己保存了下来。" || "昨天留下的内容不多，空白也可以被回望。"; habit marks line.
- Data effects: only **补勾** (`bindSumFix`, L:3583): `sum.three[ti].subs[si]` set `status="completed", done=true, c=max(c,1)`; patches matching item in `qyx_enough_prev`; `addBackdatedDone` (above); recount summary; `LS.set("qyx_sums")` (+`qyx_log` dirty from addBackdatedDone); toast "补上了，记在昨天。". Reads keys `qyx_enough_prev, qyx_sums, qyx_bonus_prev, qyx_log`.
- Port note: this card belongs to the Today/summary domain; the 说说 page merely hosts it.

---

## 3. Note composer (说说)

### 3.1 Elements
`#noteText` textarea, placeholder "发生了什么、注意到什么，话多正好……", rows 3. Below it: tag suggest box, ref suggest box, nudge card slot, **Aa 排版** `<details>` (V:394 wraps legacy toolbar), reference shelf, `v5NoteTarget` select, **语音输入** button (`#recordVoiceBtn`, status text "点一下开始，完成后可以修改"), AI polish panel (hidden), 16 mood buttons, **记下** button (`#saveNote`).
- **归属想法（可选）** select `#v5NoteTarget`: options "只留在说说" + every non-removed idea (`ideaOptions()`: state order = id-sorted, title via `title(i)`) (V:469-473). Value persisted in the `note` draft as `ideaTarget`. Reset to "只留在说说" after each successful save. If a stored target idea no longer exists the select falls back to "".
- **Moods** (L:1100-1107, handler L:3685): 😌 😄 😫 😢 😪 🔥 🥱 🤯 🥰 😤 🫠 😶‍🌫️ 🤒 🌧️ ☀️ 🌱. Single-select; tapping the selected one clears it. `selectedMood` is a memory variable (OBSERVATION: not part of the draft, lost on reload/restore). Reset after save. Stored in `record.mood` (emoji string or `null`). Not editable after save (edit dialog has no mood).

### 3.2 Drafts, receipts, pending transaction (V:355-466)
| Key (all raw `write`, **not synced, not dirty**) | Value |
|---|---|
| `qyx_draft_v5:<context>` | `{id:uid, context, revision:int, submissionId:uid, text, refs:{label:rawToken}, [title, icon, ideaTarget]}` |
| `qyx_submit_v5:<submissionId>` | receipt `{recordId, context, revision, t}` |
| `qyx_v5_pending` | in-flight tx `{record:LogEntry\|null, recordId, state:IdeasState(full clone+changes), draft}` |
| `qyx_voice_recovery_v5` | `{context,text,session}` |
Contexts: `note`, `new-idea`, `new-from:<recordId>`, `idea:<ideaId>`, `edit:<recordId>`, (`bottle` voice only).
- `loadDraft(ctx)` (V:381): stored draft unless a receipt exists for its submissionId; else fresh `{id,context,revision:0,submissionId:uid,text:""}`.
- `bindDraft(el,ctx)` (V:382): loads draft, converts raw ref tokens in the draft to readable labels, writes it back, sets `el.value`, wires `oninput` (saveDraft + normalizeEditorReferences unless IME composing), composition handlers (a submit requested during composition is queued and run at `compositionend`, toast "正在确认最后输入的文字…").
- `saveDraft(el)` (V:383): if text changed vs draft -> new draft object with `revision+1` and **new `submissionId`** (so a new text = a new record identity). If a receipt already exists for the current submissionId and the value is unchanged it returns `undefined`; if value changed it starts a fresh draft. Failure to write -> toast "草稿暂存失败，请先复制文字。".
- `saveCurrentComposer()` runs on view switch, `pagehide`, detail re-render. `pageshow` re-reads stored drafts into inactive editors (V:479). `storage` event: other tab's `qyx_ideas_v5` merged + rerender; `qyx_log`/`qyx_dead` re-merged (newer `updatedAt||t` wins, tombstoned dropped); a receipt for the current draft clears the textarea (V:480-487).
- Recovery on boot (V:466) and at the start of every submit: `recoverTransaction()` (V:427): rebuild `log` from memory + stored `qyx_log` (newer wins, minus `qyx_dead` scope `log`), push `tx.record` if missing (**`LS.set("qyx_log")`**), `state=mergeState(state,tx.state)` + raw `write(qyx_ideas_v5)`, `indexRecordTags(tx.record,true)`+`saveTagData(true)`, write receipt for `tx.draft`, remove `qyx_v5_pending`.

### 3.3 Save = `submitComposer(el,context,ideaId,config,existing)` (V:436), bound at V:474 (note) / V:307 (idea continue) / V:326 (new idea)
Order of effects:
1. `!ready` -> toast, stop. IME composing -> queue. Empty `trim()` -> **silently return** (no toast).
2. `d=saveDraft(el)`; `busySubmissions` set on submissionId (double-tap guard; function is sync so mostly belt-and-braces). If `d` is `undefined` (see O12) it throws outside the try.
3. `recoverTransaction()` (finishes any older pending tx first).
4. Receipt exists for this submissionId -> `clearSubmitted`, `renderLog`, return (idempotent retry: **no second record**).
5. `parsed=extractChecklist(storageReferences(value.trim(), refs), "rec5_"+sid)` (not when `existing`). See 7.
6. Record built (table in 0). For context `note` and not `existing`: `finishRecordTrace(true)` -> if a trace -> `r.wall,r.active` (ms).
7. `next=deepClone(state)`; push parsed tasks; if `config` (new idea): `ideaId="idea_"+sid`, push item `{id, title:config.title(trimmed, may be ""), icon:config.icon (default "star"), status:"open", rootRecordId:r.id, createdAt:now, activityAt:now, updatedAt:now}` (no `statusUpdatedAt/scheduledDate/removedAt/completedAt`); if `ideaId`: guard `owner(r.id)` belongs to another idea -> throw "这条记录已经属于另一条想法。"; push link `{id:"link_"+r.id, ideaId, recordId:r.id, role: config?"root":"update", linkedAt:now, updatedAt:now}`; target idea `activityAt=updatedAt=now`.
8. raw-write `qyx_v5_pending`, `recoverTransaction()` (commits as above), `clearSubmitted(el,d,r.id)` (rewrite receipt, delete matching draft, empty textarea, reset ref map, fresh draft in memory).
9. `LS.set("qyx_ideas_v5",state)`, `LS.set("qyx_log",log)` (**dirty**).
10. Context `note` only: if `pendingPolish.polished===r.text` -> `polishHistory.push({t:r.t, original, polished:r.text, mode})`, `LS.set("qyx_polish_history")`; clear mood buttons/`selectedMood`, hide polish panel, clear voice/polish vars, `traceSaving=false`, `beginRecordTrace()`, `markNudgeActed()`; reset `#v5NoteTarget` to "".
11. `renderLog(); renderIdeas(); refreshNoteTarget();` toast "已保存到本机" + (`qyx_ghtoken`? "，等待云端确认。" : "。"). If `ideaId` -> `openIdea(ideaId)` (user lands in the idea timeline).
12. catch: `traceSaving=false`; toast "尚未完成保存：<msg>。文字已保留。" (error toasts matched by /失败|尚未|错误|不足|不支持|无法|无效/ are red and sticky, V:729).

Tag side effects of a save: `indexRecordTags(record,true)` (see 6): creates `qyx_tags` rows, sets `qyx_record_tags[recordId]`, unburies any `tag` tombstone on the path (dirty via `LS.set("qyx_dead")` only if one was removed). Tag keys written silently, but the following `LS.set("qyx_log")` makes the sync include them.

### 3.4 Typing helpers on `#noteText` (legacy, L:4876-4916)
- `Enter` on a line starting `- ` or `N. ` continues the list (`- ` / `N+1. `); Enter on an *empty* list line removes the marker. (Applies to `noteText` only; OBSERVATION: Enter on `- [ ] x` continues with plain `- `, not a checkbox.)
- `#` typed/inserted -> tag suggest (`updateTagSuggest`, L:4839): trigger regex `(?:^|[\s，。！？；：、,.!?;:])#([^\s#]*)$` before the caret. Lists up to 20 existing tag paths containing the query (sorted zh-CN), plus "创建 #<q>" if no exact match, plus "打开标签库 →". Pick inserts `#<path> ` replacing from the `#`; direct `el.value=` (no `input` event, so draft is saved on next input/submit, O13).
- `@` typed/inserted -> ref suggest (`updateRefSuggest`, L:4863): trigger `@([^\s@]*)$`, hidden if text after @ already looks like `NNNNNN-`. Pool = rows of type note/done/ai with non-empty text, filter `text.includes(q)`, newest 30. Header "继续打字可以筛选 · 最近 30 条" / "在筛「q」 · N 条"; each row `MM/DD HH:mm[ · 完成|问一问]` + 60-char window (`refWindow`, hit highlighted). Pick inserts `refToken(e)+" "`.
- Both suggest boxes also exist for the edit dialog (`#dlgTagSuggest`, `#dlgRefSuggest`) via `suggestTarget()`.

### 3.5 基础文字排版 (Aa 排版) toolbar (V:393-425)
`mountEditorTools(el, existingBar?)` wraps a toolbar in `<details class="v51-format"><summary>Aa 排版</summary>` and adds a `.v51-ref-shelf`. Buttons (title): `#` 插入标签, `@` 引用一条记录, `B` 加粗, `•` 项目列表, `1.` 序号列表, `I` 斜体, `H` 小标题, `❝` 引用段落, `↗` 链接, `☑` 可勾选清单. Mounted on: `#noteText` (reuses legacy bar; legacy handlers keep `#,@,B,•,1.`), idea composers `#ideaBody`, edit dialog `#appDialogArea` (each builds its own full bar and removes it after the dialog closes). Buttons use `pointerdown preventDefault` to keep focus.
Inserted text: `**sel**`, `*sel*`, `[sel or 链接文字](https://)` (caret inside the `()` before `)`), `- [ ] sel`, line prefixes toggled at line start: `## `, `> `, `- `, `1. ` (press again on a line that already starts with it removes it). `@` in non-note/non-dialog editors opens a pick dialog "引用哪条记录？" with the latest 30 note/done/ai rows (`MM/DD HH:mm · excerpt38`), toast "还没有可引用的记录。" if none; inserts raw token + space then normalizes to a label.
Pure text: formatting is stored as Markdown-ish source in `record.text`; no separate field.

### 3.6 Rendering of stored text: `renderMarkdownLite` (L:1672 + V:122)
Per line, in this precedence: `^#{1,3}\s+` heading (`v5-md-h1..3`); `^>\s?` quote; `^-\s` bullet; `^\d+\.\s` numbered (keeps number as `data-marker`); else plain line. Empty line -> `<br>`. Inline (`renderInlineMarkdownLite`, L:1659 + V:116): HTML-escape, then `#tag` -> `.md-tag` span (tag must follow start/space/punctuation; excludes `<>&`), `@ref` -> `.md-ref` card (below), `**b**`, `[label](http(s)://url)` link (new tab, noopener), `*i*`. Images are **not** rendered (excerpts replace `![..](..)` with "[图片]"). `stripMarkdownLite` (L:1680) for the PNG export: bold removed, `- ` -> `· `.
`excerptText` (V:216) strips images->"[图片]", links->label, line prefixes (`#`, `>`, `- [ ]`, `-`, `N.`), `**`, `*`, collapses whitespace.

### 3.7 @引用 references
- Token grammar (L:1609): `@<kind><yymmdd>-<hhmm><suffix>`; kind letter: note "" / done `d` / ai `q`; suffix: none for the 1st record of that type in that local minute, `b`,`c`... for later ones (`"a"` is accepted on read as the first). Types `dice/draw/bonus/mark` have **no** token (`refToken` returns "").
- `refToken(entry)` (L:1638), `refMinuteMatches` (L:1626: same type, same y/m/d/h/min, sorted by `t`), `resolveRef(kind,ymd,hm,suffix)` -> `{hit, siblings}` (L:1633). OBSERVATION O9: identity is **minute+type+order**, not record id; a record added/removed earlier in the same minute (e.g. via sync) silently re-points `b/c` tokens; a deleted target renders as a grey "这条记录已经不在了" card.
- Stored text always contains **raw tokens**. In editors the user sees readable labels: `displayReferences(value,map)` (V:366) replaces each raw token (regex `rawRefPattern`: not preceded by letter/digit/_/@, not followed by letter/digit/_) with `〔引用 MM/DD HH:mm · <excerpt 24>〕` (or `〔引用：原记录暂不可用〕`; duplicate labels get ` 2〕`, ` 3〕`...). The label->token map is `editorRefs` (WeakMap per textarea) and persisted in the draft as `refs`. `storageReferences(value,map)` (V:367) swaps labels back to tokens before saving (global split/join). If the user edits a label character, it is saved as plain text.
- `renderReferenceShelf` (V:368): below the editor, a chip `<label> ↗` for each label still present in the text; click -> saves draft, then opens the target (via its idea timeline if it has an owner, else `jumpToEntry`), toast "原记录暂不可用，引用文字仍会保留。" if unresolved.
- Display card (`renderInlineMarkdownLite`): `.md-ref[data-ref]` with date/kind label, `refInline(text)` (nested refs become `⟨引用·MM/DD[ 完成|问一问]⟩` / `⟨引用·已删除⟩`), "这一分钟还有 N 条记录" when siblings, "去那条 →". Click toggles open; "去那条 →" -> `jumpToEntry` (L:3982) (always the 说说 list, even inside an idea timeline).
- `stripRefs` (L:1647) -> `（引用MM/DD HH:mm[ 完成|问一问]：<20 chars>）` or `（引用了一条已删除的记录）` used in exports.
- `charCount(text)` ignores ref tokens (L:1613).
- `jumpToEntry(entry)`: `logExpanded=true`, click nav v-log, scroll to the `.entry` whose `data-t === entry.t` (OBSERVATION O10: matches by `t` only), add `.ref-hit` for 1.2 s.

### 3.8 Voice input (v5 shared controller, basic) V:603-638
- Button label **语音输入** (note, idea composers, bottle). Uses `SpeechRecognition||webkitSpeechRecognition`, `lang zh-CN`, continuous, interim results. No audio saved. Unsupported -> toast "当前浏览器没有语音识别能力，请使用键盘上的系统听写。".
- Modal "慢慢说就好": timer `mm:ss`, state texts ("正在请求麦克风权限…", "正在听…", "已暂停，可继续或完成"), live text, buttons **取消 / 暂停(继续) / 完成**, footnote "使用当前浏览器的语音识别，完成后仍可修改文字。". Esc = cancel; Tab is trapped in the modal. Auto-pause on route change / `visibilitychange` hidden / nav click ("页面已进入后台，识别已暂停", "页面切换，已暂停"). Errors via `voiceErrorMessage` (L:3719) with "按住说" replaced by "点按开始".
- Finish: segments joined with `\n`; empty -> toast "没有识别到有效文字，原内容已保留。". Otherwise `el.value += (el.value?"\n":"")+text`, `saveDraft`, dispatch `input`, focus, and **for context `note` call `showPolish(el.value)`**; toast "文字已放回输入框，确认后再保存。". If the editor is gone: text appended to the stored draft of that context with `revision+1`, **new submissionId**.
- Crash recovery: every result raw-writes `qyx_voice_recovery_v5`; on boot, if present a `v5-source` button **恢复上次中断的语音文字** appears above `#noteText`; click appends to the draft of that context, reopens it (note / idea:<id> / new-idea / bottle), removes the key, toast "已恢复到原输入位置，尚未发表。". Removed on finish/cancel.
- Legacy hold-to-talk `startRecordVoice/stopRecordVoice` (L:3738/3766) is **dead code** (not wired).
- Data effects: none on synced keys; only draft + recovery keys (local-only).

### 3.9 语音整理 / AI polish (legacy) L:3716-3803
Panel `#polishPanel` (title "✦ AI 帮我整理 / 文字仍然像你") is hidden until a voice session in context `note` finishes (`showPolish`, L:3729: `voiceOriginal=full textarea text`, `polishResult=original`, `polishMode="keep"`, shows original vs 整理后).
Buttons: **保留原话** (keep: result=original) | **稍微整理** (tidy: `runAI` "只整理标点、断句和明显语病…"; on any error fallback `localTidy` = collapse whitespace, "然后然后"->"然后", space after 。！？) | **帮我润色** (deep: `runAI` "把这段口述整理得更流畅、有层次…"; fallback `localTidy`) | **舍弃这条** (clears textarea, hides panel, status "已舍弃，没有保存", toast "这条没有保存。") ; **应用到这条记录** -> textarea := `polishResult||voiceOriginal`, `pendingPolish={original,polished,mode}`, panel hidden, toast "整理结果已放回记录框。你确认后再记下。". Each click also `saveDraft`.
Network: sends the voice text to the configured AI (`qyx_provider`: DeepSeek or Anthropic, key `qyx_key`, both local-only) for tidy/deep.
Persistence: only when saved with `pendingPolish.polished === record.text` -> `qyx_polish_history.push({t:record.t, original, polished, mode:"keep"|"tidy"|"deep"})` via `LS.set` (synced key; merge key `t|original|polished`). O6: equality is against the *post-extraction* text, so a polished text with `- [ ]` lines or edited afterwards is silently not logged.

---

## 4. Record list, filters, row actions (说说 list)

### 4.1 Rendering `renderLog` (L:3883) + v5 wrapper (V:522)
- Pre-step: `dedupeDoneLogEntries(log)` (L:3830): among `done` rows same `day|type|src|text` keep the earliest; others `bury("log",logKey)`; if count changed -> `log=cleaned; LS.set("qyx_log")` (a render can write + mark dirty).
- Empty -> "还没有记录。第一笔随时可以来。" and hide toggle buttons.
- Group by local day desc; within day `t` desc. Group header: `今天 · M月D日` / `昨天 · M月D日` / `M月D日` (`dayTitle` L:3856) + **导出** (opens export center for that day; other spec). If `qyx_sums[day]` exists a `sum-inline` summary block is shown under the header.
- **No filters.** Only the collapse: `#logList.collapsed` hides every `.day-group` after the 2nd (CSS L:802); toggles shown only if >2 groups. `logExpanded` memory-only (`jumpToEntry` sets it true).
- Row (`.entry`, `data-t`, `data-record-id`): time `HH:mm`; type badge from `TAG` {dice 骰子, ai 问一句, draw 抽签, note 记录, done 完成, bonus bonus, other types show raw type}; for `mark`: 有启发 / 不再出现; `src` chip; `mood` emoji; body: AI rows with `q` -> `.aiq` question + `.aia` markdown answer; everything else `.etx` markdown; `est/act` line ("预估 Nm · 实际 Nm · ×x 偏乐观 | 预估准了"); for notes with `active`: "`{charCount} 字 · {fmtSpan(active)}`" + " · 中间离开 {fmtSpan(wall-active)}" when `wall-active>60000`; tag chips (`#path` buttons from `qyx_record_tags[id]`, click opens tag detail).
- v5 additions per row (found by `data-record-id` in `log`; rows with no id keep the legacy handlers): the delete button becomes **…** (title/aria "记录菜单") -> `recordMenu`; `.etx` click handler removed (no more tap-to-edit); texts >360 chars are clamped with a **展开全文 / 收起** toggle (UI only); if the record has an active owner idea a **`↗ <idea title>`** button opens it; if it has active v5 tasks the checklist block is appended (7.3).
- Mark rows also get the full "…" menu (OBSERVATION O14: you can "edit" a mark row's token text).

### 4.2 Record menu `recordMenu(id)` (V:489) — dialog title "这条记录"
Options: **编辑文字**, **添加清单项**, then if the record has an active owner: **查看所属想法**, and **更改归属** (label becomes **根记录不可更改归属** when role is `root`); if no owner: **收进消息盒子**; finally **删除记录**. Same menu is reachable from the idea timeline's per-record "…" (`这段记录的菜单`). "owner" = first link with `recordId===id && !removedAt && item(ideaId)` where the idea itself is not removed (V:134).

### 4.3 编辑文字 (v5) V:509-516 — vs legacy edit L:3966
v5 (live):
- Dialog "编辑记录", textarea prefilled with `r.text` (checklist lines are not in `r.text`; see 7). `bindDraft($('appDialogArea'),"edit:"+id)` restores an unsent edit draft over the prefill; Aa toolbar mounted. Cancel/Esc/overlay -> `null` -> draft key removed. Empty/whitespace -> return, no change, no toast.
- On OK: `parsed=extractChecklist(storageReferences(value.trim()), r.id)`; **`r.text=parsed.text; r.updatedAt=now; r.v5StableId=true`**; **id and `t` kept**; push parsed tasks into `state.tasks`; `recordTags[r.id]=[]` then `indexRecordTags(r,true)` (forced re-index, unburies tag tombstones), `saveTagData(true)` (silent); `LS.set("qyx_log")`; `persist()` (`LS.set("qyx_ideas_v5")`); `clearSubmitted` writes receipt with `recordId=r.id`; if the record has an owner idea -> `idea.activityAt=idea.updatedAt=r.updatedAt` + persist; `renderLog()`; re-render open idea detail. Timeline then shows "· 编辑过" when `updatedAt > t+1000`.
- No tombstone is created. No unchanged-text check (O3).
Legacy (still in file, **disabled in live runtime** for rows with an id because V:526 sets `text.onclick=null`): `appDialog "修改记录"` -> if changed: `bury("log", oldId)`; `e.id = "rec_"+fnv36(oldId+"|edit|"+now)`; text/updatedAt set; `recordTags` moved to new id; re-index; `LS.set`. **This "buries the old id and mints a new one"**: any v5 link/task referencing the old id is orphaned (timeline shows "这条记录已从说说中删除。其余补充仍然保留。"). The port must use the v5 semantics (keep id, bump `updatedAt`).

### 4.4 删除记录 (v5) V:517-520 — vs legacy ✕ L:3938
- Confirm "删除这条记录？" ; text: with owner "这条正文也会从所属想法中移除，其他补充会保留。" else "沿用记录删除规则。"; OK label "删除", danger.
- Effects: `bury("log", logKey(r))` (scope `log`, value = record id; `LS.set("qyx_dead")`), `log=log.filter(...)`, `delete recordTags[id]`, `saveTagData(true)`, `LS.set("qyx_log")`, re-render. Toast: **none** in v5 (legacy toasted "删了。"). **Not touched**: links (stay, now dangling -> placeholder in timeline), `state.tasks` for the record (hidden because `rec()` is missing), drafts/receipts, idea `updatedAt`. Deleting an idea root leaves the idea alive (card excerpt "原始记录已移除，其他补充仍保留").
- Legacy ✕ (rows without id only): same tombstone/removal but dialog "删除这条记录？ / 删除后不会出现在历史记录里。" and toast "删了。".

### 4.5 添加清单项 / 收进消息盒子 / 查看 / 更改归属
- **添加清单项**: dialog "添加清单项", line input placeholder "写下一件可勾选的小事"; empty -> nothing. Push task `{id:"plan_"+uid, recordId, text:trim, done:false, scheduledDate:null, order:recordTasks(id).length, createdAt:now, updatedAt:now}`; `persist()`; `refreshTaskViews()`.
- **收进消息盒子** (record has no owner): pick dialog "收进消息盒子": "作为新想法" + "补充到：<title>" per non-removed idea. "补充到" -> push link `{id:"link_"+recordId+"_"+ideaId, ideaId, recordId, role:"update", linkedAt:now, updatedAt:now}`; `persist()`; `renderLog()`; `openIdea(ideaId, recordId)`. Does **not** bump the idea's `updatedAt/activityAt`. "作为新想法" -> `openComposer(record)` (see 8.3, O1).
- **查看所属想法**: `openIdea(ideaId, recordId)` (detail scrolled to the record; filters relaxed if needed).
- **更改归属** (non-root only; root -> toast "最初记录是这条想法的起点，不能单独移走。"): pick dialog "更改归属": "移出此想法，保留说说" (`none`) + "移到：<title>" for every other non-removed idea. Effects: old link `removedAt=updatedAt=now` (soft); if target != none push link `{id:"link_"+recordId+"_"+targetId, role:"update", linkedAt:now, updatedAt:now}`; `persist()`; re-render; inside an idea detail: `none` -> re-render same idea, move -> `openIdea(target, recordId)`.
- **Timeline button 移出此想法** (`data-unlink`, non-root links only, V:310): `link.removedAt=link.updatedAt=now`; `persist()`; re-render detail + log. No confirm.

### 4.6 One idea = one card rule
- A record has at most one *active* owner. Enforced in UI only: 收进消息盒子 shown only when no owner; 更改归属 retires the old link before adding the new; `submitComposer` throws if the record already belongs to a different idea. Link ids: composer-created `link_<recordId>` (so one natural link per record), moves/adoptions `link_<recordId>_<ideaId>`; `mergeState` has no cross-link uniqueness check, so two devices can create two active links for one record (O8).
- Each idea renders as exactly one card in the list/one detail timeline; all of its linked records (root + updates) live inside that card ("接着写").
- A removed idea (`removedAt`) hides its card and makes its records ownerless (so 收进消息盒子 appears again on them); its links/events stay in storage.

---

## 5. Nudge (push card) and typing trace helpers (说说 only, local-only data)

### 5.1 Nudge card (L:1700-1768)
- Timer `startRecordNudgeTimer` (12 s after entering 说说 and on boot; cancelled on any keydown/input/button click and on leaving the page). Shows at most **2 per day** (`qyx_nudge_local.days[today].shown`) and not after the card was closed today (`nudgeClosedDay`, memory).
- Pool: `type==="note"`, age 7-60 days, `!isDead("nudge", logKey)`; take 20 with highest `concreteness(text)` (digits*2 + unit chars + `《》「」【】`*2 + verb chars + min(len/20,6)); pick one at random. Card: three icon buttons — trash (aria "不再出现这条"), bulb (aria "有启发"), ✕ (aria "收起") — plus `MM/DD HH:mm` and the full text.
- 有启发: `markNudge(entry,"light")` (adds a `mark` row, see section 0), toast "记下了。", hide after 600 ms. 不再出现: `bury("nudge", logKey(entry))` + `markNudge(entry,"trash")` + hide + toast "这条不会再出现了。记录本身还在。". ✕: closes for the day only.
- `qyx_nudge_local = {shown, acted, days:{<day>:{shown,acted}}}` raw localStorage, local-only; `acted` +1 (once per card) when the user saves a note/done within 3 min of the card (`markNudgeActed`, called from addLog, markNudge, v5 save). Settings line "开屏提醒响应：a/s（p%）" over last 14 days (`updateNudgeRatio`).
- Tombstone scope `nudge` is **synced** (`qyx_dead`); the `mark` rows are synced (`qyx_log`).

### 5.2 Typing trace (L:1770-1830)
`recordTrace={entered,first,del,active,resume}` while 说说 is the active view (begin on entering view, focus, keydown). `beforeinput deleteContentBackward` counts deletes. Blur/hidden pauses (`traceHold`). On save (`finishRecordTrace(true)`): with keystrokes -> `pushTrace("lat", first-entered)`, `("dur", wall)`, `("del", n)` and returns `{wall,active}`; without keystrokes but with text -> `{wall:now-entered, active:wall}` (voice/paste). On leaving the view unsaved (`finishRecordTrace(false)`): `pushTrace("drop", chars)` if typed else `("idle", ms)`. `qyx_trace_local = [{d:dayKey,k,v}]` (last 2000), raw, local-only. Only `wall`/`active` go into the record (and sync).

---

## 6. #tag parsing and indexing (L:1353-1375, 1415)

- `normalizeTagPath(raw)`: strip leading `#`s, split `/`, trim parts, drop empties, rejoin with `/`.
- `parseTagPaths(text)` (L:1356): regex `#([^\s#，。！？；：、]+)` over the *raw record text*; strip trailing punctuation `]['()（）【】{}<>《》"'“”‘’.,!?;:` from the match; normalize; unique, in order of appearance. (So `#a/b` = nested tag `a` > `b`. Inline-render regex for the `md-tag` styling is slightly different, L:1660.)
- `ensureTagPath(raw, revive=true)` (L:1363): for each prefix of the path: `id=stableId("tag_", fullPrefixPath)`; if `!revive && isDead("tag",id)` -> stop, return null; if `revive` -> `unbury("tag",id)`; reuse existing tag with same id **or** same `(parent_id,name)`, else create `{id, name, parent_id, created_time:now, updated_time:now}` pushed to `tags`. Returns the leaf tag id. (Does not save by itself.)
- `indexRecordTags(e, force)` (L:1371): `recordTags[e.id] = force||undefined-before ? parsed : union(existing, parsed)`; `ensureRecordId` assigns `"rec_"+fnv36(t|type|text|index)` to id-less rows.
  - `force=true` (adding a record, editing a record, nudge-free paths): revive tombstoned tags, **replace** the list.
  - `force=false` (boot `initTagSystem` L:1415, and `rerenderAll`): union, do not revive buried tags; then `saveTagData(true)` + silent saves of `qyx_log/qyx_months/qyx_enough`.
- `saveTagData(silent)` (L:1369) writes all five of `qyx_tags, qyx_record_tags, qyx_goal_tags, qyx_task_tags, qyx_task_goals`; `silent=true` -> `setSilent`. Every record path in this spec calls it silent and relies on a following `LS.set("qyx_log")` for dirtiness; `delete` removes `recordTags[id]`.
- Chips: `renderTagChips(ids)` (L:1375): unique ids that still exist, `<button class="tag-chip" data-open-tag=id>#<full path></button>`; global click opens tag detail (tag library is a separate spec). Chips shown in the 说说 row, idea timeline article, task relations.
- Tag deletion is by tombstone `{s:"tag", v:<tagId>}`; creating the tag again via typing `#path` in a *new/edited* record un-buries it.
- Hint under composers: "可在正文中输入 #标签" (continue) / "正文支持 #多层/标签" (new idea).

---

## 7. Checklist extraction and v5 tasks

### 7.1 Extraction (V:139)
Applied to the composer text (after ref restore) in `submitComposer` (not for `existing`) and to edit text. Per line, regex `^\s*[-*]\s+\[([ xX])\]\s+(.+)$` with non-empty trimmed text -> removed from the body and turned into a task `{id:"plan_"+uid, recordId, text:trim, done: mark is x/X, scheduledDate:null, order: index among extracted in this call, createdAt:now, updatedAt:now}` (`Date.now()` per task). Remaining lines are joined with `\n` and `trim()`med -> `record.text`.
- Consequence: a note consisting only of checklist lines is stored with `text: ""` (O4). Reading checklist lines is only possible through `recordTasks`; `- [ ]` lines with *empty* text stay in the body.
- Edit does not delete or update existing tasks of the record; newly typed `- [ ]` lines add new tasks with `order` starting again at 0 (O5).

### 7.2 Task model
`qyx_ideas_v5.tasks[]`: `PlanTask` per types.ts. `recordTasks(recordId)` = active tasks sorted by `order` then id.

### 7.3 Task UI (V:148-191, 530-539)
Under a record body (说说 row and idea timeline): per task `[○/✓ button] text [安排到 YYYY-MM-DD] [… 清单操作]`. Toggle `○/✓` (aria "标记完成"/"取消完成"): `done=!done`, `saveTask(t)` (`updatedAt=max(now,updatedAt+1)`, `persist()`, mirror into today's `qyx_enough` row if `v5TaskId===t.id`, re-render everything); if the task is selected in today's three: `addDoneLogOnce(text,"三件")` / `removeDoneLogToday(text,"三件")`.
"…" menu (title = task text): **修改文字** (dialog "修改清单项"; empty -> toast "清单文字不能为空。"), **安排到某天** (今天 / 明天 / 选择日期 (YYYY-MM-DD, validated; bad -> toast "日期格式不正确，安排没有改变。") / 清除安排), **上移 / 下移** (swap `order` with neighbour, bump neighbour `updatedAt`), **移出今天三件事（保留原计划）** (only if mirrored today), **删除清单项** (confirm "删除这条清单？ / 正文记录仍会保留；若已选入今天三件事，也会一起移出。" -> `removedAt=now`; mirror row blanked).
Today-page "安排到这一天" card lists scheduled ideas/tasks and `选入三件事` writes `qyx_enough.items[slot]` with `v5TaskId` / `v5IdeaId` (V:192-215) — owned by the Today spec; note only that `v5TaskId`/`v5IdeaId` mirrors must keep being written.
`qyx_ideas_v5` saved through `persist()` = `LS.set` (dirty).

---

## 8. 消息盒子 (ideas)

### 8.1 Data (qyx_ideas_v5, synced, schema 2 written)
`{schema:2, items:Idea[], links:IdeaLink[], events:IdeaEvent[], tasks:PlanTask[]}`.
- `mergeState` (V:18): per array, union by `id`, valid ids `/^[-\w:.]+$/` (also `recordId/ideaId/rootRecordId` if present), newer `updatedAt` wins, tie -> larger `JSON.stringify`; output sorted by `id.localeCompare`; schema forced to 2. `persist()` = `state=mergeState(read(stored),state); LS.set(KEY,state)`.
- Icon keys (V:110-112) and names: star 小星星, sprout 小芽, cup 杯子, note 便笺, camera 相机, plane 小飞机, flower 小花, wave 海浪, light 灯泡, bottle 小瓶子. Unknown icon -> "star" (normalised in memory on load, V:114).
- Title: `title(i) = i.title || excerptText(first sentence (split on \n 。！？) of rootRecord text, or tasks joined "、", or "暂存的想法").slice(0,32)`. An empty stored `title` means "auto".
- `contentTime(i) = max(i.createdAt, max over active links of (record.updatedAt||record.t))` — the "update time" shown/sorted. `activityAt` and `i.updatedAt` are **not** used for sorting.

### 8.2 List page (v-ideas, V:223-283)
UI: small "一点一点，接着写", H1 **消息盒子**, primary button **记个想法**; tools row: **⌕ 搜索** toggle (aria-expanded) revealing search input (label "搜索想法", placeholder "标题、最初的念头、后来的补充"; closing clears query), **排序** select: 最近更新 (`recent`, default) / 最早更新 (`oldest-update`) / 新建在前 (`created-new`) / 最早建立 (`created-old`) — persisted in `qyx_v51_view.order` (raw, local-only); filter pills **全部 / 未完成 / 已完成** (memory only, `aria-pressed`).
- Filter: `!removedAt`, status match, and if query: lowercase includes in title, in any linked record text, or in that record's task text.
- Sort: `recent`/`created-new` descending, others ascending; key `contentTime` or `createdAt`; tie `id.localeCompare`.
- Card: icon, **title**, excerpt (text of most recently updated linked record, else its tasks joined "、", else "原始记录已移除，其他补充仍保留"), small line `内容更新 MM/DD HH:mm[ · 已完成] · N 次补充[ · 安排到 YYYY-MM-DD]` (N = active non-root links), "…" button (aria "想法菜单"). With a query up to 3 hit buttons `date · excerpt70` jump into the detail at that record. Empty list: "给一个想法留个位置。" / "以后想到什么，还能回来接着写。".
- Tapping a card remembers `main.scrollTop`; back restores it.

### 8.3 Create idea: **记个想法** composer `openComposer(linkRecord)` (V:312)
Page "记个想法": back **‹ 消息盒子**; **归属** select ("新建一条想法" + all ideas); when a target is chosen the new-idea meta is hidden. New-idea meta: details **选择一个小图标** (10 icon buttons, default `star`) and **标题（可选）** input (placeholder "给这个想法起个名字"). Textarea label **现在想到的** (placeholder "一点想法、一段话，都可以留在这里"), Aa 排版, hint "正文支持 #多层/标签", buttons **语音输入**, **保存想法**.
- Draft context `new-idea` (or `new-from:<recordId>`); the draft also stores `title`, `icon`, `ideaTarget` (each change re-writes the draft).
- Save: target empty -> `submitComposer(..., ideaId=null, config={title:trim, icon:chosen}, existing)` = create idea (see 3.3 step 7): idea `idea_<sid>`, root record `rec5_<sid>` (mood null), link `link_rec5_<sid>` role `root`. Target set -> append to that idea (role `update`). After success the app opens the idea timeline.
- **作为新想法 from 收进消息盒子** (`existing`): textarea is set `readOnly` and voice hidden but is **never prefilled with the record text**, so `submitComposer` sees an empty value and returns silently — the flow cannot complete (O1). Intended data effect (for the port): create `idea_<sid>` with `rootRecordId=record.id`, link `{id:"link_"+record.id, role:"root"}`, no new record, no tasks.

### 8.4 Idea menu `ideaMenu(id)` (V:328; "…" on card and detail header) — dialog title = idea title
Options: **接着写** (open detail), **修改标题**, **更换图标**, **安排到某天**, **标记完成 / 重新打开**, **导出完整时间线**, **从消息盒子移除（保留说说）**.
| Action | UI | Data effect |
|---|---|---|
| 修改标题 | line dialog "修改标题" (prefilled with stored title) | `i.title=text.trim()` (empty = back to auto). `statusUpdatedAt=updatedAt`. If mirrored in today's three and completed: `removeDoneLogToday(oldTitle,"三件")`+`addDoneLogOnce(newTitle,"三件")`. |
| 更换图标 | pick dialog of 10 names | `i.icon=key` |
| 安排到某天 | pick: 今天 / 明天 / 选择日期 (line "输入日期 YYYY-MM-DD", invalid -> toast "日期格式不正确，安排没有改变。") / 清除安排 | `i.scheduledDate="YYYY-MM-DD"` or `null`. (+1 day computed with `setDate(+1)`, local.) |
| 标记完成 / 重新打开 | direct toggle, no confirm | `i.status` toggles `open<->completed`; `i.completedAt = now` when completed else `null`; push event `{id:uid, ideaId, event:i.status, t:now, updatedAt:now}`; `statusUpdatedAt=updatedAt`. If a today's-three row has `v5IdeaId===id`: completed -> `addDoneLogOnce(title,"三件")`, reopened -> `removeDoneLogToday(prevTitle,"三件")`. |
| 从消息盒子移除 | confirm "从消息盒子移除？ / 所有正文仍保留在说说中。完整备份会保留恢复信息。" (danger) | `i.removedAt=now` (soft; no restore UI). Records/links/tasks untouched. |
| 导出完整时间线 | downloads `<title>.md` = `# title` + per linked record (t asc) `## <date>` + `stripRefs(text)`; **no data change** | none |
Common tail (all but continue/export): `i.updatedAt=max(now, i.updatedAt+1)`; `persist()` (`LS.set(qyx_ideas_v5)`, dirty); `renderLog(); renderEnough();` re-render detail (or `back()` if the idea vanished) and list.
Done-log side effects above call `addLog`/`bury` -> `qyx_log` and `qyx_dead` dirty writes.
Cloud-side mirror: today's-three row `v5IdeaId` is reconciled by `statusUpdatedAt` vs row `updatedAt` (V:56-95, 671-708); pass-through behaviour is defined in the Today spec / DATA-CONTRACT rule 4 & D4.

### 8.5 Idea detail / timeline (V:284-311)
- Header: **‹ 消息盒子**, icon, H1 title, "…" menu. Status line "已完成 · 仍然可以接着写" when completed; "安排到 YYYY-MM-DD" when scheduled.
- **筛选与排序** details: 顺序 (从旧到新 `oldest` default / 最新在前 `newest`), 从/到 dates, 内容 (全部内容 / 含计划 / 含图片), button **全部过程** (clears from/to/kind). All persisted in `qyx_v51_view` (`detailOrder, detailFrom, detailTo, detailKind`; local-only, shared across ideas). Filters work on record local day; "含计划" = record has tasks or text matches `^\s*[-*]\s+\[[ xX]\]`; "含图片" checks `attachments/images` fields that the data model never has (O7). Records that are missing are only shown when no filter is active. `回到开头` / `最新更新` smooth-scroll buttons when >1 shown. Hint "已定位到搜索结果；本次暂时放宽了筛选。" when opened with a target record not matching the filters.
- Timeline order: active links sorted by `(record.t || link.linkedAt)`, tie link id; reversed if `newest`. A `<h3>` day marker (`YYYY-MM-DD`) at each change of local day.
- Each link article: small `最初写下` (role root) / `接着写` + `MM/DD HH:mm` of the record + ` · 编辑过` if `updatedAt>t+1000`; per-record "…" (`这段记录的菜单`, same as 4.2); markdown body; tasks; tag chips; **移出此想法** (non-root). Dangling link -> "这条记录已从说说中删除。其余补充仍然保留。" (no menu).
- Events list under the timeline: `MM/DD HH:mm · 标记完成 | 重新打开`, sorted by `t`.
- Continue composer: **接着写** heading, textarea "补充一点新的想法……", Aa 排版, "可在正文中输入 #标签", **语音输入**, **保存补充**. Draft context `idea:<id>`; submit = 3.3 with `ideaId=id` (role `update`, record mood null). After saving the page re-renders into the idea (`openIdea`).

---

## 9. Not covered here / adjacent
Export center & day PNG export (`openExportCenter`, `exportDay`), tag library UI (rename/merge/delete via `migrateTag`, `bury("tag")`), Today's-three (`qyx_enough`) mirror writers, 回看这一天 daily-review card (lives on 瓶子 page, `qyx_daily_review_v51`), settings backup/import (`completeBackup` also exports `localRecovery` = all draft/receipt/pending/voice/pre5 keys; import writes them back only if absent), sync merge (`mergeAll`, `next/src/core/merge.ts`).

---

## 10. OBSERVATIONS (bugs / oddities)

- **O1** 收进消息盒子 -> 作为新想法 (V:312-326): textarea is `readOnly`, never filled with the record text; save is a silent no-op. Feature appears non-functional in 5.1.3.1. Rewrite should implement the intended "make existing record the root of a new idea" (no new record).
- **O2** Legacy edit (L:3966-3970) buries the old id and mints `rec_<fnv(oldId|edit|now)>`; disabled in live app for rows with an id (V:526), but remains active for id-less rows and would orphan v5 links/tasks. Port should only implement the v5 edit (id kept, `updatedAt` bumped, `v5StableId:true`).
- **O3** v5 edit has no "unchanged" check: saving identical text still bumps `updatedAt`, sets `v5StableId`, adds any checklist tasks, re-indexes tags and touches the idea.
- **O4** A note consisting only of `- [ ]` lines is stored with `text:""`; edit of such a record opens an empty box.
- **O5** Edit never reconciles existing tasks: previously extracted tasks are not shown in the edit box, new `- [ ]` lines create additional tasks with `order` restarting at 0 (ties then fall to id sort, so 上移/下移 swap of equal orders is a no-op).
- **O6** `polishHistory` entry is written only if `pendingPolish.polished === saved text` (post checklist/ref processing); mismatches are silently dropped. `voiceOriginal` is the whole textarea, not only the dictated part. Panel only appears after voice (context `note`), never for typed text.
- **O7** Idea-detail filter "含图片" tests `attachments/images`, fields that do not exist; always returns nothing for real data. Images are not rendered anywhere in record text.
- **O8** "One owner per record" is a UI rule only; ids differ (`link_<rid>` vs `link_<rid>_<ideaId>`) so concurrent devices can produce two active links; `owner()` just takes the first in id order.
- **O9** `@` references are keyed by `(type, minute, order-in-minute)`, not record id; they can re-point or go grey after sync/deletion. Types dice/draw/bonus/mark are not referenceable.
- **O10** `jumpToEntry` finds the row by `data-t === entry.t`; two rows with the same `t` resolve to the first. Reference "去那条 →" inside an idea timeline jumps to 说说 rather than staying in the idea (shelf button uses the idea).
- **O11** `selectedMood` is memory-only (not in draft); text draft survives, mood does not.
- **O12** `saveDraft` returns `undefined` when a receipt already exists for the current submissionId and the text is unchanged (cross-tab race / stale restore); `submitComposer` then dereferences `d.submissionId` outside its `try` -> uncaught TypeError instead of the intended idempotent clear.
- **O13** Tag-suggest pick (`handleTagSuggest`, L:4917) assigns `el.value` without firing `input`, so the v5 draft is saved only on the next input/submit; a crash right after leaves the draft without the tag.
- **O14** The "…" menu is attached to every row type (dice/done/ai/mark/bonus); editing an `ai` or `mark` row's text is possible; deleting a `done` row created by 三件 logic can be re-created by `addDoneLogOnce` later.
- **O15** Delete leaves dangling `links`, `tasks`, drafts and receipts for the record; idea `updatedAt` is not bumped, so other devices learn of the deletion only via the `log` tombstone.
- **O16** 收进消息盒子 / 更改归属 / 移出此想法 do not bump `idea.updatedAt/activityAt`; ordering is unaffected (uses record times) but "活动" fields in types.ts are only maintained by the composer and edit paths.
- **O17** `renderLog` can write (`dedupeDoneLogEntries` -> `LS.set` + tombstones) during a plain render; any port that renders purely should move this dedupe to load/merge time.
- **O18** `r.v5StableId` is the boolean `true` although `types.ts` declares `string`; keep writing `true` for old-client compatibility (only truthiness is tested).
- **O19** Greeting count "今天已记 N 笔" counts every type including marks and done logs.
- **O20** Legacy list-continuation: Enter on a checklist line continues with plain `- `.
- **O21** `stableId` hashes only the first UTF-16 unit of astral characters (matches `next/src/core/util.ts`; keep).
- **O22** The `ready=false` path (snapshot cannot be saved) blocks all composer submits and `persist()`; the rewrite needs an equivalent "storage full" guard or a clear failure mode that never drops text (drafts are kept).

---

## 11. localStorage keys touched by this area

Synced (in Gist via BACKUP_KEYS / v5 keys; written with `LS.set` unless noted)
| Key | Written by |
|---|---|
| `qyx_log` | submit/recover (`LS.set`), edit, delete, nudge mark, 补勾, done-log helpers, dedupe-on-render; merge/boot use `setSilent` |
| `qyx_dead` | `bury/unbury` (`LS.set`): scopes used here = `log` (record delete, done dedupe), `tag` (unbury on re-add), `nudge` |
| `qyx_ideas_v5` | `persist()` / submit (`LS.set`); recover/import/merge use raw write or `setSilent` |
| `qyx_tags`, `qyx_record_tags` (also `qyx_goal_tags`, `qyx_task_tags`, `qyx_task_goals` via `saveTagData`) | `saveTagData(true)` = `setSilent` from record paths; `LS.set` from tag library |
| `qyx_polish_history` | `LS.set` on save of an applied polish |
| `qyx_enough` / `qyx_enough_prev` / `qyx_sums` | read (yesterday card); `qyx_enough` mirrored on idea/task status via `oldSaveEnough`; `qyx_sums` written by 补勾 |
| `qyx_provider` | read for polish (setSilent migration; not dirty even with `LS.set`) |
Not synced / local-only
| Key | Purpose |
|---|---|
| `qyx_draft_v5:<context>` | composer drafts (raw write) |
| `qyx_submit_v5:<submissionId>` | submit receipts (raw write) |
| `qyx_v5_pending` | in-flight transaction (raw write; removed after recover) |
| `qyx_voice_recovery_v5` | voice crash recovery |
| `qyx_pre5_snapshot` | pre-5.0 snapshot (also gates `ready`); `qyx_preimport_snapshot`, `qyx_range_import_v5` from import |
| `qyx_v51_view` | idea list/detail sort+filter prefs |
| `qyx_nudge_local`, `qyx_trace_local` | nudge counters, typing-trace samples |
| `qyx_sumseen` | dismissed yesterday banner day |
| `qyx_v5_motion` | motion preference (settings) |
| `qyx_key`, `qyx_ghtoken` | AI key / GitHub token (read for polish and toast "等待云端确认") |
| `qyx_lastchange`, `qyx_lastbackup` | dirty tracking, written by `LS.set` |
| `qyx_tag_tree_open` | tag library tree state (`setSilent`) |

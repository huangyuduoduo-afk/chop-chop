# 今天 page (legacy `#v-stuck`) — feature spec for the rewrite

Source of truth read: `index.html` (legacy inline script) + `assets/v5.js` + `assets/v5.css` (overlay), as of APP_VERSION 5.1.3.1.
`index.html:N` = line in repo-root index.html; `v5.js:N` = line in assets/v5.js.
Data shapes: `next/src/core/types.ts`; merge behaviour: `next/src/core/merge.ts` (already a port; not repeated here except where the UI depends on it).

Legend: **LS.set** = writes key AND sets `qyx_lastchange=now` (device "dirty", triggers 200 ms-debounced auto-sync if a token exists). **silent** = `LS.setSilent`, no dirty. Dirty is a single global flag, so a silent write rides along with the next dirty write. Excluded from dirtying even with LS.set: `qyx_lastbackup, qyx_lastchange, qyx_gistid, qyx_sumseen, qyx_ghtoken, qyx_key, qyx_provider` (index.html:1288-1297).

---------------------------------------------------------------------------------------------------

## 0. Page map

### 0.1 Final card order on 今天 after v5 DOM moves (v5.js:229-236)

Legacy DOM order: title, 问一问 (`.v3-today-ask`), 三件事 (`#enoughCard`), Bonus (`#bonusCard`), 交给随机 (`.v3-random`).
v5 moves `#enoughCard` right after the title, inserts a `<details class="v5-day-plans">` after it, and moves 问一问 to directly before 交给随机. **Final order, top to bottom:**

1. Title: `今天` / `先理清，再把注意力放回眼前。` / ☀ (index.html:908)
2. **今天的三件事** card (`#enoughCard`; legacy label `今天只做三件事 / 聚焦重点，少即是多。` is overwritten by v5 to `今天的三件事` / `写下今天想留意的事。`, v5.js:232-233)
   - 3 rows (each: `.ecirc` circle, text input, v5 `…` menu, sub-item chips `.esubs`, relation chips `.task-tag-row`, `.wait-wrap`)
   - 抽屉 row (`#drawerRow`), 常规 row (`#routineRow`), `今天，够了。` (`#enoughFin`), 往日写过的事项 fold (`#optsHistoryBlock`)
3. **安排到这一天 <count>** `<details>` (collapsed by default) — v5 day plans
4. **Bonus · 想挑战就写一个** card (`#bonusCard`, dashed border)
5. **问一问** card (`.v3-today-ask`) — contains buddy SVG (top-right, absolute), 问一问 AI panel, 我的准则 fold
6. **交给随机** card (`.v3-random`): hero dice button, 签 (qian) card, 就这个/再掷, add-opt row, 打转 chips, 待选 fold, 定过的 fold, 动不了的时候 fold

### 0.2 What v5.css hides / what the `…` menus click (v5.css:56)

- Hidden with `display:none!important` on every row: `拆` (`.esub-add`), `关联目标` (`.task-goal-btn`), `# 标签` (`.task-tag-btn`), `删除` (`.task-delete`). Still in DOM and still wired; the `…` menu calls `.click()` on them.
- Hidden on every sub chip: `＋` (`.splus`), `→骰` (`.todice`), `✕` (`.x`). Still wired; sub `…` menu clicks them.
- Still visible on sub chip: `.chk` (✓ / × / empty), `.stx` (text, click = edit), `.scnt` (`×N`, click = minus one), plus v5 `…`.
- Row-level `…` (`.v51-task-menu`) is created only when the row's input has text; rows with empty text get class `v51-empty-task` (menu hidden).
- Not hidden: `.wait-wrap` (挂了 N 天 + 20 分钟), `.task-tag-row` (goal chip + tag chips).

### 0.3 Not on this page (verified)

- **Habits grid** (`#habitGrid`) is in `#v-month` (成长地图), index.html:1030. `renderHabits()` is merely re-invoked on day rollover.
- **久坐提醒 / sit reminder** (`#habitReminder`, `qyx_sit_reminder`) is in `#v-log` (说说), index.html:1149. Setting is in the gear dialog. Not rendered in v-stuck.
- **昨日总结 card** (`#yesterdayReview`, `qyx_enough_prev`/`qyx_bonus_prev` consumer) is in `#v-log`, index.html:1104 (see 9). Documented here because rollover feeds it.
- Buddy on v-log is replaced by `assets/avatar-v5.jpg` in v5 (v5.js:641). **On 今天 the legacy buddy SVG stays** (see 8).
- Default landing view is `#v-log` (`class="view on"`, index.html:1082), not 今天. v5 nav order: 消息盒子, 今天, 说说(renamed from 记录), then rest (v5.js:225-228).

---------------------------------------------------------------------------------------------------

## 1. Shared primitives the Today page writes through

| Primitive | Behaviour | Source |
|---|---|---|
| `stableId(prefix, value)` | FNV-1a 32-bit: `h=2166136261; for (ch of String(value)) { h ^= ch.charCodeAt(0); h = Math.imul(h,16777619) } → prefix + (h>>>0).toString(36)`. Note `for..of` iterates code points but takes `charCodeAt(0)` (high surrogate only for astral chars). `entityId` is an alias. | index.html:1349 |
| `addLog(type,text,mood,src,q)` | Creates `{id:"rec_"+fnv36(now+"|"+Math.random()), t:now, updatedAt:now, type, text, mood:mood\|\|null, src:src\|\|null, q:q\|\|null}`, pushes to `log`, `indexRecordTags(entry,true)` (parses `#tag/paths` out of `text`, creates tags via `ensureTagPath(revive=true)` which also **unburies** `tag` tombstones, sets `qyx_record_tags[id]`), `saveTagData(true)` (**silent**: qyx_tags, qyx_record_tags, qyx_goal_tags, qyx_task_tags, qyx_task_goals), then **LS.set `qyx_log`**; `markNudgeActed()` for note/done. So a done/dice/ai/bonus log whose text contains `#x` creates a tag. | 1470 |
| `addDoneLogOnce(text,src)` | identity = `dayKey(now)\|done\|src\|text` (exact text, not trimmed); returns existing entry if found, else `addLog("done",text,null,src)`. | 3839 |
| `removeDoneLogToday(text,src)` | finds first `done` entry with same identity today (**today only**); `bury("log", e.id)`; `delete qyx_record_tags[e.id]`; `saveTagData(true)` silent; splice; **LS.set `qyx_log`**; `renderLog()`. Returns false if none. | 3844 |
| `bury(scope,val)` | push `{s,v,t:now}` unless same s+v exists; trim at >1200 (keep newest 250 per scope); **LS.set `qyx_dead`** (always, even if already present). | 4294 |
| `unbury(scope,val)` | filter out; **LS.set `qyx_dead` only if something was removed**. | 4316 |
| `saveTagData(silent=false)` | writes all five `qyx_tags, qyx_record_tags, qyx_goal_tags, qyx_task_tags, qyx_task_goals` (LS.set unless `silent`). | 1369 |
| `dayKey(t)` | local `YYYY-MM-DD`. All "today" logic is local time. | 3828 |
| `esc`, toast | `toastDone(msg)` — v5 replaces it with a status pill, 2.1 s, errors (`失败\|尚未\|错误\|不足\|不支持\|无法\|无效`) stay and use `role=alert` (v5.js:~727). | |
| `appDialog({title,text,input:'line'\|'area',value,placeholder,pick:{options,multi,max,section},okText,danger})` | Promise; `null` = cancel; `pick` alone → array of chosen `value`s (single pick closes on click); `input`+`pick` → `{line, picked}`; confirm-only → boolean. Pick rows may be `editable`/`deletable` (v5 turns these into a `…` popover with 修改/删除). | 1550-1585 |

**Done-log `src` strings used by Today:** `三件` (parent row), `三件·小项` (sub ×1), `三件·小项 ×N` (N≥2), `定过的` (ongoing ✓). Log `type`s written by Today: `done`, `dice`, `ai`, `bonus`, `note` (20-min timer).

---------------------------------------------------------------------------------------------------

## 2. 今天的三件事 (`qyx_enough`)

### 2.1 Stored shape
`qyx_enough = {d:"YYYY-MM-DD", items:[ {id, text, done, status, updatedAt, subs:[{text,done,status,updatedAt,c?}], v5TaskId?, v5IdeaId?} ×3 ]}`. Always exactly 3 items in memory (sliced/padded in `ensureEnough`). `status ∈ completed|incomplete|expired|deleted`; `done === (status==='completed')`. Sub status ∈ completed|incomplete|expired (never deleted). `c` only kept when sub completed and c>0 (`normalizeEnoughSub`, 2984).
Item id: `entityId("task_", Date.now()+"\|"+Math.random())` (blankEnoughItem 2955; `normalizeEnoughItem` 3000 fills a missing id the same way; `initTagSystem` 1415 uses `task_`+fnv(`d\|i\|text`) for id-less items at boot, written silent).
When a row mirrors a v5 plan/idea, **the item id becomes the plan id (`plan_<uuid>`) or idea id (`idea_…`)** (see 4).

### 2.2 `ensureEnough()` — load + day rollover (index.html:3052)
Called: at boot (4969+), every 60 s tick when `dayKey` changed (4992), in `addToToday/addToTodaySmart`, `selectTaskForToday/IdeaForToday`, `rerenderAll`.

Steps:
1. If `!enough || enough.d !== today`:
   a. If old `enough.items.some(i=>i.text)` (any non-empty string, even whitespace or deleted rows):
      - `previous = {...enough, items: items.map(normalizeEnoughItem).filter(text.trim() && status!=='deleted')}` (keeps old `d`; items compact, slot positions lost; v5TaskId/v5IdeaId carried). **Only if `previous.items.length`** → **LS.set `qyx_enough_prev`** (otherwise the older prev stays).
      - **Harvest**: `harvestT = new Date(old.d+"T12:00:00").getTime()`; for every sub of every raw old item with `status !== 'completed'` (i.e. incomplete AND expired), non-blank text, and `!isDead("esub:"+old.d, text)` → `rememberOpt(sub.text, harvestT)` (see 6.2). Parent-level unfinished tasks are NOT harvested.
   b. `enough = {d:today, items:[blank×3]}`; **silent** `qyx_enough` ("auto reset isn't a local change").
2. Always (every call): `items = items.map(normalizeEnoughItem).slice(0,3)`; any item with blank text and `status!=='incomplete'` is reset to `incomplete/done:false` (this also un-deletes blank deleted rows); `syncParentFromSubs` on each; pad to 3 blanks. **Not persisted** unless a later `saveEnough` runs (so id/normalisation fixes may stay in-memory until the next edit).

Edge/observation:
- Harvest + prev write use **LS.set**, so an automatic midnight rollover marks the device dirty even though the user did nothing. The reset itself is silent.
- `qyx_enough_prev` is only ever the *last non-empty* day; skipped days leave a stale `prev.d` (consumers check `prev.d === yesterdayKey`).

### 2.3 Row UI and per-row actions

| UI (verbatim) | Action | Data effect | Src |
|---|---|---|---|
| input placeholders `第一件` / `第二件` / `第三件` | type (every keystroke, `input` event) | `item.text = value`; if `status==='deleted'` → `incomplete`; if value blank: `if wasCompleted removeDoneLogToday(prevText,"三件")`, `status='incomplete'`, `subs=[]`; `done=(status==='completed')`; `updatedAt=now`; `saveEnough()` (**LS.set qyx_enough**, plus v5 mirror push, see 4.3); `renderEnough()`. | 3230-3243 |
| `.ecirc` circle (title `点击标记完成` / `再次点击标记时间结束` / `再次点击恢复空心`) | click | If item has subs: `syncParentFromSubs; saveEnough; renderEnough`; toast `分项都完成后，主项会自动打勾。` if not completed; nothing else. Else `setEnoughStatus(i, completed?'incomplete':'completed')`. | 3263 |
| `setEnoughStatus(i,status)` | | Guard: blank text → return. `before=enoughStatus(item)`; `item.status = before===status ? 'incomplete' : status`; `done`; `updatedAt=now`; **saveEnough**; render. If now completed and before≠completed: `addDoneLogOnce(text,"三件")`, `buddySay("done")`, and if all 3 filled-alive rows completed toast `今天，够了。`. Else: if before was completed → `removeDoneLogToday(text,"三件")`; if status expired toast `这件事先停在这里，留给以后回望。`. | 3246 |
| `#enoughFin` text `今天，够了。` | shown when exactly 3 alive non-blank rows all completed | display only | 3195 |
| `…` (aria `事项操作`) title `这件事` | pick: `拆小项` / `关联月目标` / `管理标签` / `删除这件事` | clicks hidden `.esub-add` / `.task-goal-btn` / `.task-tag-btn` / `.task-delete` | v5.js:711-718 |
| 拆 (拆小项) | see 3 | | |
| 关联目标 | see 2.5 | | |
| `# 标签` | see 2.5 | | |
| 删除 | dialog title `删除这件事？`, text `删除后不会进入昨日总结。`, ok `删除` (danger). On confirm: `bury("esub:"+d, sub.text)` for every sub; `delete qyx_task_tags[item.id]`; `qyx_task_goals[item.id]=null`; `saveTagData(true)` (silent); `item.subs=[]; done=false; status='deleted'; updatedAt=now` — **`item.text` is kept**; `saveEnough` (LS.set); render; `renderOptsHistory`; toast `删掉了，不会进入昨日总结。`. Guard: blank or already deleted → noop. | 3270-3282 |

Display rules (`renderEnough`, 3106): input shows `""` for deleted rows (text retained in data); classes `donetext` (completed), `expiredtext`; circle classes `on`/`expired`; `.esubs`, `.task-tag-row` (goal chip + tag chips), `.wait-wrap`, `#enoughFin`, then `renderDrawerRow()` and `renderRoutines()`.

`syncParentFromSubs(item)` (3004): if item has subs: `status = all subs completed ? completed : incomplete` (an `expired` sub counts as not completed; this **overwrites a parent's own status**), `done`, `updatedAt = max(item.updatedAt, ...subs.updatedAt)`. Does nothing when subs is empty.

Parent status `expired` is **unreachable from the UI** (circle only toggles completed/incomplete; the strings/titles/toast for expired are dead; only sync from other clients can produce it). Sub `expired` is reachable (3-state check).

### 2.4 Sub-items (小项) — see section 3 for add; here per-chip behaviour

Chip layout: `[chk] [stx text] [splus] [scnt ×N if count≥2] [todice] [x] [v5 …]`. Chip classes `sdone`, `sexpired`. Text rendered with only `<`→`&lt;` escaping (3128).

Count model: `subCount(sub)` (2974) = from **today's done log** (entries `type==='done'`, `dayKey(e.t)===today`, trimmed text equal, `src` startsWith `三件·小项`; take max of `×N` suffix, plain = 1) → if >0 `max(logCount, sub.c)`; else `sub.c` if >0; else 1 if completed else 0. `subDoneSrc(n) = n>=2 ? "三件·小项 ×"+n : "三件·小项"`.

| UI | Action | Data effect |
|---|---|---|
| `.chk` (title `点击切换：完成 / 时间结束 / 未完成`) | click | `prev=status`; cycle `incomplete→completed→expired→incomplete`; `done`; (`if completed && subCount<1: c=1` — dead, subCount is already ≥1 once status=completed); if new status ≠ completed: `n=subCount(sub)`; `for k=n..2 removeDoneLogToday(text, subDoneSrc(k))`; `sub.c=0`. `sub.updatedAt=now`; `syncParentFromSubs`; **saveEnough**. Then: completed → `addDoneLogOnce(text,"三件·小项")`; else if prev was completed → `removeDoneLogToday(text,"三件·小项")`. Re-render + `renderLog()`. |
| `＋` (hidden; menu `再做一次`) | click | `n=subCount+1`; `sub.c=n; status=completed; done=true; updatedAt=now`; `syncParentFromSubs`; **saveEnough**; `addDoneLogOnce(text, subDoneSrc(n))`. |
| `×N` (`title 点一下减一次`) | click, only visible when count≥2 | `removeDoneLogToday(text, subDoneSrc(n))`; `sub.c=n-1`; `updatedAt=now`; saveEnough. (Does not call syncParent.) |
| `.stx` text (menu `修改文字`) | dialog `修改小项` | blank → toast `小项文字不能为空，可以用右侧 × 删除。`; same text → noop. `bury("esub:"+d, oldText)`, `unbury("esub:"+d, next)`; if sub completed: `removeDoneLogToday(old,"三件·小项")`, `addDoneLogOnce(next,"三件·小项")` (**only the ×1 entry**; ×2.. entries stay under the old text and the new text restarts at count 1); `text=next; updatedAt=now`; syncParent; saveEnough. |
| `→骰` (menu `交给随机`) | click | `addToOpts(sub.text)` (see 6.1). Sub stays. |
| `✕` (menu `移除小项`) | click | `subs.splice`; `item.updatedAt=now`; syncParent; `bury("esub:"+d, text)`; saveEnough. Its done-log entries are NOT removed. |
| `…` (aria `小项操作`, title `这条小项`) | pick `修改文字`/`再做一次`/`交给随机`/`移除小项` | clicks the hidden/visible control above. |

### 2.5 Task ↔ goal / tag binding

- **关联目标** (`[data-task-goal]`): blank text → toast `先写上这件事。`. `bindGoalForTask(item)` (1408): goals = `monthAnchors()` (current month's anchors, includes watch + done; also lazily creates the month with carried watch items, see month spec). None → toast `先在「目标」页写下一个本月方向。`. Dialog title `关联本月目标`, text `<n>. <goal text>（当前）…\n\n输入编号；输入 0 取消关联。`, placeholder `目标编号`, prefilled with the current number. Value: `0` or blank → `qyx_task_goals[item.id]=null`; integer in range → `=goals[n-1].id` (string or number as stored); else toast `没有找到这个编号。` and abort. Then `saveTagData()` (LS.set ×5) + `renderEnough`.
- **# 标签** `bindTagsFor('task', item.id, current)` (1403): dialog `关联标签`, text `可以写多个，用空格分开。`, placeholder `输入 # 开头的标签，多个用空格分开`, prefilled `#path #path…`. `parseTagPaths` (regex `#([^\s#，。！？；：、]+)`, strips trailing punctuation, `/`-paths); `ensureTagPath(path)` creates each path segment tag `{id:"tag_"+fnv(fullPath), name, parent_id, created_time:now, updated_time:now}` and unburies `tag` tombstones; `qyx_task_tags[item.id] = ids` (**replaces**; empty list when none); `saveTagData()`; `renderMonth(); renderEnough()`. Cancel → null → noop.
- **Chips** (`renderTaskRelations`, 1414): `↗ 月目标：<goal text>` (class `task-goal-chip`, click = re-bind dialog) + `#<tagPath>` buttons (`data-open-tag`) for the union of `taskTags[item.id]` and `goalTags[goal.id]`. Goal lookup `goalById` scans all months by `String(id)`.
- **挂了 N 天 / 20 分钟** (`[data-wait]`, 3186): `waitingDays(goalId)` (3077): 0 if no goal or the goal is a watch card; counts distinct days among the last 10 (today..−9) whose `qyx_sums[day].three` has an entry with `String(x.goal)===goalId && !x.done`; plus 1 for today if `qyx_sums[today]` doesn't exist and a today row bound to that goal is non-blank, not completed, not deleted. Shown when ≥3: `<span class="wait-days">挂了 N 天</span><button class="wait-20" data-start-focus>20 分钟</button>`.
  - `startTwentyMinutes(item)`: if same item already running → noop; clears another running timer; `addLog("note", "开始 20 分钟：<text>")` (**type note, src null**, appears in 说说) + `renderLog()`; in-memory timer (not persisted) with button label `MM:SS` countdown; end: toast `20 分钟到了。`.
- Relations are keyed by item id. A new day creates new ids, so yesterday's goal/tag bindings stay with `qyx_enough_prev` item ids (used by month "trail" and `qyx_sums[day].three[].goal`).
- Sync note (merge.ts): when merging a same-day slot where the remote id differs and local text was empty, local takes the remote id and `taskTags`/`taskGoals` of the remote id are folded in.

### 2.6 OBSERVATIONS (三件事)
1. **Completing / un-completing with subs never writes the parent `三件` done-log** (circle is inert when subs exist; parent auto-flips via syncParent). Sub completions log `三件·小项`. Conversely, adding an incomplete sub to a completed parent flips it to incomplete without removing the existing `三件` done entry.
2. **Deleted rows keep `text`.** Clicking the circle on a visually blank deleted row passes the `item.text.trim()` guard and resurrects it as `completed` with its old text (and logs `三件`). Deleted rows' text also still counts as "in play" for 往日写过的事项 filtering and shows in v5 slot pickers as `第 N 件 · <old text>`.
3. Delete does not remove done-log entries for the item or its completed subs, nor `taskTags/taskGoals` of mirrored ids elsewhere.
4. Editing the text of an already-completed parent (non-mirrored) leaves the old-text `三件` done entry; un-completing later looks up the new text and misses it (orphan done record, "划掉" count stays).
5. Typing = one `LS.set` + one mirror push + re-render **per keystroke** (and re-arms the 200 ms auto-sync debounce).
6. The routine toast `…这件挂着月目标，加进去它就不会自动打勾了。` refers to behaviour that does not exist in code (no goal auto-check).
7. `ensureEnough` normalisation is not persisted; rollover marks the device dirty via `qyx_enough_prev`/`qyx_opts_hist` writes.

---------------------------------------------------------------------------------------------------

## 3. 拆小项 (add sub-items) — `.esub-add` handler, index.html:3284

Guard: blank/deleted text → toast `先写上这件事。`.
Dialog: title `拆小项`, text = item text, `input:'line'` placeholder `手写一个小项`, `pick:{multi:true, max:5, options:[], section: pastOptsHistory().slice(0,40) as {label:'以前写过的', collapsed:true}}` (section rows `editable`, `deletable`). Max 5 applies to picked rows only; the typed line adds one more.
Result `{line, picked:["h:<text>"…]}`; texts = `[line.trim()] + picked.map(v=>v.slice(2))`.
For each non-blank text: skip if an existing sub of **this item** has the same trimmed text; `unbury("esub:"+d, text)`; push `{text, done:false, status:"incomplete", updatedAt:now}`. If none added → return silently. Else `item.updatedAt=now; syncParentFromSubs(item)` (parent → incomplete); **saveEnough**; renderEnough; renderOptsHistory.
Picker side-effects (history rows):
- 修改 (`onEdit`): finds **first** `optsHist` entry with equal text (any day); `bury("ohist", oldKey)`; `text=next`; `unbury("ohist", newKey)`; **LS.set qyx_opts_hist**; no-op returns false if not found.
- 删除 (`onDelete`): all entries with same trimmed text (all days): `bury("ohist", key)` each, remove from `optsHist`, LS.set; toast `删掉了。`.
Other paths that create subs: `addToTodaySmart` → `放到「X」下面` (5.2); month page `to-today`.

OBSERVATION: dedupe is per item; the same text can exist as sub under two parents and as a parent at once (addToTodaySmart's dup check is global, this one is not).

---------------------------------------------------------------------------------------------------

## 4. v5 mirrors: day plans, plans/ideas in 今天

### 4.1 `安排到这一天` (`renderSchedules`, v5.js:238)
- `<details class="v5-day-plans">` summary `安排到这一天 <span id="v5PlanCount">` (count of ideas + tasks, empty when 0). Inside: `<label>查看日期 <input type=date id="v5PlanDate">` (value initialised once to today; **never refreshed at midnight**), then `#v5PlanList`.
- Idea rows: `state.items` where `!removedAt && scheduledDate===day` and NOT already mirrored in today's three (check only when `enough.d===day`: some item with `v5IdeaId===i.id` and status≠deleted). Sorted by `contentTime` desc (max of idea.createdAt and linked records' updatedAt||t), tie id asc. Row: icon, `title(i)`, buttons `查看` (→ `openIdea(id)`, switches to 消息盒子 detail) and `选入三件事`.
- Task rows: `state.tasks` where `!removedAt && scheduledDate===day && rec(t.recordId)` exists and not mirrored (`v5TaskId`). Sorted `order`, id. Row: `✓|○ <text>` + `选入三件事`. (No 查看 button.)
- Empty: `这一天没有安排的想法或清单。可以在想法菜单里选择日期。`
- Re-rendered from: `renderIdeas()` (called after almost every v5 state change and after sync merges), `saveTask`, selection actions, date `change`. **Not** re-rendered when tapping the 今天 nav tab (legacy nav handler is the only one on that button; `activate('v-stuck')` is dead code, v5.js:256).
- Binding code at v5.js:243-244,249-250 runs before `innerHTML` replace (dead duplicates); live handlers at 246-248.

### 4.2 `scheduledDate` writers (not on this page, but they feed it)
- Idea: `ideaMenu → 安排到某天` (v5.js:333-340): choices `今天` / `明天` (`dayKey(new Date().setDate(getDate()+1))`) / `选择日期` (dialog `输入日期 YYYY-MM-DD`, validated: regex + round-trip via `new Date(day+'T12:00:00')`; else toast `日期格式不正确，安排没有改变。`) / `清除安排`; sets `idea.scheduledDate = day||null`; then `idea.updatedAt = max(now, updatedAt+1)`; `persist()` (mergeState(read(KEY), state) → **LS.set qyx_ideas_v5**).
- Task: `taskMenu → 安排到某天` (v5.js:178-183) identical choices/validation (`validDay`), sets `t.scheduledDate`; `saveTask(t)`: `t.updatedAt = max(now, t.updatedAt+1)`, `persist()`, `mirrorTaskToEnough(t)`, `refreshTaskViews()`.

### 4.3 Selecting into today's three
`selectTaskForToday(id, day)` (v5.js:192) / `selectIdeaForToday(id, day)` (v5.js:203):
1. `day !== today` → toast `历史安排保留原样；只能选入今天的三件事。` abort.
2. `ensureEnough()`; if some **non-deleted** row already has `v5TaskId/v5IdeaId === id` → toast `这条计划已在今天三件事里。` / `这条想法已在今天三件事里。`.
3. Dialog `放进今天哪一件？`, single pick, options `第 {i+1} 件 · <text>` or `第 {i+1} 件 · 空位` (blank = text.trim()==='' only; deleted rows show their hidden text).
4. If chosen slot has non-blank text: confirm dialog `替换今天这件事？`, text `原来的文字会从今天三件事移出；原计划和历史记录不会删除。` (idea variant: `…想法和历史记录不会删除。`), ok `替换`.
5. Replace the **whole object** `enough.items[slot] =`
   - task: `{id:t.id, v5TaskId:t.id, text:t.text, done:t.done, status:t.done?'completed':'incomplete', updatedAt:max(now, t.updatedAt+1), subs:[]}`
   - idea: `{id:idea.id, v5IdeaId:idea.id, text:title(idea), done, status, updatedAt:max(now, (idea.statusUpdatedAt||0)+1), subs:[]}`
6. `oldSaveEnough()` (the **unpatched** saveEnough → LS.set `qyx_enough`, no push to plan/idea), `renderEnough()`, `renderSchedules()`. No done-log is written even if the plan/idea is already completed.
Consequences: replaced row loses its subs without any `esub` tombstone, its done logs, and keeps stale `taskTags/taskGoals[oldId]`. Slot id = plan/idea id so previously stored `taskTags/taskGoals[planId]` reattach on re-selection.

### 4.4 Two-way mirror (patched `saveEnough` / `renderEnough`, v5.js:668-708)

`saveEnough()` (patched, runs on every legacy save): for each of today's rows:
- `status==='deleted'` → `delete x.v5TaskId; delete x.v5IdeaId`; skip.
- `x.v5TaskId`: task missing/removed → `delete x.v5TaskId`. Else if `x.updatedAt > t.updatedAt`: if `t.done && x completed && t.text !== x.text` → `removeDoneLogToday(t.text,"三件"); addDoneLogOnce(x.text,"三件")`; then `t.text=x.text; t.done=(status==='completed'); t.updatedAt=x.updatedAt`.
- `x.v5IdeaId`: idea missing/removed → delete field. Else if `x.updatedAt > (idea.statusUpdatedAt||0)`: `next = completed?'completed':'open'`; if idea completed and next completed and `title(idea)!==x.text` → swap done log (`三件`); if `idea.status!==next` push event `{id:uuid, ideaId, event:next, t:now, updatedAt:now}`; **`idea.title = x.text`** (freezes the derived title into an explicit one), `idea.status=next`, `idea.completedAt = next==='completed' ? now : null`, `idea.statusUpdatedAt = x.updatedAt`, `idea.updatedAt = max(idea.updatedAt, x.updatedAt)`.
- Then `oldSaveEnough()` (LS.set `qyx_enough`); if anything changed: `persist()` (LS.set `qyx_ideas_v5`), `renderSchedules()`, `renderIdeas()`. `persist()` throws `空间不足，升级前快照未能保存。请先导出完整备份。` if the pre-5 snapshot could not be written.

`renderEnough()` (patched): for each today row: plan missing → `delete v5TaskId`; plan newer (`t.updatedAt > x.updatedAt`) → `x.text/done/status/updatedAt` from plan; idea missing → delete field; idea newer (`idea.statusUpdatedAt > x.updatedAt`) → `x.text=title(idea); x.done/status from idea.status; x.updatedAt=idea.statusUpdatedAt`. If anything changed → `oldSaveEnough()` (LS.set; **render can dirty the device**). Then legacy render + `enhanceEnough()` (adds `…` menus).

Other writers into today's rows:
- `mirrorTaskToEnough(t)` (v5.js:153): only if `enough.d===today`; for rows with `v5TaskId===t.id`: if `t.removedAt` → `v5TaskId=null; text=''; status='incomplete'; done=false` (id stays = plan id, subs kept, done-log kept) else `text=t.text; status/done from t.done`; `updatedAt=t.updatedAt`; `oldSaveEnough(); renderEnough()`.
- `taskMenu` (v5.js:165, triggered from the `…` on a record's checklist in 说说/消息盒子): `修改文字`, `安排到某天`, `上移/下移`, `移出今天三件事（保留原计划）` (only when mirrored), `删除清单项`. `unselect`: `delete x.v5TaskId; Object.assign(x, blankEnoughItem()); oldSaveEnough()` (fresh `task_` id, no done-log cleanup). `edit` while mirrored+done+text changed: `removeDoneLogToday(prev,"三件"); addDoneLogOnce(new,"三件")`. `delete` confirm: title `删除这条清单？`, text `正文记录仍会保留；若已选入今天三件事，也会一起移出。`, ok `删除清单`, sets `t.removedAt=now`.
- Checklist checkbox on a record (v5.js:535): `t.done=!t.done; saveTask(t)`; if mirrored today (non-deleted) → `addDoneLogOnce(t.text,"三件")` when done, `removeDoneLogToday(t.text,"三件")` when undone.
- `ideaMenu` (v5.js:328): `标记完成/重新打开` sets `status`, `completedAt`, pushes event `{id:uuid, ideaId, event, t, updatedAt}`; `rename` sets `title`; both set `statusUpdatedAt=updatedAt=max(now, updatedAt+1)`. If idea is mirrored today: status→completed `addDoneLogOnce(title,"三件")`, →open `removeDoneLogToday(previousTitle,"三件")`; rename while completed swaps the log. Then `persist(); renderLog(); renderEnough()` (renderEnough pulls the idea's new state into the row).
- `removedAt` on an idea (消息盒子移除) → row loses `v5IdeaId` on next render/save but **keeps its text** (becomes a plain row).

Merge-time counterpart (v5 `mergeAll` wrapper v5.js:68-94 ≙ merge.ts end): remote same-day rows with same `id` and `v5TaskId`/`v5IdeaId` push newer `updatedAt` into plan/idea (merge.ts has `strictIdeaMirror` deviation D4).

### 4.5 `…` menus (enhanceEnough, v5.js:709-725)
- Row `…` (class `v51-task-menu`, `aria-label 事项操作`) inserted after each input that has text; menu title `这件事`, options `拆小项 / 关联月目标 / 管理标签 / 删除这件事`.
- Sub `…` (class `v51-sub-menu`, `aria-label 小项操作`) appended to every `.esub`; menu title `这条小项`, options `修改文字 / 再做一次 / 交给随机 / 移除小项`.
- `enhanceEnough` re-runs after every `renderEnough` (sub chips are re-created each time; row buttons reuse).
- pick-dialog rows with `editable/deletable` get `…` popover with `修改`/`删除` (v5.js:728).

### 4.6 OBSERVATIONS (v5 mirrors)
1. Selecting a plan/idea sets `x.updatedAt = max(now, source.updatedAt+1)`, which is **greater** than the source's, so the next `saveEnough` of *any* row pushes the (unchanged) text back: bumps `plan.updatedAt`, and for ideas freezes `idea.title` and `statusUpdatedAt`. Pure selection therefore ends up dirtying `qyx_ideas_v5`.
2. Editing a mirrored row's text edits the plan text / idea title (title cleared → `title(idea)` falls back to the root-record excerpt).
3. Unselect/replace/delete leave done-log entries (`三件`) in place.
4. `renderEnough` may `LS.set` (marks device dirty) simply because a plan/idea is newer.
5. `v5PlanDate` default never refreshes after midnight; selecting then fails with the "历史安排" toast.
6. Slot pick labels expose deleted rows' old text.

---------------------------------------------------------------------------------------------------

## 5. Adding to today from elsewhere on the page

### 5.1 `addToToday(text, goalId)` (index.html:1910) → `"today" | "full" | "exists"`
`ensureEnough()`; trimmed text; `exists` if any non-deleted row has equal trimmed text; slot = first row that is deleted or blank; none → `full`. Set `slot.text=t; status='incomplete'; done=false; subs=[]; updatedAt=now` (id kept); `if goalId: qyx_task_goals[slot.id]=goalId`; `saveEnough()` (LS.set), `saveTagData()` (LS.set ×5), `renderEnough`, `renderOptsHistory`.

### 5.2 `addToTodaySmart(text, goalId)` (1923) → `{r:'cancel'|'exists'|'today'|'sub'|…}`
- blank → cancel; dup if any alive row text OR any sub text equals trimmed text → `exists`.
- No written alive rows → `addToToday`.
- Else dialog `排到哪里？` (text = the item) single-pick: `作为新的一件（大项）` (only if an empty/deleted slot exists) + one `放到「<parent text>」下面` per alive written row. Cancel → `cancel`.
- `top` → `addToToday`. `sub:i` → `unbury("esub:"+d, t)`; push sub `{text:t, done:false, status:'incomplete', updatedAt:now}`; `item.updatedAt=now`; `syncParentFromSubs`; if `goalId` and the parent has no goal → `qyx_task_goals[item.id]=goalId` (`noted:true`); `saveEnough(); saveTagData(); renderEnough(); renderOptsHistory()`. Returns `{r:'sub', parent, noted, goalConflict}`.
- Callers: routine chip (7.2), 往日写过的事项 `＋` (6.3), month page split `to-today` (index.html:2477; passes the anchor id as goalId).
- Toasts (by caller): `排进今天了。` / `放到「X」下面了。` / `今天已经有这一条了。` (month page variants add 月度目标 wording).

---------------------------------------------------------------------------------------------------

## 6. 打转 / 待选 / 往日写过的事项 / 定过的

### 6.1 打转区 `qyx_opts`, 待选 `qyx_bench` (index.html:1897, 2068-2123)
Data: `qyx_opts: string[]` (max `MAX_OPTS=9`), `qyx_bench: string[]`. Tombstone scope `opt` (value = text) is shared by both lists.

UI: input `placeholder 加一件事，最多9条` + `＋` (`#addOpt`; Enter submits; trims; clears and refocuses). Chips `#optChips`: empty state `先写几件进来。`; chip = `<text>` + `⌄` (title `这次不掷它`) + `✕`. Class `won` on the chip equal to `lastDice.text`.

| Action | Data effect |
|---|---|
| add (`addToOpts`) | `unbury("opt", text)`; duplicate in opts or bench → toast `已经在事项池或待选里。` return false; if `opts.length>=9`: `bench.push`, **LS.set qyx_bench**, `rememberOpt(text)`, toast `满9条了，先放进待选。`; else `opts.push`, **LS.set qyx_opts**, `rememberOpt(text)`, toast `排进去了。`; re-render opts/bench/history. |
| `⌄` | splice from opts (LS.set), push to bench if absent (LS.set). **No tombstone.** |
| `✕` on opt chip | splice, LS.set qyx_opts, `bury("opt", text)`, re-render + history. |
| 待选 block `待选 · 这次不掷 <count>` (fold `benchChips`, block hidden when bench empty) chip = text + `⌃` (title `放回打转区`) + `✕` | `⌃`: if `opts.length>=9` toast `满了，先掷掉一件。`; else bench→opts (both LS.set). `✕`: splice, LS.set, `bury("opt", text)`. |

Sync notes: merge = union of strings minus `opt` tombstones; first 9 of merged opts stay, overflow goes to bench (`merge.ts`).

### 6.2 `rememberOpt(text, t=now)` / `qyx_opts_hist` (1878)
Entry `{t, text}`. Skip if an entry with same `dayKey(t)` and same text already exists. Else push, sort asc by `t`, keep last 800, **LS.set qyx_opts_hist**. Callers: `addToOpts` (t=now), `ensureEnough` harvest (t = noon of the old day). Boot backfill (`backfillOptsHist`, 1884): every non-blank text in `opts+bench` that has no entry with the same text (any day) gets `{t:Date.now(), text}`; LS.set when changed (so a boot can dirty the device). Tombstone scope `ohist`, value `"<t>|<text>"` (`optsHistKey`).

### 6.3 往日写过的事项 (`#optsHistoryBlock`, 2033-2067)
Fold heading `往日写过的事项 <count>`, subtitle `可选，不选也不用管。`, body hidden until opened.
List = `optsHist` filtered to exclude: same-day (`dayKey(t)===today`) entries; `ohist` tombstoned keys; text (trimmed) equal to **any `done` log text** (any day/src); text in `opts` or `bench` (exact); text in today's rows or subs (including deleted rows' retained text); text of any routine. Sorted desc by `t`, de-duplicated by trimmed text (newest kept). Grouped by `dayKey(t)` newest first; each group header `M/D`; first 6 shown, button `更多 · N 条` expands that day (in-memory set `optsHistExpanded`). Empty: `过一天再回来，这里会收好你写过的事项。`
Row: text (click to edit), `＋` (title `排回今天`), `✕` (title `删除`).
- Edit text: dialog `修改事项`; blank → toast `文字不能为空，可以用 ✕ 删除。`; unchanged → noop; else `bury("ohist", oldKey)`, `item.text=next`, `unbury("ohist", newKey)`, LS.set qyx_opts_hist.
- `＋`: `addToTodaySmart(item.text)`; toasts `排进今天了。` / `放到「X」下面了。` / `今天已经有这一条了。`. History entry not removed (it disappears because it's now "in play").
- `✕`: remove from `optsHist`, `bury("ohist", key)`, LS.set.
Re-rendered after rollover tick, opts/bench/routine changes, delete, addToToday.

### 6.4 定过的 `qyx_ongoing` (1835-1876)
Shape `{id: Date.now() (number), text, t: Date.now()}`, newest first, max 10. Block hidden when empty; heading `定过的 · 点一下排回 <count>` (fold `ongoingChips`). Chip: `↻ <text> ✓` (✓ title `标记完成`).
- Created by `pushOngoing(text)` from 就这个 (6.5): skip if same text exists; `unshift`; cap 10; **LS.set qyx_ongoing**. **Does not `unbury("ongoing")`.**
- Chip click (not ✓): `addToOpts(text)` (toasts as 6.1; the chip stays) + `buddySay("resumed")` (even if add failed).
- ✓: remove by id, LS.set; `bury("ongoing", text)` (scope `ongoing`, value = text); `addLog("done", text, null, "定过的")`; `buddySay("done")`; toast `划掉了。`.
OBSERVATION: completing then re-accepting the same text via dice re-adds to `qyx_ongoing` while the `ongoing` tombstone for that text persists, so a tombstone-aware merge (D1) will drop it again. The rewrite should unbury on add.

---------------------------------------------------------------------------------------------------

## 7. 抽屉 / 常规

### 7.1 抽屉 `qyx_drawers` (1952-2031)
Shape `{id:"drawer_"+fnv(...), text, updatedAt}`; `null` = never seeded. Row label `抽屉`; chips `[text][改][✕]`; button `＋ 抽屉`. Row is always shown (`.show`).
- `ensureDrawers()` (runs on every render): if `drawers` is null → seed from `recentDrawers()` = distinct non-blank `three[].text` from `qyx_sums` for days within 30 days, newest first, excluding texts currently in today's alive rows; take 5; `{id: entityId("drawer_", text+"|"+now+"|"+i), text, updatedAt: now+i}`; **LS.set qyx_drawers** (even if the seed is empty `[]`, after which it never seeds again).
- Visible chips = drawers whose trimmed text isn't in a today alive row.
- Use: sets the first empty `#enoughCard input[data-i]` (prefers the focused empty one) to the drawer text and dispatches `input` (so it goes through the normal typing path; the drawer is not consumed, it just hides while in use). None empty → toast `三格都填了。`.
- `改`: dialog `改抽屉名字`; blank → noop; same text as another drawer → toast `已经有同名的抽屉了。`; `text=t; updatedAt=now`; LS.set. (Same id; no tombstone.)
- `✕`: `bury("drawer", id)`, remove, LS.set.
- `＋ 抽屉`: if `drawers.length>=6` toast `抽屉最多 6 条，先删一条`; dialog `添加抽屉`; dup → toast `已经在抽屉里了。`; id `entityId("drawer_", t+"|"+now+"|"+Math.random())`; `unbury("drawer", id)`; push `{id,text,updatedAt:now}`; LS.set.
- Sync: merge by id, newer `updatedAt` wins, result sorted by `updatedAt` asc then id (this reorders seeds after a sync).

### 7.2 常规 `qyx_routines` (3197-3226)
Shape `{id:"routine_"+fnv(...), text, updatedAt}`, max 9 (render shows `slice(0,9)`). Row label `常规`; chips `[text][✕]` (not hidden when in use); `＋ 常规`.
- Use: `addToTodaySmart(text)`; toasts: today → `排进今天了。`; sub → `放到「X」下面了。` (+ `这件挂着月目标，加进去它就不会自动打勾了。` if parent has a goal — stale copy); exists → `今天已经有这一条了。`.
- `✕`: `routines.filter`, `bury("routine", id)`, LS.set qyx_routines, re-render + `renderOptsHistory`.
- `＋ 常规`: if `>=9` toast `常规最多 9 条，先删一条`; dialog `添加常规`; dup → `已经在常规里了。`; id `entityId("routine_", text+"|"+now+"|"+Math.random())`; `unbury("routine", id)`; push `{id,text,updatedAt:now}`; sort by `updatedAt` asc then id; LS.set; re-render + history. No edit action.
- Routine texts are excluded from 往日写过的事项.

---------------------------------------------------------------------------------------------------

## 8. Bonus (`qyx_bonus`, `qyx_bonus_prev`) — index.html:3448-3490

Card title `Bonus · 想挑战就写一个`; two rows with `.bcirc` + inputs, placeholders `比如：收拾房间` and `第二个（可不写）`.
Shape `{d, items:[{text,done},{text,done}]}` (no ids, no per-item timestamps).
- `ensureBonus()` (boot, rollover tick, rerenderAll): if `bonus` missing or `bonus.d!==today`: if old bonus has any text → **LS.set qyx_bonus_prev** = old; then `bonus = {d:today, items:[{text:'',done:false}×2]}` **silent**.
- Input (every keystroke): `bonus.items[b].text = value`; **LS.set qyx_bonus**.
- Circle: blank text → noop; toggle `done`; **LS.set**; `renderBonus()`; when it becomes done: `addLog("bonus", text)` (type `bonus`, src null), confetti, `buddySay("done")`. Un-toggling does nothing to the log; toggling again adds another `bonus` log entry (no once-guard).
- Sync: same-day per-slot (merge.ts): empty local text filled from remote, `done` OR-ed (cannot un-done across devices).

---------------------------------------------------------------------------------------------------

## 9. Yesterday (rollover consumers) — rendered on 说说, not 今天

Documented because it is the other end of rollover data.
- `renderV3Yesterday()` (3646, called from `renderLog` 3887): card `昨日总结`, date `MM/DD 星期X`, toggle `展开`/`收起` (also click on card), state `yesterdayExpanded` in memory. Source rows: `qyx_enough_prev` if `prev.d===yesterdayKey` else `qyx_sums[yk].three`; non-blank, non-deleted, first 3; `expired` shown as incomplete at parent level; progress = 100 if completed else `round(doneSubs/subs*100)`; header `X / 3 完成` + `完成率 N%` (denominator is always 3). Sub lines `✓|×|○ text ×N` with `补勾` button for non-completed subs. Extras: `切 a · 记 b · 划掉 c` (dice+ai / note / done counts from yesterday's log), `Bonus` (from `qyx_bonus_prev` if `d===yk`, else `qyx_sums[yk].bonus`), `问一问` (last 2 yesterday `ai` entries that have `q`, showing `q` and text), `AI 回望 · 洞察` (`sum.obs` or canned sentence), habit marks. Empty: `昨天没有留下三件事。空白也算一天。`
- `补勾` (`bindSumFix`, 3586): sets the sub completed in `qyx_sums[yk].three`, in `qyx_enough_prev` (`fixYesterdayPrev`, only when `prev.d===yk`, finds by trimmed text, `status=completed, done=true, c=1 if none, updatedAt=now`, syncParent, **LS.set qyx_enough_prev**), and `addBackdatedDone(yk,text)`: log entry `{id:"done_"+fnv(yk+"|"+text), t:Date.parse(yk+"T23:59:00"), type:'done', text, src:'三件·小项', updatedAt:now}` unless one exists (**LS.set qyx_log**); `recountSummary`; **LS.set qyx_sums**; toast `补上了，记在昨天。`
- `makeDailySummary()` (3513, boot + rollover tick): if `qyx_sums[yk]` missing and yesterday has any log entry: creates `{t:now, v2:1, stats:{cut:dice+ai,notes,done}, three:[{text,goal:taskGoals[id]||null,status(expired→incomplete),done,subs:[{text,status,done,c:subCount}]}] (from prev if prev.d===yk), bonus:[{text,done}] (from qyx_bonus_prev if d===yk), habits:["name ×n"], obs:""}`; then tries `runAI` (system prompt: yesterday observation ≤50 chars, second person, no advice; user content = last 14 yesterday entries as `[标签] 文本`.slice(0,50), refs stripped) and sets `obs`; **LS.set qyx_sums**. `waitingDays` and month trails read `qyx_sums[*].three[].goal`.
- Merge post-processing recomputes `qyx_sums[prev.d].three/stats` from the merged `qyx_enough_prev` when `v2` (merge.ts).

---------------------------------------------------------------------------------------------------

## 10. 问一问 (AI card) — index.html:2205-2380, card markup 912-970

Card: label `问一问` / `今天卡在哪儿？我帮你理一下。`; buddy SVG at top-right; `.ai-head` `背景 + 选项 + 你的想法`; textarea `#aiInput` placeholder `背景 + 选项 + 你的想法（有截止时间一定写上）`; button `开始梳理 ✦`; reply box `#aiReply`; actions `照做` `不服` `存准则`; follow-up block (textarea `#aiAnswer` placeholder `说吧`, button `再切一次`); error `#aiErr`; `我的准则` block (see 10.4).

### 10.1 Request construction
- `runAI(sys, messages, {maxTokens, thinking, signal})`: key = `LS qyx_key` (local only), provider = `migrateProviderValue()` of `qyx_provider` (default `deepseek-v4-pro`; legacy `deepseek`→`deepseek-v4-flash`, `deepseek-r1`→`deepseek-v4-pro`; migration writes silent).
  - `deepseek-v4-flash|pro`: `POST https://api.deepseek.com/chat/completions`, `Authorization: Bearer <key>`, body `{model, thinking:{type:'disabled'}, max_tokens:600, messages:[{role:'system',content:sys}, ...messages]}`; no key → throws `DeepSeek 需要在设置里填 key`. Result `choices[0].message.content.trim()`.
  - otherwise: `POST https://api.anthropic.com/v1/messages` (headers `x-api-key`, `anthropic-version: 2023-06-01`, `anthropic-dangerous-direct-browser-access: true` only when key set), body `{model:'claude-sonnet-4-6', max_tokens:300, system, messages}`.
  - `data.error` → `Error(message||"API 错误")`.
- `aiContext()`: `timeStr="现在是{H}点{MM}分"`; `optStr="用户今天的事项区里有：1.a；2.b。"` (only `opts`, not bench) or ""; `threeStr="用户今天留下的三件：<text>[（已完成）|（时间结束）]；…。"` built from rows with non-blank text, then non-deleted (if only deleted rows exist this yields `用户今天留下的三件：。`); subs are not sent; `ruleStr="用户给自己立过的决策准则：1.…；2.…。"` using the first 12 rules.
- **First prompt** (`aiSend`): system =
  `{timeStr}。{threeStr}{optStr}{ruleStr}用户带着一个决策卡点来。先在心里完成判断（不输出思考过程）：` + `第一步，判断本次真正要优化什么——不套固定规则，每次重新判断。常见维度：` + `- 碎片时间利用：离下一个固定时间点还剩多久？哪个候选能完整装进这个窗口？` + `- 可中断性：哪个候选一旦展开就难收摊？窗口小的时候避开它。` + `- 精力与身体状态、长期目标推进、晚间收尾。` + `截止点/时间窗口是最常见的隐藏约束，永远先算时间。` + `第二步，若用户消息里已流露倾向，优先确认其倾向，不另起炉灶。` + `输出恰好按此格式（只写两行，总共不超过60字，大白话）：` + `第1行：「这次按X算：」+一句关键约束。例：「这次按碎片时间算：离验血只剩24分钟。」` + `第2行：裁决+第一步，动词开头，具体到现在就能做。例：「做YTWL，现在摆好垫子。」` + `规则：` + `- 有适用旧准则直接用并点明「按你的准则：X」。` + `- 纠结成本明显高于事情本身：第1行写「这题不值得纠结」，第2行随便定一个+第一步。` + `- 大额金钱、重大健康决定、重要关系不拍板，改说「这个值得慢慢想」+一句原因。` + `- 不解释利弊清单，不安慰，不抒情，不用「她」。` (newline-separated exactly as in index.html:2290-2303; copy verbatim from source when porting).
  - user message = textarea trimmed; if empty: `opts.length ? "（没写背景，看选项和时间直接切）" : "（没写选项也没写背景，就是卡住了，给一个此刻就能动的最小动作）"`; sent as `stripRefs(userMsg)` (`@dYYMMDD-HHMM` style refs expanded to `（引用…）`). `aiHistory=[{role:'user',content}]`.
- **Argue prompt** (`aiAnswerSend`): system = `{timeStr}。{threeStr}{optStr}{ruleStr}用户对上一轮裁决追问或不服。把这条新消息当作对「本次优化什么」的修正信息：` + `重新判断优化维度，输出三行（总≤70字）：第1行写新的关键约束；第2行写裁决+立即行动；第3行必须写「下次：」+从这次反驳中提炼出的具体准则（≤20字）。` + `严格禁止：复述或评论对话过程（禁说「你刚才说」「你驳我」）；揣测用户动机（禁说「你其实是怕/在意…」）；为上一轮裁决辩护。只输出重新判断后的结果。` + `维持原判时，第1行必须给出新信息为何不改变框架的那个约束，而不是重复旧理由。` (2354-2358). messages = `aiHistory` = `[user(first), assistant(first reply), user(stripRefs(ans))]`.

### 10.2 Flows
| Step | UI | Data effect |
|---|---|---|
| 开始梳理 ✦ | button shows `…` and is disabled; hides reply/actions/err/follow-up. | On success: `aiHistory.push({assistant,text})`; reply shown; actions shown; **`addLog("ai", text, null, null, ctx || "（没写背景，直接切）")`** → `{type:'ai', text:<reply>, q:<raw textarea text or the placeholder string>}` (LS.set qyx_log). Empty reply → Error `没有返回内容`. On failure: `showErr`: `没连上：<message>` (+ `（key 和服务对不上——设置里把「服务」切到对应家）` for `invalid x-api-key`) in `#aiErr`; nothing logged. Button restored to `开始梳理 ✦`. Input not cleared. |
| 照做 | `resetAI()` (clear history, show 不服, hide follow-up, clear `aiAnswer`, hide reply/actions/err), clear `aiInput`, `buddySay("accepted")`, toast `去吧。` | **No data written.** |
| 不服 | hides actions, shows follow-up textarea, focuses it | none |
| 再切一次 | blank answer → return silently. Button `…`. `aiHistory.push(user stripRefs(ans))`. On success: reply replaced, `addLog("ai", text, null, null, "不服：" + ans)`, follow-up cleared+hidden, actions shown, **`不服` button hidden** (终审后只剩照做与存准则), `aiHistory=[]`. Failure → showErr (history keeps the pushed user turn). Button text restored to `再切一次`. | LS.set qyx_log |
| 存准则 | seed text = the line containing `下次` with leading `下次：|:` stripped, else whole reply. Dialog title `存为我的准则`, text `保存前还可以改成更像你的话。`, `input:'area'`. | If non-blank: `unbury("rule", trimmed)`; if no existing rule has that exact text: `rules.unshift({id:Date.now(), t:Date.now(), text})`; cap 30; **LS.set qyx_rules**; `renderRules()`; toast `存了。以后同类的，按这条来。` (duplicate = silent no-op). |

### 10.3 `qyx_ai_review` / `回望` are on other pages; `aiHistory` is memory-only.

### 10.4 准则 (`qyx_rules`, `renderRules` 2189)
Block `#rulesBlock` shown only when rules exist: fold heading `我的准则 <count>` (list hidden until opened). Rule line = text + `✕`: `rules = rules.filter(x=>x.id!==r.id)`; `bury("rule", r.text)`; **LS.set qyx_rules**; re-render. Rule shape `{id: Date.now(), t, text}`; sync keys on **text** (scope `rule`, value text), newest-first by `t`, cap 30.

### 10.5 OBSERVATIONS (问一问)
1. After a 终审, the `不服` button stays hidden until 照做 is pressed; starting another 开始梳理 without 照做 leaves it hidden.
2. Failed 再切一次 leaves the extra user turn in `aiHistory`; retry sends two consecutive user messages.
3. Rule removal filters by `id`; rules arriving from sync without an `id`: `undefined !== undefined` is false, so removing one id-less rule removes every id-less rule (`types.ts` declares `id?`).
4. The reply is stored raw (including numbering/markdown); no `#`-tag guard, `indexRecordTags` will parse hashtags in replies.
5. `aiErr` is not hidden at the start of 再切一次.
6. `qyx_provider` writes never dirty the device (excluded list) though it is a synced key.

---------------------------------------------------------------------------------------------------

## 11. 交给随机 / 骰 / 最小动作

Card: label `交给随机` / `选择困难的时候，让它温和地帮你选。`; hero button `交给随机` sub `不知道先做什么时，让它温和地帮你选`, glyph ⚄ (`#diceBtn`).

### 11.1 Roll (`rollDice`, 2125)
Pool = **`opts`** (打转区), not the dice pool. `opts.length<2` → native `alert("只有一件，不用掷——就它。")` (1 item) or `alert("先在下面写几件进来")` (0). Else pick random, re-picking while it equals `lastDice.text`; `lastDice={text, from:'opts'}`; `renderOpts()` (marks `won`); `showQian(text)` (签 card: `.photo` text + `.stamp` `HH:MM`, shows `就这个` / `再掷`); `buddySay("rolled")`. **No log, no storage.** `再掷` calls the same function.

### 11.2 就这个 (`#acceptDice`, 2140)
`lastDice` null → noop. `addLog("dice", text)` (type `dice`, src null, LS.set qyx_log); `opts = opts.filter(o=>o!==text)`; **LS.set qyx_opts** (**no `opt` tombstone**); `pushOngoing(text)` (6.4); `lastDice=null`; re-render opts/history; hide actions, clear 签; `buddySay("accepted")`; toast `定了。去。`

### 11.3 动不了的时候 (`microBody`, fold; 2157-2187)
Button `抽一个最小动作`; 签 card; `就这个` / `再抽`. Pool = unique(`dicePool` ∪ all split texts of **current month** anchors `months[ymNow()]`). Empty → `alert("动作池是空的，去设置里加几个")`. Random pick, avoiding `lastMicro` when pool>1; `buddySay("micro")`. 就这个: `addLog("dice", lastMicro)` (same type `dice`, not `ongoing`), clear, `buddySay("accepted")`, toast `定了。去。`.

### 11.4 `qyx_dice` / `DEFAULT_DICE` (1298, settings 4930-4956)
`dicePool = LS.get("qyx_dice", DEFAULT_DICE)` — the default is in memory only until settings are saved or a merge writes the union (silent). DEFAULT_DICE (8): `去洗头`, `出门走十分钟，不带目的`, `倒一杯水，站到窗边喝完`, `把手机放到另一个房间`, `只做眼前这件事的前五分钟`, `拍一张此刻眼前的东西`, `把桌面上最碍眼的一样东西归位`, `朗读一段粤语，就一段`. Edited in the gear dialog (`#dicePool` textarea, one per line): on save, removed old lines → `bury("dice", old)`; every new line → `unbury("dice", v)`; pool = lines or `DEFAULT_DICE` when empty (the defaults are not unburied in that case); **LS.set qyx_dice**. Merge = string union minus `dice` tombstones.

### 11.5 OBSERVATIONS
1. Accepting a dice result removes it from `opts` without a tombstone, so another device still holding it will re-add it on sync (opts is a union).
2. `⌄`/`⌃` moves between opts and bench are not tombstoned either; a text can end up in both lists after a merge.
3. `microPool` includes every split (including done splits and watch cards).
4. Native `alert()`s are used on the dice paths.

---------------------------------------------------------------------------------------------------

## 12. Buddy / avatar lines (index.html:1426-1445)

Static buddy SVG (`#eyeL`, `#eyeR`, `#mouth`) lives inside the 问一问 card (top-right, scale .72 / .62 on <=430 px). Its speech bubble `#buddySay` is `display:none` in that card (`.v3-today-ask .buddy-row .bubble`), so **only the mouth animation is visible**: for kinds `accepted|done|rolled` the mouth path becomes `M48 65 Q60 78 72 65` for 1800 ms, then back to `M50 66 Q60 75 70 66`. Text is still written to `#buddySay.textContent` (random line of the kind):

| kind | lines | triggered by |
|---|---|---|
| idle (default `今天卡在哪儿？写进来。` initial text) | 今天卡在哪儿？写进来。 / 打转的那几件，各占一条。 / 来了？慢慢写。 | never called |
| rolled | 就它了，去吧。 / 骰子说了算。 / 别看我，看签。 | rollDice |
| accepted | 记着了，去。 / 好，动起来。 / 这局切完了。 | acceptDice, acceptMicro, 照做 |
| micro | 先动一下下就好。 / 一点点，就够了。 | rollMicro |
| resumed | 又排上了，好。 / 接着来。 | ongoing chip click |
| done | 划掉一件，舒服。 / 完成了就是完成了。 | parent circle completes, ongoing ✓, bonus done |

v5 replaced the buddy only on 说说 (`assets/avatar-v5.jpg`, `.v5-avatar`, paused via IntersectionObserver). Nothing in v5 touches the 今天 buddy.

---------------------------------------------------------------------------------------------------

## 13. Folds (`.fold`, index.html:~3350)
Click toggles class `open` and `display` of `#<data-target>`. All start closed. Targets on this page: `rulesList` (我的准则), `optsHistoryBody` (往日写过的事项), `benchChips` (待选 · 这次不掷), `ongoingChips` (定过的 · 点一下排回), `microBody` (动不了的时候). State is not persisted. `benchBlock`/`ongoingBlock`/`rulesBlock` themselves are shown/hidden by their render functions.

## 14. Timers and render triggers
- Boot (4969-4985): `ensureEnough(); initTagSystem(); renderOpts(); renderBench(); renderOngoing(); renderOptsHistory(); renderMonth(); renderSea(); renderEnough(); ensureBonus(); renderBonus(); renderHabits(); renderRules(); renderLog(); updatePearl(); makeDailySummary(); …syncNow(true)`. v5 loads before this block and calls `renderIdeas()` (→ `renderSchedules`) at its end.
- 60 s tick (4992): only when `dayKey` changed since boot: `ensureEnough(); renderEnough(); ensureBonus(); renderBonus(); renderHabits(); renderOptsHistory(); updatePearl(); makeDailySummary()` (not `renderOpts`, not `renderSchedules`, not the plan date).
- `rerenderAll` after sync/import (4620).
- Sync-time same-day Today merge: merge.ts "Today's three" block (legacy 4503-4548).

---------------------------------------------------------------------------------------------------

## 15. Keys and tombstone scopes touched by the 今天 page

**localStorage keys written (synced):**
`qyx_enough`, `qyx_enough_prev`, `qyx_bonus`, `qyx_bonus_prev`, `qyx_opts`, `qyx_bench`, `qyx_opts_hist`, `qyx_ongoing`, `qyx_drawers`, `qyx_routines`, `qyx_rules`, `qyx_dice` (settings/sync), `qyx_log` (types done/dice/ai/bonus/note), `qyx_dead`, `qyx_tags`, `qyx_record_tags`, `qyx_goal_tags` (re-saved), `qyx_task_tags`, `qyx_task_goals`, `qyx_sums` (yesterday summary; boot/補勾), `qyx_ideas_v5` (items/tasks/events via mirror, schedule), `qyx_months` (read; `monthAnchors()` may lazily create the month and write it with `saveMonths()`), `qyx_provider` (read/migrated).
**Read only:** `qyx_key` (local secret), `qyx_sit_reminder`/`qyx_habits` (not on page), `qyx_months` splits (micro pool, goal list), `qyx_sums` (drawer seed, waitingDays).
**Local-only/ephemeral:** `qyx_lastchange` (dirty flag), `qyx_pre5_snapshot`, in-memory: `lastDice`, `lastMicro`, `aiHistory`, `focusTimer`, `optsHistExpanded`, fold state, `yesterdayExpanded`.

**Tombstone scopes (`qyx_dead`) used by this page** — `{s, v, t}`:
| scope | value | bury | unbury |
|---|---|---|---|
| `esub:<YYYY-MM-DD>` | sub text | sub ✕; delete row (every sub); sub text edit (old) | add sub (拆, smart add, edit→new) |
| `log` | log id | `removeDoneLogToday`; duplicate done-entry dedupe in merge | — |
| `opt` | text | ✕ on opt chip or bench chip | `addToOpts` |
| `ohist` | `"<t>\|<text>"` | ✕ on history row; edit (old key); picker 修改/删除 | edit (new key) |
| `ongoing` | text | ✓ on 定过的 | **never (bug)** |
| `drawer` | id | 抽屉 ✕ | 抽屉 add (new id; no-op) |
| `routine` | id | 常规 ✕ | 常规 add (new id; no-op) |
| `rule` | text | 准则 ✕ | 存准则 |
| `dice` | text | settings save (removed lines) | settings save (all lines) |
| `tag` | tag id | — (tag library) | `ensureTagPath(revive)` from binding/addLog |

## 16. Cross-cutting rewrite checklist (derived from the observations)
- Keep writing `v5TaskId/v5IdeaId`, slot id = plan/idea id, `updatedAt` semantics (4.3-4.4); decide consciously whether to keep the "selection bumps source" side effect.
- Unbury on every add into a text/id-keyed scope (add `ongoing`; consider `opt` on dice-accept).
- Parent done-log (`三件`) vs sub done-log (`三件·小项 [×N]`) identities must stay exactly as above (they are the dedupe identity and the ×N counter source).
- Dirty rules: rollover reset and `ensureBonus` reset are silent; everything else listed as LS.set must mark dirty.
- `qyx_enough` must always hold exactly 3 items; blank rows keep `status:'incomplete'`, `updatedAt:0`, `subs:[]`.
- Do not rely on parent `expired` (unreachable) but must round-trip it.

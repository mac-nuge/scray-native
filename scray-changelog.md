# scray-native changelog

Entries for scray-native. `changelog.html` in scray-browse merges this file with scray-picker's and scray-browse's `scray-changelog.md` into one log - see the convention at the top of scray-browse's copy.

## Entries

### native 13.188 — test: studio filter search in the performer profile actually hides non-matching studios
<!-- 2026-09-17T12:29Z -->

**native** — `stg-native - 13.188`: `assets/web/scray-stash-nav.js`, `assets/web/VERSION` (JS only)

Mac confirmed the rest of browse 13.72 / native 13.187 works, so browse 13.72 is now marked stable. The one failure: typing in the studio dropdown's search box didn't narrow the list.

**Cause:** `paintStudioList` hides non-matching options with the `hidden` attribute, but the options are styled `display: flex`. An author `display` rule outranks the browser's built-in `[hidden] { display: none }`, so every option stayed visible. The jsdom test missed it because jsdom doesn't apply the stylesheet.

**Fix:** added `#stashModal .ssn .ssn-studio-opt[hidden], #stashModal .ssn-studio-none[hidden] { display: none; }` to the navigator's CSS.

**Tested:** `node --check`. The cascade reasoning was checked by hand; not re-run on a device.

### browse 13.72 / native 13.187 — test: stash toggle doesn't scroll, studio filter on performer profiles, list names wrap in full, uploads panel clears the bottom buttons, > and M> in MPB
<!-- 2026-09-17T12:20Z -->

**browse** — `staging-browse - 13.72`: `api.php`, `VERSION.txt`
**native** — `stg-native - 13.187`: `assets/web/randomiser.js`, `assets/web/scray-stash-nav.js`, `assets/web/style.css`, `assets/web/VERSION` (JS/CSS only)

Five quick requests from Mac.

**1. Stash toggle scrolled to the list** (`randomiser.js`).
- **Cause:** arming Matched/Unmatched runs the filter twice. It runs once straight away with `skipSearchScroll` set, and again after `scrayLoadStashState()` refreshes the matched set. The second pass didn't set the flag. `skipSearchScroll` is one-shot, so that pass scrolled to the results.
- **Fix:** it now sets the flag too.

**2. Studio filter on a performer profile** (`scray-stash-nav.js`, `api.php` `stash_nav` op `performer`).
- **The control:** a "Studio: All studios ▾" button sits under the profile. It opens a list with a search box: the studios the performer has worked for, busiest first, each with its scene count. Typing narrows the list without a repaint, so the keyboard stays up. Picking one re-fetches page 1 for that studio only; the profile and current scenes stay on screen until the new ones land. ✕ or "All studios" clears it. Load more carries the filter.
- **Server side:**
  - `studio_id` (a UUID) adds `studios: {value: [id], modifier: INCLUDES}` to `queryScenes`.
  - On page 1 the server asks `findPerformer { studios { scene_count studio { id name } } }` and returns them as `studios: [{id, name, count}]`.
  - That query is wrapped on its own: if StashDB refuses it, `studios` is null, the profile is unaffected, and the app builds its list from the studios on the scenes it has loaded.
  - Scene cards now carry `studio_id` so that fallback can filter too. The first scene selection asks for `studio { id name }`; the older fallback selections are unchanged.
- **Not checked against StashDB:** the `findPerformer.studios` field was not tested against the live API, which is why the fallback exists.

**3. Main list names wrap in full** (`style.css`, LIST COLUMNS).
- **Change:** studio, performer and filename cells dropped `-webkit-line-clamp: 2` and the ellipsis for plain wrapping (`display: block`, `white-space: normal`, `overflow-wrap: anywhere`), keeping `line-height: 1.2` and the font sizes.
- **Row height:** rows are `min-height: var(--lc-row-h)`, so one- or two-line names look as before and longer ones make their row taller.
- **Also covers:** history and basket, which share the same row rules.
- **Unchanged:** the bookmarks view's note cell stays at two lines.

**4. Uploads panel hidden behind the bottom button row** (`style.css`).
- **Cause:** the covering row in Mac's screenshot is the disguise dock (X R H Xⁿ Xb 🔍 BM 🌐 COL). It lives on `<html>` at the 32-bit z-index ceiling, so no z-index on the panel can beat it.
- **Fix:** on phones (≤1024px) the panel now sits 88px up (`--upload-panel-lift`, clear of the Native dock at 36px + ~40px tall) and is capped so it can't run off the top. The queue still scrolls inside it. The minimised pill lifts with it.

**5. > and M> in MPB** (`style.css`): removed the two MPB-only hide rules. Both are now shown in MPB, MPFS and FLS. Their order needs no CSS: > is attached before M>, both before fullscreen. MPB's row was described as tight when they were hidden, so it may need a shrink if it crowds.

**Tested:**
- `node --check` on both JS files, `php -l` on `api.php`.
- jsdom run of the navigator against a stubbed `scrayApiCall`:
  - The profile shows the studio button; the list shows both studios with counts.
  - Typing "braz" leaves only Brazzers.
  - Picking it keeps the profile while loading, sends `studio_id`, and shows its 3 scenes.
  - Clearing sends no `studio_id` and shows all 6.
- Not run against StashDB or on a device.
- Picker not yet ported (native first). The `api.php` change is inert for Picker until its navigator sends `studio_id`.

### native 13.186 — test: one-finger tap-then-drag zoom works in the play/pause zone too, not just the left zone
<!-- 2026-09-17T11:50Z -->

**native** — `stg-native - 13.186`: `assets/web/player.js`, `assets/web/VERSION` (JS only)

Mac asked for the one-finger zoom (tap, then touch again and drag up to zoom in, down to zoom out) to work in the play/pause zone as well as the left zone. He asked whether that would conflict with anything, in particular the swipe up/down gestures.

**Change:** `scrayOneFingerZoomInZone` now covers the left zone plus the play/pause zone beside it. In FLS and device landscape that is the left two thirds; in MPB and MPFS the left half (MPFS still inside the double-tap band). `SCRAY_OFZ_INCLUDES_PLAY_PAUSE = false` reverts to the left zone only.

**Conflict review (no further code needed):**
- **Double tap to play/pause:** unaffected. A zoom only commits once the second touch moves 8px; a double tap doesn't move, so it still reaches `handleDoubleTap`.
- **Swipes:** a plain swipe has no preceding tap, so the zoom never arms (`armed` needs a tap lifted within 300ms) and hands the touch back at 8px. Swipes affected:
  - FLS exit / peek
  - device-landscape and MPFS swipe-down exit
  - MPB page scroll
  - An armed zoom that commits raises `scrayZoomGestureActive` and stops its own touchend, so no swipe fires on release. That is the same path the left zone has used since 13.55.
  - **Only overlap:** a tap followed within 300ms by an up/down drag in these zones is now a zoom rather than a swipe or scroll.
- **Scrub:** tap-then-drag needs the drag mostly up/down to commit. A sideways drag is left to the scrub at 100%, or to 13.185's pan when zoomed.
- **13.185 pan from the play/pause zone:** the zoom's listeners run first. An armed up/down drag becomes a zoom and the pan yields (`ofzTouch.mode` check). An unarmed drag, or a sideways one, pans. So while zoomed, a tap immediately before an up/down drag there zooms rather than pans.

**Tested:** `node --check`. Not run on a device.

### native 13.185 — test: zoomed - pan from the play/pause zone too; pan zones never scrub or swipe; grid stays up while panning
<!-- 2026-09-17T11:45Z -->

**native** — `stg-native - 13.185`: `assets/web/player.js`, `assets/web/VERSION` (JS only)

Mac asked for three changes to panning a zoomed video, in every player (MPB, MPFS, FLS):
1. A drag can also start a pan from inside the play/pause zone.
2. In every pan zone (the new one, and the existing bar and strip above the grid), scrubbing and the swipe up/down gestures are off.
3. The grid guide stays visible while the finger is panning.

**What changed (player.js, CONTROLS PAN):**
- **Play/pause zone** (`scrayPointInPlayPauseZone`): the zone follows `handleDoubleTap`'s own rules, measured against the same container as `scrayOneFingerZoomInZone`:
  - FLS and device landscape: the middle third.
  - MPFS: the second quarter, inside the double-tap band (a third down to 152px off the bottom).
  - MPB: the second quarter, full height.
  - If `handleDoubleTap`'s zones move, this has to move with them.
- **Where a pan can start:** `mpfsControlsPanStart` now arms from the bar, the strip above the grid, or the play/pause zone.
- **Pan-zone touches** (`scrayPanZoneTouch`, `window.scrayPanZoneTouch()`): a touch that lands in any pan zone while zoomed is flagged from touchdown. The flag is cleared a tick after the finger lifts.
  - `startScrub` doesn't arm for it, so neither the scrub nor jog can start there.
  - `stopScrub` treats it as never a swipe (FLS swipe to exit or peek, device-landscape swipe-down exit).
  - MPFS's swipe-down exit doesn't track it.
  - Before this, a committed pan already stopped these through `stopPropagation`. The flag also covers the touch before it commits, and the bar pans that never raised `scrayZoomGestureActive`.
- **Taps still work:** a pan only commits after 8px, so a double tap in the play/pause zone still plays and pauses.
- **MPB page scroll:** in MPB, a picture pan-zone touch now calls `preventDefault` before it commits, so the page doesn't start scrolling under a pan. While zoomed, the page can't be scrolled by dragging in those zones.
- **Grid:** a committed pan (from any zone) calls `scrayWakeTapGuides`. Two things that normally hide the grid on a drag now leave it up while `scrayPanActive()` is true: the controls-policy touchmove and `scrayOnScrubBegin`. It lingers and fades as usual once the finger lifts.
- **Play state:** this applies whether the zoomed video is playing or paused, so a paused, zoomed video no longer jogs from the play/pause zone.

**Tested:** `node --check`, plus a scope check that the new helpers resolve from the pan handlers. Not run on a device.

### native 13.184 — stable: only a touch the scrub accepted can scrub - no jump to the finger's position at the start of a video
<!-- 2026-09-17T11:35Z -->

**native** — `stg-native - 13.184`: `assets/web/player.js`, `assets/web/VERSION` (JS only)

The jump was still happening after 13.183. Mac pinned it down in FLS: a scrub near the video's bottom-right (bottom-left of the physical screen in portrait), at the start of a video, sends the progress bar almost straight to the point under the finger.

**Diagnosis.**
- **The clue:** "straight to the point under the finger" is an absolute mapping, but the anywhere-scrub is relative (start + distance).
- **How a relative scrub goes absolute:** in `enableAnywhereScrubbing`, `scrubMove` acted on any touchmove reaching the wrapper, whether or not `startScrub` had accepted that touch.
- **When `startScrub` doesn't accept it:** it can bail early and leave `startX`/`startY` from an earlier gesture. The early exits are:
  - the pinch grace window (`scrayZoomBlocksGestures`, 400ms–2s after any zoom gesture)
  - a frame-step hold
  - a control under the finger
  - the touchdown never reaching it at all
- **At the start of a video:** each video gets a fresh closure, where `startX`/`startY` are still 0 and `startTime` is 0. The "offset" is then the finger's distance from the screen edge along the seek axis, which in FLS is the screen's Y. So the video jumps to roughly the finger's position, and the zone Mac described (far down the screen) lands well into the video.
- **Not confirmed on device:** which early exit fires there.

**Fix.**
- **Armed touches only:** `scrubTouchArmed` / `scrubTouchId`. Only the touch `startScrub` accepted can scrub. It is armed at the end of `startScrub` and cleared on release, touchcancel and the pinch handover. `scrubMove` also ignores a touch with a different identifier.
- **Diagnostics:**
  - The `[scrub]` release line now includes the start point and the player's size.
  - A progress-bar touchdown logs `[bar] touch at x,y -> time (bar rect)`.
  - If a jump still happens, a report taken straight after shows which path moved the video: the anywhere-scrub or the progress bar.

**Tested.** `node --check`. `enableAnywhereScrubbing` was lifted out and run against stubbed touches:
- **Touchmoves with no accepted touchdown:** 0 seeks.
- **13.183's drags** (zone lock, monotonic forward, zero-size wrapper): unchanged results.

### native 13.183 — test: scrub speed zone locks where the drag starts, small scrubs no longer jump, scrubbing cancels a pending start point
<!-- 2026-09-17T11:20Z -->

**native** — `stg-native - 13.183`: `assets/web/player.js`, `assets/web/VERSION` (JS only)

Mac reported two things: a small scrub in the middle of the player at the start of a video jumps to around the middle of the video, and a forward scrub sometimes goes backwards. He also asked how scrubbing works (answered in chat, with no change requested to the design).

**Cause, both bugs:** the speed zone was re-read on every touchmove. In `enableAnywhereScrubbing`'s playing-video path, `zoneMultiplier` was worked out from the finger's *current* position each move: bottom 20% of the video ×3, otherwise ×1. The offset is position-based (start + distance/width × duration × zone), so a finger drifting across the 20% line mid-drag re-scaled the *whole* accumulated offset.
- **Drift down into the bottom zone:** a small scrub is tripled. Worked example, 46.6-min video on a 390px-wide player: starting at 1:00 and dragging 60px while drifting into the zone landed at ~22:30, about the middle.
- **Drift up out of it while dragging forwards:** the offset drops to a third and the video goes backwards. Same video starting at 10:00: the seek went ~24:20 → ~18:20 while the finger kept moving right.
- The paused jog path already locked its tier at the start of the drag for exactly this reason; the playing path never did.

**Fixes (player.js, ANYWHERE SCRUBBING):**
- **Zone locked** (`scrubZoneMultiplier`): the zone is decided once, on the first move of a confirmed drag, and held until release. The 20–40% branch that also set ×1 was dead and is gone. The tuning is unchanged: bottom 20% ×3, elsewhere ×1.
- **Dead zone** (`SCRUB_DEAD_ZONE_PX` = 10): direction is decided after 10px, and the first seek used to include those pixels, an instant jump of over a minute on a long video. The offset now counts from the edge of the dead zone, and returning to the start point still lands on the start time.
- **Start re-read:** `startTime` is taken again when the drag is confirmed, not only at touchstart, because a playing video has moved on in between.
- **Size guard:** if the player measures under 60px along the seek axis, or the duration isn't known yet, that frame is skipped. Before, a not-yet-laid-out or replaced wrapper was divided by ~0 and flung the video to either end.
- **Stale landscape bar handlers:** the real-landscape control-bar handlers (bound 500ms after `ready`) now bail if that run's wrapper has already been replaced by a newer video, and bind at most once per bar.
- **Start points yield:** `scrayScrubSeek.begin()` and a progress-bar tap clear `scrayPendingStartAt`. Bookmark-row and X^T starts run `scrayApplyPendingStartAt`, which waits up to 20s for a seekable source and re-writes the seek up to 10 times. A scrub in that window was dragged back to the start point, or thrown there on the next `canplay`. The running chain now sees itself superseded and stops.
- **Diagnostics:** one `[scrub]` line per scrub in the on-page console, showing mode/tier, from → to, pixels, FLS, and video length. If a scrub still misbehaves, "send report" right after captures it.

**Tested:** `node --check`. `enableAnywhereScrubbing` was lifted out of player.js and run against stubbed touches, 2795s video, 390×220 player:
- **Centre start drifting into the bottom zone, 60px forward:** 1:00 → 6:58 (×1 held). The old code gave ~22:30.
- **Bottom start drifting up, forward:** seeks strictly increasing (×3 held). The old code went backwards.
- **Zero-size wrapper:** no seeks issued.

### native 13.182 — test: history saves and draws lazily, search waits for a typing pause, pop-ups don't leave listeners, disguise +P stops measuring every frame
<!-- 2026-09-17T10:50Z -->

**native** — `stg-native - 13.182`: `assets/web/history.js`, `assets/web/randomiser.js`, `assets/web/scray-config.js`, `assets/web/ui.js`, `assets/web/basket.js`, `assets/web/file-operations.js`, `assets/web/scray-basket-sync.js`, `assets/web/disguise.js`, `assets/web/VERSION` (JS only, no IPA build needed)

The second performance round proposed after 13.180. Mac said to go ahead with all four before answering which disguise mode he uses, so the disguise part is limited to the change that doesn't alter how anything looks.

**1. History** (`history.js`).
- **Saving:** `saveHistory` wrote up to 500 full video records to localStorage in one synchronous `JSON.stringify`. That happened on every play, right as the new video loads, and again on every bookmark or score save. Saves are now gathered into one write 1.5s after the last change. Anything pending is written immediately on `visibilitychange` (hidden) and `pagehide`, which covers backgrounding, reloads and the monitor's Refresh page. `flushHistorySave` is exported.
- **Rows:** `renderHistory` rebuilt every row (each with its button set) on every play, even with the panel shut. While the panel is closed it now only updates the H (n) count and marks the rows stale. `toggleHistory` builds them when the panel opens. Every caller already goes through `toggleHistory` to open it, including the fullscreen panel path.
- **Highlights:** `updateHistoryHighlights` builds one basket-id Set instead of scanning the basket per row.
- **Not done:** storing slim entries instead of full video copies. Rows, play-through, basket, CSV export and several other modules read fields straight off the stored entries, so it would be a data-model change with a lot to re-test, for little extra gain now that the write is batched.

**2. Search** (`randomiser.js`).
- **Typing pause:** the main search box's input handler ran the whole filter pass on every keystroke. It now waits for a 150ms pause (`SEARCH_TYPING_PAUSE_MS`). The X and the landscape panel's box still update instantly. The panel box and the in-player pill both drive the main box, so they get the same behaviour.
- **Overtaken passes:** `filterDisplayedByFilename` now numbers each call (`scrayFilterDisplayedPass`). A pass that finds a newer one started while it was reading the catalogue stops before drawing. Its caller then waits for the newest pass to finish, so every `await filterDisplayedByFilename()` still returns with the final list on screen. This also fixes older results occasionally landing last, and Clear all's five change events drawing the list five times.

**3. Pop-up Escape listeners** (`scray-config.js` ESCAPE WHILE OPEN).
- **Registry:** `window.scrayEscapeWhileOpen(el, handler)` adds one shared keydown listener that calls a handler only while its element is on the page. It forgets entries once their element has gone (after a 1s grace, because several pop-ups register just before they're appended).
- **Converted sites** (each previously only removed its document listener on Escape, which a phone never sends):
  - exclude tags, search-pill bin and score filter (`randomiser.js`)
  - tag action (`ui.js`)
  - basket export / import / paste / import action / tag selector (`basket.js`)
  - move and refresh folder (`file-operations.js`)
  - history tag selector (`history.js`)
  - playlist picker (`scray-basket-sync.js`)
- **Bug fix:** the basket, history and exclude tag selectors' Escape used `document.body.removeChild` on an overlay that could already be gone. They now use `overlay.remove()`.
- **Left as they were:** context menus, the score and F-tally menus, and the stash navigator already clean up on tap-outside or close.
- **Legacy:** `scray-basket-sync.js` isn't loaded by `index.html` or `bookmarks.html` in Native, so that change is inert. It may be a candidate for removal.

**4. Disguise** (`disguise.js`).
- **"+P" modes (Inv +P, GrInv +P):** these ran `trackHole` every animation frame for the whole session: `querySelectorAll` over six selectors plus a rect read per match, playing or not. Tracking now runs in 900ms bursts woken by touches, scrolls, resizes, transitions and animations, play and `loadedmetadata`, and any body or player class change (via `syncStateClasses`). A 1-second idle check is the safety net. The hole follows the player exactly as before while anything is moving.
- **`applyRowState`:** it rewrote every corner button's `hidden` and `order` on every class change in the player subtree. It now returns early unless the fullscreen/idle state or the button count changed.
- **Open question for Mac:** Grey / Invert / Grey + Invert keep a full-screen `backdrop-filter` over the playing video, recomputed on the GPU every frame (likely heat). The only real fix is dropping the tint while the video is fullscreen, which changes how it looks, so it's waiting on which mode he uses and whether he wants that.

**Tested.**
- **Syntax:** `node --check` on every changed file.
- **jsdom, Escape registry:** 50 pop-ups closed by button then one open, and a single Escape calls only the open one's handler.
- **jsdom, history:** 20 plays with the panel shut built 0 rows and made 0 writes straight away, then 1 write after the pause. Opening the panel built all 20 rows, and a further play was flushed on visibilitychange (hidden).
- **Overtaken passes:** with three overlapping calls finishing out of order, only the newest drew, and all three callers returned after it.

### native 13.181 — test: performance monitor moved from under the player to above the console
<!-- 2026-09-17T10:25Z -->

**native** — `stg-native - 13.181`: `assets/web/scray-perf.js`, `assets/web/player.js`, `assets/web/index.html`, `assets/web/scray-bridge.js` (comment), `modules/scray-native/ios/ScrayMemoryStats.swift` and `ScrayNativeView.swift` (comments only - no new build needed for this change), `assets/web/VERSION`

Mac asked for 13.180's monitor to sit by the console rather than under the player. It was under the player only because "directly below the monitor" in the original request was read as "below the video".

- **Placement:** an ordinary in-flow line directly above `#inlineConsole`, restyled to match the console box (light background, same border).
- **Player layout:** the 13.180 additions to `computeBottomDock` (the `perf-bottom-docked` class, and adding the monitor's height into the dock stack and video fit) are removed, so the docked player is back exactly as it was before 13.180.
- **When it runs:** no longer hidden while the player is idle, since it isn't part of the player now. It still pauses in fullscreen (unless FLS peek is showing the page) and while the app is hidden.
- **Unchanged:** readings, tap-for-details and Refresh page.

**Tested:** `node --check`. jsdom: the monitor lands directly above the console and renders with nothing playing.

### native 13.180 — test: long sessions stay quick - leak fixes, off-main-thread video serving, memory monitor under the player
<!-- 2026-09-17T09:57Z -->

**native** — `stg-native - 13.180`: `assets/web/player.js`, `assets/web/randomiser.js`, `assets/web/db.js`, `assets/web/file-operations.js`, `assets/web/random-panel.js`, `assets/web/scray-bridge.js`, `assets/web/index.html`, new `assets/web/scray-perf.js`, `modules/scray-native/ios/VideoSchemeHandler.swift`, `modules/scray-native/ios/ScrayNativeView.swift`, new `modules/scray-native/ios/ScrayMemoryStats.swift` (**Swift parts need a new IPA build**), `assets/web/VERSION`

Mac reported that after 15–20+ minutes Native gets sluggish: gestures lag, the scrub gets inaccurate, it sometimes grinds to a halt, and the phone warms up. A restart fixes it. He asked for three things: a fix, something that clears whatever builds up during use, and a simple memory gauge under the player. He also asked for a sweep for redundant or legacy code.

**Diagnosis.** A restart helping means something builds up over the session. Four parallel audits covered player.js (both halves), the list/filter modules, and the rest of the web layer. Every accumulating item below was checked against its call sites. The Plyr finding was also reproduced against Plyr 3.7.8's source in jsdom. No single runaway loop turned up; it's several leaks that grow per video, per render or per log line, plus main-thread blocking on the native side.

**What built up (fixed):**
- **Plyr kept every old player** (`scrayPrunePlyrListeners`, player.js). A `plyrPlayer.source =` swap is a soft destroy: it rebuilds the `<video>`, wrapper and controls but never forgets the listener records for the old ones. That kept every previous `<video>` alive, still loading Plyr's blank.mp4 and forwarding its events into the container, along with old control bars and every closure on them, plus one more container `click` handler per video. In jsdom, 20 swaps grew `eventListeners` from 352 to 3,563. With the prune right after each swap it holds flat at 183, and the new video's events and the play button still work.
- **The on-page console grew forever** (index.html). One `<div>` per console line was never removed, full pretty-printed JSON was logged, and `scrollHeight` was read after every line (a forced layout). The Swift side added to it: a log per bridge message, and a log per video range request WebKit cancelled, which happens constantly while seeking. Now capped at 250 lines and 1,000 characters each, written at most once a frame. The Swift logs are gone.
- **Tag dropdown handlers stacked** (randomiser.js). `populateTagDropdowns` re-runs after rename, move, refresh, folder scan, and every download landing from the in-app browser (`scrayRefreshLocalFolder`). Its `.on('change')` handlers survive select2 re-init, so each run added five more, each holding a full catalogue copy. After N runs, one tag change ran the whole filter N times. Now namespaced (`change.scray`) and replaced.
- **Window listeners per video / per render.**
  - The permanent progress bar added a window `mouseup` for every new video, each keeping its removed bar alive, all firing on every tap.
  - The bookmark note autocomplete added window `scroll`/`resize` on every modal render.
  - PIP drag/resize added document listeners on every PIP entry.
  - All three are now replaced or self-removing.
- **IndexedDB connections** (db.js). Every `openDB()` opened a new connection and nothing closed them; a single watch-time flush opened six or seven. Now one shared connection. It is let go on page hide (iOS can drop idle connections in the background), checked before reuse, and closes itself for `deleteDatabase` (reset mirror). Tested in fake-indexeddb: 4 calls = 1 open, delete isn't blocked, reopens after.

**Hot-path work removed:**
- **Scrubbing:** `scraySleepTapGuides(0)` rewrote the body class on every touchmove, which woke all four body-class MutationObservers per finger movement. It now only writes when the class actually flips.
- **Per-call `[rotate]` logs:** removed from `getManualRotationFullscreenElement` / `getManualRotationTargets` / `applyManualRotationStyles`, along with a post-apply `getBoundingClientRect` done only for logging. These run on every FLS drag move.
- **Leftover temporary diagnostics:**
  - `[BM DEBUG]` read the **whole database on every play**.
  - `[bm-flash]` did four `getComputedStyle` calls per M>.
  - `[rail]` hit-tested per rail.
- **Whole-page MutationObserver:** a legacy "video info safeguard" observer on `<body>` with `subtree:true` duplicated the 2-second poll beside it. Removed; the poll stays.
- **Clock:** it built a new `Intl.DateTimeFormat` every second. Now one formatter per timezone.
- **Whole-object logging:** `playVideoInline` / `downloadVideoInline` logged the entire video object. Now they log the filename.
- **Bug fix (random-panel.js):** `appendToTaggedListInPanel` referenced `videosToRender`, which isn't defined there. It threw after appending, so "show more" in the landscape panel appended the same rows again each time.

**Native side (VideoSchemeHandler.swift, rewritten):**
- **Off the main thread:** the old handler read the requested range on the main thread, inside WebKit's `start` callback. Every buffering request blocked touches and the scrub for the length of a disk read. Reads now run on a serial background queue.
- **Chunked:** responses are streamed in 512 KB pieces instead of one allocation per range.
- **Bounded handles:** open file handles are capped at three most-recently-used. Before, one per video ever played stayed open.
- **No stalls from reused addresses:** stopped tasks were kept in a Set keyed by `ObjectIdentifier` and never removed. A new request that happened to reuse a freed task's address was silently skipped as "cancelled", a plausible "grinds to a halt". Live tasks are now held strongly until they finish or stop, and every delivery checks on main that the task is still live.
- **Crash recovery (ScrayNativeView):** `webViewWebContentProcessDidTerminate` reloads the page. Before, if iOS killed the web process for memory, the view just sat dead until a restart.

**Monitor** (scray-perf.js + ScrayMemoryStats.swift).
- **Where:** one line directly under the player, joining the docked stack between the player and the now-playing bar (`computeBottomDock`). Hidden when the player is idle or fullscreen.
- **What it shows:** `● mem % · fps · lag · DOM · PL · thermal`.
  - **mem:** the app's `phys_footprint` as a share of footprint + `os_proc_available_memory()`, i.e. how close the app is to iOS's kill limit.
  - **fps:** a half-second rAF sample.
  - **lag:** timer lateness.
  - **DOM:** element count.
  - **PL:** Plyr listener records, which should now stay flat.
  - **thermal:** from `ProcessInfo.thermalState`.
  - **Dot:** green, amber or red from the worst of these. It stays red for two minutes after an iOS memory warning.
- **Tap for details:** a breakdown, plus **↻ Refresh page**. That reloads the page, which gives the same clean slate as a restart. It then reopens the current video at the same point and skips the lock screen, via a one-shot sessionStorage mark valid for 30s.
- **Cost:** one 2-second timer, a short frame sample, the DOM count every 6s, and nothing while hidden. About once a minute it also runs the Plyr prune as housekeeping.
- **On an iOS memory warning:** Swift calls `scrayOnMemoryWarning`, which prunes and trims the on-page console to 50 lines.
- **Limitation:** the page itself runs in WebKit's separate WebContent process, and iOS gives apps no way to read another process's memory. So `mem` covers the app process only; DOM, PL, fps and lag are the page-side proxies.
- **Before the new IPA:** everything JS-side works straight away in the dev client. `mem` and thermal show `–` until the 13.180 IPA is installed; the bridge rejects `memoryStats` as an unknown action.

**Not done yet (candidates for the next round, once monitor readings are in):**
- History rewrites up to 500 full video objects to localStorage and rebuilds all rows on every play.
- The filter search runs the full pipeline per keystroke with no debounce.
- render.js has a document-level non-passive `touchmove`.
- The disguise "+P" modes run a per-frame `querySelectorAll` + rect loop for the whole session. The default grey mode keeps a full-screen `backdrop-filter` over the playing video, which is steady GPU work (warmth).
- Modal Escape-key listeners are only removed on Escape, which a phone never sends.
- Automatic refresh when idle and strained: held back until the monitor shows whether the fixes alone keep it flat.
- Picker port of the shared-code fixes after Native confirmation.

**Tested.**
- **Syntax:** `node --check` on every changed JS file.
- **jsdom + Plyr 3.7.8:** listener growth before and after the prune; new media still forwards events; play button still wired.
- **jsdom:** scray-perf.js places itself after the player, renders from a stubbed bridge, the tap expands the details, a memory warning while idle doesn't throw, and the refresh mark round-trips and is consumed once.
- **jsdom:** inline console holds 250 lines after 2,000 logs.
- **fake-indexeddb:** shared connection (see above).
- **Swift:** not compiled here, so the IPA build is the first compile.

### browse 13.71 / picker 13.186 / native 13.179 — stable: TinEye in the player overflow searches the current frame (frame hosted briefly by api.php)
<!-- 2026-09-16T20:56Z -->

**browse** — `staging-browse - 13.71`: `api.php`, `VERSION.txt`
**picker** — `staging - 13.186`: `player.js`, `VERSION`
**native** — `stg-native - 13.179`: `assets/web/player.js`, `modules/scray-native/ios/VideoSchemeHandler.swift` (**needs a new IPA build**), `assets/web/VERSION`

Mac chose the recommended route for the player overflow's TinEye entry: grab the frame on screen, host it briefly on his server, and open TinEye with a link to it.

**Server** (`api.php`, TINEYE FRAMES).
- **`tineye_frame_put`** (POST, keyed; body `{ image: dataURL }`):
  - **Accepts:** a JPEG, PNG or WebP through the bug report's `scrayDecodeShot`, capped at 6 MB, 16px minimum and 4096px maximum per side.
  - **Stores:** re-encodes through GD to a plain JPEG at quality 90, so only pixels are ever served back; without GD a JPEG is stored as sent. Saved to `scray-data/tineye/<32 hex>.jpg`, mode 0600.
  - **Returns:** `{ id, url, search, expires_at }`, where `search` is `https://tineye.com/search?url=…`.
- **`tineye_frame`** (GET, **no key**): TinEye's servers are what fetch it. Validates the id against `^[0-9a-f]{32}$`, serves `image/jpeg` with `nosniff` / `noindex`, and returns 404 once expired. It's handled right after `$action` is read, before auth, the database or the JSON content type.
- **Housekeeping:** every put and get deletes frames older than `SCRAY_TINEYE_TTL_S` (1 hour). A put is refused with 429 once `SCRAY_TINEYE_HOURLY_CAP` (60) frames are live.
- **Access:** not in `SCRAY_PRIVILEGED`, because Native only has the device key. **Trade-off:** anyone with the bundled key can host up to 60 re-encoded images an hour, each reachable only by its random link for an hour.

**Apps** (`player.js` TINEYE, identical in both).
- **Grab** (`scrayGrabVideoFrame`):
  - **First try:** draw the playing `<video>` onto a canvas, scaled to at most 1920px wide, as a JPEG data URL.
  - **Fallback:** if the canvas is tainted (`SecurityError`, a cross-origin source), a hidden muted copy loads the same `currentSrc` with `crossorigin="anonymous"`, seeks to the same time and is grabbed instead. It gets a muted inline `play()` so iOS will fetch it, has a 20s timeout, and is torn down afterwards. Playback is never touched.
  - **No CORS on the source:** the error reads "the video's source doesn't allow a frame to be copied".
- **Upload and open** (`scrayTinEyeSearch`):
  - **Posts** to `tineye_frame_put` with the usual key / same-origin cookie.
  - **Opens** the returned search. In a plain browser the tab is opened inside the tap first, showing "Grabbing the frame…", then pointed at TinEye, because a tab opened after the awaits would be popup-blocked.
  - **Native and the in-app browser** go through the same bridge / `scraynative://newtab` routing as the stash navigator's external links.
  - **Feedback:** progress and errors show as player feedback. A failure closes the pre-opened tab, and a busy flag stops double taps.
- **Native local files** (`VideoSchemeHandler.swift`): the `scray-video://` responses now send `Access-Control-Allow-Origin: *`. The page is `file://` and the scheme is a different origin, so without it the copy fails. Until an IPA with this is installed, TinEye on a phone copy will report that the source doesn't allow the copy. OneDrive streams don't depend on the IPA.

**Not yet verified:** whether OneDrive's download links send CORS headers. Picker (and Native streaming from OneDrive) plays from those, so the first real tap on staging is the test. If they don't, the fallback reports it cleanly and the next step would be a server-side grab.

**Tested.**
- **Server:** `php -l`, then `php -S` with stub auth.
  - A put of a 640×360 JPEG returned an id, link and TinEye URL.
  - The link served `image/jpeg` without a key.
  - A non-image returned 400, a bad key 401.
  - Traversal and malformed ids returned 404.
  - A frame aged two hours returned 404 and was deleted.
- **Apps:** headless Chromium, with the TINEYE block lifted from `player.js` and uploading to that server.
  - **Same-origin video:** grabbed directly, uploaded, and the pre-opened tab navigated to TinEye.
  - **Cross-origin video with CORS:** fell back to the copy and grabbed the same 640×360 frame (identical bytes).
  - **Cross-origin video without CORS:** reported "the video's source doesn't allow a frame to be copied" and closed the tab.

### picker 13.185 / native 13.178 — test: performers plays like the filename; Zoom capture renamed TinEye
<!-- 2026-09-16T20:47Z -->

**picker** — `staging - 13.185`: `render.js`, `player.js`, `VERSION`
**native** — `stg-native - 13.178`: `assets/web/render.js`, `assets/web/player.js`, `assets/web/VERSION`

Mac asked for two things. First, a tap-target change: studio, score and size open the row, and performers and filename play it. Second, the player overflow's Zoom capture is renamed TinEye. It's meant to grab the current frame and run a TinEye reverse image search; how to build that was a question for this round, answered in chat, and not built yet.

**Tap targets** (`render.js` `scrayBuildListRow`, main and random lists).
- **Performers and filename:** play through `_scrayPlaySpec`. On the video already loaded in the player they stop it (13.182's rule, now on both cells).
- **Number, studio, score, size:** toggle the row open or shut. The number wasn't mentioned, so it keeps opening.
- **Empty performers cell:** it has no height to tap, so a tap there falls through to the line and opens the row.

**Player overflow** (`player.js` `scrayPlayerOverflowActions`): the entry reads "🔍 TinEye". A tap still only shows "TinEye - coming soon".

**Tested** in headless Chromium with the 13.181 harness:
- **Opening:** number, studio, score and size each opened their row.
- **Playing:** performers (with text) and filename each played. With that row's video playing, a performers tap stopped it.
- **Errors:** none.

### picker 13.184 / native 13.177 — test: zoom capture moves into the player overflow
<!-- 2026-09-16T20:40Z -->

**picker** — `staging - 13.184`: `player.js`, `style.css`, `VERSION`
**native** — `stg-native - 13.177`: `assets/web/player.js`, `assets/web/style.css`, `assets/web/VERSION`

Mac meant the magnifying-glass-and-camera button to go inside the `...` menu, not on the bar. That menu is now called the **player overflow**.

**Change** (`player.js` PLAYER OVERFLOW, `style.css`).
- **Bar:** `attachOverflowControls()` now adds only the `...` button (titled "Player overflow"), after the volume control. The bar zoom-capture button, its SVG icon and its CSS are gone.
- **Overflow entries** (`scrayPlayerOverflowActions`):
  - "⛶ Native fullscreen": touch devices only, unchanged.
  - "🔍📷 Zoom capture": everywhere. Still no function; it shows "Zoom capture - coming soon".
  - The desktop menu's "Nothing here yet" placeholder is gone, since zoom capture is always there.
- **Bar count:** the MPB bar is one button shorter than 13.183 (▶ ■ ↻ ⤢ 🔇 ...).

**Tested** in headless Chromium with real Plyr 3.7.8, as for 13.183:
- **Bar order:** play, fullscreen, volume, `...`, progress, time, with no zoom button on the bar.
- **Phone:** the player overflow listed Native fullscreen and Zoom capture.
- **Desktop:** Zoom capture only.
- **Zoom capture:** tapping it showed the coming-soon feedback and closed the menu.
- **Errors:** none, apart from the sandbox's blocked Plyr sprite fetch.

### picker 13.183 / native 13.176 — test: Mac's swipe setup is the default; player cog gone, ... overflow menu (native fullscreen) and a zoom-capture button after volume
<!-- 2026-09-16T20:34Z -->

**picker** — `staging - 13.183`: `render.js`, `player.js`, `style.css`, `VERSION`
**native** — `stg-native - 13.176`: `assets/web/render.js`, `assets/web/player.js`, `assets/web/style.css`, `assets/web/VERSION`

Mac made two requests.
1. Make the swipe setup from his settings screenshot the default in both apps.
2. In every player:
   - remove the settings cog (it only held speed)
   - add a `...` overflow menu straight after volume
   - move native fullscreen into that menu
   - add a magnifying-glass-and-camera button with no function yet (to be briefed next)

**1. Swipe defaults** (`render.js` `SCRAY_SWIPE_DEFAULTS`).
- **Left:** `row [B] [D] [★]`, i.e. `['B', 'D', '★']`, full swipe on (★).
- **Right:** `[S] [R] [F] row`, i.e. `['F tally', 'R', 'S']` listed from the row outwards, full swipe on (S).
- **Scope:** a device that already saved its own swipe setting keeps it. This only changes what an unsaved device, or Reset, gets.

**2. Player controls** (`player.js`, `style.css`).
- **Cog:** `'settings'` is removed from the Plyr `controls` list. Nothing else read the menu; speed keys set `player.speed` directly, and `attachStopButton` already tolerated a missing settings button.
- **New buttons:** `attachOverflowControls()` replaces `attachIOSFullscreenButton()` at all three control-rebuild points (`loadstart` rebuild, `ready`, `loadedmetadata`), so the ⛶ button no longer goes on the bar. Its function is kept, unused.
  - The new function puts `...` (`.plyr-more`) and the zoom-capture button (`.plyr-zoom-capture`, an inline SVG of a camera with a magnifier, drawn in `currentColor`) immediately after Plyr's `.plyr__volume` wrapper, which holds mute.
  - Both are idempotent, like the other attach functions.
  - The random / history / basket buttons insert before fullscreen, so nothing lands between volume and `...`.
- **`...` menu:**
  - Opens the shared `showContextMenu` with `scrayPlayerOverflowActions()`, the one place to add entries.
  - For now it holds "⛶ Native fullscreen" (`triggerIOSNativeFullscreen`, unchanged; touch devices only, as the button was). On desktop it reads "Nothing here yet".
  - The menu gets `z-index 2147483600`, so it opens above the docked MPB player and the fullscreen bar; the plain context menu sits at 10001. Its items are a little larger than the list's compact menu.
- **Zoom capture:** a tap shows "🔍📷 Zoom capture - coming soon" as player feedback.
- **Sizing:** matches the ⛶ they replace. 50px by default, 38px in MPB portrait, 32px in FLS and landscape fullscreen (18px icon).
- **Button count:** the MPB bar keeps its count (▶ ■ ↻ ⤢ 🔇 ... 🔍📷 against the old ▶ ■ ⛶ ↻ ⤢ ⚙ 🔇). FLS gains one button, since it never showed ⛶ but did show the cog.

**Tested** in headless Chromium against real Plyr 3.7.8 (npm), with the app's `style.css` / `style-index.css` / `context-menu.js` and `attachOverflowControls` + `triggerIOSNativeFullscreen` lifted from `player.js`. At desktop 1200×800 and phone 390×844 (touch):
- **Bar order:** play, fullscreen, volume, `...`, zoom, progress, time. No settings control. One of each new button after attaching twice.
- **Phone:** `...` was 38px and its menu showed "⛶ Native fullscreen".
- **Desktop:** `...` was 50px and its menu showed "Nothing here yet".
- **Menu z-index:** 2147483600.
- **Zoom:** a tap showed the coming-soon feedback.
- **Errors:** the only page error was Plyr failing to fetch its icon sprite from the CDN in the sandbox.

### picker 13.182 / native 13.175 — stable: Settings modal sits clear of the corner buttons; tapping the playing video's filename stops it
<!-- 2026-09-16T20:17Z -->

**picker** — `staging - 13.182`: `settings.js`, `render.js`, `VERSION`
**native** — `stg-native - 13.175`: `assets/web/settings.js`, `assets/web/render.js`, `assets/web/VERSION`

Mac reported that Cancel and Save in the Settings modal were partly hidden behind the corner button row along the bottom of the phone.

**Why:** the modal was centred in a 20px-padded overlay at up to 85vh tall. The corner row lives in disguise.js's dock, which is attached to `<html>` after `<body>`, so it paints over the overlay whatever its z-index. So the fix is space, not stacking.

**Change** (`settings.js` `open()`, identical registry in both apps).
- **Bottom padding:** the overlay's bottom padding is now safe area + `SETTINGS_BOTTOM_CLEAR_PX` (90px, covering the row plus Native's 30px lift). The top padding is safe area + 20px.
- **Height:** the box's max-height is `100%` of what's left, not `85vh`. On a short screen the settings scroll inside the box and the buttons stay in view above the row.

**Tested** in headless Chromium with the settings modal open (Swipe actions row). Gap between the bottom of Save and the bottom of the screen:
- **390×844:** 135px.
- **375×667:** 108px, with the settings scrolling inside the box.
- **320×568:** 108px, also scrolling.
- **Errors:** none.

**Added mid-version: tapping the playing video's filename stops it** (`render.js` `scrayBuildListRow`, main and random lists).
- **What changed:** 13.180 made a filename tap play. If that row's video is the one loaded in the player (`window.currentPlayingVideo`, matched by id, the same test as the green row), the tap now calls `inlineVideoPlayer.stop()` instead, which is `resetVideoInline`, the player's full Stop. A tap on any other filename still plays it.
- **Tested** with the 13.181 harness and a stub `inlineVideoPlayer.stop`: a filename tap played row 1; with row 1 playing, the same tap stopped it; a tap on row 2's filename played row 2.

### picker 13.181 / native 13.174 — test: any column but the filename opens a row; Settings > Swipe actions (picker gets a Settings page)
<!-- 2026-09-16T20:13Z -->

**picker** — `staging - 13.181`: `render.js`, `style.css`, `settings.js` (new), `index.php`, `bookmarks.php`, `VERSION`
**native** — `stg-native - 13.174`: `assets/web/render.js`, `assets/web/style.css`, `assets/web/settings.js`, `assets/web/VERSION`

Mac asked for two changes:
1. Tapping any column except the filename opens a row, not just the size.
2. Build the swipe settings after all, so every swipe can be customised.

**1. Tap targets** (`render.js` `scrayBuildListRow`). In lists with a size column (main, random), the filename plays and every other cell (number, studio, performers, score, size) toggles the row open or shut. History and basket keep 13.35's rule.

**2. Swipe settings.**
- **Config** (`render.js`):
  - The fixed `SCRAY_SWIPE_ACTIONS` table is replaced by `scraySwipeConfig()`: `{ left, right, fullLeft, fullRight }`, read from `localStorage` `scraySwipeActions` on every swipe and cleaned against `SCRAY_SWIPE_CHOICES`. It falls back to `SCRAY_SWIPE_DEFAULTS` (left `B ★`, right `R S`, full swipe on both sides).
  - The choices are every row button spec by label: P, B, ★, S, R, BM, D, Move, Stats, Copy Name, Open Link, Refresh Data, Refresh Folder, F tally, X. Up to 3 per side.
  - Labels too long for a 68px button print a short form (Copy, Link, Ref, Fold, F, Del) in a smaller font.
  - A label a row doesn't have is skipped for that row. For example, Refresh Folder is picker-only.
- **Full swipe switch:** with full swipe off for a side, a long drag meets resistance past the buttons and arms nothing.
- **Saving:** `scraySetSwipeConfig` saves and closes any row left open. The setting is per device.
- **The settings row** (`render.js`): registered on DOMContentLoaded as a `custom` row.
  - Per side there are three dropdowns (Next to the row / Middle / Outer edge; blanks are skipped), a "Full swipe runs the outer button (name)" checkbox, and a live preview such as `row [B] [★]` or `[S] [R] row`.
  - A "Reset swipes to defaults" button restores the defaults.
- **Settings registry** (`settings.js`):
  - Native's registry learns `type: "custom"`: `def.build()` returns `{ el, value(), focus() }`, wrapped to look like a text input so validate / Save / focus handle both kinds of row alike.
  - Picker had no settings. It gets a copy of Native's registry and modal (the part above "Setting 1", kept identical), loaded after `render.js` in `index.php` and `bookmarks.php`, and a "Settings" link in the footer beside Change Log, the same place as Native. Native's Picker URL setting stays Native-only.

**Tested** in headless Chromium, touch emulation at 390×844, real `render.js` / `settings.js` / `style.css` with stub row handlers; `php -l` on both PHP files:
- **Tap targets:** number, studio, performers, score and size each opened the row, and the filename played without opening.
- **Defaults:** a left swipe showed `B,★`.
- **Modal:** Settings listed `swipeActions`. Setting left to D + X with full swipe off, and right to P, previewed `row [D] [Del]` / `[P] row` and saved that JSON.
- **After saving:** a 300px left swipe showed `D,Del` and ran nothing; a 300px right swipe armed and played.
- **Reset + Save:** returned to the defaults.
- **Errors:** no page errors.

### picker 13.180 / native 13.173 — test: size opens a row and the filename plays it; right swipe S R; full swipe runs the outer button
<!-- 2026-09-16T20:05Z -->

**picker** — `staging - 13.180`: `render.js`, `style.css`, `VERSION`
**native** — `stg-native - 13.173`: `assets/web/render.js`, `assets/web/style.css`, `assets/web/VERSION`

Mac liked 13.179's swipes and asked for four changes before settings (settings are skipped for now):
1. Tapping the size opens a row.
2. Tapping the filename plays straight away.
3. The right swipe's P becomes R.
4. Swiping all the way runs the outermost button: ★ on the left, S on the right.

**1–2. Tap targets** (`render.js` `scrayBuildListRow`, the line's click handler).
- **Which lists:** those with a size column, which are main and random.
- **Size cell:** toggles the row open or shut.
- **Filename cell:** plays through `_scrayPlaySpec`, the P button's own handler. That spec is built by `ensureListRowDetail`, so a row that has never been opened builds it first.
- **Other cells:** the number, studio, performers and score do nothing. The swipes are how B / ★ / S / R are reached now.
- **History and basket:** no size column, so they keep 13.35's rule (closed: the line opens; open: it plays).
- **Wholesale mode:** its capture-phase click handler still runs first and swallows these taps, as before.

**3. Right swipe** (`SCRAY_SWIPE_ACTIONS.right = ['R', 'S']`). R is the rename spec `scrayArrangeOpenRowButtons` adds, so it opens the same rename modal as the open row's R. On screen it reads `S R`, left to right.

**4. Full swipe.**
- **Following the finger:** with buttons on that side, the row now follows the finger 1:1 all the way across. It used to meet resistance past the buttons.
- **Arming:** past `max(buttons + 40px, 60% of the row)` (`SCRAY_SWIPE_FULL_FRACTION`), the panel is armed. The outermost button (the last in each `SCRAY_SWIPE_ACTIONS` list) grows to fill the gap and the others shrink to nothing, so it's clear what letting go will do.
- **Releasing armed:** runs that button with a stand-in event centred on it, since the score menu positions itself from `event.clientX/Y`. Then the row springs back.
- **Releasing short of armed:** the old behaviour is unchanged. Open at 40% of the buttons, otherwise it springs back.

**Tested** in headless Chromium, touch emulation at 390×844, with the real `render.js` / `style.css` and stub handlers:
- **Size:** tapping it opened the row, and tapping again closed it.
- **Filename:** played without opening.
- **Studio:** did nothing.
- **Right swipe:** 150px showed `S,R`, and tapping R opened rename.
- **Full swipes:** a 300px swipe left armed and ran ★, with the menu event at the button; 300px right ran S. A 150px swipe left opened `B,★` without arming.
- **Errors:** no page errors.

### picker 13.179 / native 13.172 / browse 13.70 — test: rename suggestion names a performer once when they're also the studio; swipe list rows for B ★ / S P
<!-- 2026-09-16T19:55Z -->

**picker** — `staging - 13.179`: `scray-clean-name.js`, `render.js`, `style.css`, `VERSION`
**native** — `stg-native - 13.172`: `assets/web/scray-clean-name.js`, `assets/web/render.js`, `assets/web/style.css`, `assets/web/VERSION`
**browse** — `staging-browse - 13.70`: `scray-clean-name.js`, `VERSION.txt` (the naming rule only; browse has no list rows)

Mac asked for two things:
1. In the rename modal, when the studio and performer are the same, the suggested name should show the name once.
2. Mail-app-style swipes on list rows: swipe left uncovers B and score, swipe right uncovers S and play.

Stage 1 of the swipes has fixed actions. Stage 2, choosing what each swipe does in settings (creating a settings page in picker, which has none), waits until Mac confirms the swipe itself works.

**1. Performer who is also the studio** (`scray-clean-name.js`, identical in all three repos).
- **Where it applies:** `cleanNameFrom` already drops the parent when it equals the studio. It now also drops the performers field when, after hyphenating and censoring, it equals the studio. So `lily-carter_lily-carter_…` becomes `lily-carter_…`.
- **Why all three files:** the rename modal's suggestion, Native's and manage-data's bulk rename all build from this one file. Files that already carry the doubled name become eligible for a clean rename again, which is how the rule is meant to work.
- **Checked** with node:
  - studio "Lily Carter", performer "Lily Carter" → `lily-carter_wmvf-full-low_1080.mp4`
  - Evil Angel / Anna Lee, Bea Ray unchanged
  - with a parent → `gamma_lily-carter_x.mp4`

**2. Row swipes** (`render.js` ROW SWIPE ACTIONS, `style.css`, identical in both apps).
- **Which lists:** rows in the main list (`#taggedVideosContainer`) and the random list (`#playlist`), including files inside an open folder group.
- **Not included:** history and the basket, whose panels have their own swipe-to-close gestures; folder group lines; the landscape-phone panel list; and desktop (touch only).
- **Revealing:** the row's line slides with the finger and a panel of buttons grows into the space it leaves. Swipe left gives `B ★` on the right; swipe right gives `S P` on the left. Past 40% of the buttons' width it stays open; less, it springs back. Dragging past the buttons, or on a side with none, meets resistance.
- **The buttons:** each runs the row's own handler, the specs `ensureListRowDetail` builds for the open row's button group (P is `_scrayPlaySpec`). B, ★, S and P therefore behave exactly like the open row's buttons, including P playing through that list's handler. B reads `−B` when the file is already basketed.
- **Closing:** tapping a button runs it, then the row goes back. Any touch elsewhere closes an open row. A tap on that same row only closes it, and doesn't open or play it (a capture-phase click swallow).
- **Staying out of the way:**
  - It only engages once a drag is clearly sideways (12px, and more horizontal than vertical), then stops the page scrolling. Rows get `touch-action: pan-y`.
  - A drag that starts vertical is never taken.
  - A touch starting within 24px of either screen edge is left to disguise.js's edge swipes for the history and basket panels.
  - Nothing happens in fullscreen, except during an FLS peek.
- **Tuning:** `SCRAY_SWIPE_ACTIONS` is the one table stage 2 will turn into a setting. The other ⚙️ values are button width, lock distance, open fraction and edge.

**Tested** in headless Chromium, touch emulation at 390×844, driving the real `render.js` `scrayBuildListRow` with stub button specs and the real `style.css`, using CDP touch events:
- **Swipe left:** 150px opened `B,★` at 136px; tapping B ran B and closed the row.
- **Swipe right:** 160px opened `S,P`.
- **Tap on the open row:** closed it without opening it.
- **Short swipe (30px):** sprang back.
- **Mostly vertical drag:** did nothing.
- **Plain tap:** still opened the row.
- **Swipe from the right edge:** ignored.
- **P after swiping right:** ran P and closed the row. No page errors.

### picker 13.178 / native 13.171 — stable: MPB played row always sits just above the player, pulled down too when it was higher up
<!-- 2026-09-16T19:39Z -->

**picker** — `staging - 13.178`: `player.js`, `VERSION`
**native** — `stg-native - 13.171`: `assets/web/player.js`, `assets/web/VERSION`

Mac confirmed 13.177 works, with one tweak. A played row that was already above the MPB player was left where it was, leaving a gap between it and the player. He wants it to always end up just above the player, from above as well as from below.

**Change** (`player.js` `scrayKeepPlayedRowAbovePlayer`, both apps).
- **Before:** each settle pass scrolled by `max(top moved since the tap, bottom − player top)`. That only ever lifted a row that was under the player.
- **Now:** it scrolls by `row bottom − player top`, so a row higher up the screen scrolls down onto the player's edge too.
- **Unchanged:** the rule for when it acts. The row has to be on screen at the moment of play, and unloaded, off-screen and folded rows are left alone. Touch or wheel still cancels.
- **Simpler code:** the captured start position isn't needed any more. Every pass re-aligns to the player, which also undoes the play path's own scroll-to-player calls.
- **Near the top of the page:** the browser can't scroll back far enough, so a row there stops as close as it can get.

**Tested** in headless Chromium with the 13.177 harness (player top edge at 544, a competing `scrollIntoView` at 300 ms):
- **Row below the player:** 612–663 → 493–544.
- **Row above the player:** 214–265, with the page scrolled 500px → 493–544.
- **Row near the top of the page:** stayed at 102–153, as there was no scroll to give back.
- **Off-screen row:** no scroll.

### picker 13.177 / native 13.170 — stable: MPB scrolls the played row to sit just above the player when it's on screen
<!-- 2026-09-16T19:32Z -->

**picker** — `staging - 13.177`: `player.js`, `VERSION`
**native** — `stg-native - 13.170`: `assets/web/player.js`, `assets/web/VERSION`

Mac's simplified version of the idea from 13.176: in MPB the docked player covers the row you tapped. Scroll just enough to lift that row above the player, but only when it came from the list or is already on screen. Nothing is revealed, and there's no segment view.

**How it works** (`player.js` `scrayKeepPlayedRowAbovePlayer`, identical in both apps).
- **Trigger:** called first thing in `playVideoInline`.
- **When it acts:** only in MPB, and only if the video's row in `#taggedVideosContainer` is laid out and on screen when the play is asked for. That covers a tap in the list, and X / R / next landing on a row you can see.
- **When it doesn't:** unloaded rows, rows scrolled off and files inside a closed folder group are left alone.
- **The scroll:** each pass keeps the row's top where it was, unless that leaves its bottom under the player's top edge. Then the row is lifted just clear. It measures the whole `li`, open details included, so a row that expands on tap still clears the player.
- **Why it captures first:** the row's position is taken before the play path runs, because the play path already scrolls the player into view in `playVideoInline` and in randomiser.js's X / R handlers. Holding the row's original top undoes those scrolls instead of chasing them.
- **Settle passes:** at 0 / 150 / 400 / 900 / 1600 / 2500 ms, because the dock appears and resizes while the video loads. They only act once `#inlineVideoContainer` is `bottom-docked`. A newer play, or any touch or wheel from Mac, stops them.

**Tested** in headless Chromium at 390×844 with the functions lifted from `player.js`, a fixed 300px docked player (top edge at 544) and 50px rows:
- **Covered row:** a row at 612–663 expanded to 250px after the tap, and a competing `scrollIntoView` ran at 300 ms. It ended at 293–544, directly above the player.
- **Clear row:** a row already clear at 255–306 stayed put, despite a 200px scroll during the play.
- **Off-screen row:** no scroll.
- **Touch:** a touch cancelled it.

### picker 13.176 / native 13.169 — stable: playing video's row green in the main list, a basketed one keeps a pink number
<!-- 2026-09-16T19:22Z -->

**picker** — `staging - 13.176`: `render.js`, `player.js`, `style.css`, `VERSION`
**native** — `stg-native - 13.169`: `assets/web/render.js`, `assets/web/player.js`, `assets/web/style.css`, `assets/web/VERSION`

Mac asked for the playing video to be highlighted green in the main list, wherever it is. If it's in the basket, its number should stay pink. He also asked for two bigger changes, which are not in this version and are waiting on his go-ahead:
1. In MPB, scroll the playing row to sit directly above the player.
2. In picker, show only the segment of the list around it, with pagination at the top as well.

**How it works** (`render.js` `scrayMarkPlayingRows`, identical in both apps).
- **Marking:** it reads `window.currentPlayingVideo` and adds `lc-playing` to every `li[data-video-id]` with that id in `#taggedVideosContainer` (and `#panelTaggedList`, the landscape-phone copy of the main list). If the row is a file inside a folder group, the group gets `lc-playing-group`, so the green shows while it's collapsed.
- **Every render:** it runs at the end of `updateBasketHighlights`, which every main-list render and basket change already calls, so rows loaded later by the pagination buttons come in marked.
- **Play and Stop:** `playVideoInline` calls it right after setting `currentPlayingVideo`, and Stop's full reset calls it after clearing it. The green follows every way a play starts (P, row tap, X, R, next and previous) and goes away on Stop.

**CSS** (`style.css`).
- **Colour:** green `#c8ecc9`, placed after the `basket-added` pink so it wins over it, and before `lc-selected` so a ticked row still shows as ticked.
- **Basketed:** the number cell of a playing row that's also basketed gets the pink background.

**Tested** in headless Chromium with picker's `style.css` and `scrayMarkPlayingRows` lifted from `render.js`, on stub rows (plain, basketed, and a file inside a collapsed group):
- **Play:** the playing row turned green and the others stayed clear.
- **Switch:** moving to a basketed row cleared the old one and made the new row green with a pink number.
- **Groups:** the group line went green when its file played.
- **Stop:** clearing `currentPlayingVideo` removed every mark.

### picker 13.173 / native 13.168 — test: wholesale Clear all clears every filter and the session excludes, keeps defaults, dark red
<!-- 2026-09-16T16:44Z -->

**picker** — `staging - 13.173`: `wholesale-mode.js`, `wholesale-mode.css`, `randomiser.js`, `VERSION`
**native** — `stg-native - 13.168`: `assets/web/randomiser.js`, `assets/web/VERSION`

(Native's change is a guard that does nothing there, since it has no wholesale mode. It keeps `randomiser.js` in step between the apps.)

Mac reported that Clear all still wasn't clearing both the pills outside the Exclude panel and the non-default excludes. For wholesale mode only, he asked for it to do exactly that, in dark red.

**Why it may have failed.** Not reproduced: the shared `scrayClearAllFilters` reads correctly (13.170). Two weak points were closed rather than guessed at:
- **Chained refreshes:** it clears through a chain of select `change` handlers, each running its own filter pass.
- **Defaults:** it kept them from `window.scrayDefaultExcludeTags` with exact matching only, and an empty list if start-up never recorded them. An empty list would clear the defaults too.
- **Colour:** in the bar, Clear all was the same bright red (`#f94144`) as the Exclude (n) pill beside it, so it was easy to tap the wrong one.

**Wholesale's own Clear all** (`wholesale-mode.js` wraps `scrayClearAllFilters`; outside the mode it hands straight to the original).
- **One pass:** every pill outside the Exclude panel is cleared, and so are the folder-name excludes except the default list. That covers tag includes and the level dropdowns, the studio / performer / stash tag / note includes and excludes, note keywords, search, score, orientation, and the stash and BM toggles.
- **No handler chain:** the dropdowns change through `'change.select2'`, then a single no-scroll refresh runs and the random list re-filters.
- **Defaults kept:** matched case-insensitively. If `scrayDefaultExcludeTags` was never recorded, the list is fetched from the server first, so a missing list can't clear the defaults.
- **Dark red:** `#8b0000` in the mode (`wholesale-mode.css`).
- **The Exclude panel's Clear All** (`randomiser.js`, `showExcludeTagsModal`): in wholesale mode it calls the same clear, is labelled "Clear all filters (keep defaults)" and is dark red. Outside the mode it still clears the session excludes only, as in 13.172.

**Tested** in headless Chromium with a harness copy of `wholesale-mode.js` and stub select2 selects:
- **Starting state:** excludes `x` (session) and `misc` (default, recorded as `Misc`); tag include `other` in `#tagFilterAllSelect`; studio exclude `twistys`; performer include `jane doe`.
- **After Clear all:** only `misc` left excluded. Everything else cleared, with one filter refresh and only `change.select2` triggers.

### picker 13.172 / native 13.167 — test: default and session excludes told apart in the exclude panel, its Clear All keeps defaults
<!-- 2026-09-16T16:36Z -->

**picker** — `staging - 13.172`: `randomiser.js`, `VERSION`
**native** — `stg-native - 13.167`: `assets/web/randomiser.js`, `assets/web/VERSION`

Mac asked for three things about folder-name (catalogue tag) excludes:
1. Default excludes told apart from ones added this session.
2. Clear all clearing the session ones and keeping the defaults.
3. The two coloured differently in the Exclude panel.

**Clear all in the pills bar** already did (2) as of picker 13.170 / native 13.166. It resets `#excludeTagSelect` to `window.scrayDefaultExcludeTags`.

**The Exclude panel** (`showExcludeTagsModal`, opened from the Exclude (n) pill, both apps).
- **Colours:** session excludes keep the usual red (`#f94144`) and are listed first. Defaults are slate (`#5a6b7d`) with a small "default" mark, set inline with `!important` to beat `.tag-selection-item-exclude`'s own `!important` red.
- **Legend:** a line under the title reads "Added this session (n)" and "Default (n)", and updates as pills are tapped.
- **Tapping a default** still stops excluding it for the session only. The tooltip says it stays on the default list.
- **The panel's own Clear All** used to empty the whole exclude list, defaults included. It now keeps the defaults, labelled "Clear All (keep defaults)" when there are any, and uses 13.170's no-scroll window.

**Question answered:** where the default excludes live and how they're managed.
- **Where:** the `exclude_tags` table in the SQLite database (columns `tag`, `added_at`), read and written through `api.php`'s `exclude_get` / `exclude_add` / `exclude_remove`.
- **Loading:** both apps read the list at start-up (`scray-exclude.js` `loadDefaultExcludeTags`).
- **The only UI:** the tag action modal. Tap a folder or bracket tag and choose "📊 Default Exclude (SQL)". On a tag already listed, the same button asks whether to remove it.
- **No list view:** there's no page listing the whole table. Browse's SQL console can query `exclude_tags`.

**Tested** in headless Chromium, with `showExcludeTagsModal` lifted out of `randomiser.js`, Picker's `style.css`, and defaults `misc` and `junk` plus session excludes `x` and `justroommates`:
- **Pills and legend:** session pills red, defaults slate with "default"; legend 2 / 2.
- **Clear All (keep defaults):** left `misc` and `junk` selected.

### picker 13.170 / native 13.166 — test: Clear all ignores the default excludes and keeps them, no scroll on Clear all
<!-- 2026-09-16T16:00Z -->

**picker** — `staging - 13.170`: `randomiser.js`, `scray-exclude.js`, `VERSION`
**native** — `stg-native - 13.166`: `assets/web/randomiser.js`, `assets/web/scray-exclude.js`, `assets/web/VERSION`

(Native 13.165 was not committed before this, so native's working tree carries both.)

Mac reported two problems with 13.169's Clear all:
1. It was always on screen. It should only show when filters are in place.
2. Tapping it scrolled the page.

**1. Always on screen.** The default exclude list (`scray-exclude.js`, the `exclude_tags` table) is applied to `#excludeTagSelect` at start-up. 13.169 counted every selected exclude tag, so the defaults alone kept the pill up.
- **Recording the defaults:** `loadDefaultExcludeTags` now keeps the list as `window.scrayDefaultExcludeTags`. `addTagToDefaultExcludeList` takes a removed tag out of it.
- **The gate:** the pills bar skips those tags when it counts excludes, so Clear all shows only for filters beyond the defaults.
- **What Clear all does now** (`scrayClearAllFilters`): it puts the exclude dropdown back to the default list instead of emptying it. The defaults are always on, and clearing them away was never what that pill was for. The big Clear button (`clearAllFilters`) is unchanged.

**2. The scroll.** `scrayClearAllFilters` triggers `change` on each tag dropdown, and each handler runs its own filter pass. `skipSearchScroll` is one-shot and read at the end of `filterDisplayedByFilename`, so the first pass to finish used it up and a later one scrolled to the results. It's the same race 13.168 removed from the wholesale name taps.
- **No-scroll window:** the dropdown handlers still run, since they re-widen the cascaded option lists. Clear all now sets `window.scraySuppressScrollUntil` 1.5s ahead, and `filterDisplayedByFilename` treats that window like `skipSearchScroll`, so none of the passes it starts can scroll.
- **Also set:** `skipPanelAutoOpen`.

**Tested** in headless Chromium, with the pills function lifted out of `randomiser.js` and stub filter sets:
- **Two defaults excluded and nothing else:** `Score`, `Exclude (2)`, no Clear all.
- **Plus one tag excluded:** `✕ Clear all` appears, with `Exclude (3)`.
- **Defaults plus one studio excluded:** `− twistys`, then `✕ Clear all`.
- **Syntax:** `node --check` passes on all changed files.
- **Not tested:** the scroll window in a browser.

### picker 13.169 / native 13.165 — test: Clear all pill whenever any filter is on
<!-- 2026-09-16T15:50Z -->

**picker** — `staging - 13.169`: `randomiser.js`, `VERSION`
**native** — `stg-native - 13.165`: `assets/web/randomiser.js`, `assets/web/VERSION`

(Mac confirmed picker 13.168's wholesale name taps work.)

Mac asked for a clear button with the pills.

**Why it was missing.** `✕ Clear all` shared the Intersect / Additive switch's gate, `scrayTotalFilterTerms() > 1`. That counts includes only: catalogue tags, facet includes and note keywords. So it stayed hidden with a single include, and with any number of excludes. Excludes are what wholesale mode's name taps make first.

**The fix** (`updateFloatingTagPillsFromCommon`, both apps).
- **New gate:** Clear all has its own, and shows when includes plus excludes come to at least one. Excludes are the facet exclude sets plus `#excludeTagSelect`'s selection.
- **Unchanged:** the Intersect switch keeps the two-include gate, since it only means something with two. The pill's position and its action (`scrayClearAllFilters`, which clears everything) are the same.
- **Wholesale:** in Picker, the random list re-filters after Clear all through 13.166's `scrayRefreshFilters` wrapper.

**Question answered:** why some excludes sit inside the grey **Exclude (n)** pill while others show on their own.
- **Two different exclude lists:** a folder name (catalogue tag, e.g. from a file with no stash match) goes into `#excludeTagSelect`. The bar has always consolidated those into one Exclude (n) pill with its modal behind it.
- **Stash studios and performers** are facet excludes. Those have always had one red "− name" pill each (13.114).

**Tested** in headless Chromium, with the pills function lifted out of `randomiser.js` and stub filter sets:
- **Nothing on:** no Clear all.
- **One studio exclude:** `− twistys`, then `✕ Clear all`.
- **Plus a tag exclude:** the same, plus `Exclude (1)`.
- **One include:** `web`, then `✕ Clear all`, with no Intersect switch.
- **Two includes:** `∪ Additive`, then `✕ Clear all`.
- **Syntax:** `node --check` passes on both files.

### browse 13.69 / picker 13.165 / native 13.164 — test: Google on every Stash nav scene, stash names survive a rename, Refresh Data refreshes stash names
<!-- 2026-09-16T14:37Z -->

**browse** — `staging-browse - 13.69`: `api.php`, `VERSION.txt`
**picker** — `staging - 13.165`: `scray-stash-nav.js`, `scray-config.js`, `file-operations.js`, `excel-sheets.js`, `VERSION`
**native** — `stg-native - 13.164`: `assets/web/scray-stash-nav.js`, `assets/web/scray-config.js`, `assets/web/file-operations.js`, `assets/web/db.js`, `assets/web/VERSION`

Mac asked for two things:
1. A Google search on every scene listed in the Stash nav, in search results and on performer profiles.
2. Newly stash-matched files were still showing their path instead of studio / performers, in both apps, and Refresh Data didn't fix it. Names should update as soon as a file is matched.

**1. Google on every scene card** (`scray-stash-nav.js`). A **Google ↗** button sits after StashDB ↗ in each card's footer. It searches the title as an exact phrase, then the studio and up to two performers, e.g. `"Busted my stepsister taking a shower" just_roommates Sarah`. It opens through `openExternal`, the same as the other links, so in Native it opens in the app's browser.

**2. Names falling back to the path.** Not reproduced against the live server: the device shell can't reach macnguyen.com. The cause below was found by reading the code, and fits both symptoms, including Refresh Data not helping.
- **How names work:** the list names come from `stash_names`, a table keyed by **video_key**. It's signature-gated on the COUNT and MAX(updated_at) of `stash_matches`, `stash_scenes`, `stash_performers`, `stash_tags` and `stash_overrides`. The client keeps its copy in localStorage and only re-downloads when that signature moves.
- **What a rename does:** `scrayRekeyRows` is shared by `rename_file` (Native) and `rekey` (Picker's OneDrive rename). It moves the file's `stash_matches` and `stash_overrides` rows to the new key, but changed neither count nor updated_at.
- **So after a rename:** the signature stayed the same, and every client kept a name table with the row under the OLD key. The renamed file had no name row and was drawn from its path.
- **Why it stuck:** Refresh Data didn't call `stash_names` at all, and the periodic refreshes were told "unchanged". The file stayed on its path until some unrelated match moved the signature.
- **Why it started now:** 13.161's rename-after-match made "match, then rename" the normal flow, so almost every newly matched file hit this straight away.

Fixes:
- **Server** (`api.php`):
  - `scrayRekeyRows` now stamps `updated_at` on the `stash_matches` / `stash_overrides` rows it moves.
  - The `stash_names` and `stash_state` signatures gained `|r<MAX(sync_log.id) for field video_key>`, the latest rename, so any rename moves them.
  - The signature format change also re-sends the full table to every client once, which repairs files already renamed before this deploy.
- **Immediate, in the apps** (`scray-config.js`, `file-operations.js`, both apps):
  - `scrayStashNames.rekey(from, to)` copies a row to the new key. It's copied, not moved, since a phone-only rename leaves the catalogue key where it was.
  - `showRenameModal` records the key before renaming. Straight after `renameFile` it copies the name row across, then forces `scrayStashNames.refresh(true)` and `scrayLoadStashState(true)`.
  - In Native, a phone-only rename keeps the same key and copies nothing. The existing `refreshAllLists` that follows repaints with the name.
- **Refresh Data** (`refreshAfterDbPull`: `db.js` in Native, `excel-sheets.js` in Picker) now also forces the stash names and S-button state before repainting.
- **Refresh race** (`scray-config.js`): a forced refresh that found one already in flight used to return that one's answer. If the running request left before the match or rename being saved, the new name was missed until the next trigger. A forced refresh now waits for it and then asks again.

**Tested:**
- **Server:** `php -l` is clean. On an in-memory SQLite with `scrayRekeyRows` extracted from `api.php`, a rekey moved both signatures: `stash_names` from `…|r0` to a new updated_at and `|r1`, `stash_state` likewise. The moved row carried the new key and timestamp.
- **Headless Chromium, `scray-config.js`:** two forced refreshes started together made two `stash_names` calls, and the second result landed. `rekey` gave the renamed key the scene parts.
- **Headless Chromium, Native `file-operations.js`, mocked:** Rename everywhere called `rekey('old name.mp4', 'new name.mp4')` plus a forced refresh. A phone-only rename kept the same key.
- **Scene cards:** carry the Google URLs shown above.
- **Syntax:** `node --check` passes on all changed JS.

### picker 13.164 / native 13.163 — test: rename everywhere as a checkbox, suggested name without focus, Unblur all
<!-- 2026-09-16T14:18Z -->

**picker** — `staging - 13.164`: `file-operations.js`, `scray-stash-nav.js`, `VERSION`
**native** — `stg-native - 13.163`: `assets/web/file-operations.js`, `assets/web/scray-stash-nav.js`, `assets/web/VERSION`

(Native 13.162 was not committed before this, so native's working tree carries both.)

Mac asked for three things:
1. The rename question was still landing below the rename modal after a match. Put "everywhere or this phone only" in the rename modal itself, as a checkbox ticked by default, with the relevant details.
2. "Use suggested" / "Use without parent" should fill the name without activating the text box. The box should only wake when tapped.
3. An Unblur all option at the top of the Stash nav.

**1. Rename everywhere checkbox** (`showRenameModal`, native only; Picker never asked this question).
- **Where:** a blue box above Rename / Cancel, with the same look as the delete modal's "Also delete from OneDrive".
- **When it appears:** under the same condition `renameFile` uses before handing off to `scrayRenameLocal`: a phone file (`isLocalVideo`) that is also in the catalogue.
- **The note under it** changes with the box:
  - **Ticked:** the file is also in the catalogue. It renames the phone file, every OneDrive copy and the catalogue row (score, bookmarks, stash match and variants go with it). If the server refuses, nothing is renamed.
  - **Unticked:** this phone only. OneDrive and the catalogue keep the old name, and the difference turns up in the ✎ names list.
  - **Offline:** the box starts unticked and disabled, and the note says everywhere needs a connection.
- **On Rename:** `renameFile(video, name, { scope: 'everywhere' | 'phone' })`. `renameLocal` already skips `askScope` when a scope is passed, so no second modal is ever opened from here.
- **`askScope` stays:** the ✎ names list's batch renames still use it.
- **Why the modal was dropped:** 13.162's z-index on the question wasn't enough on device. With the question in the same sheet, the layering is gone.

**2. Suggested name** (`showRenameModal`'s `fill`, both apps). It no longer calls `input.focus()` / `setSelectionRange`. The name goes into the box and the word selector repaints, and the keyboard only comes up when you tap into the box.

**3. Unblur all** (`scray-stash-nav.js`).
- **Where:** in the search view, a 👁 Unblur all button at the end of the Search / ▶ / de-Camel / Filename row. In a performer view, it's in its own row above the profile.
- **What it does:** it reveals every cover and portrait at once and becomes 🙈 Blur all. The setting survives repaints, sorting, Load more and moving between views, so a newly drawn card arrives already unblurred.
- **Single covers:** tapping one still toggles just that one. Switching all resets any half-counted three-tap on a cover.

**Tested** in headless Chromium, native files, mocked:
- **Checkbox:** a local, catalogued file shows it ticked with the everywhere note. Unticking changes the note. Rename calls `scrayRenameLocal` with `{scope: 'phone'}`, and no `#scrayRenameScope` modal appears. A OneDrive-only file shows no checkbox.
- **Use suggested:** fills "Kari Sweets - Kari n Manna" and leaves focus on the button, not the input.
- **Unblur all:** reveals 3 of 3 covers, stays revealed after a sort repaint, and a performer view opens with 26 of 26 revealed. Blur all hides them again.
- **Syntax:** `node --check` passes on both apps' changed JS.

### picker 13.163 / native 13.162 — test: Stash nav path tags, preview and Google link, performer name choice, rename question on top
<!-- 2026-09-16T14:06Z -->

**picker** — `staging - 13.163`: `scray-stash-nav.js`, `file-operations.js`, `ui.js`, `VERSION`
**native** — `stg-native - 13.162`: `assets/web/scray-stash-nav.js`, `assets/web/file-operations.js`, `assets/web/ui.js`, `assets/web/scray-rename.js`, `assets/web/VERSION`

(Follows picker 13.162 / native 13.161 / browse 13.68, which are still test. No server change.)

Mac asked for six things:
1. After a match, the "Everywhere / This phone only" question was hidden behind the rename modal.
2. In the Stash nav, the file's path tags directly under the words box, tap to add to the search.
3. A slightly smaller font in that box.
4. A ▶ next to Search to preview the file, in the same player wholesale mode previews with.
5. Tapping a purple performer name should ask: filter as a tag, or search the performer in the Stash nav. It used to filter straight away.
6. A Google search link next to the name on a performer's profile, opening in the app's browser.

**1. Rename question** (`scray-rename.js`, native only). `askScope`'s modal is now z-index 2147483647.
- **Why it was hidden:** 13.161 raised the rename modal to the top layer so it would clear the Stash modal. The question stayed at the class default, 2147483000, underneath.
- **Why this works:** the question is appended after the rename modal, so at the same z-index it stacks on top.
- **Picker:** has no scope question, so no change there.

**2. Path tags** (`scray-stash-nav.js`). This is `video.tags` plus `video.bracketTags`, de-duplicated case-insensitively. `yet-to-upload` is left out.
- **Pills:** blue, between the box and the buttons.
- **A tap** adds the tag to the end of the box, or takes it out if it's already there as a whole word. Pills are green while their tag is in the box, and repaint as you type.
- **No automatic search,** so several can be picked first.

**3. Font.** The box is 14px, down from 16px, with slightly less padding. Both apps' viewports have `maximum-scale=1`, so iOS doesn't zoom on focus below 16px.

**4. ▶ preview** (`scrayStashNav.preview` / `endPreview`). Wholesale's popup lives in `wholesale-mode.js` / `.css`, which Native doesn't have. So the same approach is rebuilt in the shared nav file, with its own CSS injected once.
- **Same player:** it's still the app's own player. `inlineVideoPlayer.play(video, null, null, startAt, { preview: true })` starts it a quarter of the way in, like wholesale. It records no history, view or watched time.
- **Floated:** the player floats over a dim backdrop. It uses `.float-player`, which `computeBottomDock` already releases the dock for, under a new `body.ssn-pv-open`, so wholesale's own `ws-float-open` rules are never involved.
- **The Stash modal** is hidden (`display:none`) while the preview plays. ↩ Back to Stash, or a tap on the backdrop, stops the preview and brings the modal back as it was.
- **File already in the player:** this is the usual case from the S circle. It isn't restarted as a preview, which would lose your place. The modal steps aside, playback resumes if paused, and a ↩ Back to Stash pill at the top pauses it again and returns.
- **In fullscreen:** the popup CSS doesn't apply (same guard as wholesale), so the pill is used there too.

**5. Performer names in list rows** (`ui.js` `createClickablePath` chip, both apps). A performer chip now calls `scrayPerformerChoice(video, name)`, a small top-layer modal:
- **Filter as a tag:** reads **Remove from filter** when the name is already in the filter, and falls back to `scrayAddSearchTerm` as before.
- **Search in Stash nav:** opens that file's Stash modal. `showStashModal` gained `openOpts.performer`, and after the first lookup it goes straight to the performer's profile, with the matched scene id for the name lookup.
- **Studio chips** still filter on the first tap.

**6. Google link.** A small **Google ↗** after the name, and after any disambiguation, on the profile. It searches `"Name"` as an exact phrase and goes through `openExternal`: ScrayBrowser in Native, `scraynative://newtab` from Picker in the app's browser, a new tab elsewhere.

**Tested** in headless Chromium, native files, API and player mocked:
- **Path tags:** show karisweets / web / 2NGM / 21n. A tap toggles the tag in and out of the box and the green state follows. The box computes to 14px.
- **▶ preview:** calls `play` with `startAt` 47.75 (25% of 3:11) and `{preview:true}`. The modal is hidden and the player is fixed with `float-player`. Back to Stash stops it and restores the modal and body class.
- **File already playing:** no `play` call, the pill shows, and no stop on return.
- **Google link:** `https://www.google.com/search?q=%22Sarah%22`.
- **Performer choice:** Filter adds the facet. Search in Stash nav opens the modal onto the profile.
- **Syntax:** `node --check` passes on all changed JS.
- **Not tested:** the float over the real player and dock on a phone, and the rename question stacking on device.

### browse 13.68 / picker 13.162 / native 13.161 — test: in-modal Stash search and performer profiles, autocomplete fix, rename after match
<!-- 2026-09-16T13:37Z -->

**browse** — `staging-browse - 13.68`: `api.php`, `VERSION.txt`
**picker** — `staging - 13.162`: `scray-stash-nav.js` (new), `file-operations.js`, `scray-stash-edit.js`, `index.php`, `VERSION`
**native** — `stg-native - 13.161`: `assets/web/scray-stash-nav.js` (new), `assets/web/file-operations.js`, `assets/web/scray-stash-edit.js`, `assets/web/index.html`, `assets/web/VERSION`

(native 13.160 was still marked test when this started.)

Mac asked for six things in the Stash modal:
1. The **Filename** button searches just the words: CamelCase split, and separators that aren't spaces turned into spaces.
2. A Stash navigator inside the modal, because stashdb.org is hard to use on a phone.
3. Search results like bulk-stash's filename search, adapted for the apps. The list should be longer, and the words refinable in the same view.
4. In "Enter details by hand", the autocomplete list was covering the field being typed into.
5. A performer name should open that performer's StashDB profile, in the navigator.
6. Once an unmatched file is matched, the rename modal should open.

**Server: `stash_nav`** (`api.php`). A new read-only action. It writes nothing locally and sends StashDB queries only, so, like `stash_scene`, it isn't added to `SCRAY_PRIVILEGED`.
- **`op: search`:** `searchScene` with a limit of 40. `stash_fn_search` wasn't reused because it replaces a file's stored proposals, and browsing shouldn't touch those.
- **`op: performer`:** `findPerformer`, then `queryScenes` filtered to that performer, newest first, 25 to a page.
- **Name to id:** the catalogue stores performer names only, so a chip has no id. The server looks the name up in that scene's own credits first (name, "as" credit or alias), which gets exactly that person. Only then does it fall back to `searchPerformer`: an exact name or alias match, otherwise the first result.
- **Fallbacks:** every query has fallback selections, richest first, like the existing search. A field StashDB rejects gives a thinner card rather than an error. A profile whose scene list fails still shows, with a note.
- **Scoring:** every scene is scored with `scrayStashScore`, bulk-stash's scorer, when the file is catalogued. The apps send the file's own cleaned words as `score_term`. Confidence then describes the file, not whatever was last typed into the search box.

**Navigator** (`scray-stash-nav.js`, identical in both apps). It borrows the modal's body, footer and heading the way the details editor does.
- **Search view:** a sticky words box with Search, de-Camel and Filename. Under it, the result count, a stashdb.org link and a **Best match / StashDB order** toggle.
- **Cards:** a blurred thumbnail (three taps to reveal, like the modal's cover) and title, studio · date · code, and confidence. Also file length, scene length, difference (same 3% / 5% colour bands as bulk-stash) and cast shape. Performer chips, a fold-out with tags, synopsis and why-this-score, then **Accept & submit** and **StashDB ↗**.
- **Performer view:** a portrait (blurred, the widest image taller than it is wide), name, disambiguation, gender, age, birth date, country, aliases. Facts for ethnicity, height, measurements, career and scene count. **Filter by this performer**, which follows the live filter like the modal chips, plus a stashdb.org link. Then their scenes with the same cards, **Best match / Newest**, and **Load more**. Any performer chip on any card opens their view.
- **Back** walks the views. The last Back is labelled "Back to lookup" and puts the lookup panel back exactly as it was, with the typed words kept.
- **Accept** is a two-tap confirm, not `confirm()`, for the same FLS / iOS reasons as the editor. It calls `stash_submit`, the route the pasted URL already used, so the match is recorded as `manual`.
- **Offered only on an unmatched file with a fingerprint.** On a matched scene the performer profile has no Accept buttons.

**Modal wiring** (`file-operations.js`, both apps).
- **Filename:** uses `scrayStashNav.words()`. It drops the extension, turns every non-letter, non-digit, non-apostrophe run into a space, splits CamelCase, and drops WxH, 720p / 4k, fps and kbps. Example: "Busted my Stepsister taking a Shower_just_roommates_720p.mp4" becomes "Busted my Stepsister taking a Shower just roommates".
- **Search and Filename** both open the navigator now. Return in the words box does Search.
- **Performer chip menu:** "Open on StashDB" (a site search in the browser) is replaced by **View performer profile**. It passes the matched scene id for the name lookup.
- **Submit refactor:** the URL Submit button and the navigator's Accept share `attachScene` / `afterAttach`. That means reload, then `scrayStashNames.refresh(true)` and `scrayLoadStashState(true)`, then the rename offer.
- **Submit note:** a note like "stored locally, StashDB refused the fingerprint" used to be written into the panel that the reload then replaced. It now shows once on the reloaded panel.

**Rename after match.** `offerRename()` opens `showRenameModal` on top of the Stash modal, which stays open underneath with the timestamps.
- **When:** only when the file went from unmatched to matched. That covers Accept, a pasted URL, and details entered by hand for a file with no match (Save creates a `manual:` scene). Corrections to an existing match don't trigger it.
- **Order:** it runs after the names refresh, so **Use suggested** already has the new stash name.
- **Layering:** Native's `showRenameModal` gained an `opts.zIndex`, because the Stash modal sits at 2147483647 and the rename landed underneath. Picker's rename modal already sets that z-index itself, and it's appended later, so it stacks on top without a change.

**Autocomplete** (`scray-stash-edit.js`, identical in both apps).
- **Cause:** the list was `position: fixed`, placed from the input's `getBoundingClientRect`. With the iOS keyboard up, those measurements and fixed positioning disagree by however far the visual viewport has scrolled, so the list was drawn about one field too high, over the box being typed in.
- **Fix:** the list now sits in the form, straight after the input, so it can't cover the box and pushes the fields below down instead.
- **Height:** 40% of the visible height, clamped to 120–260px.
- **Scrolling:** when it first opens under a box, the form scrolls so the field's label sits at the top of the body. That offset comes from the difference between two bounding rects, so the keyboard's viewport shift cancels out.
- **Closing:** a tap outside now closes the list on `click` rather than `pointerdown`. Collapsing an in-flow list at pointerdown moved whatever was under the finger, and the tap landed on a different field.

**Tested:**
- **Headless Chromium** at 390×844, both apps' `file-operations.js`, API mocked:
  - Filename fills "Busted my Stepsister taking a Shower just roommates" and opens the search view. Cards sort by confidence, and the toggle restores StashDB order.
  - A performer chip opens the profile with 25 scenes, and Load more takes it to 50 of 60. A chip without an id sends name plus scene id. Back, then Back again, returns to the search view and then the lookup panel.
  - Accept asks twice, calls `stash_submit`, reloads the matched panel with the note, and opens the rename modal on top.
  - Hand-entered details on an unmatched file open the rename modal after Save.
  - The matched-scene chip menu opens the profile with the scene id and no Accept buttons.
  - With the viewport cut to 460px high, the studio list renders directly under its input (input bottom 152, list top 155).
- **`stash_nav` PHP:** run against an in-memory SQLite and a stubbed `scrayStashdbPost`. Tested: search with the fallback selection, name-to-id through the scene credits and through `searchPerformer`, the profile fallback selection, portrait choice, and `queryScenes` paging variables. `php -l` is clean on `api.php`.
- **Syntax:** `node --check` passes on all changed JS.
- **Not tested:** the real StashDB schema for the new queries (`findPerformer`, `searchPerformer`, `queryScenes`), and the iOS keyboard itself.

### picker 13.161 / native 13.159 — test: smaller READY at the top, FLS left-third double taps, OneDrive free space
<!-- 2026-09-16T13:30Z -->

**picker** — `staging - 13.161`: `scray-config.js`, `player.js`, `style.css`, `randomiser.js`, `VERSION`
**native** — `stg-native - 13.159`: `assets/web/scray-config.js`, `assets/web/player.js`, `assets/web/style.css`, `assets/web/VERSION`

(browse 13.67 / picker 13.160 / native 13.158 were confirmed and committed as stable before this.)

Mac asked for three things:
1. The READY signal moved to the top of the page and made smaller.
2. In FLS, a double tap in the bottom half of the zone left of the leftmost guideline switches to MPFS.
3. In Picker, the total OneDrive free space across the connected accounts, from the same API data browse.html's storage panel uses, shown where Native shows the phone's free space: after "Total size" on the stats line above the list.

For (2), Mac chose that next bookmark moves from a triple tap anywhere in the left third to a **double tap in its top half**.

**1. READY** (`scray-config.js`, both apps). The toast is now a small pill at the top centre (`safe-area-inset-top + 8px`) instead of a large card mid-screen.
- **Size:** 0.85rem, 5px × 12px padding, fully rounded, with a lighter shadow.
- **Text:** one line, "✅ READY · start-up finished in 3.0s".
- **Motion:** it drops in 6px and fades, instead of scaling.
- **Unchanged:** the colour, the dwell time and the timing logic.

**2. FLS left third** (`player.js`, both apps). This covers the landscape branch of `handleDoubleTap`, the zone left of the first guideline.
- **Top half** (as seen in landscape; the tap is already remapped for FLS): `scrayNextBookmark()`, the same call the triple tap made.
- **Bottom half:** `toggleManualRotation()`. While fullscreen is on, that resets the rotation and leaves plain portrait fullscreen, the same as the rotate button. It is guarded on `manualRotationActive`, so real device landscape does nothing there.
- **Triple tap retired:** the triple-tap tracker's FLS zone is now `null`. A triple would have had to wait out the double, and single taps in the left third toggle the controls again like everywhere else. One-finger zoom (tap, then drag) is unaffected, since a double tap never moves.
- **Guide:** a new `.fls-tap-split` draws a horizontal line across the left third at half height (FLS only), matching the other guides.

**3. OneDrive free space** (`randomiser.js`, picker). `updateVideoStats` now reads "Items: N | Total size: X | OneDrive 1.86 TB free".
- **The figure:** `graph_quota` (browse's call), with `remaining` summed over the accounts that answered, using browse's fallback of total minus used.
- **A failed account** isn't counted, and marks the figure with `*`. The line's tooltip lists each account's free space and says how many couldn't be read.
- **Doesn't slow the line:** it renders at once with the cached figure, and fills in when the call lands, but only if a newer render hasn't replaced the line.
- **Cached for 5 minutes, one request at a time:** `graph_quota` makes a Graph call per account.
- **Waits out READY:** the first fetch holds while `scrayBoot` is watching start-up or a folder refresh, polling every second for up to 2 minutes. READY is timed off network quiet, and a Graph round per account would otherwise push it back.

**Tested** in headless Chromium:
- **READY:** a pill at the top (y 8, 28px tall, 222px wide at 390px) reading "✅ READY · start-up finished in 3.0s".
- **Stats line:** renders first without the OneDrive part, then fills in "OneDrive 1.40 TB free*" with the per-account tooltip (two accounts read, one failed). A second render reuses the cache with no second request.
- **Not headless-tested:** the FLS double taps. The branch was checked by reading it, and both copies match.
- **Syntax:** `node --check` passes on all changed JS.

### browse 13.67 / picker 13.160 / native 13.158 — test: S circle, delete everywhere, rename without parent, Jira quick send
<!-- 2026-09-16T12:40Z -->

**browse** — `staging-browse - 13.67`: `api.php`, `scray-clean-name.js`, `VERSION.txt`
**picker** — `staging - 13.160`: `player.js`, `file-operations.js`, `style.css`, `scray-clean-name.js`, `scray-bugreport.js`, `VERSION`
**native** — `stg-native - 13.158`: `assets/web/player.js`, `assets/web/file-operations.js`, `assets/web/style.css`, `assets/web/scray-clean-name.js`, `assets/web/scray-bugreport.js`, `assets/web/VERSION`

Mac asked for five things:
1. An **S** (stash) circle to the left of Xt in FLS and MPFS.
2. In Native's delete modal, an option to also delete everywhere, including OneDrive, still asked first. In Picker, the same for a file that is also on the phone.
3. The rename modal's "Use suggested" split into **Use suggested** and **Use without parent**, when there's a parent.
4. The Jira modal ready to type into when it opens, with Return after the summary sending the ticket.
5. (Added mid-way.) A third Jira button, "Send and add another", and "Send to Jira" shortened to "Send".

Mac's choices on (2):
- **Picker offers the phone delete only inside Native's in-app browser.** Elsewhere the modal just notes the file is on the phone. There is no queue for Native to act on later.
- **The option is a tick box,** and Delete reads "Delete everywhere" while it's ticked.

**1. S circle** (`player.js`, both apps). `attachFrameStepButtons` puts a `plyr-frame-stash` circle first in the pause-menu group, before X^n / X^T. It opens `showStashModal(currentPlayingVideo)`, the same modal as the now-playing strip's S, which is behind "..." in fullscreen, and it has the modal circles' tap handling. The stash modal already sits at the top z-index, so it opens over the player.
- **Width:** nine circles. In MPFS (portrait query: 34px + 5px gaps) that's 346px, from 20px off the right edge, so it clears a 375pt phone. In FLS it's 346px from `right: 170px`. Checked in Chromium at 390px: the row runs 34→380.

**2. Delete everywhere.**
- **browse — new `api.php` action `delete_file { video_key, device }`.** The phone has no Graph token, the same reason `rename_file` exists.
  - **Which copies:** the same rule as `rename_file`: `file_instances` first, and `videos.one_drive_id` only when no instance row exists and no other row's copy holds that id.
  - **Deleting:** each copy gets a Graph `DELETE /me/drive/items/{id}` with its account's token, sending it to that account's recycle bin. A 404 counts as already gone.
  - **When all copies are done:** one transaction forgets their `onedrive` instance rows (phone instances stay), tombstones the row (`deleted = 1`, `offline = 0`, seq bump) and logs it to `sync_log`. It answers `{ onedrive_deleted, gone, head }`.
  - **A copy failing part way:** a DELETE can't be undone from here, so the copies already deleted are forgotten, the row is left live, and the 502 says how many went ("1 copy was already deleted (in the recycle bin); the catalogue row was kept"). If the first copy fails, it says "nothing was deleted".
  - **No copy on record:** the row is still tombstoned, and the answer is `onedrive_deleted: 0`.
  - **Access:** not in `SCRAY_PRIVILEGED`, like `rename_file`, because Native needs it with the device key. **Trade-off to be aware of:** anyone holding the bundled key can now send a catalogue file's OneDrive copies to the recycle bin (recoverable there), where before they could only rename them.
- **native — `showDeleteModal`.** A phone file that is in the catalogue (`isLocalVideo && inCatalogue === true`) gets the tick box **Also delete from OneDrive**, with the note: every OneDrive copy to the Recycle bin, out of the catalogue, needs a connection.
  - **Ticked,** it runs the new `scrayDeleteEverywhere(video)`: `delete_file` with `videoKey` (the server's key for a matched row) first, then `deleteLocalFile`, which still passes `localOnly`, since the server has already tombstoned.
  - **A server refusal** throws before the phone file is touched, and the modal stays open. An old server gets "The server needs updating first (browse 13.67's api.php)".
  - **The done message** is still the modal's alert: "Deleted everywhere … Phone, OneDrive (2 copies, in the Recycle bin) and the catalogue", or "Phone and the catalogue - no OneDrive copy was on record".
  - **Not changed:** phone files not in the catalogue, and catalogue rows that aren't on the phone.
- **picker — `showDeleteModal`.** For a file flagged offline (`scrayIsOffline`), the modal fills in a row once it is up:
  - **Inside Native's browser** (`scrayLocalPlay.available()`): it reads the phone folder if the cached read is stale, then either shows **Also delete from the phone** ("deleted for good - there is no recycle bin there"), or "marked as on the phone, but the file wasn't found there".
  - **Anywhere else:** "Also on the phone - open Picker inside Native to delete it from there too."
  - **Ticked:** OneDrive (the existing `deleteFile`, recycle bin and tombstone) goes first, then `ScrayBridge.deleteFile(path)`. The order is deliberate: the phone copy can't come back, so a OneDrive failure must leave it alone.
  - **After the phone delete:** a "not found" still counts as done, as checkout treats it. Then `scrayMarkOffline({ off: [key] })` runs and the local-play map is invalidated.
  - **If the phone delete fails,** the message says "Deleted from OneDrive, but not from the phone: …".
- **Both apps:** if Delete fails, the button goes back to "Delete everywhere" or "Delete" to match the tick box. Styles are in `.scray-delete-everywhere`.

**3. Use without parent.** `scray-clean-name.js`, still identical in all three repos:
- `cleanNameParts(video, { noParent })` builds the name with the parent field blank.
- `window.scrayCleanNameNoParent(video)` returns that name, or null when the full suggestion has no parent in it (none filed, or the studio is its own parent).

In `showRenameModal` (both apps):
- **The second button** (`rename-suggest-btn-alt`, outlined purple) shows only when the no-parent name differs from the file's current name and from the full suggestion.
- **The row** now shows when either name is on offer, so a file already carrying the full name still gets **Use without parent**.
- **Filling:** both buttons fill the box the same way, and the name line changes to whichever was last used.

**4 and 5. Jira modal** (`scray-bugreport.js`, both apps).
- **Keyboard on opening.** The old 50ms delayed focus never raised iOS's keyboard, because the snapshot is awaited first and the tap gesture has ended by the time Summary exists. Now `openModal` focuses a hidden 1px input synchronously, inside the tap. Once the panel is built, it moves focus to Summary and removes the stand-in; moving focus between fields keeps the keyboard up. `close()` removes the stand-in too.
- **Return:** Summary has `enterkeyhint="send"`, and Return in it calls `send(false)`. An empty summary still gets "A summary is required." What happened? keeps Return for new lines.
- **Buttons:** Cancel, **Send**, **Send and add another** (a little wider).
  - **Send and add another** focuses Summary inside the tap, then files the ticket. On success it empties Summary, What happened? and the screenshot, and keeps the type and the attach tick. The status reads "Filed as SO-123. Next one:".
  - **During filing** both send buttons are disabled.

**Tested**, all in headless Chromium unless stated; `node --check` passes on every changed JS file.
- **delete_file:** `php -l` passes, plus a harness that runs the real `delete_file` case against in-memory SQLite with Graph stubbed:
  - Two copies: 2 DELETEs, row tombstoned with `offline` 0, the onedrive instances forgotten and the phone one kept, 3 `sync_log` lines.
  - One 404: counted as gone and still tombstoned.
  - Second copy 403: a 502 saying 1 copy was already deleted; row live; the failed copy's instance kept.
  - First copy 500: "nothing was deleted".
  - The `videos.one_drive_id` fallback deletes that id, and a row with no copy is still tombstoned.
  - A missing, already-deleted or blank key is refused.
- **Jira** (both apps, touch emulation, opened by a tap on a Jira Report button):
  - Summary is focused on open, with no stand-in left behind. Buttons read Cancel / Send / Send and add another.
  - Send and add another files the ticket with its details, empties both fields, keeps the panel open and keeps Summary focused.
  - Typing and pressing Enter files the second ticket and closes the panel. Enter on an empty summary is refused.
- **Rename** (both apps):
  - With a parent: the full name plus both buttons, and each fills the box and the name line.
  - No parent, or the studio as its own parent: only Use suggested.
  - Already named in full: only Use without parent. Already named without the parent: only Use suggested.
- **Delete, picker:**
  - Not offline: no row.
  - Offline inside Native: the tick box appears, and ticking relabels Delete. The run goes OneDrive → phone → invalidate → mark off.
  - Unticked: OneDrive only.
  - Phone failure: the partial message. OneDrive failure: the phone is untouched and the modal stays open.
  - A file not found on the phone, and a file opened outside Native, each get their note.
- **Delete, native:**
  - A phone file in the catalogue gets the tick box. Ticked: `delete_file` with its videoKey, then the phone delete, then the "2 copies" message. Unticked: the plain delete.
  - A server 502 or an old server leaves the phone file untouched, with a clear message. A zero-copy answer gets the no-copy wording.
  - Not in the catalogue, or a cloud row: no box.
- **S circle** (both apps): nine circles with S first; a tap opens the stash modal for the current video.

### picker 13.159 / native 13.157 — test: holding search clears it without asking
<!-- 2026-09-16T12:00Z -->

**picker** — `staging - 13.159`: `ui.js`, `scray-config.js`, `VERSION`
**native** — `stg-native - 13.157`: `assets/web/ui.js`, `assets/web/scray-config.js`, `assets/web/VERSION`

**Correction to 13.158 / 13.156.** Mac's "show confirmation" for hold-to-clear meant a done message, like the score confirmation. It didn't mean an "are you sure?" prompt.

- **Holding the search button:** after 600ms with a term in place, it now clears straight away. It's the same clear as the pill's ×, including its "Filter cleared" tooltip by the button. The click that ends the hold is still swallowed, and a hold with no term is still just a tap.
- **Removed:** `window.scrayConfirmToast`, which nothing else used. The shared button builder stays hoisted in the toast IIFE, where `scrayUndoToast` uses it.

**Wording suggested for future requests:**
- **"ask first"**: an are-you-sure prompt that waits for Mac's answer.
- **"done message"**: a pop-up that just reports it happened, like the score confirmation.

**Tested** in headless Chromium, both apps:
- A tap runs the click and doesn't clear.
- A 700ms hold clears the box and the pill mid-hold, with no prompt, and no click follows.
- A hold with no term runs the click.
- `node --check` passes.

### picker 13.158 / native 13.156 — test: bookmark count by the diamond, jumps keep pause, hold search to clear
<!-- 2026-09-16T11:45Z -->

**picker** — `staging - 13.158`: `excel-sheets.js`, `style.css`, `player.js`, `file-operations.js`, `ui.js`, `scray-config.js`, `VERSION`
**native** — `stg-native - 13.156`: `assets/web/local-scores-cache.js`, `assets/web/style.css`, `assets/web/player.js`, `assets/web/file-operations.js`, `assets/web/ui.js`, `assets/web/scray-config.js`, `assets/web/VERSION`

Mac asked for three things:
1. The purple ♦ marking a video with bookmarks shows the bookmark count to its left, one font size smaller and the same purple.
2. Jumping to a bookmark while the video is paused keeps it paused.
3. Holding the search button clears the search term if there is one, after a confirmation.

**1. Count by the ♦.** A new `scrayBookmarkCount(video)`, beside `scrayHasBookmarks`, reads the same sources in the same order: the video's own array, then a JSON string, then `cachedVideoBookmarks`. It lives in picker's `excel-sheets.js` and native's `local-scores-cache.js`.
- **Both marker shapes** (the node and the HTML string) now fill the ♦ span from `scrayBookmarkDiamondInner`: `<span class="scray-bm-count">3</span>♦`.
- **Mounting and refresh:** it stays a single `.scray-bm-diamond` span, so the existing mount/refresh code needed no change. After a bookmark edit, the count repaints wherever the ♦ already does.
- **CSS:** `.scray-bm-diamond .scray-bm-count` is 0.8em with a 0.12em gap, and inherits the purple.
- **Blacklisted notes still count.** `scrayHasBookmarks` doesn't exclude them either, and the two should agree.

**2. Paused stays paused.** Two jumps used to call `play()` unconditionally:
- **The progress-bar marker and its rail chip** (`jumpTo` in `renderBookmarkMarkers`) now play only if the player wasn't paused.
- **The bookmark modal's time pill** (`jumpTo` in `showBookmarksModal`, same video). The modal pauses the player when it opens, so it is always paused by the time of the jump. The modal now records `wasPlaying` before pausing, and the jump plays only if that was true.
- **Unchanged:** jump-to-next (M>) never called `play()`. A modal jump into a *different* video still loads it through `inlineVideoPlayer.play`.

**3. Hold the search button to clear** (`ui.js`, after the `#jumpSearchBtn` click handler).
- **The hold:** `pointerdown` starts a 600ms timer, but only when `#filenameSearchBox` has a term. Up, leave or cancel stops it. When it fires, a confirm toast asks **Clear search "term"? Clear / No**.
- **Clear** empties the pill input and calls `clearSearchPillFilter` with the button as the event target, so "Filter cleared" appears by the button. It's the same clear as the pill's ×.
- **The follow-up click:** the click that ends a hold is stopped by a document capture listener, so the normal jump-to-search doesn't run as well. With no term, a hold is just a slow tap and the click runs as before.
- **`window.scrayConfirmToast`** (`scray-config.js`): a message with Yes and No in the undo toast's style. The button builder moved up to the shared scope. Left unanswered, it goes after 5s and nothing happens.

**Tested** in headless Chromium, both apps:
- **Count:** the ♦ HTML reads `3♦` for an array of three, `1♦` for a JSON string of one, and nothing for none. The node form matches. Rendered with native's `style.css`, the count is smaller and purple (1, 3, 12).
- **Marker taps:** tap-tap on a marker while paused seeks to 1:00 with no `play()`; while playing, it plays.
- **Modal jumps:** opened while paused, a jump doesn't play; opened while playing, it does.
- **Search button:**
  - A quick tap runs the click and shows no toast.
  - A 700ms hold shows the toast and the click doesn't run.
  - Clear empties both the box and the pill, with "Filter cleared" positioned off the button.
  - A hold with no term runs the click as normal.
- `node --check` passes on all changed JS.

### picker 13.157 / native 13.155 — test: edit bookmarks from the progress bar, Delete all
<!-- 2026-09-16T11:20Z -->

**picker** — `staging - 13.157`: `player.js`, `file-operations.js`, `scray-config.js`, `VERSION`
**native** — `stg-native - 13.155`: `assets/web/player.js`, `assets/web/file-operations.js`, `assets/web/scray-config.js`, `assets/web/VERSION`

Mac asked for two things:
1. The tooltip raised by tapping a progress-bar marker gets an edit button on its right. It opens an edit mode with two actions:
   - **Adjust:** scrub to a new point, tap Adjust, and the bookmark moves there.
   - **Delete:** removes the bookmark, after a confirm.
2. In the bookmark modal's delete mode, a **Delete all** option that marks every bookmark for deleting.

(Picker's 13.156 had been committed as test; it was set to stable and committed before this.)

**1. Edit mode on the marker rail** (`player.js`, byte-identical in both apps apart from one existing comment).
- **✎:** `showBookmarkRail` takes a new `opts.onEdit`, and only the marker-tap rail passes it, not the jump-to-next flash. It adds a 30px ✎ button after the chips. The rail's placement code became `rail.__place(width)`, so edit mode can re-lay the rail out at its own width.
- **Buttons:** the new buttons come from `makeRailButton`, with the chips' touchend-first firing and `dataset.firing` guard. They use their own class, `bookmark-rail-btn`, because MPB's `.bookmark-tooltip-chip` background override is `!important` and would grey out a red Delete.
- **Clusters:** with more than one chip on the rail, ✎ first asks which bookmark. The chips get a dashed outline, and tapping one picks it instead of jumping.
- **The editor:** `[1:00 note] [Adjust → 1:35] [Delete] [✕]`. The Adjust label follows the playhead every 250ms, so the button shows where it will move the bookmark. Delete swaps to `[Delete 1:00 note?] [Yes] [No]`, and No goes back.
- **Stays up while editing:**
  - The 5s fade timer is cancelled.
  - The bar's disarm listener skips a touch while `rail.dataset.editing` is set, because that touch is the scrub Adjust needs.
  - Hovering over other markers on desktop doesn't replace the edit rail.
  - Tapping a different marker still replaces it, and ✕ fades it out and hands the controls back through `dismissBookmarkRail`.
- **Saving:** it goes through `saveBookmarks` on `currentPlayingVideo` with a new list, like the modal, so the server diff tombstones the old time. It is followed by the 13.156 Undo toast: "Bookmark moved 1:00 → 1:35" or "Bookmark 1:00 deleted".
  - **Finding the bookmark:** the same object if it's still in the list, otherwise the same time (to the ms) and note.
  - **Adjust refuses** a time another bookmark already has ("A bookmark is already at 5:00"), because the server keys bookmarks by time and the two would merge. It also refuses the bookmark's own time ("Already there - scrub first").
  - **Afterwards:** `saveBookmarks` re-renders the markers, which clears the edit rail.
- **Watch for:** a background sync that re-renders markers mid-edit closes the edit rail, like any rail. Adjust works in FLS as elsewhere, since the rail rotates with the controls. The Undo toast is the unrotated body one, as all bookmark confirmations have been.

**2. Delete all** (`file-operations.js`). Delete mode's red hint bar now has a **Delete all** button, which marks every bookmark as if each had been tapped. Save still does the deleting, and shows the count.
- **Toggle:** with everything marked, the button reads **Unselect all** and clears the marks.
- **Where it shows:** the hint was only in the paged modal (with a playhead). It's now a shared `deleteHint` and also shows above the list in the no-playhead modal, which can delete but never had the hint.

**Undo toast (`scray-config.js`):** a new toast now replaces one still on screen, instead of drawing over it in the same spot. A toast mid-undo is left to finish.

**Tested** in headless Chromium, both apps. The rail and markers code was lifted out of `player.js` into a stub page.
- **Adjust:** ✎ opens the editor, and Adjust follows the playhead to 1:30. A touch on the bar and 5s of waiting both leave the rail up. Adjust saves 1:00 → 1:30, with the Undo toast.
- **Refusals:** adjusting onto an existing bookmark is refused, with no save.
- **Clusters:** ✎ on a two-bookmark cluster shows the pick step. Picking 5:03, then Delete → No → Delete → Yes, saves without it. Undo → Yes restores it.
- **✕:** clears the rail.
- **Delete all,** in both the paged and no-playhead modals: Delete all → "Unselect all" with "Save (3)". Pressing again unmarks all ("Save"). Delete all then Save saves an empty list.
- `node --check` passes on all changed files.

### picker 13.156 / native 13.154 — test: undo on bookmark and score confirmations
<!-- 2026-09-16T10:55Z -->

**picker** — `staging - 13.156`: `scray-config.js`, `file-operations.js`, `excel-sheets.js`, `VERSION`
**native** — `stg-native - 13.154`: `assets/web/scray-config.js`, `assets/web/file-operations.js`, `assets/web/local-scores-cache.js`, `assets/web/VERSION`

Mac asked for two changes to the bookmark and score save confirmations:
- They stay up 50% longer.
- They get an Undo button, in case the save was a mistake. Undo asks for confirmation first, in case it was tapped by accident.

(13.155 / 13.153 were confirmed and committed as stable before this.)

**One helper, `window.scrayUndoToast`, in `scray-config.js`.** It's in both apps and byte-identical. The confirmations themselves live in different files in each app: picker's in `excel-sheets.js`; native's score one in `local-scores-cache.js` and its bookmark one in `db.js`. A shared helper keeps the new behaviour in one place.
- **Appearance:** it borrows the class of the tooltip it replaces (`bookmark-confirmation-tooltip` or `score-confirmation-tooltip`), so it looks the same.
- **Taps:** it turns `pointer-events` back on, since those tooltips are `pointer-events: none`. Touches on it stop propagating, so a score menu's outside-tap close and the player underneath don't see them.
- **Flow:** the saved message plus **Undo**. Undo changes it to **Undo? Yes / No**, which stays up for 5s (`CONFIRM_MS`); left unanswered, the save stands. No puts the message back and restarts the timer. Yes shows "Undoing…", then "↩ Undone" or "❌ Undo failed" for 1.5s.
- **Long filenames:** the toast is capped at the screen width and the message ellipsises, so Undo can't be pushed off the edge.

**Bookmarks** (`commitAndClose`, the same in both apps). This covers every save from the modal: a quick note, Save, the timestamp button, swap, and delete.
- **Before saving:** it takes a copy of `video.bookmarks`.
- **After saving:** once `saveBookmarks` succeeds, the "Saving… → N bookmarks saved" tooltip is replaced by an undo toast with the same text for 1.95s (was 1.3s).
- **Undo:** puts the copy back and calls `saveBookmarks` again. It diffs against the server in both apps, so a bookmark the save added is tombstoned, and one it deleted or moved comes back.
- **Detached tooltip:** the undo save gets a tooltip that isn't on the page. Otherwise picker's `saveBookmarks` would pop its own "saved" message over the toast.
- **Not changed:** a failed save keeps the old ❌ tooltip, and stash imports keep the plain confirmation.

**Scores**, shown for 2.25s (was 1.5s):
- **Picker:** the write and in-memory patching in `showVideoScoringModal` became `applyScore(score)`, unchanged apart from the variable. Undo runs it with the previous score: `video.userScore`, then the cached score, then 0, which is "unscored".
- **Native:** Undo calls the existing `applyVideoScore(video, prev)`. The previous score is `video.user_score`, then the cached score, then `null`, which is native's "cleared".
- **Not changed:** rename, move and exclude confirmations use `showScoreConfirmation` too, and keep it.

**Tested** in headless Chromium with native's `style.css`, for both apps:
- **Bookmarks:** a quick note shows "2 bookmarks saved | Undo". Undo shows Yes/No, No restores it, and Yes saves the original single bookmark back and shows "↩ Undone". Untouched, the toast is still up at 1.8s and gone by 2.4s.
- **Scores:** scoring 7 on a video scored 3 writes 7; Undo → Yes writes 3 and the video reads 3 again.
- `node --check` passes on all changed files.

### picker 13.155 / native 13.153 — test: same rail height either way in, tighter button row, Clear
<!-- 2026-09-16T10:30Z -->

**picker** — `staging - 13.155`: `file-operations.js`, `VERSION`
**native** — `stg-native - 13.153`: `assets/web/file-operations.js`, `assets/web/VERSION`

Mac's three points, from testing 13.154 / 13.152 on the phone:
1. Add note showed part of one row of the quick-note rail, but tapping the field itself showed two rows and a bit. They should match.
2. There was a lot of white space around the button row. The row should sit closer to the keyboard, with the space above it going to the rail.
3. Add a Clear button between Add note and Delete that clears the selection.

**1. Tapping the field now goes through Add note's path.** In the screenshots the whole panel sat about 27pt higher after a tap on the field, and it was taller, with its bottom edge touching the keyboard's accessory bar. That is iOS's own scroll-into-view on a native focus. It moves the page, which changes what `applyKeyboardInset` measures against. Add note focuses with `preventScroll`, so it never had that shift.
- **The change:** a `touchend` on the field that arrives while the field is unfocused, and hasn't moved more than 10px, is cancelled and handed to `focusNoteField()`, the same call Add note makes.
- **Already focused:** taps are left alone, so the caret can still be placed and text selected.
- **Watch for:** WKWebView has to accept a focus from `touchend` as a user gesture and raise the keyboard. Add note already relies on the same thing from a `click`. If the keyboard doesn't come up on a field tap, this is the cause.
- **Which height wins:** the Add note one. The space reclaimed in 2 more than makes up the difference.

**2. Where the white space came from** (measured in Chromium with native's `style.css`):
- **Under the buttons (about 48px):** the global `button { margin-bottom: 10px }`, the form's UA bottom margin (17.6px), and the panel's 20px padding.
- **Above the buttons (about 40px):** the rail's 10px bottom margin, `.file-operation-buttons`' 20px `margin-top`, and 10px of padding.

**What changed:**
- The form's margin is 0, the row's buttons have margin 0, and the row has no top margin and 8px of padding.
- The rail's bottom margin is 2px and the panel's bottom padding is 10px.
- `KEYBOARD_GAP_PX` went from 12 to 6.

At the same panel height, the rail's visible area went from 57px to 131px: about four rows of pills instead of two.

**3. Clear.** An orange button between Add note and Delete. It empties the picked notes and leaves the typed search alone, since that has its own ×. It reads "typing" at the press, like the pills, so clearing while picking keeps the keyboard up.
- **After a Clear:** nothing is picked, so with the field inactive the next tap on a note saves it on its own (13.154's rule).
- **Button row:** it only appears with a playhead, like Add note. With five buttons, the side padding is 2px and the gap is 6px; all five labels fit at 430px.

**Tested** in headless Chromium, on both copies:
- With touch emulation, a tap on the field focuses it through the new path.
- Picking "kiss" and "sex", then Clear, empties the picks and keeps the field focused. After a blur, the next tap on a note saves it on its own.
- The 13.154 checks still pass: one-tap save, multi-pick after Add note, blur-then-tap picks, and delete mode.
- `node --check` passes on both.

### picker 13.154 / native 13.152 — test: tap a quick note to save the bookmark
<!-- 2026-09-16T10:08Z -->

**picker** — `staging - 13.154`: `file-operations.js`, `VERSION`
**native** — `stg-native - 13.152`: `assets/web/file-operations.js`, `assets/web/VERSION`

Mac asked for the Add bookmark page's old one-tap quick note back: tapping a note saves the bookmark and closes the modal. To add several notes, Add note has to be activated first.

**Why it had gone.** 13.151 / native 13.149 turned the rail into keyword picking, so every tap toggled a pick and saving needed Save or the timestamp. The one-tap save from before (a quick note commits straight away unless you're typing) was lost with it. Its old comment above the Save handler was still there, describing behaviour that no longer existed; it's now replaced.

**The rule, in the rail's click handler.** A tap saves `{ time: playhead, note: that keyword }` and closes the modal when all of these are true:
- the modal is in normal mode (swap and delete still only pick, since they're waiting on a row tap);
- the note field isn't active - "active" is the same as before: tapped, typed in, or opened with Add note, read at the press, and the auto-focus on opening doesn't count;
- nothing is picked yet, and the tapped pill isn't already picked.

Otherwise it picks or unpicks as in 13.153.
- **Why "nothing picked" counts:** once Add note has started a multi-pick, dismissing the iOS keyboard blurs the field. Without this, the next tap would save the note with only some of its keywords. The rail stays in picking mode until Save.
- **Fresh "+ word" pills** follow the same rule. They only show while there's typed text, which normally means the field is active, so they pick.

**Hint.** With nothing typed or picked, the preview line reads "Tap a note to save it, or Add note to pick several" (was "Search notes, or tap to pick them").

**Tested** in headless Chromium with stubbed globals, on both copies:
- A single tap on "sex" saves `{65s, "sex"}` next to the existing bookmark and closes the modal. The hint reads as above.
- Add note, then "kiss" and "cowgirl": the modal stays open, the field keeps focus, and the preview reads "kiss cowgirl".
- Blur the field, then tap "sex": it picks and doesn't save. Save then commits "kiss sex cowgirl".
- In delete mode, a rail tap only picks.
- `node --check` passes on both. The patch is byte-identical in picker and native.

### browse 13.64 / picker 13.153 / native 13.151 — test: keywords, and parent notes
<!-- 2026-09-15T21:58Z -->

**browse** — `staging-browse - 13.64`: `api.php`, `manage-data.html`, `VERSION.txt`
**picker** — `staging - 13.153`: `scray-config.js`, `randomiser.js`, `scray-views.js`, `file-operations.js`, `style.css`, `VERSION`
**native** — `stg-native - 13.151`: `assets/web/scray-config.js`, `assets/web/randomiser.js`, `assets/web/scray-views.js`, `assets/web/file-operations.js`, `assets/web/style.css`, `assets/web/VERSION`

Mac asked for three things:
1. What 13.62–13.152 called "parent notes" (a note's words) are now **keywords**, everywhere.
2. In the NOTES filter, mapped notes are styled like the keyword chips.
3. A new manage-data section, **Parent notes**. A keyword ticked Parent becomes a parent note, and any other keyword can have one parent note. Parent notes are bold in the apps and behave like any other keyword, except that picking one also brings in its child keywords.

His aim: keywords he always wants linked to another keyword shouldn't need that other keyword added by hand every time.

Mac's choices:
- **Children count as the parent.** Picking "sex" matches bookmarks with sex or any of its children, under one pill.
- **Links aren't written into notes.** Picking "cowgirl" saves "cowgirl", so changing the link later updates old bookmarks too.
- **Full rename.** The stored key moves as well, so "parent" only ever means the new parent notes.

**1. Keywords (the rename).**
- **Storage:** a note's list is now stored under `keywords` (label "Keywords"). `ensureNameMaps` moves any note's `parent` value there, notes only; a studio's Parent is untouched. It's the same LIKE-filtered move as 13.34's class→parent.
- **api.php:** functions and fields are renamed: `scrayNoteAutoKeywords`, `scrayNoteKeywordStopwords`, `scrayNoteKeywordsNone`, `scrayNoteKeywordsSame`, `scrayMigrateNoteKeywordsAuto` (still flagged `note_parents_auto_v1`, so it doesn't run again), and `note_keyword_stopwords` / `note_keywords_none` in the dictionary.
- **manage-data:** the notes sheet column, tiles, placeholder and hint are renamed. A CSV from before this bump with a `parent` column on notes still imports, as keywords.
- **Apps:** `scrayNoteKeywords`, `scrayNoteAutoKeywords`, `scrayNoteKeywordFilter` / `scrayNoteKeywordIntersect`, `scrayNoteKeywordsPass`, `scrayVideoPassesNoteKeywords`, `scrayNoteKeywordCounts`, CSS `floating-tag-notekeyword` / `scray-cloud-note-keywords`, and all the text ("Search keywords…", "Keywords: any ∪", "1 keyword, 0 selected", "∪ any keyword"). Comments too. They also read the old field names and an old cached `parent` value, so a cached dictionary still works until it refreshes.

**2. Mapped notes in the NOTES filter** use the keyword chips' size, border, radius and colours: violet when picked, red when excluded.

**3. Parent notes.**

*Storage (api.php).* A new name_maps kind, `keyword`, with one row per keyword and attributes `is_parent` (a check) and `parent` (one keyword).
- **`name_map_list?kind=keyword`** lists every keyword with how many bookmarks carry it (`scrayKeywordUses`). Notes come from both bookmark tables and are read the way the apps read them: by either spelling, with a hand-set keyword list replacing the words, `(none)` giving nothing, and blacklisted notes left out. A parent-note row whose keyword no longer appears on any note shows as orphaned.
- **Save rules** are applied to the whole set after each save, so the order rows arrive in doesn't matter: a parent note can't have a parent, and a keyword's parent must still be ticked Parent. Untick one and its children lose it; a row left with nothing is deleted. Keyword rows are lowercase and never mapped.
- **`name_map_get`** carries the `keyword` kind.

*manage-data: PARENT NOTES tab*, straight after BOOKMARK NOTES.
- **Columns:** Parent (tick), Keyword (bold when a parent, with "2 children"), Parent note (a dropdown of the current parent notes; disabled on a parent note), Bookmarks.
- **Keeping it consistent while you edit:** ticking a keyword clears its own parent; unticking one clears its children's links. The sheet redraws with focus back on the tick or dropdown.
- **Tiles:** KEYWORDS / PARENT NOTES / CHILDREN / ON THEIR OWN / ORPHANED / UNSAVED. The view buttons read CHILDREN / PARENTS on this sheet. No chip rows.

*Apps.*
- **The tree:** `scrayKeywordTree()` builds parent notes, child→parent and parent→children from the dictionary's keyword rows. It's read defensively: a parent's own parent, or a link to a keyword that isn't a parent, is ignored. It exposes `scrayKeywordIsParent`, `scrayKeywordParentOf` and `scrayKeywordChildren`.
- **Expanded keywords:** `scrayNoteKeywordsExpanded(note)` is a note's own keywords plus the parent notes they count as. Filtering and counting use it: the keyword test for videos and for Bookmarks view (so "sex" finds cowgirl bookmarks, and all-mode "sex + pov" finds "cowgirl pov"), the parent's count (which includes its children), and the NOTES search. The rail and the saved note still use the note's own keywords.
- **NOTES filter:**
  - Parent notes are bold, with their children straight after them.
  - Searching keeps a child visible when its parent is picked or matches the search.
  - A picked parent's pill is bold.
- **Bookmark modal:**
  - Parent notes are bold.
  - A picked parent note's children come straight after the picks.
  - A search that finds a parent note also lists its children after it.
  - Picking a child saves just the child.

**Tested.**
- **api.php:** `php -l` is clean. Under PHP's built-in server with a SQLite fixture:
  - The note `parent`→`keywords` move leaves studios untouched.
  - The keyword list and counts, with a blacklisted note excluded and a hand-set list used.
  - A save drops a parent note's own parent and a link to a non-parent. Unticking the parent clears and deletes its children's rows.
  - `name_map_get` carries the keyword kind.
- **manage-data** in headless Chromium, 21 checks:
  - **Notes sheet:** migrated lists show as automatic or set; there's a KEYWORDS column and tiles; the tab order is right; a save stores `keywords`.
  - **Parent notes sheet:** headers; the keyword list; ticking; the dropdown is disabled for parents and lists only parents; children and child counts; promoting a child clears its link; unticking removes it from options and clears children; PARENTS and CHILDREN views.
  - **Save and reload:** a save round-trips, the page reloads clean with no chip rows, and switching back to notes works.
- **Native's real index.html** in headless Chromium, with a cached dictionary holding parent notes, 17 checks:
  - The tree, including a link to a non-parent being ignored, and expanded keywords.
  - Parent bold, its count including its children, children following it, and the "Keywords" row label.
  - Mapped notes computed with the same radius, size and colour as the keyword chips.
  - Picking the parent: videos include its children, the notes under it show, the pill is bold, all-mode works, and Bookmarks view lists per bookmark.
  - A search for the parent brings its children.
  - Bookmark modal: parent first and bold, children after a pick and after a search hit, and a child saved on its own.
- **Regression:** the stage 2, 3 and 4 suites and the loose-search suite still pass with the renamed names (19 + 17 + 20 + 4). `node --check` passes on every JS file, and picker's changed functions match native's apart from comments.

**Worth knowing.**
- **Deploy browse first.** Until it's live, the apps find no keyword rows, so there are no parent notes, and hand-set note keywords only come through the old-name fallback.
- **One level only,** by design.
- **Keyword rows:** a keyword that's neither a parent nor a child has no row. It appears on the sheet only because a note uses it.

### picker 13.152 / native 13.150 — test: bookmark modal split into swipeable Add and Bookmarks pages
<!-- 2026-09-15T20:40Z -->

**picker** — `staging - 13.152`: `file-operations.js`, `VERSION`
**native** — `stg-native - 13.150`: `assets/web/file-operations.js`, `assets/web/VERSION`

Stage 4, the last of the notes-as-tags work, plus one tweak to stage 3 (13.151 / 13.149).

**Top 100.** With nothing typed, the parent-note rail now shows the 100 most-used parent notes instead of 30 (⚙️ `TOP_PARENTS`).

**Two pages** (Mac's spec):
- new and existing bookmarks go in separate panels of the same modal, switched by swiping left and right with the feel of iPhone home-screen pages;
- the Add bookmark panel is the modal as it was, minus the existing bookmarks;
- the existing-bookmarks panel is the modal as it was, minus the quick notes;
- Delete shows the existing bookmarks ready to delete, and the swap button next to the note field shows them ready to swap.

**Layout.** Only when there's a playhead, i.e. a new bookmark to add. Opened from a list menu there's nothing to add, so the modal is the single bookmark list as before.
- **Stays put:** the header, a two-tab strip ("Add bookmark" / "Bookmarks (n)", n = not marked for deleting) with a sliding underline, and the button row.
- **Page 0:** the time, search field, preview and parent-note rail.
- **Page 1:** a one-line hint, then the bookmark pills. The hint is grey by default ("Tap a time to jump to it, a note to edit it"), blue while swap is armed ("Tap a bookmark to move its note to 0:42") and red while delete is armed.
- **Height:** each page has one scroller, so the old 60/40 split (`sizeQuickNotes`) is gone. The panel is now a fixed height rather than a maximum, because the pages are laid out against it. Otherwise it would change height as you swipe between a long list and a short one. `applyKeyboardInset` still sets it, so the keyboard still shrinks it.

**The swipe.**
- **Mechanism:** pointer events on `#bmPager`. The pager and both scrollers are `touch-action: pan-y`, so a vertical drag still scrolls the page's list and only a horizontal one reaches the pager. The first 8px of travel decides the axis for the whole gesture.
- **Following the finger:** with no transition, it drags straight under your finger. Past either end it rubber-bands with iOS's resistance curve.
- **On release:** it turns the page past ⚙️ a third of the width or on ⚙️ a flick over 0.35 px/ms, otherwise it springs back. A pause at the end doesn't count as a flick.
- **Settle:** ⚙️ 320ms on an ease-out curve, shorter for a fast flick (down to 160ms), and the tab underline follows the drag. Tapping a tab turns the page too.
- **Taps and selection:** the click that ends a swipe is swallowed, so a swipe that starts on a pill neither jumps nor opens the editor.
- **Keyboard:** a swipe blurs the note field so the keyboard goes.
- **Desktop mouse fix, found in testing:** a mouse drag over the rail started a text selection, and dragging a selection is a native drag-and-drop, which fires `pointercancel` and snapped the page back after about 25px. The pager now turns off text selection while a horizontal drag is under way, and cancels `dragstart`.

**Buttons.**
- **Delete:** arms delete and slides to Bookmarks. Tapping pills marks them, and a second Delete disarms.
- **⇄:** arms swap and slides to Bookmarks. A tap on a bookmark moves its note to the playhead and saves, as before.
- **Add note:** slides back to Add bookmark and focuses the field.
- **Returning to Add bookmark:** swap and delete stand down, since they only mean something over the list. Pending deletions stay marked, and Save still applies them. After a swipe, the redraw that clears the mode waits until the list is off screen, so nothing jumps. From Add note it redraws first, because iOS only raises the keyboard for a focus made inside the tap.
- **Page survives redraws:** marking, editing a note, or picking a parent all redraw on the page you're on.

**Also fixed.** The rail's hand-drawn scroll thumb was measured before the panel had its height, so it could stay drawn with nothing to scroll. It showed as a grey sliver at the right edge of Add bookmark. It's re-measured once the panel is sized.

**Tested** in headless Chromium at 390×844 on native's real index.html, with a stubbed playhead and save.
- **Mouse, 20 checks:**
  - Both pages lay out with scrollers taller than 100px, and the tabs and counts are right. A tab slides the page.
  - A short slow drag springs back; a long drag turns the page; mid-drag past the end it resists and then springs back; a quick flick turns it.
  - Delete slides to the list with the red hint. Marking a pill keeps you on the list, updates Save (1) and Bookmarks (2), and swiping back disarms delete but keeps the mark.
  - Add note slides back and focuses the field, including while delete is armed.
  - Swap slides to the list with the blue hint and saves the moved note (with the pending delete applied). Picking and saving on Add bookmark still works.
  - A swipe that starts on a pill doesn't open its editor.
- **Real touch events (CDP):** a horizontal touch swipe turns the page, and a vertical touch drag scrolls an 80-bookmark list without moving the page.
- **No playhead:** the single list, with Delete working.
- **Regression:** stage 3's 17 checks still pass. No page errors. `node --check` on both files. Picker's modal code is the same as native's apart from comments.

**Worth checking on the phone.**
- **Feel:** the flick threshold, the snap time and the rubber band are all ⚙️ constants at the top of the pager block.
- **Existing note editor:** a tapped note still opens the old text field with the old dropdown of whole notes. Stage 4 didn't change it; say if it should become a parent-note picker too.

### picker 13.151 / native 13.149 — test: bookmark modal searches and picks parent notes
<!-- 2026-09-15T20:18Z -->

**picker** — `staging - 13.151`: `file-operations.js`, `randomiser.js`, `VERSION`
**native** — `stg-native - 13.149`: `assets/web/file-operations.js`, `assets/web/randomiser.js`, `assets/web/VERSION`

Stage 3 of the notes-as-tags work. The bookmark modal now works from parent notes. Mac's spec:
- the Add note field works as a search field;
- the quick-note rail becomes the results, replacing the autocomplete, and shows every parent note that matches at least one typed word, even partly;
- a typed word that isn't a parent yet is offered as a "+ word" pill at the start of the results;
- the note is built from the picked words, most popular first;
- saving means tapping the notes you want and then pressing Save, not saving on the first tap;
- with nothing typed, the rail still shows the top 30;
- the ▲▼ arrows go.

Stage 4 (Add bookmark / Existing bookmarks as two swipeable panels, with Delete and swap showing the existing ones) is still to come, so the existing bookmark list stays in this panel for now.

**Vocabulary** (`showBookmarksModal`).
- **`parentPop`** counts how many bookmarks carry each parent note, from the local catalogue via `scrayNoteParentCounts(true)`. That function gained an argument to count bookmarks regardless of which view is showing.
- **Top-up:** it's then topped up with the parents of every note `getTopBookmarkNotes(500)` returns, at a count of 0. A parent that only exists on notes this device doesn't hold is still offered, at the bottom.
- **`allNotes`** stays too, but only for the existing-bookmark row editor's autocomplete. That editor is untouched until stage 4.

**The new-bookmark row.** [time] [Search or add notes… ×] [⇄], then a preview line, then the results rail.
- **Nothing typed:** the rail shows the picked parents, then ⚙️ `TOP_PARENTS` = 30 most popular (ties A–Z).
- **Typing** (loose, like the NOTES filter): what's typed is split into words. Each word that isn't a parent yet gets a green dashed **+ word** pill first, tokenised with `scrayNoteAutoParents` so the offer matches what the saved note will file under. Then the picked parents, then **every** parent containing any typed word: exact matches, then prefix matches, then popularity.
- **Picking:** a tap toggles a pick (blue = picked), and picked pills stay in the rail whatever is typed. A tap made while typing hands focus back to the field, so the keyboard stays up. Return picks the first unpicked pill instead of saving; with nothing left to pick it still saves.
- **The note:** `builtNote()` joins the picks by popularity, most popular first, ties in tap order. A brand-new word has no count, so it goes last. The preview reads "Note: ts mish" as you go.
- **Saving:** Save stores the new bookmark with that note, and tapping the time saves straight away with whatever is picked (possibly nothing). If words are typed but nothing is picked, Save doesn't close; the preview turns red and says "Tap a note to pick it, then Save". With nothing typed and nothing picked, Save just applies deletions and edits, as before.
- **Clearing:** × clears the search and keeps the picks.
- **Existing bookmark tapped while typing:** its parent notes join the picks (previously its note text was appended to the field).
- **Removed:** the ▲▼ arrows (`AC_ARROW`, `#bmAcArrows`, `placeAcArrows`), the autocomplete on the new-note field, Add note's pick-the-highlighted-suggestion press, the append-to-typed-text path, and saving on a quick-note tap. Add note now just focuses the field. `scrayAttachNoteAutocomplete` is kept for the row editor and the bookmarks page.

**Tested** in headless Chromium at 390×844 on native's real index.html, with a stubbed catalogue, playhead and save. 17 checks:
- **At rest:** the rail shows parents by popularity; no arrows; the hint shows and × is hidden.
- **Search:** "mi ts" shows + mi, ts and mish.
- **Picking:** picks stay on and build "ts mish"; unpicking works; clearing leaves picks first, then the top parents.
- **Return:** picks the "+ cuddle" pill, which goes after ts, and doesn't save.
- **Save:** stores {42, "ts cuddle"}. Typed but unpicked shows the red hint and saves nothing.
- **Existing bookmark while typing:** "neck kiss" picks kiss and neck.
- **Time button:** saves the picks.
- **Plain Save:** adds nothing.
- No page errors. `node --check` passes on all four files. Picker's modal code is the same as native's apart from comments.

**Worth watching on the phone.**
- **Keyboard:** whether tapping a pill while typing flickers it (focus goes back inside the tap, so iOS should allow it).
- **"+ word" pills:** typing half a word always offers it as a new note, e.g. "+ ki" while typing "kiss". It only becomes a note if tapped.
- **Multi-word parents:** a parent set by hand with a space in it would split into separate words once saved into a note.

### picker 13.150 / native 13.148 — test: NOTE search matches any typed word
<!-- 2026-09-15T20:07Z -->

**picker** — `staging - 13.150`: `randomiser.js`, `VERSION`
**native** — `stg-native - 13.148`: `assets/web/randomiser.js`, `assets/web/VERSION`

Mac confirmed stage 2 (13.149 / 13.147) works well, and asked for a looser search box in the NOTES filter. "mish ts" matched nothing, because the whole string had to appear inside one parent note. It should bring up both "mish" and "ts".

**Change.** A new `termHit()` in `showTagCloudModal` splits what's typed on whitespace, and a value matches when it contains **any** of the words. Both places that search use it: the parent chips, and the mapped notes (a note shows when any of its parents matches). Picked parents still stay visible, and once a parent is picked the box still leaves the mapped notes alone. The other filter modals (tags, studios, performers) keep their whole-string search.

**Tested** in headless Chromium on native's real index.html with the stage 2 fixture:
- "lick  cow" (double space) shows the cowgirl and lick chips, plus the notes "cowgirl pov" and "neck lick".
- A single partial word ("nec") still works, and an unmatched word leaves only All.
- No page errors. `node --check` passes on both files.

### picker 13.149 / native 13.147 — test: parent notes filter videos and bookmarks
<!-- 2026-09-15T19:59Z -->

**picker** — `staging - 13.149`: `randomiser.js`, `scray-views.js`, `style.css`, `VERSION`
**native** — `stg-native - 13.147`: `assets/web/randomiser.js`, `assets/web/scray-views.js`, `assets/web/style.css`, `assets/web/VERSION`

Stage 2 of the notes-as-tags work. Mac tested 13.148 / 13.146 on the phone: tapping a parent note in the NOTES filter didn't count as selected, added no pill and didn't filter any videos, and the mapped notes had disappeared. Most of that was by design so far: parent chips only narrowed the note chips inside the modal, and stage 2 was always going to make them a real filter. The missing notes were a real layout bug. Hundreds of automatic parent chips sat in the modal's non-scrolling controls area and squeezed the notes grid to zero height.

**The filter.**
- **State:** `window.scrayNoteParentFilter` (a Set of parent notes) and `window.scrayNoteParentIntersect`.
- **Per bookmark, not per video.** `scrayNoteParentsPass(note)` checks one note: additive means any picked parent, intersect means all of them. With intersect on, "neck" and "kiss" find a bookmark that is both, not a video with a neck bookmark here and a kiss bookmark there. That's the reason a bookmark has several parents in the first place.
- **Its own switch.** Any/all has its own toggle rather than reusing `scrayTagIntersect`, because it asks about one bookmark, not about how the filter classes combine.
- **Videos (`getFilteredVideos`):** a video stays when one of its bookmarks passes the parent test. If mapped notes are picked too, it has to be that same bookmark (`scrayVideoPassesNoteParents`). The parent test is always ANDed with everything else, since parent notes are the way in, not one more term to OR with a studio. While parents are picked, mapped-note picks leave the facet include pass and only narrow the parent test. With no parents picked, mapped notes work exactly as before.
- **Bookmarks view (`scray-views.js`):** `passesNoteFilter` applies the parent test to each bookmark as well, so only the bookmarks that match are listed. Xb picks from them, because `scrayTotalFilterTerms` now counts parents.
- **Pills:** picked parents go in front of the mapped-note pills, in a deeper purple (`floating-tag-noteparent`). From two parents on, an outlined `∪ any parent` / `∩ all parents` pill flips the mode. Tapping a parent pill removes it.
- **Clearing:** the Clear-all pill, the big Clear and the cloud's "Clear notes" all empty parents and set any/all back to any.

**NOTES filter modal.**
- **Parent notes box:** the chips now scroll in a box of their own (⚙️ `max-height: 26vh`), with a **Mapped notes** label and grid underneath (⚙️ at least 18vh). The notes modal is also allowed to be taller (⚙️ 80vh against the other filters' 62vh).
- **Picking a parent** updates the filter, the pills and the list straight away. The title reads "Notes — 1 parent, 0 selected, 2 shown".
- **Mapped notes** show the notes under the picked parents, using the same test as the filter, intersect included. You can then tap them to narrow further.
- **Counts:** a parent's count is how many videos carry it, or how many bookmarks do in Bookmarks view (`scrayNoteParentCounts`). Before, it added up the notes' counts, so a video was counted once for each note it had under that parent.
- **Sort: count** applies to the parent chips too.
- **Parents: any ∪ / Parents: all ∩** toggle next to Tag intersect.
- **Search:** the box still narrows the parent chips. Once a parent is picked it stops narrowing the mapped notes, so those stay the notes under your picks.

**Tested** in headless Chromium at 390×844 on native's real index.html, with all its scripts and style.css, a cached dictionary and a stubbed five-video catalogue. 19 checks:
- **Counts:** each parent counted once per video; the (none) note gives no parent.
- **Layout:** the mapped notes grid is visible and taller than 100px.
- **Picking neck:** the chip turns on, the title and the pill appear, the mapped notes show "neck kiss" and "neck lick", and the videos narrow to the two with neck bookmarks.
- **neck + kiss:** in any mode, both videos, and the mode pill appears. In all mode, only the video whose one bookmark is "neck kiss", and the notes grid follows.
- **Mapped note on top:** picking "neck lick" narrows to its video.
- **Bookmarks view:** returns exactly that bookmark, then all three matching bookmarks once the note pick is cleared.
- **Search:** keeps picked chips and leaves the mapped notes as they were.
- **Clearing:** the All chip clears the filter, and so does Clear all.
- No page errors. `node --check` on all four JS files. picker's changes are the same code.

**Worth knowing.**
- **Bookmarks with no note** never match a parent pick.
- **Parent counts** are over the whole catalogue, like every other filter chip, so they don't shrink as other filters are added.
- **Next:** stage 3, the bookmark modal as a parent-note search with multi-select and Save.

### picker 13.148 / native 13.146 — test: NOTE cloud search narrows parent notes
<!-- 2026-09-15T19:41Z -->

**picker** — `staging - 13.148`: `randomiser.js`, `VERSION`
**native** — `stg-native - 13.146`: `assets/web/randomiser.js`, `assets/web/VERSION`

Mac: parent notes are the way into the NOTE filter now, so its search box should narrow them. Typing "bj" narrowed only the notes grid and left every parent chip showing. This sits between stage 1 (13.147 / 13.145) and stage 2.

**The change** (`showTagCloudModal`, NOTE cloud only; the other clouds are unchanged):
- **Placeholder:** the box now reads "Search parent notes…".
- **Parent chips:** `renderAttrRows` keeps only the chips whose name contains the term, and drops the unset chip while you're searching. A chip you've already picked stays visible, so undoing a pick never means clearing the box first. The search input redraws this row as you type.
- **Notes grid:** a note shows when one of its parents contains the term, not its own name. The notes below therefore always match the parent chips above. Picked and excluded notes still stay visible, as before.
- **Picking a parent** still narrows the notes grid to the notes under it. Stage 2 makes it choose the videos.

**Tested** in headless Chromium with each app's real `randomiser.js` and `scray-config.js`, a cached dictionary and stubbed counts, 6 checks each:
- The placeholder.
- "po" leaves only the pov chip and shows "oral pov" and "bj", which is mapped to "oral pov".
- A picked "kiss" chip stays visible while "ora" is typed.
- Clearing the box with kiss picked leaves only "neck kiss".
- `node --check` on both files.

### browse 13.62 / picker 13.147 / native 13.145 — test: automatic parent notes from note words
<!-- 2026-09-15T19:32Z -->

**browse** — `staging-browse - 13.62`: `api.php`, `manage-data.html`, `VERSION.txt`
**picker** — `staging - 13.147`: `scray-config.js`, `randomiser.js`, `VERSION`
**native** — `stg-native - 13.145`: `assets/web/scray-config.js`, `assets/web/randomiser.js`, `assets/web/VERSION`

Stage 1 of 4 in making bookmark notes work like tags. Mac is finding that a lot of bookmarks belong under several labels, so parent notes become the main way to label and filter them. The later stages are the NOTES filter led by parents, the bookmark modal as a parent-note search with multi-select, and a two-panel swipeable modal. This stage only changes how parents are worked out. Sits on top of picker 13.146 / native 13.144 (compact Jira modal), still awaiting its test.

**The rule.** By default a note's parent notes are the words of its display name: the mapped name, or the raw note where it isn't mapped.
- **Words:** lowercase. A hyphen or apostrophe inside a word keeps it one word ("neck-kiss", "doggy's"). One-letter words and a ⚙️ stopword list (a, and, the, of, on, with, from and so on) are dropped, and repeats count once.
- **Nothing stored:** an automatic parent is worked out wherever it's needed, so notes with no name_maps row get parents too.
- **Overrides (Mac's choices):** a parent list set by hand in manage-data **replaces** the automatic words. `(none)` means no parents at all, since an empty value already means automatic.
- **One rule, three copies:** `scrayNoteAutoParents()` in api.php, `autoParents()` in manage-data.html and `scrayNoteAutoParents()` in both apps' scray-config.js. The tokeniser is one regex copied between them. The stopword list lives only in api.php (`scrayNoteParentStopwords()`) and reaches both clients in `name_map_list` / `name_map_get`, and the dictionary rev includes it.

**api.php.**
- **Existing parents (Mac: keep as overrides).** `scrayMigrateNoteParentsAuto()` runs once, flagged `note_parents_auto_v1` in app_state, on the first `name_map_list` or `name_map_get`. A hand-set list that says exactly what the automatic rule now says (same words, any order or case) isn't really an override, so it's cleared. Everything else is kept. A row left with no mapping and no attributes is deleted, as `name_map_save` would. The flag stores how many were cleared.
- **Save:** `name_map_save` does the same for incoming rows, so a CSV import that restates the words saves as automatic and keeps following the name if the mapping changes.
- **`(none)`** listed beside real parents is dropped by `scrayCleanNameAttrs`, and the real parents win.

**manage-data.html (Parent note column).**
- **Automatic:** dashed, faded chips, one per word, which follow the mapped name live as you type it.
- **Set by hand:** a ✎, solid chips and an **auto** button that goes back to automatic. Its tooltip lists the words you'd get.
- **Editing an automatic cell** turns it into an override: removing a chip keeps the other words, and adding one (Enter, a pick, leaving the cell) keeps the words plus the new one. If your edit ends up matching the automatic words, the cell goes back to automatic by itself.
- **Removing the last parent** gives a red **none** chip; its × goes back to automatic. Backspace and Ctrl+D work the same way, since the cell's stored value is still what's on `data-multi`.
- **Counts:** tiles, chip counts, sort, search and suggestions all use a note's actual parents (automatic or set). There's a new **SET BY HAND** tile, and a **✎ set by hand** chip at the front of the Parent note row that narrows to the overrides.
- **Import hint:** an empty parent cell means automatic, and `(none)` means no parents.

**Apps (scray-config.js, randomiser.js; same code in both).**
- **`window.scrayNoteParents(note)`** returns a note's parents by either spelling: the hand-set list (lowercased, `(none)` giving an empty list), otherwise the automatic words of its mapped name. It's cached per note, and every dictionary adopt clears the cache. A cached dictionary from before this bump falls back to a built-in copy of the stopword list.
- **NOTE cloud:** `scrayCloudAttrValues` uses it for a note's Parent row, so that row now fills in for every note. What parent picks *do* in the cloud is unchanged here (they narrow the chip grid); stage 2 makes them choose the videos.

**Tested.**
- **Parsing:** `php -l` clean. PHP functions extracted and run: hyphen, apostrophe, unicode, numbers, stopwords, one-letter words and repeats; `(none)` beside a real parent dropped, on its own kept.
- **Migration** against SQLite: a matching override on an unmapped note deletes the row; one on a mapped note clears the parent and keeps the mapping; a different one is kept; a blacklist tick survives; studio rows are untouched; it runs once.
- **Real api.php** under PHP's built-in server (test paths, stub auth, minimal tables): `name_map_list` returns the stopwords and the sentinel. A save restating the auto words stores automatic, `(none)` is kept, and `(none) | Cowgirl` on a note mapped to "cowgirl" saves as automatic. `name_map_get` carries both new fields.
- **manage-data** in headless Chromium against that server, 18 checks:
  - Dashed auto chips, and the none and set-by-hand cells.
  - SET BY HAND tile and chip; chip counts use actual parents.
  - × on an auto chip gives an override; adding a word gives an override; removing it again goes back to auto.
  - Typing a mapped name updates the auto chips live.
  - The auto button; Backspace down to none; none's × back to auto; the set-by-hand narrowing.
  - Save, then the server state and the reloaded sheet match.
  - No page errors.
- **Both apps' scray-config.js** loaded with a cached dictionary: automatic words, a mapped note's words, an override by raw and by mapped spelling, `(none)`, and stopwords from the payload. `node --check` on all four JS files.

**Worth knowing.**
- **Stopwords:** edit `scrayNoteParentStopwords()` in api.php. The apps pick a change up at their next dictionary refresh, because it moves the rev.
- **The Parent row in the NOTE cloud** will be much longer now. Stage 2 is where it becomes the main filter.
- **Deploy browse first.** An old api.php sends no stopwords, so the apps fall back to their built-in copy, which is identical.

### picker 13.146 / native 13.144 — test: compact Jira modal
<!-- 2026-09-15T18:18Z -->

**picker** — `staging - 13.146`: `scray-bugreport.js`, `VERSION`
**native** — `stg-native - 13.144`: `assets/web/scray-bugreport.js`, `assets/web/VERSION`

Mac's ask: the Report an issue modal was far taller than it needed to be (about 930px on a phone) and the on-screen keyboard covered the lower half. Make it compact without losing anything.

**What changed.**
- **Type toggle:** Task is now the default. Bug / Task are small pills on the title line; the separate "Type" row is gone (the group keeps its aria-label).
- **Summary and What happened** are the same 38px height. What happened grows as you type, up to 160px, then scrolls, so long write-ups still fit. Placeholder shortened to one line.
- **Cancel / Send to Jira** now sit straight under What happened, full width side by side, so they're visible while typing. The status line sits under them and takes no space when empty.
- **Screenshot** is one line: label, "none", then Paste and Attach a photo side by side. The attached image preview is capped at 120px. Paste-box fallback for Native is unchanged.
- **Attach app state** is unticked by default.
- **Keyboard:** the overlay is pinned to the top and sized to `visualViewport` (resize and scroll), so the panel shrinks to the space above the keyboard and scrolls inside. The listeners are removed on close.

**Why it was so tall.** style.css's mobile query sets `button, select, input { width:100%; padding:12px; margin-bottom:10px }` and `label { font-size:1.1rem }`. That's why Paste was a full-width bar on its own row and the checkbox sat mid-row. Every control in the panel now sets its own width, margin and padding.

**Tested.** `node --check` on both copies. Headless Chromium at 390px against picker's style.css: panel 305px tall (was about 930), fields 38px each, Task selected, box unticked, no page errors. With the viewport cut to 470px and four lines typed, everything, buttons included, still fits.

**Worth knowing.** The markup and CSS are byte-identical between picker and native. If a future tweak makes the panel taller again, check the style.css mobile query first.

### browse 13.61 / picker 13.145 / native 13.143 — test: one changelog per repo, merged on changelog.html
<!-- 2026-09-15T17:59Z -->

**browse** — `staging-browse - 13.61`: `scray-changelog.md` (new; replaces `changelog.md`), `changelog-legacy.md` (new), `changelog.html`, `changelog-commits.php`, `VERSION.txt`
**picker** — `staging - 13.145`: `scray-changelog.md` (new), `CHANGELOG.md` (deleted), `index.php`, `bookmarks.php`, `basket-checkout.php`, `VERSION`
**native** — `stg-native - 13.143`: `scray-changelog.md` (new, repo root), `assets/web/CHANGELOG.md` (deleted), `assets/web/index.html`, `assets/web/bookmarks.html`, `assets/web/VERSION`

Mac's problem: the log lived in scray-browse, so every picker or native bump, and every "mark stable", left browse showing a modified file with no browse version change. Gitignoring it wasn't an option, because Mac uses `changelog.html`, and Hostinger only gets what's pushed. He chose one file per repo feeding the same page, and retiring the old pre-13.x `CHANGELOG.md` files into a legacy section at the bottom of the page.

**The files.**
- **Name and place:** each repo has `scray-changelog.md` at its root. The name isn't `changelog.md` because picker's root already held `CHANGELOG.md`, and on Windows the two names are the same file. Native's copy is at the repo root, not `assets/web`, so it never ships in the app.
- **Who writes what:** an entry goes into the repo it describes, in the same commit as that repo's VERSION bump. A joint entry goes into each repo it touched with the identical heading.
- **Date line:** straight under each heading, `<!-- YYYY-MM-DDTHH:MMZ -->` records when the entry was written, and the merged page sorts on it. Markdown viewers hide it.
- **The split:** the 65 existing entries were split by the apps in their headings: browse 7, picker 43, native 57. The "correction (no bump)" entry went to both picker and native, since it was about both. Bodies are byte-identical to the old file (checked).
- **Backfilled dates:** each old entry got the date of the first commit carrying its version, or of the commit it shipped in. Where that would have reordered entries, the date was nudged a minute at a time so the merged page reproduces the old file's order exactly. So a date on an old entry is right to within the batch it shipped in, not to the minute.
- **Convention:** the convention now lives at the top of browse's copy, and the page shows it as "About this log".

**`changelog-commits.php`.**
- **`?files=1`** returns each repo's `scray-changelog.md` from GitHub (contents API, raw), with the same caching as the commits: 120s TTL, a refresh no more often than every 20s, 60s retry when errors are cached, and the last good copy kept per repo, marked `stale`.
- **Found and fixed on the way: both lists now read each repo's working branch** (`CC_BRANCHES`: picker `new-sql-db-picker`, native `staging`, browse `staging`). The commit list was asking GitHub without a branch, which means the default branch, and that's `main` for picker and browse. Neither `main` has had 13.x work on it (picker's `main` last moved in July), so the commit chips could only ever have shown what `main` happened to hold.
- ⚙️ **When you switch branch**, update `CC_BRANCHES`, or both the entries and the commits go quiet.

**`changelog.html`.**
- **Merging:** reads the feed, merges the three files, shows a joint entry once (matched on the heading's app/version part), and sorts newest first.
  - If copies of a joint entry disagree, the one that says `stable` wins.
  - Each entry shows its date.
- **Header:** the old `changelog.md` link is replaced by picker / native / browse links to each file on GitHub.
- **Refresh:** ↻ asks GitHub for new entries as well as commits.
- **Fallback:** if the feed fails outright, the page shows browse's local copy on its own, with a warning saying so.
- **Legacy:** `changelog-legacy.md` holds picker's and native's old `CHANGELOG.md` verbatim (they differed: picker's has a 5.2.7 native never got), marked by `<!-- legacy: app -->` lines.
  - It's rendered below the "commits without an entry" block, one collapsible per app.
  - The app filter and search reach it; a test/stable filter hides it.

**The footer "Change Log" link** in picker (index, bookmarks, checkout) and native (index, bookmarks) used to open that app's `CHANGELOG.md` in a popup. It now opens `changelog.html`:
- **URL:** worked out from `SCRAY_SYNC.BROWSE_URL`, falling back to `https://macnguyen.com/scray/`.
- **Native:** opens it in the in-app browser through the page's existing `openInAppBrowser`.
- **Picker:** opens it in a new tab, or in the same tab where a web view has no tabs to give.
- **Removed:** the popup markup, its handlers, and the `marked` library, which nothing else used.

**Tested.**
- **PHP:** `changelog-commits.php` was run under PHP's built-in server against a fake GitHub that only answers the right branch. `?files=1` returned all three files with their branch URLs; commits were requested with `&sha=<branch>`.
- **Page:** `changelog.html` in headless Chromium, 24 checks:
  - 65 entries with the three-repo joint entry shown once and all three tags; the merged order is exactly the old file's; dates shown and the comment never rendered.
  - Intro from browse's file; header links; commit chips still attach.
  - The two legacy blocks at the very bottom, rendering their versions, filtered by app, hidden by status, found by search.
  - ↻ rebuilds without duplicating anything and re-asks GitHub for both lists.
  - No overflow at 390px; with GitHub down and no cache, browse's copy alone with the warning; no page errors.
- **Scripts:** all five footer scripts pass `node --check`.

**Worth knowing.**
- **Until these commits are pushed,** the live page's feed finds no `scray-changelog.md` on GitHub and falls back to browse's copy, once browse is deployed. Push all three.
- **Marking stable** now edits the file in the repo whose VERSION changed. For a joint entry confirmed for only some of its apps, the body says which.

### picker 13.143 / native 13.142 — test: FLS marker notes lifted, opaque and a step smaller
<!-- 2026-09-15T12:56Z -->

**picker** — `staging - 13.143`: `player.js`, `style.css`, `VERSION`
**native** — `stg-native - 13.142` (stable — confirmed by Mac): `assets/web/player.js`, `assets/web/style.css`, `assets/web/VERSION`

Mac asked for three changes to the note labels under the progress-bar markers in FLS: lift them so they aren't cut off at the bottom (a small clash with the marker dot is fine), make the text non-transparent, and make it one size smaller.

**Why the text was transparent.** Each label was a child of its marker, and the marker is inside `.permanent-progress-bar`. That bar is drawn at `--scray-progress-bar-opacity` (0.3), and an ancestor's opacity can't be undone by a child, so the labels were always at 30%. The progress timestamp hit the same thing in 13.49 / 13.46 and got out of it with a zero-height anchor above the bar.

**Fix: the same pattern, below the bar.**
- **The anchor:** `#permanentProgressBar` gains `.permanent-progress-label-anchor`, a full-width, zero-height flex item directly after the bar.
  - A negative top margin cancels the container's flex gap (4px, or 3px under 768px), so its top edge *is* the bar's bottom edge and the layout doesn't move.
  - It's as wide as the bar, so a label set to its marker's own `left%` lands under the dot. It's inside the rotated container, so FLS turns it with the bar as before.
- **`renderBookmarkMarkers`:** it appends labels there with the marker's `left` copied across. Since the labels are no longer removed along with their markers, it clears the anchor's labels explicitly. If a bar was built before the new markup, labels fall back to the old in-marker placement.
- **Hover rule removed:** the `:hover` scale-cancel rule (`scale(0.714)`) is gone. It only existed because the label was inside the scaled marker.
- **Stacking:** the anchor sits at z-index 59, above the bar's 50, so where a label touches its dot the text reads on top.
- **Picker's template** also has `.permanent-progress-buffered-label` above the bar. That's unaffected, since the new anchor goes after the bar.

**Numbers.**
- **Text size:** `calc(0.7rem - 3px)` → `calc(0.7rem - 4px)`, i.e. 8.2px → 7.2px. This applies wherever labels show (MPFS and FLS); MPB and the mini players still hide them.
- **Position everywhere:** `top: 4px` from the anchor, the same spot as before (1px past the dot).
- **FLS only:** `body.manual-rotate-landscape .bookmark-marker-label { top: 0 }`, which lifts it 4px to sit right against the bar. ⚙️ Both values are commented in style.css.

**Measured** in headless Chromium at 390×844, with a fixture of the FLS rotation, the bar at `bottom: 4px` and 70px insets as `applyManualRotationStyles` sets them. The "before" figures come from the committed native style.css with the label inside the marker.

```
                 gap to player edge   vs dot          text    opacity
FLS  before          1.8px            2px clear       8.2px   0.30
FLS  after           6.8px            2px overlap     7.2px   1.00   (both apps)
MPFS before         82.2px            2px clear       8.2px   0.30
MPFS after          83.2px            2px clear       7.2px   1.00   (both apps)
```

That 1.8px in FLS, with the text shadow hanging past it, is the cut-off Mac was seeing. The label stays centred under its dot in every case.

**Worth knowing.** The 2px overlap with the dot in FLS is deliberate, per Mac. If it reads badly on the phone, `top: 1px` or `2px` on the FLS rule is the knob.

### picker 13.142 / native 13.141 — test: bookmark notes shown in lowercase
<!-- 2026-09-15T12:30Z -->

**picker** — `staging - 13.142`: `scray-config.js`, `file-operations.js`, `style.css`, `VERSION`
**native** — `stg-native - 13.141`: `assets/web/scray-config.js`, `assets/web/file-operations.js`, `assets/web/style.css`, `assets/web/VERSION`

Mac asked for every bookmark note to show in lowercase in both players, quick-note buttons included.

**Why not manage-data.** Mac asked whether it would be easier to do it there. It wouldn't, and it wouldn't cover everything:
- The players only show a mapped name for notes that have a row, so every capitalised note would need a mapping written purely for display.
- A note typed later with capitals would show as typed until the mapping was added.
- The bookmark modal shows the stored text regardless of mappings.

**The change.**
- **One lookup:** `scrayNameMap.lookup` lowercases its result when `kind` is `note`, mapped or not. Every surface that *prints* a note already comes through it via `scrayMapName` or `scrayFoldNotes`: the progress-bar tooltip chips and marker labels, the NOTE cloud and its pills, the Note column in Bookmarks view, the loading-page bookmark line, and the quick-note rail with its autocomplete. So it's one line rather than a change at every call site. Studios keep their case.
- **The bookmark modal's note pills** (`.bm-note-btn`) show the stored text on purpose, because the modal is an editing surface (see the DISPLAY NAME MAPPING comment in `scray-config.js`). They get `text-transform: lowercase` in CSS, so it's display only. The edit field (`.bm-note-edit`) still shows and saves exactly what's stored.
- **The stash marker import list** in `file-operations.js` lowercases its note text for display.

**What does change in the data, as agreed.** Quick notes and the note autocomplete now offer lowercase text, so a bookmark saved from them stores the lowercase version. A note typed by hand is saved as typed. Nothing already stored is rewritten.

**Harmless knock-ons checked.**
- **Blacklist:** `scrayNoteBlacklisted` compares the note with its mapped name. That comparison now differs by case for an unmapped capitalised note, which just means one extra lookup of the same row, since attributes are keyed case-folded. Patterns are case-insensitive anyway.
- **Filters:** NOTE facet picks aren't persisted, so no saved filter holds an old capitalised name.

**Tested.** Both apps' `scray-config.js` and `style.css` were loaded in a headless page with a cached dictionary:
- An unmapped "Cowgirl POV" shows as "cowgirl pov", and "BJ" mapped to "Oral" shows as "oral".
- Studios keep their case.
- The quick-note vocabulary folds "Cowgirl / cowgirl / COWGIRL" to one "cowgirl", with blacklisted notes still gone.
- The Blacklist tick and patterns still apply.
- The modal pill computes `lowercase` while the edit field doesn't.
- No page errors.

### browse 13.60 / picker 13.141 / native 13.140 — stable: regex patterns in the note blacklist
<!-- 2026-09-15T12:05Z -->

**browse** — `staging-browse - 13.60`
Files: `api.php`, `manage-data.html`, `VERSION.txt`
**picker** — `staging - 13.141`: `scray-config.js`, `VERSION`
**native** — `stg-native - 13.140`: `assets/web/scray-config.js`, `assets/web/VERSION`

Sits on top of 13.59 / 13.140 / 13.139 (multiple parent notes), which is still awaiting its test.

Mac asked to blacklist notes by keyword or regex ("if it contains x"), added to the Blacklist chip row in manage-data.

**Semantics.**
- **Flavour and case:** a pattern is a JavaScript regular expression, tested case-insensitively. Plain text therefore already means "contains".
- **What it's tested against:** a note's raw spelling *and* the name it's mapped to, the same two spellings the Blacklist tick checks. A pattern written for the tidied name still catches every raw spelling mapped onto it.
- **Effect:** a match hides that note's bookmarks exactly as ticking Blacklist does. They're hidden, not deleted: removing the pattern brings them back at the next dictionary refresh.
- **Why JavaScript:** it's the only language that ever runs these. PHP stores them and nothing more, so there's no PCRE/JS mismatch to worry about.

**Storage (`api.php`).**
- **Where:** one JSON list in `app_state` under `note_blacklist_patterns`, not rows in `name_maps`. A pattern isn't a name: it has no raw spelling or usage count, and it would otherwise show up as a row in the very sheet it acts on.
- **`scrayNotePatterns($db)`** reads it.
- **`note_patterns_save`** (new, POST `{patterns: [...]}`) replaces the whole list. It trims, drops blanks and exact repeats, and enforces ⚙️ 200 characters per pattern and ⚙️ 100 patterns. The limits are literals in the case, not top-level consts: consts only exist once execution reaches them, which is the trap browse 13.56's rebuild.php fell into.
- **Device key refused explicitly** (403), like `rename_candidates`: the device key is public, and this decides what every app hides.
- **Delivery:** `name_map_get` carries `note_patterns`, so the apps get them in the dictionary they already fetch. `name_map_list` carries them for the note sheet. `scrayNameMapRev` includes them, so a pattern change moves the rev.

**Console (`manage-data.html`).** In the Blacklist row on BOOKMARK NOTES, after the tick chips, there's a PATTERNS label, one dashed red chip per pattern and a `+ pattern` chip.
- **Pattern chip:** shows `/pattern/` and how many notes it matches. Tapping it narrows the sheet to those notes; × removes the pattern after a confirm.
- **`+ pattern`:**
  - Prompts for the pattern and compiles it with the same flags the apps use. An invalid one is refused before anything is saved.
  - Shows how many notes it matches and the first eight **before** saving, because a loose pattern ("a") takes out almost everything.
- **Saving:** patterns save immediately through their own call and aren't row edits, so they never sit in EDITS waiting for Save. An unsaved row edit survives a pattern save.
- **Narrowing as "either":** the tick chips and pattern chips share one row, so picks from both sides combine as either. ALL clears both.
- **The `re` badge:** a note a pattern is already hiding gets a small `re` badge beside its Blacklist tick, with a tooltip naming the patterns. That way it doesn't look un-blacklisted just because the box is empty.
- **Invalid saved patterns:** a stored pattern that won't compile (only possible through a direct API call) shows struck through and marked "invalid", and the apps skip it.

**Apps (`scray-config.js`, identical in both).**
- **Compiling:** `scrayNameMap.adopt()` compiles the list once, dropping any pattern that won't compile with a console warning instead of throwing on every bookmark. It also keeps the list in the localStorage cache.
- **Matching:** `scrayNoteBlacklisted` checks the tick first as before, then the patterns against both spellings. Every surface already reads through it (`scrayVisibleBookmarks`, `scrayFoldNotes`), so nothing else changed.
- **Caching:** the answer is cached per note in `window.scrayNoteBlacklistCache`, since this runs for every bookmark on every draw. `adopt()` clears the cache whenever the patterns or the mappings could have changed. The cache is declared ahead of `scrayNameMap`, because that adopts its cached copy the moment it's built.

**Tested.**
- **`api.php`** (`php -l` clean): the real `note_patterns_save` case was run against SQLite.
  - Blanks and repeats are dropped, and slashes and unicode are kept.
  - The rev moves.
  - A device key gets 403; a non-array, a 201-character pattern and 101 patterns are all refused.
  - An empty list clears it.
- **manage-data** in headless Chromium, 17 checks:
  - No pattern chips on studios.
  - The saved pattern is shown with its count and badges its note (case-insensitive); tapping narrows; pattern + tick chip gives either; ALL clears both.
  - An invalid regex is refused, and the confirm shows a hit via the *mapped* name; cancel saves nothing, confirm saves the whole list.
  - An unsaved row edit survives; a duplicate isn't re-saved; × removes and the badge goes.
  - A stored invalid pattern renders as invalid; no page errors.
- **Both apps' `scray-config.js`** loaded in a page with a cached dictionary:
  - `^intro\b` hides "Intro scene" but not "the intro".
  - `oral$` hides "bj" and "BJ" through their mapping.
  - The tick still works, and a bad pattern is skipped.
  - `scrayVisibleBookmarks` leaves only the clean bookmark.
  - A refresh with no patterns un-hides the note and re-caches.

**Worth knowing.**
- Apps pick a pattern up within the 10-minute dictionary TTL, on next launch, or on returning to the foreground.
- Word boundaries need `\b`: `intro` alone also hides "introduction".

### browse 13.59 / picker 13.140 / native 13.139 — test: a bookmark note can have several parent notes
<!-- 2026-09-15T11:53Z -->

**browse** — `staging-browse - 13.59`
Files: `api.php`, `manage-data.html`, `scray-page-kit.js`, `VERSION.txt`
**picker** — `staging - 13.140`: `randomiser.js`, `VERSION`
**native** — `stg-native - 13.139`: `assets/web/randomiser.js`, `assets/web/VERSION`

Mac asked for a note to be able to belong to more than one parent, with the Parent note cell in manage-data letting him add more than one.

**How the list is stored.** It's still one string in `attrs_json`, joined with `" | "`. So there's no schema change, the CSV round trip keeps working, and EDITS, the save payload and `sameState()` still compare plain strings. The note's `parent` def in `scrayNameAttrDefs` gains `'multi' => true`. That flag travels to the console and the apps in `attr_defs` like the rest of the declaration, so only code that treats a value as *one thing* has to split it. Studio Parent is unchanged and stays single.
- **`api.php`:** a new `scraySplitMultiAttr()` splits on `|`, trims, drops empty items and folds case (first spelling wins). `scrayCleanNameAttrs` then rejoins with `" | "`, so there's one stored spelling. The 120-character limit now applies to each parent, not the joined string. `scrayNameAttrValues` suggests each parent on its own rather than the whole list.
- **Why the label stays "Parent note":** the console's tiles add an S to the label, and a plural label came out as "PARENT NOTESS".

**The cell (`manage-data.html`).** One chip per parent, each with ×, followed by an input for the next one. The input suggests existing parents, like the other attribute cells.
- **Adding:** a parent is added when you pick a suggestion, press Enter with text typed, or leave the cell with text typed. A parent is *not* added on every keystroke, because the input only ever holds the next item, not the cell's value. The page's `input` handler skips multi cells for that reason, and a `change` handler commits them.
- **Enter:** Enter with text adds it and keeps the focus there for another. An empty Enter still moves down a row like every other cell.
- **Removing:** Backspace in an empty input removes the last parent.
- **Repainting:** `commitMulti()` redraws only that cell and keeps the input alive. A full `render()` would lose focus and the open suggestion list between picks.
- **Escape goes back one step at a time:** first it closes the suggestion list, then it clears half-typed text, and only then does it revert the cell. The first test run showed why: Escape reverted the whole cell at once, so dismissing the dropdown threw away every parent added so far.
- **Everything that counts a value now splits it:** the attribute chip row (a note is counted under each of its parents, and picking either parent shows it), the tiles' distinct count, and the suggestion list.
- The import hint says a multi column takes values separated by `|`.

**Ctrl+D fill-down (`scray-page-kit.js`).** The grid reads a multi cell's value from `data-multi`, not from the half-typed input. `put()` is also how a picked suggestion lands, where it should *add* one parent. Fill-down is a copy, so it goes through a new `putWhole()` that replaces the whole list.

**Apps (`randomiser.js`, identical in both).** `scrayCloudAttrValues(kind, name, def)` returns every parent a cloud value falls under: a list of one for ordinary attributes, the split list for multi ones. The NOTE cloud's Parent row counts a note under each of its parents, and narrowing to a parent keeps any note that has it.

**Tested.**
- **`php -l`:** clean. `scrayCleanNameAttrs` was also run directly:
  - `" Kiss |kiss| Oral ||  POV "` becomes `Kiss | Oral | POV`.
  - All-empty becomes unset.
  - A 121-character parent is refused on save.
  - Studio `A | B` is left untouched.
- **manage-data in headless Chromium, against a mocked API:** 28 checks.
  - Chips render; a picked suggestion, a typed parent + Enter and a parent typed then left all add; a case duplicate is folded.
  - A new parent joins the suggestions; Backspace and × remove.
  - Removing and re-adding the same parent isn't counted as an edit; Escape brings back the saved list.
  - Ctrl+D copies the whole list; arrow keys still move between cells.
  - The save payload is right, the chip filter works as "either parent", and CSV export gives `Kiss | Oral`.
  - No page errors.
- **The cloud functions** were pulled out of `randomiser.js` and run: "neck kiss" with `Kiss | Foreplay` counts under both, and picking Foreplay keeps it.

**Worth knowing.**
- Apps cache the dictionary for 10 minutes. A copy cached before this change has no `multi` flag, so a multi-parent note shows up as one "Kiss | Foreplay" chip until the next refresh.
- The cloud's Parent tallies now add up to more than the number of notes, since a note is counted under each parent.
- A parent name can't contain `|`.

### correction (no bump) — the test files listed in 13.137–13.139 were removed
<!-- 2026-09-14T21:36Z -->

Not a version bump — no app code changed. This is a correction to the record.

#### What happened

The 13.137, 13.138 and 13.139 entries each list a `*.test.js` file among their
changed files, as committed to `scray-native/assets/web/` (and one to
`scray-picker/`). Those files have been deleted. The entries' descriptions of
what each suite proved still stand as a record of how the change was verified;
the files themselves are gone.

#### Why

`assets/web/` is the folder Expo bundles into the iOS app. Ten Playwright suites
(~90KB) had accumulated there one commit at a time across the session, so test
code was shipping inside the app and being served beside the web app. Neither
repo lists Playwright as a dependency — native's devDependencies are
`@types/react` and `typescript` — so the suites could not be run from the repo at
all; they only ever ran in the cloud workspace where Playwright is installed.
Nothing in either `.gitignore` excluded them, so they were tracked.

Picker had received exactly one of the ten (`fls-typing.test.js`), as a passenger
in the 13.139 batch, so the two repos were not even consistently wrong.

Mac spotted it. It is worth naming the failure mode rather than just the fix:
each file was a reasonable addition on its own, and no single step looked wrong.
Nobody looked at the folder as a whole until eleven files were in it. A
per-commit check ("does this file belong in the bundle?") would have caught it at
the first one.

#### Files removed

`scray-native/assets/web/`: `col-panel.test.js`, `dock-fusion.test.js`,
`dock-placement.test.js`, `fls-filter.test.js`, `fls-guides.test.js`,
`fls-typing.test.js`, `mpfs-rows.test.js`, `peek.test.js`,
`player-controls.test.js`, `x-stack.test.js`

`scray-picker/`: `fls-typing.test.js`

#### What this costs

The regression cover described in 13.121–13.139 is no longer runnable from the
repos. Notably lost:

- `dock-fusion` (64 assertions) — the fused row's geometry, the flex freeze, the
  button box at every breakpoint. This is the suite that caught VID/BM and 🌐
  still being 38px tall during the picker port.
- `fls-typing` — that the FLS surface compensates for the keyboard viewport gap.
- `peek` / `col-panel` — that the dock is absent in fullscreen but whole during a
  peek, and that the pills bar goes home while peeking.

What the suites established is written down in the changelog entries, including
the measured numbers, so the reasoning survives. Re-running any of it means
rebuilding the fixture.

#### If they are ever wanted back

They belong in a `tests/` directory at each repo root — outside `assets/web/`, so
Expo does not bundle them — with `playwright` as a devDependency and an npm
script. They read `SCRAY_WEB` to choose which app to measure, so one copy serves
both repos.

### native 13.138 — test: FLS surface stays put while typing in the search pill
<!-- 2026-09-14T21:34Z -->

**native** — `stg-native - 13.138`
Files: `assets/web/player.js`, `assets/web/randomiser.js` (comment only),
`assets/web/VERSION`, `assets/web/fls-typing.test.js` (new)

#### Symptom

In FLS, tapping the search pill and typing made the whole view look like it
jumped upward.

#### What it was not

Two plausible suspects were measured and cleared before the real one was found.

**The title block growing.** As soon as the term starts matching, the bar renders
the matching tag pills, so the title gains a row. The title is anchored at
`top: 50%` with `translate(-50%, -50%)`, which grows a box about its *centre* —
so it looked like the obvious culprit. It isn't: the `ResizeObserver` on
`applyFlsTitleInset` re-pins it, and measurement shows the title's top edge holds
at 93px while the box grows +19px *downward*.

**The search pill moving.** It does move — down 19px — but that is by design and
in the wrong direction for this complaint. `ensureSearchPill()` gives the pill
`order: 99` so it renders last: matching pills land *above* it, which is the
point (you see what your term matched, and the box you're typing in stays nearest
the keyboard). The pill steps down by exactly the row that appeared over it.

Neither moves anything up, and neither moves the video, controls or circles at
all. Whatever the cause was, it had to move **everything at once**.

#### What it actually was

`#inlineVideoContainer` in FLS is `position: fixed`, so it is laid out against the
**layout** viewport.

When iOS opens the keyboard it does not resize that viewport. It **scrolls the
page** to lift the focused input clear of the keyboard, so the visual viewport
slides down the document while the layout viewport stays where it is. Everything
`fixed` therefore appears to travel up by the gap — video, title, pill, controls,
circles, together. Nothing moved relative to anything else, which is exactly why
it read as "the whole thing jumped" rather than as one element misplacing itself.

This is a known problem in this codebase, already solved once. 13.82 hit it with
`#floatingTagPillsBar` ("a bar pinned to `top:0` ends up above what you can
actually see") and introduced `--pills-top-offset`, the measured gap between the
two viewports, published by `adjustForKeyboard()` in `randomiser.js` on every
`visualViewport` resize and scroll. The fullscreen surface was simply never given
it.

#### The fix

One line — the gap added back as a translate, outermost in the container
transform:

```js
transform: 'translateY(var(--pills-top-offset, 0px)) ' +
    (flsPeekActive ? `translateX(${flsPeekShiftPx()}px) ` : '') +
    'translate(-50%, -50%) rotate(90deg)',
```

Three things about that shape are load-bearing:

- **It goes first.** Transform functions compose outermost-first, so ahead of the
  `rotate(90deg)` this is a plain screen-space nudge, in the same space the gap
  was measured in. Behind the rotate it would be 120px sideways.
- **It is a `var()`, not a number.** Custom properties resolve at computed-value
  time, so the inline transform re-evaluates on every `visualViewport` event
  without re-running `applyManualRotationStyles()`. No re-measure, no layout pass,
  nothing to get out of step — and it survives every re-apply for free.
- **It is a difference, not a coordinate.** 13.119's rule was: never write a
  coordinate measured in the visual viewport onto an element laid out against the
  layout viewport. This writes the *gap between* the two, which is the safe form
  of the same quantity.

`randomiser.js` gets a comment only, at the point `--pills-top-offset` is set,
warning that `player.js` now reads it too. The property name is historical — it is
the viewport gap, not a pills-bar offset — but renaming it would diverge
`randomiser.js` from picker's copy for no functional gain, so the name stays and
the comment carries the meaning.

#### Test

New suite `fls-typing.test.js`. It reproduces FLS as `applyManualRotationStyles()
` builds it — including `applyFlsTitleInset` and its `ResizeObserver` — and asserts
against `player.js` that the fixture still matches the source it claims to
reproduce.

```
=== typing: a matching term renders tag pills into the bar ===
  layer                 top before -> after   moved   height +/-
  container                 0 ->     0        0          0
  video wrapper             3 ->     3        0          0
  title block              93 ->    93        0        +19
  video name               95 ->    95        0          0
  search pill             114 ->   133      +19          0
  player controls          40 ->    40        0          0
  circle row              198 ->   198        0          0

=== the keyboard gap: iOS scrolls the page under the fixed surface ===
  container                 0 ->   120     +120     (…and every layer with it)
  PASS  the fixed surface compensates for the gap, so it stays put on screen
```

Headless can't open a keyboard, so the gap half drives `--pills-top-offset`
directly and checks that the surface answers it. That is the mechanism, not the
iOS behaviour itself — the device test is the real confirmation.

##### One thing worth recording about writing this test

The first version hardcoded the transform string in the fixture. Run against the
previous `player.js` it reported **one** failure — the source-drift check — while
the behavioural assertion still passed, because the fixture was compensating for
the gap all by itself. It was proving a fact about the fixture, not about the app.

The fixture now **scrapes the transform out of `player.js`** and applies that.
Re-run against the previous build, the behavioural assertion fails as it should:

```
--- against the previous player.js (should FAIL) ---
  container                 0 ->     0        0
  FAIL  the fixed surface compensates for the gap, so it stays put on screen
        container moved 0px for a 120px gap (want +120)
```

The general lesson, and it applies to several of the fixtures in this repo: if a
test restates a value the code owns, it can only ever test itself. Scrape it or
assert on it — never retype it.

Full set re-run green: `fls-typing`, `player-controls`, `peek`, `col-panel`,
`dock-placement`, `dock-fusion` (64/64), `x-stack`, `fls-guides`, `fls-filter`.

#### Not done, and why

**MPFS has the same exposure.** `body.fullscreen-active #inlineVideoContainer` is
`position: fixed; inset: 0` in both modes, so the same scroll lifts the same
surface. It is not fixed here for one reason: in MPFS the container carries no
transform at all, and giving it one — even `translateY(0px)` — makes it a
containing block for any `position: fixed` descendant, which changes behaviour
permanently for a problem that only exists while the keyboard is up. Doable by
scoping the rule to `.keyboard-active`, but it wants its own check of what is
fixed inside the player in MPFS. Awaiting a decision.

**Picker.** Not applied. Picker's `player.js` predates 13.121 and has neither the
peek branch nor this transform.

### native 13.137 — test: `>` added before `M>` in the MPFS player controls
<!-- 2026-09-14T21:33Z -->

**native** — `stg-native - 13.137`
Files: `assets/web/style.css`, `assets/web/VERSION`, `assets/web/player-controls.test.js` (new)

#### What changed

The play-next button (`>`, `.plyr-play-next`) now appears in the MPFS player
control bar, in the slot immediately before `M>` (`.plyr-basket-quick`).

MPFS control bar, before → after:

```
P            M>  R  F
P   >        M>  R  F
```

#### Why it was a one-line change

`>` already existed and was already built in the right place. `attachPlayNextButton()`
runs before `attachBasketQuickButton()` at all three call sites, and both insert
before `[data-plyr="fullscreen"]`, so `>` lands ahead of `M>` in the DOM with no
flex `order` to undo it. The button was simply being hidden.

It was hidden by a three-way portrait rule written back when "portrait" meant MPB:

```css
body:not(.manual-rotate-landscape) .plyr-random-video,
body:not(.manual-rotate-landscape) .plyr-history-sequence,
body:not(.manual-rotate-landscape) .plyr-play-next { display: none !important; }
```

MPFS is portrait too, so it inherited a hide meant for the mini-player.

#### The fix, and the precedent it followed

`M>` had already hit exactly this problem and been solved. Its hide reads:

```css
body:not(.manual-rotate-landscape):not(.portrait-fullscreen) .plyr-basket-quick {
    display: none !important;
}
```

So `.plyr-play-next` was lifted out of the three-way rule and given the same
shape — its hide narrowed with `:not(.portrait-fullscreen)`, rather than adding
an un-hide override somewhere else.

This matters more than it looks. Narrowing keeps **one rule per button saying
where that button is hidden**. An override would have meant two rules in
disagreement, and the next person to change MPFS visibility would have to find
both. That is the same failure mode logged in 13.136 — a state excluded from
only *some* of the rules describing it — approached from the other side: don't
create the second rule in the first place.

`.plyr-random-video` and `.plyr-history-sequence` stay in the original two-way
rule; they are still MPB-and-MPFS-hidden, FLS-only.

#### Test

New suite `player-controls.test.js`, measuring against the real `style.css` and
`player.js` in headless Chromium:

```
=== MPB ===   shown: P R F
=== MPFS ===  shown: P > M> R F
  PASS  > is shown in MPFS
  PASS  M> is shown in MPFS
  PASS  > comes immediately before M>              > at 1, M> at 2
  PASS  X and H< stay hidden in MPFS, as before
=== FLS ===   shown: P X Xb H< > M> F
  PASS  > is still shown in FLS
  PASS  and still immediately before M>            > at 4, M> at 5
  PASS  attachPlayNextButton runs before attachBasketQuickButton
  PASS  both insert before the fullscreen control, so call order is DOM order
```

Proven to catch the regression: run against the previous `style.css` it fails on
the two MPFS assertions and passes everything else.

```
--- against the previous style.css (should FAIL) ---
  shown: P M> R F
  FAIL  > is shown in MPFS
  FAIL  > comes immediately before M>              > at -1, M> at 1
2 FAILED
```

The suite also asserts the *order* mechanism rather than just the outcome, so if
someone later reorders the `attach*` call sites the test says which cause moved,
not merely that the row looks wrong.

Full set re-run green: `dock-fusion` (64/64), `x-stack`, `fls-guides`,
`fls-filter`, `dock-placement`, `peek`, `col-panel`, `player-controls`.

#### Note

`mpfs-rows.js` no longer runs — it measures the anchor dock in MPFS, and 13.134
removed the dock from MPFS entirely. It is dead along with the orange row guide
(now reachable only during FLS peek) and the dormant `--mpfs-row-1` token. All
three are deletion candidates awaiting a decision.

#### Picker

Not applied. Picker's `player.js`/`style.css` still predate 13.121, so the MPFS
control bar there does not have the structure this change targets.

### native 13.136 — test: the anchor buttons stop auto-hiding while peeking
<!-- 2026-09-14T21:32Z -->

Mac: they keep disappearing while peeking. They did, and 13.134 caused it.

**The video keeps playing behind a peek.** So Plyr still idles its controls away
after its usual dwell, `syncStateClasses` still relays `is-controls-hidden` onto
the overlay root, and the rule that fades the dock to nothing in fullscreen still
matched. A few seconds after the up-swipe, the row Mac had just asked to have
back went to `opacity: 0`.

13.134 put `:not(.is-peek)` on the `FS_ANCHOR_OPACITY` rule — the one that dims
the dock to 0.45 — and **missed the pair below it**, which is the one that
actually hides it. Both carry the exclusion now.

**The same miss in the tap handler.** `dockIsBlind()` tested
`is-fs && is-controls-hidden && collapsed`, all true during a peek with the
controls idle — so a tap on 🔍 or R would have raised the player's controls
instead of pressing the button, which is 13.123's blind-row behaviour firing in
a state that is not blind at all. It excludes peek too.

**The test was the real failure.** 13.134's peek case checked opacity with the
controls *up* — the one situation that already worked — and never entered the
state that breaks. That is not a corner case: it is what happens a few seconds
after you swipe up, every time.

`peek.test.js` now idles the controls during peek and asserts the dock stays at
full opacity, stays present, keeps every child tappable, and that a tap presses
the button rather than waking the player. It also asserts the fullscreen side is
unchanged — there is no dock there to fade.

**Verified against the previous build**, which is the part that makes it worth
having: run against 13.135's `disguise.js` the new assertions fail with
`opacity 0` and the tap raising controls; against 13.136 they pass. A test for a
regression that was never seen to fail is only a guess that it would have.

**Pattern worth naming.** This is the third time in this series that a state was
excluded from *some* of the rules that describe it — 13.123 (the strip's buttons
kept `pointer-events: auto` when the container was turned off), 13.130 (the X
stack left the dock and left 13.123's rule with it), and now 13.134. Each time
the fix was correct and incomplete, because the behaviour is spread across a
group of rules and only one was edited. When `is-peek` or anything like it is
added next, the check is `grep` for every rule carrying the class it modifies,
not just the one the symptom pointed at.

### native 13.135 — test: peek gets the real filter bar back, and COL opens full size above the row
<!-- 2026-09-14T21:31Z -->

Two from Mac on 13.134's peek.

**1. The filter bar was not the page's, because the pills were not on the page.**
`scrayStripBelongsInTitle()` tested `manual-rotate-landscape || portrait-fullscreen`
— both of which are still set while peeking — so `syncNowPlayingStripPlacement`
kept holding `#floatingTagPillsBar` in `.fls-video-title`, where the 13.62 rules
draw it compact, centred and `pointer-events: none`. It could not look like the
full-width pink bar because it was not where that bar lives.

One line: peeking returns false. `scrayReturnNowPlayingStrip` and
`scrayReturnTagPills` already know how to send both home, and the placement runs
off the body-class observer, so entering and leaving peek moves them on its own.
The 13.132/13.133 title-bar rules stop applying at the same moment, because every
one of them is scoped `.fls-video-title > #floatingTagPillsBar`.

**2. COL opened squished, and the number says how badly.** Measured at 402px: the
panel asked for its 62vw — 249px — and got **107**. The dock is a flex row, and
since 13.121 the scrolling strip has been in it at `flex: 1 1 auto`, so an open
COL was a flex item competing with the strip for width and losing most of it. It
was never squished before the fusion because the dock held two buttons and
nothing that wanted width.

Open, it now leaves the flow: `position: absolute`, anchored to the dock's own
bottom-right, so the handle stays where the COL button was and the panel simply
grows upward out of it. Desktop anchors by the top instead, the dock being up
there and a panel growing upward leaving the screen.

**And the row keeps the space it left behind.** Out of flow, COL stops being a
flex item — so the strip grew into the slot and 🔍, VID and 🌐 all slid right,
then slid back on close. A jiggle on every open. `renderOpen()` measures the
collapsed button *before* it leaves the flow and writes the reservation as the
dock's `padding-right`.

**Measured rather than expressed in tokens, and that mattered:** a
`calc(var(--scray-btn-min-w) + 6px)` reservation was 4px out on desktop.
`min-width` is a floor, not the width — the mode tag's text decides the rest, so
the collapsed box differs by breakpoint. The test caught it as a 4px strip shift.

**Tested** by a new `col-panel.test.js` at phone and desktop widths. The width
assertion is the interesting one: "it hits its max-width" would be wrong, since
`max-width` is a cap and the panel is content-sized. What matters is that the
strip no longer decides it — so the panel is opened a second time with the strip
removed from the DOM and the two widths must match. They do: 200px with the row
and 200px without it on a phone, 229/229 on desktop. Plus: out of flow, growing
upward on a phone and downward on desktop, its bottom edge where the COL button
was, and nothing in the row moving by more than a pixel. The peek half is checked
by driving `scrayStripBelongsInTitle` through all four states — idle, MPFS, FLS,
and FLS+peek — with the function extracted from player.js rather than
reimplemented. All six other suites unchanged.

### native 13.134 — test: no anchor buttons over the picture, and peek gives the page back whole
<!-- 2026-09-14T21:30Z -->

Mac, drastically simplifying after 13.132 and 13.133: the anchor buttons are not
wanted in fullscreen at all. Two rules and one relayed class do it.

**Nothing in FLS or MPFS.** 13.132 cut the row down to the frozen three and
13.133 moved those out of the way; the answer was that they should not be over
the picture in the first place. Everything they did is reachable from the circles
— which 13.132 put back — and the one thing that was not, the filter, is
reachable by peeking.

**Except while peeking.** An up-swipe in FLS slides the rotated player aside and
`body.fls-peek` hands the page back — that is what the `:not(.fls-peek)` on every
page-element hide in style.css has always been for. In that state the page is
ordinary, so the dock is ordinary too: the whole row, in its normal place, at full
opacity, with the same buttons it shows when nothing is playing, and the BM/VID
switch back with them. Peek is relayed onto the overlay root as `.is-peek`, and
every dock rule that means "over the picture" excludes it. `applyRowState` treats
peeking as not-playing for the same reason.

**The filter follows.** 🔍 checked for `manual-rotate-landscape` or
`portrait-fullscreen` and opened the fullscreen path; both are still set while
peeking, so it now excludes peek and falls through to the ordinary page paths —
the filter behaves exactly as it does when nothing is playing, which is what was
asked for.

**Two things retired themselves, which is the good kind of change.**

- **The orange row guide.** It marks the anchor row, and there is no anchor row in
  fullscreen any more. `placeRowGuides` drops a line whose target has no box, and
  a `display: none` dock has none — so it needed no code at all. It still appears,
  correctly, while peeking.
- **13.123's blind-row contract.** "Nothing inside the faded row is tappable, and
  a tap wakes it" was about a row that was there but invisible. There is no row,
  so there is nothing to press blind. The assertion is replaced by the simpler
  fact that none of it is rendered.

**⚠️ Worth a decision: the row guide is now nearly dead.** 13.125–13.128 built it
so Mac could see where to tap in fullscreen. With no anchor row in fullscreen it
can only ever appear during FLS peek, where the page is visible anyway. It is
left in because removing a feature is Mac's call, not mine — but it is a
candidate for deletion, along with `--mpfs-row-1` (now dormant: nothing reads the
MPFS dock offset, and it is kept only so the anchors land on the documented row
if they are ever wanted back).

**Tested** by a new `peek.test.js` across four states: nothing playing (dock, row,
eight buttons, BM switch, full opacity), MPFS and FLS (no dock, no row, no search
button, no guide), FLS peek (all of it back, eight buttons, full opacity rather
than the fullscreen fade), and back out of peek (gone again). Plus a source check
that 🔍 treats peek as not-fullscreen.

**Four suites were updated to the new contract, not repaired** — and that is now
worth watching as a habit. `dock-fusion` lost the blind-row section, `fls-guides`
asserts no line where it asserted a line and gained a peek case, `dock-placement`
lost its placement half entirely to `peek.test.js`, and `x-stack`'s guard check
was rewritten to strip comments and assert on the code: a character-window regex
had broken twice as the explanatory comments between its terms grew, which is the
comments being long rather than the guard being wrong.

**A repeat mistake caught in my own fixture:** `peek.test.js` first asked whether
🔍 was visible by reading its own `display`, which says nothing when an ancestor
is hidden. That is 13.130's lesson, made again in the same session. It walks
ancestors now, as `dock-fusion` already did.

### native 13.133 — test: the frozen three move out of the way, and the filter field stops drifting
<!-- 2026-09-14T21:29Z -->

**Where the three sit, measured rather than guessed.** At 402×812:

```
  MPFS   title 133..269 x 28..67       controls full width x 665..724
         circles 348..382 x 612..656   rail full width x 768..780
         -> the dock sat 725..755: one pixel under the controls, thirteen over
            the rail. Which is why 13.132's +8px never felt like enough - there
            was nowhere to go inside that gap.

  FLS    the picture is rotated, so the title is the RIGHT edge (353..392 x
         449..585) and the controls are the LEFT (78..141 x 489..811).
```

So they leave the gap entirely. MPFS puts them **above the circle row**, still
right-aligned — the right-hand column now reads dock, circles, controls, rail
from the top down. FLS puts them **top-right**, the one corner the rotated
picture is not using. Both **upright**, per Mac, not rotated with the content.
With the row gone the dock no longer needs the width, so it shrink-wraps.

The MPFS offset is expressed off `--mpfs-row-3` plus the circle row's height plus
the stack's own 9px of air, so moving the circles moves this with them — the one
thing it has to stay clear of.

**A round trip worth recording:** the first attempt put the MPFS position in a
rule of its own and the dock did not move at all. The phone media query already
carries `.is-mpfs` and `.is-mpfs.is-native` variants, and a block outside it
loses to both on order *and* specificity. It is set at the constant they both
read instead.

**The first circle is mode-dependent**: X^n in MPFS, X^T in FLS. One slot, because
there is one circle group and both modes share it — `scrayRandomCircleMode()`
relabels it from `syncNowPlayingStripPlacement`, which already runs on every body
class change, so the swap rides the signal the rest of the fullscreen furniture
moves on. It clicks the real corner button rather than reaching for the play
function; a `display: none` button still fires its handler on `.click()`, which is
what makes that work while the row is hidden in fullscreen.

**The filter field: three wrong fixes before the right one.** Mac: it appears
perfectly, then disappears the moment he types.

- **Cause 1, the disappearance.** `.floating-tag-search-wrap.is-focused` goes
  `position: absolute`, which its own comment justifies by `#floatingTagPillsBar`
  being `position: fixed`. In the title it is not — 13.62 sets it `static` — so
  the field resolved against whatever was positioned further up, inside the
  player, and in FLS inside the *rotated* container. Made `static`.
- **Cause 2, found by fixing cause 1.** The focused state also takes the input to
  2rem, the magnifier to 1.4rem and the x to 1.9rem, all sized for a full-width
  bar at the top of the screen. In a narrow title strip that reflowed the row and
  carried the field 122px down it. The focused pieces now keep the title's own
  compact metrics.
- **Cause 3, and the real one.** Even compact, focusing *always* changes the
  field's size — the clear x appears — and the title bar centres its children, so
  any width change slides it sideways. Trying to stop the growth failed (a flex
  basis of 0 does not stop an input contributing its intrinsic 20-character width
  to its container's max-content), and left-aligning the bar while focused made
  it worse: that is itself a position change, and moved it 112px.

  The answer is to **spend the movement once**. The field snaps to the full width
  of the bar on focus and is then already as wide as it can get, so nothing typed
  after that can move it. Sized to content instead, every keystroke re-centres the
  row — which is exactly the drift being reported.

**And the test was aimed at the wrong moment.** It measured the focus transition,
when the complaint was about typing. It now types four terms of different lengths
— rewriting the inline width the way `sizeSearchPill` does — and asserts the field
does not move: 0px across all four, in both modes.

**Sixth time for the backticks**, same JS template literal as 13.115, 13.120,
13.121, 13.126 and 13.129. The gate caught it again. At six, the comment style is
the fault rather than the attention — that CSS block should stop being a template
literal.

**A fixture lie caught on the way:** the circle-glyph check called
`window.scrayRandomCircleMode()`, which the fixture never loads — so it asserted
nothing, and the MPFS case "passed" because the fixture's own default glyph
happened to be `Xn`. The function is extracted from player.js and injected now,
and the FLS case fails without it.

**Tested** in both modes: the dock right-aligned and clear of controls, circles,
rail and title; above the circles in MPFS; at the top and untransformed in FLS;
the circle reading Xn/Xt with the swap wired to the body-class signal; and the
filter field static, pinned to the bar, and immobile across four terms of typing.
All five other suites unchanged.

### native 13.132 — test: the row goes back to plain buttons, fullscreen goes down to three
<!-- 2026-09-14T21:28Z -->

Mac, after living with 13.129–13.131: some of it back, some of it changed. Treated
as one bump rather than a series of reverts, because the pieces only make sense
together.

**Nothing playing.** The consolidated X is gone. X^n, Xb and X^T are ordinary
buttons in the row again, after H:

```
  X  R  H  X^n  Xb  X^T  B()  H()
```

One tap each, no stack to open, nothing floating above the row to keep track of —
and with it go the stack's CSS, its placement maths, its outside-tap and
strip-scroll closers, and the capture-phase interception that stopped X's own
first tap. X plays on the first tap again.

They are **moved**, not rebuilt, so their id-bound handlers keep working. X^n
comes out of the parked section it has been in since 13.114, which is a different
container from the row — 13.130's lesson, so each is asked of its own home. Xb is
the one genuine construction: it has never been a corner button, only a control
inside the player, so it is built against the same `window.scrayPlayRandomBookmark`
that one calls.

**New: edge swipes.** In from the left edge opens history, in from the right opens
the basket — the same two panels H() and B() open, without reaching for the row.

Deliberately narrow, because a list that scrolls vertically is underneath it: the
swipe must start within 24px of the edge, travel at least 55px inward, stay more
horizontal than vertical, and be a single finger. It is read-only — never calls
`preventDefault` — so a gesture it declines still does whatever the page was going
to do with it. **Nothing playing only:** in FLS and MPFS the horizontal edges are
the player's own seek and zoom territory, and this must not sit on top of that.

**FLS and MPFS: the row is gone.** Only the frozen three remain — 🔍, 🌐 and COL.
Everything the scrolling row carried is reachable from the circles, which this
bump puts back, so a row of buttons over the picture was duplicating them. Hidden
rather than emptied: the strip keeps its scroll position and its buttons keep
their handlers, so leaving fullscreen brings the row back exactly as it was.

**The anchors rise 8px in MPFS.** They sat 5px off the progress rail, which read
as crowded. 9px is the whole of the available headroom — the control row is at
`calc(6vh + 39px)` and the anchors are 30 tall, so `6vh + 9 + 30` lands *exactly*
on its underside — so this takes 8 and keeps a pixel rather than trusting
sub-pixel rounding not to overlap them on a real screen. Going further means
moving rows 2 and 3 as well, which Mac considered and declined. The orange guide
follows on its own, being measured rather than written down.

**The circles are all eight again**, with one substitution: the F slot is now
**X^n**. 13.129 dropped F, H and B because the anchor row carried them in
fullscreen — and this bump takes that row out of fullscreen, so the circles are
the only way to reach them. F itself is not needed: the pink search pill shows the
term at rest in the title bar. The new circle clicks the real `playRandomWeightedBtn`
rather than reaching for the play function, so there is one implementation.

*(Leaving them built-but-detached in 13.129 is what made this an `appendChild`
rather than an archaeology exercise.)*

**The old filter pill under the title is retired.** `#floatingTagPillsBar` rides
into `.fls-video-title` in fullscreen carrying the pink search pill, which already
shows the current term — so `.fls-filter-pill` was a second box saying the same
thing one line below it. 🔍 focuses the pink pill now, and style.css opts that
pill (and only that pill) back in from the bar's `pointer-events: none`, exactly
as the old one used to for itself — the bar carries the open-basket click handler,
and a stray tap beside a pill should not open the basket.

The builder is **short-circuited behind `SHOW_FLS_FILTER_PILL = false`**, not
deleted: `syncFullscreenFilterPill`, `startFullscreenFilterEdit` and the strip
placement all query for the pill and are already written to cope with it being
absent, so returning null exercises exactly those paths. 13.131's full-width
editing box goes with the pill it styled.

**13.131's blink fix stays** — it was never about the pill. The guard is keyed on
the fullscreen classes, which is what makes it immune to `fls-filter-editing`
being dropped before `keyboard-active` clears.

**Tested**: the idle row in the right order in both the DOM and on screen; no
stack anywhere; X playing on the first tap; Xb still reaching its function; all
four edge-swipe cases (left opens history, right opens basket, mid-screen does
nothing, too-short does nothing, mostly-vertical does nothing — that last one is
list scrolling); swipes standing down in fullscreen; the row hidden and only the
frozen three showing there; all eight circles with the X^n substitution asserted
at the source; the old pill absent and the pink one tappable in the title; and
13.131's blink sequence still clean. 74/74 on the dock suite, guides unchanged.

**Three suites were updated to the new contract**, not repaired: the fullscreen
row can no longer overflow because there is no fullscreen row (the idle row's
eight buttons are checked instead), the consolidated-X section became the
plain-buttons section, and `fls-filter.test.js` now asserts the pill's absence
where it used to assert its width.

### native 13.131 — test: the fullscreen filter becomes a full-width box, and the player stops blinking
<!-- 2026-09-14T21:27Z -->

**1. The filter box.** At rest `.fls-filter-pill` is a small chip under the title
showing the current term, which is right — it is a label. The moment you are
typing into it, it is a filter box, and a 9em input on its own row is a keyhole
to type a search term through.

While `body.fls-filter-editing` is set the pill now takes the whole width of the
title bar and grows to a real type size, staying transparent so the picture reads
behind it. The input loses its own black background and its 9em — the **box**
carries the tint now and the input just fills it. Two classes beat the one-class
rest rules, so nothing needed `!important`, and the resting chip is untouched.

**Two flex details that were not obvious.**

- `flex: 1 1 0` on the input, not `1 1 auto`. An `<input>` has an intrinsic
  20-character width, and with `flex-basis: auto` that is where growing *starts
  from* — so it keeps a chunk of the row to itself instead of filling what is
  left.
- `width: auto` on the bin. style.css sets `button, select, input` to
  `width: 100%` for everything under 1024px — the same trap `#scrayDisguiseGlobe`
  documents from 13.120 — so the bin claimed the entire pill and left the input
  nowhere to grow. The class already beat the bare selector for *padding*, which
  is why only the width went wrong and it presented as a flex problem rather than
  an inherited one.

**2. The blink is a class-ordering race, and the existing guard could not win
it.** Two classes come off at different times:

- `fls-filter-editing` — removed **synchronously** by `endFullscreenFilterEdit()`
  the moment the input blurs.
- `keyboard-active` — removed by the `visualViewport` resize handler, which does
  not fire until the keyboard has finished animating down, several frames later.

In between, `.keyboard-active.search-pill-active #inlineVideoContainer
{ display: none !important }` (which exists so MPB can show the results list
above the keyboard) applies with its guard already gone. The player disappears
for those frames. That is the blink.

The guard is now keyed on the **fullscreen** classes rather than on the editing
flag. `portrait-fullscreen` / `manual-rotate-landscape` are set for the whole
interaction and outlast both of the others, so there is no window left for the
hide rule to land in — it is fixed by construction rather than by getting the
ordering lucky. And the reasoning holds generally: in fullscreen the player *is*
the surface, there is no results list behind it to make room for, so hiding it
for a keyboard is never right there.

(`search-pill-active` is effectively always true since 13.84 put the page's
search pill permanently on screen, which is why this reproduced without any
search term being involved.)

**Tested** by a new `fls-filter.test.js`, in both MPFS and FLS: the chip stays
small at rest and becomes the full content width of the title bar while editing,
the box is transparent and the input carries no background of its own, the type
is at least 14px, the input actually fills the box rather than sitting at its
intrinsic width, and the label swaps for the input. The blink is reproduced by
replaying the real ordering — add `keyboard-active`, drop `fls-filter-editing`
synchronously, then drop `keyboard-active` several frames later — and asserting
the player never computes to `display: none` at any of the three points. Plus a
source check that the guard is keyed on the fullscreen classes, since that is the
property that makes it immune rather than lucky. The other four suites are
unchanged.

### native 13.130 — test: three 13.129 bugs, and the fixture that let two of them through
<!-- 2026-09-14T21:26Z -->

Mac, on testing 13.129: X^n never appeared in the stack, the filter stopped
working, and the X's were see-through with the play/pause button showing behind
them. All three were mine.

**1. X^n was looked for in the wrong container.** It is not in
`.corner-btn-row` — it was retired in 13.114 and parked as a direct child of
`#cornerButtons`, outside the row. 13.129 queried the strip for both X's and
found only X^T.

The first fix swapped the query to the shell and broke it the other way: by that
point the row has already been moved into the dock, which is not in the document
yet, so the shell no longer contains X^T. Neither container holds both. Each is
now asked for its own.

**⚙️ The fixture is the real story here.** 13.129's test hand-wrote the corner row
and put X^n inside `.corner-btn-row` — the exact thing that was broken, asserted
against markup that did not exist. That is the **fourth** fixture of this shape in
this series (13.122's row without `X^T`, 13.125's `addInitScript` never reaching
`setContent`, 13.126's FLS that never rotated). `x-stack.test.js` now **extracts
`#cornerButtons` from the real index.html**, walking div depth so the nested row
comes whole, and asserts up front that the fixture really does park X^n outside
the row. The class of bug is gone rather than this instance of it.

**2. The filter stopped working because 13.129 deleted the only way in.** FLS and
MPFS have had a filter since 13.62: `syncNowPlayingStripPlacement` moves
`#floatingTagPillsBar` into `.fls-video-title`, and `startFullscreenFilterEdit()`
opens an editable pill there. Its one caller was the **F circle** — which 13.129
removed as a duplicate of the anchor row's 🔍, without noticing 🔍 did something
else entirely (scroll the page to a search box that is behind the picture).

🔍 now calls `startFullscreenFilterEdit()` when `manual-rotate-landscape` or
`portrait-fullscreen` is set, before any of the page paths, and synchronously
inside the click so iOS still raises the keyboard.

**13.129's style.css block is deleted too.** It tried to un-hide the pills bar in
its *page* position for MPFS — but in fullscreen the bar is not in its page
position, and the 13.62 rules already un-hide, place and fade it where it
actually is. It also only overrode `display` while the hide rule sets
`visibility: hidden !important` as well, so it achieved nothing beyond fighting
the mechanism that works. **The test passed because it only checked `display`.**

**3. The X's were translucent because the dock is.** In fullscreen the dock is
held at `FS_ANCHOR_OPACITY` (0.45), and opacity on an ancestor cannot be undone by
a child — so a stack inside the dock was 0.45 whatever it asked for, and the
play/pause button showed through. The stack now hangs off the overlay **root**,
which is `position: fixed; inset: 0` and therefore a full-viewport frame for an
absolutely positioned child: same container-relative arithmetic the row guides
use, no viewport mixing for 13.119's drift to get into.

**That move caused a regression, which the 13.121 suite caught.** 13.123's
"nothing inside the faded row is tappable" rule hangs off the *dock*, so leaving
the dock took the stack out of it and `playRandomTimeBtn` came back as tappable
while invisible — the exact bug 13.123 existed to fix. The blind state is now
stated for the stack too. (The suite's own check was also sharpened: it treated
`pointer-events` as the whole answer, when an element inside a `display: none`
subtree is untappable regardless. It walks ancestors now.)

**Tested**: X^n and X^T both in the stack and both out of the strip; the stack
opaque in fullscreen and demonstrably not a dock descendant; first tap opening
without playing and second tap playing exactly once; 🔍 calling
`startFullscreenFilterEdit` ahead of the page paths, gated on the fullscreen
classes, with the function still exposed for it; and 13.129's rival CSS gone.
72/72 on the dock suite, both guide suites unchanged.

### native 13.129 — test: the anchor row follows the app's state, and one X replaces four
<!-- 2026-09-14T21:25Z -->

Four changes from Mac in one bump, on his call.

**1. The row depends on what the app is doing.**

```
  nothing playing   X  R  H  B()  H()          frozen: 🔍  BM  🌐  COL
  MPFS / FLS        X  >  H  B()  H()  <  B    frozen: 🔍      🌐  COL
```

R drops out in fullscreen deliberately — the X family covers random while you are
watching. `>`, `<` and B (random basket) only appear once something is playing,
which is the only time they mean anything.

Buttons are hidden, not removed: every one is wired by id elsewhere, and the
parked-button rule (a missing element is a silent dead listener) applies just as
much to a button that comes back. Order comes from flex `order` rather than
reshuffling the DOM, so the markup keeps describing the tap order it is the
record of.

**The BM/VID switch goes in fullscreen**, via a CSS rule rather than the `hidden`
property — scray-views.js owns that property and re-asserts it on every toggle,
so the two would have fought.

**2. One X instead of four.** X^n, X^T and Xb now live in a stack that opens
*above* X. First tap opens; a second tap on X plays the regular X, and the stack
stays up so another can be tapped. It closes on a tap anywhere that is not one of
the X's, on a strip scroll (the X moves out from under it), and — in fullscreen —
when the player controls go, since a stack left open over a faded row would be
tappable-but-invisible, which 13.123 was entirely about.

The first tap is swallowed by a **capture-phase** listener on X, so randomiser.js's
own click handler never sees it and opening the stack cannot also start a video.
Once open, X is let through untouched.

X^n and X^T are **moved** out of the strip, so their id-bound handlers keep
working; X^n was parked `display:none` in the markup (retired 13.114) and comes
back here. Xb has never been a corner button — it exists only inside the player
controls — so it is built here against `window.scrayPlayRandomBookmark`, the same
function that one calls.

The stack sits inside the **dock**, not the strip: the strip is `overflow-x: auto`
and would clip a popup dead. Its left offset is measured against the dock's own
rect — same containing block, one rect batch, no viewport arithmetic (13.119).

**3. The filter works in MPFS.** `body.fullscreen-active` hides
`#floatingTagPillsBar` with the rest of the page furniture — and on a phone that
bar is where the search pill lives, `#searchFilterRow` being `display: none`
under 1024px. It is let back through in MPFS, transparent over the picture (the
pills at 0.72; the bar itself was already `background: transparent`), and faded
out with the player controls via `:has(.plyr--hide-controls)` on body, since that
class lives on a descendant and the bar is a sibling of it.

**MPFS only.** FLS rotates the picture over the whole screen and has no page
underneath to filter against.

**4. Three circles removed.** F, H and B duplicated 🔍, H/H() and B()/B, which are
now a thumb's width away in the anchor row. Five circles remain: BM, ★, RN, −, +.
They are still *built* — the handlers and pause-menu tap plumbing cost nothing
detached — just not appended, so restoring one is a single `appendChild` rather
than an archaeology exercise.

**Fifth time for the backticks.** A comment for the X stack's CSS used them inside
the same JS template literal that caught 13.115, 13.120, 13.121 and 13.126. The
gate in the test run caught it again.

**Tested** by a new `x-stack.test.js`: both rows in the right order with the right
members, no R in fullscreen, the BM switch appearing and disappearing, X^n/X^T
actually relocated into the stack, first tap opening without playing (asserted
against a stand-in for randomiser.js's handler, so a leak would show), second tap
playing exactly once, Xb reaching `scrayPlayRandomBookmark`, the stack surviving
those taps, closing on an outside tap, and closing when the controls hide. Plus
the filter bar shown and transparent in MPFS, faded with the controls, absent in
FLS, and a static check that the circle group is five without F/H/B.

**Two assertions in the 13.121 suite were updated, not fixed** — they described
the old design. Dock child order now ignores out-of-flow children, since the X
stack is `position: absolute` and not part of the row's layout; and "the strip
overflows" now checks the fullscreen row, because the idle row's five buttons fit
at 402px, which is the new behaviour working rather than failing. 72/72 again,
and the three guide suites are unchanged.

### native 13.128 — test: one guide, through the centre of the anchor row
<!-- 2026-09-14T21:24Z -->

Mac dropped the player-controls guide and asked for a single line running through
the middle of the anchor row instead of a pair bracketing it.

**Most of this bump is deletion, and the deletion is the interesting part.** The
controls guide is what forced all the machinery 13.127 added: FLS rotates
`.plyr__controls` 90° into a column, so the lines had to work out which way a row
ran and switch axis accordingly — vertical pair in FLS, horizontal pair in MPFS,
decided by measuring the rect. The anchor row lives in **this overlay** rather
than in the player, so it is never rotated. With the controls guide gone, a
horizontal rule is correct in both modes and the orientation logic, the second
line of each pair, and the `.is-vertical` CSS all go with it. Nothing left here
asks which mode is running.

The line is centred rather than edged: `top = rect.top + rect.height / 2 - 1`,
the `- 1` being half the line's own 2px so it is centred on the row rather than
starting at the centre.

Unchanged and still the point: it belongs to the double-tap grid, not the
controls — up only while `body.scray-guides-awake` is set, with that grid's own
asymmetric timing. And the placement is still container-relative from a single
rect batch, on the rising edge of the awake flag plus resize, for the reasons
13.119 wrote down.

**Tested** in both modes and, for FLS, both viewports: exactly one line exists and
none for the controls; the anchor row is horizontal and so is its guide; the line
runs through the row's centre (mid 64 in MPFS, 761 and 377 in the two FLS
viewports); it goes when the grid sleeps and is re-measured on the next wake. The
FLS fixture still applies the real rotation and still asserts the controls came
out as a column first — nothing is drawn on them now, but if that stops being
true the fixture is no longer testing FLS. The 13.121 suite still passes 72/72.

### native 13.127 — test: the row guides bracket each row, and turn vertical for the rotated FLS controls
<!-- 2026-09-14T21:23Z -->

*(Superseded in part by 13.128, which removed the controls guide. Kept for the
fixture lesson, which is the durable half.)*

Mac sent a screenshot of FLS with the lines he wanted drawn on it, and said to
scrap both of the ones 13.126 produced.

**Why 13.126's FLS lines were wrong: the fixture never rotated.** FLS is not a
set of body classes, it is `applyManualRotationStyles()` — the player container
gets `width: screenH; height: screenW` and
`transform: translate(-50%, -50%) rotate(90deg)`. So `.plyr__controls` is a tall
narrow **column down the left** in FLS (measured: 63×322 on a portrait viewport,
63×812 on a landscape one) and an ordinary wide row in MPFS.

13.126's fixture set the classes and stopped there, so it measured an unrotated
control row, drew a horizontal line on its top edge, and passed. On the device
that line lay across the picture and marked nothing. **Third fixture failure of
this exact shape in this series** — 13.125's `addInitScript` not reaching
`setContent`, 13.122's four-button row without `X^T`, and now this. The pattern
is always the same: the fixture models the mode as *the flags the mode sets*
rather than *what the mode does*. `fls-guides.test.js` now applies the rotation
and asserts the controls actually came out as a column **before** asserting
anything else, so a fixture that stops rotating fails loudly.

13.127's answer was to measure which axis each row was thin in and bracket it on
that axis — right, and no longer needed once the controls guide was dropped in
13.128.

### native 13.126 — test: row guides bound to the tap grid, and drawn in FLS too
<!-- 2026-09-14T21:22Z -->

Two corrections to 13.125 from Mac. The guides belong to the **double-tap grid**,
not to the controls — the point of them is knowing where to tap, so they should
come up when the grid does. And they should be drawn in FLS as well as MPFS.

**1. The gate was wrong, and style.css already said so.** 13.125 hung the guides
off `is-controls-hidden`, so they were up whenever the controls were. The tap grid
has a different contract, written down right next to it:

> The double-tap grid shows only while you're tapping the picture … **not with
> the controls**, and not for a scrub. Up at once, and gone almost as fast.

`body.scray-guides-awake` is that flag — set from the touch, cleared ~300ms after
the taps stop. The overlay is a sibling of `body` and cannot see body classes, so
`syncStateClasses` mirrors it as `.is-guides-awake`, the same relay `is-mpfs` and
`is-controls-hidden` already use. No new observer: the body class observer added
in 13.119 already fires on it. The asymmetric timing is copied deliberately —
instant up, `0.1s` out — rather than approximated.

**2. FLS forced the lines to be measured rather than declared, and that is the
substantive finding.** MPFS's rows are declared (`--mpfs-row-1/2`, 13.125) and
could be drawn straight from CSS. FLS's are not. Measured:

```
  FLS, portrait viewport 402x812    dock 36–66    controls 57–120
  FLS, landscape viewport 812x402   dock 10–40    controls 184–247
```

No pair of numbers is right in both, and FLS is reachable either way. A
hard-coded line would have been a line that lies — worse than no line at all,
when the whole purpose is telling you where to tap. So `placeRowGuides()` reads
the dock and `.plyr__controls` and puts each line on that row's **top edge**: the
boundary between picture and furniture, which is the edge the question is
actually about. (13.125 drew them at the rows' bottom offsets, which read as
underlines; the top edge is the one that says "don't tap below here".)

**Measuring is what 13.119 and 13.121 warned about, so it is done in the one
shape that is safe.** Both rects come from the same batch and the offset is
expressed against the guide container's *own* rect — the element the line is
positioned inside. 13.119's bug was writing a coordinate measured in the VISUAL
viewport onto an element laid out against the LAYOUT viewport, two systems that
diverge the moment Safari's toolbar collapses; container-relative arithmetic has
no second system in it, so there is nothing to diverge. And it runs on the
discrete moment the guides wake — the rising edge of `is-guides-awake` — plus
resize and orientationchange. Never in a loop, never mid-animation, which was the
other half of what drifted: only opacity animates on these rows, their positions
are CSS-anchored.

Also, that 402×812 FLS reading is worth noting on its own: **dock 36–66 against
controls 57–120 is a 9px overlap**, live, in forced-rotation FLS. Not touched
here — FLS's rows were not asked for — but it is the same class of problem 13.124
fixed in MPFS, and now there is a harness that shows it.

**Tested** by two harnesses. `mpfs-rows.test.js` gained the new contract: each
line on the top edge of its row, orange at the right alpha, visible while the
grid is awake, **gone when the grid sleeps even with the controls fully up** —
which is the whole of correction 1 — and back on the next wake. A new
`fls-guides.test.js` runs FLS at both viewports and asserts the overlay reports
`is-fs` without `is-mpfs`, the guides are drawn, and each line lands on its row's
top edge in both — 66/120 in one and 40/247 in the other, from the same code,
which is the proof that measuring was the right call. The 13.121 suite still
passes 72/72.

### native 13.125 — test: orange row guides for the anchor and control rows
<!-- 2026-09-14T21:21Z -->

Mac wanted the gesture grid to say what is under the thumb, not just which zone
you are in: lines marking the anchor row and the control row, orange at 70%
transparent.

**The three row offsets became one source of truth first.** They were written in
three files — `disguise.js` for the dock, `player.js` for the controls,
`style.css` for the circles — which is fine for three rows nobody draws, and not
fine the moment something has to draw a line *on* one of them. A line copied from
a second place is a line that goes stale. So `:root` in style.css now holds
`--mpfs-row-1/2/3`, and all three consumers read them: the dock positions with
`var(--mpfs-row-1)`, `applyFullscreenOffsets()` writes `var(--mpfs-row-2)` inline,
the circles rule uses `var(--mpfs-row-3)`, and the guides draw at rows 1 and 2.
A guide and the row it marks now cannot disagree.

**The lines live in the disguise overlay, not in `.fls-tap-guides`** with the rest
of the grid, for two reasons that both had to be checked rather than assumed:

- The guide container is **bounded** in MPFS — `top: 33.333%; bottom: 152px`, it
  *is* the gesture band — so a child of it cannot reach down to rows that sit
  below 152px. Both new lines do.
- It lives inside `.plyr__video-wrapper`, which the zoom gesture transforms. A
  transformed ancestor becomes the containing block for `position: fixed`, so a
  fixed child there would drift with the zoom.

The overlay root is a sibling of body, untransformed, and already carries the
`is-mpfs` and `is-controls-hidden` classes `syncStateClasses` mirrors onto it — so
the lines fade with the player controls exactly as the tap guides do, with no new
wiring. Appended before the dock so they paint under it rather than across its
buttons.

**2px, not the tap grid's 1px.** At alpha 0.3 over moving picture a hairline is
not reliably visible.

**Tested** by extending the 13.124 harness: each line must report the same
distance from the screen edge as the row it claims to mark (49 and 88), the
computed colour must be `rgba(255, 140, 0, 0.3)`, the container must be shown in
MPFS, and its opacity must go to 0 when the controls idle away. The 13.121 suite
still passes 72/72.

**Not drawn:** the circle row. Row 3 has its own custom property and would be one
line, but it was not asked for.

### native 13.124 — test: the MPFS bottom rows rotated
<!-- 2026-09-14T21:20Z -->

Mac: anchor buttons to the bottom where the player controls are, controls up to
where the circles are, circles up to where the anchors were. Visibility and
tappability as in FLS.

**What was actually there.** Measured at 402×812 against the real stylesheet,
rather than read off the constants — which would have been wrong, because the
live offsets for the controls and the progress rail are written **inline from
player.js** and the CSS values are only pre-JS fallbacks:

```
  progress rail     32 – 44    (h 12)
  player controls   49 – 108   (h 59)
  circle pause row  118 – 162  (h 44)
  anchor dock       149 – 179  (h 30)   <- overlapping the circles by 13px
```

That 13px overlap was live before any of this, and was invisible because the six
circles only exist while paused. Rotating the rows by simply swapping the three
numbers would have made it much worse — the controls are 59 tall and the old gap
between row 2 and row 3 was 31px, so controls-at-118 would have run straight
through circles-at-149.

**So the rows were recomputed rather than swapped.** Row 1 is 6vh, exactly where
the controls used to sit, so the bottom row lands where the thumb already expects
a control row. Each row above is the one below it plus that row's measured height
plus a 9px gap:

```
  row 3   circle pause row   calc(6vh + 107px)
  row 2   player controls    calc(6vh + 39px)
  row 1   anchor dock        6vh
  ----    progress rail      4vh              (unmoved)
```

Result: `49–79`, `88–147`, `156–200`, **no overlaps anywhere**. (13.125 moved
these three values into `--mpfs-row-1/2/3` on `:root`; before that they were
written in the three files below.)

**Three files, because the three rows live in three places** — which is the real
reason this looked harder than it was:

- **disguise.js.** `MOBILE_BOTTOM_OFFSET_MPFS` goes from `calc(7vh + 62px)` to
  row 1, and the MPFS rules drop the `env(safe-area-inset-bottom)` term the other
  states carry. Row 1 has to land exactly where the controls were, and those are
  anchored at a plain 6vh with no inset of their own — adding one would float the
  dock above the row it is replacing. Native takes no extra lift for the same
  reason, so `.is-native` restates the same value purely to out-weigh the
  `.is-native` portrait rule, the same trick landscape already uses.
- **player.js.** `FULLSCREEN_CONTROLS_BOTTOM_VH = 6` becomes
  `FULLSCREEN_CONTROLS_BOTTOM` — a CSS length now, not a bare number. MPFS-only
  by construction: `applyFullscreenOffsets()` returns early while
  `manualRotationActive`, so FLS never reaches it.
- **style.css.** The circles' `bottom: 118px` becomes row 3, and row 2 gains a
  pre-JS fallback at
  `body.portrait-fullscreen:not(.manual-rotate-landscape) .plyr__controls`.
  Without that, the first paint of MPFS puts the controls at the shared 7vh rule
  — on top of the dock now sitting at row 1 — until `applyFullscreenOffsets()`
  runs. FLS never matches the selector.

**Visibility and tappability needed no work.** The dock's rules key off `is-fs`,
which 13.122 defined as FLS *or* MPFS, so 13.123's contract already applied here:
faded with the player controls, nothing inside tappable while faded, and a tap in
the region raising the controls rather than pressing blind.

**Worth watching on the phone.** The progress rail sits at 32–44 and the dock now
at 49–79, a 5px gap. It was not asked to move and has not, but the anchor row is
now directly above the scrub rail rather than well clear of it — if scrubbing
feels cramped, moving the rail down or row 1 up is the knob.

**Tested** with a new harness, `assets/web/mpfs-rows.test.js`, which renders the
real MPFS stack at 402×812 against the real style.css and disguise.js, applies
the inline offsets exactly as `applyFullscreenOffsets()` does, and prints every
row's bottom, top and height plus any pairwise overlap. It scrapes the offsets
out of player.js as written, so the fixture cannot drift from the app — when the
controls constant changed shape from a number to a string, the harness failed
loudly rather than measuring a stale value. The 13.121 suite still passes 72/72.

**Stale comment worth knowing about.** `.fls-tap-guides`' MPFS floor is
`bottom: 152px`, and its comment derives that from the circles sitting at
118 + 34. The circles have moved to row 3 (156), so the arithmetic in that
comment no longer holds — but the number still matches `MPFS_BAND_BOTTOM_PX` in
player.js, which is what actually keeps the drawn grid and the live gesture zones
in step, and the band still clears the circles by 4px. Worth tidying when the
band is next touched.

### native 13.123 — test: COL drawn as a corner button, and the faded row is untappable but wakes on tap
<!-- 2026-09-14T17:48Z -->

Two from Mac, both about the fused row behaving like one thing rather than two.

**1. COL is a button, so it is drawn as one.** Collapsed, it was still wearing the
menu's skin — a white 10px pill with a grey hairline and a shadow — which read as
a stray UI element parked in the row rather than the last button in it. It now
takes `.burger-btn`'s look as well as its box: `#333`, 4px corners, white type,
no border, no shadow, and the same `min-width` as everything else. The mode tag
is the button's label now, so it goes white too — restated against both the plain
and the `.has-mode-tag` handle rules, since the tag rule carries its own grey and
would otherwise keep winning.

Strictly `.is-collapsed`. **Expanded it is a menu again** and keeps the white
card, which is what makes it readable over a video.

**2. The blind row was fully tappable — a 13.121 regression, and mine.** In FLS
and MPFS the row fades out with the player controls. The rule turning it off
listed `#scrayDisguiseStrip` and each frozen button by name, which was right
until the fused row arrived: `#scrayDisguiseStrip .burger-btn` sets
`pointer-events: auto`, and that beats inheritance from the strip. So every
corner button inside the scroller stayed perfectly pressable while invisible.
Mac hit exactly that.

The fix is one descendant selector — `… :has(…is-collapsed) *` — which
out-specifies both `.burger-btn` rules with no `!important` needed. **Lesson
worth keeping:** turning `pointer-events` off on a container does nothing to a
descendant that sets it back on. Naming the container is not naming its contents.

**And a tap there now wakes the row rather than doing nothing.** The dock itself
becomes the catcher — `pointer-events: auto` on it while blind, the one place in
the file it is ever auto — and a capture-phase `pointerdown` raises the controls
and stops the event. One tap to wake, a second to press; never the blind press.
It goes through `scrayRaiseControlsForTouch`, newly exposed on window in
player.js, because that re-arms Plyr's hide timer too, so the row stays up for the
usual dwell instead of vanishing again immediately. `scrayShowControlsNow` is the
fallback — it reveals but does not re-arm.

Both halves apply to FLS *and* MPFS: the rule keys off `is-fs`, which 13.122
defined as either.

**Tested**: 72 assertions. The new ones drive the real thing rather than reading
CSS — with the controls hidden, a synthetic `pointerdown` aimed at where a corner
button sits asserts that nothing is pressed, that the hit lands on the dock
rather than a button under it, that the controls were raised, and that the row is
back afterwards. Plus: nothing inside the blind row has live pointer-events, and
COL's radius, background, border and handle colour match `.burger-btn`.

### native 13.122 — test: one button box across the fused row, and a left inset
<!-- 2026-09-14T17:47Z -->

Mac, on seeing 13.121: match the anchor buttons to the corner buttons, and inset
the row so the first button starts where the second one was.

**One box, and it is the corner button's**, because that is the one there are ten
of. The anchor buttons had been carrying their own sizes — 38px tall on a phone
against the corner row's 30 — which nobody could see while they were separate
rows and everybody could see the moment they shared one. `--scray-btn-h` and
`--scray-btn-min-w` on the dock now drive every button in the row, COL's
collapsed box included.

**30px, not the 27 a corner button measures on its own.** `X^T`'s superscript
makes that one button 30 tall, and a flex row stretches its siblings to match, so
30 is what the corner row has always actually been. The first pass set the token
to 27 from a measurement taken on a four-button fixture that happened not to
include `X^T` — the test caught it immediately (`corner 30 | search 28 | view 27
| globe 27 | COL 29`, five different heights in one row).

The height is now **pinned** on every button rather than left to whichever
happens to be tallest, and the strip is `align-items: center` rather than the
default stretch. Adding or removing `X^T` later therefore cannot silently resize
the whole row, which is the failure mode the 27-vs-30 mistake was a preview of.

COL needed `box-sizing: border-box` alongside its pinned height: its 1px border
was pushing it one pixel taller than the buttons beside it.

**The inset** is `padding-left: calc(var(--scray-btn-min-w) + 6px)` — one button
and one gap — on the strip. Padding rather than margin, deliberately: it belongs
to the scrolling content, so buttons pass through it as you scroll instead of
stopping at a hard edge, and the strip keeps its full width for measuring.

**Tested**: 56 assertions, the suite from 13.121 plus four — every button in the
row exactly `--scray-btn-h`, nothing narrower than `--scray-btn-min-w`, the inset
at 38px, and the first strip button landing where the second one used to.

### native 13.121 — test: the corner buttons move into the anchor dock, scrolling behind four frozen
<!-- 2026-09-14T17:46Z -->

Picker untouched at 13.126.

**Mac's idea.** The anchor buttons are the future of the corner buttons, so fuse
the two. All corner buttons to the left of the anchors, the whole row scrolling
because it is too long, and a frozen group on the right that never scrolls away —
four of them: the existing three plus 🔍.

**Why this is a deletion, not an addition.** The corner row and the anchor
buttons have been two separately positioned rows sharing one baseline, held apart
by a hand-written 92px reserve — `ANCHOR_RESERVE` — restated across six
`!important` blocks in style.css (13.122, 13.123). That number is the dock's own
offset plus its measured width plus air, so every button added to either side
made it wrong again, and 13.123 shipped only after finding that patching one of
the three landscape blocks left the row still overlapping by 74px.

Fused, there is no reserve, because there is no gap to maintain. The two rows are
one flex row:

```
[ ------- strip, scrolls ------- ][ 🔍 ][ VID/BM ][ 🌐 ][ COL ]
                                  \_________ frozen __________/
```

**The freeze needs no code.** The four on the right are ordinary flex items at
their natural width; the strip is the only one that flexes, so it takes what is
left and scrolls its overflow. `min-width: 0` on the strip is load-bearing — a
flex item will not shrink below its content width without it, so the strip would
push the frozen four off the screen instead of scrolling.

**How it is done.** `#cornerButtons`' inner `.corner-btn-row` is **moved** — not
copied — into the dock at build time and renamed `#scrayDisguiseStrip`; 🔍 comes
out of it to join the frozen group. Moving rather than rebuilding means every
handler bound by id is still bound to the same node, and no id changes. The shell
stays in the DOM, hidden, because it still holds the retired parked buttons whose
handlers are wired by id — the same reason they were parked rather than deleted.

Moving it out of `<body>` has two effects, both wanted:

- `body.fullscreen-active:not(.fls-peek) #cornerButtons` no longer reaches it, so
  the row survives fullscreen instead of being hidden outright — and as a dock
  child it now fades with the player controls, which is what Mac asked for. The
  whole row, scroller included, not just the frozen four.
- Every other `#cornerButtons` rule stops applying too: the centring, the
  history-panel left-shifts, the three right-anchor blocks, the reserve. They are
  dead rather than fighting, and are the cleanup once this is proven.

**The dock now spans the width.** It was shrink-to-fit because it held two
buttons; it is stretched to the opposite edge so the strip has somewhere to
scroll. Safe because the dock is `pointer-events: none` with only its children
opting back in, so the empty part of the row is not a dead zone over the page —
the property 13.119 added for the gap between 🌐 and COL now covers a whole row.

**Desktop too**, per Mac, but with the dock staying exactly where it is: still
top-right, COL still at the right edge, the strip extending leftward from the
frozen group. Nothing a desktop user already reaches for moves.

**One behaviour change worth knowing.** Tap-off-to-collapse tested
`dock.contains(e.target)` — correct when the dock was two buttons, wrong now that
it contains the whole corner row, since tapping R or X would have left an open COL
panel sitting over the app. It now tests the panel's own furniture (COL, 🌐,
VID/BM) instead. 🔍 deliberately closes the panel: it scrolls the page out from
under it anyway.

**Two bugs found by the test, both fixture-shaped.**

- **A detached subtree.** The search button silently stayed in the scroller and
  the frozen group was three wide. `document.getElementById('jumpSearchBtn')` ran
  *after* the strip had been appended to the dock — and the dock is not in the
  document until `root.appendChild()` at the end of `build()`, so the whole row
  was a detached subtree, which `getElementById` cannot see into. It now queries
  the strip, before the move.
- **The fixture was testing the wrong surface.** `addInitScript` did not reach
  `setContent`'s `about:blank`, so `IS_NATIVE` came out false and the "native" run
  was silently exercising Picker — 🌐 was never drawn. The stub is inline in the
  fixture HTML now, and the suite asserts `is-native` matches the surface it
  claims to be testing before asserting anything else. Same lesson as 13.125: the
  fixture was wrong, not the assertion.

**Fourth time for the backticks.** The explanatory comment for the strip's CSS
used backticks inside the same JS template literal that caught 13.115 and 13.120.
`node --check` caught it again, and the run now has a hard gate that counts
backticks inside the CSS block and exits non-zero.

**Tested** in headless Chromium against native's real style.css and real
disguise.js, at 402×812 portrait (both surfaces), 812×402 landscape and 1400×900
desktop. Covers: the row moved with its ids intact and the shell hidden with its
parked buttons kept; the dock spanning the width; child order; `min-width: 0`;
the strip overflowing and scrolling; the strip stopping at the freeze line and
never running under the frozen four; the four sitting in a row without
overlapping and reaching the right gutter; the shadow; a shared baseline in
portrait and landscape; and the full MPFS cycle — 0.45 with controls up, 0 and
untappable when they idle away, back when they return. The suite lives at
`assets/web/dock-fusion.test.js`.

**Not covered:** actual touch-scrolling on a device, and whether the visible
button count at 402px is enough before scrolling gets annoying. Both are phone
questions.

#### ⚠️ Tooling note: silent no-op writes to the device

Twice in this session `device_commit_files` returned `written` for
`assets/web/disguise.js` and the bytes on disk did not change — the file's mtime
updated, but the content was the previous version. Both times the app was
therefore showing the previous bump, which is how it was noticed.

**The pattern, and the workaround.** Both failures reused a staging path that had
been overwritten with new content since the last commit from that same path. The
write appears to go out with the *previously seen* content for that path. Writing
each bump from a **fresh, uniquely named staging directory** worked first time —
including 13.123, committed that way from the start with no retry.

So: one new staging directory per bump, and **read the file back and compare
before telling Mac it has landed.** A `written` response is not evidence on its
own.

### native 13.120 — stable: the index page holds both views, Videos and Bookmarks
<!-- 2026-09-14T16:03Z -->

**What Mac asked for.** Stop flipping between two pages. One page, a Videos view
and a Bookmarks view, toggled by a button, with the filters shared across the
switch so a tag or performer spotted in a bookmark row can be taken straight back
to the full library — and one page to maintain instead of two.

**Why this was much smaller than it looked.** The 13.37 rebuild had already done
most of it without meaning to:

- `bookmarks.html` was regenerated from `index.html`, so the two shells differ by
  76 lines and most of that is drift, not design — the bookmarks copy never got
  wholesale mode or `scray-stash-edit.js`, and its corner row still carries
  buttons retired in 13.114.
- Every bookmark-aware branch in the shared code tests `video.__bmStartAt != null`
  on the ENTRY — 13 sites in render.js, 12 in player.js, 2 in randomiser.js.
  Not one asks which page it is on. So a page that shows either kind of row needed
  no changes there at all.
- 13.114 gave the index page its own note facet (`'note'` in
  `SCRAY_FACET_CLASSES`, the NOTE button, both filter sets). That made
  bookmarks-page.js's private note Sets, its own pill painter, its NOTE binding
  and its term-count and Clear-all overrides redundant — about 80 lines deleted
  rather than ported.

**The shape.** `bookmarks-page.js` becomes `scray-views.js`. The four pipeline
overrides stay exactly what they were — `getFilteredVideos`, `matchesSearchQuery`,
`updateVideoStats`, `scrayFacetCounts` — but each now asks which view is showing
and hands straight back to the original in Videos view, so the main list is
bit-for-bit what it was. The shared filters need no code: `scrayFacetFilters` and
friends were always window globals and only ever died at navigation.

**Three things had to be decided rather than discovered.**

- **Note excludes change granularity between the views.** In Videos, "− kiss"
  means "no video that has a kiss bookmark" and `getFilteredVideos` drops the
  whole record — right, because the row is the file. In Bookmarks it means "not
  the kiss bookmarks", and dropping the record would take the same video's other
  bookmarks with it. So in Bookmarks view the note exclude set is lifted out for
  the base pass (restored in a `finally`) and re-applied per entry afterwards.
  Includes need no such care: the base pass keeps a video if ANY of its notes
  match, and the per-entry filter then narrows to the matching bookmarks, which
  is a narrowing of the same question rather than a different one.
- **One shared sort, dropping keys that don't apply.** `note` and `bmtime` read
  fields only an entry has, so they come out on the way back to Videos via a new
  `scrayListSortDrop`. Left in, they would sort the whole main list by `undefined`
  and read as a broken sort rather than an inapplicable one. The video keys need
  no care in the other direction — an entry is a clone of its video and still
  carries every one of them.
- **Always boots into Videos; the mode is not persisted.** A reload is a clean
  start, which also means nothing has to be restored before first paint to stop
  the list grid flashing the wrong column count — the `--lc-cols` class is
  toggled on `html` at switch time rather than added as the script parses.

**Also.** Open rows are cleared on every switch: a row key is the video's id in
Videos and `id@time` in Bookmarks, so one carried across could never match a row
again and would sit in the set for the rest of the session, re-opening a row the
moment you switched back. `scrayOpenListRows` is exposed for that.

**A latent bug fixed on the way.** `scrayTotalFilterTerms` counted
`['tag', 'studio', 'performer', 'stashtag']` — written before `'note'` was a
class. A note-only filter therefore counted as no terms at all: the intersect and
Clear all pills stayed away, and the bookmarks page had been quietly adding notes
back on top of it. It now runs off `SCRAY_FACET_CLASSES`, the same fix 13.114
applied to the exclude sets and for the same reason. **Watch for:** the intersect
and Clear all pills now appear on the index with only notes picked, where they
previously did not.

**The switch.** A green VID/BM button on the disguise dock, first in DOM order so
it sits left of 🌐 and the COL panel. Built there because the dock is the one
element already anchored correctly on every screen and in every fullscreen state —
anywhere else would have to restate all of it — and it inherits the 13.122 fade
with the player controls for free. disguise.js draws it hidden with no label and
calls whatever `window.scrayToggleView` is at click time; scray-views.js reveals,
names and colours it. So disguise.js knows nothing about views, and a page without
that script never shows a button. It turns BM purple (`#6f42c1`, the colour the
note cells and pills already use) in Bookmarks view, so which view you are in is
readable from the button alone.

**Tested** as a module against a stub window: Videos view hands `getFilteredVideos`
straight through unchanged and `scrayFilteredBookmarkEntries` answers null; the
switch expands two bookmarks from one video in time order; the note column goes
in and comes back out of `SCRAY_LIST_COLUMNS_FOR`; and a note exclude drops only
its own bookmark while keeping the video's other one, with the exclude set
restored afterwards. Then on the device by Mac, who confirmed it — hence
`stable`, and hence the Picker port above.

### picker 13.125 / native 13.119 — test: the in-app browser was being mistaken for the Native app
<!-- 2026-09-14T13:46Z -->

13.124 shipped and the button stayed blue. Mac also noticed the anchor buttons still sitting high. Two complaints, **one cause**, and the diagnostics named it in the very first line: `div#scrayDisguise.is-native`. That is Picker — and it was claiming to be Native.

`IS_NATIVE` tested for the `scrayBridge` message handler, on the reasoning that iOS Safari exposes `window.webkit` but not the app's own handler. True as far as it goes — but `ScrayBrowser.swift:264` registers a handler under that **same name** for the pages it hosts. So Picker running inside Native's browser passed the test and was treated as the app:

- it kept the blue "open the browser" button while already being in the browser — 13.124's `if (IS_NATIVE)` branch won before the in-app check was ever reached;
- and it took `NATIVE_EXTRA_LIFT`, putting the dock at `bottom: 36px` against the corner row's 6px. Exactly the 30px Mac was looking at, and it matches the diagnostics: `#cornerButtons @10,642` (h42, so 6px up) vs `#scrayDisguiseDock @318,616` (h38, so 36px up).

`IN_APP_BROWSER` is now computed first and `IS_NATIVE` excludes it. The in-app browser is ruled out explicitly rather than by reaching for some other signal, because the handler genuinely *is* there — it is the surface that differs, not the bridge. `window.SCRAY_NATIVE` is added as a third accepted signal since it is injected only into the main web view.

**Also worth recording:** that bottom bar with ✕, ‹, ›, ↻, a tab count and a download button is ScrayBrowser's own chrome, not Safari's. The user agent says `Version/17.0 … Safari/604.1` because ScrayBrowser presents a Safari UA, which is why the report read as Safari at a glance. `ipa: null` was the real tell — the main web view always has `window.SCRAY_NATIVE`.

**Tested** against all three surfaces with exactly what each really exposes: the main web view (ScrayBridge + SCRAY_NATIVE), Picker inside ScrayBrowser (`webkit.messageHandlers.scrayBridge` + SCRAY_IN_APP_BROWSER), and Picker in plain Safari (nothing). Asserts `is-native`, which glyph is drawn or whether the button exists at all, and that the dock and the corner row share a baseline in each. The middle case reproduces Mac's 36-vs-6 before the fix and 6-vs-6 after.

*The previous test missed this because it stubbed the two surfaces as I imagined them — a bridge for Native, the in-app flag for Picker — never the combination the real browser presents. The fixture, not the assertion, was wrong.*

### picker 13.124 / native 13.118 — test: picker's browser button becomes a red close button
<!-- 2026-09-14T13:36Z -->

Mac's realisation: Picker never needs a button that summons the browser, because Picker only ever runs *inside* that browser (or in a plain tab, where there is no browser to summon). Same slot, opposite job.

- **Native** — unchanged. Blue 🌐, resumes the in-app browser where it was left.
- **Picker inside the in-app browser** — red 📱, dismisses the browser and lands you back in Native. 📱 over a cross or a door because what matters is where you end up, not that something is closing; red because it dismisses, matching the Exclude pill and the modals' Clear buttons.
- **Picker anywhere else** — not drawn at all. COL sits alone and the dock is 44px instead of 78px. A dead control is worse than no control.

**No Swift change and no IPA rebuild.** `ScrayBrowser.swift`'s `decidePolicyFor` already cancels every `scraynative://` navigation, routes host `newtab` to a tab, and lets everything else fall through to `dismiss(animated: true)` — playing a video afterwards only if a `?key=` came with it. So `scraynative://close`, with no key, is *already* "dismiss the browser and do nothing else" on the installed build 73. The button is a new caller of an existing path, not a new path.

The surface test is `window.SCRAY_IN_APP_BROWSER`, injected at documentStart by ScrayBrowser and only there, so it is exact rather than a user-agent guess.

**Tested** across all three surfaces: glyph, background colour, tooltip, and whether the button is drawn at all, plus the dock's resulting width. The hop itself is asserted statically — `window.location` cannot be redefined in a page, and Chromium drops an unknown scheme with no request and no console message, so only the device can confirm the dismissal actually happens. The test checks the handler targets `scraynative://close` and carries no `?key=`, since a stray key would turn a close into a playback.

### picker 13.123 / native 13.117 — test: anchor buttons level in landscape, control fade 1500 -> 2250ms
<!-- 2026-09-14T13:26Z -->

**1. The levelling.** Mac's picker screenshot was a narrow LANDSCAPE window, not the phone — which is why native looked level and picker did not. Measured across viewports: level at 402x812 in both apps, but 48px out in picker and 78px out in native under `(max-width: 1024px) and (orientation: landscape)`.

That gap was deliberate once. The app pins `#cornerButtons` at `bottom: 10px` and right-anchors it in landscape, so `MOBILE_BOTTOM_OFFSET_LANDSCAPE = 58px` lifted the panel clear of a row that ran the full width. Since 13.122 the row reserves horizontal space for the anchor buttons, so lifting them is no longer buying anything. The offset is now 10px — the corner row's own landscape bottom — and the landscape `.is-native` rule keeps the same value rather than adding `NATIVE_EXTRA_LIFT`. That rule has to stay: it exists purely to out-specify the portrait `.is-native` rule, which carries two IDs and would otherwise keep winning inside the landscape media query and put Native at 36px while Picker sat at 10px.

**The reserve had to be applied three times, not once.** The obvious landscape rule was only the first of three that set `right: calc(safe + 10px) !important` on the corner row — there is also a "reinforce right anchoring" block and a random-panel-open block, both later and both `!important`. Patching one left the row still running to the screen edge and overlapping the dock by 74px. The overlap test caught it; a visual check at one viewport would not have. All three now carry the +92px reserve.

**2. Control fade timeout.** `SCRAY_CONTROLS_HIDE_MS` 1500 -> 2250 (+50%) in both apps — 13.90's halving turned out a shade too quick to live with. Note the new value is *above* Plyr's own hardcoded 2000ms, which is fine: `scrayTakeOverPlyrControlsTimer` replaces Plyr's timer on the same element and phase rather than racing it, so ours is still the number that decides. Had the takeover not existed, anything above 2000 would have been silently clamped.

**Tested** across four viewports per app (phone portrait, two landscape widths, desktop), asserting both that the baselines match and that the corner row stops before the dock: gaps of 23/8px in portrait and 18px in landscape, zero baseline difference everywhere on mobile. Desktop is unchanged and still anchors the dock top-right by design.

### picker 13.122 / native 13.116 — test: corner row anchored left, anchor buttons fade with the player controls
<!-- 2026-09-14T13:05Z -->

**1. Native's corner row (native only).** It was centred — the base rule is `left: 50%` + `translateX(-50%)` — so on Mac's 402px screen a 285px row ran 59→344 and its last button sat under the anchor buttons at 318. The diagnostics said it outright: `#cornerButtons [fixed] 285x42 @59,734`.

It is now left-anchored at an 8px gutter, matching `#floatingTagPillsBar`'s own side padding, with a 92px right-hand reserve: the dock's right offset (6) + its width (28 globe + 6 gap + 44 COL = 78) + 8px of air. Centring was the deeper problem — it moved the row's start every time a button was added or removed. Left-anchored, the start is fixed and the reserve decides where it stops. Picker was already left-anchored and clear by 23px, so it is untouched.

**2. Transparent in fullscreen, fading with the controls (both apps).** In FLS and MPFS the anchor buttons sit on the picture, so they drop to `FS_ANCHOR_OPACITY` (⚙️ 0.45) and go to zero when Plyr idles its controls away — the same `.plyr--hide-controls` signal `.fls-video-title` has always keyed off.

The overlay lives outside `<body>` and cannot see that class, so `syncStateClasses` relays it, alongside a new `is-fs` (FLS *or* MPFS — only the position offset is MPFS-only). Plyr's flag is on `.plyr`, which is rebuilt on every source change, so the observer binds to `#inlineVideoContainer` and rebinds if that wrapper is ever replaced. Scoped to that subtree rather than body's on purpose: a class-change observer over the whole list would fire on every row highlight.

Two details. A `:has(#scrayDisguiseControl.is-collapsed)` guard keeps an OPEN panel on screen — the controls idle out after three seconds, and a menu vanishing mid-tap is a bug, not a fade. And `pointer-events: none` goes on the children rather than the dock, because the dock is already `pointer-events: none` with its children opting back in, so clearing it at dock level would do nothing.

**Tested** at 402×812 against each app's real style.css with a stand-in player wrapper: opaque outside fullscreen, 0.45 in MPFS, 0 with controls hidden (and the globe untappable), back to 0.45 when they return, never 0 with the panel open, and 1 again on exit. Geometry asserted too — native's row now runs 8→310 against a dock at 318.

*Testing note: the first run "failed" at 0.63 / 0.20 / 0.32. That was the 0.3s transition still in flight against a 120ms settle, not a bug — worth remembering when asserting on animated properties.*

### picker 13.121 / native 13.115 — test: MPFS drift gone, and the MPFS offset finally applies at all
<!-- 2026-09-14T13:04Z -->

Mac's report narrowed it perfectly: drifting in native MPFS, "locked down and ok" in picker. Picker has no JS touching the anchor buttons' position; native had `positionAbovePlayerControls`. That was the only structural difference, so that function was the suspect — and 13.120's attempt to make its measurement honest (subtracting the row's animated translate) had not held.

**The function is deleted.** It re-ran on a MutationObserver watching body class changes — `scray-paused`, `scray-scrubbing`, `scray-guides-awake`, `keyboard-active`, all of which fire while you swipe — and each run wrote a fresh inline `bottom` measured against whatever the control row was doing at that instant. A constant cannot drift; matching picker is worth more than an auto-fitted offset. `MOBILE_BOTTOM_OFFSET_MPFS` is the knob if the panel sits too close to the control row.

**Which uncovered a much older bug.** Deleting it should have left native on the CSS MPFS offset. It didn't move at all — the CSS rule was never applying. It read `body.portrait-fullscreen:not(.manual-rotate-landscape) #scrayDisguiseDock`: a descendant-of-body selector, on an overlay that `injectStyles` appends to `documentElement`, a **sibling** of body. It has never matched, in either app, for as long as it has existed. Native masked it completely, because the inline `bottom` from the measuring function was writing over the top of it. Picker has been silently sitting at its MPB offset in MPFS the whole time.

`syncStateClasses()` now mirrors the one class the layout cares about onto the overlay root (`is-mpfs`), and the rules are keyed `#scrayDisguise.is-mpfs #scrayDisguiseDock` / `.is-mpfs.is-native`. A class toggle rather than a measurement, deliberately: the measurement is the thing that drifted. FLS also sets `portrait-fullscreen`, so the `:not(.manual-rotate-landscape)` test moved into the JS rather than the selector.

**Worth checking on the device:** picker's COL panel now lifts in MPFS where it previously did not. That is the intended position, but it is a visible change to a mode that has looked the same for a long time.

**Tested** in headless Chromium at 402×812 against each app's real style.css, with `ScrayBridge` stubbed so native runs its `is-native` path. Asserts the full state machine — MPB → MPFS → FLS → MPFS → exit — and that twelve rounds of body-class churn move the dock by zero pixels and leave no inline style on it. picker 768 → 655, native 738 → 625, FLS correctly excluded in both.

**Third time for the backticks.** Same JS template literal, same parse error, caught the same way. The check now runs as a hard gate that counts backticks inside the CSS block and exits non-zero, rather than something to remember.

### picker 13.120 / native 13.114 — test: anchor buttons level again, MPFS lift measures the control row at rest
<!-- 2026-09-14T12:47Z -->

Two causes behind one report, both found from the `ui_layers` line in Mac's diagnostics: `div#scrayDisguiseDock [absolute] 78x48`. The width was right (28 + 6 + 44); the height should have been 38.

**The misalignment.** style.css sets `button, select, input` to `width:100%; padding:12px; margin-bottom:10px` for everything under 1024px. The `#scrayDisguiseGlobe` ID beats a bare element selector, so width and padding were already safe — but the globe rule never mentioned margin. 10px of bottom margin under a 38px button makes its margin box 48px, and `align-items: flex-end` aligns MARGIN boxes, so the button rendered 10px above the panel it is meant to sit level with. That 48 is the dock height in the diagnostics. Fixed with an explicit `margin: 0`.

**The drift in MPFS (native only).** `positionAbovePlayerControls` measured `.plyr__controls` with `getBoundingClientRect()` and wrote the result as an inline `bottom`. Plyr hides that row by translating it down 100%, and the function re-runs on a MutationObserver watching **body class changes** — `scray-paused`, `scray-scrubbing`, `scray-guides-awake`, `keyboard-active`, all of which fire while you swipe. Measured mid-animation, `rect.top` is wherever the row has slid to, so every swipe wrote a different bottom and the pair walked up the screen.

It now subtracts the row's current `translateY` (read off the computed transform matrix) to get its resting box, and refuses any reading that falls outside a sane band rather than writing a number that would put the buttons off-screen. Picker has no equivalent function — its MPFS offset is pure CSS — which is why this half was native-only.

**Testing lesson worth keeping.** 13.119's headless test passed on a bare page with no app stylesheet loaded, which is precisely why it could not see a rule in style.css clobbering the button. The test now loads each app's real style.css before disguise.js, at the 402×812 viewport from the diagnostics, and asserts the dock's height as well as the alignment — it reproduces 78x48 against the old build and 78x38 against the new one.

Also: the explanatory comment for this fix used backticks again, inside the same JS template literal that 13.115 got caught by. Same parse error, caught the same way. There is now a check in the test run that counts backticks inside the CSS block.

### picker 13.119 / native 13.113 — test: anchor buttons drifting in MPFS
<!-- 2026-09-14T12:46Z -->

Mac's name for the 🌐 and COL pair, from here on: **the anchor buttons**.

In MPFS they crept up the screen on every swipe, and 🌐 sat well away from COL rather than beside it.

**Cause.** 13.115 placed 🌐 by measuring COL's `getBoundingClientRect()` and writing the result as `left`/`top` on an absolutely positioned child of a `position: fixed` root. Those are two different coordinate systems on iOS: `getBoundingClientRect()` reports against the **visual** viewport, while the absolutely positioned child is laid out against the **layout** viewport. They agree until Safari's toolbar collapses under a swipe — then each re-sync wrote a number from one system into the other, and the error compounded with every swipe. Exactly "crawling up the page".

**Fix: one positioned element, no coordinates.** A new `#scrayDisguiseDock` is the only thing that is positioned. It carries every rule that decides where the pair sits — desktop top-right, phone bottom-right, the Native lift, the landscape lift, and the MPFS lift that Native writes on it as an inline style (`positionAbovePlayerControls` retargeted from the control to the dock). COL and 🌐 are flex children of it, so 🌐 sits left of COL because it comes first in the DOM, and which edge they line up on is the dock's `align-items` — `flex-start` on desktop, `flex-end` on phones. Nothing is measured, so there is nothing left to drift, and the `visibility: hidden` placeholder 13.115 needed is gone with it.

This is what 13.115's comment argued against ("five rules that would otherwise have to be kept in step by hand") — the answer is not to mirror those five rules onto a second element but to have only one element carrying them, with the other laid out relative to it by the layout engine.

Two details worth keeping: the dock is `pointer-events: none` so the gap between the two buttons isn't a dead zone over the page (both children opt back in), and the tap-off-to-collapse handler now tests `dock.contains` rather than `control.contains`, or tapping 🌐 would collapse the panel.

**Tested** in headless Chromium at 390×844 and 1400×900, both apps: 🌐 sits 6px left of COL, bottom-aligned on the phone and top-aligned on desktop, both collapsed and expanded; neither moves when the page scrolls 900px.

### picker 13.118 / native 13.112 — test: full-width search field while typing, autoscroll to the stats line
<!-- 2026-09-14T12:08Z -->

Two refinements to 13.117, both from Mac watching it on the phone.

**The field takes the whole top row while focused.** `.floating-tag-search-wrap.is-focused` goes `position: absolute`, 8px in from each side of `#floatingTagPillsBar`, at 2rem. The rest state is untouched. It is taken OUT of the bar's flex flow rather than grown in place: grown in place it would push the bar to a second row mid-keystroke, and the bar's height is what the autoscroll measures to decide where the list starts — so the list would step down the screen as you typed. Out of flow it simply covers the tag, score and exclude pills, which come straight back on blur.

Two traps in that block. The containing block for an absolutely positioned child is the *padding* box, so `left: 0` sits flush to the screen edge rather than inside the bar's 8px gutters — hence the explicit insets. And `sizeSearchPill` writes a measured px width as an inline style on the input; at full width the term no longer decides the box, so the focused rule needs `width: auto !important` to beat it.

**Autoscroll lands on `#videoStats`** rather than the sort buttons. Mac's reasoning: the sort buttons only respond with the term at rest, so a row of controls that does nothing mid-type is a row of viewport spent on nothing. The count line is what you want first, with rows immediately under it.

`scrayScrollToResults` now also measures the focused field, not just the bar: focused, the field has left the bar's flow and is taller than it, so the bar's own rect no longer describes what is covering the top of the screen. Whichever reaches further down sets the clearance.

### picker 13.113–13.117 / native 13.107–13.111 — test: NOTE excludes, index naming, COL nav, 🌐 button, corner rows, filter autoscroll
<!-- 2026-09-14T09:48Z -->

A run of UI work. Grouped because each bump was a small increment on the one before, and two of them were fixing the bump before.

**NOTE exclude cycle (13.114 / 13.108).** Tapping a note chip in the cloud on the index page cycled off → include → off; on the bookmarks page it cycled all three. `scrayFacetExcludes` was declared with `studio`, `performer` and `stashtag` only, so `scraySetExcluded('note', …)` was a no-op — and the bookmarks page happens to create its own note set, which is why only it worked. The excludes object is now gap-filled from `SCRAY_FACET_CLASSES`, the same way the includes already were, so the next class added gets both halves without anyone having to remember that file.

The exclude pass in `getFilteredVideos` also had the bug the include pass had in 13.112: `note` fell through the ternary to `stashTagList`, and an early `if (!p) return true` waved every video with no StashDB row past its note excludes entirely. Notes are now tested before that guard, off the video's own bookmarks.

**"index".** Mac's name for the main list + player screen, as against bookmarks and whatever comes later. Nothing needed changing — `scray-bugreport` already reported `page: index.*` — so this is a naming block at the top of each index file and the nav labels below.

**COL nav.** Native's floating menu read "Native", which names the app rather than the page; it is now "Index", with a "Picker" entry between it and Bookmarks. That entry carries an `open` function instead of an `href`, because Picker lives on the web and pointing the WKWebView at it would replace the app with it — it goes to the in-app browser instead, which is what the corner "P" always did. Picker's own entry is "Picker index" rather than plain "Index", so the two menus stay distinguishable.

**🌐 browser button (13.114, fixed 13.115).** An always-on-top blue button pinned left of the COL panel. Native's corner "P" is retired into the hidden park; on the web it opens browse.html.

The first attempt made it a child of `#scrayDisguiseControl`, positioned outside that box with `right: 100%`. Invisible on phones: the control carries `overflow-y: auto` so a tall expanded panel can scroll in landscape, and an overflow ancestor clips absolutely positioned descendants that sit outside its box. It is now a child of `#scrayDisguise` (the full-viewport root, no overflow) with a `syncGlobe()` writing `left`/`top` from the control's `getBoundingClientRect()`.

That is a measurement, not a mirrored copy of the control's offsets, on purpose: desktop top-right, phone bottom-right, the Native lift, the landscape lift and the MPFS lift are five rules, and the MPFS one is an *inline* style Native writes at runtime, so it could not have been mirrored in CSS at all. It re-syncs on collapse/expand, rotation, keyboard, fullscreen and any resize of the panel, and starts `visibility: hidden` until the first placement lands so it cannot flash in the corner.

Worth knowing for next time: that CSS lives inside a JS template literal, and the first version of the explanatory comment used backticks. It would have thrown at parse time and taken all of `disguise.js` with it. `node --check` caught it before it shipped.

**Corner rows.** Native: 🔍 X R > H B(#) < H(#), then X^T and B^x — those two were not in the requested sequence but were not asked for either way, so they keep their place at the end rather than disappearing. C and P are gone. Picker: L, R^, C and T retired, F is now 🔍 and sits first to match native. Everything retired is `display: none` rather than deleted, because handlers bind by id and a missing element is a silent dead listener. The corner row's right-hand reserve grew by 33px so the 🌐 cannot cover the last button.

**Filter autoscroll (13.116, fixed 13.117).** Typing in the filter should park the results where you can watch them narrow. 13.116 changed the scroll at the end of `filterDisplayedByFilename` — the wrong function. The input handler deliberately sets `skipSearchScroll` before every keystroke to suppress that one; what actually runs while typing is `scrollListIntoViewForFilter`.

That function was broken, and had been since 13.84. It anchors on `#searchFilterRow`, which style.css hides with `display: none !important` under 1024px — the width at which this function is the only thing that runs. A `display:none` element measures as all zeros, so the target came out as `pageYOffset - 80` and every keystroke nudged the page *up* by 80px. Both call sites now go through one `scrayScrollToResults()`; the typing one is instant rather than smooth and repeats across four frames, because the list re-renders underneath as the filter narrows and pulls the scroll back down. Its gate widened from mobile-portrait-only to everything except landscape-on-a-phone, where the list is in the side panel and scrolling the page behind it achieves nothing.

**A latent bug found on the way.** `skipSearchScroll` is a one-way latch: forty-odd places set it `true` meaning "not on this refresh", and exactly one ever set it back — inside a `setTimeout` on the clear-filters path. So the first player open, history panel or sync of a session killed that scroll permanently. It is now consumed on read, which is what every caller assumes. **Watch for:** other filter actions (tag picks, clears) now scroll where they had silently stopped. If anything feels jumpy, this is the change to look at.

### picker 13.42 / native 13.42 — test: standard line-clamp beside -webkit-line-clamp
<!-- 2026-09-10T18:26Z -->

Mac's editor showed two yellow warnings in each app's style.css. Both came from the two-line clamps: the list's name columns (13.22) and the bookmarks page's note column (13.37). Each used `-webkit-line-clamp: 2` with no standard property next to it, which the CSS linter flags as "Also define the standard property 'line-clamp' for compatibility".

**Fix.** A `line-clamp: 2;` line goes straight after each of the four `-webkit-line-clamp: 2;` lines, two per file. It changes nothing on screen: Safari and Chrome still clamp through the prefixed property together with `display: -webkit-box` and `-webkit-box-orient`, and browsers that don't know the standard property skip it. The diff is exactly those four added lines.

Picker's 13.41 (size matching) is still awaiting its test. This bump sits on top of it.

### picker 13.40 / native 13.40 — stable: keep/delete taps with ▶ preview, saved delete list, checkout progress, screen-on and ring over Native
<!-- 2026-09-10T17:10Z -->

Mac's feedback on 13.39, plus three native requests once it was clear the IPA needed rebuilding anyway.

**Why checkout said "too old".** The installed IPA predates 13.19's Swift. The page found `ScrayBridge` (13.18's shim) but no `enqueueDownload`. The Swift in the repo has had it since 13.19, so a rebuild is all checkout needs. The new native pieces below ride along with that rebuild.

**Main list: taps are keep ↔ delete only.** The third tap opening the row was confusing, so rows never open in the mode now.
- **▶ column.** A new column before the score holds ▶, which previews the copy on the phone through `scray-video://`, as old step 1 did. It works for every device file, catalogued or not.
- **Folder groups.** A group line's tap marks the whole folder. That leaves nothing to open it with, so the group's cell holds ▸/▾ instead, which is let through to the line's own open handler.
- **Layout.** The column is a `--lc-cols` override under `body.scray-wholesale-mode`. The header gets a blank cell, re-added when a heading tap redraws the header (`scrayRefreshMainListHeader` wrapped).
- **Rows open from before.** On entering the mode `scrayOpenListRows.main` is cleared, since an open row would have no way to close.

**Saved delete list.**
- **What Save does.** Save now switches to `view = 'deletes'`, which shows only rows whose device paths the last Save marked (`savedPaths`). It stays on the full list when nothing is marked.
- **Un-marking.** An un-marked row stays on screen as keep, with Save reverting to "Save *", until the next Save drops it. A tap never makes a row vanish under your thumb.
- **Show all / To delete** switches the view. It's stored in localStorage (`scrayWholesaleView`).
- **Scope.** The filter only applies to main-list builds (the same `listCall` flag), so X still plays from everything on the phone.
- **Mark bar layout.** It wraps to two rows: the marking pair, then Save / view / ↻.

**Checkout: overall progress.** `#coOverall` reads "42% · 3 of 10 videos" above the bar. The percentage is by bytes, like the ETA, so a large file halfway through counts for more than a small one done.

**Native: ScrayRunMonitor.swift (new) and ScrayBrowser.swift.**
- **Heartbeat.** The page sends `runStatus({ active, phase, done, total, bytesDone, bytesTotal })` at most every 700 ms while running, and `active: false` last, after the library refresh. Leaving the page mid-run sends `active: false` on `pagehide`. An older build without `runStatus` gets a pre-flight note rather than a block.
- **Screen on.** `isIdleTimerDisabled` is held while the heartbeat is fresh (30 s timeout) or anything in the download centre is active. The monitor only releases its own hold.
- **Ring.** `ScrayRunRing` is added to the key window while busy and the browser isn't showing. It sits top-right, 56 pt under the safe area. It shows the run's byte percentage with done/total, or the active downloads' combined progress when there's no fresh heartbeat. Tapping it calls `ScrayBrowser.shared.resume()`.
- **Parking the page.** On dismiss, if a run is live, the page's WKWebView is moved into a view at index 0 of the key window, behind the app. Out of any window it's a hidden page to WebKit: timers throttled, process suspendable. The pacing loop would stall after the files in flight, because nothing would start the next one.
  - **Getting it back:** `viewWillAppear` unparks, then re-adds the current tab (`selectTab`) if its web view isn't in `webContainer`.
  - **Also unparked** on `active: false`.

**Tested** (JS only; the Swift has not been compiled here, since there's no iOS toolchain in this environment) in headless Chromium at 390×844:
- **Taps:** they toggle and never open, by click and touch.
- **▶ column:**
  - It sits before the score, and the header lines up cell for cell with no overflow.
  - ▶ previews catalogued and uncatalogued files without marking them.
- **Groups:**
  - The line marks the whole folder, and ▸ opens it without changing marks.
  - A member tap marks just that file (group partly marked), and the line then goes all, then none.
- **Saved list:**
  - Save shows only the marked file, and un-marking keeps the row and unsaves.
  - Show all brings everything back, and the mark bar is two rows with no clipped labels.
- **Earlier checks:** all the 13.39 random, basket, filter and persistence checks still pass.
- **Checkout:** the overall line reads "100% · 2 of 2 videos". Heartbeats go active (with downloading progress) and then a single `active: false` last. There's no rebuild note when `runStatus` exists.

**Worth watching on the device.**
- **Parking:** that a parked page keeps its timers running. If runs still stall with the browser closed, the parking is what to revisit.
- **Ring position:** that it doesn't sit on something Native draws top-right. ⚙️ `ringTopOffset` / `ringTrailingInset`.
- **App in the background:** switching apps or locking the phone still suspends everything. Screen-on only stops auto-lock.

### picker 13.38 / native 13.38 — stable: bookmark name on the loading page
<!-- 2026-09-10T15:24Z -->

Mac asked for the bookmark's name on the loading page when Xb plays a random bookmark, or when any video is played from a bookmark.

**What shows.** A line under the orange source label ("Random bookmark", "Random @ 45%" and so on) and above the path: 🔖, the note in a light BM purple, then "@ time". An empty note reads "no note" in grey italic. The note goes through `scrayMapName`, so it matches the NOTE cloud and the Note column. It's escaped, since notes are free text.

**What counts as "from a bookmark".** `scrayLoadingBookmarkFor(video, startAt)` in player.js, run once per `playVideoInline`:
- **The video carries `__bmStartAt`** (with no explicit start): bookmarks-page rows, Xb's clone, and anything that plays one of those clones again, such as P, the open-row title, > and <, and history/basket entries added from the bookmarks page.
- **An explicit `startAt` equal to one of the video's bookmark times, to 0.01s:** the BM modal's jump on a video that isn't the one playing, which passes the real video plus a time. The tolerance is tight on purpose: R@% also passes an explicit start (a random fraction of the duration), and a loose match could have named a bookmark it merely landed near.

**Why a global.** The result goes on `window.currentLoadingBookmark`, set right after `resolvedStartAt` and before the preview card, and `scrayLoadingBookmarkLine()` renders it. All three places that build the overlay add the line: `scrayShowPreviewTitle` (the preview delay card), `playVideoInline`'s own card, and the `'progress'` handler, which rebuilds the overlay on every buffered-range update and would otherwise drop the line a moment after it appears. It's the same reason the source label lives on `currentLoadingLabel`. Every play sets it, so a plain play after a bookmark play clears it.

**Tested** in headless Chromium at 390×844, both apps, on the real index page:
- A plain play shows no line.
- A bookmark clone shows "🔖 kiss @ 1:10" on the preview card and still on the loading card after the load starts. A plain play afterwards clears it.
- An explicit start on a bookmark time names it ("dance @ 5:00"). An empty note shows "no note". A note with HTML in it shows as text.
- An R@% start that isn't a bookmark shows no line and keeps its label.
- Xb shows "Random bookmark" plus the picked bookmark's line.
- A `'progress'` rebuild keeps the line.

**Worth watching.** A bookmark jump within the video already playing doesn't load anything, so there's no loading page for it to appear on.

### picker 13.37 / native 13.37 — stable: bookmarks pages rebuilt on the main list, Note column, NOTE cloud
<!-- 2026-09-10T15:11Z -->

Mac asked for three things:
- bring the bookmarks pages up to date with everything done on the main page,
- add a column holding the bookmark's note and time together, sorting by note name,
- give the page the main page's tag selectors (AT / STU / PERF / STAG), and turn the note cloud into a modal selector like those, with its selected notes shown as floating pills.

**Why a rebuild rather than a port.**
- bookmarks.php / bookmarks.html were copies of the index shell from before the 13.20+ series. bookmarks-page.js drew its own list (`#bmList`) with the old `buildVideoRow`, and ran its own sort buttons, note cloud, R and X.
- Porting every list change into that second copy would have left two lists to keep in step forever.

**Now the page is the main page's shell, and the main list's pipeline works on bookmarks.**
- **Shells.** bookmarks.php and bookmarks.html are regenerated from the current index.php and index.html. The only differences:
  - the title and h1,
  - bookmarks-page.js added to the script list,
  - a NOTE button after STAG,
  - a Time sort button after Created,
  - "No. random bookmarks",
  - Picker's footer link goes back to the Picker.
  So the page picks up the current basket toolbar, X<sup>T</sup>, the filter row, and so on. The old inline `<style>` block, `#bmList` and the hidden `#taggedVideosContainer` are gone.
- **Entries.** One per bookmark: a shallow clone of the video carrying `__bmStartAt` and `__bmNote` (the note after `scrayMapName`). This is the same idea as before. `playVideoInline` starts at `__bmStartAt`, so P, the open-row title, > and <, and X all open at the bookmark.
- **The main functions are pointed at the entries.** bookmarks-page.js replaces four top-level randomiser.js functions on window. Their global bindings are window properties, so randomiser's bare-name calls reach the replacements.
  - **`getFilteredVideos`:** the main filter runs on the videos as usual (tags, facets, excludes, toggles). The result is then expanded to bookmark entries and the note filter applied. So the list, R's random list and X all get bookmarks with no changes of their own. The old R and X overrides are gone.
  - **`matchesSearchQuery`:** the search box also matches the note.
  - **`updateVideoStats`:** the stats line reads "Bookmarks: N | Videos: M". It also keeps the last filtered set for the player's Xb (`scrayFilteredBookmarkEntries`). That returns null when no filter, search or exclude is armed, as before.
  - **`scrayFacetCounts`:** the clouds count bookmarks, and only over bookmarked videos, so a studio's number is how many bookmarks picking it gives.

**Note column (render.js).**
- **Column.** A new `lc-note` column def (key `note`), plus `scrayListNoteCell`: the note in BM purple (italic grey "no note" when empty), then the time, clamped to two lines like the name columns.
- **Where it shows.** `SCRAY_LIST_COLUMNS_FOR` is now exposed on window, and bookmarks-page.js inserts `lc-note` after `#` for the main and random lists on that page only. A group row gets a blank note cell to keep the grid aligned.
- **CSS.** `html.scray-bookmarks-page` sets a seven-column `--lc-cols`. html rather than body, so the grid is right on first paint.
- **Sorting.** Sort keys `note` (text, asc first) and `bmtime` (numeric, asc first) are added to `SCRAY_LIST_SORT_KEYS`. The Note heading sorts by `note`; the Time button uses `bmtime`, keeping the old page's timestamp sort. Nothing on the main list carries either field, so neither key ever moves a video there.
- **Per-bookmark behaviour.**
  - An entry's row key is `id@time`, so opening one bookmark doesn't open every bookmark in that file.
  - `scrayGroupKeyFor` returns null for entries, so bookmarks are never folder-grouped.
  - The open row gains a "Bookmark: note at time" line.

**NOTE cloud and pills.**
- **Notes as a facet.** 'note' is a fifth facet class: `scrayFacetFilters.note` / `scrayFacetExcludes.note`, with meta `{label: 'Notes', pill: 'floating-tag-note'}`. So `showTagCloudModal('note')` needs no changes: search, sort count/A–Z, the tap cycle (off → include → exclude → off), Clear notes, and a live refresh. "(no note)" is a pickable value.
- **How notes combine.** Picked notes match ANY of themselves, since a bookmark has one note and ALL could never match. They always narrow what the tag and facet filters leave, whatever intersect is set to. An excluded note drops its bookmarks.
- **Pills.** `updateFloatingTagPillsFromCommon` lives inside `populateTagDropdowns` and only knows its four classes. A MutationObserver on the bar adds note pills after each repaint, before the intersect, clear and search pills, and is idempotent. There's a purple include pill, and a "− note" exclude pill with a purple edge. Tapping either removes that filter.
- **Clear and counts.** `scrayTotalFilterTerms` counts notes, so intersect and Clear all appear at two terms. `scrayClearAllFilters` and `clearAllFilters` clear notes too.

**Tested** in headless Chromium at 390×844 on each app's regenerated bookmarks page, with a seeded catalogue (4 videos, 6 bookmarks, one video without any):
- **List:**
  - Six rows, none for the unbookmarked video.
  - The header reads # NOTE STUDIO PERF FILE ★ SIZE, and the seven-column grid doesn't overflow.
  - The stats line reads "Bookmarks: 6 | Videos: 3".
- **Sorting:** the Note heading sorts dance, dance, finale, kiss, kiss, no note. Time sorts by time.
- **NOTE cloud:**
  - It lists dance(2), kiss(2), (no note)(1) and finale(1).
  - Picking kiss filters the list live and adds a purple pill, and search narrows it further. Tapping the pill removes it.
  - A second tap excludes the note with a "− dance" pill; a third tap clears it.
  - Search matches notes.
- **AT cloud and Clear all:**
  - AT counts bookmarks: blonde(5), outdoor(2), brunette(1). Picking brunette narrows to that video.
  - Note + tag narrows within the tag.
  - The Clear all pill clears both.
- **Rows:** opening a row opens only that bookmark and shows its Bookmark line. Tapping the open title plays that bookmark: `main` context, its index, its start time.
- **R, X and Xb:**
  - R builds a random list of bookmarks with the note column, and X plays a random bookmark.
  - Xb returns null unfiltered and the two kiss bookmarks when searched.
- **Main list:** the row-tap suite passes in both apps. h/run4's two "tap the detail filename plays" checks now fail as expected, since 13.35 made that tap collapse the row.

**Worth watching.**
- Scope: the page reuses the whole main page, so anything that takes `getFilteredVideos` on it now gets bookmark entries: +B adds each bookmarked file once (the basket dedupes by id), and the landscape panel list. Basket and history entries added from this page carry the bookmark time, as they did before.
- Folder grouping doesn't apply on this page: a bookmark is a moment, not a file.
- The Note heading's ties keep filter order (created ↓ by default), not time order.

### picker 13.36 / native 13.36 — stable: no controls on scrubs, grid only while tapping
<!-- 2026-09-10T14:40Z -->

Follow-up to 13.35. Mac confirmed marker taps and the list-row swap. Scrubs were still raising the controls, and he refined the grid.

**Why scrubs still showed the controls.**
- `scrayScrubSeek.begin()` pauses the video while the finger drags (`SCRUB_PAUSE_WHILE_DRAGGING`), and 13.35's policy let any pause raise the bar.
- 13.35's harness drag didn't actually engage a scrub, so it missed this. The new harness asserts `scray-scrubbing` and a paused player mid-drag. Run against the 13.35 build, it fails on exactly these points.

**Fix.**
- **Paused only counts when it's a real pause.** `scrayControlsMayShow` now allows a show while paused only if `body.scray-scrubbing` isn't set. The class is added before `pause()`, and `end()` removes it just before `play()`, which clears `paused` synchronously.
- **Asked Mac:** should a real pause, e.g. a double tap in the middle zone, still raise the controls and pause menu? He chose yes.
- **Progress-bar drags too.** `begin()` now calls `window.scrayOnScrubBegin()`.
  - The touchstart capture records whether it raised a hidden bar (`scrayGestureRaisedBar`). If it did, e.g. a progress-bar touch that turned into a drag, `scrayOnScrubBegin` puts the bar back and drops the hold.
  - It also clears `scrayGestureInControls`, so the scrub's own touchmoves can't re-raise the bar through Plyr's container listener. Scrubs that start inside the hidden control-bar rect over the picture hit this.
  - A bar that was already up stays up.
- Net effect: controls come up only from a tap in the controls area (control bar or progress bar, markers included), a real pause, or a new video loading.

**Grid: only while tapping.**
- **Timing:** touchstart on the picture shows it. When the last finger lifts it lingers ⚙️ `SCRAY_GUIDES_LINGER_MS` = 300ms, the double-tap window, so it's still there for the second tap, then goes. Moving more than ⚙️ `SCRAY_GUIDES_DRAG_PX` = 10px (a drag) and scrub begin both hide it immediately.
- **CSS:** it no longer shows with the controls. `body:not(.scray-guides-awake) .fls-tap-guides` sets opacity 0 with a ⚙️ 0.1s fade, and the awake rule sets 1 with no transition. That replaces 13.35's rule, which only lifted it under hidden controls.

**Tested** in headless Chromium at 390×844 with touch, both apps, playing a muted blob video. MPB, MPFS and FLS:
- **Single tap on the picture:** the grid shows while the finger is down and is still up just after lifting. It's gone after 500ms, with the controls hidden throughout.
- **Double tap:** the grid is up between and after the taps and gone once they stop. The controls stay hidden and the video keeps playing.
- **Scrub on the picture:** the scrub engages (paused mid-drag). The controls are hidden and there's no grid mid-drag; after release they're still hidden and the video is playing.
- **Progress-bar drag:** the controls are hidden mid-drag and after release.
- **Taps that still raise the controls:**
  - A tap on the progress bar raises them with no grid, and they hide after 3s.
  - A tap in the controls area raises them.
  - A real pause raises them, with no grid.
  - A marker tap raises them with the tooltip visible.
- The 13.29–13.35 suites still pass: FLS peek/panels, strip, bookmark modal, marker taps.

### picker 13.35 / native 13.35 — stable (markers, row swap; scrubs revised in 13.36): controls policy on touch, marker taps raise the bar, list row tap swap
<!-- 2026-09-10T14:39Z -->

Three requests from Mac.

**1. In MPB, a marker tap showed nothing while the controls were hidden.**
- The tooltip rail lives inside `.plyr__controls`. A marker stops its own touchstart so the bar can't seek underneath it, and that also kept the touch from Plyr's container listener. So nothing raised the bar, and the rail was built inside a hidden one.
- Even when it did show, Plyr's 3s idle hide took the rail with it. In MPB, Plyr slides a hidden bar down 100%, so the `:has(#bookmarkTooltipRail)` opacity override wasn't enough.
- Mac's framing: treat the progress bar as part of the controls, so any tap on it raises the bar, which then hides as usual.

**2. Scrubs and double taps shouldn't raise the controls (all players).**
- The bar should only come up on pause or when a touch lands on the controls. The double-tap grid should still show.

**The controls policy, in player.js (top level, just above `createPlayerElement`).**

`scrayInstallControlsPolicy(plyrPlayer)` wraps the player's own `toggleControls`, right after `new Plyr`. Every show and hide Plyr makes goes through that method: from touches, media events, or its idle timer. So one wrapper covers all of them without fighting Plyr's listeners. On touch devices (`player.touch`), a hidden bar may only show:
- while paused,
- during the new-video load hold (`scrayVideoLoading`),
- while a tooltip rail is up,
- when the current event is a touch whose gesture started in a control area,
- when the phone's synthesised mouse events come within 1s of such a touch,
- on focus or keyboard events,
- or when our own code removes the class (`scrayShowControlsNow`).

Everything else is vetoed: Plyr's `loading` from a seek, its recent-touch-seek grace, taps on the picture. A veto only stops a show; it never hides. Mouse-only desktops keep Plyr's behaviour.

A **control area** is the rect of `.plyr__controls` plus `#permanentProgressBar` (markers included), with 6px slop.
- A hidden bar's `translateY(100%)` is taken back off, so the area is where the bar shows, not where it's parked.
- FLS writes the controls' transform inline, so Plyr's slide never applies there.
- The touch is classified once, at touchstart, by a document **capture** listener. That runs before anything on the player can stop the touch, which is why markers now work. A drag keeps its start classification.

What a touch does:
- **Control-area touch:** calls `scrayShowControlsNow`, sets `player.timers.controls` to hide after 3s, and holds the bar up for that long (`scrayControlsHeldUntil`). The hold exists because a progress-bar tap seeks, and the seek's `'playing'` made Plyr re-evaluate and hide the bar the instant it appeared.
- **Picture touch:** adds `body.scray-guides-awake` for 3s, extended by touchmove. A new CSS rule shows `.fls-tap-guides` under `.plyr--hide-controls` while it's set.

Hides are refused while a rail is up. `dismissBookmarkRail` removes the rail before it hides the bar, so the bar now goes when the tooltip goes, not before.

**Stuck `pressed`, found while testing.** Plyr sets `controls.pressed` on touchstart and clears it on the bar's touchend. Our buttons stop their touchend, so it stayed true. That pinned the bar up, and it let the next picture tap raise it through the pressed check. The capture touchend now clears `pressed` whenever a finger lifts, and the policy ignores `pressed` on touch (hover still counts for mice).

**Tested** in headless Chromium at 390×844 with touch, both apps, on each app's real page with a playing (muted) blob video. In MPB, MPFS and FLS:
- **Taps, scrubs and double taps:** the controls stay hidden for a tap on the picture, a scrub, and a double-tap seek. The grid wakes in MPFS and FLS.
- **Progress bar:** a tap raises the controls, and they hide again after 3s.
- **Marker:** a tap raises the controls with the tooltip visible. They stay up past 3s while the tooltip shows, and hide when it fades.
- **Pause and control area:** pause raises them, and so does touching the hidden control-bar area.
- 13.29–13.34's suites still pass: FLS peek/panels, strip, bookmark modal, and marker taps.

**3. Open list rows: taps swapped (render.js).**
- On an open row, the top line now plays, through the held-back P spec, stored as `li._scrayPlaySpec`. Tapping the expanded section's text lines collapses the row. A closed row's line still opens it.
- Buttons and tags are unchanged.
- The builder is shared, so this applies to the random list, history and basket rows as well as the main list.
- **Tested:** a closed tap opens without playing. An open tap plays (main context, index 2) and stays open. Tapping the detail filename or the stats line collapses without playing. B still works.

**Worth watching.**
- A single tap on the picture no longer shows the controls at all. To get them up: pause (double tap the middle zone), or touch the control bar or progress bar.
- FLS's single-tap frame-step zones only work while the controls are visible, so they now effectively need a pause.

### picker 13.34 / native 13.34 — test: tap a bookmark marker again to jump; lower, lighter MPB tooltip
<!-- 2026-09-10T14:38Z -->

Two changes to the bookmark markers on the progress bar.

**Tap the same marker again to jump (all players).**
- **Before:** a marker only ever raised the tooltip rail, and reaching a bookmark took a tap on its chip. Tapping a chip still jumps.
- **Now:** `renderBookmarkMarkers` remembers which marker the rail is up for (`raisedEntry`) and the rail element (`raisedRail`). A tap on the same marker jumps while that exact rail is still live: identity-checked against `#bookmarkTooltipRail`, and not mid-fade. Anything that replaced or removed it makes the next tap a raise again: a jump-to-next flash, the 5s fade, a tap on the bar.
- A tap on a different marker only switches the rail, so reading around a cluster never seeks. With a mouse, hover raises and a click jumps.
- **Touch:** the marker acts on `touchend`, like the chips. `handleDoubleTap` on `.plyr` preventDefaults a second touch inside 300ms, and iOS then drops the synthesised click. A quick tap-tap is exactly that case.
- **No double firing:** a click within 600ms of a handled touchend is ignored as the same tap. Only the click is skipped: a time lock on both events (the chips' `dataset.firing` pattern) would also have swallowed a quick second touch.

**Found while testing: in MPB the second tap couldn't reach the marker at all.**
- While a rail is up, `.plyr__controls:has(#bookmarkTooltipRail)` lifts the control bar to z 96, so its chips clear the pause-menu circles.
- In MPB the control bar's box reaches down over the progress bar (controls 652–737px, bar 717–737px at 390×844), so the lifted controls covered the markers.
- `body.portrait-inline:has(#bookmarkTooltipRail) #permanentProgressBar` now lifts the bar to 97 while a rail is up. It's MPB only:
  - MPFS already runs the bar at 999998, and an unscoped rule would have *lowered* it to 97.
  - FLS stacks both elements inline.

**MPB tooltip lower and lighter.** Both are CSS overrides of the rail's inline styles under `body.portrait-inline`, in a new block at the end of style.css:
- `margin-bottom` goes from 10px to −14px ⚙️, so the rail sits 24px lower, still clear of the control icons.
- Chip background goes from `rgba(0,0,0,0.85)` to 0.5 ⚙️.
- MPFS and FLS are unchanged.

**Tested** in the harness at 390×844, both apps, in MPB, MPFS and FLS:
- The first tap raises the rail with no seek, and a second tap on the same marker jumps. A tap on a different marker switches the rail without seeking.
- The chip still jumps. After the rail goes, a tap raises again.
- A quick double tap 120ms apart jumps. With the mouse, a click raises and a second click jumps.
- In MPB the rail moved from 622 to 646px, and the chip background is 0.5.

### picker 13.33 / native 13.33 — stable: keep the list where it was between FLS peeks
<!-- 2026-09-10T13:25Z -->

Mac found that after peeking, playing a video from the list and swiping up again, the page was back at the top rather than where he'd played from.

**Why.** Ending a peek puts the body lock back (`position: fixed; overflow: hidden`). That collapses the page, and the browser's scroll position goes to 0. When the next peek unlocks, nothing puts it back.

**Fix: `flsPeekScrollY`.**
- `setFlsPeek(false)` saves `window.scrollY` just before the lock goes back. That covers both ways a peek ends: playing a video and tapping the sliver.
- `setFlsPeek(true)` restores it last, once the page is unlocked and back at full height. It scrolls again on the next frame in case the first attempt was clamped.
- `resetManualRotation` clears the saved value when FLS ends. The first peek of a new FLS session falls back to Plyr's `fullscreen.scrollPosition`, which is where the page was when fullscreen began (Plyr keeps it for its own exit). So the first peek also opens at the list position you played from.

**Two things were undoing the restore.** Both were found by tracing every scroll in the harness.
- **`toggleBasket(false)` in basket-index.js.**
  - It pins the scroll position it saw on the next frame, so the page doesn't jump when the panel reflows. `setFlsPeek(true)` called it unconditionally to close any panel opened over FLS, while the page was still locked, so it pinned 0 a frame after the restore.
  - Peek now only closes history or basket if one is actually open.
- **`playVideoInline`'s mobile auto-scroll** (`#inlineVideoContainer.scrollIntoView`, smooth).
  - In FLS it runs on a locked page and scrolls nothing. But it's a ~400ms animation, and a peek inside that window let it carry the unlocked page to the top.
  - It's now skipped while `manualRotationActive`, because the player covers the page and there's nothing to bring into view.

**Tested** in the harness at 390×844, both apps, on top of the 13.29 peek/panel suite (all still passing) and the strip suite:
- **Play, then peek again:** peek, scroll to 700, then play from the list. The page is locked. Peeking again right away puts it at 700. This is deliberately inside the auto-scroll's window, which is where the scrollIntoView race showed up.
- **Tap the sliver, then peek again:** scroll to 350, tap the sliver, peek again. It's at 350.
- **New FLS session:** leave fullscreen, scroll to 450, enter FLS and peek. It opens at 450.

### picker 13.32 / native 13.32 — stable: now-playing "..." menu, lower bar, BM Add note
<!-- 2026-09-10T13:24Z -->

Four tweaks from Mac.

**1. The bar sits lower in FLS and MPFS.**
- There's a new ⚙️ `NOW_PLAYING_DROP_PX = 20` in player.js, next to `FLS_TITLE_EDGE_INSET_PX`. `applyFlsTitleInset` adds it, so the FLS edge moves from 20 → 40px on picker and 70 → 90px on native.
- In MPFS, `top` goes from `safe-area + 8px` to `+ 28px`, overridden at the end of style.css. The two are commented to stay in step.
- It moves the bar whether or not the strip is in it. With a video playing it always is.

**2. The bar's buttons now sit behind one "..." next to the filter pill.**
- **In the bar:** CSS hides the strip's `.compact-btn-group`, and the bar is now a wrapping row. The strip takes a full line, and the 🔍 pill and a new `.fls-np-more` "..." share the line under it. The "..." is styled like the pill.
- **The menu:**
  - `rebuildVideoInfoDisplay` leaves the full spec list on the strip as `_scrayButtons`.
  - `scrayNowPlayingMenuActions` builds the menu from that list each time it opens, so it can't drift from the strip. It gives the letters readable names: Play, Download, Score, Add/Remove from Basket (worked out from the basket at open time), Stash, Bookmarks. It also gives ★ and BM text colours you can read on the white menu.
  - It then opens with `showContextMenu`, already lifted above fullscreen since 13.30.
  - The button stops its own mousedown/touch events so the bar's rename-on-tap and the player's handlers don't see them.
  - `syncNowPlayingStripPlacement` keeps it straight after the pill.
- **MPB is unchanged:** the strip keeps its button row there and the "..." is hidden.
- **Not in the menu:** picker's in-app-browser "N" is added inside `createCompactButtonGroup` on a copy of the array, so it isn't on `_scrayButtons` and doesn't appear.

**3. BM modal: an Add note button between Save and Delete.**
- It only shows when there's a new-bookmark row, i.e. a playhead on this video. Tapping it focuses `#newBmNote` with the caret at the end.
- It fixes more than reach. The existing auto-focus on open runs after `await scrayBmSync`, outside any gesture, and iOS won't raise the keyboard for that. Focusing inside the tap does.
- It's `flex: 1.3`, nowrap, with 4px side padding, so "Add note" stays on one line and the four buttons stay the same height.

**4. BM modal: quick notes add to the note while you're typing it.**
- **When it applies:** only while the new-note field is active, tracked by `noteFieldActive`. That turns on when the field is tapped, typed in or opened with Add note, and off on blur.
- **What a tap does then:** the note is added to the end of what's typed (`"hello" + beta → "hello beta"`) and the field is re-focused, so the keyboard stays up. Outside that, a quick note saves straight away as before. Swap and delete modes still just fill the field.
- **Why it's read at the press:** on a phone the tap takes focus off the field before the click fires. So the state is read at touchstart/mousedown. On desktop, mousedown is prevented so the caret never leaves.
- **Auto-focus doesn't count:** it deliberately doesn't set the flag. On desktop that focus sticks, and every quick note would otherwise stop saving.
- The hint above the rail now mentions both behaviours.

**Tested** in the harness at 390×844, both apps:
- **Bar position and menu:**
  - MPFS bar top is 28px and the FLS edge is 40/90px, still right after a thicker rebuild.
  - No button row shows in the bar. The "..." sits right of the pill on the same line, under the strip, and receives taps.
  - The menu opens above the player with Play, Download, Score, Add to Basket, Stash, Bookmarks, then the usual items, still in fullscreen and with no rename.
  - Add to Basket adds, and the next open reads Remove from Basket. Score opens the score picker on top.
  - MPB keeps its row with no "...".
- **BM modal, with touch taps and with mouse clicks:**
  - The buttons read Save | Add note | Delete | Close on one line, all the same height.
  - Add note focuses the field. Typing "hello" then tapping beta and gamma gives "hello beta gamma", with the field still focused and nothing saved.
  - With the field blurred, a quick note saves and closes. Tapping into the field then a quick note fills it.
  - After the auto-focus on open, a quick note still saves. Swap-armed still fills.
- 13.29's FLS peek/panel suite and 13.30/31's strip suite still pass.

**Worth watching.** On iOS, whether tapping a quick note while typing dismisses the keyboard and brings it straight back, a visible flicker, rather than leaving it up. The re-focus happens inside the tap, so iOS should allow it either way.

### picker 13.31 / native 13.31 — stable: dark strip title, small text, B back in the strip
<!-- 2026-09-10T13:23Z -->

Follow-up to 13.30 from Mac's testing. He asked for three things.

**1. White text on black, like the old title.**
- 13.30 took the bar's dark background away and let the strip's light MPB look show at 50%. That is reverted: the bar keeps `rgba(0,0,0,0.5)`, its padding and its 0.5 opacity, exactly as the old title had them, and the filter pill sits on it again with no background of its own.
- Inside the bar the strip is transparent (its hover grey too), with no border.
- All text is white: crumbs, separators, filename, score and size all set their colours inline, so the rule is `*:not(button)` with `!important`. The buttons keep their own colours.
- The in-basket highlight on the filename was pale pink (`rgb(249,215,221)`), which can't take white text. In the bar it becomes the basket button's pink at 0.75. It's matched on the inline style string (`span[style*="249, 215, 221"]`), because that's all the highlight code writes.

**2. Oversized text on the first FLS entry.**
- **Not reproducible here.** Headless Chromium doesn't autosize text, so the fix below is untested on a device.
- **Cause, by elimination:**
  - Every size in the strip is in rem, and no CSS rule that reaches it in FLS makes it bigger.
  - That leaves iOS WebKit's text autosizing, which inflates small text in blocks it considers wide. The FLS player is laid out 844px wide before rotation.
  - The old title was exempt, because WebKit skips `nowrap` and `overflow: hidden` text. The strip wraps, so it isn't exempt.
- **Fix:**
  - `.fls-video-title` now has `-webkit-text-size-adjust: 100%`, which is inherited by the strip and the pill.
  - The strip in the bar gets an explicit `font-size: 0.65rem` (the old title's size, ⚙️) and `line-height: 1.3`. It was using MPB's 0.7rem.
- If it still happens, the next suspect is Plyr adding `viewport-fit=cover` to the viewport meta on its first fallback entry on iOS.

**3. B button instead of "Add to Basket".**
- `createCompactButtonGroup` swaps S into B's visible slot and moves B into the overflow as "Add to Basket", but only when the array has no S of its own. This is the same fix as 13.24 for list rows: the strip's button array (`rebuildVideoInfoDisplay`) now lists an S spec straight after B, so the swap is skipped.
- `visibleCount` goes from 5 to 6, and the desktop right-click slice changes from `slice(5)` to `slice(6)`, so the row reads **P D ★ B S BM …** and the overflow is unchanged.
- The S spec is a copy of context-menu.js's and needs to follow it if that ever changes.
- This is the same strip in MPB, so MPB gets B back too.

**Tested** in the same harness at 390×844, both apps. 13.30's checks plus these:
- **Look in the bar:** 0.5 opacity on the dark background, and the pill has no background. The strip is transparent with white text, no text is any other colour, font 10.4px, text-size-adjust 100%.
- **Buttons:** the row reads P D ★ B S BM …. B adds to the basket and the highlight turns the strong pink. The … menu has no Add to Basket.
- **FLS inset:** still holds for short and long names.

### picker 13.30 / native 13.30 — stable: now-playing strip as the FLS / MPFS title
<!-- 2026-09-10T13:22Z -->

Mac asked for the title in FLS and MPFS to be replaced by the now-playing bar, at 50% transparency, with the filter pill kept underneath it. The now-playing bar is `#currentVideoInfo`, the strip MPB shows under the player: folder crumbs, name, score, size, and P D ★ S BM ….

**Moved, not copied.** `syncNowPlayingStripPlacement` in player.js moves the strip itself into `.fls-video-title`, just above the pill, while `body.manual-rotate-landscape` or `body.portrait-fullscreen` is set. When both classes go, it moves the strip back directly after `#inlineVideoContainer`. A copy was ruled out:
- A copy would lose every listener.
- It would also go stale. `rebuildVideoInfoDisplay`, `updateNowPlayingBasketHighlight`, the rename/score refreshes and the "video info disappeared" watchdog all look the strip up by id. Moving it means they keep working wherever it sits.

**When it moves.**
- `syncVideoTitleBar` calls `syncNowPlayingStripPlacement` at its end. `updatePlayerStateClass` already calls `syncVideoTitleBar` synchronously on every mode change, so on exit the strip is back under the player before `computeBottomDock` measures it. A MutationObserver would have fired too late, after the dock had measured the strip inside the bar.
- A body-class MutationObserver catches any class change that doesn't pass through there.
- Picker's `ensureVideoTitleBar` removes an orphaned bar after a player rebuild. It now rescues the strip first. Native adopts the orphan instead, so the strip moves with it.

**FLS thickness.** The rotated FLS title is positioned from its own `offsetHeight`, and the strip is taller than the old one-line title and changes with every rebuild. So:
- Picker now has native's `applyFlsTitleInset` helper, with its 20px inset moved to a top-level `FLS_TITLE_EDGE_INSET_PX`.
- A ResizeObserver on the bar re-applies the inset in FLS whenever the bar changes size. It only writes `left`, which doesn't change the bar's size, so it can't loop.

**CSS.** Everything is keyed on `.fls-video-title:has(> #currentVideoInfo:not(:empty))`. With nothing loaded, the bar falls back to its plain filename.
- **Replacing the title:** the bar's filename text is hidden.
- **Transparency:** the bar keeps its base `opacity: 0.5`, which is what makes the strip 50% see-through. It also keeps its fade with the controls. Its dark background and padding are dropped, and the dark `rgba(0,0,0,0.5)` backing moves onto the filter pill so the pill looks as before.
- **Width:** the bar is `width: max-content`. Without it, MPFS's `left: 50%` anchor shrink-wrapped it to about 222px.
- **Undoing the page placement:** the strip is un-hidden from the fullscreen hide list. MPB's full-bleed width, the bottom dock's fixed position and the keyboard rule are undone. It gets `order: 0`, because MPB's `order: 2` had put it below the pill in the flex column.
- **Taps:** the strip is tappable in both modes, although the bar is display-only in MPFS. It stops taking taps while faded with the controls, unless a load holds the bar up, and during an FLS peek.
- **Rename:** the bar's rename-on-tap ignores taps that come from inside the strip. The strip's own filename still renames; its score, size and gaps don't.

**Popups.** The strip brings buttons into fullscreen whose popups used to sit under the player: …, folder crumbs and the tag-action modal, ★'s score menu. 13.29's lift list (`.basket-json-modal`, `.context-menu`, `.score-context-menu` and the rest, to 2147483647) now applies under `body.fullscreen-active` instead of only `body.scray-fs-panel-open`. The error overlays are still left out.

**Tested** in headless Chromium at 390×844, both apps, on each app's real index page with Plyr in its fallback fullscreen:
- **MPB:** the strip sits under the player.
- **MPFS layout:** the strip is in the bar above the pill, and the pill sits underneath it. The title text is hidden. The bar is 0.5 opacity with a transparent background, and the pill keeps its dark backing. The bar is 312px wide at the top.
- **MPFS buttons:** the strip's ★ is hit-testable and opens the score menu above the player, with no rename. The … menu opens above the player.
- **FLS:** the strip is in the bar, with its edge at the inset: 20px on picker, 70px on native.
- **FLS rebuild:** rebuilding with a long name made the bar thicker, and the edge stayed at the inset. Tapping the size span doesn't open rename.
- **Exits:** FLS → MPFS keeps the strip in the bar. Leaving fullscreen puts it back under the player and it re-docks.
- **Empty strip:** the plain title comes back.
- 13.29's FLS peek/panel checks still pass.

**Worth watching.**
- On native, the strip reaches the top-right clock in MPFS, and they overlap.
- The strip is 312px wide in fullscreen, against 390px in MPB, so a long name wraps to more lines.
- Native turns `.basket-json-modal-content` 90° in FLS. A tag-action modal opened from the strip there is turned like every other FLS modal, even though the strip itself reads upright.

### picker 13.29 / native 13.29 — stable: FLS peek, H and B panels over FLS
<!-- 2026-09-10T13:21Z -->

Mac asked to get rid of the pause menu's B modal (its own history / basket / … tabs) and use the ordinary panels instead:
- An "up" swipe in FLS slides the player up and out of the way, leaving a sliver of it showing, so the main page is usable while FLS stays on. Playing anything brings the player back down in FLS.
- A new **H** circle between F and B opens the normal history panel on top of FLS. **B** now does the same with the basket panel.

**The old modal is gone.** `showPlayerBasketModal` and `downloadCurrentVideoFromModal` are deleted from player.js in both apps. `#playerBasketModal` is still named in a few CSS selector lists and in the text-selection exemptions. Those selectors now match nothing and do no harm.

**Peek (`setFlsPeek`).** A physical rightward swipe is "up" for the rotated video. That branch of `stopScrub` used to do nothing.
- **FLS state stays on.** `manualRotationActive`, the fullscreen and the body classes all stay. `applyManualRotationStyles` puts `translateX(innerWidth − 28px)` in front of the rotation, so the box slides right and its bottom edge (which carries the progress bar) stays on screen. Coming back only removes the translate, so nothing has to be re-entered.
- **`body.fls-peek` gives the page back:**
  - The fullscreen hide list and FLS's black `body::before` now have `:not(.fls-peek)`, and so do the black body background and the hidden search bar. The page's own rules take over again. This was chosen over re-showing each element with a guessed `display` value.
  - The inline body lock (`overflow:hidden; position:fixed`, set on entering portrait fullscreen and again by Plyr's fallback) is saved and cleared, then restored exactly on return.
  - `#inlineVideoContainer` is still a full-screen fixed layer at max z. It and all its children get `pointer-events:none`, so taps reach the page.
- **Coming back.** `.fls-peek-catcher` is added as the player's last child and covers the sliver. A tap on it calls `setFlsPeek(false)`. It stops its own touchstart and touchmove, so the scrub and tap-zone handlers underneath never see those touches. `playVideoInline` ends a peek before loading, and `resetManualRotation` clears one if FLS is left.
- Picker's scroll-lock `touchmove` handler skips a peek.
- The swipe distance is the same 60px as swipe-down-to-exit. The sliver width and slide duration are the ⚙️ knobs `FLS_PEEK_SLIVER_PX` and `FLS_PEEK_ANIM_MS`.

**Panels over fullscreen (`scrayOpenPanelOverFullscreen`).** H and B call the panels' own `toggleHistory` / `toggleBasket`, so it's the same panel in its usual portrait layout. `body.scray-fs-panel-open` is followed by a MutationObserver on both panels and on the body's classes, not set at each call site. Panels close from several places (swipe, P, the backdrop), and this catches all of them. The class is only on while a panel is open, the page is fullscreen, and there is no peek. Stacking, bottom to top:
- FLS black backdrop, 2147483000 (unchanged)
- player, 2147483100 (FLS writes the inline z itself; CSS covers `#inlineVideoContainer` and MPFS)
- `#scrayFsPanelBackdrop`, 2147483500, dimmed; a tap closes the panel
- panel, 2147483600
- popups a row can open, 2147483647: rename/bookmarks, file-ops, score, tags, context menu, stash chips

The panels are left out of the fullscreen hide list only while the class is on. The FLS 0.75 fade on modals is turned off while a panel is open.
- **Native only:** it turns `.basket-json-modal-content` 90° in FLS, and that is undone under the class.
- **Error overlays are deliberately not lifted.** They aren't opened from a panel, and one left over from a failed load covered the panel in testing.

The circles work in MPFS too, so the MPFS swipe-down-to-exit now ignores touches in the panels. Scrolling a panel's list is a downward drag and was exiting fullscreen.

A peek closes any panel opened over FLS. While peeking, the corner buttons open the panels normally, at their usual z.

**Tested** in headless Chromium at 390×844 (touch), against each app's real index page with Plyr 3.7.8 in its CSS fallback (as on iPhone) and a generated webm. CDP touch events drove the gestures. All checks pass in both apps:
- **Circles:** F H B BM ★ RN − +.
- **Peek:** a rightward swipe on the video peeks and leaves translateX(362px). FLS classes stay. The page is hit left of the sliver and the catcher on it. Corner buttons show, the body is unlocked, the page scrolls, and a page drag keeps the peek.
- **Return:** tapping the sliver brings the player back and restores the lock and hides.
- **H:** history opens over FLS and the player drops to 2147483100. The panel and the backdrop beside it each get their taps. A modal opened from a row sits above the panel, upright and solid.
- **B:** swaps to the basket. A backdrop tap closes it, FLS stays, and the z is restored.
- **Peek with a panel:** peeking closes the panel over FLS. History then opens normally from the page.
- **Leaving a peek:** playing while peeking returns to FLS. FLS → MPFS from a peek clears it.
- **MPFS:** the panel sits over the player, and dragging down in it doesn't exit.

**Worth watching.**
- On the device: whether iOS's rubber-banding on the unlocked page during a peek fights the fixed player, and whether 28px is enough of a target.
- The basket panel opens under the sliver's 28px on the right. The sliver sits on top and a tap there brings the player back, not the basket row.
- While peeking the video keeps playing; nothing pauses it.

### picker 13.28 / native 13.28 — stable: group small files by folder
<!-- 2026-09-10T11:50Z -->

Small files from the same folder now show as one line for the folder. Mac's reason: small files tend to be watched together, and they were scattered through the list. Files under 100 MB that aren't matched on StashDB are grouped. The group line shows the folder in the studio and performer columns, "misc <100mb · N" where the filename would be, and the folder's total size. Tapping it shows an Add folder to basket button and the files, each an ordinary row. Mac chose:
- grouping in the main list and the basket only, in both apps; random and history stay ungrouped
- a group needs 2+ files, so a lone small file keeps its own line
- in the basket, small files from one folder are pulled together even if they were added at different times

**The rule** is `scrayGroupKeyFor` in render.js. A file qualifies when:
- its size is known and under `SCRAY_GROUP_MAX_BYTES` (100 × 1024²)
- it isn't yet-to-upload
- it isn't stash-matched, by either signal: `scrayHasStashMatch` (the server's matched set, the same one that colours S) or a scene name in `scrayStashNames`

The group key is the file's full folder path: the catalogue path on Native, so files at the top of the iOS folder don't all fall into one group. `SCRAY_GROUP_MIN_FILES` = 2 and `SCRAY_GROUP_LABEL` are ⚙️ knobs next to it.

**Order is real, not just drawn.** `scrayGroupVideos(list)` puts each group where its FIRST file sits in the given order, keeps the files' order within the group, and returns the reordered array. Next/previous in the main list play `paginationState.allVideos`, and the basket plays `basketVideos`. Both arrays are reordered so play order matches the screen.
- **Main list:** `scrayGroupMainList` runs after sorting, both in `renderPaginatedListSetup` and in `scrayApplyListSort`. A group therefore sits where its best-placed file would under any sort, and its files are sorted among themselves.
- **Basket:** it only syncs a list of keys, so nothing about grouping can be stored. `renderBasket` works it out every time. If that moves files, it writes the new order to `basketVideos` and calls `saveBasket()`. That call pushes the order out, except during a pull, which already suppresses pushes. Every device applies the same rule, so the result is stable.

**Main list rendering.**
- `appendVideoList` builds a group line when its first file comes past, with all its files inside, and skips the rest.
- `renderNextChunk` counts lines, not files (`scrayChunkEnd`). A group is one line and is never split across chunks. With 40 small files and 30 singles, the first 25 lines hold 64 files.
- Each file keeps its own `allVideos` position for play, looked up from `paginationState.indexOf`.
- Numbers count lines, and a group's files are numbered within the group. `cfg.number` on `scrayBuildListRow` carries the printed number. `removeRowFromLists` renumbers the same way.
- Open groups are remembered per list (`scrayOpenListGroups`), so a re-sort or re-render leaves them open.
- A group line is `li.lc-row.lc-group` with no `data-video-id`, so anything that looks rows up by video id skips it. `updateBasketHighlights` calls `scrayRefreshGroupBasketState`. A group line turns pink when every file is in the basket, and its button then reads "Remove folder from basket".

**Basket actions.** `scrayAddVideosToBasket` / `scrayRemoveVideosFromBasket` make one basket change, with one save, sync and redraw, instead of one per file. Added files go on top in the group's order, as `addToBasket` does. In the basket the group button only removes the folder. The group's # ticks or unticks every file in it.

**Dragging in the basket.**
- The group line is the draggable element, carrying `dataset.index` (its first file) and `dataset.count`. The files inside aren't draggable, and a long press on one drags the whole group.
- The drag code now uses basket positions from `dataset.index`/`count`, not the element's position among `li[draggable]` (a group is one element holding several files).
- It splices `draggedCount` files.
- A drop anywhere inside the block's own span does nothing.
- This applies to both drop paths: the desktop drop and the touchend.

**Tested** in the harness at 390px, both apps:
- **Main list:**
  - Groups sit at their first file; lone, stash-matched and large files keep their own lines.
  - `allVideos` has group files together.
  - The group line cells and the numbering are right.
  - Tapping opens the group; its files are numbered 1–3 and open and play at their `allVideos` position.
  - Add folder adds all three in order, the button flips and the line turns pink. Remove folder takes them out.
  - After sorting by size, the group sits at its biggest file and stays open.
  - Chunking gives 25 lines = 64 files, and the next chunk continues numbering at 31.
  - Delete renumbers.
- **Basket:**
  - Files added apart are pulled together, and the array and localStorage follow.
  - The group drags as a block and its files don't drag.
  - The # ticks both files.
  - Playing a group file uses its basket position.
  - A real mouse drag moved the group below another file as a block.
  - Remove folder works.
- All earlier list, panel and toolbar checks still pass.

**Worth watching.**
- Deleting one file from a group updates the list, but the group line's count and total size stay out of date until the list next redraws.
- StashDB match data loads after boot. A file can leave its group on the next redraw once its match arrives, which may reorder the basket slightly.

### picker 13.27 / native 13.27 — test: no B button on basket rows
<!-- 2026-09-10T10:58Z -->

Mac found the B on an open basket row redundant, since the row is already in the basket. In 13.25, `scrayArrangeOpenRowButtons` had turned the basket's "Remove" spec into that B. It now drops the spec instead. A single row is removed by ticking its # and pressing Remove selected (13.26). A basket row's buttons now read **D ★ S BM R …**, and the More menu is unchanged: Move … Stats, Move to top, X.

The number of visible buttons is now counted up to and including R, not fixed at 6. That way a list without a B shows one fewer button in the row, rather than pulling "Move" out of the More menu to fill the gap. The main, random and history lists still show B D ★ S BM R ….

Checked in the harness, both apps: the basket row's buttons are D ★ S BM R … on one line, and the More menu has no Remove and no Add to Basket. The main-list, random, history and toolbar checks all still pass.

### picker 13.26 / native 13.26 — test: basket toolbar full labels, clear selection
<!-- 2026-09-10T10:57Z -->

Mac asked for three things in the basket toolbar: a Clear selection button next to ALL and REM, full names instead of abbreviations, and no push/pull buttons.

- **Native:** the ↑ push and ↓ pull (to Excel) buttons are gone, along with their handlers in basket.js and in basket-index.js's desktop clone. The toolbar is now Select all / Remove selected / Clear selection / More…. Native's basket stays on the device and the Excel backend is retired. The "💾 SAVE / 📂 LOAD … Excel" entries in the More menu were not part of the request and are still there.
- **Picker:** Mac chose to keep the playlist buttons, renamed in full: 📂 Load playlist / 💾 Save playlist / Select all / Remove selected / Clear selection / More…. wholesale.php carries a copy of the same markup and was updated to match.
- **Clear selection** (`#basketClearSelBtn`) is bound in basket.js and again on the desktop clone in basket-index.js. The "CLR - Clear Selection" item has been removed from both More menus in both apps, so it isn't in two places.

**Layout (≤768px).** The toolbar used to be flex, with fixed 36px icon slots. It is now a grid of equal buttons, and labels can wrap to two lines:
- Native's four buttons sit on one row.
- Picker's six sit three per row, over two rows. This is chosen with `.basket-tools:has(> button:nth-of-type(5))`, so both apps share the same CSS.
- Labels are 0.66rem. The rule is scoped under `#basketPanel` because the "base rules" block later in style.css sets `.basket-tools button` back to 0.7rem.
- The landscape rule that hides every toolbar button not on its list now includes the new button.
- The toolbar is taller than the 50px that `#basketList`'s `max-height: calc(100% - 50px)` allowed for. The list now sizes by flex (`flex: 1 1 auto; min-height: 0; max-height: none`) so the toolbar can't be pushed out of the panel.

**Tested** in the harness at 390px, for both apps:
- The labels are correct and none are cut off.
- Picker's toolbar is two rows and Native's is one.
- The toolbar sits inside the panel and the list ends above it.
- Select all, Clear selection and Remove selected all work.
- Neither More menu has Clear Selection.
- The 13.25 list checks still pass.

### picker 13.25 / native 13.25 — test: column rows for random, history, basket
<!-- 2026-09-10T10:56Z -->

The random list, history and basket now use the main list's column rows. Mac's choices:

- **Random:** the same six columns, still on the blue background. The headings don't sort, because the random list keeps the order it was drawn in, and that is also the order next/previous plays.
- **History and basket:** five columns (#, studio, perf, file, ★), no size.
- **Selecting:** in history and the basket, tapping the # ticks the row (it shows ✓ and turns yellow). History's checkboxes are gone, and tapping a basket row no longer selects it.
- **History time:** history's played time is only shown in the open row, not as a column.
- **Panel width:** both panels are now 80% of the phone width (they were 49%).
- **Basket squeeze removed:** the basket no longer squeezes the page to 51vw.

**One builder.** `scrayBuildListRow(video, index, cfg)` in render.js replaces `buildMainListRow`, and draws all four lists. `cfg` sets:
- `list`: which columns to draw and which open-rows set to use.
- `buttons`: that list's own button specs.
- `rowKey`: history passes its entry id, because one file can be in history more than once.
- `select`: makes the # a tick.
- `playedAt`: history only.

The main and random lists are built in render.js (`appendVideoList`, and `renderVideoList` for `#playlist`). history.js and basket.js keep their own button arrays and call the builder. The bookmarks page and the landscape panel still use `buildVideoRow`. `scrayOpenListRows` is now one set per list.

**Each list keeps its own actions, in one layout.** `scrayArrangeOpenRowButtons` puts any list's specs into B D ★ S BM R …:
- P is held back, and tapping the text calls it. So history's play still closes the panel, and the basket's still plays in basket order (closing the panel on phones).
- The basket's "Remove" becomes its B, since removing is what B does to something already in the basket. It is no longer in the overflow menu; "Move to top" still is.
- History and the basket call bookmarks "Bookmarks". It is renamed BM so it sits in the row and gets the bookmarked colour.
- The basket keeps its own R spec, recoloured. The other lists get a new one.

**Basket drag still works.** The row keeps `draggable` and `dataset.index`. `setupDragAndDrop` runs on the new `li`, and the header is a `div`, so the `li[draggable]` lookups skip it. A long press still starts a drag; a plain tap now opens the row.

**player.js.** `attachBasketPlayButtons` (run on DOMContentLoaded) adds a "Play Inline" button to every `#basketList li`. It now skips `.lc-row`, which would otherwise have gained a stray button.

**CSS.** The list block's selector is now `:is(#taggedVideosContainer, #playlist, #historyList, #basketList)`. `:is()` takes the specificity of its strongest member, so it still beats the old per-list id rules. Old rules that had to be undone:
- History and the basket were white bordered cards.
- History marked basket membership with a pink background on each span (`#historyList li.basket-added span`). The pink now goes on the row. Search highlights keep their colour because they carry an inline background.
- The basket's buttons were `flex: 1`, which stretched "…" to full width.
- `#basketPanel #basketList .compact-btn-group { gap: 15px !important }` needed the double-id `:is(#historyPanel, #basketPanel) :is(#historyList, #basketList)` to beat it. The panels' buttons are also packed a little tighter so all seven fit on one line at 80% of 390px.

Row backgrounds are set once for all lists, weakest first: open, then in the basket, then ticked.

**Squeeze removed.** All four `body:has(#basketPanel.basket-open)` squeeze blocks are gone: the ≤768 one, the two landscape ones (player and video info) and the portrait player/info one. The landscape loading-overlay rule stays. Other changes:
- `#basketPanel` is 80% in the ≤1024 block, and `#historyPanel` is 80% in style-index.css's ≤768 block. The two notes point at each other so the widths stay in step.
- When history is open on a phone, the corner buttons used to move to `calc(49% + 10px)`. They now stay where they are. The panel stops short of the bottom, so they sit below it. **This rule differs between the apps:** Picker's corner buttons sit at the left edge, Native's are centred (`left: 50%`). The first patch used the Picker value for both and moved Native's buttons.

**Tested** in headless Chromium at 390px with both panels in the page and the real history.js / basket.js / basket-index.js:
- Random: total, then header; six columns; headings don't sort; still blue; tapping the text plays with the `random` context.
- History: five columns, no checkboxes, panel 312px wide. Tapping # ticks the row without opening it. Only the tapped duplicate entry opens. The open row survives a re-render after ticking. The played time shows to the minute. R renames. Tapping the text plays and closes the panel. B adds to the basket and the pink is on the row, not on each span.
- Basket: draggable, with indexes. The page is not squeezed. Tapping the line opens the row without selecting it; tapping # selects. The buttons read B D ★ S BM R … on one line. The overflow has Move to top and no Remove. Tapping the text plays with the `basket` context. B removes the item.
- Corner buttons don't move when either panel opens, in both apps.
- The main list's earlier checks all still pass.

**Worth watching.** The history and basket panels haven't been checked on the desktop layout (the basket column, history at 25%). Rows there use the same CSS, so they should just be narrower.

### picker 13.24 / native 13.24 — stable: B basket button replaces P in open rows
<!-- 2026-09-10T09:50Z -->

Mac asked for P to become B (add to basket) in an open row of the main list, with "Add to Basket" removed from the overflow menu. An open row's buttons now read **B D ★ S BM R …**.

- **P's spec is removed from the array but kept.** The text tap calls that spec's `onClick`, so tapping the name still plays exactly what P did. The basket spec moves to index 0.
- **S is added here rather than by the button group.** Left alone, `createCompactButtonGroup` finds a B, swaps S into B's slot (index 0 now, which would push basket off the front) and adds a renamed "Add to Basket" just before X in the overflow. It only does that when there is no S in the array. Adding an identical S spec after ★ skips the swap entirely; S still gets its matched/unmatched colour, because `scrayApplyStashButtonColour` looks S up by label. The S spec is a copy of the one in context-menu.js, which is identical in both apps. If that one ever changes, this copy needs to follow.
- The right-click menu slices the same array from index 3 (S BM R Move …), so it also has no basket entry.
- Only the open row changed. `buildVideoRowButtons` and the random list and bookmarks page still show P and put basket in the overflow.

Checked in the harness for both apps:
- The buttons read B D ★ S BM R ….
- B adds to the basket and highlights the row, and a second tap removes it.
- B neither plays nor renames.
- Tapping the name still plays in the `main` context.
- The overflow menu has no basket entry and no second S. Picker's reads Move, Refresh Data, Refresh Folder, Open Link, Copy Name, F tally, Stats, X; Native's is the same without Refresh Folder.

### picker 13.23 / native 13.23 — stable: R rename button, tap name to play
<!-- 2026-09-10T09:49Z -->

Mac asked for two changes to open rows in the main list: tapping the name should play the video, and rename should move to an **R** button next to BM. P stays as it is for now.

- R is spliced into the button specs straight after BM, only in `ensureMainListDetail`. `buildVideoRowButtons` is unchanged, so the random list and the bookmarks page don't get an R. The visible count went from 5 to 6, so R shows in the row (P D ★ S BM R …) rather than in the overflow menu. It sits after S has swapped into B's place, and Native's in-app N button bumps the count on its own. R also appears in the right-click menu, because that menu slices the same array.
- A tap on the text of an open row calls the P spec's own `onClick`, so tapping the name and pressing P can never start different things. Only taps on `.lc-d-line` text count. A tap that misses a button and lands in the padding below the row doesn't start a video. Folder, bracket and StashDB tags (underlined, and they stop propagation) still do their own thing.
- The closed line still opens and closes the row. Nothing is renamed by tapping any more.

Checked in the harness, for both apps: the buttons read P D ★ S BM R …; tapping the name plays in the `main` context at the row's index and doesn't rename; R renames and doesn't play; P still plays; a tap in the padding does nothing; a folder tag doesn't play.

### picker 13.22 / native 13.22 — stable: tighter list columns, two-line names
<!-- 2026-09-10T09:48Z -->

Mac asked for more room in the column list: numbers against the left edge, names wrapping to two lines, and a narrower score column so the filename gets more width. Size is unchanged.

- **The # column.** The row's left padding went from 6px to 2px, and the column from 1.75rem to 1.5rem. Numbers and the header are now left-aligned. Number text is a fixed 0.6rem and no longer grows on an open row, because the column is only just wide enough for "1000." at that size.
- **Two-line names.** Studio, performers and file clamp to two lines (`-webkit-line-clamp: 2`) at line-height 1.2, with `overflow-wrap: anywhere` so filenames without spaces still break. `--lc-font` went from 0.68rem to 0.65rem: two lines are then 25px, which fits inside the unchanged 30px row. At 0.68rem it would still have fitted, but with only a pixel or two to spare. An open row keeps 0.75rem, and two lines of that (28.8px) still sit inside 30px.
- **The score column.** The header is now ★, and the column went from 2.5rem to 1.4rem, which is enough for "10" and "7.5". Column headers now carry a long `name` for the tooltip.
- **Where the space went.** The file column share rose from 1.7fr to 2.15fr, so the width freed by # and score goes to the filename rather than being split three ways. At 390px the filename is about 121px wide (it was about 96px), and studio and performers stay about 56px.
- The open row's indent follows the new # width: `calc(1.5rem + 8px)`.

Checked in the headless harness at 390px: a long row is still 30px tall, the filename wraps to exactly two lines, the number starts 2px from the container edge, "10" fits the score column, and there is no horizontal overflow.

### picker 13.21 / native 13.21 — stable: smaller text on closed list rows
<!-- 2026-09-10T09:47Z -->

Mac asked for smaller text on the new column list so more of each name fits, without changing the row height, and for open rows to keep the larger text.

- The size of the closed-row text is now one setting, `--lc-font`, on `#taggedVideosContainer`. It is 0.68rem (it was 0.75rem). The `#` and Size columns are set a little smaller than that, using `calc()` from the same value.
- An open row, including its top line, uses `--lc-font-open`, which is 0.75rem. The detail lines were already 0.75rem and are unchanged. Each row picks between the two through a per-row `--lc-cell-font`, so only `.lc-open` needs to switch it.
- The row height stays at `--lc-row-h` (30px), because that sets the line's min-height and doesn't depend on font size.
- New rule: spans inside a cell (search highlights) now inherit the cell's size. Before this, the older `#taggedVideosContainer li span { font-size: 0.75rem !important }` rule would have made a highlighted word bigger than the rest of its cell. That didn't show while the two sizes were the same.

Checked in the same headless harness at 390px: closed text is 10.9px, open-row text is 12px, both lines are 30px tall, and highlighted words match their cell.

### picker 13.20 / native 13.20 — stable: main list as columns, tap a row to open it
<!-- 2026-09-10T09:46Z -->

The main list (`#taggedVideosContainer`) now uses Wholesale step 1's compact layout. Each file is one line with six columns: `#`, studio, performers, file, score, size. Tapping the line opens the full row underneath it: path; studio / performers / title; filename [score] (size, duration); views · watched · played · created; and the button group. The random list, the bookmarks page and the landscape panel are untouched. Landscape is being dropped, since the app doesn't rotate.

**Studio and performers columns.** StashDB is used where it has a value. Otherwise the folder path stands in: every folder above the last one for studio, the last folder for performers. Each column falls back on its own, so a studio-only match still takes its performers from the folder. The path used is the catalogue path (`scrayResolvePathParts` on Native), with the top folder trimmed by `scrayNameCrumbs` the same way names are. Values from the path are greyed so you can tell they didn't come from StashDB. The sort reads the same `scrayListColumns()` the row draws with, so a column sorts by exactly what it shows.

**One sort for headings and buttons.** Mac chose a combined sort. Headings (studio, perf, file, score, size) and buttons (views, watched, played, created) all add keys to one ordered `scrayListSort`, in the order they were tapped. The first tap adds a key, the second reverses it, the third removes it. Once there are two or more keys, each arrow shows its rank (↓1, ↑2). Clear empties the sort. Some decisions worth keeping:

- **The boot default (created ↓) gives way to the first tap.** Left in place, a heading tap would only break ties between identical created dates. That never happens, so the tap would look like it did nothing. Tapping Created itself carries on cycling the default instead. The flag is `scrayListSortIsDefault`.
- **Nulls sort last in both directions**, as in Wholesale. An unscored file is not a zero-scored one. Views and watch time are counters, so a missing value counts as 0.
- **Ties fall back to the unsorted filter order** (`paginationState.unsortedVideos`), not to the previous sort. Removing a key puts rows back where the filter left them.
- **Each key is read once per video before sorting.** Studio and performers go through the StashDB name lookup, which is too slow to call on every comparison.
- Re-sorting keeps the current list depth, so a 200-row list isn't cut back to 25.

The old `current*SortState` variables stay declared because random-panel.js's landscape buttons still write to them. Their toggle and label functions in randomiser.js are gone. The `sortVideosBy*` helpers stay, since the bookmarks page uses them.

**The open row.** It is built the first time a row is opened, so a long list costs short lines rather than a button group per row. The button specs moved out of `buildVideoRow` into `buildVideoRowButtons`, so old rows and open rows share one set. Open rows are remembered by video id, which keeps a row open when a score, rename or sync re-renders the list. Only one row is open at a time (`SCRAY_LIST_ONE_OPEN`). Closing a row above the one you tapped scrolls by the difference, so the tapped row stays under your finger. Rename, which used to be a tap on the row, is now a tap on the open row's text. Right-click on a closed row still shows the overflow menu.

Lines 1 and 2 of the open row both use `createClickablePath`, so folder crumbs and StashDB chips keep their click behaviour. Each is passed a copy of the video:

- **Line 1** gets a `videoKey` that no StashDB row can match. Otherwise a matched video would print its scene name instead of its path.
- **Line 2** gets an empty path. Otherwise a studio-only match would repeat line 1.

**Things other code relies on.**

- The header is drawn inside the container as its first child, so it moves with the container in `desktop-layout.js`. `appendVideoList` adds it again whenever the container has been cleared.
- The `#` cell's first text node is still `"N. "`, so `removeRowFromLists` renumbers after a delete without changes.
- `patchScoreInLists` hands `.lc-row` rows to `scrayListRowSetScore`, which updates the column and the open row's badge. Without this it would have added an old-style badge span into the grid.

**CSS traps.**

- Column widths are in rem. The header font is smaller than the rows', and em widths put the header columns out of line with the rows.
- Buttons in the open row have to undo two older rules: style.css's full-width button rule on phones, and style-index.css's fixed 20px `.compact-btn`.
- The older `#taggedVideosContainer li` rules are `!important` on phones. The new rules beat them with an extra class.
- Sorted SCORE and SIZE headings are allowed to overflow to the left, into the empty space next to FILE, instead of cutting off.

**Tested** in headless Chromium at 390px, using the real render / randomiser / ui / file-operations / context-menu / style scripts with sample data for each app. 45 checks passed in each: column fallbacks, every sort path (default hand-off, multi-key ranks, reverse, remove, clear, nulls-last, button + heading together), open/close/accordion, rename vs button taps, P button context and index, a row staying open through a re-sort, score patch, renumber after delete, context menu, search highlight, basket highlight, and no horizontal overflow.

**Worth watching.**

- Six columns on a phone leave the filename about 16 characters. Adjust `--lc-cols` in style.css if the balance is wrong.
- Studio/performers from the path are only as good as the folder layout. A folder deeper than `studio/performer` puts the extra folders into the studio column.
- wholesale.php still has a hidden copy of the old five sort buttons. They are unbound and harmless.

### picker 13.15 / native 13.17 — test: a view now needs 10s of playback, not 20s
<!-- 2026-09-09T19:27Z -->

`SCRAY_VIEW_THRESHOLD_S` 20 → 10, so both gates now sit at ten seconds: ten
seconds of playback counts the view, stamps `last_played`, AND opens the
`time_viewed` gate. Mac's call after living with 20s.

Kept as two constants rather than collapsed into one, because they answer
different questions — "was this watched?" versus "is this worth measuring?" —
and either may want to move without the other later.

Consequence worth knowing: both now fire on the same `timeupdate` tick, so a
qualifying watch sends two pushes in quick succession (the view, then the
first time flush) instead of one. They're deliberately not merged — the view
fires once per load and the flush repeats, and folding them together would
tangle two different lifecycles to save one request.

### picker 13.14 / native 13.16 — stable: flush watch time as soon as the 10s gate opens
<!-- 2026-09-09T19:26Z -->

Follow-up to the entry below, found while testing it. `time_viewed` was only
sent every 60s of playback (plus on pause/end/next-video), so a watch that
ended abruptly anywhere between 10s and 70s — app killed, phone locked, tab
closed — recorded nothing at all. It also made the feature look broken during
testing: play a video, watch the database, see nothing for a full minute.

Now the first flush fires the moment the 10s gate opens, then every 60s after.
The condition is `!s.flushed || s.watched - s.flushed >= FLUSH_EVERY_S`, and
`scrayWatchFlushTime` still no-ops below the gate, so it costs one extra push
per watch and nothing else.

Also added `window.scrayWatchState()` — a read-only console peek at the live
session (filename, watched, flushed, viewCounted, listening). It splits the
chain cleanly when something looks wrong: `watched` climbing with `flushed`
stuck above 10 means the send is failing, not the measuring, which is exactly
the signature of an old api.php silently skipping an `add` field it doesn't
have in `$COUNTERS`.

### picker 13.13 / native 13.15 / browse 13.15 — stable: watch-gated view_count, new time_viewed
<!-- 2026-09-09T19:11Z -->

One change spanning all three repos. Existing view_count values are left
exactly as they are; only counting from here on changes.

**The problem.** `view_count` was incremented inside `playVideoInline` at the
moment a video was *loaded*, before a frame had played. Flicking through ten
videos recorded ten views. That noise also fed the "favour less-watched"
random weighting, so the weighting was partly measuring how often a file had
been skipped past.

**What counts now.** A watch session opens on load (`window.scrayWatchBegin`,
in player.js in both apps) and measures real playback off Plyr's `timeupdate`
stream:

- `SCRAY_VIEW_THRESHOLD_S` of playback → `view_count + 1` and `last_played`,
  once per load.
- `SCRAY_TIME_THRESHOLD_S` of playback → `time_viewed` starts accumulating,
  and the *whole* watched duration counts, including the seconds before the
  gate opened. It is a gate against skim-throughs, not a deduction.

(Both thresholds shipped at 20s/10s and are now 10s/10s — see the top entry.)

`last_played` moved to the same gate as the view deliberately: a three-second
skip-through should now leave no trace at all.

Playback is measured as the *step between* `timeupdate` readings, not
wall-clock. A step over 2s is a seek and contributes nothing; a negative step
is a rewind, same. Pausing needs no handling — `timeupdate` stops firing.
Seconds are on the video's own clock, so watching at 2x banks two minutes of
video per minute of your time, which is what "seconds of this video watched"
should mean.

Unflushed seconds are sent on `ended`, `pause`, `pagehide`,
`visibilitychange`, on the next video loading, and at intervals —
backgrounding the app on a phone is the ordinary way a watch ends and it
fires none of the first two. (Interval behaviour amended in 13.14/13.16
above.)

**time_viewed.** New INTEGER column on `videos`, created on first use by
`ensureTimeViewedColumn()` in api.php — same self-migrating pattern as
`ensureOfflineColumn`, because browse.html's query action is SELECT-only and
there is no console path for an ALTER. It travels as an `add` delta
(`add_time_viewed` → `op.add.time_viewed`), never an absolute: watched
seconds are summed across devices and plays, so there is no absolute for a
client to resolve to. Added to `$COUNTERS`, which is a hardcoded list rather
than a read of `$COLUMNS`, so it is writable on the very request that creates
the column.

On `merge` (api.php and rebuild.php) time_viewed is **summed**, not maxed like
view_count/f_tally — both rows' seconds were really watched. rebuild.php
guards on the column existing, since it also runs against backups that predate
it.

Appended to the *end* of `VIDEO_SCHEMA` in both apps, not slotted in beside
view_count where it reads better. That list is a column *order*; inserting
would silently re-label every column after it in years of exported CSVs.

**Native offline views.** `saveVideoMeta` used to drop play counters entirely
when offline, on the grounds that a view recorded on a plane and replayed days
later would land with the wrong `last_played` and inflate a count nobody could
account for. Both objections are now answered, so they queue like any other
op:

- `last_played` is stamped by `buildOp` at *enqueue* time, not push time — so
  the timestamp is when you actually watched it, not when the network came
  back.
- the double-count risk on replay is handled by op ids (below).

**Op-id dedupe.** Counter deltas are not idempotent: +1 applied twice is +2.
That was harmless while play counters were never queued for replay. Now that
Native holds them through an offline stretch, a push that succeeds on the
server but loses its response on the way back would be retried out of the
outbox and counted twice. Every op now carries an `op_uid` minted in
`buildOp` — minted *there* so the stored outbox entry presents the same id on
a replay; minting it at push time would defeat the point. api.php records it
in the new `applied_ops` table *inside* the push transaction, so a rollback
takes the id with it and the retry is a first sighting again. A repeat is
reported as applied so the client's outbox entry still clears. Ids older than
60 days are pruned on each push.

**Deploy order matters.** browse before the apps. An old api.php ignores both
`op_uid` (an unknown key) and `add: {time_viewed}` (a field not in its
`$COUNTERS`) and still returns ok, so the client clears its outbox and those
seconds are gone. Silent by design, and the reason `scrayWatchState()` above
exists.

**Surfaced in:** Picker's video stats modal ("Time watched", formatted, not
raw seconds); browse.html presets — added to All videos and Most played, plus
new "Most watched (time)" and "Watched vs length" presets. Native has no
stats modal (it doesn't load excel-sheets.js), so nothing to add there.

**Worth watching.**

- A video watched, then re-opened and watched again in one sitting counts two
  views. That is intended — two sittings — but it is a change from one view
  per load.
- `applied_ops` growth on the live database. Should stay small; the prune is
  a plain indexed DELETE on every push.

/**
 * scray-reels.js - TikTok-style mode. Same file in Picker and Native, like
 * scray-image-viewer.js.
 *
 * What it is: a full-screen overlay that plays videos one at a time - portrait, landscape or both, as the
 * overlay's orientation button is set (default both).
 * Swipe up for the next, down for the one before, tap to pause, Stop to leave.
 * It has its own <video> elements (the normal Plyr player is paused while it is
 * open) and three slots - the one before, the one playing, the one after - that
 * are moved by the finger and then rotated, so the next video is already
 * waiting when you swipe.
 *
 * Preloading is deliberately shallow: only the NEXT video gets preload="auto",
 * the one before gets metadata only, and a slot that is recycled drops its
 * source, so at most two videos are buffering. A swipe onto a video that has
 * not caught up yet shows a spinner and plays when it can.
 *
 * The mode ("armed") is separate from the overlay:
 *   - the orientation button's cycle (All > Landscape > Portrait > TikTok)
 *     arms it, which sets the orientation filter to what the overlay's orientation
 *     button is set to (portrait / both / landscape; both by default) and takes the
 *     "soft" tag out of the excluded tags (they go back when the mode ends),
 *     then starts playing a random video;
 *   - while armed, playVideoInline hands every video to the overlay
 *     (player.js scrayPlayReels), and only ones of that orientation play;
 *   - the videos come at random: the list is shuffled, starting with the one
 *     played, and reshuffled when it runs out, so it never ends;
 *   - gestures are MPFS's seek gestures: a horizontal drag scrubs (x3 in the
 *     bottom fifth), a horizontal drag on a paused video jogs frame by frame
 *     (128x / 64x / 32x by thirds, bottom to top), a double tap in the left
 *     or right half of the middle band seeks 3 / 10 / 30s back or on;
 *   - Stop closes the overlay AND ends the mode.
 *
 * It builds itself the first time it opens. Nothing happens at load beyond
 * wiring the button.
 */
(function () {
  'use strict';
  if (window.scrayReels) return;

  // Tags the mode lifts out of the exclude list while it runs (lower case).
  const SOFT_TAGS = ['soft'];
  const ANIM_MS = 280;
  const FLICK_PX = 60;          // a drag this long moves on
  const FLICK_V = 0.45;         // ...or a flick this fast (px per ms)
  const MUTE_KEY = 'scray_reels_muted';
  const ORDER_KEY = 'scray_reels_order';      // 'random' (default) or 'ordered'
  const ORIENT_KEY = 'scray_reels_orient';    // which videos play: 'P' portrait, 'any' both (the default), 'L' landscape
  // Containers the web player can't decode (player.js SCRAY_UNPLAYABLE_EXT).
  const NO_PLAY = new Set(['mkv', 'wmv', 'avi', 'flv', 'mpg', 'mpeg', 'rm', 'rmvb', 'asf',
                           'f4v', 'vob', 'divx', 'ogv', 'mts', 'm2v']);

  let armed = false;
  let saved = null;       // what to put back when the mode ends
  let ownOrient = null;   // the orientation filter value the mode itself set (so only that is put back)
  let R = null;           // the open overlay's state
  let toastEl = null, toastT = 0;

  const $ = id => document.getElementById(id);
  const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } };

  // ---------------------------------------------------------------- which videos
  function isPortrait(v) {
    if (!v) return false;
    const o = v.orientation ?? (typeof window.deriveOrientation === 'function'
      ? window.deriveOrientation(v.width, v.height) : null);
    return o === 'P';
  }
  function playable(v) {
    if (!v) return false;
    if (typeof window.scrayIsImageFile === 'function' && window.scrayIsImageFile(v)) return false;
    const ext = String(v.filename || '').split('.').pop().toLowerCase();
    return !NO_PLAY.has(ext);
  }
  let orientMem = null;   // the setting this session, for when storage is not available
  const orientMode = () => {
    const m = orientMem !== null ? orientMem : lsGet(ORIENT_KEY);
    return m === 'P' || m === 'L' ? m : 'any';
  };
  const isLandscape = v => !!v && (v.orientation ?? (typeof window.deriveOrientation === 'function'
    ? window.deriveOrientation(v.width, v.height) : null)) === 'L';
  /** A video the mode will play: playable, and of the orientation the overlay's button is set to (the filter's P / any / L). */
    function canPlay(v) {
    if (!playable(v)) return false;
    const m = orientMode();
    return m === 'any' || (m === 'P' ? isPortrait(v) : isLandscape(v));
  }
  /** Before starting on a particular video (the MPFS TT circle): if the setting would refuse it, widen to both. */
  function allow(v) { if (playable(v) && !canPlay(v)) setOrient('any'); }

  // ---------------------------------------------------------------- toast
  function toast(text) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.style.cssText = 'position:fixed;left:50%;bottom:calc(env(safe-area-inset-bottom,0px) + 90px);' +
        'transform:translateX(-50%);z-index:2147483646;background:rgba(0,0,0,.85);color:#fff;padding:8px 14px;' +
        'border-radius:18px;font:13px/1.3 system-ui,sans-serif;max-width:86%;text-align:center;' +
        'pointer-events:none;opacity:0;transition:opacity .2s';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = text;
    toastEl.style.opacity = '1';
    clearTimeout(toastT);
    toastT = setTimeout(() => { toastEl.style.opacity = '0'; }, 2600);
  }

  // ---------------------------------------------------------------- the mode
  function arm() {
    if (armed) return;
    armed = true;
    saved = { orient: null, soft: [] };
    const sel = $('orientationFilter');
    if (sel) {
      saved.orient = sel.value;
      ownOrient = orientMode();
      if (sel.value !== ownOrient) {
        sel.value = ownOrient;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    // "soft" is a default exclude; it must not hide anything in this mode.
    const j = window.jQuery;
    if (j && j('#excludeTagSelect').length) {
      const cur = j('#excludeTagSelect').val() || [];
      const gone = cur.filter(t => SOFT_TAGS.includes(String(t).toLowerCase()));
      if (gone.length) {
        saved.soft = gone;
        j('#excludeTagSelect').val(cur.filter(t => !gone.includes(t))).trigger('change');
      }
    }
    if (typeof window.syncOrientationToggleLabel === 'function') window.syncOrientationToggleLabel();
  }

  function disarm() {
    if (!armed) return;
    armed = false;
    if (R) closeOverlay();
    const s = saved; saved = null;
    if (s) {
      const sel = $('orientationFilter');
      // Only put it back if nobody changed it meanwhile.
      if (sel && s.orient != null && ownOrient != null && sel.value === ownOrient && s.orient !== ownOrient) {
        sel.value = s.orient;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const j = window.jQuery;
      if (j && s.soft.length && j('#excludeTagSelect').length) {
        const cur = j('#excludeTagSelect').val() || [];
        const back = s.soft.filter(t => !cur.includes(t));
        if (back.length) j('#excludeTagSelect').val(cur.concat(back)).trigger('change');
      }
    }
    if (typeof window.syncOrientationToggleLabel === 'function') window.syncOrientationToggleLabel();
  }

  /** Start playing from the list on screen: a random portrait video, then onwards (random or in order, per the order button). */
  async function start() {
    // The portrait filter was only just switched on, and the list redraws asynchronously - wait for it to
    // hold something playable (up to 4 s) rather than reading it once and giving up.
    const t0 = Date.now();
    let list = [], ok = [];
    for (;;) {
      list = (window.paginationState && window.paginationState.allVideos) || [];
      ok = list.filter(canPlay);
      if (ok.length || Date.now() - t0 > 4000) break;
      await new Promise(r => setTimeout(r, 200));
    }
    if (!ok.length) { toast(`No ${ORIENT_TXT[orientMode()].toLowerCase()} videos in the list (${list.length} listed)`); return; }
    // Exactly what pressing X does with TikTok mode on: it picks from the list as it stands and plays it,
    // which TikTok mode hands to the overlay. (playVideoInline is not on window, so it cannot be called from here.)
    const x = $('playRandomFilteredBtn');
    if (!x) { toast('The X button is missing'); return; }
    x.click();
  }

  async function toggle() {
    if (armed) { disarm(); return; }
    arm();
    // The filter change redraws the list; give it a moment before reading it.
    await new Promise(r => setTimeout(r, 150));
    try { await start(); } catch (err) { console.warn('[reels] could not start:', err); toast('TikTok mode could not start: ' + ((err && err.message) || err)); }
  }

  // ---------------------------------------------------------------- random order
  function shuffled(list) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  /** Keep a few videos queued ahead: when the shuffled run is nearly out, add another shuffle of the lot. */
  /** If the list behind the mode changed (a filter or search from the title, say), what comes next follows it. */
  function syncList() {
    if (!R || !R.listKey) return;
    let key;
    try { key = R.listKey(); } catch (e) { return; }
    if (!key || key === R.lastKey) return;
    R.lastKey = key;
    let items;
    try { items = R.listItems(); } catch (e) { return; }
    const cur = R.items[R.index];
    const curId = cur && idOf(cur.video);
    const fresh = (items || []).filter(it => idOf(it.video) !== curId);
    if (!fresh.length) { toast('Nothing else matches - keeping the current run'); return; }
    R.source = items;
    if (R.pool) {
      R.pool = items;                   // the whole match, this one included, for the reshuffles after
      R.items = R.items.slice(0, R.index + 1).concat(shuffled(fresh));
    } else {                            // in order: carry on down the new list from where this one sits in it
      const at = items.findIndex(it => idOf(it.video) === curId);
      R.items = R.items.slice(0, R.index + 1).concat(at >= 0 ? items.slice(at + 1) : fresh);
    }
    ensureAhead();
    fill(R.slots[2], R.index + 1, 'auto');
    if (Date.now() - R.openedAt > 2500) toast(`Next videos from the ${fresh.length + (curId != null ? 1 : 0)} that match`);   // not for the list settling at the start
  }
  const idOf = v => (v ? (v.oneDriveId ?? v.idFromAPI ?? v.filename ?? v) : null);

  function ensureAhead() {
    if (!R || !R.pool || R.pool.length < 2) return;
    while (R.items.length - R.index < 4) {
      const last = R.items[R.items.length - 1];
      const batch = shuffled(R.pool);
      if (batch[0] === last) { const t = batch[0]; batch[0] = batch[1]; batch[1] = t; }   // no repeat back to back
      R.items.push(...batch);
    }
  }

  // ---------------------------------------------------------------- the overlay
  const CSS = `
.sr-root{--sr-lift:18px;position:fixed;inset:0;z-index:2147483000;background:#000;color:#fff;overflow:hidden;touch-action:none;
  user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;display:none;font-family:system-ui,sans-serif}
.sr-root.on{display:block}
.sr-slot{position:absolute;inset:0;background:#000;will-change:transform}
/* ⚙️ object-position 50% 30%: a video shorter than the screen sits higher than centred - 30% of the spare
   height above it, 70% below - so it uses the space at the top and keeps clear of the title and bar. */
.sr-slot video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;object-position:50% 30%;background:#000;pointer-events:none}
/* ⚙️ The title sits ABOVE the button row (74px up, the row is 40px + about 28 tall), full width: five buttons are too wide to share a line with it. */
.sr-cap{position:absolute;left:12px;right:12px;bottom:calc(env(safe-area-inset-bottom,0px) + var(--sr-lift) + 74px);font-size:11.5px;
  line-height:1.3;text-shadow:0 1px 3px #000,0 0 8px #000;pointer-events:none;word-break:break-word;opacity:.72;
  display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.sr-spin{position:absolute;left:50%;top:50%;width:34px;height:34px;margin:-17px 0 0 -17px;border:3px solid rgba(255,255,255,.25);
  border-top-color:#fff;border-radius:50%;animation:srspin .8s linear infinite;display:none;pointer-events:none}
.sr-spin.on{display:block}
@keyframes srspin{to{transform:rotate(360deg)}}
.sr-err{position:absolute;left:10%;right:10%;top:45%;text-align:center;font-size:14px;color:#ff8a80;display:none;pointer-events:none}
.sr-err.on{display:block}
.sr-top{position:absolute;left:0;right:0;top:0;display:flex;align-items:center;
  padding:calc(env(safe-area-inset-top,0px) + 10px) 12px 0 12px;pointer-events:none}
.sr-count{font-size:11px;opacity:.85;background:rgba(0,0,0,.45);padding:3px 8px;border-radius:12px}
/* The filter pills, on top of the picture as in FLS / MPFS (their 13.62 title rules, restated here): the page's own
   #floatingTagPillsBar is moved in while the overlay is open and put back after. Compact, centred, and - as there -
   only the pink search pill takes taps; a stray tap beside it does nothing. */
.sr-pills{position:absolute;left:44px;right:44px;top:calc(env(safe-area-inset-top,0px) + 8px);display:flex;justify-content:center;pointer-events:none}
#scrayReels .sr-pills > #floatingTagPillsBar{display:flex!important;visibility:visible!important;opacity:.85!important;position:static!important;
  top:auto!important;right:auto!important;bottom:auto!important;left:auto!important;transform:none!important;z-index:auto!important;
  flex-wrap:wrap;justify-content:center;gap:3px;width:auto!important;max-width:100%!important;margin:0!important;padding:0!important;
  background:transparent!important;pointer-events:none!important}
#scrayReels .sr-pills > #floatingTagPillsBar .floating-tag-pill{font-size:.6rem;line-height:1.2;padding:2px 6px}
#scrayReels .sr-pills > #floatingTagPillsBar .floating-tag-search-wrap,
#scrayReels .sr-pills > #floatingTagPillsBar .floating-tag-search,
#scrayReels .sr-pills > #floatingTagPillsBar .search-pill-input{pointer-events:auto!important}
#scrayReels .sr-pills > #floatingTagPillsBar .floating-tag-search-wrap.is-focused{position:static!important;top:auto!important;left:auto!important;
  right:auto!important;z-index:auto!important;width:100%!important;flex:0 0 100%!important}
#scrayReels .sr-pills > #floatingTagPillsBar .floating-tag-search-wrap.is-focused .floating-tag-search{width:auto!important;max-width:100%!important;
  gap:4px!important;padding:2px 6px!important;border-radius:10px!important;box-shadow:none!important}
#scrayReels .sr-pills > #floatingTagPillsBar .floating-tag-search-wrap.is-focused .search-pill-input{font-size:.7rem!important;flex:1 1 0!important;min-width:0!important;width:auto!important}
#scrayReels .sr-pills > #floatingTagPillsBar .floating-tag-search-wrap.is-focused .search-pill-glass{font-size:.7rem!important}
#scrayReels .sr-pills > #floatingTagPillsBar .floating-tag-search-wrap.is-focused .search-pill-x{font-size:.8rem!important;margin:0!important;padding:0 4px!important;border-radius:8px!important}
.sr-ctl{position:absolute;right:10px;bottom:calc(env(safe-area-inset-bottom,0px) + var(--sr-lift) + 38px);display:flex;gap:4px;align-items:center;opacity:.72}
/* The title is the same clickable path as a list row (createClickablePath): folders, bracket tags and Stash chips
   open the filter / search modal. Its inline colours are for a white page, so they are restated for black. */
.sr-cap span{color:#fff!important}
.sr-cap span[style*="underline"]{color:#8cc8ff!important;pointer-events:auto;cursor:pointer}
.sr-cap span[style*="italic"]{color:#bbb!important}
html.scray-reels-open .basket-json-modal{z-index:2147483647!important}
.sr-btn{background:rgba(0,0,0,.35);color:#fff;border:1px solid rgba(255,255,255,.3);border-radius:12px;padding:3px 7px;
  font-size:10.5px;line-height:1.4;cursor:pointer}
.sr-btn.stop{background:rgba(200,30,60,.55);border-color:transparent;font-weight:600}
.sr-btn.mpfs{letter-spacing:.02em}
/* The seek bar, as MPFS's: a thin full-width track, played in white, loaded a little lighter, the time
   as played / left above it. The strip is taller than the track so a thumb can find it. */
/* ⚙️ --sr-lift (18px, on .sr-root) raises the bar, its time, the title and the buttons clear of the screen's
   rounded bottom corners; the track also stops 10px short of each side, with round ends. */
.sr-seek{position:absolute;left:0;right:0;bottom:calc(env(safe-area-inset-bottom,0px) + var(--sr-lift));height:34px;touch-action:none}
.sr-ts{position:absolute;left:12px;bottom:17px;font-size:10px;opacity:.8;font-variant-numeric:tabular-nums;text-shadow:1px 1px 2px rgba(0,0,0,.9);pointer-events:none}
.sr-track{position:absolute;left:10px;right:10px;bottom:6px;height:6px;border-radius:3px;overflow:hidden;background:rgba(255,255,255,.22)}
.sr-buf{position:absolute;left:0;top:0;bottom:0;width:0;background:rgba(255,255,255,.38)}
.sr-fill{position:absolute;left:0;top:0;bottom:0;width:0;background:#fff}
/* Everything that floats over the page goes behind, as in MPFS: the old corner shell, the pills, and the fused
   dock (X R H ... 🔍 BM 🌐 COL). The dock lives in #scrayDisguise under <html>, outside <body>, at the top z-index,
   hence the class on <html>. The disguise screen itself is left alone and still covers this when it is up. */
html.scray-reels-open #cornerButtons,html.scray-reels-open #floatingTagPillsBar:not(.sr-in),
html.scray-reels-open #scrayDisguiseDock,html.scray-reels-open #scrayDisguiseStrip{display:none!important}
.sr-pause{position:absolute;left:50%;top:50%;width:72px;height:72px;margin:-36px 0 0 -36px;border-radius:50%;
  background:rgba(0,0,0,.5);display:none;align-items:center;justify-content:center;font-size:34px;pointer-events:none}
.sr-pause.on{display:flex}
.sr-fb{position:absolute;top:calc(env(safe-area-inset-top,0px) + 56px);background:rgba(0,0,0,.65);padding:6px 12px;border-radius:14px;
  font-size:14px;font-variant-numeric:tabular-nums;opacity:0;transition:opacity .2s;pointer-events:none}
.sr-fb.on{opacity:1}
.sr-hint{position:absolute;left:50%;bottom:calc(env(safe-area-inset-bottom,0px) + var(--sr-lift) + 140px);transform:translateX(-50%);
  background:rgba(0,0,0,.6);padding:7px 14px;border-radius:16px;font-size:13px;opacity:0;transition:opacity .3s;pointer-events:none;white-space:nowrap}
.sr-hint.on{opacity:1}
`;

  function injectCss() {
    if ($('scrayReelsCss')) return;
    const s = document.createElement('style');
    s.id = 'scrayReelsCss';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function makeSlot() {
    const el = document.createElement('div');
    el.className = 'sr-slot';
    el.innerHTML = '<video playsinline webkit-playsinline preload="none" disablepictureinpicture></video>' +
      '<div class="sr-cap"></div><div class="sr-spin"></div><div class="sr-err"></div>';
    const slot = {
      el, v: el.querySelector('video'), cap: el.querySelector('.sr-cap'),
      spin: el.querySelector('.sr-spin'), err: el.querySelector('.sr-err'),
      idx: -1, tok: 0
    };
    const cur = () => R && R.slots[1] === slot;
    const v = slot.v;
    v.loop = true;
    v.addEventListener('waiting', () => { if (cur() && !v.paused) slot.spin.classList.add('on'); });
    v.addEventListener('loadstart', () => { if (cur()) slot.spin.classList.add('on'); });
    v.addEventListener('playing', () => { slot.spin.classList.remove('on'); if (cur()) { showPaused(false); flushWaiters(); } });
    v.addEventListener('canplay', () => { if (cur() && !v.paused) slot.spin.classList.remove('on'); });
    v.addEventListener('timeupdate', () => {
      if (!cur()) return;
      paint();
      if (typeof window.scrayWatchStep === 'function') window.scrayWatchStep(v.currentTime);
    });
    ['loadedmetadata', 'durationchange', 'progress'].forEach(n => v.addEventListener(n, () => { if (cur()) paint(); }));
    v.addEventListener('pause', () => { if (cur() && typeof window.scrayWatchFlush === 'function') window.scrayWatchFlush(); });
    v.addEventListener('error', () => {
      if (!slot.v.getAttribute('src')) return;     // a source we removed ourselves
      fail(slot, new Error("can't play this one"));
    });
    return slot;
  }

  function build() {
    injectCss();
    const root = document.createElement('div');
    root.className = 'sr-root';
    root.id = 'scrayReels';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'TikTok mode');
    const slots = [makeSlot(), makeSlot(), makeSlot()];
    slots.forEach(s => root.appendChild(s.el));
    root.insertAdjacentHTML('beforeend',
      '<div class="sr-pause">&#9654;</div>' +
      '<div class="sr-top"><span class="sr-count"></span></div><div class="sr-pills"></div>' +
      '<div class="sr-ctl"><button type="button" class="sr-btn mute" aria-label="Sound"></button>' +
      '<button type="button" class="sr-btn order" aria-label="Order"></button>' +
      '<button type="button" class="sr-btn land" aria-label="Landscape videos"></button>' +
      '<button type="button" class="sr-btn stop">Stop</button>' +
      '<button type="button" class="sr-btn mpfs" title="Leave TikTok mode and carry on in the normal portrait player (MPFS)">MPFS</button></div>' +
      '<div class="sr-seek"><div class="sr-ts">0:00 / 0:00</div><div class="sr-track"><div class="sr-buf"></div><div class="sr-fill"></div></div></div>' +
      '<div class="sr-fb"></div><div class="sr-hint">Swipe up for the next video</div>');
    document.body.appendChild(root);
    const st = {
      root, slots, items: [], index: 0, busy: false, muted: lsGet(MUTE_KEY) === '1',
      onShow: null, onClose: null,
      bar: root.querySelector('.sr-fill'), buf: root.querySelector('.sr-buf'), ts: root.querySelector('.sr-ts'),
      seek: root.querySelector('.sr-seek'), track: root.querySelector('.sr-track'),
      curPlaying: false, waiters: [], waitT: 0, autoMuted: false, fb: root.querySelector('.sr-fb'), count: root.querySelector('.sr-count'),
      pauseIcon: root.querySelector('.sr-pause'), hint: root.querySelector('.sr-hint'),
      muteBtn: root.querySelector('.mute'), orderBtn: root.querySelector('.order'), landBtn: root.querySelector('.land'), source: [], startAt: null, wheelLock: false, errTimer: 0
    };
    root.querySelector('.stop').addEventListener('click', e => { e.stopPropagation(); disarm(); closeOverlay(); });
    root.querySelector('.mpfs').addEventListener('click', e => { e.stopPropagation(); toMpfs(); });
    st.muteBtn.addEventListener('click', e => { e.stopPropagation(); setMuted(!R.muted); });
    st.orderBtn.addEventListener('click', e => { e.stopPropagation(); toggleOrder(); });
    st.landBtn.addEventListener('click', e => { e.stopPropagation(); toggleLandscape(); });
    wireGestures(st);
    wireSeekBar(st);
    return st;
  }

  function setMuted(m, persist = true) {
    if (!R) return;
    R.muted = !!m;
    if (persist) { R.autoMuted = false; lsSet(MUTE_KEY, R.muted ? '1' : '0'); }
    R.slots.forEach(s => { s.v.muted = R.muted; });
    R.muteBtn.textContent = R.muted ? '🔇' : '🔊';
  }

  // ---- landscape videos (the button beside the order button)
  const ORIENT_NEXT = { P: 'any', any: 'L', L: 'P' };
  const ORIENT_TXT = { P: 'Portrait only', any: 'Portrait and landscape', L: 'Landscape only' };
  const ORIENT_GLYPH = { P: '▯', any: '▯▭', L: '▭' };
  function paintLand() {
    if (!R) return;
    const m = orientMode();
    R.landBtn.textContent = ORIENT_GLYPH[m];
    R.landBtn.title = `${ORIENT_TXT[m]} - tap for ${ORIENT_TXT[ORIENT_NEXT[m]].toLowerCase()}`;
  }
  /** Set which videos play. The list behind the mode is the orientation filter's, so the filter moves too. */
  function setOrient(m) {
    orientMem = m;
    lsSet(ORIENT_KEY, m);
    const sel = $('orientationFilter');
    if (armed && sel && ownOrient != null && sel.value === ownOrient) {
      ownOrient = m;
      sel.value = m;
      sel.dispatchEvent(new Event('change', { bubbles: true }));   // the list redraws; syncList then feeds what comes next
    }
    paintLand();
  }
  /** The button in the overlay: portrait only > portrait and landscape > landscape only > portrait only. */
  function toggleLandscape() {
    const m = ORIENT_NEXT[orientMode()];
    setOrient(m);
    toast(ORIENT_TXT[m]);
  }

  // ---- random / in order (the button beside mute)
  const isRandom = () => lsGet(ORDER_KEY) !== 'ordered';
  function paintOrder() {
    if (!R) return;
    const rnd = !!R.pool;
    R.orderBtn.textContent = rnd ? '🔀' : '➡️';
    R.orderBtn.title = rnd ? 'Random order - tap for in order' : 'In order - tap for random';
  }
  /** Switch what comes next between random and the list's own order, from the video on screen, without a restart. */
  function toggleOrder() {
    if (!R) return;
    const goRandom = !R.pool;
    lsSet(ORDER_KEY, goRandom ? 'random' : 'ordered');
    const src = R.source && R.source.length ? R.source : R.items;
    const cur = R.items[R.index];
    const curId = cur && idOf(cur.video);
    const head = R.items.slice(0, R.index + 1);
    if (goRandom) {
      R.pool = src.slice();
      R.items = head.concat(shuffled(src.filter(it => idOf(it.video) !== curId)));
      ensureAhead();
      if (R.listKey && R.listItems) { clearInterval(R.syncT); R.syncT = setInterval(syncList, 700); }
    } else {
      R.pool = null;
      const at = src.findIndex(it => idOf(it.video) === curId);
      R.items = head.concat(at >= 0 ? src.slice(at + 1) : src.filter(it => idOf(it.video) !== curId));
    }
    fill(R.slots[2], R.index + 1, 'auto');
    paintOrder();
    shown();
    toast(goRandom ? 'Random order' : 'In order');
  }

  function showPaused(on) { if (R) R.pauseIcon.classList.toggle('on', !!on); }

  // ---- positions: k is the slot's place (-1 before, 0 playing, 1 after)
  function place(slot, k, dy, anim) {
    slot.el.style.transition = anim ? `transform ${ANIM_MS}ms cubic-bezier(.22,.8,.25,1)` : 'none';
    slot.el.style.transform = `translate3d(0,calc(${k * 100}% + ${dy}px),0)`;
  }
  function layout(dy, anim) {
    R.slots.forEach((s, i) => place(s, i - 1, dy, anim));
  }

  /** The title: the list row's clickable path when ui.js is there, else the plain name. */
  function setCaption(slot, it) {
    slot.cap.textContent = '';
    if (it.video && typeof window.createClickablePath === 'function') {
      try { slot.cap.appendChild(window.createClickablePath(it.video, true, true)); return; }
      catch (err) { slot.cap.textContent = ''; }
    }
    slot.cap.textContent = it.name || '';
  }

  function resetSlot(slot) {
    slot.v.pause();
    slot.v.removeAttribute('src');
    try { slot.v.load(); } catch (e) { /* nothing loaded */ }
    slot.cap.textContent = '';
    slot.err.classList.remove('on');
    slot.spin.classList.remove('on');
  }

  function fail(slot, err) {
    slot.spin.classList.remove('on');
    slot.err.textContent = (err && err.message) || "can't play this one";
    slot.err.classList.add('on');
    // A broken one in the middle of the feed moves on by itself.
    if (R && R.slots[1] === slot && R.index + 1 < R.items.length) {
      clearTimeout(R.errTimer);
      const at = R.index;
      R.errTimer = setTimeout(() => { if (R && R.index === at) go(1); }, 1600);
    }
  }

  /** Put item `idx` in a slot. preload: 'auto' (the next one) or 'metadata' (the one before). */
  async function fill(slot, idx, preload) {
    const my = ++slot.tok;
    slot.idx = idx;
    resetSlot(slot);
    const it = R.items[idx];
    if (!it) return;
    setCaption(slot, it);
    if (R.slots[1] === slot) slot.spin.classList.add('on');
    let url;
    try { url = await it.load(); }
    catch (err) { if (slot.tok === my && R) fail(slot, err); return; }
    if (slot.tok !== my || !R) return;
    if (!url) { fail(slot, new Error('no link for this one')); return; }
    const apply = () => {
      if (slot.tok !== my || !R) return;
      slot.v.muted = R.muted;
      slot.v.preload = preload;
      if (R.startAt && R.startAt.idx === idx) {
        const t = R.startAt.t; R.startAt = null;
        slot.v.addEventListener('loadedmetadata', () => { try { slot.v.currentTime = t; } catch (e) { /* not seekable yet */ } }, { once: true });
      }
      slot.v.src = url;
    };
    if (R.slots[1] === slot) { apply(); playCur(); }
    else whenCurPlaying(apply);     // neighbours start loading once this one is on screen, not alongside it
  }

  /** Run fn once the video on screen is playing (or after 3s regardless), so loads go one after another. */
  function whenCurPlaying(fn) {
    if (!R) return;
    if (R.curPlaying) { fn(); return; }
    R.waiters.push(fn);
    clearTimeout(R.waitT);
    R.waitT = setTimeout(flushWaiters, 3000);
  }
  function flushWaiters() {
    if (!R) return;
    clearTimeout(R.waitT);
    R.curPlaying = true;
    R.waiters.splice(0).forEach(f => f());
  }

  function playCur() {
    if (!R) return;
    const s = R.slots[1], v = s.v;
    if (!v.getAttribute('src')) return;
    v.muted = R.muted;
    const p = v.play();
    if (p && p.catch) {
      p.catch(err => {
        if (err && err.name === 'NotAllowedError' && !v.muted) {
          // Sound needs a tap on some browsers; carry on muted rather than sit still.
          // The browser wouldn't start sound without a tap: play muted, and the next touch turns it back on.
          setMuted(true, false);
          R.autoMuted = true;
          v.play().catch(() => showPaused(true));
        } else if (!err || err.name !== 'AbortError') {
          showPaused(true);
        }
      });
    }
  }

  /** The seek bar and its time, from the playing video (or from t while seeking). */
  function paint(t) {
    if (!R) return;
    const v = R.slots[1].v, d = v.duration;
    if (!(d > 0) || !isFinite(d)) { R.bar.style.width = '0%'; R.buf.style.width = '0%'; R.ts.textContent = '0:00 / 0:00'; return; }
    const c = t == null ? (R.scrubT != null ? R.scrubT : v.currentTime) : t;   // while scrubbing: from the finger
    R.bar.style.width = (100 * c / d) + '%';
    R.ts.textContent = `${fmt(c)} / ${fmt(Math.max(0, d - c))}`;
    try {
      let e = 0;
      for (let i = 0; i < v.buffered.length; i++) {
        if (v.buffered.start(i) <= c + 0.5 && v.buffered.end(i) > e) e = v.buffered.end(i);
      }
      R.buf.style.width = (100 * Math.min(e, d) / d) + '%';
    } catch (err) { /* no ranges yet */ }
  }

  function shown() {
    const it = R.items[R.index];
    if (R.pool) R.count.textContent = `${R.index + 1}`;
    else {
      // In order: the place in the list itself, not in the run since the toggle.
      const id = it && idOf(it.video);
      const at = R.source.length ? R.source.findIndex(s => idOf(s.video) === id) : -1;
      R.count.textContent = at >= 0 ? `${at + 1} / ${R.source.length}` : `${R.index + 1} / ${R.items.length}`;
    }
    paint();
    showPaused(false);
    if (R.onShow && it) { try { R.onShow(it, R.index); } catch (err) { console.warn('[reels] onShow:', err); } }
  }

  function bounce() {
    layout(0, true);
    toast(R.index === 0 && R.items.length > 1 ? 'That is the first one' : 'That is the last one');
  }

  /** Move one video on (+1) or back (-1), sliding the whole screen. */
  function go(dir) {
    if (!R || R.busy) return;
    const ni = R.index + dir;
    if (dir > 0) ensureAhead();
    if (ni < 0 || ni >= R.items.length) { bounce(); return; }
    clearTimeout(R.errTimer);
    R.busy = true;
    const [prev, cur, next] = R.slots;
    if (dir > 0) { place(cur, -1, 0, true); place(next, 0, 0, true); }
    else { place(cur, 1, 0, true); place(prev, 0, 0, true); }
    setTimeout(() => {
      if (!R) return;
      cur.v.pause();
      if (dir > 0) {
        R.slots.push(R.slots.shift());          // the old "before" becomes the new "after"
        R.index = ni;
        ensureAhead();
        fill(R.slots[2], ni + 1, 'auto');
      } else {
        R.slots.unshift(R.slots.pop());         // the old "after" becomes the new "before"
        R.index = ni;
        fill(R.slots[0], ni - 1, 'metadata');
      }
      layout(0, false);
      R.curPlaying = false;
      const s = R.slots[1];
      if (s.v.getAttribute('src')) {
        try { s.v.currentTime = 0; } catch (e) { /* not seekable yet */ }
        playCur();
      } else if (!s.err.classList.contains('on')) {
        s.spin.classList.add('on');             // still fetching its link; fill() plays it
      }
      shown();
      R.busy = false;
    }, ANIM_MS + 20);
  }

  function togglePause() {
    if (!R) return;
    const v = R.slots[1].v;
    if (!v.getAttribute('src')) return;
    if (v.paused) { playCur(); showPaused(false); }
    else { v.pause(); showPaused(true); }
  }

  // ---- scrub engine: the main player's window.scrayScrubSeek (player.js), for this overlay's video
  // fastSeek snaps to keyframes and a seek per animation frame aborts the one before it, so a drag showed few
  // frames. This issues ACCURATE seeks (the exact frame) one at a time - the next only once the last has
  // completed ('seeked') - so the picture follows the finger as fast as the source can deliver. A playing
  // video is paused for the drag (seeking one is far slower on iOS) and resumes on release, which lands on
  // the exact spot with one last accurate seek. The bar and time are drawn from the finger, not the element.
  const SCRUB_TIMEOUT_MS = 250;      // 'seeked' never came (a stalled segment): carry on after this
  const SCRUB_MIN_DELTA_S = 0.015;   // ignore requests closer than this to the last seek issued
  const Scrub = (function () {
    let target = null, lastReq = null, lastIssued = null, inFlight = false, wd = 0, el = null, active = false, resume = false;
    const media = () => (R ? R.slots[1].v : null);
    const settle = () => { clearTimeout(wd); inFlight = false; pump(); };
    function bind(v) {
      if (el === v) return;
      if (el) { el.removeEventListener('seeked', settle); el.removeEventListener('error', settle); }
      el = v;
      el.addEventListener('seeked', settle);
      el.addEventListener('error', settle);
    }
    function pump() {
      if (inFlight || target === null) return;
      const v = media();
      if (!v || v.readyState < 1) return;           // writing currentTime with nothing loaded stalls iOS's media pipeline
      const next = target; target = null;
      if (lastIssued !== null && Math.abs(next - lastIssued) < SCRUB_MIN_DELTA_S) return;
      bind(v);
      inFlight = true; lastIssued = next;
      wd = setTimeout(settle, SCRUB_TIMEOUT_MS);
      try { v.currentTime = next; } catch (e) { settle(); }
    }
    const clear = () => { clearTimeout(wd); target = null; lastReq = null; lastIssued = null; inFlight = false; };
    return {
      active: () => active,
      begin() {
        clear();
        active = true;
        const v = media();
        resume = resume && !!(v && v.paused);       // a resume already owed carries over, only while still paused
        if (v && !v.paused) { resume = true; v.pause(); }
      },
      request(t) {
        if (!isFinite(t)) return;
        target = t; lastReq = t;
        if (R) { R.scrubT = t; paint(t); }
        pump();
      },
      end(finalT) {
        const landOn = isFinite(finalT) ? finalT : (target !== null ? target : lastReq);
        clear();
        const v = media();
        if (v && v.readyState > 0 && isFinite(landOn)) { try { v.currentTime = landOn; } catch (e) { /* not seekable yet */ } }
        active = false;
        if (R) { R.scrubT = null; if (isFinite(landOn)) paint(landOn); }
        if (resume) { resume = false; playCur(); }
      },
      /** Drop the session without resuming (the overlay is closing or moving on). */
      reset() { clear(); active = false; resume = false; if (R) R.scrubT = null; }
    };
  })();

  // ---- seek gestures (the MPFS ones, player.js startScrub / scrubMove / handleDoubleTap)
  const DEAD_PX = 10;            // a drag decides its direction after this much
  const JOG_PX_PER_STEP = 8;     // paused: pixels per frame step
  const JOG_MULT = [128, 64, 32];// paused: bottom, middle, top third
  const FRAME_S = 1 / 30;
  const DOUBLE_MS = 300;
  const BAND_TOP_FRAC = 1 / 3;   // double taps work from a third of the way down...
  const BAND_BOTTOM_PX = 152;    // ...to this far above the bottom

  const fmt = t => {
    t = Math.max(0, Math.floor(t || 0));
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(sec).padStart(2, '0');
  };

  let fbT = 0;
  function feedback(text, side) {
    if (!R) return;
    const f = R.fb;
    f.textContent = text;
    f.style.left = side === 'right' ? 'auto' : '14px';
    f.style.right = side === 'right' ? '14px' : 'auto';
    f.classList.add('on');
    clearTimeout(fbT);
    fbT = setTimeout(() => { if (R) R.fb.classList.remove('on'); }, 900);
  }

  function seekTo(t) {
    const v = R.slots[1].v;
    const d = v.duration;
    if (!(d > 0)) return;
    t = Math.max(0, Math.min(d, t));
    try { v.currentTime = t; } catch (e) { /* not seekable yet */ }
    paint(t);
  }

  function seekBy(delta) {
    const v = R.slots[1].v;
    if (!(v.duration > 0)) return;
    seekTo(v.currentTime + delta);
    const sign = delta > 0 ? '+' : '−';
    feedback(`${sign}${Math.abs(delta)}s (${fmt(v.currentTime)})`, delta > 0 ? 'right' : 'left');
  }

  /** A double tap's zone: left half minus, right half plus; 3 / 10 / 30s from the bottom to the top of the band. */
  function tapZone(x, y) {
    const W = window.innerWidth, H = window.innerHeight;
    const top = H * BAND_TOP_FRAC;
    const bottom = Math.max(top + 1, H - BAND_BOTTOM_PX);
    if (y < top || y > bottom) return null;
    if (x >= W / 4 && x <= W * 3 / 4) return null;           // the middle is play / pause
    const into = y - top, h = bottom - top;
    const amount = into > h * 2 / 3 ? 3 : into > h / 3 ? 10 : 30;
    return { sign: x > W / 2 ? 1 : -1, amount };
  }

  function wireGestures(st) {
    const root = st.root;
    let down = false, mode = 'none', x0 = 0, y0 = 0, dy = 0, hist = [];
    // seek drag
    let t0 = 0, jog = false, jogMult = 32, mult = 1, last = null;
    // taps
    let lastTapAt = 0, tapTimer = 0, lastSeekAt = 0, lastSeekSign = 0;

    root.addEventListener('pointerdown', e => {
      if (!R || R.busy || e.target.closest('.sr-btn')) return;
      if (e.target.closest('.sr-cap span[style*="underline"], .sr-pills .floating-tag-search-wrap')) return;   // a tag in the title, the search pill: their own taps
      if (R.autoMuted) { R.autoMuted = false; setMuted(false, false); }
      down = true; mode = 'none'; x0 = e.clientX; y0 = e.clientY; dy = 0;
      hist = [[e.clientY, performance.now()]];
      try { root.setPointerCapture(e.pointerId); } catch (err) { /* synthetic */ }
    });

    root.addEventListener('pointermove', e => {
      if (!down || !R) return;
      const dx = e.clientX - x0;
      dy = e.clientY - y0;
      if (mode === 'none') {
        if (Math.abs(dx) <= DEAD_PX && Math.abs(dy) <= DEAD_PX) return;
        if (Math.abs(dx) > Math.abs(dy)) {
          // Sideways: seek. Where the finger is decides the speed, once, for the whole drag.
          const v = R.slots[1].v;
          if (!(v.duration > 0)) { mode = 'x'; return; }
          mode = 'h';
          jog = v.paused;                                 // decided before the drag pauses a playing one
          t0 = v.currentTime;
          last = null;
          Scrub.begin();                                  // pauses a playing video: a still frame to seek against
          const H = window.innerHeight;
          const fromBottom = 1 - (y0 / H);                // 0 at the bottom, 1 at the top
          mult = fromBottom < 0.2 ? 3 : 1;                // playing: bottom fifth is x3
          jogMult = JOG_MULT[fromBottom < 1 / 3 ? 0 : fromBottom < 2 / 3 ? 1 : 2];
          clearTimeout(tapTimer);
        } else {
          mode = 'v';
          clearTimeout(tapTimer);
        }
      }
      if (mode === 'h') {
        const v = R.slots[1].v, d = v.duration;
        let t;
        if (jog) {
          const steps = dx / JOG_PX_PER_STEP;
          t = t0 + steps * FRAME_S * jogMult;
        } else {
          const beyond = Math.sign(dx) * Math.max(0, Math.abs(dx) - DEAD_PX);
          t = t0 + (beyond / window.innerWidth) * d * mult;
        }
        t = Math.max(0, Math.min(d, t));
        last = t;
        Scrub.request(t);
        const off = t - t0;
        feedback(jog
          ? `${off >= 0 ? '+' : '−'}${Math.abs(off).toFixed(2)}s (${jogMult}x)  ${fmt(t)}`
          : `${off >= 0 ? '+' : '−'}${Math.abs(Math.round(off))}s  ${fmt(t)}`, 'left');
        return;
      }
      if (mode === 'v') {
        hist.push([e.clientY, performance.now()]);
        if (hist.length > 6) hist.shift();
        const atEdge = (dy < 0 && R.index + 1 >= R.items.length) || (dy > 0 && R.index === 0);
        layout(atEdge ? dy * 0.3 : dy, false);
      }
    });

    const end = e => {
      if (!down) return;
      down = false;
      if (!R) return;
      if (mode === 'h') {
        Scrub.end(last);                              // lands on the exact frame, then resumes if it was playing
        last = null;
        mode = 'none';
        return;
      }
      if (mode === 'v') {
        mode = 'none';
        const a = hist[0], b = hist[hist.length - 1];
        const v = b && a && b[1] > a[1] ? (b[0] - a[0]) / (b[1] - a[1]) : 0;   // px per ms, up is negative
        if (e.type === 'pointercancel') { layout(0, true); return; }
        if (dy < -FLICK_PX || v < -FLICK_V) go(1);
        else if (dy > FLICK_PX || v > FLICK_V) go(-1);
        else layout(0, true);
        return;
      }
      mode = 'none';
      if (e.type !== 'pointerup') return;
      // A tap. Two close together in the seek zones seek; otherwise it is play / pause (after a beat,
      // so a double tap doesn't pause on its first tap).
      const now = performance.now();
      const zone = tapZone(e.clientX, e.clientY);
      // Already seeking with double taps: further single taps in the same half keep seeking.
      if (zone && now - lastSeekAt < 450 && zone.sign === lastSeekSign) {
        lastSeekAt = now; seekBy(zone.sign * zone.amount); return;
      }
      if (zone && now - lastTapAt < DOUBLE_MS) {
        clearTimeout(tapTimer);
        lastTapAt = 0; lastSeekAt = now; lastSeekSign = zone.sign;
        seekBy(zone.sign * zone.amount);
        return;
      }
      lastTapAt = now;
      clearTimeout(tapTimer);
      tapTimer = setTimeout(() => { lastTapAt = 0; togglePause(); }, DOUBLE_MS);
    };
    root.addEventListener('pointerup', end);
    root.addEventListener('pointercancel', end);
    root.addEventListener('wheel', e => {
      e.preventDefault();
      if (!R || R.wheelLock || Math.abs(e.deltaY) < 20) return;
      R.wheelLock = true;
      setTimeout(() => { if (R) R.wheelLock = false; }, 600);
      go(e.deltaY > 0 ? 1 : -1);
    }, { passive: false });
    root.addEventListener('contextmenu', e => e.preventDefault());
  }

  /** Tap the bar to jump, drag along it to scrub (MPFS's permanent progress bar). */
  function wireSeekBar(st) {
    const bar = st.seek;
    let on = false, dragging = false, began = false, x0 = 0;
    const fracAt = e => {
      const r = st.track.getBoundingClientRect();
      return Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width)));
    };
    // A tap lands on the spot, exactly. A drag goes through the scrub engine (accurate, one seek at a time,
    // paused while it runs); letting go lands on the last spot and resumes.
    const to = (e, final) => {
      const v = R.slots[1].v;
      if (!(v.duration > 0)) return;
      const t = fracAt(e) * v.duration;
      paint(t);
      feedback(fmt(t), 'left');
      if (!dragging) { try { v.currentTime = t; } catch (err) { /* not seekable yet */ } return; }
      if (!began) { Scrub.begin(); began = true; }
      if (final) { Scrub.end(t); began = false; }
      else Scrub.request(t);
    };
    bar.addEventListener('pointerdown', e => {
      e.stopPropagation();
      if (!R || !(R.slots[1].v.duration > 0)) return;
      on = true; dragging = false; x0 = e.clientX;
      try { bar.setPointerCapture(e.pointerId); } catch (err) { /* synthetic */ }
      to(e, false);                                 // a tap lands on the spot, exactly (not a drag yet)
    });
    bar.addEventListener('pointermove', e => {
      if (!on || !R) return;
      e.stopPropagation();
      if (!dragging && Math.abs(e.clientX - x0) < 8) return;   // a tap's jitter is not a drag
      dragging = true;
      to(e, false);
    });
    const up = e => {
      e.stopPropagation();
      if (!on) return;
      on = false;
      if (dragging && R) to(e, true);
      dragging = false;
    };
    bar.addEventListener('pointerup', up);
    bar.addEventListener('pointercancel', up);
  }

  /** The MPFS button: leave TikTok mode and carry on with this video in the normal portrait player. */
  function toMpfs() {
    if (!R) return;
    const it = R.items[R.index];
    const t = R.slots[1].v.currentTime || 0;
    disarm();                                       // ends the mode, filters back as they were
    closeOverlay();
    if (it && typeof window.scrayPlayFromReels === 'function') window.scrayPlayFromReels(it.video, t);
  }

  function onKey(e) {
    if (!R) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;   // typing in the search pill
    const k = e.key;
    const used = ['ArrowDown', 'ArrowUp', ' ', 'Escape', 'm', 'M', 'k', 'j'];
    if (!used.includes(k)) { e.stopPropagation(); return; }   // keep the page's own shortcuts out of it
    e.preventDefault(); e.stopPropagation();
    if (k === 'ArrowDown' || k === 'j') go(1);
    else if (k === 'ArrowUp' || k === 'k') go(-1);
    else if (k === ' ') togglePause();
    else if (k === 'Escape') { disarm(); closeOverlay(); }
    else setMuted(!R.muted);
  }

  /**
   * Open the overlay.
   *   items:  [{ video, name, load: async () => url }]
   *   index:  where to start
   *   onShow: (item, index) when a video comes on screen
   *   onClose: when it closes
   */
  function open(opts) {
    const items = (opts && opts.items) || [];
    if (!items.length) return false;
    if (!R) R = build(); else if (!R.root.isConnected) document.body.appendChild(R.root);
    clearTimeout(R.errTimer);
    Scrub.reset();
    const at = Math.max(0, Math.min(items.length - 1, (opts.index | 0)));
    R.source = items.slice();
    if (opts.shuffle && isRandom()) {
      // The one played first, then the rest in random order; reshuffled when it runs out.
      R.pool = items.slice();
      R.items = [items[at]].concat(shuffled(items.filter((_, i) => i !== at)));
      R.index = 0;
      ensureAhead();
    } else {
      R.pool = null;
      R.items = items;
      R.index = at;
    }
    R.startAt = opts.startAt > 0 ? { idx: R.index, t: opts.startAt } : null;   // carry on from where the other player was
    R.onShow = opts.onShow || null;
    R.onClose = opts.onClose || null;
    R.openedAt = Date.now();
    R.listKey = opts.listKey || null;
    R.listItems = opts.listItems || null;
    try { R.lastKey = R.listKey ? R.listKey() : null; } catch (e) { R.lastKey = null; }
    clearInterval(R.syncT);
    if (R.listKey) R.syncT = setInterval(syncList, 700);
    R.busy = false;
    R.curPlaying = false; R.waiters.length = 0; R.autoMuted = false;
    try { window.plyrPlayer && window.plyrPlayer.pause && window.plyrPlayer.pause(); } catch (e) { /* nothing playing */ }
    R.root.classList.add('on');
    borrowPills();
    document.documentElement.classList.add('scray-reels-open');   // corner buttons, pills and dock go behind
    document.documentElement.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey, true);
    setMuted(R.muted);
    paintOrder();
    paintLand();
    layout(0, false);
    fill(R.slots[1], R.index, 'auto');
    fill(R.slots[2], R.index + 1, 'auto');
    fill(R.slots[0], R.index - 1, 'metadata');
    shown();
    R.hint.textContent = R.pool ? 'Swipe up for the next - random' : 'Swipe up for the next - in order';
    R.hint.classList.add('on');
    setTimeout(() => { if (R) R.hint.classList.remove('on'); }, 2600);
    return true;
  }

  /** The playing video's own row changed (the same overlay, a new list). */
  /** Borrow the page's pill bar for the top of the overlay; a marker remembers where it lives. */
  let pillsHome = null;
  function borrowPills() {
    const bar = document.getElementById('floatingTagPillsBar');
    const slot = R && R.root.querySelector('.sr-pills');
    if (!bar || !slot || bar.parentElement === slot) return;
    if (!pillsHome) pillsHome = document.createComment(' floatingTagPillsBar (TikTok mode) ');
    if (bar.parentNode) bar.parentNode.insertBefore(pillsHome, bar);
    bar.classList.add('sr-in');
    slot.appendChild(bar);
  }
  function returnPills() {
    const bar = document.getElementById('floatingTagPillsBar');
    if (!bar || !bar.classList.contains('sr-in')) return;
    const a = document.activeElement;
    if (a && bar.contains(a)) { try { a.blur(); } catch (e) { /* fine */ } }
    bar.classList.remove('sr-in');
    if (pillsHome && pillsHome.parentNode) { pillsHome.parentNode.insertBefore(bar, pillsHome); pillsHome.remove(); }
    else document.body.appendChild(bar);
    // Let the fullscreen modes take it again if one of them is what is showing now.
    if (typeof window.syncNowPlayingStripPlacement === 'function') { try { window.syncNowPlayingStripPlacement(); } catch (e) { /* fine */ } }
  }

  function closeOverlay() {
    if (!R || !R.root.classList.contains('on')) return;
    clearTimeout(R.errTimer);
    clearInterval(R.syncT);
    Scrub.reset();
    if (typeof window.scrayWatchFlush === 'function') window.scrayWatchFlush();
    R.slots.forEach(s => { s.tok++; resetSlot(s); s.idx = -1; });
    R.root.classList.remove('on');
    returnPills();
    document.documentElement.classList.remove('scray-reels-open');
    document.documentElement.style.overflow = '';
    window.removeEventListener('keydown', onKey, true);
    const cb = R.onClose; R.onClose = null;
    if (cb) { try { cb(); } catch (err) { /* ignore */ } }
  }

  window.scrayReels = {
    armed: () => armed,
    isOpen: () => !!(R && R.root.classList.contains('on')),
    arm, disarm, toggle, start, open,
    close: closeOverlay,
    stop: () => { disarm(); closeOverlay(); },
    canPlay, allow, toast,
    /** The video that comes after the one on screen (for play-next-after-delete), or null. */
    peekNext: () => (R && R.root.classList.contains('on') && R.items[R.index + 1] && R.items[R.index + 1].video) || null
  };

  // The corner-row TT button (index.html) starts TikTok mode, and a second tap ends it.
  function wireCornerBtn() {
    const b = $('reelsCornerBtn');
    if (!b || b.dataset.wired) return;
    b.dataset.wired = '1';
    b.addEventListener('click', e => { e.preventDefault(); toggle(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wireCornerBtn);
  else wireCornerBtn();

})();

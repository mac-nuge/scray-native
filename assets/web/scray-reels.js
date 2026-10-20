/**
 * scray-reels.js - TikTok-style mode. Same file in Picker and Native, like
 * scray-image-viewer.js.
 *
 * What it is: a full-screen overlay that plays portrait videos one at a time.
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
 *     arms it, which sets the orientation filter to portrait and takes the
 *     "soft" tag out of the excluded tags (they go back when the mode ends),
 *     then starts playing a random portrait video;
 *   - while armed, playVideoInline hands every video to the overlay
 *     (player.js scrayPlayReels), and only portrait ones play;
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
  // Containers the web player can't decode (player.js SCRAY_UNPLAYABLE_EXT).
  const NO_PLAY = new Set(['mkv', 'wmv', 'avi', 'flv', 'mpg', 'mpeg', 'rm', 'rmvb', 'asf',
                           'f4v', 'vob', 'divx', 'ogv', 'mts', 'm2v']);

  let armed = false;
  let saved = null;       // what to put back when the mode ends
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
  /** A video the mode will play: portrait (the filter's P - portrait or square) and playable. */
  function canPlay(v) { return playable(v) && isPortrait(v); }

  // ---------------------------------------------------------------- toast
  function toast(text) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.style.cssText = 'position:fixed;left:50%;bottom:calc(env(safe-area-inset-bottom,0px) + 90px);' +
        'transform:translateX(-50%);z-index:100001;background:rgba(0,0,0,.85);color:#fff;padding:8px 14px;' +
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
      if (sel.value !== 'P') {
        sel.value = 'P';
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
      if (sel && s.orient != null && sel.value === 'P' && s.orient !== 'P') {
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

  /** Start playing from the list on screen: a random portrait video, then onwards in list order. */
  async function start() {
    const list = (window.paginationState && window.paginationState.allVideos) || [];
    const ok = list.filter(canPlay);
    if (!ok.length) { toast('No portrait videos in the list'); return; }
    const v = ok[Math.floor(Math.random() * ok.length)];
    if (typeof window.playVideoInline === 'function') await window.playVideoInline(v, 'main', list.indexOf(v));
  }

  async function toggle() {
    if (armed) { disarm(); return; }
    arm();
    // The filter change redraws the list; give it a moment before reading it.
    await new Promise(r => setTimeout(r, 150));
    try { await start(); } catch (err) { console.warn('[reels] could not start:', err); }
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
.sr-root{position:fixed;inset:0;z-index:100000;background:#000;color:#fff;overflow:hidden;touch-action:none;
  user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;display:none;font-family:system-ui,sans-serif}
.sr-root.on{display:block}
.sr-slot{position:absolute;inset:0;background:#000;will-change:transform}
.sr-slot video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000;pointer-events:none}
.sr-cap{position:absolute;left:14px;right:70px;bottom:calc(env(safe-area-inset-bottom,0px) + 22px);font-size:14px;
  line-height:1.3;text-shadow:0 1px 3px #000,0 0 8px #000;pointer-events:none;word-break:break-word}
.sr-spin{position:absolute;left:50%;top:50%;width:34px;height:34px;margin:-17px 0 0 -17px;border:3px solid rgba(255,255,255,.25);
  border-top-color:#fff;border-radius:50%;animation:srspin .8s linear infinite;display:none;pointer-events:none}
.sr-spin.on{display:block}
@keyframes srspin{to{transform:rotate(360deg)}}
.sr-err{position:absolute;left:10%;right:10%;top:45%;text-align:center;font-size:14px;color:#ff8a80;display:none;pointer-events:none}
.sr-err.on{display:block}
.sr-top{position:absolute;left:0;right:0;top:0;display:flex;align-items:center;gap:8px;
  padding:calc(env(safe-area-inset-top,0px) + 10px) 12px 0 12px;pointer-events:none}
.sr-top>*{pointer-events:auto}
.sr-count{margin-right:auto;font-size:12px;opacity:.85;background:rgba(0,0,0,.45);padding:5px 10px;border-radius:14px;pointer-events:none}
.sr-btn{background:rgba(0,0,0,.55);color:#fff;border:1px solid rgba(255,255,255,.35);border-radius:16px;padding:6px 14px;
  font-size:13px;cursor:pointer}
.sr-btn.stop{background:rgba(200,30,60,.85);border-color:transparent;font-weight:600}
.sr-bar{position:absolute;left:0;right:0;bottom:0;height:3px;background:rgba(255,255,255,.25);pointer-events:none}
.sr-bar i{display:block;height:100%;width:0;background:#fff}
.sr-pause{position:absolute;left:50%;top:50%;width:72px;height:72px;margin:-36px 0 0 -36px;border-radius:50%;
  background:rgba(0,0,0,.5);display:none;align-items:center;justify-content:center;font-size:34px;pointer-events:none}
.sr-pause.on{display:flex}
.sr-fb{position:absolute;top:calc(env(safe-area-inset-top,0px) + 56px);background:rgba(0,0,0,.65);padding:6px 12px;border-radius:14px;
  font-size:14px;font-variant-numeric:tabular-nums;opacity:0;transition:opacity .2s;pointer-events:none}
.sr-fb.on{opacity:1}
.sr-hint{position:absolute;left:50%;bottom:calc(env(safe-area-inset-bottom,0px) + 70px);transform:translateX(-50%);
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
    v.addEventListener('playing', () => { slot.spin.classList.remove('on'); if (cur()) showPaused(false); });
    v.addEventListener('canplay', () => { if (cur() && !v.paused) slot.spin.classList.remove('on'); });
    v.addEventListener('timeupdate', () => {
      if (!cur()) return;
      if (v.duration > 0) R.bar.style.width = (100 * v.currentTime / v.duration) + '%';
      if (typeof window.scrayWatchStep === 'function') window.scrayWatchStep(v.currentTime);
    });
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
      '<div class="sr-top"><span class="sr-count"></span>' +
      '<button type="button" class="sr-btn mute" aria-label="Sound"></button>' +
      '<button type="button" class="sr-btn stop">Stop</button></div>' +
      '<div class="sr-bar"><i></i></div><div class="sr-fb"></div><div class="sr-hint">Swipe up for the next video</div>');
    document.body.appendChild(root);
    const st = {
      root, slots, items: [], index: 0, busy: false, muted: lsGet(MUTE_KEY) === '1',
      onShow: null, onClose: null,
      bar: root.querySelector('.sr-bar i'), fb: root.querySelector('.sr-fb'), count: root.querySelector('.sr-count'),
      pauseIcon: root.querySelector('.sr-pause'), hint: root.querySelector('.sr-hint'),
      muteBtn: root.querySelector('.mute'), wheelLock: false, errTimer: 0
    };
    root.querySelector('.stop').addEventListener('click', e => { e.stopPropagation(); disarm(); closeOverlay(); });
    st.muteBtn.addEventListener('click', e => { e.stopPropagation(); setMuted(!R.muted); });
    wireGestures(st);
    return st;
  }

  function setMuted(m) {
    if (!R) return;
    R.muted = !!m;
    lsSet(MUTE_KEY, R.muted ? '1' : '0');
    R.slots.forEach(s => { s.v.muted = R.muted; });
    R.muteBtn.textContent = R.muted ? '🔇 Muted' : '🔊';
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
    slot.cap.textContent = it.name || '';
    if (R.slots[1] === slot) slot.spin.classList.add('on');
    let url;
    try { url = await it.load(); }
    catch (err) { if (slot.tok === my && R) fail(slot, err); return; }
    if (slot.tok !== my || !R) return;
    if (!url) { fail(slot, new Error('no link for this one')); return; }
    slot.v.muted = R.muted;
    slot.v.preload = preload;
    slot.v.src = url;
    if (R.slots[1] === slot) playCur();
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
          setMuted(true);
          v.play().catch(() => showPaused(true));
        } else if (!err || err.name !== 'AbortError') {
          showPaused(true);
        }
      });
    }
  }

  function shown() {
    const it = R.items[R.index];
    R.count.textContent = R.pool ? `${R.index + 1}` : `${R.index + 1} / ${R.items.length}`;
    R.bar.style.width = '0%';
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
    if (R.bar) R.bar.style.width = (100 * t / d) + '%';
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
    let t0 = 0, wasPlaying = false, jog = false, jogMult = 32, mult = 1, raf = 0, pending = null;
    // taps
    let lastTapAt = 0, tapTimer = 0, lastSeekAt = 0, lastSeekSign = 0;

    const flush = () => { raf = 0; if (pending != null) { seekTo(pending); pending = null; } };

    root.addEventListener('pointerdown', e => {
      if (!R || R.busy || e.target.closest('.sr-btn')) return;
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
          jog = v.paused;
          t0 = v.currentTime;
          wasPlaying = !v.paused;
          if (wasPlaying) v.pause();                      // a still frame to seek against
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
        pending = t;
        if (!raf) raf = requestAnimationFrame(flush);
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
        if (raf) { cancelAnimationFrame(raf); raf = 0; }
        if (pending != null) { seekTo(pending); pending = null; }
        if (wasPlaying) playCur();
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

  function onKey(e) {
    if (!R) return;
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
    const at = Math.max(0, Math.min(items.length - 1, (opts.index | 0)));
    if (opts.shuffle) {
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
    R.onShow = opts.onShow || null;
    R.onClose = opts.onClose || null;
    R.busy = false;
    try { window.plyrPlayer && window.plyrPlayer.pause && window.plyrPlayer.pause(); } catch (e) { /* nothing playing */ }
    R.root.classList.add('on');
    document.documentElement.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey, true);
    setMuted(R.muted);
    layout(0, false);
    fill(R.slots[1], R.index, 'auto');
    fill(R.slots[2], R.index + 1, 'auto');
    fill(R.slots[0], R.index - 1, 'metadata');
    shown();
    R.hint.textContent = R.pool ? 'Swipe up for the next - random' : 'Swipe up for the next video';
    R.hint.classList.add('on');
    setTimeout(() => { if (R) R.hint.classList.remove('on'); }, 2600);
    return true;
  }

  /** The playing video's own row changed (the same overlay, a new list). */
  function closeOverlay() {
    if (!R || !R.root.classList.contains('on')) return;
    clearTimeout(R.errTimer);
    if (typeof window.scrayWatchFlush === 'function') window.scrayWatchFlush();
    R.slots.forEach(s => { s.tok++; resetSlot(s); s.idx = -1; });
    R.root.classList.remove('on');
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
    canPlay, toast
  };

})();

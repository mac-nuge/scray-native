// ============================================================================
// scray-perf.js - PERFORMANCE MONITOR by the console (native 13.180; moved
// from under the player to directly above the on-page console in 13.181)
//
// A one-line health readout, so a long session's slowdown can be SEEN
// building rather than guessed at:
//
//   ● mem 23% · 60fps · lag 3ms · DOM 3.1k · PL 212 · cool
//
//   ●     green / amber / red - the worst of everything below
//   mem   the app's memory in use, as a share of what iOS will let it have
//         before it is killed (needs the 13.180 IPA - shows "mem –" before)
//   fps   frames the page managed in a short sample; 60 is smooth
//   lag   how late a timer fired - the main thread being too busy to answer
//   DOM   elements in the page; should level off, not climb all session
//   PL    Plyr listener records; should stay roughly flat per video
//   cool  the phone's thermal state (cool / warm / hot / too hot)
//
// Tap it for the breakdown and a "Refresh page" button - the same clean slate
// a restart gives (the page's memory, listeners and media all start again),
// which reopens the video you were on at the same point and skips the lock.
//
// What it CAN'T show: WebKit runs the page in its own process and iOS gives
// apps no way to read another process's memory. DOM, PL, fps and lag are the
// page-side stand-ins; mem is the app process itself.
//
// Cheap by design: one timer every 2s, a half-second frame sample within it,
// nothing at all while fullscreen or the app is hidden.
// ============================================================================
(function () {
  'use strict';

  const IS_NATIVE = !!(window.webkit && window.webkit.messageHandlers
    && window.webkit.messageHandlers.scrayBridge);

  // ⚙️ Tuning
  const TICK_MS = 2000;             // how often the line updates
  const FPS_SAMPLE_MS = 500;        // frame-count window inside each tick
  const DOM_COUNT_EVERY_TICKS = 3;  // DOM count is the priciest read - every 6s
  const HOUSEKEEP_EVERY_TICKS = 30; // listener prune etc - about once a minute
  const REFRESH_KEY = 'scray_perf_refresh';
  const REFRESH_MAX_AGE_MS = 30000; // a refresh mark older than this is ignored
  // ⚙️ Thresholds for the dot: [amber, red]
  const MEM_PCT = [60, 80];
  const FPS = [45, 25];             // below these
  const LAG_MS = [60, 250];
  const WARNING_RED_FOR_MS = 120000; // an iOS memory warning keeps it red this long

  const COLORS = { ok: '#4caf50', warn: '#ff9800', bad: '#f44336' };
  const THERMAL_LABEL = { nominal: 'cool', fair: 'warm', serious: 'hot', critical: 'too hot' };

  const s = {
    fps: null, lag: null,
    dom: null, domStart: null,
    pl: null, plStart: null,
    videos: null,
    native: null, nativeMissing: !IS_NATIVE,
    pageWarnings: 0, lastWarningAt: 0,
    ticks: 0
  };

  let root = null, lineEl = null, detailEl = null, expanded = false;
  let timer = null, expectedAt = 0, sampling = false;

  // ---------------------------------------------------------------- DOM ----

  function injectStyle() {
    if (document.getElementById('scrayPerfMonitorStyle')) return;
    const st = document.createElement('style');
    st.id = 'scrayPerfMonitorStyle';
    st.textContent = `
      /* Styled to sit with the console box below it (style.css INLINE CONSOLE). */
      #scrayPerfMonitor {
        font: 10px/1.35 ui-monospace, Menlo, monospace;
        color: #333; background: #f9f9f9;
        border: 1px solid #ccc; border-bottom: none;
        padding: 3px 6px; box-sizing: border-box;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        -webkit-user-select: none; user-select: none; cursor: pointer;
        -webkit-tap-highlight-color: transparent;
      }
      body.fullscreen-active:not(.fls-peek) #scrayPerfMonitor { display: none !important; }
      #scrayPerfMonitor .spm-dot { font-size: 11px; }
      #scrayPerfMonitor .spm-detail { white-space: normal; padding: 4px 0 2px; color: #555; }
      #scrayPerfMonitor .spm-detail > div { margin: 1px 0; }
      #scrayPerfMonitor .spm-note { color: #888; }
      #scrayPerfMonitor .spm-actions { display: flex; gap: 8px; margin-top: 5px; }
      #scrayPerfMonitor .spm-actions button {
        font: 11px/1 -apple-system, system-ui, sans-serif; color: #222;
        background: #eee; border: 1px solid #999; border-radius: 6px; padding: 6px 10px;
      }
      #scrayPerfMonitor .spm-actions button[data-spm="refresh"] { color: #fff; background: #1565c0; border-color: #1e88e5; }
    `;
    document.head.appendChild(st);
  }

  function ensureRoot() {
    if (root && root.isConnected) return root;
    injectStyle();
    const consoleEl = document.getElementById('inlineConsole');
    if (!consoleEl) return null;
    root = document.getElementById('scrayPerfMonitor');
    if (!root) {
      root = document.createElement('div');
      root.id = 'scrayPerfMonitor';
      root.innerHTML = '<div class="spm-line"></div><div class="spm-detail" hidden></div>';
      root.addEventListener('click', onTap);
    }
    // Directly above the on-page console (13.181) - an ordinary in-flow line,
    // so it scrolls with the console and stays out of the player's layout.
    if (consoleEl.previousElementSibling !== root) consoleEl.insertAdjacentElement('beforebegin', root);
    lineEl = root.querySelector('.spm-line');
    detailEl = root.querySelector('.spm-detail');
    return root;
  }

  function visible() {
    const b = document.body;
    // Shown whether or not anything is playing (13.181) - it lives by the
    // console now, not in the player.
    return !!b && !document.hidden
      && !(b.classList.contains('fullscreen-active') && !b.classList.contains('fls-peek'));
  }

  // ------------------------------------------------------------ Sampling ---

  function sampleFps() {
    if (sampling) return;
    sampling = true;
    let frames = 0;
    const t0 = performance.now();
    const step = (t) => {
      frames++;
      if (t - t0 < FPS_SAMPLE_MS) { requestAnimationFrame(step); return; }
      sampling = false;
      s.fps = Math.min(60, Math.round((frames - 1) * 1000 / Math.max(1, t - t0)));
    };
    requestAnimationFrame(step);
  }

  function readPage() {
    const p = window.plyrPlayer;
    if (p && Array.isArray(p.eventListeners)) {
      s.pl = p.eventListeners.length;
      if (s.plStart === null) s.plStart = s.pl;
    }
    if (s.ticks % DOM_COUNT_EVERY_TICKS === 0 || s.dom === null) {
      s.dom = document.getElementsByTagName('*').length;
      if (s.domStart === null) s.domStart = s.dom;
      s.videos = document.getElementsByTagName('video').length;
    }
  }

  function readNative() {
    if (s.nativeMissing) return;
    const bridge = window.ScrayBridge;
    if (!bridge || typeof bridge.memoryStats !== 'function') { s.nativeMissing = true; return; }
    bridge.memoryStats().then((r) => {
      s.native = r || null;
    }).catch(() => {
      // "Unknown action" - an IPA from before 13.180. Stop asking.
      s.nativeMissing = true;
      s.native = null;
    });
  }

  // ---------------------------------------------------------- Rendering ----

  function fmtK(n) {
    if (n === null || n === undefined) return '–';
    return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);
  }
  function fmtMB(bytes) {
    if (!bytes && bytes !== 0) return '–';
    return bytes >= 1024 * 1024 * 1024
      ? (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB'
      : Math.round(bytes / (1024 * 1024)) + ' MB';
  }

  function memPct() {
    const n = s.native;
    if (!n || !n.footprintBytes || n.availableBytes === undefined) return null;
    const limit = n.footprintBytes + n.availableBytes;
    return limit > 0 ? Math.round(n.footprintBytes * 100 / limit) : null;
  }

  function level(value, [amber, red], lowerIsWorse) {
    if (value === null || value === undefined) return 0;
    if (lowerIsWorse) return value < red ? 2 : value < amber ? 1 : 0;
    return value >= red ? 2 : value >= amber ? 1 : 0;
  }

  function recentWarning() {
    const n = s.native;
    const nativeRecent = n && typeof n.secondsSinceWarning === 'number'
      && n.secondsSinceWarning * 1000 < WARNING_RED_FOR_MS;
    const pageRecent = s.lastWarningAt && Date.now() - s.lastWarningAt < WARNING_RED_FOR_MS;
    return !!(nativeRecent || pageRecent);
  }

  function health() {
    const thermal = s.native && s.native.thermal;
    const t = thermal === 'serious' || thermal === 'critical' ? 2 : thermal === 'fair' ? 1 : 0;
    const worst = Math.max(
      level(memPct(), MEM_PCT),
      level(s.fps, FPS, true),
      level(s.lag, LAG_MS),
      t,
      recentWarning() ? 2 : 0
    );
    return worst === 2 ? 'bad' : worst === 1 ? 'warn' : 'ok';
  }

  function render() {
    if (!ensureRoot()) return;
    const pct = memPct();
    const thermal = s.native && s.native.thermal;
    const parts = [
      `mem ${pct === null ? '–' : pct + '%'}`,
      `${s.fps === null ? '–' : s.fps}fps`,
      `lag ${s.lag === null ? '–' : Math.round(s.lag) + 'ms'}`,
      `DOM ${fmtK(s.dom)}`,
      `PL ${fmtK(s.pl)}`
    ];
    if (thermal) parts.push(THERMAL_LABEL[thermal] || thermal);
    if (recentWarning()) parts.push('LOW MEM');
    const h = health();
    const text = parts.join(' · ');
    const html = `<span class="spm-dot" style="color:${COLORS[h]}">●</span> ${text}`;
    if (lineEl.__html !== html) { lineEl.innerHTML = html; lineEl.__html = html; }
    if (expanded) renderDetail();
  }

  function renderDetail() {
    const n = s.native;
    const pct = memPct();
    const rows = [];
    if (n) {
      rows.push(`App process: ${fmtMB(n.footprintBytes)} of ~${fmtMB(n.footprintBytes + n.availableBytes)} allowed (${pct}%)`);
      rows.push(`Phone: ${fmtMB(n.physicalBytes)} RAM · ${THERMAL_LABEL[n.thermal] || n.thermal}${n.lowPower ? ' · Low Power on' : ''} · iOS memory warnings: ${n.memoryWarnings || 0}`);
    } else {
      rows.push(IS_NATIVE
        ? 'App memory / heat: needs the 13.180 IPA build'
        : 'App memory / heat: Native only');
    }
    rows.push(`Page: ${fmtK(s.dom)} DOM nodes (${fmtK(s.domStart)} at start) · ${s.videos ?? '–'} video element${s.videos === 1 ? '' : 's'}`);
    rows.push(`Plyr listener records: ${s.pl ?? '–'} (${s.plStart ?? '–'} at start)`);
    rows.push(`Main thread: ${s.fps ?? '–'} fps · timer lag ${s.lag === null ? '–' : Math.round(s.lag) + ' ms'}`);
    rows.push('<span class="spm-note">The page itself runs in WebKit\'s own process, which iOS doesn\'t let apps measure - DOM, PL, fps and lag stand in for it.</span>');
    const html = rows.map(r => `<div>${r}</div>`).join('')
      + '<div class="spm-actions"><button type="button" data-spm="refresh">↻ Refresh page</button>'
      + '<button type="button" data-spm="close">Close</button></div>';
    if (detailEl.__html !== html) { detailEl.innerHTML = html; detailEl.__html = html; }
  }

  function onTap(e) {
    e.stopPropagation();
    const action = e.target && e.target.closest && e.target.closest('[data-spm]');
    const which = action ? action.dataset.spm : null;
    if (which === 'refresh') { refreshPage(); return; }
    expanded = which === 'close' ? false : !expanded;
    detailEl.hidden = !expanded;
    render();
  }

  // --------------------------------------------------------------- Loop ----

  function tick() {
    timer = null;
    const now = performance.now();
    if (expectedAt) s.lag = Math.max(0, now - expectedAt);
    s.ticks++;

    if (s.ticks % HOUSEKEEP_EVERY_TICKS === 0) housekeep();

    if (visible()) {
      readPage();
      readNative();
      sampleFps();
      // Rendered next tick with the samples just taken; the first one now.
      render();
    }
    schedule();
  }

  function schedule() {
    if (timer) return;
    expectedAt = performance.now() + TICK_MS;
    timer = setTimeout(tick, TICK_MS);
  }

  // A hidden page's timers are throttled - that isn't lag. Start clean.
  document.addEventListener('visibilitychange', () => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!document.hidden) { s.lag = null; schedule(); }
  });

  // --------------------------------------------------------- Housekeeping --

  /** Safe to run any time: only drops things that are already dead. */
  function housekeep() {
    try {
      const p = window.plyrPlayer;
      if (p && typeof window.scrayPrunePlyrListeners === 'function') {
        window.scrayPrunePlyrListeners(p, {});
      }
    } catch (e) {}
  }

  /** iOS says memory is short (ScrayNativeView.notifyMemoryWarning). */
  window.scrayOnMemoryWarning = function () {
    s.pageWarnings++;
    s.lastWarningAt = Date.now();
    housekeep();
    // The on-page console is the biggest thing that is safe to throw away.
    const con = document.getElementById('inlineConsole');
    if (con) {
      while (con.childElementCount > 50 && con.firstChild) con.firstChild.remove();
    }
    console.warn('[perf] iOS memory warning');
    if (visible()) render();
  };

  // ------------------------------------------------------------ Refresh ----

  function refreshPage() {
    const v = window.currentPlayingVideo;
    const p = window.plyrPlayer;
    const mark = { at: Date.now() };
    if (v && v.oneDriveId) {
      mark.oneDriveId = v.oneDriveId;
      mark.time = p && isFinite(p.currentTime) ? p.currentTime : 0;
      mark.paused = !!(p && p.paused);
    }
    try { sessionStorage.setItem(REFRESH_KEY, JSON.stringify(mark)); } catch (e) {}
    location.reload();
  }

  /** Read once, then gone - a later manual reload is a normal launch. */
  function takeRefreshMark() {
    let mark = null;
    try {
      const raw = sessionStorage.getItem(REFRESH_KEY);
      sessionStorage.removeItem(REFRESH_KEY);
      if (raw) mark = JSON.parse(raw);
    } catch (e) {}
    if (!mark || !mark.at || Date.now() - mark.at > REFRESH_MAX_AGE_MS) return null;
    return mark;
  }

  const pendingRefresh = takeRefreshMark();
  // The lock screen asks this before it shows (index.html).
  window.scrayPerfRefreshed = !!pendingRefresh;

  async function resumeAfterRefresh(mark) {
    if (!mark || !mark.oneDriveId) return;
    // The catalogue loads asynchronously after boot; wait for it (≤15s).
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      try {
        if (typeof window.getAllVideos === 'function' && window.inlineVideoPlayer) {
          const all = await window.getAllVideos();
          const match = all && all.find(x => x.oneDriveId === mark.oneDriveId);
          if (match) {
            const list = (window.paginationState && window.paginationState.allVideos) || [];
            const idx = list.findIndex(x => x.oneDriveId === match.oneDriveId);
            await window.inlineVideoPlayer.play(match, idx >= 0 ? 'main' : null,
              idx >= 0 ? idx : null, mark.time > 1 ? mark.time : null);
            if (mark.paused && window.plyrPlayer) {
              window.plyrPlayer.once('playing', () => window.plyrPlayer.pause());
            }
            return;
          }
          if (all && all.length) return; // catalogue is here, video isn't
        }
      } catch (e) { /* try again */ }
      await new Promise(r => setTimeout(r, 500));
    }
  }

  // --------------------------------------------------------------- Boot ----

  function boot() {
    ensureRoot();
    if (visible()) render();
    schedule();
    if (pendingRefresh) setTimeout(() => resumeAfterRefresh(pendingRefresh), 800);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 0), { once: true });
  } else {
    setTimeout(boot, 0);
  }

  window.scrayPerf = { state: s, render, housekeep, refresh: refreshPage };
})();

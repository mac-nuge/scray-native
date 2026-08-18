/**
 * Scray sync configuration. Same file in Native and Picker.
 * The API key is not a secret from you — it's a secret from the internet.
 * Anyone with the app bundle can read it, which is fine: the threat model
 * is "random person finds the endpoint", not "attacker has your phone".
 */
/* =========================================
   BOOT WATCHER — the "READY" confirmation
   =========================================

   Start-up fans out across a dozen independent async chains (MSAL re-auth,
   score/bookmark/view-count loads, bookmark-note preload, tag dropdowns,
   catalogue sync), most of them fire-and-forget and several kicked off from
   inside other files by their LOCAL bindings - so a list of window.* names
   to await can never see them all. That's what made the first attempt fire
   early.

   So this doesn't try to enumerate anything. It counts in-flight HTTP
   requests and declares READY once the network has been quiet for a while.
   Anything genuinely slow at start-up is network-bound, so quiet means done.
   Nothing needs to register itself; new start-up work is covered
   automatically.

   Lives in scray-config.js because it loads 2nd, before db.js / auth.js /
   excel-sheets.js - the hooks must be in place before the first request.
   ========================================= */
window.scrayBoot = (function () {
  // ⚙️ ADJUSTABLE: earliest READY can appear, ms. Also covers work that
  //    starts on a timer - Native's catalogue sync fires at 2s, so this must
  //    stay above that or READY can land before the sync even begins.
  const MIN_MS   = 3000;
  // ⚙️ ADJUSTABLE: how long the network must stay silent before we call it
  //    done, ms. Also the grace period for the IndexedDB writes that follow
  //    each load ("Saved 332 scores..."). Raise if READY still feels early.
  const QUIET_MS = 2000;
  // ⚙️ ADJUSTABLE: hard ceiling, ms. Something is wedged - say so and stop.
  const MAX_MS   = 90000;

  const t0 = Date.now();
  let inFlight = 0;         // open HTTP requests
  let extra = 0;            // non-HTTP work registered via track()
  let lastActivity = Date.now();
  let done = false;
  let timer = null;

  const bump = () => { lastActivity = Date.now(); };

  // ---- fetch -------------------------------------------------------------
  const origFetch = typeof window.fetch === 'function' ? window.fetch.bind(window) : null;
  if (origFetch) {
    window.fetch = function (...args) {
      inFlight++; bump();
      let p;
      try {
        p = origFetch(...args);
      } catch (err) {
        inFlight--; bump();
        throw err;
      }
      return p.then(
        (res) => { inFlight--; bump(); return res; },
        (err) => { inFlight--; bump(); throw err; }
      );
    };
  }

  // ---- XMLHttpRequest ----------------------------------------------------
  // MSAL and jQuery both fall back to XHR in places, and a missed request
  // source would mean READY fires while that work is still running.
  const origSend = window.XMLHttpRequest && window.XMLHttpRequest.prototype.send;
  if (origSend) {
    window.XMLHttpRequest.prototype.send = function (...args) {
      let settled = false;
      const release = () => {
        if (settled) return;
        settled = true;
        inFlight--; bump();
      };
      inFlight++; bump();
      this.addEventListener('loadend', release);
      try {
        return origSend.apply(this, args);
      } catch (err) {
        release();
        throw err;
      }
    };
  }

  /**
   * Escape hatch for start-up work that never touches the network - a long
   * IndexedDB migration, say. Pass a promise; READY waits for it.
   */
  function track(promise) {
    if (!promise || typeof promise.then !== 'function') return promise;
    extra++; bump();
    const release = () => { extra--; bump(); };
    promise.then(release, release);
    return promise;
  }

  // ⚙️ ADJUSTABLE: the READY confirmation's look and dwell time.
  const READY_COLOUR   = '#ff9800';  // matches the score badges / progress end caps
  const READY_FONT     = '1.7rem';   // the word READY itself
  const READY_DWELL_MS = 2200;       // how long it sits before fading

  function toast(secs) {
    const el = document.createElement('div');
    el.innerHTML =
      `✅ READY<br><span style="font-size:0.42em;opacity:0.9;font-weight:normal;">start-up finished in ${secs}s</span>`;
    // Fully inline rather than borrowing .score-confirmation-tooltip: that
    // class positions itself near the bottom of the screen, and a class rule
    // fighting inline centring is exactly the kind of thing that silently
    // breaks later. Nothing here depends on style.css.
    el.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%) scale(0.92);
      background: ${READY_COLOUR};
      color: #fff;
      padding: 20px 34px;
      border-radius: 12px;
      box-shadow: 0 6px 24px rgba(0, 0, 0, 0.45);
      font-family: Arial, sans-serif;
      font-size: ${READY_FONT};
      font-weight: bold;
      letter-spacing: 0.06em;
      line-height: 1.35;
      text-align: center;
      white-space: nowrap;
      max-width: 90vw;
      pointer-events: none;
      z-index: 2147483646;
      opacity: 0;
      transition: opacity 0.25s ease, transform 0.25s ease;
    `;
    document.body.appendChild(el);
    // Next frame, so the browser has a starting state to animate FROM -
    // setting both states in one go would skip the transition entirely.
    requestAnimationFrame(() => {
      el.style.opacity = '0.96';
      el.style.transform = 'translate(-50%, -50%) scale(1)';
    });
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translate(-50%, -50%) scale(0.96)';
      setTimeout(() => el.remove(), 350);
    }, READY_DWELL_MS);
  }

  function settle(reason) {
    if (done) return;
    done = true;
    clearInterval(timer);
    // Put the originals back - no reason to keep instrumenting for the rest
    // of the session.
    if (origFetch) window.fetch = origFetch;
    if (origSend) window.XMLHttpRequest.prototype.send = origSend;

    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    if (reason === 'ceiling') {
      console.warn(`[boot] hit the ${MAX_MS / 1000}s ceiling with ${inFlight} request(s) still open - calling it ready anyway`);
    } else {
      console.log(`[boot] READY - all start-up work finished in ${secs}s`);
    }
    try { toast(secs); } catch (e) { /* a failed toast must never break boot */ }
  }

  function start() {
    timer = setInterval(() => {
      const now = Date.now();
      if (now - t0 > MAX_MS)           return settle('ceiling');
      if (now - t0 < MIN_MS)           return;
      if (inFlight > 0 || extra > 0)   return;
      if (now - lastActivity < QUIET_MS) return;
      settle('quiet');
    }, 250);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  return {
    track,
    settle: () => settle('manual'),
    stats: () => ({ inFlight, extra, elapsed: Date.now() - t0 })
  };
})();

window.SCRAY_SYNC = {
  API_BASE: "https://macnguyen.com/scray/api.php",
  API_KEY:  "d0ae361fdf8759771caf2c989b1bfec07c3fb24b5c4d11433e01fbeae666d7cb",

  // Distinguishes rows in sync_log and drives conflict messages.
  DEVICE_ID: (() => {
    let d = localStorage.getItem("scray_device_id");
    if (!d) {
      const guess = /iPhone|iPad/.test(navigator.userAgent)
        ? (window.ScrayBridge ? "native-ios" : "safari-ios")
        : "desktop";
      d = `${guess}-${Math.random().toString(36).slice(2, 7)}`;
      localStorage.setItem("scray_device_id", d);
    }
    return d;
  })(),

  PING_TIMEOUT_MS: 4000,
  PUSH_BATCH_SIZE: 200,
  AUTO_SYNC_ON_RECONNECT: true,   // still prompts — this only controls the prompt firing
};

/**
 * The single definition of a video_key. Must match schema_v2 / the server byte
 * for byte.
 *
 * NFC first: iOS stores filenames decomposed (café = c a f e U+0301) while
 * Graph returns them composed (café = c a f é). Without this the same file
 * produces two different keys and Native never joins to the catalogue.
 */
window.scrayVideoKey = function (filename) {
  return String(filename || "").normalize("NFC").trim().toLowerCase();
};

/**
 * Filename-free fingerprint, so it survives a rename.
 *
 * Bitrate is deliberately excluded: Graph frequently returns null and
 * fetchVideoFacet backfills it afterwards, so it is not reliably present at
 * fingerprint time. Duration is rounded to whole seconds because container
 * remuxes drift by a few milliseconds.
 */
window.scrayFingerprint = function (v) {
  const size = v?.sizeBytes ?? v?.file_size_bytes ?? null;
  if (size == null) return null;              // worthless without the size anchor
  const dur = v?.durationMs ?? v?.duration_ms ?? null;
  const d = dur != null ? Math.round(dur / 1000) : "?";
  return `${size}:${d}:${v?.width ?? "?"}x${v?.height ?? "?"}`;
};
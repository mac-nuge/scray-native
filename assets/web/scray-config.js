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
  // ⚙️ ADJUSTABLE: the start-up run. minMs is the earliest READY can appear -
  //    it also covers work that starts on a timer, and Native's catalogue
  //    sync fires at 2s, so it must stay above that or READY can land before
  //    the sync even begins. quietMs is how long the network must stay silent
  //    before we call it done, and doubles as the grace period for the
  //    IndexedDB writes that follow each load ("Saved 332 scores..."). maxMs
  //    is a hard ceiling - something is wedged, say so and stop.
  const BOOT = { minMs: 3000, quietMs: 2000, maxMs: 90000 };

  // ⚙️ ADJUSTABLE: a folder refresh / folder add run. The work itself is
  //    handed to watch() as a promise, so there is no timer-delayed work to
  //    guard against and minMs can be short. The ceiling is generous because
  //    a first scan of a large folder is thousands of metadata reads.
  const TASK = { minMs: 800, quietMs: 1500, maxMs: 900000 };

  const bootT0 = Date.now();
  let inFlight = 0;         // open HTTP requests
  let extra = 0;            // non-HTTP work registered via track()
  let lastActivity = Date.now();

  // The run currently being watched, or null between runs. Keeping this in
  // one object rather than loose t0/done/timer is what lets a second run
  // happen at all - the old flat state could only ever settle once.
  let run = null;

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

  function toast(secs, label) {
    const el = document.createElement('div');
    el.innerHTML =
      `✅ READY<br><span style="font-size:0.42em;opacity:0.9;font-weight:normal;">${label || 'start-up'} finished in ${secs}s</span>`;
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

  // Note the fetch/XHR wrappers above now stay installed for the whole
  // session - settle() no longer puts the originals back. That was fine when
  // READY fired exactly once, but a second run needs the counters live again,
  // and re-wrapping a wrapper (or unwrapping over somebody else's later
  // wrapper) is how you end up with a permanently negative inFlight and a
  // READY that never fires. A counter increment per request costs nothing.

  function begin(label, cfg) {
    // Already watching something - fold this in rather than stacking two
    // toasts. Refresh-all-accounts fans out into one call per account and
    // would otherwise fire a separate READY for each one.
    if (run) {
      if (label) run.label = label;
      bump();
      return run;
    }
    run = { label: label || null, cfg, t0: Date.now(), timer: null, done: false };
    bump();
    run.timer = setInterval(tick, 250);
    return run;
  }

  function tick() {
    if (!run) return;
    const now = Date.now();
    const { minMs, quietMs, maxMs } = run.cfg;
    if (now - run.t0 > maxMs)           return settle('ceiling');
    if (now - run.t0 < minMs)           return;
    if (inFlight > 0 || extra > 0)      return;
    if (now - lastActivity < quietMs)   return;
    settle('quiet');
  }

  // Ends a run WITHOUT a toast - used when the watched work throws. A refresh
  // that failed must not be announced as READY.
  function abandon() {
    if (!run) return;
    run.done = true;
    clearInterval(run.timer);
    run = null;
  }

  function settle(reason) {
    if (!run || run.done) return;
    const finished = run;
    finished.done = true;
    clearInterval(finished.timer);
    run = null;

    const label = finished.label || 'start-up';
    const secs = ((Date.now() - finished.t0) / 1000).toFixed(1);
    if (reason === 'ceiling') {
      console.warn(`[boot] ${label}: hit the ${finished.cfg.maxMs / 1000}s ceiling with ${inFlight} request(s) still open - calling it ready anyway`);
    } else {
      console.log(`[boot] READY - ${label} finished in ${secs}s`);
    }
    try { toast(secs, label); } catch (e) { /* a failed toast must never break anything */ }
  }

  /**
   * Watch a discrete piece of work and show the READY confirmation once it
   * has genuinely finished - which is later than the promise resolving.
   *
   * A folder refresh returns as soon as its own awaits are done, but the
   * catalogue push, the score re-apply, the tag dropdowns and the grid
   * repaint are all still settling behind it. So the promise only holds the
   * run OPEN; the same network-quiet test that ends start-up is what actually
   * ends this. READY therefore means "loaded, pushed, joined and painted".
   *
   *   await window.scrayWatch("folder refresh", () => scanLocalLibrary());
   */
  function watch(label, work, cfg) {
    const mine = begin(label, cfg || TASK);
    let p;
    try {
      p = Promise.resolve(typeof work === 'function' ? work() : work);
    } catch (err) {
      if (run === mine) abandon();
      return Promise.reject(err);
    }
    extra++; bump();
    return p.then(
      (val) => { extra--; bump(); return val; },
      (err) => { extra--; bump(); if (run === mine) abandon(); throw err; }
    );
  }

  // bootT0 is script-parse time, not DOMContentLoaded, so the reported
  // start-up duration stays what it always was.
  function start() { begin(null, BOOT).t0 = bootT0; }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  return {
    track,
    watch,
    settle: () => settle('manual'),
    stats: () => ({ inFlight, extra, running: !!run, elapsed: run ? Date.now() - run.t0 : 0 })
  };
})();

/**
 * One-liner so call sites don't each need a guard. Behaves exactly like
 * scrayBoot.watch, but still runs the work if the watcher somehow isn't there
 * - a missing confirmation must never cost you the refresh itself.
 */
window.scrayWatch = function (label, work) {
  if (window.scrayBoot && typeof window.scrayBoot.watch === 'function') {
    return window.scrayBoot.watch(label, work);
  }
  return Promise.resolve(typeof work === 'function' ? work() : work);
};

const PICKER_URL_KEY = "scray_picker_url";

/**
 * Where the Picker buttons and the in-app browser's home button point.
 * A localStorage override beats the SCRAY_SYNC default, so staging, production
 * and a laptop dev server can be swapped on the device. Matters most in
 * Native, which ships as a signed IPA - editing the constant means a rebuild.
 */
window.scrayPickerUrl = function () {
  try {
    const override = localStorage.getItem(PICKER_URL_KEY);
    if (override) return override;
  } catch {}
  return window.SCRAY_SYNC.PICKER_URL;
};

/**
 * Pass a falsy value to clear the override and fall back to the default.
 * Returns the URL now in effect; throws if the input isn't a usable http(s)
 * URL, so a typo can't leave the button pointing at nowhere.
 */
window.scraySetPickerUrl = function (url) {
  try {
    const trimmed = String(url || "").trim();
    if (!trimmed) {
      localStorage.removeItem(PICKER_URL_KEY);
    } else {
      // new URL() throws on nonsense; the protocol check then keeps out
      // javascript: and file:, which parse fine but have no business here.
      const parsed = new URL(trimmed);
      if (!/^https?:$/.test(parsed.protocol)) throw new Error("must be http or https");
      localStorage.setItem(PICKER_URL_KEY, parsed.href);
    }
  } catch (err) {
    console.warn("[picker-url] rejected:", err.message);
    throw err;
  }
  return window.scrayPickerUrl();
};

window.SCRAY_SYNC = {
  API_BASE: "https://macnguyen.com/scray/api.php",

  // Where the in-app browser's home button goes. Harmless in Picker itself,
  // which keeps this file byte-identical to Native's copy.
  // This is the DEFAULT - the live value comes from scrayPickerUrl() below,
  // which lets a per-device localStorage override win.
  PICKER_URL: "https://macnguyen.com/sp-staging-sql/",
  BROWSE_URL: "https://macnguyen.com/scray/browse.html",
  // Supplied by scray-key.js, generated at build time by the workflow from
  // the SCRAY_API_KEY repo secret. Empty here means the build step did not
  // run — every call will 401, which is the correct loud failure.
  API_KEY:  (typeof window.SCRAY_API_KEY === "string" ? window.SCRAY_API_KEY : ""),

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

/* =========================================
   DISPLAY NAME MAPPING
   =========================================

   One dictionary, two kinds: 'studio' and 'note'. manage-data.html writes it;
   everything that PRINTS one of those strings reads it through
   scrayMapName(). EDITING surfaces deliberately do not - the bookmark modal
   has to show, and save, the raw text, or a tidy-up would silently rewrite
   the row it was only meant to relabel.

   The same rows also carry ATTRIBUTES - a studio's region and class today -
   which are not display names at all: nothing prints them, the studio cloud
   groups by them. attrsFor() answers by either spelling, so a caller holding a
   mapped name and a caller holding a raw one both find the same row.

   Synchronous by design: it returns the raw string until the dictionary
   lands, so a slow or failed fetch degrades to today's behaviour instead of
   blanking a label. The localStorage copy means that only ever happens on a
   genuinely first run.

   Lives here rather than in a new file so Native needs no change to
   index.html's script list and no bundle rebuild to pick it up.
   ========================================= */
window.scrayNameMap = (function () {
  // v2: the cached payload gained attributes, and a v1 blob would leave the
  // studio cloud with no rows until the TTL expired.
  const CACHE_KEY = "scray_name_maps_v2";
  const TTL_MS    = 10 * 60 * 1000;

  let dict     = { studio: {}, note: {} };
  let attrs    = { studio: {}, note: {} };
  let defs     = { studio: [], note: [] };
  // raw_key AND the fold key of the mapped spelling both point at the same
  // attribute object. A caller asks by whichever name it happens to be
  // holding - the lists print the mapped one, the database carries the raw
  // one - and neither has to know whether a studio was ever renamed.
  let index    = { studio: {}, note: {} };
  let loadedAt = 0;
  let inFlight = null;

  // Must stay identical to scrayNameKey() in api.php and nameKey() in
  // manage-data.html, or a saved mapping is never found.
  const key = (s) => String(s == null ? "" : s).normalize("NFC").trim().toLowerCase();

  function reindex() {
    index = { studio: {}, note: {} };
    Object.keys(index).forEach(kind => {
      const table = attrs[kind] || {};
      const names = dict[kind]  || {};
      Object.keys(table).forEach(rk => {
        const a = table[rk];
        if (!a) return;
        index[kind][rk] = a;
        const m = names[rk];
        if (m) index[kind][key(m)] = a;
      });
    });
  }

  // One path for the cached copy and the fetched one, so a shape change can
  // only ever be got wrong in a single place.
  function adopt(payload) {
    const p = payload || {};
    dict  = { studio: (p.maps      && p.maps.studio)      || {}, note: (p.maps      && p.maps.note)      || {} };
    attrs = { studio: (p.attrs     && p.attrs.studio)     || {}, note: (p.attrs     && p.attrs.note)     || {} };
    defs  = { studio: (p.attr_defs && p.attr_defs.studio) || [], note: (p.attr_defs && p.attr_defs.note) || [] };
    reindex();
  }

  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    if (cached && cached.maps) { adopt(cached); loadedAt = cached.at || 0; }
  } catch { /* corrupt cache is the same as no cache */ }
  // The v1 blob has no attributes in it and will never be read again.
  try { localStorage.removeItem("scray_name_maps_v1"); } catch {}

  function lookup(kind, raw) {
    const original = String(raw == null ? "" : raw);
    const table = dict[kind];
    if (!table || !original) return original;
    const hit = table[key(original)];
    return (typeof hit === "string" && hit !== "") ? hit : original;
  }

  /**
   * The attributes filed against one name, by either spelling. Always an
   * object, so a caller can read a key straight off it - an unknown name and a
   * name with nothing filled in are the same answer.
   */
  function attrsFor(kind, name) {
    const table = index[kind];
    if (!table) return {};
    return table[key(name)] || {};
  }

  /** [{ key, label }] for one kind, straight from api.php's declaration. */
  function attrDefs(kind) {
    return defs[kind] || [];
  }

  async function refresh(force) {
    if (!force && Date.now() - loadedAt < TTL_MS) return dict;
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        const url = new URL(window.SCRAY_SYNC.API_BASE);
        url.searchParams.set("action", "name_map_get");
        const res  = await fetch(url.toString(), { headers: { "X-Scray-Key": window.SCRAY_SYNC.API_KEY } });
        const json = await res.json();
        if (!json || !json.ok) throw new Error((json && json.error) || `HTTP ${res.status}`);
        adopt(json);
        loadedAt = Date.now();
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify(
            { at: loadedAt, rev: json.rev, maps: dict, attrs: attrs, attr_defs: defs }));
        } catch {}
      } catch (err) {
        // Keep whatever is cached. A missing dictionary means raw names, which
        // is a worse label, not a broken player.
        console.warn("[name-map] refresh failed, keeping cached copy:", err.message);
      } finally {
        inFlight = null;
      }
      return dict;
    })();
    return inFlight;
  }

  return { lookup, refresh, key, attrsFor, attrDefs,
           dump: () => dict, dumpAttrs: () => attrs };
})();

/** kind is 'studio' or 'note'. Unmapped names come back unchanged. */
window.scrayMapName = function (kind, raw) {
  return window.scrayNameMap.lookup(kind, raw);
};

/**
 * Fold a counted list of bookmark notes down to the mapped vocabulary.
 *
 * api.php already does this, so against a current server it is one cheap pass
 * that changes nothing. It stays here for the two cases the server cannot
 * cover: a mapping edited AFTER the list was cached - callers fold on the way
 * OUT, so the next modal open is already correct - and an older api.php still
 * answering with raw names.
 *
 * Takes either the server's [{ note, n }] or a plain string[]. Entries landing
 * on the same display name merge and their counts add, so "most used first"
 * survives the merge instead of inheriting whichever spelling ranked higher.
 *
 * @param {Array} rows
 * @returns {string[]} display names, most used first
 */
window.scrayFoldNotes = function (rows) {
  const totals = new Map();
  (rows || []).forEach(r => {
    const obj = r && typeof r === 'object';
    const raw = String((obj ? r.note : r) || '').trim();
    if (!raw) return;
    const name = window.scrayMapName ? window.scrayMapName('note', raw) : raw;
    if (!name) return;
    // The same fold key the dictionary is stored under, so two spellings that
    // differ only in case or accent form cannot survive as two pills.
    const k   = window.scrayNameMap ? window.scrayNameMap.key(name) : name.toLowerCase();
    const n   = (obj && Number(r.n)) || 1;
    const hit = totals.get(k);
    if (hit) hit.n += n; else totals.set(k, { name, n });
  });
  return Array.from(totals.values())
    .sort((a, b) => (b.n - a.n) || a.name.localeCompare(b.name))
    .map(e => e.name);
};

/* ---- when the dictionary gets re-fetched ----------------------------------
   Three triggers, in descending order of how often they fire:

     boot            - forced, so a cold start is always current.
     scray-sync-done - TTL-guarded, so the frequent quiet drains cost nothing
                       but a comparison. drainQuietly() already dispatches it.
     foreground      - forced, but only after a real gap. This is the one that
                       covers "edited the map on the laptop, picked up the
                       phone", which neither of the other two would catch.

   All of them swallow their own failures: a stale dictionary means raw names,
   which is a worse label, not a broken player.
--------------------------------------------------------------------------- */
(function () {
  // ⚙️ ADJUSTABLE: how old the copy must be before returning to the app is
  //    worth a round trip. Below this, a tab-switch is not evidence of
  //    anything having changed.
  const FOREGROUND_MIN_MS = 60 * 1000;
  let lastLoad = 0;

  const load = (force) => {
    lastLoad = Date.now();
    try { window.scrayNameMap.refresh(force); } catch (err) {
      console.warn("[name-map] refresh threw:", err.message);
    }
  };

  // Deferred a tick rather than called inline: this file is document.write'd
  // from <head>, and start-up is already dense enough without one more
  // synchronous branch in the parse path. scrayBoot's fetch hook is installed
  // at the top of this file, so READY still waits for the request.
  setTimeout(() => load(true), 0);

  window.addEventListener("scray-sync-done", () => load(false));

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (Date.now() - lastLoad < FOREGROUND_MIN_MS) return;
    load(true);
  });
})();

/* =========================================
   STASH DISPLAY NAMES
   =========================================

   For a video StashDB has matched, the useful name is not the filename - it
   is who made it, who is in it and what it is called. This module holds that
   mapping for the whole catalogue so any list can render it synchronously,
   with no join and no per-row request.

   Same shape as scrayNameMap above, and for the same reasons: localStorage
   first so the very FIRST render after a cold start is already right, and a
   signature sent with the refresh so an unchanged catalogue costs one tiny
   response instead of a few thousand entries.

   Rows arrive as fixed-position arrays, which is what makes holding several
   thousand of them in localStorage reasonable:

     [ studio, "female performers, comma separated", title,
       stash duration in seconds, marker count ]

   Unmatched videos are simply absent. Every reader below returns null for
   them, which is how the old filename rendering stays the fallback.

   Lives here rather than in a new file so neither app's script list changes
   and Native needs no bundle rebuild to pick it up.
   ========================================= */
window.scrayStashNames = (function () {
  const CACHE_KEY = "scray_stash_names_v1";
  const TTL_MS    = 10 * 60 * 1000;

  let rows     = {};
  let sig      = null;
  let loadedAt = 0;
  let inFlight = null;

  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    if (cached && cached.rows) {
      rows     = cached.rows;
      sig      = cached.sig || null;
      loadedAt = cached.at || 0;
    }
  } catch { /* corrupt cache is the same as no cache */ }

  /**
   * The stored key wins over the filename. Native adopts a fingerprint-matched
   * key that deliberately differs from the local filename, so deriving the key
   * from the name would miss exactly the rows that were hardest to match.
   */
  function keyFor(video) {
    if (!video) return "";
    if (video.videoKey) return video.videoKey;
    if (typeof window.scrayKeyFor === "function") {
      const k = window.scrayKeyFor(video);
      if (k) return k;
    }
    return window.scrayVideoKey(video.filename);
  }

  /**
   * The parts a list needs, already mapped and lower-cased. Returns null when
   * this video has no match, or when the match carries nothing worth showing -
   * a scene row with no studio, no cast and no title is not a better name than
   * the filename, so callers fall back rather than render three separators.
   */
  function parts(video) {
    const k = keyFor(video);
    if (!k) return null;
    const r = rows[k];
    if (!r) return null;

    // Studio goes through the same display-name dictionary as everywhere else
    // that PRINTS a studio, so a rename in manage-data.html reaches the lists.
    const studio = String(
      window.scrayMapName ? window.scrayMapName("studio", r[0] || "") : (r[0] || "")
    ).trim().toLowerCase();
    const performers = String(r[1] || "").trim().toLowerCase();
    const title      = String(r[2] || "").trim().toLowerCase();

    if (!studio && !performers && !title) return null;

    // [5] arrives as "M:john roe, NB:alex ray" - the cast MINUS the women,
    // each name carrying its StashDB gender code. [6] is the scene's tag list.
    // Both are absent from a row cached before the server started sending
    // them, which is why every reader here survives an empty string rather
    // than assuming a seven-entry array.
    const femaleList = performers
        ? performers.split(",").map(s => s.trim()).filter(Boolean)
        : [];

    const maleList  = [];
    const otherList = [];
    String(r[5] || "").trim().toLowerCase().split(",").forEach(entry => {
      const bit = entry.trim();
      if (!bit) return;
      // indexOf rather than split(":"): a gender code is never longer than two
      // characters, but a performer name is free text and may carry a colon of
      // its own.
      const at   = bit.indexOf(":");
      const code = at === -1 ? "?" : bit.slice(0, at).trim();
      const name = (at === -1 ? bit : bit.slice(at + 1)).trim();
      if (!name) return;
      if (code === "m" || code === "tm") maleList.push(name);
      else otherList.push(name);
    });

    const stashTagList = String(r[6] || "").trim().toLowerCase()
        .split(",").map(s => s.trim()).filter(Boolean);

    return {
      studio,
      // Split as well as joined: the list renders one clickable span per
      // performer, and re-splitting a joined string at the call site would
      // put the comma handling in six places instead of one.
      //
      // performerList stays FEMALE-ONLY. It is what names every row in every
      // list, and widening it here would silently rewrite the display text of
      // the whole catalogue. The filter cloud asks for performerListAll.
      performerList: femaleList,
      performerListF: femaleList,
      performerListM: maleList,
      performerListAll: femaleList.concat(maleList, otherList),
      stashTagList,
      performers,
      title,
      durationSec: (typeof r[3] === "number" && r[3] > 0) ? r[3] : null,
      markers: r[4] || 0
    };
  }

  /** Flat text for the search haystack. Empty string when unmatched. */
  function text(video) {
    const p = parts(video);
    if (!p) return "";
    return [p.studio, p.performers, p.title].filter(Boolean).join(" ");
  }

  function has(video) { return parts(video) !== null; }

  async function refresh(force) {
    if (!force && Date.now() - loadedAt < TTL_MS) return rows;
    if (inFlight) return inFlight;
    if (typeof window.scrayApiCall !== "function") return rows;

    inFlight = (async () => {
      try {
        // The signature is ALWAYS sent when we have one, force or not. It is
        // derived from the data, so if anything changed the server sends the
        // new table anyway - discarding it on a forced refresh would just
        // re-download several thousand unchanged rows on every cold boot.
        // `force` only bypasses the TTL check above.
        const r = await window.scrayApiCall("stash_names", { params: sig ? { sig } : {} });
        if (!r.unchanged) {
          rows     = r.rows || {};
          sig      = r.sig || null;
          try {
            localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), sig, rows }));
          } catch { /* over quota - the in-memory copy still works this session */ }
          // Lists already on screen were drawn from the old copy. Repaint them
          // rather than leaving half the catalogue showing filenames until the
          // next filter change.
          if (typeof window.refreshAllLists === "function") {
            try { window.refreshAllLists(); } catch { /* not every page has lists */ }
          }
          console.log(`✅ stash names — ${Object.keys(rows).length} matched video(s)`);
        }
        loadedAt = Date.now();
      } catch (err) {
        // Keep whatever is cached. A missing dictionary means filenames, which
        // is a worse label, not a broken list.
        console.warn("[stash-names] refresh failed, keeping cached copy:", err.message);
      } finally {
        inFlight = null;
      }
      return rows;
    })();
    return inFlight;
  }

  return { parts, text, has, keyFor, refresh, dump: () => rows };
})();

/**
 * WHICH NAME a video gets, decided once for every renderer.
 *
 * Three outcomes, and the whole app agrees on them because they are chosen
 * here rather than in each of the six places that draw a row:
 *
 *   null          unmatched, or matched to a row carrying nothing worth
 *                 printing. The old path / filename rendering, untouched.
 *
 *   "scene"       the row says more than just who made it - there is a cast,
 *                 or a title, or both. The scene names the video and the path
 *                 is dropped:  studio / performers / title [filename]
 *
 *   "studioPath"  a studio and nothing else. That is not a name - it says who
 *                 made it and nothing about WHICH file this is - so the folder
 *                 crumbs stay, with the studio in front:
 *                 studio / path / [filename]
 *
 * The filename is back in both, in square brackets, because a scene name on
 * its own gave no way to tell two files of the same scene apart.
 */
window.scrayStashNamePlan = function (video) {
  const parts = window.scrayStashNames && window.scrayStashNames.parts(video);
  if (!parts) return null;
  const scene = parts.performerList.length > 0 || !!parts.title;
  return { mode: scene ? "scene" : "studioPath", parts };
};

/**
 * ⚙️ ADJUSTABLE: how many leading folders a NAME hides.
 *
 * The top of the tree - "2NGM", "4NGT" - sorts the library, it does not
 * identify a file: every row underneath carries the same crumb, so it spends
 * width on something no two rows disagree about. Dropped from the rendered
 * NAME only. The folder itself is untouched: it is still scanned into tags,
 * still filterable, and the lines that exist to answer "where does this live"
 * - the player's "Loading from", the move and delete confirmations - still
 * print the address in full.
 *
 * Set to 0 to print whole paths again, or 2 to hide two levels.
 */
window.SCRAY_NAME_PATH_SKIP = 1;

/**
 * The crumbs a name should print, with the top levels dropped.
 *
 * Every place a name is drawn goes through here - the list rows, the strip
 * under the player, and the plain-text name used by the overlays and titles -
 * so the three can never disagree about how much of the path is showing.
 */
window.scrayNameCrumbs = function (crumbs) {
  const skip = window.SCRAY_NAME_PATH_SKIP || 0;
  if (!Array.isArray(crumbs)) return [];
  return skip ? crumbs.slice(skip) : crumbs;
};

/**
 * The folder crumbs of a path, as an array.
 *
 * Through scrayResolvePathParts where it exists, so Native's on-device folder
 * arrives in the same grey-bracket shape the lists print - "(camera/)" after
 * the OneDrive crumbs. Picker has no such split and falls back to video.path,
 * where a leading "*" is the legacy device marker and not part of a folder's
 * name.
 */
window.scrayPathCrumbs = function (video) {
  // The top of the tree comes off here rather than in each caller, so the
  // plain-text name and the DOM one are trimmed by the same rule.
  const trim = (crumbs) => (typeof window.scrayNameCrumbs === "function")
      ? window.scrayNameCrumbs(crumbs) : crumbs;
  if (typeof window.scrayResolvePathParts === "function") {
    const parts = window.scrayResolvePathParts(video);
    return [
      ...trim(parts.catalogue),
      ...(parts.device.length ? [`(${parts.device.join("/")}/)`] : [])
    ];
  }
  const raw = (video && video.path) || "";
  const clean = raw.startsWith("*") ? raw.slice(1) : raw;
  return trim(clean.split("/").filter(Boolean));
};

/** The filename as it is printed inside a name: bracketed, or "" if absent. */
window.scrayBracketedFilename = function (video) {
  const f = (video && video.filename) || "";
  return f ? "[" + f + "]" : "";
};

/**
 * The display name as plain text, for the places that cannot take a DOM
 * fragment: the loading overlay's innerHTML, the PIP and mini-player titles,
 * Plyr's own media title, toasts and the in-player list modal.
 *
 * Same parts, same rule and the same " / " separators createClickablePath
 * prints, from the same dictionary - so the strip under the player and the
 * row you clicked to get there can never disagree.
 *
 * "" for an unmatched video, which is every caller's signal to fall straight
 * through to the old path/filename text.
 */
window.scrayStashDisplayName = function (video) {
  const plan = window.scrayStashNamePlan(video);
  if (!plan) return "";
  const p    = plan.parts;
  const file = window.scrayBracketedFilename(video);

  if (plan.mode === "studioPath") {
    // Every section is its own " / " group here, filename included - the
    // studio is standing in for a folder, so the whole line reads as one path.
    return [p.studio, ...window.scrayPathCrumbs(video), file]
        .filter(Boolean).join(" / ");
  }

  const groups = [];
  if (p.studio) groups.push(p.studio);
  if (p.performerList.length) groups.push(p.performerList.join(", "));
  if (p.title) groups.push(p.title);
  // A SPACE before the filename, not a separator: the scene parts are the
  // name, and the bracket is an aside after it.
  return groups.join(" / ") + (file ? (groups.length ? " " : "") + file : "");
};

/**
 * The duration a list should PRINT for this video.
 *
 * StashDB's number describes the scene; ours describes the file, and the file
 * usually carries an intro, a trailer or an encoder's rounding. For a matched
 * video the scene's own runtime is the more honest answer, so it wins.
 * Unmatched videos are unaffected.
 */
window.scrayDisplayDurationMs = function (video) {
  const p = window.scrayStashNames.parts(video);
  if (p && p.durationSec) return p.durationSec * 1000;
  return video ? video.durationMs : null;
};

/**
 * Add one term to the filter and re-run it.
 *
 * Appends rather than replaces, so tapping a studio and then a performer
 * narrows instead of starting over. Terms containing spaces are quoted:
 * parseSearchQuery splits on whitespace, so an unquoted "jane doe" would
 * become two independent AND terms and quietly match the wrong rows.
 *
 * A term already in the box is a no-op - re-tapping the same performer across
 * three rows should not stack three copies of the same word.
 */
window.scrayAddSearchTerm = function (term) {
  const clean = String(term || "").trim();
  if (!clean) return;

  const box = document.getElementById("filenameSearchBox");
  if (!box) return;

  const token   = /\s/.test(clean) ? `"${clean}"` : clean;
  const current = box.value.trim();
  if (current && (current === token || current.includes(token))) return;

  const next = current ? `${current} ${token}` : token;
  box.value = next;

  const clearX = document.getElementById("clearSearchX");
  if (clearX) clearX.style.display = "block";

  const panelBox = document.getElementById("panelSearchBox");
  if (panelBox) {
    panelBox.value = next;
    const panelClearX = document.getElementById("panelSearchClearX");
    if (panelClearX) panelClearX.style.display = "block";
  }

  // Never scroll the page or pop the landscape panel: this is reachable from
  // inside the fullscreen player as well as from a list row.
  window.skipSearchScroll   = true;
  window.skipPanelAutoOpen  = true;
  if (typeof filterDisplayedByFilename === "function") filterDisplayedByFilename();
};

/* ---- when the name table gets re-fetched ---------------------------------
   Deliberately the same three triggers as the display-name dictionary above,
   and deliberately a separate timer: a bulk stash run finishing is exactly
   the case where names change without anything else on the page moving.
--------------------------------------------------------------------------- */
(function () {
  // ⚙️ ADJUSTABLE: how stale the copy must be before returning to the app is
  //    worth a round trip.
  const FOREGROUND_MIN_MS = 60 * 1000;
  let lastLoad = 0;

  const load = (force) => {
    lastLoad = Date.now();
    try { window.scrayStashNames.refresh(force); } catch (err) {
      console.warn("[stash-names] refresh threw:", err.message);
    }
  };

  // Deferred well past boot: this is the largest of the three dictionaries and
  // the lists paint correctly from the localStorage copy without it. Same
  // reasoning as the 2.5s delay on Picker's stash-state fetch.
  setTimeout(() => load(true), 2500);

  window.addEventListener("scray-sync-done", () => load(false));

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (Date.now() - lastLoad < FOREGROUND_MIN_MS) return;
    load(true);
  });
})();
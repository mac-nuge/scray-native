console.log("scray-bugreport.js loaded");

// =========================================
// SCRAY BUG REPORT
//
// A button, a modal, and a black box recorder. Send files a ticket straight
// into Jira (project SO) via api.php?action=bug_report - the Jira credentials
// live in scray_secrets.php and never reach the client.
//
// Why the recorder runs from the moment this file loads: by the time you
// notice something is wrong, the console line that explains it has usually
// scrolled away, and on the phone there is no console to scroll at all. So
// every console call, every uncaught error and every failed HTTP request goes
// into a small ring buffer, and the last few hundred lines ride along with
// the ticket.
//
// This file MUST be first in localScripts. Anything logged before it loads is
// simply not recorded. It also wraps fetch BEFORE scray-config.js does, so
// scrayBoot's in-flight counter ends up on the outside - neither ever
// unwraps, so the order only decides who wraps whom.
//
// Deliberately NOT prompt(): ScrayNativeView is the WKUIDelegate and answers
// prompt() with a silent null. Everything here is in-page DOM.
// =========================================
(() => {
  // ⚙️ ADJUSTABLE
  const MAX_LINES     = 400;    // ring buffer depth
  const MAX_ARG_CHARS = 600;    // per formatted console argument
  const SEND_LINES    = 250;    // how many of those lines go with a ticket
  const BTN_CORNER    = "bottom:14px; left:14px;";

  // Legacy floating button. Not mounted any more - the entry point is the
  // "Jira Report" button in the Floating Menu - but if it is ever brought back
  // it should still sit UNDER the disguise rather than poking through it.
  const Z_BTN   = 2147482000;
  // The modal has to beat the Floating Menu, which sits at the 32-bit ceiling.
  // There is no higher number to reach for, so it matches that value and wins
  // on DOM order instead - which is why the overlay is appended to <html>
  // after the disguise root rather than into <body>.
  const Z_MODAL = 2147483647;

  const IS_NATIVE = !!(
    (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.scrayBridge)
    || window.ScrayBridge
  );

  // -------------------------------------------------------------
  // Ring buffer
  // -------------------------------------------------------------
  const buf = [];
  const t0 = Date.now();

  function push(level, text) {
    buf.push({ ms: Date.now() - t0, level, text: String(text).slice(0, 4000) });
    if (buf.length > MAX_LINES) buf.splice(0, buf.length - MAX_LINES);
  }

  /** Console arguments are anything at all; this has to survive all of it. */
  function fmt(a) {
    if (typeof a === "string") return a.slice(0, MAX_ARG_CHARS);
    if (a instanceof Error) return `${a.name}: ${a.message}\n${(a.stack || "").slice(0, MAX_ARG_CHARS)}`;
    if (a === null || a === undefined || typeof a !== "object") return String(a);
    if (a instanceof HTMLElement) return `<${a.tagName.toLowerCase()}${a.id ? "#" + a.id : ""}>`;
    try {
      return JSON.stringify(a).slice(0, MAX_ARG_CHARS);
    } catch {
      return "[unserialisable " + (a.constructor ? a.constructor.name : "object") + "]";
    }
  }

  ["log", "info", "warn", "error", "debug"].forEach((level) => {
    const orig = typeof console[level] === "function" ? console[level].bind(console) : null;
    if (!orig) return;
    console[level] = function (...args) {
      try { push(level, args.map(fmt).join(" ")); } catch { /* logging must never throw */ }
      return orig(...args);
    };
  });

  window.addEventListener("error", (e) => {
    if (e.message) {
      push("uncaught", `${e.message} @ ${e.filename || "?"}:${e.lineno || 0}:${e.colno || 0}`
        + (e.error && e.error.stack ? `\n${String(e.error.stack).slice(0, MAX_ARG_CHARS)}` : ""));
    } else if (e.target && e.target.src) {
      // Resource load failures (a missing script, a dead video URL) arrive as
      // an error event with no message, only a target.
      push("uncaught", `failed to load ${scrubUrl(e.target.src)}`);
    }
  }, true);

  window.addEventListener("unhandledrejection", (e) => {
    const r = e.reason;
    push("rejection", r instanceof Error ? `${r.message}\n${(r.stack || "").slice(0, MAX_ARG_CHARS)}` : fmt(r));
  });

  /**
   * Query strings are where the secrets are - OneDrive download URLs carry a
   * `tempauth` bearer token, Graph carries SAS parameters. A ticket is a
   * durable, shareable artefact, so nothing but the api.php action survives.
   */
  function scrubUrl(u) {
    try {
      const url = new URL(String(u), location.href);
      const action = url.searchParams.get("action");
      return url.origin + url.pathname + (action ? `?action=${action}` : url.search ? "?[stripped]" : "");
    } catch {
      return String(u).split("?")[0];
    }
  }

  const origFetch = typeof window.fetch === "function" ? window.fetch.bind(window) : null;
  if (origFetch) {
    window.fetch = function (...args) {
      const started = Date.now();
      const url = scrubUrl(args[0] && args[0].url ? args[0].url : args[0]);
      let p;
      try {
        p = origFetch(...args);
      } catch (err) {
        push("net", `THREW ${url}: ${err && err.message}`);
        throw err;
      }
      return p.then(
        (res) => {
          if (!res.ok) push("net", `HTTP ${res.status} ${url} (${Date.now() - started}ms)`);
          return res;
        },
        (err) => {
          push("net", `FAILED ${url}: ${err && err.message} (${Date.now() - started}ms)`);
          throw err;
        }
      );
    };
  }

  // -------------------------------------------------------------
  // State snapshot
  // -------------------------------------------------------------

  /** Never let a diagnostic getter break the thing that collects diagnostics. */
  function safe(fn, fallback = null) {
    try { const v = fn(); return v === undefined ? fallback : v; } catch { return fallback; }
  }

  async function snapshot() {
    const v = safe(() => window.currentPlayingVideo);
    const player = safe(() => window.inlineVideoPlayer);

    let outbox = null;
    try {
      if (typeof window.scrayGetOutbox === "function") {
        const entries = await window.scrayGetOutbox();
        outbox = Array.isArray(entries) ? entries.length : null;
      }
    } catch (err) {
      outbox = `error: ${err && err.message}`;
    }

    return {
      captured_at:  new Date().toISOString(),
      app:          IS_NATIVE ? "native" : "picker",
      page:         safe(() => location.pathname.split("/").pop() || "index"),
      web_version:  safe(() => window.SCRAY_VERSION) || null,
      ipa:          safe(() => window.SCRAY_NATIVE) || null,
      device_id:    safe(() => window.SCRAY_SYNC.DEVICE_ID),
      api_base:     safe(() => window.SCRAY_SYNC.API_BASE),
      db_mode:      safe(() => window.scrayDbMode.stamp()),
      db_mode_drift: safe(() => !!window.SCRAY_DB_MODE_DRIFT, false),
      online:       safe(() => navigator.onLine),
      outbox_pending: outbox,
      uptime_s:     Math.round((Date.now() - t0) / 1000),
      viewport:     safe(() => `${window.innerWidth}x${window.innerHeight} @${window.devicePixelRatio || 1}x`),
      user_agent:   safe(() => navigator.userAgent),
      language:     safe(() => navigator.language),
      videos_in_view: safe(() => (window.filteredVideosGlobal || []).length),
      body_classes: safe(() => document.body.className) || "",
      playing: v ? {
        video_key:  safe(() => v.videoKey || v.video_key) || null,
        filename:   safe(() => v.filename) || null,
        one_drive_id: safe(() => v.oneDriveId) || null,
        score:      safe(() => (v.userScore !== undefined ? v.userScore : v.user_score)),
        position_s: player ? safe(() => Math.round(player.currentTime)) : null,
        duration_s: player ? safe(() => Math.round(player.duration)) : null,
        paused:     player ? safe(() => player.paused) : null,
        source:     player ? safe(() => scrubUrl(player.source || (player.media && player.media.currentSrc))) : null,
      } : null,
      scray_local_keys: safe(() => Object.keys(localStorage).filter((k) => /^scray/i.test(k)), []),
    };
  }

  /**
   * The device key is in the bundle and therefore already public, but a ticket
   * gets forwarded and pasted around far more casually than an IPA does.
   * Strip it from anything on its way out regardless.
   */
  function redact(text) {
    let out = String(text);
    const key = safe(() => window.SCRAY_SYNC.API_KEY) || "";
    if (key && key.length > 8) out = out.split(key).join("[REDACTED-KEY]");
    return out.replace(/(tempauth|access_token|sig|SharedAccessSignature)=[^&\s"']+/gi, "$1=[REDACTED]");
  }

  function consoleLines() {
    return buf.slice(-SEND_LINES).map((e) => {
      const s = (e.ms / 1000).toFixed(1).padStart(7, " ");
      return `[${s}s] ${e.level.toUpperCase().padEnd(9)} ${redact(e.text)}`;
    });
  }

  // -------------------------------------------------------------
  // UI
  // -------------------------------------------------------------
  function injectStyles() {
    if (document.getElementById("scrayBugStyles")) return;
    const el = document.createElement("style");
    el.id = "scrayBugStyles";
    el.textContent = `
#scrayBugBtn {
  position: fixed; ${BTN_CORNER}
  z-index: ${Z_BTN};
  width: 34px; height: 34px; padding: 0;
  border: 1px solid #444; border-radius: 50%;
  background: rgba(30,30,30,0.55); color: #bbb;
  font-size: 16px; line-height: 1; cursor: pointer;
  opacity: 0.45; transition: opacity 0.15s ease, background 0.15s ease;
  -webkit-tap-highlight-color: transparent;
}
#scrayBugBtn:hover, #scrayBugBtn:focus { opacity: 1; background: rgba(60,60,60,0.9); color: #fff; }
#scrayBugOverlay {
  position: fixed; inset: 0; z-index: ${Z_MODAL};
  background: rgba(0,0,0,0.72);
  display: flex; align-items: center; justify-content: center; padding: 16px;
  font-family: Arial, Helvetica, sans-serif;
}
#scrayBugPanel {
  background: #1e1e1e; color: #eee; border: 1px solid #3a3a3a; border-radius: 10px;
  width: min(560px, 100%); max-height: 88vh; overflow-y: auto;
  padding: 18px 18px 14px; box-shadow: 0 10px 40px rgba(0,0,0,0.6);
  -webkit-overflow-scrolling: touch;
}
#scrayBugPanel h2 { margin: 0 0 12px; font-size: 1.05rem; font-weight: 600; }
#scrayBugPanel label { display: block; font-size: 0.82rem; font-weight: 600; margin: 0 0 4px; }
#scrayBugPanel .row { margin-bottom: 13px; }
#scrayBugPanel input[type=text], #scrayBugPanel textarea, #scrayBugPanel select {
  width: 100%; box-sizing: border-box; background: #2a2a2a; color: #eee;
  border: 1px solid #454545; border-radius: 6px; padding: 8px 9px;
  font-size: 16px; font-family: inherit;   /* 16px stops iOS zooming on focus */
}
#scrayBugPanel textarea { min-height: 92px; resize: vertical; }
#scrayBugPanel .check { display: flex; align-items: flex-start; gap: 8px; font-size: 0.82rem; color: #bbb; }
#scrayBugPanel .check input { margin-top: 2px; }
#scrayBugPanel details { margin-top: 8px; }
#scrayBugPanel summary { cursor: pointer; font-size: 0.78rem; color: #888; }
#scrayBugPanel pre {
  background: #141414; border: 1px solid #333; border-radius: 6px;
  padding: 8px; margin: 8px 0 0; max-height: 220px; overflow: auto;
  font-size: 0.68rem; line-height: 1.4; white-space: pre-wrap; word-break: break-word; color: #9c9;
}
#scrayBugActions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 6px; }
#scrayBugActions button {
  padding: 9px 16px; border-radius: 6px; border: 1px solid #4a4a4a;
  background: #2f2f2f; color: #ddd; font-size: 0.88rem; cursor: pointer;
}
#scrayBugActions button.primary { background: #2d6cdf; border-color: #2d6cdf; color: #fff; font-weight: 600; }
#scrayBugActions button[disabled] { opacity: 0.5; cursor: default; }
#scrayBugStatus { font-size: 0.8rem; min-height: 1.2em; margin-top: 10px; }
#scrayBugStatus.bad { color: #ff7a6b; }
#scrayBugStatus.good { color: #7ddb8a; }
`;
    document.head.appendChild(el);
  }

  let open = false;

  function close() {
    const o = document.getElementById("scrayBugOverlay");
    if (o) o.remove();
    open = false;
  }

  async function openModal() {
    if (open) return;
    open = true;
    injectStyles();

    const state = await snapshot();
    const lines = consoleLines();

    const overlay = document.createElement("div");
    overlay.id = "scrayBugOverlay";
    overlay.innerHTML = `
      <div id="scrayBugPanel" role="dialog" aria-modal="true">
        <h2>Report an issue</h2>
        <div class="row">
          <label for="scrayBugType">Type</label>
          <select id="scrayBugType">
            <option value="Bug">Bug — something is broken</option>
            <option value="Task">Task — something to do or change</option>
          </select>
        </div>
        <div class="row">
          <label for="scrayBugSummary">Summary</label>
          <input type="text" id="scrayBugSummary" maxlength="240" placeholder="One line — this becomes the ticket title">
        </div>
        <div class="row">
          <label for="scrayBugDetails">What happened?</label>
          <textarea id="scrayBugDetails" placeholder="What you did, what you expected, what you got."></textarea>
        </div>
        <div class="row">
          <div class="check">
            <input type="checkbox" id="scrayBugIncl" checked>
            <label for="scrayBugIncl" style="font-weight:normal;margin:0;">
              Attach app state and the last ${lines.length} console line${lines.length === 1 ? "" : "s"}
            </label>
          </div>
          <details>
            <summary>Show what would be sent</summary>
            <pre id="scrayBugPreview"></pre>
          </details>
        </div>
        <div id="scrayBugStatus"></div>
        <div id="scrayBugActions">
          <button type="button" id="scrayBugCancel">Cancel</button>
          <button type="button" id="scrayBugSend" class="primary">Send to Jira</button>
        </div>
      </div>`;
    // <html>, not <body>: the Floating Menu is also a child of <html> at the
    // same z-index, and at equal z-index the later sibling paints on top. The
    // menu is built at DOMContentLoaded, this overlay on click, so appending
    // here puts the modal above it. In <body> it would be buried.
    document.documentElement.appendChild(overlay);

    // textContent, not innerHTML: console output is arbitrary text and will
    // contain angle brackets sooner or later.
    document.getElementById("scrayBugPreview").textContent =
      JSON.stringify(state, null, 2) + "\n\n--- console ---\n" + lines.join("\n");

    const status  = document.getElementById("scrayBugStatus");
    const sendBtn = document.getElementById("scrayBugSend");
    const summary = document.getElementById("scrayBugSummary");

    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    document.getElementById("scrayBugCancel").addEventListener("click", close);
    // ui.js binds single-letter shortcuts on window and exempts input/textarea
    // but not <select>, so "t" in the type dropdown would cycle the tag
    // buttons behind the modal. Swallow everything at the panel instead.
    overlay.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") close();
    });
    setTimeout(() => summary.focus(), 50);

    sendBtn.addEventListener("click", async () => {
      const text = summary.value.trim();
      if (!text) {
        status.className = "bad";
        status.textContent = "A summary is required.";
        summary.focus();
        return;
      }
      const include = document.getElementById("scrayBugIncl").checked;
      sendBtn.disabled = true;
      status.className = "";
      status.textContent = "Filing…";

      try {
        const res = await call("bug_report", {
          type:    document.getElementById("scrayBugType").value,
          summary: text,
          details: redact(document.getElementById("scrayBugDetails").value.trim()),
          state:   include ? state : null,
          console: include ? lines : null,
        });
        status.className = "good";
        status.textContent = `Filed as ${res.key}. ${res.attached ? "State attached." : ""}`;
        push("log", `[bug] filed ${res.key}`);
        setTimeout(close, 1800);
      } catch (err) {
        status.className = "bad";
        status.textContent = String(err && err.message ? err.message : err);
        sendBtn.disabled = false;
      }
    });
  }

  /**
   * scrayApiCall carries the session cookie in Picker and the device key in
   * Native, and already unwraps { ok: false }. The fallback only matters on a
   * page that loaded this file without scray-sync.js.
   */
  async function call(action, body) {
    if (typeof window.scrayApiCall === "function") {
      return window.scrayApiCall(action, { method: "POST", body });
    }
    const url = new URL(window.SCRAY_SYNC.API_BASE);
    url.searchParams.set("action", action);
    const res = await fetch(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Scray-Key": window.SCRAY_SYNC.API_KEY || "" },
      body: JSON.stringify(body),
      credentials: "same-origin",
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
    return json;
  }

  function mountButton() {
    if (document.getElementById("scrayBugBtn")) return;
    injectStyles();
    const btn = document.createElement("button");
    btn.id = "scrayBugBtn";
    btn.type = "button";
    btn.textContent = "🐞";
    btn.title = "Report an issue to Jira";
    btn.setAttribute("aria-label", "Report an issue");
    btn.addEventListener("click", openModal);
    document.body.appendChild(btn);
  }

  // -------------------------------------------------------------
  // "send report" — the one-tap sibling of the console's copy button
  // -------------------------------------------------------------
  // Same payload a Jira ticket would carry, minus the ticket. It POSTs to
  // api.php?action=save_report; the server bolts its own half on (db_mode,
  // row counts, Graph token expiry, the PHP error log) and stores a report
  // you can read back from report.php. Deliberately no dialog - by the time
  // you want this, typing on a phone is the last thing you want to be doing.
  const REPORT_PANEL_CHARS = 60000;

  function reportOut(bar) {
    let out = document.getElementById("scrayReportOut");
    if (!out) {
      out = document.createElement("span");
      out.id = "scrayReportOut";
      // The toolbar is justify-content:flex-end, so first child puts this to
      // the LEFT of both buttons rather than shoving them off the edge.
      out.style.cssText = "font-size:0.62rem;align-self:center;margin-right:8px;" +
        "flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left;";
      bar.insertBefore(out, bar.firstChild);
    }
    return out;
  }

  async function sendConsoleReport(btn) {
    const label = btn.textContent;
    const out = reportOut(btn.parentNode);
    btn.disabled = true;
    btn.textContent = "sending…";
    out.style.color = "#666";
    out.textContent = "collecting…";
    try {
      const panelEl = document.getElementById("inlineConsole");
      const panel = panelEl
        ? redact(Array.from(panelEl.children).map((d) => d.textContent).join("\n")).slice(-REPORT_PANEL_CHARS)
        : "";
      const res = await call("save_report", {
        note: "",
        state: await snapshot(),
        console: consoleLines(),
        panel: panel,
      });
      btn.textContent = "sent ✓";
      out.style.color = "#070";
      out.textContent = "";
      const a = document.createElement("a");
      a.href = res.url; a.target = "_blank"; a.rel = "noopener";
      a.textContent = res.url; a.style.color = "inherit";
      out.appendChild(a);
      // Clipboard can be refused - insecure origin, or no user gesture left by
      // the time the round trip finishes. The visible link is the fallback.
      try { if (navigator.clipboard) navigator.clipboard.writeText(res.url); } catch { /* link is enough */ }
      push("log", `[report] written to ${res.url}`);
    } catch (err) {
      btn.textContent = "failed";
      out.style.color = "#c00";
      out.textContent = String(err && err.message ? err.message : err);
    } finally {
      setTimeout(() => { btn.disabled = false; btn.textContent = label; }, 4000);
    }
  }

  function mountConsoleReportBtn() {
    const bar = document.getElementById("inlineConsoleToolbar");
    if (!bar || document.getElementById("scrayConsoleReportBtn")) return;
    const btn = document.createElement("button");
    btn.id = "scrayConsoleReportBtn";
    btn.type = "button";
    btn.textContent = "send report";
    btn.title = "Save a full diagnostics report and copy the link to report.php";
    btn.addEventListener("click", () => sendConsoleReport(btn));
    // Directly after copy. #inlineConsoleToolbar button already styles it, so
    // there is no CSS to add.
    const copy = document.getElementById("inlineConsoleCopyBtn");
    if (copy && copy.parentNode === bar) bar.insertBefore(btn, copy.nextSibling);
    else bar.appendChild(btn);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountConsoleReportBtn);
  } else {
    mountConsoleReportBtn();
  }

  // Re-mountable by hand, and callable without the button - useful from a
  // keyboard binding or from Safari's console over the cable.
  window.scrayMountConsoleReport = mountConsoleReportBtn;
  window.scraySendReport = () => {
    const b = document.getElementById("scrayConsoleReportBtn");
    return b ? sendConsoleReport(b) : Promise.reject(new Error("send report button not mounted"));
  };

  // No longer self-mounting: the entry point is the "Jira Report" button in
  // the Floating Menu (disguise.js), which calls window.scrayReportBug below.
  // mountButton is kept rather than deleted so the standalone floating button
  // can be put back with one call from the console.
  window.scrayMountBugButton = mountButton;

  // Exposed so the button is not the only way in - useful from the console,
  // from a keyboard binding, or from Native's settings modal later.
  window.scrayReportBug = openModal;
  window.scrayBugLog = {
    lines: () => buf.slice(),
    snapshot,
    clear: () => { buf.length = 0; },
  };
})();
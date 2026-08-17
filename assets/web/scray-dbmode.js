/**
 * scray-dbmode.js — the LIVE / TEST / REBUILD switch, in the apps.
 * Identical file in Native and Picker.
 *
 * browse.html already has this control. The rule it enforces is the important
 * part and is unchanged here: db_mode.txt on the server is the ONLY source of
 * truth. Nothing in this file decides which database anything talks to — it
 * reads the server's answer, paints it, and asks the server to change it.
 * localStorage holds a cached copy purely so an offline app can say "last I
 * knew, LIVE" instead of showing a blank.
 *
 * The offline problem this exists to solve:
 *   Native queues changes while offline. db_mode.txt can move while it is
 *   away — you flip to TEST from browse.html on the desktop. When Native
 *   reconnects, its outbox is full of edits that were made against LIVE, and
 *   the naive behaviour is to fire them straight into TEST. So every outbox
 *   entry is stamped with the mode that was in force when it was written, and
 *   the stamp is checked against the server's answer at push time. Mismatches
 *   are held back and you get asked, never guessed at.
 */

(function () {
  "use strict";

  const LS_MODE = "scray_db_mode";
  const LS_SEEN = "scray_db_mode_seen_at";

  // "?" is a real, meaningful value: it means a change was queued before this
  // device had ever managed to ask the server anything. It is not "live".
  const UNKNOWN = "?";

  const MODES = {
    live:    { label: "LIVE",    colour: "#27ae60" },
    test:    { label: "TEST",    colour: "#f39c12" },
    rebuild: { label: "REBUILD", colour: "#9b59b6" },
  };

  let lastProbeOk = false;      // did the most recent probe actually reach the server
  let blockedCount = 0;         // outbox entries held back over a mode mismatch
  let driftPrompted = false;    // one drift prompt per page load, not one per probe

  // -----------------------------------------------------------
  // Cached last-known mode
  // -----------------------------------------------------------
  function lastKnown() {
    const m = localStorage.getItem(LS_MODE);
    return MODES[m] ? m : null;
  }

  function remember(mode) {
    if (!MODES[mode]) return;
    localStorage.setItem(LS_MODE, mode);
    localStorage.setItem(LS_SEEN, new Date().toISOString());
  }

  /** What to stamp on an outbox entry being written right now. */
  function stamp() {
    return lastKnown() || UNKNOWN;
  }

  // -----------------------------------------------------------
  // Asking the server
  // -----------------------------------------------------------

  /**
   * Cheap, unauthenticated mode read. `ping` returns the mode api.php actually
   * RESOLVED, which is not the same as what db_mode.txt says — an api.php
   * missing the rebuild-mode changes silently falls back to live. Always trust
   * this over the file.
   */
  async function probe() {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), window.SCRAY_SYNC?.PING_TIMEOUT_MS ?? 4000);
    try {
      const url = new URL(window.SCRAY_SYNC.API_BASE);
      url.searchParams.set("action", "ping");
      const res = await fetch(url.toString(), { signal: ctl.signal, cache: "no-store" });
      if (!res.ok) { lastProbeOk = false; return null; }
      const json = await res.json();
      lastProbeOk = true;
      if (!json.mode) return null;   // api.php predates mode-in-ping
      remember(json.mode);
      return json.mode;
    } catch {
      lastProbeOk = false;
      return null;
    } finally {
      clearTimeout(t);
    }
  }

  /** Authenticated: which databases exist, and can db_mode.txt be written. */
  async function details() {
    try {
      const info = await window.scrayApiCall("db_mode");
      if (info.mode) remember(info.mode);
      lastProbeOk = true;
      return info;
    } catch {
      lastProbeOk = false;
      return null;
    }
  }

  // -----------------------------------------------------------
  // A modal that does not depend on the app's CSS
  // -----------------------------------------------------------
  // Picker never loads scray-sync-ui.js, so scrayModal does not exist there.
  // Inline styles rather than app classes so this looks the same in both.
  function ask(title, bodyHtml, buttons) {
    return new Promise((resolve) => {
      const wrap = document.createElement("div");
      wrap.style.cssText =
        "position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:2147483000;" +
        "display:flex;align-items:center;justify-content:center;padding:16px;";
      wrap.innerHTML =
        '<div style="background:#fff;color:#222;border-radius:10px;max-width:520px;width:100%;' +
        'padding:18px 20px;box-shadow:0 8px 32px rgba(0,0,0,.4);font-size:.92rem;line-height:1.5;">' +
        '<h3 style="margin:0 0 10px;font-size:1.05rem;">' + title + "</h3>" +
        '<div style="max-height:55vh;overflow:auto;">' + bodyHtml + "</div>" +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;margin-top:16px;">' +
        buttons.map((b, i) =>
          '<button data-i="' + i + '" style="padding:8px 14px;border-radius:6px;cursor:pointer;' +
          "border:1px solid " + (b.primary ? "#2b7cd3" : "#bbb") + ";" +
          "background:" + (b.primary ? "#2b7cd3" : "#f4f4f4") + ";" +
          "color:" + (b.primary ? "#fff" : "#333") + ';">' + b.label + "</button>"
        ).join("") +
        "</div></div>";
      document.body.appendChild(wrap);
      wrap.querySelectorAll("button[data-i]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const v = buttons[Number(btn.dataset.i)].value;
          wrap.remove();
          resolve(v);
        });
      });
    });
  }

  // -----------------------------------------------------------
  // Local state that is only meaningful against one database
  // -----------------------------------------------------------
  /**
   * A delta cursor is a position in ONE database's seq counter. Carried across
   * a switch it is worse than useless: TEST's head is far below LIVE's, so a
   * LIVE cursor against TEST means `WHERE seq > :since` matches nothing and
   * sync looks broken with no error anywhere.
   *
   * The outbox is deliberately NOT touched. Those changes still belong to the
   * database they were made against, and the stamp is what protects them.
   */
  async function adoptLocally(mode) {
    remember(mode);
    if (typeof openDB !== "function") return;

    let db;
    try { db = await openDB(); } catch (e) {
      console.warn("[dbmode] could not open IndexedDB to reset sync state:", e);
      return;
    }

    if (db.objectStoreNames.contains("syncState")) {
      await new Promise((res) => {
        const tx = db.transaction("syncState", "readwrite");
        const store = tx.objectStore("syncState");
        const req = store.getAll();
        req.onsuccess = () => {
          (req.result || []).forEach((r) => {
            if (r.key === "cursor" || String(r.key).startsWith("row:")) store.delete(r.key);
          });
        };
        tx.oncomplete = res;
        tx.onerror = () => res();
      });
    }

    // Native only. Clearing inCatalogue sends every local video down
    // scraySyncLibrary's since=0 path, so the new database's metadata is
    // pulled in full rather than as deltas from a cursor that no longer means
    // anything. Picker has no such store and skips this.
    if (db.objectStoreNames.contains("videoSource")) {
      await new Promise((res) => {
        const tx = db.transaction("videoSource", "readwrite");
        const store = tx.objectStore("videoSource");
        const req = store.getAll();
        req.onsuccess = () => {
          (req.result || []).forEach((v) => {
            if (v.inCatalogue) store.put(Object.assign({}, v, { inCatalogue: false }));
          });
        };
        tx.oncomplete = res;
        tx.onerror = () => res();
      });
    }

    console.log("[dbmode] local sync state reset for " + mode + " — next sync is a full pull");
  }

  // -----------------------------------------------------------
  // Switching
  // -----------------------------------------------------------
  async function set(want) {
    if (!MODES[want]) throw new Error("unknown mode: " + want);

    const now = await probe();
    if (now === null && !lastProbeOk) {
      await ask("Offline",
        "<p>Can't reach the server, so the database can't be switched from here.</p>",
        [{ label: "OK", value: null, primary: true }]);
      return false;
    }
    if (now === want) { render(); return true; }

    const pending = (typeof window.scrayGetOutbox === "function")
      ? (await window.scrayGetOutbox()).length : 0;

    const go = await ask(
      "Point everything at " + MODES[want].label + "?",
      "<p>This is <strong>global</strong>. Picker, Native and the DB console all " +
      "follow <code>db_mode.txt</code> — there is no per-device setting.</p>" +
      (pending
        ? "<p style='color:#b9770e;'><strong>" + pending + " unsynced change(s)</strong> are queued here. " +
          "They stay queued and stay stamped <strong>" + (MODES[now] ? MODES[now].label : "unknown") +
          "</strong>. You'll be asked what to do with them before anything is pushed to " +
          MODES[want].label + ".</p>"
        : "") +
      "<p style='color:#888;'>The local copy re-downloads from scratch afterwards, " +
      "because a delta cursor only means something against the database that issued it.</p>",
      [{ label: "Cancel", value: false },
       { label: "Switch to " + MODES[want].label, value: true, primary: true }]
    );
    if (!go) return false;

    try {
      await window.scrayApiCall("db_mode_set", { method: "POST", body: { mode: want } });
    } catch (e) {
      await ask("Switch failed", "<p>" + e.message + "</p>",
        [{ label: "OK", value: null, primary: true }]);
      return false;
    }

    // Writing db_mode.txt is not the same as api.php honouring it — the same
    // check rebuild.html makes. If they disagree, stop: adopting locally here
    // would reset the cursor for a database we are not actually talking to.
    const seen = await probe();
    if (seen && seen !== want) {
      await ask("Mode mismatch",
        "<p><code>db_mode.txt</code> now says <strong>" + want +
        "</strong>, but api.php resolved <strong>" + seen + "</strong>.</p>" +
        "<p>Nothing local has been changed. api.php is missing the changes for that mode — " +
        "apply those before switching.</p>",
        [{ label: "OK", value: null, primary: true }]);
      render();
      return false;
    }

    await adoptLocally(want);
    location.reload();
    return true;
  }

  // -----------------------------------------------------------
  // Push guard
  // -----------------------------------------------------------
  /**
   * Called by pushOutbox before anything leaves the device.
   *
   * `modes` is the caller's override:
   *   null       — only entries stamped with the server's current mode go
   *   "all"      — send everything, you've been asked and you said yes
   *   ["live"]   — send only entries stamped live
   */
  async function guardPush(entries, modes) {
    if (modes === "all") {
      blockedCount = 0;
      return { send: entries, blocked: [], current: lastKnown() };
    }

    const current = (await probe()) || lastKnown();
    const allow = Array.isArray(modes) ? new Set(modes) : new Set([current]);

    const send = [], blocked = [];
    for (const e of entries) {
      // Entries written before this file shipped carry no stamp. They predate
      // any possibility of a recorded mismatch, so they are not held hostage.
      if (e.mode == null || e.mode === current || allow.has(e.mode)) send.push(e);
      else blocked.push(e);
    }

    blockedCount = blocked.length;
    if (blocked.length) {
      const byMode = {};
      blocked.forEach((e) => { byMode[e.mode] = (byMode[e.mode] || 0) + 1; });
      console.warn("[dbmode] holding " + blocked.length + " change(s) — server is on " +
                   current + ", they are stamped " + JSON.stringify(byMode));
      render();
    }
    return { send, blocked, current };
  }

  /**
   * The reconnect conversation. Only ever reached when a stamp disagrees with
   * the server, i.e. db_mode.txt moved while this device was away.
   */
  let resolving = false;
  async function resolveHeld() {
    if (resolving) return;
    resolving = true;
    try {
      const entries = (typeof window.scrayGetOutbox === "function")
        ? await window.scrayGetOutbox() : [];
      if (!entries.length) { blockedCount = 0; render(); return; }

      const current = (await probe()) || lastKnown();
      if (!current) return;

      const blocked = entries.filter((e) => e.mode != null && e.mode !== current);
      if (!blocked.length) { blockedCount = 0; render(); return; }

      const counts = {};
      blocked.forEach((e) => { counts[e.mode] = (counts[e.mode] || 0) + 1; });
      const stamps = Object.keys(counts);
      const only = stamps.length === 1 ? stamps[0] : null;
      const lbl = (m) => (MODES[m] ? MODES[m].label : "an unidentified database");

      const rows = stamps
        .map((m) => "<li><strong>" + counts[m] + "</strong> change(s) made while pointed at <strong>" +
                    lbl(m) + "</strong></li>")
        .join("");

      const buttons = [{ label: "Leave them queued", value: "hold" }];
      // Only offer the switch-back when every held change agrees on where it
      // came from, and it is a real mode rather than "?".
      if (only && MODES[only]) {
        buttons.push({ label: "Switch server back to " + lbl(only), value: "switch" });
      }
      buttons.push({ label: "Push to " + lbl(current) + " anyway", value: "force", primary: true });

      const choice = await ask(
        "These changes belong to a different database",
        "<p>The server is currently on <strong>" + lbl(current) + "</strong>, but:</p>" +
        "<ul>" + rows + "</ul>" +
        (stamps.includes(UNKNOWN)
          ? "<p style='color:#b9770e;'>Some were queued before this device had ever " +
            "reached the server, so there is no record of which database they were meant for.</p>"
          : "") +
        "<p style='color:#888;'>Nothing has been sent. Leaving them queued is safe — " +
        "they'll be offered again next time.</p>",
        buttons
      );

      if (choice === "force") {
        await window.scrayPushOutbox({ modes: "all" });
        blockedCount = 0;
        render();
        if (typeof window.refreshSyncStatus === "function") window.refreshSyncStatus();
      } else if (choice === "switch") {
        await set(only);   // reloads on success
      }
    } finally {
      resolving = false;
    }
  }

  /** Recount held entries against the last-known mode, for the pill badge. */
  async function recount() {
    if (typeof window.scrayGetOutbox !== "function") return;
    const current = lastKnown();
    if (!current) { blockedCount = 0; return; }
    const entries = await window.scrayGetOutbox();
    blockedCount = entries.filter((e) => e.mode != null && e.mode !== current).length;
  }

  // -----------------------------------------------------------
  // The pill
  // -----------------------------------------------------------
  function render() {
    const host = document.getElementById("dbModePill");
    if (!host) return;

    const mode = lastKnown();
    const known = mode && MODES[mode];
    const colour = known ? MODES[mode].colour : "#999";
    const label = known ? MODES[mode].label : "DB ?";

    // Offline, or api.php too old to report a mode: show the cached answer but
    // make it obvious it is a memory, not a reading.
    const stale = !lastProbeOk;
    const badge = blockedCount ? " ⚠" + blockedCount : "";

    host.innerHTML = "";
    const btn = document.createElement("span");
    btn.textContent = label + (stale ? " (last known)" : "") + badge;
    btn.style.cssText =
      "cursor:pointer;font-weight:600;letter-spacing:.04em;font-size:.78rem;" +
      "border:1px solid " + colour + ";color:" + colour + ";" +
      "border-radius:999px;padding:1px 8px;white-space:nowrap;" +
      "opacity:" + (stale ? ".6" : "1") + ";";
    btn.title = stale
      ? "Last known database. Can't reach the server to confirm — tap to retry."
      : (blockedCount
          ? blockedCount + " queued change(s) belong to a different database. Tap to resolve."
          : "Database every Scray client is pointed at. Tap to switch.");
    btn.addEventListener("click", onPillTap);
    host.appendChild(btn);
  }

  async function onPillTap() {
    if (blockedCount) return resolveHeld();

    const info = await details();
    if (!info) {
      const m = await probe();
      render();
      if (m === null) {
        await ask("Offline",
          "<p>Can't reach the server. Showing the last database this device saw.</p>",
          [{ label: "OK", value: null, primary: true }]);
      }
      return;
    }
    render();

    const buttons = [{ label: "Close", value: null }];
    ["live", "test", "rebuild"].forEach((m) => {
      if (m === info.mode) return;
      if (!info[m + "_exists"]) return;
      buttons.push({ label: "Switch to " + MODES[m].label, value: m, primary: m === "live" });
    });

    const choice = await ask(
      "Database: " + MODES[info.mode].label,
      "<p>Every Scray client — this app, Picker, Native and the DB console — is " +
      "pointed at <strong>" + MODES[info.mode].label + "</strong>.</p>" +
      "<ul>" +
      ["live", "test", "rebuild"].map((m) =>
        "<li>" + MODES[m].label + ": " +
        (info[m + "_exists"] ? "available" : "<span style='color:#999;'>not built</span>") +
        (m === info.mode ? " <strong>← current</strong>" : "") + "</li>"
      ).join("") +
      "</ul>" +
      (info.writable ? "" :
        "<p style='color:#c0392b;'><code>db_mode.txt</code> is not writable — " +
        "switch over SSH instead.</p>"),
      info.writable ? buttons : [{ label: "Close", value: null, primary: true }]
    );

    if (choice) await set(choice);
  }

  // -----------------------------------------------------------
  // Drift: db_mode.txt moved while this app was open or asleep
  // -----------------------------------------------------------
  /**
   * Deliberately a prompt rather than a silent adopt. Adopting resets the
   * cursor and forces a full re-pull, and doing that underneath a sync that is
   * already in flight is how you get a half-populated mirror.
   */
  async function checkDrift() {
    const before = lastKnown();
    const now = await probe();
    if (!now) { render(); return; }
    if (!before || before === now) { render(); await recount(); render(); return; }

    // Everything queued from here on belongs to the new database, and anything
    // already queued is now a mismatch that guardPush will catch.
    window.SCRAY_DB_MODE_DRIFT = true;
    render();

    if (driftPrompted) return;
    driftPrompted = true;

    const pending = (typeof window.scrayGetOutbox === "function")
      ? (await window.scrayGetOutbox()).length : 0;

    const choice = await ask(
      "The database moved to " + MODES[now].label,
      "<p>This device last synced against <strong>" + MODES[before].label +
      "</strong>. The server is now on <strong>" + MODES[now].label + "</strong>.</p>" +
      "<p>The local copy still holds " + MODES[before].label + " metadata, and its sync " +
      "cursor is a position in " + MODES[before].label + "'s history — meaningless here.</p>" +
      (pending
        ? "<p style='color:#b9770e;'><strong>" + pending + " queued change(s)</strong> are stamped " +
          MODES[before].label + ". They are not sent either way; you'll be asked about them " +
          "separately.</p>"
        : ""),
      [{ label: "Leave it for now", value: false },
       { label: "Re-sync against " + MODES[now].label, value: true, primary: true }]
    );

    if (choice) {
      await adoptLocally(now);
      location.reload();
    } else {
      // Stay on the old data but do not pretend it matches. The autosync in
      // scray-sync-ui.js checks this flag and stands down.
      render();
    }
  }

  // -----------------------------------------------------------
  // Wiring
  // -----------------------------------------------------------
  document.addEventListener("DOMContentLoaded", () => {
    render();                       // paint the cached answer immediately
    setTimeout(checkDrift, 300);    // then confirm it against the server
  });

  window.addEventListener("online", () => setTimeout(checkDrift, 2000));
  window.addEventListener("offline", () => { lastProbeOk = false; render(); });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkDrift();
  });

  window.scrayDbMode = {
    lastKnown, stamp, probe, details, set,
    guardPush, resolveHeld, recount, render, adoptLocally,
    heldCount: () => blockedCount,
    UNKNOWN, MODES,
  };
})();

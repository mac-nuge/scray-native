// =========================================
// HETZNER SOURCE (native 15.10 - brought back from 14.51, undone in 14.52)
//
// Videos on the Hetzner Storage Box, added to this device's library as a
// source of their own - the way a phone folder is one, except nothing is on
// the phone: they stream through the gateway's signed URLs. The box has no
// sign-in to go through, which is what keeps OneDrive out of Native.
//
// Native's library holds only what its own scans find; a catalogue pull never
// adds a row (scrayApplyPulledRow ignores keys this device doesn't hold). So
// the box is fetched explicitly, like an account: the Hetzner button fetches,
// the pill re-fetches, the pill's cross removes. api.php's hetzner_list
// (browse 15.55) lists every catalogued video with a copy on the box.
//
// Rows are ordinary videoSource rows with routing fields of their own:
//   oneDriveId "hz:<video_key>", driveId "hetzner", accountKey "Hetzner::hetzner"
// - the same driveId/accountKey the catalogue gives a Hetzner file, so
// scrayIsHetznerVideo reads them the way Picker's does. isLocalVideo() is false
// for them, so local-file paths leave them alone; scrayApplyPulledRow keeps
// their routing fields and applies catalogue metadata (scores, bookmarks,
// tags, variant group, migrated_at) through the usual videoKey lookup.
// refreshVideoBeforeUse (player.js) asks hetzner_url for a signed URL.
//
// A file migrated from OneDrive is its own catalogue row on the box
// (<name>#hetzner), linked to the original as a variant - so a phone copy and
// its box copy are one list row with two size chips, the phone's lit
// (render.js). Only a box copy filed under the very same key as a phone file
// would list twice; that one is never added, and scrayHetznerDedupe drops it
// if a phone copy turns up later.
// =========================================

(function () {
  const ACCOUNT_KEY = "Hetzner::hetzner";
  const DRIVE_ID    = "hetzner";
  const NAME        = "Hetzner";
  const ID_PREFIX   = "hz:";
  const FLAG        = "scray.hetzner.enabled";

  /** A file on the box - the same test as Picker's scray-hetzner.js. */
  function isHetznerVideo(v) {
    if (!v) return false;
    const id = String(v.oneDriveId || v.one_drive_id || "");
    return id.startsWith(ID_PREFIX)
      || v.driveId === DRIVE_ID || v.drive_id === DRIVE_ID
      || String(v.accountKey || v.account_key || "").toLowerCase().endsWith("::" + DRIVE_ID);
  }
  window.scrayIsHetznerVideo = isHetznerVideo;
  window.isHetznerVideo = isHetznerVideo;
  const isHetznerRow = isHetznerVideo;

  function enabled() { try { return localStorage.getItem(FLAG) === "1"; } catch { return false; } }
  function setEnabled(on) { try { on ? localStorage.setItem(FLAG, "1") : localStorage.removeItem(FLAG); } catch {} }
  // native 15.51: how many videos the box held at the last fetch, for the pill's
  // "5,348 (423 on phone)". Whatever isn't a Hetzner row now is on the phone.
  const BOX_TOTAL = "scray.hetzner.boxTotal";
  function boxTotal() { try { return +localStorage.getItem(BOX_TOTAL) || 0; } catch { return 0; } }
  function setBoxTotal(n) { try { n ? localStorage.setItem(BOX_TOTAL, String(n)) : localStorage.removeItem(BOX_TOTAL); } catch {} }

  function splitList(s) { return typeof s === "string" && s ? s.split(";").filter(Boolean) : []; }

  /** One hetzner_list row as a videoSource row. */
  function toRow(r) {
    const key      = r.video_key;
    const filename = r.filename || key;
    const hzPath   = String(r.hetzner_path || filename);
    const slash    = hzPath.lastIndexOf("/");
    // The folder on the box, no leading slash - the same shape as a phone
    // row's path, so the Move list lines them up (native 15.11).
    const dir      = slash > 0 ? hzPath.slice(0, slash) : "";
    const size = r.file_size_bytes != null ? Number(r.file_size_bytes) : null;
    const dur  = r.duration_ms != null ? Number(r.duration_ms) : null;
    const w    = r.width != null ? Number(r.width) : null;
    const h    = r.height != null ? Number(r.height) : null;
    const row = {
      oneDriveId: ID_PREFIX + key,
      driveId: DRIVE_ID,
      accountKey: ACCOUNT_KEY,
      accountName: NAME,
      path: dir,
      hetznerPath: hzPath,
      hetznerInstanceId: r.hetzner_instance_id || null,
      filename,
      downloadUrl: null,                 // signed on demand - they expire
      sizeBytes: size,
      durationMs: dur,
      createdDateTime: r.created_date || null,
      lastModifiedDateTime: r.last_modified_date || null,
      mimeType: r.mime_type || "video/mp4",
      width: w,
      height: h,
      orientation: typeof window.deriveOrientation === "function" ? window.deriveOrientation(w, h) : null,
      bitrate: null,
      tags: splitList(r.tags),
      bracketTags: splitList(r.bracket_tags),
      fingerprint: typeof window.buildVideoFingerprint === "function"
        ? window.buildVideoFingerprint({ filename, width: w, height: h, durationMs: dur, bitrate: null }) : null,
      fileFingerprint: typeof window.scrayFingerprint === "function"
        ? window.scrayFingerprint({ sizeBytes: size, durationMs: dur, width: w, height: h }) : null,
      videoKey: key,
      inCatalogue: true,                 // it came from the catalogue
      inOneDrive: !!r.in_onedrive,
      lastScanned: new Date().toISOString(),
    };
    for (let i = 1; i <= 5; i++) row[`level_${i}`] = r[`level_${i}`] || null;
    return row;
  }

  // ⚙️ Videos per page of the listing (native 15.50: 1000 rather than 2000, so
  // the count on the pill moves in more, smaller steps).
  const LIST_PAGE = 1000;
  async function listAll(onProgress) {
    const out = [];
    let after = "";
    for (;;) {
      const res = await window.scrayApiCall("hetzner_list", { params: { after, limit: LIST_PAGE } });
      out.push(...(res.videos || []));
      onProgress?.(`Listing the box… ${out.length.toLocaleString()}${res.more ? "" : " videos"}`);
      if (!res.more || !res.next) break;
      after = res.next;
    }
    return out;
  }

  function readAll(store) {
    return new Promise((res, rej) => {
      const r = store.getAll();
      r.onsuccess = () => res(r.result || []);
      r.onerror = () => rej(r.error);
    });
  }
  function done(tx) {
    return new Promise((res, rej) => {
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error || new Error("transaction aborted"));
    });
  }
  const phoneKeysOf = rows => new Set(rows
    .filter(v => typeof window.isLocalVideo === "function" ? window.isLocalVideo(v) : v.driveId === "local")
    .map(v => v.videoKey || (window.scrayVideoKey ? window.scrayVideoKey(v.filename) : ""))
    .filter(Boolean));

  /**
   * Fetch the box's catalogued videos into the library. Adds new ones, updates
   * ones already here, and drops Hetzner rows whose video has left the box or
   * now has a phone copy under the same key. Then a catalogue sync brings their
   * scores, bookmarks and variant links down, as it does after a folder scan.
   */
  // native 15.50: each step says what it's doing on the pill, and a failure
  // says which step failed and what that means for the library.
  function stepError(step, err, extra) {
    const why = (err && err.message) || String(err);
    const text = {
      listing: `Couldn't list the Hetzner box - ${why}. Nothing on the phone changed.`,
      saving:  `Listed the box, but couldn't save it to the phone's library - ${why}.`,
      syncing: `${extra || "The videos are in the library"}, but syncing their scores, bookmarks and tags failed - ${why}. Tap the pill twice to try again.`
    }[step] || why;
    return Object.assign(new Error(text), { step, cause: err });
  }

  async function fetchHetzner({ onProgress, rescan = true } = {}) {
    if (typeof window.scrayApiCall !== "function") throw new Error("the sync layer isn't loaded");
    // native 15.22: the server re-reads the box too, in the background - see
    // kickBoxRescan. This listing doesn't wait for it.
    if (rescan) kickBoxRescan();
    onProgress?.("Listing the box…");
    let listed;
    try { listed = await listAll(onProgress); } catch (err) { throw stepError("listing", err); }
    onProgress?.(`Saving ${listed.length.toLocaleString()} to the library…`);
    try {
      return await saveAndSync(listed, onProgress);
    } catch (err) {
      throw err && err.step ? err : stepError("saving", err);
    }
  }

  async function saveAndSync(listed, onProgress) {
    const db = await openDB();
    const tx = db.transaction([STORE_NAME, META_STORE_NAME], "readwrite");
    const src = tx.objectStore(STORE_NAME);
    const meta = tx.objectStore(META_STORE_NAME);
    // Every read before the first write: an await on anything but this
    // transaction's own requests lets it auto-commit.
    const [rows, metas] = await Promise.all([readAll(src), readAll(meta)]);
    const phoneKeys = phoneKeysOf(rows);
    const haveMeta  = new Set(metas.map(m => m.oneDriveId));
    const existing  = new Map(rows.filter(isHetznerRow).map(v => [v.oneDriveId, v]));

    const keep = new Set();
    let added = 0, updated = 0, skipped = 0, removed = 0;
    const now = new Date().toISOString();
    for (const r of listed) {
      if (!r || !r.video_key) continue;
      if (phoneKeys.has(r.video_key)) { skipped++; continue; }
      const row = toRow(r);
      keep.add(row.oneDriveId);
      const prior = existing.get(row.oneDriveId);
      // A re-fetch re-asks the catalogue for full history, like a folder
      // rescan does: cataloguePath stays unset until the sync after it.
      src.put(prior ? { ...prior, ...row, cataloguePath: undefined } : row);
      prior ? updated++ : added++;
      if (!haveMeta.has(row.oneDriveId)) {
        meta.put({
          oneDriveId: row.oneDriveId, user_score: null, notes: null, bookmarks: [],
          view_count: 0, time_viewed: 0, last_played: null, first_seen: now,
          f_tally: 0, updatedAt: now, updatedBy: "scan",
        });
      }
    }
    // Includes rows a 14.51 fetch left behind (accountKey "hetzner::box").
    for (const id of existing.keys()) {
      if (keep.has(id)) continue;
      src.delete(id); meta.delete(id); removed++;
    }
    await done(tx);
    setEnabled(true);
    setBoxTotal(listed.length);
    console.log(`[hetzner] ${listed.length} listed: ${added} added, ${updated} updated, ${removed} removed, ${skipped} already on the phone`);
    const tally = [added ? `+${added.toLocaleString()} new` : "", removed ? `−${removed.toLocaleString()} gone` : ""].filter(Boolean).join(" · ");
    onProgress?.(`${(added + updated).toLocaleString()} in the library${tally ? " · " + tally : ""}`);

    let checkError = null;
    if (typeof window.scraySyncLibrary === "function") {
      let res;
      try {
        res = await window.scraySyncLibrary({ quiet: true, onProgress });
      } catch (err) {
        throw stepError("syncing", err, `${(added + updated).toLocaleString()} Hetzner videos are in the library`);
      }
      checkError = (res && res.checkError) || null;
      await stampSynced();
    }
    if (typeof refreshAllLists === "function") refreshAllLists();
    if (typeof window.renderFolderPills === "function") await window.renderFolderPills();
    return { listed: listed.length, added, updated, removed, skipped, checkError };
  }

  /** What the user sees once a fetch is done (native 15.50). */
  function reportFetch(r) {
    const toast = (msg, colour) => {
      if (typeof window.showScoreConfirmation === "function") { try { window.showScoreConfirmation(msg, colour); return; } catch { /* below */ } }
      console.log("[hetzner]", msg);
    };
    const bits = [`☁ ${(r.listed - r.skipped).toLocaleString()} Hetzner videos`];
    if (r.added) bits.push(`+${r.added.toLocaleString()} new`);
    if (r.removed) bits.push(`−${r.removed.toLocaleString()} gone`);
    if (r.checkError) {
      // The pull landed; only the check of this phone's own files didn't.
      console.warn("[hetzner] catalogue check:", r.checkError.message);
      toast(`⚠️ ${bits.join(" · ")} - synced, but the check of this phone's own files didn't finish: ${r.checkError.message}`, "#b8860b");
    } else {
      toast(`✅ ${bits.join(" · ")}`);
    }
  }
  /** A failed fetch, said plainly - and in the console with the underlying error. */
  function reportFetchError(err) {
    console.error("[hetzner] fetch failed:", err, err && err.cause);
    alert(`Hetzner: ${(err && err.message) || err}`);
  }

  /**
   * Box rescan (native 15.22). This list is the catalogue's idea of the box,
   * so a file moved, added or deleted over WinSCP only showed up once Picker
   * had fetched that folder. A re-fetch now also asks api.php to rescan the
   * box (hetzner_rescan, browse 15.73) - unless one finished in the last ten
   * minutes - and carries on listing without waiting: the rescan runs on the
   * server, reading every folder on the box. When it finishes with anything
   * changed, the list is fetched again, quietly, so moved files take their
   * new folders and new ones appear. Nothing waits on it, and closing the app
   * doesn't stop it (only this follow-up re-list).
   */
  let rescanWatching = false;
  const RESCAN_MIN_AGE_S = 600;
  function kickBoxRescan() {
    if (rescanWatching) return;
    rescanWatching = true;
    const t0 = Date.now();
    const stop = () => { rescanWatching = false; };
    api("hetzner_rescan", { do: "start", device: device(), min_age: RESCAN_MIN_AGE_S }).then(r => {
      const st = r && r.scan && r.scan.state;
      const busy = s => s === "walking" || s === "reconciling" || s === "probing";   // probing: browse 15.74
      if (!busy(st)) { stop(); return; }    // recent enough, or couldn't start
      console.log(`[hetzner] box rescan ${r.already ? "already running" : "started"} on the server`);
      const tick = async () => {
        let z = {};
        try { z = (await api("hetzner_rescan", { do: "status" })).scan || {}; } catch {}
        if (busy(z.state) && Date.now() - t0 < 15 * 60 * 1000) {
          setTimeout(tick, 5000);
          return;
        }
        stop();
        const x = z.result || {};
        if (z.state !== "done") { if (z.error) console.warn("[hetzner] box rescan:", z.error); return; }
        console.log(`[hetzner] box rescanned: ${x.moved || 0} moved, ${x.added || 0} new, ${x.gone || 0} gone, details read for ${x.probed || 0}`);
        // Details read (duration, size) are worth a re-list too: they're what the rows show.
        if ((x.moved || 0) + (x.added || 0) + (x.gone || 0) + (x.probed || 0) > 0) {
          try { await fetchHetzner({ rescan: false }); }
          catch (err) { console.warn("[hetzner] re-list after the rescan failed:", err); }
        }
      };
      setTimeout(tick, 5000);
    }).catch(err => { stop(); console.warn("[hetzner] box rescan not started:", friendly(err)); });
  }

  /**
   * After a sync has pulled their full history, mark Hetzner rows as answered
   * so later syncs ask for deltas only (the same cataloguePath test
   * scraySyncLibrary applies to phone files).
   */
  async function stampSynced() {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const src = tx.objectStore(STORE_NAME);
    const rows = await readAll(src);
    rows.filter(v => isHetznerRow(v) && typeof v.cataloguePath !== "string")
        .forEach(v => src.put({ ...v, cataloguePath: v.path || "" }));
    await done(tx);
  }

  /** Remove every Hetzner row from this device's library. Nothing on the box changes. */
  async function removeHetzner() {
    const db = await openDB();
    const tx = db.transaction([STORE_NAME, META_STORE_NAME], "readwrite");
    const src = tx.objectStore(STORE_NAME);
    const meta = tx.objectStore(META_STORE_NAME);
    const rows = await readAll(src);
    let n = 0;
    rows.filter(isHetznerRow).forEach(v => { src.delete(v.oneDriveId); meta.delete(v.oneDriveId); n++; });
    await done(tx);
    setEnabled(false);
    setBoxTotal(0);
    console.log(`[hetzner] removed ${n} video(s) from this device's library`);
    if (typeof refreshAllLists === "function") refreshAllLists();
    if (typeof window.renderFolderPills === "function") await window.renderFolderPills();
    return n;
  }

  /** Drop Hetzner rows whose key now has a phone copy. Cheap; safe to call often. */
  async function dedupe() {
    const db = await openDB();
    const tx = db.transaction([STORE_NAME, META_STORE_NAME], "readwrite");
    const src = tx.objectStore(STORE_NAME);
    const meta = tx.objectStore(META_STORE_NAME);
    const rows = await readAll(src);
    const phoneKeys = phoneKeysOf(rows);
    let n = 0;
    rows.filter(v => isHetznerRow(v) && phoneKeys.has(v.videoKey)).forEach(v => {
      src.delete(v.oneDriveId); meta.delete(v.oneDriveId); n++;
    });
    await done(tx);
    if (n) console.log(`[hetzner] ${n} video(s) now on the phone - Hetzner rows dropped`);
    return n;
  }

  // ---- offline: what is on this phone (native 15.11) -------------------------
  // Every phone file is offline - it plays with no connection - and a Hetzner
  // row streams. render.js and ui.js set such a file's name bold and
  // underlined (scray-offline-title, as in Picker), and the Offline toggle
  // (randomiser.js) shows only these.
  window.scrayIsOffline = v => !!v && (typeof window.isLocalVideo === "function"
    ? window.isLocalVideo(v)
    : v.driveId === "local");

  // ---- D: save a Hetzner file to the phone (native 15.11) --------------------
  // The D paths call refreshVideoBeforeUse first, so downloadUrl is a fresh
  // signed link. ScrayOffline.swift downloads it into <video folder>/Offline/,
  // and a finished file is added to the library at once - after which the
  // sync drops the Hetzner row if it has the same key (the phone copy wins),
  // or the two sit as one row with P and H chips, the phone's lit.
  //
  // Progress (native 15.13) is the Upload panel's template (scray-upload.js):
  // #scrayOfflinePanel wears the same up-* classes and style.css styles both
  // panels with one set of rules - the file going down with its bar, %, size,
  // speed and time left, an "All" bar when there are several, ▾ to fold it to
  // a pill, the list with Retry, Clear. It sits where the Upload panel sits,
  // lifted clear of the corner buttons, and stacks above the Upload panel
  // when both are showing (placePanel).
  const OFFLINE_FOLDER = "Offline";
  const POLL_MS = 1000;
  // One entry per file: { id, filename, rowId, state, received, total, bps, error }
  // state: starting → downloading → adding → done | failed | cancelled
  // Starts folded to its pill (native 15.15) - tap it to open.
  const dl = { items: [], minimized: true, showList: false };
  let dlTimer = null;
  const DL_ACTIVE = new Set(["starting", "downloading", "adding"]);

  const esc = s => String(s ?? "").replace(/[&<>"']/g, m =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  function fmtBytes(b) {
    let n = Number(b);
    if (!Number.isFinite(n) || n < 0) return "—";
    const u = ["B", "KB", "MB", "GB", "TB"];
    let i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return (i === 0 ? String(n) : n.toFixed(n < 10 ? 2 : n < 100 ? 1 : 0)) + " " + u[i];
  }
  const fmtSpeed = bps => bps > 0 ? fmtBytes(bps) + "/s" : "";
  function fmtEta(sec) {
    if (!Number.isFinite(sec) || sec < 0 || sec > 86400 * 2) return "";
    sec = Math.round(sec);
    if (sec < 60) return `${sec}s`;
    const m = Math.floor(sec / 60), s = sec % 60;
    if (m < 60) return `${m}m ${String(s).padStart(2, "0")}s`;
    return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
  }
  const pct = (a, b) => b > 0 ? Math.min(100, Math.floor((a / b) * 100)) : 0;
  const dlFind = id => dl.items.find(i => i.id === id);
  const newDlId = () => "off-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const forgetJob = id => { try { window.ScrayBridge?.offlineForget?.(id)?.catch?.(() => {}); } catch {} };

  // ------------------------------------------------------------------ panel
  let panel = null;
  let upWatch = null;

  function showPanel(on) {
    if (!on) { if (panel) panel.hidden = true; return; }
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "scrayOfflinePanel";
      panel.addEventListener("click", onPanelClick);
      document.body.appendChild(panel);
      window.addEventListener("resize", placePanel);
    }
    panel.hidden = false;
    renderPanel();
  }

  /**
   * Both panels anchor to the same corner. When the Upload panel is showing,
   * this one sits on top of it rather than over it; otherwise style.css's
   * place (clear of the corner buttons) stands.
   */
  function placePanel() {
    if (!panel || panel.hidden) return;
    panel.style.bottom = "";
    panel.style.maxHeight = "";
    const up = document.getElementById("scrayUploadPanel");
    if (up && !upWatch && typeof ResizeObserver === "function") {
      upWatch = new ResizeObserver(() => placePanel());
      upWatch.observe(up);
    }
    if (!up || up.hidden) return;
    const r = up.getBoundingClientRect();
    if (!r.height) return;
    const mine = parseFloat(getComputedStyle(panel).bottom) || 0;
    const need = Math.round(window.innerHeight - r.top + 8);
    if (need <= mine) return;
    panel.style.bottom = `${need}px`;
    panel.style.maxHeight = `${Math.max(90, Math.round(r.top - 8 - 20))}px`;
  }

  function renderPanel() {
    if (!panel || panel.hidden) return;
    const items = dl.items;
    const actives = items.filter(i => DL_ACTIVE.has(i.state));
    const current = actives[0];
    const done = items.filter(i => i.state === "done");
    const failed = items.filter(i => i.state === "failed");

    // Batch figures: what's going and what's landed, so the bar doesn't jump
    // back when a file finishes.
    const batch = items.filter(i => i.state !== "cancelled" && i.state !== "failed");
    const bTotal = batch.reduce((a, i) => a + (i.total || 0), 0);
    const bGot   = batch.reduce((a, i) => a + (i.state === "done" || i.state === "adding" ? (i.total || 0) : (i.received || 0)), 0);
    const bps  = actives.reduce((a, i) => a + (i.bps || 0), 0);
    const left = actives.reduce((a, i) => a + Math.max(0, (i.total || 0) - (i.received || 0)), 0);
    const overallEta = bps > 0 ? fmtEta(left / bps) : "";

    panel.classList.toggle("is-min", dl.minimized);
    if (dl.minimized) {
      const label = current ? `${pct(bGot, bTotal)}%` : failed.length ? `${failed.length} failed` : done.length ? "✓" : "";
      panel.innerHTML = `<button class="up-pill" data-act="expand" title="Saving offline">⬇ ${esc(label)}</button>`;
      placePanel();
      return;
    }

    let head;
    if (current) {
      const one = (c) => {
        const p = pct(c.received, c.total);
        const eta = c.bps > 0 && c.total ? fmtEta((c.total - c.received) / c.bps) : "";
        const status = c.state === "starting" ? "asking for the file…"
          : c.state === "adding" ? "adding to the library…"
          : [c.total ? `${p}%` : "", c.total ? `${fmtBytes(c.received)} of ${fmtBytes(c.total)}` : fmtBytes(c.received),
             fmtSpeed(c.bps), eta && `${eta} left`].filter(Boolean).join(" · ");
        return `
        <div class="up-now">
          <div class="up-name" title="${esc(c.filename)}">${esc(c.filename)}</div>
          <div class="up-dest">Phone › ${esc(OFFLINE_FOLDER)}</div>
          <div class="up-bar"><i style="width:${c.state === "adding" ? 100 : p}%"></i></div>
          <div class="up-stat">${esc(status)}</div>
          ${c.state !== "adding" ? `<button class="up-link" data-act="cancel" data-id="${esc(c.id)}">Cancel this file</button>` : ""}
        </div>`;
      };
      head = actives.map(one).join("") + `
        ${batch.length > 1 ? `
        <div class="up-batch">
          <div class="up-bar thin"><i style="width:${pct(bGot, bTotal)}%"></i></div>
          <div class="up-stat">All: ${done.length} of ${batch.length} saved${actives.length > 1 ? `, ${actives.length} coming down` : ""} · ${fmtBytes(bGot)} of ${fmtBytes(bTotal)}${bps > 0 ? ` · ${fmtSpeed(bps)}` : ""}${overallEta ? ` · ${overallEta} left` : ""}</div>
        </div>` : ""}`;
    } else {
      head = `<div class="up-now"><div class="up-stat">${
        failed.length ? `${done.length} saved, ${failed.length} failed`
          : done.length ? `All ${done.length} saved to ${esc(OFFLINE_FOLDER)}` : "Nothing saved"}</div></div>`;
    }

    const rows = items.map(i => {
      const icon = { starting: "⬇", downloading: "⬇", adding: "⬇", done: "✓", failed: "✕", cancelled: "–" }[i.state];
      const cls = i.state === "downloading" || i.state === "starting" || i.state === "adding" ? "uploading" : i.state;
      const act = (i.state === "failed" || i.state === "cancelled")
        ? `<button class="up-link" data-act="retry" data-id="${esc(i.id)}">Retry</button>` : "";
      const sub = i.state === "failed" ? `<div class="up-err">${esc(i.error)}</div>`
        : i.state === "done" ? `<div class="up-sub">Phone › ${esc(OFFLINE_FOLDER)}</div>` : "";
      return `<li class="st-${cls}"><span class="up-ico">${icon}</span>
        <div class="up-li"><div class="up-li-name">${esc(i.filename)} ${i.total ? `<span class="up-size">${fmtBytes(i.total)}</span>` : ""}</div>${sub}</div>${act}</li>`;
    }).join("");

    panel.innerHTML = `
      <div class="up-head">
        <b>SAVING OFFLINE</b>
        <span class="up-grow"></span>
        ${!current && items.length ? `<button class="up-link" data-act="clear">Clear</button>` : ""}
        <button class="up-x" data-act="minimize" title="Minimise">▾</button>
      </div>
      ${head}
      ${current && items.length > 1 ? `<button class="up-link up-toggle" data-act="list">${dl.showList ? "Hide" : "Show"} the list (${items.length})</button>` : ""}
      ${!current || dl.showList ? `<ul class="up-list">${rows}</ul>` : ""}`;
    placePanel();
  }

  function onPanelClick(e) {
    const b = e.target.closest("button[data-act]");
    if (!b) return;
    e.stopPropagation();
    const id = b.dataset.id;
    switch (b.dataset.act) {
      case "minimize": dl.minimized = true; renderPanel(); break;
      case "expand":   dl.minimized = false; renderPanel(); break;
      case "cancel":   cancelDownload(id); break;
      case "retry":    retryDownload(id).catch(err => failItem(dlFind(id), err)); break;
      case "clear":    clearFinished(); break;
      case "list":     dl.showList = !dl.showList; renderPanel(); break;
    }
  }

  // ------------------------------------------------------------------ jobs
  function failItem(it, err) {
    if (!it) return;
    it.state = "failed";
    it.bps = 0;
    it.error = String((err && err.message) || err || "download failed").replace(/^Error: /, "");
    renderPanel();
  }

  async function cancelDownload(id) {
    const it = dlFind(id);
    if (!it || !(it.state === "starting" || it.state === "downloading")) return;
    it.state = "cancelled";
    it.bps = 0;
    renderPanel();
    try { await window.ScrayBridge.offlineCancel(id); } catch { /* not running on the native side */ }
    forgetJob(id);
  }

  function clearFinished() {
    dl.items = dl.items.filter(i => DL_ACTIVE.has(i.state));
    renderPanel();
    if (!dl.items.length) showPanel(false);
  }

  function ensureTimer() {
    if (!dlTimer) dlTimer = setInterval(() => { pollDownloads().catch(() => {}); }, POLL_MS);
  }

  /** A saved file into the library, as scrayPlayDownloaded does (native 13.195). */
  async function addToLibrary(relPath) {
    const got = await window.scrayLocalVideoRow(relPath);
    if (!got || !got.meta) throw new Error(`saved, but Scray can't read ${relPath}`);
    await saveVideos([got.row], getActiveFolderName(), "local", "local");
    // Brings its score and bookmarks down, and drops a same-key Hetzner row.
    if (typeof window.scraySyncLibrary === "function") {
      try { await window.scraySyncLibrary({ quiet: true }); } catch (err) { console.warn("[offline] sync:", err); }
    }
    if (typeof refreshAllLists === "function") refreshAllLists();
    if (typeof window.renderFolderPills === "function") await window.renderFolderPills();
    if (typeof window.syncOfflineOnlyToggleLabel === "function") window.syncOfflineOnlyToggleLabel();
  }

  async function pollDownloads() {
    const going = dl.items.filter(i => i.state === "downloading");
    if (!going.length) {
      if (!dl.items.some(i => DL_ACTIVE.has(i.state))) { clearInterval(dlTimer); dlTimer = null; }
      return;
    }
    let jobs = [];
    try { jobs = ((await window.ScrayBridge.offlineStatus(going.map(i => i.id))) || {}).jobs || []; } catch { return; }
    for (const st of jobs) {
      const it = dlFind(st.id);
      if (!it || it.state !== "downloading") continue;
      it.received = Number(st.received) || 0;
      if (Number(st.total) > 0) it.total = Number(st.total);
      it.bps = Number(st.bytesPerSecond) || 0;
      if (st.state === "downloading") continue;
      it.bps = 0;
      if (st.state === "finished") {
        it.state = "adding";
        renderPanel();
        try {
          await addToLibrary(st.path);
          it.state = "done";
          if (it.total) it.received = it.total;
        } catch (err) { failItem(it, err); }
        forgetJob(st.id);
      } else if (st.state === "failed") {
        failItem(it, st.error || "download failed");
        forgetJob(st.id);
      } else {                               // cancelled
        it.state = "cancelled";
        forgetJob(st.id);
      }
    }
    renderPanel();
  }

  /**
   * Start one file. `it` is an existing entry when this is a Retry, so the
   * list keeps its place; otherwise a new one joins the list.
   */
  async function startOffline(vid, it) {
    const id = newDlId();
    const total = Number(vid.sizeBytes) || 0;
    if (it) {
      forgetJob(it.id);
      Object.assign(it, { id, state: "starting", received: 0, total: total || it.total || 0, bps: 0, error: null });
    } else {
      it = { id, filename: vid.filename, rowId: vid.oneDriveId || null, state: "starting", received: 0, total, bps: 0, error: null };
      dl.items.push(it);
    }
    // native 15.15: a new download starts with the panel folded to its pill.
    // If the panel is already on screen (open, or a Retry pressed in it), it
    // stays as it is.
    if (!panel || panel.hidden) dl.minimized = true;
    showPanel(true);
    try {
      await window.ScrayBridge.offlineStart({ id, url: vid.downloadUrl, filename: vid.filename, folder: OFFLINE_FOLDER });
    } catch (err) {
      const m = String((err && err.message) || err);
      // An app built before 15.11: the in-app browser's download instead.
      if (/Unknown action/i.test(m)) {
        dl.items = dl.items.filter(x => x !== it);
        if (!dl.items.length) showPanel(false); else renderPanel();
        browserDownload(vid);
        return;
      }
      failItem(it, m);
      return;
    }
    if (it.state === "starting") it.state = "downloading";
    renderPanel();
    ensureTimer();
  }

  /** Retry: a fresh signed link for the same row, then start it again. */
  async function retryDownload(id) {
    const it = dlFind(id);
    if (!it || !(it.state === "failed" || it.state === "cancelled")) return;
    it.state = "starting"; it.error = null;
    renderPanel();
    const all = typeof getAllVideos === "function" ? await getAllVideos() : [];
    const want = nfcLower(it.filename);
    const row = (it.rowId && all.find(v => v.oneDriveId === it.rowId))
      || all.find(v => isHetznerRow(v) && nfcLower(v.filename) === want);
    if (!row) throw new Error("this file isn't in the Hetzner list any more - fetch Hetzner and press D again");
    const fresh = await window.refreshVideoBeforeUse({ ...row });
    if (!fresh || !fresh.downloadUrl) throw new Error("couldn't get a fresh link for this file");
    it.rowId = row.oneDriveId;
    await startOffline(fresh, it);
  }

  /**
   * After a reload the list is gone but Swift's downloads aren't: pick up
   * anything still coming down (or finished and not yet in the library).
   */
  async function recoverDownloads() {
    const b = window.ScrayBridge;
    if (!b || typeof b.offlineStatus !== "function") return;
    let jobs = [];
    try { jobs = ((await b.offlineStatus(null)) || {}).jobs || []; } catch { return; }
    for (const st of jobs) {
      if (dlFind(st.id)) continue;
      if (st.state === "downloading" || st.state === "finished") {
        dl.items.push({ id: st.id, filename: st.filename, rowId: null, state: "downloading",
          received: Number(st.received) || 0, total: Number(st.total) || 0, bps: 0, error: null });
      } else {
        forgetJob(st.id);
      }
    }
    if (dl.items.length) { showPanel(true); ensureTimer(); }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setTimeout(recoverDownloads, 500));
  else setTimeout(recoverDownloads, 500);

  /** Before 15.11's build: the signed link with dl=1 in the in-app browser. */
  function browserDownload(vid) {
    const url = vid.downloadUrl + (vid.downloadUrl.includes("?") ? "&" : "?") + "dl=1";
    if (window.ScrayBridge && typeof window.ScrayBridge.openBrowser === "function") {
      window.ScrayBridge.openBrowser(url).catch(err => console.error("[hetzner] download:", err));
    } else {
      window.open(url, "_blank");
    }
  }

  /**
   * D on a Hetzner row. Returns true when it took the row, false to leave the
   * caller's own path (which sets window.location.href - for a Hetzner file
   * that would navigate Scray's own page away).
   */
  function hetznerDownload(vid) {
    if (!isHetznerRow(vid) || !vid.downloadUrl) return false;
    if (window.ScrayBridge && typeof window.ScrayBridge.offlineStart === "function") {
      startOffline(vid).catch(err => alert(`Couldn't save ${vid.filename}: ${err.message || err}`));
    } else {
      browserDownload(vid);
    }
    return true;
  }
  window.scrayHetznerDownload = hetznerDownload;

  // ---- delete / rename / move on a streamed row (native 15.11) ---------------
  const api = (action, body) => window.scrayApiCall(action, { method: "POST", body: body || {} });
  const device = () => window.SCRAY_SYNC?.DEVICE_ID || "native";
  const nfcLower = s => String(s ?? "").normalize("NFC").trim().toLowerCase();
  const friendly = err => String((err && err.message) || err || "failed").replace(/^HTTP \d+: /, "");

  /** Forget a Hetzner row here only - the server has already dealt with the file. */
  async function forgetRow(v) {
    const id = v.oneDriveId;
    if (window.currentPlayingVideo?.oneDriveId === id && window.inlineVideoPlayer) {
      try { window.inlineVideoPlayer.stop(); } catch {}
    }
    await deleteVideoFromDB(id, { localOnly: true });
    try {
      const db = await openDB();
      const tx = db.transaction(META_STORE_NAME, "readwrite");
      tx.objectStore(META_STORE_NAME).delete(id);
      await done(tx);
    } catch {}
    if (typeof removeVideoFromMemory === "function") removeVideoFromMemory(id);
    if (typeof window.removeRowFromLists === "function") window.removeRowFromLists(id);
    if (typeof refreshAllLists === "function") refreshAllLists();
    if (typeof window.renderFolderPills === "function") await window.renderFolderPills();
  }

  /**
   * Delete a streamed Hetzner file: delete_file deletes its copies (the box
   * has no recycle bin; a OneDrive copy under the same key goes to the
   * Recycle bin) and tombstones the catalogue row - the same action Native's
   * "delete everywhere" uses. Then the row leaves this library.
   */
  async function deleteRow(v) {
    const key = v.videoKey || (window.scrayVideoKey ? window.scrayVideoKey(v.filename) : "");
    if (!key) throw new Error("no video key for this file");
    let res;
    try { res = await api("delete_file", { video_key: key, device: device() }); }
    catch (err) { throw new Error(friendly(err)); }
    await forgetRow(v);
    return res;
  }
  window.scrayHetznerDeleteRow = deleteRow;

  /**
   * Move a streamed Hetzner file to another folder on the box: hetzner_move
   * (browse 15.56 lets the device key do this). The row takes the new folder
   * and its tags at once; the next sync confirms them.
   */
  async function moveRow(v, destDir) {
    const iid = v.hetznerInstanceId;
    if (!iid) throw new Error("This Hetzner row is from before 15.11 - tap the Hetzner pill twice to re-fetch, then try again");
    const dest = String(destDir || "").replace(/\\/g, "/").replace(/^[\/*]+|\/+$/g, "");
    let r;
    try { r = await api("hetzner_move", { instance_id: iid, dest_dir: dest, device: device() }); }
    catch (err) { throw new Error(friendly(err)); }
    if (r && r.noop) return r;
    const facts = r.facts || {};
    const split = x => typeof x === "string" && x ? x.split(";").filter(Boolean) : [];
    const fields = {
      path: dest,
      hetznerPath: (dest ? dest + "/" : "") + (r.filename || v.filename),
      cataloguePath: undefined,          // re-ask the catalogue next sync
    };
    if (facts.tags !== undefined) fields.tags = split(facts.tags);
    if (facts.bracket_tags !== undefined) fields.bracketTags = split(facts.bracket_tags);
    for (let i = 1; i <= 5; i++) if (facts[`level_${i}`] !== undefined) fields[`level_${i}`] = facts[`level_${i}`] || null;
    if (typeof window.updateVideoInDB === "function") await window.updateVideoInDB(v.oneDriveId, fields, { fromSync: true });
    if (typeof window.updateVideoInMemory === "function") window.updateVideoInMemory(v.oneDriveId, fields);
    Object.assign(v, fields);
    if (typeof refreshAllLists === "function") refreshAllLists();
    return r;
  }
  window.scrayHetznerMoveRow = moveRow;

  /**
   * The Hetzner copies of the same file that a phone file is linked to: rows
   * in this library that stream from the box, in the phone file's variant
   * group, under the same file name (a migrated copy keeps its name, and is
   * filed as <name>#hetzner when OneDrive holds the name). "Everywhere" on the
   * phone file reaches these too. A linked copy with another name is another
   * file - a 4K version, say - and is left alone.
   */
  async function linkedCopies(video, name) {
    const g = video && video.variant_group;
    if (!g || typeof getAllVideos !== "function") return [];
    const key = video.videoKey;
    const want = nfcLower(name || video.filename);
    return (await getAllVideos()).filter(x => isHetznerRow(x) && String(x.variant_group || "") === String(g)
      && x.videoKey !== key && nfcLower(x.filename) === want);
  }
  window.scrayHetznerLinkedCopies = linkedCopies;


  window.scrayHetznerFetch  = fetchHetzner;
  window.scrayHetznerRemove = removeHetzner;
  window.scrayHetznerDedupe = dedupe;

  // ---- the pill ------------------------------------------------------------
  // Drawn after the folder pills, in the same row and the same style. Tap to
  // arm, tap again to re-fetch; the cross arms, a tap on the pill removes -
  // the two-tap pattern the folder pills use, since confirm() is unreliable
  // in WKWebView.
  async function renderPill() {
    const container = document.getElementById("accountLoadButtons");
    if (!container) return;
    container.querySelector('.account-pill[data-source="hetzner"]')?.remove();
    let count = 0;
    try { count = (await getAllVideos()).filter(isHetznerRow).length; } catch {}
    // The top-row button is only the way in; once the box is part of the
    // library the pill does re-fetch and remove.
    const topBtn = document.getElementById("hetznerFetchBtn");
    if (topBtn) topBtn.style.display = (count || enabled()) ? "none" : "";
    if (!count && !enabled()) return;

    const pill = document.createElement("div");
    pill.className = "account-pill";
    pill.dataset.source = "hetzner";
    // The box's whole count, with the part on this phone in brackets (native
    // 15.51) - those play from the phone, so they have no Hetzner row. Until a
    // fetch has recorded the total, just the rows.
    const total = boxTotal();
    const onPhone = total > count ? total - count : 0;
    const label = total && onPhone
      ? `☁ ${NAME} ${total.toLocaleString()} (${onPhone.toLocaleString()} on phone)`
      : `☁ ${NAME} (${count.toLocaleString()})`;
    const btn = document.createElement("button");
    btn.className = "account-load-btn";
    btn.textContent = label;
    btn.title = "Tap to re-fetch from the Hetzner Storage Box";
    const cross = document.createElement("span");
    cross.className = "account-remove-cross";
    cross.innerHTML = "&times;";
    cross.title = "Remove these videos from this device's library (nothing on the box is deleted)";

    let armed = null, timer = null;
    const disarm = () => {
      armed = null; clearTimeout(timer);
      btn.textContent = label; btn.style.background = ""; cross.style.display = "";
    };
    const arm = (mode, text, colour) => {
      armed = mode; btn.textContent = text; btn.style.background = colour;
      if (mode === "remove") cross.style.display = "none";
      clearTimeout(timer); timer = setTimeout(disarm, 5000);
    };

    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (armed === "remove") {
        disarm(); btn.textContent = "Removing…"; btn.disabled = true;
        try { await removeHetzner(); } catch (err) { alert(`Remove failed: ${err.message}`); await renderPill(); }
        return;
      }
      if (armed !== "fetch") { arm("fetch", "Re-fetch?", "#007bff"); return; }
      disarm(); btn.disabled = true;
      try {
        const r = await fetchHetzner({ onProgress: m => { btn.textContent = `☁ ${m}`; } });
        if (r.added || r.removed) console.log(`[hetzner] +${r.added} −${r.removed}`);
        reportFetch(r);
      } catch (err) {
        reportFetchError(err);
      } finally {
        btn.disabled = false;
        await renderPill();
      }
    });
    cross.addEventListener("click", (e) => {
      e.stopPropagation(); e.preventDefault();
      arm("remove", "Confirm remove?", "#999");
    });

    pill.appendChild(btn);
    pill.appendChild(cross);
    container.appendChild(pill);
  }
  window.scrayRenderHetznerPill = renderPill;

  // renderFolderPills rebuilds the row from scratch, so the pill is added
  // after every redraw. A top-level function declaration is a global binding,
  // so the calls to it inside local-library.js pick up this wrapper too.
  function wrapPills() {
    const orig = window.renderFolderPills;
    if (typeof orig !== "function" || orig._scrayHetzner) return;
    const wrapped = async function (...args) {
      const r = await orig.apply(this, args);
      try { await renderPill(); } catch (err) { console.warn("[hetzner] pill:", err); }
      return r;
    };
    wrapped._scrayHetzner = true;
    window.renderFolderPills = wrapped;
  }
  wrapPills();

  document.addEventListener("DOMContentLoaded", () => {
    wrapPills();
    const btn = document.getElementById("hetznerFetchBtn");
    btn?.addEventListener("click", async () => {
      const orig = btn.textContent;
      btn.disabled = true;
      try {
        const r = await fetchHetzner({ onProgress: m => { btn.textContent = m; } });
        btn.textContent = `✅ ${r.added + r.updated}`;
        setTimeout(() => { btn.textContent = orig; }, 1500);
        reportFetch(r);
      } catch (err) {
        reportFetchError(err);
        btn.textContent = orig;
      } finally {
        btn.disabled = false;
      }
    });
    renderPill().catch(() => {});
  });
})();

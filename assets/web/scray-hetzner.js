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

  async function listAll(onProgress) {
    const out = [];
    let after = "";
    for (;;) {
      const res = await window.scrayApiCall("hetzner_list", { params: { after, limit: 2000 } });
      out.push(...(res.videos || []));
      onProgress?.(`Listing Hetzner… ${out.length}`);
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
  async function fetchHetzner({ onProgress } = {}) {
    if (typeof window.scrayApiCall !== "function") throw new Error("sync layer not loaded");
    onProgress?.("Listing Hetzner…");
    const listed = await listAll(onProgress);

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
    console.log(`[hetzner] ${listed.length} listed: ${added} added, ${updated} updated, ${removed} removed, ${skipped} already on the phone`);

    onProgress?.("Syncing scores…");
    if (typeof window.scraySyncLibrary === "function") {
      await window.scraySyncLibrary({ quiet: true });
      await stampSynced();
    }
    if (typeof refreshAllLists === "function") refreshAllLists();
    if (typeof window.renderFolderPills === "function") await window.renderFolderPills();
    return { listed: listed.length, added, updated, removed, skipped };
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
  // this polls for progress in a small panel bottom-left, and a finished file
  // is added to the library at once - after which the sync drops the Hetzner
  // row if it has the same key (the phone copy wins), or the two sit as one
  // row with P and H chips, the phone's lit.
  const OFFLINE_FOLDER = "Offline";
  const dlJobs = new Map();          // id -> { filename, el }
  let dlTimer = null;
  const fmtMB = b => `${(Number(b || 0) / 1048576).toFixed(b >= 1073741824 ? 0 : 1)} MB`;

  function dlPanel() {
    let box = document.getElementById("scrayOfflineDownloads");
    if (box) return box;
    box = document.createElement("div");
    box.id = "scrayOfflineDownloads";
    box.style.cssText = "position:fixed;left:8px;bottom:8px;z-index:2147483000;display:flex;flex-direction:column;" +
      "gap:4px;max-width:calc(100vw - 16px);pointer-events:none;";
    document.body.appendChild(box);
    return box;
  }
  function dlLine(id, filename) {
    const el = document.createElement("div");
    el.style.cssText = "pointer-events:auto;display:flex;align-items:center;gap:8px;background:rgba(20,20,20,.88);" +
      "color:#fff;border-radius:6px;padding:5px 8px;font-size:12px;box-shadow:0 2px 8px rgba(0,0,0,.35);";
    const text = document.createElement("span");
    text.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:70vw;";
    text.textContent = `⬇ ${filename}`;
    const x = document.createElement("button");
    x.type = "button";
    x.textContent = "✕";
    x.title = "Stop this download";
    x.style.cssText = "all:unset;cursor:pointer;padding:0 4px;font-size:13px;";
    x.addEventListener("click", async (e) => {
      e.stopPropagation();
      const job = dlJobs.get(id);
      if (job && job.state && job.state !== "downloading") { drop(id); return; }
      try { await window.ScrayBridge.offlineCancel(id); } catch {}
    });
    el.append(text, x);
    el._text = text;
    dlPanel().appendChild(el);
    return el;
  }
  function drop(id) {
    const job = dlJobs.get(id);
    job?.el?.remove();
    dlJobs.delete(id);
    try { window.ScrayBridge?.offlineForget?.(id); } catch {}
    if (!dlJobs.size) { clearInterval(dlTimer); dlTimer = null; }
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
  }

  async function pollDownloads() {
    const ids = [...dlJobs.keys()].filter(id => !dlJobs.get(id).state || dlJobs.get(id).state === "downloading");
    if (!ids.length) return;
    let jobs = [];
    try { jobs = ((await window.ScrayBridge.offlineStatus(ids)) || {}).jobs || []; } catch { return; }
    for (const st of jobs) {
      const job = dlJobs.get(st.id);
      if (!job || job.state === st.state) {
        if (job && st.state === "downloading") {
          const pct = st.total ? Math.floor(st.received / st.total * 100) : null;
          const rate = st.bytesPerSecond ? ` · ${fmtMB(st.bytesPerSecond)}/s` : "";
          job.el._text.textContent = `⬇ ${job.filename} ${pct != null ? pct + "%" : fmtMB(st.received)}${rate}`;
        }
        continue;
      }
      job.state = st.state;
      if (st.state === "finished") {
        job.el._text.textContent = `✅ Saved to ${OFFLINE_FOLDER}: ${job.filename}`;
        try { await addToLibrary(st.path); }
        catch (err) { job.el._text.textContent = `⚠ ${job.filename}: ${err.message || err}`; continue; }
        setTimeout(() => drop(st.id), 4000);
      } else if (st.state === "failed") {
        job.el._text.textContent = `⚠ ${job.filename}: ${st.error || "download failed"}`;
      } else {
        drop(st.id);                       // cancelled
      }
    }
  }

  async function startOffline(vid) {
    const id = "off-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    try {
      await window.ScrayBridge.offlineStart({ id, url: vid.downloadUrl, filename: vid.filename, folder: OFFLINE_FOLDER });
    } catch (err) {
      const m = String((err && err.message) || err);
      // An app built before 15.11: the in-app browser's download instead.
      if (/Unknown action/i.test(m)) { browserDownload(vid); return; }
      alert(`Couldn't save ${vid.filename} to the phone: ${m}`);
      return;
    }
    dlJobs.set(id, { filename: vid.filename, el: dlLine(id, vid.filename), state: "downloading" });
    if (!dlTimer) dlTimer = setInterval(() => { pollDownloads().catch(() => {}); }, 1000);
  }

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
    const label = `☁ ${NAME} (${count})`;
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
        const r = await fetchHetzner({ onProgress: m => { btn.textContent = m; } });
        if (r.added || r.removed) console.log(`[hetzner] +${r.added} −${r.removed}`);
      } catch (err) {
        console.error("[hetzner] fetch failed:", err);
        alert(`Hetzner fetch failed: ${err.message}`);
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
      } catch (err) {
        console.error("[hetzner] fetch failed:", err);
        alert(`Hetzner fetch failed: ${err.message}`);
        btn.textContent = orig;
      } finally {
        btn.disabled = false;
      }
    });
    renderPill().catch(() => {});
  });
})();

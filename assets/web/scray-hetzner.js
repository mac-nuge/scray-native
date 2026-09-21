// =========================================
// HETZNER SOURCE (native 14.51)
//
// Videos on the Hetzner Storage Box, added to this device's library as a
// source of their own - the way a phone folder is one, except nothing is on
// the phone: they stream through the gateway's signed URLs.
//
// Native's library holds only what its own scans find; a catalogue pull
// never adds a row (scrayApplyPulledRow ignores keys this device doesn't
// hold). So the box has to be fetched explicitly, like an account: the
// Hetzner button fetches, the pill re-fetches, the pill's cross removes.
//
// Rows are ordinary videoSource rows with routing fields of their own:
//   oneDriveId "hz:<video_key>", driveId "hetzner", accountKey "hetzner::box"
// isLocalVideo() is false for them, so local-file paths leave them alone;
// scrayApplyPulledRow keeps their routing fields and applies catalogue
// metadata (scores, bookmarks, tags) through the usual videoKey lookup.
// refreshVideoBeforeUse (player.js) asks api.php's hetzner_url for a signed
// URL before any OneDrive account is looked up.
//
// A key this device already holds as a phone file is never added: the phone
// copy wins. scrayHetznerDedupe drops a Hetzner row once a phone copy of the
// same key turns up (a download, a folder scan), so nothing shows twice.
// =========================================

(function () {
  const ACCOUNT_KEY = "hetzner::box";
  const DRIVE_ID    = "hetzner";
  const NAME        = "Hetzner";
  const ID_PREFIX   = "hz:";
  const FLAG        = "scray.hetzner.enabled";

  const isHetznerRow = v => !!v && (v.driveId === DRIVE_ID || v.accountKey === ACCOUNT_KEY);
  window.isHetznerVideo = isHetznerRow;

  function enabled() { try { return localStorage.getItem(FLAG) === "1"; } catch { return false; } }
  function setEnabled(on) { try { on ? localStorage.setItem(FLAG, "1") : localStorage.removeItem(FLAG); } catch {} }

  function splitList(s) { return typeof s === "string" && s ? s.split(";").filter(Boolean) : []; }

  /** One hetzner_list row as a videoSource row. */
  function toRow(r) {
    const key      = r.video_key;
    const filename = r.filename || key;
    const hzPath   = String(r.hetzner_path || filename);
    const slash    = hzPath.lastIndexOf("/");
    const dir      = slash > 0 ? "/" + hzPath.slice(0, slash) : "";
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
      filename,
      downloadUrl: null,                 // signed on demand - they expire
      sizeBytes: size,
      durationMs: dur,
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
   * now has a phone copy. Then a catalogue sync brings their scores and
   * bookmarks down, as it does after a folder scan.
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
   * After a sync has pulled their full history, mark Hetzner rows as
   * answered so later syncs ask for deltas only (the same cataloguePath test
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

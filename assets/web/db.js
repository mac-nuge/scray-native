/**
* IndexedDB setup for Scray Picker
*
* Two-store architecture:
* - videoSource: everything derivable from the video file / a rescan or
*   future Excel-videos-tab import. Freely overwritten every scan/import -
*   never hand-edited.
* - videoMeta: everything you create yourself (score, notes, bookmarks) or
*   that's event-driven (view_count, last_played, first_seen, f_tally).
*   Only ever written by explicit app actions - never silently overwritten
*   by a rescan.
*
* Both stores share the same key (kept as "oneDriveId" for compatibility
* with the rest of the app, even though for local files it now just holds
* a stable local file identifier rather than a real OneDrive ID).
*
* getAllVideos() joins both stores into the same flat shape the rest of
* the app already expects.
*/
const DB_NAME = "scray_picker";
const DB_VERSION = 11; // v11: videoKey index + inCatalogue flag for filename-key sync.
                       // Intentional full wipe - rescan the device library after
                       // this ships; metadata comes back from the server.
const STORE_NAME = "videoSource";
const META_STORE_NAME = "videoMeta";

// The 30-column CSV/SQLite column order. Previously read from excel-sheets.js,
// which the native build never loads - so exportVideosToCsv() threw. Defined
// here because db.js is loaded and this is the only consumer.
const VIDEO_SCHEMA = [
  "filename","file_size_bytes","duration_ms","width","height","orientation",
  "bitrate","mime_type","created_date","last_modified_date","oneDriveId",
  "drive_id","account_key","account_name","path","web_url","tags",
  "bracket_tags","level_1","level_2","level_3","level_4","level_5",
  "view_count","last_played","first_seen","user_score","notes","f_tally","bookmarks"
];
window.VIDEO_SCHEMA = VIDEO_SCHEMA;

// Fields that belong to you, not the file. updateVideoInDB() in
// file-operations.js auto-routes any of these to videoMeta so existing
// callers (saveBookmarks, etc.) keep working without changes.
const META_FIELDS = new Set([
  "user_score", "notes", "bookmarks", "view_count",
  "last_played", "first_seen", "f_tally"
]);
window.VIDEO_META_FIELDS = META_FIELDS;

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      if (db.objectStoreNames.contains(STORE_NAME)) db.deleteObjectStore(STORE_NAME);
      if (db.objectStoreNames.contains(META_STORE_NAME)) db.deleteObjectStore(META_STORE_NAME);
      if (db.objectStoreNames.contains("outbox")) db.deleteObjectStore("outbox");
      if (db.objectStoreNames.contains("syncState")) db.deleteObjectStore("syncState");

      const outboxStore = db.createObjectStore("outbox", { keyPath: "id", autoIncrement: true });
      outboxStore.createIndex("oneDriveId", "oneDriveId");
      outboxStore.createIndex("at", "at");
      db.createObjectStore("syncState", { keyPath: "key" });

      const sourceStore = db.createObjectStore(STORE_NAME, { keyPath: "oneDriveId" });
      sourceStore.createIndex("path", "path");
      sourceStore.createIndex("filename", "filename");
      sourceStore.createIndex("webUrl", "webUrl");
      sourceStore.createIndex("accountKey", "accountKey");
      sourceStore.createIndex("tags", "tags", { multiEntry: true });
      sourceStore.createIndex("mimeType", "mimeType");
      sourceStore.createIndex("orientation", "orientation");
      sourceStore.createIndex("createdDateTime", "createdDateTime");
      sourceStore.createIndex("lastModifiedDateTime", "lastModifiedDateTime");
      sourceStore.createIndex("bitrate", "bitrate");
      sourceStore.createIndex("fingerprint", "fingerprint");
      // unique:false is deliberate — two local files sharing a normalized name
      // is exactly the duplicate case to flag, not an exception that should
      // abort the scan.
      sourceStore.createIndex("videoKey", "videoKey", { unique: false });
      sourceStore.createIndex("inCatalogue", "inCatalogue");

      const metaStore = db.createObjectStore(META_STORE_NAME, { keyPath: "oneDriveId" });
      metaStore.createIndex("user_score", "user_score");
      metaStore.createIndex("last_played", "last_played");
    };

    request.onsuccess = e => resolve(e.target.result);
    request.onerror = e => reject(e.target.error);
  });
}

/** Convert folder path into tags array */
function generateTagsFromPath(pathString) {
  if (!pathString) return [];
  return pathString
      .split("/")
      .filter(Boolean)
      .map(folder => folder.trim().replace(/\s+/g, "-").toLowerCase());
}

/**
* Extract tags from square brackets in filename
* Example: "video[tag1][tag2].mp4" → ["tag1", "tag2"]
*/
function generateTagsFromFilename(filename) {
  if (!filename) return [];
  const bracketRegex = /\[([^\]]+)\]/g;
  const tags = [];
  let match;
  while ((match = bracketRegex.exec(filename)) !== null) {
      const tag = match[1].trim().replace(/\s+/g, "-").toLowerCase();
      if (tag.length > 0) tags.push(tag);
  }
  return tags;
}

/** Extract folder levels from path into level_1...level_5 */
function generateLevelFieldsFromPath(pathString) {
   const levels = {};
   if (!pathString) return levels;
   const folders = pathString
       .split("/")
       .filter(Boolean)
       .map(folder => folder.trim().replace(/\s+/g, "-").toLowerCase());
   folders.forEach((folderName, idx) => {
       const levelNum = idx + 1;
       if (levelNum <= 4) {
           levels[`level_${levelNum}`] = folderName;
       } else if (levelNum === 5) {
           levels[`level_${levelNum}`] = folders.slice(idx).join("_");
       }
   });
   return levels;
}

/**
* Build a fingerprint string for cross-referencing a local video against
* Excel Videos-tab rows (joined with raw_data for width/height/duration).
* Not a storage key - used as a corroboration signal with tolerance bands
* at match time, not exact equality.
*/
/**
* Derive orientation from dimensions: "L" = landscape/square, "P" = portrait.
* Centralised here so every write path (scan, import, backfill) produces
* exactly the same value the orientation dropdown filters against.
*/
function deriveOrientation(width, height) {
  if (width == null || height == null) return null;
  return width >= height ? "L" : "P";
}
window.deriveOrientation = deriveOrientation;

function buildVideoFingerprint({ filename, width, height, durationMs, bitrate }) {
  const w = width ?? "?";
  const h = height ?? "?";
  const d = durationMs != null ? Math.round(durationMs / 1000) : "?";
  const b = bitrate != null ? Math.round(bitrate / 1000) : "?";
  return `${filename}|${w}x${h}|${d}s|${b}kbps`;
}
window.buildVideoFingerprint = buildVideoFingerprint;

/**
* Save videos into videoSource (native/derivable fields only). Called by
* scanLocalLibrary(). Also ensures a default videoMeta row exists for
* each video, stamping first_seen the first time it's ever scanned.
*/
async function saveVideos(videos, username, accountId, driveId) {
   const db = await openDB();
   const tx = db.transaction([STORE_NAME, META_STORE_NAME], "readwrite");
   const sourceStore = tx.objectStore(STORE_NAME);
   const metaStore = tx.objectStore(META_STORE_NAME);

   for (const video of videos) {
       let vidId = video.idFromAPI ?? video.oneDriveId ?? null;
       let drvId = driveId;
       if ((!vidId || !drvId) && video.webUrl) {
           try {
               const u = new URL(video.webUrl);
               const cidParam = u.searchParams.get("cid");
               const idParam = u.searchParams.get("id");
               if (cidParam) drvId = drvId || cidParam;
               if (idParam) vidId = vidId || idParam;
           } catch {}
       }

    const pathTags = generateTagsFromPath(video.path);
    const filenameBracketTags = generateTagsFromFilename(video.name || video.filename);
    const tagsArray = [...new Set([...pathTags, ...filenameBracketTags])];
    const levelFields = generateLevelFieldsFromPath(video.path);

    if (filenameBracketTags.length > 0) {
        levelFields.level_5 = levelFields.level_5
            ? levelFields.level_5 + ';' + filenameBracketTags.join(';')
            : filenameBracketTags.join(';');
    }

    const filename = video.name || video.filename;
    const fingerprint = buildVideoFingerprint({
        filename, width: video.width, height: video.height,
        durationMs: video.durationMs, bitrate: video.bitrate
    });

    sourceStore.put({
       oneDriveId: vidId,
       driveId: drvId,
       accountKey: `${accountId}::${drvId}`,
       accountName: username,
       path: video.path,
       webUrl: video.webUrl,
       filename,
       downloadUrl: video.downloadUrl,
       sizeBytes: video.sizeBytes,
       durationMs: video.durationMs ?? null,
       createdDateTime: video.createdDateTime ?? null,
       lastModifiedDateTime: video.lastModifiedDateTime ?? null,
       mimeType: video.mimeType ?? null,
       width: video.width ?? null,
       height: video.height ?? null,
       orientation: video.orientation ?? deriveOrientation(video.width, video.height),
       bitrate: video.bitrate ?? null,
       tags: tagsArray,
       bracketTags: filenameBracketTags,
       fingerprint,                                    // legacy — includes filename
       // Filename-free, so it survives a rename. buildVideoFingerprint above
       // folds the filename in, which defeats rename detection.
       fileFingerprint: window.scrayFingerprint({
           sizeBytes: video.sizeBytes, durationMs: video.durationMs,
           width: video.width, height: video.height
       }),
       videoKey: window.scrayVideoKey(filename),
       inCatalogue: false,        // set true by the sync when a server row is found
       lastScanned: new Date().toISOString(),
       ...levelFields
    });

    const existingMeta = await new Promise((resolve, reject) => {
        const req = metaStore.get(vidId);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
    if (!existingMeta) {
        metaStore.put({
            oneDriveId: vidId,
            user_score: null,
            notes: null,
            bookmarks: [],
            view_count: 0,
            last_played: null,
            first_seen: new Date().toISOString(),
            f_tally: 0,
            updatedAt: new Date().toISOString(),
            updatedBy: "scan"
        });
    }
   }

   // IDBTransaction has no `.complete` property — this returned undefined and
   // resolved before the write committed. Callers that immediately read back
   // (the post-scan sync, for one) were racing the transaction.
   await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
}

/**
* Write to videoMeta only. Stamps updatedAt/updatedBy so a future
* merge-conflict UI can show provenance before overwriting anything.
*/
// opUpdates lets a caller send the server something different from what's
// written locally. Play counters need exactly that: IndexedDB stores the
// absolute count (for display), while the server gets a +1 delta.
async function saveVideoMeta(oneDriveId, metaUpdates, updatedBy = "app", opUpdates = null) {
  const db = await openDB();
  const tx = db.transaction(META_STORE_NAME, "readwrite");
  const store = tx.objectStore(META_STORE_NAME);

  const existing = await new Promise((resolve, reject) => {
    const req = store.get(oneDriveId);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  store.put({
    ...(existing || {
      oneDriveId, user_score: null, notes: null, bookmarks: [],
      view_count: 0, last_played: null, first_seen: new Date().toISOString(), f_tally: 0
    }),
    ...metaUpdates,
    oneDriveId,
    updatedAt: new Date().toISOString(),
    updatedBy
  });

  await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });

  // Bookmarks live in their own table with their own endpoint, so they can
  // never ride the ops queue — buildOp drops them. Every bookmark write in the
  // app funnels through here, which makes this the one place worth handling
  // them: quick-add, the modal and deletes are all covered by it.
  if (updatedBy !== "scan" && updatedBy !== "sync" && metaUpdates.bookmarks !== undefined) {
    try {
      const db3 = await openDB();
      const srcRow = await new Promise((res) => {
        const r = db3.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(oneDriveId);
        r.onsuccess = () => res(r.result); r.onerror = () => res(null);
      });
      const bmKey = srcRow?.videoKey || (srcRow?.filename ? window.scrayVideoKey(srcRow.filename) : null);

      if (!bmKey) {
        console.warn(`[bm] no video_key for ${oneDriveId} — bookmarks saved locally only`);
      } else if (srcRow?.inCatalogue === false) {
        console.log(`[bm] ${bmKey} not in the catalogue — bookmarks stay on this device`);
      } else {
        const local = Array.isArray(metaUpdates.bookmarks) ? metaUpdates.bookmarks : [];
        const before = await window.scrayApiCall("bookmarks_get", { params: { id: bmKey } });
        const serverTimes = new Set((before.bookmarks || []).map(b => b.time_ms));
        const localTimes  = new Set(local.map(b => Math.round(b.time * 1000)));
        const removed = [...serverTimes].filter(t => !localTimes.has(t));

        await window.scrayApiCall("bookmarks_push", {
          method: "POST",
          body: {
            video_key: bmKey,
            device: window.SCRAY_SYNC.DEVICE_ID,
            upsert: local.map(b => ({ time_ms: Math.round(b.time * 1000), note: b.note || "" })),
            delete: removed,
          }
        });
        console.log(`[bm] pushed ${local.length} bookmark(s)` +
                    (removed.length ? `, tombstoned ${removed.length}` : "") + ` for ${bmKey}`);
      }
    } catch (err) {
      console.error("[bm] push failed — bookmarks are saved locally:", err.message);
    }
  }

  // Local write is committed; now queue it for the server. A "scan" is
  // derived data, not a user action, so it never generates an op.
  if (updatedBy !== "scan" && updatedBy !== "sync" && typeof window.scrayEnqueueOp === "function") {
    // Ops are addressed by video_key — the server has never heard of this
    // device's local ids.
    const db2 = await openDB();
    const row = await new Promise((res) => {
      const r = db2.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(oneDriveId);
      r.onsuccess = () => res(r.result); r.onerror = () => res(null);
    });
    const key = row?.videoKey || (row?.filename ? window.scrayVideoKey(row.filename) : null);

    if (!key) {
      console.warn(`[sync] no video_key for ${oneDriveId} — change saved locally only`);
    } else if (row && row.inCatalogue === false) {
      // Native NEVER auto-creates catalogue rows. That is what keeps the
      // catalogue clean; use "Add to catalogue" to promote deliberately.
      console.log(`[sync] ${key} is not in the catalogue — saved locally, not pushed`);
    } else {
      // Bookmarks were pushed above via their own endpoint — sending them here
      // just triggers buildOp's warning and does nothing.
      const { bookmarks, ...derivedOpUpdates } = (opUpdates || metaUpdates);
      const finalOp = opUpdates ? derivedOpUpdates : derivedOpUpdates;

      // Play counters are deliberately NOT queued when offline. A view
      // recorded on a plane and replayed three days later lands with the
      // wrong last_played and inflates a count nobody can account for -
      // better to lose it than to record it misleadingly. The local
      // IndexedDB write above still happened, so the device's own numbers
      // stay right.
      if (updatedBy === "play" && !navigator.onLine) {
        console.log(`[sync] offline - play counters for ${key} stay on this device`);
      } else if (Object.keys(finalOp).length) {
        await window.scrayEnqueueOp(key, finalOp);
      }
    }
  }
  return;
}
window.saveVideoMeta = saveVideoMeta;

/** Get all rows from videoMeta directly (rarely needed - prefer getAllVideos()) */
async function getAllVideoMeta() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(META_STORE_NAME, "readonly");
    const request = tx.objectStore(META_STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}
window.getAllVideoMeta = getAllVideoMeta;

/** Get all videos, merged from videoSource + videoMeta into the flat shape the rest of the app expects */
async function getAllVideos() {
   const db = await openDB();
   const [sourceRows, metaRows] = await Promise.all([
     new Promise((resolve, reject) => {
       const tx = db.transaction(STORE_NAME, "readonly");
       const req = tx.objectStore(STORE_NAME).getAll();
       req.onsuccess = () => resolve(req.result || []);
       req.onerror = () => reject(req.error);
     }),
     new Promise((resolve, reject) => {
       const tx = db.transaction(META_STORE_NAME, "readonly");
       const req = tx.objectStore(META_STORE_NAME).getAll();
       req.onsuccess = () => resolve(req.result || []);
       req.onerror = () => reject(req.error);
     })
   ]);

   const metaById = new Map(metaRows.map(m => [m.oneDriveId, m]));
   return sourceRows.map(source => ({
     ...source,
     ...(metaById.get(source.oneDriveId) || {})
   }));
}
window.getAllVideos = getAllVideos;

/** Get all unique tags from saved videos */
async function getAllTags() {
   const videos = await getAllVideos();
   const tagsSet = new Set();
   videos.forEach(rec => Array.isArray(rec.tags) && rec.tags.forEach(t => tagsSet.add(t)));
   return Array.from(tagsSet).sort();
}
window.getAllTags = getAllTags;

/** Clear videoSource only - a rescan should never wipe your notes/bookmarks/scores */
async function clearVideos() {
   const db = await openDB();
   const tx = db.transaction(STORE_NAME, "readwrite");
   tx.objectStore(STORE_NAME).clear();
   return tx.complete;
}
window.clearVideos = clearVideos;

/**
* Modal folder chooser. Resolves to an array of folder names, or null if
* cancelled. Videos whose accountName isn't in the registry are grouped under
* a synthetic "(unassigned)" entry so nothing silently drops out of the export.
*/
async function chooseFoldersForExport() {
  const allVideos = await getAllVideos();
  const registered = (typeof getLocalFolders === "function" ? getLocalFolders() : [])
    .map(f => f.name);

  const counts = new Map();
  allVideos.forEach(v => {
    const key = registered.includes(v.accountName) ? v.accountName : "(unassigned)";
    counts.set(key, (counts.get(key) || 0) + 1);
  });

  const entries = [...counts.entries()]
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);

  if (entries.length <= 1) {
    return entries.length ? [entries[0][0]] : [];
  }

  return new Promise((resolve) => {
    const modal = document.createElement("div");
    modal.className = "basket-json-modal";
    modal.innerHTML = `
      <div class="basket-json-modal-content">
        <h3>Export which folders?</h3>
        <p style="font-size:0.85rem;color:#666;">
          Only the selected folders are matched against the catalogue
          and written to the CSV.
        </p>
        <div style="margin:12px 0;max-height:50vh;overflow-y:auto;">
          ${entries.map(([name, n]) => `
            <label style="display:flex;align-items:center;gap:8px;padding:10px;background:#f9f9f9;border-radius:4px;margin-bottom:6px;cursor:pointer;">
              <input type="checkbox" class="folder-export-cb" value="${name.replace(/"/g, '&quot;')}" checked
                     style="width:auto;margin:0;flex:0 0 auto;">
              <span style="font-size:0.9rem;flex:1;">${name}</span>
              <span style="font-size:0.8rem;color:#888;">${n}</span>
            </label>
          `).join("")}
        </div>
        <div style="margin-bottom:10px;">
          <button id="folderExportAllBtn" class="modal-btn" style="font-size:0.8rem;padding:6px 10px;">Select all</button>
          <button id="folderExportNoneBtn" class="modal-btn" style="font-size:0.8rem;padding:6px 10px;">Select none</button>
        </div>
        <div class="file-operation-buttons">
          <button id="folderExportConfirmBtn" class="modal-btn modal-btn-primary">Export</button>
          <button id="folderExportCancelBtn" class="modal-btn modal-btn-cancel">Cancel</button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    const boxes = () => [...modal.querySelectorAll(".folder-export-cb")];
    const finish = (value) => { modal.remove(); resolve(value); };

    modal.querySelector("#folderExportAllBtn").addEventListener("click", () => {
      boxes().forEach(b => { b.checked = true; });
    });
    modal.querySelector("#folderExportNoneBtn").addEventListener("click", () => {
      boxes().forEach(b => { b.checked = false; });
    });
    modal.querySelector("#folderExportCancelBtn").addEventListener("click", () => finish(null));
    modal.addEventListener("click", (e) => { if (e.target === modal) finish(null); });

    modal.querySelector("#folderExportConfirmBtn").addEventListener("click", () => {
      const chosen = boxes().filter(b => b.checked).map(b => b.value);
      if (!chosen.length) {
        alert("Select at least one folder.");
        return;
      }
      finish(chosen);
    });
  });
}
window.chooseFoldersForExport = chooseFoldersForExport;

/**
* Export local videos as a CSV in the v2 schema (30 columns + no_match),
* ready for Picker's Import CSV.
*
* Field sources:
*   intrinsics  -> the local file (authoritative)
*   filename    -> the local file (a native rename is a real rename)
*   onedrive    -> the catalogue, via the tiered matcher
*   behaviour   -> videoMeta
*   app metadata-> videoMeta
*
* Rows with no catalogue match are exported with a blank oneDriveId and a
* no_match reason. Picker skips those on import - they were never uploaded
* to OneDrive, so there's nothing to reconcile them against.
*/
async function exportVideosToCsv(selectedFolders = null) {
  // VIDEO_SCHEMA is defined at the top of this file. A top-level `const` isn't
  // a window property, so use the explicit export rather than the bare name.
  const SCHEMA = window.VIDEO_SCHEMA;
  if (!Array.isArray(SCHEMA)) {
    throw new Error("VIDEO_SCHEMA not available - it should be defined at the top of db.js");
  }

  let videos = await getAllVideos();

  if (Array.isArray(selectedFolders)) {
    const registered = (typeof getLocalFolders === "function" ? getLocalFolders() : [])
      .map(f => f.name);
    const wanted = new Set(selectedFolders);
    const before = videos.length;
    videos = videos.filter(v => {
      const key = registered.includes(v.accountName) ? v.accountName : "(unassigned)";
      return wanted.has(key);
    });
    console.log(`Folder filter: ${videos.length}/${before} videos in [${selectedFolders.join(", ")}]`);
  }

  // ---- Catalogue ----
  let catalogue = window.scrayExcelVideoRows;
  if (!catalogue) {
    try {
      const cached = localStorage.getItem("scrayExcelVideosCache");
      if (cached) catalogue = JSON.parse(cached);
    } catch (err) {
      console.warn("Could not read cached catalogue:", err);
    }
  }
  catalogue = Array.isArray(catalogue) ? catalogue : [];
  if (!catalogue.length) {
    console.warn("No catalogue loaded - every row will export unmatched. Import the Excel file first.");
  }

  const index = buildCatalogIndex(catalogue);
  const claimed = new Set();

  const renamed = [];
  const viaStats = {};
  let matchedCount = 0;

  const resolved = videos.map(v => {
    // A previously-attached catalogueId makes this a tier-1 hit
    const probe = { ...v, oneDriveId: v.catalogueId || null };
    const { row, via, reason } = matchVideoToCatalog(probe, index, claimed);

    if (row) {
      claimed.add(row);
      matchedCount++;
      viaStats[via] = (viaStats[via] || 0) + 1;
      if (row.filename && row.filename !== v.filename) {
        renamed.push({ local: v.filename, catalogue: row.filename, id: row.oneDriveId });
      }
    }
    return { v, x: row, noMatch: reason };
  });

  if (renamed.length) {
    console.warn(`${renamed.length} filename(s) differ from the catalogue:`);
    renamed.forEach(r => console.warn(`  local: "${r.local}"  |  catalogue: "${r.catalogue}"`));
  }
  const viaSummary = Object.entries(viaStats).map(([k, n]) => `${k}: ${n}`).join(", ");
  console.log(`CSV export: ${matchedCount}/${videos.length} matched (${viaSummary || "none"})`);

  window.lastCsvExportReport = {
    total: videos.length,
    matched: matchedCount,
    unmatched: videos.length - matchedCount,
    exported: videos.length,
    skipped: 0,
    renamed,
    viaStats
  };

  // ---- Rows ----
  const csvEscape = val => {
    const s = val === null || val === undefined ? "" : String(val);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const buildRow = ({ v, x, noMatch }) => {
    const rec = {
      // intrinsic - always the local file
      file_size_bytes: v.sizeBytes ?? "",
      duration_ms: v.durationMs ?? "",
      width: v.width != null ? Math.round(v.width) : "",
      height: v.height != null ? Math.round(v.height) : "",
      orientation: v.orientation ?? "",
      bitrate: v.bitrate != null ? Math.round(v.bitrate) : "",
      mime_type: v.mimeType ?? (x?.mime_type ?? ""),
      created_date: v.createdDateTime ?? "",
      last_modified_date: v.lastModifiedDateTime ?? "",
      // filename - local wins; a rename here is deliberate
      filename: v.filename ?? "",
      // onedrive - catalogue only
      oneDriveId: x?.oneDriveId ?? "",
      drive_id: x?.drive_id ?? "",
      account_key: x?.account_key ?? "",
      account_name: x?.account_name ?? "",
      path: x?.path ?? "",
      web_url: x?.web_url ?? "",
      tags: x?.tags ?? (Array.isArray(v.tags) ? v.tags.join(";") : ""),
      bracket_tags: x?.bracket_tags ?? (Array.isArray(v.bracketTags) ? v.bracketTags.join(";") : ""),
      level_1: x?.level_1 ?? "", level_2: x?.level_2 ?? "", level_3: x?.level_3 ?? "",
      level_4: x?.level_4 ?? "", level_5: x?.level_5 ?? "",
      // behaviour + app metadata - native is authoritative
      view_count: v.view_count ?? 0,
      last_played: v.last_played ?? "",
      first_seen: v.first_seen ?? "",
      user_score: v.user_score ?? "",
      notes: v.notes ?? "",
      f_tally: v.f_tally ?? 0,
      bookmarks: (v.bookmarks && v.bookmarks.length) ? JSON.stringify(v.bookmarks) : ""
    };
    return [...SCHEMA.map(c => csvEscape(rec[c])), csvEscape(noMatch || "")];
  };

  const header = [...SCHEMA, "no_match"].join(",");
  const rows = resolved.map(buildRow).map(cells => cells.join(","));
  return [header, ...rows].join("\n");
}
window.exportVideosToCsv = exportVideosToCsv;

/** Export the metadata CSV via the native "Save to Files" picker */
/**
* WKWebView no-ops alert()/confirm() unless a WKUIDelegate is set, and
* confirm() returns false - which silently aborted every export.
*/
function showExportConfirmModal(message) {
  return new Promise((resolve) => {
    const modal = document.createElement("div");
    modal.className = "basket-json-modal";
    modal.innerHTML = `
      <div class="basket-json-modal-content">
        <h3>Export CSV</h3>
        <p style="font-size:0.9rem;white-space:pre-wrap;line-height:1.4;">${message}</p>
        <div class="file-operation-buttons">
          <button id="exportProceedBtn" class="modal-btn modal-btn-primary">Save file</button>
          <button id="exportAbortBtn" class="modal-btn modal-btn-cancel">Cancel</button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    const finish = (v) => { modal.remove(); resolve(v); };
    modal.querySelector("#exportProceedBtn").addEventListener("click", () => finish(true));
    modal.querySelector("#exportAbortBtn").addEventListener("click", () => finish(false));
    modal.addEventListener("click", (e) => { if (e.target === modal) finish(false); });
  });
}

let _csvExportInFlight = false;

async function downloadVideosCsv() {
  // #exportCsvBtn has more than one click listener bound - without this the
  // whole export runs twice per tap
  if (_csvExportInFlight) {
    console.log("CSV export already running - ignoring duplicate call");
    return;
  }
  _csvExportInFlight = true;
  try {
    return await _downloadVideosCsv();
  } catch (err) {
    console.error(`CSV export failed: ${err.name}: ${err.message}`);
    console.error(err.stack || err);
    alert(`Export failed: ${err.message || err}`);
  } finally {
    _csvExportInFlight = false;
  }
}

async function _downloadVideosCsv() {
  const selectedFolders = await chooseFoldersForExport();
  if (selectedFolders === null) {
    console.log("Export cancelled at folder selection");
    return;
  }

  const csvContent = await exportVideosToCsv(selectedFolders);

  const slug = selectedFolders.length === 1
    ? "_" + selectedFolders[0].replace(/[^a-z0-9]+/gi, "-").toLowerCase()
    : "";
  const filename = `scray_videos${slug}_${new Date().toISOString().slice(0, 10)}.csv`;

  const report = window.lastCsvExportReport;
  if (report) {
    if (!report.exported) {
      alert(`Nothing to export - none of the ${report.total} videos matched a Scray Data Excel row.\n\nImport the Excel file first, or check the console for match diagnostics.`);
      return;
    }
    let msg = `Exporting all ${report.exported} video(s).\n${report.matched} matched to Scray Data Excel`;
    if (report.unmatched) msg += `, ${report.unmatched} unmatched (see the no_match column)`;
    if (report.renamed.length) {
      msg += `\n\n⚠️ ${report.renamed.length} filename(s) differ from Excel. ` +
             `The local name was kept - see console for the list. ` +
             `These rows still carry their Excel id, so Picker will match them by id.`;
    }
    if (report.collisions?.length) {
      msg += `\n\n⚠️ ${report.collisions.length} file(s) matched an Excel row already ` +
             `claimed by another local file (usually "... 2.mp4" duplicates). ` +
             `These export with a blank id and will be added as new rows in Picker.`;
    }
    if (report.skipped || report.renamed.length || report.collisions?.length) {
      const proceed = await showExportConfirmModal(msg);
      if (!proceed) {
        console.log("Export cancelled by user");
        return;
      }
    }
  }

  if (window.ScrayBridge && typeof window.ScrayBridge.exportCsv === "function") {
    const result = await ScrayBridge.exportCsv(csvContent, filename);
    if (!result || result.success !== true) {
      if (!result || !result.cancelled) {
        console.error("CSV export failed or was not saved:", result);
        alert("CSV export failed - see console.");
      }
    }
    return;
  }

  // Fallback for non-native contexts (e.g. testing in a regular browser)
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
window.downloadVideosCsv = downloadVideosCsv;

window.generateTagsFromFilename = generateTagsFromFilename;

async function ingestYetToUploadCSV(file) {
let filenames = [];

const ext = file.name.split(".").pop().toLowerCase();
if (ext === "xlsx") {
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data, { type: "array" });
    const firstSheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[firstSheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    filenames = rows
        .map(row => {
            let cell = row && row.length > 0 ? String(row[0]).trim() : "";
            cell = cell.replace(/,+$/, "");
            return cell;
        })
        .filter(Boolean);
    console.log(`Read ${filenames.length} filenames from XLSX`);
} else {
    const text = await file.text();
    filenames = text
        .split(/\r?\n/)
        .map(l => l.trim().replace(/,+$/, ""))
        .filter(Boolean);
    console.log(`Read ${filenames.length} filenames from CSV`);
}

if (!filenames.length) {
    alert("File contained no filenames");
    return;
}

const db = await openDB();
const tx = db.transaction(STORE_NAME, "readwrite");
const store = tx.objectStore(STORE_NAME);

const all = await new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
});
const toDelete = all.filter(v => v.path === "yet-to-upload");
toDelete.forEach(v => store.delete(v.oneDriveId));
console.log(`Deleted ${toDelete.length} existing yet-to-upload entries`);

filenames.forEach((filename, idx) => {
    const vidId = `manual-${Date.now()}-${idx}`;
    store.put({
        oneDriveId: vidId,
        driveId: null,
        accountKey: null,
        accountName: "local",
        path: "yet-to-upload",
        webUrl: null,
        filename: filename,
        downloadUrl: null,
        sizeBytes: null,
        durationMs: null,
        createdDateTime: null,
        lastModifiedDateTime: null,
        mimeType: null,
        width: null,
        height: null,
        orientation: null,
        tags: ["yet-to-upload"],
        level_1: "yet-to-upload",
        level_2: null,
        level_3: null,
        level_4: null,
        level_5: null
    });
});

await tx.complete;

console.log(`Inserted ${filenames.length} cleaned yet-to-upload entries`);
alert(`Ingested ${filenames.length} cleaned placeholder videos`);

if (typeof populateTagDropdowns === "function") {
    await populateTagDropdowns();
}
}

window.ingestYetToUploadCSV = ingestYetToUploadCSV;

/**
 * Apply one pulled server row into the local mirror.
 *
 * Passing updatedBy "sync" is load-bearing: saveVideoMeta skips the enqueue
 * for that value, which is what stops a pulled change bouncing back up.
 */
async function scrayApplyPulledRow(appRow, rawRow, bookmarksByKey = null) {
  const key = rawRow.video_key;
  if (!key) return;

  // Rows are addressed by video_key now, but videoSource is keyed by the local
  // id, so resolve through the videoKey index first.
  const db = await openDB();
  const id = await findLocalIdByKey(db, key);
  // Not in this device's library — ignore the row ENTIRELY. Previously the
  // meta branch below was unguarded, so saveVideoMeta created a videoMeta row
  // for every catalogue entry: thousands of invisible orphans.
  if (!id) return;

  if (rawRow.deleted) {
    const tx = db.transaction([STORE_NAME, META_STORE_NAME], "readwrite");
    tx.objectStore(STORE_NAME).delete(id);
    tx.objectStore(META_STORE_NAME).delete(id);
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
    return;
  }

  const existing = await new Promise((res, rej) => {
    const r = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(id);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  if (!existing) return;

  // isLocalVideo() routes playback on driveId/accountKey. Those are NOT
  // META_FIELDS, so they used to land in sourcePatch and get overwritten with
  // the OneDrive account's values — after which the player stopped treating
  // the file as local and hung on the load screen.
  //
  // The device is authoritative about the physical file in every respect:
  // where it is, how to play it, how big it is. The server contributes
  // metadata only. So a local row takes no sourcePatch at all.
  const isLocal = typeof window.isLocalVideo === "function"
    ? window.isLocalVideo(existing)
    : (existing.driveId === "local" || (existing.accountKey || "").startsWith("local::"));

  const metaPatch = {};
  const sourcePatch = {};
  for (const [k, v] of Object.entries(appRow)) {
    if (k === "oneDriveId" || k === "videoKey" || k.startsWith("_")) continue;
    if (META_FIELDS.has(k)) { metaPatch[k] = v; continue; }
    if (isLocal) continue;                      // device wins, full stop
    // Non-local rows still keep their own intrinsics and routing fields.
    if (["filename", "sizeBytes", "durationMs", "width", "height", "bitrate", "path",
         "driveId", "accountKey", "accountName", "webUrl", "downloadUrl"].includes(k)) continue;
    sourcePatch[k] = v;
  }

  if (bookmarksByKey?.has(key)) metaPatch.bookmarks = bookmarksByKey.get(key);

  // Always stamp the join key and the flag, even when nothing else changes.
  {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put({ ...existing, ...sourcePatch, oneDriveId: id, videoKey: key, inCatalogue: true });
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  }

  if (Object.keys(metaPatch).length) {
    await saveVideoMeta(id, metaPatch, "sync");
  }
}

/** videoSource is keyed by local id, so look rows up through the videoKey index. */
async function findLocalIdByKey(db, key) {
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const idx = tx.objectStore(STORE_NAME).index("videoKey");
    const req = idx.get(key);
    req.onsuccess = () => resolve(req.result?.oneDriveId || null);
    req.onerror   = () => resolve(null);
  });
}
window.findLocalIdByKey = findLocalIdByKey;

/**
 * Pull one video's metadata straight from SQLite, bypassing the delta cursor.
 *
 * The cursor exists so routine syncs stay cheap; this is the "I know it
 * changed elsewhere, fetch it now" path, so it ignores the cursor entirely.
 */
async function refreshVideoFromDb(video, { silent = false } = {}) {
  const key = video.videoKey || window.scrayVideoKey(video.filename);
  if (!key) throw new Error("no video_key for this file");

  let [row, bm] = await Promise.all([
    window.scrayApiCall("get", { params: { id: key } }),
    window.scrayApiCall("bookmarks_get", { params: { id: key } }),
  ]);

  // Key gone usually means the file was renamed on the OneDrive side, so the
  // row moved out from under this device's filename. Same size-anchored
  // lookup the sync uses - adopt the catalogue's key rather than failing and
  // making the user wait for a full sync to notice.
  if (!row.video && video.sizeBytes) {
    const fp = await window.scrayApiCall("fingerprint_lookup", {
      method: "POST",
      body: { size: video.sizeBytes, duration_ms: video.durationMs, width: video.width, height: video.height }
    }).catch(() => null);
    // A single size match is already unambiguous — duration/dimensions get no
    // veto. The catalogue's duration_ms is wrong often enough that requiring
    // it rejected 29% of otherwise-clean unique matches.
    const all = fp?.candidates || [];
    const hits = all.length === 1 ? all : all.filter(c => c.corroborated);
    if (hits.length === 1) {
      const adopted = hits[0].video_key;
      console.log(`↻ "${video.filename}" renamed upstream — adopting "${adopted}"`);
      [row, bm] = await Promise.all([
        window.scrayApiCall("get", { params: { id: adopted } }),
        window.scrayApiCall("bookmarks_get", { params: { id: adopted } }),
      ]);
      await saveVideoMeta(video.oneDriveId, { videoKey: adopted, inCatalogue: true }, "sync");
      video.videoKey = adopted;
    }
  }

  if (!row.video) throw new Error(`"${video.filename}" is not in the catalogue`);

  const patch = {
    user_score: row.video.user_score,
    view_count: row.video.view_count,
    f_tally: row.video.f_tally,
    notes: row.video.notes,
    last_played: row.video.last_played,
    bookmarks: (bm.bookmarks || []).map(b => ({ time: b.time_ms / 1000, note: b.note || "" })),
  };

  // "sync" so saveVideoMeta doesn't enqueue this straight back to the server.
  await saveVideoMeta(video.oneDriveId, patch, "sync");
  Object.assign(video, patch);
  video.userScore = patch.user_score;      // basket/history shape

  // The player draws markers from currentPlayingVideo, which is a separate
  // object reference — patch it or the markers stay stale until reload.
  if (window.currentPlayingVideo?.oneDriveId === video.oneDriveId) {
    window.currentPlayingVideo.bookmarks = patch.bookmarks;
    window.currentPlayingVideo.user_score = patch.user_score;
    if (typeof window.renderBookmarkMarkers === 'function') window.renderBookmarkMarkers();
  }

  if (typeof window.loadCachesFromMeta === "function") await window.loadCachesFromMeta(true);
  console.log(`↻ ${video.filename}: score ${patch.user_score}, ${patch.bookmarks.length} bookmark(s)`);

  // The confirmation lives HERE, not at the call sites. This is the single
  // read path, so every menu that pulls from the DB gets feedback for free
  // and a new menu can't ship without it. Compound flows (rename, move) pass
  // { silent: true } so they don't fire a toast mid-sequence.
  if (!silent && typeof window.showSyncConfirmation === 'function') {
    const n = patch.bookmarks.length;
    window.showSyncConfirmation(
      // Score first and on its own line — it's the thing being confirmed.
      // The filename is context, so it goes smaller and truncates.
      `↻ Score: ${patch.user_score ?? '—'}${n ? ` · ${n} bookmark${n === 1 ? '' : 's'}` : ''}` +
      `<br><span style="font-size:0.6em;opacity:0.85;display:block;` +
      `overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${video.filename}</span>`,
      "#17a2b8"
    );
  }
  return video;
}
window.refreshVideoFromDb = refreshVideoFromDb;

// Top bookmark notes, for the quick-add pills in the bookmark modal.
// The excel-sheets.js copy is both unloaded in Native AND still the old
// implementation (download the whole catalogue, tally notes in JS, requires
// an Excel token). This is the same one indexed GROUP BY that Picker now
// uses - no Microsoft auth anywhere in the path.
let cachedTopBookmarkNotesDb = null;

window.getTopBookmarkNotes = async function (limit = 12, forceRefresh = false) {
  if (cachedTopBookmarkNotesDb && !forceRefresh && cachedTopBookmarkNotesDb.length >= limit) {
    return cachedTopBookmarkNotesDb.slice(0, limit);
  }
  try {
    const res = await window.scrayApiCall("top_notes", { params: { limit: Math.max(limit, 30) } });
    const sorted = (res.notes || []).map(n => n.note);
    cachedTopBookmarkNotesDb = sorted;
    console.log(`✅ Compiled ${sorted.length} top bookmark notes from the bookmarks table`);
    return sorted.slice(0, limit);
  } catch (err) {
    console.error('Failed to compute top bookmark notes:', err);
    return [];
  }
};

window.clearTopBookmarkNotesCache = function () {
  cachedTopBookmarkNotesDb = null;
};

// showSyncConfirmation lives in excel-sheets.js, which Native deliberately
// does NOT load - it's the Graph/Excel layer and drags in MSAL. Since every
// call site is guarded with `typeof === 'function'`, the toast has been
// silently doing nothing in Native all along, for basket sync as well as
// refresh. Defining it here rather than loading excel-sheets.js keeps Native
// free of the Microsoft dependency.
//
// No inline positioning: the CSS class already sets position/left/bottom/
// transform, and setting `bottom` inline would beat the mobile media queries
// that move it clear of the corner buttons.
if (typeof window.showSyncConfirmation !== 'function') {
  window.showSyncConfirmation = function (message, bgColor = '#28a745') {
    const tooltip = document.createElement('div');
    tooltip.className = 'sync-confirmation-tooltip';
    tooltip.innerHTML = message;
    tooltip.style.background = bgColor;
    document.body.appendChild(tooltip);
    setTimeout(() => tooltip.classList.add('show'), 10);
    setTimeout(() => {
      tooltip.classList.remove('show');
      setTimeout(() => tooltip.remove(), 300);
    }, 2000);
  };
}

// Same story as showSyncConfirmation above: these live in excel-sheets.js,
// which Native doesn't load, so they've been undefined here. That's why the
// portrait bookmark save shows no feedback at all, and why the FLS one - which
// uses showRotatedPlayerConfirmation from player.js instead - gets created
// with persist:true and then never closed.
if (typeof window.showBookmarkConfirmation !== 'function') {
  window.showBookmarkConfirmation = function (message, bgColor = '#28a745', persist = false) {
    const tooltip = document.createElement('div');
    tooltip.className = 'bookmark-confirmation-tooltip';
    tooltip.innerHTML = message;
    tooltip.style.background = bgColor;
    document.body.appendChild(tooltip);
    setTimeout(() => tooltip.classList.add('show'), 10);
    if (!persist) {
      setTimeout(() => {
        tooltip.classList.remove('show');
        setTimeout(() => tooltip.remove(), 300);
      }, 1300);
    }
    return tooltip;
  };
}

if (typeof window.updateBookmarkConfirmation !== 'function') {
  window.updateBookmarkConfirmation = function (tooltip, message, bgColor) {
    if (!tooltip) return;
    tooltip.innerHTML = message;
    tooltip.style.background = bgColor;
  };
}

if (typeof window.closeBookmarkConfirmation !== 'function') {
  window.closeBookmarkConfirmation = function (tooltip, delay = 1300) {
    if (!tooltip) return;
    setTimeout(() => {
      tooltip.classList.remove('show');
      setTimeout(() => tooltip.remove(), 300);
    }, delay);
  };
}

// A DB pull updates the underlying record, so EVERY visible surface showing
// that video is stale afterwards — not just the list you happened to open the
// menu in. Each surface is guarded separately so a missing renderer on one
// doesn't stop the others from updating.
window.refreshAfterDbPull = async function (video) {
  try {
    const bi = window.basketVideos?.findIndex(v => v.oneDriveId === video.oneDriveId);
    if (bi >= 0) {
      Object.assign(window.basketVideos[bi], video);
      window.saveBasket?.();
      window.renderBasket?.();
    }
  } catch (err) { console.warn('basket re-render failed:', err); }

  try {
    const hits = window.historyVideos?.filter(v => v.oneDriveId === video.oneDriveId) || [];
    if (hits.length) {
      hits.forEach(item => Object.assign(item, video));
      window.saveHistory?.();
      window.renderHistory?.();
    }
  } catch (err) { console.warn('history re-render failed:', err); }

  try {
    if (typeof window.refreshAllLists === 'function') window.refreshAllLists();
    if (typeof window.populateTagDropdowns === 'function') await window.populateTagDropdowns();
  } catch (err) { console.warn('list re-render failed:', err); }
};
window.scrayApplyPulledRow = scrayApplyPulledRow;
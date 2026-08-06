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
const DB_VERSION = 9; // bumped to 9: split into videoSource + videoMeta stores
const STORE_NAME = "videoSource";
const META_STORE_NAME = "videoMeta";

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
       fingerprint,
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

   return tx.complete;
}

/**
* Write to videoMeta only. Stamps updatedAt/updatedBy so a future
* merge-conflict UI can show provenance before overwriting anything.
*/
async function saveVideoMeta(oneDriveId, metaUpdates, updatedBy = "app") {
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

  return tx.complete;
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
* Export all merged videos to a CSV matching the Picker's Videos sheet schema
* exactly (A-M), so the result can be fed straight into Picker's Import CSV.
*
* Field sources:
*   id, path, tags        -> imported Scray Data Excel (window.scrayExcelVideoRows)
*   filename, size, bitrate -> the local file (authoritative)
*   everything else       -> videoMeta (your own data)
*
* Local files are matched to Excel rows on byte size first (exact and highly
* discriminating), falling back to filename. That ordering means a file you've
* renamed locally still finds its Excel row - and we can report the mismatch
* rather than silently exporting a broken pairing.
*/
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
          Only the selected folders are matched against the Scray Data Excel
          and written to the CSV.
        </p>
        <div style="margin:12px 0;max-height:50vh;overflow-y:auto;">
          ${entries.map(([name, n], i) => `
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

async function exportVideosToCsv(selectedFolders = null) {
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

  // ---- Build the Scray Data Excel lookup ----
  let excelRows = window.scrayExcelVideoRows;
  if (!excelRows) {
    try {
      const cached = localStorage.getItem("scrayExcelVideosCache");
      if (cached) excelRows = JSON.parse(cached);
    } catch (err) {
      console.warn("Could not read cached Scray Excel data:", err);
    }
  }
  excelRows = Array.isArray(excelRows) ? excelRows : [];

  if (!excelRows.length) {
    console.warn("No Scray Excel data loaded - id, path and tags will be blank. Import Excel first for a complete export.");
  }

  // Collapses "clip 2.mp4" -> "clip", decodes %20, drops punctuation. Catches
  // Finder-style duplicate suffixes and URL-encoded names from the catalog.
  const normalizeName = (name) => String(name || "")
    .toLowerCase()
    .replace(/%20/g, " ")
    .replace(/\.[^.]+$/, "")
    .replace(/\s+\d{1,2}$/, "")
    .replace(/[^a-z0-9]+/g, "");

  const bySize = new Map();
  const byFilename = new Map();
  const byNormalized = new Map();
  let sizedRows = 0;

  const push = (map, key, row) => {
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  };

  excelRows.forEach(row => {
    const size = Number(row.file_size_bytes);
    if (size) { sizedRows++; push(bySize, size, row); }
    push(byFilename, row.filename, row);
    push(byNormalized, normalizeName(row.filename), row);
  });

  console.log(`Excel lookup: ${excelRows.length} rows, ${sizedRows} with a usable size`);
  if (excelRows.length && sizedRows / excelRows.length < 0.5) {
    console.warn("Most Excel rows have no file_size_bytes - size matching will be weak. Check the raw_data join.");
  }

  // ✅ An Excel row can only be claimed once. Two local files must never
  // export the same id, or Picker's import collapses them into one row.
  const claimed = new Set();

  const narrow = (candidates, video) => {
    const free = candidates.filter(c => !claimed.has(c));
    if (!free.length) return null;
    if (free.length === 1) return free[0];

    const byName = free.filter(c => c.filename === video.filename);
    if (byName.length === 1) return byName[0];

    const pool = byName.length ? byName : free;
    if (video.bitrate) {
      const close = pool.filter(c =>
        c.bitrate && Math.abs(c.bitrate - video.bitrate) / Math.max(c.bitrate, video.bitrate) <= 0.02
      );
      if (close.length) return close[0];
    }
    return pool[0];
  };

  const renamed = [];
  const collisions = [];
  const stats = { size: 0, filename: 0, normalized: 0 };
  let matchedCount = 0;

  // Which local file took which Excel row, so collisions can name the culprit
  const claimedBy = new Map();

  const findExcelRow = (video) => {
    let hit = null;
    let via = null;
    const blockedBy = [];   // rows that fit but were already taken
    const triedLabels = [];

    const trySource = (candidates, label) => {
      if (!candidates || !candidates.length) return;
      triedLabels.push(label);
      if (hit) return;
      const found = narrow(candidates, video);
      if (found) {
        hit = found;
        via = label;
      } else {
        candidates.forEach(c => { if (claimed.has(c)) blockedBy.push(c); });
      }
    };

    if (video.sizeBytes) trySource(bySize.get(Number(video.sizeBytes)), "size");
    trySource(byFilename.get(video.filename), "filename");
    trySource(byNormalized.get(normalizeName(video.filename)), "normalized");

    if (hit) {
      claimed.add(hit);
      claimedBy.set(hit, video.filename);
      matchedCount++;
      stats[via]++;
      if (hit.filename && hit.filename !== video.filename) {
        renamed.push({ local: video.filename, excel: hit.filename, via });
      }
      return { row: hit, reason: "" };
    }

    // ---- Build a human-readable reason ----
    let reason;
    if (!excelRows.length) {
      reason = "no Excel data loaded";
    } else if (blockedBy.length) {
      const owner = claimedBy.get(blockedBy[0]) || "another file";
      reason = `Excel row "${blockedBy[0].filename}" already claimed by "${owner}"`;
      collisions.push(video.filename);
    } else {
      const parts = [];
      if (!video.sizeBytes) {
        parts.push("no local size");
      } else if (!bySize.has(Number(video.sizeBytes))) {
        parts.push(`size ${video.sizeBytes} not in Excel`);
      }
      if (!byFilename.has(video.filename)) parts.push("filename not in Excel");
      if (!byNormalized.has(normalizeName(video.filename))) parts.push("normalized name not in Excel");
      reason = parts.length ? parts.join("; ") : "no candidate found";
    }

    return { row: null, reason };
  };

  // Resolve once per video so each column getter isn't re-matching
  const resolved = videos.map(v => {
    const { row, reason } = findExcelRow(v);
    return { v, x: row, noMatch: reason };
  });

  if (renamed.length) {
    console.warn(`${renamed.length} filename(s) differ from Scray Data Excel:`);
    renamed.forEach(r => console.warn(`  [${r.via}] local: "${r.local}"  |  excel: "${r.excel}"`));
  }
  if (collisions.length) {
    console.warn(`${collisions.length} file(s) had only already-claimed Excel matches - exported with a blank id:`);
    collisions.forEach(f => console.warn(`  ${f}`));
  }
  console.log(
    `CSV export: ${matchedCount}/${videos.length} matched ` +
    `(size: ${stats.size}, filename: ${stats.filename}, normalized: ${stats.normalized})`
  );

  window.lastCsvExportReport = {
    total: videos.length,
    matched: matchedCount,
    unmatched: videos.length - matchedCount,
    renamed,
    collisions,
    stats
  };

  // ---- Videos sheet schema, columns A-M, in order ----
  const columns = [
    ["id", (v, x) => x?.id ?? ""],
    ["filename", (v) => v.filename],                       // local file wins
    ["file_size_bytes", (v) => v.sizeBytes ?? ""],
    ["bitrate", (v) => v.bitrate != null ? Math.round(v.bitrate) : ""],
    ["path", (v, x) => x?.path ?? ""],
    ["view_count", (v) => v.view_count ?? 0],
    ["user_score", (v) => v.user_score ?? ""],
    ["notes", (v) => v.notes ?? ""],
    ["last_played", (v) => v.last_played ?? ""],
    ["first_seen", (v) => v.first_seen ?? ""],
    ["tags", (v, x) => {
        if (x?.tags) return x.tags;
        return Array.isArray(v.tags) ? v.tags.join(";") : "";
    }],
    ["f_tally", (v) => v.f_tally ?? 0],
    ["bookmarks", (v) => (v.bookmarks && v.bookmarks.length) ? JSON.stringify(v.bookmarks) : ""],
    // ✅ Column N - blank when matched, otherwise why it didn't
    ["no_match", (v, x, noMatch) => noMatch || ""]
  ];

  const csvEscape = val => {
    const s = val === null || val === undefined ? "" : String(val);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  // ✅ Every row exports, matched or not. The no_match column carries the
  // diagnosis so the misses can be worked through in a spreadsheet.
  window.lastCsvExportReport.exported = resolved.length;
  window.lastCsvExportReport.skipped = 0;

  const reasonCounts = new Map();
  resolved.forEach(({ noMatch }) => {
    if (!noMatch) return;
    // Group by shape, not by the specific filename in the message
    const bucket = noMatch.startsWith("Excel row") ? "already claimed" : noMatch;
    reasonCounts.set(bucket, (reasonCounts.get(bucket) || 0) + 1);
  });
  if (reasonCounts.size) {
    console.log("Unmatched reasons:");
    [...reasonCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .forEach(([reason, n]) => console.log(`  ${n}x  ${reason}`));
  }

  const header = columns.map(([name]) => name).join(",");
  const rows = resolved.map(({ v, x, noMatch }) =>
    columns.map(([, getter]) => csvEscape(getter(v, x, noMatch))).join(",")
  );
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
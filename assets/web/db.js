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
       orientation: video.orientation ?? null,
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

/** Export all merged videos to a CSV string, mirroring your Excel db's column names */
async function exportVideosToCsv() {
  const videos = await getAllVideos();
  const columns = [
    ["filename", v => v.filename],
    ["file_size_bytes", v => v.sizeBytes],
    ["bitrate", v => v.bitrate],
    ["width", v => v.width],
    ["height", v => v.height],
    ["duration_ms", v => v.durationMs],
    ["path", v => v.path],
    ["fingerprint", v => v.fingerprint],
    ["view_count", v => v.view_count],
    ["user_score", v => v.user_score],
    ["notes", v => v.notes],
    ["last_played", v => v.last_played],
    ["first_seen", v => v.first_seen],
    ["tags", v => Array.isArray(v.tags) ? v.tags.join(";") : ""],
    ["f_tally", v => v.f_tally],
    ["bookmarks", v => JSON.stringify(v.bookmarks || [])]
  ];

  const csvEscape = val => {
    const s = val === null || val === undefined ? "" : String(val);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const header = columns.map(([name]) => name).join(",");
  const rows = videos.map(v => columns.map(([, getter]) => csvEscape(getter(v))).join(","));
  return [header, ...rows].join("\n");
}
window.exportVideosToCsv = exportVideosToCsv;

/** Export the metadata CSV via the native "Save to Files" picker */
async function downloadVideosCsv() {
  const csvContent = await exportVideosToCsv();
  const filename = `scray_video_metadata_${new Date().toISOString().slice(0, 10)}.csv`;

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
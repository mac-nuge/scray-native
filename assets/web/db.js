/**
* IndexedDB setup for Scray Picker
* Uses `oneDriveId` as primary key to avoid duplicates if files are renamed/moved in OneDrive
*/
const DB_NAME = "scray_picker";
const DB_VERSION = 8; // bumped to 8 to add bitrate field
const STORE_NAME = "videos";

/**
* Open IndexedDB connection
* - On upgrade, recreate store with oneDriveId as keyPath
*/
function openDB() {
   return new Promise((resolve, reject) => {
       const request = indexedDB.open(DB_NAME, DB_VERSION);

       request.onupgradeneeded = (event) => {
           const db = event.target.result;
           // Remove old store if exists
           if (db.objectStoreNames.contains(STORE_NAME)) db.deleteObjectStore(STORE_NAME);

// ✅ oneDriveId is the stable Graph item ID, so use as key
       const store = db.createObjectStore(STORE_NAME, { keyPath: "oneDriveId" });
      store.createIndex("path", "path");
      store.createIndex("filename", "filename");
      store.createIndex("webUrl", "webUrl");
      store.createIndex("accountKey", "accountKey");
      store.createIndex("tags", "tags", { multiEntry: true });
      // Add indexes for new fields
      store.createIndex("mimeType", "mimeType");
      store.createIndex("orientation", "orientation");
      store.createIndex("createdDateTime", "createdDateTime");
      store.createIndex("lastModifiedDateTime", "lastModifiedDateTime");
      store.createIndex("bitrate", "bitrate");
      // We don't need indexes for level_x unless you want to filter on them in IndexedDB queries
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
* Spaces in tags are converted to hyphens
*/
function generateTagsFromFilename(filename) {
  if (!filename) return [];
  
  const bracketRegex = /\[([^\]]+)\]/g;
  const tags = [];
  let match;
  
  while ((match = bracketRegex.exec(filename)) !== null) {
      const tag = match[1].trim().replace(/\s+/g, "-").toLowerCase();
      if (tag.length > 0) {
          tags.push(tag);
      }
  }
  
  return tags;
}

/**
* Extract tags from square brackets in filename
* Example: "video[tag1][tag2].mp4" → ["tag1", "tag2"]
* Spaces in tags are converted to hyphens
*/
function generateTagsFromFilename(filename) {
  if (!filename) return [];
  
  const bracketRegex = /\[([^\]]+)\]/g;
  const tags = [];
  let match;
  
  while ((match = bracketRegex.exec(filename)) !== null) {
      const tag = match[1].trim().replace(/\s+/g, "-").toLowerCase();
      if (tag.length > 0) {
          tags.push(tag);
      }
  }
  
  return tags;
}

/**
* Extract folder levels from path into separate fields level_1...level_5
* - level_1..level_4 = respective folder names
* - level_5 = fifth folder and all deeper folders joined with "_"
*/
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
           const merged = folders.slice(idx).join("_");
           levels[`level_${levelNum}`] = merged;
       }
   });

   return levels;
}

/**
* Save videos into IndexedDB with tags + level_x fields
* @param {Array} videos - list of video objects from Graph API
* @param {string} username - OneDrive account username
* @param {string} accountId - MSAL homeAccountId
* @param {string} driveId - OneDrive drive ID
*/
async function saveVideos(videos, username, accountId, driveId) {
   const db = await openDB();
   const tx = db.transaction(STORE_NAME, "readwrite");
   const store = tx.objectStore(STORE_NAME);

   videos.forEach(video => {
       // Extract or heal IDs from video or webUrl
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

// Prepare tags + level_x fields
    const pathTags = generateTagsFromPath(video.path);
    const filenameBracketTags = generateTagsFromFilename(video.name || video.filename);
    const tagsArray = [...new Set([...pathTags, ...filenameBracketTags])]; // Merge and deduplicate (path tags have priority)
    const levelFields = generateLevelFieldsFromPath(video.path);
    
    // ✅ Store bracket tags as level_5 (join multiple bracket tags with semicolon)
    // If level_5 already has folder data, append bracket tags; otherwise just use bracket tags
    if (filenameBracketTags.length > 0) {
        if (levelFields.level_5) {
            // Append to existing level_5 folder data
            levelFields.level_5 = levelFields.level_5 + ';' + filenameBracketTags.join(';');
        } else {
            // No level_5 folder data, just use bracket tags
            levelFields.level_5 = filenameBracketTags.join(';');
        }
    }
    
// Store full record
store.put({
   oneDriveId: vidId,
   driveId: drvId,
   accountKey: `${accountId}::${drvId}`,
   accountName: username,
   path: video.path,
   webUrl: video.webUrl,
   filename: video.name || video.filename,
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
   bracketTags: filenameBracketTags, // Also store as separate array for easy access
   bookmarks: video.bookmarks || [], 
   ...levelFields // merges level_1..level_5 into separate fields (now includes level_4 bracket tags)
});
   });

   return tx.complete;
}

/** Get all saved videos */
async function getAllVideos() {
   const db = await openDB();
   return new Promise((resolve, reject) => {
       const tx = db.transaction(STORE_NAME, "readonly");
       const store = tx.objectStore(STORE_NAME);
       const request = store.getAll();
       request.onsuccess = () => resolve(request.result || []);
       request.onerror = () => reject(request.error);
   });
}

/** Get all unique tags from saved videos */
async function getAllTags() {
   const videos = await getAllVideos();
   const tagsSet = new Set();
   videos.forEach(rec => Array.isArray(rec.tags) && rec.tags.forEach(t => tagsSet.add(t)));
   return Array.from(tagsSet).sort();
}

/** Clear the videos store */
async function clearVideos() {
   const db = await openDB();
   const tx = db.transaction(STORE_NAME, "readwrite");
   tx.objectStore(STORE_NAME).clear();
   return tx.complete;
}

// Expose globally
window.getAllVideos = getAllVideos;
window.getAllTags = getAllTags;
window.saveVideos = saveVideos; // ✅ points to the correct version
window.clearVideos = clearVideos;
window.generateTagsFromFilename = generateTagsFromFilename; // ✅ Export for use in basket refresh and UI

async function ingestYetToUploadCSV(file) {
let filenames = [];

const ext = file.name.split(".").pop().toLowerCase();
if (ext === "xlsx") {
    // Read XLSX via SheetJS
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data, { type: "array" });

    const firstSheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[firstSheetName];

    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

    // Clean first cell of each row
    filenames = rows
        .map(row => {
            let cell = row && row.length > 0 ? String(row[0]).trim() : "";
            cell = cell.replace(/,+$/, ""); // 🚀 remove trailing commas
            return cell;
        })
        .filter(Boolean);

    console.log(`Read ${filenames.length} filenames from XLSX`);
} else {
    // CSV fallback
    const text = await file.text();
    filenames = text
        .split(/\r?\n/)
        .map(l => l.trim().replace(/,+$/, "")) // 🚀 remove trailing commas
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

// Delete old yet-to-upload entries
const all = await new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
});
const toDelete = all.filter(v => v.path === "yet-to-upload");
toDelete.forEach(v => store.delete(v.oneDriveId));
console.log(`Deleted ${toDelete.length} existing yet-to-upload entries`);

// Insert new cleaned entries
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
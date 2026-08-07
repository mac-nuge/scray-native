// ===== excel-online.js =====

// Excel workbook ID from OneDrive (replace with your workbook ID)
const EXCEL_WORKBOOK_ID = "FC889D210229F431!sd3d6f40d45714290bbfeebba760f157c";

const SHEETS = {
BASKETS: "Baskets",
VIDEOS: "Videos",
EXCLUDE: "Exclude",
CURRENT: "Current Basket",
RAW: "raw_data"
};

// =========================================
// UNIFIED VIDEO SCHEMA (v2) - 30 columns, A..AD
// Videos and raw_data share this exact shape. Videos holds rows carrying user
// metadata; raw_data holds the full catalogue. Same columns in both means one
// parser, and the union of the two is the real catalogue.
// Grouped: intrinsic | filename | onedrive | behaviour | app metadata
// =========================================
const VIDEO_SCHEMA = [
   // filename (mutable, but it's what you actually read when scanning the sheet)
   "filename",
   // intrinsic (never changes for a given encode)
   "file_size_bytes", "duration_ms", "width", "height", "orientation",
   "bitrate", "mime_type", "created_date", "last_modified_date",
   // onedrive
   "oneDriveId", "drive_id", "account_key", "account_name", "path", "web_url",
   "tags", "bracket_tags", "level_1", "level_2", "level_3", "level_4", "level_5",
   // user behaviour
   "view_count", "last_played", "first_seen",
   // app-added metadata
   "user_score", "notes", "f_tally", "bookmarks"
];

// Name -> zero-based index. Never hardcode a column number again.
const COL = VIDEO_SCHEMA.reduce((acc, name, i) => { acc[name] = i; return acc; }, {});

/** 1-based column number -> letter. Handles past Z (the old fromCharCode did not). */
function colLetter(n) {
   let s = "";
   while (n > 0) {
       const r = (n - 1) % 26;
       s = String.fromCharCode(65 + r) + s;
       n = Math.floor((n - 1) / 26);
   }
   return s;
}

const VIDEO_LAST_COL = colLetter(VIDEO_SCHEMA.length);           // "AD"
const VIDEO_RANGE_ALL = `A2:${VIDEO_LAST_COL}100000`;
const VIDEO_RANGE_HEADER = `A1:${VIDEO_LAST_COL}1`;
const videoRowRange = (row) => `A${row}:${VIDEO_LAST_COL}${row}`;
const videoRowsRange = (from, to) => `A${from}:${VIDEO_LAST_COL}${to}`;

window.VIDEO_SCHEMA = VIDEO_SCHEMA;
window.COL = COL;
window.colLetter = colLetter;
window.videoRowRange = videoRowRange;

// -----------------------------------------
// Row <-> object
// -----------------------------------------
const NUMERIC_FIELDS = new Set([
   "file_size_bytes", "duration_ms", "width", "height", "bitrate",
   "view_count", "user_score", "f_tally"
]);

function toNum(v) {
   if (v === null || v === undefined || v === "") return null;
   const n = Number(v);
   return Number.isFinite(n) ? n : null;
}

/** Sheet row array -> named object. Tolerates short rows and legacy 13-col rows. */
function rowToVideo(row) {
   if (!row) return null;

   // Legacy A..M Videos rows start with oneDriveId; v2 rows start with a size.
   // A non-empty first cell that isn't numeric means we're looking at old data.
   const first = row[0];
   const looksLegacy = first !== null && first !== undefined && first !== "" &&
                       !Number.isFinite(Number(first)) && row.length <= 14;
   if (looksLegacy) {
       return {
           oneDriveId: row[0], filename: row[1],
           file_size_bytes: toNum(row[2]), bitrate: toNum(row[3]),
           path: row[4], view_count: toNum(row[5]) || 0,
           user_score: toNum(row[6]), notes: row[7] || null,
           last_played: row[8] || null, first_seen: row[9] || null,
           tags: row[10] || "", f_tally: toNum(row[11]) || 0,
           bookmarks: row[12] || "",
           _legacy: true
       };
   }

   const out = {};
   VIDEO_SCHEMA.forEach((name, i) => {
       const raw = i < row.length ? row[i] : null;
       out[name] = NUMERIC_FIELDS.has(name) ? toNum(raw) : (raw === undefined ? null : raw);
   });
   return out;
}

/** Named object -> sheet row array of exactly VIDEO_SCHEMA.length cells. */
function videoToRow(v) {
   return VIDEO_SCHEMA.map(name => {
       const val = v[name];
       if (val === null || val === undefined) return "";
       if (Array.isArray(val)) return val.join(";");
       return val;
   });
}

/** App-shaped video object (videoSource/Graph) -> schema-shaped object. */
function appVideoToSchema(v) {
   return {
       file_size_bytes: v.sizeBytes ?? v.file_size_bytes ?? null,
       duration_ms: v.durationMs ?? v.duration_ms ?? null,
       width: v.width ?? null,
       height: v.height ?? null,
       orientation: v.orientation ?? null,
       bitrate: v.bitrate ?? null,
       mime_type: v.mimeType ?? v.mime_type ?? null,
       created_date: v.createdDateTime ?? v.created_date ?? null,
       last_modified_date: v.lastModifiedDateTime ?? v.last_modified_date ?? null,
       filename: v.filename ?? null,
       oneDriveId: v.oneDriveId ?? null,
       drive_id: v.driveId ?? v.drive_id ?? null,
       account_key: v.accountKey ?? v.account_key ?? null,
       account_name: v.accountName ?? v.account_name ?? null,
       path: v.path ?? null,
       web_url: v.webUrl ?? v.web_url ?? null,
       tags: Array.isArray(v.tags) ? v.tags.join(";") : (v.tags ?? ""),
       bracket_tags: Array.isArray(v.bracketTags) ? v.bracketTags.join(";") : (v.bracket_tags ?? ""),
       level_1: v.level_1 ?? null, level_2: v.level_2 ?? null, level_3: v.level_3 ?? null,
       level_4: v.level_4 ?? null, level_5: v.level_5 ?? null,
       view_count: v.view_count ?? 0,
       last_played: v.last_played ?? null,
       first_seen: v.first_seen ?? null,
       user_score: v.user_score ?? null,
       notes: v.notes ?? null,
       f_tally: v.f_tally ?? 0,
       bookmarks: Array.isArray(v.bookmarks)
           ? (v.bookmarks.length ? JSON.stringify(v.bookmarks) : "")
           : (v.bookmarks ?? "")
   };
}

window.rowToVideo = rowToVideo;
window.videoToRow = videoToRow;
window.appVideoToSchema = appVideoToSchema;

// =========================================
// TIERED CATALOGUE MATCHER
// Built from measurements on a 6,522-video catalogue vs 422 local files:
//   - exact byte size resolves 236 uniquely, 12 ambiguously
//   - fuzzy size is WORSE THAN USELESS: at 0.1% tolerance it "matches" 150
//     files whose names appear nowhere in the catalogue. Never tolerance size.
//   - normalised filename added ZERO matches beyond size. Kept only as a
//     last resort for rows with no size on either side.
// =========================================

/** Build a lookup over catalogue rows (schema-shaped objects). */
function buildCatalogIndex(catalogRows) {
   const byId = new Map();
   const bySize = new Map();
   const byName = new Map();
   const push = (map, key, row) => {
       if (key === null || key === undefined || key === "") return;
       if (!map.has(key)) map.set(key, []);
       map.get(key).push(row);
   };

   catalogRows.forEach(row => {
       if (!row) return;
       if (row.oneDriveId && !byId.has(row.oneDriveId)) byId.set(row.oneDriveId, row);
       push(bySize, toNum(row.file_size_bytes), row);
       push(byName, row.filename, row);
   });

   return { byId, bySize, byName, size: catalogRows.length };
}

const within = (a, b, pct) => {
   a = toNum(a); b = toNum(b);
   if (a === null || b === null || a === 0 || b === 0) return false;
   return Math.abs(a - b) / Math.max(a, b) <= pct;
};

/**
* Score a candidate against a local video's intrinsics. Used only to break
* ties between rows that already share an exact byte size.
*/
function scoreCandidate(candidate, local) {
   let score = 0;
   if (within(candidate.duration_ms, local.durationMs ?? local.duration_ms, 0.02)) score += 3;
   if (toNum(candidate.width) && toNum(candidate.width) === Math.round(toNum(local.width) || 0) &&
       toNum(candidate.height) === Math.round(toNum(local.height) || 0)) score += 2;
   if (within(candidate.bitrate, local.bitrate, 0.02)) score += 1;
   if (candidate.filename === local.filename) score += 1;
   return score;
}

/**
* Match one local video against the catalogue.
* @returns {{row: object|null, via: string|null, reason: string}}
*/
function matchVideoToCatalog(local, index, claimed) {
   claimed = claimed || new Set();
   const free = (arr) => (arr || []).filter(r => !claimed.has(r));

   // Tier 1 - already carries an id
   if (local.oneDriveId && index.byId.has(local.oneDriveId)) {
       const row = index.byId.get(local.oneDriveId);
       if (!claimed.has(row)) return { row, via: "id", reason: "" };
   }

   // Tier 2/3 - exact byte size
   const size = toNum(local.sizeBytes ?? local.file_size_bytes);
   if (size) {
       const all = index.bySize.get(size) || [];
       const candidates = free(all);
       if (candidates.length === 1) {
           return { row: candidates[0], via: "size", reason: "" };
       }
       if (candidates.length > 1) {
           const scored = candidates
               .map(c => ({ c, s: scoreCandidate(c, local) }))
               .sort((a, b) => b.s - a.s);
           // Require a clear winner, else it's a coin flip
           if (scored[0].s > 0 && scored[0].s > (scored[1]?.s ?? -1)) {
               return { row: scored[0].c, via: "size+intrinsics", reason: "" };
           }
           return {
               row: null, via: null,
               reason: `ambiguous: ${candidates.length} catalogue rows share size ${size}`
           };
       }
       if (all.length) {
           const owner = all[0].filename || "another file";
           return {
               row: null, via: null,
               reason: `size ${size} matched "${owner}" but it was already claimed`
           };
       }
   }

   // Tier 4 - exact filename, only when size can't decide
   if (local.filename) {
       const candidates = free(index.byName.get(local.filename));
       if (candidates.length === 1 && !size) {
           return { row: candidates[0], via: "filename", reason: "" };
       }
   }

   if (!index.size) return { row: null, via: null, reason: "no catalogue loaded" };
   if (!size) return { row: null, via: null, reason: "local file has no size" };
   return { row: null, via: null, reason: "not in catalogue (never uploaded to OneDrive)" };
}

window.buildCatalogIndex = buildCatalogIndex;
window.matchVideoToCatalog = matchVideoToCatalog;

let excelAccessToken = null;

// ✅ Global score cache for fast filtering
let cachedVideoScores = null;
let cachedVideoRowNumbers = null; // Map<oneDriveId, excelRowNumber> - skip full sheet reads
let scoresLastLoaded = null;

// ✅ Global bookmark cache - mirrors the score cache so bookmarks sync
// across devices instead of only loading when a video's modal is opened
let cachedVideoBookmarks = null;
let bookmarksLastLoaded = null;

// ✅ Per-video write queue — serialises concurrent updates so two calls never
// both see "row not found" and insert duplicates
const excelWriteQueue = new Map();

function queueExcelUpdate(video, updates) {
 const id = video.oneDriveId;
 const prev = excelWriteQueue.get(id) ?? Promise.resolve();
 const next = prev
     .then(() => updateVideoInExcel(video, updates))
     .catch(err => { throw err; }); // re-throw so the caller can handle it
 // Store the settled version so a failure never permanently blocks the queue
 excelWriteQueue.set(id, next.catch(() => {}));
 return next;
}
window.queueExcelUpdate = queueExcelUpdate;

// ✅ Allow other modules to wait for any pending queued write for a video
// to finish before pulling fresh data from Excel. This prevents a slow
// in-flight write (e.g. a bookmark save) from being overwritten by a
// read that started before the write completed.
function waitForPendingExcelWrite(oneDriveId) {
 return excelWriteQueue.get(oneDriveId) ?? Promise.resolve();
}
window.waitForPendingExcelWrite = waitForPendingExcelWrite;

// =========================================
// INITIALIZATION
// =========================================

function initExcelOnlineAPI() {
// Check if we have a stored account we can reconnect with. We deliberately
// do NOT trust/reuse the old stored token here - instead, start "disconnected"
// on page load and simulate the user tapping "Refresh Authentication",
// which reliably works via the normal signInToExcelOnline() flow. This
// avoids a silent-restore path that was intermittently hanging on the
// bookmark notes preload.
const saved = localStorage.getItem('excel_online_token');
if (saved) {
    console.log("Found saved Excel session - re-authenticating via standard sign-in flow...");
    setTimeout(async () => {
        try {
            await signInToExcelOnline();
            console.log("✅ Excel Online reconnected on page load");
        } catch (err) {
            console.warn("Excel Online reconnect on page load failed:", err);
        }
    }, 1000);
}

console.log("✅ Excel Online API initialized");
}
/**
* Silently refresh Excel Online token without user interaction
*/
async function refreshExcelTokenSilently() {
 // Find the ngumac@gmail.com account in MSAL cache
 const targetAccount = msalInstance.getAllAccounts().find(acc => 
     acc.username === "ngumac@gmail.com"
 );
 
 if (!targetAccount) {
     throw new Error('Excel account not found in MSAL cache');
 }
 
 console.log("Attempting silent token refresh for Excel Online...");
 
 // Try silent refresh
 const tokenResponse = await msalInstance.acquireTokenSilent({
     account: targetAccount,
     scopes: ["Files.ReadWrite.All", "Sites.Read.All"],
     forceRefresh: true
 });
 
 excelAccessToken = tokenResponse.accessToken;
 window.excelAccessToken = excelAccessToken;
 
 // Store token with 55-minute expiry
 localStorage.setItem('excel_online_token', JSON.stringify({
     token: excelAccessToken,
     expiry: Date.now() + (55 * 60 * 1000)
 }));
 
 updateExcelConnectionStatus(true);
 console.log("✅ Excel token refreshed silently");
}

// Test Excel connection
async function testExcelConnection() {
   if (!excelAccessToken) {
       throw new Error('No Excel token available');
   }
   
   const response = await fetch(
       `https://graph.microsoft.com/v1.0/me/drive/items/${EXCEL_WORKBOOK_ID}`,
       {
           headers: {
               'Authorization': `Bearer ${excelAccessToken}`
           }
       }
   );
   
   if (!response.ok) {
       throw new Error(`HTTP ${response.status}`);
   }
   
   return response.json();
}

// Helper to ensure we have a valid token
async function ensureExcelToken() {
   if (!excelAccessToken) {
       throw new Error('NOT_CONNECTED');
   }
   
   // Check if token is expired
   const saved = localStorage.getItem('excel_online_token');
   if (saved) {
       try {
           const tokenData = JSON.parse(saved);
           if (tokenData.expiry < Date.now()) {
               console.log('Token expired, need to re-authenticate');
               throw new Error('NEEDS_REAUTH');
           }
       } catch (err) {
           console.warn('Error checking token expiry:', err);
       }
   }
}

/**
* Ensure Current Basket worksheet exists with headers
*/
async function ensureCurrentBasketSheetExists() {
if (!excelAccessToken) {
   throw new Error('No Excel access token');
}

try {
   // Check if Current Basket worksheet exists
   const checkResponse = await fetch(
       `https://graph.microsoft.com/v1.0/me/drive/items/${EXCEL_WORKBOOK_ID}/workbook/worksheets/${SHEETS.CURRENT}`,
       {
           headers: {
               'Authorization': `Bearer ${excelAccessToken}`
           }
       }
   );
   
   if (checkResponse.ok) {
       console.log('✅ Current Basket worksheet exists');
       return; // Sheet exists, we're good
   }
   
   // Sheet doesn't exist - create it
   console.log('Creating Current Basket worksheet...');
   
   const createSheetResponse = await fetch(
       `https://graph.microsoft.com/v1.0/me/drive/items/${EXCEL_WORKBOOK_ID}/workbook/worksheets`,
       {
           method: 'POST',
           headers: {
               'Authorization': `Bearer ${excelAccessToken}`,
               'Content-Type': 'application/json'
           },
           body: JSON.stringify({ name: SHEETS.CURRENT })
       }
   );
   
   if (!createSheetResponse.ok) {
       throw new Error(`Failed to create Current Basket worksheet: HTTP ${createSheetResponse.status}`);
   }
   
   console.log('✅ Created Current Basket worksheet');
   
   // Add headers to row 1
   const headers = ['basket_id', 'name', 'created_date', 'item_count', 'json_data'];
   
   await fetch(
       `https://graph.microsoft.com/v1.0/me/drive/items/${EXCEL_WORKBOOK_ID}/workbook/worksheets/${SHEETS.CURRENT}/range(address='A1:E1')`,
       {
           method: 'PATCH',
           headers: {
               'Authorization': `Bearer ${excelAccessToken}`,
               'Content-Type': 'application/json'
           },
           body: JSON.stringify({ values: [headers] })
       }
   );
   
   console.log('✅ Added headers to Current Basket worksheet');
   
} catch (err) {
   console.error('Error ensuring Current Basket sheet exists:', err);
   throw err;
}
}

/**
* Ensure Videos worksheet exists with headers (no table needed)
*/
async function ensureVideosSheetExists() {
if (!excelAccessToken) {
    throw new Error('No Excel access token');
}

try {
    // Check if Videos worksheet exists
    const checkResponse = await fetch(
        `https://graph.microsoft.com/v1.0/me/drive/items/${EXCEL_WORKBOOK_ID}/workbook/worksheets/${SHEETS.VIDEOS}`,
        {
            headers: {
                'Authorization': `Bearer ${excelAccessToken}`
            }
        }
    );
    
    if (checkResponse.ok) {
        console.log('✅ Videos worksheet exists');
        
        // ✅ Repair missing "bookmarks" header on column M (for sheets created before this column existed)
        try {
            const headerCheckResponse = await fetch(
                `https://graph.microsoft.com/v1.0/me/drive/items/${EXCEL_WORKBOOK_ID}/workbook/worksheets/${SHEETS.VIDEOS}/range(address='M1')`,
                { headers: { 'Authorization': `Bearer ${excelAccessToken}` } }
            );
            if (headerCheckResponse.ok) {
                const headerData = await headerCheckResponse.json();
                const currentHeader = headerData.values?.[0]?.[0];
                if (!currentHeader || currentHeader.toString().trim() === '') {
                    await fetch(
                        `https://graph.microsoft.com/v1.0/me/drive/items/${EXCEL_WORKBOOK_ID}/workbook/worksheets/${SHEETS.VIDEOS}/range(address='M1')`,
                        {
                            method: 'PATCH',
                            headers: {
                                'Authorization': `Bearer ${excelAccessToken}`,
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({ values: [['bookmarks']] })
                        }
                    );
                    console.log('✅ Repaired missing "bookmarks" column header');
                }
            }
        } catch (headerErr) {
            console.warn('Could not verify/repair bookmarks header:', headerErr);
        }
        
        return; // Sheet exists, we're good
    }
    
    // Sheet doesn't exist - create it
    console.log('Creating Videos worksheet...');
    
    const createSheetResponse = await fetch(
        `https://graph.microsoft.com/v1.0/me/drive/items/${EXCEL_WORKBOOK_ID}/workbook/worksheets`,
        {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${excelAccessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name: SHEETS.VIDEOS })
        }
    );
    
    if (!createSheetResponse.ok) {
        throw new Error(`Failed to create Videos worksheet: HTTP ${createSheetResponse.status}`);
    }
    
    console.log('✅ Created Videos worksheet');
    
    // Add headers to row 1
    const headers = [
        'id', 'filename', 'file_size_bytes', 'bitrate', 'path', 
        'view_count', 'user_score', 'notes', 'last_played', 
        'first_seen', 'tags', 'f_tally', 'bookmarks'
    ];
    
    await fetch(
        `https://graph.microsoft.com/v1.0/me/drive/items/${EXCEL_WORKBOOK_ID}/workbook/worksheets/${SHEETS.VIDEOS}/range(address='A1:M1')`,
        {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${excelAccessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ values: [headers] })
        }
    );
    
    console.log('✅ Added headers to Videos worksheet (no table needed)');
    
} catch (err) {
    console.error('Error ensuring Videos sheet exists:', err);
    throw err;
}
}

async function signInToExcelOnline() {
try {
   // Find the ngumac@gmail.com account in MSAL cache
   const targetAccount = msalInstance.getAllAccounts().find(acc => 
       acc.username === "ngumac@gmail.com"
   );
   
   let loginResponse;
   
   if (targetAccount) {
       // Account exists - use it directly (silent auth)
       console.log("Found ngumac@gmail.com account - using it for Excel");
       loginResponse = { account: targetAccount };
   } else {
       // Account doesn't exist - force login with hint
       console.log("ngumac@gmail.com not found - prompting login");
       
       try {
           loginResponse = await msalInstance.loginPopup({
               scopes: ["Files.ReadWrite.All", "Sites.Read.All"],
               loginHint: "ngumac@gmail.com"
           });
       } catch (popupErr) {
           // ✅ Detect popup blocker errors
           if (popupErr.errorCode === 'popup_window_error' || 
               popupErr.errorCode === 'empty_window_error' ||
               popupErr.message?.includes('popup') ||
               popupErr.message?.includes('window.open')) {
               
               console.warn('Popup blocked, offering redirect fallback');
               
               // Show modal with redirect option
               const useRedirect = await showPopupBlockedModal();
               
               if (useRedirect) {
                   // Use redirect-based authentication instead
                   await msalInstance.loginRedirect({
                       scopes: ["Files.ReadWrite.All", "Sites.Read.All"],
                       loginHint: "ngumac@gmail.com"
                   });
                   return; // loginRedirect will reload the page
               } else if (useRedirect === false) {
                   // User clicked "Try Again" - recursive call
                   return await signInToExcelOnline();
               } else {
                   // User clicked "Cancel"
                   throw new Error('Sign-in cancelled');
               }
           } else {
               // Other error - re-throw
               throw popupErr;
           }
       }
   }
   
   let tokenResponse;
   try {
       tokenResponse = await msalInstance.acquireTokenSilent({
           account: loginResponse.account,
           scopes: ["Files.ReadWrite.All", "Sites.Read.All"]
       });
   } catch (silentErr) {
       // ✅ Try popup with error handling
       try {
           tokenResponse = await msalInstance.acquireTokenPopup({
               account: loginResponse.account,
               scopes: ["Files.ReadWrite.All", "Sites.Read.All"]
           });
       } catch (popupErr) {
           // ✅ Detect popup blocker errors
           if (popupErr.errorCode === 'popup_window_error' || 
               popupErr.errorCode === 'empty_window_error' ||
               popupErr.message?.includes('popup') ||
               popupErr.message?.includes('window.open')) {
               
               console.warn('Popup blocked during token acquisition, offering redirect fallback');
               
               const useRedirect = await showPopupBlockedModal();
               
               if (useRedirect) {
                   await msalInstance.acquireTokenRedirect({
                       account: loginResponse.account,
                       scopes: ["Files.ReadWrite.All", "Sites.Read.All"]
                   });
                   return; // Redirect will reload the page
               } else if (useRedirect === false) {
                   // User clicked "Try Again" - recursive call
                   return await signInToExcelOnline();
               } else {
                   // User clicked "Cancel"
                   throw new Error('Sign-in cancelled');
               }
           } else {
               throw popupErr;
           }
       }
   }
       
       excelAccessToken = tokenResponse.accessToken;
       window.excelAccessToken = excelAccessToken;
       
       // Store token with 55-minute expiry
       localStorage.setItem('excel_online_token', JSON.stringify({
           token: excelAccessToken,
           expiry: Date.now() + (55 * 60 * 1000)
       }));
       
       // Load default exclude tags
      await loadDefaultExcludeTags();
      
      // ✅ Ensure Videos sheet exists
     try {
         await ensureVideosSheetExists();
     } catch (sheetErr) {
         console.warn('Could not verify Videos sheet:', sheetErr);
     }
     
     // ✅ Ensure Current Basket sheet exists
     try {
         await ensureCurrentBasketSheetExists();
     } catch (sheetErr) {
         console.warn('Could not verify Current Basket sheet:', sheetErr);
     }
      
      // Update button/pill immediately - will show "Connecting..." until
      // the bookmark notes preload finishes, then flip to full green
      updateExcelConnectionStatus(true);
       
       console.log("✅Signed in to Excel Online");
  
  // ✅Pre-load top bookmark notes immediately alongside scores
  preloadExcelBookmarkNotes();
  
  // ✅Pre-load view counts for weighted random selection
  getCachedViewCounts(true).catch(err => {
      console.warn('Could not pre-load view counts:', err);
  });
  
  // Pre-load scores immediately for fast filtering
getCachedVideoScores(true).then(() => {
    console.log('Score cache ready for instant filtering');
    
    // Re-render all lists to show loaded scores
    if (typeof window.refreshAllLists === 'function') {
        window.refreshAllLists();
    }
    
    // Also refresh basket and history if they have items
    if (window.basketVideos && window.basketVideos.length > 0 && typeof window.renderBasket === 'function') {
        window.renderBasket();
    }
    
    if (window.historyVideos && window.historyVideos.length > 0 && typeof window.renderHistory === 'function') {
        window.renderHistory();
    }
}).catch(err => {
    console.warn('Could not pre-load scores:', err);
});

// ✅ Pre-load bookmarks immediately so they sync across devices the
// same way scores do, instead of only loading when a video's
// Bookmarks modal is opened
getCachedVideoBookmarks(true).then((bookmarkMap) => {
    console.log('Bookmark cache ready - synced across devices');

    // ✅ Basket/history items are localStorage snapshots, not IndexedDB
    // records - the sync above never touches them on its own, so patch
    // them here or they'll keep showing stale/missing bookmarks forever
    if (window.basketVideos && window.basketVideos.length > 0) {
        window.basketVideos.forEach(v => {
            const fresh = bookmarkMap.get(v.oneDriveId);
            if (fresh) v.bookmarks = fresh;
        });
        if (typeof window.saveBasket === 'function') window.saveBasket();
    }

    if (window.historyVideos && window.historyVideos.length > 0) {
        window.historyVideos.forEach(v => {
            const fresh = bookmarkMap.get(v.oneDriveId);
            if (fresh) v.bookmarks = fresh;
        });
        if (typeof window.saveHistory === 'function') window.saveHistory();
    }

    // If a video is already playing, refresh its bookmarks + markers
    if (window.currentPlayingVideo) {
        const freshBookmarks = bookmarkMap.get(window.currentPlayingVideo.oneDriveId);
        if (freshBookmarks) {
            window.currentPlayingVideo.bookmarks = freshBookmarks;
        }
        if (typeof window.renderBookmarkMarkers === 'function') {
            window.renderBookmarkMarkers();
        }
    }
}).catch(err => {
    console.warn('Could not pre-load bookmarks:', err);
});
 
 // ✅ Auto-load DISABLED - user must manually pull basket
   
} catch (err) {
   console.error("Excel Online sign-in failed:", err);
      alert(`Sign-in failed: ${err.message || 'Unknown error'}`);
  }
}

function signOutFromExcelOnline() {
excelAccessToken = null;
window.excelAccessToken = null;
localStorage.removeItem('excel_online_token');
clearScoreCache(); // ✅Clear cache on sign-out
clearBookmarkCache(); // ✅Clear bookmark cache on sign-out
excelNotesReady = false; // ✅Require a fresh notes preload on next connect
updateExcelConnectionStatus(false);
console.log("Signed out from Excel Online");
}

function isAutoTrackEnabled() {
   // Default to enabled unless the user has explicitly turned it off
   return localStorage.getItem('auto_track_videos') !== '0';
}
window.isAutoTrackEnabled = isAutoTrackEnabled;

// ✅Tracks whether getTopBookmarkNotes has finished for the current
// connection - the button/pill only show fully "connected" once this
// is true, so they never claim success before the notes are ready.
let excelNotesReady = false;

function isExcelBookmarkNotesReady() {
   return excelNotesReady;
}
window.isExcelBookmarkNotesReady = isExcelBookmarkNotesReady;

/**
* Race a promise against a timeout - resolves/rejects with whichever
* finishes first. Used so a hung Graph API call can never permanently
* stick the Excel button/pill on "Connecting...".
*/
function withTimeout(promise, ms, label) {
   return new Promise((resolve, reject) => {
       const timer = setTimeout(() => {
           reject(new Error(`${label} timed out after ${ms}ms`));
       }, ms);
       promise.then(
           (val) => { clearTimeout(timer); resolve(val); },
           (err) => { clearTimeout(timer); reject(err); }
       );
   });
}

/**
* Preload top bookmark notes and flip the connection UI to "connecting"
* while it runs, then to fully connected once it resolves (success or
* failure - we don't want a failed notes fetch to leave the UI stuck).
* Guarded with a timeout + single retry so a hung/slow Graph API call
* on page load can never leave the button/pill stuck on "Connecting...".
*/
async function preloadExcelBookmarkNotes(isRetry = false) {
   excelNotesReady = false;
   if (typeof window.updateExcelConnectionStatus === 'function') {
       window.updateExcelConnectionStatus(!!window.excelAccessToken);
   }
   console.log(`📊 Preloading bookmark notes${isRetry ? ' (retry)' : ''}...`);

   let succeeded = false;
   try {
       const notes = await withTimeout(getTopBookmarkNotes(30, true), 15000, 'Bookmark notes preload');
       console.log(`✅Bookmark notes preload complete (${notes.length} notes)`);
       succeeded = true;
   } catch (err) {
       console.warn('Could not pre-load bookmark notes:', err);
   }

   if (!succeeded && !isRetry) {
       // First attempt failed/timed out - retry once before giving up
       console.log('📊 Retrying bookmark notes preload in 3s...');
       setTimeout(() => { preloadExcelBookmarkNotes(true); }, 3000);
       return; // Leave state as "connecting" until the retry finishes
   }

   // Either it succeeded, or this was already the retry (succeeded or
   // not) - either way, stop showing "Connecting..." now
   excelNotesReady = true;
   if (typeof window.updateExcelConnectionStatus === 'function') {
       window.updateExcelConnectionStatus(!!window.excelAccessToken);
   }
}
window.preloadExcelBookmarkNotes = preloadExcelBookmarkNotes;

function updateExcelConnectionStatus(connected) {
const btn = document.getElementById('excelOnlineConnectBtn');
const refreshBtn = document.getElementById('refreshScoresBtn');

if (!btn) return;

if (connected && excelNotesReady) {
   const autoTrackOn = isAutoTrackEnabled();
   btn.textContent = autoTrackOn ? "📊 Excel ✓" : "📊 Excel";
   btn.style.background = "#28a745";
   if (refreshBtn) refreshBtn.style.display = 'inline-block';
} else if (connected && !excelNotesReady) {
   btn.textContent = "📊 Connecting...";
   btn.style.background = "#555";
   if (refreshBtn) refreshBtn.style.display = 'none';
} else {
   btn.textContent = "📊 Connect Excel";
   btn.style.background = "#555";
   if (refreshBtn) refreshBtn.style.display = 'none';
}

// Keep the floating Excel pill perfectly in sync with the button
if (typeof window.updateFloatingTagPillsFromCommon === 'function') {
   window.updateFloatingTagPillsFromCommon();
}
}

// =========================================
// BASKETS MANAGEMENT
// =========================================

// Save current basket to Excel
async function saveBasketToExcel(basketName) {
   if (!excelAccessToken) {
       alert("Please connect to Excel Online first");
       signInToExcelOnline();
       return;
   }

   // Show modal to input basket name
   const name = await showBasketNameModal(basketName);
   if (!name) return;

   try {
       // COMPRESSED: Only store oneDriveIds
       const videoIds = window.basketVideos.map(v => v.oneDriveId).filter(Boolean);
       
       const basketData = {
           version: "2.0",
           exportDate: new Date().toISOString(),
           itemCount: videoIds.length,
           videoIds: videoIds
       };
       
       const values = [[
           `basket_${Date.now()}`,
           name,
           new Date().toISOString(),
           window.basketVideos.length,
           JSON.stringify(basketData)
       ]];

       // Append to Excel table
       const response = await fetch(
           `https://graph.microsoft.com/v1.0/me/drive/items/${EXCEL_WORKBOOK_ID}/workbook/worksheets/${SHEETS.BASKETS}/tables/Table1/rows`,
           {
               method: 'POST',
               headers: {
                   'Authorization': `Bearer ${excelAccessToken}`,
                   'Content-Type': 'application/json'
               },
               body: JSON.stringify({ values: values })
           }
       );
       
       if (!response.ok) {
           throw new Error(`HTTP ${response.status}`);
       }
       
       console.log(`Saved basket to Excel: ${name}`);
       
   } catch (err) {
       console.error("Failed to save basket:", err);
       handleExcelAPIError(err);
   }
}


// =========================================
// CURRENT BASKET AUTO-SYNC
// =========================================

/**
* Sync current basket to Excel "Current Basket" tab (overwrites existing)
* ✅ ALSO saves a versioned copy to "Baskets" tab with timestamp
*/
async function syncCurrentBasketToExcel() {
if (!excelAccessToken) {
   console.log('Excel not connected - skipping basket sync');
   return;
}

if (!window.autoSyncEnabled) {
   console.log('Auto-sync disabled - skipping basket sync');
   return;
}

// Build compressed basket data
const videoIds = window.basketVideos.map(v => v.oneDriveId).filter(Boolean);

const basketData = {
   version: "2.0",
   exportDate: new Date().toISOString(),
   itemCount: videoIds.length,
   videoIds: videoIds
};

const values = [[
   `current_${Date.now()}`,
   'Current Basket',
   new Date().toISOString(),
   window.basketVideos.length,
   JSON.stringify(basketData)
]];

// ✅ FAST PATH: single PATCH overwrites existing row - no clear needed
const writeResponse = await fetch(
   `https://graph.microsoft.com/v1.0/me/drive/items/${EXCEL_WORKBOOK_ID}/workbook/worksheets/${SHEETS.CURRENT}/range(address='A2:E2')`,
   {
       method: 'PATCH',
       headers: {
           'Authorization': `Bearer ${excelAccessToken}`,
           'Content-Type': 'application/json'
       },
       body: JSON.stringify({ values: values })
   }
);

if (!writeResponse.ok) {
   throw new Error(`HTTP ${writeResponse.status}`);
}

console.log(`✅ Synced current basket to Excel (${window.basketVideos.length} items)`);

// ✅ Fire-and-forget versioned backup — user doesn't wait for this
saveVersionedBasketBackup(basketData).catch(err => {
   console.warn('Versioned basket backup failed (non-critical):', err);
});
}

/**
* Save a timestamped backup row to the Baskets sheet.
* Runs in the background — never blocks the push button.
*/
async function saveVersionedBasketBackup(basketData) {
try {
   const timestamp = new Date().toLocaleString('en-GB', {
       year: 'numeric', month: '2-digit', day: '2-digit',
       hour: '2-digit', minute: '2-digit', second: '2-digit',
       hour12: false
   }).replace(/[/,]/g, '-').replace(/:/g, '.');

   const versionedName = `sync ${timestamp}`;

   const versionedRow = [
       `basket_${Date.now()}`,
       versionedName,
       new Date().toISOString(),
       basketData.itemCount,
       JSON.stringify(basketData)
   ];

   // ✅ Ask for rowCount only — no cell data downloaded
   let nextRow = 2;
   try {
       const usedRangeResponse = await fetch(
           `https://graph.microsoft.com/v1.0/me/drive/items/${EXCEL_WORKBOOK_ID}/workbook/worksheets/${SHEETS.BASKETS}/usedRange?$select=rowCount`,
           { headers: { 'Authorization': `Bearer ${excelAccessToken}` } }
       );
       if (usedRangeResponse.ok) {
           const rangeData = await usedRangeResponse.json();
           // rowCount includes the header row, so next empty row = rowCount + 1
           nextRow = (rangeData.rowCount || 1) + 1;
       }
   } catch (err) {
       console.warn('Could not read Baskets usedRange, defaulting to row 2:', err);
   }

   const versionWriteResponse = await fetch(
       `https://graph.microsoft.com/v1.0/me/drive/items/${EXCEL_WORKBOOK_ID}/workbook/worksheets/${SHEETS.BASKETS}/range(address='A${nextRow}:E${nextRow}')`,
       {
           method: 'PATCH',
           headers: {
               'Authorization': `Bearer ${excelAccessToken}`,
               'Content-Type': 'application/json'
           },
           body: JSON.stringify({ values: [versionedRow] })
       }
   );

   if (versionWriteResponse.ok) {
       console.log(`✅ Background: saved versioned basket "${versionedName}" at row ${nextRow}`);
   } else {
       const err = await versionWriteResponse.json().catch(() => ({}));
       console.warn('Versioned basket write failed:', err?.error?.message || versionWriteResponse.status);
   }
} catch (err) {
   console.warn('saveVersionedBasketBackup error:', err);
}
}

/**
* Load current basket from Excel "Current Basket" tab on page load
*/
async function loadCurrentBasketFromExcel() {
  if (!excelAccessToken) {
      console.log('Excel not connected - skipping current basket restore');
      return;
  }
  
  try {
      const response = await fetch(
          `https://graph.microsoft.com/v1.0/me/drive/items/${EXCEL_WORKBOOK_ID}/workbook/worksheets/${SHEETS.CURRENT}/range(address='A2:E2')`,
          {
              headers: {
                  'Authorization': `Bearer ${excelAccessToken}`
              }
          }
      );
      
      if (!response.ok) {
          console.log('Current Basket sheet not accessible (may be empty or not exist)');
          return;
      }
      
      const data = await response.json();
      const rows = data.values || [];
      
      // Check if row has data
      if (rows.length === 0 || !rows[0] || !rows[0][0]) {
          console.log('No current basket found in Excel');
          return;
      }
      
      const row = rows[0];
      const basketData = {
          basket_id: row[0],
          name: row[1],
          created_date: row[2],
          item_count: parseInt(row[3]) || 0,
          json_data: row[4] ? JSON.parse(row[4]) : null
      };
      
      if (!basketData.json_data) {
          console.log('Current basket has no data');
          return;
      }
      
      // Check version to determine format
      const isCompressed = basketData.json_data.version === "2.0";
      let videosToLoad = [];
      let missingCount = 0;
      
      if (isCompressed) {
          // NEW FORMAT: Reconstruct videos from IndexedDB using IDs
          if (!basketData.json_data.videoIds || !Array.isArray(basketData.json_data.videoIds)) {
              console.warn('Invalid compressed basket format');
              return;
          }
          
          console.log(`Restoring current basket with ${basketData.json_data.videoIds.length} video IDs...`);
          
          // Get all videos from IndexedDB
          const allVideos = await getAllVideos();
          const videoMap = new Map(allVideos.map(v => [v.oneDriveId, v]));
          
          // Reconstruct video objects
          basketData.json_data.videoIds.forEach(id => {
              const video = videoMap.get(id);
              if (video) {
                  videosToLoad.push(video);
              } else {
                  missingCount++;
                  console.warn(`Video not found in database: ${id}`);
              }
          });
      } else {
          // OLD FORMAT: Videos already in full format
          if (!basketData.json_data.videos || !Array.isArray(basketData.json_data.videos)) {
              console.warn('Invalid basket format');
              return;
          }
          videosToLoad = basketData.json_data.videos;
      }
      
      if (videosToLoad.length === 0) {
          console.log('No videos could be restored from current basket');
          return;
      }
      
      // Load into basket
      window.basketVideos = [...videosToLoad];
      window.saveBasket();
      window.renderBasket();
      
      console.log(`✅ Restored current basket from Excel: ${videosToLoad.length} items` + 
                  (missingCount > 0 ? ` (${missingCount} missing)` : ''));
      
  } catch (err) {
      console.error('Failed to load current basket from Excel:', err);
      // Silent fail - don't disrupt page load
  }
}

// Export functions globally
window.syncCurrentBasketToExcel = syncCurrentBasketToExcel;
window.loadCurrentBasketFromExcel = loadCurrentBasketFromExcel;

// Load all saved baskets from Excel
async function loadBasketsFromExcel() {
  if (!excelAccessToken) {
      alert("Please connect to Excel Online first");
      return [];
  }
  
  try {
      const response = await fetch(
          `https://graph.microsoft.com/v1.0/me/drive/items/${EXCEL_WORKBOOK_ID}/workbook/worksheets/${SHEETS.BASKETS}/range(address='A2:E100000')`,
          {
              headers: {
                  'Authorization': `Bearer ${excelAccessToken}`
              }
          }
      );
      
      if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
      }
      
      const data = await response.json();
   
   // Handle case where sheet is empty or has no data
   if (!data.values || data.values.length === 0) {
       console.log('No baskets found in Excel (sheet empty)');
       return [];
   }
   
   const rows = data.values; // ✅ DON'T slice - A2:E1000 already skips header
    
    return rows
        .filter(row => row && row[0]) // Filter out empty/null rows
        .map(row => ({
               basket_id: row[0],
               name: row[1],
               created_date: row[2],
               item_count: parseInt(row[3]) || 0,
               json_data: row[4] ? JSON.parse(row[4]) : null
           }));
       
   } catch (err) {
       console.error("Failed to load baskets:", err);
       handleExcelAPIError(err);
       return [];
   }
}


// Show basket picker modal
async function showBasketPickerModal() {
 const baskets = await loadBasketsFromExcel();
 
 if (!baskets.length) {
  alert("No saved baskets found in Excel");
     return;
 }
 
 // ✅ Reverse so latest basket is at top
 baskets.reverse();
   
   const modal = document.createElement('div');
   modal.className = 'basket-json-modal';
   
  const basketsList = baskets.map((b, idx) =>
      `<div class="basket-picker-item" data-index="${idx}">
          <div class="basket-picker-info">
              <strong>${b.name}</strong>
              <span style="font-size: 0.85rem; color: #666;">
                  ${b.item_count} items • ${new Date(b.created_date).toLocaleString()}
              </span>
          </div>
          <div style="display: flex; gap: 8px;">
              <button class="basket-picker-load-btn" data-index="${idx}">Load</button>
              <button class="basket-picker-delete-btn" data-index="${idx}" data-basket-id="${b.basket_id}">Delete</button>
          </div>
      </div>`
  ).join('');
   
   modal.innerHTML = `
      <div class="basket-json-modal-content basket-json-modal-wide">
          <h3>Load Basket from Excel</h3>
           <div id="basketPickerList" style="max-height: 400px; overflow-y: auto; margin-bottom: 16px;">
               ${basketsList}
           </div>
           <button id="basketPickerCancelBtn" class="modal-btn modal-btn-cancel">Cancel</button>
       </div>
   `;
   document.body.appendChild(modal);
   
   // Load button handlers
modal.querySelectorAll('.basket-picker-load-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
        const idx = parseInt(btn.dataset.index);
        const basket = baskets[idx];
        modal.remove();
         await loadBasketFromExcelData(basket);
    });
});

// Delete button handlers
modal.querySelectorAll('.basket-picker-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
        const idx = parseInt(btn.dataset.index);
        const basket = baskets[idx];
        const basketId = btn.dataset.basketId;
        
        // Confirm deletion
        if (!confirm(`Delete basket "${basket.name}"?\n\nThis will permanently remove it from Excel Online.`)) {
            return;
        }
        
        // Disable buttons during deletion
        btn.disabled = true;
        btn.textContent = 'Deleting...';
        const loadBtn = btn.parentElement.querySelector('.basket-picker-load-btn');
        if (loadBtn) loadBtn.disabled = true;
        
        try {
            // Find the row in Excel and delete it
            await deleteBasketFromExcel(basketId);
            
            // Show success
            btn.textContent = 'Deleted';
            btn.style.background = '#28a745';
            
            // Remove the item from UI
            setTimeout(() => {
                const item = btn.closest('.basket-picker-item');
                if (item) {
                    item.style.transition = 'opacity 0.3s ease';
                    item.style.opacity = '0';
                    setTimeout(() => item.remove(), 300);
                }
                
                // Check if list is now empty
                const remaining = modal.querySelectorAll('.basket-picker-item').length;
                if (remaining <= 1) { // <= 1 because the removed one might still be in DOM
                    setTimeout(() => {
                        modal.remove();
                        alert('All baskets deleted');
                    }, 400);
                }
            }, 1000);
            
        } catch (err) {
            console.error('Failed to delete basket:', err);
            alert(`Delete failed: ${err.message}`);
            btn.disabled = false;
            btn.textContent = 'Delete';
            if (loadBtn) loadBtn.disabled = false;
        }
    });
});
   
   // Cancel
   document.getElementById('basketPickerCancelBtn').addEventListener('click', () => {
       modal.remove();
   });
   
   // Click outside to close
modal.addEventListener('click', (e) => {
  if (e.target === modal) modal.remove();
});

// ESC key to close
const pickerEscHandler = (e) => {
  if (e.key === 'Escape') {
      modal.remove();
      document.removeEventListener('keydown', pickerEscHandler);
  }
};
document.addEventListener('keydown', pickerEscHandler);
}

// Load basket data into app
async function loadBasketFromExcelData(basketData) {
if (!basketData.json_data) {
alert("Invalid basket data");
return;
}

// Check version to determine format
const isCompressed = basketData.json_data.version === "2.0";
let videosToLoad = [];
let missingCount = 0;
let missingVideosByAccount = new Map();

if (isCompressed) {
// NEW FORMAT: Reconstruct videos from IndexedDB using IDs
if (!basketData.json_data.videoIds || !Array.isArray(basketData.json_data.videoIds)) {
   alert("Invalid compressed basket format");
   return;
}

console.log(`Loading compressed basket with ${basketData.json_data.videoIds.length} video IDs...`);

// Get all videos from IndexedDB
const allVideos = await getAllVideos();
const videoMap = new Map(allVideos.map(v => [v.oneDriveId, v]));

// Fetch raw_data from Excel to lookup missing video accounts
let rawDataMap = new Map();
if (excelAccessToken) {
try {
    console.log('Fetching raw_data sheet for account lookup...');
    const response = await fetch(
        `https://graph.microsoft.com/v1.0/me/drive/items/${EXCEL_WORKBOOK_ID}/workbook/worksheets/raw_data/range(address='A2:H100000')`,
        {
            headers: {
                'Authorization': `Bearer ${excelAccessToken}`
            }
        }
    );
    
    if (response.ok) {
        const data = await response.json();
        const rows = data.values || [];
        rows.forEach(row => {
            const id = row[0];
            const accountName = row[3]; // ✅ FIXED: Column D (account_name) is index 3, not 7
            if (id && accountName) {
                rawDataMap.set(id, accountName);
            }
        });
        console.log(`Loaded ${rawDataMap.size} video-to-account mappings from raw_data sheet`);
    }
} catch (err) {
    console.warn('Could not fetch raw_data sheet for account lookup:', err);
}
}

// Reconstruct video objects and track missing by account
basketData.json_data.videoIds.forEach(id => {
    const video = videoMap.get(id);
    if (video) {
        videosToLoad.push(video);
    } else {
        missingCount++;
        // ✅ First try to get account from raw_data sheet
        let accountName = rawDataMap.get(id);
        
        // ✅ Fallback: try to find in current IndexedDB (for videos that were deleted)
        if (!accountName) {
            accountName = 'Unknown Account';
        }
        
        const currentCount = missingVideosByAccount.get(accountName) || 0;
        missingVideosByAccount.set(accountName, currentCount + 1);
        console.warn(`Video not found in database: ${id} (Account: ${accountName})`);
    }
});
} else {
// ✅ OLD FORMAT: Videos already in full format
if (!basketData.json_data.videos || !Array.isArray(basketData.json_data.videos)) {
    alert("Invalid basket format");
    return;
}
videosToLoad = basketData.json_data.videos;
console.log(`Loading legacy basket with ${videosToLoad.length} full video objects...`);
}

const importCount = videosToLoad.length;
const totalCount = basketData.json_data.videoIds?.length || basketData.json_data.videos?.length || 0;

// ✅ Build warning message with account breakdown
let warningMessage = null;
if (missingCount > 0) {
const accountBreakdown = Array.from(missingVideosByAccount.entries())
    .map(([account, count]) => `${account}: ${count} video${count > 1 ? 's' : ''}`)
    .join('<br>');

warningMessage = `${missingCount} video${missingCount > 1 ? 's' : ''} from this basket ${missingCount > 1 ? 'are' : 'is'} no longer in your database.<br><br><strong>Missing by account:</strong><br>${accountBreakdown}`;
}

// Load whatever videos ARE available (don't block on missing videos)
if (importCount === 0) {
console.warn(`No videos found in database for basket "${basketData.name}" - all ${totalCount} videos are missing`);
alert(`Cannot load basket "${basketData.name}"\n\nAll ${totalCount} videos are missing from your database.\n\nPlease load the source accounts first.`);
return;
}

console.log(`Loading basket with ${importCount} available videos (${missingCount} missing)`);

// Ask user what to do if basket has items (with warning integrated)
if (window.basketVideos.length > 0) {
const action = await window.showImportActionModal(
  window.basketVideos.length, 
  importCount,
  warningMessage
);

if (action === 'cancel') return;

if (action === 'replace') {
   window.basketVideos = [...videosToLoad];
   console.log(`Replaced basket with ${videosToLoad.length} videos (${missingCount} missing)`);
} else if (action === 'add') {
   let addedCount = 0;
   videosToLoad.forEach(video => {
       if (!window.basketVideos.some(v => v.oneDriveId === video.oneDriveId)) {
           window.basketVideos.push(video);
           addedCount++;
       }
   });
   console.log(`Added ${addedCount} new videos (${missingCount} missing from basket)`);
}
} else {
// Empty basket - load available videos directly (show info if missing videos)
window.basketVideos = [...videosToLoad];
console.log(`Loaded ${videosToLoad.length} videos into empty basket (${missingCount} missing)`);

// Show warning toast if some videos were missing
if (missingCount > 0) {
   const accountList = Array.from(missingVideosByAccount.entries())
       .map(([account, count]) => `${account}: ${count}`)
       .join(', ');
   alert(`Loaded basket "${basketData.name}"\n\n✅ ${importCount} videos loaded\n⚠️ ${missingCount} videos missing\n\nMissing from: ${accountList}`);
}
}

window.saveBasket();
window.renderBasket();

// ✅ Auto-sync DISABLED - user must manually push after loading

// ✅ No alert - success shown in modal via button state
}

/**
* Delete a basket from Excel by basket_id
*/
async function deleteBasketFromExcel(basketId) {
   if (!excelAccessToken) {
       throw new Error('Not connected to Excel Online');
   }
   
   try {
       // Read all baskets to find the row number
       const response = await fetch(
           `https://graph.microsoft.com/v1.0/me/drive/items/${EXCEL_WORKBOOK_ID}/workbook/worksheets/${SHEETS.BASKETS}/range(address='A2:E100000')`,
           {
               headers: {
                   'Authorization': `Bearer ${excelAccessToken}`
               }
           }
       );
       
       if (!response.ok) {
           throw new Error(`HTTP ${response.status}`);
       }
       
       const data = await response.json();
       const rows = data.values || [];
       
       // Find the row with matching basket_id
       const rowIndex = rows.findIndex(row => row[0] === basketId);
       
       if (rowIndex === -1) {
           throw new Error('Basket not found in Excel');
       }
       
       // Excel row number (add 2 because: 1 for header, 1 for 0-based index)
       const excelRowNumber = rowIndex + 2;
       
       console.log(`Deleting basket at row ${excelRowNumber}`);
       
       // Clear the row (delete entire row would shift others, so we clear instead)
       const deleteResponse = await fetch(
           `https://graph.microsoft.com/v1.0/me/drive/items/${EXCEL_WORKBOOK_ID}/workbook/worksheets/${SHEETS.BASKETS}/range(address='A${excelRowNumber}:E${excelRowNumber}')/clear`,
           {
               method: 'POST',
               headers: {
                   'Authorization': `Bearer ${excelAccessToken}`,
                   'Content-Type': 'application/json'
               },
               body: JSON.stringify({ applyTo: 'All' })
           }
       );
       
       if (!deleteResponse.ok) {
           throw new Error(`Failed to delete: HTTP ${deleteResponse.status}`);
       }
       
       console.log(`✅ Deleted basket: ${basketId}`);
       
   } catch (err) {
       console.error('Failed to delete basket:', err);
       throw err;
   }
}

/**
* Show modal when popup is blocked, offer redirect as alternative
*/
function showPopupBlockedModal() {
   return new Promise((resolve) => {
       const modal = document.createElement('div');
       modal.className = 'basket-json-modal';
       modal.innerHTML = `
           <div class="basket-json-modal-content" style="max-width: 500px;">
               <h3 style="color: #ff9800;">⚠️ Popup Blocked</h3>
               <p style="margin-bottom: 12px;">
                   Your browser blocked the sign-in popup window.
               </p>
               <p style="font-size: 0.85rem; color: #666; margin-bottom: 20px;">
                   <strong>Quick fix:</strong><br>
                   • Enable popups for this site, then try again<br>
                   • Or use "Redirect Mode" below (will reload the page)
               </p>
               <div style="display: flex; flex-direction: column; gap: 10px;">
                   <button id="popupRetryBtn" class="modal-btn modal-btn-primary">
                       🔄 Try Again
                   </button>
                   <button id="popupRedirectBtn" class="modal-btn modal-btn-primary" style="background: #ff9800;">
                       🔀 Use Redirect Mode
                   </button>
                   <button id="popupCancelBtn" class="modal-btn modal-btn-cancel">
                       Cancel
                   </button>
               </div>
           </div>
       `;
       document.body.appendChild(modal);
       
       // Retry button - try popup again
       document.getElementById('popupRetryBtn').addEventListener('click', () => {
           modal.remove();
           resolve(false); // Return false to retry popup
       });
       
       // Redirect button - use redirect mode
       document.getElementById('popupRedirectBtn').addEventListener('click', () => {
           modal.remove();
           resolve(true); // Return true to use redirect
       });
       
       // Cancel button
       document.getElementById('popupCancelBtn').addEventListener('click', () => {
           modal.remove();
           resolve(null); // Return null to cancel
       });
       
       // Close on background click
modal.addEventListener('click', (e) => {
  if (e.target === modal) {
      modal.remove();
      resolve(null);
  }
});

// ESC key to cancel
const escHandler = (e) => {
  if (e.key === 'Escape') {
      modal.remove();
      resolve(null);
      document.removeEventListener('keydown', escHandler);
  }
};
document.addEventListener('keydown', escHandler);
   });
}

// =========================================
// DEFAULT EXCLUDE TAGS
// =========================================

/**
* Load default exclude tags from Excel and apply to dropdown
*/
async function loadDefaultExcludeTags() {
   if (!excelAccessToken) {
       console.warn("No Excel token - skipping default exclude tags");
       return;
   }
   
   try {
       // Read from Exclude sheet, column A starting from row 2
       const response = await fetch(
           `https://graph.microsoft.com/v1.0/me/drive/items/${EXCEL_WORKBOOK_ID}/workbook/worksheets/${SHEETS.EXCLUDE}/range(address='A2:A100000')`,
           {
               headers: {
                   'Authorization': `Bearer ${excelAccessToken}`
               }
           }
       );
       
       if (!response.ok) {
           throw new Error(`HTTP ${response.status}`);
       }
       
       const data = await response.json();
       const rows = data.values || [];
       
       // Extract tags from rows
       const defaultExcludeTags = rows
           .map(row => row[0])
           .filter(tag => tag && tag.toString().trim().length > 0)
           .map(tag => tag.toString().trim());
       
       if (defaultExcludeTags.length === 0) {
           console.log("No default exclude tags found in Excel");
           return;
       }
       
       console.log(`Found ${defaultExcludeTags.length} default exclude tags:`, defaultExcludeTags);
       
       // Apply to exclude dropdown
       const $excludeSelect = $('#excludeTagSelect');
       if ($excludeSelect.length) {
           const currentExcludes = $excludeSelect.val() || [];
           const updatedExcludes = [...new Set([...currentExcludes, ...defaultExcludeTags])];
           $excludeSelect.val(updatedExcludes).trigger('change');
           
           console.log(`✅ Applied ${defaultExcludeTags.length} default exclude tags to dropdown`);
       }
       
   } catch (err) {
       console.warn("Failed to load default exclude tags:", err);
   }
}

// Export globally
window.loadDefaultExcludeTags = loadDefaultExcludeTags;

/**
* Get cached video scores (fast) or load from Excel if needed
* @param {boolean} forceRefresh - Force reload from Excel
* @returns {Promise<Map>} - Map of oneDriveId => userScore
*/
async function getCachedVideoScores(forceRefresh = false) {
// Return cached if available and not forcing refresh
if (cachedVideoScores && !forceRefresh) {
    console.log(`✅ Using cached scores (${cachedVideoScores.size} videos)`);
    return cachedVideoScores;
}

// Not connected - return empty map
if (!excelAccessToken) {
    console.log('Excel not connected - returning empty score map');
    return new Map();
}

try {
    console.log('📊 Loading video scores from Excel...');
    const videoScores = await loadAllVideoScoresFromExcel();
    cachedVideoScores = new Map(videoScores.map(v => [v.oneDriveId, v.user_score]));
    scoresLastLoaded = Date.now();
    
    console.log(`✅ Loaded ${cachedVideoScores.size} video scores into cache`);
    
    // ✅ NEW: Save scores to IndexedDB for persistence
    await saveScoresToIndexedDB(videoScores);
    
    return cachedVideoScores;
    
} catch (err) {
    console.error('Failed to load video scores:', err);
    return new Map();
}
}

/**
* Save scores to IndexedDB (merges with existing video data)
* @param {Array} videoScores - Array of {oneDriveId, user_score}
*/
async function saveScoresToIndexedDB(videoScores) {
if (!videoScores || videoScores.length === 0) return;

try {
    const db = await openDB();
    let updateCount = 0;
    
    // Process in batches to avoid transaction timeout
    const batchSize = 100;
    for (let i = 0; i < videoScores.length; i += batchSize) {
        const batch = videoScores.slice(i, i + batchSize);
        
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        
        // ✅ Process each score in batch with proper async handling
        for (const scoreData of batch) {
            try {
                // Get existing video
                const existing = await new Promise((resolve, reject) => {
                    const getRequest = store.get(scoreData.oneDriveId);
                    getRequest.onsuccess = () => resolve(getRequest.result);
                    getRequest.onerror = () => reject(getRequest.error);
                });
                
                if (existing) {
                    // Update score and save back
                    existing.userScore = scoreData.user_score;
                    await new Promise((resolve, reject) => {
                        const putRequest = store.put(existing);
                        putRequest.onsuccess = () => {
                            updateCount++;
                            resolve();
                        };
                        putRequest.onerror = () => reject(putRequest.error);
                    });
                }
            } catch (itemErr) {
                console.warn(`Failed to update score for ${scoreData.oneDriveId}:`, itemErr);
            }
        }
        
        // Wait for transaction to complete
        await new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
        
        // ✅ Log progress for large batches
        if (videoScores.length > 100) {
            console.log(`Progress: Saved ${updateCount} of ${Math.min(i + batchSize, videoScores.length)} scores...`);
        }
    }
    
    console.log(`✅ Saved ${updateCount} scores to IndexedDB (out of ${videoScores.length} from Excel)`);
    
} catch (err) {
    console.error('Failed to save scores to IndexedDB:', err);
}
}

/**
* Get cached video bookmarks (fast) or load from Excel if needed.
* Mirrors getCachedVideoScores() so bookmarks sync across devices the
* same way scores do, instead of only being fetched when a video's
* Bookmarks modal is opened.
* @param {boolean} forceRefresh - Force reload from Excel
* @returns {Promise<Map>} - Map of oneDriveId => bookmarks array
*/
async function getCachedVideoBookmarks(forceRefresh = false) {
if (cachedVideoBookmarks && !forceRefresh) {
    console.log(`✅ Using cached bookmarks (${cachedVideoBookmarks.size} videos)`);
    return cachedVideoBookmarks;
}

if (!excelAccessToken) {
    console.log('Excel not connected - returning empty bookmark map');
    return new Map();
}

try {
    console.log('📊 Loading video bookmarks from Excel...');
    const videoBookmarks = await loadAllBookmarksFromExcel();
    cachedVideoBookmarks = new Map(videoBookmarks.map(v => [v.oneDriveId, v.bookmarks]));
    bookmarksLastLoaded = Date.now();

    console.log(`✅ Loaded bookmarks for ${cachedVideoBookmarks.size} videos into cache`);

    // ✅ Save bookmarks to IndexedDB so every device stays in sync
    await saveBookmarksToIndexedDB(videoBookmarks);

    return cachedVideoBookmarks;

} catch (err) {
    console.error('Failed to load video bookmarks:', err);
    return new Map();
}
}

/**
* Save bookmarks to IndexedDB (merges with existing video data)
* @param {Array} videoBookmarks - Array of {oneDriveId, bookmarks}
*/
async function saveBookmarksToIndexedDB(videoBookmarks) {
if (!videoBookmarks || videoBookmarks.length === 0) return;

try {
    const db = await openDB();
    let updateCount = 0;

    const batchSize = 100;
    for (let i = 0; i < videoBookmarks.length; i += batchSize) {
        const batch = videoBookmarks.slice(i, i + batchSize);

        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);

        for (const bmData of batch) {
            try {
                const existing = await new Promise((resolve, reject) => {
                    const getRequest = store.get(bmData.oneDriveId);
                    getRequest.onsuccess = () => resolve(getRequest.result);
                    getRequest.onerror = () => reject(getRequest.error);
                });

                if (existing) {
                    existing.bookmarks = bmData.bookmarks;
                    await new Promise((resolve, reject) => {
                        const putRequest = store.put(existing);
                        putRequest.onsuccess = () => {
                            updateCount++;
                            resolve();
                        };
                        putRequest.onerror = () => reject(putRequest.error);
                    });
                }
            } catch (itemErr) {
                console.warn(`Failed to update bookmarks for ${bmData.oneDriveId}:`, itemErr);
            }
        }

        await new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    console.log(`✅ Saved bookmarks for ${updateCount} videos to IndexedDB (out of ${videoBookmarks.length} from Excel)`);

} catch (err) {
    console.error('Failed to save bookmarks to IndexedDB:', err);
}
}

/**
* Clear the score cache (forces reload on next use)
*/
function clearScoreCache() {
cachedVideoScores = null;
cachedVideoRowNumbers = null;
scoresLastLoaded = null;
console.log('🗑️ Score cache cleared');
}

/**
* Clear the bookmark cache (forces reload on next use)
*/
function clearBookmarkCache() {
cachedVideoBookmarks = null;
bookmarksLastLoaded = null;
console.log('🗑️ Bookmark cache cleared');
}

// Export globally
window.getCachedVideoScores = getCachedVideoScores;
window.clearScoreCache = clearScoreCache;
window.getCachedVideoBookmarks = getCachedVideoBookmarks;
window.saveBookmarksToIndexedDB = saveBookmarksToIndexedDB;
window.clearBookmarkCache = clearBookmarkCache;

/**
* Add a tag to the default exclude list in Excel
* @param {string} tag - Tag to add to exclude list
*/
async function addTagToDefaultExcludeList(tag) {
if (!excelAccessToken) {
    throw new Error('NOT_CONNECTED');
}

try {
    // First, check if tag already exists in Exclude sheet
    const response = await fetch(
        `https://graph.microsoft.com/v1.0/me/drive/items/${EXCEL_WORKBOOK_ID}/workbook/worksheets/${SHEETS.EXCLUDE}/range(address='A2:A100000')`,
        {
            headers: {
                'Authorization': `Bearer ${excelAccessToken}`
            }
        }
    );
    
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
    
    const data = await response.json();
    const rows = data.values || [];
    
    // ✅ Build list of existing tags (case insensitive) for duplicate check
    const existingTags = rows
        .map(row => row && row[0])
        .filter(t => t && t.toString().trim().length > 0)
        .map(t => t.toString().trim().toLowerCase());
    
    // Check if tag already exists (case insensitive)
    if (existingTags.includes(tag.toLowerCase())) {
        console.log(`Tag "${tag}" already in default exclude list`);
        return { alreadyExists: true };
    }
    
    // ✅ Find next empty row by checking actual row data (not filtered length)
    let nextRow = 2; // Start at row 2 (after header)
    for (let i = 0; i < rows.length; i++) {
        const cellValue = rows[i] && rows[i][0];
        if (!cellValue || cellValue.toString().trim().length === 0) {
            // Found first empty row
            nextRow = 2 + i;
            break;
        }
        // If we've checked all rows and none are empty, append after last row
        if (i === rows.length - 1) {
            nextRow = 2 + rows.length;
        }
    }
    
    // ✅ If no rows exist yet, start at row 2
    if (rows.length === 0) {
        nextRow = 2;
    }
    
    console.log(`Adding tag "${tag}" to Exclude sheet at row ${nextRow}`);
       
       // Append tag to next row
       const writeResponse = await fetch(
           `https://graph.microsoft.com/v1.0/me/drive/items/${EXCEL_WORKBOOK_ID}/workbook/worksheets/${SHEETS.EXCLUDE}/range(address='A${nextRow}')`,
           {
               method: 'PATCH',
               headers: {
                   'Authorization': `Bearer ${excelAccessToken}`,
                   'Content-Type': 'application/json'
               },
               body: JSON.stringify({ values: [[tag]] })
           }
       );
       
       if (!writeResponse.ok) {
           const errorData = await writeResponse.json().catch(() => ({}));
           throw new Error(`HTTP ${writeResponse.status} - ${errorData.error?.message || 'Unknown error'}`);
       }
       
       console.log(`✅ Added "${tag}" to default exclude list in Excel`);
    
    // ✅ Refresh Excel authentication AFTER successful write (interactive re-auth)
try {
    console.log('Starting Excel authentication refresh after exclude tag write...');
    await window.signInToExcelOnline();
    console.log('✅ Excel re-authenticated successfully after adding exclude tag');
} catch (refreshErr) {
    console.warn('Excel re-auth after write failed (non-critical):', refreshErr);
    // Non-critical - tag was already added successfully
    // Show user-friendly message
    if (refreshErr.message !== 'Sign-in cancelled') {
        console.error('Re-auth error details:', refreshErr);
    }
}
    
    // Reload default exclude tags to update the exclude dropdown
    await loadDefaultExcludeTags();
    
    return { success: true };
    
} catch (err) {
    console.error('Failed to add tag to default exclude list:', err);
    throw err;
}
}

// Export globally
window.addTagToDefaultExcludeList = addTagToDefaultExcludeList;
window.loadDefaultExcludeTags = loadDefaultExcludeTags;

// =========================================
// VIDEO DATABASE MANAGEMENT
// =========================================

/**
* Update or create video entry in Excel
* @param {object} updates - Can include: increment_views, user_score, notes, played_now, increment_f_tally
*/
async function updateVideoInExcel(video, updates = {}) {
  // Check and refresh token if needed
  try {
      await ensureExcelToken();
  } catch (err) {
      if (err.message === 'NOT_CONNECTED') {
          console.warn("Not connected to Excel Online - skipping video update");
          return;
      }
      if (err.message === 'NEEDS_REAUTH') {
          console.warn("Token expired, need manual re-auth");
          return;
      }
  }
  
  // Sheet verified on connect — skip per-update check
  
  try {
      // ✅ FAST PATH: score-only update with cached row — single cell PATCH, no read
      const cachedRow = cachedVideoRowNumbers?.get(video.oneDriveId);
      const isScoreOnly = updates.user_score !== undefined &&
          !updates.increment_views && !updates.played_now &&
          !updates.notes && !updates.increment_f_tally;

      if (cachedRow && isScoreOnly) {
          const patchRes = await fetch(
              `https://graph.microsoft.com/v1.0/me/drive/items/${EXCEL_WORKBOOK_ID}/workbook/worksheets/${SHEETS.VIDEOS}/range(address='G${cachedRow}')`,
              {
                  method: 'PATCH',
                  headers: { 'Authorization': `Bearer ${excelAccessToken}`, 'Content-Type': 'application/json' },
                  body: JSON.stringify({ values: [[updates.user_score]] })
              }
          );
          if (!patchRes.ok) throw new Error(`HTTP ${patchRes.status}`);
          console.log(`✅ Score patched directly at G${cachedRow}: ${video.filename}`);
          return;
      }

      // Standard path: read all rows to find/insert
      // Get all rows to find existing video
      const response = await fetch(
           `https://graph.microsoft.com/v1.0/me/drive/items/${EXCEL_WORKBOOK_ID}/workbook/worksheets/${SHEETS.VIDEOS}/range(address='A2:M100000')`,
           {
               headers: {
                   'Authorization': `Bearer ${excelAccessToken}`
               }
           }
       );
       
       if (!response.ok) {
           throw new Error(`HTTP ${response.status}`);
       }
       
       const data = await response.json();
       const rows = data.values || [];
       const existingIndex = rows.findIndex(row => row[0] === video.oneDriveId);

       if (existingIndex >= 0) {
           // Update existing row
           const row = rows[existingIndex];
           const viewCount = parseInt(row[5]) || 0;
           const userScore = updates.user_score !== undefined ? updates.user_score : (parseFloat(row[6]) || 0);
           const notes = updates.notes !== undefined ? updates.notes : (row[7] || '');
           const fTally = parseInt(row[11]) || 0;
           const bookmarksStr = updates.bookmarks !== undefined ? updates.bookmarks : (row[12] || '');

           const updatedRow = [
               video.oneDriveId,
               video.filename,
               video.sizeBytes || row[2] || 0,
               video.bitrate ?? row[3] ?? null,
               video.path,
               updates.increment_views ? viewCount + 1 : viewCount,
               userScore,
               notes,
               updates.played_now ? new Date().toISOString() : (row[8] || ''),
               row[9] || new Date().toISOString(),
               Array.isArray(video.tags) ? video.tags.join(';') : '',
               updates.increment_f_tally ? fTally + 1 : fTally,
               bookmarksStr
           ];
           
           // Update the specific row
           const updateResponse = await fetch(
               `https://graph.microsoft.com/v1.0/me/drive/items/${EXCEL_WORKBOOK_ID}/workbook/worksheets/${SHEETS.VIDEOS}/range(address='A${existingIndex + 2}:M${existingIndex + 2}')`,
               {
                   method: 'PATCH',
                   headers: {
                       'Authorization': `Bearer ${excelAccessToken}`,
                       'Content-Type': 'application/json'
                   },
                   body: JSON.stringify({ values: [updatedRow] })
               }
           );
           
           if (!updateResponse.ok) {
               throw new Error(`HTTP ${updateResponse.status}`);
           }
           
           console.log(`Updated video in Excel: ${video.filename}`);
        // ✅ Cache so next update uses the fast path
        if (cachedVideoRowNumbers) {
            cachedVideoRowNumbers.set(video.oneDriveId, existingIndex + 2);
        }
        
    } else {
    // Insert new row using range API (no table needed)
    const newRow = [
        video.oneDriveId,
        video.filename,
        video.sizeBytes || 0,
        video.bitrate ?? null,
        video.path,
        updates.increment_views ? 1 : 0,
        updates.user_score || 0,
        updates.notes || '',
        updates.played_now ? new Date().toISOString() : '',
        new Date().toISOString(),
        Array.isArray(video.tags) ? video.tags.join(';') : '',
        updates.increment_f_tally ? 1 : 0,
        updates.bookmarks || ''
    ];
    
    // Find next empty row - use same approach as Baskets sheet
    // Filter to only rows with data in column A (video ID)
    const existingVideos = rows.filter(row => row && row[0]);
    const nextRow = 2 + existingVideos.length; // Header at row 1, data starts at row 2
    
    console.log(`Inserting new video at row ${nextRow} (${existingVideos.length} existing videos found)`);
        
        const insertResponse = await fetch(
            `https://graph.microsoft.com/v1.0/me/drive/items/${EXCEL_WORKBOOK_ID}/workbook/worksheets/${SHEETS.VIDEOS}/range(address='A${nextRow}:M${nextRow}')`,
            {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${excelAccessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ values: [newRow] })
            }
        );
        
        if (!insertResponse.ok) {
            const errorData = await insertResponse.json().catch(() => ({}));
            throw new Error(`HTTP ${insertResponse.status} - ${errorData.error?.message || 'Unknown error'}`);
        }
        
        console.log(`Added new video to Excel: ${video.filename}`);
     // ✅ Cache so next update uses the fast path
     if (cachedVideoRowNumbers) {
         cachedVideoRowNumbers.set(video.oneDriveId, nextRow);
     }
 }
       
   } catch (err) {
       console.error("Failed to update video in Excel:", err);
       handleExcelAPIError(err);
   }
}

async function getVideoFromExcel(oneDriveId) {
   if (!excelAccessToken) return null;
   
   try {
       // ✅ Fast path: if we already know this video's row number (from the
       // score cache built earlier), read just that single row instead of
       // scanning the whole sheet.
       const cachedRow = cachedVideoRowNumbers?.get(oneDriveId);
       
       let row;
       
       if (cachedRow) {
           const response = await fetch(
               `https://graph.microsoft.com/v1.0/me/drive/items/${EXCEL_WORKBOOK_ID}/workbook/worksheets/${SHEETS.VIDEOS}/range(address='A${cachedRow}:M${cachedRow}')`,
               {
                   headers: {
                       'Authorization': `Bearer ${excelAccessToken}`
                   }
               }
           );
           
           if (response.ok) {
               const data = await response.json();
               const fetchedRow = (data.values || [])[0];
               // Sanity check: make sure the row still matches this video
               if (fetchedRow && fetchedRow[0] === oneDriveId) {
                   row = fetchedRow;
               }
           }
       }
       
       // Fallback: full sheet scan (also used if cached row was stale/missing)
       if (!row) {
           const response = await fetch(
               `https://graph.microsoft.com/v1.0/me/drive/items/${EXCEL_WORKBOOK_ID}/workbook/worksheets/${SHEETS.VIDEOS}/range(address='A2:M100000')`,
               {
                   headers: {
                       'Authorization': `Bearer ${excelAccessToken}`
                   }
               }
           );
           
           if (!response.ok) return null;
           
           const data = await response.json();
           const rows = data.values || [];
           row = rows.find(r => r[0] === oneDriveId);
       }
       
       if (!row) return null;
       
       return {
           oneDriveId: row[0],
           filename: row[1],
           file_size_bytes: parseInt(row[2]) || 0,
           bitrate: parseInt(row[3]) || null,
           path: row[4],
           view_count: parseInt(row[5]) || 0,
           user_score: parseFloat(row[6]) || 0,
           notes: row[7] || '',
           last_played: row[8] || null,
           first_seen: row[9] || null,
           tags: row[10] ? row[10].split(';') : [],
           f_tally: parseInt(row[11]) || 0,
           bookmarks: (() => { try { return row[12] ? JSON.parse(row[12]) : []; } catch(e) { return []; } })()
       };
       
   } catch (err) {
       console.error("Failed to get video from Excel:", err);
       return null;
   }
}

// Load all videos from Excel
async function loadAllVideosFromExcel() {
   if (!excelAccessToken) {
       alert("Please connect to Excel Online first");
       return [];
   }

   try {
       const response = await fetch(
           `https://graph.microsoft.com/v1.0/me/drive/items/${EXCEL_WORKBOOK_ID}/workbook/worksheets/${SHEETS.VIDEOS}/range(address='A2:M100000')`,
           {
               headers: {
                   'Authorization': `Bearer ${excelAccessToken}`
               }
           }
       );
       
       if (!response.ok) {
           throw new Error(`HTTP ${response.status}`);
       }
       
       const data = await response.json();
       const rows = data.values || [];
       
       return rows
           .filter(row => row[0]) // Filter empty rows
           .map(row => ({
               oneDriveId: row[0],
               filename: row[1],
               file_size_bytes: parseInt(row[2]) || 0,
               bitrate: parseInt(row[3]) || null,
               path: row[4],
               view_count: parseInt(row[5]) || 0,
               user_score: parseFloat(row[6]) || 0,
               notes: row[7] || '',
               last_played: row[8] || null,
               first_seen: row[9] || null,
               tags: row[10] ? row[10].split(';') : [],
               f_tally: parseInt(row[11]) || 0,
               bookmarks: (() => { try { return row[12] ? JSON.parse(row[12]) : []; } catch(e) { return []; } })()
           }));
       
   } catch (err) {
       console.error("Failed to load videos from Excel:", err);
       handleExcelAPIError(err);
       return [];
   }
}

// ✅Cache for top bookmark notes (avoids re-reading the whole sheet every time a modal opens)
let cachedTopBookmarkNotes = null;

/**
* Compile all bookmark notes across every video in the Excel Videos sheet,
* tally how often each exact note text is used, and return the top N.
* @param {number} limit - Max number of notes to return (default 10)
* @param {boolean} forceRefresh - Force re-reading from Excel instead of using cache
* @returns {Promise<string[]>} - Array of note strings, most common first
*/
async function getTopBookmarkNotes(limit = 12, forceRefresh = false) {
   if (cachedTopBookmarkNotes && !forceRefresh && cachedTopBookmarkNotes.length >= limit) {
       return cachedTopBookmarkNotes.slice(0, limit);
   }

   if (!excelAccessToken) {
       return [];
   }

   try {
       const allVideos = await loadAllBookmarksFromExcel();
       const noteCounts = new Map();

       allVideos.forEach(v => {
           if (Array.isArray(v.bookmarks)) {
               v.bookmarks.forEach(bm => {
                   const note = (bm.note || '').trim();
                   if (note) {
                       noteCounts.set(note, (noteCounts.get(note) || 0) + 1);
                   }
               });
           }
       });

       const sorted = Array.from(noteCounts.entries())
           .sort((a, b) => b[1] - a[1])
           .slice(0, limit)
           .map(([note]) => note);

       cachedTopBookmarkNotes = sorted;
       console.log(`✅Compiled ${sorted.length} top bookmark notes from ${allVideos.length} videos`);
       return sorted;

   } catch (err) {
       console.error('Failed to compute top bookmark notes:', err);
       return [];
   }
}

/**
* Load just oneDriveId + bookmarks from the Videos sheet efficiently via
* usedRange (same fast approach loadAllVideoScoresFromExcel uses), instead
* of the full loadAllVideosFromExcel() which requests a slow, oversized
* fixed A2:M100000 range - that oversized request is what was causing the
* bookmark notes preload to hang/stall on page load.
*/
async function loadAllBookmarksFromExcel() {
if (!excelAccessToken) {
    console.warn("Not connected to Excel Online");
    return [];
}

try {
    const response = await fetch(
        `https://graph.microsoft.com/v1.0/me/drive/items/${EXCEL_WORKBOOK_ID}/workbook/worksheets/${SHEETS.VIDEOS}/usedRange`,
        {
            headers: {
                'Authorization': `Bearer ${excelAccessToken}`
            }
        }
    );

    if (!response.ok) {
        console.error(`Failed to load bookmarks: HTTP ${response.status}`);
        return [];
    }

    const data = await response.json();
    const rows = data.values || [];
    const dataRows = rows.slice(1); // skip header row

    return dataRows
        .filter(row => row && row[0])
        .map(row => {
            let bookmarks = [];
            try {
                bookmarks = row[12] ? JSON.parse(row[12]) : [];
            } catch (e) {
                bookmarks = [];
            }
            return { oneDriveId: String(row[0]).trim(), bookmarks };
        });

} catch (err) {
    console.error("Failed to load bookmarks from Excel:", err);
    return [];
}
}
window.loadAllBookmarksFromExcel = loadAllBookmarksFromExcel;

// ✅Cache for view counts, used to weight the "Play random, favour less-watched" button
let cachedViewCounts = null;

/**
* Load just oneDriveId + view_count from the Videos sheet via usedRange
* (same fast pattern as scores/bookmarks).
* @param {boolean} forceRefresh - Force reload from Excel
* @returns {Promise<Map>} - Map of oneDriveId => view_count
*/
async function getCachedViewCounts(forceRefresh = false) {
if (cachedViewCounts && !forceRefresh) {
    return cachedViewCounts;
}

if (!excelAccessToken) {
    return new Map();
}

try {
    const response = await fetch(
        `https://graph.microsoft.com/v1.0/me/drive/items/${EXCEL_WORKBOOK_ID}/workbook/worksheets/${SHEETS.VIDEOS}/usedRange`,
        {
            headers: {
                'Authorization': `Bearer ${excelAccessToken}`
            }
        }
    );

    if (!response.ok) {
        console.error(`Failed to load view counts: HTTP ${response.status}`);
        return new Map();
    }

    const data = await response.json();
    const rows = data.values || [];
    const dataRows = rows.slice(1); // skip header row

    cachedViewCounts = new Map(
        dataRows
            .filter(row => row && row[0])
            .map(row => [String(row[0]).trim(), parseInt(row[5]) || 0])
    );

    console.log(`✅Cached ${cachedViewCounts.size} view counts for weighted random selection`);
    return cachedViewCounts;

} catch (err) {
    console.error("Failed to load view counts from Excel:", err);
    return new Map();
}
}
window.getCachedViewCounts = getCachedViewCounts;

function clearViewCountsCache() {
cachedViewCounts = null;
}
window.clearViewCountsCache = clearViewCountsCache;

window.getTopBookmarkNotes = getTopBookmarkNotes;

function clearTopBookmarkNotesCache() {
   cachedTopBookmarkNotes = null;
}
window.clearTopBookmarkNotesCache = clearTopBookmarkNotesCache;

// Load only video IDs and scores from Excel (optimized for filtering)
async function loadAllVideoScoresFromExcel() {
if (!excelAccessToken) {
    console.warn("Not connected to Excel Online");
    return [];
}

try {
    // ✅ Use usedRange to get ALL data (no row limit)
    const response = await fetch(
        `https://graph.microsoft.com/v1.0/me/drive/items/${EXCEL_WORKBOOK_ID}/workbook/worksheets/${SHEETS.VIDEOS}/usedRange`,
        {
            headers: {
                'Authorization': `Bearer ${excelAccessToken}`
            }
        }
    );
    
    if (!response.ok) {
        console.error(`Failed to load scores: HTTP ${response.status}`);
        return [];
    }
    
    const data = await response.json();
    const rows = data.values || [];
    
    // Skip header row (index 0)
    const dataRows = rows.slice(1);
    
    console.log(`✅ Loaded ${dataRows.length} video scores from Excel (usedRange)`);

   const validRows = dataRows
       .map((row, index) => ({ row, excelRow: index + 2 })) // +2: 1-based + skip header
       .filter(({ row }) => row && row[0]);

   // ✅ Build row number cache at the same time (zero extra cost)
   cachedVideoRowNumbers = new Map(
       validRows.map(({ row, excelRow }) => [String(row[0]).trim(), excelRow])
   );
   console.log(`✅ Cached ${cachedVideoRowNumbers.size} row numbers for fast updates`);

   return validRows.map(({ row }) => ({
       oneDriveId: String(row[0]).trim(),
       user_score: parseFloat(row[6]) || 0
   }));
    
} catch (err) {
    console.error("Failed to load video scores from Excel:", err);
    return [];
}
}

// Load all videos from Google Sheets
async function loadAllVideosFromSheets() {
try {
 await ensureGAPIReady();
} catch (err) {
 alert("Google Sheets API not ready. Please refresh the page and try again.");
 return [];
}

if (!googleAccessToken) {
 alert("Please connect to Google Sheets first");
 return [];
}

try {
     const response = await gapi.client.sheets.spreadsheets.values.get({
         spreadsheetId: SPREADSHEET_ID,
         range: `${SHEETS.VIDEOS}!A2:L`,
         });
         
         const rows = response.result.values || [];
         
         return rows.map(row => ({
             oneDriveId: row[0],
             filename: row[1],
             file_size_bytes: parseInt(row[2]) || 0,
             bitrate: parseInt(row[3]) || null,
             path: row[4],
             view_count: parseInt(row[5]) || 0,
             user_score: parseFloat(row[6]) || 0,
             notes: row[7] || '',
             last_played: row[8] || null,
             first_seen: row[9] || null,
               tags: row[10] ? row[10].split(';') : [],
               f_tally: parseInt(row[11]) || 0,
               bookmarks: (() => { try { return row[12] ? JSON.parse(row[12]) : []; } catch(e) { return []; } })()
           }));
    
} catch (err) {
    console.error("Failed to load videos from Sheets:", err);
    handleGoogleAPIError(err);
    return [];
}
}

// Load only video IDs and scores from Google Sheets (optimized for filtering)
async function loadAllVideoScoresFromSheets() {
try {
 await ensureGAPIReady();
} catch (err) {
 console.warn("Google Sheets API not ready");
 return [];
}

if (!googleAccessToken) {
 console.warn("Not connected to Google Sheets");
 return [];
}

try {
     const response = await gapi.client.sheets.spreadsheets.values.get({
         spreadsheetId: SPREADSHEET_ID,
         range: `${SHEETS.VIDEOS}!A2:G`, // ✅ FIXED: Include column G for user_score
         });
         
         const rows = response.result.values || [];
         
         return rows.map(row => ({
             oneDriveId: row[0],
             user_score: parseFloat(row[6]) || 0  // ✅ FIXED: Column G is index 6, not 5
             }));
      
  } catch (err) {
      console.error("Failed to load video scores from Sheets:", err);
      return [];
  }
}

// =========================================
// SCORING & NOTES UI
// =========================================

// Show scoring context menu for a video
function showVideoScoringModal(video, event) {
   // Create context menu with 1-10 score grid
   const menu = document.createElement('div');
   menu.className = 'score-context-menu';
   
   // Create 2x6 grid of score buttons (1-10)
  const gridContainer = document.createElement('div');
  gridContainer.className = 'score-grid';
  
  for (let i = 1; i <= 10; i++) {
       const scoreBtn = document.createElement('button');
       scoreBtn.className = 'score-grid-btn';
       scoreBtn.textContent = i;
       scoreBtn.dataset.score = i;
       
       scoreBtn.addEventListener('click', async (e) => {
 e.stopPropagation();
 menu.remove();

 try {
     // ✅ Await Excel write — fast via cached row + single-cell PATCH
     // Queue ensures auto-track insert finishes first if it's in flight
     await queueExcelUpdate(video, { user_score: i });

     // ✅ Update all in-memory state after Excel confirms
     if (cachedVideoScores) cachedVideoScores.set(video.oneDriveId, i);
     video.userScore = i;

     const basketIndex = window.basketVideos?.findIndex(v => v.oneDriveId === video.oneDriveId);
     if (basketIndex >= 0) {
         window.basketVideos[basketIndex].userScore = i;
         window.saveBasket();
         window.renderBasket();
     }

     const historyItems = window.historyVideos?.filter(v => v.oneDriveId === video.oneDriveId);
     if (historyItems && historyItems.length > 0) {
         historyItems.forEach(item => { item.userScore = i; });
         window.saveHistory();
         window.renderHistory();
     }

     if (window.currentPlayingVideo && window.currentPlayingVideo.oneDriveId === video.oneDriveId) {
         window.currentPlayingVideo.userScore = i;
         if (typeof window.rebuildVideoInfoDisplay === 'function') {
             window.rebuildVideoInfoDisplay(window.currentPlayingVideo);
         }
     }

     if (typeof updateVideoInDB === 'function') {
         updateVideoInDB(video.oneDriveId, { userScore: i }).catch(console.warn);
     }

     // ✅ Confirmation only shown after Excel has saved
     const message = document.createElement('div');
     message.innerHTML = `✅ Score: ${i}<br><span style="font-size: 0.5em; opacity: 0.9;">${video.filename}</span>`;
     showScoreConfirmation(message.innerHTML);
     console.log(`Scored ${video.filename}: ${i}/10`);

 } catch (err) {
     console.error('Failed to save score:', err);
     showScoreConfirmation('❌ Failed', '#f44336');
     alert('Failed to save score. Make sure Excel Online is connected.');
 }
});
       
       gridContainer.appendChild(scoreBtn);
   }
   
   menu.appendChild(gridContainer);
   
   // Position menu
   const x = event.clientX || (event.touches && event.touches[0].clientX) || 0;
   const y = event.clientY || (event.touches && event.touches[0].clientY) || 0;
   
   menu.style.left = x + 'px';
   menu.style.top = y + 'px';
   
   document.body.appendChild(menu);
   
   // Adjust if off-screen (same logic as context menu)
   setTimeout(() => {
       const rect = menu.getBoundingClientRect();
       
       // Check right edge
       if (rect.right > window.innerWidth) {
           menu.style.left = (window.innerWidth - rect.width - 10) + 'px';
       }
       
       // Check left edge
       if (rect.left < 0) {
           menu.style.left = '10px';
       }
       
       // Check bottom edge
       if (rect.bottom > window.innerHeight) {
           const spaceBelow = window.innerHeight - y;
           const spaceAbove = y;
           
           if (spaceAbove > spaceBelow && spaceAbove > rect.height) {
               menu.style.top = (y - rect.height) + 'px';
           } else {
               const maxTop = window.innerHeight - rect.height - 10;
               menu.style.top = Math.min(y, maxTop) + 'px';
           }
       }
       
       // Check top edge
       if (rect.top < 0) {
           menu.style.top = '10px';
       }
   }, 0);
   
   // Close on click outside
   const closeHandler = (e) => {
       if (!menu.contains(e.target)) {
           menu.remove();
           document.removeEventListener('click', closeHandler);
           document.removeEventListener('touchstart', closeHandler);
           document.removeEventListener('keydown', escapeHandler);
       }
   };
   
   // Close on ESC key
   const escapeHandler = (e) => {
       if (e.key === 'Escape') {
           menu.remove();
           document.removeEventListener('click', closeHandler);
           document.removeEventListener('touchstart', closeHandler);
           document.removeEventListener('keydown', escapeHandler);
       }
   };
   
   setTimeout(() => {
       document.addEventListener('click', closeHandler);
       document.addEventListener('touchstart', closeHandler);
       document.addEventListener('keydown', escapeHandler);
   }, 100);
}

// Show video stats modal (read-only view from Excel)
async function showVideoStatsModal(video) {
const sheetData = await getVideoFromExcel(video.oneDriveId);

// Calculate quality metrics
const width = video.width || null;
const height = video.height || null;
const sizeBytes = video.sizeBytes || 0;
const durationMs = video.durationMs || null;
const storedBitrate = video.bitrate || null;

// Resolution category
let resolutionCategory = 'Unknown';
if (width && height) {
    const pixels = width * height;
    if (pixels >= 7680 * 4320) resolutionCategory = '8K';
    else if (pixels >= 3840 * 2160) resolutionCategory = '4K (UHD)';
    else if (pixels >= 2560 * 1440) resolutionCategory = '2K (QHD)';
    else if (pixels >= 1920 * 1080) resolutionCategory = 'Full HD (1080p)';
    else if (pixels >= 1280 * 720) resolutionCategory = 'HD (720p)';
    else if (pixels >= 854 * 480) resolutionCategory = 'SD (480p)';
    else resolutionCategory = 'Low Resolution';
}

// Average bitrate (prefer stored OneDrive bitrate, fallback to calculated)
let bitrateText = 'N/A';
if (storedBitrate) {
    // Use OneDrive's reported bitrate
    const mbps = storedBitrate / 1000000; // convert to Mbps
    bitrateText = `${mbps.toFixed(2)} Mbps (OneDrive)`;
} else if (durationMs && durationMs > 0 && sizeBytes > 0) {
    // Calculate from file size and duration
    const durationSeconds = durationMs / 1000;
    const bitrate = (sizeBytes * 8) / durationSeconds; // bits per second
    const mbps = bitrate / 1000000; // convert to Mbps
    bitrateText = `${mbps.toFixed(2)} Mbps (calculated)`;
}

// Bits per pixel (quality indicator - higher is better)
let bitsPerPixelText = 'N/A';
if (width && height && durationMs && durationMs > 0 && sizeBytes > 0) {
    const totalPixels = width * height;
    const durationSeconds = durationMs / 1000;
    const totalFramePixels = totalPixels * (30 * durationSeconds); // Assume 30fps
    const bitsPerPixel = (sizeBytes * 8) / totalFramePixels;
    bitsPerPixelText = `${bitsPerPixel.toFixed(3)} bpp`;
    
    // Add quality indicator
    if (bitsPerPixel >= 0.5) bitsPerPixelText += ' (Excellent)';
    else if (bitsPerPixel >= 0.3) bitsPerPixelText += ' (High)';
    else if (bitsPerPixel >= 0.2) bitsPerPixelText += ' (Good)';
    else if (bitsPerPixel >= 0.1) bitsPerPixelText += ' (Medium)';
    else bitsPerPixelText += ' (Low)';
}

// Use video data with fallback to "No tracking data" for Google Sheets fields
const filename = sheetData?.filename || video.filename || 'Unknown';
const path = sheetData?.path || video.path || 'Unknown';
const viewCount = sheetData?.view_count ?? 'No tracking data';
const userScore = sheetData?.user_score ?? 'No tracking data';
const firstSeen = sheetData?.first_seen ? new Date(sheetData.first_seen).toLocaleString() : 'No tracking data';
const lastPlayed = sheetData?.last_played ? new Date(sheetData.last_played).toLocaleString() : 'No tracking data';
const notes = sheetData?.notes || '';

const modal = document.createElement('div');
modal.className = 'basket-json-modal';
modal.innerHTML = `
    <div class="basket-json-modal-content" style="max-width: 500px;">
        <h3>📊 Video Stats</h3>
        <div style="text-align: left; margin: 16px 0; font-size: 0.9rem;">
            <p style="margin: 8px 0;"><strong>Filename:</strong><br>${filename}</p>
            <p style="margin: 8px 0;"><strong>Path:</strong><br>${path}</p>
            
            <hr style="margin: 12px 0; border: none; border-top: 1px solid #ddd;">
            
            <p style="margin: 8px 0;"><strong>File Size:</strong> ${formatFileSize(sizeBytes)}</p>
            <p style="margin: 8px 0;"><strong>Duration:</strong> ${formatDuration(durationMs)}</p>
            <p style="margin: 8px 0;"><strong>Dimensions:</strong> ${width && height ? `${width} × ${height}` : 'Unknown'}</p>
            <p style="margin: 8px 0;"><strong>Resolution:</strong> ${resolutionCategory}</p>
            <p style="margin: 8px 0;"><strong>Average Bitrate:</strong> ${bitrateText}</p>
            <p style="margin: 8px 0;"><strong>Quality:</strong> ${bitsPerPixelText}</p>
            
            <hr style="margin: 12px 0; border: none; border-top: 1px solid #ddd;">
            
            <p style="margin: 8px 0;"><strong>Views:</strong> ${viewCount}</p>
            <p style="margin: 8px 0;"><strong>Score:</strong> ${typeof userScore === 'number' ? userScore + '/10' : userScore}</p>
            <p style="margin: 8px 0;"><strong>First Seen:</strong> ${firstSeen}</p>
            <p style="margin: 8px 0;"><strong>Last Played:</strong> ${lastPlayed}</p>
            ${notes ? `<p style="margin: 8px 0;"><strong>Notes:</strong><br>${notes}</p>` : ''}
        </div>
        <button id="statsCloseBtn" class="modal-btn modal-btn-cancel">Close</button>
    </div>
`;
document.body.appendChild(modal);

document.getElementById('statsCloseBtn').addEventListener('click', () => {
  modal.remove();
});

modal.addEventListener('click', (e) => {
  if (e.target === modal) modal.remove();
});

// ESC key to close
const statsEscHandler = (e) => {
  if (e.key === 'Escape') {
      modal.remove();
      document.removeEventListener('keydown', statsEscHandler);
  }
};
document.addEventListener('keydown', statsEscHandler);
}

/**
* Show confirm modal for F tally increment
* @param {object} video - Video object to increment tally for
* @param {Event} event - Event object for visual feedback on button
* @returns {Promise<boolean>} - True if incremented successfully
*/
async function showFTallyConfirmModal(video, event) {
   return new Promise((resolve) => {
       const modal = document.createElement('div');
       modal.className = 'basket-json-modal';
       modal.innerHTML = `
           <div class="basket-json-modal-content">
               <h3>Increment F Tally</h3>
               <p style="font-size: 0.85rem; color: #666; margin-bottom: 16px;">${video.filename}</p>
               <p style="margin-bottom: 20px;">Add +1 to F tally for this video?</p>
               <div class="basket-json-modal-buttons">
                   <button id="fTallyConfirmBtn" class="modal-btn modal-btn-primary">Confirm</button>
                   <button id="fTallyCancelBtn" class="modal-btn modal-btn-cancel">Cancel</button>
               </div>
           </div>
       `;
       document.body.appendChild(modal);
       
       // Confirm button
       document.getElementById('fTallyConfirmBtn').addEventListener('click', async () => {
           const confirmBtn = document.getElementById('fTallyConfirmBtn');
           confirmBtn.disabled = true;
           confirmBtn.textContent = 'Saving...';
           
           try {
              await window.queueExcelUpdate(video, { increment_f_tally: true });
               
               // Show success
               confirmBtn.textContent = '✅ Success';
               confirmBtn.style.background = '#28a745';
               
               // Visual feedback on original button if event provided
               if (event && event.target) {
                   const btn = event.target;
                   const originalText = btn.textContent;
                   btn.textContent = 'Y';
                   btn.style.background = '#28a745';
                   setTimeout(() => {
                       btn.textContent = originalText;
                       btn.style.background = '#17a2b8';
                   }, 10000);
               }
               
               setTimeout(() => {
                   modal.remove();
                   resolve(true);
               }, 1000);
               
           } catch (err) {
               console.error('Failed to increment F tally:', err);
               confirmBtn.textContent = '❌ Failed';
               confirmBtn.style.background = '#dc3545';
               
               setTimeout(() => {
                   modal.remove();
                   alert('Failed to update tally. Make sure Google Sheets is connected.');
                   resolve(false);
               }, 1500);
           }
       });
       
       // Cancel button
       document.getElementById('fTallyCancelBtn').addEventListener('click', () => {
           modal.remove();
           resolve(false);
       });
       
       // Click outside to cancel
modal.addEventListener('click', (e) => {
  if (e.target === modal) {
      modal.remove();
      resolve(false);
  }
});

// ESC key to cancel
const fTallyEscHandler = (e) => {
if (e.key === 'Escape') {
    modal.remove();
    resolve(false);
    document.removeEventListener('keydown', fTallyEscHandler);
}
};
document.addEventListener('keydown', fTallyEscHandler);
   });
}

// Export globally
window.showFTallyConfirmModal = showFTallyConfirmModal;

// =========================================
// ERROR HANDLING
// =========================================

function handleExcelAPIError(err) {
   if (err.message?.includes('401') || err.message?.includes('403')) {
       if (confirm("Excel Online session expired. Reconnect now?")) {
           signInToExcelOnline();
       } else {
           signOutFromExcelOnline();
       }
   } else {
       alert(`Excel Online error: ${err.message || 'Unknown error'}`);
   }
}

// =========================================
// EXPORT FILTERED VIDEOS TO EXCEL
// =========================================

/**
* Export current filtered videos to raw_data tab in Excel
*/
async function exportToExcelOnline() {
   if (!excelAccessToken) {
       alert("Please connect to Excel Online first");
       signInToExcelOnline();
       return;
   }

   const btn = document.getElementById("exportToExcelBtn");
   const originalText = btn ? btn.textContent : "📊 Export to Excel";
   const originalBg = btn ? btn.style.background : "";
   
   if (btn) {
       btn.disabled = true;
       btn.textContent = "Exporting...";
   }

   try {
       // Get the same filtered videos as CSV export
       const includeTags = Array.from(window.commonSelectedTags);
       const excludeTags = $('#excludeTagSelect').val() || [];
       const minDurationMs = getDurationMsFromInputs("minMinutes", "minSeconds");
       const maxDurationMs = getDurationMsFromInputs("maxMinutes", "maxSeconds");
       const searchText = document.getElementById("filenameSearchBox").value.toLowerCase().trim();

       let videos = await getFilteredVideos(includeTags, excludeTags, minDurationMs, maxDurationMs);

       if (searchText.length > 0) {
           const query = parseSearchQuery(searchText);
           videos = videos.filter(video => matchesSearchQuery(video, query));
       }

       if (videos.length === 0) {
           if (btn) {
               btn.textContent = "❌ No videos";
               btn.style.background = "#dc3545";
               setTimeout(() => {
                   btn.textContent = originalText;
                   btn.style.background = originalBg;
                   btn.disabled = false;
               }, 3000);
           }
           return;
       }

       // Create header row
       const headers = [
           "id", "drive_id", "account_key", "account_name", "path", "filename",
           "web_url", "download_url", "size_bytes", "duration_ms",
           "created_date", "last_modified_date", "mime_type",
           "width", "height", "orientation", "bitrate",
           "tags", "bracket_tags",
           "level_1", "level_2", "level_3", "level_4", "level_5", "bookmarks"
       ];

       // Create data rows
       const rows = videos.map(v => [
           v.oneDriveId || "",
           v.driveId || "",
           v.accountKey || "",
           v.accountName || "",
           v.path || "",
           v.filename || "",
           v.webUrl || "",
           v.downloadUrl || "",
           v.sizeBytes ?? "",
           v.durationMs ?? "",
           v.createdDateTime ?? "",
           v.lastModifiedDateTime ?? "",
           v.mimeType || "",
           v.width ?? "",
           v.height ?? "",
           v.orientation || "",
           v.bitrate ?? "",
           Array.isArray(v.tags) ? v.tags.join(";") : "",
           Array.isArray(v.bracketTags) ? v.bracketTags.join(";") : "",
           v.level_1 || "",
           v.level_2 || "",
           v.level_3 || "",
           v.level_4 || "",
           v.level_5 || "",
           JSON.stringify(v.bookmarks || [])
       ]);

       const allRows = [headers, ...rows];

// Calculate the range we need to write to
const lastRow = allRows.length;
const lastCol = headers.length;
const columnLetter = String.fromCharCode(64 + lastCol); // Convert number to letter (1=A, 2=B, etc)
const rangeAddress = `A1:${columnLetter}${lastRow}`;

console.log(`Writing ${allRows.length} rows to Excel range: ${rangeAddress}`);

// Create a session for bulk operations (more reliable)
const sessionResponse = await fetch(
    `https://graph.microsoft.com/v1.0/me/drive/items/${EXCEL_WORKBOOK_ID}/workbook/createSession`,
    {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${excelAccessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ persistChanges: true })
    }
);

if (!sessionResponse.ok) {
    throw new Error(`Failed to create session: HTTP ${sessionResponse.status}`);
}

const session = await sessionResponse.json();
const sessionHeaders = {
    'Authorization': `Bearer ${excelAccessToken}`,
    'Content-Type': 'application/json',
    'workbook-session-id': session.id
};

// Clear existing data in raw_data sheet (entire used range)
const clearResponse = await fetch(
    `https://graph.microsoft.com/v1.0/me/drive/items/${EXCEL_WORKBOOK_ID}/workbook/worksheets/raw_data/usedRange/clear`,
    {
        method: 'POST',
        headers: sessionHeaders,
        body: JSON.stringify({ applyTo: 'Contents' })
    }
);

if (!clearResponse.ok) {
    console.warn('Clear operation failed, continuing anyway');
}

// Write to Excel with calculated range
const writeResponse = await fetch(
    `https://graph.microsoft.com/v1.0/me/drive/items/${EXCEL_WORKBOOK_ID}/workbook/worksheets/raw_data/range(address='${rangeAddress}')`,
    {
        method: 'PATCH',
        headers: sessionHeaders,
        body: JSON.stringify({ values: allRows })
    }
);

// Close the session
await fetch(
    `https://graph.microsoft.com/v1.0/me/drive/items/${EXCEL_WORKBOOK_ID}/workbook/closeSession`,
    {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${excelAccessToken}`,
            'Content-Type': 'application/json',
            'workbook-session-id': session.id
        }
    }
);

if (!writeResponse.ok) {
    const errorData = await writeResponse.json().catch(() => ({}));
    throw new Error(`Write failed: HTTP ${writeResponse.status} - ${errorData.error?.message || 'Unknown error'}`);
}

       console.log(`Exported ${videos.length} videos to Excel raw_data tab`);

       if (btn) {
           btn.textContent = `✅ Success (${videos.length})`;
           btn.style.background = "#28a745";
           
           setTimeout(() => {
               btn.textContent = originalText;
               btn.style.background = originalBg;
               btn.disabled = false;
           }, 5000);
       }

   } catch (err) {
       console.error("Failed to export to Excel:", err);
       
       if (btn) {
           btn.textContent = "❌ Failed";
           btn.style.background = "#dc3545";
           
           setTimeout(() => {
               btn.textContent = originalText;
               btn.style.background = originalBg;
               btn.disabled = false;
           }, 3000);
       }
       
       handleExcelAPIError(err);
   }
}

/**
* Show modal to input basket name (replaces prompt)
*/
function showBasketNameModal(defaultName = null) {
   return new Promise((resolve) => {
       const suggestedName = defaultName || `Basket ${new Date().toLocaleString()}`;
       
       const modal = document.createElement('div');
       modal.className = 'basket-json-modal';
       modal.innerHTML = `
        <div class="basket-json-modal-content">
            <h3>Save Basket to Excel</h3>
               <p style="margin-bottom: 16px; color: #666;">Enter a name for this basket:</p>
               <input type="text" id="basketNameInput" value="${suggestedName}" 
                      placeholder="Basket name" 
                      style="width: 100%; padding: 10px; font-size: 1rem; border: 2px solid #ddd; border-radius: 4px; box-sizing: border-box; margin-bottom: 16px;">
               <div class="basket-json-modal-buttons">
                   <button id="saveBasketNameBtn" class="modal-btn modal-btn-primary">Save to Sheets</button>
                   <button id="cancelBasketNameBtn" class="modal-btn modal-btn-cancel">Cancel</button>
               </div>
           </div>
       `;
       document.body.appendChild(modal);
       
       const input = document.getElementById('basketNameInput');
       const saveBtn = document.getElementById('saveBasketNameBtn');
       
       // Focus and select input
       setTimeout(() => {
           input.focus();
           input.select();
       }, 100);
       
       // Save button
       saveBtn.addEventListener('click', async () => {
           const name = input.value.trim();
           if (!name) {
               alert('Please enter a basket name');
               return;
           }
           
           saveBtn.disabled = true;
           saveBtn.textContent = 'Saving...';
           
           // Resolve with name - parent function will do the actual save
           // We need to wait for save to complete, so pass the save logic here
           try {
 // COMPRESSED: Only store oneDriveIds (30x smaller)
 const videoIds = window.basketVideos.map(v => v.oneDriveId).filter(Boolean);
 
 const basketData = {
     version: "2.0",
     exportDate: new Date().toISOString(),
     itemCount: videoIds.length,
     videoIds: videoIds
 };
 
 const newRow = [
     `basket_${Date.now()}`,
     name,
     new Date().toISOString(),
     window.basketVideos.length,
     JSON.stringify(basketData)
 ];
 
 // Read all existing baskets to find next row
let allBaskets = [];
try {
    const readResponse = await fetch(
        `https://graph.microsoft.com/v1.0/me/drive/items/${EXCEL_WORKBOOK_ID}/workbook/worksheets/${SHEETS.BASKETS}/range(address='A2:E100000')`,
        {
            headers: {
                'Authorization': `Bearer ${excelAccessToken}`
            }
        }
    );
    
    if (readResponse.ok) {
        const data = await readResponse.json();
        // ✅ Filter out empty rows (where first column is null/empty)
        allBaskets = (data.values || []).filter(row => row && row[0]);
    }
} catch (readErr) {
    console.warn('Could not read existing baskets, will start fresh:', readErr);
}

// ✅ Find next empty row: header (row 1) + actual data rows
let nextRow = 2 + allBaskets.length;

console.log(`Writing basket to row ${nextRow} (${allBaskets.length} existing baskets found)`);
 
 // Write new basket
 const writeResponse = await fetch(
     `https://graph.microsoft.com/v1.0/me/drive/items/${EXCEL_WORKBOOK_ID}/workbook/worksheets/${SHEETS.BASKETS}/range(address='A${nextRow}:E${nextRow}')`,
     {
         method: 'PATCH',
         headers: {
             'Authorization': `Bearer ${excelAccessToken}`,
             'Content-Type': 'application/json'
         },
         body: JSON.stringify({ values: [newRow] })
     }
 );
 
 if (!writeResponse.ok) {
    const errorData = await writeResponse.json().catch(() => ({}));
    console.error('Write response:', errorData);
    throw new Error(`HTTP ${writeResponse.status} - ${errorData.error?.message || 'Unknown error'}`);
}
           
           console.log(`Saved basket to Excel: ${name}`);
              
              // Show success
              saveBtn.textContent = '✅ Success';
               saveBtn.style.background = '#28a745';
               
               setTimeout(() => {
                   modal.remove();
                   resolve(name);
               }, 1000);
               
           } catch (err) {
               console.error("Failed to save basket:", err);
               saveBtn.textContent = '❌ Failed';
               saveBtn.style.background = '#dc3545';
               
               setTimeout(() => {
                   saveBtn.disabled = false;
                   saveBtn.textContent = 'Save to Excel';
                   saveBtn.style.background = '#007bff';
                   alert(`Save failed: ${err.message}`);
               }, 1500);
           }
       });
       
       // Cancel button
       document.getElementById('cancelBasketNameBtn').addEventListener('click', () => {
           modal.remove();
           resolve(null);
       });
       
       // Enter key to confirm, ESC to cancel
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
      saveBtn.click();
  } else if (e.key === 'Escape') {
      modal.remove();
      resolve(null);
  }
});
       
       // Close on background click
       modal.addEventListener('click', (e) => {
           if (e.target === modal) {
               modal.remove();
               resolve(null);
           }
       });
   });
}

// Save current basket to Excel
async function saveBasketToExcel(basketName) {
   if (!excelAccessToken) {
       alert("Please connect to Excel Online first");
       signInToExcelOnline();
       return;
   }

   // Show modal and wait for save to complete (modal handles the save now)
   await showBasketNameModal(basketName);
}

/**
* Show warning modal when loading basket into empty basket with missing videos
*/
function showImportWarningModal(basketName, totalCount, loadedCount, missingCount, missingVideosByAccount = null) {
  return new Promise((resolve) => {
      const modal = document.createElement('div');
      modal.className = 'basket-json-modal';
      
      // ✅ Build account breakdown if available
      let accountBreakdownHTML = '';
      if (missingVideosByAccount && missingVideosByAccount.size > 0) {
          const accountList = Array.from(missingVideosByAccount.entries())
              .map(([account, count]) => `${account}: ${count} video${count > 1 ? 's' : ''}`)
              .join('<br>');
          accountBreakdownHTML = `
              <p style="margin: 8px 0 0 0; color: #856404; font-size: 0.9rem;">
                  <strong>Missing by account:</strong><br>
                  ${accountList}
              </p>
          `;
      }
      
      modal.innerHTML = `
          <div class="basket-json-modal-content">
              <h3>⚠️ Import Warning</h3>
              <p style="margin-bottom: 16px;">Basket: <strong>${basketName}</strong></p>
              <div style="background: #fff3cd; border: 1px solid #ffc107; border-radius: 4px; padding: 12px; margin-bottom: 16px;">
                  <p style="margin: 0; color: #856404; font-size: 0.9rem;">
                      ${missingCount} video${missingCount > 1 ? 's' : ''} from this basket ${missingCount > 1 ? 'are' : 'is'} no longer in your database.
                  </p>
                  ${accountBreakdownHTML}
                  <p style="margin: 8px 0 0 0; color: #856404; font-size: 0.9rem;">
                      Loading ${loadedCount} of ${totalCount} videos.
                  </p>
              </div>
              <div class="basket-json-modal-buttons">
                  <button id="proceedImportBtn" class="modal-btn modal-btn-primary">Continue</button>
                  <button id="cancelImportBtn" class="modal-btn modal-btn-cancel">Cancel</button>
              </div>
          </div>
      `;
      document.body.appendChild(modal);
      
      const proceedBtn = document.getElementById('proceedImportBtn');
      const cancelBtn = document.getElementById('cancelImportBtn');
      
      proceedBtn.addEventListener('click', () => {
          proceedBtn.disabled = true;
          cancelBtn.disabled = true;
          proceedBtn.textContent = '✅ Success';
          proceedBtn.style.background = '#28a745';
          
          setTimeout(() => {
              modal.remove();
              resolve(true);
          }, 1000);
      });
      
      cancelBtn.addEventListener('click', () => {
          modal.remove();
          resolve(false);
      });
      
      modal.addEventListener('click', (e) => {
          if (e.target === modal) {
              modal.remove();
              resolve(false);
          }
      });
  });
}

/**
* Show error modal when no videos can be loaded
*/
function showImportErrorModal(basketName, totalCount, loadedCount, missingVideosByAccount = null) {
  return new Promise((resolve) => {
      const modal = document.createElement('div');
      modal.className = 'basket-json-modal';
      
      // ✅ Build account breakdown if available
      let accountBreakdownHTML = '';
      if (missingVideosByAccount && missingVideosByAccount.size > 0) {
          const accountList = Array.from(missingVideosByAccount.entries())
              .map(([account, count]) => `${account}: ${count} video${count > 1 ? 's' : ''}`)
              .join('<br>');
          accountBreakdownHTML = `
              <p style="margin: 8px 0 0 0; color: #c62828; font-size: 0.9rem;">
                  <strong>Missing by account:</strong><br>
                  ${accountList}
              </p>
          `;
      }
      
      modal.innerHTML = `
          <div class="basket-json-modal-content">
              <h3 style="color: #f44336;">❌ Import Failed</h3>
              <p style="margin-bottom: 16px;">Basket: <strong>${basketName}</strong></p>
              <div style="background: #ffebee; border: 1px solid #f44336; border-radius: 4px; padding: 12px; margin-bottom: 16px;">
                  <p style="margin: 0; color: #c62828; font-size: 0.9rem;">
                      No videos could be loaded from this basket.
                  </p>
                  <p style="margin: 8px 0 0 0; color: #c62828; font-size: 0.9rem;">
                      All ${totalCount} videos are missing from your database.
                  </p>
                  ${accountBreakdownHTML}
              </div>
              <button id="closeErrorBtn" class="modal-btn modal-btn-cancel" style="width: 100%;">Close</button>
          </div>
      `;
      document.body.appendChild(modal);
      
      document.getElementById('closeErrorBtn').addEventListener('click', () => {
  modal.remove();
  resolve();
});

modal.addEventListener('click', (e) => {
  if (e.target === modal) {
      modal.remove();
      resolve();
  }
});

// ESC key to close
const escHandler = (e) => {
  if (e.key === 'Escape') {
      modal.remove();
      resolve();
      document.removeEventListener('keydown', escHandler);
  }
};
document.addEventListener('keydown', escHandler);
  });
}

/**
* Show score confirmation tooltip at center of screen
* @param {string} message - Message to display
* @param {string} bgColor - Background color (optional, defaults to green)
*/
function showScoreConfirmation(message, bgColor = '#28a745') {
const tooltip = document.createElement('div');
tooltip.className = 'score-confirmation-tooltip';
tooltip.innerHTML = message;  // FIXED - renders HTML properly
tooltip.style.background = bgColor;

// Position at bottom of screen (matches sync confirmation)
tooltip.style.position = 'fixed';
tooltip.style.left = '50%';
tooltip.style.bottom = '120px'; // Above corner buttons and floating pills
tooltip.style.transform = 'translateX(-50%)';
 
 document.body.appendChild(tooltip);
 
 // Fade in
 setTimeout(() => tooltip.classList.add('show'), 10);
 
 // Fade out and remove
setTimeout(() => {
  tooltip.classList.remove('show');
  setTimeout(() => tooltip.remove(), 300);
}, 1500);
}

/**
* Show sync confirmation tooltip at bottom of screen
* @param {string} message - Message to display
* @param {string} bgColor - Background color (optional, defaults to green)
*/
function showSyncConfirmation(message, bgColor = '#28a745') {
const tooltip = document.createElement('div');
tooltip.className = 'sync-confirmation-tooltip';
tooltip.innerHTML = message;
tooltip.style.background = bgColor;
 
 // Position at bottom of screen
 tooltip.style.position = 'fixed';
 tooltip.style.left = '50%';
 tooltip.style.bottom = '120px'; // Above corner buttons and floating pills
 tooltip.style.transform = 'translateX(-50%)';
 
 document.body.appendChild(tooltip);
 
 // Fade in
 setTimeout(() => tooltip.classList.add('show'), 10);
 
 // Fade out and remove
setTimeout(() => {
  tooltip.classList.remove('show');
  setTimeout(() => tooltip.remove(), 300);
}, 2000); // Show for 2 seconds (longer than score confirmation)
}

/**
* Show a smaller confirmation tooltip specifically for bookmark saves
* @param {string} message - Message to display
* @param {string} bgColor - Background color (optional, defaults to green)
* @param {boolean} persist - If true, tooltip stays open until manually closed/updated
* @returns {HTMLElement} - The tooltip element (useful when persist=true)
*/
function showBookmarkConfirmation(message, bgColor = '#28a745', persist = false) {
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
}

/**
* Update an existing persistent bookmark tooltip's message/color
* @param {HTMLElement} tooltip - Tooltip returned from showBookmarkConfirmation
* @param {string} message - New message
* @param {string} bgColor - New background color
*/
function updateBookmarkConfirmation(tooltip, message, bgColor) {
if (!tooltip) return;
tooltip.innerHTML = message;
tooltip.style.background = bgColor;
}

/**
* Close a persistent bookmark tooltip with fade-out
* @param {HTMLElement} tooltip - Tooltip to close
* @param {number} delay - Delay before starting fade-out (ms)
*/
function closeBookmarkConfirmation(tooltip, delay = 1300) {
if (!tooltip) return;
setTimeout(() => {
    tooltip.classList.remove('show');
    setTimeout(() => tooltip.remove(), 300);
}, delay);
}

// Export globally
window.showSyncConfirmation = showSyncConfirmation;
window.showBookmarkConfirmation = showBookmarkConfirmation;
window.updateBookmarkConfirmation = updateBookmarkConfirmation;
window.closeBookmarkConfirmation = closeBookmarkConfirmation;

// =========================================
// EXPORT GLOBALS
// =========================================

// =========================================
// EXPORT GLOBALS
// =========================================

window.initExcelOnlineAPI = initExcelOnlineAPI;
window.signInToExcelOnline = signInToExcelOnline;
window.signOutFromExcelOnline = signOutFromExcelOnline;
window.refreshExcelTokenSilently = refreshExcelTokenSilently;
window.saveBasketToExcel = saveBasketToExcel;
window.loadBasketsFromExcel = loadBasketsFromExcel;
window.showBasketPickerModal = showBasketPickerModal;
window.updateVideoInExcel = updateVideoInExcel;
window.getVideoFromExcel = getVideoFromExcel;
window.loadAllVideosFromExcel = loadAllVideosFromExcel;
window.loadAllVideoScoresFromExcel = loadAllVideoScoresFromExcel;
window.showVideoScoringModal = showVideoScoringModal;
window.showVideoStatsModal = showVideoStatsModal;
window.excelAccessToken = excelAccessToken;
window.exportToExcelOnline = exportToExcelOnline;
window.saveScoresToIndexedDB = saveScoresToIndexedDB;
window.getTopBookmarkNotes = getTopBookmarkNotes;
window.updateExcelConnectionStatus = updateExcelConnectionStatus;

// =========================================
// SCORE BUTTON STYLES (injected into page)
// =========================================
if (!document.getElementById('scoreButtonStyles')) {
const style = document.createElement('style');
style.id = 'scoreButtonStyles';
style.textContent = `
    /* Score modal compact sizing */
    .score-modal-content {
        max-width: 400px;
        padding: 16px;
    }
    
    @media (max-width: 768px) {
        .score-modal-content {
            max-width: 95%;
            padding: 12px;
        }
        
        .score-modal-content h3 {
            font-size: 0.9rem !important;
        }
        
        .score-modal-content p {
            font-size: 0.75rem !important;
        }
    }
    
    /* Score context menu - compact grid */
.score-context-menu {
   position: fixed;
   background: white;
   border: 2px solid #007bff;
   border-radius: 8px;
   box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
   z-index: 2147483647;
   padding: 8px;
}

.score-grid {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 6px;
}

/* Mobile: 3 columns for better fit */
@media (max-width: 768px) {
  .score-grid {
      grid-template-columns: repeat(3, 1fr);
  }
}

.score-grid-btn {
   background: #e0e0e0;
   color: #333;
   border: 1px solid #ccc;
   padding: 8px;
   border-radius: 4px;
   cursor: pointer;
   font-size: 0.85rem;
   font-weight: bold;
   transition: all 0.15s ease;
   min-width: 36px;
   min-height: 36px;
   text-align: center;
}

.score-grid-btn:hover {
   background: #007bff;
   color: white;
   border-color: #0056b3;
   transform: scale(1.05);
}

.score-grid-btn:active {
  transform: scale(0.95);
}

/* Selected state - orange highlight */
.score-grid-btn.score-selected {
  background: #ff9800;
  color: white;
  border-color: #f57c00;
  font-weight: bold;
}

.score-grid-btn.score-selected:hover {
  background: #f57c00;
}

/* Mobile: larger touch targets */
@media (max-width: 768px) {
   .score-grid {
       gap: 8px;
   }
   
   .score-grid-btn {
       padding: 12px;
       font-size: 1rem;
       min-width: 44px;
       min-height: 44px;
   }
}
`;
document.head.appendChild(style);
}

// Initialize on load
window.addEventListener('DOMContentLoaded', () => {
   initExcelOnlineAPI();
}); 
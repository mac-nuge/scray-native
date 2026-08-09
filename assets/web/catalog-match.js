/**
 * Tiered catalogue matcher — matches local video files against catalogue rows.
 *
 * Extracted from excel-sheets.js, which the native build never loads. Both
 * db.js (exportVideosToCsv) and local-library.js call these unguarded, so
 * without this file native throws "Can't find variable: buildCatalogIndex"
 * the moment you export a CSV.
 *
 * Pure functions, no Excel or network dependency despite the origin — safe to
 * load in both builds. Picker keeps its own copy inside excel-sheets.js; if you
 * change the matching rules, change both.
 */

// =========================================
// TIERED CATALOGUE MATCHER
// Built from measurements on a 6,522-video catalogue vs 422 local files:
//   - exact byte size resolves 236 uniquely, 12 ambiguously
//   - fuzzy size is WORSE THAN USELESS: at 0.1% tolerance it "matches" 150
//     files whose names appear nowhere in the catalogue. Never tolerance size.
//   - normalised filename added ZERO matches beyond size. Kept only as a
//     last resort for rows with no size on either side.
// =========================================

const NUMERIC_FIELDS_CM = new Set(["file_size_bytes","duration_ms","width","height","bitrate","view_count","user_score","f_tally"]);
function toNum(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

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

console.log("history.js loaded, version X");

// ===== history.js =====
/* =========================================
   One history for every player (picker 15.104 / native 15.123 / browse 15.177)

   The list lives on the server (api.php play_history_*), newest 100 plays,
   shared by Picker and every Native install. This device keeps:
     historyEntries  [{ hid, key, at }] - the shared list as last seen, with
                     this device's unsent changes on top. A few KB in
                     localStorage, so it shows straight away on start.
     historyOutbox   changes not yet on the server - plays, REM, CLR ALL - in
                     order, kept across restarts and sent when there's a
                     connection.
     historyVideos   what the panel, H< and the player walk: the entries this
                     library can play, as copies of its video records. An
                     entry for a file this device doesn't have (played in
                     Picker from OneDrive, say) isn't shown here but stays in
                     the shared list for the players that do have it.

   It used to be up to 500 whole video records in localStorage, saved on every
   play. On a phone with full storage that write failed (QuotaExceededError)
   and history silently stopped saving. The old list is sent up once, on the
   first start with this version, then removed.
   ========================================= */
const HISTORY_MAX = 100;                          // ⚙️ the server keeps the same
const HISTORY_LS_KEY = "scray_history_v2";        // slim entries
const HISTORY_OUTBOX_KEY = "scray_history_outbox_v1";
const HISTORY_LEGACY_KEY = "scray_history";       // the old full-record list
const HISTORY_PULL_THROTTLE_MS = 5000;            // ⚙️

function historyReadLs(k, fallback) {
try { const v = JSON.parse(localStorage.getItem(k) || "null"); return v == null ? fallback : v; }
catch (e) { return fallback; }
}

let historyEntries = (historyReadLs(HISTORY_LS_KEY, []) || []).filter(e => e && e.key);
let historyOutbox  = (historyReadLs(HISTORY_OUTBOX_KEY, []) || []).filter(o => o && o.op);
let   // (P) play link
historyVideos = [];
let selectedHistoryIds = new Set();

// The library's records by key, for turning entries into playable videos.
let historyLibrary = new Map();
let historyLibraryAt = 0;
let historyUnresolvedSig = "";

// ✅ Export globally IMMEDIATELY
window.historyVideos = historyVideos;
window.selectedHistoryIds = selectedHistoryIds;

/** Same key the basket and the server use: the stored key wins over the filename. */
function historyKeyFor(v) {
if (!v) return "";
if (v.videoKey) return v.videoKey;
if (typeof window.scrayKeyFor === "function") { const k = window.scrayKeyFor(v); if (k) return k; }
return typeof window.scrayVideoKey === "function"
    ? window.scrayVideoKey(v.filename || "")
    : String(v.filename || "").normalize("NFC").trim().toLowerCase();
}

// ✅ Generate unique ID for each history entry
function generateHistoryId() {
return `hist-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// Toggle selection for a history item (now using historyId instead of oneDriveId)
function toggleHistorySelection(historyId) {
if (selectedHistoryIds.has(historyId)) {
    selectedHistoryIds.delete(historyId);
} else {
    selectedHistoryIds.add(historyId);
}
renderHistory();
}

// Clear all selections
function clearHistorySelection() {
selectedHistoryIds.clear();
renderHistory();
}

// Local save: only the slim entries and the outbox - a few KB - batched a
// moment after the change, and written at once if the app is backgrounded or
// the page reloaded.
const HISTORY_SAVE_DELAY_MS = 1500; // ⚙️
let historySaveTimer = null;
let historySavePending = false;

function flushHistorySave() {
clearTimeout(historySaveTimer);
historySaveTimer = null;
if (!historySavePending) return;
historySavePending = false;
try {
    localStorage.setItem(HISTORY_OUTBOX_KEY, JSON.stringify(historyOutbox));
    localStorage.setItem(HISTORY_LS_KEY, JSON.stringify(historyEntries));
} catch (err) {
    console.error("Saving history failed:", err);
}
}

/**
 * Called after anything changes history - here, and by the other files after
 * they patch a history item in place (bookmarks, a rename). Those patches live
 * on the copies in memory; what's stored is only which files, in what order.
 */
function saveHistory() {
window.historyVideos = historyVideos;
historySavePending = true;
clearTimeout(historySaveTimer);
historySaveTimer = setTimeout(flushHistorySave, HISTORY_SAVE_DELAY_MS);
}

document.addEventListener("visibilitychange", () => {
if (document.hidden) flushHistorySave();
});
window.addEventListener("pagehide", flushHistorySave);

/**
 * historyEntries -> historyVideos. A copy already made for an entry is kept,
 * so whatever the other files patched onto it (bookmarks, score) stays.
 */
function rebuildHistoryVideos() {
const prev = new Map(historyVideos.map(v => [v.historyId, v]));
const out = [];
historyEntries.forEach(e => {
    const had = prev.get(e.hid);
    if (had && historyKeyFor(had) === e.key) { had.playedAt = e.at; out.push(had); return; }
    const lib = historyLibrary.get(e.key);
    if (!lib) return;
    out.push({ ...lib, historyId: e.hid, playedAt: e.at });
});
const changed = out.length !== historyVideos.length || out.some((v, i) => v !== historyVideos[i]);
historyVideos = out;
window.historyVideos = historyVideos;
if (changed && typeof resetHistoryPlayIndex === "function") resetHistoryPlayIndex();
return changed;
}

function historyUnresolvedKeys() {
const shown = new Set(historyVideos.map(v => v.historyId));
return historyEntries.filter(e => !shown.has(e.hid)).map(e => e.key);
}

/**
 * Read the library into historyLibrary. Only when an entry can't be shown and
 * the set of those has changed since the last read - so a file that's on
 * another device only doesn't cost a full library read on every pull.
 */
async function historyIndexLibrary(force = false) {
const missing = historyUnresolvedKeys();
const sig = missing.join("\n");
if (!force && (!missing.length || sig === historyUnresolvedSig)) return false;
const getAll = window.getAllVideosRaw || window.getAllVideos;   // 🔒 private rows are hidden at render
if (typeof getAll !== "function") return false;
let all = [];
try { all = (await getAll()) || []; } catch (e) { console.warn("[history] library read failed:", e); return false; }
const map = new Map();
all.forEach(v => { const k = historyKeyFor(v); if (k && !map.has(k)) map.set(k, v); });
historyLibrary = map;
historyLibraryAt = Date.now();
rebuildHistoryVideos();
historyUnresolvedSig = historyUnresolvedKeys().join("\n");
return true;
}

/* ---------- server sync ---------- */
let historyReady = false;
let historyPushTimer = null;
let historyPushInFlight = null;
let historyLastPullAt = 0;

function historyApp() { return "native"; }
function historyDevice() { return (window.SCRAY_SYNC && window.SCRAY_SYNC.DEVICE_ID) || ""; }

function queueHistoryOp(op) {
historyOutbox.push(op);
saveHistory();
scheduleHistoryPush();
}

function scheduleHistoryPush(delay = HISTORY_SAVE_DELAY_MS) {
clearTimeout(historyPushTimer);
historyPushTimer = setTimeout(() => { historyPushTimer = null; pushHistory(); }, delay);
}

/** The server's list replaces ours - unless more changes are waiting to go. */
async function applyServerHistory(list) {
if (historyOutbox.length || historyPushTimer) return;
const next = (Array.isArray(list) ? list : [])
    .filter(e => e && e.hid && e.key)
    .map(e => ({ hid: String(e.hid), key: String(e.key), at: Number(e.at) || 0 }))
    .slice(0, HISTORY_MAX);
const sigOf = (l) => l.map(e => `${e.hid}@${e.at}`).join("|");
if (sigOf(next) === sigOf(historyEntries)) return;
historyEntries = next;
rebuildHistoryVideos();
saveHistory();
await historyIndexLibrary();
renderHistory();
}

async function pushHistory() {
if (historyPushInFlight || !historyOutbox.length || typeof window.scrayApiCall !== "function") return;
const sending = historyOutbox.slice(0, 500);
historyPushInFlight = (async () => {
    try {
        const res = await window.scrayApiCall("play_history_apply", {
            method: "POST",
            body: { ops: sending, device: historyDevice(), app: historyApp() },
        });
        historyOutbox.splice(0, sending.length);
        saveHistory();
        if (!historyOutbox.length) await applyServerHistory(res.entries);
    } catch (err) {
        // Offline or the server said no: it stays in the outbox for next time.
        console.warn("[history] sync failed - kept for next time:", err.message || err);
        return "failed";
    }
})();
const r = await historyPushInFlight;
historyPushInFlight = null;
if (r !== "failed" && historyOutbox.length) scheduleHistoryPush(0);
}

async function pullHistory({ force = false } = {}) {
if (typeof window.scrayApiCall !== "function") return;
if (!force && Date.now() - historyLastPullAt < HISTORY_PULL_THROTTLE_MS) return;
historyLastPullAt = Date.now();
if (historyOutbox.length) { pushHistory(); return; }   // its answer is the list
try {
    const res = await window.scrayApiCall("play_history_get");
    await applyServerHistory(res.entries);
} catch (err) {
    console.warn("[history] pull failed:", err.message || err);
}
}

/** The first start with the shared list: send this device's old one up, then drop it. */
function migrateLegacyHistory() {
let legacy = null;
try { legacy = JSON.parse(localStorage.getItem(HISTORY_LEGACY_KEY) || "null"); } catch (e) { legacy = null; }
if (!Array.isArray(legacy)) {
    try { localStorage.removeItem(HISTORY_LEGACY_KEY); } catch (e) {}
    return;
}
const have = new Set(historyEntries.map(e => e.hid));
const adds = legacy.slice(0, HISTORY_MAX)
    .map(v => ({ op: "add", hid: v.historyId || generateHistoryId(), key: historyKeyFor(v), at: Number(v.playedAt) || 0 }))
    .filter(o => o.key && o.at && !have.has(o.hid))
    .reverse();                                   // oldest first, as they were played
// Its records will do until the library has been read.
legacy.forEach(v => { const k = historyKeyFor(v); if (k && !historyLibrary.has(k)) historyLibrary.set(k, v); });
historyEntries = historyEntries
    .concat(adds.map(o => ({ hid: o.hid, key: o.key, at: o.at })))
    .sort((a, b) => b.at - a.at)
    .slice(0, HISTORY_MAX);
historyOutbox = historyOutbox.concat(adds);
// Gone before anything is written, which is what frees the space.
try { localStorage.removeItem(HISTORY_LEGACY_KEY); } catch (e) {}
historySavePending = true;
flushHistorySave();
console.log(`[history] ${adds.length} entr${adds.length === 1 ? "y" : "ies"} from this device's old history queued for the shared list`);
}

async function initHistorySync() {
migrateLegacyHistory();
rebuildHistoryVideos();
await historyIndexLibrary(true);
renderHistory();
historyReady = true;
if (historyOutbox.length) await pushHistory();
else await pullHistory({ force: true });
console.log(`[history] ready - ${historyEntries.length} in the shared list, ${historyVideos.length} playable here`);
}

window.addEventListener("focus", () => { if (historyReady) pullHistory(); });
document.addEventListener("visibilitychange", () => {
if (historyReady && document.visibilityState === "visible") pullHistory();
});
window.addEventListener("online", () => { if (historyReady) pushHistory(); });

window.scrayHistorySync = {
pull: pullHistory,
push: pushHistory,
reindex: () => historyIndexLibrary(true).then(() => renderHistory()),
state: () => ({ entries: historyEntries.length, shown: historyVideos.length, outbox: historyOutbox.length, libraryAt: historyLibraryAt }),
};

/**
 * Drop every history entry for a file that no longer exists on the device.
 *
 * Has to live here: historyVideos is a module-level `let` and window.historyVideos
 * is only a mirror of it, so reassigning the mirror from file-operations.js
 * would leave renderHistory() still reading the old array.
 *
 * Returns how many entries went, so the caller can decide whether to repaint.
 */
function removeFromHistoryByVideoId(oneDriveId) {
if (!oneDriveId) return 0;
const before = historyVideos.length;
// Only from what this device shows (15.123): the plays stay in the shared
// list, for the players that still have the file. Its record leaves the
// library map too, so a rebuild doesn't bring the row back.
historyVideos.forEach(v => {
    if ((v.oneDriveId ?? v.idFromAPI) !== oneDriveId) return;
    const k = historyKeyFor(v);
    if (historyLibrary.get(k) && (historyLibrary.get(k).oneDriveId ?? historyLibrary.get(k).idFromAPI) === oneDriveId) historyLibrary.delete(k);
});
historyVideos = historyVideos.filter(v => (v.oneDriveId ?? v.idFromAPI) !== oneDriveId);
const removed = before - historyVideos.length;
if (!removed) return 0;

window.historyVideos = historyVideos;
// Positions shifted, so a queued play-through would jump to the wrong item.
if (typeof resetHistoryPlayIndex === "function") resetHistoryPlayIndex();
saveHistory();
if (typeof updateHistoryCount === "function") updateHistoryCount();
return removed;
}
window.removeFromHistoryByVideoId = removeFromHistoryByVideoId;

/* =========================================
   History states (picker 15.109 / native 15.130)

   A state is what you'd filtered the list down to: the include picks of every
   class (tags, studios, performers, Stash tags, notes), studio groups, note
   keywords, the intersect switches - and/or the search term. It is only
   REMEMBERED once a video is played from it: arming filters or typing a search
   commits nothing. A play counts when it comes from the filtered list (⚙️
   HISTORY_STATE_CONTEXTS: the main list and X / > / <, the randomiser) - not
   from history or the basket, which don't play from the filters.

   Shown at the top of the history panel, newest first; playing from a state
   again moves it back to the top and counts the play. Tap one to put those
   filters and that search back - replacing the picks and search armed now.
   Excludes, file types, score, orientation and the Stash / BM toggles are left
   as they are. × forgets one; ... > CLR STATES forgets them all.

   Kept on this device only (localStorage) - the shared play list on the
   server has no room for them.
   ========================================= */
const HISTORY_STATES_KEY = "scray_history_states_v1";
const HISTORY_STATES_MAX = 20;                                // ⚙️ kept
const HISTORY_STATES_SHOWN = 4;                               // ⚙️ shown before "more"
const HISTORY_STATE_CONTEXTS = new Set(["main", "random"]);   // ⚙️ plays that commit one

let historyStates = (historyReadLs(HISTORY_STATES_KEY, []) || []).filter(s => s && s.sig && s.inc);
let historyStatesExpanded = false;

function saveHistoryStates() {
try { localStorage.setItem(HISTORY_STATES_KEY, JSON.stringify(historyStates)); }
catch (err) { console.warn("[history] saving states failed:", err); }
}

/** File types are a standing setting (mp4 on open), not a filter you play from. */
function historyStateClasses() {
return ["tag"].concat((window.SCRAY_FACET_CLASSES || []).filter(k => k !== "filetype"));
}

function historyStateSet(kind) {
return kind === "tag" ? window.commonSelectedTags : (window.scrayFacetFilters || {})[kind];
}

function historySortedValues(set) {
return Array.from(set || []).map(v => String(v)).filter(Boolean).sort((a, b) => a.localeCompare(b));
}

function historyStateTerms(st) {
return Object.values(st.inc || {}).reduce((n, a) => n + a.length, 0) + (st.parents || []).length;
}

/** Same filters = same state. A switch only counts where it changes anything. */
function historyStateSig(st) {
return JSON.stringify([
    historyStateClasses().map(k => (st.inc[k] || []).join("\u0001")),
    (st.parents || []).join("\u0001"),
    (st.kw || []).join("\u0001"),
    (st.kw || []).length > 1 && !!st.kwAll,
    historyStateTerms(st) > 1 && !!st.intersect,
    String(st.q || "").toLowerCase(),
]);
}

/** What's armed right now, or null when there's nothing to remember. */
function captureHistoryState() {
const inc = {};
historyStateClasses().forEach(k => {
    const vals = historySortedValues(historyStateSet(k));
    if (vals.length) inc[k] = vals;
});
const box = document.getElementById("filenameSearchBox");
const st = {
    inc,
    parents: historySortedValues(window.scrayStudioParentFilter),
    kw: historySortedValues(window.scrayNoteKeywordFilter),
    kwAll: !!window.scrayNoteKeywordIntersect,
    intersect: !!window.scrayTagIntersect,
    q: box ? String(box.value || "").trim() : "",
};
if (!historyStateTerms(st) && !st.kw.length && !st.q) return null;
st.sig = historyStateSig(st);
return st;
}

/** Called by addToHistory with the play's list context. */
function commitHistoryState(listContext) {
if (!HISTORY_STATE_CONTEXTS.has(listContext)) return;
const st = captureHistoryState();
if (!st) return;
const now = Date.now();
const had = historyStates.find(s => s.sig === st.sig);
historyStates = historyStates.filter(s => s.sig !== st.sig);
historyStates.unshift({
    ...st,
    id: had ? had.id : `state-${now}-${Math.random().toString(36).slice(2, 8)}`,
    at: now,
    plays: ((had && had.plays) || 0) + 1,
});
if (historyStates.length > HISTORY_STATES_MAX) historyStates = historyStates.slice(0, HISTORY_STATES_MAX);
saveHistoryStates();
}

/** Put a state's filters and search back, in place of what's armed now. */
function applyHistoryState(st) {
if (!st || !st.inc) return;
historyStateClasses().forEach(k => {
    const set = historyStateSet(k);
    if (!set) return;
    set.clear();
    (st.inc[k] || []).forEach(v => set.add(v));
});
if (window.scrayStudioParentFilter) {
    window.scrayStudioParentFilter.clear();
    (st.parents || []).forEach(v => window.scrayStudioParentFilter.add(v));
}
if (window.scrayNoteKeywordFilter) {
    window.scrayNoteKeywordFilter.clear();
    (st.kw || []).forEach(v => window.scrayNoteKeywordFilter.add(v));
}
window.scrayNoteKeywordIntersect = !!st.kwAll;
window.scrayTagIntersect = !!st.intersect;

// The search, the way the row menus' 🔍 sets it: both boxes, both ✕.
const q = String(st.q || "");
const box = document.getElementById("filenameSearchBox");
const panelBox = document.getElementById("panelSearchBox");
if (box) box.value = q;
if (panelBox) panelBox.value = q;
const clearX = document.getElementById("clearSearchX");
const panelX = document.getElementById("panelSearchClearX");
if (clearX) clearX.style.display = q ? "block" : "none";
if (panelX) panelX.style.display = q ? "block" : "none";

// No scroll and no panel opening from any of the filter passes below.
window.scraySuppressScrollUntil = Date.now() + 1500;
window.skipPanelAutoOpen = true;
window.skipSearchScroll = true;

// The tag dropdowns show what they hold, not commonSelectedTags - left as
// they were, the next pick in one would put the old state's tags back.
// Each is set to the state's tags it offers; its change handler then finds
// nothing to add or remove.
if (typeof $ === "function" && typeof window.scrayResetSelect === "function") {
    const want = window.commonSelectedTags || new Set();
    ["#tagFilterLevel1Select", "#tagFilterLevel2Select", "#tagFilterLevel3Select", "#tagFilterAllSelect"].forEach(sel => {
        const $s = $(sel);
        if (!$s.length) return;
        const offered = new Set($s.find("option").map(function () { return this.value; }).get());
        const next = [...want].filter(t => offered.has(t)).sort();
        const now = ($s.val() || []).slice().sort();
        if (next.join("\u0001") !== now.join("\u0001")) window.scrayResetSelect(sel, next);
    });
}

if (typeof window.scrayRefreshFilters === "function") window.scrayRefreshFilters();
else if (typeof filterDisplayedByFilename === "function") filterDisplayedByFilename();
if (typeof window.syncFullscreenFilterPill === "function") window.syncFullscreenFilterPill();
}

function forgetHistoryState(id) {
historyStates = historyStates.filter(s => s.id !== id);
saveHistoryStates();
refreshHistoryStatesStrip();
}

function clearHistoryStates() {
historyStates = [];
historyStatesExpanded = false;
saveHistoryStates();
refreshHistoryStatesStrip();
}

function historyAgo(at) {
const s = Math.max(0, Math.round((Date.now() - (Number(at) || 0)) / 1000));
if (s < 60) return "now";
if (s < 3600) return `${Math.floor(s / 60)}m`;
if (s < 86400) return `${Math.floor(s / 3600)}h`;
return `${Math.floor(s / 86400)}d`;
}

/** The states block at the top of the panel, or null when there are none. */
function buildHistoryStatesStrip() {
if (!historyStates.length) return null;
const wrap = document.createElement("div");
wrap.className = "history-states";

const head = document.createElement("div");
head.className = "history-states-head";
head.textContent = `States (${historyStates.length})`;
wrap.appendChild(head);

const cur = captureHistoryState();
const curSig = cur ? cur.sig : "";
const shown = historyStatesExpanded ? historyStates : historyStates.slice(0, HISTORY_STATES_SHOWN);

shown.forEach(st => {
    const row = document.createElement("div");
    row.className = "history-state" + (st.sig === curSig ? " is-active" : "");

    const go = document.createElement("button");
    go.type = "button";
    go.className = "history-state-go";
    go.title = "Put these filters back";
    const pill = (kind, text) => {
        const p = document.createElement("span");
        p.className = `history-state-pill hsp-${kind}`;
        p.textContent = text;
        go.appendChild(p);
    };
    historyStateClasses().forEach(k => (st.inc[k] || []).forEach(v => pill(k, v)));
    (st.parents || []).forEach(v => pill("studio", `${v} ▸`));
    (st.kw || []).forEach(v => pill("notekeyword", v));
    if (historyStateTerms(st) > 1) pill(st.intersect ? "and" : "or", st.intersect ? "ALL" : "ANY");
    if (st.q) pill("search", `🔍 ${st.q}`);
    const meta = document.createElement("span");
    meta.className = "history-state-meta";
    meta.textContent = `${st.plays || 1}▶ · ${historyAgo(st.at)}`;
    go.appendChild(meta);
    go.addEventListener("click", (e) => {
        e.stopPropagation();
        applyHistoryState(st);
        toggleHistory(false);
        const ok = window.showScoreConfirmation || (typeof showScoreConfirmation === "function" ? showScoreConfirmation : null);
        if (ok) ok("✅ State applied");
    });
    row.appendChild(go);

    const x = document.createElement("button");
    x.type = "button";
    x.className = "history-state-x";
    x.title = "Forget this state";
    x.textContent = "×";
    x.addEventListener("click", (e) => { e.stopPropagation(); forgetHistoryState(st.id); });
    row.appendChild(x);

    wrap.appendChild(row);
});

if (historyStates.length > HISTORY_STATES_SHOWN) {
    const more = document.createElement("button");
    more.type = "button";
    more.className = "history-states-more";
    more.textContent = historyStatesExpanded ? "Fewer" : `+${historyStates.length - HISTORY_STATES_SHOWN} more`;
    more.addEventListener("click", (e) => {
        e.stopPropagation();
        historyStatesExpanded = !historyStatesExpanded;
        refreshHistoryStatesStrip();
    });
    wrap.appendChild(more);
}
return wrap;
}

/** Just the states block - its "active" mark follows the filters, not the plays. */
function refreshHistoryStatesStrip() {
const list = document.getElementById("historyList");
if (!list || !historyPanelIsOpen()) return;
const old = list.querySelector(":scope > .history-states");
const next = buildHistoryStatesStrip();
if (old && next) old.replaceWith(next);
else if (old) old.remove();
else if (next) list.insertBefore(next, list.firstChild);
}

function injectHistoryStatesCss() {
if (document.getElementById("scray-history-states-css")) return;
const css = document.createElement("style");
css.id = "scray-history-states-css";
css.textContent = `
#historyList .history-states { padding: 6px; margin-bottom: 6px; background: #eef1f5; border-bottom: 1px solid #d5dae1; }
#historyList .history-states-head { font-size: 0.72rem; font-weight: bold; color: #555; text-transform: uppercase; letter-spacing: 0.04em; margin: 0 0 4px 2px; }
#historyList .history-state { display: flex; align-items: stretch; background: #fff; border: 1px solid #ccc; border-radius: 6px; overflow: hidden; margin-bottom: 4px; }
#historyList .history-state.is-active { border-color: #28a745; box-shadow: inset 0 0 0 1px #28a745; }
#historyList .history-state-go { flex: 1; min-width: 0; min-height: 34px; margin: 0; padding: 4px 6px; display: flex; flex-wrap: wrap; align-items: center; gap: 3px; background: none; border: 0; text-align: left; font: inherit; color: inherit; cursor: pointer; }
#historyList .history-state-pill { font-size: 0.75rem; line-height: 1.5; padding: 0 7px; border-radius: 10px; color: #fff; white-space: nowrap; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
#historyList .hsp-tag { background: #007bff; }
#historyList .hsp-studio { background: #0f8b6c; }
#historyList .hsp-performer { background: #6c5ce7; }
#historyList .hsp-stashtag { background: #b8860b; }
#historyList .hsp-note { background: #6f42c1; }
#historyList .hsp-notekeyword { background: #3d1f7a; }
#historyList .hsp-and { background: #222; }
#historyList .hsp-or { background: #bbb; color: #222; }
#historyList .hsp-search { background: #fff; color: #222; border: 1px solid #999; }
#historyList .history-state-meta { margin-left: auto; padding-left: 6px; font-size: 0.7rem; color: #888; white-space: nowrap; }
#historyList .history-state-x { margin: 0; width: 34px; flex: 0 0 34px; padding: 0; border: 0; border-left: 1px solid #eee; background: #fafafa; color: #999; font-size: 1.05rem; cursor: pointer; }
#historyList .history-states-more { margin: 0; padding: 2px 8px; font-size: 0.75rem; background: none; border: 0; color: #007bff; cursor: pointer; }
`;
document.head.appendChild(css);
}

window.scrayHistoryStates = {
list: () => historyStates.slice(),
capture: captureHistoryState,
apply: applyHistoryState,
forget: forgetHistoryState,
clear: clearHistoryStates,
};

function updateHistoryCount() {
const countEl = document.getElementById("historyCount");
if (countEl) countEl.textContent = historyVideos.length;
}

// ✅ Update history highlights based on basket contents
function updateHistoryHighlights() {
const allHistoryItems = document.querySelectorAll('#historyList li');
if (!allHistoryItems.length) return;
// One lookup set, not a scan of the basket per row (13.182).
const inBasket = new Set((basketVideos || []).map(v => v.oneDriveId));
allHistoryItems.forEach(li => {
    const videoIdInLi = li.dataset.videoId;
    if (inBasket.has(videoIdInLi)) {
        li.classList.add('basket-added');
    } else {
        li.classList.remove('basket-added');
    }
});
}

// ✅ PERFORMANCE (native 13.182): renderHistory used to rebuild all (up to 500)
// rows, each with its button set, on every play - with the panel shut. While
// the panel is closed it now only notes that the rows are out of date and
// keeps the H (n) count right; the rows are built when the panel opens.
let historyRowsStale = true;

function historyPanelIsOpen() {
const panel = document.getElementById("historyPanel");
return !!(panel && panel.classList.contains("history-open"));
}

function renderHistory() {
if (!historyPanelIsOpen()) {
    historyRowsStale = true;
    updateHistoryCount();
    return;
}
historyRowsStale = false;
const historyList = document.getElementById("historyList");
if (!historyList) return;
historyList.innerHTML = '';

// Filter states (15.109 / 15.130) above the plays.
const statesEl = buildHistoryStatesStrip();
if (statesEl) historyList.appendChild(statesEl);

// 🔒 Private folders stay out while locked (picker 15.62 / native 15.73).
const totalSize = historyVideos.reduce((acc, v) => acc + ((window.scrayPrivate && window.scrayPrivate.hides(v)) ? 0 : (v.sizeBytes || 0)), 0);

const totalDiv = document.createElement("div");
totalDiv.className = "history-total-size";
totalDiv.style.fontSize = "0.85rem";
totalDiv.style.padding = "6px";
// Plays this library can't show (another player's files) are still in the shared list (15.123).
const elsewhere = historyEntries.length - historyVideos.length;
totalDiv.textContent = `Total size: ${formatFileSize(totalSize)}` + (elsewhere > 0 ? ` · ${elsewhere} more on other players` : "");
historyList.appendChild(totalDiv);

// Column header - no size column in the panel, and not sortable: history
// stays in the order things were played.
if (typeof window.scrayBuildListHeader === 'function') {
    historyList.appendChild(window.scrayBuildListHeader('history'));
}

historyVideos.forEach((video, idx) => {
if (window.scrayPrivate && window.scrayPrivate.hides(video)) return;   // 🔒 (picker 15.62 / native 15.73)

// ✅ Compact buttons with overflow menu
const buttons = [
{
label: "P",
title: "Play video",
color: "#28a745",
onClick: () => {
  const vid = historyVideos[idx];
  // 'history' as the context, not nothing: that is the door into
  // scrayPlaceHistoryPlay (player.js), which puts < and > back on this file's
  // spot in the MAIN list. Its position in this panel is not walkable.
  window.inlineVideoPlayer?.play(vid, 'history', idx);
  // Still reset the play-through sequence, as passing no context used to do
  // for us: picking a row by hand is not carrying on through history.
  if (typeof window.resetHistoryPlayIndex === 'function') window.resetHistoryPlayIndex();
  // ✅ Close history panel after playing
  if (typeof toggleHistory === 'function') {
      toggleHistory(false);
  }
}
},
{
  label: "D",
  title: "Download",
  onClick: async () => {
      try {
          let vid = historyVideos[idx];
          vid = await refreshVideoBeforeUse(vid);
          if (vid && typeof window.scrayHetznerDownload === "function" && window.scrayHetznerDownload(vid)) {
                 // native 15.10: a Hetzner file downloads in the in-app browser
             } else if (vid && vid.downloadUrl) {
              window.location.href = vid.downloadUrl;
          } else {
              showDownloadError("Missing or expired download URL", historyVideos[idx]);
          }
      } catch (err) {
          console.error("Download failed", err);
          showDownloadError(err.message || 'Download failed', historyVideos[idx]);
      }
  }
},
{
 label: "★",
 title: "Score video",
 color: "#ffc107",
 onClick: (e) => {
     e.stopPropagation();
     if (typeof window.showVideoScoringModal === 'function') {
         window.showVideoScoringModal(video, e);
     }
 }
},
{
label: "B",
title: "Toggle basket",
color: "#e91e63",
onClick: (e) => {
    e.stopPropagation();
    let oneDriveId = video.oneDriveId ?? video.idFromAPI ?? null;
    let driveId = video.driveId ?? null;
    if ((!oneDriveId || !driveId) && video.webUrl) {
        try {
            const u = new URL(video.webUrl);
            const cidParam = u.searchParams.get("cid");
            const idParam = u.searchParams.get("id");
            if (cidParam) driveId = driveId || cidParam;
            if (idParam) oneDriveId = oneDriveId || idParam;
        } catch {}
    }
    const existingIndex = basketVideos.findIndex(v => v.oneDriveId === oneDriveId);
    if (existingIndex >= 0) {
        basketVideos.splice(existingIndex, 1);
        saveBasket();
        renderBasket();
    } else {
        addToBasket({ ...video, oneDriveId, driveId });
    }
    updateHistoryHighlights();
    if (window.updateBasketHighlights) window.updateBasketHighlights();
}
},
{
 label: "Move",
 title: "Move file to different folder",
 color: "#9c27b0",
 onClick: async (e) => {
     e.stopPropagation();
      if (typeof window.showMoveFileModal === 'function') {
          await window.showMoveFileModal(video);
      }
  }
},

{
label: "Refresh Data",
title: "Pull the latest score, bookmarks and counters from the database",
color: "#17a2b8",
onClick: async (e) => {
   e.stopPropagation();
   try {
       await window.refreshVideoFromDb(video);
       await window.refreshAfterDbPull(video);
   } catch (err) {
       console.error('DB refresh failed:', err);
       alert(`Refresh failed: ${err.message}`);
   }
}
},
{
 label: "Open Link",
  title: "Open in OneDrive",
  disabled: !video.webUrl,
  onClick: () => {
      if (video.webUrl) window.open(video.webUrl, '_blank');
  }
},
{
label: "Copy Name",
title: "Copy filename to clipboard",
onClick: (e) => {
    const textToCopy = video.filename || '';
    copyToClipboardWithFeedback(textToCopy, e);
}
},
{
label: "F tally",
title: "Increment F tally",
color: "#17a2b8",
onClick: async (e) => {
   e.stopPropagation();
   if (typeof window.showFTallyConfirmModal === 'function') {
       await window.showFTallyConfirmModal(video, e);
   } else {
              alert('Excel Online not connected');

   }
}
},
{
   label: "Bookmarks",
   title: "Bookmarks",
   color: window.scrayHasBookmarks(video) ? "#6f42c1" : "#ece6f6",
   textColor: window.scrayHasBookmarks(video) ? "white" : "#6f42c1",
   onClick: (e) => {
       e.stopPropagation();
       if (typeof window.showBookmarksModal === 'function') {
           window.showBookmarksModal(video);
       }
   }
 },
 {
   label: "Stats",
   title: "View stats",
  color: "#17a2b8",
  onClick: (e) => {
      e.stopPropagation();
      if (typeof window.showVideoStatsModal === 'function') {
          window.showVideoStatsModal(video);
      }
  }
},
{
  label: "X",
  title: "Delete file",
  color: "#f44336",
  onClick: async (e) => {
      e.stopPropagation();
      if (typeof window.showDeleteModal === 'function') {
          await window.showDeleteModal(video);
      }
  }
}
];

// The row itself is render.js's column row: tap the line to open it, tap the
// number to tick it (what the checkbox did), tap the open row's text to play.
// These buttons are laid out there as B D ★ S BM R …, so this P still decides
// what "play" means here - it closes the panel - and Bookmarks becomes BM.
const selected = selectedHistoryIds.has(video.historyId);
const li = window.scrayBuildListRow(video, idx, {
    list: 'history',
    buttons: () => buttons,
    // One file can be in history more than once; the entry id tells them apart.
    rowKey: video.historyId,
    select: { on: selected, toggle: () => toggleHistorySelection(video.historyId) },
    playedAt: video.playedAt || null
});
li.dataset.historyId = video.historyId;
if (selected) li.classList.add("history-selected");

historyList.appendChild(li);
});
updateHistoryCount();
updateHistoryHighlights();
}

// ✅ Allow duplicates BUT NOT consecutive - only add if different from last played.
// Goes into the shared list (15.123): shown here at once, sent a moment later.
function addToHistory(video, listContext = null) {
// The filters it was played from become a state (15.109 / 15.130).
commitHistoryState(listContext);

let oneDriveId = video.oneDriveId ?? video.idFromAPI ?? null;
let driveId = video.driveId ?? null;

if ((!oneDriveId || !driveId) && video.webUrl) {
    try {
        const u = new URL(video.webUrl);
        const cidParam = u.searchParams.get("cid");
        const idParam = u.searchParams.get("id");
        if (cidParam) driveId = driveId || cidParam;
        if (idParam) oneDriveId = oneDriveId || idParam;
    } catch {}
}

const key = historyKeyFor(video);
if (!key) return;
const now = Date.now();
// The freshest record for this key - it's playing, so this library has it.
historyLibrary.set(key, { ...video, oneDriveId, driveId });

// ✅ Same video as the last one played (on any player): just move its time on.
const last = historyEntries[0];
if (last && last.key === key) {
    last.at = now;
    const shown = historyVideos.find(v => v.historyId === last.hid);
    if (shown) shown.playedAt = now;
    else rebuildHistoryVideos();
    queueHistoryOp({ op: "add", hid: last.hid, key, at: now });
    renderHistory();
    console.log(`Updated timestamp for already-recent video: ${video.filename}`);
    return; // ✅ Don't add duplicate
}

// ✅ Different video - add to beginning with unique ID and timestamp
const hid = generateHistoryId();
historyEntries.unshift({ hid, key, at: now });
historyVideos.unshift({
    ...video,
    oneDriveId,
    driveId,
    historyId: hid, // ✅ Unique ID for this history entry
    playedAt: now
});

// Keep only the last HISTORY_MAX - the server keeps the same
if (historyEntries.length > HISTORY_MAX) historyEntries = historyEntries.slice(0, HISTORY_MAX);
const keep = new Set(historyEntries.map(e => e.hid));
historyVideos = historyVideos.filter(v => keep.has(v.historyId));

window.historyVideos = historyVideos;
queueHistoryOp({ op: "add", hid, key, at: now });
renderHistory();
console.log(`Added to history: ${video.filename}`);
}

function toggleHistory(open = null) {
const panel = document.getElementById("historyPanel");
if (!panel) return;
const isOpening = open ?? !panel.classList.contains("history-open");
panel.classList.toggle("history-open", isOpening);
// Rows are only built while the panel is open (13.182) - catch up now.
if (isOpening && historyRowsStale) renderHistory();
// The states' active mark follows the filters, which change with the panel shut.
else if (isOpening) refreshHistoryStatesStrip();
// ...and with what the other players have added since (15.123).
if (isOpening && historyReady) {
    pullHistory();
    historyIndexLibrary().then((did) => { if (did) renderHistory(); });
}
}

// Clears the shared list - every player's (15.123). A play elsewhere after
// this moment stays.
function clearHistory() {
historyEntries = [];
historyVideos = [];
window.historyVideos = historyVideos;
resetHistoryPlayIndex(); // ✅ Reset play index when history clears
queueHistoryOp({ op: "clear", at: Date.now() });
renderHistory();
console.log("History cleared");
}

function exportHistorySubsetToCSV(subset) {
if (!subset || !subset.length) {
    alert("No history items to export");
    return;
}

const headers = [
    "history_id", "id", "path", "filename", "web_url", "download_url",
    "size_bytes", "duration_ms", "account_name", "account_key", "tags", "played_at"
];

const rows = subset.map(v => [
    `"${(v.historyId || "").replace(/"/g,'""')}"`, // ✅ Include historyId
    `"${(v.oneDriveId || "").replace(/"/g,'""')}"`,
    `"${(v.path || "").replace(/"/g,'""')}"`,
    `"${(v.filename || "").replace(/"/g,'""')}"`,
    `"${v.webUrl || ""}"`,
    `"${v.downloadUrl || ""}"`,
    v.sizeBytes ?? "",
    v.durationMs ?? "",
    `"${(v.accountName || "").replace(/"/g,'""')}"`,
    `"${(v.accountKey || "").replace(/"/g,'""')}"`,
    `"${(Array.isArray(v.tags) ? v.tags.join(";") : "").replace(/"/g,'""')}"`,
    v.playedAt ? new Date(v.playedAt).toISOString() : ""
]);

const csvContent = [headers, ...rows].map(r => r.join(",")).join("\n");
const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
const url = URL.createObjectURL(blob);

const a = document.createElement("a"); 
a.href = url;
a.download = `history_export_${new Date().toISOString().slice(0,10)}.csv`;
document.body.appendChild(a); 
a.click(); 
document.body.removeChild(a);
}

// =========================================
// PLAY LAST PLAYED VIDEO
// =========================================
function playLastPlayedVideo() {
if (!historyVideos || historyVideos.length === 0) {
alert("History is empty");
return;
}

// Skip the most recent (currently playing) and play the one before it
if (historyVideos.length < 2) {
alert("No previous video in history");
return;
}

const video = historyVideos[1];

console.log(`Replaying previous video: ${video.filename}`);

if (window.inlineVideoPlayer) {
window.inlineVideoPlayer.play(video, 'history', 1);

// Mobile: auto-scroll to player
if (window.innerWidth <= 1024) {
  setTimeout(() => {
    const player = document.getElementById("inlineVideoContainer");
    if (player) {
      player.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, 300);
}
}
}

// =========================================
// PLAY THROUGH HISTORY SEQUENTIALLY
// =========================================
let currentHistoryPlayIndex = 0; // Track position in history

function playHistorySequence() {
if (!historyVideos || historyVideos.length === 0) {
  alert("History is empty");
  return;
}

// Play current video
const video = historyVideos[currentHistoryPlayIndex];

console.log(`Playing history item ${currentHistoryPlayIndex + 1}/${historyVideos.length}: ${video.filename}`);

if (window.inlineVideoPlayer) {
  window.inlineVideoPlayer.play(video, 'history', currentHistoryPlayIndex);
  
  // Mobile: auto-scroll to player
  if (window.innerWidth <= 1024) {
    setTimeout(() => {
      const player = document.getElementById("inlineVideoContainer");
      if (player) {
        player.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 300);
  }
}

// Increment for next play
currentHistoryPlayIndex++;

// Wrap around to start
if (currentHistoryPlayIndex >= historyVideos.length) {
  currentHistoryPlayIndex = 0;
  console.log("Reached end of history - will restart from beginning next time");
}
}

// Reset history play index when history changes
function resetHistoryPlayIndex() {
currentHistoryPlayIndex = 0;
console.log("History play index reset to 0");
}

// ✅ Export all functions
window.addToHistory = addToHistory;
window.toggleHistory = toggleHistory;
window.clearHistory = clearHistory;
window.saveHistory = saveHistory;
window.flushHistorySave = flushHistorySave;
window.renderHistory = renderHistory;
window.clearHistorySelection = clearHistorySelection;
window.exportHistorySubsetToCSV = exportHistorySubsetToCSV;
window.toggleHistorySelection = toggleHistorySelection;
window.updateHistoryHighlights = updateHistoryHighlights;
window.playLastPlayedVideo = playLastPlayedVideo;
window.playHistorySequence = playHistorySequence;
window.resetHistoryPlayIndex = resetHistoryPlayIndex;

// =========================================
// TAG BUTTON - Show tags from selected history items
// =========================================
function showHistoryTagSelector() {
const selectedVideos = historyVideos.filter(v => selectedHistoryIds.has(v.historyId));

if (selectedVideos.length === 0) {
  alert("No history items selected");
  return;
}

// Gather all unique tags from selected videos
const tagSet = new Set();
selectedVideos.forEach(video => {
  if (Array.isArray(video.tags)) {
    video.tags.forEach(tag => tagSet.add(tag));
  }
});

const tags = Array.from(tagSet).sort();

if (tags.length === 0) {
  alert("Selected items have no tags");
  return;
}

// Create overlay
const overlay = document.createElement('div');
overlay.className = 'tag-selection-overlay';

const content = document.createElement('div');
content.className = 'tag-selection-content';

const title = document.createElement('h3');
title.textContent = `Tags from ${selectedVideos.length} selected item${selectedVideos.length > 1 ? 's' : ''}`;
content.appendChild(title);

const grid = document.createElement('div');
grid.className = 'tag-selection-grid';

tags.forEach(tag => {
  const pill = document.createElement('div');
  pill.className = 'tag-selection-item';
  pill.textContent = tag;
  pill.title = `Click to filter by "${tag}"`;
  
  pill.addEventListener('click', () => {
    // Add to global selected tags
    window.commonSelectedTags.add(tag);
    
    // Find which dropdown contains this tag and select it
    ['Level1', 'Level2', 'Level3', 'All'].forEach(levelName => {
      const selectId = `tagFilter${levelName}Select`;
      const $select = $(`#${selectId}`);
      
      // Check if this dropdown has this tag as an option
      if ($select.find(`option[value="${tag}"]`).length) {
        const currentVals = $select.val() || [];
        if (!currentVals.includes(tag)) {
          currentVals.push(tag);
          $select.val(currentVals).trigger('change');
        }
      }
    });
    
    // Refresh filters and pills
if (typeof updateFloatingTagPillsFromCommon === 'function') {
  updateFloatingTagPillsFromCommon();
}
window.skipSearchScroll = true;
window.skipPanelAutoOpen = true; // ✅ Prevent panel auto-open
if (typeof filterDisplayedByFilename === 'function') {
  filterDisplayedByFilename();
}
    
    // Visual feedback
    pill.style.background = '#28a745';
    setTimeout(() => {
      pill.style.background = '#007bff';
    }, 200);
  });
  
  grid.appendChild(pill);
});

content.appendChild(grid);

const closeBtn = document.createElement('button');
closeBtn.className = 'tag-selection-close';
closeBtn.textContent = 'Close';
closeBtn.addEventListener('click', () => {
  document.body.removeChild(overlay);
});

content.appendChild(closeBtn);
overlay.appendChild(content);

// Close on background click
overlay.addEventListener('click', (e) => {
if (e.target === overlay) {
  document.body.removeChild(overlay);
}
});

// ESC key to close
const historyTagEscHandler = (e) => {
  if (e.key === 'Escape') {
      overlay.remove();
      document.removeEventListener('keydown', historyTagEscHandler);
  }
};
window.scrayEscapeWhileOpen(overlay, historyTagEscHandler); // not left behind on close (13.182)

document.body.appendChild(overlay);
}

window.showHistoryTagSelector = showHistoryTagSelector;


window.addEventListener("DOMContentLoaded", () => {
injectHistoryStatesCss();

// Behind scrayWatch so the READY toast waits for it, like basket sync.
if (typeof window.scrayWatch === "function") window.scrayWatch("history sync", () => initHistorySync());
else initHistorySync();

// The library changed (a scan, a Hetzner fetch): plays from other players may
// be playable here now.
const syncLib = window.scraySyncLibrary;
if (typeof syncLib === "function" && !syncLib.__historyWrapped) {
    const wrapped = async function (...args) {
        const r = await syncLib.apply(this, args);
        if (historyReady) historyIndexLibrary(true).then(() => renderHistory()).catch(() => {});
        return r;
    };
    wrapped.__historyWrapped = true;
    wrapped.__basketWrapped = syncLib.__basketWrapped;
    window.scraySyncLibrary = wrapped;
}

document.getElementById("historyToggleBtn")?.addEventListener("click", () => toggleHistory());

document.getElementById("playHistorySequenceBtn")?.addEventListener("click", () => {
window.lastPlayLabel = 'Last Played';
if (typeof window.playHistorySequence === 'function') {
  window.playHistorySequence();
}
});

document.getElementById("historySelectAllBtn")?.addEventListener("click", () => {
 historyVideos.forEach(v => selectedHistoryIds.add(v.historyId));
 renderHistory();
});

// ✅ Overflow menu button for history
document.getElementById("historyMoreBtn")?.addEventListener("click", (e) => {
   const subset = historyVideos.filter(v => selectedHistoryIds.has(v.historyId));
   
   const actions = [
       {
           label: "CLR - Clear Selection",
           onClick: () => clearHistorySelection()
       },
       {
         label: "REM - Remove Selected",
         onClick: () => {
             if (!selectedHistoryIds.size) {
                 alert("No history items selected to remove");
                 return;
             }
             // From the shared list too (15.123), so every player loses them.
             const hids = [...selectedHistoryIds];
             historyEntries = historyEntries.filter(e => !selectedHistoryIds.has(e.hid));
             historyVideos = historyVideos.filter(v => !selectedHistoryIds.has(v.historyId));
             window.historyVideos = historyVideos;
             resetHistoryPlayIndex(); // ✅ Reset play index when history changes
             clearHistorySelection();
             queueHistoryOp({ op: "remove", hids });
             renderHistory();
         }
     },
       {
           label: "CSV - Export to CSV",
           onClick: () => {
               if (!subset.length) {
                   alert("No history items selected to export");
                   return;
               }
               exportHistorySubsetToCSV(subset);
           }
       },
       {
           label: "TAG - Filter by Tags",
           onClick: () => showHistoryTagSelector()
       },
       {
           label: "CLR STATES - Forget Filter States",
           onClick: () => {
               if (!historyStates.length) { alert("No filter states to forget"); return; }
               if (confirm(`Forget all ${historyStates.length} filter states?\n\nOnly on this device - the plays stay.`)) clearHistoryStates();
           }
       },
       {
           label: "CLR ALL - Clear Entire History",
           color: "#f44336",
           onClick: () => {
               if (confirm("Clear entire history?\n\nHistory is shared, so this clears it on every player.")) {
                   clearHistory();
               }
           }
       }
   ];
   
   showContextMenu(actions, e);
});

renderHistory();

// Swipe to dismiss (mobile only) - WITH INTERACTIVE ITEM EXCEPTION
if (window.innerWidth < 769) {
let touchStartX = 0;
let touchStartY = 0;
let isSwiping = false;
let isScrolling = false;
let scrollableList = null;
let isInteractiveItem = false; // Track if touch is on interactive element

const historyPanel = document.getElementById("historyPanel");
if (historyPanel) {
    // STEP 1: Capture touches but check if they're on interactive items
    historyPanel.addEventListener("touchstart", e => {
        // Check if touch is on checkbox or button - if so, let it through
        const interactiveEl = e.target.closest('input, button, a, .history-checkbox');
        isInteractiveItem = !!interactiveEl;
        
        if (isInteractiveItem) {
            // Don't interfere with clicks/selections
            return;
        }
        
        e.stopPropagation();
        
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        isSwiping = false;
        isScrolling = false;
        
        // Check if touch started inside scrollable list
        scrollableList = e.target.closest('#historyList');
    }, { passive: false, capture: true });
    
    // STEP 2: Handle touchmove
    historyPanel.addEventListener("touchmove", e => {
        // Skip if interacting with buttons/checkboxes
        if (isInteractiveItem) {
            return;
        }
        
        e.stopPropagation();
        
        const touchCurrentX = e.touches[0].clientX;
        const touchCurrentY = e.touches[0].clientY;
        const deltaX = Math.abs(touchCurrentX - touchStartX);
        const deltaY = Math.abs(touchCurrentY - touchStartY);
        
        // Determine direction on first significant movement
        if (!isSwiping && !isScrolling && (deltaX > 5 || deltaY > 5)) {
            if (deltaX > deltaY) {
                isSwiping = true;
            } else {
                isScrolling = true;
            }
        }
        
        // ALWAYS prevent default UNLESS we're scrolling inside the list
        if (isSwiping || !scrollableList) {
            e.preventDefault();
        }
        
    }, { passive: false, capture: true });
    
    // STEP 3: Handle touchend
    historyPanel.addEventListener("touchend", e => {
        // Skip if interacting with buttons/checkboxes
        if (isInteractiveItem) {
            isInteractiveItem = false;
            return;
        }
        
        e.stopPropagation();
        
        const touchEndX = e.changedTouches[0].clientX;
        
        // Swipe left to close
        if (isSwiping && touchStartX - touchEndX > 50) {
            e.preventDefault();
            historyPanel.classList.remove("history-open");
        }
        
        // Reset
        isSwiping = false;
        isScrolling = false;
        scrollableList = null;
        isInteractiveItem = false;
    }, { passive: false, capture: true });
    
    // STEP 4: Also handle touchcancel
    historyPanel.addEventListener("touchcancel", e => {
        isInteractiveItem = false;
        isSwiping = false;
        isScrolling = false;
        scrollableList = null;
    }, { passive: false, capture: true });
}
}
});

// ✅ Re-render history on orientation change (to update path visibility)
window.addEventListener('orientationchange', () => {
setTimeout(() => {
  if (typeof renderHistory === 'function') {
    renderHistory();
  }
}, 300);
});


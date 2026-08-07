/**
 * Scray sync engine.
 *
 * Model:
 *   - IndexedDB is the local mirror and remains the read path. Nothing in the
 *     UI ever waits on the network.
 *   - Every write goes to IndexedDB immediately AND appends an op to `outbox`.
 *   - Online: the outbox drains within a second, so it feels real-time.
 *   - Offline: the outbox accumulates. On reconnect you get prompted, then it
 *     drains and pulls deltas back.
 *
 * Why ops and not "just send the row":
 *   view_count and f_tally are synced as absolute values, highest wins on
 *   conflict — same rule as last_played (max) and first_seen (min). No
 *   arithmetic, no read-before-write on the server, and these fields never
 *   generate a conflict prompt: the server just keeps whichever number is
 *   bigger. This is deliberately simpler than summing deltas.
 *
 *   The one thing this trades away: it assumes these counters only ever go
 *   up. If you ever add a "reset play count" feature, a reset to 0 will
 *   never survive a sync against a device that already reported a higher
 *   number — the higher number always wins, forever. Fine for the current
 *   app; worth remembering if that changes.
 *
 *   Each app must resolve view_count/f_tally to the actual next absolute
 *   value *before* calling buildOp (i.e. read the current count, add 1,
 *   pass that number) — buildOp does not do read-modify-write itself, it
 *   only compares what it's given against what the server already has.
 *   bookmarks still gets a real union merge, since two devices adding
 *   different bookmarks isn't a "pick one" situation.
 */

const SYNC_OUTBOX = "outbox";
const SYNC_STATE  = "syncState";

// -------------------------------------------------------------
// Field routing — must match api.php's understanding
// -------------------------------------------------------------
const MAX_FIELDS = new Set(["last_played", "view_count", "f_tally"]);
const MIN_FIELDS = new Set(["first_seen"]);

// app camelCase -> sqlite snake_case. Only fields that differ need listing.
const FIELD_MAP = {
  sizeBytes: "file_size_bytes",
  durationMs: "duration_ms",
  mimeType: "mime_type",
  createdDateTime: "created_date",
  lastModifiedDateTime: "last_modified_date",
  driveId: "drive_id",
  accountKey: "account_key",
  accountName: "account_name",
  webUrl: "web_url",
  bracketTags: "bracket_tags",
};
const REVERSE_FIELD_MAP = Object.fromEntries(
  Object.entries(FIELD_MAP).map(([k, v]) => [v, k])
);

function toDbField(k) { return FIELD_MAP[k] || k; }
function toAppField(k) { return REVERSE_FIELD_MAP[k] || k; }
window.scrayToAppField = toAppField;

/** SQLite row -> the flat shape getAllVideos() already returns. */
function dbRowToApp(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (["seq", "updated_at", "updated_by", "deleted"].includes(k)) { out["_" + k] = v; continue; }
    out[k === "one_drive_id" ? "oneDriveId" : toAppField(k)] = v;
  }
  if (typeof out.tags === "string") out.tags = out.tags ? out.tags.split(";") : [];
  if (typeof out.bracketTags === "string") out.bracketTags = out.bracketTags ? out.bracketTags.split(";") : [];
  if (typeof out.bookmarks === "string") {
    try { out.bookmarks = out.bookmarks ? JSON.parse(out.bookmarks) : []; }
    catch { out.bookmarks = []; }
  }
  return out;
}
window.scrayDbRowToApp = dbRowToApp;

// -------------------------------------------------------------
// Outbox
// -------------------------------------------------------------

/**
 * Turn an app-shaped `updates` object into a server op. This is the single
 * translation point between "what the UI did" and "what the server needs".
 *
 * IMPORTANT: view_count and f_tally must already be the absolute next value
 * by the time they reach this function (current count + 1, resolved by the
 * caller) — buildOp does not increment anything itself, it just decides
 * which server bucket (`set`/`max`/`min`/`merge_bookmarks`) a field goes in.
 * The old `increment_views`/`increment_f_tally` pseudo-fields are no longer
 * accepted here for that reason; resolve them before calling buildOp (see
 * Stage 2.2 for Native, Stage 3.1 for Picker).
 */
function buildOp(oneDriveId, updates, baseSeq, defaults) {
  const op = { id: oneDriveId, device: window.SCRAY_SYNC.DEVICE_ID, base_seq: baseSeq ?? 0 };

  for (const [rawKey, value] of Object.entries(updates)) {
    if (rawKey === "increment_views" || rawKey === "increment_f_tally") {
      console.warn(`[sync] buildOp received "${rawKey}" - this must be resolved to an absolute value before calling buildOp. Ignoring.`);
      continue;
    }
    if (rawKey === "played_now") { (op.max ??= {}).last_played = new Date().toISOString(); continue; }

    const key = toDbField(rawKey);

    if (MAX_FIELDS.has(key))     { (op.max ??= {})[key] = value; continue; }
    if (MIN_FIELDS.has(key))     { (op.min ??= {})[key] = value; continue; }

    if (key === "bookmarks") {
      op.merge_bookmarks = Array.isArray(value)
        ? value
        : (() => { try { return JSON.parse(value || "[]"); } catch { return []; } })();
      continue;
    }

    (op.set ??= {})[key] = Array.isArray(value) ? value.join(";") : value;
  }

  if (defaults) op.upsert_defaults = defaults;
  return op;
}
window.scrayBuildOp = buildOp;

/** Append an op to the outbox. Never throws — a failed enqueue must not break a UI action. */
async function enqueueOp(oneDriveId, updates, defaults = null) {
  try {
    const db = await openDB();
    if (!db.objectStoreNames.contains(SYNC_OUTBOX)) return;

    const local = await scrayGetSyncState(`row:${oneDriveId}`);
    const op = buildOp(oneDriveId, updates, local?.seq ?? 0, defaults);

    const tx = db.transaction(SYNC_OUTBOX, "readwrite");
    tx.objectStore(SYNC_OUTBOX).add({ oneDriveId, op, at: new Date().toISOString() });
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });

    if (window.SCRAY_SYNC.AUTO_SYNC_ON_RECONNECT && navigator.onLine) scheduleDrain();
  } catch (err) {
    console.warn("[sync] enqueue failed (change is still saved locally):", err);
  }
}
window.scrayEnqueueOp = enqueueOp;

async function getOutbox() {
  const db = await openDB();
  if (!db.objectStoreNames.contains(SYNC_OUTBOX)) return [];
  return new Promise((res, rej) => {
    const req = db.transaction(SYNC_OUTBOX, "readonly").objectStore(SYNC_OUTBOX).getAll();
    req.onsuccess = () => res(req.result || []);
    req.onerror = () => rej(req.error);
  });
}
window.scrayGetOutbox = getOutbox;

async function clearOutboxEntries(keys) {
  const db = await openDB();
  const tx = db.transaction(SYNC_OUTBOX, "readwrite");
  const store = tx.objectStore(SYNC_OUTBOX);
  keys.forEach(k => store.delete(k));
  return new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
}

// -------------------------------------------------------------
// Sync state (cursor, per-row seq)
// -------------------------------------------------------------
async function scrayGetSyncState(key) {
  const db = await openDB();
  if (!db.objectStoreNames.contains(SYNC_STATE)) return null;
  return new Promise((res, rej) => {
    const req = db.transaction(SYNC_STATE, "readonly").objectStore(SYNC_STATE).get(key);
    req.onsuccess = () => res(req.result || null);
    req.onerror = () => rej(req.error);
  });
}
window.scrayGetSyncState = scrayGetSyncState;

async function scraySetSyncState(key, value) {
  const db = await openDB();
  if (!db.objectStoreNames.contains(SYNC_STATE)) return;
  const tx = db.transaction(SYNC_STATE, "readwrite");
  tx.objectStore(SYNC_STATE).put({ key, ...value });
  return new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
}

// -------------------------------------------------------------
// Transport
// -------------------------------------------------------------
async function apiCall(action, { method = "GET", body = null, params = {} } = {}) {
  const url = new URL(window.SCRAY_SYNC.API_BASE);
  url.searchParams.set("action", action);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 30000);
  try {
    const res = await fetch(url.toString(), {
      method,
      headers: {
        "X-Scray-Key": window.SCRAY_SYNC.API_KEY,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || "api error");
    return json;
  } finally {
    clearTimeout(timer);
  }
}
window.scrayApiCall = apiCall;

/** Real reachability, not navigator.onLine's opinion of it. */
async function isServerReachable() {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), window.SCRAY_SYNC.PING_TIMEOUT_MS);
  try {
    const url = new URL(window.SCRAY_SYNC.API_BASE);
    url.searchParams.set("action", "ping");
    const res = await fetch(url.toString(), { signal: ctl.signal, cache: "no-store" });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
window.scrayIsServerReachable = isServerReachable;

// -------------------------------------------------------------
// Push / pull
// -------------------------------------------------------------
async function pushOutbox() {
  const entries = await getOutbox();
  if (!entries.length) return { pushed: 0, conflicts: [] };

  const size = window.SCRAY_SYNC.PUSH_BATCH_SIZE;
  let pushed = 0;
  const allConflicts = [];

  for (let i = 0; i < entries.length; i += size) {
    const batch = entries.slice(i, i + size);
    const json = await apiCall("push", { method: "POST", body: { ops: batch.map(e => e.op) } });
    allConflicts.push(...(json.conflicts || []));
    await clearOutboxEntries(batch.map(e => e.id));
    pushed += batch.length;
  }
  return { pushed, conflicts: allConflicts };
}
window.scrayPushOutbox = pushOutbox;

/**
 * Pull deltas and write them into the local mirror.
 * `applyRow` is supplied by each app so this file stays storage-agnostic —
 * Native writes to videoSource/videoMeta, Picker may just cache.
 */
async function pullDeltas(applyRow) {
  const cursor = await scrayGetSyncState("cursor");
  let since = cursor?.seq ?? 0;
  let pulled = 0;

  for (;;) {
    const json = await apiCall("pull", { params: { since, limit: 5000 } });
    for (const row of json.videos) {
      await applyRow(dbRowToApp(row), row);
      await scraySetSyncState(`row:${row.one_drive_id}`, { seq: row.seq });
      pulled++;
    }
    since = json.seq;
    await scraySetSyncState("cursor", { seq: since, at: new Date().toISOString() });
    if (!json.more) break;
  }
  return { pulled, seq: since };
}
window.scrayPullDeltas = pullDeltas;

// -------------------------------------------------------------
// Debounced drain for the online case
// -------------------------------------------------------------
let drainTimer = null;
let draining = false;

function scheduleDrain(delay = 800) {
  clearTimeout(drainTimer);
  drainTimer = setTimeout(() => { drainQuietly(); }, delay);
}
window.scraySchedule = scheduleDrain;

async function drainQuietly() {
  if (draining) return;
  draining = true;
  try {
    const { conflicts } = await pushOutbox();
    if (conflicts.length && typeof window.scrayShowConflicts === "function") {
      window.scrayShowConflicts(conflicts);
    }
    window.dispatchEvent(new CustomEvent("scray-sync-done", { detail: { quiet: true } }));
  } catch (err) {
    console.log("[sync] deferred — will retry on next change or reconnect:", err.message);
  } finally {
    draining = false;
  }
}
window.scrayDrainQuietly = drainQuietly;

console.log(`[sync] ready — device ${window.SCRAY_SYNC.DEVICE_ID}`);

// TEMPORARY Stage 1 self-test — delete this block once verified.
// Native has no console input, so the checks run themselves and print
// to the inline console panel at the bottom of the screen.
setTimeout(async () => {
  console.log("=== STAGE 1 SELF-TEST ===");
  console.log("1. DEVICE_ID:", window.SCRAY_SYNC.DEVICE_ID);
  try {
    const reachable = await scrayIsServerReachable();
    console.log("2. server reachable:", reachable);
    if (!reachable) {
      console.error("   → ping failed. Check API_BASE in scray-config.js, and that the URL is https.");
      return;
    }
    const stats = await scrayApiCall("stats");
    console.log("3. stats:", JSON.stringify(stats));
    console.log("=== SELF-TEST PASSED ===");
  } catch (err) {
    console.error("SELF-TEST FAILED:", err.message);
  }
}, 2000);
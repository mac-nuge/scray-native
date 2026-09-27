/**
 * scray-basket-sync.js — Native (native 15.31).
 *
 * Native's basket, shared by every install of Native - the same way Picker's
 * basket is shared by every Picker (Picker has its own copy of this file). The
 * two baskets are separate: Native's is the server's app_state row
 * 'native_basket' (api.php native_basket_get / native_basket_set, browse
 * 15.79), Picker's is 'current_basket'.
 *
 * The row holds video_keys, not ids: a phone file's id is only good on that
 * phone, while the key is the same everywhere.
 *
 * What each install shows is the part of the basket its own library has - its
 * phone files and its Hetzner rows. The rest isn't lost: the keys this install
 * can't show are remembered from the last pull, with the key they came after,
 * and go back into every push in the same place. So removing, adding or
 * reordering here never drops what only another install can play.
 * Clear is the exception - it empties the basket everywhere.
 *
 * Push model: debounced, fired from saveBasket(). Two guards matter -
 *   READY: no push may happen before the first pull has landed, or the empty
 *          boot basket would overwrite the server copy.
 *   SUPPRESS: applying a pulled basket calls saveBasket(), which would
 *          otherwise immediately push the thing we just received.
 *
 * Pull model: on start, whenever the app comes back to the foreground
 * (throttled), and after the library changes, since that can bring in items
 * this install couldn't show before.
 */
(function () {
  const GET = "native_basket_get";
  const SET = "native_basket_set";
  const PUSH_DEBOUNCE_MS = 800;
  const FOCUS_PULL_THROTTLE_MS = 5000;

  let ready = false;        // first pull has completed
  let suppress = false;     // currently applying a pulled basket
  let pushTimer = null;
  let inFlight = null;      // promise of the push currently running
  let pendingAgain = false; // a change arrived while a push was in flight
  let lastPullAt = 0;
  let lastRev = 0;
  let hidden = [];          // [{ key, after }] - in the basket, not in this library
  let cleared = false;      // Clear pressed: the next push drops the hidden ones too
  let seed = false;         // the server has never had a basket: send this device's instead of wiping it

  // ---------------------------------------------------------------
  // Traffic light - grey idle, amber syncing, green synced, red error
  // ---------------------------------------------------------------
  let state = "idle";
  let stateTitle = "Basket sync idle";

  function setState(next, title) {
    state = next;
    stateTitle = title || next;
    paint();
  }

  function paint() {
    document.querySelectorAll(".basket-sync-light").forEach((el) => {
      el.className = `basket-sync-light basket-sync-${state}`;
      el.title = stateTitle;
    });
  }

  /** Called by renderBasket() when it builds the total-size row. */
  function makeLight() {
    const dot = document.createElement("span");
    dot.className = `basket-sync-light basket-sync-${state}`;
    dot.title = stateTitle;
    return dot;
  }

  // ---------------------------------------------------------------
  // Keys
  // ---------------------------------------------------------------
  /** The stored key wins: Native adopts fingerprint-matched keys that differ from the filename. */
  function keyFor(v) {
    if (!v) return "";
    if (v.videoKey) return v.videoKey;
    return typeof window.scrayVideoKey === "function"
      ? window.scrayVideoKey(v.filename || "")
      : String(v.filename || "").trim().toLowerCase();
  }

  function keysFromBasket() {
    const seen = new Set();
    const out = [];
    (window.basketVideos || []).forEach((v) => {
      const k = keyFor(v);
      if (!k || seen.has(k)) return;   // a basket is a set, not a bag
      seen.add(k);
      out.push(k);
    });
    return out;
  }

  /** This install's basket, with the keys only other installs can show put back where they were. */
  function keysToPush() {
    const local = keysFromBasket();
    if (cleared) return local;
    const have = new Set(local);
    const after = new Map();              // anchor key (or "") -> hidden keys that follow it
    hidden.forEach(({ key, after: a }) => {
      if (have.has(key)) return;          // it's showing here now
      const k = a || "";
      if (!after.has(k)) after.set(k, []);
      after.get(k).push(key);
    });
    const out = [];
    const put = (k) => { if (!have.has(k)) { have.add(k); out.push(k); } };
    (after.get("") || []).forEach(put);
    after.delete("");
    local.forEach((k) => {
      out.push(k);
      (after.get(k) || []).forEach(put);
      after.delete(k);
    });
    after.forEach((ks) => ks.forEach(put)); // their anchor was removed here: keep them, at the end
    return out;
  }

  /** video_keys -> this library's videos, in order, and the ones it doesn't have. */
  async function resolveKeys(keys) {
    const all = typeof window.getAllVideos === "function" ? await window.getAllVideos() : [];
    const byKey = new Map();
    all.forEach((v) => {
      const k = keyFor(v);
      if (k && !byKey.has(k)) byKey.set(k, v);
    });
    const videos = [];
    const missing = [];
    let lastShown = "";
    keys.forEach((k) => {
      const hit = byKey.get(k);
      if (hit) { videos.push(hit); lastShown = k; }
      else missing.push({ key: k, after: lastShown });
    });
    return { videos, missing };
  }

  // ---------------------------------------------------------------
  // Push
  // ---------------------------------------------------------------
  async function pushNow() {
    // Another device may have changed the basket since this one last looked:
    // take the items only it can show from the server's copy as it is now, so
    // they aren't lost or put back in old places. (What's showing here is
    // still this device's to decide - last change wins, as in Picker.)
    if (!cleared) {
      try {
        const cur = await window.scrayApiCall(GET);
        if ((cur.rev || 0) !== lastRev) hidden = (await resolveKeys(Array.isArray(cur.keys) ? cur.keys : [])).missing;
      } catch (err) { /* offline: the last pull's list will do */ }
    }
    const keys = keysToPush();
    const shown = (window.basketVideos || []).length;
    setState("syncing", `Syncing ${keys.length} item(s)...`);
    try {
      const res = await window.scrayApiCall(SET, {
        method: "POST",
        body: { keys, device: window.SCRAY_SYNC.DEVICE_ID },
      });
      lastRev = res.rev || lastRev;
      if (cleared) { hidden = []; cleared = false; }
      const extra = keys.length - shown;
      setState("synced", `Synced ${keys.length} item(s)${extra > 0 ? ` - ${extra} only on other devices` : ""} at ${new Date().toLocaleTimeString()}`);
    } catch (err) {
      console.error("[basket-sync] push failed:", err);
      setState("error", `Sync failed: ${err.message || err} - will retry on next change`);
      throw err;
    }
  }

  /** Debounced. Safe to call from every basket mutation. */
  function schedulePush() {
    if (!ready || suppress) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      pushTimer = null;
      if (inFlight) { pendingAgain = true; return; }  // serialise, never overlap
      inFlight = pushNow()
        .catch(() => {})
        .finally(() => {
          inFlight = null;
          if (pendingAgain) { pendingAgain = false; schedulePush(); }
        });
    }, PUSH_DEBOUNCE_MS);
  }

  /** Clear in basket.js calls this first: the basket is emptied on every device, not just here. */
  function markCleared() { cleared = true; }

  // ---------------------------------------------------------------
  // Pull
  // ---------------------------------------------------------------
  async function pull({ force = false, announce = false, reresolve = false } = {}) {
    if (!force && !reresolve && Date.now() - lastPullAt < FOCUS_PULL_THROTTLE_MS) return;
    // A local change still waiting to go out wins over what the server has.
    if (ready && !force && (pushTimer || inFlight)) return;
    lastPullAt = Date.now();

    setState("syncing", "Checking server basket...");
    try {
      const res = await window.scrayApiCall(GET);
      const keys = Array.isArray(res.keys) ? res.keys : [];
      const rev = res.rev || 0;

      // First install to sync: the server has no basket yet, so this device's
      // is the one to keep - applying the empty server copy would wipe it.
      if (rev === 0 && !keys.length && (window.basketVideos || []).length) {
        seed = true;
        setState("syncing", "Sending this device's basket to the server...");
        return;
      }

      // Nothing new. Don't touch the basket - re-applying identical content
      // would still reset selection and scroll position. (After a library
      // change the same rev is worth resolving again: more may show now.)
      if (!force && !reresolve && rev === lastRev) {
        setState("synced", `Up to date (rev ${rev})`);
        return;
      }
      lastRev = rev;

      const { videos, missing } = await resolveKeys(keys);
      hidden = missing;
      cleared = false;

      suppress = true;
      try {
        window.basketVideos = videos;
        if (typeof window.saveBasket === "function") window.saveBasket();
        if (typeof window.renderBasket === "function") window.renderBasket();
        if (typeof window.updateBasketCount === "function") window.updateBasketCount();
      } finally {
        suppress = false;
      }

      const note = missing.length ? ` (${missing.length} only on other devices)` : "";
      setState("synced", `Pulled ${videos.length} item(s)${note} - rev ${rev}`);
      if (announce && typeof window.showSyncConfirmation === "function") {
        window.showSyncConfirmation(`✅ Basket: ${videos.length} item(s)${note}`);
      }
    } catch (err) {
      console.error("[basket-sync] pull failed:", err);
      setState("error", `Pull failed: ${err.message || err}`);
    }
  }

  // ---------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------
  async function init() {
    await pull({ force: true });
    ready = true;   // only now may a local change reach the server
    if (seed) { seed = false; schedulePush(); }
    console.log("[basket-sync] ready");
  }

  window.addEventListener("DOMContentLoaded", () => {
    // Behind scrayWatch so the READY toast waits for the basket, same as
    // every other start-up chain.
    window.scrayWatch("basket sync", () => init());

    // The library changed (a scan, a Hetzner fetch): basket items that were
    // only on other devices may be here now. Every library change ends in
    // scraySyncLibrary (scray-sync-ui.js), so it's wrapped once here.
    const sync = window.scraySyncLibrary;
    if (typeof sync === "function" && !sync.__basketWrapped) {
      const wrapped = async function (...args) {
        const r = await sync.apply(this, args);
        if (ready && hidden.length) pull({ reresolve: true }).catch(() => {});
        return r;
      };
      wrapped.__basketWrapped = true;
      window.scraySyncLibrary = wrapped;
    }
  });

  // Back in the foreground: catch up with what another device did meanwhile.
  window.addEventListener("focus", () => { if (ready) pull(); });
  document.addEventListener("visibilitychange", () => {
    if (ready && document.visibilityState === "visible") pull();
  });

  window.scrayBasketSync = {
    schedulePush,
    pull,
    makeLight,
    paint,
    markCleared,
    isReady: () => ready,
    _test: { keysToPush, resolveKeys, setHidden: (h) => { hidden = h; }, getHidden: () => hidden },
  };
})();

/**
 * scray-basket-sync.js — Picker only.
 *
 * The basket is now a single row in the server's `app_state` table, keyed
 * 'current_basket', holding a JSON array of video_keys. Every device running
 * Picker sees the same basket.
 *
 * Why video_key and not oneDriveId: oneDriveId identifies a physical file
 * instance, so it changes the moment a file is re-uploaded or moves account.
 * video_key is the row identity everywhere else in the system, so a basket
 * saved today still resolves after a re-upload tomorrow.
 *
 * Native deliberately does NOT load this file. Its basket stays local.
 *
 * Push model: debounced, fired from saveBasket(). Two guards matter -
 *   READY: no push may happen before the first pull has landed, or the empty
 *          boot basket would overwrite the server copy.
 *   SUPPRESS: applying a pulled basket calls saveBasket(), which would
 *          otherwise immediately push the thing we just received.
 *
 * Pull model: on boot, and on tab focus (throttled). No polling - the basket
 * is edited by one person on one device at a time, and a stale read costs a
 * tab switch to fix.
 */
(function () {
  const KEY = "current_basket";
  const PUSH_DEBOUNCE_MS = 800;
  const FOCUS_PULL_THROTTLE_MS = 5000;

  let ready = false;        // first pull has completed
  let suppress = false;     // currently applying a pulled basket
  let pushTimer = null;
  let inFlight = null;      // promise of the push currently running
  let pendingAgain = false; // a change arrived while a push was in flight
  let lastPullAt = 0;
  let lastRev = 0;

  // ---------------------------------------------------------------
  // Traffic light
  // ---------------------------------------------------------------
  // States: idle (grey), syncing (amber), synced (green), error (red).
  // renderBasket() rebuilds the total-size row on every change, so the
  // current state is held here and re-applied rather than living in the DOM.
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
  // Key helpers
  // ---------------------------------------------------------------
  function keysFromBasket() {
    const seen = new Set();
    const out = [];
    (window.basketVideos || []).forEach((v) => {
      const k = window.scrayKeyFor(v);
      if (!k || seen.has(k)) return;   // a basket is a set, not a bag
      seen.add(k);
      out.push(k);
    });
    return out;
  }

  /**
   * video_keys -> full video objects from IndexedDB, in the order given.
   * Falls back to matching on oneDriveId so a basket saved by the old Excel
   * path (which stored oneDriveIds) still resolves.
   */
  async function resolveKeys(keys) {
    const all = await getAllVideos();
    const byKey = new Map();
    const byId = new Map();
    all.forEach((v) => {
      const k = window.scrayKeyFor(v);
      if (k && !byKey.has(k)) byKey.set(k, v);
      if (v.oneDriveId) byId.set(v.oneDriveId, v);
    });

    const videos = [];
    let missing = 0;
    keys.forEach((k) => {
      const hit = byKey.get(k) || byId.get(k);
      if (hit) videos.push(hit);
      else missing++;
    });
    return { videos, missing };
  }

  // ---------------------------------------------------------------
  // Push
  // ---------------------------------------------------------------
  async function pushNow() {
    const keys = keysFromBasket();
    setState("syncing", `Syncing ${keys.length} item(s)...`);
    try {
      const res = await window.scrayApiCall("basket_set", {
        method: "POST",
        body: { keys, device: window.SCRAY_SYNC.DEVICE_ID },
      });
      lastRev = res.rev || lastRev;
      setState("synced", `Synced ${keys.length} item(s) at ${new Date().toLocaleTimeString()}`);
    } catch (err) {
      console.error("[basket-sync] push failed:", err);
      setState("error", `Sync failed: ${err.message || err} — will retry on next change`);
      throw err;
    }
  }

  /** Debounced. Safe to call from every basket mutation. */
  function schedulePush() {
    if (!ready || suppress) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      if (inFlight) { pendingAgain = true; return; }  // serialise, never overlap
      inFlight = pushNow()
        .catch(() => {})
        .finally(() => {
          inFlight = null;
          if (pendingAgain) { pendingAgain = false; schedulePush(); }
        });
    }, PUSH_DEBOUNCE_MS);
  }

  // ---------------------------------------------------------------
  // Pull
  // ---------------------------------------------------------------
  async function pull({ force = false, announce = false } = {}) {
    if (!force && Date.now() - lastPullAt < FOCUS_PULL_THROTTLE_MS) return;
    lastPullAt = Date.now();

    setState("syncing", "Checking server basket...");
    try {
      const res = await window.scrayApiCall("basket_get");
      const keys = Array.isArray(res.keys) ? res.keys : [];
      const rev = res.rev || 0;

      // Nothing new. Don't touch the basket - re-applying identical content
      // would still reset selection and scroll position.
      if (!force && rev === lastRev) {
        setState("synced", `Up to date (rev ${rev})`);
        return;
      }
      lastRev = rev;

      const { videos, missing } = await resolveKeys(keys);

      suppress = true;
      try {
        window.basketVideos = videos;
        if (typeof window.saveBasket === "function") window.saveBasket();
        if (typeof window.renderBasket === "function") window.renderBasket();
      } finally {
        suppress = false;
      }

      const note = missing ? ` (${missing} not in this catalogue)` : "";
      setState("synced", `Pulled ${videos.length} item(s)${note} — rev ${rev}`);
      if (announce && typeof window.showSyncConfirmation === "function") {
        window.showSyncConfirmation(`✅ Basket: ${videos.length} item(s)${note}`);
      }
    } catch (err) {
      console.error("[basket-sync] pull failed:", err);
      setState("error", `Pull failed: ${err.message || err}`);
    }
  }

  // ---------------------------------------------------------------
  // Playlists
  // ---------------------------------------------------------------
  async function savePlaylist(name) {
    const keys = keysFromBasket();
    if (!keys.length) throw new Error("Basket is empty");
    return window.scrayApiCall("playlists_save", {
      method: "POST",
      body: { name, keys },
    });
  }

  async function listPlaylists() {
    const res = await window.scrayApiCall("playlists_list");
    return res.playlists || [];
  }

  async function deletePlaylist(id) {
    return window.scrayApiCall("playlists_delete", { method: "POST", body: { id } });
  }

  /** Replaces the basket with a playlist, then pushes so other devices follow. */
  async function loadPlaylist(playlist) {
    let keys = [];
    try {
      keys = JSON.parse(playlist.keys_json || "[]");
    } catch (e) {
      throw new Error("Playlist data is corrupt");
    }
    const { videos, missing } = await resolveKeys(keys);

    window.basketVideos = videos;
    if (typeof window.resetBasketPlayIndex === "function") window.resetBasketPlayIndex();
    if (typeof window.clearBasketSelection === "function") window.clearBasketSelection();
    if (typeof window.saveBasket === "function") window.saveBasket();
    if (typeof window.renderBasket === "function") window.renderBasket();

    return { loaded: videos.length, total: keys.length, missing };
  }

  // ---------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------
  async function init() {
    await pull({ force: true });
    ready = true;   // only now may a local change reach the server
    console.log("[basket-sync] ready");
  }

  window.addEventListener("DOMContentLoaded", () => {
    // Behind scrayWatch so the READY toast waits for the basket, same as
    // every other start-up chain.
    window.scrayWatch("basket sync", () => init());
  });

  // A tab left open overnight should catch up when you come back to it.
  window.addEventListener("focus", () => { if (ready) pull(); });
  document.addEventListener("visibilitychange", () => {
    if (ready && document.visibilityState === "visible") pull();
  });

  window.scrayBasketSync = {
    schedulePush,
    pull,
    makeLight,
    paint,
    savePlaylist,
    listPlaylists,
    deletePlaylist,
    loadPlaylist,
    isReady: () => ready,
  };
})();

/* =========================================
   Playlist modals
   ========================================= */

/** Save-as-playlist prompt. Reuses the existing basket modal styling. */
window.showPlaylistSaveModal = function () {
  return new Promise((resolve) => {
    const suggested = `Playlist ${new Date().toLocaleString("en-GB", {
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).replace(/[/,]/g, "-").replace(/:/g, ".")}`;

    const modal = document.createElement("div");
    modal.className = "basket-json-modal";
    modal.innerHTML = `
      <div class="basket-json-modal-content">
        <h3>Save Basket as Playlist</h3>
        <p style="margin-bottom: 16px; color: #666;">${(window.basketVideos || []).length} item(s) will be saved.</p>
        <input type="text" id="playlistNameInput" value="${suggested}"
               placeholder="Playlist name"
               style="width: 100%; padding: 10px; font-size: 1rem; border: 2px solid #ddd; border-radius: 4px; box-sizing: border-box; margin-bottom: 16px;">
        <div class="basket-json-modal-buttons">
          <button id="playlistSaveConfirmBtn" class="modal-btn modal-btn-primary">Save</button>
          <button id="playlistSaveCancelBtn" class="modal-btn modal-btn-cancel">Cancel</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const input = document.getElementById("playlistNameInput");
    const saveBtn = document.getElementById("playlistSaveConfirmBtn");
    setTimeout(() => { input.focus(); input.select(); }, 100);

    const close = (val) => { modal.remove(); resolve(val); };

    saveBtn.addEventListener("click", async () => {
      const name = input.value.trim();
      if (!name) { alert("Please enter a playlist name"); return; }
      saveBtn.disabled = true;
      saveBtn.textContent = "Saving...";
      try {
        await window.scrayBasketSync.savePlaylist(name);
        saveBtn.textContent = "✅ Saved";
        saveBtn.style.background = "#28a745";
        setTimeout(() => close(name), 900);
      } catch (err) {
        console.error("Playlist save failed:", err);
        saveBtn.textContent = "❌ Failed";
        saveBtn.style.background = "#dc3545";
        setTimeout(() => {
          saveBtn.disabled = false;
          saveBtn.textContent = "Save";
          saveBtn.style.background = "";
          alert(`Save failed: ${err.message || err}`);
        }, 1200);
      }
    });

    document.getElementById("playlistSaveCancelBtn").addEventListener("click", () => close(null));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") saveBtn.click();
      else if (e.key === "Escape") close(null);
    });
    modal.addEventListener("click", (e) => { if (e.target === modal) close(null); });
  });
};

/** Playlist picker, with delete. */
window.showPlaylistPickerModal = async function () {
  let playlists;
  try {
    playlists = await window.scrayBasketSync.listPlaylists();
  } catch (err) {
    alert(`Could not load playlists: ${err.message || err}`);
    return;
  }

  if (!playlists.length) {
    alert("No saved playlists yet — save one with the 💾 button first.");
    return;
  }

  const modal = document.createElement("div");
  modal.className = "basket-json-modal";

  const rows = playlists.map((p, idx) => `
    <div class="basket-picker-item" data-index="${idx}">
      <div class="basket-picker-info">
        <strong>${p.name}</strong>
        <span style="font-size: 0.85rem; color: #666;">
          ${p.item_count} items • ${new Date(p.updated_at || p.created_at).toLocaleString()}
        </span>
      </div>
      <div style="display: flex; gap: 8px;">
        <button class="basket-picker-load-btn" data-index="${idx}">Load</button>
        <button class="basket-picker-delete-btn" data-index="${idx}">Delete</button>
      </div>
    </div>
  `).join("");

  modal.innerHTML = `
    <div class="basket-json-modal-content basket-json-modal-wide">
      <h3>Load Playlist</h3>
      <div id="playlistPickerList" style="max-height: 400px; overflow-y: auto; margin-bottom: 16px;">
        ${rows}
      </div>
      <button id="playlistPickerCancelBtn" class="modal-btn modal-btn-cancel">Cancel</button>
    </div>
  `;
  document.body.appendChild(modal);

  const escHandler = (e) => {
    if (e.key === "Escape") {
      modal.remove();
      document.removeEventListener("keydown", escHandler);
    }
  };
  document.addEventListener("keydown", escHandler);

  modal.querySelectorAll(".basket-picker-load-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const p = playlists[parseInt(btn.dataset.index)];
      btn.disabled = true;
      btn.textContent = "Loading...";
      try {
        const r = await window.scrayBasketSync.loadPlaylist(p);
        modal.remove();
        document.removeEventListener("keydown", escHandler);
        if (typeof window.showSyncConfirmation === "function") {
          window.showSyncConfirmation(
            r.missing
              ? `✅ Loaded ${r.loaded} of ${r.total} — ${r.missing} not in this catalogue`
              : `✅ Loaded playlist "${p.name}" (${r.loaded} items)`
          );
        }
      } catch (err) {
        console.error("Playlist load failed:", err);
        btn.disabled = false;
        btn.textContent = "Load";
        alert(`Load failed: ${err.message || err}`);
      }
    });
  });

  modal.querySelectorAll(".basket-picker-delete-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const p = playlists[parseInt(btn.dataset.index)];
      if (!confirm(`Delete playlist "${p.name}"?\n\nThis removes it from the database for every device.`)) return;
      btn.disabled = true;
      btn.textContent = "Deleting...";
      try {
        await window.scrayBasketSync.deletePlaylist(p.id);
        const item = btn.closest(".basket-picker-item");
        if (item) {
          item.style.transition = "opacity 0.3s ease";
          item.style.opacity = "0";
          setTimeout(() => item.remove(), 300);
        }
      } catch (err) {
        console.error("Playlist delete failed:", err);
        btn.disabled = false;
        btn.textContent = "Delete";
        alert(`Delete failed: ${err.message || err}`);
      }
    });
  });

  document.getElementById("playlistPickerCancelBtn").addEventListener("click", () => {
    modal.remove();
    document.removeEventListener("keydown", escHandler);
  });
  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      modal.remove();
      document.removeEventListener("keydown", escHandler);
    }
  });
};

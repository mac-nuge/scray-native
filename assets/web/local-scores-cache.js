// Minimal local replacement for excel-online.js's live Graph API sync.
// Phase 7 replaces this with real local .xlsx import/export.

window.excelAccessToken = null; // no live connection — Phase 7 changes this

// Was previously defined in onedrive.js/auth.js, deleted in Phase 6.2 without
// being ported — several files (grid rendering included) call this directly.
function formatFileSize(bytes) {
  if (!bytes || bytes <= 0) return "Unknown size";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}
window.formatFileSize = formatFileSize;

// Also deleted along with onedrive.js/auth.js in Phase 6.2, never ported —
// used in 47 places including the progress bar and all seek/frame-step
// feedback messages. Takes milliseconds, returns "M:SS" or "H:MM:SS".
function formatDuration(ms) {
  if (!ms || isNaN(ms) || ms < 0) return "0:00";
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const paddedSeconds = seconds.toString().padStart(2, "0");
  if (hours > 0) {
    const paddedMinutes = minutes.toString().padStart(2, "0");
    return `${hours}:${paddedMinutes}:${paddedSeconds}`;
  }
  return `${minutes}:${paddedSeconds}`;
}
window.formatDuration = formatDuration;

let cachedVideoScores = new Map();
let cachedVideoBookmarks = new Map();
let cachesLoaded = false;

/**
 * Load both caches from videoMeta.
 *
 * These Maps used to start empty and were only ever filled by
 * queueExcelUpdate — i.e. by edits made in this session. Anything the
 * catalogue sync wrote into videoMeta was invisible to the grid, because the
 * grid reads these Maps rather than the store.
 *
 * Call with force=true after a sync to pick up newly pulled metadata.
 */
async function loadCachesFromMeta(force = false) {
    if (cachesLoaded && !force) return;
    try {
        const videos = await getAllVideos();   // merges videoSource + videoMeta
        cachedVideoScores = new Map();
        cachedVideoBookmarks = new Map();
        videos.forEach(v => {
            if (v.user_score !== undefined && v.user_score !== null) {
                cachedVideoScores.set(v.oneDriveId, v.user_score);
            }
            if (Array.isArray(v.bookmarks) && v.bookmarks.length) {
                cachedVideoBookmarks.set(v.oneDriveId, v.bookmarks);
            }
        });
        cachesLoaded = true;
        console.log(`✅ caches loaded from videoMeta — ${cachedVideoScores.size} score(s), ${cachedVideoBookmarks.size} bookmarked video(s)`);
    } catch (err) {
        console.error("loadCachesFromMeta failed:", err);
    }
}
window.loadCachesFromMeta = loadCachesFromMeta;

async function getCachedVideoScores(forceRefresh = false) {
    await loadCachesFromMeta(forceRefresh);
    return cachedVideoScores;
}

async function getCachedVideoBookmarks(forceRefresh = false) {
    await loadCachesFromMeta(forceRefresh);
    return cachedVideoBookmarks;
}

/**
 * Synchronous "does this video have any bookmarks", for button styling that
 * has to decide during a render. Prefers the object's own array (list rows
 * come from getAllVideos and carry it) and falls back to the cache, since
 * basket and history entries are stored separately and often don't.
 */
/* ⚙️ The two BM states in one place. Seven call sites used to hard-code
   "#6f42c1" / "#ece6f6" inline; they all go through
   scrayApplyBookmarkButtonColour() now, so changing a shade means changing
   it here only. Off is a disabled-looking grey rather than a pale purple. */
const SCRAY_BM_COLOURS = {
    on:  { bg: '#6f42c1', fg: '#ffffff' },
    off: { bg: '#e0e0e0', fg: '#9e9e9e' }
};
window.SCRAY_BM_COLOURS = SCRAY_BM_COLOURS;

function scrayHasBookmarks(video) {
    if (!video) return false;
    const own = video.bookmarks;
    if (Array.isArray(own)) return own.length > 0;
    // Sync rows and server payloads carry it as a JSON string; the old
    // Array.isArray test fell straight past those to the cache.
    if (typeof own === 'string' && own.trim()) {
        try {
            const parsed = JSON.parse(own);
            return Array.isArray(parsed) && parsed.length > 0;
        } catch { /* malformed - fall through to the cache */ }
    }
    // .has() was the bug: queueExcelUpdate left an empty array behind when
    // the last bookmark was deleted, so the key survived and the button
    // stayed purple. Read the value and check its length.
    const cached = cachedVideoBookmarks.get(video.oneDriveId);
    return Array.isArray(cached) ? cached.length > 0 : false;
}
window.scrayHasBookmarks = scrayHasBookmarks;

/* ⚙️ StashDB match state, ported from Picker's excel-sheets.js so the Stash
   filter toggle has something to filter against. Same shape as the BM block
   above: one place decides "has this file been matched", everything else asks.

   The matched set comes from stash_matches on the server, cached in
   localStorage so the FIRST render after a cold start is already right. A
   signature (count + newest updated_at) rides along with the refresh, so an
   unchanged catalogue costs one tiny response instead of a 3,000-entry array.

   scrayApplyStashButtonColour and scrayRefreshStashButtons are included but
   nothing calls them yet - Native's S button is still hard-coded purple in
   context-menu.js. Wiring them up is a separate, one-line job. */
const SCRAY_STASH_COLOURS = {
    on:  { bg: '#6c5ce7', fg: '#ffffff' },
    off: { bg: '#e0e0e0', fg: '#9e9e9e' }
};
window.SCRAY_STASH_COLOURS = SCRAY_STASH_COLOURS;

const SCRAY_STASH_CACHE_KEY = 'scray_stash_state_v1';
let scrayStashMatched = null;      // Set<video_key>, null until first hydrate
let scrayStashMarked  = null;      // Set<video_key> that also have timestamps
let scrayStashSig     = null;
let scrayStashInFlight = null;

/**
 * Native never defined window.scrayKeyFor - only Picker did - so the stored
 * key is the one that counts here: Native adopts a fingerprint-matched
 * videoKey that deliberately differs from the local filename, and deriving
 * from the filename instead would miss every adopted row.
 */
function scrayStashKeyFor(video) {
    if (!video) return '';
    if (typeof window.scrayKeyFor === 'function') return window.scrayKeyFor(video) || '';
    if (video.videoKey) return video.videoKey;
    return typeof window.scrayVideoKey === 'function'
        ? window.scrayVideoKey(video.filename)
        : String(video.filename || '').trim().toLowerCase();
}

function scrayStashHydrateFromCache() {
    if (scrayStashMatched) return;
    try {
        const raw = localStorage.getItem(SCRAY_STASH_CACHE_KEY);
        if (!raw) return;
        const j = JSON.parse(raw);
        scrayStashMatched = new Set(j.matched || []);
        scrayStashMarked  = new Set(j.with_markers || []);
        scrayStashSig     = j.sig || null;
    } catch { /* corrupt cache is the same as no cache */ }
}

function scrayHasStashMatch(video) {
    if (!scrayStashMatched) return false;
    const k = scrayStashKeyFor(video);
    return k !== '' && scrayStashMatched.has(k);
}
window.scrayHasStashMatch = scrayHasStashMatch;

function scrayHasStashMarkers(video) {
    if (!scrayStashMarked) return false;
    const k = scrayStashKeyFor(video);
    return k !== '' && scrayStashMarked.has(k);
}
window.scrayHasStashMarkers = scrayHasStashMarkers;

/**
 * Pull the matched-key list. Cheap when nothing has changed: the server
 * compares the signature and answers `unchanged` without sending the list.
 * Concurrent callers share one request rather than each starting their own.
 */
async function scrayLoadStashState(force = false) {
    scrayStashHydrateFromCache();
    if (scrayStashInFlight) return scrayStashInFlight;
    if (typeof window.scrayApiCall !== 'function') return null;

    scrayStashInFlight = (async () => {
        try {
            const params = (!force && scrayStashSig) ? { sig: scrayStashSig } : {};
            const r = await window.scrayApiCall('stash_state', { params });
            if (r.unchanged) return r.sig;

            scrayStashMatched = new Set(r.matched || []);
            scrayStashMarked  = new Set(r.with_markers || []);
            scrayStashSig     = r.sig || null;
            try {
                localStorage.setItem(SCRAY_STASH_CACHE_KEY, JSON.stringify({
                    sig: scrayStashSig,
                    matched: [...scrayStashMatched],
                    with_markers: [...scrayStashMarked]
                }));
            } catch { /* over quota - the in-memory set still works this session */ }

            scrayRefreshStashButtons();
            console.log(`✅ stash state — ${scrayStashMatched.size} matched, ${scrayStashMarked.size} with timestamps`);
            return scrayStashSig;
        } catch (err) {
            console.warn('stash state refresh failed:', err && err.message);
            return null;
        } finally {
            scrayStashInFlight = null;
        }
    })();
    return scrayStashInFlight;
}
window.scrayLoadStashState = scrayLoadStashState;

/** Mark one key locally, so the button turns purple the moment the modal
 *  reports a hit rather than after the next full refresh. */
function scrayNoteStashMatch(video, matched = true, hasMarkers = false) {
    scrayStashHydrateFromCache();
    if (!scrayStashMatched) { scrayStashMatched = new Set(); scrayStashMarked = new Set(); }
    const k = scrayStashKeyFor(video);
    if (!k) return;
    if (matched) scrayStashMatched.add(k); else scrayStashMatched.delete(k);
    if (hasMarkers) scrayStashMarked.add(k); else scrayStashMarked.delete(k);
    scrayRefreshStashButtons();
}
window.scrayNoteStashMatch = scrayNoteStashMatch;

function scrayApplyStashButtonColour(spec, video) {
    if (!spec) return spec;
    const hit = scrayHasStashMatch(video);
    const state = hit ? SCRAY_STASH_COLOURS.on : SCRAY_STASH_COLOURS.off;
    spec.color = state.bg;
    spec.textColor = state.fg;
    spec.title = hit
        ? 'Scene data and timestamps' + (scrayHasStashMarkers(video) ? ' (timestamps available)' : '')
        : 'Not matched on StashDB yet — tap to look it up';
    return spec;
}
window.scrayApplyStashButtonColour = scrayApplyStashButtonColour;

function scrayRefreshStashButtons() {
    document.querySelectorAll('.scray-stash-btn').forEach(el => {
        const v = el._scrayVideo;
        if (!v) return;
        const state = scrayHasStashMatch(v) ? SCRAY_STASH_COLOURS.on : SCRAY_STASH_COLOURS.off;
        el.style.background = state.bg;
        el.style.color = state.fg;
        // The mouseleave handler restores from the spec object, so that has
        // to move too or a hover would repaint the old colour.
        if (el._scrayBtnSpec) {
            el._scrayBtnSpec.color = state.bg;
            el._scrayBtnSpec.textColor = state.fg;
        }
    });
}
window.scrayRefreshStashButtons = scrayRefreshStashButtons;

// Cache first, so the toggle is usable immediately after a warm start;
// network second, deferred so it never competes with boot.
scrayStashHydrateFromCache();
setTimeout(() => { scrayLoadStashState().catch(() => {}); }, 2500);

/**
 * Stamp the on/off colours onto a BM button spec. Called once by
 * createCompactButtonGroup before it splits visible from overflow, so the
 * caller's inline ternary no longer decides anything.
 */
function scrayApplyBookmarkButtonColour(spec, video) {
    if (!spec) return spec;
    const state = scrayHasBookmarks(video) ? SCRAY_BM_COLOURS.on : SCRAY_BM_COLOURS.off;
    spec.color = state.bg;
    spec.textColor = state.fg;
    return spec;
}
window.scrayApplyBookmarkButtonColour = scrayApplyBookmarkButtonColour;

/**
 * Restyle every BM button currently on screen. Anything that adds or removes
 * a bookmark has to call this, or the button keeps its build-time colour
 * until the next full re-render.
 *
 * `changed` is the video that was just edited. Basket, history and the
 * now-playing strip each hold their own copy of the same video, so the fresh
 * array is pushed across by oneDriveId rather than trusting object identity.
 */
function scrayRefreshBookmarkButtons(changed = null) {
    const id = changed ? (changed.oneDriveId ?? null) : null;
    const list = Array.isArray(changed?.bookmarks) ? changed.bookmarks : null;

    document.querySelectorAll('.scray-bm-btn').forEach(el => {
        const v = el._scrayVideo;
        if (!v) return;
        if (id && list && v.oneDriveId === id) v.bookmarks = list;

        const state = scrayHasBookmarks(v) ? SCRAY_BM_COLOURS.on : SCRAY_BM_COLOURS.off;
        el.style.background = state.bg;
        el.style.color = state.fg;
        // The mouseleave handler restores from the spec object, so that has
        // to move too or a hover would repaint the old colour.
        if (el._scrayBtnSpec) {
            el._scrayBtnSpec.color = state.bg;
            el._scrayBtnSpec.textColor = state.fg;
        }
    });
}
window.scrayRefreshBookmarkButtons = scrayRefreshBookmarkButtons;

// ✅ Local persistence: the same update shape excel-sheets.js uses, but
// written to videoMeta instead of Graph. Without this, view_count,
// last_played and f_tally were never recorded anywhere.
async function queueExcelUpdate(video, updates) {
    const metaUpdates = {};
    // What the SERVER gets, when it differs from what's stored locally.
    const opUpdates = {};

    if (updates.user_score !== undefined) {
        cachedVideoScores.set(video.oneDriveId, updates.user_score);
        video.userScore = updates.user_score;
        metaUpdates.user_score = updates.user_score;
    }

    if (updates.bookmarks !== undefined) {
        const parsed = typeof updates.bookmarks === "string"
            ? JSON.parse(updates.bookmarks)
            : updates.bookmarks;
        // Deleting the last bookmark has to REMOVE the key, not store an
        // empty array - loadCachesFromMeta only ever sets non-empty entries,
        // so an empty one here was a state the cache could not otherwise
        // reach, and scrayHasBookmarks read it as "yes".
        if (Array.isArray(parsed) && parsed.length) {
            cachedVideoBookmarks.set(video.oneDriveId, parsed);
        } else {
            cachedVideoBookmarks.delete(video.oneDriveId);
        }
        // Keep the in-memory object in step. user_score does this two blocks
        // up; bookmarks never did, which left grid rows stale.
        video.bookmarks = Array.isArray(parsed) ? parsed : [];
        metaUpdates.bookmarks = parsed;
    }

    if (updates.notes !== undefined) {
        metaUpdates.notes = updates.notes;
        video.notes = updates.notes;
    }

    // Counters need the current value first - read/modify/write
    if (updates.increment_views || updates.increment_f_tally) {
        let current = null;
        try {
            const db = await openDB();
            const tx = db.transaction(META_STORE_NAME, "readonly");
            current = await new Promise((resolve, reject) => {
                const req = tx.objectStore(META_STORE_NAME).get(video.oneDriveId);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
        } catch (err) {
            console.warn("Could not read current counters:", err);
        }

        if (updates.increment_views) {
            const next = (parseInt(current?.view_count) || 0) + 1;
            metaUpdates.view_count = next;   // absolute, for local display
            video.view_count = next;
            opUpdates.increment_views = true; // delta, for the server
        }
        if (updates.increment_f_tally) {
            const next = (parseInt(current?.f_tally) || 0) + 1;
            metaUpdates.f_tally = next;
            video.f_tally = next;
            opUpdates.increment_f_tally = true;
        }
    }

    if (updates.played_now) {
        const now = new Date().toISOString();
        metaUpdates.last_played = now;
        video.last_played = now;
        // played_now becomes op.max.last_played server-side - idempotent,
        // and immune to clock skew between devices picking a loser.
        opUpdates.played_now = true;
    }

    // "play" rather than "app" so saveVideoMeta knows to drop this op when
    // offline instead of queueing it for a confusing later replay.
    const isPlayTracking = !!(updates.increment_views || updates.played_now || updates.increment_f_tally);

    if (Object.keys(metaUpdates).length && typeof saveVideoMeta === "function") {
        await saveVideoMeta(
            video.oneDriveId,
            metaUpdates,
            isPlayTracking ? "play" : "app",
            Object.keys(opUpdates).length ? { ...metaUpdatesNonCounter(metaUpdates), ...opUpdates } : null
        );
    }
}

// Everything except the absolute counter values, which the server must
// receive as deltas instead.
function metaUpdatesNonCounter(m) {
    const { view_count, f_tally, last_played, ...rest } = m;
    return rest;
}

window.getCachedVideoScores = getCachedVideoScores;
window.getCachedVideoBookmarks = getCachedVideoBookmarks;
window.queueExcelUpdate = queueExcelUpdate;
// ✅ Tracking now persists locally, so it's safe to enable
window.isAutoTrackEnabled = () => {
    const stored = localStorage.getItem("autoTrackEnabled");
    return stored === null ? true : stored === "true";
};

// =========================================
// LOCAL SCORING (replaces the Excel-backed path from excel-sheets.js)
// =========================================
// excel-sheets.js isn't loaded in the native build, so showVideoScoringModal
// and showScoreConfirmation were undefined - every ★ button resolved to
// `undefined` and did nothing. These write straight to the videoMeta store
// (db.js), which a rescan never overwrites.

function showScoreConfirmation(message, bgColor = '#28a745') {
  const tooltip = document.createElement('div');
  tooltip.className = 'score-confirmation-tooltip';
  tooltip.innerHTML = message;
  tooltip.style.background = bgColor;
  tooltip.style.position = 'fixed';
  tooltip.style.left = '50%';
  tooltip.style.bottom = '120px';
  tooltip.style.transform = 'translateX(-50%)';

  document.body.appendChild(tooltip);
  setTimeout(() => tooltip.classList.add('show'), 10);
  setTimeout(() => {
    tooltip.classList.remove('show');
    setTimeout(() => tooltip.remove(), 300);
  }, 1500);
}

/**
* Persist a score, then patch every in-memory copy of the video.
* Basket and history are localStorage snapshots (not live DB reads), so they
* must be updated by hand or they keep showing the stale score.
* @param {object} video
* @param {number|null} score - 1-10, or null to clear
*/
async function applyVideoScore(video, score) {
  await saveVideoMeta(video.oneDriveId, { user_score: score }, "app");

  if (score === null) cachedVideoScores.delete(video.oneDriveId);
  else cachedVideoScores.set(video.oneDriveId, score);

  video.user_score = score;

  const basketIndex = window.basketVideos?.findIndex(v => v.oneDriveId === video.oneDriveId);
  if (basketIndex >= 0) {
    window.basketVideos[basketIndex].user_score = score;
    window.saveBasket?.();
    window.renderBasket?.();
  }

  const historyItems = window.historyVideos?.filter(v => v.oneDriveId === video.oneDriveId) || [];
  if (historyItems.length > 0) {
    historyItems.forEach(item => { item.user_score = score; });
    window.saveHistory?.();
    window.renderHistory?.();
  }

  if (window.currentPlayingVideo?.oneDriveId === video.oneDriveId) {
    window.currentPlayingVideo.user_score = score;
    window.rebuildVideoInfoDisplay?.(window.currentPlayingVideo);
  }

  // Re-render main/random lists so the [score] badge updates there too
  if (typeof window.refreshAllLists === 'function') window.refreshAllLists();
}

function showVideoScoringModal(video, event) {
  const menu = document.createElement('div');
  menu.className = 'score-context-menu';

  const gridContainer = document.createElement('div');
  gridContainer.className = 'score-grid';

  const makeScoreBtn = (label, score, title) => {
    const btn = document.createElement('button');
    btn.className = 'score-grid-btn';
    btn.textContent = label;
    btn.title = title;
    if (score !== null && video.user_score === score) btn.classList.add('score-selected');

    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      menu.remove();
      try {
        await applyVideoScore(video, score);
        const label = score === null ? 'Score cleared' : `✅ Score: ${score}`;
        showScoreConfirmation(
          `${label}<br><span style="font-size: 0.5em; opacity: 0.9;">${video.filename || ''}</span>`
        );
        console.log(`Scored ${video.filename}: ${score === null ? 'cleared' : score + '/10'}`);
      } catch (err) {
        console.error('Failed to save score:', err);
        showScoreConfirmation('❌ Failed to save score', '#f44336');
      }
    });

    return btn;
  };

  for (let i = 1; i <= 10; i++) {
    gridContainer.appendChild(makeScoreBtn(String(i), i, `Score ${i}/10`));
  }
  gridContainer.appendChild(makeScoreBtn('–', null, 'Clear score'));

  menu.appendChild(gridContainer);

  const x = event?.clientX || (event?.touches && event.touches[0].clientX) || 0;
  const y = event?.clientY || (event?.touches && event.touches[0].clientY) || 0;
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';

  document.body.appendChild(menu);

  // Nudge back on-screen if it overflows
  setTimeout(() => {
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = (window.innerWidth - rect.width - 10) + 'px';
    if (rect.left < 0) menu.style.left = '10px';
    if (rect.bottom > window.innerHeight) {
      const spaceBelow = window.innerHeight - y;
      const spaceAbove = y;
      if (spaceAbove > spaceBelow && spaceAbove > rect.height) {
        menu.style.top = (y - rect.height) + 'px';
      } else {
        menu.style.top = Math.min(y, window.innerHeight - rect.height - 10) + 'px';
      }
    }
    if (rect.top < 0) menu.style.top = '10px';
  }, 0);

  const cleanup = () => {
    document.removeEventListener('click', closeHandler);
    document.removeEventListener('touchstart', closeHandler);
    document.removeEventListener('keydown', escapeHandler);
  };
  const closeHandler = (e) => {
    if (!menu.contains(e.target)) { menu.remove(); cleanup(); }
  };
  const escapeHandler = (e) => {
    if (e.key === 'Escape') { menu.remove(); cleanup(); }
  };
  setTimeout(() => {
    document.addEventListener('click', closeHandler);
    document.addEventListener('touchstart', closeHandler);
    document.addEventListener('keydown', escapeHandler);
  }, 100);
}

window.showScoreConfirmation = showScoreConfirmation;
window.showVideoScoringModal = showVideoScoringModal;
window.applyVideoScore = applyVideoScore;

// =========================================
// F TALLY (replaces the Excel-backed path from excel-sheets.js)
// =========================================
// Same story as showVideoScoringModal above: this modal only ever existed in
// excel-sheets.js, which the native build doesn't load, so every "F tally"
// button hit the `typeof window.showFTallyConfirmModal === 'function'` guard
// at its call site and fell through to the misleading "Excel Online not
// connected" alert. The counter itself has worked all along - queueExcelUpdate
// above handles increment_f_tally, writing the absolute value to videoMeta for
// local display and sending a delta op to the server. Only the modal was missing.

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

       const cleanup = () => {
           modal.remove();
           document.removeEventListener('keydown', fTallyEscHandler);
       };

       document.getElementById('fTallyConfirmBtn').addEventListener('click', async () => {
           const confirmBtn = document.getElementById('fTallyConfirmBtn');
           confirmBtn.disabled = true;
           confirmBtn.textContent = 'Saving...';

           try {
               await window.queueExcelUpdate(video, { increment_f_tally: true });

               confirmBtn.textContent = '✅ Success';
               confirmBtn.style.background = '#28a745';

               // Visual feedback on the button that opened this, if there was one.
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

               setTimeout(() => { cleanup(); resolve(true); }, 1000);

           } catch (err) {
               console.error('Failed to increment F tally:', err);
               confirmBtn.textContent = '❌ Failed';
               confirmBtn.style.background = '#dc3545';
               setTimeout(() => {
                   cleanup();
                   // The old copy said "Make sure Google Sheets is connected",
                   // which was wrong in both apps and doubly so here.
                   alert(`Failed to update F tally: ${err.message || err}`);
                   resolve(false);
               }, 1500);
           }
       });

       document.getElementById('fTallyCancelBtn').addEventListener('click', () => {
           cleanup();
           resolve(false);
       });

       modal.addEventListener('click', (e) => {
           if (e.target === modal) { cleanup(); resolve(false); }
       });

       const fTallyEscHandler = (e) => {
           if (e.key === 'Escape') { cleanup(); resolve(false); }
       };
       document.addEventListener('keydown', fTallyEscHandler);
   });
}

window.showFTallyConfirmModal = showFTallyConfirmModal;
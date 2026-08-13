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
        cachedVideoBookmarks.set(video.oneDriveId, parsed);
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
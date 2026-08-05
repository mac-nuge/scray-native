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

async function getCachedVideoScores() {
    return cachedVideoScores;
}

async function getCachedVideoBookmarks() {
    return cachedVideoBookmarks;
}

// No-op persistence until Phase 7 wires up real local storage
async function queueExcelUpdate(video, updates) {
    if (updates.user_score !== undefined) {
        cachedVideoScores.set(video.oneDriveId, updates.user_score);
        video.userScore = updates.user_score;
    }
    if (updates.bookmarks !== undefined) {
        cachedVideoBookmarks.set(video.oneDriveId, JSON.parse(updates.bookmarks));
    }
}

window.getCachedVideoScores = getCachedVideoScores;
window.getCachedVideoBookmarks = getCachedVideoBookmarks;
window.queueExcelUpdate = queueExcelUpdate;
window.isAutoTrackEnabled = () => false;

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
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
// Minimal local replacement for excel-online.js's live Graph API sync.
// Phase 7 replaces this with real local .xlsx import/export.

window.excelAccessToken = null; // no live connection — Phase 7 changes this

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
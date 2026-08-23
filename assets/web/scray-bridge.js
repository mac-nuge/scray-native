window._scrayPending = window._scrayPending || {};

window._scrayResolve = function(id, result) {
  const pending = window._scrayPending[id];
  if (pending) {
    pending.resolve(result);
    delete window._scrayPending[id];
  }
};

window._scrayReject = function(id, error) {
  const pending = window._scrayPending[id];
  if (pending) {
    pending.reject(new Error(error));
    delete window._scrayPending[id];
  }
};

function callNative(action, payload) {
  return new Promise((resolve, reject) => {
    const id = Math.random().toString(36).slice(2);
    window._scrayPending[id] = { resolve, reject };
    window.webkit.messageHandlers.scrayBridge.postMessage({ id, action, payload: payload || null });
  });
}

window.ScrayBridge = {
  pickFolder: () => callNative('pickFolder'),
  listVideoFiles: () => callNative('listVideoFiles'),
  debugBundle: () => callNative('debugBundle'),
  getVideoDuration: (relativePath) => callNative('getVideoDuration', relativePath),
  getVideoMetadata: (relativePath) => callNative('getVideoMetadata', relativePath),
  exportCsv: (csvText, filename) => callNative('exportCsv', { csv: csvText, filename }),
  // ✅ Filesystem writes inside the security-scoped folder
  renameFile: (relativePath, newName) => callNative('renameFile', { path: relativePath, newName }),
  deleteFile: (relativePath) => callNative('deleteFile', { path: relativePath }),
  // ✅ In-app browser. Pass nothing to resume where it was left.
  openBrowser: (url) => callNative('openBrowser', {
    url: url || null,
    home: (typeof window.scrayPickerUrl === 'function' ? window.scrayPickerUrl() : null)
  })
};

/**
 * Native -> web, the opposite direction to everything above.
 *
 * Picker's "N" button navigates to scraynative://play?key=... inside
 * ScrayBrowser. Swift cancels that navigation, dismisses the browser, and
 * calls this on the main web view once the dismissal animation has finished.
 */
window.scrayPlayByKey = async function (key) {
  key = String(key || "").normalize("NFC").trim().toLowerCase();
  if (!key) return false;
  try {
    const all = await window.getAllVideos();
    const match = all.find(v =>
      (v.videoKey || window.scrayVideoKey(v.filename)) === key
    );
    if (!match) {
      // The catalogue said this was offline but the file isn't here — a stale
      // flag, or the folder was re-picked. Say so rather than fail silently.
      alert(`That file isn't on this device.\n\nKey: ${key}`);
      return false;
    }
    // Play it in the context of the main list where possible, so next/previous
    // still work. Falls back to a standalone play if it's filtered out.
    const list = (window.paginationState && window.paginationState.allVideos) || [];
    const idx = list.findIndex(v => v.oneDriveId === match.oneDriveId);
    window.inlineVideoPlayer.play(match, idx >= 0 ? "main" : null, idx >= 0 ? idx : null);
    return true;
  } catch (err) {
    console.error("scrayPlayByKey failed:", err);
    return false;
  }
};
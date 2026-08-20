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
    home: (window.SCRAY_SYNC && window.SCRAY_SYNC.PICKER_URL) || null
  })
};
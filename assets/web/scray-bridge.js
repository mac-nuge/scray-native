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
  deviceStorage: () => callNative('deviceStorage'),
  // Performance monitor by the console (13.180) - ScrayMemoryStats.swift.
  // Rejects with "Unknown action" on an older IPA.
  memoryStats: () => callNative('memoryStats'),
  getVideoDuration: (relativePath) => callNative('getVideoDuration', relativePath),
  getVideoMetadata: (relativePath) => callNative('getVideoMetadata', relativePath),
  exportCsv: (csvText, filename) => callNative('exportCsv', { csv: csvText, filename }),
  // ✅ Filesystem writes inside the security-scoped folder
  renameFile: (relativePath, newName) => callNative('renameFile', { path: relativePath, newName }),
  deleteFile: (relativePath) => callNative('deleteFile', { path: relativePath }),
  // ✅ Uploads to OneDrive (13.47) - ScrayUploads.swift. uploadUrl comes from
  // api.php's upload_session; status reports sent/total/bytesPerSecond per id.
  uploadStart: (job) => callNative('uploadStart', job),
  uploadStatus: (ids) => callNative('uploadStatus', { ids: ids || null }),
  uploadCancel: (id) => callNative('uploadCancel', { id }),
  uploadForget: (id) => callNative('uploadForget', { id }),
  // ✅ In-app browser. Pass nothing to resume where it was left.
  openBrowser: (url) => callNative('openBrowser', {
    url: url || null,
    home: (typeof window.scrayPickerUrl === 'function' ? window.scrayPickerUrl() : null),
    // Where the browser syncs favourites, history and logins (native 14.29).
    api: (window.SCRAY_SYNC && window.SCRAY_SYNC.API_BASE) || null,
    key: (window.SCRAY_SYNC && window.SCRAY_SYNC.API_KEY) || null
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
  // A filter or search handed over from Picker (native 13.192), riding the
  // same hop - see the cross-app block in randomiser.js. Checked before the
  // key is lower-cased: the payload is base64 and case matters.
  const raw = String(key || "").trim();
  if (raw.indexOf("scraycmd:") === 0) {
    return typeof window.scrayCrossAppReceive === "function"
      ? window.scrayCrossAppReceive(raw.slice(9))
      : false;
  }
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

/**
 * A finished download tapped in ScrayBrowser's Downloads list (native 13.195).
 *
 * Swift has already checked the file is inside the linked video folder and
 * worked out its path there - which is exactly a local row's oneDriveId - and
 * closed the browser. The full rescan the browser starts on its way out takes
 * a while on a big folder, so rather than wait for it, a file the list doesn't
 * have yet is read and saved on its own first; the rescan then finds it there.
 */
window.scrayPlayDownloaded = async function (relPath) {
  relPath = String(relPath || "");
  if (!relPath) return false;
  try {
    const find = async () => (await window.getAllVideos())
      .find(v => v.driveId === "local" && v.oneDriveId === relPath);

    let match = await find();
    if (!match) {
      const got = await window.scrayLocalVideoRow(relPath);
      // No metadata means native couldn't open that path in the video folder -
      // a download folder that only shares the video folder's name. Don't save
      // a row for a file that isn't there.
      if (!got.meta) {
        alert(`That download isn't in the video folder, so Scray can't play it.\n\n${relPath}`);
        return false;
      }
      await saveVideos([got.row], getActiveFolderName(), "local", "local");
      match = await find();
    }
    if (!match) {
      alert(`Couldn't find that download in the list.\n\n${relPath}`);
      return false;
    }

    // As scrayPlayByKey: in the main list's context where it's in there.
    const list = (window.paginationState && window.paginationState.allVideos) || [];
    const idx = list.findIndex(v => v.oneDriveId === match.oneDriveId);
    window.inlineVideoPlayer.play(match, idx >= 0 ? "main" : null, idx >= 0 ? idx : null);
    return true;
  } catch (err) {
    console.error("scrayPlayDownloaded failed:", err);
    alert(`Couldn't play that download: ${err.message || err}`);
    return false;
  }
};

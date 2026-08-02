// Replaces onedrive.js's folder-scanning role
async function scanLocalLibrary() {
  const relativePaths = await ScrayBridge.listVideoFiles();

  const videos = relativePaths.map(relPath => {
    const parts = relPath.split('/');
    const filename = parts[parts.length - 1];
    const folderPath = parts.slice(0, -1).join('/');
    const encodedPath = parts.map(encodeURIComponent).join('/');

    return {
      idFromAPI: relPath,
      name: filename,
      path: folderPath,
      downloadUrl: `scray-video://local/${encodedPath}`,
      webUrl: null,
      sizeBytes: null,
      durationMs: null
    };
  });

  // Reuses your existing db.js logic unchanged — tags/levels are derived
  // from `path` exactly as they were from OneDrive folder paths
  await saveVideos(videos, "local", "local", "local");

  if (typeof populateTagDropdowns === 'function') {
    await populateTagDropdowns();
  }

  console.log(`Scanned local library: ${videos.length} videos found`);
}

window.scanLocalLibrary = scanLocalLibrary;

let scrayDebugLines = [];

function debugLog(msg) {
  scrayDebugLines.push(msg);

  let el = document.getElementById('scrayDebugLog');
  if (!el) {
    el = document.createElement('textarea');
    el.id = 'scrayDebugLog';
    el.readOnly = true;
    el.style.cssText = 'position:fixed;bottom:0;left:0;right:0;height:150px;background:black;color:lime;font-size:11px;padding:4px;z-index:99999;border:2px solid lime;';
    document.body.appendChild(el);
  }
  el.value += msg + '\n';
}

window.addEventListener("DOMContentLoaded", () => {
  document.getElementById("pickFolderBtn")?.addEventListener("click", async () => {
    debugLog("pickFolderBtn clicked");
    try {
      debugLog("ScrayBridge exists: " + (typeof window.ScrayBridge));
      const result = await ScrayBridge.pickFolder();
      debugLog("pickFolder result: " + JSON.stringify(result));
      await scanLocalLibrary();
    } catch (err) {
      debugLog("pickFolder ERROR: " + err.message);
    }
  });
  document.getElementById("rescanLibraryBtn")?.addEventListener("click", () => scanLocalLibrary());
});
// Replaces onedrive.js's folder-scanning role
async function scanLocalLibrary() {
  const relativePaths = await ScrayWebView.listVideoFiles();

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

window.addEventListener("DOMContentLoaded", () => {
  document.getElementById("pickFolderBtn")?.addEventListener("click", () => ScrayWebView.pickFolder());
  document.getElementById("rescanLibraryBtn")?.addEventListener("click", () => scanLocalLibrary());
});
async function scanLocalLibrary() {
  console.log("scanLocalLibrary: starting");
  const relativePaths = await ScrayBridge.listVideoFiles();
  console.log("scanLocalLibrary: found " + relativePaths.length + " files: " + JSON.stringify(relativePaths));

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

  await saveVideos(videos, "local", "local", "local");
  console.log("scanLocalLibrary: saved to IndexedDB");

  if (typeof populateTagDropdowns === 'function') {
    await populateTagDropdowns();
  }

  // This was the missing piece: populateTagDropdowns only updates the
  // filter dropdowns, it never refreshes the visible video grid itself.
  if (typeof filterDisplayedByFilename === 'function') {
    await filterDisplayedByFilename();
    console.log("scanLocalLibrary: grid refreshed");
  } else {
    console.error("scanLocalLibrary: filterDisplayedByFilename not found — grid won't update");
  }

  console.log(`Scanned local library: ${videos.length} videos found`);
}

window.addEventListener("DOMContentLoaded", () => {
  document.getElementById("pickFolderBtn")?.addEventListener("click", async () => {
    console.log("pickFolderBtn clicked");
    try {
      const result = await ScrayBridge.pickFolder();
      console.log("pickFolder result: " + JSON.stringify(result));
      await scanLocalLibrary();
    } catch (err) {
      console.error("pickFolder ERROR: " + err.message);
    }
  });
  document.getElementById("rescanLibraryBtn")?.addEventListener("click", () => scanLocalLibrary());
});
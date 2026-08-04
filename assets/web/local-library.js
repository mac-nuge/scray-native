async function scanLocalLibrary() {
  console.log("scanLocalLibrary: starting");
  const relativePaths = await ScrayBridge.listVideoFiles();
  console.log("scanLocalLibrary: found " + relativePaths.length + " files: " + JSON.stringify(relativePaths));

  const videos = [];
  for (let i = 0; i < relativePaths.length; i++) {
    const relPath = relativePaths[i];
    const parts = relPath.split('/');
    const filename = parts[parts.length - 1];
    const folderPath = parts.slice(0, -1).join('/');
    const encodedPath = parts.map(encodeURIComponent).join('/');

    let meta = null;
    try {
      meta = await ScrayBridge.getVideoMetadata(relPath);
    } catch (err) {
      console.warn(`getVideoMetadata failed for ${relPath}: ${err.message}`);
    }

    const width = meta?.width ?? null;
    const height = meta?.height ?? null;
    const orientation = (width != null && height != null)
      ? (width >= height ? "L" : "P")
      : null;

    videos.push({
      idFromAPI: relPath,
      name: filename,
      path: folderPath,
      downloadUrl: `scray-video://local/${encodedPath}`,
      webUrl: null,
      sizeBytes: meta?.sizeBytes ?? null,
      durationMs: meta?.duration != null ? Math.round(meta.duration * 1000) : null,
      width,
      height,
      orientation,
      bitrate: meta?.bitrate ?? null,
      createdDateTime: meta?.createdDate ?? null,
      lastModifiedDateTime: meta?.modifiedDate ?? null
    });

    if ((i + 1) % 100 === 0) {
      console.log(`scanLocalLibrary: metadata read ${i + 1}/${relativePaths.length}`);
    }
  }

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
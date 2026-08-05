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

/**
* Scray Picker Excel DB import
* Reads the "Videos" sheet (view_count, user_score, notes, last_played,
* first_seen, f_tally, bookmarks) and joins it against "raw_data"
* (width/height/duration_ms) via oneDriveId/id, giving a fingerprint to
* disambiguate true duplicate filenames. Matched rows are written to
* videoMeta via saveVideoMeta(), never touching videoSource.
* Baskets, Exclude, and Current Basket sheets are intentionally ignored.
*/
window.addEventListener("DOMContentLoaded", () => {
  const importBtn = document.getElementById("excelOnlineConnectBtn");
  const importInput = document.getElementById("scrayExcelImportInput");

  importBtn?.addEventListener("click", () => importInput?.click());

  importInput?.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: "array" });

      const videoSheet = workbook.Sheets["Videos"];
      if (!videoSheet) {
        alert('No "Videos" sheet found in that Excel file');
        return;
      }
      const videoRows = XLSX.utils.sheet_to_json(videoSheet, { defval: null });

      const rawDataSheet = workbook.Sheets["raw_data"];
      const rawDataRows = rawDataSheet ? XLSX.utils.sheet_to_json(rawDataSheet, { defval: null }) : [];
      if (!rawDataSheet) {
        console.warn('No "raw_data" sheet found - width/height fingerprint enrichment skipped');
      }

      const joinedRows = joinVideosWithRawData(videoRows, rawDataRows);
      console.log(`Scray Excel import: ${videoRows.length} Videos rows loaded`);

      localStorage.setItem("scrayExcelVideosCache", JSON.stringify(joinedRows));
      window.scrayExcelVideoRows = joinedRows;

      await matchExcelMetadataToLocalVideos(joinedRows);
      updateScrayExcelButtonStatus(true);
    } catch (err) {
      console.error("Scray Excel import failed:", err);
      alert("Failed to import Excel file: " + err.message);
    } finally {
      e.target.value = ""; // allow re-selecting the same file later
    }
  });

  const cached = localStorage.getItem("scrayExcelVideosCache");
  if (cached) {
    try {
      window.scrayExcelVideoRows = JSON.parse(cached);
      updateScrayExcelButtonStatus(true);
    } catch (err) {
      console.warn("Could not parse cached Scray Excel data:", err);
      updateScrayExcelButtonStatus(false);
    }
  } else {
    updateScrayExcelButtonStatus(false);
  }
});

function updateScrayExcelButtonStatus(loaded) {
  const btn = document.getElementById("excelOnlineConnectBtn");
  if (!btn) return;
  if (loaded) {
    btn.textContent = "📊 Excel ✓";
    btn.style.background = "#28a745";
  } else {
    btn.textContent = "📊 Import Excel";
    btn.style.background = "#555";
  }
}

/** Join Videos-sheet rows onto raw_data rows via oneDriveId/id to pull in width/height/duration_ms */
function joinVideosWithRawData(videoRows, rawDataRows) {
  const rawById = new Map();
  rawDataRows.forEach(r => { if (r.id) rawById.set(r.id, r); });

  return videoRows.map(v => {
    const raw = v.oneDriveId ? rawById.get(v.oneDriveId) : null;
    return {
      ...v,
      width: raw?.width ?? null,
      height: raw?.height ?? null,
      duration_ms: raw?.duration_ms ?? null,
      file_size_bytes: raw?.size_bytes ?? v.file_size_bytes ?? null,
      bitrate: raw?.bitrate ?? v.bitrate ?? null
    };
  });
}

/** Group joined rows by filename (some filenames have true duplicate catalog entries) */
function buildExcelVideoIndex(rows) {
  const map = new Map();
  rows.forEach(row => {
    if (!row.filename) return;
    if (!map.has(row.filename)) map.set(row.filename, []);
    map.get(row.filename).push(row);
  });
  return map;
}

/** True if two bitrates are within a tolerance band */
function bitrateWithinTolerance(a, b, pct = 0.02) {
  if (a == null || b == null || a === 0 || b === 0) return null;
  return Math.abs(a - b) / Math.max(a, b) <= pct;
}

/** Score how well an Excel candidate row matches a local video's own scanned metadata */
function scoreCandidateMatch(candidate, nativeMeta) {
  if (!nativeMeta) return 0;
  let score = 0;

  if (candidate.width != null && candidate.height != null &&
      candidate.width === nativeMeta.width && candidate.height === nativeMeta.height) {
    score += 2;
  }
  if (bitrateWithinTolerance(candidate.bitrate, nativeMeta.bitrate)) score++;
  if (candidate.file_size_bytes && nativeMeta.sizeBytes && candidate.file_size_bytes === nativeMeta.sizeBytes) score++;
  if (candidate.duration_ms != null && nativeMeta.duration != null) {
    const durMsFromNative = nativeMeta.duration * 1000;
    if (Math.abs(candidate.duration_ms - durMsFromNative) / Math.max(candidate.duration_ms, durMsFromNative) <= 0.02) score++;
  }
  return score;
}

/**
* Match imported Excel rows onto local videos already scanned into
* IndexedDB (driveId === "local"). Filename is the lookup key; the
* fingerprint (already captured at scan time - no native call needed)
* disambiguates true duplicate filenames.
*
* NOTE: this overwrites videoMeta unconditionally for every matched video
* (score, notes, bookmarks, etc.) - there's no conflict check yet against
* anything you've already set in-app. That's the "alert before overwrite"
* piece you mentioned as a later step.
*/
async function matchExcelMetadataToLocalVideos(excelRows) {
  const excelIndex = buildExcelVideoIndex(excelRows);
  const allVideos = await getAllVideos();
  const localVideos = allVideos.filter(v => v.driveId === "local");

  let matched = 0, unmatched = 0, lowConfidence = 0;

  for (const video of localVideos) {
    const candidates = excelIndex.get(video.filename);
    if (!candidates || candidates.length === 0) {
      unmatched++;
      continue;
    }

    let chosen = candidates[0];

    if (candidates.length > 1) {
      const nativeMeta = {
        width: video.width,
        height: video.height,
        bitrate: video.bitrate,
        duration: video.durationMs != null ? video.durationMs / 1000 : null,
        sizeBytes: video.sizeBytes
      };
      const scored = candidates
        .map(c => ({ row: c, score: scoreCandidateMatch(c, nativeMeta) }))
        .sort((a, b) => b.score - a.score);
      chosen = scored[0].row;

      if (scored[0].score === 0) {
        lowConfidence++;
        console.warn(`Low-confidence Excel match for "${video.filename}" (${candidates.length} candidates, no fingerprint corroboration) - using first entry`);
      }
    }

    let bookmarks = [];
    if (chosen.bookmarks) {
      try {
        bookmarks = JSON.parse(chosen.bookmarks);
      } catch (err) {
        console.warn(`Could not parse bookmarks for "${video.filename}":`, err.message);
      }
    }

    const metaUpdates = {
      view_count: chosen.view_count ?? 0,
      user_score: chosen.user_score ?? null,
      notes: chosen.notes ?? null,
      last_played: chosen.last_played ?? null,
      first_seen: chosen.first_seen ?? null,
      f_tally: chosen.f_tally ?? 0,
      bookmarks
    };

    await saveVideoMeta(video.oneDriveId, metaUpdates, "excel-import");

    // Tags live in videoSource, not videoMeta - merge (union) rather than
    // overwrite, so re-importing never removes a tag you've added since.
    if (chosen.tags) {
      const excelTags = chosen.tags.split(";").map(t => t.trim()).filter(Boolean);
      const mergedTags = [...new Set([...(video.tags || []), ...excelTags])];
      await updateVideoInDB(video.oneDriveId, { tags: mergedTags });
    }

    matched++;
  }

  console.log(`Excel match complete: ${matched} matched (${lowConfidence} low-confidence), ${unmatched} unmatched`);
  alert(`Excel import matched ${matched} of ${localVideos.length} local videos\n(${lowConfidence} low-confidence, ${unmatched} unmatched)`);

  if (typeof refreshAllLists === "function") refreshAllLists();
}
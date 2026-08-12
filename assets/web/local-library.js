// =========================================
// LOCAL FOLDER REGISTRY + PILLS
// Videos are attributed to a folder via accountName, so accountKey stays
// "local::local" and every existing `driveId === "local"` check keeps working.
// =========================================
const LOCAL_FOLDERS_KEY = "scrayLocalFolders";

function getLocalFolders() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_FOLDERS_KEY)) || [];
  } catch {
    return [];
  }
}

function saveLocalFolders(folders) {
  localStorage.setItem(LOCAL_FOLDERS_KEY, JSON.stringify(folders));
}

function registerLocalFolder(name) {
  const folders = getLocalFolders();
  if (!folders.some(f => f.name === name)) {
    folders.push({ name, addedAt: new Date().toISOString() });
    saveLocalFolders(folders);
  }
  localStorage.setItem("scrayActiveFolder", name);
  return name;
}

function getActiveFolderName() {
  return localStorage.getItem("scrayActiveFolder")
      || getLocalFolders()[0]?.name
      || "Video Folder";
}

/**
* pickFolder's return shape is decided by the native layer, so accept
* whatever it hands back and dig out something human-readable.
*/
function resolveFolderName(result) {
  const lastComponent = (p) => {
    if (!p) return null;
    const parts = String(p).split("/").filter(Boolean);
    let name = parts[parts.length - 1] || null;
    if (name) { try { name = decodeURIComponent(name); } catch {} }
    return name;
  };

  if (!result) return "Video Folder";
  if (typeof result === "string") return lastComponent(result) || result;

  return result.name
      || result.folderName
      || result.displayName
      || lastComponent(result.path)
      || lastComponent(result.url)
      || "Video Folder";
}
window.resolveFolderName = resolveFolderName;

async function renderFolderPills() {
  const container = document.getElementById("accountLoadButtons");
  if (!container) return;

  const folders = getLocalFolders();
  container.innerHTML = "";

  if (!folders.length) return;

  let allVideos = [];
  try {
    allVideos = await getAllVideos();
  } catch (err) {
    console.warn("renderFolderPills: could not read DB", err);
  }

  const activeName = getActiveFolderName();

  folders.forEach(folder => {
    const count = allVideos.filter(
      v => v.driveId === "local" && v.accountName === folder.name
    ).length;

    const pill = document.createElement("div");
    pill.className = "account-pill";
    pill.dataset.username = folder.name;

    const labelText = `${folder.name} (${count})`;

    const loadBtn = document.createElement("button");
    loadBtn.className = "account-load-btn";
    loadBtn.textContent = labelText;
    loadBtn.title = "Tap to refresh this folder";
    // ✅ Every added folder stays "loaded". No greying out - the active
    // folder is an internal scan target, not a display state.

    const disarmRefresh = () => {
      if (pill.dataset.refreshState !== 'confirming') return;
      pill.dataset.refreshState = 'initial';
      loadBtn.textContent = labelText;
      loadBtn.style.background = '';
      if (pill._refreshTimeout) { clearTimeout(pill._refreshTimeout); pill._refreshTimeout = null; }
      if (pill._refreshOutsideHandler) {
        document.removeEventListener('click', pill._refreshOutsideHandler, true);
        pill._refreshOutsideHandler = null;
      }
    };

    loadBtn.addEventListener("click", async (e) => {
      e.stopPropagation();

      // Don't compete with the remove-confirm state
      if (pill.dataset.removeState === 'confirming') return;

      // First tap arms, second tap commits
      if (pill.dataset.refreshState !== 'confirming') {
        pill.dataset.refreshState = 'confirming';
        loadBtn.textContent = 'Refresh?';
        loadBtn.style.background = '#007bff';

        // Tapping anywhere else cancels. Capture phase so it fires before
        // other handlers; the stopPropagation above keeps our own tap out.
        pill._refreshOutsideHandler = (ev) => {
          if (!pill.contains(ev.target)) disarmRefresh();
        };
        document.addEventListener('click', pill._refreshOutsideHandler, true);

        pill._refreshTimeout = setTimeout(disarmRefresh, 5000);
        return;
      }

      // Confirmed
      disarmRefresh();
      loadBtn.textContent = "Scanning...";
      loadBtn.disabled = true;
      try {
        await scanLocalLibrary(folder.name);
      } catch (err) {
        console.error("Rescan failed:", err);
        alert(`Refresh failed: ${err.message}`);
        loadBtn.textContent = labelText;
      } finally {
        loadBtn.disabled = false;
      }
    });

    const removeBtn = document.createElement("span");
    removeBtn.className = "account-remove-cross";
    removeBtn.innerHTML = "&times;";
    removeBtn.title = "Remove these videos from the database";
    removeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      removeLocalFolder(folder.name);
    });

    pill.appendChild(loadBtn);
    pill.appendChild(removeBtn);
    container.appendChild(pill);
  });
}
window.renderFolderPills = renderFolderPills;

/**
* Removes a folder's videos from IndexedDB only. Files on disk are untouched.
*/
async function removeLocalFolder(folderName) {
  const pill = document.querySelector(`.account-pill[data-username="${folderName}"]`);
  if (!pill) return;

  const state = pill.dataset.removeState || 'initial';

  // ✅ First tap arms it, second tap commits. confirm() is unreliable inside
  // WKWebView, which is why the old dialog-based version silently did nothing.
  if (state === 'initial') {
    pill.dataset.removeState = 'confirming';
    pill.style.backgroundColor = '#999';
    pill.style.cursor = 'pointer';
    pill.title = 'Tap the pill again to confirm - files on disk are NOT deleted';

    const loadBtn = pill.querySelector('.account-load-btn');
    const removeBtn = pill.querySelector('.account-remove-cross');

    if (loadBtn) {
      loadBtn.textContent = 'Confirm remove?';
      loadBtn.disabled = true;
      loadBtn.style.background = '#999';
      loadBtn.style.color = 'white';
      loadBtn.style.cursor = 'pointer';
      loadBtn.style.pointerEvents = 'none'; // let the tap reach the pill
    }
    if (removeBtn) removeBtn.style.display = 'none';

    pill._confirmClickHandler = (e) => {
      e.stopPropagation();
      e.preventDefault();
      removeLocalFolder(folderName);
    };
    pill.addEventListener('click', pill._confirmClickHandler);

    // Disarm after 5s
    pill._resetTimeout = setTimeout(() => {
      if (pill && pill.dataset.removeState === 'confirming') {
        pill.dataset.removeState = 'initial';
        pill.style.backgroundColor = '';
        pill.style.cursor = '';
        pill.title = '';
        if (loadBtn) {
          loadBtn.disabled = false;
          loadBtn.style.background = '';
          loadBtn.style.color = '';
          loadBtn.style.cursor = '';
          loadBtn.style.pointerEvents = '';
        }
        if (removeBtn) removeBtn.style.display = '';
        if (pill._confirmClickHandler) {
          pill.removeEventListener('click', pill._confirmClickHandler);
          pill._confirmClickHandler = null;
        }
        renderFolderPills().catch(() => {});
      }
    }, 5000);

    return;
  }

  // Second tap - commit
  if (pill._resetTimeout) clearTimeout(pill._resetTimeout);
  if (pill._confirmClickHandler) {
    pill.removeEventListener('click', pill._confirmClickHandler);
    pill._confirmClickHandler = null;
  }

  const confirmBtn = pill.querySelector('.account-load-btn');
  if (confirmBtn) confirmBtn.textContent = 'Removing...';

  const allVideos = await getAllVideos();
  const doomed = allVideos.filter(
    v => v.driveId === "local" && v.accountName === folderName
  );

  for (const v of doomed) {
    try {
      await deleteVideoFromDB(v.oneDriveId);
      if (typeof removeVideoFromMemory === "function") {
        removeVideoFromMemory(v.oneDriveId);
      }
    } catch (err) {
      console.warn(`Failed to remove ${v.filename}:`, err);
    }
  }

  saveLocalFolders(getLocalFolders().filter(f => f.name !== folderName));
  if (getActiveFolderName() === folderName) {
    localStorage.removeItem("scrayActiveFolder");
  }

  console.log(`Removed folder "${folderName}": ${doomed.length} videos cleared`);

  if (typeof populateTagDropdowns === "function") await populateTagDropdowns();
  if (typeof refreshAllLists === "function") refreshAllLists();
  await renderFolderPills();
}
window.removeLocalFolder = removeLocalFolder;

async function scanLocalLibrary(folderNameOverride) {
  const folderName = folderNameOverride || getActiveFolderName();
  console.log(`scanLocalLibrary: starting for "${folderName}"`);
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
    const orientation = deriveOrientation(width, height); // see db.js

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

  // folderName lands in accountName; accountId stays "local" so accountKey
  // remains "local::local" for the existing local-video guards
  await saveVideos(videos, folderName, "local", "local");
  registerLocalFolder(folderName);
  console.log(`scanLocalLibrary: saved ${videos.length} videos under "${folderName}"`);

  if (typeof renderFolderPills === "function") await renderFolderPills();

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

  // Match against the catalogue now rather than waiting for the next launch.
  // Non-fatal: the scan itself succeeded, and boot will retry.
  if (typeof window.scraySyncLibrary === "function") {
    try {
      const res = await window.scraySyncLibrary({ quiet: true });
      console.log(`scanLocalLibrary: synced — ${res.pulled} matched, ${res.flagged} not in catalogue`);
      if (typeof window.loadCachesFromMeta === 'function') await window.loadCachesFromMeta(true);
      if (typeof filterDisplayedByFilename === 'function') await filterDisplayedByFilename();
    } catch (err) {
      console.warn("scanLocalLibrary: catalogue sync failed, will retry on next launch:", err.message);
    }
  }

  console.log(`Scanned local library: ${videos.length} videos found`);
} 

/**
* Repair orientation on videos scanned before native width/height existed.
* The dropdown filters on an exact "L"/"P" match, so a row still holding
* orientation: null disappears whenever a specific orientation is selected.
* This fills those gaps in place - no full rescan required.
* For local files oneDriveId IS the relative path, so it can be passed
* straight back to getVideoMetadata().
*/
async function backfillVideoOrientation() {
  const videos = await getAllVideos();
  const needsFix = videos.filter(v => v.driveId === "local" && !v.orientation);

  if (needsFix.length === 0) {
    console.log("backfillVideoOrientation: nothing to fix");
    return 0;
  }

  console.log(`backfillVideoOrientation: repairing ${needsFix.length} video(s)`);
  let fixed = 0;

  for (const video of needsFix) {
    let width = video.width;
    let height = video.height;

    // No stored dimensions at all - ask the native layer for them once
    if ((width == null || height == null) && typeof ScrayBridge !== "undefined") {
      try {
        const meta = await ScrayBridge.getVideoMetadata(video.oneDriveId);
        width = meta?.width ?? null;
        height = meta?.height ?? null;
      } catch (err) {
        console.warn(`backfillVideoOrientation: metadata failed for ${video.filename}: ${err.message}`);
      }
    }

    const orientation = deriveOrientation(width, height);
    if (!orientation) continue;

    await updateVideoInDB(video.oneDriveId, { width, height, orientation });
    fixed++;
  }

  console.log(`backfillVideoOrientation: fixed ${fixed} of ${needsFix.length}`);

  if (fixed > 0) {
    if (typeof populateTagDropdowns === "function") await populateTagDropdowns();
    if (typeof filterDisplayedByFilename === "function") await filterDisplayedByFilename();
  }

  return fixed;
}
window.backfillVideoOrientation = backfillVideoOrientation;

window.addEventListener("DOMContentLoaded", () => {
  // Self-heal any rows predating native width/height so the orientation
  // dropdown has something to match against
  backfillVideoOrientation().catch(err => console.warn("Orientation backfill failed:", err));

  // Paint any previously added folders on load
  renderFolderPills().catch(err => console.warn("Folder pill render failed:", err));

  document.getElementById("pickFolderBtn")?.addEventListener("click", async () => {
    console.log("pickFolderBtn clicked");
    const btn = document.getElementById("pickFolderBtn");
    const originalText = btn ? btn.textContent : null;
    try {
      const result = await ScrayBridge.pickFolder();
      console.log("pickFolder result: " + JSON.stringify(result));

      const folderName = resolveFolderName(result);
      registerLocalFolder(folderName);
      await renderFolderPills();

      if (btn) { btn.textContent = "Scanning..."; btn.disabled = true; }
      await scanLocalLibrary(folderName);
    } catch (err) {
      console.error("pickFolder ERROR: " + err.message);
    } finally {
      if (btn) { btn.textContent = originalText; btn.disabled = false; }
    }
  });

  // ✅ "Refresh" - re-scans the linked folder and updates the pill counts
  document.getElementById("rescanLibraryBtn")?.addEventListener("click", async () => {
    const btn = document.getElementById("rescanLibraryBtn");
    const originalText = btn ? btn.textContent : null;
    if (btn) { btn.textContent = "Refreshing..."; btn.disabled = true; }
    try {
      await scanLocalLibrary();
    } catch (err) {
      console.error("Refresh failed:", err);
      alert(`Refresh failed: ${err.message}`);
    } finally {
      if (btn) { btn.textContent = originalText; btn.disabled = false; }
    }
  });
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

      // The union can be large; localStorage has a ~5MB ceiling
      try {
        localStorage.setItem("scrayExcelVideosCache", JSON.stringify(joinedRows));
      } catch (quotaErr) {
        console.warn("Catalogue too large for localStorage - keeping in memory only:", quotaErr.message);
        localStorage.removeItem("scrayExcelVideosCache");
      }
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
/**
* Build the UNION of Videos + raw_data, keyed on oneDriveId.
*
* These are two partially-overlapping catalogues, not a table and its index:
* on a real workbook, 271 Videos ids had no raw_data twin while raw_data held
* 6,251 rows against Videos' 1,683. Using either alone loses videos - measured
* on 422 local files, Videos-only matched 151 and the union matched 270.
*
* Both sheets now share the v2 schema, so rows merge field-by-field with the
* richer value winning.
*/
function joinVideosWithRawData(videoRows, rawDataRows) {
  const union = new Map();

  const idOf = (r) => r.oneDriveId ?? r.id ?? null;

  // Legacy raw_data used size_bytes; v2 uses file_size_bytes
  const normalize = (r) => ({
    ...r,
    oneDriveId: idOf(r),
    file_size_bytes: r.file_size_bytes ?? r.size_bytes ?? null,
    web_url: r.web_url ?? r.webUrl ?? null
  });

  const absorb = (r) => {
    const row = normalize(r);
    if (!row.oneDriveId) return;
    const existing = union.get(row.oneDriveId);
    if (!existing) {
      union.set(row.oneDriveId, row);
      return;
    }
    // Merge: a non-empty value beats an empty one
    Object.keys(row).forEach(k => {
      const val = row[k];
      if (val !== null && val !== undefined && val !== "" &&
          (existing[k] === null || existing[k] === undefined || existing[k] === "")) {
        existing[k] = val;
      }
    });
  };

  rawDataRows.forEach(absorb);
  videoRows.forEach(absorb);   // Videos wins on user metadata by going last

  const out = [...union.values()];
  const withSize = out.filter(r => r.file_size_bytes).length;
  const withDuration = out.filter(r => r.duration_ms).length;
  console.log(
    `Catalogue union: ${out.length} videos ` +
    `(Videos ${videoRows.length}, raw_data ${rawDataRows.length}) - ` +
    `${withSize} with size, ${withDuration} with duration`
  );
  return out;
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
  const index = buildCatalogIndex(excelRows);
  const claimed = new Set();
  const allVideos = await getAllVideos();
  const localVideos = allVideos.filter(v => v.driveId === "local");

  let matched = 0, unmatched = 0, lowConfidence = 0;
  const viaStats = {};
  const failReasons = [];
  const matchedBookmarksById = new Map(); // oneDriveId -> bookmarks[], used to patch in-memory copies after the loop

  for (const video of localVideos) {
    // ✅ Tiered: id -> exact size -> size+intrinsics -> filename.
    // Never tolerance-matches size: on a 6.5k catalogue a 0.1% band
    // "matches" 150 files that aren't in the catalogue at all.
    const { row: chosen, via, reason } = matchVideoToCatalog(video, index, claimed);

    if (!chosen) {
      unmatched++;
      failReasons.push(reason);
      continue;
    }

    claimed.add(chosen);
    viaStats[via] = (viaStats[via] || 0) + 1;
    if (via === "filename") lowConfidence++;

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

    // ✅ THE POINT OF ALL THIS: attach the stable OneDrive identity to the
    // local row. Once catalogueId is set, every later match is tier-1 and
    // renames on either side stop mattering.
    await updateVideoInDB(video.oneDriveId, {
      catalogueId: chosen.oneDriveId,
      web_url: chosen.web_url ?? null,
      catalogue_path: chosen.path ?? null,
      catalogue_filename: chosen.filename ?? null,
      matched_via: via
    });

    // Tags live in videoSource, not videoMeta - merge (union) rather than
    // overwrite, so re-importing never removes a tag you've added since.
    if (chosen.tags) {
      const excelTags = chosen.tags.split(";").map(t => t.trim()).filter(Boolean);
      const mergedTags = [...new Set([...(video.tags || []), ...excelTags])];
      await updateVideoInDB(video.oneDriveId, { tags: mergedTags });
    }

    matchedBookmarksById.set(video.oneDriveId, bookmarks);
    matched++;
  }

  const viaSummary = Object.entries(viaStats).map(([k, n]) => `${k}: ${n}`).join(", ");
  console.log(`Excel match complete: ${matched}/${localVideos.length} matched (${viaSummary})`);

  if (failReasons.length) {
    const buckets = {};
    failReasons.forEach(r => {
      const key = r.startsWith("size ") ? "already claimed by another file"
                : r.startsWith("ambiguous") ? "ambiguous (several rows share the size)"
                : r;
      buckets[key] = (buckets[key] || 0) + 1;
    });
    console.log("Unmatched breakdown:");
    Object.entries(buckets)
      .sort((a, b) => b[1] - a[1])
      .forEach(([k, n]) => console.log(`  ${n}x  ${k}`));
  }

  alert(
    `Excel import matched ${matched} of ${localVideos.length} local videos.\n\n` +
    `By method - ${viaSummary || "none"}\n` +
    `Unmatched: ${unmatched} (see console for reasons)`
  );

  if (typeof refreshAllLists === "function") refreshAllLists();

  // Patch bookmarks into anything refreshAllLists() won't touch: basket
  // and history are localStorage snapshots, not re-fetched from
  // IndexedDB, and the currently-playing video's markers need an
  // explicit re-render rather than just updated underlying data.
  if (window.basketVideos && window.basketVideos.length > 0) {
    let basketChanged = false;
    window.basketVideos.forEach(v => {
      const fresh = matchedBookmarksById.get(v.oneDriveId);
      if (fresh) { v.bookmarks = fresh; basketChanged = true; }
    });
    if (basketChanged && typeof window.saveBasket === "function") window.saveBasket();
    if (basketChanged && typeof window.renderBasket === "function") window.renderBasket();
  }

  if (window.historyVideos && window.historyVideos.length > 0) {
    let historyChanged = false;
    window.historyVideos.forEach(v => {
      const fresh = matchedBookmarksById.get(v.oneDriveId);
      if (fresh) { v.bookmarks = fresh; historyChanged = true; }
    });
    if (historyChanged && typeof window.saveHistory === "function") window.saveHistory();
    if (historyChanged && typeof window.renderHistory === "function") window.renderHistory();
  }

  if (window.currentPlayingVideo) {
    const fresh = matchedBookmarksById.get(window.currentPlayingVideo.oneDriveId);
    if (fresh) {
      window.currentPlayingVideo.bookmarks = fresh;
    }
    if (typeof window.renderBookmarkMarkers === "function") {
      window.renderBookmarkMarkers();
    }
  }
}

/**
* Re-import a CSV previously produced by exportVideosToCsv()/downloadVideosCsv().
* Matches primarily on fingerprint (encodes filename+width+height+duration+
* bitrate, so it's more precise than filename alone), falling back to
* filename when no fingerprint match is found. Writes to videoMeta via
* saveVideoMeta(), merges tags (union) into videoSource - same pattern as
* the Excel importer, including the post-import bookmark marker refresh.
*/
async function importMetadataCsv(file) {
  const text = await file.text();
  const workbook = XLSX.read(text, { type: "string" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });

  if (!rows.length) {
    alert("CSV file contained no rows");
    return;
  }

  const allVideos = await getAllVideos();
  const localVideos = allVideos.filter(v => v.driveId === "local");
  const byFingerprint = new Map(localVideos.map(v => [v.fingerprint, v]));
  const byFilename = new Map();
  localVideos.forEach(v => {
    if (!byFilename.has(v.filename)) byFilename.set(v.filename, []);
    byFilename.get(v.filename).push(v);
  });

  let matched = 0, unmatched = 0;
  const matchedBookmarksById = new Map();

  for (const row of rows) {
    let video = row.fingerprint ? byFingerprint.get(row.fingerprint) : null;

    if (!video) {
      const candidates = byFilename.get(row.filename);
      if (candidates && candidates.length === 1) {
        video = candidates[0];
      } else if (candidates && candidates.length > 1) {
        console.warn(`Ambiguous filename match for "${row.filename}" (${candidates.length} local videos share this name, no fingerprint match) - skipping`);
      }
    }

    if (!video) {
      unmatched++;
      continue;
    }

    let bookmarks = [];
    if (row.bookmarks) {
      try {
        bookmarks = JSON.parse(row.bookmarks);
      } catch (err) {
        console.warn(`Could not parse bookmarks for "${row.filename}":`, err.message);
      }
    }
    matchedBookmarksById.set(video.oneDriveId, bookmarks);

    const metaUpdates = {
      view_count: row.view_count ?? 0,
      user_score: row.user_score ?? null,
      notes: row.notes ?? null,
      last_played: row.last_played ?? null,
      first_seen: row.first_seen ?? null,
      f_tally: row.f_tally ?? 0,
      bookmarks
    };
    await saveVideoMeta(video.oneDriveId, metaUpdates, "csv-import");

    if (row.tags) {
      const csvTags = String(row.tags).split(";").map(t => t.trim()).filter(Boolean);
      const mergedTags = [...new Set([...(video.tags || []), ...csvTags])];
      await updateVideoInDB(video.oneDriveId, { tags: mergedTags });
    }

    matched++;
  }

  console.log(`Metadata CSV import complete: ${matched} matched, ${unmatched} unmatched`);
  alert(`Metadata CSV import matched ${matched} of ${rows.length} rows (${unmatched} unmatched)`);

  if (typeof refreshAllLists === "function") refreshAllLists();

  if (window.basketVideos && window.basketVideos.length > 0) {
    let basketChanged = false;
    window.basketVideos.forEach(v => {
      const fresh = matchedBookmarksById.get(v.oneDriveId);
      if (fresh) { v.bookmarks = fresh; basketChanged = true; }
    });
    if (basketChanged && typeof window.saveBasket === "function") window.saveBasket();
    if (basketChanged && typeof window.renderBasket === "function") window.renderBasket();
  }

  if (window.historyVideos && window.historyVideos.length > 0) {
    let historyChanged = false;
    window.historyVideos.forEach(v => {
      const fresh = matchedBookmarksById.get(v.oneDriveId);
      if (fresh) { v.bookmarks = fresh; historyChanged = true; }
    });
    if (historyChanged && typeof window.saveHistory === "function") window.saveHistory();
    if (historyChanged && typeof window.renderHistory === "function") window.renderHistory();
  }

  if (window.currentPlayingVideo) {
    const fresh = matchedBookmarksById.get(window.currentPlayingVideo.oneDriveId);
    if (fresh) {
      window.currentPlayingVideo.bookmarks = fresh;
    }
    if (typeof window.renderBookmarkMarkers === "function") {
      window.renderBookmarkMarkers();
    }
  }
}
window.importMetadataCsv = importMetadataCsv;
/**
 * Sync prompts, status pill, and the conflict report.
 *
 * The prompt is deliberately not automatic-and-silent: you asked to be told
 * when a sync happens, and a background sync that quietly changes 200 scores
 * is exactly the failure mode Excel had.
 */

function setSyncStatus(text, color = "#999") {
  const el = document.getElementById("syncStatus");
  if (el) { el.textContent = text; el.style.color = color; }
}

async function refreshSyncStatus() {
  const pending = (await scrayGetOutbox()).length;
  const online = navigator.onLine;
  if (pending && !online)  return setSyncStatus(`🔴 ${pending} pending (offline)`, "#e67e22");
  if (pending)             return setSyncStatus(`🟡 ${pending} pending`, "#f1c40f");
  const cursor = await scrayGetSyncState("cursor");
  if (!cursor)             return setSyncStatus("⚪ not synced", "#999");
  const mins = Math.round((Date.now() - new Date(cursor.at)) / 60000);
  setSyncStatus(mins < 2 ? "🟢 synced" : `🟢 synced ${mins}m ago`, "#27ae60");
}
window.refreshSyncStatus = refreshSyncStatus;

function scrayModal(title, bodyHtml, buttons) {
  return new Promise((resolve) => {
    const modal = document.createElement("div");
    modal.className = "basket-json-modal";
    modal.innerHTML = `
      <div class="basket-json-modal-content">
        <h3>${title}</h3>
        <div style="font-size:0.9rem;line-height:1.5;max-height:50vh;overflow:auto;">${bodyHtml}</div>
        <div class="file-operation-buttons">
          ${buttons.map((b, i) =>
            `<button data-i="${i}" class="modal-btn ${b.primary ? "modal-btn-primary" : "modal-btn-cancel"}">${b.label}</button>`
          ).join("")}
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.querySelectorAll("button[data-i]").forEach(btn => {
      btn.addEventListener("click", () => {
        const choice = buttons[Number(btn.dataset.i)].value;
        modal.remove();
        resolve(choice);
      });
    });
  });
}

/** Full sync with prompts. Called by the button and on reconnect. */
async function scraySyncNow({ prompt = true } = {}) {
  const pending = await scrayGetOutbox();

  if (!(await scrayIsServerReachable())) {
    await scrayModal("Offline",
      `<p>Can't reach macnguyen.com.</p>
       <p><strong>${pending.length}</strong> change(s) are queued and will sync when you're back online. Nothing is lost.</p>`,
      [{ label: "OK", value: null, primary: true }]);
    return;
  }

  if (prompt) {
    const affected = new Set(pending.map(p => p.oneDriveId)).size;
    const go = await scrayModal("Sync with server",
      `<p>Ready to sync.</p>
       <ul>
         <li><strong>${pending.length}</strong> queued change(s) across <strong>${affected}</strong> video(s) to upload</li>
         <li>Then download anything changed elsewhere since your last sync</li>
       </ul>
       <p style="color:#888;">Counters (views, f-tally) keep whichever value is higher — nothing you did offline gets overwritten by a lower count elsewhere.</p>`,
      [{ label: "Cancel", value: false }, { label: "Sync now", value: true, primary: true }]);
    if (!go) return;
  }

  setSyncStatus("⏳ syncing…", "#3498db");
  try {
    const { pushed, conflicts, held } = await scrayPushOutbox();

    // Held back because db_mode.txt moved while this device was offline. Ask
    // before pulling: the answer may be "switch the server back", which
    // reloads, and there's no point pulling a database we're about to leave.
    if (held && window.scrayDbMode) {
      setSyncStatus(`🟠 ${held} held (wrong DB)`, "#e67e22");
      await window.scrayDbMode.resolveHeld();
      return;
    }

    const { pulled } = await scrayPullDeltas(window.scrayApplyPulledRow);

    if (conflicts.length) {
      await scrayShowConflicts(conflicts);
    } else {
      await scrayModal("Sync complete",
        `<p>⬆️ ${pushed} change(s) uploaded<br>⬇️ ${pulled} change(s) downloaded</p>`,
        [{ label: "OK", value: null, primary: true }]);
    }

    if (typeof refreshAllLists === "function") refreshAllLists();
  } catch (err) {
    await scrayModal("Sync failed",
      `<p>${err.message}</p><p>Your changes are still queued locally — nothing was lost. Try again later.</p>`,
      [{ label: "OK", value: null, primary: true }]);
  } finally {
    refreshSyncStatus();
  }
}
window.scraySyncNow = scraySyncNow;

/** Conflict report. Server already applied your side; this tells you what it stepped on. */
async function scrayShowConflicts(conflicts) {
  const rows = conflicts.map(c => `
    <tr>
      <td style="padding:4px;border-bottom:1px solid #eee;"><code>${String(c.id).slice(-12)}</code></td>
      <td style="padding:4px;border-bottom:1px solid #eee;">${c.field}</td>
      <td style="padding:4px;border-bottom:1px solid #eee;color:#27ae60;">${c.yours ?? "—"}</td>
      <td style="padding:4px;border-bottom:1px solid #eee;color:#e67e22;">${c.theirs ?? "—"}</td>
      <td style="padding:4px;border-bottom:1px solid #eee;font-size:0.8rem;color:#888;">${c.their_device ?? "?"}</td>
    </tr>`).join("");

  await scrayModal(`⚠️ ${conflicts.length} conflict(s)`,
    `<p>These fields were changed on another device while you were offline. <strong>Your version won.</strong> The previous value is recoverable from <code>sync_log</code>.</p>
     <table style="width:100%;border-collapse:collapse;font-size:0.85rem;">
       <tr style="text-align:left;"><th>Video</th><th>Field</th><th>Kept</th><th>Overwritten</th><th>From</th></tr>
       ${rows}
     </table>`,
    [{ label: "OK", value: null, primary: true }]);
}
window.scrayShowConflicts = scrayShowConflicts;

// -------------------------------------------------------------
// Triggers
// -------------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("syncNowBtn")?.addEventListener("click", () => scraySyncNow());
  document.getElementById("syncStatus")?.addEventListener("click", () => scraySyncNow());
  refreshSyncStatus();
  setInterval(refreshSyncStatus, 30000);
});

// Reconnect. navigator.onLine fires on any interface change, so confirm with
// a real ping before bothering you with a prompt.
let reconnectTimer = null;
window.addEventListener("online", () => {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(async () => {
    const pending = await scrayGetOutbox();
    if (!pending.length) return;
    if (!(await scrayIsServerReachable())) return;
    scraySyncNow({ prompt: true });
  }, 3000);
});

window.addEventListener("offline", refreshSyncStatus);

// App returning to foreground is the other reconnect moment on iOS.
document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState !== "visible") return;
  const pending = await scrayGetOutbox();
  if (pending.length && await scrayIsServerReachable()) scraySyncNow({ prompt: true });
  else refreshSyncStatus();
});


/**
 * Pull catalogue metadata for videos on this device.
 *
 * Two passes, split on the local row's `inCatalogue` flag:
 *
 *   never matched (inCatalogue !== true) -> since = 0, full history
 *   already matched                      -> since = cursor, deltas only
 *
 * The split used to be driven by a stored `knownKeys` list, which was a
 * mistake: it recorded keys that had never actually been received, so they
 * became delta-only while their metadata sat far BELOW the cursor. The rows
 * were then permanently unreachable — 256 matched keys returning 0 rows.
 *
 * `inCatalogue` can't drift the same way. saveVideos() resets it to false on
 * every scan, so a rescan always re-asks for full history, and a video added
 * to the catalogue later is picked up regardless of where the cursor sits.
 */
async function scraySyncLibrary({ quiet = false } = {}) {
  const locals = await getAllVideos();
  if (!locals.length) return { pulled: 0, flagged: 0 };

  const freshKeys = new Set();
  const deltaKeys = new Set();
  for (const v of locals) {
    const k = v.videoKey || window.scrayVideoKey(v.filename);
    if (!k) continue;
    // A row that has never been handed a catalogue path needs the full pull,
    // not a delta: its server row may not have changed since the cursor, so a
    // delta would never deliver the path. typeof, not truthiness - "" means the
    // file sits at the catalogue root and is already answered.
    const hasCataloguePath = typeof v.cataloguePath === "string";
    (v.inCatalogue === true && hasCataloguePath ? deltaKeys : freshKeys).add(k);
  }
  if (!freshKeys.size && !deltaKeys.size) return { pulled: 0, flagged: 0 };

  const cursor = await window.scrayGetSyncState("cursor");
  let pulled = 0;
  window._scrayTombstonesIgnored = 0;

  if (freshKeys.size) {
    pulled += await pullScoped([...freshKeys], 0);
    if (!quiet) console.log(`[sync] full pull for ${freshKeys.size} unmatched key(s)`);
  }
  if (deltaKeys.size) {
    pulled += await pullScoped([...deltaKeys], cursor?.seq ?? 0);
  }

  const stats = await window.scrayApiCall("stats");
  await window.scraySetSyncState("cursor", { seq: stats.head, at: new Date().toISOString() });

  if (window._scrayTombstonesIgnored) {
    console.log(`[sync] ${window._scrayTombstonesIgnored} catalogue tombstone(s) ignored — those files are on this device`);
  }
  const flagged = await flagUncatalogued([...freshKeys, ...deltaKeys]);
  await pushOfflineFlags();
  if (typeof refreshAllLists === "function") refreshAllLists();
  return { pulled, flagged };
}
window.scraySyncLibrary = scraySyncLibrary;

/**
 * Tell the server which catalogue rows have a copy on this device.
 *
 * Sits inside scraySyncLibrary rather than in scanLocalLibrary, so it covers
 * both callers: the folder refresh AND the boot sync. And it runs after
 * flagUncatalogued, because that is where fingerprint adoption happens — go
 * earlier and a renamed file reports its local key, which the catalogue has
 * never heard of, and silently never gets marked.
 */
async function pushOfflineFlags() {
  // The server is on a different database than this mirror was built from.
  // Publishing against it would flag the wrong catalogue's rows.
  if (window.SCRAY_DB_MODE_DRIFT) return null;

  const locals = await getAllVideos();

  // offline_sync has whole-list semantics, so an empty list clears every flag
  // in the catalogue. A fresh install before the folder is picked looks
  // exactly like that — refuse to send rather than wipe the lot.
  if (!locals.length) return null;

  const keys = [...new Set(
    locals
      .filter(v => v.inCatalogue === true)
      .map(v => v.videoKey || window.scrayVideoKey(v.filename))
      .filter(Boolean)
  )];
  if (!keys.length) return null;

  try {
    const res = await window.scrayApiCall("offline_sync", {
      method: "POST",
      body: { keys, device: window.SCRAY_SYNC.DEVICE_ID }
    });
    console.log(`[offline] ${res.total_offline} file(s) flagged offline (+${res.marked_offline}, -${res.cleared})`);
    return res;
  } catch (err) {
    // Non-fatal. The scan itself succeeded; the next sync republishes.
    console.warn("[offline] could not publish the offline list:", err.message);
    return null;
  }
}
window.scrayPushOfflineFlags = pushOfflineFlags;

async function pullScoped(keys, since, received = null) {
  let total = 0, from = since;
  for (;;) {
    const res = await window.scrayApiCall("pull", {
      method: "POST", body: { since: from, limit: 5000, keys }
    });

    const bmByKey = new Map();
    (res.bookmarks || []).forEach(b => {
      if (b.deleted) return;
      if (!bmByKey.has(b.video_key)) bmByKey.set(b.video_key, []);
      bmByKey.get(b.video_key).push({ time: b.time_ms / 1000, note: b.note || "", source: b.source || "" });
    });
    bmByKey.forEach(list => list.sort((a, b) => a.time - b.time));

    for (const row of res.videos) {
      await window.scrayApplyPulledRow(window.scrayDbRowToApp(row), row, bmByKey);
      received?.add(row.video_key);
      total++;
    }
    from = res.seq;
    if (!res.more) break;
  }
  return total;
}

/**
 * Anything on this device with no server row is usable but flagged.
 */
async function flagUncatalogued(allKeys) {
  const missing = new Set();
  for (let i = 0; i < allKeys.length; i += 400) {
    const res = await window.scrayApiCall("keycheck", {
      method: "POST", body: { keys: allKeys.slice(i, i + 400) }
    });
    (res.missing || []).forEach(k => missing.add(k));
  }

  // Before flagging, give every orphan one size-anchored lookup. The row may
  // well exist under a different name - renamed outside Picker, or imported
  // to this device from Files. keycheck only ever answers "is this exact key
  // present", so without this pass a renamed file stays orphaned forever.
  //
  // The CATALOGUE key wins: this device adopts it locally rather than rekeying
  // the server row onto the local filename. Picker derives its key from the
  // OneDrive filename on every push AND every scan, so moving the row here
  // just makes Picker mint a second row under the old name.
  const adoptions = new Map();   // local row id -> catalogue video_key
  if (missing.size) {
    const locals = await getAllVideos();
    const claimedKeys = new Set();
    for (const v of locals) {
      const k = v.videoKey || window.scrayVideoKey(v.filename);
      if (!k || !missing.has(k) || !v.sizeBytes) continue;
      const localId = v.oneDriveId ?? v.idFromAPI ?? null;
      if (!localId) continue;
      try {
        const res = await window.scrayApiCall("fingerprint_lookup", {
          method: "POST",
          body: { size: v.sizeBytes, duration_ms: v.durationMs, width: v.width, height: v.height }
        });
        const free = (res.candidates || []).filter(c => !claimedKeys.has(c.video_key));
        // A single size match is already unambiguous - there is nothing for
        // duration/dimensions to disambiguate, so they get no veto. The
        // catalogue's duration_ms is wrong often enough (implied bitrates of
        // 48 Mbps on 720p files) that requiring it rejected 29% of otherwise
        // clean unique matches. Corroborate only when a tiebreak is needed.
        const good = free.length === 1 ? free : free.filter(c => c.corroborated);
        if (good.length !== 1) {
          if (free.length) console.log(`[sync] "${k}": ${free.length} size match(es), none unambiguous — left flagged`);
          continue;
        }
        claimedKeys.add(good[0].video_key);
        adoptions.set(localId, good[0].video_key);
        missing.delete(k);
        console.log(`[sync] "${v.filename}" adopts catalogue key "${good[0].video_key}" (size ${v.sizeBytes})`);
      } catch (err) {
        console.warn(`[sync] lookup failed for "${k}":`, err.message);
      }
    }

    // The adopted key has to be on the local row BEFORE pulling:
    // scrayApplyPulledRow resolves rows through the videoKey index, so pulling
    // first would find nothing and silently drop the metadata.
    if (adoptions.size) {
      const dbA = await openDB();
      const txA = dbA.transaction(STORE_NAME, "readwrite");
      const storeA = txA.objectStore(STORE_NAME);
      for (const [id, key] of adoptions) {
        const row = await new Promise((r2) => {
          const r = storeA.get(id); r.onsuccess = () => r2(r.result); r.onerror = () => r2(null);
        });
        if (row) storeA.put({ ...row, videoKey: key, inCatalogue: true });
      }
      await new Promise((r2, rej) => { txA.oncomplete = r2; txA.onerror = () => rej(txA.error); });

      await pullScoped([...adoptions.values()], 0);
      console.log(`[sync] ${adoptions.size} local video(s) matched to catalogue rows by size`);
    }
  }

  const db = await openDB();
  const tx = db.transaction(STORE_NAME, "readwrite");
  const store = tx.objectStore(STORE_NAME);
  const all = await new Promise((res, rej) => {
    const r = store.getAll(); r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error);
  });
  all.forEach(v => {
    const adopted = adoptions.get(v.oneDriveId);
    const k = adopted || v.videoKey || window.scrayVideoKey(v.filename);
    const inCat = adopted ? true : !missing.has(k);
    if (v.inCatalogue !== inCat || (adopted && v.videoKey !== adopted)) {
      store.put({ ...v, videoKey: k, inCatalogue: inCat });
    }
  });
  await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });

  if (missing.size) console.log(`[sync] ${missing.size} local video(s) not in the catalogue — flagged`);
  return missing.size;
}

/**
 * Pull the latest catalogue metadata on every app load.
 *
 * Deliberately not gated on anything: scores and bookmarks change in Picker
 * between sessions, and this is the only thing that brings them across.
 * Delayed slightly so the video grid paints first.
 */
setTimeout(async () => {
  if (typeof window.scraySyncLibrary !== "function") return;

  // The server is on a different database than this mirror was built from and
  // you chose to leave it that way. Pulling would blend two catalogues.
  if (window.SCRAY_DB_MODE_DRIFT) {
    console.log("[sync] catalogue sync skipped — server is on a different database");
    return;
  }
  try {
    const res = await window.scraySyncLibrary({ quiet: true });
    console.log(`[sync] ${res.pulled} row(s) applied, ${res.flagged} not in catalogue`);
    if (res.pulled) {
      // The grid reads the in-memory caches, not videoMeta, so a pull is
      // invisible until they are rebuilt.
      if (typeof window.loadCachesFromMeta === "function") await window.loadCachesFromMeta(true);
      if (typeof window.refreshAllLists === "function") window.refreshAllLists();
      // Second, direct call - the flag was already consumed by the refresh
      // above, so it needs setting again or this one collapses the list.
      window.scrayKeepListDepth = true;
      if (typeof filterDisplayedByFilename === "function") await filterDisplayedByFilename();
    }
  } catch (err) {
    console.warn("[sync] catalogue sync failed — using local data:", err.message);
  }
}, 2000);


// // TEMPORARY DIAGNOSTIC — remove after.
// setTimeout(async () => {
//   const L = (...a) => console.log("[DIAG]", ...a);
//   try {
//     L("=== METADATA CHAIN ===");

//     // 1. A local row, and its key
//     const locals = await getAllVideos();
//     L("1. local videos:", locals.length);
//     if (!locals.length) return L("   no local videos — stop");
//     const v = locals[0];
//     L("   sample filename :", v.filename);
//     L("   sample videoKey :", JSON.stringify(v.videoKey));
//     L("   oneDriveId      :", v.oneDriveId);
//     L("   inCatalogue     :", v.inCatalogue);
//     L("   user_score now  :", v.user_score);

//     const key = v.videoKey || window.scrayVideoKey(v.filename);

//     // 2. Does the index resolve it?
//     const db = await openDB();
//     const foundId = await window.findLocalIdByKey(db, key);
//     L("2. findLocalIdByKey:", foundId ? "✓ " + foundId : "✗ NULL  <- index lookup failing");

//     // 3. Does the server have it?
//     const kc = await window.scrayApiCall("keycheck", { method: "POST", body: { keys: [key] } });
//     L("3. keycheck found:", kc.found, "missing:", JSON.stringify(kc.missing));

//     // 4. Does a since=0 scoped pull return it, and with what?
//     const pull = await window.scrayApiCall("pull", {
//       method: "POST", body: { since: 0, limit: 10, keys: [key] } });
//     L("4. pull returned:", pull.videos.length, "video(s),", pull.bookmarks.length, "bookmark(s)");
//     if (pull.videos.length) {
//       const raw = pull.videos[0];
//       L("   raw user_score  :", raw.user_score, "| view_count:", raw.view_count, "| seq:", raw.seq);
//       const app = window.scrayDbRowToApp(raw);
//       L("   mapped user_score:", app.user_score);
//       L("   META_FIELDS has user_score:", window.VIDEO_META_FIELDS.has("user_score"));
//     } else {
//       L("   ✗ pull returned nothing for a key keycheck says exists");
//     }

//     // 5. Cursor / knownKeys state
//     L("5. cursor    :", JSON.stringify(await window.scrayGetSyncState("cursor")));
//     const kk = await window.scrayGetSyncState("knownKeys");
//     L("   knownKeys :", kk ? kk.keys.length + " key(s), includes this one: " + kk.keys.includes(key) : "null");

//     // 6. Apply it by hand and see if videoMeta changes
//     if (pull.videos.length) {
//       const before = await getAllVideoMeta();
//       const bm = new Map();
//       (pull.bookmarks || []).filter(b => !b.deleted).forEach(b => {
//         if (!bm.has(b.video_key)) bm.set(b.video_key, []);
//         bm.get(b.video_key).push({ time: b.time_ms / 1000, note: b.note || "" });
//       });
//       await window.scrayApplyPulledRow(window.scrayDbRowToApp(pull.videos[0]), pull.videos[0], bm);
//       const after = (await getAllVideoMeta()).find(m => m.oneDriveId === foundId);
//       L("6. videoMeta rows:", before.length, "->", (await getAllVideoMeta()).length);
//       L("   this row's meta:", after ? JSON.stringify({score: after.user_score, views: after.view_count, bm: (after.bookmarks||[]).length, by: after.updatedBy}) : "✗ NOT FOUND");
//     }

//     // 7. Does the merged view show it?
//     const merged = (await getAllVideos()).find(x => x.oneDriveId === foundId);
//     L("7. merged user_score:", merged?.user_score, "| bookmarks:", (merged?.bookmarks || []).length);

//     // 8. Does the cache?
//     const cache = await window.getCachedVideoScores(true);
//     L("8. cache size:", cache.size, "| this video:", cache.get(foundId));

//     L("=== END ===");
//   } catch (e) { console.error("[DIAG] ✗", e.message, e.stack); }
// }, 4000);


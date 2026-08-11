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
    const { pushed, conflicts } = await scrayPushOutbox();
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
 * Pull only the rows for videos actually on this device.
 *
 * Two passes, because a key-filtered pull advances the cursor to the newest
 * seq it saw. A file added later whose server row is OLDER than the cursor
 * would never arrive — so newly seen keys get a one-off since=0 pull.
 */
async function scraySyncLibrary({ quiet = false } = {}) {
  const locals = await getAllVideos();
  const keys = [...new Set(
    locals.map(v => v.videoKey || window.scrayVideoKey(v.filename)).filter(Boolean)
  )];
  if (!keys.length) return { pulled: 0, flagged: 0 };

  const knownState = await window.scrayGetSyncState("knownKeys");
  const known = new Set(knownState?.keys || []);
  const fresh = keys.filter(k => !known.has(k));
  const cursor = await window.scrayGetSyncState("cursor");

  let pulled = 0;

  if (fresh.length) {
    pulled += await pullScoped(fresh, 0);
    if (!quiet) console.log(`[sync] first-time pull for ${fresh.length} new local file(s)`);
  }

  const established = keys.filter(k => known.has(k));
  if (established.length) {
    pulled += await pullScoped(established, cursor?.seq ?? 0);
  }

  await window.scraySetSyncState("knownKeys", { keys });
  const stats = await window.scrayApiCall("stats");
  await window.scraySetSyncState("cursor", { seq: stats.head, at: new Date().toISOString() });

  const flagged = await flagUncatalogued(keys);
  if (typeof refreshAllLists === "function") refreshAllLists();
  return { pulled, flagged };
}
window.scraySyncLibrary = scraySyncLibrary;

async function pullScoped(keys, since) {
  let total = 0, from = since;
  for (;;) {
    const res = await window.scrayApiCall("pull", {
      method: "POST", body: { since: from, limit: 5000, keys }
    });

    const bmByKey = new Map();
    (res.bookmarks || []).forEach(b => {
      if (b.deleted) return;
      if (!bmByKey.has(b.video_key)) bmByKey.set(b.video_key, []);
      bmByKey.get(b.video_key).push({ time: b.time_ms / 1000, note: b.note || "" });
    });
    bmByKey.forEach(list => list.sort((a, b) => a.time - b.time));

    for (const row of res.videos) {
      await window.scrayApplyPulledRow(window.scrayDbRowToApp(row), row, bmByKey);
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

  const db = await openDB();
  const tx = db.transaction(STORE_NAME, "readwrite");
  const store = tx.objectStore(STORE_NAME);
  const all = await new Promise((res, rej) => {
    const r = store.getAll(); r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error);
  });
  all.forEach(v => {
    const k = v.videoKey || window.scrayVideoKey(v.filename);
    const inCat = !missing.has(k);
    if (v.inCatalogue !== inCat) store.put({ ...v, inCatalogue: inCat });
  });
  await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });

  if (missing.size) console.log(`[sync] ${missing.size} local video(s) not in the catalogue — flagged`);
  return missing.size;
}

// TEMPORARY Stage 4 self-test — comment out once verified.
setTimeout(async () => {
  const log = (...a) => console.log("[S4]", ...a);
  const ok  = (c) => c ? "✓" : "✗";
  try {
    log("=== STAGE 4 SELF-TEST ===");

    const db = await openDB();
    log("1. DB version:", db.version, ok(db.version >= 11));
    log("   videoKey index:",
        ok(db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME)
             .indexNames.contains("videoKey")));

    const locals = await getAllVideos();
    const keys = [...new Set(locals.map(v => v.videoKey).filter(Boolean))];
    log("2. local videos:", locals.length, "| distinct keys:", keys.length, ok(keys.length > 0));
    if (keys.length < locals.length) {
      log("   ⚠ " + (locals.length - keys.length) + " duplicate/missing key(s) locally");
    }

    const check = await window.scrayApiCall("keycheck", {
      method: "POST", body: { keys: keys.slice(0, 400) } });
    log("3. keycheck — sent", check.sent, "found", check.found, "missing", check.missing.length);
    if (check.missing.length) log("   missing sample:", check.missing.slice(0, 5));

    const before = (await getAllVideos()).filter(v => v.inCatalogue === false).length;
    const res = await window.scraySyncLibrary({ quiet: true });
    const after = (await getAllVideos()).filter(v => v.inCatalogue === false).length;
    log("4. synced — pulled", res.pulled, "| flagged", res.flagged);
    log("   local-only before/after:", before, "/", after);

    const metaCount = (await getAllVideoMeta()).length;
    const srcCount  = (await getAllVideos()).length;
    log("5. videoMeta:", metaCount, "| videoSource:", srcCount, ok(metaCount <= srcCount + 5));
    if (metaCount > srcCount + 5) log("   ✗ ORPHAN META ROWS — 4.1 not applied");

    log("=== STAGE 4 SELF-TEST DONE ===");
  } catch (err) {
    console.error("[S4] ✗", err.message, err.stack);
  }
}, 3000);
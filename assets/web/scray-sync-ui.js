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
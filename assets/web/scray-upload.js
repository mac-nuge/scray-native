// ===== scray-upload.js =====
// Native only (13.47): upload files that are on the phone but not in the
// catalogue to OneDrive, from the ⋯ / long-press menu.
//
//   Menu → "Upload to OneDrive…" → a sheet:
//     1. FILES    the file you opened it from, ticked, plus every other
//                 not-in-catalogue file on the phone to tick as well;
//     2. ACCOUNT  every OneDrive account connected on the server, with the
//                 folders the catalogue holds its files in (its stacks);
//     3. FOLDER   a stack, then its live subfolders, down to where they go.
//   Start → the files join one upload queue, shown in a panel with the
//   percentage, speed and time left for the file going up and for the batch.
//
// Who does what:
//   - api.php: upload_targets / upload_folders list where things can go;
//     upload_session hands out a pre-authenticated URL for ONE new file;
//     upload_done checks the result with Graph and catalogues it. The device
//     key never sees a Graph token.
//   - Swift (ScrayUploads): reads the file in 10 MiB pieces and PUTs them,
//     resuming from OneDrive's own count after a dropped connection.
//   - here: the sheet, the queue (one file at a time, so the first file isn't
//     slowed by the rest), and afterwards linking the phone copy to its new
//     catalogue row so its score, notes and bookmarks go with it.
//
// Uploads started separately while a batch is running join the same queue.
// The queue is kept in localStorage, so a reload of the page picks up where
// it was; an app restart can't resume a half-sent file, so those come back as
// "interrupted" with a Retry.

(function () {
  "use strict";

  const QUEUE_KEY = "scray_upload_queue_v1";
  const LAST_KEY  = "scray_upload_last_dest_v1";
  const POLL_MS   = 1000;

  // ---------------------------------------------------------------- helpers
  const esc = s => String(s ?? "").replace(/[&<>"']/g, m =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));

  function fmtBytes(b) {
    let n = Number(b);
    if (!Number.isFinite(n) || n < 0) return "—";
    const u = ["B", "KB", "MB", "GB", "TB"];
    let i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return (i === 0 ? String(n) : n.toFixed(n < 10 ? 2 : n < 100 ? 1 : 0)) + " " + u[i];
  }
  const fmtSpeed = bps => bps > 0 ? fmtBytes(bps) + "/s" : "";
  function fmtEta(sec) {
    if (!Number.isFinite(sec) || sec < 0 || sec > 86400 * 2) return "";
    sec = Math.round(sec);
    if (sec < 60) return `${sec}s`;
    const m = Math.floor(sec / 60), s = sec % 60;
    if (m < 60) return `${m}m ${String(s).padStart(2, "0")}s`;
    return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
  }
  const pct = (a, b) => b > 0 ? Math.min(100, Math.floor((a / b) * 100)) : 0;
  const shortAcct = a => String(a || "").split("@")[0];
  const newId = () => "up_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const api = (action, body) => window.scrayApiCall(action, { method: "POST", body: body || {} });
  const bridge = () => window.ScrayBridge || {};
  const localId = v => v.oneDriveId ?? v.idFromAPI ?? null;
  const isPhoneOnly = v => v && v.inCatalogue === false && !!localId(v);

  function load(key, fallback) {
    try { const v = JSON.parse(localStorage.getItem(key) || "null"); return v ?? fallback; } catch { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode: queue lives in memory only */ }
  }

  // ------------------------------------------------------------------ queue
  // One entry per file: { uid, rel, filename, size, account, folder, state,
  // sent, bps, error, note, videoKey, facts, meta, bookmarks }.
  // state: waiting → starting → uploading → finishing → done | failed | cancelled
  const Q = { items: load(QUEUE_KEY, []), running: false, minimized: false, showList: false };

  const ACTIVE = new Set(["starting", "uploading", "finishing"]);
  const persist = () => save(QUEUE_KEY, Q.items.map(it => ({ ...it, bps: 0 })));
  const findItem = uid => Q.items.find(i => i.uid === uid);
  const queuedPaths = () => new Set(Q.items.filter(i => i.state === "waiting" || ACTIVE.has(i.state)).map(i => i.rel));

  function enqueue(videos, dest) {
    const already = queuedPaths();
    let added = 0;
    for (const v of videos) {
      const rel = localId(v);
      if (!rel || already.has(rel)) continue;
      Q.items.push({
        uid: newId(), rel, filename: v.filename || rel.split("/").pop(), size: Number(v.sizeBytes) || 0,
        account: dest.account, folder: dest.path, state: "waiting", sent: 0, bps: 0, error: null, note: null,
        facts: {
          duration_ms: v.durationMs ?? null, width: v.width ?? null, height: v.height ?? null,
          bitrate: v.bitrate ?? null, orientation: v.orientation ?? null,
          fingerprint: typeof window.scrayFingerprint === "function" ? window.scrayFingerprint(v) : null
        }
      });
      added++;
    }
    persist();
    Q.minimized = false;
    showPanel(true);
    pump();
    return added;
  }

  /** Start the next waiting file if nothing is going up. */
  async function pump() {
    if (Q.running) return;
    const next = Q.items.find(i => i.state === "waiting");
    if (!next) { renderPanel(); return; }
    Q.running = true;
    try {
      await runOne(next);
    } finally {
      Q.running = false;
      persist();
      renderPanel();
    }
    pump();
  }

  async function runOne(it) {
    // A run number, so a run that was cancelled and retried before its last
    // poll came back can't reach in and mark the new run failed.
    const run = it.run = (it.run || 0) + 1;
    const stale = () => it.run !== run || it.state === "cancelled";
    it.state = "starting"; it.error = null; it.note = null; it.sent = 0; it.bps = 0;
    persist(); renderPanel();
    try {
      const s = await api("upload_session", { account: it.account, path: it.folder, filename: it.filename, size: it.size });
      if (stale()) return;
      await bridge().uploadStart({ id: it.uid, path: it.rel, uploadUrl: s.upload_url, size: it.size });
      if (!stale()) it.state = "uploading";
      persist(); renderPanel();
      const job = await waitForJob(it, run);
      if (!job || stale()) return;                       // cancelled
      await finishOne(it, job.item);
    } catch (err) {
      if (stale()) return;
      it.state = "failed";
      it.error = friendlyError(err);
    }
  }

  function friendlyError(err) {
    const m = String(err && err.message || err || "failed");
    if (/Unknown action: upload/i.test(m)) return "This needs the 13.47 app build — rebuild and reinstall the app";
    return m.replace(/^HTTP \d+: /, "");
  }

  /** Poll Swift until this upload finishes. Resolves with the job, or null if cancelled. */
  function waitForJob(it, run) {
    return new Promise((resolve, reject) => {
      const tick = async () => {
        if (run !== undefined && it.run !== run) return resolve(null);   // superseded by a retry
        if (it.state === "cancelled") {
          // Cancelled while the start was still on its way: make sure nothing keeps sending.
          try { await bridge().uploadCancel(it.uid); } catch { /* not running */ }
          return resolve(null);
        }
        let job;
        try {
          job = ((await bridge().uploadStatus([it.uid])) || {}).jobs?.[0];
        } catch (err) {
          return reject(err);
        }
        if (run !== undefined && it.run !== run) return resolve(null);
        if (!job) return reject(new Error("The app lost track of this upload — retry it"));
        it.sent = Number(job.sent) || 0;
        it.bps = Number(job.bytesPerSecond) || 0;
        it.note = job.note || null;
        renderPanel();
        if (job.state === "finished") return resolve(job);
        if (job.state === "failed") return reject(new Error(job.error || "upload failed"));
        if (job.state === "cancelled") return resolve(null);
        setTimeout(tick, POLL_MS);
      };
      tick();
    });
  }

  /** Catalogue it, then make the phone copy that row. */
  async function finishOne(it, item) {
    it.state = "finishing"; it.sent = it.size; it.bps = 0;
    persist(); renderPanel();
    if (!item || !item.id) throw new Error("OneDrive didn't say what it saved — check the folder, then retry");
    it.itemId = item.id;

    const v = await localVideo(it.rel);
    const meta = v ? {
      user_score: v.userScore ?? v.user_score ?? null, notes: v.notes ?? null,
      view_count: v.view_count ?? null, f_tally: v.f_tally ?? null,
      time_viewed: v.time_viewed ?? null, last_played: v.last_played ?? null
    } : {};
    const res = await api("upload_done", {
      account: it.account, item_id: item.id, size: it.size, facts: it.facts, meta,
      device: window.SCRAY_SYNC?.DEVICE_ID || "native"
    });
    it.videoKey = res.video_key;
    it.folder = res.path || it.folder;
    await adoptLocally(it.rel, res.video_key, v);
    try { await bridge().uploadForget(it.uid); } catch { /* old list entry, harmless */ }
    it.state = "done";
  }

  async function localVideo(rel) {
    try {
      const all = await window.getAllVideos();
      return all.find(v => localId(v) === rel) || null;
    } catch { return null; }
  }

  /**
   * The same adoption the ⚠ match does: the phone row takes the catalogue key
   * and stops being "not in the catalogue". Then its bookmarks, which stayed
   * on the phone until now, go up to the new row.
   */
  async function adoptLocally(rel, key, v) {
    try {
      const db = await openDB();
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const row = await new Promise(r => { const q = store.get(rel); q.onsuccess = () => r(q.result); q.onerror = () => r(null); });
      if (row) store.put({ ...row, videoKey: key, inCatalogue: true });
      await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
    } catch (err) {
      console.warn("[upload] local adopt failed:", err.message);
    }

    const marks = Array.isArray(v?.bookmarks) ? v.bookmarks : [];
    if (marks.length) {
      try {
        await window.scrayApiCall("bookmarks_push", {
          method: "POST",
          body: {
            video_key: key, device: window.SCRAY_SYNC?.DEVICE_ID || "native",
            upsert: marks.map(b => ({ time_ms: Math.round(Number(b.time) * 1000), note: b.note || "" })),
            delete: []
          }
        });
      } catch (err) {
        console.warn("[upload] bookmarks push failed — they're still on the phone:", err.message);
      }
    }

    // The row on screen: drop the ⚠ without a rescan.
    const live = window.paginationState?.allVideos || [];
    live.forEach(x => { if (localId(x) === rel) { x.videoKey = key; x.inCatalogue = true; } });
    document.querySelectorAll("li[data-video-id]").forEach(li => {
      if (li.dataset.videoId !== rel) return;
      li.querySelectorAll(".not-in-catalogue-badge").forEach(b => b.remove());
      li.querySelectorAll(".lc-uncatalogued").forEach(b => b.classList.remove("lc-uncatalogued"));
    });
  }

  async function cancelItem(uid) {
    const it = findItem(uid);
    if (!it) return;
    if (it.state === "waiting") {
      it.state = "cancelled";
    } else if (it.state === "starting" || it.state === "uploading") {
      it.state = "cancelled";
      try { await bridge().uploadCancel(uid); } catch { /* nothing running on the native side */ }
    } else {
      return;                                    // finishing: too late to stop cleanly
    }
    persist(); renderPanel();
  }

  function retryItem(uid) {
    const it = findItem(uid);
    if (!it || !(it.state === "failed" || it.state === "cancelled")) return;
    it.run = (it.run || 0) + 1;                  // anything still polling for the old run stands down
    it.state = "waiting"; it.error = null; it.sent = 0; it.bps = 0;
    try { bridge().uploadForget?.(uid); } catch { /* ignore */ }
    persist(); pump();
  }

  function clearFinished() {
    Q.items = Q.items.filter(i => i.state === "waiting" || ACTIVE.has(i.state));
    persist(); renderPanel();
    if (!Q.items.length) showPanel(false);
  }

  /**
   * After a reload the queue is back but the loop isn't. An upload that Swift
   * is still sending is picked up again; one Swift finished is catalogued; one
   * Swift has never heard of (the app was restarted) can't be continued.
   */
  async function recover() {
    const stuck = Q.items.filter(i => ACTIVE.has(i.state));
    if (!stuck.length) { if (Q.items.some(i => i.state === "waiting")) { showPanel(true); pump(); } return; }
    showPanel(true);
    let jobs = [];
    try { jobs = ((await bridge().uploadStatus(stuck.map(i => i.uid))) || {}).jobs || []; } catch { /* old build */ }
    for (const it of stuck) {
      const job = jobs.find(j => j.id === it.uid);
      if (it.state === "finishing" && it.itemId) {
        Q.running = true;
        try { await finishOne(it, { id: it.itemId }); } catch (err) { it.state = "failed"; it.error = friendlyError(err); }
        Q.running = false;
      } else if (job && (job.state === "uploading" || job.state === "finished")) {
        Q.running = true;
        it.state = "uploading";
        try {
          const done = await waitForJob(it);
          if (done) await finishOne(it, done.item);
        } catch (err) { it.state = "failed"; it.error = friendlyError(err); }
        Q.running = false;
      } else {
        it.state = "failed";
        it.error = "Interrupted when the app closed — retry to send it again";
      }
      persist();
    }
    renderPanel();
    pump();
  }

  // ------------------------------------------------------------------ panel
  let panel = null;

  function showPanel(on) {
    if (!on) { if (panel) panel.hidden = true; return; }
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "scrayUploadPanel";
      panel.addEventListener("click", onPanelClick);
      document.body.appendChild(panel);
    }
    panel.hidden = false;
    renderPanel();
  }

  function renderPanel() {
    if (!panel || panel.hidden) return;
    const items = Q.items;
    const current = items.find(i => i.state === "uploading" || i.state === "starting" || i.state === "finishing");
    const pending = items.filter(i => i.state === "waiting" || ACTIVE.has(i.state));
    const done = items.filter(i => i.state === "done");
    const failed = items.filter(i => i.state === "failed");

    // Batch figures: everything not finished or dropped, plus what's done this
    // session, so the bar doesn't jump back when a file lands.
    const batch = items.filter(i => i.state !== "cancelled" && i.state !== "failed");
    const bTotal = batch.reduce((a, i) => a + i.size, 0);
    const bSent  = batch.reduce((a, i) => a + (i.state === "done" ? i.size : (i === current ? i.sent : 0)), 0);
    const bps = current ? current.bps : 0;
    const left = pending.reduce((a, i) => a + i.size - (i === current ? i.sent : 0), 0);
    const overallEta = bps > 0 ? fmtEta(left / bps) : "";

    panel.classList.toggle("is-min", Q.minimized);
    if (Q.minimized) {
      const label = current ? `${pct(bSent, bTotal)}%` : failed.length ? `${failed.length} failed` : done.length ? "✓" : "";
      panel.innerHTML = `<button class="up-pill" data-act="expand" title="Uploads">⬆ ${esc(label)}</button>`;
      return;
    }

    let head;
    if (current) {
      const p = pct(current.sent, current.size);
      const eta = current.bps > 0 ? fmtEta((current.size - current.sent) / current.bps) : "";
      const status = current.state === "starting" ? "asking OneDrive for an upload link…"
        : current.state === "finishing" ? "adding to the catalogue…"
        : [`${p}%`, `${fmtBytes(current.sent)} of ${fmtBytes(current.size)}`, fmtSpeed(current.bps), eta && `${eta} left`]
            .filter(Boolean).join(" · ");
      head = `
        <div class="up-now">
          <div class="up-name" title="${esc(current.filename)}">${esc(current.filename)}</div>
          <div class="up-dest">${esc(shortAcct(current.account))} › ${esc(current.folder)}</div>
          <div class="up-bar"><i style="width:${current.state === "finishing" ? 100 : p}%"></i></div>
          <div class="up-stat">${esc(status)}</div>
          ${current.note ? `<div class="up-note">${esc(current.note)}</div>` : ""}
          ${current.state !== "finishing" ? `<button class="up-link" data-act="cancel" data-uid="${esc(current.uid)}">Cancel this file</button>` : ""}
        </div>
        ${batch.length > 1 ? `
        <div class="up-batch">
          <div class="up-bar thin"><i style="width:${pct(bSent, bTotal)}%"></i></div>
          <div class="up-stat">All: file ${done.length + 1} of ${batch.length} · ${fmtBytes(bSent)} of ${fmtBytes(bTotal)}${overallEta ? ` · ${overallEta} left` : ""}</div>
        </div>` : ""}`;
    } else if (pending.length) {
      head = `<div class="up-now"><div class="up-stat">Starting the next file…</div></div>`;
    } else {
      head = `<div class="up-now"><div class="up-stat">${
        failed.length ? `${done.length} uploaded, ${failed.length} failed` : `All ${done.length} uploaded`}</div></div>`;
    }

    const rows = items.map(i => {
      const icon = { waiting: "…", starting: "⬆", uploading: "⬆", finishing: "⬆", done: "✓", failed: "✕", cancelled: "–" }[i.state];
      const act = i.state === "waiting" ? `<button class="up-link" data-act="cancel" data-uid="${esc(i.uid)}">Remove</button>`
        : (i.state === "failed" || i.state === "cancelled") ? `<button class="up-link" data-act="retry" data-uid="${esc(i.uid)}">Retry</button>` : "";
      const sub = i.state === "failed" ? `<div class="up-err">${esc(i.error)}</div>`
        : i.state === "done" ? `<div class="up-sub">${esc(shortAcct(i.account))} › ${esc(i.folder)}</div>` : "";
      return `<li class="st-${i.state}"><span class="up-ico">${icon}</span>
        <div class="up-li"><div class="up-li-name">${esc(i.filename)} <span class="up-size">${fmtBytes(i.size)}</span></div>${sub}</div>${act}</li>`;
    }).join("");

    panel.innerHTML = `
      <div class="up-head">
        <b>UPLOADS</b>
        <span class="up-grow"></span>
        ${!current && items.length ? `<button class="up-link" data-act="clear">Clear</button>` : ""}
        <button class="up-x" data-act="minimize" title="Minimise">▾</button>
      </div>
      ${head}
      ${current && items.length > 1 ? `<button class="up-link up-toggle" data-act="list">${Q.showList ? "Hide" : "Show"} the queue (${items.length})</button>` : ""}
      ${!current || Q.showList ? `<ul class="up-list">${rows}</ul>` : ""}`;
  }

  function onPanelClick(e) {
    const b = e.target.closest("button[data-act]");
    if (!b) return;
    e.stopPropagation();
    const uid = b.dataset.uid;
    switch (b.dataset.act) {
      case "minimize": Q.minimized = true; renderPanel(); break;
      case "expand":   Q.minimized = false; renderPanel(); break;
      case "cancel":   cancelItem(uid); break;
      case "retry":    retryItem(uid); break;
      case "clear":    clearFinished(); break;
      case "list":     Q.showList = !Q.showList; renderPanel(); break;
    }
  }

  // ------------------------------------------------------------------ sheet
  // One modal, three steps. State lives in `S` for the life of the sheet.
  let S = null;

  async function openSheet(video) {
    closeSheet();
    S = { step: "files", ticked: new Set(), files: [], filter: "", targets: null, account: null, path: null,
          folders: null, loading: false, error: null, needsBuild: false };
    const start = localId(video);
    if (start) S.ticked.add(start);

    const modal = document.createElement("div");
    modal.className = "basket-json-modal";
    modal.id = "scrayUploadSheet";
    modal.innerHTML = `<div class="basket-json-modal-content basket-json-modal-wide up-sheet"></div>`;
    modal.addEventListener("click", e => { if (e.target === modal) closeSheet(); });
    modal.firstElementChild.addEventListener("click", onSheetClick);
    modal.firstElementChild.addEventListener("change", onSheetChange);
    modal.firstElementChild.addEventListener("input", onSheetInput);
    document.body.appendChild(modal);
    S.modal = modal;
    renderSheet();

    try {
      const all = await window.getAllVideos();
      S.files = all.filter(isPhoneOnly).sort((a, b) => String(a.filename).localeCompare(String(b.filename)));
      if (start && !S.files.some(v => localId(v) === start) && isPhoneOnly(video)) S.files.unshift(video);
    } catch (err) {
      S.error = `Couldn't read the phone's files: ${err.message}`;
    }
    // An app build from before 13.47 has no uploader; say so before any choosing.
    try { await bridge().uploadStatus([]); } catch (err) { if (/Unknown action|not a function|undefined/i.test(String(err.message))) S.needsBuild = true; }
    if (typeof bridge().uploadStatus !== "function") S.needsBuild = true;
    renderSheet();
  }

  function closeSheet() {
    if (S && S.modal) S.modal.remove();
    S = null;
  }

  const tickedFiles = () => S.files.filter(v => S.ticked.has(localId(v)));

  function renderSheet() {
    if (!S) return;
    const box = S.modal.firstElementChild;
    const queued = queuedPaths();
    const picked = tickedFiles();
    const size = picked.reduce((a, v) => a + (Number(v.sizeBytes) || 0), 0);
    const steps = ["files", "account", "folder"];
    const crumbs = steps.map((s, i) => `<span class="${s === S.step ? "on" : ""}">${i + 1} ${s.toUpperCase()}</span>`).join("");
    let body = "", buttons = "";

    if (S.needsBuild) {
      body += `<div class="up-warn">Uploading needs the 13.47 app build. Rebuild the IPA and reinstall it, then try again.</div>`;
    }
    if (S.error) body += `<div class="up-err">${esc(S.error)}</div>`;

    if (S.step === "files") {
      const f = S.filter.trim().toLowerCase();
      const shown = S.files.filter(v => !f || String(v.filename).toLowerCase().includes(f));
      body += `
        <p class="up-lead">Files on this phone that aren't in the catalogue. Every ticked file goes to the same folder.</p>
        <div class="up-tools">
          <input type="search" class="up-find" placeholder="Filter ${S.files.length} files…" value="${esc(S.filter)}">
          <button class="up-link" data-act="all">All</button><button class="up-link" data-act="none">None</button>
        </div>
        <ul class="up-files">${shown.map(v => {
          const id = localId(v), q = queued.has(id);
          return `<li class="${q ? "is-queued" : ""}"><label>
            <input type="checkbox" data-id="${esc(id)}" ${S.ticked.has(id) ? "checked" : ""} ${q ? "disabled" : ""}>
            <span class="up-fn">${esc(v.filename)}</span>
            <span class="up-size">${q ? "queued" : fmtBytes(v.sizeBytes)}</span></label></li>`;
        }).join("") || `<li class="up-empty">${S.files.length ? "Nothing matches." : "Every file on the phone is in the catalogue."}</li>`}</ul>`;
      buttons = `<button class="modal-btn modal-btn-primary" data-act="to-account" ${picked.length ? "" : "disabled"}>
                   Next: ${picked.length} file${picked.length === 1 ? "" : "s"} · ${fmtBytes(size)}</button>`;
    }

    if (S.step === "account") {
      const last = load(LAST_KEY, null);
      body += `<p class="up-lead">${picked.length} file${picked.length === 1 ? "" : "s"} · ${fmtBytes(size)}. Choose the OneDrive account.</p>`;
      if (!S.targets) {
        body += `<div class="up-loading">Loading accounts…</div>`;
      } else {
        if (last && S.targets.some(a => a.account_id === last.account && a.stacks.some(s => last.path === s.path || last.path.startsWith(s.path + "/")))) {
          body += `<button class="up-last" data-act="use-last">Last used: <b>${esc(shortAcct(last.account))}</b> › ${esc(last.path)}</button>`;
        }
        body += `<ul class="up-accounts">${S.targets.map(a => `
          <li><button data-act="account" data-account="${esc(a.account_id)}" ${a.stacks.length ? "" : "disabled"}>
            <span class="up-acct">${esc(a.account_id)}</span>
            <span class="up-count">${a.stacks.length ? `(${a.stacks.length} folder${a.stacks.length === 1 ? "" : "s"})` : "no catalogued folders"}</span>
          </button></li>`).join("") || `<li class="up-empty">No OneDrive accounts are connected on the server.</li>`}</ul>`;
      }
      buttons = `<button class="modal-btn modal-btn-secondary" data-act="to-files">Back</button>`;
    }

    if (S.step === "folder") {
      const acct = S.targets.find(a => a.account_id === S.account);
      const segs = S.path ? S.path.split("/").filter(Boolean) : [];
      const trail = [`<button class="up-crumb" data-act="crumb" data-path="">${esc(shortAcct(S.account))}</button>`]
        .concat(segs.map((s, i) => `<button class="up-crumb" data-act="crumb" data-path="${esc("/" + segs.slice(0, i + 1).join("/"))}">${esc(s)}</button>`))
        .join(`<span class="up-sep">›</span>`);
      const list = S.path === null
        ? acct.stacks.map(s => ({ name: s.name, path: s.path, extra: `${s.files} file${s.files === 1 ? "" : "s"}` }))
        : (S.folders || []).map(f => ({ name: f.name, path: f.path, extra: "" }));
      body += `<div class="up-trail">${trail}</div>`;
      if (S.path !== null && S.loading) body += `<div class="up-loading">Loading folders…</div>`;
      else body += `<ul class="up-folders">${list.map(f => `
          <li><button data-act="open" data-path="${esc(f.path)}"><span class="up-folder">📁 ${esc(f.name)}</span>
          <span class="up-count">${esc(f.extra)}</span><span class="up-go">›</span></button></li>`).join("")
          || `<li class="up-empty">${S.path === null ? "No folders." : "No subfolders — upload here."}</li>`}</ul>`;
      const can = S.path !== null && !S.loading && !S.needsBuild;
      buttons = `<button class="modal-btn modal-btn-secondary" data-act="to-account">Back</button>
        <button class="modal-btn modal-btn-primary" data-act="start" ${can ? "" : "disabled"}>${
          S.path === null ? "Choose a folder" : `Upload ${picked.length} here`}</button>`;
    }

    box.innerHTML = `
      <div class="up-top"><h3>Upload to OneDrive</h3><button class="up-x" data-act="close" title="Close">✕</button></div>
      <div class="up-steps">${crumbs}</div>
      ${body}
      <div class="basket-json-modal-buttons up-buttons">${buttons}</div>`;
    if (S.step === "files" && S.refocus) {
      const inp = box.querySelector(".up-find");
      inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length);
      S.refocus = false;
    }
  }

  async function loadTargets() {
    S.targets = null; S.error = null; renderSheet();
    try {
      const r = await api("upload_targets");
      if (!S) return;
      S.targets = r.accounts || [];
    } catch (err) {
      if (!S) return;
      S.targets = []; S.error = `Couldn't load accounts: ${friendlyError(err)}`;
    }
    renderSheet();
  }

  async function openFolder(path) {
    S.path = path; S.folders = null; S.error = null;
    if (path === null) { renderSheet(); return; }
    S.loading = true; renderSheet();
    const want = path;
    try {
      const r = await api("upload_folders", { account: S.account, path });
      if (!S || S.path !== want) return;
      S.folders = r.folders || [];
    } catch (err) {
      if (!S || S.path !== want) return;
      S.folders = []; S.error = friendlyError(err);
    }
    S.loading = false;
    renderSheet();
  }

  function onSheetClick(e) {
    const b = e.target.closest("[data-act]");
    if (!b || !S) return;
    e.stopPropagation();
    switch (b.dataset.act) {
      case "close": closeSheet(); break;
      case "all": {
        const f = S.filter.trim().toLowerCase(), q = queuedPaths();
        S.files.forEach(v => { const id = localId(v); if (!q.has(id) && (!f || String(v.filename).toLowerCase().includes(f))) S.ticked.add(id); });
        renderSheet(); break;
      }
      case "none": S.ticked.clear(); renderSheet(); break;
      case "to-files": S.step = "files"; S.error = null; renderSheet(); break;
      case "to-account":
        S.step = "account"; S.error = null; renderSheet();
        if (!S.targets || !S.targets.length) loadTargets();
        break;
      case "use-last": {
        const last = load(LAST_KEY, null);
        if (!last) break;
        S.account = last.account; S.step = "folder"; openFolder(last.path); break;
      }
      case "account": S.account = b.dataset.account; S.step = "folder"; openFolder(null); break;
      case "open": openFolder(b.dataset.path); break;
      case "crumb": openFolder(b.dataset.path || null); break;
      case "start": {
        if (S.path === null) break;
        const files = tickedFiles();
        const dest = { account: S.account, path: S.path };
        save(LAST_KEY, dest);
        closeSheet();
        const n = enqueue(files, dest);
        if (!n) alert("Those files are already queued.");
        break;
      }
    }
  }

  function onSheetChange(e) {
    const cb = e.target.closest("input[type=checkbox][data-id]");
    if (!cb || !S) return;
    if (cb.checked) S.ticked.add(cb.dataset.id); else S.ticked.delete(cb.dataset.id);
    renderSheet();
  }

  function onSheetInput(e) {
    if (!S || !e.target.classList.contains("up-find")) return;
    S.filter = e.target.value; S.refocus = true;
    renderSheet();
  }

  // -------------------------------------------------------------- exports
  window.scrayShowUploadSheet = openSheet;
  window.scrayUploadQueue = {
    items: () => Q.items, cancel: cancelItem, retry: retryItem, clear: clearFinished,
    show: () => { Q.minimized = false; showPanel(true); }
  };
  window.scrayIsPhoneOnly = isPhoneOnly;

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", recover);
  else setTimeout(recover, 0);
})();

// =============================================================
// ✎ RENAME EVERYWHERE  (native 13.60, needs browse 13.32's api.php;
//    13.61: confirmations say where the rename happened)
// =============================================================
// Two halves, both about keeping one name for one file:
//
// 1. Renaming a phone file that is in the catalogue asks "Everywhere" or
//    "This phone only". Everywhere goes to the server first (rename_file:
//    every OneDrive copy, then the catalogue row with its score, bookmarks,
//    stash match and variant group) and renames the phone file only once that
//    has worked. A refusal - the name is taken, a copy failed - leaves all
//    three untouched. Everywhere needs a connection; offline, only the phone
//    file can be renamed, and the difference turns up in the list below.
//
// 2. The sync stores the catalogue's own spelling of each file's name
//    (keycheck's `filenames`, as catalogueFilename). Wherever that differs
//    from the phone's name, whichever side changed, the file goes in the
//    "✎ N names" list: rename the phone file, push the phone's name
//    everywhere, or skip. A skip is remembered for that exact pair of names
//    only, so the same question never comes back but a later rename does.
//
// Catalogue rows that aren't on the phone rename through the server too, so
// the catalogue moves with OneDrive (it used to wait for Picker's next scan).
(function () {
  "use strict";

  const SKIP_KEY = "scray_rename_skips_v1";
  const api = (action, body) => window.scrayApiCall(action, { method: "POST", body: body || {} });
  const nfc = s => String(s ?? "").normalize("NFC");
  const localId = v => v.oneDriveId ?? v.idFromAPI ?? null;
  const isLocal = v => !!v && (typeof window.isLocalVideo === "function"
    ? window.isLocalVideo(v)
    : (v.driveId === "local" || String(v.accountKey || "").startsWith("local::")));
  const keyOf = v => v.videoKey || window.scrayVideoKey(v.filename);
  const device = () => window.SCRAY_SYNC?.DEVICE_ID || "native";
  const esc = s => String(s ?? "").replace(/[&<>"']/g, m =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));

  function cancelled() {
    const e = new Error("Rename cancelled");
    e.cancelled = true;
    return e;
  }

  function friendly(err) {
    const m = String(err && err.message || err || "failed");
    if (/Unknown action: rename_file/i.test(m)) return "The server needs updating first (browse 13.32's api.php)";
    return m.replace(/^HTTP \d+: /, "");
  }

  // ---- saying where a rename happened (13.61) --------------------------------
  // renameLocal / renameCatalogueRow resolve with { scope, onedrive, onPhone }:
  //   everywhere, on the phone: "Phone, OneDrive (2 copies) and the catalogue"
  //   everywhere, catalogue row: "OneDrive (1 copy) and the catalogue"
  //   phone only:               "OneDrive and the catalogue keep the old name"
  // A phone file that isn't in the catalogue resolves with nothing, and keeps
  // the plain "Renamed to" message.
  function where(res) {
    if (!res || !res.scope) return null;
    if (res.scope === "phone") {
      return { title: "Renamed on this phone only", detail: "OneDrive and the catalogue keep the old name" };
    }
    const n = Number(res.onedrive) || 0;
    const parts = [
      res.onPhone ? "phone" : null,
      n ? `OneDrive (${n} cop${n === 1 ? "y" : "ies"})` : null,
      "the catalogue"
    ].filter(Boolean);
    const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0];
    return { title: "Renamed everywhere", detail: list.charAt(0).toUpperCase() + list.slice(1) };
  }

  /** The rename box's pop-up. Without a result, the message it always had. */
  function confirmHtml(res, name) {
    const w = where(res);
    const small = t => `<span style="font-size: 0.5em; opacity: 0.9;">${t}</span>`;
    return w
      ? `✅ ${esc(w.title)}<br>${small(`${esc(w.detail)}<br>${esc(name)}`)}`
      : `✅ Renamed to:<br>${small(esc(name))}`;
  }

  // ---- skips: one exact pair of names per file ----------------------------
  const pairId = (key, phone, cat) => [key, nfc(phone), nfc(cat)].join("\u0001");
  function loadSkips() {
    try { return new Set(JSON.parse(localStorage.getItem(SKIP_KEY) || "[]")); } catch { return new Set(); }
  }
  function saveSkips(set) {
    try { localStorage.setItem(SKIP_KEY, JSON.stringify([...set])); } catch {}
  }
  function setSkipped(row, on) {
    const skips = loadSkips();
    const id = pairId(keyOf(row), row.filename, row.catalogueFilename);
    if (on) skips.add(id); else skips.delete(id);
    saveSkips(skips);
  }
  const isSkipped = (row, skips) => skips.has(pairId(keyOf(row), row.filename, row.catalogueFilename));

  /** A phone file in the catalogue whose name there is different. */
  const differs = v => isLocal(v) && v.inCatalogue === true &&
    typeof v.catalogueFilename === "string" && v.catalogueFilename !== "" &&
    nfc(v.filename) !== nfc(v.catalogueFilename);

  // ---- local row updates -----------------------------------------------------
  // fromSync: these are the server's answers, not edits to send back to it.
  async function setRowFields(id, fields) {
    if (!id) return;
    if (typeof window.updateVideoInDB === "function") await window.updateVideoInDB(id, fields, { fromSync: true });
    if (typeof window.updateVideoInMemory === "function") window.updateVideoInMemory(id, fields);
    (window.paginationState?.allVideos || []).forEach(x => { if (localId(x) === id) Object.assign(x, fields); });
  }

  async function renameOnServer(key, newName) {
    try {
      return await api("rename_file", { video_key: key, new_name: newName, device: device() });
    } catch (err) {
      throw new Error(friendly(err));
    }
  }

  // ---- the question ----------------------------------------------------------
  /**
   * "Everywhere" / "This phone only" / cancel. Resolves 'everywhere', 'phone'
   * or null. { video, newName } for one file, { count } for a batch.
   */
  function askScope({ video, newName, count } = {}) {
    return new Promise(resolve => {
      document.getElementById("scrayRenameScope")?.remove();
      const online = navigator.onLine !== false;
      const modal = document.createElement("div");
      modal.className = "basket-json-modal";
      modal.id = "scrayRenameScope";
      const what = video
        ? `<div class="rn-pair"><div><span class="rn-lbl">From</span><span class="rn-name">${esc(video.filename)}</span></div>
           <div><span class="rn-lbl">To</span><span class="rn-name">${esc(newName)}</span></div></div>`
        : `<p class="rn-lead">${count} file${count === 1 ? "" : "s"}.</p>`;
      modal.innerHTML = `
        <div class="basket-json-modal-content rn-sheet">
          <h3>Rename ${video ? "this file" : "these files"}</h3>
          ${what}
          <p class="rn-lead">${video ? "It's" : "Some are"} also in the catalogue. Rename in OneDrive and the catalogue too?</p>
          <div class="rn-choices">
            <button class="modal-btn modal-btn-primary" data-scope="everywhere" ${online ? "" : "disabled"}>
              Everywhere<small>${online ? "Phone, OneDrive and the catalogue" : "Needs a connection"}</small></button>
            <button class="modal-btn modal-btn-secondary" data-scope="phone">This phone only<small>OneDrive and the catalogue keep the old name</small></button>
            <button class="modal-btn rn-cancel" data-scope="">Cancel</button>
          </div>
        </div>`;
      const done = v => { modal.remove(); resolve(v || null); };
      modal.addEventListener("click", e => {
        if (e.target === modal) return done(null);
        const b = e.target.closest("[data-scope]");
        if (b && !b.disabled) done(b.dataset.scope);
      });
      document.body.appendChild(modal);
    });
  }

  // ---- 1. renaming from Native ----------------------------------------------
  /** A phone file that's in the catalogue - see file-operations.js renameFile. */
  async function renameLocal(video, newName, opts = {}) {
    const scope = opts.scope || await askScope({ video, newName });
    if (!scope) throw cancelled();

    if (scope === "phone") {
      const catName = video.catalogueFilename;
      const key = keyOf(video);
      const online = navigator.onLine !== false;
      await window.renameLocalFile(video, newName);
      // Chosen with Everywhere on offer, it's a deliberate phone-only name:
      // don't list it. Offline it wasn't a choice, so it is listed.
      if (online && catName && nfc(catName) !== nfc(newName)) {
        setSkipped({ videoKey: key, filename: newName, catalogueFilename: catName }, true);
      }
      await refresh();
      return { scope: "phone" };
    }

    // Everywhere: the server first. A refusal throws before anything changes.
    const r = await renameOnServer(keyOf(video), newName);
    try {
      if (nfc(video.filename) !== nfc(newName)) await window.renameLocalFile(video, newName);
    } catch (err) {
      await setRowFields(localId(video), { videoKey: r.video_key, catalogueFilename: r.filename });
      await refresh();
      throw new Error(`Renamed in OneDrive and the catalogue, but not on this phone: ${friendly(err)}. ` +
        `It's in the ✎ names list, so you can try the phone again from there.`);
    }
    await setRowFields(localId(video), { videoKey: r.video_key, catalogueFilename: r.filename });
    Object.assign(video, { videoKey: r.video_key, catalogueFilename: r.filename });
    await refresh();
    return { scope: "everywhere", onedrive: r.onedrive_renamed || 0, onPhone: true };
  }

  /** A catalogue row that isn't on the phone: the server renames OneDrive and the row. */
  async function renameCatalogueRow(video, newName) {
    const r = await renameOnServer(keyOf(video), newName);
    const id = localId(video);
    await setRowFields(id, { filename: r.filename, videoKey: r.video_key });
    Object.assign(video, { filename: r.filename, videoKey: r.video_key });
    if (typeof window.refreshAllLists === "function") window.refreshAllLists();
    return { scope: "everywhere", onedrive: r.onedrive_renamed || 0, onPhone: false };
  }

  // ---- 2. the list -------------------------------------------------------------
  let S = null;     // the open sheet
  let lastRows = [];
  // ⚙️ How long a row stays in the list, ticked, after it's been renamed.
  const DONE_SHOW_MS = 1800;
  const DONE_FADE_MS = 300;

  async function loadRows() {
    if (typeof window.getAllVideos !== "function") return [];
    const all = await window.getAllVideos();
    return all.filter(differs).sort((a, b) => nfc(a.filename).localeCompare(nfc(b.filename)));
  }

  function pill() {
    let btn = document.getElementById("scrayRenameReviewBtn");
    if (btn) return btn;
    const row = document.getElementById("secondaryButtonsRow");
    if (!row) return null;
    btn = document.createElement("button");
    btn.id = "scrayRenameReviewBtn";
    btn.title = "Files whose name on this phone is different from the catalogue";
    btn.hidden = true;
    btn.addEventListener("click", () => openSheet());
    const after = document.getElementById("uncataloguedToggleBtn");
    if (after && after.parentElement === row) after.after(btn); else row.appendChild(btn);
    return btn;
  }

  async function refresh() {
    lastRows = await loadRows();
    const skips = loadSkips();
    const n = lastRows.filter(r => !isSkipped(r, skips)).length;
    const btn = pill();
    if (btn) {
      btn.hidden = n === 0;
      btn.textContent = `✎ ${n} name${n === 1 ? "" : "s"}`;
    }
    if (S) renderSheet();
    return n;
  }

  function openSheet() {
    closeSheet();
    // done: rows just renamed, kept on show with a tick (see act)
    S = { showSkipped: false, busy: new Set(), errors: new Map(), note: "", done: new Map() };
    const modal = document.createElement("div");
    modal.className = "basket-json-modal";
    modal.id = "scrayRenameReview";
    modal.innerHTML = `<div class="basket-json-modal-content basket-json-modal-wide rn-sheet"></div>`;
    modal.addEventListener("click", e => { if (e.target === modal) closeSheet(); });
    modal.firstElementChild.addEventListener("click", onSheetClick);
    modal.firstElementChild.addEventListener("change", e => {
      if (e.target.matches("[data-act=show-skipped]")) { S.showSkipped = e.target.checked; renderSheet(); }
    });
    document.body.appendChild(modal);
    S.modal = modal;
    refresh();
  }

  function closeSheet() {
    if (S && S.modal) S.modal.remove();
    S = null;
  }

  function renderSheet() {
    if (!S) return;
    const skips = loadSkips();
    const online = navigator.onLine !== false;
    const skippedCount = lastRows.filter(r => isSkipped(r, skips)).length;
    // Rows renamed a moment ago stay where they were, ticked, until they go.
    const doneIds = new Set([...S.done.values()].map(d => d.newId));
    const live = lastRows.filter(r => (S.showSkipped || !isSkipped(r, skips)) && !doneIds.has(localId(r)));
    const open = live.filter(r => !isSkipped(r, skips));
    const shown = [
      ...live.map(r => ({ r, sortName: nfc(r.filename) })),
      ...[...S.done.values()].map(d => ({ d, sortName: d.sortName }))
    ].sort((a, b) => a.sortName.localeCompare(b.sortName));
    const box = S.modal.firstElementChild;
    box.innerHTML = `
      <div class="rn-top"><h3>Name changes</h3><button class="rn-x" data-act="close" title="Close">✕</button></div>
      <p class="rn-lead">These files are called something different on this phone than in the catalogue.</p>
      ${S.note ? `<div class="rn-note">${esc(S.note)}</div>` : ""}
      <div class="rn-tools">
        ${open.length > 1 ? `<button class="modal-btn modal-btn-secondary" data-act="phone-all" ${S.busy.size ? "disabled" : ""}>Rename all ${open.length} on the phone</button>` : "<span></span>"}
        <label class="rn-toggle"><input type="checkbox" data-act="show-skipped" ${S.showSkipped ? "checked" : ""}> Show skipped (${skippedCount})</label>
      </div>
      <ul class="rn-list">${shown.map(({ r, d }) => {
        if (d) {
          return `<li class="is-done${d.leaving ? " is-leaving" : ""}">
            <div class="rn-pair">
              <div><span class="rn-lbl">Phone</span><span class="rn-name">${esc(d.row.filename)}</span></div>
              <div><span class="rn-lbl">Catalogue</span><span class="rn-name">${esc(d.row.catalogueFilename)}</span></div>
            </div>
            <div class="rn-done">${esc(d.label)}</div>
            ${d.detail ? `<div class="rn-done-detail">${esc(d.detail)}</div>` : ""}
          </li>`;
        }
        const id = localId(r), busy = S.busy.has(id), skipped = isSkipped(r, skips), err = S.errors.get(id);
        return `<li class="${skipped ? "is-skipped" : ""}${busy ? " is-busy" : ""}" data-id="${esc(id)}">
          <div class="rn-pair">
            <div><span class="rn-lbl">Phone</span><span class="rn-name">${esc(r.filename)}</span></div>
            <div><span class="rn-lbl">Catalogue</span><span class="rn-name">${esc(r.catalogueFilename)}</span></div>
          </div>
          <div class="rn-acts">
            <button class="modal-btn modal-btn-primary" data-act="phone" data-id="${esc(id)}" ${busy ? "disabled" : ""}>Rename phone file</button>
            <button class="modal-btn modal-btn-secondary" data-act="everywhere" data-id="${esc(id)}" ${busy || !online ? "disabled" : ""}
              title="${online ? "Rename OneDrive and the catalogue to the phone's name" : "Needs a connection"}">Use phone name everywhere</button>
            <button class="modal-btn rn-skip" data-act="${skipped ? "unskip" : "skip"}" data-id="${esc(id)}" ${busy ? "disabled" : ""}>${skipped ? "Unskip" : "Skip"}</button>
          </div>
          ${busy ? `<div class="rn-busy">Renaming…</div>` : ""}
          ${err ? `<div class="rn-err">${esc(err)}</div>` : ""}
        </li>`;
      }).join("") || `<li class="rn-empty">${skippedCount ? "Nothing left to decide." : "Every phone file has the catalogue's name."}</li>`}</ul>`;
  }

  async function act(row, what) {
    const id = localId(row);
    S.errors.delete(id);
    if (what === "skip" || what === "unskip") {
      setSkipped(row, what === "skip");
      await refresh();
      return;
    }
    S.busy.add(id);
    renderSheet();
    const before = { ...row };
    let done = null;
    try {
      if (what === "phone") {
        await window.renameLocalFile(row, row.catalogueFilename);
        done = { row: { ...before, filename: before.catalogueFilename }, label: "✓ Renamed on the phone", detail: "" };
      } else if (what === "everywhere") {
        const r = await renameOnServer(keyOf(row), row.filename);
        await setRowFields(id, { videoKey: r.video_key, catalogueFilename: r.filename });
        const w = where({ scope: "everywhere", onedrive: r.onedrive_renamed || 0, onPhone: false });
        done = { row: { ...before, catalogueFilename: r.filename }, label: "✓ Renamed everywhere",
                 detail: `${w.detail} now use the phone's name` };
      }
    } catch (err) {
      S.errors.set(localId(row) || id, friendly(err));
    } finally {
      S.busy.delete(id);
    }
    if (done && S) {
      // Shown in the old row's place for a moment, then faded out.
      const mine = S;
      mine.done.set(id, { ...done, newId: localId(row), sortName: nfc(before.filename), leaving: false });
      setTimeout(() => {
        const d = mine.done.get(id);
        if (d && S === mine) { d.leaving = true; renderSheet(); }
      }, DONE_SHOW_MS - DONE_FADE_MS);
      setTimeout(() => { if (mine.done.delete(id) && S === mine) renderSheet(); }, DONE_SHOW_MS);
    }
    await refresh();
  }

  async function onSheetClick(e) {
    const b = e.target.closest("[data-act]");
    if (!b || b.disabled || !S) return;
    const a = b.dataset.act;
    if (a === "close") return closeSheet();
    if (a === "show-skipped") return;
    if (a === "phone-all") {
      const skips = loadSkips();
      const todo = lastRows.filter(r => !isSkipped(r, skips));
      let ok = 0;
      for (const r of todo) {
        if (!S) return;
        await act(r, "phone");
        if (!S.errors.has(localId(r))) ok++;
      }
      if (S) { S.note = `${ok} of ${todo.length} renamed on the phone.`; renderSheet(); }
      return;
    }
    const row = lastRows.find(r => localId(r) === b.dataset.id);
    if (row) await act(row, a);
  }

  // ---- styles ------------------------------------------------------------------
  const style = document.createElement("style");
  style.id = "scray-rename-style";
  style.textContent = `
#scrayRenameReviewBtn[hidden] { display: none !important; }
#scrayRenameScope, #scrayRenameReview { z-index: 2147483001 !important; }
#scrayRenameReviewBtn { background: #0078d4 !important; color: #fff !important; }
.rn-sheet button { width: auto; margin-bottom: 0; }
.rn-sheet h3 { margin: 0 0 8px; }
.rn-top { display: flex; align-items: center; justify-content: space-between; }
.rn-x { background: none; border: 0; font-size: 1.1rem; color: #666; padding: 4px 8px; cursor: pointer; }
.rn-lead { color: #555; font-size: 0.85rem; margin: 4px 0 10px; }
.rn-note { background: #e8f2fc; color: #0b4f8a; border-radius: 6px; padding: 8px 10px; font-size: 0.8rem; margin-bottom: 10px; }
.rn-tools { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.rn-toggle { font-size: 0.8rem; color: #555; display: flex; align-items: center; gap: 6px; }
.rn-toggle input { width: auto; margin: 0; }
.rn-list { list-style: none; margin: 0; padding: 0; max-height: 58vh; overflow-y: auto; }
.rn-list li { border: 1px solid #eee; border-radius: 8px; padding: 10px; margin-bottom: 8px; }
.rn-list li.is-skipped { opacity: .6; }
.rn-pair > div { display: flex; gap: 8px; align-items: baseline; font-size: 0.85rem; margin-bottom: 3px; }
.rn-lbl { flex: none; width: 70px; color: #888; font-size: 0.72rem; text-transform: uppercase; letter-spacing: .04em; }
.rn-name { flex: 1; min-width: 0; word-break: break-word; }
.rn-acts { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.rn-acts .modal-btn { font-size: 0.78rem; padding: 7px 10px; }
.rn-skip { background: #f2f2f2; color: #333; }
.rn-err { color: #c62828; font-size: 0.78rem; margin-top: 6px; word-break: break-word; }
.rn-busy { color: #0078d4; font-size: 0.78rem; margin-top: 6px; }
.rn-list li.is-done { border-color: #b7e1c1; background: #f1faf3; transition: opacity ${DONE_FADE_MS}ms ease; }
.rn-list li.is-leaving { opacity: 0; }
.rn-done { color: #2e7d32; font-weight: 600; font-size: 0.85rem; margin-top: 6px; }
.rn-done-detail { color: #4f7a58; font-size: 0.75rem; margin-top: 2px; }
.rn-empty { color: #888; font-size: 0.85rem; border: 0 !important; }
.rn-choices { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
.rn-choices .modal-btn { width: 100%; text-align: left; padding: 10px 12px; }
.rn-choices small { display: block; font-size: 0.72rem; opacity: .8; font-weight: 400; margin-top: 2px; }
.rn-cancel { background: none; color: #555; text-align: center !important; }
`;
  (document.head || document.documentElement).appendChild(style);

  window.scrayAskRenameScope = askScope;
  window.scrayRenameWhere = where;
  window.scrayRenameConfirmHtml = confirmHtml;
  window.scrayRenameLocal = renameLocal;
  window.scrayRenameCatalogueRow = renameCatalogueRow;
  window.scrayRenameRefresh = refresh;
  window.scrayShowRenameReview = openSheet;

  // Names stored by the last sync, before this one runs.
  const boot = () => setTimeout(() => refresh().catch(() => {}), 1500);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();

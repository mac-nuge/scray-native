/*
 * scray-bulk-rename.js (native 15.159)
 *
 * Bulk select > the pencil button: rename the ticked files in one go, the way
 * the data explorer's bulk rename does. Each row shows the current name, an
 * editable new name (extension kept out of the box) and chips for the two
 * suggestions - the full clean name and the clean name without the parent.
 * "Use suggested for all" / "Use without parent for all" fill every row that
 * has that suggestion; a row can still be typed over, and its arrow puts the
 * original name back. Renames run one after another through renameFile, so a
 * phone file that is also in the catalogue asks (once) whether to rename it
 * everywhere or on this phone only.
 *
 * Find and replace (picker 15.147 / native 15.206): the ⇄ button opens the
 * single rename's find / replace row, run on every name not yet renamed -
 * literal text, case-blind unless Match case, blank replacement removes it.
 * Find / Replace with / Match case are shared with the single rename modal
 * (scray_rename_fr_v1); whether the row is open here is this modal's own.
 */
(function () {
  "use strict";

  const BAD = /["*:<>?\/\\|]/;
  const MAX_BYTES = 250;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const bytes = (s) => new TextEncoder().encode(s).length;
  const nfc = (s) => (s && s.normalize ? s.normalize("NFC") : String(s || ""));

  function splitExt(name) {
    const i = String(name).lastIndexOf(".");
    return i > 0 ? { base: name.slice(0, i), ext: name.slice(i) } : { base: String(name), ext: "" };
  }

  function stripExt(name, ext) {
    if (!name) return null;
    return ext && name.toLowerCase().endsWith(ext.toLowerCase()) ? name.slice(0, -ext.length) : name;
  }

  function rowsFor(videos) {
    return videos.map((video) => {
      const { base, ext } = splitExt(video.filename || "");
      let full = null, noParent = null;
      try { full = window.scrayCleanName ? window.scrayCleanName(video) : null; } catch (e) { /* none */ }
      try { noParent = window.scrayCleanNameNoParent ? window.scrayCleanNameNoParent(video) : null; } catch (e) { /* none */ }
      const f = stripExt(full, ext), n = stripExt(noParent, ext);
      return {
        video, ext, orig: base, value: base,
        full: f && nfc(f) !== nfc(base) ? f : null,
        np: n && nfc(n) !== nfc(base) ? n : null,
        status: "", msg: ""
      };
    });
  }

  function check(r) {
    const v = r.value.trim();
    if (!v) return "Name is empty";
    if (BAD.test(v)) return "Not allowed: \" * : < > ? / \\ |";
    if (/^\.|\.$/.test(v)) return "No leading or trailing dot";
    if (bytes(v + r.ext) > MAX_BYTES) return "Too long (250 bytes max)";
    return "";
  }

  // ---- find and replace (picker 15.147 / native 15.206) ----
  const FR_KEY = "scray_rename_fr_v1";           // shared with the single rename modal
  const FR_OPEN_KEY = "scray_bulk_rename_fr_open_v1";
  function frLoad() {
    let o = {};
    try { o = JSON.parse(localStorage.getItem(FR_KEY) || "{}") || {}; } catch (e) { o = {}; }
    let open = false;
    try { open = localStorage.getItem(FR_OPEN_KEY) === "1"; } catch (e) { /* closed */ }
    return { find: typeof o.find === "string" ? o.find : "", repl: typeof o.repl === "string" ? o.repl : "",
             cs: !!o.cs, open };
  }
  function frSave(fr) {
    try {
      let o = {};
      try { o = JSON.parse(localStorage.getItem(FR_KEY) || "{}") || {}; } catch (e) { o = {}; }
      localStorage.setItem(FR_KEY, JSON.stringify(Object.assign(o, { find: fr.find, repl: fr.repl, cs: fr.cs })));
      localStorage.setItem(FR_OPEN_KEY, fr.open ? "1" : "0");
    } catch (e) { /* not remembered, that's all */ }
  }
  const frPattern = (fr) => fr.find
    ? new RegExp(fr.find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), fr.cs ? "g" : "gi") : null;

  function open(videos) {
    if (!videos || !videos.length) return;
    if (typeof window.renameFile !== "function" && typeof renameFile !== "function") {
      alert("Rename is not available here."); return;
    }
    document.getElementById("scrayBulkRename")?.remove();
    const rows = rowsFor(videos);
    let running = false, finished = false;
    const fr = frLoad();
    let frLast = null;          // { n, files, rows: [{ r, before, after }] } - the last replace, for Undo
    let frSel = null;           // the row box last left and what was selected in it

    const modal = document.createElement("div");
    modal.className = "basket-json-modal";
    modal.id = "scrayBulkRename";
    modal.style.zIndex = "2147483002";
    document.body.appendChild(modal);

    // Clear of the corner-button dock (disguise.js), which always draws on top:
    // the modal's bottom padding stops above it, re-measured on resize, so the
    // Rename / Cancel row is never underneath the buttons (native 15.160).
    const clearOfDock = () => {
      if (!modal.isConnected) { window.removeEventListener("resize", clearOfDock); return; }
      let gap = 0;
      try {
        const dock = document.getElementById("scrayDisguiseDock");
        const r = dock && dock.offsetParent !== null ? dock.getBoundingClientRect() : null;
        if (r && r.height && r.top > window.innerHeight / 2) gap = Math.round(window.innerHeight - r.top + 8);
      } catch (e) { /* no dock */ }
      modal.style.paddingBottom = gap ? "max(" + gap + "px, 20px)" : "";
    };
    clearOfDock();
    window.addEventListener("resize", clearOfDock);

    const changed = (r) => nfc(r.value.trim()) !== nfc(r.orig);
    const todo = () => rows.filter((r) => changed(r) && !check(r) && r.status !== "ok");

    function paint() {
      const nFull = rows.filter((r) => r.full).length;
      const nNp = rows.filter((r) => r.np).length;
      const bad = rows.filter((r) => changed(r) && check(r)).length;
      const go = todo().length;
      modal.innerHTML = `
        <div class="basket-json-modal-content" style="max-width:640px;width:94vw;max-height:100%;display:flex;flex-direction:column;">
          <h3 style="margin:0 0 6px;">Rename ${rows.length} file${rows.length === 1 ? "" : "s"}</h3>
          <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;">
            <button class="modal-btn modal-btn-secondary" data-br="all-full" ${running || !nFull ? "disabled" : ""}>Use suggested for all (${nFull})</button>
            <button class="modal-btn modal-btn-secondary" data-br="all-np" ${running || !nNp ? "disabled" : ""}>Use without parent for all (${nNp})</button>
            <button class="modal-btn modal-btn-secondary" data-br="reset" ${running ? "disabled" : ""}>Reset</button>
            <button class="modal-btn modal-btn-secondary" data-br="fr" ${running ? "disabled" : ""} title="Find and replace in every name"
              style="${fr.open ? "background:#0e6674;color:#fff;" : ""}">&#8644; Find &amp; replace</button>
          </div>
          ${fr.open ? frHtml() : ""}
          <div id="brList" style="overflow-y:auto;flex:1;text-align:left;">
            ${rows.map((r, i) => rowHtml(r, i)).join("")}
          </div>
          <div style="margin-top:10px;font-size:.85rem;color:#c0392b;">${bad ? bad + " name" + (bad === 1 ? " needs" : "s need") + " fixing" : ""}</div>
          <div style="display:flex;gap:8px;margin-top:8px;">
            ${finished
              ? `<button class="modal-btn modal-btn-primary" data-br="close" style="flex:1;">Close</button>`
              : `<button class="modal-btn modal-btn-primary" data-br="go" style="flex:1;" ${running || !go || bad ? "disabled" : ""}>${running ? "Renaming..." : "Rename " + go}</button>
                 <button class="modal-btn rn-cancel" data-br="close" ${running ? "disabled" : ""}>Cancel</button>`}
          </div>
        </div>`;
    }

    // The last replace stands while every row it changed still reads as it left it.
    function frLive() {
      if (frLast && !frLast.rows.every((x) => x.r.value === x.after && x.r.status !== "ok")) frLast = null;
      return frLast;
    }
    function frCount() {
      const re = frPattern(fr);
      let n = 0, files = 0;
      if (re) rows.forEach((r) => { if (r.status === "ok") return; const m = (r.value.match(re) || []).length; n += m; if (m) files++; });
      return { n, files };
    }
    const frIn = (files) => " in " + files + " file" + (files === 1 ? "" : "s");
    function frNote() {
      const last = frLive();
      if (last) return "Replaced " + last.n + frIn(last.files);
      if (!fr.find) return "";
      const c = frCount();
      return c.n ? c.n + (c.n === 1 ? " match" : " matches") + frIn(c.files) : "No matches";
    }
    function frHtml() {
      const c = frCount(), last = frLive();
      const inp = "flex:1 1 0;min-width:0;padding:6px;font-size:16px;border:1px solid #bbb;border-radius:4px;box-sizing:border-box;";
      return `
          <div style="margin-bottom:8px;padding:8px;background:#eef8fa;border:1px solid #bfe3ea;border-radius:4px;text-align:left;">
            <div style="display:flex;align-items:center;gap:6px;">
              <input type="text" data-br="fr-find" value="${esc(fr.find)}" placeholder="Find" style="${inp}" ${running ? "disabled" : ""}
                autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">
              <span style="color:#666;font-weight:bold;">&rarr;</span>
              <input type="text" data-br="fr-repl" value="${esc(fr.repl)}" placeholder="Replace with" style="${inp}" ${running ? "disabled" : ""}
                autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">
            </div>
            <div style="display:flex;align-items:center;gap:8px;margin-top:6px;flex-wrap:wrap;">
              <label style="display:flex;align-items:center;gap:4px;font-size:.8rem;color:#444;margin:0;">
                <input type="checkbox" data-br="fr-cs" style="margin:0;width:auto;" ${fr.cs ? "checked" : ""} ${running ? "disabled" : ""}> Match case</label>
              <span data-br="fr-note" style="flex:1 1 auto;font-size:.8rem;color:#666;min-width:0;">${esc(frNote())}</span>
              ${last ? `<button class="modal-btn modal-btn-secondary" data-br="fr-undo" style="flex:0 0 auto;width:auto;margin:0;padding:6px 10px;font-size:.8rem;" ${running ? "disabled" : ""}>Undo</button>` : ""}
              <button class="modal-btn modal-btn-primary" data-br="fr-go" style="flex:0 0 auto;width:auto;margin:0;padding:6px 12px;font-size:.8rem;" ${running || !c.n ? "disabled" : ""}>Replace all</button>
            </div>
          </div>`;
    }
    // Typing in Find changes only the note and Replace all, so the keyboard stays up.
    function frRefresh() {
      const note = modal.querySelector('[data-br="fr-note"]');
      if (note) note.textContent = frNote();
      const go = modal.querySelector('button[data-br="fr-go"]');
      if (go) go.disabled = running || !frCount().n;
    }
    function frReplace() {
      if (running) return;
      const re = frPattern(fr);
      if (!re) return;
      const last = { n: 0, files: 0, rows: [] };
      rows.forEach((r) => {
        if (r.status === "ok") return;
        const m = (r.value.match(re) || []).length;
        if (!m) return;
        const before = r.value;
        r.value = r.value.replace(re, () => fr.repl);   // a function: no $& surprises
        if (r.status === "fail") { r.status = ""; r.msg = ""; }
        last.n += m; last.files++; last.rows.push({ r, before, after: r.value });
      });
      if (!last.n) { frRefresh(); return; }
      frLast = last;
      paint();
    }
    function frToggle() {
      fr.open = !fr.open;
      let picked = "";
      if (fr.open && frSel && frSel.end > frSel.start && !(frSel.start === 0 && frSel.end === frSel.value.length)) {
        picked = frSel.value.slice(frSel.start, frSel.end);
        fr.find = picked;
      }
      frSave(fr);
      paint();
      if (fr.open) {
        const f = modal.querySelector(picked ? 'input[data-br="fr-repl"]' : 'input[data-br="fr-find"]');
        if (f) { f.focus(); try { f.select(); } catch (e) { /* ok */ } }
      }
    }

    function rowHtml(r, i) {
      const err = r.status === "" && changed(r) ? check(r) : "";
      const icon = r.status === "ok" ? "✅" : r.status === "fail" ? "❌" : r.status === "busy" ? "⏳" : "";
      const chips = (r.full || r.np) && r.status !== "ok" ? `
        <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:3px;">
          ${r.full ? `<button class="modal-btn modal-btn-secondary" data-br="pick" data-i="${i}" data-which="full" style="font-size:.72rem;padding:2px 6px;" ${running ? "disabled" : ""} title="${esc(r.full + r.ext)}">Suggested</button>` : ""}
          ${r.np ? `<button class="modal-btn modal-btn-secondary" data-br="pick" data-i="${i}" data-which="np" style="font-size:.72rem;padding:2px 6px;" ${running ? "disabled" : ""} title="${esc(r.np + r.ext)}">− parent</button>` : ""}
        </div>` : "";
      return `
        <div style="padding:6px 0;border-bottom:1px solid rgba(128,128,128,.25);">
          <div style="font-size:.72rem;opacity:.7;word-break:break-all;">${icon} ${esc(r.orig + r.ext)}</div>
          <div style="display:flex;gap:4px;align-items:center;margin-top:2px;">
            <input type="text" data-br="in" data-i="${i}" value="${esc(r.value)}" ${running || r.status === "ok" ? "disabled" : ""}
              style="flex:1;min-width:0;font-size:.85rem;padding:4px;${err ? "border:1px solid #c0392b;" : ""}" autocapitalize="off" autocorrect="off" spellcheck="false">
            <span style="font-size:.8rem;opacity:.7;">${esc(r.ext)}</span>
            <button class="modal-btn modal-btn-secondary" data-br="revert" data-i="${i}" style="padding:2px 8px;" ${running || !changed(r) || r.status === "ok" ? "disabled" : ""} title="Back to the current name">↺</button>
          </div>
          ${chips}
          ${err ? `<div style="font-size:.72rem;color:#c0392b;">${esc(err)}</div>` : ""}
          ${r.msg ? `<div style="font-size:.72rem;color:${r.status === "fail" ? "#c0392b" : "#2e7d32"};">${esc(r.msg)}</div>` : ""}
        </div>`;
    }

    // Typing repaints only the little bits that depend on it, so the keyboard
    // stays up: a full repaint would drop focus on every keystroke.
    function softRepaint() {
      const active = document.activeElement;
      const idx = active && active.dataset && active.dataset.br === "in" ? Number(active.dataset.i) : -1;
      const pos = idx >= 0 ? active.selectionStart : 0;
      paint();
      if (idx >= 0) {
        const el = modal.querySelector(`input[data-br="in"][data-i="${idx}"]`);
        if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch (e) { /* ok */ } }
      }
    }

    modal.addEventListener("input", (e) => {
      const f = e.target.closest && e.target.closest('input[data-br="fr-find"], input[data-br="fr-repl"]');
      if (f) {
        if (f.dataset.br === "fr-find") { fr.find = f.value; frLast = null; } else fr.repl = f.value;
        frSave(fr); frRefresh(); return;
      }
      const el = e.target.closest && e.target.closest('input[data-br="in"]');
      if (!el) return;
      rows[Number(el.dataset.i)].value = el.value;
      softRepaint();
    });

    modal.addEventListener("change", (e) => {
      if (!e.target.matches || !e.target.matches('input[data-br="fr-cs"]')) return;
      fr.cs = e.target.checked; frLast = null; frSave(fr); frRefresh();
    });
    modal.addEventListener("keydown", (e) => {
      const f = e.target.closest && e.target.closest('input[data-br="fr-find"], input[data-br="fr-repl"]');
      if (!f) return;
      if (e.key === "Enter") { e.preventDefault(); frReplace(); }
      else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); if (fr.open) frToggle(); }
    });
    // What was selected in a row's box when it lost focus - goes into Find
    // when the row opens. Desktop keeps the box focused through the press.
    modal.addEventListener("focusout", (e) => {
      const el = e.target.closest && e.target.closest('input[data-br="in"]');
      if (el) frSel = { value: el.value, start: el.selectionStart, end: el.selectionEnd };
    });
    modal.addEventListener("mousedown", (e) => {
      if (e.target.closest && e.target.closest('button[data-br="fr"]')) e.preventDefault();
    });

    modal.addEventListener("click", async (e) => {
      if (e.target === modal && !running) { modal.remove(); return; }
      const b = e.target.closest && e.target.closest("button[data-br]");
      if (!b || b.disabled) return;
      const what = b.dataset.br;
      if (what === "close") { if (!running) modal.remove(); return; }
      if (running) return;
      if (what === "fr") {
        const a = document.activeElement;
        if (a && a.dataset && a.dataset.br === "in") frSel = { value: a.value, start: a.selectionStart, end: a.selectionEnd };
        frToggle(); return;
      }
      if (what === "fr-go") { frReplace(); return; }
      if (what === "fr-undo") {
        if (frLive()) frLast.rows.forEach((x) => { if (x.r.value === x.after && x.r.status !== "ok") x.r.value = x.before; });
        frLast = null; paint(); return;
      }
      if (what === "all-full") { rows.forEach((r) => { if (r.full && r.status !== "ok") r.value = r.full; }); paint(); return; }
      if (what === "all-np") { rows.forEach((r) => { if (r.np && r.status !== "ok") r.value = r.np; }); paint(); return; }
      if (what === "reset") { rows.forEach((r) => { if (r.status !== "ok") { r.value = r.orig; r.msg = ""; r.status = ""; } }); paint(); return; }
      if (what === "revert") { const r = rows[Number(b.dataset.i)]; r.value = r.orig; r.status = ""; r.msg = ""; paint(); return; }
      if (what === "pick") { const r = rows[Number(b.dataset.i)]; r.value = b.dataset.which === "np" ? r.np : r.full; paint(); return; }
      if (what === "go") await run();
    });

    async function run() {
      const list = todo();
      if (!list.length) return;
      // One scope question for the whole batch, as the CSV bulk rename does.
      let opts = {};
      if (typeof window.scrayAskRenameScope === "function" && typeof window.isLocalVideo === "function" &&
          list.some((r) => window.isLocalVideo(r.video) && r.video.inCatalogue === true)) {
        const scope = await window.scrayAskRenameScope({ count: list.length });
        if (!scope) return;               // cancelled: nothing renamed
        opts = { scope };
      }
      running = true; paint();
      let ok = 0, fail = 0;
      for (const r of list) {
        r.status = "busy"; r.msg = ""; paint();
        const newFull = r.value.trim() + r.ext;
        const keyBefore = r.video.videoKey || (window.scrayVideoKey ? window.scrayVideoKey(r.video.filename) : null);
        try {
          const res = await renameFile(r.video, newFull, opts);
          try {
            const phoneOnly = !!(res && res.scope === "phone");
            const after = phoneOnly ? keyBefore
              : ((r.video.videoKey && r.video.videoKey !== keyBefore) ? r.video.videoKey
                : (window.scrayVideoKey ? window.scrayVideoKey(newFull) : keyBefore));
            if (window.scrayStashNames && typeof window.scrayStashNames.rekey === "function" && keyBefore) {
              window.scrayStashNames.rekey(keyBefore, after);
            }
          } catch (er) { console.warn("[bulk-rename] stash carry-over failed:", er); }
          r.status = "ok"; r.msg = "Renamed"; r.orig = r.value.trim(); r.value = r.orig; ok++;
        } catch (err) {
          r.status = "fail"; r.msg = (err && err.message) || "Failed"; fail++;
        }
        paint();
      }
      try { Promise.resolve(window.scrayStashNames?.refresh(true)).catch(() => {}); } catch (e) { /* ok */ }
      try { if (typeof window.scrayLoadStashState === "function") Promise.resolve(window.scrayLoadStashState(true)).catch(() => {}); } catch (e) { /* ok */ }
      try { if (typeof window.refreshAllLists === "function") window.refreshAllLists(); } catch (e) { /* ok */ }
      running = false; finished = fail === 0; paint();
      if (typeof window.showSyncConfirmation === "function") {
        window.showSyncConfirmation(fail ? `Renamed ${ok}, ${fail} failed` : `Renamed ${ok} file${ok === 1 ? "" : "s"}`, fail ? "#c0392b" : undefined);
      }
    }

    paint();
  }

  window.scrayShowBulkRename = open;
})();

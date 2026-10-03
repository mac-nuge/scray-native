// scray-convert-bulk.js — Convert several files to MP4 at once (browse 15.160;
// browse 15.161 / picker 15.88 / native 15.105: in Migrate and the apps too).
// One file, identical in scray-picker, scray-native/assets/web and scray-browse,
// as scray-convert.js (the one-file modal) is.
//
// Where it opens: Data explorer and Migrate (the ticked rows: the toolbar's
// Convert N…, or Convert to MP4… on a ticked row), and Picker / Native (MP4 on
// the Bulk select bar). One set of settings for all of them.
//
// Looks: theme 'console' wears the browse pages' look (veil, dlg, go, ghost
// and their colour variables), theme 'app' Picker's / Native's modal classes
// (basket-json-modal, modal-btn …). The behaviour is the same.
//
// The same choices as one file, applied to each:
//   * quality - a % of each file's own bitrate, with each file's estimate and the total;
//   * one pass or two;
//   * the name - each file's same name as .mp4, or its suggested name where it
//     has one (the same name where it hasn't);
//   * where - each file's own folder, or one box folder for all of them;
//   * whether to delete each original once its MP4 is in place.
// Files that can't go (not on the box, already converting, a name that's taken
// or used twice in the batch) are listed and left out; any file can be unticked.
//
// Usage:
//   scrayConvertBulk.open({ items: [{ videoKey, instanceId?, filename, row? }], theme: 'console' | 'app',
//                           call(action, body) -> Promise<json>,
//                           suggest(item) -> Promise<name|null>,
//                           by, monitorUrl, onQueued(results) })
//   scrayConvertBulk.forApp(videos, { onQueued })    Picker / Native: all of the above from video rows
(function () {
  'use strict';

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const DEFAULT_QUALITY = 70;      // ⚙️ as scray-convert.js
  const MIN_QUALITY = 10;
  const FLOOR_BPS = 198000;        // ⚙️ as scray-convert.js and api.php's SCRAY_CONV_FLOOR_BPS
  const PREP_CHUNK = 100;          // files looked up per call while opening

  function bytes(n) {
    n = Number(n) || 0;
    if (n >= 1e9) return (n / 1e9).toFixed(n >= 1e10 ? 1 : 2) + ' GB';
    if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e8 ? 0 : 1) + ' MB';
    if (n >= 1e3) return Math.round(n / 1e3) + ' KB';
    return n + ' B';
  }
  const stripExt = (n) => String(n || '').replace(/\.[A-Za-z0-9]{1,5}$/, '');
  const keyOf = (n) => String(n || '').trim().normalize('NFC').toLowerCase();

  function ensureCss() {
    if (document.getElementById('scvbCss')) return;
    const css = document.createElement('style');
    css.id = 'scvbCss';
    css.textContent = `
.scvb .scvb-card { max-width: 760px; width: calc(100vw - 32px); max-height: calc(100vh - 32px); overflow-y: auto; box-sizing: border-box; -webkit-overflow-scrolling: touch; }
.scvb .scv-sec { margin: 12px 0 0; }
.scvb .scv-lab { display: block; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; margin: 0 0 5px; }
.scvb .scv-opt { display: flex; align-items: flex-start; gap: 8px; margin: 4px 0; cursor: pointer; font-size: 13px; line-height: 1.35; text-transform: none; letter-spacing: 0; }
.scvb .scv-opt input { width: 16px; height: 16px; margin: 1px 0 0; flex: 0 0 auto; padding: 0; }
.scvb .scv-opt small { display: block; font-size: 11.5px; }
.scvb .scv-opt b { font-weight: 600; }
.scvb .scv-q { display: flex; align-items: center; gap: 10px; }
.scvb .scv-q input[type=range] { flex: 1 1 auto; min-width: 0; margin: 0; padding: 0; border: 0; background: none; }
.scvb .scv-qv { flex: 0 0 auto; min-width: 46px; text-align: right; font-weight: 700; font-variant-numeric: tabular-nums; }
.scvb .scv-est { margin: 6px 0 0; font-size: 13px; font-variant-numeric: tabular-nums; }
.scvb .scv-est b { font-size: 15px; }
.scvb .scv-msg { font-size: 12px; margin: 4px 0 0 24px; }
.scvb .scv-msg:empty { display: none; }
.scvb .scv-warn { font-size: 12px; }
.scvb .scv-dirs { margin: 6px 0 0 24px; }
.scvb .scv-dirs input { width: 100%; box-sizing: border-box; margin: 0; }
.scvb .scv-dlist { max-height: 150px; overflow-y: auto; -webkit-overflow-scrolling: touch; margin-top: 4px; }
.scvb .scv-dlist button { display: flex; justify-content: space-between; gap: 8px; width: 100%; text-align: left; border: 0; border-radius: 0; margin: 0; padding: 5px 8px; font-size: 12.5px; cursor: pointer; background: transparent; color: inherit; }
.scvb .scv-dlist button small { opacity: .6; flex: 0 0 auto; }
.scvb .scvb-files { max-height: 240px; overflow-y: auto; -webkit-overflow-scrolling: touch; font-size: 12px; }
.scvb .scvb-files table { width: 100%; border-collapse: collapse; }
.scvb .scvb-files td { padding: 4px 6px; vertical-align: top; }
.scvb .scvb-files td.ck { width: 18px; }
.scvb .scvb-files td.ck input { margin: 1px 0 0; width: 16px; height: 16px; padding: 0; }
.scvb .scvb-files td.sz { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.scvb .scvb-files .nm, .scvb .scvb-files .to { word-break: break-word; }
.scvb .scvb-files .to b { font-weight: 600; }
.scvb .scvb-files tr.off td { opacity: .5; }
.scvb .scvb-files .why, .scvb .scvb-files .note { font-size: 11.5px; }
.scvb .scvb-sum { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 12px; margin: 6px 0 0; }
.scvb .scvb-sum a { cursor: pointer; text-decoration: underline; }
.scvb .scv-btns { display: flex; gap: 8px; margin-top: 16px; }
.scvb .scv-btns button { flex: 1 1 0; }
.scvb .scv-busy { opacity: .7; font-size: 13px; padding: 10px 0; }
.scvb .scv-done { font-size: 14px; line-height: 1.5; }
.scvb .scv-done a { font-weight: 600; }
.scvb .scv-done ul { margin: 6px 0 0; padding-left: 18px; font-size: 12.5px; max-height: 200px; overflow-y: auto; }

/* console: the browse pages - dark, their own variables */
.scvb-console .scv-lab, .scvb-console .scv-opt small, .scvb-console .scvb-files td.sz, .scvb-console .scvb-files .to,
.scvb-console .scvb-sum { color: var(--dim, #6d8298); }
.scvb-console .scv-opt input, .scvb-console .scvb-files td.ck input { accent-color: var(--cyan, #3ec7d4); }
.scvb-console .scv-q input[type=range] { accent-color: var(--amber, #f0a500); }
.scvb-console .scv-qv, .scvb-console .scv-warn, .scvb-console .scvb-files .note, .scvb-console .scv-dlist button.on { color: var(--amber, #f0a500); }
.scvb-console .scv-est b, .scvb-console .scv-msg.ok { color: var(--green, #5bc98a); }
.scvb-console .scv-msg.bad, .scvb-console .scvb-files tr.skip .why { color: var(--red, #e2574c); }
.scvb-console .scv-dlist, .scvb-console .scvb-files { border: 1px solid var(--line, #26364a); }
.scvb-console .scvb-files td { border-bottom: 1px solid var(--line, #26364a); }
.scvb-console .scvb-files .to b { color: var(--text, #c3d1dd); }
.scvb-console .scv-dlist button:hover { background: var(--panel-2, #1b2733); color: var(--cyan, #3ec7d4); }
.scvb-console .scvb-sum a, .scvb-console .scv-done a { color: var(--cyan, #3ec7d4); }

/* app: Picker / Native - light, like their other modals */
.scvb-app .scvb-card { max-width: 560px; max-height: 88vh; }
.scvb-app .scv-lab { color: #555; }
.scvb-app .scv-opt small, .scvb-app .scvb-files td.sz, .scvb-app .scvb-files .to, .scvb-app .scvb-sum { color: #666; }
.scvb-app .scv-opt input, .scvb-app .scvb-files td.ck input, .scvb-app .scv-q input[type=range] { accent-color: #6f42c1; }
.scvb-app .scv-qv, .scvb-app .scvb-sum a, .scvb-app .scv-done a { color: #6f42c1; }
.scvb-app .scv-est b, .scvb-app .scv-msg.ok { color: #1e7e34; }
.scvb-app .scv-msg.bad, .scvb-app .scvb-files tr.skip .why { color: #dc3545; }
.scvb-app .scv-warn, .scvb-app .scvb-files .note { color: #b8860b; }
.scvb-app .scvb-files .to b { color: #222; }
.scvb-app input[type=text] { padding: 8px; font-size: 15px; border: 1px solid #ccc; border-radius: 6px; background: #fff; color: #222; box-sizing: border-box; }
.scvb-app .scv-dlist, .scvb-app .scvb-files { border: 1px solid #e3e3e8; border-radius: 6px; }
.scvb-app .scvb-files td { border-bottom: 1px solid #eee; }
.scvb-app .scv-dlist button:nth-child(odd) { background: #f7f7fa; }
.scvb-app .scv-dlist button.on { background: #6f42c1; color: #fff; }
.scvb-app .scv-opt, .scvb-app .scvb-files { font-size: 14px; }
.scvb .scvb-files tr:last-child td { border-bottom: 0; }
`;
    document.head.appendChild(css);
  }

  async function open(opts) {
    ensureCss();
    const call = opts.call;
    // One line per video (a video ticked twice - two copy lines - goes once, as the first copy asked for).
    const seen = new Set();
    const asked = (opts.items || []).filter(it => {
      const k = keyOf(it.videoKey);
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    const theme = opts.theme === 'app' ? 'app' : 'console';
    let closed = false;
    const root = document.createElement('div');
    if (theme === 'console') {
      root.className = 'veil on scvb scvb-console';
      root.innerHTML = '<div class="dlg scvb-card" role="dialog" aria-modal="true"></div>';
    } else {
      root.className = 'basket-json-modal scvb scvb-app';
      root.style.zIndex = '2147483647';     // over FLS, as the other modals
      root.innerHTML = '<div class="basket-json-modal-content scvb-card" role="dialog" aria-modal="true"></div>';
    }
    const card = root.firstChild;
    const close = () => {
      if (closed || st.busy) return;
      closed = true;
      document.removeEventListener('keydown', onKey, true);
      root.remove();
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    root.addEventListener(theme === 'console' ? 'mousedown' : 'click', (e) => { if (e.target === root) close(); });
    document.body.appendChild(root);
    document.addEventListener('keydown', onKey, true);
    const title = (n) => theme === 'console'
      ? `<h2>CONVERT ${Number(n).toLocaleString()} FILE${n === 1 ? '' : 'S'} TO MP4</h2>`
      : `<h3>Convert ${Number(n).toLocaleString()} file${n === 1 ? '' : 's'} to MP4</h3>`;
    const btn = (kind, label, attrs) => theme === 'console'
      ? `<button type="button" class="${kind === 'go' ? 'go' : 'ghost'}" ${attrs || ''}>${label}</button>`
      : `<button type="button" class="modal-btn ${kind === 'go' ? 'modal-btn-primary' : 'modal-btn-cancel'}" ${attrs || ''}>${label}</button>`;
    const st = { q: DEFAULT_QUALITY, passes: 1, nameMode: 'same', destMode: 'same', dir: '', del: false, busy: false, checking: false, finding: false, err: '' };

    if (!asked.length) {
      card.innerHTML = title(0) + `<p>Nothing to convert.</p><div class="scv-btns">${btn('x', 'Close', 'data-x')}</div>`;
      card.querySelector('[data-x]').onclick = close;
      return;
    }
    card.innerHTML = title(asked.length) + `<div class="scv-busy" data-busy>Looking them up…</div>`;

    // ---- look every file up ----
    const items = [];
    try {
      for (let i = 0; i < asked.length; i += PREP_CHUNK) {
        const part = asked.slice(i, i + PREP_CHUNK);
        const r = await call('convert_prepare_many', { items: part.map(it => ({ video_key: it.videoKey, instance_id: it.instanceId || '' })) });
        if (closed) return;
        (r.items || []).forEach((p, j) => {
          const src = part[j] || {};
          items.push({
            src, prep: p, key: (p.video && p.video.video_key) || keyOf(src.videoKey),
            filename: (p.video && p.video.filename) || src.filename || src.videoKey,
            copy: (p.copies && p.copies[0]) || null,
            on: true, sug: undefined, name: '', chk: null
          });
        });
        const b = card.querySelector('[data-busy]');
        if (b) b.textContent = `Looking them up… ${Math.min(i + PREP_CHUNK, asked.length).toLocaleString()} of ${asked.length.toLocaleString()}`;
      }
    } catch (err) {
      if (closed) return;
      card.innerHTML = title(asked.length) + `<p class="scv-msg bad" style="margin-left:0">${esc(err.message || err)}</p>` +
        `<div class="scv-btns">${btn('x', 'Close', 'data-x')}</div>`;
      card.querySelector('[data-x]').onclick = close;
      return;
    }

    // Why a file can't go at all, whatever the settings.
    function fixedSkip(it) {
      const p = it.prep;
      if (p.gone) return 'not in the library any more';
      if (!it.copy) return p.no_box === 'onedrive' ? 'only in OneDrive - migrate it to the box first' : 'only on the phone';
      if (p.active && p.active.length) return 'already converting: ' + p.active.map(a => `#${a.id} ${a.out_name}`).join(', ');
      return '';
    }
    items.forEach(it => { it.fixed = fixedSkip(it); if (it.fixed) it.on = false; });
    const usable = () => items.filter(it => !it.fixed);

    const sizeOf = (it) => Number(it.copy && it.copy.size) || Number(it.prep.video && it.prep.video.size) || 0;
    const durOf = (it) => Number(it.copy && it.copy.duration_ms) || Number(it.prep.video && it.prep.video.duration_ms) || 0;
    function estOf(it) {
      const size = sizeOf(it), dur = durOf(it);
      const floor = dur ? Math.round(FLOOR_BPS * dur / 1000 / 8) : 0;
      return Math.min(size, Math.max(Math.round(size * st.q / 100), floor));
    }
    const nameOf = (it) => st.nameMode === 'sug' && it.sug ? it.sug : it.prep.default_name;
    const sameDir = (it) => (it.copy && it.copy.same_folder && it.copy.same_folder.dir) || '';
    const destDir = () => String(st.dir || '').trim().replace(/^\/+|\/+$/g, '');

    // What's wrong with a file's name, once checked; a name used twice in the batch goes once.
    function nameSkip(it) {
      const c = it.chk;
      if (!c) return '';
      if (c.bad) return c.bad;
      if (c.taken) return 'the name is already in the library: ' + c.taken;
      if (c.busy) return `conversion #${c.busy} is already making ${c.name}`;
      if (c.dupeOf) return 'the same name as ' + c.dupeOf + ' in this batch';
      return '';
    }
    const skipOf = (it) => it.fixed || nameSkip(it);
    const going = () => items.filter(it => it.on && !skipOf(it));

    // ---- names: work them out, then ask the library about all of them at once ----
    let checkSeq = 0;
    async function checkNames() {
      const seq = ++checkSeq;
      st.checking = true;
      paintFiles();
      const list = usable();
      list.forEach(it => { it.name = nameOf(it); });
      try {
        const r = await call('convert_check_many', { names: list.map(it => it.name) });
        if (seq !== checkSeq || closed) return;
        const firstBy = new Map();
        list.forEach((it, i) => {
          const c = Object.assign({}, (r.results || [])[i] || {});
          const k = keyOf(c.name || it.name);
          // Only among the ticked ones: untick the first and the second can go.
          if (!c.bad && !c.taken && !c.busy && it.on) {
            if (firstBy.has(k)) c.dupeOf = firstBy.get(k).filename;
            else firstBy.set(k, it);
          }
          it.chk = c;
        });
      } catch (err) {
        if (seq !== checkSeq || closed) return;
        list.forEach(it => { it.chk = { name: it.name }; });     // the server checks again on Convert
      }
      st.checking = false;
      paintFiles();
    }

    // Suggested names, fetched once, the first time they're asked for.
    let sugDone = false;
    async function findSuggestions() {
      if (sugDone || !opts.suggest) { checkNames(); return; }
      st.finding = true;
      paintFiles();
      await Promise.all(usable().map(async it => {
        try {
          const s = await opts.suggest(it.src);
          const n = s ? stripExt(s).trim() : '';
          it.sug = n && (n + '.mp4').toLowerCase() !== String(it.prep.default_name).toLowerCase() ? n + '.mp4' : null;
        } catch (e) { it.sug = null; }
      }));
      sugDone = true;
      st.finding = false;
      if (!closed) checkNames();
    }

    // ---- painting ----
    function totalsHtml() {
      const g = going();
      const before = g.reduce((a, it) => a + sizeOf(it), 0);
      const after = g.reduce((a, it) => a + estOf(it), 0);
      const atFloor = g.filter(it => durOf(it) && estOf(it) > sizeOf(it) * st.q / 100 + 1).length;
      return `≈ <b>${bytes(after)}</b> in all <span style="opacity:.75">(now ${bytes(before)}, −${bytes(before - after)}, ${g.length.toLocaleString()} file${g.length === 1 ? '' : 's'})</span>` +
        (atFloor ? `<div class="scv-warn">${atFloor.toLocaleString()} ${atFloor === 1 ? 'is' : 'are'} as small as ${atFloor === 1 ? 'its' : 'their'} length goes - lower won’t make ${atFloor === 1 ? 'it' : 'them'} smaller.</div>` : '');
    }
    function rowHtml(it, i) {
      const skip = skipOf(it);
      const to = it.fixed ? '' : (it.chk && it.chk.name) || nameOf(it);
      const dir = st.destMode === 'same' ? sameDir(it) : destDir();
      const more = it.prep.copies && it.prep.copies.length > 1 ? ` · the first of ${it.prep.copies.length} box copies` : '';
      return `<tr class="${skip ? 'skip off' : it.on ? '' : 'off'}">` +
        `<td class="ck"><input type="checkbox" data-i="${i}"${it.on && !skip ? ' checked' : ''}${skip ? ' disabled' : ''} aria-label="Convert this one"></td>` +
        `<td><div class="nm">${esc(it.filename)}</div>` +
          (to ? `<div class="to">→ <b>${esc(to)}</b> · /${esc(dir)}${esc(more)}</div>` : '') +
          (skip ? `<div class="why">${esc(skip)}</div>` : '') +
          (!skip && st.nameMode === 'sug' && sugDone && !it.sug ? `<div class="note">no suggested name - keeps its own</div>` : '') +
        `</td>` +
        `<td class="sz">${it.copy ? esc(bytes(sizeOf(it))) + '<br>→ ' + esc(bytes(estOf(it))) : ''}</td></tr>`;
    }
    function paintFiles() {
      if (closed) return;
      const box = card.querySelector('[data-files]');
      if (!box) return;
      const top = box.scrollTop;
      box.innerHTML = `<table>${items.map(rowHtml).join('')}</table>`;
      box.scrollTop = top;
      box.querySelectorAll('input[data-i]').forEach(cb => {
        cb.onchange = () => {
          items[+cb.dataset.i].on = cb.checked;
          checkNames();                    // a name twice in the batch is judged among the ticked ones
        };
      });
      const skipped = items.filter(it => skipOf(it)).length;
      const unticked = items.filter(it => !it.on && !skipOf(it)).length;
      const sum = card.querySelector('[data-sum]');
      if (sum) {
        sum.innerHTML = (st.finding ? '<span>Finding suggested names…</span>' : st.checking ? '<span>Checking names…</span>' : '') +
          (skipped ? `<span>${skipped.toLocaleString()} can’t be converted (reason under each)</span>` : '') +
          (unticked ? `<span>${unticked.toLocaleString()} unticked</span>` : '') +
          (usable().length > 1 ? `<span><a data-all="1">tick all</a> · <a data-all="0">untick all</a></span>` : '');
        sum.querySelectorAll('a[data-all]').forEach(a => {
          a.onclick = () => { usable().forEach(it => { it.on = a.dataset.all === '1'; }); checkNames(); };
        });
      }
      const est = card.querySelector('[data-est]');
      if (est) est.innerHTML = totalsHtml();
      paintGo();
    }
    function paintGo() {
      const g = card.querySelector('[data-go]');
      if (!g) return;
      const n = going().length;
      g.disabled = !n || st.busy || st.checking || st.finding;
      g.textContent = st.busy ? 'Queueing…' : n ? `Convert ${n.toLocaleString()}` : 'Convert';
    }

    function paint() {
      if (closed) return;
      card.innerHTML = title(items.length) +
        `<div class="scvb-files" data-files></div>` +
        `<div class="scvb-sum" data-sum></div>` +

        `<div class="scv-sec"><span class="scv-lab">Quality - for every file</span>` +
          `<div class="scv-q"><input type="range" min="${MIN_QUALITY}" max="100" step="5" value="${st.q}" data-q aria-label="Quality">` +
          `<span class="scv-qv" data-qv>${st.q}%</span></div>` +
          `<div class="scv-est" data-est></div></div>` +

        `<div class="scv-sec"><span class="scv-lab">Encoding</span>` +
          `<label class="scv-opt"><input type="radio" name="scvbPass" value="1"${st.passes === 1 ? ' checked' : ''}><span><b>One pass</b><small>Quicker. Each size lands within about 5–10% of its estimate.</small></span></label>` +
          `<label class="scv-opt"><input type="radio" name="scvbPass" value="2"${st.passes === 2 ? ' checked' : ''}><span><b>Two passes</b><small>About twice as long. Each size lands within about 1–2%.</small></span></label></div>` +

        `<div class="scv-sec"><span class="scv-lab">Names</span>` +
          `<label class="scv-opt"><input type="radio" name="scvbName" value="same"${st.nameMode === 'same' ? ' checked' : ''}><span><b>The same names</b>, as .mp4</span></label>` +
          `<label class="scv-opt"><input type="radio" name="scvbName" value="sug"${st.nameMode === 'sug' ? ' checked' : ''}${opts.suggest ? '' : ' disabled'}><span><b>Suggested names</b> where there is one<small>From each file’s Stash match. A file with no suggestion keeps its own name.</small></span></label></div>` +

        `<div class="scv-sec"><span class="scv-lab">Save to</span>` +
          `<label class="scv-opt"><input type="radio" name="scvbDest" value="same"${st.destMode === 'same' ? ' checked' : ''}><span><b>Each file’s own folder</b></span></label>` +
          `<label class="scv-opt"><input type="radio" name="scvbDest" value="other"${st.destMode === 'other' ? ' checked' : ''}><span><b>One box folder</b> for all of them</span></label>` +
          (st.destMode === 'other'
            ? `<div class="scv-dirs"><input type="text" data-dir value="${esc(st.dir)}" placeholder="Search, or type a new folder (a/b)" spellcheck="false" autocomplete="off">` +
              `<div class="scv-dlist" data-dlist></div><div class="scv-msg" data-dmsg style="margin-left:0"></div></div>`
            : '') +
        `</div>` +

        `<div class="scv-sec"><label class="scv-opt"><input type="checkbox" data-del${st.del ? ' checked' : ''}><span><b>Delete each original</b> once its MP4 is safely in place` +
          `<small>From the box - permanent, the box has no recycle bin. Scores, notes and bookmarks carry over: each pair is linked as variants first.</small></span></label></div>` +
        (st.err ? `<p class="scv-msg bad" style="margin-left:0">${esc(st.err)}</p>` : '') +
        `<div class="scv-btns">${btn('x', 'Cancel', 'data-x')}${btn('go', 'Convert', 'data-go disabled')}</div>`;
      wire();
      paintFiles();
      if (st.destMode === 'other') paintDirs();
    }

    function wire() {
      card.querySelector('[data-x]').onclick = close;
      card.querySelector('[data-go]').onclick = go;
      const q = card.querySelector('[data-q]');
      q.oninput = () => {
        st.q = +q.value;
        card.querySelector('[data-qv]').textContent = st.q + '%';
        paintFiles();
      };
      card.querySelectorAll('input[name=scvbPass]').forEach(r => { r.onchange = () => { st.passes = +r.value; }; });
      card.querySelectorAll('input[name=scvbName]').forEach(r => {
        r.onchange = () => {
          st.nameMode = r.value;
          if (st.nameMode === 'sug') findSuggestions(); else checkNames();
        };
      });
      card.querySelectorAll('input[name=scvbDest]').forEach(r => {
        r.onchange = () => {
          st.destMode = r.value;
          paint();
          if (st.destMode === 'other') loadFolders();
        };
      });
      const di = card.querySelector('[data-dir]');
      if (di) di.oninput = () => { st.dir = di.value; paintDirs(); paintFiles(); };
      const del = card.querySelector('[data-del]');
      del.onchange = () => { st.del = del.checked; };
    }

    let folders = null, foldersBusy = false;
    async function loadFolders() {
      if (folders || foldersBusy) return;
      foldersBusy = true;
      try { folders = (await call('convert_folders', {})).hetzner || []; }
      catch (err) { folders = []; }
      foldersBusy = false;
      if (!closed && st.destMode === 'other') paintDirs();
    }
    function paintDirs() {
      const list = card.querySelector('[data-dlist]');
      const msg = card.querySelector('[data-dmsg]');
      if (!list) return;
      if (!folders) { list.innerHTML = '<div class="scv-busy" style="padding:6px 8px">Loading the box’s folders…</div>'; return; }
      const typed = destDir();
      const words = typed.toLowerCase().split(/\s+/).filter(Boolean);
      const hits = folders.filter(f => words.every(w => f.path.toLowerCase().includes(w))).slice(0, 80);
      list.innerHTML = hits.map(f =>
        `<button type="button" data-path="${esc(f.path)}" class="${f.path === typed ? 'on' : ''}"><span>/${esc(f.path)}</span><small>${f.files ? f.files + ' file' + (f.files === 1 ? '' : 's') : ''}</small></button>`).join('');
      list.querySelectorAll('button').forEach(b => {
        b.onclick = () => {
          st.dir = b.dataset.path;
          const di = card.querySelector('[data-dir]');
          if (di) di.value = st.dir;
          paintDirs();
          paintFiles();
        };
      });
      const known = folders.some(f => f.path.toLowerCase() === typed.toLowerCase());
      if (msg) {
        msg.className = 'scv-msg ' + (typed && !known ? 'ok' : '');
        msg.textContent = typed && !known ? 'New folder - it’s made when the first MP4 arrives: /' + typed : (typed ? 'Into /' + typed : 'Into the top of the box');
      }
    }

    async function go() {
      const list = going();
      if (!list.length || st.busy || st.checking || st.finding) return;
      st.busy = true;
      st.err = '';
      paintGo();
      let r;
      try {
        r = await call('convert_start_many', {
          items: list.map(it => ({ video_key: it.key, instance_id: it.copy.instance_id, name: (it.chk && it.chk.name) || nameOf(it) })),
          quality: st.q, passes: st.passes,
          dest: st.destMode === 'same' ? { kind: 'same' } : { kind: 'hetzner', dir: destDir() },
          delete_src: st.del, by: opts.by || ''
        });
      } catch (err) {
        st.busy = false;
        if (closed) return;
        st.err = err.message || String(err);
        paint();
        return;
      }
      st.busy = false;
      if (closed) return;
      const ok = (r.results || []).filter(x => x.ok);
      const no = (r.results || []).filter(x => !x.ok);
      const nameBy = new Map(list.map(it => [it.key, it.filename]));
      const est = ok.reduce((a, x) => a + (Number(x.job.est_bytes) || 0), 0);
      const url = opts.monitorUrl || 'converter.html';
      card.innerHTML = title(items.length) +
        `<div class="scv-done">` +
          (ok.length
            ? `Queued <b>${ok.length.toLocaleString()}</b> conversion${ok.length === 1 ? '' : 's'} (#${ok[0].job.id}${ok.length > 1 ? '–#' + ok[ok.length - 1].job.id : ''}), about ${esc(bytes(est))} in all. ` +
              `They run on the gateway one at a time - you can close this and carry on. `
            : 'Nothing was queued. ') +
          `<a href="${esc(url)}" target="_blank" rel="noopener">Watch them on Converter ↗</a>` +
          (no.length ? `<div class="scv-warn" style="margin-top:8px">${no.length.toLocaleString()} refused:</div><ul>` +
            no.map(x => `<li>${esc(nameBy.get(x.video_key) || x.video_key)}: ${esc(x.error)}</li>`).join('') + '</ul>' : '') +
        `</div><div class="scv-btns">${btn('go', 'Done', 'data-x')}</div>`;
      card.querySelector('[data-x]').onclick = close;
      if (typeof opts.onQueued === 'function') { try { opts.onQueued(r.results || []); } catch (e) { /* the page's business */ } }
    }

    paint();
    checkNames();
  }

  // ---- Picker / Native ------------------------------------------------------
  // The body goes base64-wrapped (api.php's body() unwraps it): a list of
  // filenames is what Hostinger's CDN refused in Picker's Hetzner fetch (picker 15.81).
  function b64(str) {
    const u = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function appMonitorUrl() {
    try { return new URL('converter.html', (window.SCRAY_SYNC && window.SCRAY_SYNC.API_BASE) || location.href).toString(); }
    catch (e) { return 'converter.html'; }
  }
  /** The Bulk select bar's MP4: these videos, the app's look, its API. */
  function forApp(videos, extra) {
    const keyOfVideo = (v) => v.videoKey || (window.scrayVideoKey ? window.scrayVideoKey(v.filename || '') : String(v.filename || '').toLowerCase());
    return open({
      items: (videos || []).filter(Boolean).map(v => ({ videoKey: keyOfVideo(v), instanceId: '', filename: v.filename, row: v })),
      theme: 'app',
      by: window.ScrayBridge ? 'native' : 'picker',
      call: (action, body) => window.scrayApiCall(action, { method: 'POST', body: { b64: b64(JSON.stringify(body || {})) } }),
      suggest: typeof window.scrayCleanNameSuggestion === 'function'
        ? async (it) => { try { return window.scrayCleanNameSuggestion(it.row); } catch (e) { return null; } }
        : null,
      monitorUrl: appMonitorUrl(),
      onQueued: extra && extra.onQueued
    });
  }

  window.scrayConvertBulk = { open, forApp };
})();

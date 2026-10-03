// scray-convert.js — the Convert to MP4 modal (picker 15.86 / native 15.104 /
// browse 15.158). One file, identical in scray-picker, scray-native/assets/web
// and scray-browse.
//
// A file on the Hetzner box becomes an MP4 (H.264 + AAC) on the box, made on
// the gateway (gateway/scray-convert.py) and watched on converter.html. This
// is only the asking:
//   * the copy (when a video has more than one on the box);
//   * quality - a % of the source's bitrate, so the MP4 comes out at about
//     that % of the source's size; the estimate is shown as you move it;
//   * one pass (quicker, size within ~5-10%) or two (about twice as long,
//     within ~1-2%);
//   * the name - the same name as .mp4, the suggested one (from the Stash
//     match), or your own - checked against the library as you go;
//   * where - the same folder, or any other box folder (typed folders that
//     don't exist yet are made);
//   * whether to delete the original from the box once the MP4 is in place.
// The finished MP4 is catalogued and linked to the original as a variant.
//
// Looks: theme 'app' borrows Picker's / Native's modal classes
// (basket-json-modal, modal-btn …), theme 'console' the browse pages'
// (veil, dlg, go, ghost and their colour variables). The behaviour is the same.
//
// Usage:
//   scrayConvert.open({ videoKey, instanceId?, filename, theme: 'app' | 'console',
//                       call(action, body) -> Promise<json>, suggest() -> Promise<name|null>,
//                       by, monitorUrl })
//   scrayConvert.forApp(video)        Picker / Native: all of the above from a video row
//   scrayConvert.appAvailability(video) -> { ok, why }   for the menu item (box files only)
(function () {
  'use strict';

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const DEFAULT_QUALITY = 70;      // ⚙️ where the slider starts, %
  const MIN_QUALITY = 10;          // ⚙️ and how low it goes
  // The least the gateway will give a second of video: 150 kb/s of picture and
  // 48 kb/s of sound (scray-convert.py's MIN_VIDEO_BPS and its audio floor;
  // api.php's scrayConvEstimate uses the same). A long file at a low % would
  // ask for less than that, and come out bigger than the estimate said.
  const FLOOR_BPS = 198000;

  function bytes(n) {
    n = Number(n) || 0;
    if (n >= 1e9) return (n / 1e9).toFixed(n >= 1e10 ? 1 : 2) + ' GB';
    if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e8 ? 0 : 1) + ' MB';
    if (n >= 1e3) return Math.round(n / 1e3) + ' KB';
    return n + ' B';
  }
  function clock(ms) {
    const s = Math.round((Number(ms) || 0) / 1000);
    const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
  }
  const stripExt = (n) => String(n || '').replace(/\.[A-Za-z0-9]{1,5}$/, '');

  // ---- styles: the parts both looks share, then each look's colours ----------
  function ensureCss() {
    if (document.getElementById('scvCss')) return;
    const css = document.createElement('style');
    css.id = 'scvCss';
    css.textContent = `
.scv .scv-sec { margin: 12px 0 0; }
.scv .scv-lab { display: block; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; margin: 0 0 5px; opacity: .75; }
.scv .scv-opt { display: flex; align-items: flex-start; gap: 8px; margin: 4px 0; cursor: pointer; font-size: 13px; line-height: 1.35; text-transform: none; letter-spacing: 0; }
.scv .scv-opt input[type=radio], .scv .scv-opt input[type=checkbox] { width: 16px; height: 16px; margin: 1px 0 0; flex: 0 0 auto; padding: 0; }
.scv .scv-opt small { display: block; opacity: .7; font-size: 11.5px; }
.scv .scv-opt b { font-weight: 600; word-break: break-word; }
.scv .scv-q { display: flex; align-items: center; gap: 10px; }
.scv .scv-q input[type=range] { flex: 1 1 auto; min-width: 0; margin: 0; padding: 0; border: 0; background: none; }
.scv .scv-q .scv-qv { flex: 0 0 auto; min-width: 46px; text-align: right; font-weight: 700; font-variant-numeric: tabular-nums; }
.scv .scv-est { margin: 6px 0 0; font-size: 13px; font-variant-numeric: tabular-nums; }
.scv .scv-est b { font-size: 15px; }
.scv .scv-name { display: flex; align-items: center; gap: 6px; margin: 4px 0 0 24px; }
.scv .scv-name input { flex: 1 1 auto; min-width: 0; margin: 0; }
.scv .scv-name span { flex: 0 0 auto; opacity: .7; }
.scv .scv-msg { font-size: 12px; margin: 4px 0 0 24px; min-height: 0; }
.scv .scv-msg:empty { display: none; }
.scv .scv-dirs { margin: 6px 0 0 24px; }
.scv .scv-dirs input { width: 100%; box-sizing: border-box; margin: 0; }
.scv .scv-dlist { max-height: 170px; overflow-y: auto; -webkit-overflow-scrolling: touch; margin-top: 4px; border-radius: 6px; }
.scv .scv-dlist button { display: flex; justify-content: space-between; gap: 8px; width: 100%; text-align: left; border: 0; border-radius: 0; margin: 0; padding: 6px 8px; font-size: 12.5px; cursor: pointer; background: transparent; color: inherit; }
.scv .scv-dlist button small { opacity: .6; flex: 0 0 auto; }
.scv .scv-src { font-size: 12.5px; margin: 0 0 4px; word-break: break-word; }
.scv .scv-src select { width: 100%; margin: 4px 0 0; }
.scv .scv-done { font-size: 14px; line-height: 1.5; }
.scv .scv-done a { font-weight: 600; }
.scv .scv-btns { display: flex; gap: 8px; margin-top: 16px; }
.scv .scv-btns button { flex: 1 1 0; }
.scv .scv-busy { opacity: .7; font-size: 13px; padding: 10px 0; }

/* app: Picker / Native - light, like their other modals */
.scv-app .basket-json-modal-content { max-width: 480px; }
.scv-app .scv-lab { color: #555; }
.scv-app .scv-src, .scv-app .scv-opt small, .scv-app .scv-name span { color: #666; }
.scv-app .scv-est b { color: #1e7e34; }
.scv-app .scv-q .scv-qv { color: #6f42c1; }
.scv-app input[type=text], .scv-app select { padding: 8px; font-size: 15px; border: 1px solid #ccc; border-radius: 6px; background: #fff; color: #222; box-sizing: border-box; }
.scv-app .scv-dlist { border: 1px solid #e3e3e8; }
.scv-app .scv-dlist button:nth-child(odd) { background: #f7f7fa; }
.scv-app .scv-dlist button.on { background: #6f42c1; color: #fff; }
.scv-app .scv-msg.bad { color: #dc3545; }
.scv-app .scv-msg.ok { color: #1e7e34; }
.scv-app .scv-warn { color: #b8860b; font-size: 12px; }
.scv-app .scv-done a { color: #6f42c1; }

/* console: the browse pages - dark, their own variables */
.scv-console .dlg { max-width: 560px; max-height: calc(100vh - 32px); overflow-y: auto; }
.scv-console .scv-lab { color: var(--dim, #6d8298); }
.scv-console .scv-src, .scv-console .scv-opt small, .scv-console .scv-name span { color: var(--dim, #6d8298); }
.scv-console .scv-est b { color: var(--green, #5bc98a); }
.scv-console .scv-q .scv-qv { color: var(--amber, #f0a500); }
.scv-console select { background: var(--ink, #0e141a); border: 1px solid var(--line, #26364a); border-radius: 3px; padding: 7px 8px; color: var(--text, #c3d1dd); }
.scv-console input[type=range] { accent-color: var(--amber, #f0a500); }
.scv-console .scv-opt input { accent-color: var(--cyan, #3ec7d4); }
.scv-console .scv-dlist { border: 1px solid var(--line, #26364a); }
.scv-console .scv-dlist button:hover { background: var(--panel-2, #1b2733); color: var(--cyan, #3ec7d4); }
.scv-console .scv-dlist button.on { color: var(--amber, #f0a500); }
.scv-console .scv-msg.bad { color: var(--red, #e2574c); }
.scv-console .scv-msg.ok { color: var(--green, #5bc98a); }
.scv-console .scv-warn { color: var(--amber, #f0a500); font-size: 12px; }
.scv-console .scv-done a { color: var(--cyan, #3ec7d4); }
`;
    document.head.appendChild(css);
  }

  // ---- the shell, in the page's own look ------------------------------------
  function shell(theme, onClose) {
    ensureCss();
    const root = document.createElement('div');
    let card;
    if (theme === 'console') {
      root.className = 'veil on scv scv-console';
      root.innerHTML = '<div class="dlg" role="dialog" aria-modal="true"></div>';
      card = root.firstChild;
      root.addEventListener('mousedown', (e) => { if (e.target === root) onClose(); });
    } else {
      root.className = 'basket-json-modal scv scv-app';
      root.style.zIndex = '2147483647';     // over FLS, as the rename modal
      root.innerHTML = '<div class="basket-json-modal-content" role="dialog" aria-modal="true"></div>';
      card = root.firstChild;
      root.addEventListener('click', (e) => { if (e.target === root) onClose(); });
    }
    document.body.appendChild(root);
    return { root, card };
  }
  const heading = (theme, text) => theme === 'console' ? `<h2>${esc(text.toUpperCase())}</h2>` : `<h3>${esc(text)}</h3>`;
  const btn = (theme, kind, label, attrs) => theme === 'console'
    ? `<button type="button" class="${kind === 'go' ? 'go' : 'ghost'}" ${attrs || ''}>${label}</button>`
    : `<button type="button" class="modal-btn ${kind === 'go' ? 'modal-btn-primary' : 'modal-btn-cancel'}" ${attrs || ''}>${label}</button>`;

  // ---- open -------------------------------------------------------------
  async function open(opts) {
    const theme = opts.theme === 'console' ? 'console' : 'app';
    const call = opts.call;
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKey, true);
      ui.root.remove();
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    const ui = shell(theme, close);
    document.addEventListener('keydown', onKey, true);
    const card = ui.card;
    card.innerHTML = heading(theme, 'Convert to MP4') + `<div class="scv-src">${esc(opts.filename || '')}</div><div class="scv-busy">Looking it up…</div>`;

    let prep;
    try {
      prep = await call('convert_prepare', { video_key: opts.videoKey, instance_id: opts.instanceId || '' });
    } catch (err) {
      if (closed) return;
      card.innerHTML = heading(theme, 'Convert to MP4') + `<p class="scv-msg bad" style="margin-left:0">${esc(err.message || err)}</p>` +
        `<div class="scv-btns">${btn(theme, 'cancel', 'Close', 'data-x')}</div>`;
      card.querySelector('[data-x]').onclick = close;
      return;
    }
    if (closed) return;
    if (!prep.copies || !prep.copies.length) {
      const why = prep.no_box === 'onedrive'
        ? 'Only files on the Hetzner box can be converted, and this one is only in OneDrive. Migrate it to the box first.'
        : 'Only files on the Hetzner box can be converted, and this one is only on your phone.';
      card.innerHTML = heading(theme, 'Convert to MP4') + `<div class="scv-src">${esc(prep.video.filename)}</div><p>${esc(why)}</p>` +
        `<div class="scv-btns">${btn(theme, 'cancel', 'Close', 'data-x')}</div>`;
      card.querySelector('[data-x]').onclick = close;
      return;
    }

    // What's been chosen.
    const st = {
      copy: prep.copies[0], q: DEFAULT_QUALITY, passes: 1,
      nameMode: 'same', custom: stripExt(prep.default_name), sug: null,
      destMode: 'same', dir: '', del: false,
      check: { name: null, taken: prep.taken, bad: null }, checking: false, busy: false
    };
    let folders = null, foldersBusy = false;
    let checkTimer = null, checkSeq = 0;

    const sizeOf = () => Number(st.copy.size) || Number(prep.video.size) || 0;
    const durOf = () => Number(st.copy.duration_ms) || Number(prep.video.duration_ms) || 0;
    const nameNow = () => st.nameMode === 'sug' && st.sug ? st.sug
                        : st.nameMode === 'custom' ? (st.custom.trim() ? st.custom.trim() + '.mp4' : '')
                        : prep.default_name;
    const sameDir = () => (st.copy.same_folder && st.copy.same_folder.dir) || '';
    const destDir = () => st.destMode === 'same' ? sameDir() : String(st.dir || '').trim().replace(/^\/+|\/+$/g, '');

    // The suggested name, when there is one and it isn't the same name.
    Promise.resolve().then(() => opts.suggest ? opts.suggest() : null).then(s => {
      const n = s ? stripExt(s).trim() : '';
      if (!n || closed) return;
      const full = n + '.mp4';
      if (full.toLowerCase() === String(prep.default_name).toLowerCase()) return;
      st.sug = full;
      paint();
    }).catch(() => {});

    function estimateHtml() {
      const size = sizeOf(), dur = durOf();
      const floor = dur ? Math.round(FLOOR_BPS * dur / 1000 / 8) : 0;
      const est = Math.min(size, Math.max(Math.round(size * st.q / 100), floor));
      const atFloor = floor && est === floor && floor > size * st.q / 100;
      const bps = dur ? est * 8 / (dur / 1000) : 0;
      const rate = bps ? ` · ≈ ${bps >= 1e6 ? (bps / 1e6).toFixed(1) + ' Mb/s' : Math.round(bps / 1e3) + ' kb/s'}` : '';
      return `≈ <b>${bytes(est)}</b> <span style="opacity:.75">(now ${bytes(size)}, −${bytes(size - est)})${rate}</span>` +
        (atFloor ? `<div class="scv-warn">That’s as small as this length goes - lower won’t make it smaller.</div>` : '');
    }
    function nameMsg() {
      if (st.check.bad) return { cls: 'bad', text: st.check.bad };
      if (st.check.taken) return { cls: 'bad', text: 'Already in the library: ' + st.check.taken };
      if (!nameNow()) return { cls: 'bad', text: 'Type a name.' };
      return { cls: '', text: '' };
    }
    function canGo() {
      const m = nameMsg();
      return !st.busy && !m.text && !st.checking && (st.destMode === 'same' || destDir() !== null);
    }

    function paint() {
      if (closed) return;
      const c = st.copy;
      const copies = prep.copies;
      const msg = nameMsg();
      const sameLabel = 'Hetzner /' + sameDir();
      card.innerHTML = heading(theme, 'Convert to MP4') +
        `<div class="scv-src">${esc(prep.video.filename)}` +
          (copies.length > 1
            ? `<select data-copy>${copies.map((x, i) => `<option value="${i}"${x === c ? ' selected' : ''}>${esc(x.where)} · ${esc(bytes(x.size))}</option>`).join('')}</select>`
            : `<br>${esc(c.where)} · ${esc(bytes(c.size))}${durOf() ? ' · ' + clock(durOf()) : ''}`) +
        `</div>` +
        (prep.active && prep.active.length
          ? `<div class="scv-warn">Already converting: ${prep.active.map(a => esc(a.out_name) + ' (' + esc(a.state) + ')').join(', ')}</div>` : '') +

        `<div class="scv-sec"><span class="scv-lab">Quality</span>` +
          `<div class="scv-q"><input type="range" min="${MIN_QUALITY}" max="100" step="5" value="${st.q}" data-q aria-label="Quality">` +
          `<span class="scv-qv" data-qv>${st.q}%</span></div>` +
          `<div class="scv-est" data-est>${estimateHtml()}</div></div>` +

        `<div class="scv-sec"><span class="scv-lab">Encoding</span>` +
          `<label class="scv-opt"><input type="radio" name="scvPass" value="1"${st.passes === 1 ? ' checked' : ''}><span><b>One pass</b><small>Quicker. The size lands within about 5–10% of the estimate.</small></span></label>` +
          `<label class="scv-opt"><input type="radio" name="scvPass" value="2"${st.passes === 2 ? ' checked' : ''}><span><b>Two passes</b><small>About twice as long. The size lands within about 1–2%.</small></span></label></div>` +

        `<div class="scv-sec"><span class="scv-lab">Name</span>` +
          `<label class="scv-opt"><input type="radio" name="scvName" value="same"${st.nameMode === 'same' ? ' checked' : ''}><span>Same name: <b>${esc(prep.default_name)}</b></span></label>` +
          (st.sug ? `<label class="scv-opt"><input type="radio" name="scvName" value="sug"${st.nameMode === 'sug' ? ' checked' : ''}><span>Suggested: <b>${esc(st.sug)}</b></span></label>` : '') +
          `<label class="scv-opt"><input type="radio" name="scvName" value="custom"${st.nameMode === 'custom' ? ' checked' : ''}><span>Your own</span></label>` +
          (st.nameMode === 'custom' ? `<div class="scv-name"><input type="text" data-custom value="${esc(st.custom)}" spellcheck="false" autocomplete="off"><span>.mp4</span></div>` : '') +
          `<div class="scv-msg ${msg.cls}" data-nmsg>${esc(st.checking ? 'Checking…' : msg.text)}</div></div>` +

        `<div class="scv-sec"><span class="scv-lab">Save to</span>` +
          `<label class="scv-opt"><input type="radio" name="scvDest" value="same"${st.destMode === 'same' ? ' checked' : ''}><span>Same folder: <b>${esc(sameLabel)}</b></span></label>` +
          `<label class="scv-opt"><input type="radio" name="scvDest" value="other"${st.destMode === 'other' ? ' checked' : ''}><span>Another box folder</span></label>` +
          (st.destMode === 'other'
            ? `<div class="scv-dirs"><input type="text" data-dir value="${esc(st.dir)}" placeholder="Search, or type a new folder (a/b)" spellcheck="false" autocomplete="off">` +
              `<div class="scv-dlist" data-dlist></div><div class="scv-msg" data-dmsg></div></div>`
            : '') +
        `</div>` +

        `<div class="scv-sec"><label class="scv-opt"><input type="checkbox" data-del${st.del ? ' checked' : ''}><span><b>Delete the original</b> once the MP4 is safely in place` +
          `<small>From the box - permanent, the box has no recycle bin. Its score, notes and bookmarks carry over: the two are linked as variants first.</small></span></label></div>` +

        `<div class="scv-btns">${btn(theme, 'cancel', 'Cancel', 'data-x')}${btn(theme, 'go', 'Convert', 'data-go' + (canGo() ? '' : ' disabled'))}</div>`;
      wire();
      if (st.destMode === 'other') paintDirs();
    }

    function wire() {
      card.querySelector('[data-x]').onclick = close;
      card.querySelector('[data-go]').onclick = go;
      const sel = card.querySelector('[data-copy]');
      if (sel) sel.onchange = () => { st.copy = prep.copies[+sel.value]; paint(); };
      const q = card.querySelector('[data-q]');
      q.oninput = () => {
        st.q = +q.value;
        card.querySelector('[data-qv]').textContent = st.q + '%';
        card.querySelector('[data-est]').innerHTML = estimateHtml();
      };
      card.querySelectorAll('input[name=scvPass]').forEach(r => { r.onchange = () => { st.passes = +r.value; }; });
      card.querySelectorAll('input[name=scvName]').forEach(r => {
        r.onchange = () => {
          st.nameMode = r.value;
          paint();
          scheduleCheck(0);
          const ci = card.querySelector('[data-custom]');
          if (ci) { ci.focus(); ci.setSelectionRange(ci.value.length, ci.value.length); }
        };
      });
      const ci = card.querySelector('[data-custom]');
      if (ci) ci.oninput = () => { st.custom = ci.value; scheduleCheck(350); };
      card.querySelectorAll('input[name=scvDest]').forEach(r => {
        r.onchange = () => {
          st.destMode = r.value;
          if (st.destMode === 'other' && !st.dir) st.dir = sameDir();
          paint();
          if (st.destMode === 'other') loadFolders();
        };
      });
      const di = card.querySelector('[data-dir]');
      if (di) di.oninput = () => { st.dir = di.value; paintDirs(); };
      const del = card.querySelector('[data-del]');
      del.onchange = () => { st.del = del.checked; };
    }

    // Only the parts that change while typing - a full repaint would take the keyboard away.
    function paintNameMsg() {
      const m = nameMsg();
      const el = card.querySelector('[data-nmsg]');
      if (el) { el.className = 'scv-msg ' + m.cls; el.textContent = st.checking ? 'Checking…' : m.text; }
      const g = card.querySelector('[data-go]');
      if (g) g.disabled = !canGo();
    }
    function scheduleCheck(ms) {
      clearTimeout(checkTimer);
      st.checking = true;
      paintNameMsg();
      checkTimer = setTimeout(async () => {
        const seq = ++checkSeq;
        const name = nameNow();
        if (!name) { st.checking = false; st.check = { name: '', taken: null, bad: null }; paintNameMsg(); return; }
        try {
          const r = await call('convert_check', { name });
          if (seq !== checkSeq || closed) return;
          st.check = { name: r.name, taken: r.taken, bad: r.bad };
        } catch (err) {
          if (seq !== checkSeq || closed) return;
          st.check = { name, taken: null, bad: null };     // the server checks again on Convert
        }
        st.checking = false;
        paintNameMsg();
      }, ms);
    }

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
        };
      });
      const known = folders.some(f => f.path.toLowerCase() === typed.toLowerCase());
      if (msg) {
        msg.className = 'scv-msg ' + (typed && !known ? 'ok' : '');
        msg.textContent = typed && !known ? 'New folder - it’s made when the MP4 arrives: /' + typed : (typed ? 'Into /' + typed : 'Into the top of the box');
      }
    }

    async function go() {
      if (!canGo()) return;
      st.busy = true;
      const g = card.querySelector('[data-go]');
      if (g) { g.disabled = true; g.textContent = 'Queueing…'; }
      try {
        const r = await call('convert_start', {
          video_key: prep.video.video_key, instance_id: st.copy.instance_id, quality: st.q, passes: st.passes,
          name: nameNow(), dest: st.destMode === 'same' ? { kind: 'same' } : { kind: 'hetzner', dir: destDir() },
          delete_src: st.del, by: opts.by || ''
        });
        if (closed) return;
        const j = r.job;
        const url = opts.monitorUrl || 'converter.html';
        card.innerHTML = heading(theme, 'Convert to MP4') +
          `<div class="scv-done">Queued as <b>#${j.id}</b>: <b>${esc(j.out_name)}</b>, about ${esc(bytes(j.est_bytes))}, into ${esc(j.dest)}.<br>` +
          `It runs on the gateway - you can close this and carry on. ` +
          `<a href="${esc(url)}" target="_blank" rel="noopener">Watch it on Converter ↗</a></div>` +
          `<div class="scv-btns">${btn(theme, 'go', 'Done', 'data-x')}</div>`;
        card.querySelector('[data-x]').onclick = close;
        if (typeof opts.onQueued === 'function') { try { opts.onQueued(j); } catch (e) { /* the page's business */ } }
      } catch (err) {
        st.busy = false;
        if (closed) return;
        st.check.bad = err.message || String(err);
        paint();
      }
    }

    paint();
  }

  // ---- Picker / Native ------------------------------------------------------
  /** Whether the menu offers Convert for this row: box files only (Mac, 3 Oct) - OneDrive and phone files can't be. */
  function appAvailability(video) {
    const hz = typeof window.scrayIsHetznerVideo === 'function' && !!window.scrayIsHetznerVideo(video);
    return hz ? { ok: true, why: '' } : { ok: false, why: 'only files on the Hetzner box can be converted' };
  }
  function appMonitorUrl() {
    try { return new URL('converter.html', (window.SCRAY_SYNC && window.SCRAY_SYNC.API_BASE) || location.href).toString(); }
    catch (e) { return 'converter.html'; }
  }
  function forApp(video) {
    if (!video) return;
    const key = video.videoKey || (window.scrayVideoKey ? window.scrayVideoKey(video.filename || '') : String(video.filename || '').toLowerCase());
    return open({
      videoKey: key, filename: video.filename, theme: 'app',
      by: window.ScrayBridge ? 'native' : 'picker',
      call: (action, body) => window.scrayApiCall(action, { method: 'POST', body }),
      suggest: async () => {
        try { return typeof window.scrayCleanNameSuggestion === 'function' ? window.scrayCleanNameSuggestion(video) : null; }
        catch (e) { return null; }
      },
      monitorUrl: appMonitorUrl()
    });
  }

  window.scrayConvert = { open, forApp, appAvailability };
})();

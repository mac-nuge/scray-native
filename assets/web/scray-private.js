// scray-private.js - 🔒 private folders (picker 15.62 / native 15.73, needs
// browse 15.101's private_get / private_unlock / private_save).
// Identical in Picker and Native.
//
// Folders you choose are hidden everywhere in the app - lists, search, tags,
// random, history, basket, the Stash hunt - until the PIN is entered, and
// hidden again every time the app opens (and after it has sat in the
// background for a while). It keeps them from someone who picks up the device;
// it is not encryption, and the files are exactly where they were.
//
// How: window.getAllVideos, which everything that lists videos reads, leaves
// out any video whose folder is private while locked. window.getAllVideosRaw
// is the untouched one. hides(video) / hidesPath(folder) are for the few
// places that keep their own lists (history, basket, the hunt's recent list,
// the Stash navigator's In library links).
//
// One PIN for everything, kept hashed on the server. The folder list is cached
// on the device so the first paint already leaves them out.
//
// Settings ▸ 🔒 Private folders: Unlock / Lock, and Manage (add and remove
// folders, change the PIN) once unlocked. The first time: choose a PIN.
(function () {
  'use strict';

  // ⚙️ Locks again after the app has been in the background this long.
  const BACKGROUND_LOCK_MS = 5 * 60 * 1000;
  const LS = 'scray.private.folders.v1';

  const api = (action, body) => window.scrayApiCall(action, { method: 'POST', body: body || {} });
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const low = (s) => String(s ?? '').normalize('NFC').toLowerCase();
  const clean = (p) => String(p ?? '').replace(/\\/g, '/').replace(/^\*+/, '').replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '').trim();

  let folders = [];
  try { folders = (JSON.parse(localStorage.getItem(LS) || '[]') || []).map(String); } catch (e) { folders = []; }
  let rules = folders.map(f => low(clean(f))).filter(Boolean);
  let hasPin = null;
  let unlocked = false;
  let pinNow = '';          // the PIN entered this time, for saving changes; memory only
  let hiddenAt = 0;

  function setFolders(list) {
    folders = (list || []).map(f => clean(f)).filter(Boolean);
    rules = folders.map(f => low(f));
    try { localStorage.setItem(LS, JSON.stringify(folders)); } catch (e) { /* the server has it */ }
  }

  /** A video's folder, as the lists show it ("A/B"). */
  function folderOf(v) {
    if (!v) return '';
    try {
      if (typeof window.scrayResolvePathParts === 'function') return window.scrayResolvePathParts(v).catalogue.join('/');
    } catch (e) { /* the plain path will do */ }
    return clean(v.path);
  }
  function inRules(path) {
    const f = low(clean(path));
    return !!f && rules.some(r => f === r || f.startsWith(r + '/'));
  }
  /** Hidden right now: a private folder (or one below it), and locked. */
  function hidesPath(path) { return !unlocked && rules.length > 0 && inRules(path); }
  function hides(v) {
    if (unlocked || !rules.length || !v) return false;
    return inRules(folderOf(v)) || (typeof v.cataloguePath === 'string' && inRules(v.cataloguePath));
  }

  // ---- every list's source ----------------------------------------------------
  const real = window.getAllVideos;
  if (typeof real === 'function') {
    window.getAllVideosRaw = real;
    window.getAllVideos = async function () {
      const all = await real.apply(this, arguments);
      return (unlocked || !rules.length) ? all : (all || []).filter(v => !hides(v));
    };
  } else {
    console.warn('[private] getAllVideos not found - load scray-private.js after db.js');
  }

  /** Every list drawn again, from the (now) filtered source. */
  async function repaint() {
    try {
      if (Array.isArray(window.allVideos) && typeof window.getAllVideos === 'function') window.allVideos = await window.getAllVideos();
    } catch (e) { /* lists read the source themselves */ }
    try { if (typeof window.populateTagDropdowns === 'function') await window.populateTagDropdowns(); } catch (e) { console.warn('[private] tags:', e); }
    try { if (typeof window.refreshAllLists === 'function') window.refreshAllLists(); } catch (e) { console.warn('[private] lists:', e); }
    paintRow();
  }

  function lock(why) {
    const was = unlocked;
    unlocked = false;
    pinNow = '';
    if (!was) return;
    // Nothing private left playing or open.
    try {
      const cur = window.currentPlayingVideo;
      if (cur && hides(cur) && window.inlineVideoPlayer && typeof window.inlineVideoPlayer.stop === 'function') window.inlineVideoPlayer.stop();
    } catch (e) { /* nothing playing */ }
    try { if (window.scrayStashHunt && window.scrayStashHunt.isActive && window.scrayStashHunt.isActive()) window.scrayStashHunt.stop(); } catch (e) { /* no hunt */ }
    try { if (window.scrayStashNav && window.scrayStashNav.endPreview) window.scrayStashNav.endPreview(); } catch (e) { /* no preview */ }
    repaint();
    if (why) toast('🔒 ' + why);
  }

  // The folder list, fresh from the server (another device may have changed it).
  async function sync() {
    try {
      const r = await api('private_get');
      hasPin = !!r.has_pin;
      const before = JSON.stringify(rules);
      setFolders(r.folders || []);
      if (JSON.stringify(rules) !== before) repaint(); else paintRow();
    } catch (e) { /* offline: the cached list stands */ }
  }

  // Back from the background after a while: locked again.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    if (unlocked && hiddenAt && Date.now() - hiddenAt >= BACKGROUND_LOCK_MS) lock('Private folders locked again');
    hiddenAt = 0;
  });

  // ---- UI ---------------------------------------------------------------------
  function toast(msg) {
    const t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;left:50%;bottom:calc(env(safe-area-inset-bottom,0px) + 110px);transform:translateX(-50%);' +
      'background:#333;color:#fff;padding:9px 14px;border-radius:8px;font-size:.85rem;z-index:2147483647;max-width:88vw;text-align:center;';
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }

  function sheet(html) {
    const o = document.createElement('div');
    o.className = 'scray-private';
    o.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;' +
      'padding:calc(env(safe-area-inset-top,0px) + 16px) 14px calc(env(safe-area-inset-bottom,0px) + 90px);box-sizing:border-box;z-index:2147483647;';
    o.innerHTML = '<div class="sp-box">' + html + '</div>';
    document.body.appendChild(o);
    return o;
  }
  function ensureCss() {
    if (document.getElementById('scrayPrivateCss')) return;
    const css = document.createElement('style');
    css.id = 'scrayPrivateCss';
    css.textContent = `
.scray-private .sp-box { background:#1e1e1e; color:#fff; border-radius:10px; padding:18px; width:100%; max-width:440px; max-height:100%;
  box-sizing:border-box; display:flex; flex-direction:column; gap:10px; overflow:hidden; text-align:left; font-size:.9rem; }
.scray-private h3 { margin:0; font-size:1.05rem; }
.scray-private .sp-note { font-size:.78rem; color:#aaa; line-height:1.35; }
.scray-private .sp-err { font-size:.8rem; color:#ff6b6b; min-height:1em; }
.scray-private input { width:100%; box-sizing:border-box; margin:0; padding:10px; background:#2a2a2a; color:#fff; border:1px solid #555;
  border-radius:6px; font-size:16px; }
.scray-private input.sp-pin { letter-spacing:.35em; text-align:center; font-size:20px; }
.scray-private button { width:auto; margin:0; padding:9px 14px; border:none; border-radius:6px; font-size:.9rem; background:#444; color:#fff; cursor:pointer; }
.scray-private button.go { background:#6f42c1; font-weight:700; }
.scray-private button.red { background:#8b2332; }
.scray-private .sp-row { display:flex; gap:8px; justify-content:flex-end; flex-wrap:wrap; }
.scray-private .sp-list { flex:1 1 auto; min-height:60px; overflow-y:auto; border:1px solid #333; border-radius:6px; }
.scray-private .sp-it { display:flex; align-items:center; gap:8px; padding:8px 10px; border-bottom:1px solid #2c2c2c; cursor:pointer; }
.scray-private .sp-it:last-child { border-bottom:none; }
.scray-private .sp-it .n { flex:1 1 auto; min-width:0; overflow-wrap:anywhere; }
.scray-private .sp-it small { color:#999; flex:0 0 auto; }
.scray-private .sp-it.on { background:#2d2440; }
.scray-private .sp-it .x { color:#ff8a8a; font-weight:700; }
.scray-private .sp-h { font-size:.72rem; letter-spacing:.06em; text-transform:uppercase; color:#999; margin-top:4px; }
`;
    document.head.appendChild(css);
  }

  /** Ask for the PIN; resolves true once unlocked. */
  function askPin() {
    ensureCss();
    return new Promise(resolve => {
      const o = sheet(
        '<h3>🔒 Private folders</h3>' +
        '<div class="sp-note">Enter the PIN to show them.</div>' +
        '<input class="sp-pin" type="password" inputmode="numeric" autocomplete="off" maxlength="12">' +
        '<div class="sp-err"></div>' +
        '<div class="sp-row"><button type="button" data-a="no">Cancel</button><button type="button" class="go" data-a="go">Unlock</button></div>');
      const inp = o.querySelector('input'), err = o.querySelector('.sp-err');
      const done = (v) => { o.remove(); resolve(v); };
      const go = async () => {
        const pin = inp.value.trim();
        if (!pin) { inp.focus(); return; }
        err.textContent = 'Checking…';
        try {
          const r = await api('private_unlock', { pin });
          setFolders(r.folders || folders);
          unlocked = true;
          pinNow = pin;
          done(true);
          repaint();
          toast('🔓 Private folders shown until the app is closed');
        } catch (e) {
          err.textContent = /403|wrong/i.test(e.message || '') ? 'Wrong PIN' : (e.message || String(e));
          inp.value = '';
          inp.focus();
        }
      };
      o.addEventListener('click', (e) => {
        if (e.target === o) return done(false);
        const b = e.target.closest('button[data-a]');
        if (!b) return;
        if (b.dataset.a === 'go') go(); else done(false);
      });
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
      setTimeout(() => inp.focus(), 50);
    });
  }

  /** First time: choose a PIN (twice). */
  function setupPin() {
    ensureCss();
    return new Promise(resolve => {
      const o = sheet(
        '<h3>🔒 Set up private folders</h3>' +
        '<div class="sp-note">Choose a PIN (4 to 12 digits). It\'s the same on every device and page. Folders you make private are hidden until it\'s entered, and hidden again each time the app opens. This keeps them from someone who picks up the device - it isn\'t encryption.</div>' +
        '<input class="sp-pin" data-p="1" type="password" inputmode="numeric" autocomplete="off" maxlength="12" placeholder="PIN">' +
        '<input class="sp-pin" data-p="2" type="password" inputmode="numeric" autocomplete="off" maxlength="12" placeholder="again">' +
        '<div class="sp-err"></div>' +
        '<div class="sp-row"><button type="button" data-a="no">Cancel</button><button type="button" class="go" data-a="go">Set PIN</button></div>');
      const [a, b] = o.querySelectorAll('input');
      const err = o.querySelector('.sp-err');
      const done = (v) => { o.remove(); resolve(v); };
      const go = async () => {
        const p1 = a.value.trim(), p2 = b.value.trim();
        if (!/^\d{4,12}$/.test(p1)) { err.textContent = 'The PIN must be 4 to 12 digits'; a.focus(); return; }
        if (p1 !== p2) { err.textContent = 'The two don\'t match'; b.value = ''; b.focus(); return; }
        err.textContent = 'Saving…';
        try {
          const r = await api('private_save', { new_pin: p1, device: deviceName() });
          hasPin = true;
          setFolders(r.folders || []);
          unlocked = true;
          pinNow = p1;
          done(true);
        } catch (e) { err.textContent = e.message || String(e); }
      };
      o.addEventListener('click', (e) => {
        if (e.target === o) return done(false);
        const bt = e.target.closest('button[data-a]');
        if (!bt) return;
        if (bt.dataset.a === 'go') go(); else done(false);
      });
      b.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
      setTimeout(() => a.focus(), 50);
    });
  }

  const deviceName = () => (window.SCRAY_SYNC && window.SCRAY_SYNC.DEVICE_ID) || (window.SCRAY_DEVICE_NAME || 'app');

  /** Add and remove folders, change the PIN. Needs unlocking first. */
  async function manage() {
    if (hasPin === null) await sync();
    if (!hasPin) { if (!(await setupPin())) return; }
    else if (!unlocked || !pinNow) { if (!(await askPin())) return; }
    ensureCss();
    // Every folder the library has, with how many videos are in it or below.
    const counts = new Map();
    try {
      const all = await (window.getAllVideosRaw || window.getAllVideos)();
      (all || []).forEach(v => {
        const segs = folderOf(v).split('/').filter(Boolean);
        for (let i = 1; i <= segs.length; i++) {
          const p = segs.slice(0, i).join('/');
          counts.set(p, (counts.get(p) || 0) + 1);
        }
      });
    } catch (e) { /* the list can still be typed into */ }
    let picks = folders.slice();
    let term = '';
    const o = sheet(
      '<h3>🔒 Private folders</h3>' +
      '<div class="sp-note">Hidden everywhere in Picker, Native and the Scray pages until the PIN is entered. A folder hides everything below it too.</div>' +
      '<div class="sp-h">Private now</div><div class="sp-list sp-cur" style="flex:0 1 auto;max-height:22vh;"></div>' +
      '<div class="sp-h">Add a folder</div>' +
      '<input class="sp-find" type="search" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="Search your folders…">' +
      '<div class="sp-list sp-all"></div>' +
      '<details style="font-size:.85rem;"><summary style="cursor:pointer;color:#bbb;">Change the PIN</summary>' +
        '<input class="sp-pin sp-new" type="password" inputmode="numeric" autocomplete="off" maxlength="12" placeholder="new PIN" style="margin-top:8px;"></details>' +
      '<div class="sp-err"></div>' +
      '<div class="sp-row"><button type="button" data-a="no">Cancel</button><button type="button" class="go" data-a="save">Save</button></div>');
    const cur = o.querySelector('.sp-cur'), allEl = o.querySelector('.sp-all'), find = o.querySelector('.sp-find');
    const err = o.querySelector('.sp-err');
    const isOn = (p) => picks.some(x => low(x) === low(p));
    const paint = () => {
      cur.innerHTML = picks.length
        ? picks.map((p, i) => '<div class="sp-it" data-rm="' + i + '"><span>📁</span><span class="n">' + esc(p) + '</span>' +
            '<small>' + (counts.get(p) != null ? counts.get(p) + ' videos' : '') + '</small><span class="x">✕</span></div>').join('')
        : '<div class="sp-it" style="cursor:default;color:#888;">None yet - pick folders below</div>';
      const words = low(term).split(/\s+/).filter(Boolean);
      const hits = [...counts.keys()]
        .filter(p => words.every(w => low(p).includes(w)))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
        .slice(0, 300);
      allEl.innerHTML = hits.length
        ? hits.map(p => '<div class="sp-it' + (isOn(p) ? ' on' : '') + '" data-add="' + esc(p) + '"><span>' + (isOn(p) ? '🔒' : '📁') + '</span>' +
            '<span class="n">' + esc(p) + '</span><small>' + counts.get(p) + '</small></div>').join('')
        : '<div class="sp-it" style="cursor:default;color:#888;">' + (counts.size ? 'No folder matches' : 'No folders found') + '</div>';
    };
    paint();
    find.addEventListener('input', () => { term = find.value; paint(); });
    o.addEventListener('click', async (e) => {
      if (e.target === o) { o.remove(); return; }
      const rm = e.target.closest('[data-rm]');
      if (rm) { picks.splice(+rm.dataset.rm, 1); paint(); return; }
      const add = e.target.closest('[data-add]');
      if (add) {
        const p = add.dataset.add;
        picks = isOn(p) ? picks.filter(x => low(x) !== low(p)) : picks.concat([p]);
        paint();
        return;
      }
      const b = e.target.closest('button[data-a]');
      if (!b) return;
      if (b.dataset.a === 'no') { o.remove(); return; }
      const np = o.querySelector('.sp-new').value.trim();
      if (np && !/^\d{4,12}$/.test(np)) { err.textContent = 'The new PIN must be 4 to 12 digits'; return; }
      err.textContent = 'Saving…';
      b.disabled = true;
      try {
        const body = { pin: pinNow, folders: picks, device: deviceName() };
        if (np) body.new_pin = np;
        const r = await api('private_save', body);
        setFolders(r.folders || picks);
        if (np) pinNow = np;
        o.remove();
        repaint();
        toast(folders.length ? '🔒 ' + folders.length + ' private folder' + (folders.length === 1 ? '' : 's') + ' - hidden when locked' : 'No private folders');
      } catch (e2) {
        b.disabled = false;
        err.textContent = e2.message || String(e2);
      }
    });
  }

  // ---- Settings ▸ 🔒 Private folders --------------------------------------------
  let rowEl = null;
  function paintRow() {
    if (!rowEl || !rowEl.isConnected) return;
    const st = rowEl.querySelector('.sp-st'), ub = rowEl.querySelector('[data-a="lock"]');
    st.textContent = hasPin === false ? 'Not set up yet'
      : unlocked ? '🔓 Shown until the app is closed'
      : '🔒 Locked';
    ub.textContent = unlocked ? 'Lock' : 'Unlock';
    ub.style.display = hasPin === false ? 'none' : '';
    rowEl.querySelector('[data-a="manage"]').textContent = hasPin === false ? 'Set up…' : 'Manage…';
  }
  function register() {
    if (!window.scraySettings || typeof window.scraySettings.register !== 'function') return false;
    window.scraySettings.register({
      id: 'privateFolders',
      label: '🔒 Private folders',
      hint: 'Folders hidden everywhere until the PIN is entered',
      type: 'custom',
      build() {
        ensureCss();
        const el = document.createElement('div');
        el.className = 'scray-private';
        el.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;position:static;background:none;padding:0;';
        el.innerHTML = '<span class="sp-st" style="flex:1 1 auto;font-size:.85rem;color:#ccc;"></span>' +
          '<button type="button" data-a="lock">Unlock</button><button type="button" class="go" data-a="manage">Manage…</button>';
        rowEl = el;
        el.addEventListener('click', async (e) => {
          const b = e.target.closest('button[data-a]');
          if (!b) return;
          e.preventDefault();
          if (b.dataset.a === 'lock') { if (unlocked) lock('Private folders hidden'); else await askPin(); }
          else await manage();
          paintRow();
        });
        paintRow();
        if (hasPin === null) sync();
        return { el, value: () => '' };
      },
      get: () => '',
      set: () => {}
    });
    return true;
  }
  if (!register()) document.addEventListener('DOMContentLoaded', register);

  // Fresh list once the app is up (scrayApiCall comes with the config).
  let tries = 0;
  const start = () => { if (typeof window.scrayApiCall === 'function') sync(); else if (++tries < 40) setTimeout(start, 1500); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(start, 800));
  else setTimeout(start, 800);

  window.scrayPrivate = {
    hides, hidesPath, folderOf,
    isUnlocked: () => unlocked,
    folders: () => folders.slice(),
    unlock: askPin, lock: () => lock(''), manage,
    _test: { setFolders, setUnlocked: (v) => { unlocked = !!v; } }
  };
})();

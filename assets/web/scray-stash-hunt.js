// scray-stash-hunt.js — 🎯 Stash hunt (picker 15.23 / native 15.32, needs
// browse 15.80's stash_hunt_get / stash_hunt_never).
// Identical in Picker and Native.
//
// Finds more Stash matches, one random unmatched file at a time. Each file
// opens in the ordinary Stash modal, straight onto a navigator search for its
// filename - so the refine box, the path-tag and studio-name pills, de-Camel,
// performer and studio views, ▶ preview (the app's own player, TinEye in its
// ... menu), pasting a URL and entering details by hand all work exactly as
// they do anywhere else. This file only adds:
//   - a bar under the modal's heading: the file, the scope and what's left,
//     this run's score, and ▶ Preview / Same folder / Same tag / Never / Next;
//   - the pool: every file the app has that isn't matched, isn't on the never
//     list and hasn't come up already this run, narrowed by the scope;
//   - the scope sheet: pick folders and tags (any folder AND any tag), and
//     the never list, where a hidden file can be put back.
//
// Next moves on (the file can come up again another time). Never hides it for
// good - kept on the server so Picker and Native agree.
//
// Hooks in showStashModal (file-operations.js): openOpts.hunt, or
// optsFor(video) when the modal is reopened for the hunt's file some other way
// (TinEye's Search, say). The handle is { mount(modal), loaded(matched, modal),
// closed(modal) }.
//
// Started from 🎯 Stash hunt on the Stash button's home view, or
// window.scrayStashHunt.start(); in Picker also ?hunt=1.
(function () {
  'use strict';

  const esc = (s) => String(s ?? '').replace(/[&<>"]/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const api = (action, opts) => window.scrayApiCall(action, opts || {});
  const LS_SCOPE = 'scray.huntScope';
  const ROW_CAP = 400;   // ⚙️ rows drawn per sheet tab before "type to narrow"

  // ---- small helpers -------------------------------------------------------
  const lower = (s) => String(s ?? '').normalize('NFC').trim().toLowerCase();
  function keyOf(v) {
    if (!v) return '';
    if (v.videoKey) return v.videoKey;
    return typeof window.scrayVideoKey === 'function'
      ? window.scrayVideoKey(v.filename || '')
      : lower(v.filename);
  }
  /** Catalogue folder (Native) or path (Picker), without the leading *. */
  function folderOf(v) {
    let parts;
    if (typeof window.scrayResolvePathParts === 'function') {
      parts = window.scrayResolvePathParts(v).catalogue;
    } else {
      const p = (v && v.path) || '';
      parts = (p.startsWith('*') ? p.slice(1) : p).split('/').filter(Boolean);
    }
    return parts.join('/');
  }
  function tagsOf(v) {
    const seen = new Set(), out = [];
    ((v && v.tags) || []).forEach(t => {
      const s = String(t ?? '').trim();
      const k = s.toLowerCase();
      if (!s || seen.has(k) || k === 'yet-to-upload') return;
      seen.add(k);
      out.push(s);
    });
    return out;
  }
  const lastSeg = (p) => p ? p.split('/').pop() : '';
  const plural = (n, w) => n.toLocaleString() + ' ' + w + (n === 1 ? '' : 's');
  function toast(msg, colour) {
    const f = window.showScoreConfirmation;
    if (typeof f === 'function') { try { f(msg, colour); return; } catch (e) { /* fall through */ } }
    console.log('[hunt]', msg);
  }
  const matchedNow = (v) => typeof window.scrayHasStashMatch === 'function' && window.scrayHasStashMatch(v);

  function loadScope() {
    try {
      const j = JSON.parse(localStorage.getItem(LS_SCOPE) || 'null');
      if (j && Array.isArray(j.folders) && Array.isArray(j.tags)) {
        return { folders: j.folders.filter(x => typeof x === 'string'), tags: j.tags.filter(x => typeof x === 'string') };
      }
    } catch (e) { /* no saved scope */ }
    return { folders: [], tags: [] };
  }
  function saveScope(sc) {
    try { localStorage.setItem(LS_SCOPE, JSON.stringify(sc)); } catch (e) { /* this run only */ }
  }

  /** Any chosen folder (or one under it) AND any chosen tag. Empty = no limit. */
  function inScope(v, sc) {
    if (sc.folders.length) {
      const f = lower(v.__huntFolder);
      if (!sc.folders.some(p => { const q = lower(p); return f === q || f.startsWith(q + '/'); })) return false;
    }
    if (sc.tags.length) {
      const want = new Set(sc.tags.map(lower));
      if (!v.__huntTags.some(t => want.has(lower(t)))) return false;
    }
    return true;
  }
  function scopeLabel(sc) {
    if (!sc.folders.length && !sc.tags.length) return 'All files';
    const bits = [];
    if (sc.folders.length === 1) bits.push('📁 ' + lastSeg(sc.folders[0]));
    else if (sc.folders.length) bits.push('📁 ' + sc.folders.length + ' folders');
    if (sc.tags.length === 1) bits.push('🏷 ' + sc.tags[0]);
    else if (sc.tags.length) bits.push('🏷 ' + sc.tags.length + ' tags');
    return bits.join(' · ');
  }

  // ---- session ---------------------------------------------------------------
  let S = null;        // the run in progress
  let starting = false;

  function newSession() {
    return {
      scope: loadScope(),
      pool: [],                 // unmatched, not never - scope is applied when picking
      never: new Map(),         // key -> { key, name, at }
      neverLoaded: false,
      seen: new Set(),          // keys already offered this run
      cur: null,                // { video, key, matched, auto, loaded }
      stats: { matched: 0, skipped: 0, never: 0, streak: 0, best: 0 },
      modal: null,
      bar: null,
      tagMenu: false
    };
  }

  async function loadNever() {
    try {
      const r = await api('stash_hunt_get');
      S.never = new Map((r.items || []).map(it => [it.key, it]));
      S.neverLoaded = true;
    } catch (err) {
      console.warn('[hunt] never list unavailable:', err && err.message);
      toast('⚠️ Couldn’t load the never list - hidden files may come up', '#b8860b');
    }
  }

  async function buildPool() {
    if (typeof window.scrayLoadStashState === 'function') {
      try { await window.scrayLoadStashState(false); } catch (e) { /* the cached set will do */ }
    }
    const all = typeof window.getAllVideos === 'function' ? await window.getAllVideos() : [];
    const seen = new Set();
    const pool = [];
    (all || []).forEach(v => {
      if (!v || !v.filename) return;
      if (v.inCatalogue === false) return;     // phone-only: no catalogue row to match onto
      const k = keyOf(v);
      if (!k || seen.has(k)) return;
      seen.add(k);
      if (matchedNow(v) || S.never.has(k)) return;
      v.__huntFolder = folderOf(v);
      v.__huntTags = tagsOf(v);
      pool.push(v);
    });
    S.pool = pool;
  }

  const inScopeLeft = () => S.pool.filter(v => inScope(v, S.scope) && !S.seen.has(keyOf(v)) && !matchedNow(v));
  const inScopeAll  = () => S.pool.filter(v => inScope(v, S.scope) && !matchedNow(v));

  // ---- moving on -----------------------------------------------------------
  function endPreview() {
    try { if (window.scrayStashNav) window.scrayStashNav.endPreview(); } catch (e) { /* none open */ }
  }

  function advance() {
    if (!S) return;
    endPreview();
    const left = inScopeLeft();
    if (!left.length) {
      const all = inScopeAll();
      openSheet({
        note: all.length
          ? 'You’ve been through all ' + plural(all.length, 'file') + ' in this scope this run. ' +
            '<button type="button" data-sh="again">Go round again</button> or pick another scope.'
          : 'Nothing unmatched left in this scope. Pick another one.'
      });
      return;
    }
    const v = left[Math.floor(Math.random() * left.length)];
    const k = keyOf(v);
    S.seen.add(k);
    S.cur = { video: v, key: k, matched: false, auto: false, loaded: false };
    S.tagMenu = false;
    const words = window.scrayStashNav ? window.scrayStashNav.words(v.filename || '') : String(v.filename || '');
    window.showStashModal(v, { search: words, hunt: handle });
  }

  function next() {
    if (!S || !S.cur) return advance();
    if (!S.cur.matched) { S.stats.skipped++; S.stats.streak = 0; }
    advance();
  }

  async function never() {
    if (!S || !S.cur) return;
    const cur = S.cur;
    const item = { key: cur.key, name: cur.video.filename || cur.key, at: new Date().toISOString() };
    S.never.set(cur.key, item);
    S.pool = S.pool.filter(v => keyOf(v) !== cur.key);
    S.stats.never++;
    S.stats.streak = 0;
    const device = window.SCRAY_SYNC && window.SCRAY_SYNC.DEVICE_ID;
    api('stash_hunt_never', { method: 'POST', body: { add: [{ key: item.key, name: item.name }], device } })
      .then(() => toast('🚫 Won’t come up again - undo under the scope’s Hidden tab'))
      .catch(err => {
        S && S.never.delete(cur.key);
        toast('⚠️ Couldn’t save Never: ' + (err.message || err), '#dc3545');
      });
    advance();
  }

  async function unNever(key) {
    const device = window.SCRAY_SYNC && window.SCRAY_SYNC.DEVICE_ID;
    try {
      const r = await api('stash_hunt_never', { method: 'POST', body: { remove: [key], device } });
      if (S) {
        S.never = new Map((r.items || []).map(it => [it.key, it]));
        await buildPool();
      }
      toast('↩︎ Back in the hunt');
    } catch (err) {
      toast('⚠️ Couldn’t undo: ' + (err.message || err), '#dc3545');
    }
  }

  function setScope(sc, why) {
    S.scope = { folders: sc.folders.slice(), tags: sc.tags.slice() };
    saveScope(S.scope);
    paintBar();
    if (why) toast('🎯 ' + why + ' - ' + plural(inScopeLeft().length, 'file') + ' to go');
  }

  // ---- the bar in the Stash modal -------------------------------------------
  function ensureCss() {
    if (document.getElementById('scrayStashHuntCss')) return;
    const css = document.createElement('style');
    css.id = 'scrayStashHuntCss';
    css.textContent = `
#stashModal .sh-bar { flex: 0 0 auto; margin: -4px 0 10px; padding: 8px; border-radius: 10px; background: linear-gradient(135deg, #f3efff, #eaf3ff); border: 1px solid #d9d0fb; font-size: .8rem; text-align: left; color: #222; }
#stashModal .sh-bar.sh-won { background: linear-gradient(135deg, #e6f8ea, #eefbe9); border-color: #9bd8a8; }
#stashModal .sh-bar button { width: auto; min-width: 0; margin: 0; padding: 6px 10px; font-size: .8rem; line-height: 1.2; border: 1px solid #ccc; border-radius: 7px; background: #fff; color: #222; cursor: pointer; white-space: nowrap; }
#stashModal .sh-top { display: flex; align-items: center; gap: 6px; }
#stashModal .sh-bar .sh-scope { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; text-align: left; border-color: #cbbef5; color: #5b3fd1; font-weight: 600; }
#stashModal .sh-stats { flex: 0 0 auto; font-size: .74rem; color: #555; white-space: nowrap; }
#stashModal .sh-file { margin: 6px 2px; font-size: .78rem; color: #444; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; word-break: break-word; }
#stashModal .sh-file .sh-dir { color: #888; }
#stashModal .sh-won-line { margin: 2px 2px 6px; font-weight: 700; color: #1e7e34; font-size: .85rem; }
#stashModal .sh-acts { display: flex; gap: 5px; }
#stashModal .sh-acts button { flex: 1 1 0; padding: 7px 3px; font-size: .78rem; }
#stashModal .sh-acts button[data-h="play"] { flex: 0 0 38px; }
#stashModal .sh-bar .sh-next { flex: 1.4 1 0; background: #6f42c1; border-color: #6f42c1; color: #fff; font-weight: 700; }
#stashModal .sh-bar.sh-won .sh-next { background: #28a745; border-color: #28a745; }
#stashModal .sh-bar button.sh-on { background: #6f42c1; border-color: #6f42c1; color: #fff; }
#stashModal .sh-tags { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 7px; }
#stashModal .sh-tags button { padding: 3px 9px; border-radius: 12px; border-color: #b9d4f5; background: #eaf3ff; color: #0b5ed7; font-size: .76rem; }
#stashModal .sh-tags .sh-none { color: #888; font-size: .76rem; }
#stashHuntSheet { position: fixed; inset: 0; z-index: 2147483647; background: rgba(0,0,0,.45); display: flex; align-items: flex-end; justify-content: center; }
#stashHuntSheet .shs { width: 100%; max-width: 640px; max-height: 88vh; max-height: 88dvh; display: flex; flex-direction: column; background: #fff; color: #222; border-radius: 14px 14px 0 0; padding: 12px 12px calc(12px + env(safe-area-inset-bottom, 0px)); box-sizing: border-box; font-size: .88rem; text-align: left; }
@media (min-width: 700px) { #stashHuntSheet { align-items: center; } #stashHuntSheet .shs { border-radius: 14px; max-height: 80vh; } }
#stashHuntSheet button { width: auto; min-width: 0; margin: 0; padding: 7px 12px; font-size: .82rem; line-height: 1.2; border: 1px solid #ccc; border-radius: 7px; background: #f4f4f6; color: #222; cursor: pointer; white-space: nowrap; }
#stashHuntSheet h3 { margin: 0 0 8px; font-size: 1.05rem; }
#stashHuntSheet .shs-note { margin: 0 0 8px; padding: 8px 10px; border-radius: 8px; background: #fff7e0; border-left: 3px solid #e0a800; font-size: .82rem; }
#stashHuntSheet .shs-note button { padding: 3px 9px; font-size: .78rem; }
#stashHuntSheet .shs-tabs { display: flex; gap: 6px; margin-bottom: 8px; }
#stashHuntSheet .shs-tabs button { flex: 1 1 0; }
#stashHuntSheet .shs-tabs button.on { background: #6f42c1; border-color: #6f42c1; color: #fff; }
#stashHuntSheet input.shs-find { display: block; width: 100%; box-sizing: border-box; margin: 0 0 8px; padding: 8px 10px; font-size: 15px; border: 1px solid #ccc; border-radius: 8px; background: #fff; color: inherit; -webkit-appearance: none; appearance: none; }
#stashHuntSheet .shs-list { flex: 1 1 auto; min-height: 120px; overflow-y: auto; -webkit-overflow-scrolling: touch; border: 1px solid #eee; border-radius: 8px; }
#stashHuntSheet label.shs-row { display: flex; align-items: center; gap: 8px; padding: 9px 10px; border-bottom: 1px solid #f0f0f0; cursor: pointer; }
#stashHuntSheet label.shs-row input { width: 18px; height: 18px; margin: 0; flex: 0 0 auto; padding: 0; }
#stashHuntSheet .shs-row .n { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#stashHuntSheet .shs-row .n small { color: #999; }
#stashHuntSheet .shs-row .c { flex: 0 0 auto; font-size: .75rem; font-weight: 600; color: #6f42c1; }
#stashHuntSheet .shs-hid { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 1px solid #f0f0f0; }
#stashHuntSheet .shs-hid .n { flex: 1 1 auto; min-width: 0; word-break: break-word; font-size: .8rem; }
#stashHuntSheet .shs-empty { padding: 14px 10px; color: #888; font-size: .82rem; }
#stashHuntSheet .shs-foot { display: flex; gap: 8px; margin-top: 10px; }
#stashHuntSheet .shs-foot .go { flex: 1 1 auto; background: #6f42c1; border-color: #6f42c1; color: #fff; font-weight: 700; }
#stashModal .ssn-hunt-row { display: flex; align-items: center; gap: 10px; margin: 4px 4px 12px; font-size: .8rem; color: #777; }
#stashModal .ssn .ssn-hunt-go { background: #6f42c1; border-color: #6f42c1; color: #fff; font-weight: 700; padding: 8px 14px; font-size: .88rem; }
`;
    document.head.appendChild(css);
  }

  function paintBar() {
    const bar = S && S.bar;
    if (!bar || !S.cur) return;
    const v = S.cur.video;
    const left = inScopeLeft().length;
    const st = S.stats;
    const dir = v.__huntFolder || folderOf(v);
    const won = S.cur.matched;
    bar.classList.toggle('sh-won', won);
    const tagBtns = () => {
      const tags = v.__huntTags || tagsOf(v);
      if (!tags.length) return '<span class="sh-none">This file has no tags.</span>';
      return tags.map((t, i) => {
        const n = S.pool.filter(x => x.__huntTags.some(y => lower(y) === lower(t)) && !matchedNow(x)).length;
        return '<button type="button" data-tag="' + i + '">' + esc(t) + ' <b>' + n + '</b></button>';
      }).join('');
    };
    const inThisFolder = S.scope.folders.length === 1 && !S.scope.tags.length && lower(S.scope.folders[0]) === lower(dir);
    bar.innerHTML =
      '<div class="sh-top">' +
        '<button type="button" class="sh-scope" data-h="scope" title="Choose folders and tags">🎯 ' +
          esc(scopeLabel(S.scope)) + ' · ' + left.toLocaleString() + ' left ▾</button>' +
        '<span class="sh-stats" title="Matched · skipped · hidden this run">✅ ' + st.matched +
          ' · ⏭ ' + st.skipped + ' · 🚫 ' + st.never + (st.streak > 1 ? ' · 🔥' + st.streak : '') + '</span>' +
      '</div>' +
      '<div class="sh-file" title="' + esc((dir ? dir + '/' : '') + (v.filename || '')) + '">' +
        (dir ? '<span class="sh-dir">' + esc(dir) + '/</span>' : '') + esc(v.filename || '') + '</div>' +
      (won ? '<div class="sh-won-line">' + (S.cur.auto ? '✅ Matched by fingerprint!' : '✅ Matched!') + ' On to the next one?</div>' : '') +
      '<div class="sh-acts">' +
        '<button type="button" data-h="play" title="Preview in the player">▶</button>' +
        '<button type="button" data-h="folder" class="' + (inThisFolder ? 'sh-on' : '') + '" title="Next ones from this folder">📁 Folder</button>' +
        '<button type="button" data-h="tag" class="' + (S.tagMenu ? 'sh-on' : '') + '" title="Next ones with one of this file’s tags">🏷 Tag</button>' +
        '<button type="button" data-h="never" title="Never show this file in the hunt again">🚫 Never</button>' +
        '<button type="button" data-h="next" class="sh-next">Next ⏭</button>' +
      '</div>' +
      (S.tagMenu ? '<div class="sh-tags">' + tagBtns() + '</div>' : '');
  }

  function onBarClick(e) {
    if (!S || !S.cur) return;
    const b = e.target.closest('button');
    if (!b) return;
    e.stopPropagation();
    const v = S.cur.video;
    if (b.dataset.tag != null) {
      const t = (v.__huntTags || [])[+b.dataset.tag];
      if (!t) return;
      S.tagMenu = false;
      setScope({ folders: [], tags: [t] }, 'Next ones tagged ' + t);
      return;
    }
    switch (b.dataset.h) {
      case 'scope': openSheet({}); break;
      case 'play':
        if (window.scrayStashNav) window.scrayStashNav.preview(v, S.modal);
        break;
      case 'folder': {
        const dir = v.__huntFolder || folderOf(v);
        if (S.scope.folders.length === 1 && !S.scope.tags.length && lower(S.scope.folders[0]) === lower(dir)) {
          setScope({ folders: [], tags: [] }, 'Back to all files');
        } else {
          setScope({ folders: dir ? [dir] : [], tags: [] }, dir ? 'Next ones from ' + lastSeg(dir) : 'All files');
        }
        break;
      }
      case 'tag': S.tagMenu = !S.tagMenu; paintBar(); break;
      case 'never': never(); break;
      case 'next': next(); break;
    }
  }

  // ---- the handle showStashModal calls ---------------------------------------
  const handle = {
    mount(modal) {
      if (!S || !S.cur) return;
      ensureCss();
      S.modal = modal;
      const bar = document.createElement('div');
      bar.className = 'sh-bar';
      bar.addEventListener('click', onBarClick);
      const h = modal.querySelector('h3');
      if (h && h.parentNode) h.after(bar); else modal.firstElementChild.prepend(bar);
      S.bar = bar;
      paintBar();
    },
    loaded(matched, modal) {
      if (!S || !S.cur || modal !== S.modal) return;
      const c = S.cur;
      if (matched && !c.matched) {
        c.matched = true;
        c.auto = !c.loaded;
        S.stats.matched++;
        S.stats.streak++;
        S.stats.best = Math.max(S.stats.best, S.stats.streak);
        S.pool = S.pool.filter(v => keyOf(v) !== c.key);
        if (typeof window.scrayNoteStashMatch === 'function') {
          try { window.scrayNoteStashMatch(c.video, true, window.scrayHasStashMarkers ? window.scrayHasStashMarkers(c.video) : false); } catch (e) { /* colour catches up */ }
        }
        if (S.stats.streak > 1 && S.stats.streak % 5 === 0) toast('🔥 ' + S.stats.streak + ' in a row!');
      } else if (!matched && c.matched && c.loaded) {
        // Unmatched again from inside the modal: it goes back in the pool.
        c.matched = false;
        S.stats.matched = Math.max(0, S.stats.matched - 1);
        S.stats.streak = 0;
        if (!S.pool.includes(c.video)) S.pool.push(c.video);
      }
      c.loaded = true;
      paintBar();
    },
    closed(modal) {
      if (!S || modal !== S.modal) return;
      stop();
    }
  };

  function optsFor(video) {
    if (!S || !S.cur || !video) return null;
    return (video === S.cur.video || keyOf(video) === S.cur.key) ? handle : null;
  }

  function stop() {
    if (!S) return;
    const st = S.stats;
    if (st.matched || st.skipped || st.never) {
      toast('🎯 Hunt over: ' + st.matched + ' matched, ' + st.skipped + ' skipped' +
            (st.never ? ', ' + st.never + ' hidden' : '') + (st.best > 1 ? ' - best run ' + st.best : ''));
    }
    document.getElementById('stashHuntSheet')?.remove();
    S = null;
  }

  // ---- the scope sheet -------------------------------------------------------
  function openSheet({ note, tab: startTab, draft: keep } = {}) {
    if (!S) return;
    ensureCss();
    document.getElementById('stashHuntSheet')?.remove();
    const src = keep || S.scope;
    const draft = { folders: src.folders.slice(), tags: src.tags.slice() };
    let tab = startTab || (draft.tags.length && !draft.folders.length ? 'tags' : 'folders');
    let find = '';

    // Counts over the whole pool (not this run's seen list): what's unmatched.
    const live = S.pool.filter(v => !matchedNow(v));
    const folderCounts = new Map();   // lowercased path -> { path, n }
    const tagCounts = new Map();      // lowercased tag -> { tag, n }
    live.forEach(v => {
      const parts = (v.__huntFolder || '').split('/').filter(Boolean);
      for (let i = 1; i <= parts.length; i++) {
        const p = parts.slice(0, i).join('/');
        const k = lower(p);
        const e = folderCounts.get(k);
        if (e) e.n++; else folderCounts.set(k, { path: p, n: 1 });
      }
      v.__huntTags.forEach(t => {
        const k = lower(t);
        const e = tagCounts.get(k);
        if (e) e.n++; else tagCounts.set(k, { tag: t, n: 1 });
      });
    });
    const folders = [...folderCounts.values()].sort((a, b) => a.path.localeCompare(b.path, undefined, { sensitivity: 'base' }));
    const tags = [...tagCounts.values()].sort((a, b) => b.n - a.n || a.tag.localeCompare(b.tag));

    const sheet = document.createElement('div');
    sheet.id = 'stashHuntSheet';
    document.body.appendChild(sheet);

    const draftCount = () => live.filter(v => inScope(v, draft)).length;
    const has = (arr, x) => arr.some(y => lower(y) === lower(x));
    const toggle = (arr, x) => {
      const i = arr.findIndex(y => lower(y) === lower(x));
      if (i >= 0) arr.splice(i, 1); else arr.push(x);
    };

    function listHtml() {
      const q = lower(find);
      if (tab === 'hidden') {
        const items = [...S.never.values()].filter(it => !q || lower(it.name).includes(q))
          .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
        if (!items.length) return '<div class="shs-empty">' + (S.never.size ? 'None match.' : 'Nothing hidden. 🚫 Never on a file puts it here.') + '</div>';
        return items.slice(0, ROW_CAP).map(it =>
          '<div class="shs-hid"><span class="n">' + esc(it.name || it.key) + '</span>' +
          '<button type="button" data-un="' + esc(it.key) + '">Put back</button></div>').join('') +
          (items.length > ROW_CAP ? '<div class="shs-empty">…and ' + (items.length - ROW_CAP) + ' more - type to narrow.</div>' : '');
      }
      if (tab === 'tags') {
        const rows = tags.filter(t => !q || lower(t.tag).includes(q));
        if (!rows.length) return '<div class="shs-empty">No tags' + (q ? ' match.' : ' on unmatched files.') + '</div>';
        return rows.slice(0, ROW_CAP).map(t =>
          '<label class="shs-row"><input type="checkbox" data-t="' + esc(t.tag) + '"' + (has(draft.tags, t.tag) ? ' checked' : '') + '>' +
          '<span class="n">' + esc(t.tag) + '</span><span class="c">' + t.n.toLocaleString() + '</span></label>').join('') +
          (rows.length > ROW_CAP ? '<div class="shs-empty">…and ' + (rows.length - ROW_CAP) + ' more - type to narrow.</div>' : '');
      }
      const rows = folders.filter(f => !q || lower(f.path).includes(q));
      if (!rows.length) return '<div class="shs-empty">No folders' + (q ? ' match.' : '.') + '</div>';
      return rows.slice(0, ROW_CAP).map(f => {
        const depth = f.path.split('/').length - 1;
        const parent = depth ? f.path.slice(0, f.path.lastIndexOf('/')) : '';
        return '<label class="shs-row" title="' + esc(f.path) + '" style="padding-left:' + (10 + (q ? 0 : Math.min(depth, 6) * 14)) + 'px">' +
          '<input type="checkbox" data-f="' + esc(f.path) + '"' + (has(draft.folders, f.path) ? ' checked' : '') + '>' +
          '<span class="n">' + (q && parent ? '<small>' + esc(parent) + '/</small>' : '') + esc(lastSeg(f.path)) + '</span>' +
          '<span class="c">' + f.n.toLocaleString() + '</span></label>';
      }).join('') +
        (rows.length > ROW_CAP ? '<div class="shs-empty">…and ' + (rows.length - ROW_CAP) + ' more - type to narrow.</div>' : '');
    }

    function paint(keepFind) {
      const n = draftCount();
      const findVal = find;
      sheet.innerHTML =
        '<div class="shs">' +
          '<h3>🎯 Stash hunt - what to look at</h3>' +
          (note ? '<div class="shs-note">' + note + '</div>' : '') +
          '<div class="shs-tabs">' +
            '<button type="button" data-tab="folders" class="' + (tab === 'folders' ? 'on' : '') + '">📁 Folders' + (draft.folders.length ? ' (' + draft.folders.length + ')' : '') + '</button>' +
            '<button type="button" data-tab="tags" class="' + (tab === 'tags' ? 'on' : '') + '">🏷 Tags' + (draft.tags.length ? ' (' + draft.tags.length + ')' : '') + '</button>' +
            '<button type="button" data-tab="hidden" class="' + (tab === 'hidden' ? 'on' : '') + '">🚫 Hidden (' + S.never.size + ')</button>' +
          '</div>' +
          '<input class="shs-find" type="search" spellcheck="false" autocomplete="off" autocorrect="off" autocapitalize="off" placeholder="' +
            (tab === 'hidden' ? 'find a hidden file…' : tab === 'tags' ? 'find a tag…' : 'find a folder…') + '" value="' + esc(findVal) + '">' +
          '<div class="shs-list">' + listHtml() + '</div>' +
          '<div class="shs-foot">' +
            '<button type="button" data-sh="clear">Clear</button>' +
            '<button type="button" data-sh="end">End hunt</button>' +
            '<button type="button" data-sh="go" class="go">' + (n ? 'Hunt ' + plural(n, 'file') : 'Nothing unmatched here') + '</button>' +
          '</div>' +
        '</div>';
      const go = sheet.querySelector('[data-sh="go"]');
      go.disabled = !n;
      const box = sheet.querySelector('input.shs-find');
      box.addEventListener('input', () => {
        find = box.value;
        sheet.querySelector('.shs-list').innerHTML = listHtml();
      });
      if (keepFind) { try { box.focus({ preventScroll: true }); } catch (e) { box.focus(); } }
    }

    function refreshCounts() {
      const n = draftCount();
      const go = sheet.querySelector('[data-sh="go"]');
      go.textContent = n ? 'Hunt ' + plural(n, 'file') : 'Nothing unmatched here';
      go.disabled = !n;
      sheet.querySelectorAll('.shs-tabs button').forEach(b => {
        const t = b.dataset.tab;
        if (t === 'folders') b.textContent = '📁 Folders' + (draft.folders.length ? ' (' + draft.folders.length + ')' : '');
        if (t === 'tags') b.textContent = '🏷 Tags' + (draft.tags.length ? ' (' + draft.tags.length + ')' : '');
        if (t === 'hidden') b.textContent = '🚫 Hidden (' + S.never.size + ')';
      });
    }

    const close = () => sheet.remove();
    sheet.addEventListener('change', (e) => {
      const c = e.target;
      if (!c.matches('input[type=checkbox]')) return;
      if (c.dataset.f != null) toggle(draft.folders, c.dataset.f);
      if (c.dataset.t != null) toggle(draft.tags, c.dataset.t);
      refreshCounts();
    });
    sheet.addEventListener('click', async (e) => {
      if (e.target === sheet) { close(); if (!S.cur || !S.modal || !S.modal.isConnected) stop(); return; }
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.tab) { tab = b.dataset.tab; find = ''; paint(); return; }
      if (b.dataset.un) {
        b.disabled = true;
        await unNever(b.dataset.un);
        if (!S) return;
        // Counts include the file again: draw the sheet afresh, same choices.
        openSheet({ note, tab: 'hidden', draft });
        return;
      }
      switch (b.dataset.sh) {
        case 'clear': draft.folders = []; draft.tags = []; paint(); break;
        case 'end':
          close();
          if (S && S.modal && S.modal.isConnected) {
            // Through the modal's own Close, so it tidies up as usual.
            const cb = S.modal.querySelector('#stashCloseBtn');
            if (cb) cb.click(); else stop();
          } else stop();
          break;
        case 'again':
          S.seen = new Set([...S.seen].filter(k => !live.some(v => keyOf(v) === k && inScope(v, S.scope))));
          close();
          advance();
          break;
        case 'go': {
          const wasCur = S.cur;
          setScope(draft);
          close();
          // Carry on with the file on screen if it's still in scope; else a new one.
          // (Moving on because of a new scope isn't counted as a skip.)
          if (!wasCur || !S.modal || !S.modal.isConnected || wasCur.matched || !inScope(wasCur.video, S.scope)) {
            advance();
          }
          break;
        }
      }
    });
    paint();
  }

  // ---- start ---------------------------------------------------------------
  async function start() {
    if (starting) return;
    starting = true;
    try {
      if (S) stop();
      document.getElementById('stashModal')?.remove();
      S = newSession();
      toast('🎯 Stash hunt - finding unmatched files…', '#6f42c1');
      await loadNever();
      await buildPool();
      if (!S.pool.length) {
        toast('Everything here is matched already 🎉');
        S = null;
        return;
      }
      if (!inScopeLeft().length) {
        openSheet({ note: 'Nothing unmatched in the scope you used last time. Pick another one.' });
        return;
      }
      advance();
    } catch (err) {
      console.error('[hunt] start failed:', err);
      toast('⚠️ Stash hunt couldn’t start: ' + (err.message || err), '#dc3545');
      S = null;
    } finally {
      starting = false;
    }
  }

  // Up front: the home view's 🎯 button is styled from here too.
  try { ensureCss(); } catch (e) { /* no head yet - mount() adds it */ }

  // 🎯 on the Stash button's home view (scray-stash-nav.js draws it).
  document.addEventListener('click', (ev) => {
    const b = ev.target && ev.target.closest && ev.target.closest('.ssn-hunt-go');
    if (!b) return;
    ev.preventDefault();
    start();
  });

  // ?hunt=1 (Picker): start once the library has loaded.
  try {
    if (new URLSearchParams(location.search).get('hunt') === '1') {
      let tries = 0;
      const wait = async () => {
        tries++;
        let n = 0;
        try { n = typeof window.getAllVideos === 'function' ? (await window.getAllVideos()).length : 0; } catch (e) { n = 0; }
        if (n && typeof window.showStashModal === 'function' && typeof window.scrayApiCall === 'function') start();
        else if (tries < 60) setTimeout(wait, 2000);
      };
      window.addEventListener('load', () => setTimeout(wait, 1500));
    }
  } catch (e) { /* no URL to read */ }

  window.scrayStashHunt = {
    start, stop, optsFor, openScope: () => openSheet({}),
    isActive: () => !!S,
    _test: { inScope, scopeLabel, folderOf, tagsOf, keyOf, getSession: () => S, newSession, setSession: (s) => { S = s; }, buildPool, inScopeLeft }
  };
})();

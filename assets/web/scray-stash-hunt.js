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
// picker 15.35 / native 15.44: swipes on the whole card. A quick long swipe
// left is Next; a slower one opens the options (✏️ 📁 🏷 🚫) from behind the
// card's right edge. A swipe right opens the last match, with Unmatch. The
// last match's female performer(s) are offered to the navigator as pills,
// beside the studio - suggestPerformers(video).
// picker 15.30 / native 15.39: 📁 and 🏷 are icons only, the same width as ▶ and ✏️.
// picker 15.29 / native 15.38: ✏️ in the bar opens the details form (enter or
// correct the Stash details by hand) without going Back to the lookup first.
// picker 15.28 / native 15.37: the scope sheet is a card clear of the
// corner-button dock (and the gear), with 🎲 All files to go back to the
// whole library in one tap.
// picker 15.26 / native 15.35: the studio of the last match (any run, kept on
// this device) is offered to the navigator as a pill - suggestStudio(video).
//
// Started from 🎯 Stash hunt on the Stash button's home view, or
// window.scrayStashHunt.start(); in Picker also ?hunt=1.
(function () {
  'use strict';

  const esc = (s) => String(s ?? '').replace(/[&<>"]/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const api = (action, opts) => window.scrayApiCall(action, opts || {});
  const LS_SCOPE = 'scray.huntScope';
  const LS_STUDIO = 'scray.huntLastStudio';
  let lastStudio = (() => { try { return localStorage.getItem(LS_STUDIO) || ''; } catch (e) { return ''; } })();
  // picker 15.35 / native 15.44: the last match's female performer(s), and
  // the last match itself (for a swipe right). Kept on this device, any run.
  const LS_PERFS = 'scray.huntLastPerformers';
  const LS_LAST = 'scray.huntLastMatch';
  const LS_TIP = 'scray.huntSwipeTip';
  const readJson = (k, dflt) => { try { const j = JSON.parse(localStorage.getItem(k) || 'null'); return j == null ? dflt : j; } catch (e) { return dflt; } };
  const writeJson = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* this page load only */ } };
  let lastPerfs = (() => { const a = readJson(LS_PERFS, []); return Array.isArray(a) ? a.filter(x => typeof x === 'string') : []; })();
  let lastMatch = (() => { const m = readJson(LS_LAST, null); return m && typeof m.key === 'string' ? m : null; })();
  let lastMatchVideo = null;   // the file itself, when it was matched this page load
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
      tagMenu: false,
      run: Date.now(),          // which hunt a last match was made in
      swipeIn: false            // the next card slides in (a flick sent us on)
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
#stashModal .sh-acts button[data-h="play"], #stashModal .sh-acts button[data-h="edit"],
#stashModal .sh-acts button[data-h="folder"], #stashModal .sh-acts button[data-h="tag"] { flex: 0 0 38px; }
#stashModal .sh-bar .sh-next { flex: 1.4 1 0; background: #6f42c1; border-color: #6f42c1; color: #fff; font-weight: 700; }
#stashModal .sh-bar.sh-won .sh-next { background: #28a745; border-color: #28a745; }
#stashModal .sh-bar button.sh-on { background: #6f42c1; border-color: #6f42c1; color: #fff; }
#stashModal .sh-tags { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 7px; }
#stashModal .sh-tags button { padding: 3px 9px; border-radius: 12px; border-color: #b9d4f5; background: #eaf3ff; color: #0b5ed7; font-size: .76rem; }
#stashModal .sh-tags .sh-none { color: #888; font-size: .76rem; }
#stashHuntSheet { position: fixed; inset: 0; z-index: 2147483647; background: rgba(0,0,0,.45); display: flex; align-items: center; justify-content: center; box-sizing: border-box; padding: calc(env(safe-area-inset-top, 0px) + 12px) 10px calc(env(safe-area-inset-bottom, 0px) + 12px); }
#stashHuntSheet .shs { width: 100%; max-width: 640px; max-height: 100%; display: flex; flex-direction: column; background: #fff; color: #222; border-radius: 14px; padding: 12px; box-sizing: border-box; font-size: .88rem; text-align: left; }
#stashHuntSheet h3 { padding-right: 56px; }
#stashHuntSheet .shs-all { display: block; width: 100%; margin: 0 0 8px; padding: 9px 12px; text-align: left; border-color: #cbbef5; background: #f3efff; color: #5b3fd1; font-weight: 600; }
#stashHuntSheet .shs-all.on { background: #6f42c1; border-color: #6f42c1; color: #fff; }
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
#stashModal .sh-card { position: relative; z-index: 2; will-change: transform; }
#stashModal .sh-card.sh-in { animation: shIn .28s ease-out; }
@keyframes shIn { from { transform: translateX(70px); opacity: 0; } to { transform: none; opacity: 1; } }
#stashModal .sh-tray, #stashModal .sh-lasthint { position: fixed; z-index: 1; opacity: 0; pointer-events: none; display: flex; flex-direction: column; box-sizing: border-box; }
#stashModal .sh-tray { gap: 6px; padding: 0 0 0 8px; }
#stashModal .sh-tray button { flex: 1 1 0; min-height: 0; width: 100%; margin: 0; padding: 4px 2px; border: none; border-radius: 10px; background: #f4f4f6; color: #222; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; cursor: pointer; -webkit-tap-highlight-color: transparent; }
#stashModal .sh-tray button .i { font-size: 1.3rem; line-height: 1; }
#stashModal .sh-tray button .l { font-size: .7rem; font-weight: 600; line-height: 1.1; text-align: center; }
#stashModal .sh-tray button.on { background: #6f42c1; color: #fff; }
#stashModal .sh-tray button.bad { background: #dc3545; color: #fff; }
#stashModal .sh-lasthint { align-items: flex-start; justify-content: center; padding-left: 14px; color: #fff; gap: 4px; }
#stashModal .sh-lasthint .i { font-size: 1.6rem; line-height: 1; }
#stashModal .sh-lasthint .l { font-size: .78rem; font-weight: 700; }
#stashHuntLast { position: fixed; inset: 0; z-index: 2147483647; background: rgba(0,0,0,.45); display: flex; align-items: center; justify-content: center; box-sizing: border-box; padding: calc(env(safe-area-inset-top, 0px) + 12px) 12px calc(env(safe-area-inset-bottom, 0px) + 12px); }
#stashHuntLast .shl { width: 100%; max-width: 480px; background: #fff; color: #222; border-radius: 14px; padding: 14px; box-sizing: border-box; font-size: .88rem; text-align: left; }
#stashHuntLast h3 { margin: 0 0 4px; font-size: 1.05rem; }
#stashHuntLast .shl-when { font-size: .76rem; color: #777; margin-bottom: 8px; }
#stashHuntLast .shl-file { font-size: .8rem; color: #444; word-break: break-word; margin-bottom: 8px; }
#stashHuntLast .shl-file .sh-dir { color: #888; }
#stashHuntLast .shl-scene { padding: 8px 10px; border-radius: 8px; background: #eaf7ee; border-left: 3px solid #28a745; font-size: .84rem; line-height: 1.35; }
#stashHuntLast .shl-scene div { color: #555; font-size: .8rem; margin-top: 2px; }
#stashHuntLast .shl-msg { margin: 8px 2px 0; font-size: .8rem; color: #1e7e34; }
#stashHuntLast .shl-msg.err { color: #dc3545; }
#stashHuntLast .shl-msg:empty { display: none; }
#stashHuntLast .shl-foot { display: flex; gap: 8px; margin-top: 12px; }
#stashHuntLast button { flex: 1 1 0; width: auto; min-width: 0; margin: 0; padding: 9px 10px; font-size: .84rem; line-height: 1.2; border: 1px solid #ccc; border-radius: 8px; background: #f4f4f6; color: #222; cursor: pointer; }
#stashHuntLast .shl-un { background: transparent; color: #dc3545; border-color: #dc3545; font-weight: 600; }
#stashHuntLast .shl-un.armed { background: #dc3545; color: #fff; }
#stashHuntLast .shl-go { background: #6f42c1; border-color: #6f42c1; color: #fff; font-weight: 700; }
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
        '<button type="button" data-h="edit" title="Enter the Stash details by hand">✏️</button>' +
        '<button type="button" data-h="folder" class="' + (inThisFolder ? 'sh-on' : '') + '" title="Next ones from this folder">📁</button>' +
        '<button type="button" data-h="tag" class="' + (S.tagMenu ? 'sh-on' : '') + '" title="Next ones with one of this file’s tags">🏷</button>' +
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
      case 'edit': openDetails(); break;
      case 'play':
        if (window.scrayStashNav) window.scrayStashNav.preview(v, S.modal);
        break;
      case 'folder': toggleFolderScope(); break;
      case 'tag': S.tagMenu = !S.tagMenu; paintBar(); break;
      case 'never': never(); break;
      case 'next': next(); break;
    }
  }

  function openDetails() {
    if (S && S.modal && typeof S.modal.scrayOpenDetails === 'function') S.modal.scrayOpenDetails();
  }
  const inThisFolderScope = (v) => {
    const dir = v.__huntFolder || folderOf(v);
    return S.scope.folders.length === 1 && !S.scope.tags.length && lower(S.scope.folders[0]) === lower(dir);
  };
  function toggleFolderScope() {
    if (!S || !S.cur) return;
    const v = S.cur.video;
    const dir = v.__huntFolder || folderOf(v);
    if (inThisFolderScope(v)) {
      setScope({ folders: [], tags: [] }, 'Back to all files');
    } else {
      setScope({ folders: dir ? [dir] : [], tags: [] }, dir ? 'Next ones from ' + lastSeg(dir) : 'All files');
    }
  }

  // ---- swipes on the card (picker 15.35 / native 15.44) ---------------------
  // Left, quick and long: Next - the card flies off and the next one slides in.
  // Left, slower: the options come out from behind the card's right edge;
  //   tap one, or tap the card / swipe it back to put them away.
  // Right: the last match, with Unmatch.
  // Up and down still scroll: the swipe only takes over once the finger has
  // clearly gone sideways. Not from inside a text box, or anything that
  // scrolls sideways itself.
  // ⚙️ Feel.
  const SW = {
    lock: 10,        // px the finger moves before it's a swipe or a scroll
    flickV: 0.5,     // px/ms leftwards at the end that makes a flick (Next)
    flickMin: 70,    // px a flick has to have covered
    open: 45,        // px left a slower swipe needs to open the options
    last: 70,        // px right to open the last match
    tray: 84         // px the options take up
  };

  function swipeBlocked(t, card) {
    if (!t || !t.closest) return true;
    if (t.closest('input, textarea, select, [contenteditable="true"], .ssn-find-list, .ssn-studio-pop')) return true;
    for (let el = t; el && el !== card; el = el.parentElement) {
      if (el.scrollWidth > el.clientWidth + 2) {
        const ox = getComputedStyle(el).overflowX;
        if (ox === 'auto' || ox === 'scroll') return true;
      }
    }
    return false;
  }

  function attachSwipe(modal) {
    const card = modal.querySelector('.basket-json-modal-content');
    if (!card) return;
    card.classList.add('sh-card');
    const tray = document.createElement('div');
    tray.className = 'sh-tray';
    const hint = document.createElement('div');
    hint.className = 'sh-lasthint';
    modal.append(tray, hint);
    let g = null;          // the gesture under way
    let trayOpen = false;
    let x = 0;

    const setX = (nx, ms) => {
      x = nx;
      card.style.transition = ms ? 'transform ' + ms + 'ms ease-out' : 'none';
      card.style.transform = nx ? 'translateX(' + nx + 'px)' : 'none';
      tray.style.transition = hint.style.transition = ms ? 'opacity ' + ms + 'ms' : 'none';
      tray.style.opacity = nx < 0 ? String(Math.min(1, -nx / SW.tray)) : '0';
      hint.style.opacity = nx > 0 ? String(Math.min(1, nx / SW.last)) : '0';
      tray.style.pointerEvents = nx < 0 ? 'auto' : 'none';
    };
    // Tray and hint sit where the card will uncover them.
    const place = () => {
      const r = card.getBoundingClientRect();
      const left = r.left - x, right = r.right - x;
      tray.style.top = hint.style.top = r.top + 'px';
      tray.style.height = hint.style.height = r.height + 'px';
      tray.style.left = (right - SW.tray) + 'px';
      tray.style.width = SW.tray + 'px';
      hint.style.left = left + 'px';
      hint.style.width = Math.min(150, r.width / 2) + 'px';
    };
    const paintTray = () => {
      const v = S && S.cur && S.cur.video;
      const folderOn = !!(v && inThisFolderScope(v));
      const b = (h, icon, label, cls) => '<button type="button" data-t="' + h + '" class="' + (cls || '') + '">' +
        '<span class="i">' + icon + '</span><span class="l">' + label + '</span></button>';
      tray.innerHTML =
        b('edit', '✏️', 'Details') +
        b('folder', '📁', folderOn ? 'All files' : 'This folder', folderOn ? 'on' : '') +
        b('tag', '🏷', 'Tag', S && S.tagMenu ? 'on' : '') +
        b('never', '🚫', 'Never', 'bad');
    };
    const paintHint = () => {
      hint.innerHTML = lastMatch
        ? '<span class="i">↩︎</span><span class="l">Last match</span>'
        : '<span class="i">·</span><span class="l">No match yet</span>';
    };
    const shut = () => { trayOpen = false; setX(0, 200); };

    card.addEventListener('touchstart', (e) => {
      g = null;
      if (!S || S.modal !== modal || e.touches.length !== 1) return;
      if (swipeBlocked(e.target, card)) return;
      const t = e.touches[0];
      g = { x0: t.clientX, y0: t.clientY, base: x, dir: '', dx: 0, pts: [{ t: performance.now(), x: t.clientX }] };
    }, { passive: true });

    card.addEventListener('touchmove', (e) => {
      if (!g) return;
      if (e.touches.length !== 1) { g = null; shut(); return; }
      const t = e.touches[0];
      const dx = t.clientX - g.x0, dy = t.clientY - g.y0;
      if (!g.dir) {
        if (Math.abs(dx) < SW.lock && Math.abs(dy) < SW.lock) return;
        if (Math.abs(dx) <= Math.abs(dy) * 1.2) { g = null; return; }   // a scroll
        g.dir = 'x';
        place(); paintTray(); paintHint();
      }
      e.preventDefault();
      g.dx = dx;
      const now = performance.now();
      g.pts.push({ t: now, x: t.clientX });
      while (g.pts.length > 2 && now - g.pts[0].t > 100) g.pts.shift();
      let nx = g.base + dx;
      if (nx > 0) nx = Math.min(nx, SW.last + (nx - SW.last) * 0.3);   // gives, past the mark
      setX(nx, 0);
    }, { passive: false });

    const end = () => {
      const gg = g;
      g = null;
      if (!gg || gg.dir !== 'x') return;
      const a = gg.pts[0], z = gg.pts[gg.pts.length - 1];
      // Held still before letting go: that's a slow swipe, whatever came before.
      const v = performance.now() - z.t > 80 || z.t <= a.t ? 0 : (z.x - a.x) / (z.t - a.t);
      if (gg.dx < 0 && v <= -SW.flickV && -gg.dx >= SW.flickMin) {
        // Next: off to the left, then the next file's card slides in.
        trayOpen = false;
        setX(-Math.max(window.innerWidth, 400), 160);
        setTimeout(() => {
          if (!S || S.modal !== modal) return;
          S.swipeIn = true;
          next();
          // Nowhere to go (the scope sheet came up instead): this card comes back.
          if (S && S.modal === modal && modal.isConnected) { S.swipeIn = false; shut(); }
        }, 150);
      } else if (x <= -SW.open) {
        trayOpen = true;
        setX(-SW.tray, 200);
      } else if (gg.base === 0 && x >= SW.last) {
        shut();
        openLast();
      } else {
        shut();
      }
    };
    card.addEventListener('touchend', end);
    card.addEventListener('touchcancel', () => { g = null; shut(); });

    // With the options out, a tap on the card only puts them away.
    card.addEventListener('click', (e) => {
      if (!trayOpen) return;
      e.preventDefault();
      e.stopPropagation();
      shut();
    }, true);

    tray.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-t]');
      if (!b || !S || !S.cur) return;
      e.stopPropagation();
      shut();
      switch (b.dataset.t) {
        case 'edit': openDetails(); break;
        case 'folder': toggleFolderScope(); break;
        case 'tag':
          S.tagMenu = true;
          paintBar();
          try { S.bar && S.bar.scrollIntoView({ block: 'nearest' }); } catch (err) { /* it's at the top */ }
          break;
        case 'never': never(); break;
      }
    });

    if (S.swipeIn) {
      S.swipeIn = false;
      card.classList.add('sh-in');
      setTimeout(() => card.classList.remove('sh-in'), 400);
    }
  }

  // ---- the last match (swipe right) ------------------------------------------
  function noteLastMatch(c, scene) {
    if (!scene) return;
    const id = String(scene.id || '');
    const names = (Array.isArray(scene.cast) && scene.cast.length ? scene.cast.map(p => p && p.name) : (scene.performers || []))
      .map(n => String(n ?? '').trim()).filter(Boolean);
    lastMatch = {
      key: c.key,
      name: c.video.filename || c.key,
      dir: c.video.__huntFolder || folderOf(c.video),
      id,
      manual: !!scene.manual || id.startsWith('manual:'),
      title: String(scene.title || ''),
      studio: String(scene.studio || ''),
      performers: names.slice(0, 8),
      at: new Date().toISOString(),
      run: S ? S.run : 0
    };
    lastMatchVideo = c.video;
    writeJson(LS_LAST, lastMatch);
  }
  function forgetLastMatch() {
    lastMatch = null;
    lastMatchVideo = null;
    writeJson(LS_LAST, null);
  }

  const ago = (iso) => {
    const t = Date.parse(iso || '');
    if (!t) return '';
    const m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + ' min ago';
    const h = Math.round(m / 60);
    if (h < 24) return h + ' hour' + (h === 1 ? '' : 's') + ' ago';
    const d = Math.round(h / 24);
    return d + ' day' + (d === 1 ? '' : 's') + ' ago';
  };

  async function findVideo(key) {
    if (lastMatchVideo && keyOf(lastMatchVideo) === key) return lastMatchVideo;
    if (S) {
      if (S.cur && S.cur.key === key) return S.cur.video;
      const hit = S.pool.find(v => keyOf(v) === key);
      if (hit) return hit;
    }
    try {
      const all = typeof window.getAllVideos === 'function' ? await window.getAllVideos() : [];
      return (all || []).find(v => v && keyOf(v) === key) || null;
    } catch (e) { return null; }
  }

  async function unmatchLast(m) {
    if (m.manual) {
      const res = await api('stash_edit_manual_delete', { method: 'POST', body: { video_keys: [m.key] } });
      if (res.refused) throw new Error('it is matched to StashDB, not entered by hand');
      try { if (window.scrayStashNames) await window.scrayStashNames.refresh(true); } catch (e) { /* lists catch up */ }
      try { if (typeof window.scrayLoadStashState === 'function') await window.scrayLoadStashState(true); } catch (e) { /* S catches up */ }
      return 'Your details for it were removed.';
    }
    if (!window.scrayStashEdit || typeof window.scrayStashEdit.unmatch !== 'function') {
      throw new Error('scray-stash-edit.js is not loaded');
    }
    const res = await window.scrayStashEdit.unmatch(m.key, await findVideo(m.key));
    return res.summary || 'Unmatched.';
  }

  function openLast() {
    if (!lastMatch) { toast('No match yet to look back at'); return; }
    ensureCss();
    document.getElementById('stashHuntLast')?.remove();
    const m = lastMatch;
    const sheet = document.createElement('div');
    sheet.id = 'stashHuntLast';
    const who = [m.studio, (m.performers || []).join(', ')].filter(Boolean).join(' · ');
    sheet.innerHTML =
      '<div class="shl">' +
        '<h3>↩︎ Last match</h3>' +
        '<div class="shl-when">' + esc(ago(m.at)) + (S && m.run === S.run ? ' · this hunt' : '') +
          (m.manual ? ' · details entered by hand' : '') + '</div>' +
        '<div class="shl-file">' + (m.dir ? '<span class="sh-dir">' + esc(m.dir) + '/</span>' : '') + esc(m.name) + '</div>' +
        '<div class="shl-scene">' + (m.title ? '<b>' + esc(m.title) + '</b>' : '<i>No title</i>') +
          (who ? '<div>' + esc(who) + '</div>' : '') + '</div>' +
        '<div class="shl-msg"></div>' +
        '<div class="shl-foot">' +
          '<button type="button" class="shl-un" data-l="unmatch">✕ ' + (m.manual ? 'Remove my details' : 'Unmatch') + '</button>' +
          '<button type="button" data-l="close">Close</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(sheet);
    const msg = sheet.querySelector('.shl-msg');
    const foot = sheet.querySelector('.shl-foot');
    let armT = null;

    sheet.addEventListener('click', async (e) => {
      if (e.target === sheet) { clearTimeout(armT); sheet.remove(); return; }
      const b = e.target.closest('button[data-l]');
      if (!b || b.disabled) return;
      e.stopPropagation();
      switch (b.dataset.l) {
        case 'close': clearTimeout(armT); sheet.remove(); break;
        case 'unmatch': {
          // Two taps, as in the lookup panel - no native confirm().
          if (!armT) {
            b.textContent = 'Tap again to ' + (m.manual ? 'remove' : 'unmatch');
            b.classList.add('armed');
            armT = setTimeout(() => {
              armT = null;
              b.classList.remove('armed');
              b.textContent = '✕ ' + (m.manual ? 'Remove my details' : 'Unmatch');
            }, 3000);
            return;
          }
          clearTimeout(armT); armT = null;
          b.disabled = true;
          b.textContent = m.manual ? 'Removing…' : 'Unmatching…';
          msg.textContent = '';
          let summary;
          try {
            summary = await unmatchLast(m);
          } catch (err) {
            b.disabled = false;
            b.classList.remove('armed');
            b.textContent = '✕ ' + (m.manual ? 'Remove my details' : 'Unmatch');
            msg.textContent = 'Couldn’t ' + (m.manual ? 'remove' : 'unmatch') + ': ' + (err.message || err);
            msg.classList.add('err');
            return;
          }
          const video = await findVideo(m.key);
          forgetLastMatch();
          toast('↩︎ ' + summary);
          if (!S) { sheet.remove(); return; }
          if (S.cur && S.cur.key === m.key) {
            // The file on screen: reopen it, and loaded() puts it back in
            // the pool and takes it off the score.
            sheet.remove();
            const words = window.scrayStashNav ? window.scrayStashNav.words(video ? video.filename || '' : m.name) : m.name;
            window.showStashModal(S.cur.video, { search: words, hunt: handle });
            return;
          }
          if (m.run === S.run) {
            S.stats.matched = Math.max(0, S.stats.matched - 1);
            S.stats.streak = 0;
          }
          if (video && !S.pool.some(v => keyOf(v) === m.key)) {
            video.__huntFolder = folderOf(video);
            video.__huntTags = tagsOf(video);
            S.pool.push(video);
          }
          paintBar();
          msg.classList.remove('err');
          msg.textContent = summary;
          foot.innerHTML = video
            ? '<button type="button" class="shl-go" data-l="again">🔎 Hunt it again now</button><button type="button" data-l="close">Carry on</button>'
            : '<button type="button" data-l="close">Close</button>';
          break;
        }
        case 'again': {
          sheet.remove();
          const video = await findVideo(m.key);
          if (!video || !S) return;
          endPreview();
          S.seen.add(m.key);
          S.cur = { video, key: m.key, matched: false, auto: false, loaded: false };
          S.tagMenu = false;
          const words = window.scrayStashNav ? window.scrayStashNav.words(video.filename || '') : String(video.filename || '');
          window.showStashModal(video, { search: words, hunt: handle });
          break;
        }
      }
    });
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
      try { attachSwipe(modal); } catch (e) { console.error('[hunt] swipe:', e); }
    },
    loaded(matched, modal, scene) {
      if (!S || !S.cur || modal !== S.modal) return;
      const c = S.cur;
      // The studio it matched to: the next file is likely from it too.
      if (matched && scene && scene.studio) {
        lastStudio = String(scene.studio).trim();
        try { localStorage.setItem(LS_STUDIO, lastStudio); } catch (e) { /* this page load only */ }
      }
      // ...and its women (picker 15.35 / native 15.44). A match with none
      // leaves the last ones standing.
      if (matched && scene && Array.isArray(scene.cast)) {
        const women = scene.cast
          .filter(p => p && (String(p.gender || '').toUpperCase() === 'FEMALE' || String(p.gender_short || '').toUpperCase() === 'F'))
          .map(p => String(p.name || '').trim()).filter(Boolean);
        if (women.length) { lastPerfs = women.slice(0, 3); writeJson(LS_PERFS, lastPerfs); }
      }
      // The last match, for a swipe right: a new one, or this one again with
      // different details (a different scene accepted, say).
      if (matched && scene && (!c.matched || (lastMatch && lastMatch.key === c.key))) noteLastMatch(c, scene);
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
        if (lastMatch && lastMatch.key === c.key) forgetLastMatch();
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
    document.getElementById('stashHuntLast')?.remove();
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
    // The corner-button dock (disguise.js) always draws on top, so the card
    // keeps clear of it rather than trying to cover it: its bottom stops above
    // the dock when the dock sits in the lower half of the screen.
    try {
      const dock = document.getElementById('scrayDisguiseDock');
      const r = dock && dock.offsetParent !== null ? dock.getBoundingClientRect() : null;
      if (r && r.height && r.top > window.innerHeight / 2) {
        const gap = Math.round(window.innerHeight - r.top + 8);
        sheet.style.paddingBottom = 'max(' + gap + 'px, calc(env(safe-area-inset-bottom, 0px) + 12px))';
      }
    } catch (e) { /* the default padding will do */ }

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
          // Back to the whole library in one tap, whatever is ticked below.
          '<button type="button" data-sh="all" class="shs-all' + (!S.scope.folders.length && !S.scope.tags.length ? ' on' : '') + '">' +
            '🎲 All files, at random · ' + live.length.toLocaleString() + ' unmatched</button>' +
          '<div class="shs-tabs">' +
            '<button type="button" data-tab="folders" class="' + (tab === 'folders' ? 'on' : '') + '">📁 Folders' + (draft.folders.length ? ' (' + draft.folders.length + ')' : '') + '</button>' +
            '<button type="button" data-tab="tags" class="' + (tab === 'tags' ? 'on' : '') + '">🏷 Tags' + (draft.tags.length ? ' (' + draft.tags.length + ')' : '') + '</button>' +
            '<button type="button" data-tab="hidden" class="' + (tab === 'hidden' ? 'on' : '') + '">🚫 Hidden (' + S.never.size + ')</button>' +
          '</div>' +
          '<input class="shs-find" type="search" spellcheck="false" autocomplete="off" autocorrect="off" autocapitalize="off" placeholder="' +
            (tab === 'hidden' ? 'find a hidden file…' : tab === 'tags' ? 'find a tag…' : 'find a folder…') + '" value="' + esc(findVal) + '">' +
          '<div class="shs-list">' + listHtml() + '</div>' +
          '<div class="shs-foot">' +
            '<button type="button" data-sh="clear" title="Untick every folder and tag">Clear picks</button>' +
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
        case 'all':
          draft.folders = []; draft.tags = [];
          // falls through: hunt with nothing ticked - every unmatched file
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
      // How to swipe, the first few hunts on this device.
      const tips = +(readJson(LS_TIP, 0)) || 0;
      if (tips < 3) {
        writeJson(LS_TIP, tips + 1);
        setTimeout(() => toast('👆 Swipe ← quick for Next, slow for options · → last match', '#6f42c1'), 1800);
      }
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
    /** The studio of the hunt's last match, for the hunt's own file only. */
    suggestStudio: (video) => (optsFor(video) ? lastStudio : ''),
    /** The female performer(s) of the hunt's last match, for its own file only. */
    suggestPerformers: (video) => (optsFor(video) ? lastPerfs.slice() : []),
    openLast,
    isActive: () => !!S,
    _test: { inScope, scopeLabel, folderOf, tagsOf, keyOf, getSession: () => S, newSession, setSession: (s) => { S = s; }, buildPool, inScopeLeft,
             getLastMatch: () => lastMatch, getLastPerformers: () => lastPerfs.slice(), SW }
  };
})();

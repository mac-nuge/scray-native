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
// picker 15.55 / native 15.66: 🔎 opens the file's Stash modal ON TOP of the
// bulk sheet, which stays as it is underneath - close it and you're back.
// (15.54 hid the sheet and rebuilt the hunt's card on close, which then sat
// over the sheet: Back to bulk looked like it went nowhere.) The hunt's own
// card is kept aside meanwhile, not rebuilt. ▶ on a row plays over the lot,
// as ▶ does elsewhere, and bulk rows are more compact.
// picker 15.61 / native 15.72: a bulk check over more than 60 files has
// "+ Next 60": the next files in the scope join the list below the others and
// are checked, ticks and results above kept (moreBulk).
// picker 15.60 / native 15.71: the swipe-left options fill only the lower 60%
// of the card - from where the third used to start down to the foot - so they
// are all in thumb reach (SW.trayFrom).
// picker 15.54 / native 15.65: 🔎 on a bulk row opens that file's full Stash
// modal - lookup, search, Accept - with ⚡ Back to bulk, and the bulk check
// comes back as it was (still running, ticks and sort kept). A match made
// there shows on its row. 🎯 Hunt it there does what 🔎 used to: leaves bulk
// and hunts that file.
// picker 15.53 / native 15.64: every bulk row has ▶ under 🔎 - a preview in
// the player, the sheet hidden until Back to Stash, as the bar's ▶ does.
// picker 15.52 / native 15.63: Tick 90+ has its own mark - − 90 + beside it
// (steps of 5, or type one) - starting at 90 and kept for the rest of the
// hunt (S.bulkMin).
// picker 15.51 / native 15.62: Match ticked shows how far it has got - a bar
// and "Matching… 40% · 4 of 10" - and the renaming after it does the same.
// picker 15.50 / native 15.61: the bulk check sorts by confidence on request
// (Sort: Files | Confidence), kept for the rest of the hunt (S.bulkSort), and
// ☑ 90+ ticks every row whose shown scene scores 90 or more - asked for by
// name; it only ticks, Match ticked is still a separate tap after looking.
// picker 15.49 / native 15.60: the bulk check shows each file's best match or
// StashDB's first result - Best match | StashDB order, the same setting as the
// search's order (S.sort), so it carries both ways until the hunt is closed.
// picker 15.48 / native 15.59: the 🎯 scope button in the bar wraps (a size
// smaller) instead of cutting off the scope and the count left.
// picker 15.46 / native 15.57: the swipe options run 🚫 Never, 📁, ⏭ Next, 🏷,
// ✏️ Details - Never and Details swapped.
// picker 15.45 / native 15.56: the mark for Next is 55% of the card's width.
// picker 15.44 / native 15.55: a swipe left right across the card - past 75%
// of its width - is Next again (any speed); anything shorter opens the
// options as before. Past the mark the card says "Let go: Next".
// picker 15.43 / native 15.54: the search order picked on one file (StashDB
// order or Best match) is where the next files' searches open, until the hunt
// is closed - searchSort() / setSearchSort(v). StashDB order to start with.
// picker 15.41 / native 15.52: no more flick for Next - a swipe left only
// opens the options, which now include ⏭ Next (between 📁 and 🏷). A studio
// or performer name added to a file's search is carried to the next files
// from the same folder (carried(video)); take it out of the search and it
// stops.
// picker 15.40 / native 15.49: every sheet the hunt opens, and the Stash
// modal itself during a hunt, keeps clear of the corner-button dock
// (clearOfDock). The bulk check takes extra words for every search, with the
// usual suggestions as pills, and Search all again.
// picker 15.39 / native 15.48: the swipe-right list is every file the hunt has
// shown - matched, skipped, never, unmatched - with filter chips; a match
// opens its details, anything else goes back into the hunt. A file renamed
// since is still found (file id, size + length, or its scene's title).
// picker 15.38 / native 15.47: Rename too is two taps straight to the
// suggested name (file-operations.js, handle.renamed keeps the list in step),
// and after Match ticked the bulk check asks: rename them all, none, or choose.
// picker 15.37 / native 15.46: a swipe right lists the recent matches (not
// just the last); tap one to check its Stash details, unmatch there if it's
// wrong, and Back to the hunt. ⚡ Bulk (a folder or tag picked) checks the
// rest of the scope at once - fingerprint, then the best-scoring name match
// with confidence and lengths - and matches the ones you tick.
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
  const LS_LAST = 'scray.huntLastMatch';       // picker 15.35 / native 15.44 - read once, below
  const LS_MATCHES = 'scray.huntMatches';
  const LS_TIP = 'scray.huntSwipeTip';
  const readJson = (k, dflt) => { try { const j = JSON.parse(localStorage.getItem(k) || 'null'); return j == null ? dflt : j; } catch (e) { return dflt; } };
  const writeJson = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* this page load only */ } };
  let lastPerfs = (() => { const a = readJson(LS_PERFS, []); return Array.isArray(a) ? a.filter(x => typeof x === 'string') : []; })();
  // Newest first (picker 15.37 / native 15.46); starts from 15.35's single last match.
  let matches = (() => {
    const a = readJson(LS_MATCHES, null);
    if (Array.isArray(a)) return a.filter(m => m && typeof m.key === 'string');
    const one = readJson(LS_LAST, null);
    return one && typeof one.key === 'string' ? [one] : [];
  })();
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
      swipeIn: false,           // the next card slides in (⏭ in the swipe options sent us on)
      carry: new Map(),         // PIN_KEY -> pinned studio / performer names, added to every search (picker 15.75 / native 15.90: hunt-wide, was per folder)
      sort: '',                 // the search order picked this run: 'match' | 'order' | 'dur' | '' (StashDB order)
      bulkMin: 90,              // Tick N+ in the bulk check: the confidence it ticks from (picker 15.52 / native 15.63)
      bulkSort: ''              // the bulk check's rows: 'conf' (highest confidence first) | 'dur' (closest length first) | '' (as the files come)
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
    window.showStashModal(v, { search: huntWords(v), hunt: handle });
  }

  function next() {
    if (!S || !S.cur) return advance();
    if (!S.cur.matched) { S.stats.skipped++; S.stats.streak = 0; noteSeen(S.cur.video, 'skip'); }
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
    noteSeen(cur.video, 'never');
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
/* picker 15.48 / native 15.59: the scope and what's left wrap onto a second line, a size smaller, instead of being cut off. */
#stashModal .sh-bar button.sh-scope { white-space: normal; overflow-wrap: anywhere; font-size: .72rem; line-height: 1.2; padding: 5px 8px; }
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
#stashModal .sh-tray button.go { background: #6f42c1; color: #fff; }
#stashModal .sh-nexthint { position: fixed; z-index: 1; opacity: 0; pointer-events: none; height: 68px; box-sizing: border-box; border-radius: 12px; border: 2px dashed rgba(255,255,255,.55); color: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; text-align: center; }
#stashModal .sh-nexthint .i { font-size: 1.4rem; line-height: 1; }
#stashModal .sh-nexthint .l { font-size: .78rem; font-weight: 700; }
#stashModal .sh-nexthint.armed { background: #6f42c1; border-style: solid; border-color: #6f42c1; }
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
#stashModal .sh-bar .sh-bulk { flex: 0 0 auto; border-color: #e0a800; background: #fff8e1; color: #8a6d00; font-weight: 700; }
#stashModal .sh-bar.sh-insp { background: linear-gradient(135deg, #fff8e1, #fff3d6); border-color: #f0d58a; }
#stashModal .sh-insp-l { flex: 1 1 auto; font-weight: 700; color: #8a6d00; }
#stashModal .sh-bar .sh-back { background: #6f42c1; border-color: #6f42c1; color: #fff; font-weight: 700; }
#stashModal .sh-bar.sh-peek { background: linear-gradient(135deg, #fff8e1, #fdf1d0); }
#stashModal .sh-bar.sh-peek .sh-back { background: #d39e00; border-color: #d39e00; }
#stashHuntLast .shl { max-height: 100%; display: flex; flex-direction: column; }
#stashHuntLast h3 small { font-size: .75rem; color: #888; font-weight: 400; }
#stashHuntLast .shl-note { font-size: .76rem; color: #777; margin: 0 0 8px; }
#stashHuntLast .shl-list { flex: 1 1 auto; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; border: 1px solid #eee; border-radius: 8px; }
#stashHuntLast .shl-chips { display: flex; flex-wrap: wrap; gap: 5px; margin: 0 0 8px; }
#stashHuntLast .shl-chips button { flex: 0 0 auto; width: auto; padding: 4px 10px; border-radius: 14px; font-size: .76rem; border-color: #ddd; background: #f6f6f8; color: #333; }
#stashHuntLast .shl-chips button.on { background: #6f42c1; border-color: #6f42c1; color: #fff; }
#stashHuntLast .shl-k { flex: 0 0 22px; font-size: 1rem; line-height: 1.3; text-align: center; }
#stashHuntLast .shl-b { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
#stashHuntLast .shl-row.k-skip .shl-f, #stashHuntLast .shl-row.k-never .shl-f, #stashHuntLast .shl-row.k-unmatched .shl-f { font-size: .8rem; color: #222; font-weight: 600; }
#stashHuntLast .shl-row.k-never { opacity: .75; }
#stashHuntLast button.shl-row { display: flex; flex-direction: row; align-items: flex-start; gap: 6px; width: 100%; margin: 0; padding: 9px 10px; border: none; border-bottom: 1px solid #f0f0f0; border-radius: 0; background: #fff; text-align: left; font-size: .82rem; }
#stashHuntLast .shl-row:active { background: #f3efff; }
#stashHuntLast .shl-t { font-weight: 700; color: #222; }
#stashHuntLast .shl-w { color: #555; font-size: .78rem; }
#stashHuntLast .shl-f { color: #444; font-size: .74rem; word-break: break-word; }
#stashHuntLast .shl-f .sh-dir { color: #999; }
#stashHuntLast .shl-when { color: #999; font-size: .7rem; }
#stashHuntSheet .shs-foot .bulk { border-color: #e0a800; background: #fff8e1; color: #8a6d00; font-weight: 700; }
#stashHuntSheet .shs-foot [hidden] { display: none; }
#stashHuntBulk { position: fixed; inset: 0; z-index: 2147483647; background: rgba(0,0,0,.45); display: flex; align-items: center; justify-content: center; box-sizing: border-box; padding: calc(env(safe-area-inset-top, 0px) + 10px) 8px calc(env(safe-area-inset-bottom, 0px) + 10px); }
#stashHuntBulk .shb { width: 100%; max-width: 720px; max-height: 100%; display: flex; flex-direction: column; background: #fff; color: #222; border-radius: 14px; padding: 12px; box-sizing: border-box; font-size: .84rem; text-align: left; }
#stashHuntBulk h3 { margin: 0 0 4px; font-size: 1.02rem; }
#stashHuntBulk .shb-note { font-size: .76rem; color: #666; margin-bottom: 6px; }
#stashHuntBulk .shb-head { display: flex; align-items: center; gap: 8px; justify-content: space-between; font-size: .76rem; color: #555; margin-bottom: 6px; min-height: 26px; }
#stashHuntBulk button { width: auto; min-width: 0; margin: 0; padding: 7px 12px; font-size: .82rem; line-height: 1.2; border: 1px solid #ccc; border-radius: 8px; background: #f4f4f6; color: #222; cursor: pointer; }
#stashHuntBulk .shb-list { flex: 1 1 auto; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; border: 1px solid #eee; border-radius: 8px; display: flex; flex-direction: column; }
#stashHuntBulk .shb-list > .shb-row { flex: 0 0 auto; }
#stashHuntBulk .shb-row { display: flex; gap: 6px; align-items: flex-start; padding: 6px 6px; border-bottom: 1px solid #f0f0f0; cursor: pointer; -webkit-tap-highlight-color: transparent; }
#stashHuntBulk .shb-row.on { background: #eaf7ee; }
#stashHuntBulk .shb-row.st-done, #stashHuntBulk .shb-row.st-fpmatch { background: #f3fbf5; cursor: default; }
#stashHuntBulk .shb-row.st-wait, #stashHuntBulk .shb-row.st-fp, #stashHuntBulk .shb-row.st-search, #stashHuntBulk .shb-row.st-none, #stashHuntBulk .shb-row.st-err { cursor: default; }
#stashHuntBulk .shb-tick { flex: 0 0 22px; font-size: 1.2rem; line-height: 1.1; text-align: center; color: #28a745; }
#stashHuntBulk .shb-main { flex: 1 1 auto; min-width: 0; }
#stashHuntBulk .shb-file { font-size: .7rem; color: #444; word-break: break-word; line-height: 1.25; }
#stashHuntBulk .shb-file .sh-dir { color: #999; }
#stashHuntBulk .shb-scene { margin-top: 2px; font-size: .76rem; line-height: 1.25; }
#stashHuntBulk .shb-sub { font-size: .7rem; color: #555; line-height: 1.25; }
#stashHuntBulk .shb-sub small { color: #999; }
#stashHuntBulk .shb-facts { display: flex; flex-wrap: wrap; gap: 5px; align-items: center; margin-top: 3px; }
#stashHuntBulk .shb-conf { display: inline-block; min-width: 26px; padding: 1px 6px; border-radius: 9px; text-align: center; font-weight: 800; font-size: .78rem; background: #eee; color: #555; }
#stashHuntBulk .shb-conf.good { background: #d4f4dc; color: #1e7e34; }
#stashHuntBulk .shb-conf.mid { background: #fff3cd; color: #8a6d00; }
#stashHuntBulk .shb-conf.low { background: #fbe0e3; color: #b02a37; }
#stashHuntBulk .shb-dur { font-size: .72rem; color: #666; }
#stashHuntBulk .shb-dur.ok { color: #1e7e34; font-weight: 600; }
#stashHuntBulk .shb-dur.bad { color: #b02a37; font-weight: 600; }
#stashHuntBulk .shb-of { font-size: .68rem; color: #999; }
#stashHuntBulk .shb-st { display: block; margin-top: 3px; font-size: .76rem; color: #777; }
#stashHuntBulk .shb-st.good { color: #1e7e34; font-weight: 600; }
#stashHuntBulk .shb-st.bad { color: #b02a37; }
#stashHuntBulk .shb-hunt { flex: 0 0 auto; padding: 4px 7px; font-size: .78rem; }
#stashHuntBulk .shb-btns { flex: 0 0 auto; display: flex; flex-direction: column; gap: 4px; }
#stashHuntBulk .shb-btns .shb-pv { font-size: .8rem; }
#stashHuntBulk .shb-terms { margin: 0 0 6px; }
#stashHuntBulk .shb-head .more { background: #6c5ce7; border-color: #6c5ce7; color: #fff; font-weight: 700; padding: 5px 10px; font-size: .78rem; white-space: nowrap; }
#stashHuntBulk .shb-head .more small { font-weight: 400; opacity: .85; }
#stashHuntBulk .shb-order { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 0 0 6px; font-size: .76rem; color: #555; }
#stashHuntBulk .shb-seg { display: inline-flex; border: 1px solid #ccc; border-radius: 7px; overflow: hidden; }
#stashHuntBulk .shb-seg button { border: none; border-radius: 0; margin: 0; padding: 5px 10px; font-size: .76rem; background: #fff; color: #222; }
#stashHuntBulk .shb-seg button.on { background: #6c5ce7; color: #fff; }
#stashHuntBulk .shb-order .shb-t90 { margin-left: auto; padding: 5px 10px; font-size: .76rem; background: #eaf7ee; border-color: #9bd8a8; color: #1e7e34; font-weight: 700; }
#stashHuntBulk .shb-order .shb-t90:disabled { opacity: .45; }
#stashHuntBulk .shb-thr { display: inline-flex; align-items: center; border: 1px solid #ccc; border-radius: 7px; overflow: hidden; background: #fff; }
#stashHuntBulk .shb-thr button { border: none; border-radius: 0; margin: 0; padding: 4px 11px; font-size: .95rem; line-height: 1.2; background: #f4f4f6; }
/* 16px: iOS zooms the page into any smaller box it focuses. */
#stashHuntBulk input.shb-min { width: 3.2em; margin: 0; padding: 3px 2px; border: none; border-left: 1px solid #ddd; border-right: 1px solid #ddd; border-radius: 0; text-align: center; font-size: 16px; font-weight: 700; background: #fff; color: inherit; -moz-appearance: textfield; appearance: textfield; }
#stashHuntBulk input.shb-min::-webkit-outer-spin-button, #stashHuntBulk input.shb-min::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
#stashHuntBulk .shb-trow { display: flex; gap: 6px; }
#stashHuntBulk input.shb-add { flex: 1 1 auto; min-width: 0; box-sizing: border-box; margin: 0; padding: 7px 9px; font-size: 15px; border: 1px solid #ccc; border-radius: 8px; background: #fff; color: inherit; -webkit-appearance: none; appearance: none; }
#stashHuntBulk .shb-trow .again { flex: 0 0 auto; background: #6c5ce7; border-color: #6c5ce7; color: #fff; font-weight: 700; }
#stashHuntBulk .shb-trow .again:disabled { opacity: .5; }
#stashHuntBulk .shb-pills { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 6px; }
#stashHuntBulk .shb-pill { padding: 3px 9px; border-radius: 12px; border-color: #b9d4f5; background: #eaf3ff; color: #0b5ed7; font-size: .76rem; }
#stashHuntBulk .shb-pill.k-studio { border-color: #cbbef5; background: #f3efff; color: #5b3fd1; }
#stashHuntBulk .shb-pill.k-perf { border-color: #f1a7c9; background: #fdf0f6; color: #b0246a; }
#stashHuntBulk .shb-pill.on { background: #28a745; border-color: #28a745; color: #fff; }
#stashHuntBulk .shb-ren { display: block; margin-top: 3px; font-size: .74rem; color: #5b3fd1; word-break: break-word; }
#stashHuntBulk .shb-ren.ok { color: #1e7e34; font-weight: 600; }
#stashHuntBulk .shb-ren.bad { color: #b02a37; }
#stashHuntBulk .shb-row.pick { cursor: pointer; background: #fff; }
#stashHuntBulk .shb-row.pick.on { background: #f3efff; }
#stashHuntBulk .shb-row.pick .shb-tick { color: #6f42c1; }
#stashHuntBulk .shb-ask { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 8px; padding: 8px 10px; border-radius: 8px; background: #f3efff; border-left: 3px solid #6f42c1; font-size: .8rem; }
#stashHuntBulk .shb-ask[hidden] { display: none; }
#stashHuntBulk .shb-ask span { flex: 1 1 100%; }
#stashHuntBulk .shb-ask button { flex: 1 1 0; }
#stashHuntBulk .shb-ask .go { background: #6f42c1; border-color: #6f42c1; color: #fff; font-weight: 700; }
#stashHuntBulk .shb-ask .go:disabled { opacity: .5; }
#stashHuntBulk .shb-foot { display: flex; gap: 8px; margin-top: 10px; }
#stashHuntBulk .shb-prog { margin: 8px 0 0; }
#stashHuntBulk .shb-prog-bar { height: 8px; border-radius: 4px; background: #e8e8ee; overflow: hidden; }
#stashHuntBulk .shb-prog-bar i { display: block; height: 100%; background: #28a745; transition: width .25s ease-out; }
#stashHuntBulk .shb-prog-t { margin-top: 4px; font-size: .76rem; color: #444; }
#stashHuntBulk .shb-prog-t .bad { color: #b02a37; }
#stashHuntBulk .shb-foot button { flex: 1 1 0; }
#stashHuntBulk .shb-foot .go { flex: 1.6 1 0; background: #28a745; border-color: #28a745; color: #fff; font-weight: 700; }
#stashHuntBulk .shb-foot .go:disabled { opacity: .5; }
#stashModal .ssn-hunt-row { display: flex; align-items: center; gap: 10px; margin: 4px 4px 12px; font-size: .8rem; color: #777; }
mark.ssn-hl { background: #ffe066; color: #1a1a1a; padding: 0 1px; border-radius: 2px; }
#stashModal .ssn .ssn-hunt-go { background: #6f42c1; border-color: #6f42c1; color: #fff; font-weight: 700; padding: 8px 14px; font-size: .88rem; }
`;
    document.head.appendChild(css);
  }

  // ---- matching words on the file's name (picker 15.84 / native 15.102) ----
  // scray-stash-nav.js marks the words a result card shares with the file; this
  // marks the file's side - the words any card on show shares - on the hunt
  // bar's file line, and both sides of each bulk check row.
  const HL = () => (window.scrayStashNav && window.scrayStashNav.hl) || null;
  /** A file line's inside: folder/ and name, the words `terms` has marked. */
  function fileLineHtml(v, terms) {
    const dir = v.__huntFolder || folderOf(v);
    const h = HL();
    const mk = (t) => (h && terms ? h.html(t, terms) : esc(t));
    return (dir ? '<span class="sh-dir">' + mk(dir) + '/</span>' : '') + mk(v.filename || '');
  }
  /** The navigator has drawn these cards for `video`: mark the file line to match. */
  function shown(video, cards) {
    const h = HL();
    if (!video || !h) return;
    const key = keyOf(video);
    const terms = cards && cards.length ? h.sceneTerms(cards) : null;
    if (S && S.cur && S.cur.key === key) S.cur.shownTerms = terms;
    document.querySelectorAll('.sh-file[data-hlk]').forEach(el => {
      if (el.dataset.hlk === key) el.innerHTML = fileLineHtml(video, terms);
    });
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
        (bulkable() && left ? '<button type="button" class="sh-bulk" data-h="bulk" title="Check the rest of this folder / tag at once">⚡ Bulk</button>' : '') +
        '<span class="sh-stats" title="Matched · skipped · hidden this run">✅ ' + st.matched +
          ' · ⏭ ' + st.skipped + ' · 🚫 ' + st.never + (st.streak > 1 ? ' · 🔥' + st.streak : '') + '</span>' +
      '</div>' +
      '<div class="sh-file" data-hlk="' + esc(S.cur.key) + '" title="' + esc((dir ? dir + '/' : '') + (v.filename || '')) + '">' +
        fileLineHtml(v, S.cur.shownTerms || null) + '</div>' +
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
      case 'bulk': openBulk(); break;
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

  // ---- clear of the corner-button dock (picker 15.40 / native 15.49) --------
  // The dock (disguise.js) always draws on top of everything, so anything
  // full-screen keeps clear of it rather than trying to cover it: its bottom
  // padding stops above the dock whenever the dock sits in the lower half of
  // the screen. Re-measured on resize while it's up. Use this for every new
  // sheet or modal: the dock covering a footer is an easy thing to miss.
  // cap: an inner card whose max-height must fit the space that's left.
  function clearOfDock(el, basePad, cap) {
    const apply = () => {
      if (!el.isConnected) { window.removeEventListener('resize', apply); return; }
      let gap = 0;
      try {
        const dock = document.getElementById('scrayDisguiseDock');
        const r = dock && dock.offsetParent !== null ? dock.getBoundingClientRect() : null;
        if (r && r.height && r.top > window.innerHeight / 2) gap = Math.round(window.innerHeight - r.top + 8);
      } catch (e) { /* no dock: the default padding will do */ }
      el.style.paddingBottom = gap ? 'max(' + gap + 'px, ' + basePad + ')' : '';
      if (cap) cap.style.maxHeight = gap ? 'min(' + (cap.dataset.shMax || '100%') + ', 100%)' : (cap.dataset.shMax || '');
    };
    apply();
    window.addEventListener('resize', apply);
  }
  const SHEET_PAD = 'calc(env(safe-area-inset-bottom, 0px) + 12px)';
  /** The Stash modal: its card is 82vh tall, so it's capped to what's left too. */
  function modalClearOfDock(modal) {
    const card = modal.querySelector('.basket-json-modal-content');
    if (card && !card.dataset.shMax) card.dataset.shMax = card.style.maxHeight || '82vh';
    clearOfDock(modal, '20px', card);
  }

  // ---- swipes on the card (picker 15.35 / native 15.44) ---------------------
  // Left: the options come out from behind the card's right edge (🚫 📁 ⏭ 🏷 ✏️);
  //   tap one, or tap the card / swipe it back to put them away. ⏭ Next sends
  //   the card off to the left and the next one slides in. (picker 15.41 /
  //   native 15.52: a quick flick no longer goes straight to Next - too easy
  //   to do by accident.)
  // Left, well across - past SW.nextShare (55%) of the card's width, any
  //   speed: Next, as ⏭ does (picker 15.44 / native 15.55; 55% from 15.45 / 15.56).
  // Right: the last match, with Unmatch.
  // Up and down still scroll: the swipe only takes over once the finger has
  // clearly gone sideways. Not from inside a text box, or anything that
  // scrolls sideways itself.
  // ⚙️ Feel.
  const SW = {
    lock: 10,        // px the finger moves before it's a swipe or a scroll
    open: 45,        // px left a swipe needs to open the options
    nextShare: 0.55, // share of the card's width a swipe left must cover to go Next (picker 15.44 / native 15.55; 0.75 until 15.45 / 15.56)
    last: 70,        // px right to open the last match
    tray: 84,        // px the options take up
    trayFrom: 0.4    // the options start this far down the card and run to its foot - in thumb reach (picker 15.60 / native 15.71)
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
    // "Keep going" / "Let go: Next" in the gap a long swipe left opens (picker 15.44 / native 15.55).
    const nextHint = document.createElement('div');
    nextHint.className = 'sh-nexthint';
    modal.append(tray, hint, nextHint);
    let cardW = 0, cardRight = 0, cardMid = 0;
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
      paintNext(nx, ms);
    };
    const nextArmed = (nx) => cardW > 0 && -nx >= cardW * SW.nextShare;
    const paintNext = (nx, ms) => {
      const gap = -nx - SW.tray;             // the room between the card and the options
      if (ms || !g || gap < 120) { nextHint.style.opacity = '0'; nextHint.classList.remove('armed'); return; }
      const armed = nextArmed(nx);
      nextHint.classList.toggle('armed', armed);
      nextHint.innerHTML = armed ? '<span class="i">⏭</span><span class="l">Let go: Next</span>'
                                 : '<span class="i">⏭</span><span class="l">Keep going for Next</span>';
      const w = Math.min(150, gap - 16);
      nextHint.style.width = w + 'px';
      nextHint.style.left = (cardRight + nx + (gap - w) / 2) + 'px';
      nextHint.style.top = (cardMid - 34) + 'px';
      nextHint.style.opacity = '1';
    };
    // Tray and hint sit where the card will uncover them.
    const place = () => {
      const r = card.getBoundingClientRect();
      const left = r.left - x, right = r.right - x;
      cardW = r.width; cardRight = right; cardMid = r.top + r.height / 2;
      hint.style.top = r.top + 'px';
      hint.style.height = r.height + 'px';
      // The options fill the lower part only (picker 15.60 / native 15.71).
      tray.style.top = (r.top + r.height * SW.trayFrom) + 'px';
      tray.style.height = (r.height * (1 - SW.trayFrom)) + 'px';
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
      // Never at the top, Details at the bottom (picker 15.46 / native 15.57).
      tray.innerHTML =
        b('never', '🚫', 'Never', 'bad') +
        b('folder', '📁', folderOn ? 'All files' : 'This folder', folderOn ? 'on' : '') +
        b('next', '⏭', 'Next', 'go') +
        b('tag', '🏷', 'Tag', S && S.tagMenu ? 'on' : '') +
        b('edit', '✏️', 'Details');
    };
    const paintHint = () => {
      hint.innerHTML = matches.length
        ? '<span class="i">↩︎</span><span class="l">Recent files</span>'
        : '<span class="i">·</span><span class="l">No match yet</span>';
    };
    const shut = () => { trayOpen = false; setX(0, 200); };
    // ⏭ Next: off to the left, then the next file's card slides in.
    const flyNext = () => {
      trayOpen = false;
      setX(-Math.max(window.innerWidth, 400), 160);
      setTimeout(() => {
        if (!S || S.modal !== modal) return;
        S.swipeIn = true;
        next();
        // Nowhere to go (the scope sheet came up instead): this card comes back.
        if (S && S.modal === modal && modal.isConnected) { S.swipeIn = false; shut(); }
      }, 150);
    };

    card.addEventListener('touchstart', (e) => {
      g = null;
      if (!S || S.modal !== modal || e.touches.length !== 1) return;
      if (swipeBlocked(e.target, card)) return;
      const t = e.touches[0];
      g = { x0: t.clientX, y0: t.clientY, base: x, dir: '', dx: 0 };
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
      let nx = g.base + dx;
      if (nx > 0) nx = Math.min(nx, SW.last + (nx - SW.last) * 0.3);   // gives, past the mark
      setX(nx, 0);
    }, { passive: false });

    const end = () => {
      const gg = g;
      g = null;
      if (!gg || gg.dir !== 'x') return;
      if (nextArmed(x)) {
        flyNext();
      } else if (x <= -SW.open) {
        trayOpen = true;
        setX(-SW.tray, 200);
      } else if (gg.base === 0 && x >= SW.last) {
        shut();
        openMatches();
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
      if (b.dataset.t === 'next') { flyNext(); return; }
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

  // ---- recent matches (swipe right) -----------------------------------------
  // picker 15.37 / native 15.46: every match the hunt makes - one at a time,
  // by fingerprint, or from a bulk check - newest first, kept on this device.
  // A swipe right lists them; tap one to open its Stash details (Unmatch is
  // there as usual) and the hunt carries on where it was when that closes.
  // ⚙️ How many are kept.
  const MATCHES_KEPT = 100;
  // picker 15.39 / native 15.48: every file the hunt has shown, not only the
  // matches - kind 'match' | 'skip' | 'never' | 'unmatched' (none = match).
  const KIND = { match: ['✅', 'Matched'], skip: ['⏭', 'Skipped'], unmatched: ['↩︎', 'Unmatched'], never: ['🚫', 'Never'] };
  let listFilter = 'all';
  /** What finds a file again after a rename moves its key. */
  const idsOf = (v) => ({
    oid: String((v && (v.oneDriveId || v.idFromAPI)) || ''),
    size: +(v && (v.sizeBytes || v.size)) || 0,
    dur: +(v && v.durationMs) || 0
  });
  const matchVideos = new Map();   // key -> the file, for matches made this page load

  const castOf = (scene) => (Array.isArray(scene.cast) && scene.cast.length)
    ? scene.cast.filter(Boolean)
    : (scene.performers || []).map(n => ({ name: n }));

  /** Studio and women of a match, offered to the navigator for the next files. */
  function rememberScene(scene) {
    if (!scene) return;
    if (scene.studio) {
      lastStudio = String(scene.studio).trim();
      try { localStorage.setItem(LS_STUDIO, lastStudio); } catch (e) { /* this page load only */ }
    }
    // A match with no women leaves the last ones standing.
    const women = castOf(scene)
      .filter(p => String(p.gender || '').toUpperCase() === 'FEMALE' || String(p.gender_short || '').toUpperCase() === 'F')
      .map(p => String(p.name || '').trim()).filter(Boolean);
    if (women.length) { lastPerfs = women.slice(0, 3); writeJson(LS_PERFS, lastPerfs); }
  }

  function noteMatch(key, video, scene, how) {
    if (!scene || !key) return;
    const id = String(scene.id || scene.stash_id || '');
    const m = {
      key,
      name: (video && video.filename) || key,
      dir: video ? (video.__huntFolder || folderOf(video)) : '',
      id,
      manual: !!scene.manual || id.startsWith('manual:'),
      title: String(scene.title || ''),
      studio: String(scene.studio || ''),
      performers: castOf(scene).map(p => String(p.name || '').trim()).filter(Boolean).slice(0, 8),
      how: how || '',
      kind: 'match',
      at: new Date().toISOString(),
      run: S ? S.run : 0
    };
    Object.assign(m, idsOf(video));
    matches = [m].concat(matches.filter(x => x.key !== key)).slice(0, MATCHES_KEPT);
    if (video) matchVideos.set(key, video);
    writeJson(LS_MATCHES, matches);
  }
  /** A file left without a match: skipped (Next, or another file opened) or Never. */
  function noteSeen(video, kind) {
    if (!video) return;
    const key = keyOf(video);
    if (!key) return;
    const m = Object.assign({
      key, name: video.filename || key, dir: video.__huntFolder || folderOf(video),
      kind, at: new Date().toISOString(), run: S ? S.run : 0
    }, idsOf(video));
    matches = [m].concat(matches.filter(x => x.key !== key)).slice(0, MATCHES_KEPT);
    matchVideos.set(key, video);
    writeJson(LS_MATCHES, matches);
  }
  /** Unmatched: it stays on the list, as unmatched, at the top. */
  function forgetMatch(key) {
    const m = matches.find(x => x.key === key);
    if (!m) return;
    ['id', 'title', 'studio', 'performers', 'manual', 'how'].forEach(f => delete m[f]);
    m.kind = 'unmatched';
    m.at = new Date().toISOString();
    matches = [m].concat(matches.filter(x => x !== m));
    writeJson(LS_MATCHES, matches);
  }

  /** A renamed file keeps its place in the hunt and the list (its key moves). */
  function renamedFile(video, oldKey) {
    if (!video) return;
    const newKey = (video.videoKey && video.videoKey !== oldKey) ? video.videoKey
      : (typeof window.scrayVideoKey === 'function' ? window.scrayVideoKey(video.filename || '') : lower(video.filename));
    matches.forEach(m => { if (m.key === oldKey) { m.key = newKey; m.name = video.filename || m.name; } });
    writeJson(LS_MATCHES, matches);
    if (matchVideos.has(oldKey)) { matchVideos.delete(oldKey); matchVideos.set(newKey, video); }
    if (!S) return;
    S.seen.add(newKey);
    if (S.cur && (S.cur.video === video || S.cur.key === oldKey)) S.cur.key = newKey;
  }

  /** A match made outside the modal (bulk check): counted, and out of the pool. */
  function tookMatch(video, key, scene, how) {
    rememberScene(scene);
    noteMatch(key, video, scene, how);
    if (!S) return;
    S.stats.matched++;
    S.pool = S.pool.filter(v => keyOf(v) !== key);
    if (typeof window.scrayNoteStashMatch === 'function') {
      try { window.scrayNoteStashMatch(video, true, false); } catch (e) { /* colour catches up */ }
    }
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

  async function findVideo(m) {
    const rec = typeof m === 'string' ? { key: m } : (m || {});
    const key = rec.key;
    if (matchVideos.has(key)) return matchVideos.get(key);
    if (S) {
      if (S.cur && S.cur.key === key) return S.cur.video;
      const hit = S.pool.find(v => keyOf(v) === key);
      if (hit) return hit;
    }
    let all = [];
    try { all = ((typeof window.getAllVideos === 'function' ? await window.getAllVideos() : []) || []).filter(Boolean); } catch (e) { all = []; }
    let v = all.find(x => keyOf(x) === key) || null;
    // Renamed since (picker 15.39 / native 15.48) - the key moves with the
    // name - so: its file id (a OneDrive rename keeps it), then its size and
    // length together, then for a match the scene's title (and studio).
    if (!v && rec.oid) v = all.find(x => x.oneDriveId === rec.oid || x.idFromAPI === rec.oid) || null;
    if (!v && rec.size && rec.dur) {
      const c = all.filter(x => (+x.sizeBytes || +x.size || 0) === rec.size && Math.abs((+x.durationMs || 0) - rec.dur) < 1500);
      if (c.length === 1) v = c[0];
    }
    if (!v && rec.title && window.scrayStashNames && typeof window.scrayStashNames.parts === 'function') {
      const t = lower(rec.title), st = lower(rec.studio);
      const c = all.filter(x => { const p = window.scrayStashNames.parts(x); return !!(p && p.title === t); });
      if (c.length === 1) v = c[0];
      else if (c.length > 1) {
        const d = c.filter(x => { const p = window.scrayStashNames.parts(x); return p && p.studio === st; });
        if (d.length === 1) v = d[0];
      }
    }
    // Found under another key: the entry learns it, so next time is direct.
    if (v && typeof m === 'object' && keyOf(v) !== key) {
      const nk = keyOf(v);
      matches.forEach(x => { if (x.key === key) { x.key = nk; x.name = v.filename || x.name; } });
      writeJson(LS_MATCHES, matches);
    }
    if (v) matchVideos.set(keyOf(v), v);
    return v;
  }

  const baseWords = (v) => window.scrayStashNav ? window.scrayStashNav.words(v.filename || '') : String(v.filename || '');

  // ---- names carried from file to file (picker 15.41 / native 15.52) --------
  // A pinned studio or performer name is added to the search of every next
  // file in the hunt, whatever its folder. Take it out of the search (and
  // search), or unpin it, and it stops. This run only.
  // picker 15.74 / native 15.89: pinned by hand only - the navigator's studio / performer pill
  // menus have Pin / Unpin. A name added to a search used to be carried by
  // itself.
  const reEsc = (t) => String(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const hasWord = (text, name) => new RegExp('(^|\\s)' + reEsc(name) + '(?=\\s|$)', 'i').test(String(text || ''));
  // picker 15.75 / native 15.90: one list for the whole hunt. Pins were kept per folder, but the
  // next file is picked at random from the whole scope - subfolders and tag
  // matches included - so it was usually in another folder and never saw them.
  const PIN_KEY = '*';
  const carryOf = (v) => (S && S.carry && S.carry.get(PIN_KEY)) || [];

  /**
   * The navigator's report of a search it ran for the hunt's file. Only prunes
   * now (picker 15.74 / native 15.89): a pinned name taken out of the words stops being carried.
   * Nothing new is pinned here - see pin().
   */
  function searched(video, term) {
    if (!S || !optsFor(video)) return;
    const kept = carryOf(video).filter(n => hasWord(term, n));
    if (kept.length) S.carry.set(PIN_KEY, kept); else S.carry.delete(PIN_KEY);
  }

  /** Pin a name for the rest of the hunt, or unpin it (picker 15.74 / native 15.89). */
  function pin(video, name, on) {
    if (!S || !optsFor(video)) return false;
    const n = String(name || '').replace(/\s+/g, ' ').trim();
    if (n.length < 2) return false;
    const list = carryOf(video).filter(x => lower(x) !== lower(n));
    if (on) list.push(n);
    if (list.length) S.carry.set(PIN_KEY, list); else S.carry.delete(PIN_KEY);
    return true;
  }
  const isPinned = (video, name) => !!(S && optsFor(video)) && carryOf(video).some(x => lower(x) === lower(name));

  /** The file's own words, and whatever its folder carries. */
  const huntWords = (v) => {
    const base = baseWords(v);
    const extra = carryOf(v).filter(n => !hasWord(base, n));
    return (base + ' ' + extra.join(' ')).trim();
  };

  /** Back to the hunt's own file, as it was. */
  function resume() {
    if (!S) return;
    if (!S.cur) { advance(); return; }
    window.showStashModal(S.cur.video, { search: huntWords(S.cur.video), hunt: handle });
  }

  /** Make this file the hunt's current one, straight away. */
  function huntNow(video) {
    if (!S || !video) return;
    const key = keyOf(video);
    endPreview();
    // The one being left, unmatched, goes on the list as skipped.
    if (S.cur && S.cur.video !== video && S.cur.key !== key && !S.cur.matched) noteSeen(S.cur.video, 'skip');
    S.seen.add(key);
    S.cur = { video, key, matched: false, auto: false, loaded: false };
    S.tagMenu = false;
    window.showStashModal(video, { search: huntWords(video), hunt: handle });
  }

  function openMatches() {
    if (!matches.length) { toast('Nothing yet to look back at'); return; }
    ensureCss();
    document.getElementById('stashHuntLast')?.remove();
    const sheet = document.createElement('div');
    sheet.id = 'stashHuntLast';
    document.body.appendChild(sheet);
    clearOfDock(sheet, SHEET_PAD);
    listFilter = 'all';     // chips are for this look only
    const kindOf = (m) => KIND[m.kind] ? m.kind : 'match';
    const paint = () => {
      const counts = { all: matches.length };
      matches.forEach(m => { const k = kindOf(m); counts[k] = (counts[k] || 0) + 1; });
      if (listFilter !== 'all' && !counts[listFilter]) listFilter = 'all';
      const chips = ['all', 'match', 'skip', 'unmatched', 'never'].filter(k => k === 'all' || counts[k]).map(k =>
        '<button type="button" data-f="' + k + '" class="' + (listFilter === k ? 'on' : '') + '">' +
          (k === 'all' ? 'All' : KIND[k][0] + ' ' + KIND[k][1]) + ' <b>' + counts[k] + '</b></button>').join('');
      const rows = matches.map((m, i) => ({ m, i }))
        // 🔒 Files in private folders stay out while locked (picker 15.62 / native 15.73).
        .filter(x => !(window.scrayPrivate && window.scrayPrivate.hidesPath(x.m.dir)))
        .filter(x => listFilter === 'all' || kindOf(x.m) === listFilter).map(({ m, i }) => {
        const k = kindOf(m);
        const onScreen = !!(S && S.cur && S.cur.key === m.key);
        const tags = [KIND[k][1] + (k === 'match' && m.how === 'bulk' ? ' in a bulk check' : k === 'match' && m.how === 'fingerprint' ? ' by fingerprint' : ''), ago(m.at)];
        if (S && m.run === S.run) tags.push('this hunt');
        if (k === 'match' && m.manual) tags.push('entered by hand');
        if (onScreen) tags.push('on screen now');
        const who = [m.studio, (m.performers || []).join(', ')].filter(Boolean).join(' · ');
        const file = '<span class="shl-f">' + (m.dir ? '<span class="sh-dir">' + esc(m.dir) + '/</span>' : '') + esc(m.name) + '</span>';
        return '<button type="button" class="shl-row k-' + k + '" data-i="' + i + '">' +
          '<span class="shl-k">' + KIND[k][0] + '</span><span class="shl-b">' +
          (k === 'match'
            ? '<span class="shl-t">' + (m.title ? esc(m.title) : '<i>No title</i>') + '</span>' + (who ? '<span class="shl-w">' + esc(who) + '</span>' : '') + file
            : file) +
          '<span class="shl-when">' + esc(tags.filter(Boolean).join(' · ')) + '</span></span>' +
        '</button>';
      }).join('');
      sheet.innerHTML =
        '<div class="shl">' +
          '<h3>↩︎ Recent files <small>' + matches.length + '</small></h3>' +
          '<div class="shl-note">A match opens its Stash details (unmatch there if it’s wrong); anything else goes back into the hunt.</div>' +
          '<div class="shl-chips">' + chips + '</div>' +
          '<div class="shl-list">' + rows + '</div>' +
          '<div class="shl-foot"><button type="button" class="shl-go" data-l="resume">▶ Resume the hunt</button></div>' +
        '</div>';
    };
    paint();
    sheet.addEventListener('click', (e) => {
      if (e.target === sheet) { sheet.remove(); return; }
      const chip = e.target.closest('[data-f]');
      if (chip) { e.stopPropagation(); listFilter = chip.dataset.f; paint(); return; }
      const row = e.target.closest('[data-i]');
      if (row) {
        e.stopPropagation();
        const m = matches[+row.dataset.i];
        sheet.remove();
        if (!m) return;
        if (kindOf(m) === 'match') inspect(m); else reopen(m);
        return;
      }
      if (e.target.closest('[data-l]')) { e.stopPropagation(); sheet.remove(); }
    });
  }

  /** A file that wasn't matched: back into the hunt as the one on screen. */
  async function reopen(m) {
    if (!S) return;
    if (S.cur && S.cur.key === m.key && S.modal && S.modal.isConnected) { toast('That’s the file on screen'); return; }
    const video = await findVideo(m);
    if (!video) { toast('⚠️ Can’t find that file in the library here any more', '#b8860b'); return; }
    if (m.kind === 'never') toast('🚫 It’s on the never list - the scope’s Hidden tab puts it back', '#6f42c1');
    huntNow(video);
  }

  async function inspect(m) {
    if (!S) return;
    if (S.cur && S.cur.key === m.key && S.modal && S.modal.isConnected) { toast('That’s the file on screen'); return; }
    const video = await findVideo(m);
    if (!video) { toast('⚠️ Can’t find that file in the library here any more', '#b8860b'); return; }
    endPreview();
    window.showStashModal(video, { hunt: inspectHandle(m, video) });
  }

  // The Stash modal on a past match: a slim bar with Back to the hunt, and
  // an unmatch there puts the file back in the hunt.
  function inspectHandle(m0, video) {
    let m = m0, gone = false;
    return {
      mount(modal) {
        ensureCss();
        const bar = document.createElement('div');
        bar.className = 'sh-bar sh-insp';
        bar.innerHTML =
          '<div class="sh-top"><span class="sh-insp-l">↩︎ Checking a past match</span>' +
            '<button type="button" class="sh-back" data-h="back">🎯 Back to the hunt</button></div>' +
          '<div class="sh-file">' + (m.dir ? '<span class="sh-dir">' + esc(m.dir) + '/</span>' : '') + esc(m.name) + '</div>';
        bar.addEventListener('click', (e) => {
          if (!e.target.closest('[data-h="back"]')) return;
          e.stopPropagation();
          const cb = modal.querySelector('#stashCloseBtn');
          if (cb) cb.click();
        });
        const h = modal.querySelector('h3');
        if (h && h.parentNode) h.after(bar); else modal.firstElementChild.prepend(bar);
        modalClearOfDock(modal);
      },
      loaded(matched, modal, scene) {
        if (!S) return;
        if (!matched) {
          if (gone) return;
          // Unmatched here: off the list, and back in the hunt.
          gone = true;
          forgetMatch(m.key);
          if (m.run === S.run) { S.stats.matched = Math.max(0, S.stats.matched - 1); S.stats.streak = 0; }
          if (!S.pool.some(v => keyOf(v) === m.key)) {
            video.__huntFolder = folderOf(video);
            video.__huntTags = tagsOf(video);
            S.pool.push(video);
          }
          return;
        }
        if (scene && (gone || String(scene.id || '') !== m.id)) {
          // Matched again, or to another scene: a fresh entry at the top.
          if (gone) { S.stats.matched++; S.pool = S.pool.filter(v => keyOf(v) !== m.key); }
          gone = false;
          rememberScene(scene);
          noteMatch(m.key, video, scene, 'modal');
          m = matches[0];
        }
      },
      closed() { resume(); }
    };
  }

  // ---- bulk check (picker 15.37 / native 15.46) ------------------------------
  // With a folder or tag picked: the rest of that scope at once. Each file
  // gets the fingerprint lookup opening it would (a fingerprint match is kept
  // there and then, exactly as when the modal opens), then a StashDB search
  // on its name scored against the file - the best-scoring scene comes back
  // with its confidence and the file vs scene length. Tick the right ones and
  // Match ticked submits them one at a time, as Accept & submit does. Nothing
  // is ticked for you. What's left stays in the hunt, one by one.
  // ⚙️
  const BULK_MAX = 60;     // files in one bulk check
  const BULK_PAR = 2;      // lookups at once
  let bulk = null;         // the check in progress / on screen
  const bulkable = () => !!(S && (S.scope.folders.length || S.scope.tags.length));

  const clock = (sec) => {
    sec = Math.max(0, Math.round(+sec || 0));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), x = sec % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(x).padStart(2, '0');
  };
  /** Best confidence; StashDB's own order breaks ties (and decides when unscored). */
  function bestOf(scenes) {
    let best = null, bi = -1;
    (scenes || []).forEach((c, i) => {
      if (!c || !c.stash_id) return;
      const a = Number(c.confidence), b = best ? Number(best.confidence) : NaN;
      if (!best || (Number.isFinite(a) && (!Number.isFinite(b) || a > b))) { best = c; bi = i; }
    });
    return best ? Object.assign({ rank: bi + 1 }, best) : null;
  }
  /** StashDB's own first result. */
  function firstOf(scenes) {
    const i = (scenes || []).findIndex(c => c && c.stash_id);
    return i < 0 ? null : Object.assign({ rank: i + 1 }, scenes[i]);
  }
  /** How far apart file and scene are, as a fraction; Infinity without both lengths (picker 15.64 / native 15.76). */
  const durGap = (c) => {
    const f = Number(c && c.file_duration_sec) || 0, s = Number(c && c.stash_duration_sec) || 0;
    return f > 0 && s > 0 ? Math.abs(f - s) / Math.max(f, s) : Infinity;
  };
  /** The closest length; StashDB's order breaks ties. Falls back to StashDB's first with no lengths. */
  function closestOf(scenes) {
    let best = null, bi = -1;
    (scenes || []).forEach((c, i) => {
      if (!c || !c.stash_id) return;
      if (!best || durGap(c) < durGap(best)) { best = c; bi = i; }
    });
    return best ? Object.assign({ rank: bi + 1 }, best) : null;
  }
  // Which scene a bulk row shows (picker 15.49 / native 15.60): the hunt's
  // search order - StashDB order unless Best match (or, picker 15.64 /
  // native 15.76, Duration diff) has been picked.
  const bulkOrder = () => (S && (S.sort === 'match' || S.sort === 'dur')) ? S.sort : 'order';
  const pickCard = (scenes) => bulkOrder() === 'match' ? bestOf(scenes) : bulkOrder() === 'dur' ? closestOf(scenes) : firstOf(scenes);
  function setBulkOrder(B, v) {
    if (!S || (v !== 'match' && v !== 'order' && v !== 'dur')) return;
    S.sort = v;
    B.rows.forEach(r => {
      if (!r.scenes || !(r.st === 'found' || r.st === 'fail')) return;
      const c = pickCard(r.scenes);
      // A different scene isn't the one that was ticked.
      if (!c || !r.card || c.stash_id !== r.card.stash_id) r.tick = false;
      r.card = c;
      r.how = v;
    });
    B.rows.forEach(r => paintBulkRow(r));
    paintBulk();
  }
  /**
   * Where a row sits when sorted by confidence (picker 15.50 / native 15.61):
   * scenes to decide on, highest confidence first; then the ones still being
   * checked; then nothing found; then the ones already matched. Ties keep the
   * files' own order. Applied as the CSS order, so the rows keep their indexes.
   */
  function bulkRank(r) {
    if (!S || (S.bulkSort !== 'conf' && S.bulkSort !== 'dur')) return 0;
    // Length diff (picker 15.64 / native 15.76): closest first, in tenths of a
    // percent; a row with no lengths to compare after the rest to decide on.
    if (S.bulkSort === 'dur' && r.card && (r.st === 'found' || r.st === 'fail' || r.st === 'sub')) {
      const g = durGap(r.card);
      return g === Infinity ? 2500 : Math.min(2400, Math.round(g * 1000));
    }
    if (r.card && (r.st === 'found' || r.st === 'fail' || r.st === 'sub')) {
      const c = Number(r.card.confidence);
      return Math.round((100 - (Number.isFinite(c) ? Math.max(0, Math.min(100, c)) : -1)) * 10);
    }
    if (r.st === 'wait' || r.st === 'fp' || r.st === 'search') return 3000;
    if (r.st === 'none' || r.st === 'err') return 4000;
    return 5000;
  }
  /** Rows to decide on whose shown scene scores 90 or more (picker 15.50 / native 15.61). */
  const bulkMin = () => { const n = Number(S && S.bulkMin); return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 90; };
  const bulkHigh = (B) => B.rows.filter(r => r.card && (r.st === 'found' || r.st === 'fail') && Number(r.card.confidence) >= bulkMin());
  const cardScene = (c) => ({ id: c.stash_id, title: c.title, studio: c.studio, cast: c.cast || [],
                              performers: (c.cast || []).map(p => p.name) });

  function bulkRowHtml(r, i) {
    const v = r.v;
    const dir = v.__huntFolder || folderOf(v);
    // Matching words marked on both sides (picker 15.84 / native 15.102).
    const h = HL();
    const sceneT = h && r.card ? h.sceneTerms([r.card]) : null;
    const fileT = h && r.card ? h.fileTerms(v) : null;
    const hs = (t) => (h && fileT ? h.html(t, fileT) : esc(t));
    const file = '<div class="shb-file">' + fileLineHtml(v, sceneT) + '</div>';
    const tickable = (r.st === 'found' || r.st === 'fail') && !(bulk && (bulk.submitting || preAsk(bulk)));
    const renPick = !!(bulk && ((bulk.ask === 'pick' && r.st === 'done' && r.sug && !r.rst) ||
                                (bulk.ask === 'prepick' && inPending(bulk, r) && r.sug)));
    let body = '';
    if (r.card && (r.st === 'found' || r.st === 'sub' || r.st === 'done' || r.st === 'fail' || r.st === 'q')) {
      const c = r.card;
      const conf = Number(c.confidence);
      const confHtml = c.confidence != null && Number.isFinite(conf)
        ? '<span class="shb-conf ' + (conf >= 70 ? 'good' : conf >= 40 ? 'mid' : 'low') + '">' + conf.toFixed(0) + '</span>'
        : '<span class="shb-conf">?</span>';
      const fs = Number(c.file_duration_sec) || 0, ss = Number(c.stash_duration_sec) || 0;
      let dur;
      if (fs > 60 && ss > 60) {
        const drift = Math.abs(fs - ss) / Math.max(fs, ss);
        // The navigator's bands: within 3% reads right, past 5% reads wrong.
        dur = '<span class="shb-dur ' + (drift <= 0.03 ? 'ok' : drift <= 0.05 ? '' : 'bad') + '">File ' + clock(fs) +
              ' · Scene ' + clock(ss) + ' · ' + (drift * 100).toFixed(1) + '% apart</span>';
      } else {
        dur = '<span class="shb-dur">' + (fs ? 'File ' + clock(fs) + ' · ' : '') + (ss ? 'Scene ' + clock(ss) : 'no scene runtime') + '</span>';
      }
      const cast = (c.cast || []).map(p => hs(p.name) + (p.gender_short && p.gender_short !== '?' ? ' <small>' + esc(p.gender_short) + '</small>' : '')).join(', ');
      body =
        '<div class="shb-scene"><b>' + (c.title ? hs(c.title) : '<i>No title</i>') + '</b></div>' +
        '<div class="shb-sub">' + [c.studio ? hs(c.studio) : 'no studio', c.release_date ? hs(c.release_date) : ''].filter(Boolean).join(' · ') +
          (cast ? ' · ' + cast : '') + '</div>' +
        '<div class="shb-facts">' + confHtml + dur +
          (r.count > 1 ? '<span class="shb-of">' + (r.how === 'dur'
            ? 'closest length of ' + r.count + (c.rank > 1 ? ' · #' + c.rank + ' on StashDB' : '')
            : r.how === 'order'
            ? 'StashDB’s #' + c.rank + ' of ' + r.count + (r.best && r.best.stash_id !== c.stash_id
                ? ' · best match is #' + r.best.rank + (Number.isFinite(Number(r.best.confidence)) ? ' (' + Number(r.best.confidence).toFixed(0) + ')' : '')
                : ' · also the best match')
            : 'best of ' + r.count + (c.rank > 1 ? ' · #' + c.rank + ' on StashDB' : '')) + '</span>' : '') + '</div>';
    }
    // After matching (picker 15.38 / native 15.47): the suggested name.
    let ren = '';
    if (bulk && preAsk(bulk) && inPending(bulk, r) && r.sug) {
      // Before handing over (picker 15.76 / native 15.96): the name it would get.
      ren = '<span class="shb-ren"' + (bulk.ask === 'prepick' && !r.ren ? ' style="opacity:.45;text-decoration:line-through"' : '') +
            '>✎ → ' + esc(r.sug) + '</span>';
    } else if (r.st === 'done' || r.st === 'q') {
      if (r.rst === 'q') ren = '<span class="shb-ren">✎ Then renamed to ' + esc(r.newName || r.sug || '') + '</span>';
      else if (r.rst === 'renamed') ren = '<span class="shb-ren ok">✎ Renamed to ' + esc(r.newName || '') + '</span>';
      else if (r.rst === 'renaming') ren = '<span class="shb-ren">✎ Renaming…</span>';
      else if (r.rst === 'rfail') ren = '<span class="shb-ren bad">✎ Rename failed' + (r.rnote ? ': ' + esc(r.rnote) : '') + '</span>';
      else if (r.sug) ren = '<span class="shb-ren">✎ → ' + esc(r.sug) + '</span>';
    }
    const status = {
      wait: '<span class="shb-st">Waiting…</span>',
      fp: '<span class="shb-st">Checking the fingerprint…</span>',
      search: '<span class="shb-st">Searching StashDB by name…</span>',
      none: '<span class="shb-st">Nothing on StashDB for its name.</span>',
      err: '<span class="shb-st bad">⚠️ ' + esc(r.note) + '</span>',
      fpmatch: '<span class="shb-st good">✅ Matched by fingerprint' + (r.scene && r.scene.title ? ': ' + esc(r.scene.title) : '') + '</span>',
      sub: '<span class="shb-st">Submitting…</span>',
      q: '<span class="shb-st">⏳ Queued on the server - it carries on if you close this</span>',
      done: '<span class="shb-st good">✅ Matched' + (r.note ? ' - ' + esc(r.note) : '') + '</span>',
      fail: '<span class="shb-st bad">⚠️ Couldn’t submit: ' + esc(r.note) + '</span>',
      found: ''
    }[r.st] || '';
    return '<div class="shb-row st-' + r.st + (r.tick || (renPick && r.ren) ? ' on' : '') + (renPick ? ' pick' : '') + '" data-r="' + i + '" style="order:' + bulkRank(r) + '">' +
      '<span class="shb-tick">' + (renPick ? (r.ren ? '☑' : '☐') : tickable ? (r.tick ? '☑' : '☐') : (r.st === 'done' || r.st === 'fpmatch' ? '✅' : '')) + '</span>' +
      '<div class="shb-main">' + file + body + status + ren + '</div>' +
      '<div class="shb-btns">' +
        (r.st !== 'done' && r.st !== 'fpmatch' && r.st !== 'sub' && r.st !== 'q'
          ? '<button type="button" class="shb-hunt" data-hunt="' + i + '" title="Its full Stash details - then back to the bulk check">🔎</button>' : '') +
        '<button type="button" class="shb-hunt shb-pv" data-pv="' + i + '" title="Preview in the player">▶</button>' +
      '</div>' +
    '</div>';
  }

  function paintBulk() {
    const B = bulk;
    const sheet = document.getElementById('stashHuntBulk');
    if (!B || !sheet) return;
    const done = B.rows.filter(r => !['wait', 'fp', 'search'].includes(r.st)).length;
    const found = B.rows.filter(r => r.card).length;
    const fp = B.rows.filter(r => r.st === 'fpmatch').length;
    const ticked = B.rows.filter(r => r.tick && (r.st === 'found' || r.st === 'fail')).length;
    sheet.querySelector('.shb-head').innerHTML =
      '<span>' + (B.running ? 'Checked ' + done + ' of ' + B.rows.length : 'Checked ' + done + ' of ' + B.rows.length) +
        ' · ' + found + ' with a likely scene' + (fp ? ' · ' + fp + ' matched by fingerprint' : '') +
        (B.extra ? ' · searched with + <b>' + esc(B.extra) + '</b>' : '') + '</span>' +
      (B.running ? '<button type="button" data-b="stop">Stop</button>' : '') +
      // The rest of the scope, 60 at a time (picker 15.61 / native 15.72).
      (bulkRest(B).length && !B.running && !B.submitting && !B.renaming
        ? '<button type="button" data-b="more" class="more">+ Next ' + Math.min(BULK_MAX, bulkRest(B).length) +
          ' <small>(' + bulkRest(B).length.toLocaleString() + ' more)</small></button>' : '');
    sheet.querySelectorAll('.shb-seg button').forEach(x => {
      const k = x.dataset.b;
      x.classList.toggle('on', k === 'omatch' || k === 'oorder' || k === 'odur'
        ? ({ omatch: 'match', oorder: 'order', odur: 'dur' })[k] === bulkOrder()
        : ({ sfile: '', sconf: 'conf', sdur: 'dur' })[k] === ((S && S.bulkSort) || ''));
    });
    const t90 = sheet.querySelector('[data-b="t90"]');
    if (t90) {
      const hi = bulkHigh(B);
      const all = hi.length && hi.every(r => r.tick);
      t90.textContent = (all ? '☐ Untick ' : '☑ Tick ') + bulkMin() + '+ (' + hi.length + ')';
      t90.disabled = !hi.length || B.submitting || B.renaming || preAsk(B);
    }
    const go = sheet.querySelector('[data-b="match"]');
    const P = B.prog;
    const pct = P && P.total ? Math.round(100 * P.done / P.total) : 0;
    go.textContent = B.submitting
      ? (P && P.what === 'queue' ? 'Handing over…' : P && P.finishing ? 'Finishing…' : 'Matching… ' + pct + '%')
      : '✓ Match ticked' + (ticked ? ' (' + ticked + ')' : '');
    // How far Match ticked / the renaming has got (picker 15.51 / native 15.62).
    const bar = sheet.querySelector('.shb-prog');
    if (bar) {
      bar.hidden = !P;
      if (P) {
        bar.innerHTML = '<div class="shb-prog-bar"><i style="width:' + (P.finishing ? 100 : pct) + '%"></i></div>' +
          '<div class="shb-prog-t">' + (P.what === 'rename' ? '✎ Renaming' : P.what === 'server' ? '🎯 On the server' : P.what === 'queue' ? '🎯 Handing over' : '✓ Matching') +
            ' · <b>' + (P.finishing ? 100 : pct) + '%</b> · ' +
            P.done + ' of ' + P.total + (P.fail ? ' · <span class="bad">' + P.fail + ' failed</span>' : '') +
            (P.finishing ? ' · updating names…' : '') + '</div>';
      }
    }
    go.disabled = !ticked || B.submitting || B.renaming || preAsk(B);
    sheet.querySelector('[data-b="close"]').disabled = B.submitting || B.renaming;
    const again = sheet.querySelector('[data-b="again"]');
    if (again) again.disabled = !!(B.running || B.submitting || B.renaming);
    // Rename the ones just matched? (picker 15.38 / native 15.47)
    const ask = sheet.querySelector('.shb-ask');
    const can = B.rows.filter(r => r.st === 'done' && r.sug && !r.rst);
    if (preAsk(B)) {
      // Asked BEFORE matching now (picker 15.76 / native 15.96): the match and
      // the rename go to the server together, so the names are settled first -
      // from the scene each file is being matched to.
      const pend = B.pending || [];
      const named = pend.filter(r => r.sug);
      ask.hidden = false;
      if (B.ask === 'prepick') {
        const n = named.filter(r => r.ren).length;
        ask.innerHTML = '<span>Tap the ones to rename as well.</span>' +
          '<button type="button" data-b="qback">Back</button>' +
          '<button type="button" data-b="qgo" class="go">✓ Match ' + pend.length + (n ? ' · ✎ rename ' + n : '') + '</button>';
      } else {
        ask.innerHTML = '<span>Match ' + plural(pend.length, 'file') + ' - and rename ' +
            (named.length === pend.length ? (pend.length === 1 ? 'it' : 'them') : named.length + ' of them') +
            ' to ' + (named.length === 1 ? 'its' : 'their') + ' suggested name' + (named.length === 1 ? '' : 's') + '?</span>' +
          '<button type="button" data-b="qall" class="go">All</button>' +
          '<button type="button" data-b="qpick">Choose</button>' +
          '<button type="button" data-b="qnone">Match only</button>' +
          '<button type="button" data-b="qback">Back</button>';
      }
    } else if (!B.ask || (!can.length && !B.renaming)) {
      ask.hidden = true;
      if (B.ask && !B.renaming) B.ask = null;
    } else if (B.renaming) {
      ask.hidden = false;
      ask.innerHTML = '<span>✎ Renaming…' + (B.prog ? ' ' + B.prog.done + ' of ' + B.prog.total : '') + '</span>';
    } else if (B.ask === 'pick') {
      const n = can.filter(r => r.ren).length;
      ask.hidden = false;
      ask.innerHTML = '<span>Tap the ones to rename to their suggested names.</span>' +
        '<button type="button" data-b="rnone">Skip</button>' +
        '<button type="button" data-b="rgo" class="go"' + (n ? '' : ' disabled') + '>✎ Rename ' + (n ? n : '') + '</button>';
    } else {
      ask.hidden = false;
      ask.innerHTML = '<span>Rename the ' + plural(can.length, 'file') + ' just matched to ' + (can.length === 1 ? 'its' : 'their') + ' suggested name' + (can.length === 1 ? '' : 's') + '?</span>' +
        '<button type="button" data-b="rall" class="go">All</button>' +
        '<button type="button" data-b="rpick">Choose</button>' +
        '<button type="button" data-b="rnone">None</button>';
    }
  }
  function paintBulkRow(r) {
    const B = bulk;
    const i = B ? B.rows.indexOf(r) : -1;
    const el = i >= 0 && document.querySelector('#stashHuntBulk .shb-row[data-r="' + i + '"]');
    if (el) el.outerHTML = bulkRowHtml(r, i);
    paintBulk();
  }

  async function bulkOne(B, r) {
    if (r.fpDone) return bulkName(B, r);
    r.st = 'fp'; paintBulkRow(r);
    // 1. The fingerprint, as opening the modal would ask it.
    try {
      const res = await api('stash_scene', { method: 'POST', body: { video_key: r.key, force: false } });
      if (bulk !== B) return;
      if (res && res.stash_id) {
        r.st = 'fpmatch';
        r.scene = res.scene || { id: res.stash_id };
        tookMatch(r.v, r.key, r.scene, 'fingerprint');
        paintBulkRow(r);
        return;
      }
    } catch (e) { /* the name can still find it */ }
    r.fpDone = true;
    if (bulk !== B || B.stop) { r.st = 'wait'; paintBulkRow(r); return; }
    return bulkName(B, r);
  }

  async function bulkName(B, r) {
    // 2. Its name, scored against the file.
    r.st = 'search'; paintBulkRow(r);
    // The file's own words, plus any added for every search (15.40); the
    // score is still measured against the file's words alone.
    const own = huntWords(r.v);
    const term = B.extra ? (own + ' ' + B.extra).trim() : own;
    try {
      // Scored against the file's own words - not names carried from the folder (picker 15.49 / native 15.60).
      const res = await api('stash_nav', { method: 'POST', body: { op: 'search', term, video_key: r.key, score_term: baseWords(r.v) } });
      if (bulk !== B) return;
      const scenes = (res && res.scenes) || [];
      r.count = scenes.length;
      r.scenes = scenes;
      r.best = bestOf(scenes);
      r.how = bulkOrder();
      r.card = pickCard(scenes);
      r.st = r.card ? 'found' : 'none';
    } catch (e) {
      if (bulk !== B) return;
      r.st = 'err';
      r.note = (e && e.message) || String(e);
    }
    paintBulkRow(r);
  }

  async function runBulk(B, rows) {
    const list = rows || B.rows;
    let next = 0;
    B.running = true;
    B.stop = false;
    paintBulk();
    const worker = async () => {
      while (bulk === B && !B.stop && S && next < list.length) {
        const r = list[next++];
        await bulkOne(B, r);
      }
    };
    await Promise.all(Array.from({ length: BULK_PAR }, worker));
    if (bulk !== B) return;
    B.running = false;
    paintBulk();
    if (S) paintBar();
  }

  // ---- Match + rename on the server (picker 15.76 / native 15.96) -----------
  // Match ticked hands the files to api.php's hunt job (scray-hunt-jobs.js
  // shows its progress, minimised to a pill), so it carries on with the sheet
  // closed and the app closed. The names are worked out first, from the scene
  // each file is being matched to (scrayCleanNameSuggestionFor - the same rule
  // and the same name as after the match), and the rename question is asked
  // before handing over. A server without hunt jobs gets the old way below.
  const preAsk = (B) => !!B && (B.ask === 'pre' || B.ask === 'prepick');
  const inPending = (B, r) => !!(B && B.pending && B.pending.includes(r));

  async function queueBulk(list, renames) {
    const B = bulk;
    if (!B || B.submitting) return;
    B.ask = null;
    B.submitting = true;
    B.prog = { what: 'queue', done: 0, total: list.length, fail: 0 };
    B.rows.forEach(r => paintBulkRow(r));
    const local = v => (typeof window.isLocalVideo === 'function' ? !!window.isLocalVideo(v) : v && v.driveId === 'local');
    const items = [];
    for (const r of list) {
      const v = r.v;
      const ren = renames.includes(r) && !!r.sug;
      const phone = local(v);
      let also = [];
      // Native: the box copy linked to a phone file is renamed with it, as the
      // rename modal does (native 15.11).
      if (ren && phone && typeof window.scrayHetznerLinkedCopies === 'function') {
        try { also = (await window.scrayHetznerLinkedCopies(v)).map(h => ({ video_key: keyOf(h), local_id: h.oneDriveId || null })); } catch (e) { also = []; }
      }
      items.push({ video_key: r.key, filename: v.filename || '', stash_id: r.card.stash_id,
                   new_name: ren ? r.sug : null, local_id: v.oneDriveId || v.idFromAPI || null, phone, also });
    }
    let job = null;
    try {
      job = await window.scrayHuntJobs.start(items);
    } catch (err) {
      B.submitting = false;
      B.prog = null;
      if (err && err.unsupported) {
        // An older api.php: match here, one at a time, as before.
        B.noServer = true;
        B.pending = null;
        paintBulk();
        return submitBulk();
      }
      toast('⚠️ Couldn’t hand the files to the server: ' + ((err && err.message) || err), '#b8860b');
      B.pending = null;
      B.rows.forEach(r => paintBulkRow(r));
      return;
    }
    if (bulk !== B) return;
    B.jobs = B.jobs || new Set();
    B.jobs.add(job.job_id);
    list.forEach((r, i) => {
      r.job = job.job_id; r.jobIdx = i;
      r.st = 'q'; r.tick = false; r.note = '';
      r.rst = renames.includes(r) && r.sug ? 'q' : null;
      r.newName = r.rst ? r.sug : '';
      r.ren = false;
    });
    B.pending = null;
    B.submitting = false;
    B.prog = { what: 'server', done: 0, total: list.length, fail: 0 };
    B.rows.forEach(r => paintBulkRow(r));
    paintBulk();
    if (S) paintBar();
    toast('🎯 ' + plural(list.length, 'file') + ' handed to the server - close this whenever you like');
  }

  /** The hunt job's answers, onto this sheet's rows (scray-hunt-jobs.js sends them). */
  function onHuntJobs(e) {
    const B = bulk;
    if (!B || !B.jobs || !B.jobs.size) return;
    const jobs = ((e && e.detail && e.detail.jobs) || []).filter(j => B.jobs.has(j.job_id));
    if (!jobs.length) return;
    let total = 0, done = 0, fail = 0, liveAny = false;
    for (const j of jobs) {
      if (j.state === 'queued' || j.state === 'running') liveAny = true;
      for (const it of j.items || []) {
        const r = B.rows.find(x => x.job === j.job_id && x.jobIdx === it.idx);
        if (!r) continue;
        total++;
        const was = r.st + '|' + r.rst;
        if (it.match_st === 'done' && r.st !== 'done') {
          r.st = 'done';
          r.note = it.note || '';
          tookMatch(r.v, r.key, cardScene(r.card), 'bulk');
        } else if (it.match_st === 'failed') {
          r.st = 'fail'; r.note = it.note || 'failed';
        } else if (it.match_st === 'cancelled') {
          r.st = 'found'; r.rst = null; r.job = null;
        }
        if (it.rename_st === 'done' && r.rst !== 'renamed') {
          const oldKey = r.key;
          r.rst = 'renamed';
          r.newName = it.new_filename || r.newName;
          if (it.new_key) {
            Object.assign(r.v, { videoKey: it.new_key });
            if (!it.phone) r.v.filename = it.new_filename || r.v.filename;
            renamedFile(r.v, oldKey);
            r.key = it.new_key;
          }
        } else if (it.rename_st === 'failed') {
          r.rst = 'rfail'; r.rnote = it.rnote || '';
        } else if (it.rename_st === 'skipped' || it.rename_st === 'cancelled') {
          if (r.rst === 'q') r.rst = null;
        }
        const finished = it.match_st !== 'pending' && it.rename_st !== 'pending';
        if (finished) done++;
        if (it.match_st === 'failed' || it.rename_st === 'failed') fail++;
        if (was !== r.st + '|' + r.rst) paintBulkRow(r);
      }
    }
    B.prog = liveAny ? { what: 'server', done, total, fail } : null;
    paintBulk();
    if (S) paintBar();
  }
  window.addEventListener('scray-hunt-jobs', onHuntJobs);

  async function submitBulk() {
    const B = bulk;
    if (!B || B.submitting) return;
    const list = B.rows.filter(r => r.tick && r.card && (r.st === 'found' || r.st === 'fail'));
    if (!list.length) return;
    if (window.scrayHuntJobs && !B.noServer) {
      list.forEach(r => {
        try {
          r.sug = typeof window.scrayCleanNameSuggestionFor === 'function' ? window.scrayCleanNameSuggestionFor(r.v, r.card) : null;
        } catch (e) { r.sug = null; }
        r.ren = !!r.sug;
      });
      B.pending = list;
      if (!list.some(r => r.sug)) return queueBulk(list, []);
      B.ask = 'pre';
      B.rows.forEach(r => paintBulkRow(r));
      paintBulk();
      return;
    }
    B.submitting = true;
    B.prog = { what: 'match', done: 0, total: list.length, fail: 0 };
    list.forEach(r => paintBulkRow(r));
    let ok = 0;
    // One at a time, each exactly what Accept & submit sends for that file.
    for (const r of list) {
      if (bulk !== B || !S) break;
      r.st = 'sub'; paintBulkRow(r);
      try {
        const res = await api('stash_submit', { method: 'POST', body: { video_key: r.key, stash_id: r.card.stash_id } });
        r.st = 'done';
        r.tick = false;
        r.note = res && res.note && /refused|could not|locally/i.test(res.note) ? 'stored locally' : '';
        tookMatch(r.v, r.key, cardScene(r.card), 'bulk');
        ok++;
      } catch (e) {
        r.st = 'fail';
        r.note = (e && e.message) || String(e);
        B.prog.fail++;
      }
      B.prog.done++;
      paintBulkRow(r);
    }
    // Names and the S button next: a moment more, and it says so.
    B.prog.finishing = true;
    paintBulk();
    // Names and the S button, once for the lot.
    try { if (window.scrayStashNames) await window.scrayStashNames.refresh(true); } catch (e) { /* lists catch up */ }
    try { if (typeof window.scrayLoadStashState === 'function') await window.scrayLoadStashState(true); } catch (e) { /* S catches up */ }
    B.submitting = false;
    B.prog = null;
    // The names are fresh now, so the suggestions are: ask about renaming.
    if (bulk === B) {
      B.rows.forEach(r => {
        if (r.st === 'done' && !r.rst && r.sug === undefined) {
          try { r.sug = window.scrayCleanNameSuggestion ? window.scrayCleanNameSuggestion(r.v) : null; } catch (e) { r.sug = null; }
        }
      });
      if (B.rows.some(r => r.st === 'done' && r.sug && !r.rst)) B.ask = 'ask';
      B.rows.forEach(r => paintBulkRow(r));
    }
    paintBulk();
    if (S) paintBar();
    if (ok) toast('✅ ' + plural(ok, 'file') + ' matched');
  }

  /** The suggested names, one file at a time, each as the rename modal would. */
  async function renameBulk(list) {
    const B = bulk;
    if (!B || B.renaming || !list.length) return;
    if (typeof window.showRenameModal !== 'function') { toast('⚠️ Renaming isn’t available here', '#b8860b'); return; }
    B.renaming = true;
    B.ask = 'ask';
    B.prog = { what: 'rename', done: 0, total: list.length, fail: 0 };
    paintBulk();
    let ok = 0;
    for (const r of list) {
      if (bulk !== B) break;
      r.rst = 'renaming';
      paintBulkRow(r);
      const oldKey = r.key;
      try {
        const res = await window.showRenameModal(r.v, { auto: 'suggested' });
        if (res && res.ok) {
          r.rst = 'renamed';
          r.newName = res.name || r.v.filename;
          renamedFile(r.v, oldKey);
          r.key = keyOf(r.v);
          ok++;
        } else {
          r.rst = 'rfail';
          r.rnote = (res && res.why) || '';
        }
      } catch (e) {
        r.rst = 'rfail';
        r.rnote = (e && e.message) || String(e);
      }
      if (r.rst === 'rfail') B.prog.fail++;
      B.prog.done++;
      paintBulkRow(r);
    }
    B.renaming = false;
    B.prog = null;
    B.ask = null;
    if (bulk === B) B.rows.forEach(r => { r.ren = false; if (r.st === 'done') paintBulkRow(r); });
    paintBulk();
    if (ok) toast('✎ ' + plural(ok, 'file') + ' renamed');
  }

  // ---- words for every search (picker 15.40 / native 15.49) --------------
  // The same suggestions the navigator offers one file at a time: the studio
  // and women of the hunt's last match, studio names the folder tags stand for
  // (manage-data's mapping), and the tags these files carry, commonest first.
  function bulkSuggestions(B) {
    const out = [], seen = new Set();
    const add = (name, kind, hunted) => {
      const n = String(name || '').trim(), k = lower(n);
      if (!n || seen.has(k)) return;
      seen.add(k);
      out.push({ name: n, kind, hunted });
    };
    if (lastStudio) add(lastStudio, 'studio', true);
    lastPerfs.forEach(n => add(n, 'perf', true));
    const counts = new Map();
    B.rows.forEach(r => {
      const v = r.v;
      // Not the top-level folder (picker 15.74 / native 15.89) - every file shares it, so as a word
      // it only ever made the search worse.
      const top = (window.scrayStashNav && typeof window.scrayStashNav.topFolderTags === 'function')
        ? window.scrayStashNav.topFolderTags(v) : new Set();
      [].concat(v.__huntTags || tagsOf(v), v.bracketTags || []).forEach(t => {
        const n = String(t || '').trim();
        if (n && !top.has(lower(n))) counts.set(n, (counts.get(n) || 0) + 1);
      });
    });
    const tags = [...counts.keys()];
    try {
      if (window.scrayStashNav && typeof window.scrayStashNav.studioSuggestions === 'function') {
        window.scrayStashNav.studioSuggestions(tags).forEach(n => add(n, 'studio', false));
      }
    } catch (e) { /* no name map yet */ }
    // ⚙️ How many of the files' own tags are offered.
    [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).forEach(([t]) => add(t, 'tag', false));
    return out;
  }
  const wordRe = (t) => new RegExp('(^|\\s)' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=\\s|$)', 'i');
  function paintBulkPills(sheet) {
    const box = sheet.querySelector('.shb-add');
    if (!box) return;
    sheet.querySelectorAll('.shb-pill').forEach(b => b.classList.toggle('on', wordRe(b.dataset.pill).test(box.value)));
  }
  /** Search all again with the words in the box: every row not already matched. */
  /** The scope's files not in the list yet, still unmatched (picker 15.61 / native 15.72). */
  function bulkRest(B) {
    if (!B || !B.all) return [];
    const have = new Set(B.rows.map(r => r.key));
    return B.all.filter(v => !have.has(keyOf(v)) && !matchedNow(v) && !(S && S.never.has(keyOf(v))));
  }
  /** The next 60 join the list and are checked; what's above stays as it is. */
  function moreBulk() {
    const B = bulk;
    const sheet = document.getElementById('stashHuntBulk');
    if (!B || !sheet || B.running || B.submitting || B.renaming) return;
    const add = bulkRest(B).slice(0, BULK_MAX).map(v => ({ v, key: keyOf(v), st: 'wait', card: null, note: '', tick: false, count: 0 }));
    if (!add.length) return;
    const start = B.rows.length;
    B.rows.push(...add);
    const list = sheet.querySelector('.shb-list');
    if (list) list.insertAdjacentHTML('beforeend', add.map((r, k) => bulkRowHtml(r, start + k)).join(''));
    const first = list && list.querySelector('.shb-row[data-r="' + start + '"]');
    if (first && !(S && (S.bulkSort === 'conf' || S.bulkSort === 'dur'))) { try { first.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (e) { /* fine */ } }
    runBulk(B, add);
  }

  function bulkAgain() {
    const B = bulk;
    const sheet = document.getElementById('stashHuntBulk');
    if (!B || !sheet || B.running || B.submitting || B.renaming) return;
    const box = sheet.querySelector('.shb-add');
    B.extra = box ? box.value.replace(/\s+/g, ' ').trim() : '';
    const rows = B.rows.filter(r => ['found', 'none', 'err', 'fail', 'wait'].includes(r.st));
    if (!rows.length) { toast('Nothing left to search again'); return; }
    rows.forEach(r => { r.card = null; r.tick = false; r.count = 0; r.note = ''; r.st = 'wait'; paintBulkRow(r); });
    try { box && box.blur(); } catch (e) { /* no keyboard */ }
    runBulk(B, rows);
  }

  function closeBulk() {
    const B = bulk;
    if (B && (B.submitting || B.renaming)) return;
    if (B) B.stop = true;
    bulk = null;
    document.getElementById('stashHuntBulk')?.remove();
    // A 🔎 look that never came back the usual way: the hunt's card returns.
    const aside = document.getElementById('stashModalHuntAside');
    if (aside) {
      aside.style.visibility = aside.dataset.shVis || '';
      if (!document.getElementById('stashModal')) aside.id = 'stashModal'; else aside.remove();
    }
    if (S) S.peek = null;
    if (!S) return;
    paintBar();
    // Carry on with the file on screen if it's still one to hunt; else the next.
    const c = S.cur;
    if (!c || !S.modal || !S.modal.isConnected || c.matched || matchedNow(c.video) || !inScope(c.video, S.scope)) advance();
  }

  function openBulk() {
    if (!S) return;
    if (!bulkable()) { toast('Pick a folder or a tag first - bulk check works on one of those'); return; }
    ensureCss();
    endPreview();
    const all = inScopeLeft();
    if (!all.length) { toast('Nothing unmatched left in this scope'); return; }
    if (bulk) bulk.stop = true;
    document.getElementById('stashHuntBulk')?.remove();
    const B = bulk = {
      rows: all.slice(0, BULK_MAX).map(v => ({ v, key: keyOf(v), st: 'wait', card: null, note: '', tick: false, count: 0 })),
      all,   // the whole scope, for + Next 60 (picker 15.61 / native 15.72)
      running: true, stop: false, submitting: false, extra: ''
    };
    const sugg = bulkSuggestions(B);
    const sheet = document.createElement('div');
    sheet.id = 'stashHuntBulk';
    sheet.innerHTML =
      '<div class="shb">' +
        '<h3>⚡ Bulk check · ' + esc(scopeLabel(S.scope)) + '</h3>' +
        '<div class="shb-note">' + (all.length > BULK_MAX ? 'The first ' + BULK_MAX + ' of ' + all.length.toLocaleString() + ' - + Next ' + BULK_MAX + ' adds more. ' : '') +
          'Tick the ones that are right, then Match ticked. The rest stay in the hunt.</div>' +
        '<div class="shb-terms">' +
          '<div class="shb-trow"><input class="shb-add" type="search" enterkeyhint="search" spellcheck="false" autocomplete="off" ' +
            'autocorrect="off" autocapitalize="off" placeholder="Add words to every search…">' +
            '<button type="button" data-b="again" class="again">Search all again</button></div>' +
          (sugg.length ? '<div class="shb-pills">' + sugg.map(x =>
            '<button type="button" class="shb-pill k-' + x.kind + '" data-pill="' + esc(x.name) + '" title="' +
              (x.hunted ? (x.kind === 'perf' ? 'In the hunt’s last match' : 'Studio of the hunt’s last match')
                        : x.kind === 'studio' ? 'Studio name mapped in manage-data' : 'A tag these files carry') + '">' +
              (x.hunted ? '🎯 ' : '') + esc(x.name) + '</button>').join('') + '</div>' : '') +
        '</div>' +
        '<div class="shb-order"><span>Each file shows its</span><div class="shb-seg">' +
          '<button type="button" data-b="omatch">Best match</button><button type="button" data-b="oorder">StashDB #1</button>' +
          '<button type="button" data-b="odur" title="The scene closest in length to the file">Closest length</button></div></div>' +
        '<div class="shb-order"><span>Sort</span><div class="shb-seg">' +
          '<button type="button" data-b="sfile">Files</button><button type="button" data-b="sconf">Confidence ↓</button>' +
          '<button type="button" data-b="sdur" title="Smallest file / scene length difference first">Duration diff ↑</button></div></div>' +
        '<div class="shb-order"><span>Tick all at</span><div class="shb-thr">' +
          '<button type="button" data-b="tdown" title="5 lower">−</button>' +
          '<input class="shb-min" type="number" inputmode="numeric" min="0" max="100" step="1" value="' + bulkMin() + '" aria-label="Confidence to tick from">' +
          '<button type="button" data-b="tup" title="5 higher">+</button></div>' +
          '<button type="button" data-b="t90" class="shb-t90">☑ Tick ' + bulkMin() + '+</button></div>' +
        '<div class="shb-head"></div>' +
        '<div class="shb-list">' + B.rows.map(bulkRowHtml).join('') + '</div>' +
        '<div class="shb-prog" hidden></div>' +
        '<div class="shb-ask" hidden></div>' +
        '<div class="shb-foot">' +
          '<button type="button" data-b="close">Close</button>' +
          '<button type="button" data-b="match" class="go">✓ Match ticked</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(sheet);
    clearOfDock(sheet, SHEET_PAD);
    const addBox = sheet.querySelector('.shb-add');
    addBox.addEventListener('input', () => paintBulkPills(sheet));
    // A mark typed in (picker 15.52 / native 15.63).
    const minBox = sheet.querySelector('.shb-min');
    if (minBox) {
      minBox.addEventListener('input', () => {
        const n = parseInt(minBox.value, 10);
        if (!Number.isFinite(n) || !S) return;
        S.bulkMin = Math.max(0, Math.min(100, n));
        paintBulk();
      });
      minBox.addEventListener('change', () => { minBox.value = String(bulkMin()); });
      minBox.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); minBox.blur(); } });
    }
    addBox.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); bulkAgain(); } });
    sheet.addEventListener('click', (e) => {
      if (bulk !== B) return;
      const b = e.target.closest('button');
      if (b && b.dataset.hunt != null) {
        // A look at the whole thing, then back here (picker 15.54 / native 15.65).
        e.stopPropagation();
        const r = B.rows[+b.dataset.hunt];
        if (!r || B.submitting || B.renaming) return;
        peekBulk(B, r, sheet);
        return;
      }
      if (b && b.dataset.pv != null) {
        // ▶ (picker 15.53 / native 15.64): the sheet steps aside while it plays.
        e.stopPropagation();
        const r = B.rows[+b.dataset.pv];
        // The sheet AND the hunt's card under it step aside (picker 15.55 / native 15.66),
        // so the player is what's on screen, as ▶ is elsewhere; Back to Stash brings both back.
        if (r && window.scrayStashNav && typeof window.scrayStashNav.preview === 'function') {
          window.scrayStashNav.preview(r.v, [sheet, S && S.modal].filter(Boolean));
        }
        return;
      }
      if (b && b.dataset.pill != null) {
        // A pill puts its words in the box, or takes them back out.
        e.stopPropagation();
        const t = b.dataset.pill;
        addBox.value = wordRe(t).test(addBox.value)
          ? addBox.value.replace(wordRe(t), ' ').replace(/\s+/g, ' ').trim()
          : (addBox.value.trim() + ' ' + t).trim();
        paintBulkPills(sheet);
        return;
      }
      if (b && b.dataset.b) {
        e.stopPropagation();
        if (b.dataset.b === 'again') { bulkAgain(); return; }
        if (b.dataset.b === 'more') { moreBulk(); return; }
        if (b.dataset.b === 'tdown' || b.dataset.b === 'tup') {
          // Steps of 5, onto the nearest 5 first (87 → 85 / 90).
          const m = bulkMin();
          S.bulkMin = b.dataset.b === 'tup' ? Math.min(100, Math.floor(m / 5) * 5 + 5) : Math.max(0, Math.ceil(m / 5) * 5 - 5);
          const inp = sheet.querySelector('.shb-min');
          if (inp) inp.value = String(S.bulkMin);
          paintBulk();
          return;
        }
        if (b.dataset.b === 't90') {
          // Every row to decide on whose shown scene scores 90+ - or, when
          // they all are already, untick them again.
          if (B.submitting || B.renaming) return;
          const hi = bulkHigh(B);
          const all = hi.length && hi.every(r => r.tick);
          hi.forEach(r => { r.tick = !all; paintBulkRow(r); });
          paintBulk();
          return;
        }
        if (b.dataset.b === 'sfile' || b.dataset.b === 'sconf' || b.dataset.b === 'sdur') {
          S.bulkSort = ({ sfile: '', sconf: 'conf', sdur: 'dur' })[b.dataset.b];
          B.rows.forEach(r => paintBulkRow(r));
          const list = sheet.querySelector('.shb-list');
          if (list) list.scrollTop = 0;
          return;
        }
        if (b.dataset.b === 'omatch' || b.dataset.b === 'oorder' || b.dataset.b === 'odur') {
          if (!B.submitting && !B.renaming) setBulkOrder(B, ({ omatch: 'match', oorder: 'order', odur: 'dur' })[b.dataset.b]);
          return;
        }
        if (b.dataset.b === 'stop') { B.stop = true; B.running = false; paintBulk(); }
        if (b.dataset.b === 'close') closeBulk();
        if (b.dataset.b === 'match') submitBulk();
        const can = () => B.rows.filter(r => r.st === 'done' && r.sug && !r.rst);
        if (b.dataset.b === 'rall') renameBulk(can());
        if (b.dataset.b === 'rpick') { B.ask = 'pick'; B.rows.forEach(r => paintBulkRow(r)); }
        if (b.dataset.b === 'rgo') renameBulk(can().filter(r => r.ren));
        if (b.dataset.b === 'rnone') { B.ask = null; B.rows.forEach(r => { r.ren = false; paintBulkRow(r); }); }
        // Before handing over (picker 15.76 / native 15.96).
        const pend = () => (B.pending || []);
        if (b.dataset.b === 'qall') queueBulk(pend(), pend().filter(r => r.sug));
        if (b.dataset.b === 'qnone') queueBulk(pend(), []);
        if (b.dataset.b === 'qpick') { B.ask = 'prepick'; B.rows.forEach(r => paintBulkRow(r)); }
        if (b.dataset.b === 'qgo') queueBulk(pend(), pend().filter(r => r.sug && r.ren));
        if (b.dataset.b === 'qback') { B.ask = null; B.pending = null; B.rows.forEach(r => { r.ren = false; paintBulkRow(r); }); }
        return;
      }
      const row = e.target.closest('.shb-row');
      if (!row || B.submitting || B.renaming) return;
      const r = B.rows[+row.dataset.r];
      if (r && B.ask === 'prepick' && inPending(B, r) && r.sug) {
        r.ren = !r.ren;
        paintBulkRow(r);
        paintBulk();
        return;
      }
      if (preAsk(B)) return;
      if (r && B.ask === 'pick' && r.st === 'done' && r.sug && !r.rst) {
        r.ren = !r.ren;
        paintBulkRow(r);
        return;
      }
      if (!r || !(r.st === 'found' || r.st === 'fail') || !r.card) return;
      r.tick = !r.tick;
      paintBulkRow(r);
    });
    paintBulk();
    runBulk(B);
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
      modalClearOfDock(modal);
      try { attachSwipe(modal); } catch (e) { console.error('[hunt] swipe:', e); }
    },
    loaded(matched, modal, scene) {
      if (!S || !S.cur || modal !== S.modal) return;
      const c = S.cur;
      // The studio it matched to, and its women: the next file is likely
      // from them too (picker 15.26 / 15.35).
      if (matched && scene) rememberScene(scene);
      // Into the recent matches: a new one, or this one again with other
      // details (a different scene accepted, say).
      if (matched && scene) {
        const had = matches.find(m => m.key === c.key);
        if (!c.matched || !had || had.id !== String(scene.id || '')) noteMatch(c.key, c.video, scene, c.loaded ? 'modal' : 'fingerprint');
      }
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
        forgetMatch(c.key);
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
    },
    renamed(video, oldKey) { renamedFile(video, oldKey); }
  };

  function optsFor(video) {
    if (!S || !video) return null;
    // A bulk row opened with 🔎 (picker 15.54 / native 15.65) gets the hunt's pills and order too.
    if (S.peek && (video === S.peek.video || keyOf(video) === S.peek.key)) return S.peek.handle;
    if (!S.cur) return null;
    return (video === S.cur.video || keyOf(video) === S.cur.key) ? handle : null;
  }

  // ---- 🔎 from the bulk check (picker 15.54 / native 15.65) -----------------
  // The row's file in the ordinary Stash modal - fingerprint lookup, the
  // search with every card, Accept & submit, details - while the bulk sheet
  // waits, hidden, still checking. Close or ⚡ Back to bulk brings it back.
  function peekBulk(B, r, sheet) {
    if (!S || bulk !== B) return;
    endPreview();
    // The hunt's own card stays where it is, under the sheet, out of the way:
    // showStashModal replaces whatever is #stashModal, so it steps out of that
    // name until the look is over (picker 15.55 / native 15.66).
    const main = document.getElementById('stashModal');
    if (main) {
      main.id = 'stashModalHuntAside';
      main.dataset.shVis = main.style.visibility || '';
      main.style.visibility = 'hidden';
    }
    const unAside = () => {
      const m = document.getElementById('stashModalHuntAside');
      if (!m) return;
      m.style.visibility = m.dataset.shVis || '';
      if (!document.getElementById('stashModal')) m.id = 'stashModal';
      else m.remove();   // something else took its place meanwhile
    };
    let leaving = false;
    const back = () => {
      if (S) S.peek = null;
      if (leaving) return;
      unAside();
      // The sheet never went anywhere; its rows catch up with the look.
      if (S && bulk === B && sheet.isConnected) B.rows.forEach(x => paintBulkRow(x));
    };
    const h = {
      mount(modal) {
        ensureCss();
        const i = B.rows.indexOf(r);
        const dir = r.v.__huntFolder || folderOf(r.v);
        const bar = document.createElement('div');
        bar.className = 'sh-bar sh-insp sh-peek';
        bar.innerHTML =
          '<div class="sh-top"><span class="sh-insp-l">⚡ From the bulk check · ' + (i + 1) + ' of ' + B.rows.length + '</span>' +
            '<button type="button" data-h="hunt" title="Leave the bulk check and hunt this file">🎯 Hunt it</button>' +
            '<button type="button" class="sh-back" data-h="back">✕ Back to bulk</button></div>' +
          '<div class="sh-file" data-hlk="' + esc(keyOf(r.v)) + '">' + fileLineHtml(r.v, null) + '</div>';
        bar.addEventListener('click', (e) => {
          const t = e.target.closest('[data-h]');
          if (!t) return;
          e.stopPropagation();
          if (t.dataset.h === 'back') {
            const cb = modal.querySelector('#stashCloseBtn');
            if (cb) cb.click();
          } else if (t.dataset.h === 'hunt') {
            // What 🔎 did before: the bulk check ends, and this file is the hunt's.
            leaving = true;
            S.peek = null;
            B.stop = true;
            bulk = null;
            sheet.remove();
            document.getElementById('stashModalHuntAside')?.remove();
            huntNow(r.v);
          }
        });
        const hh = modal.querySelector('h3');
        if (hh && hh.parentNode) hh.after(bar); else modal.firstElementChild.prepend(bar);
        modalClearOfDock(modal);
      },
      loaded(matched, modal, scene) {
        if (!S || bulk !== B) return;
        if (matched && scene && r.st !== 'done' && r.st !== 'fpmatch') {
          // Matched in there: the row says so, and the hunt counts it.
          r.st = 'done';
          r.tick = false;
          r.note = 'in the Stash modal';
          r.scene = scene;
          tookMatch(r.v, r.key, scene, 'modal');
        } else if (!matched && (r.st === 'done' || r.st === 'fpmatch') && r.note === 'in the Stash modal') {
          // ...and unmatched again before leaving.
          r.st = r.card ? 'found' : 'none';
          r.note = '';
          forgetMatch(r.key);
          S.stats.matched = Math.max(0, S.stats.matched - 1);
          if (!S.pool.includes(r.v)) S.pool.push(r.v);
        }
      },
      closed() { back(); },
      renamed(video, oldKey) {
        renamedFile(video, oldKey);
        r.key = keyOf(video);
        if (S && S.peek && S.peek.handle === h) S.peek.key = r.key;
      }
    };
    S.peek = { video: r.v, key: r.key, handle: h };
    // Opened after the sheet, at the same z-index, so it lands on top of it.
    window.showStashModal(r.v, { search: huntWords(r.v), hunt: h });
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
    if (bulk) bulk.stop = true;
    bulk = null;
    document.getElementById('stashHuntBulk')?.remove();
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
    // Clear of the corner-button dock, like every hunt sheet.
    clearOfDock(sheet, SHEET_PAD);

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
            '<button type="button" data-sh="bulk" class="bulk"' + ((draft.folders.length || draft.tags.length) && n ? '' : ' hidden') +
              ' title="Check all of them at once">⚡ Bulk</button>' +
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
      const bb = sheet.querySelector('[data-sh="bulk"]');
      if (bb) bb.hidden = !(draft.folders.length || draft.tags.length) || !n;
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
        case 'bulk':
          if (!(draft.folders.length || draft.tags.length)) break;
          setScope(draft);
          close();
          openBulk();
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
        setTimeout(() => toast('👆 Swipe ← for options, ⏭ Next among them · → recent files', '#6f42c1'), 1800);
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
    /** The navigator's cards for this file, to mark its name (picker 15.84 / native 15.102). */
    shown,
    /** The studio of the hunt's last match, for the hunt's own file only. */
    suggestStudio: (video) => (optsFor(video) ? lastStudio : ''),
    /** The female performer(s) of the hunt's last match, for its own file only. */
    suggestPerformers: (video) => (optsFor(video) ? lastPerfs.slice() : []),
    /** Names this file's folder carries into its search (picker 15.41 / native 15.52). */
    carried: (video) => (optsFor(video) ? carryOf(video).slice() : []),
    /** The search order picked this run ('' until one is picked). */
    searchSort: () => (S && S.sort) || '',
    setSearchSort: (v) => { if (S && (v === 'match' || v === 'order' || v === 'dur')) S.sort = v; },
    searched,
    /** Pin / unpin a name for the rest of the hunt's files (picker 15.74 / native 15.89). */
    pin, isPinned,
    openMatches, openBulk,
    isActive: () => !!S,
    _test: { inScope, scopeLabel, folderOf, tagsOf, keyOf, getSession: () => S, newSession, setSession: (s) => { S = s; }, buildPool, inScopeLeft,
             getMatches: () => matches.slice(), getBulk: () => bulk, bestOf, getLastPerformers: () => lastPerfs.slice(), SW, huntWords }
  };
})();

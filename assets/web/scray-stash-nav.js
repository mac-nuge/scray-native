// scray-stash-nav.js — the Stash modal's own StashDB navigator
// (picker 13.162 / native 13.161, needs browse 13.68's stash_nav action).
// picker 13.163 / native 13.162: path tags under the words box, a ▶ preview,
// a Google link on profiles, and scrayPerformerChoice for the list rows.
// picker 13.164 / native 13.163: Unblur all.
// picker 13.165 / native 13.164: a Google link on every scene card.
// native 13.189 (browse 13.74): "In library" on cards already matched to a
// file, and Back to Stash sits just above the video when it was already playing.
// native 13.190 / picker 13.189: In library opens the file in Picker - from
// Native through the in-app browser (Picker's ?play=<video_key>), and inside
// Picker as a preview, the way ▶ previews this modal's own file.
// native 13.191 / picker 13.190: the studio search lifts itself clear of the
// keyboard, and In library shows on this modal's own file too.
// picker 14.6 / native 14.10 (browse 14.2): a studio view - profile, scenes
// newest first, a performer filter - opened from a studio name on any card,
// or from a studio chip's "Search in Stash nav".
// picker 14.7 / native 14.11 (browse 14.3): the profile dropdowns pick
// several - studios add together (any of them), performers intersect (all of
// them in the same scene).
// picker 14.10 / native 14.16 (browse 14.5): a parent studio's view lists
// the scenes of every studio under it, with a second dropdown to narrow to
// some of them; a performer's studio dropdown offers the parent networks too.
// picker 14.11 / native 14.17 (browse 14.6): in a performer's Studio dropdown
// each studio sits under its parent network, as on stashdb.org.
// picker 14.19 / native 14.31 (browse 14.36): one box at the top of every
// view that finds studios AND performers (stash_nav op 'find'), and a Stash
// button under the console that opens the navigator on its own, starting on
// just that box.
// picker 14.21-14.23 / native 14.33-14.35: the find list is one mixed list,
// coloured by kind: your catalogue's names first with Picker / Native counts
// (counted server-side), then StashDB on request.
// picker 14.24 / native 14.36 (browse 14.38): In library on every profile,
// plus Indexxx and Eporner links.
// picker 15.23 / native 15.32: 🎯 Stash hunt on the home view.
// picker 15.26 / native 15.35: the search view filters its results by studio
// and performer, Unblur all is a 👁 in the Search row, and in a hunt the ▶ goes
// (the hunt bar has one) and the studio of the hunt's last match is a pill.
// picker 15.27 / native 15.36: the result filters are searchable dropdowns
// like the profile views' (several picks each), and a studio pill offers
// Filter these results / Open the studio's page / Add to search words, and
// ▶ moves from the Search row to the footer, between Back and Close.
// picker 15.31 / native 15.40: every searchable dropdown has Done, beside its
// search box and under its list, to close it and bring the results back.
// picker 15.32 / native 15.41: a studio pill's Add to the search words runs
// the search straight away.
// picker 15.33 / native 15.42: "Take studio/performers" on every card - the
// studio and/or performers you tick go into this file's details
// (opts.onTake -> scrayStashEdit.take), for when StashDB hasn't got the video
// but has others from the same studio or with the same people.
// picker 15.35 / native 15.44: search results open in StashDB order (Best
// match is one tap away), and in a hunt the female performer(s) of its last
// match are pills too, with the same menu as a studio pill.
// picker 15.41 / native 15.52 (browse 15.89's scoring): a compact card -
// confidence, file and scene length, difference and cast shape in one row,
// then a big Accept & submit; the cast, the more-details and the other
// buttons under it. In a hunt, names carried from this folder's earlier
// searches are 📌 pills (tap to take out), and every search tells the hunt
// which studio / performer names were added to the words (hunt.searched).
// picker 15.43 / native 15.54: in a hunt, the search's order (StashDB order
// or Best match) sticks from file to file until the hunt is closed
// (hunt.searchSort / hunt.setSearchSort). StashDB order to start with.
// Identical in Picker and Native.
//
// stashdb.org is hard work on a phone, so searching and browsing happen inside
// the Stash modal instead:
//   - a search view: the words box (refine and re-run in place), then a long
//     list of scenes, each scored against this file the way bulk-stash's
//     filename search scores them - confidence, file vs scene length, the
//     difference, cast shape, performers;
//   - a performer view: the profile, then their scenes, newest first, with
//     the same cards. Any performer on any card opens one.
// Back walks the views; the first Back returns to the lookup panel as it was.
//
// Accepting a scene is the caller's job (stash_submit), passed in as
// onAccept(stashId). The navigator itself writes nothing anywhere.
//
// Usage: const ctl = window.scrayStashNav.open({
//            host, actions, heading, video, videoKey, canAccept,
//            start: { type: 'search', term } | { type: 'performer', id?, name, sceneId? }
//                   | { type: 'studio', id?, name, sceneId? },
//            openExternal(url), onAccept(stashId) -> Promise, onClose(),
//            onDone(result) });   // result: { accepted: stashId, response } or null
(function () {
  'use strict';

  const esc = (s) => String(s ?? '').replace(/[&<>"]/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const api = (action, opts) => window.scrayApiCall(action, opts || {});

  // ---- search words --------------------------------------------------------
  // "FreyaMayer_ANewStarHasRisen_1280x720_60fps" -> "Freya Mayer A New Star Has
  // Risen". CamelCase split first (an acronym meeting a word, then the plain
  // lower->Upper boundary), every separator that isn't a space becomes one,
  // and the technical tail goes - a resolution, frame rate or bitrate is never
  // in a scene title and only dilutes the search. Apostrophes stay: "Don't".
  function clean(text) {
    // Noise goes before the CamelCase split, or "4K" would come out "4 K".
    const noise = (t) => t
      .replace(/(^|\s)\d{3,4}\s*x\s*\d{3,4}(?=\s|$)/gi, ' ')
      .replace(/(^|\s)(?:\d{3,4}p|[48]k|\d{2,3}\s*fps|\d{3,5}\s*kbps)(?=\s|$)/gi, ' ');
    // A number stuck on the end of a word goes (picker 14.30 / native 14.44):
    // "radke2" and "remaster2" are this library's copy numbers, and a
    // performer or a title almost never carries one. Three letters at least,
    // so a code like "EP447" or "AA12" is left alone, and a word that is all
    // digits is left alone too - a year in a title is worth searching for.
    const unnumber = (t) => t.replace(/(\p{L}{3,})\d+(?=\s|$)/gu, '$1');
    return unnumber(noise(noise(String(text ?? '').replace(/[^\p{L}\p{N}'\s]+/gu, ' '))
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')))
      .replace(/\s+/g, ' ')
      .trim();
  }
  const words = (filename) => clean(String(filename ?? '').replace(/\.[a-z0-9]{1,5}$/i, ''));

  const clock = (n) => {
    n = Math.round(Number(n) || 0);
    if (!n) return '—';
    const h = Math.floor(n / 3600), m = Math.floor((n % 3600) / 60), s = n % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(s).padStart(2, '0');
  };

  // ---- styles --------------------------------------------------------------
  // Scoped under #stashModal, which outranks the mobile `button, input
  // { width:100%; padding:12px }` rule without any !important.
  function ensureCss() {
    if (document.getElementById('scrayStashNavCss')) return;
    const css = document.createElement('style');
    css.id = 'scrayStashNavCss';
    css.textContent = `
#stashModal .ssn { font-size: .9rem; text-align: left; }
#stashModal .ssn button { width: auto; min-width: 0; margin: 0; padding: 6px 12px; font-size: .8rem; line-height: 1.2; border: 1px solid #ccc; border-radius: 6px; background: #f4f4f6; color: #222; cursor: pointer; white-space: nowrap; }
#stashModal .ssn button:disabled { opacity: .5; cursor: default; }
#stashModal .ssn-refine { position: sticky; top: 0; z-index: 2; background: #fff; padding: 0 0 8px; border-bottom: 1px solid rgba(128,128,128,.2); margin-bottom: 8px; }
#stashModal .ssn input.ssn-term { display: block; width: 100%; box-sizing: border-box; margin: 0 0 6px; padding: 7px 9px; font-size: 14px; border: 1px solid #ccc; border-radius: 6px; background: #fff; color: inherit; -webkit-appearance: none; appearance: none; }
#stashModal .ssn-finder { position: relative; margin: 0 0 10px; }
#stashModal .ssn input.ssn-find-box { display: block; width: 100%; box-sizing: border-box; margin: 0; padding: 8px 10px; font-size: 15px; border: 1px solid #ccc; border-radius: 8px; background: #fff; color: inherit; -webkit-appearance: none; appearance: none; }
#stashModal .ssn input.ssn-find-box:focus { outline: none; border-color: #8b7cf0; box-shadow: 0 0 0 2px rgba(139,124,240,.25); }
#stashModal .ssn-find-list { margin-top: 4px; background: #fff; border: 1px solid #ccc; border-radius: 8px; box-shadow: 0 6px 16px rgba(0,0,0,.12); max-height: 55vh; overflow-y: auto; -webkit-overflow-scrolling: touch; }
#stashModal .ssn-find-list:empty { display: none; }
#stashModal .ssn-find-head { padding: 5px 10px; font-size: .68rem; letter-spacing: .07em; text-transform: uppercase; color: #777; background: #f6f6f8; border-bottom: 1px solid #eee; }
#stashModal .ssn .ssn-find-opt { display: flex; width: 100%; justify-content: space-between; align-items: baseline; gap: 8px; border: none; border-bottom: 1px solid #f0f0f0; border-radius: 0; background: transparent; padding: 9px 10px; font-size: .88rem; text-align: left; white-space: normal; }
#stashModal .ssn .ssn-find-opt.first { background: #f7f7f9; }
#stashModal .ssn .ssn-find-opt.is-performer { border-left: 4px solid #d63384; }
#stashModal .ssn .ssn-find-opt.is-studio { border-left: 4px solid #0b7fd7; }
#stashModal .ssn-find-opt .k { font-size: .72rem; color: #888; flex: 0 0 auto; }
#stashModal .ssn-find-opt .cnt { display: block; margin-top: 2px; font-size: .72rem; font-weight: 600; color: #1e7e34; }
#stashModal .ssn-find-opt .kind { flex: 0 0 auto; font-size: .68rem; font-weight: 600; padding: 2px 7px; border-radius: 10px; }
#stashModal .ssn-find-opt.is-performer .kind { background: #fde8f1; color: #b0226a; }
#stashModal .ssn-find-opt.is-studio .kind { background: #e3f1fd; color: #0a66b0; }
#stashModal .ssn .ssn-find-global { display: block; width: 100%; border: none; border-top: 1px dashed #ccc; border-radius: 0; background: #fafafa; color: #5b4bc4; padding: 10px; font-size: .84rem; text-align: center; }
#stashModal .ssn-find-note { padding: 9px 10px; font-size: .82rem; color: #777; }
#stashModal .ssn-home { padding: 14px 4px; color: #888; font-size: .85rem; }
#stashModal .ssn input.ssn-term:focus { outline: none; border-color: #8b7cf0; box-shadow: 0 0 0 2px rgba(139,124,240,.25); }
#stashModal .ssn-btns { display: flex; gap: 6px; flex-wrap: wrap; }
#stashModal .ssn-ptags { display: flex; flex-wrap: wrap; gap: 5px; margin: 0 0 7px; }
#stashModal .ssn-ptags:empty { display: none; }
#stashModal .ssn .ssn-ptag { padding: 2px 9px; border-radius: 12px; border: 1px solid #b9d4f5; background: #eaf3ff; color: #0b5ed7; font-size: .76rem; }
#stashModal .ssn .ssn-ptag.on { background: #28a745; border-color: #28a745; color: #fff; }
#stashModal .ssn .ssn-ptag.ssn-ptag-studio:not(.on) { border-color: #cbbef5; background: #f3efff; color: #5b3fd1; }
#stashModal .ssn .ssn-play { padding: 6px 11px; }
#stashModal .ssn .ssn-unblur { margin-left: auto; }
#stashModal .ssn .ssn-eye { margin-left: auto; padding: 6px 10px; font-size: .95rem; line-height: 1; }
#stashModal .ssn-rf-row { display: flex; gap: 6px; align-items: center; }
#stashModal .ssn .ssn-rf-row .ssn-studio-btn { flex: 1 1 0; }
#stashModal .ssn .ssn-rf-row .ssn-rf-x { flex: 0 0 auto; padding: 6px 9px; }
#stashModal .ssn .ssn-ptag.filt { box-shadow: 0 0 0 2px #6c5ce7; }
#ssnPillMenu .ssn-pm-note { margin: -4px 0 10px; font-size: .8rem; color: #777; }
#stashModal .ssn .ssn-ptag.ssn-ptag-hunt:not(.on) { border-color: #9bd8a8; background: #eaf7ee; color: #1e7e34; font-weight: 600; }
#stashModal .ssn .ssn-ptag.ssn-ptag-perf:not(.on) { border-color: #f1a7c9; background: #fdf0f6; color: #b0246a; }
#stashModal .ssn-rf-none { padding: 10px 4px; font-size: .84rem; color: #666; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
#stashModal .ssn .ssn-google.ssn-google-card { margin-left: 0; padding: 6px 12px; font-size: .8rem; }
#stashModal .ssn .ssn-lib { background: #28a745; border-color: #28a745; color: #fff; }
#stashModal .ssn-topbar { justify-content: flex-end; margin: 0 0 8px; }
#stashModal .ssn .ssn-libf { border-color: #28a745; color: #1e7e34; background: #fff; font-weight: 600; }
#stashModal .ssn .ssn-libf.on { background: #28a745; color: #fff; }
#stashModal .ssn .ssn-google { padding: 1px 7px; margin-left: 6px; font-size: .7rem; font-weight: 400; vertical-align: middle; background: transparent; color: #1a73e8; border-color: rgba(26,115,232,.4); }
#stashModal .ssn-btns button[data-go] { background: #6c5ce7; border-color: #6c5ce7; color: #fff; }
#stashModal .ssn-state { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: .78rem; opacity: .8; margin: 0 0 8px; }
#stashModal .ssn-state .ssn-err { color: #dc3545; opacity: 1; }
#stashModal .ssn-sort { display: inline-flex; border: 1px solid #ccc; border-radius: 6px; overflow: hidden; margin-left: auto; }
#stashModal .ssn .ssn-sort button { border: none; border-radius: 0; padding: 4px 9px; font-size: .74rem; background: transparent; }
#stashModal .ssn .ssn-sort button.on { background: #6c5ce7; color: #fff; }
#stashModal .ssn-empty { padding: 14px 4px; opacity: .7; text-align: center; }
#stashModal .ssn-card { border: 1px solid #e1e1e8; border-radius: 8px; padding: 10px; margin: 0 0 10px; background: #fff; }
#stashModal .ssn-card.ssn-busy { opacity: .6; }
#stashModal .ssn-top { display: flex; gap: 10px; align-items: flex-start; margin-bottom: 8px; }
#stashModal .ssn-tt { flex: 1 1 auto; min-width: 0; }
#stashModal .ssn-title { font-weight: 600; font-size: .95rem; line-height: 1.25; overflow-wrap: anywhere; }
#stashModal .ssn-sub { font-size: .76rem; opacity: .7; margin-top: 2px; overflow-wrap: anywhere; }
#stashModal .ssn-conf { color: #dc3545; line-height: 1; margin-top: 5px; }
#stashModal .ssn-conf b { font-size: 1.25rem; font-variant-numeric: tabular-nums; }
#stashModal .ssn-conf small { font-size: .56rem; letter-spacing: .08em; opacity: .75; }
#stashModal .ssn-conf.mid { color: #b8860b; }
#stashModal .ssn-conf.good { color: #1e7e34; }
#stashModal .ssn-cover { position: relative; overflow: hidden; border-radius: 6px; margin: 0 0 8px; aspect-ratio: 16 / 9; background: #222; cursor: pointer; user-select: none; -webkit-user-select: none; -webkit-tap-highlight-color: transparent; }
#stashModal .ssn-cover img { display: block; width: 100%; height: 100%; object-fit: cover; filter: blur(28px); transform: scale(1.15); }
#stashModal .ssn-cover.shown img { filter: none; transform: none; }
#stashModal .ssn-veil { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #fff; font-size: .75rem; background: rgba(0,0,0,.45); text-align: center; padding: 6px; }
#stashModal .ssn-cover.shown .ssn-veil { display: none; }
#stashModal .ssn-thumb { flex: 0 0 40%; width: 40%; margin: 0; }
#stashModal .ssn-cover.none { display: flex; align-items: center; justify-content: center; background: #eee; color: #999; font-size: .7rem; cursor: default; }
#stashModal .ssn .ssn-extsm { padding: 2px 8px; font-size: .72rem; }
#stashModal .ssn-facts { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin: 0 0 8px; }
/* picker 15.41 / native 15.52: a result card's five facts in one row. */
#stashModal .ssn-facts.ssn-facts5 { grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 4px; }
#stashModal .ssn-facts5 .ssn-fact { padding: 4px 3px; text-align: center; }
#stashModal .ssn-facts5 .ssn-fact span { font-size: .55rem; letter-spacing: .04em; }
#stashModal .ssn-facts5 .ssn-fact b { font-size: .8rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#stashModal .ssn-facts5 .ssn-fact.gm b { white-space: normal; overflow-wrap: anywhere; font-size: .74rem; }
#stashModal .ssn-fact.ssn-cf b { font-size: 1.05rem; color: #dc3545; }
#stashModal .ssn-fact.ssn-cf.mid b { color: #b8860b; }
#stashModal .ssn-fact.ssn-cf.good b { color: #1e7e34; }
#stashModal .ssn-fact.ssn-cf.good { background: #eaf7ee; border-color: #9bd8a8; }
#stashModal .ssn-fact.spot { background: #eaf7ee; border-color: #9bd8a8; }
#stashModal .ssn .ssn-accept.ssn-accept-big { display: block; width: 100%; margin: 0 0 8px; padding: 11px 12px; font-size: 1rem; font-weight: 700; border-radius: 8px; box-shadow: 0 2px 6px rgba(40,167,69,.3); }
#stashModal .ssn .ssn-ptag.ssn-ptag-carry:not(.on) { border-color: #f0c36d; background: #fff8e6; color: #8a6100; }
#stashModal .ssn .ssn-ptag.ssn-ptag-carry.on { background: #e0a800; border-color: #e0a800; color: #fff; }
#stashModal .ssn-fact { border: 1px solid #e6e6ec; border-radius: 6px; padding: 5px 7px; min-width: 0; }
#stashModal .ssn-fact span { display: block; font-size: .6rem; letter-spacing: .06em; opacity: .6; text-transform: uppercase; }
#stashModal .ssn-fact b { display: block; font-size: .85rem; font-weight: 600; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
#stashModal .ssn-fact.okv b { color: #1e7e34; }
#stashModal .ssn-fact.warnv b { color: #dc3545; }
#stashModal .ssn-fact.gm b { color: #b8860b; }
#stashModal .ssn-cast { display: flex; flex-wrap: wrap; gap: 5px; margin: 0 0 8px; }
#stashModal .ssn .ssn-perf { padding: 3px 9px; border-radius: 12px; border: none; background: #efe9fb; font-size: .78rem; color: #3d2f9a; }
#stashModal .ssn .ssn-perf.here { background: #6c5ce7; color: #fff; }
#stashModal .ssn-perf small { opacity: .65; }
#stashModal .ssn-more { font-size: .78rem; margin: 0 0 8px; }
#stashModal .ssn-more summary { cursor: pointer; opacity: .75; }
#stashModal .ssn-tags { display: flex; flex-wrap: wrap; gap: 4px; margin: 6px 0; }
#stashModal .ssn-tags span { background: #eef1f4; border-radius: 10px; padding: 1px 7px; white-space: nowrap; }
#stashModal .ssn-syn { opacity: .85; margin: 6px 0; white-space: pre-wrap; }
#stashModal .ssn-why { width: 100%; border-collapse: collapse; margin: 6px 0 0; }
#stashModal .ssn-why td { padding: 2px 4px; vertical-align: top; border-top: 1px solid rgba(128,128,128,.15); }
#stashModal .ssn-why td.p { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; color: #1e7e34; }
#stashModal .ssn-why tr.zero td { opacity: .55; }
#stashModal .ssn-why tr.zero td.p { color: inherit; }
#stashModal .ssn-foot { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
#stashModal .ssn .ssn-accept { background: #28a745; border-color: #28a745; color: #fff; }
#stashModal .ssn .ssn-accept.armed { background: #dc3545; border-color: #dc3545; }
#stashModal .ssn .ssn-take { background: #f3efff; border-color: #cbbef5; color: #5b3fd1; }
#ssnTakeMenu .ssn-tk-note { margin: -4px 0 10px; font-size: .8rem; color: #777; }
#ssnTakeMenu .ssn-tk-head { margin: 8px 0 2px; font-size: .72rem; letter-spacing: .06em; text-transform: uppercase; color: #888; }
#ssnTakeMenu label { display: flex; gap: 10px; align-items: center; padding: 8px 2px; border-bottom: 1px solid #eee; font-size: .92rem; cursor: pointer; text-align: left; }
#ssnTakeMenu label input { width: 20px; height: 20px; margin: 0; padding: 0; flex: 0 0 auto; }
#ssnTakeMenu label small { color: #888; }
#ssnTakeMenu .ssn-tk-err { color: #dc3545; font-size: .82rem; margin: 6px 0 0; }
#stashModal .ssn .ssn-ext { background: transparent; color: #6c5ce7; border-color: rgba(108,92,231,.4); }
#stashModal .ssn-cerr { color: #dc3545; font-size: .78rem; margin-top: 6px; }
#stashModal .ssn-cerr:empty { display: none; }
#stashModal .ssn-prof { display: flex; gap: 12px; align-items: flex-start; margin: 0 0 10px; }
#stashModal .ssn-pimg { flex: 0 0 96px; width: 96px; aspect-ratio: 3 / 4; margin: 0; }
#stashModal .ssn-pimg.none { display: flex; align-items: center; justify-content: center; background: #eee; color: #999; font-size: .7rem; cursor: default; }
#stashModal .ssn-pmain { flex: 1 1 auto; min-width: 0; }
#stashModal .ssn-pname { font-size: 1.1rem; font-weight: 700; line-height: 1.2; overflow-wrap: anywhere; }
#stashModal .ssn-pname small { font-weight: 400; font-size: .8rem; opacity: .65; }
#stashModal .ssn-alias { font-size: .76rem; opacity: .7; margin-top: 4px; overflow-wrap: anywhere; }
#stashModal .ssn-btnrow { display: flex; gap: 6px; flex-wrap: wrap; margin: 0 0 12px; }
#stashModal .ssn .ssn-filter.on { background: #6c5ce7; border-color: #6c5ce7; color: #fff; }
#stashModal .ssn-h { font-weight: 600; font-size: .85rem; margin: 4px 0 6px; }
#stashModal .ssn .ssn-loadmore { display: block; width: 100%; padding: 10px; margin: 0 0 10px; }
#stashModal .ssn-studio { margin: 0 0 10px; }
#stashModal .ssn-studio-row { display: flex; gap: 6px; align-items: center; }
#stashModal .ssn .ssn-studio-btn { flex: 1 1 auto; min-width: 0; text-align: left; overflow: hidden; text-overflow: ellipsis; }
#stashModal .ssn .ssn-studio-btn.on { background: #6c5ce7; border-color: #6c5ce7; color: #fff; }
#stashModal .ssn-studio-pop { margin-top: 6px; border: 1px solid #ccc; border-radius: 6px; background: #fff; padding: 6px; }
#stashModal .ssn input.ssn-studio-find { display: block; width: 100%; box-sizing: border-box; margin: 0 0 6px; padding: 7px 9px; font-size: 14px; border: 1px solid #ccc; border-radius: 6px; background: #fff; color: inherit; -webkit-appearance: none; appearance: none; }
#stashModal .ssn-studio-list { max-height: 40vh; overflow-y: auto; -webkit-overflow-scrolling: touch; }
#stashModal .ssn .ssn-studio-opt { display: flex; width: 100%; justify-content: space-between; gap: 8px; border: none; border-bottom: 1px solid #f0f0f0; border-radius: 0; background: transparent; padding: 8px 6px; text-align: left; white-space: normal; }
#stashModal .ssn .ssn-studio-opt.on { color: #6c5ce7; font-weight: 700; }
/* 13.188: the search hides options with the hidden attribute, but the
   display:flex above outranks the browser's own [hidden] rule - so nothing
   ever disappeared. */
#stashModal .ssn .ssn-studio-opt[hidden], #stashModal .ssn-studio-none[hidden] { display: none; }
#stashModal .ssn .ssn-studio-opt small { opacity: .6; flex: 0 0 auto; }
#stashModal .ssn-studio-none { padding: 8px 6px; font-size: .8rem; opacity: .6; }
#stashModal .ssn-studio-how { font-size: .72rem; opacity: .65; margin: 0 0 6px; }
#stashModal .ssn-dd-top { display: flex; gap: 6px; align-items: center; margin: 0 0 6px; }
#stashModal .ssn-dd-top input.ssn-studio-find { flex: 1 1 auto; min-width: 0; margin: 0; }
#stashModal .ssn .ssn-dd-done { flex: 0 0 auto; background: #6c5ce7; border-color: #6c5ce7; color: #fff; font-weight: 600; }
#stashModal .ssn .ssn-dd-done-bottom { display: block; width: 100%; margin-top: 6px; padding: 9px 12px; }
#stashModal .ssn .ssn-studio-opt.net { font-weight: 600; }
#stashModal .ssn .ssn-studio-opt.child { padding-left: 24px; }
/* picker 14.6 / native 14.10: studio names on cards open the studio view. */
#stashModal .ssn .ssn-stlink { display: inline; padding: 0; margin: 0; border: none; border-radius: 0; background: none; color: #6c5ce7; text-decoration: underline; font: inherit; white-space: normal; vertical-align: baseline; }
#stashModal .ssn-slogo { flex: 0 0 110px; width: 110px; height: 70px; border-radius: 6px; background: #fff; border: 1px solid #e6e6ec; display: flex; align-items: center; justify-content: center; overflow: hidden; }
#stashModal .ssn-slogo img { max-width: 100%; max-height: 100%; object-fit: contain; }
#stashModal .ssn-slinks { font-size: .78rem; margin-top: 4px; overflow-wrap: anywhere; }
#stashModal .ssn-slinks a { color: #6c5ce7; }
#stashModal .ssn-kin { font-size: .8rem; margin: 0 0 10px; line-height: 1.6; }
#stashModal .ssn-kin b { font-weight: 600; opacity: .7; }
`;
    document.head.appendChild(css);
  }

  // ⚙️ How a search's results are ordered at first: 'order' is StashDB's own
  // order (picker 15.35 / native 15.44), 'match' is Best match against this file.
  const SEARCH_SORT = 'order';

  // ---- the navigator ---------------------------------------------------------
  function open(opts) {
    ensureCss();
    const host    = opts.host;
    const actions = opts.actions;
    const heading = opts.heading || null;
    const video   = opts.video || {};
    const key     = opts.videoKey || '';
    const canAccept = !!opts.canAccept;
    const scoreTerm = words(video.filename || '');
    const openExternal = typeof opts.openExternal === 'function'
      ? opts.openExternal : (url) => window.open(url, '_blank');

    const stack = [];
    let finished = false, busyAccept = false, loadSeq = 0;
    // Unblur all (13.164 / 13.163): one switch for every cover and portrait in
    // this navigator, kept across views and repaints until it's switched back.
    let revealAll = false;
    const unblurBtn = () => '<button type="button" class="ssn-unblur" data-unblur>' +
      (revealAll ? '&#128584; Blur all' : '&#128065; Unblur all') + '</button>';
    // The search view's own, in the Search row (picker 15.26 / native 15.35).
    const eyeBtn = () => '<button type="button" class="ssn-eye" data-unblur title="' +
      (revealAll ? 'Blur all covers again' : 'Unblur all covers') + '">' + (revealAll ? '&#128584;' : '&#128065;') + '</button>';
    // In a Stash hunt (scray-stash-hunt.js) the hunt bar already has ▶, and
    // the studio of the hunt's last match is offered as a pill.
    const hunt = window.scrayStashHunt;
    const inHunt = !!(hunt && typeof hunt.optsFor === 'function' && hunt.optsFor(video));
    const huntStudio = inHunt && typeof hunt.suggestStudio === 'function'
      ? String(hunt.suggestStudio(video) || '').trim() : '';
    // ...and its female performer(s) (picker 15.35 / native 15.44).
    const huntPerfs = inHunt && typeof hunt.suggestPerformers === 'function'
      ? (hunt.suggestPerformers(video) || []).map(x => String(x || '').trim()).filter(Boolean) : [];
    // ...and the names its folder's earlier searches added (picker 15.41 / native 15.52).
    const huntCarry = inHunt && typeof hunt.carried === 'function'
      ? (hunt.carried(video) || []).map(x => String(x || '').trim()).filter(n => n &&
          ![huntStudio].concat(huntPerfs).some(h => h && h.toLowerCase() === n.toLowerCase()))
      : [];
    const headingWas = heading ? heading.textContent : '';
    // A search's first order: the hunt's, once picked there (picker 15.43 / native 15.54).
    const searchSort = () => {
      try {
        const v = inHunt && typeof hunt.searchSort === 'function' ? hunt.searchSort() : '';
        return v === 'match' || v === 'order' ? v : SEARCH_SORT;
      } catch (err) { return SEARCH_SORT; }
    };

    // The studio + performer box (picker 14.19 / native 14.31). Kept out here
    // because every repaint rebuilds the box: the words and results survive.
    // picker 14.23 / native 14.35: your catalogue first (stash_nav op 'local',
    // counted on the server so both apps agree), StashDB only when asked.
    let findTerm = '', findSeq = 0, findTimer = null;
    let findLocal = null;    // { term, results: [{kind, name, mapped, all, phone, key}] }
    let findGlobal = null;   // op 'find''s answer, after "Search StashDB"
    let findBusy = '', findErr = '';   // findBusy: 'local' | 'global' | ''

    // The footer's own buttons are hidden, not removed, so they come back
    // exactly as they were - the editor does the same.
    const defaults = [...actions.children];
    defaults.forEach(b => { b.dataset.ssnDisplay = b.style.display; b.style.display = 'none'; });
    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'modal-btn modal-btn-secondary';
    backBtn.style.cssText = 'flex:1;';
    backBtn.textContent = '‹ Back';
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'modal-btn modal-btn-cancel';
    closeBtn.textContent = 'Close';
    // ▶ preview between Back and Close (picker 15.27 / native 15.36), on every
    // view, when there's a file to play - not on the Stash button's own card.
    let playBtn = null;
    if (video && video.filename) {
      playBtn = document.createElement('button');
      playBtn.type = 'button';
      playBtn.className = 'modal-btn modal-btn-secondary ssn-foot-play';
      playBtn.style.cssText = 'flex:0 0 64px;width:64px;min-width:0;';
      playBtn.title = 'Preview this file';
      playBtn.innerHTML = '&#9654;';
      playBtn.addEventListener('click', () => {
        if (busyAccept || finished) return;
        preview(video, host.closest('.basket-json-modal') || null);
      });
    }
    actions.appendChild(backBtn);
    if (playBtn) actions.appendChild(playBtn);
    actions.appendChild(closeBtn);

    const finish = (result) => {
      if (finished) return;
      finished = true;
      loadSeq++;
      findSeq++;
      clearTimeout(findTimer);
      host.removeEventListener('click', onClick);
      host.removeEventListener('keydown', onKey);
      host.removeEventListener('input', onInput);
      host.removeEventListener('focusin', onFocusIn);
      backBtn.remove();
      closeBtn.remove();
      if (playBtn) playBtn.remove();
      document.getElementById('ssnPillMenu')?.remove();
      document.getElementById('ssnTakeMenu')?.remove();
      defaults.forEach(b => { b.style.display = b.dataset.ssnDisplay || ''; });
      if (heading) heading.textContent = headingWas;
      if (typeof opts.onDone === 'function') opts.onDone(result || null);
    };
    backBtn.addEventListener('click', () => {
      if (busyAccept) return;
      stack.pop();
      if (!stack.length) { finish(null); return; }
      paint(true);
    });
    closeBtn.addEventListener('click', () => {
      if (busyAccept) return;
      finish(null);
      if (typeof opts.onClose === 'function') opts.onClose();
    });

    const top = () => stack[stack.length - 1];

    function push(entry) {
      const cur = top();
      if (cur) {
        cur.scroll = host.scrollTop;
        // Words typed but not yet searched are still there on the way back.
        const box = host.querySelector('input.ssn-term');
        if (cur.type === 'search' && box) cur.term = box.value;
      }
      stack.push(Object.assign({ data: null, busy: false, error: '', scroll: 0 }, entry));
      paint(false);
      if (entry.type !== 'home') load(top(), false);
    }

    // ---- the studio + performer box -----------------------------------------
    const finderHtml = () => '<div class="ssn-finder">' +
      '<input class="ssn-find-box" type="search" enterkeyhint="go" spellcheck="false" autocomplete="off" ' +
             'autocorrect="off" autocapitalize="off" placeholder="Find a studio or performer&hellip;" ' +
             'value="' + esc(findTerm) + '">' +
      '<div class="ssn-find-list"></div></div>';

    /**
     * One list, studios and performers mixed (picker 14.21 / native 14.33).
     * Your catalogue's own names first, in the server's order - best name
     * match, then most files - each with its Picker / Native counts. Then,
     * once asked for, StashDB's answer, minus the names already listed.
     */
    const findHits = () => {
      const hits = [];
      const seen = new Set();
      (findLocal ? findLocal.results : []).forEach(x => {
        seen.add(x.kind + '|' + String(x.name).toLowerCase());
        hits.push({ kind: x.kind, name: x.name, key: x.key, n: x,
                    sub: x.mapped ? '\u201c' + x.mapped + '\u201d' : '' });
      });
      if (findGlobal) {
        const q = findTerm.trim().toLowerCase();
        const rank = (name) => {
          const n = String(name || '').toLowerCase();
          return n === q ? 0 : n.startsWith(q) ? 1 : (' ' + n).includes(' ' + q) ? 2 : 3;
        };
        (findGlobal.performers || []).map((x, i) => ({ kind: 'performer', x, i, sub: x.disambiguation || '' }))
          .concat((findGlobal.studios || []).map((x, i) => ({ kind: 'studio', x, i, sub: x.parent ? 'in ' + x.parent : '' })))
          .map(h => Object.assign(h, { r: rank(h.x.name) }))
          .sort((a, b) => a.r - b.r || a.i - b.i || (a.kind === 'performer' ? -1 : 1))
          .forEach(h => {
            if (seen.has(h.kind + '|' + String(h.x.name).toLowerCase())) return;
            hits.push({ kind: h.kind, name: h.x.name, id: h.x.id, sub: h.sub, global: true });
          });
      }
      return hits;
    };

    const optHtml = (h, i) =>
      '<button type="button" class="ssn-find-opt is-' + h.kind + (i === 0 ? ' first' : '') + '" data-findi="' + i + '">' +
        '<span>' + esc(h.name) + (h.sub ? ' <span class="k">' + esc(h.sub) + '</span>' : '') +
          (h.n ? '<span class="cnt">Picker ' + h.n.all + ' &middot; Native ' + h.n.phone + '</span>' : '') + '</span>' +
        '<span class="kind">' + (h.kind === 'studio' ? 'Studio' : 'Performer') + '</span></button>';

    function paintFind() {
      const list = host.querySelector('.ssn-find-list');
      if (!list) return;
      const q = findTerm.trim();
      if (q.length < 2) { list.innerHTML = ''; return; }
      const hits = findHits();
      const nLocal = hits.filter(h => !h.global).length;
      let html = '';
      // The last answer stays up while the next one is on its way, so the
      // list never blinks to "nothing" between keystrokes.
      if (nLocal) html += hits.slice(0, nLocal).map(optHtml).join('');
      else if (findLocal && findBusy !== 'local') html += '<div class="ssn-find-note">Nothing in your library matches that.</div>';
      else if (findBusy === 'local') html += '<div class="ssn-find-note">Searching your library&hellip;</div>';
      if (findErr) html += '<div class="ssn-find-note ssn-err">' + esc(findErr) + '</div>';
      if (findGlobal) {
        html += '<div class="ssn-find-head">From StashDB</div>';
        html += hits.length > nLocal
          ? hits.slice(nLocal).map((h, k) => optHtml(h, nLocal + k)).join('')
          : '<div class="ssn-find-note">Nothing more on StashDB.</div>';
      } else {
        html += '<button type="button" class="ssn-find-global" data-findglobal' + (findBusy === 'global' ? ' disabled' : '') + '>' +
          (findBusy === 'global' ? 'Searching StashDB&hellip;' : '&#128269; Search StashDB for \u201c' + esc(q) + '\u201d') + '</button>';
      }
      list.innerHTML = html;
    }

    function runFind() {
      const q = findTerm.trim();
      const seq = ++findSeq;
      findGlobal = null;
      if (q.length < 2) { findLocal = null; findErr = ''; findBusy = ''; paintFind(); return; }
      findBusy = 'local'; findErr = '';
      paintFind();
      api('stash_nav', { method: 'POST', body: { op: 'local', term: q } })
        .then(r => { if (seq === findSeq && !finished) { findLocal = { term: q, results: r.results || [] }; } })
        .catch(err => { if (seq === findSeq && !finished) { findLocal = null; findErr = err.message || String(err); } })
        .finally(() => { if (seq === findSeq && !finished) { findBusy = ''; paintFind(); } });
    }

    /** The box's "Search StashDB": everything, not just your catalogue. */
    function runGlobal() {
      const q = findTerm.trim();
      if (q.length < 2 || findBusy === 'global') return;
      const seq = ++findSeq;
      findBusy = 'global'; findErr = '';
      paintFind();
      api('stash_nav', { method: 'POST', body: { op: 'find', term: q } })
        .then(r => { if (seq === findSeq && !finished) findGlobal = r; })
        .catch(err => { if (seq === findSeq && !finished) findErr = 'StashDB: ' + (err.message || String(err)); })
        .finally(() => { if (seq === findSeq && !finished) { findBusy = ''; paintFind(); } });
    }

    function pickFind(i) {
      const h = findHits()[i];
      if (!h) return;
      findTerm = ''; findLocal = null; findGlobal = null; findErr = ''; findBusy = ''; findSeq++;
      clearTimeout(findTimer);
      const box = host.querySelector('input.ssn-find-box');
      if (box) box.blur();
      // A catalogue name opens off one of its own files' scenes (from_key),
      // exactly as Open in Stash does; a StashDB result by its id.
      push(h.global ? { type: h.kind, id: h.id, name: h.name } : { type: h.kind, name: h.name, fromKey: h.key || '' });
    }

    // ---- loading ---------------------------------------------------------
    // keep: a studio change re-fetches page 1 but leaves the profile and the
    // current scenes on screen until the new ones land.
    async function load(entry, more, keep) {
      const seq = ++loadSeq;
      entry.busy = true;
      entry.error = '';
      if (!more && !keep) entry.data = null;
      paint(false, true);
      let res;
      try {
        const body = { video_key: key, score_term: scoreTerm };
        if (entry.type === 'search') {
          body.op = 'search';
          body.term = entry.term;
        } else if (entry.type === 'studio') {
          body.op = 'studio';
          if (entry.id) body.id = entry.id;
          body.name = entry.name || '';
          if (entry.sceneId) body.scene_id = entry.sceneId;
          if (entry.fromKey) body.from_key = entry.fromKey;
          if (entry.libOnly) body.in_library = 1;
          // The dropdown's picks are PERFORMERS on a studio view - all of
          // them in the same scene (picker 14.7 / native 14.11). The state
          // keeps the studio-filter names (e.picks, e.studios, ...) because
          // the dropdown is the same one, listing the other kind.
          if (entry.picks && entry.picks.length) body.performer_ids = entry.picks.map(x => x.id);
          // The sub-studios picked on a parent studio's view (picker 14.10).
          if (entry.subPicks && entry.subPicks.length) body.sub_studio_ids = entry.subPicks.map(x => x.id);
          body.page = more ? (entry.data.page || 1) + 1 : 1;
        } else {
          body.op = 'performer';
          if (entry.id) body.id = entry.id;
          body.name = entry.name || '';
          if (entry.sceneId) body.scene_id = entry.sceneId;
          if (entry.fromKey) body.from_key = entry.fromKey;
          if (entry.libOnly) body.in_library = 1;
          // Studio filter on the scene list (13.187 / browse 13.72).
          // Any of the picked studios (picker 14.7 / native 14.11).
          if (entry.picks && entry.picks.length) {
            // "net:<id>" is a parent network: sent apart, expanded server-side.
            const st = entry.picks.filter(x => !String(x.id).startsWith('net:')).map(x => x.id);
            const nets = entry.picks.filter(x => String(x.id).startsWith('net:')).map(x => String(x.id).slice(4));
            if (st.length) body.studio_ids = st;
            if (nets.length) body.network_ids = nets;
          }
          body.page = more ? (entry.data.page || 1) + 1 : 1;
        }
        res = await api('stash_nav', { method: 'POST', body });
      } catch (err) {
        if (seq !== loadSeq || top() !== entry) return;
        entry.busy = false;
        entry.error = err.message || String(err);
        paint(false, true);
        return;
      }
      if (seq !== loadSeq || top() !== entry) return;
      entry.busy = false;
      if (more && entry.data) {
        const seen = new Set(entry.data.scenes.map(s => s.stash_id));
        entry.data.scenes = entry.data.scenes.concat((res.scenes || []).filter(s => !seen.has(s.stash_id)));
        entry.data.page = res.page;
        entry.data.lastCount = (res.scenes || []).length;
        entry.data.note = res.note || '';
      } else {
        entry.data = Object.assign({}, res, { scenes: res.scenes || [], lastCount: (res.scenes || []).length });
        // The performer's studios, from the unfiltered first load. Kept across
        // a studio change so the list doesn't shrink to the one picked.
        if (entry.type === 'performer' && Array.isArray(res.studios) && !entry.studios) entry.studios = res.studios;
        // Networks come with the unfiltered first page only; keep them.
        if (entry.type === 'performer') {
          if (Array.isArray(res.networks)) entry.networks = res.networks;
          if (entry.networks && entry.data) entry.data.networks = entry.networks;
        }
        if (entry.type === 'studio' && Array.isArray(res.performers) && !entry.studios) entry.studios = res.performers;
        if (entry.type === 'studio' && res.studio) {
          entry.id = res.studio.id;
          entry.name = res.studio.name || entry.name;
        }
        if (entry.type === 'performer' && res.performer) {
          entry.id = res.performer.id;
          entry.name = res.performer.name || entry.name;
        }
        if (!entry.sort) entry.sort = (entry.type === 'search' && res.scored) ? searchSort() : 'order';
        // The hunt carries studio / performer names added to the words on to
        // the next files from this folder (picker 15.41 / native 15.52).
        if (entry.type === 'search' && inHunt && typeof hunt.searched === 'function') {
          try {
            const names = [huntStudio].concat(huntPerfs, huntCarry, pathTags.slice(studioStart));
            entry.data.scenes.forEach(c => {
              if (c.studio) names.push(c.studio);
              (c.cast || []).forEach(p => { if (p && p.name) names.push(p.name); if (p && p.as) names.push(p.as); });
            });
            hunt.searched(video, entry.term || '', names.filter(Boolean));
          } catch (err) { console.warn('[stash nav] hunt carry:', err); }
        }
      }
      paint(false, true);
    }

    // ---- painting --------------------------------------------------------
    // keepScroll: re-render in place (a load landing) rather than a new view.
    function paint(restore, keepScroll) {
      if (finished) return;
      const e = top();
      if (!e) return;
      const scrollWas = host.scrollTop;
      // What is typed survives a repaint: the box is rebuilt, the words aren't.
      const box = host.querySelector('input.ssn-term');
      if (box && e.type === 'search' && keepScroll) e.term = box.value;
      const hadFocus = box && document.activeElement === box;
      // Which dropdown's search box had the keyboard, so the repaint gives it back.
      const ae = document.activeElement;
      const focusDd = (ae && ae.matches && ae.matches('input.ssn-studio-find') && host.contains(ae))
        ? ((ae.closest('.ssn-studio') || {}).dataset || {}).dd || 'main' : '';
      const findFocus = !!(ae && ae.matches && ae.matches('input.ssn-find-box') && host.contains(ae));

      if (heading) {
        heading.textContent = e.type === 'home'
          ? 'Stash'
          : e.type === 'search'
          ? 'Stash search'
          : e.type === 'studio'
            ? (e.data && e.data.studio ? e.data.studio.name : (e.name || 'Studio'))
            : (e.data && e.data.performer ? e.data.performer.name : (e.name || 'Performer'));
      }
      backBtn.textContent = stack.length > 1 ? '‹ Back' : (opts.rootBackLabel || '‹ Back to lookup');

      host.innerHTML = '<div class="ssn">' + (e.type === 'search' ? rfilterHtml(e) : '') + finderHtml() +
        (e.type === 'home'
          ? '<div class="ssn-home">Type a studio&rsquo;s or performer&rsquo;s name, then pick one to open their page.</div>' +
            // 🎯 Stash hunt (picker 15.23 / native 15.32, scray-stash-hunt.js).
            (window.scrayStashHunt
              ? '<div class="ssn-hunt-row"><button type="button" class="ssn-hunt-go">&#127919; Stash hunt</button>' +
                '<span>Random unmatched files, one at a time</span></div>'
              : '')
          : e.type === 'search' ? searchHtml(e) : e.type === 'studio' ? studioViewHtml(e) : performerHtml(e)) + '</div>';
      paintFind();
      // Started from the Stash button: the box is all there is, so it has the keyboard.
      const fb = host.querySelector('input.ssn-find-box');
      if (fb && (findFocus || (e.type === 'home' && !restore && !keepScroll))) {
        try { fb.focus({ preventScroll: true }); } catch (_) { fb.focus(); }
        fb.setSelectionRange(fb.value.length, fb.value.length);
      }

      if (restore) host.scrollTop = e.scroll || 0;
      else if (keepScroll) host.scrollTop = scrollWas;
      else host.scrollTop = 0;

      if (hadFocus) {
        const nb = host.querySelector('input.ssn-term');
        if (nb) { nb.focus(); nb.setSelectionRange(nb.value.length, nb.value.length); }
      }
      const wantDd = focusDd || Object.keys(DD).find(k => e[DD[k].focus]) || '';
      if (wantDd) {
        Object.keys(DD).forEach(k => { e[DD[k].focus] = false; });
        const sb = host.querySelector('.ssn-studio[data-dd="' + wantDd + '"] input.ssn-studio-find');
        if (sb) { try { sb.focus({ preventScroll: true }); } catch (_) { sb.focus(); } }
      }
      paintStudioList();
      paintFilter();
      paintPtags();
    }

    function sortedScenes(e) {
      const list = (e.data && e.data.scenes || []).map((s, i) => ({ s, i }));
      if (e.sort === 'match') {
        list.sort((a, b) => (Number(b.s.confidence) || 0) - (Number(a.s.confidence) || 0)
                            || (a.s.order ?? a.i) - (b.s.order ?? b.i));
      }
      return list;
    }

    // Best match needs scores, so the toggle only appears when the file is
    // catalogued and there is more than one scene to put in order.
    function sortHtml(e, orderLabel) {
      if (!e.data || !e.data.scored || e.data.scenes.length < 2) return '';
      return '<span class="ssn-sort">' +
          '<button type="button" data-sort="match" class="' + (e.sort === 'match' ? 'on' : '') + '">Best match</button>' +
          '<button type="button" data-sort="order" class="' + (e.sort === 'order' ? 'on' : '') + '">' + orderLabel + '</button>' +
        '</span>';
    }
    const errHtml = (msg) => msg ? '<div class="ssn-state"><span class="ssn-err">' + esc(msg) + '</span></div>' : '';

    function stateHtml(e, label, orderLabel) {
      if (e.busy && !(e.data && e.data.scenes.length)) {
        return '<div class="ssn-state">Asking StashDB&hellip;</div>';
      }
      if (e.error) return errHtml(e.error);
      if (!e.data) return '';
      return '<div class="ssn-state"><span>' + label + '</span>' + sortHtml(e, orderLabel) + '</div>' +
        errHtml(e.data.note);
    }

    // The file's own tags - folder tags and [bracket] tags - as pills under the
    // words box. A tap puts the tag into the box, or takes it back out; it
    // doesn't search, so several can be picked before pressing Search.
    let studioStart = Infinity;
    const pathTags = (() => {
      const seen = new Set(), out = [];
      [].concat(video.tags || [], video.bracketTags || []).forEach(t => {
        const v = String(t ?? '').trim();
        const k = v.toLowerCase();
        if (!v || seen.has(k) || k === 'yet-to-upload') return;
        seen.add(k);
        out.push(v);
      });
      // Studio names the folder tags stand for (picker 14.28 / native 14.41),
      // from studioSuggestions below.
      const extra = studioSuggestions(out);
      studioStart = out.length;
      return out.concat(extra);
    })();
    // Folder tags toggle their words in the box. Studio pills - the names the
    // folder tags stand for, and in a hunt the studio of its last match - open
    // a menu (picker 15.27 / native 15.36): filter these results, open the
    // studio's page, or add to the search words.
    const ptagsHtml = (e) => '<div class="ssn-ptags">' +
      (huntStudio
        ? '<button type="button" class="ssn-ptag ssn-ptag-hunt" data-pstudio="' + esc(huntStudio) + '" data-pname="' + esc(huntStudio) +
          '" title="Studio of the hunt&rsquo;s last match">&#127919; ' + esc(huntStudio) + '</button>'
        : '') +
      huntPerfs.map(n => '<button type="button" class="ssn-ptag ssn-ptag-hunt ssn-ptag-perf" data-pperf="' + esc(n) + '" data-pname="' + esc(n) +
          '" title="Performer in the hunt&rsquo;s last match">&#127919; ' + esc(n) + '</button>').join('') +
      huntCarry.filter(n => !pathTags.some(t => t.toLowerCase() === n.toLowerCase())).map(n =>
        '<button type="button" class="ssn-ptag ssn-ptag-carry" data-pword="' + esc(n) + '" data-pname="' + esc(n) +
          '" title="Added to this folder&rsquo;s searches - tap to take it out">&#128204; ' + esc(n) + '</button>').join('') +
      pathTags.map((t, i) => i >= studioStart
        ? '<button type="button" class="ssn-ptag ssn-ptag-studio" data-pstudio="' + esc(t) + '" data-pname="' + esc(t) +
          '" title="Studio name mapped in manage-data">' + esc(t) + '</button>'
        : '<button type="button" class="ssn-ptag" data-ptag="' + i + '" data-pname="' + esc(t) + '">' + esc(t) + '</button>').join('') +
      '</div>';
    const reEsc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const tagRe = (t) => new RegExp('(^|\\s)' + reEsc(t) + '(?=\\s|$)', 'i');
    function paintPtags() {
      const box = host.querySelector('input.ssn-term');
      if (!box) return;
      const e = top();
      host.querySelectorAll('.ssn-ptag[data-pname]').forEach(b => {
        const t = b.dataset.pname;
        b.classList.toggle('on', !!t && tagRe(t).test(box.value));
        // A studio pill that is filtering the results gets an outline.
        b.classList.toggle('filt', !!(e && ((b.dataset.pstudio && rfHas(e, 'rfs', t)) || (b.dataset.pperf && rfHas(e, 'rfp', t)))));
      });
    }
    function toggleWord(t) {
      const box = host.querySelector('input.ssn-term');
      if (!box || !t) return;
      box.value = tagRe(t).test(box.value)
        ? box.value.replace(tagRe(t), ' ').replace(/\s+/g, ' ').trim()
        : (box.value.trim() + ' ' + t).trim();
      paintPtags();
    }
    function togglePtag(i) { toggleWord(pathTags[i]); }

    // ---- filtering the search results (picker 15.26 / native 15.35) --------
    // By studio and by performer, from what is in the results. Searchable
    // dropdowns like the profile views' (picker 15.27 / native 15.36), each
    // taking several: any of the studios, all of the performers together.
    // Kept on the entry, so a refined search and Back keep them.
    const lk = (x) => String(x ?? '').normalize('NFC').trim().toLowerCase();
    // Names compared without spaces or punctuation: a folder's "Teenfidelity"
    // is StashDB's "Teen Fidelity".
    const ck = (x) => lk(x).replace(/[^\p{L}\p{N}]+/gu, '');
    const rfList = (e, dd) => e[DD[dd].picks] || (e[DD[dd].picks] = []);
    const rfHas = (e, dd, name) => rfList(e, dd).some(x => x.k === ck(name));
    function rfToggle(e, dd, name) {
      const list = rfList(e, dd), k = ck(name);
      if (!k) return;
      e[DD[dd].picks] = list.some(x => x.k === k) ? list.filter(x => x.k !== k) : list.concat([{ k, name }]);
    }
    function rfPass(e, c) {
      const sts = rfList(e, 'rfs'), pfs = rfList(e, 'rfp');
      if (sts.length && !sts.some(x => x.k === ck(c.studio))) return false;
      if (pfs.length && !pfs.every(x => (c.cast || []).some(p => ck(p.name) === x.k))) return false;
      return true;
    }
    function rfCounts(e) {
      const st = new Map(), pf = new Map();
      ((e.data && e.data.scenes) || []).forEach(c => {
        if (c.studio) { const k = ck(c.studio); const x = st.get(k) || { k, name: c.studio, n: 0 }; x.n++; st.set(k, x); }
        const seen = new Set();
        (c.cast || []).forEach(p => {
          const k = ck(p.name);
          if (!k || seen.has(k)) return;
          seen.add(k);
          const x = pf.get(k) || { k, name: p.name, n: 0 }; x.n++; pf.set(k, x);
        });
      });
      const order = (m) => [...m.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
      return { rfs: order(st), rfp: order(pf) };
    }
    function rfilterHtml(e) {
      const n = e.data ? e.data.scenes.length : 0;
      if (!n && !rfList(e, 'rfs').length && !rfList(e, 'rfp').length) return '';
      const counts = rfCounts(e);
      const open = e.rfsOpen ? 'rfs' : e.rfpOpen ? 'rfp' : '';
      const LBL = { rfs: ['Studio', 'studios'], rfp: ['Performer', 'performers'] };
      const btn = (dd) => {
        const picks = rfList(e, dd);
        const [one, many] = LBL[dd];
        const label = !picks.length ? 'All ' + many + ' (' + counts[dd].length + ')'
          : picks.length <= 2 ? picks.map(x => x.name).join(dd === 'rfs' ? ', ' : ' + ')
          : picks.slice(0, 2).map(x => x.name).join(dd === 'rfs' ? ', ' : ' + ') + ' +' + (picks.length - 2);
        return '<button type="button" class="ssn-studio-btn' + (picks.length ? ' on' : '') + '" data-rf-toggle="' + dd + '" ' +
            'title="' + (picks.length ? (picks.length > 1 ? one + 's' : one) + ': ' + esc(picks.map(x => x.name).join(', ')) : 'Filter the results by ' + one.toLowerCase()) + '">' +
            esc(label) + ' ' + (open === dd ? '&#9652;' : '&#9662;') + '</button>' +
          (picks.length ? '<button type="button" class="ssn-rf-x" data-rf-pick="" data-dd="' + dd + '" title="All ' + many + '">&#10005;</button>' : '');
      };
      let pop = '';
      if (open) {
        const picks = rfList(e, open);
        const [one, many] = LBL[open];
        const opts = counts[open].slice();
        picks.forEach(pk => { if (!opts.some(o => o.k === pk.k)) opts.push({ k: pk.k, name: pk.name, n: 0 }); });
        const isOn = (k) => picks.some(x => x.k === k);
        opts.sort((a, b) => (isOn(b.k) ? 1 : 0) - (isOn(a.k) ? 1 : 0));
        pop = '<div class="ssn-studio-pop">' +
          '<div class="ssn-studio-how">' + (open === 'rfs' ? 'Pick several to see scenes from any of them'
                                                         : 'Pick several to see scenes they&rsquo;re all in together') + '</div>' +
          '<div class="ssn-dd-top"><input class="ssn-studio-find" type="search" enterkeyhint="done" spellcheck="false" autocomplete="off" ' +
            'autocorrect="off" autocapitalize="off" placeholder="Search ' + many + ' in the results&hellip;" value="' + esc(e[DD[open].term] || '') + '">' +
            doneBtn(open) + '</div>' +
          '<div class="ssn-studio-list">' +
            '<button type="button" class="ssn-studio-opt' + (!picks.length ? ' on' : '') + '" data-dd="' + open + '" data-rf-pick="">All ' + many + '</button>' +
            opts.map(o => '<button type="button" class="ssn-studio-opt' + (isOn(o.k) ? ' on' : '') + '" data-dd="' + open + '" ' +
              'data-rf-pick="' + esc(o.name) + '" data-studio-name="' + esc(o.name) + '">' +
              '<span>' + (isOn(o.k) ? '&#10003; ' : '') + esc(o.name) + '</span><small>' + o.n + '</small></button>').join('') +
            '<div class="ssn-studio-none" hidden>No ' + one.toLowerCase() + ' matches</div>' +
          '</div>' +
          doneBtn(open, true) +
        '</div>';
      }
      // One wrapper, named after the open list, so paintStudioList narrows it
      // and the repaint gives its box the keyboard back.
      return '<div class="ssn-studio ssn-rfilter" data-dd="' + (open || 'rfs') + '">' +
        '<div class="ssn-rf-row">' + btn('rfs') + btn('rfp') + '</div>' + pop + '</div>';
    }

    // The studio pills' menu (picker 15.27 / native 15.36), like a performer
    // chip's in the Stash modal: on top of the modal, gone with the navigator.
    function pillMenu(name, kind) {
      document.getElementById('ssnPillMenu')?.remove();
      const e = top();
      if (!e || e.type !== 'search' || !name) return;
      // A performer pill (the hunt's last match) filters on the cast instead.
      const perf = kind === 'performer';
      const dd = perf ? 'rfp' : 'rfs';
      const n = ((e.data && e.data.scenes) || []).filter(c => perf
        ? (c.cast || []).some(p => ck(p && p.name) === ck(name))
        : ck(c.studio) === ck(name)).length;
      const filtering = rfHas(e, dd, name);
      const box = host.querySelector('input.ssn-term');
      const inWords = !!(box && tagRe(name).test(box.value));
      const m = document.createElement('div');
      m.className = 'basket-json-modal';
      m.id = 'ssnPillMenu';
      m.style.cssText = 'transform:none;z-index:2147483647;';
      m.innerHTML =
        '<div class="basket-json-modal-content" style="transform:none;max-width:340px;">' +
          '<h3 style="margin-top:0;">' + esc(name) + '</h3>' +
          '<div class="ssn-pm-note">' + (e.data ? (n ? n + ' of these ' + e.data.scenes.length + ' results' : 'Not in these results') : 'No results yet') + '</div>' +
          '<div style="display:flex;flex-direction:column;gap:8px;">' +
            '<button type="button" class="modal-btn modal-btn-primary" data-pm="filter">' +
              (filtering ? '&#10005; Stop filtering by it' : '&#8853; Filter these results') + '</button>' +
            '<button type="button" class="modal-btn modal-btn-secondary" data-pm="page">&#128269; Open ' + (perf ? 'her' : 'the studio&rsquo;s') + ' page</button>' +
            '<button type="button" class="modal-btn modal-btn-secondary" data-pm="words">' +
              (inWords ? '&#8722; Take out of the search &amp; search again' : '&#43; Add to the search &amp; search') + '</button>' +
            '<button type="button" class="modal-btn modal-btn-cancel" data-pm="">Cancel</button>' +
          '</div>' +
        '</div>';
      m.addEventListener('click', (ev) => {
        if (ev.target === m) { m.remove(); return; }
        const b = ev.target.closest('[data-pm]');
        if (!b) return;
        ev.stopPropagation();
        m.remove();
        if (finished || top() !== e) return;
        if (b.dataset.pm === 'filter') { e.rfsOpen = e.rfpOpen = false; rfToggle(e, dd, name); paint(false, true); }
        else if (b.dataset.pm === 'page') push({ type: perf ? 'performer' : 'studio', id: '', name, sceneId: '' });
        else if (b.dataset.pm === 'words') {
          // In or out of the words, then the search runs with them.
          toggleWord(name);
          const bx = host.querySelector('input.ssn-term');
          if (bx) search(bx.value);
        }
      });
      document.body.appendChild(m);
    }

    function searchHtml(e) {
      const all = e.data ? e.data.scenes.length : 0;
      const shown = e.data ? sortedScenes(e).filter(x => rfPass(e, x.s)) : [];
      const n = shown.length;
      const sts = rfList(e, 'rfs'), pfs = rfList(e, 'rfp');
      const filtered = !!(sts.length || pfs.length);
      const label = e.data ? (all ? (filtered ? n + ' of ' + all : all) + ' result' + (all === 1 ? '' : 's') : '') : '';
      let none = '';
      if (e.data && all && !n && filtered) {
        const b = (x) => '<b>' + esc(x.name) + '</b>';
        const what = [sts.length ? 'from ' + sts.map(b).join(' or ') : '', pfs.length ? 'with ' + pfs.map(b).join(' and ') : '']
          .filter(Boolean).join(' ');
        const bits = ['<span>Nothing in these results ' + what + '.</span>'];
        // A page to go to instead - three at most.
        sts.map(x => ({ x, a: 'data-stpage' })).concat(pfs.map(x => ({ x, a: 'data-pfpage' }))).slice(0, 3).forEach(({ x, a }) =>
          bits.push('<button type="button" class="ssn-go-page" ' + a + '="' + esc(x.name) + '">Open ' + esc(x.name) + '&rsquo;s page &rsaquo;</button>'));
        bits.push('<button type="button" data-rfclear>Show all ' + all + '</button>');
        none = '<div class="ssn-rf-none">' + bits.join('') + '</div>';
      }
      const list = e.data && !all && !e.busy && !e.error
        ? '<div class="ssn-empty">Nothing came back for those words.<br>' +
          'Try the performer&rsquo;s name, or the studio and a couple of words from the title.</div>'
        : none || shown.map(x => cardHtml(x.s, x.i, null)).join('');
      return '' +
        '<div class="ssn-refine">' +
          '<input class="ssn-term" type="search" enterkeyhint="search" spellcheck="false" autocomplete="off" ' +
                 'autocorrect="off" autocapitalize="off" placeholder="performer name, studio, title words&hellip;" ' +
                 'value="' + esc(e.term) + '">' +
          ptagsHtml(e) +
          '<div class="ssn-btns">' +
            '<button type="button" data-go>Search</button>' +
            '<button type="button" data-camel title="Split CamelCase and separators into words, drop resolution noise, then search">de-Camel</button>' +
            '<button type="button" data-fname title="Start again from this file&rsquo;s name">Filename</button>' +
            eyeBtn() +
          '</div>' +
        '</div>' +
        stateHtml(e, label +
          (e.data ? ' <button type="button" class="ssn-ext ssn-extsm" data-ext="' +
                    esc('https://stashdb.org/search?q=' + encodeURIComponent(e.term || '')) + '">stashdb.org &#8599;</button>' : ''),
          'StashDB order') +
        list;
    }

    function performerHtml(e) {
      const d = e.data;
      const p = d && d.performer;
      let prof = '';
      if (p) {
        const g = { F: 'Female', M: 'Male', TF: 'Trans female', TM: 'Trans male', NB: 'Non-binary', I: 'Intersex' }[p.gender_short] || '';
        const sub = [g, p.age ? p.age + ' yrs' : '', p.birth_date ? 'born ' + p.birth_date : '', p.country]
          .filter(Boolean).map(esc).join(' &middot; ');
        const fact = (label, v) => v ? '<div class="ssn-fact"><span>' + label + '</span><b>' + esc(v) + '</b></div>' : '';
        const facts = fact('Ethnicity', p.ethnicity ? p.ethnicity.toLowerCase().replace(/_/g, ' ') : '') +
                      fact('Height', p.height ? p.height + ' cm' : '') +
                      fact('Measurements', p.measurements) +
                      fact('Breasts', p.breast_type ? p.breast_type.toLowerCase() : '') +
                      fact('Career', p.career) +
                      fact('Scenes on StashDB', p.scene_count != null ? String(p.scene_count) : '');
        prof =
          '<div class="ssn-btnrow ssn-topbar">' + libBtn(e) + extLinks(p.name, []) + unblurBtn() + '</div>' +
          '<div class="ssn-prof">' +
            (p.image
              ? '<div class="ssn-cover ssn-pimg' + (revealAll ? ' shown' : '') + '" data-cover><img src="' + esc(p.image) + '" alt="" loading="lazy">' +
                '<div class="ssn-veil">Tap 3 times</div></div>'
              : '<div class="ssn-cover ssn-pimg none">no image</div>') +
            '<div class="ssn-pmain">' +
              '<div class="ssn-pname">' + esc(p.name) +
                (p.disambiguation ? ' <small>(' + esc(p.disambiguation) + ')</small>' : '') +
                '<button type="button" class="ssn-google" title="Search Google for this name" data-ext="' +
                  esc('https://www.google.com/search?q=' + encodeURIComponent('"' + p.name + '"')) + '">Google &#8599;</button>' + '</div>' +
              (sub ? '<div class="ssn-sub">' + sub + '</div>' : '') +
              (p.aliases && p.aliases.length ? '<div class="ssn-alias">Also known as ' + esc(p.aliases.join(', ')) + '</div>' : '') +
            '</div>' +
          '</div>' +
          (facts ? '<div class="ssn-facts">' + facts + '</div>' : '') +
          '<div class="ssn-btnrow">' +
            (typeof window.scrayAddTagFilter === 'function'
              ? '<button type="button" class="ssn-filter" data-filter>&#8853; Filter by this performer</button>' : '') +
            '<button type="button" class="ssn-ext" data-ext="' + esc(p.stash_url) + '">stashdb.org &#8599;</button>' +
          '</div>';
      } else if (e.busy) {
        return '<div class="ssn-state">Looking up ' + esc(e.name || 'performer') + '&hellip;</div>';
      } else if (e.error) {
        return '<div class="ssn-state"><span class="ssn-err">' + esc(e.error) + '</span></div>';
      }

      const n = d ? d.scenes.length : 0;
      const label = d ? ((e.libOnly ? 'In your library' : 'Scenes') + (d.count != null ? ' &middot; ' + d.count : '') +
                         (e.sort === 'order' ? ' &middot; newest first' : '')) : '';
      const list = d && !n && !e.busy
        ? (d.note ? '' : '<div class="ssn-empty">' + (e.libOnly ? 'None of your files are scenes of this performer' +
            (e.picks && e.picks.length ? ' at that studio' : '') + '.' : 'No scenes listed for this performer.') + '</div>')
        : sortedScenes(e).map(x => cardHtml(x.s, x.i, p ? p.id : null)).join('');
      const more = d && d.count != null && n < d.count && d.lastCount >= (d.per_page || 25)
        ? '<button type="button" class="ssn-loadmore" data-more' + (e.busy ? ' disabled' : '') + '>' +
            (e.busy ? 'Loading&hellip;' : 'Load more (' + n + ' of ' + d.count + ')') + '</button>'
        : '';
      return prof + studioHtml(e) +
        '<div class="ssn-state"><span class="ssn-h">' + label + '</span>' + sortHtml(e, 'Newest') + '</div>' +
        errHtml(e.error) + errHtml(d && d.note) +
        list + more;
    }

    // ---- studio view (picker 14.6 / native 14.10) --------------------------
    // The performer view's twin: the studio's logo, name, aliases and links,
    // its network and sub-studios (each one tappable), then its scenes newest
    // first with the same cards, and a performer filter in place of the
    // studio one.
    function studioViewHtml(e) {
      const d = e.data;
      const s = d && d.studio;
      let prof = '';
      if (s) {
        const fact = (label, v) => v ? '<div class="ssn-fact"><span>' + label + '</span><b>' + esc(v) + '</b></div>' : '';
        const facts = fact('Network', s.parent ? s.parent.name : '') +
                      fact('Sub-studios', s.children && s.children.length ? String(s.children.length) : '') +
                      fact(s.children && s.children.length ? 'Scenes in network' : 'Scenes on StashDB',
                           d.count != null && !e.libOnly && !(e.picks && e.picks.length) && !(e.subPicks && e.subPicks.length) ? String(d.count) : '') +
                      fact('Performers', s.performer_count != null ? String(s.performer_count) : '');
        const link = (st) => '<button type="button" class="ssn-stlink" data-stid="' + esc(st.id) + '" data-stname="' +
          esc(st.name) + '">' + esc(st.name) + '</button>';
        const kin =
          (s.parent ? '<div><b>Part of</b> ' + link(s.parent) + '</div>' : '') +
          (s.children && s.children.length ? '<div><b>Sub-studios</b> ' + s.children.map(link).join(', ') + '</div>' : '');
        const sites = (s.urls || []).map(u => {
          let label = u.site || '';
          try { label = label || new URL(u.url).hostname.replace(/^www\./, ''); } catch (_) { label = label || u.url; }
          return '<a href="#" data-exturl="' + esc(u.url) + '">' + esc(label) + ' &#8599;</a>';
        }).join(' &middot; ');
        prof =
          '<div class="ssn-btnrow ssn-topbar">' + libBtn(e) + extLinks(s.name, s.urls) + unblurBtn() + '</div>' +
          '<div class="ssn-prof">' +
            (s.image ? '<div class="ssn-slogo"><img src="' + esc(s.image) + '" alt="" loading="lazy"></div>' : '') +
            '<div class="ssn-pmain">' +
              '<div class="ssn-pname">' + esc(s.name) +
                '<button type="button" class="ssn-google" title="Search Google for this studio" data-ext="' +
                  esc('https://www.google.com/search?q=' + encodeURIComponent('"' + s.name + '"')) + '">Google &#8599;</button></div>' +
              (s.aliases && s.aliases.length ? '<div class="ssn-alias">Also known as ' + esc(s.aliases.join(', ')) + '</div>' : '') +
              (sites ? '<div class="ssn-slinks">' + sites + '</div>' : '') +
            '</div>' +
          '</div>' +
          (facts ? '<div class="ssn-facts">' + facts + '</div>' : '') +
          (kin ? '<div class="ssn-kin">' + kin + '</div>' : '') +
          '<div class="ssn-btnrow">' +
            (typeof window.scrayAddTagFilter === 'function'
              ? '<button type="button" class="ssn-filter" data-filter>&#8853; Filter by this studio</button>' : '') +
            '<button type="button" class="ssn-ext" data-ext="' + esc(s.stash_url) + '">stashdb.org &#8599;</button>' +
          '</div>';
      } else if (e.busy) {
        return '<div class="ssn-state">Looking up ' + esc(e.name || 'studio') + '&hellip;</div>';
      } else if (e.error) {
        return '<div class="ssn-state"><span class="ssn-err">' + esc(e.error) + '</span></div>';
      }

      const n = d ? d.scenes.length : 0;
      const label = d ? ((e.libOnly ? 'In your library' : 'Scenes') + (d.count != null ? ' &middot; ' + d.count : '') +
                         (e.sort === 'order' ? ' &middot; newest first' : '')) : '';
      const list = d && !n && !e.busy
        ? (d.note ? '' : '<div class="ssn-empty">' + (e.libOnly ? 'None of your files are' : 'No') + ' scenes listed for this studio' +
            (e.picks && e.picks.length ? ' with ' + esc(e.picks.map(x => x.name).join(' + ')) + ' together' : '') + '.</div>')
        : sortedScenes(e).map(x => cardHtml(x.s, x.i, (e.picks || []).map(x => x.id), s ? s.id : null)).join('');
      const more = d && d.count != null && n < d.count && d.lastCount >= (d.per_page || 25)
        ? '<button type="button" class="ssn-loadmore" data-more' + (e.busy ? ' disabled' : '') + '>' +
            (e.busy ? 'Loading&hellip;' : 'Load more (' + n + ' of ' + d.count + ')') + '</button>'
        : '';
      return prof + studioHtml(e, 'sub') + studioHtml(e, 'main') +
        '<div class="ssn-state"><span class="ssn-h">' + label + '</span>' + sortHtml(e, 'Newest') + '</div>' +
        errHtml(e.error) + errHtml(d && d.note) +
        list + more;
    }

    // ---- studio filter on a profile (13.187) ------------------------------
    // picker 14.6 / native 14.10: the same dropdown on a STUDIO view lists
    // performers instead, and filters the studio's scenes to one of them.
    // A searchable dropdown of the studios this performer has worked for.
    // The list comes from StashDB via api.php (browse 13.72); if that isn't
    // available it falls back to the studios on the scenes loaded so far.
    // Picking one re-asks StashDB for their scenes at that studio only, so
    // the count and Load more are for the filtered list.
    function studioOptions(e) {
      if (Array.isArray(e.studios) && e.studios.length) return e.studios;
      const seen = new Map();
      if (e.type === 'studio') {
        ((e.data && e.data.scenes) || []).forEach(s => (s.cast || []).forEach(p => {
          if (!p.id || !p.name) return;
          const o = seen.get(p.id) || { id: p.id, name: p.name, count: 0 };
          o.count++;
          seen.set(p.id, o);
        }));
        return [...seen.values()].sort((a, b) => (b.count - a.count) || a.name.localeCompare(b.name));
      }
      ((e.data && e.data.scenes) || []).forEach(s => {
        if (!s.studio_id || !s.studio) return;
        const o = seen.get(s.studio_id) || { id: s.studio_id, name: s.studio, count: 0 };
        o.count++;
        seen.set(s.studio_id, o);
      });
      return [...seen.values()].sort((a, b) => (b.count - a.count) || a.name.localeCompare(b.name));
    }

    // Two dropdowns share this (picker 14.10 / native 14.16): 'main' - studios
    // on a performer (and their parent networks, marked ⌂), performers on a
    // studio - and 'sub', the sub-studios on a parent studio's view. Each keeps
    // its own state on the entry.
    const DD = {
      main: { picks: 'picks',    open: 'studioOpen', term: 'studioTerm', focus: 'studioFocus' },
      sub:  { picks: 'subPicks', open: 'subOpen',    term: 'subTerm',    focus: 'subFocus' },
      // The search view's result filters (picker 15.27 / native 15.36).
      rfs:  { picks: 'rfStudios', open: 'rfsOpen', term: 'rfsTerm', focus: 'rfsFocus' },
      rfp:  { picks: 'rfPerfs',   open: 'rfpOpen', term: 'rfpTerm', focus: 'rfpFocus' }
    };

    // Done (picker 15.31 / native 15.40): closes the list it sits in - beside
    // the search box, and again under the list, where the thumb is after
    // scrolling through it.
    const doneBtn = (dd, bottom) => '<button type="button" class="ssn-dd-done' + (bottom ? ' ssn-dd-done-bottom' : '') +
      '" data-dd-done="' + dd + '" title="Close the list">' + (bottom ? '&#10003; Done' : 'Done') + '</button>';
    function closeDd(dd) {
      const e = top();
      const K = DD[dd];
      if (!e || !K) return;
      e[K.open] = false;
      e[K.focus] = false;
      paint(false, true);
      // Back up to the dropdown's own row when the list had scrolled it away,
      // so what it filtered is straight underneath.
      const row = host.querySelector('.ssn-studio[data-dd="' + dd + '"]') ||
                  (/^rf/.test(dd) ? host.querySelector('.ssn-rfilter') : null);
      if (row) {
        const dy = row.getBoundingClientRect().top - host.getBoundingClientRect().top;
        if (dy < 0) host.scrollTop += dy - 4;
      }
    }

    function ddOptions(e, dd) {
      if (dd === 'sub') {
        const s = e.data && e.data.studio;
        if (!s || !(s.children && s.children.length)) return [];
        // The parent itself first - its own scenes - then the studios under it.
        return [{ id: s.id, name: '\u2302 ' + s.name + ' (itself)', net: true, group: s.id }]
          .concat(s.children.map(c => ({ id: c.id, name: c.name, child: true, group: s.id })));
      }
      const list = studioOptions(e);
      // Parent networks of this performer's studios; picking one means every
      // studio under it (browse 14.5 expands it). Nested (picker 14.11): each
      // network is followed by its own studios, indented, as on stashdb.org;
      // studios with no network (or none known) come after, on their own.
      if (e.type === 'performer' && e.data && Array.isArray(e.data.networks) && e.data.networks.length) {
        const out = [];
        const placed = new Set();
        e.data.networks.forEach(n => {
          out.push({ id: 'net:' + n.id, name: '\u2302 ' + n.name, count: n.count, net: true, group: n.id });
          list.filter(o => o.parent_id && o.parent_id === n.id).forEach(o => {
            out.push(Object.assign({}, o, { child: true, group: n.id }));
            placed.add(o.id);
          });
        });
        list.forEach(o => { if (!placed.has(o.id)) out.push(o); });
        return out;
      }
      return list;
    }

    function studioHtml(e, dd) {
      dd = dd || 'main';
      const K = DD[dd];
      if (!e.data || !(e.data.performer || e.data.studio)) return '';
      // What the dropdown lists: studios on a performer, performers on a
      // studio, sub-studios on a parent studio.
      const one = dd === 'sub' ? 'Studio' : e.type === 'studio' ? 'Performer' : 'Studio';
      const many = dd === 'sub' ? 'studios in this network' : e.type === 'studio' ? 'performers' : 'studios';
      const opts = ddOptions(e, dd);
      const picks = e[K.picks] || [];
      if (!opts.length && !picks.length) return '';
      const isOn = (id) => picks.some(x => x.id === id);
      const joinWith = (dd === 'main' && e.type === 'studio') ? ' + ' : ', ';
      // Several can be picked (picker 14.7 / native 14.11); the list stays
      // open between taps. Studios add together, performers intersect.
      const how = (dd === 'main' && e.type === 'studio')
        ? 'Pick several to see scenes they&rsquo;re all in together'
        : 'Pick several to see scenes from any of them';
      const plain = (n) => String(n).replace(/^⌂ /, '⌂');
      const label = !picks.length ? 'All ' + many
        : picks.length <= 2 ? picks.map(x => plain(x.name)).join(joinWith)
        : picks.slice(0, 2).map(x => plain(x.name)).join(joinWith) + ' +' + (picks.length - 2);
      let pop = '';
      if (e[K.open]) {
        pop = '<div class="ssn-studio-pop">' +
          '<div class="ssn-studio-how">' + how + '</div>' +
          '<div class="ssn-dd-top"><input class="ssn-studio-find" type="search" enterkeyhint="done" spellcheck="false" autocomplete="off" ' +
            'autocorrect="off" autocapitalize="off" placeholder="Search ' + many + '&hellip;" value="' + esc(e[K.term] || '') + '">' +
            doneBtn(dd) + '</div>' +
          '<div class="ssn-studio-list">' +
            '<button type="button" class="ssn-studio-opt' + (!picks.length ? ' on' : '') + '" data-dd="' + dd + '" data-studio-pick="">All ' + many + '</button>' +
            // Picked ones first, so they're easy to find and untick.
            // A nested list keeps its order (a studio stays under its network);
            // a flat one puts the picked ones first.
            (opts.some(o => o.group) ? opts : opts.slice().sort((a, b) => (isOn(b.id) ? 1 : 0) - (isOn(a.id) ? 1 : 0))).map(o =>
              '<button type="button" class="ssn-studio-opt' + (isOn(o.id) ? ' on' : '') + (o.net ? ' net' : '') + (o.child ? ' child' : '') + '" data-dd="' + dd + '" ' +
              (o.group ? 'data-group="' + esc(o.group) + '" ' : '') +
              'data-studio-pick="' + esc(o.id) + '" data-studio-name="' + esc(o.name) + '">' +
              '<span>' + (isOn(o.id) ? '&#10003; ' : '') + esc(o.name) + '</span>' + (o.count ? '<small>' + o.count + '</small>' : '') + '</button>').join('') +
            '<div class="ssn-studio-none" hidden>No ' + one.toLowerCase() + ' matches</div>' +
          '</div>' +
          doneBtn(dd, true) +
        '</div>';
      }
      return '<div class="ssn-studio" data-dd="' + dd + '">' +
        '<div class="ssn-studio-row">' +
          '<button type="button" class="ssn-studio-btn' + (picks.length ? ' on' : '') + '" data-dd="' + dd + '" data-studio-toggle>' +
            (picks.length > 1 ? one + 's' : one) + ': ' + esc(label) + ' ' + (e[K.open] ? '&#9652;' : '&#9662;') + '</button>' +
          (picks.length ? '<button type="button" data-dd="' + dd + '" data-studio-pick="" title="Show all ' + many + '">&#10005;</button>' : '') +
        '</div>' + pop +
      '</div>';
    }

    // Narrows the open list to what's typed, without a repaint (which would
    // close the keyboard).
    function paintStudioList() {
      const e = top();
      if (!e) return;
      // Each open dropdown narrows by its own box.
      host.querySelectorAll('.ssn-studio[data-dd]').forEach(wrap => {
        const box = wrap.querySelector('input.ssn-studio-find');
        if (!box) return;
        const K = DD[wrap.dataset.dd] || DD.main;
        const q = box.value.trim().toLowerCase();
        e[K.term] = box.value;
        let shown = 0;
        const hitGroups = new Set();
        wrap.querySelectorAll('.ssn-studio-opt[data-studio-name]').forEach(b => {
          const hit = !q || b.dataset.studioName.toLowerCase().includes(q);
          b.hidden = !hit;
          if (hit) { shown++; if (b.dataset.group) hitGroups.add(b.dataset.group); }
        });
        // A studio that matches keeps its network's heading above it.
        if (q) wrap.querySelectorAll('.ssn-studio-opt.net[data-group]').forEach(b => {
          if (hitGroups.has(b.dataset.group)) b.hidden = false;
        });
        const all = wrap.querySelector('.ssn-studio-opt[data-studio-pick=""]');
        if (all) all.hidden = !!q;
        const none = wrap.querySelector('.ssn-studio-none');
        if (none) none.hidden = shown > 0 || !q;
      });
    }

    // Eporner / Porntrex (picker 15.18 / native 15.19): both search by a
    // dashed slug in the path. A name as it is; a scene by its title, or the
    // studio and first performer when it has none.
    const siteSlug = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const sceneTerms = (c) => c.title ||
      [c.studio, ((c.cast || [])[0] || {}).name].filter(Boolean).join(' ');
    function tubeLinks(text, cls) {
      const slug = siteSlug(text);
      if (!slug) return '';
      return '<button type="button" class="' + cls + '" title="Search Eporner" data-ext="' +
               esc('https://www.eporner.com/search/' + slug + '/') + '">Eporner &#8599;</button>' +
             '<button type="button" class="' + cls + '" title="Search Porntrex" data-ext="' +
               esc('https://www.porntrex.com/search/' + slug + '/') + '">Porntrex &#8599;</button>';
    }

    // Google for one scene (13.165 / 13.164): the title as an exact phrase,
    // then the studio and up to two performers to pin it down.
    function googleUrl(c) {
      const bits = [];
      if (c.title) bits.push('"' + String(c.title).replace(/"/g, '') + '"');
      if (c.studio) bits.push(c.studio);
      (c.cast || []).slice(0, 2).forEach(p => { if (p && p.name) bits.push(p.name); });
      return bits.length ? 'https://www.google.com/search?q=' + encodeURIComponent(bits.join(' ')) : '';
    }

    // In library (native 13.189 / browse 13.74): stash_nav lists the catalogue
    // files already matched to this scene. 13.191 / 13.190: the file this modal
    // is for counts too - it was left out as "already on screen", which made a
    // performer profile opened from a list row the one list missing a link.
    function libOthers(c) {
      return (c.library || []).filter(l => l && l.video_key);
    }
    function libHtml(c, i) {
      const lib = libOthers(c);
      if (!lib.length) return '';
      const names = lib.map(l => (l.path ? l.path + '/' : '') + l.filename).join('\n');
      return '<button type="button" class="ssn-lib" data-lib="' + i + '" title="' + esc(names) + '">' +
        '&#9654; In library' + (lib.length > 1 ? ' (' + lib.length + ')' : '') + '</button>';
    }
    async function openLibrary(i) {
      const e = top();
      const c = e && e.data && e.data.scenes[i];
      const libs = c ? libOthers(c) : [];
      const l = libs[0];
      if (!l) return;

      // This device's own copy first (picker 15.20 / native 15.22): on Native a
      // phone file, else the box's copy streamed from Hetzner, plays right here
      // - it used to go to Picker every time. Any of the scene's files counts,
      // not just the first; a copy that isn't a Hetzner stream is preferred.
      let match = null;
      try {
        const all = typeof window.getAllVideos === 'function' ? await window.getAllVideos() : [];
        const keyOf = v => v.videoKey || (window.scrayVideoKey ? window.scrayVideoKey(v.filename || '') : '');
        const want = new Set(libs.map(x => x.video_key));
        const here = all.filter(v => want.has(keyOf(v)));
        const isHz = v => typeof window.scrayIsHetznerVideo === 'function' && window.scrayIsHetznerVideo(v);
        match = here.find(v => !isHz(v)) || here[0] || null;
      } catch (err) {
        console.error('[stash] library lookup failed:', err);
      }
      if (finished) return;
      if (match) { preview(match, host.closest('.basket-json-modal') || null); return; }

      // Native, and this phone has no copy: the file belongs to the catalogue,
      // so it opens in Picker in the in-app browser. The modal stays as it was
      // underneath.
      if (window.ScrayBridge && window.ScrayBridge.openBrowser) {
        const base = typeof window.scrayPickerUrl === 'function' ? window.scrayPickerUrl() : '';
        if (!base) { alert('No Picker address is set.'); return; }
        let url;
        try {
          const u = new URL(base);
          u.searchParams.set('play', l.video_key);
          url = u.toString();
        } catch (err) {
          url = base + (base.indexOf('?') >= 0 ? '&' : '?') + 'play=' + encodeURIComponent(l.video_key);
        }
        openExternal(url);
        return;
      }

      // Picker, and no copy found above.
      alert('That file isn\u2019t in the library here yet - it may need a sync.\n\n' + (l.path ? l.path + '/' : '') + l.filename);
    }

    function cardHtml(c, i, herePid, hereSid) {
      const fileSec = Number(c.file_duration_sec) || 0;
      const sceneSec = Number(c.stash_duration_sec) || 0;
      let durClass = '', durNote = sceneSec ? 'no file length' : 'no scene runtime', durShort = '—';
      if (fileSec > 60 && sceneSec > 60) {
        const drift = Math.abs(fileSec - sceneSec) / Math.max(fileSec, sceneSec);
        // Same bands as bulk-stash: within 3% reads right, past 5% reads wrong.
        // Within 0.2% (the score's top bands) it's picked out.
        durClass = drift <= 0.03 ? 'okv' : (drift <= 0.05 ? '' : 'warnv');
        if (Number((drift * 100).toFixed(1)) <= 0.2) durClass += ' spot';
        durNote = (drift * 100).toFixed(1) + '% apart';
        durShort = (drift * 100).toFixed(1) + '%';
      }
      const scored = c.confidence !== null && c.confidence !== undefined;
      const conf = Number(c.confidence) || 0;
      const confClass = conf >= 70 ? 'good' : (conf >= 40 ? 'mid' : '');
      // The studio opens its own view (picker 14.6 / native 14.10) - unless
      // this IS that studio's view.
      const studioBit = !c.studio ? 'no studio'
        : (hereSid && c.studio_id === hereSid)
          ? esc(c.studio)
          : '<button type="button" class="ssn-stlink" data-stid="' + esc(c.studio_id || '') + '" data-stname="' +
              esc(c.studio) + '" data-sid="' + esc(c.stash_id) + '">' + esc(c.studio) + '</button>';
      const sub = [studioBit].concat([c.release_date, c.code].filter(Boolean).map(esc)).join(' &middot; ');

      const cast = (c.cast || []).map(p =>
        '<button type="button" class="ssn-perf' + (p.id && [].concat(herePid || []).includes(p.id) ? ' here' : '') + '" ' +
          'data-pid="' + esc(p.id || '') + '" data-pname="' + esc(p.name) + '" data-sid="' + esc(c.stash_id) + '">' +
          esc(p.name) + (p.as ? ' <small>as ' + esc(p.as) + '</small>' : '') +
          (p.gender_short && p.gender_short !== '?' ? ' <small>' + esc(p.gender_short) + '</small>' : '') +
        '</button>').join('');

      const reasons = (c.reasons || []);
      const moreBits =
        ((c.tags || []).length ? '<div class="ssn-tags">' + c.tags.map(t => '<span>' + esc(t) + '</span>').join('') + '</div>' : '') +
        (c.director ? '<div class="ssn-syn"><strong>Director:</strong> ' + esc(c.director) + '</div>' : '') +
        (c.details ? '<div class="ssn-syn">' + esc(c.details) + '</div>' : '') +
        (reasons.length
          ? '<table class="ssn-why">' + reasons.map(r =>
              '<tr class="' + (Number(r.points) > 0 ? '' : 'zero') + '"><td>' + esc(r.field) + '</td>' +
              '<td class="p">' + (Number(r.points) > 0 ? '+' + r.points : '0') + '</td>' +
              '<td>' + esc(r.detail) + '</td></tr>').join('') + '</table>'
          : '');
      const moreLabel = [
        (c.tags || []).length ? (c.tags.length + ' tag' + (c.tags.length === 1 ? '' : 's')) : '',
        c.details ? 'synopsis' : '',
        reasons.length ? 'why this score' : ''
      ].filter(Boolean).join(' &middot; ');

      return '<div class="ssn-card" data-i="' + i + '">' +
        '<div class="ssn-top">' +
          (c.cover
            ? '<div class="ssn-cover ssn-thumb' + (revealAll ? ' shown' : '') + '" data-cover><img src="' + esc(c.cover) + '" alt="" loading="lazy">' +
              '<div class="ssn-veil">Tap 3 times</div></div>'
            : '<div class="ssn-cover ssn-thumb none">no cover</div>') +
          '<div class="ssn-tt"><div class="ssn-title">' + esc(c.title || '(untitled scene)') + '</div>' +
            '<div class="ssn-sub">' + sub + '</div>' +
          '</div>' +
        '</div>' +
        // picker 15.41 / native 15.52: one row, then Accept & submit.
        '<div class="ssn-facts ssn-facts5">' +
          '<div class="ssn-fact ssn-cf ' + confClass + '" title="Confidence"><span>Conf</span><b>' + (scored ? conf.toFixed(0) : '—') + '</b></div>' +
          '<div class="ssn-fact ' + durClass + '" title="File length"><span>File</span><b>' + clock(fileSec) + '</b></div>' +
          '<div class="ssn-fact ' + durClass + '" title="Scene length"><span>Scene</span><b>' + clock(sceneSec) + '</b></div>' +
          '<div class="ssn-fact ' + durClass + '" title="Difference: ' + esc(durNote) + '"><span>Diff</span><b>' + esc(durShort) + '</b></div>' +
          '<div class="ssn-fact gm" title="Cast shape"><span>Cast</span><b>' + esc(c.gender_mix || '—') + '</b></div>' +
        '</div>' +
        (canAccept ? '<button type="button" class="ssn-accept ssn-accept-big" data-accept="' + i + '">Accept &amp; submit</button>' : '') +
        (cast ? '<div class="ssn-cast">' + cast + '</div>' : '<div class="ssn-sub" style="margin:0 0 8px;">no performers listed</div>') +
        (moreBits ? '<details class="ssn-more"><summary>' + moreLabel + '</summary>' + moreBits + '</details>' : '') +
        '<div class="ssn-foot">' +
          (canAccept && typeof opts.onTake === 'function' && (c.studio || (c.cast || []).length)
            ? '<button type="button" class="ssn-take" data-take="' + i + '" title="Put this scene&rsquo;s studio and/or performers into this file&rsquo;s details, without attaching the scene">Take studio/performers</button>'
            : '') +
          (c.stash_url ? '<button type="button" class="ssn-ext" data-ext="' + esc(c.stash_url) + '">StashDB &#8599;</button>' : '') +
          (googleUrl(c) ? '<button type="button" class="ssn-google ssn-google-card" title="Search Google for this scene" data-ext="' +
                          esc(googleUrl(c)) + '">Google &#8599;</button>' : '') +
          tubeLinks(sceneTerms(c), 'ssn-google ssn-google-card') +
          libHtml(c, i) +
        '</div>' +
        '<div class="ssn-cerr"></div>' +
      '</div>';
    }

    // ---- In library, Indexxx, Eporner, Porntrex (picker 14.24 / native 14.36; Porntrex picker 15.18 / native 15.19) ----
    // A profile's top bar. In library swaps StashDB's paged scene list for
    // the scenes of your own files (browse 14.38's in_library) and puts this
    // studio / performer in the app's tag filter, taking it back out when
    // switched off if it was the one that added it.
    const libBtn = (e) => '<button type="button" class="ssn-libf' + (e.libOnly ? ' on' : '') + '" data-libonly ' +
      'title="Only the scenes you have">' + (e.libOnly ? '&#10003; In library' : '&#128218; In library') + '</button>';
    function extLinks(name, urls) {
      if (!name) return '';
      const hasIndexxx = (urls || []).some(u => /indexxx\./i.test(u.url || ''));
      return (hasIndexxx ? '' : '<button type="button" class="ssn-ext ssn-extsm" data-ext="' +
                esc('https://www.indexxx.com/search/?query=' + encodeURIComponent(name)) + '">Indexxx &#8599;</button>') +
             tubeLinks(name, 'ssn-ext ssn-extsm');
    }
    /** The value the app's STU / PERF filter holds: studios by their mapped name, lower-cased. */
    function facetName(kind, name) {
      const raw = String(name || '').trim();
      const v = kind === 'studio' && typeof window.scrayMapName === 'function' ? (window.scrayMapName('studio', raw) || raw) : raw;
      return String(v).trim().toLowerCase();
    }
    function toggleLibOnly() {
      const e = top();
      if (!e || (e.type !== 'studio' && e.type !== 'performer') || !e.data) return;
      const kind = e.type;
      const who = kind === 'studio' ? e.data.studio : e.data.performer;
      e.libOnly = !e.libOnly;
      const val = who ? facetName(kind, who.name) : '';
      const set = typeof window.scrayFacetSet === 'function' ? window.scrayFacetSet(kind) : null;
      if (val && e.libOnly) {
        if (!(set && set.has(val)) && typeof window.scrayAddTagFilter === 'function') {
          window.scrayAddTagFilter(kind, val);
          e.libAddedFilter = val;
        }
      } else if (val && e.libAddedFilter === val) {
        window.scrayRemoveTagFilter?.(kind, val);
        e.libAddedFilter = '';
      }
      e.sort = e.libOnly ? 'order' : e.sort;
      load(e, false, true);
    }

    // The filter button paints from the live filter, like the modal's chips.
    function paintFilter() {
      const b = host.querySelector('[data-filter]');
      const e = top();
      const kind = e && e.type === 'studio' ? 'studio' : 'performer';
      const who = e && e.data && (kind === 'studio' ? e.data.studio : e.data.performer);
      if (!b || !who) return;
      const set = typeof window.scrayFacetSet === 'function' ? window.scrayFacetSet(kind) : null;
      const on = !!(set && set.has(facetName(kind, who.name)));
      b.classList.toggle('on', on);
      b.innerHTML = on ? '&#10005; Remove from filter' : '&#8853; Filter by this ' + kind;
    }

    // ---- actions ---------------------------------------------------------
    const search = (term) => {
      const e = top();
      if (!e || e.type !== 'search') return;
      term = String(term ?? '').trim();
      if (!term) { host.querySelector('input.ssn-term')?.focus(); return; }
      e.term = term;
      e.sort = null;
      load(e, false);
    };

    // Cover art straight from StashDB, blurred. Three deliberate taps, and
    // they have to be consecutive - the Stash modal's own cover works this way.
    const coverTaps = new WeakMap();
    function tapCover(el) {
      const veil = el.querySelector('.ssn-veil');
      if (el.classList.contains('shown')) { el.classList.remove('shown'); coverTaps.delete(el); return; }
      const st = coverTaps.get(el) || { n: 0, t: null };
      st.n++;
      clearTimeout(st.t);
      if (st.n >= 3) {
        el.classList.add('shown');
        coverTaps.delete(el);
        return;
      }
      st.t = setTimeout(() => {
        coverTaps.delete(el);
        if (veil) veil.textContent = 'Tap 3 times';
      }, 3000);
      coverTaps.set(el, st);
      if (veil) veil.textContent = (3 - st.n) + ' more tap' + (3 - st.n === 1 ? '' : 's');
    }

    // A two-tap confirm rather than confirm(): a native dialog in FLS lands
    // unrotated behind the player, and on iOS it can wedge the web view.
    // Take studio/performers (picker 15.33 / native 15.42): pick which, then
    // they go into this file's details and the navigator closes onto the
    // lookup, the way Accept does.
    function takeMenu(i) {
      document.getElementById('ssnTakeMenu')?.remove();
      const e = top();
      const c = e && e.data && e.data.scenes[i];
      if (!c || busyAccept || finished) return;
      const cast = (c.cast || []).filter(p => p && p.name);
      const m = document.createElement('div');
      m.className = 'basket-json-modal';
      m.id = 'ssnTakeMenu';
      m.style.cssText = 'transform:none;z-index:2147483647;';
      m.innerHTML =
        '<div class="basket-json-modal-content" style="transform:none;max-width:380px;max-height:82vh;overflow-y:auto;">' +
          '<h3 style="margin-top:0;">Take from this scene</h3>' +
          '<div class="ssn-tk-note">Into this file&rsquo;s own details - the scene itself isn&rsquo;t attached. ' +
            'Performers are added to any already there; the studio replaces.</div>' +
          (c.studio ? '<div class="ssn-tk-head">Studio</div>' +
            '<label><input type="checkbox" data-tk-studio checked><span>' + esc(c.studio) + '</span></label>' : '') +
          (cast.length ? '<div class="ssn-tk-head">Performers</div>' + cast.map((p, k) =>
            '<label><input type="checkbox" data-tk-p="' + k + '" checked><span>' + esc(p.name) +
            (p.gender_short && p.gender_short !== '?' ? ' <small>' + esc(p.gender_short) + '</small>' : '') + '</span></label>').join('') : '') +
          '<div class="ssn-tk-err"></div>' +
          '<div style="display:flex;flex-direction:column;gap:8px;margin-top:12px;">' +
            '<button type="button" class="modal-btn modal-btn-primary" data-tk="save">Save to this file&rsquo;s details</button>' +
            '<button type="button" class="modal-btn modal-btn-cancel" data-tk="">Cancel</button>' +
          '</div>' +
        '</div>';
      const saveB = () => m.querySelector('[data-tk="save"]');
      const picked = () => ({
        studio: m.querySelector('[data-tk-studio]:checked') ? c.studio : '',
        performers: cast.filter((p, k) => m.querySelector('[data-tk-p="' + k + '"]:checked'))
                        .map(p => ({ name: p.name, gender: p.gender_short || '' }))
      });
      m.addEventListener('change', () => {
        const w = picked();
        saveB().disabled = !w.studio && !w.performers.length;
      });
      m.addEventListener('click', async (ev) => {
        if (ev.target === m && !busyAccept) { m.remove(); return; }
        const b = ev.target.closest('[data-tk]');
        if (!b || busyAccept) return;
        ev.stopPropagation();
        if (!b.dataset.tk) { m.remove(); return; }
        const want = picked();
        if (!want.studio && !want.performers.length) return;
        busyAccept = true;
        b.disabled = true;
        b.textContent = 'Saving…';
        backBtn.disabled = closeBtn.disabled = true;
        try {
          const taken = await opts.onTake(want, c);
          busyAccept = false;
          backBtn.disabled = closeBtn.disabled = false;
          m.remove();
          finish({ taken });
        } catch (err) {
          busyAccept = false;
          backBtn.disabled = closeBtn.disabled = false;
          b.disabled = false;
          b.innerHTML = 'Save to this file&rsquo;s details';
          m.querySelector('.ssn-tk-err').textContent = 'Could not save: ' + (err && err.message || err);
        }
      });
      document.body.appendChild(m);
    }

    async function accept(btn) {
      const e = top();
      const c = e && e.data && e.data.scenes[+btn.dataset.accept];
      if (!c || busyAccept) return;
      if (!btn.classList.contains('armed')) {
        host.querySelectorAll('.ssn-accept.armed').forEach(b => {
          b.classList.remove('armed'); b.innerHTML = 'Accept &amp; submit';
        });
        btn.classList.add('armed');
        btn.textContent = 'Tap again to submit';
        clearTimeout(btn._ssnT);
        btn._ssnT = setTimeout(() => {
          if (!btn.isConnected) return;
          btn.classList.remove('armed');
          btn.innerHTML = 'Accept &amp; submit';
        }, 3000);
        return;
      }
      clearTimeout(btn._ssnT);
      const card = btn.closest('.ssn-card');
      const errEl = card && card.querySelector('.ssn-cerr');
      busyAccept = true;
      btn.classList.remove('armed');
      btn.textContent = 'Submitting…';
      host.querySelectorAll('.ssn-accept').forEach(b => { b.disabled = true; });
      backBtn.disabled = closeBtn.disabled = true;
      if (card) card.classList.add('ssn-busy');
      if (errEl) errEl.textContent = '';
      try {
        const response = await opts.onAccept(c.stash_id, c);
        busyAccept = false;
        backBtn.disabled = closeBtn.disabled = false;
        finish({ accepted: c.stash_id, response });
      } catch (err) {
        busyAccept = false;
        backBtn.disabled = closeBtn.disabled = false;
        if (card) card.classList.remove('ssn-busy');
        host.querySelectorAll('.ssn-accept').forEach(b => { b.disabled = false; });
        btn.innerHTML = 'Accept &amp; submit';
        if (errEl) errEl.textContent = 'Could not submit: ' + (err && err.message || err);
      }
    }

    host.addEventListener('click', onClick);
    host.addEventListener('keydown', onKey);
    host.addEventListener('input', onInput);
    host.addEventListener('focusin', onFocusIn);

    // Studio search above the keyboard (13.191 / 13.190). Focusing the box
    // scrolls the modal so the box sits at the top of it, with the list
    // underneath in whatever the keyboard leaves. Bottom padding goes on
    // first so there is always room to scroll that far - the next repaint
    // (picking a studio, closing the list) drops it with the rest of the view.
    // Not on a desktop browser: no keyboard, and nothing to get out of the way of.
    function liftStudioBox() {
      if (finished) return;
      const box = host.querySelector('input.ssn-studio-find');
      if (!box || document.activeElement !== box) return;
      const wrap = host.querySelector('.ssn');
      if (wrap && !wrap.style.paddingBottom) wrap.style.paddingBottom = '60vh';
      const delta = box.getBoundingClientRect().top - host.getBoundingClientRect().top - 8;
      if (Math.abs(delta) > 2) host.scrollTop += delta;
    }
    function onFocusIn(ev) {
      if (!ev.target.closest || !ev.target.closest('input.ssn-studio-find')) return;
      if (typeof window.scrayNoAutoScroll === 'function' && window.scrayNoAutoScroll()) return;
      liftStudioBox();
      // Again once the keyboard is up: iOS can nudge things while it animates.
      setTimeout(liftStudioBox, 350);
    }
    function onInput(ev) {
      if (ev.target.closest && ev.target.closest('input.ssn-find-box')) {
        findTerm = ev.target.value;
        clearTimeout(findTimer);
        if (findTerm.trim().length < 2) runFind();
        else findTimer = setTimeout(runFind, 300);
        return;
      }
      if (ev.target.closest && ev.target.closest('input.ssn-term')) paintPtags();
      if (ev.target.closest && ev.target.closest('input.ssn-studio-find')) paintStudioList();
    }
    function onClick(ev) {
      if (finished) return;
      const t = ev.target;
      const extA = t.closest && t.closest('a[data-exturl]');
      if (extA && host.contains(extA)) { ev.preventDefault(); openExternal(extA.dataset.exturl); return; }
      const cover = t.closest('.ssn-cover[data-cover]');
      if (cover && host.contains(cover)) { tapCover(cover); return; }
      const fo = t.closest('.ssn-find-opt[data-findi]');
      if (fo && host.contains(fo)) { pickFind(+fo.dataset.findi); return; }
      const fg = t.closest('[data-findglobal]');
      if (fg && host.contains(fg)) { runGlobal(); return; }
      const btn = t.closest('button');
      if (!btn || !host.contains(btn)) return;
      const box = host.querySelector('input.ssn-term');

      if (btn.hasAttribute('data-go')) { search(box && box.value); box && box.blur(); return; }
      if (btn.dataset.ptag !== undefined) { togglePtag(+btn.dataset.ptag); return; }
      if (btn.dataset.pstudio !== undefined) { pillMenu(btn.dataset.pstudio); return; }
      if (btn.dataset.pperf !== undefined) { pillMenu(btn.dataset.pperf, 'performer'); return; }
      if (btn.dataset.pword !== undefined) { toggleWord(btn.dataset.pword); return; }
      if (btn.dataset.ddDone) { closeDd(btn.dataset.ddDone); return; }
      if (btn.dataset.rfToggle) {
        const e = top();
        if (!e || e.type !== 'search') return;
        const dd = btn.dataset.rfToggle, other = dd === 'rfs' ? 'rfp' : 'rfs';
        e[DD[dd].open] = !e[DD[dd].open];
        e[DD[dd].focus] = e[DD[dd].open];
        e[DD[other].open] = false;
        paint(false, true);
        return;
      }
      if (btn.dataset.rfPick !== undefined) {
        const e = top();
        const dd = btn.dataset.dd;
        if (!e || e.type !== 'search' || !DD[dd]) return;
        // "All" or the x: clear that list and close it; a name toggles and
        // the list stays open for the next one.
        if (!btn.dataset.rfPick) { e[DD[dd].picks] = []; e[DD[dd].open] = false; e[DD[dd].term] = ''; }
        else rfToggle(e, dd, btn.dataset.rfPick);
        paint(false, true);
        return;
      }
      if (btn.hasAttribute('data-rfclear')) {
        const e = top();
        if (!e) return;
        e.rfStudios = []; e.rfPerfs = [];
        e.rfsOpen = e.rfpOpen = false;
        paint(false, true);
        return;
      }
      if (btn.dataset.stpage !== undefined) { push({ type: 'studio', id: '', name: btn.dataset.stpage || '', sceneId: '' }); return; }
      if (btn.dataset.pfpage !== undefined) { push({ type: 'performer', id: '', name: btn.dataset.pfpage || '', sceneId: '' }); return; }
      if (btn.hasAttribute('data-unblur')) {
        revealAll = !revealAll;
        host.querySelectorAll('.ssn-cover[data-cover]').forEach(c => {
          c.classList.toggle('shown', revealAll);
          coverTaps.delete(c);
          const v = c.querySelector('.ssn-veil');
          if (v) v.textContent = 'Tap 3 times';
        });
        host.querySelectorAll('[data-unblur]').forEach(b => {
          if (b.classList.contains('ssn-eye')) {
            b.innerHTML = revealAll ? '&#128584;' : '&#128065;';
            b.title = revealAll ? 'Blur all covers again' : 'Unblur all covers';
          } else b.innerHTML = revealAll ? '&#128584; Blur all' : '&#128065; Unblur all';
        });
        return;
      }
      if (btn.hasAttribute('data-play')) {
        preview(video, host.closest('.basket-json-modal') || null);
        return;
      }
      if (btn.hasAttribute('data-camel')) {
        const v = clean(box ? box.value : '');
        if (box) box.value = v;
        search(v);
        return;
      }
      if (btn.hasAttribute('data-fname')) {
        const v = words(video.filename || '');
        if (box) box.value = v;
        search(v);
        return;
      }
      if (btn.hasAttribute('data-studio-toggle')) {
        const e = top();
        if (!e) return;
        const K = DD[btn.dataset.dd] || DD.main;
        e[K.open] = !e[K.open];
        e[K.focus] = e[K.open];
        paint(false, true);
        return;
      }
      if (btn.dataset.studioPick !== undefined) {
        const e = top();
        if (!e || (e.type !== 'performer' && e.type !== 'studio')) return;
        const K = DD[btn.dataset.dd] || DD.main;
        const id = btn.dataset.studioPick;
        const picks = e[K.picks] || [];
        if (!id) {
          // "All" or the x: clear the lot and close the list.
          e[K.open] = false;
          e[K.term] = '';
          if (!picks.length) { paint(false, true); return; }
          e[K.picks] = [];
        } else {
          // A tick toggles; the list stays open for the next one.
          e[K.picks] = picks.some(x => x.id === id)
            ? picks.filter(x => x.id !== id)
            : picks.concat([{ id, name: btn.dataset.studioName || '' }]);
        }
        e.sort = 'order';
        load(e, false, true);
        return;
      }
      if (btn.dataset.sort) {
        const e = top();
        if (e && e.sort !== btn.dataset.sort) { e.sort = btn.dataset.sort; paint(false, true); }
        // In a hunt, the next files' searches open in this order too (picker 15.43 / native 15.54).
        if (e && e.type === 'search' && inHunt && typeof hunt.setSearchSort === 'function') {
          try { hunt.setSearchSort(btn.dataset.sort); } catch (err) { /* this card only */ }
        }
        return;
      }
      if (btn.dataset.ext) { openExternal(btn.dataset.ext); return; }
      if (btn.dataset.lib !== undefined) { openLibrary(+btn.dataset.lib); return; }
      if (btn.dataset.accept !== undefined) { accept(btn); return; }
      if (btn.dataset.take !== undefined) { takeMenu(+btn.dataset.take); return; }
      if (btn.hasAttribute('data-more')) { const e = top(); if (e && !e.busy) load(e, true); return; }
      if (btn.hasAttribute('data-libonly')) { if (!(top() || {}).busy) toggleLibOnly(); return; }
      if (btn.hasAttribute('data-filter')) {
        const e = top();
        const kind = e && e.type === 'studio' ? 'studio' : 'performer';
        const who = e && e.data && (kind === 'studio' ? e.data.studio : e.data.performer);
        const name = who && who.name;
        if (!name) return;
        const val = facetName(kind, name);
        const set = typeof window.scrayFacetSet === 'function' ? window.scrayFacetSet(kind) : null;
        if (set && set.has(val)) window.scrayRemoveTagFilter?.(kind, val);
        else window.scrayAddTagFilter?.(kind, val);
        paintFilter();
        return;
      }
      if (btn.classList.contains('ssn-stlink')) {
        const e = top();
        const stid = btn.dataset.stid || '';
        if (e && e.type === 'studio' && stid && e.id === stid) return;
        push({ type: 'studio', id: stid, name: btn.dataset.stname || '', sceneId: btn.dataset.sid || '' });
        return;
      }
      if (btn.classList.contains('ssn-perf')) {
        const e = top();
        const pid = btn.dataset.pid || '';
        // Already on this performer's page: nothing to open.
        if (e && e.type === 'performer' && pid && e.id === pid) return;
        push({ type: 'performer', id: pid, name: btn.dataset.pname || '', sceneId: btn.dataset.sid || '' });
      }
    }
    function onKey(ev) {
      const fbox = ev.target.closest && ev.target.closest('input.ssn-find-box');
      if (fbox) {
        ev.stopPropagation();        // not the player's single-key shortcuts
        if (ev.key === 'Enter') { ev.preventDefault(); if (findHits().length) pickFind(0); else if (findLocal) runGlobal(); else { clearTimeout(findTimer); runFind(); } }
        else if (ev.key === 'Escape' && fbox.value) {
          ev.preventDefault();
          fbox.value = ''; findTerm = ''; runFind();
        }
        return;
      }
      const sbox = ev.target.closest && ev.target.closest('input.ssn-studio-find');
      if (sbox) {
        ev.stopPropagation();        // not the player's single-key shortcuts
        if (ev.key === 'Enter') { ev.preventDefault(); sbox.blur(); }
        return;
      }
      const box = ev.target.closest && ev.target.closest('input.ssn-term');
      if (!box) return;
      ev.stopPropagation();          // not the player's single-key shortcuts
      if (ev.key === 'Enter') {
        ev.preventDefault();
        search(box.value);
        box.blur();                  // put the keyboard away so the results show
      }
    }

    const start = opts.start || { type: 'search', term: words(video.filename || '') };
    push(start.type === 'home' ? { type: 'home' } : start.type === 'performer'
      ? { type: 'performer', id: start.id || '', name: start.name || '', sceneId: start.sceneId || '', fromKey: start.fromKey || '' }
      : start.type === 'studio'
        ? { type: 'studio', id: start.id || '', name: start.name || '', sceneId: start.sceneId || '', fromKey: start.fromKey || '' }
        : { type: 'search', term: String(start.term || '').trim() || words(video.filename || '') });

    return {
      close: () => finish(null),
      get busy() { return busyAccept; }
    };
  }

  // ---- ▶ preview (13.163 / 13.162) ----------------------------------------
  // The file plays in the app's own player, as a PREVIEW (no history, no view,
  // no watched time - playVideoInline's opts.preview), floated over the page
  // the way wholesale mode's ▶ floats it. The Stash modal is hidden while it
  // plays and comes back when the preview is closed (×, a tap on the dim
  // backdrop, or "Back to Stash").
  //
  // If the file is ALREADY the one in the player - the usual case when the
  // modal was opened from the S circle - it isn't restarted as a preview,
  // which would lose your place: the modal just steps aside and playback
  // carries on from where it was.
  // ⚙️ How far in a preview opens. Wholesale uses the same quarter.
  const PREVIEW_START_FRACTION = 0.25;
  let pv = null;   // { overlay, same, displayWas }

  function ensurePreviewCss() {
    if (document.getElementById('scrayStashPvCss')) return;
    const css = document.createElement('style');
    css.id = 'scrayStashPvCss';
    css.textContent = `
#ssnPvScrim, #ssnPvBar, #ssnPvPill { display: none; }
body.ssn-pv-open #ssnPvScrim { display: block; position: fixed; inset: 0; background: rgba(0,0,0,.82); z-index: 2147482000; }
body.ssn-pv-open #ssnPvBar { display: flex; align-items: flex-end; gap: 8px; position: absolute; bottom: 100%; left: 0; right: 0; margin-bottom: 6px; z-index: 2147482002; }
#ssnPvBar .ssn-pv-name { flex: 1 1 auto; min-width: 0; color: #ddd; font-size: .78rem; line-height: 1.3; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; word-break: break-all; }
#ssnPvBar button, #ssnPvPill { flex: 0 0 auto; width: auto; min-width: 0; margin: 0; padding: 6px 12px; font-size: .8rem; line-height: 1.2; background: #6c5ce7; color: #fff; border: none; border-radius: 16px; cursor: pointer; white-space: nowrap; -webkit-tap-highlight-color: transparent; }
body.ssn-pv-open.fullscreen-active #ssnPvScrim, body.ssn-pv-open.fullscreen-active #ssnPvBar { display: none; }
body.ssn-pv-open:not(.fullscreen-active) #inlineVideoContainer.float-player {
  position: fixed !important; top: calc(50% + 6vh) !important; bottom: auto !important;
  left: 50% !important; right: auto !important; transform: translate(-50%, -50%);
  width: min(92vw, 760px) !important; max-width: min(92vw, 760px) !important;
  margin: 0 !important; height: auto !important; background: #000; border-radius: 6px;
  overflow: visible !important; box-shadow: 0 10px 30px rgba(0,0,0,.55); z-index: 2147482001;
}
body.ssn-pv-open:not(.fullscreen-active) #inlineVideoContainer.float-player video,
body.ssn-pv-open:not(.fullscreen-active) #inlineVideoContainer.float-player .plyr { max-height: 68vh; }
body.ssn-pv-open:not(.fullscreen-active) #currentVideoInfo { display: none !important; }
body.ssn-pv-open:not(.fullscreen-active) #inlineVideoContainer.float-player > #currentVideoInfo:not(:empty) {
  display: block !important; position: static !important; left: auto !important; right: auto !important; bottom: auto !important;
  width: 100% !important; max-width: 100% !important; margin: 0 !important; box-sizing: border-box;
  border: none !important; border-radius: 0 0 6px 6px !important; z-index: auto !important;
  max-height: 22vh; overflow-y: auto; -webkit-overflow-scrolling: touch;
}
#ssnPvPill.on { display: block; position: fixed; left: 50%; transform: translateX(-50%); top: calc(env(safe-area-inset-top, 0px) + 10px); z-index: 2147483647; box-shadow: 0 4px 14px rgba(0,0,0,.4); }
body.fullscreen-active #ssnPvBar { display: none; }
`;
    document.head.appendChild(css);
  }

  const keyOf = (v) => v ? String(v.videoKey || (window.scrayVideoKey ? window.scrayVideoKey(v.filename || '') : v.filename || '')) : '';

  function pvChrome() {
    let scrim = document.getElementById('ssnPvScrim');
    if (!scrim) {
      scrim = document.createElement('div');
      scrim.id = 'ssnPvScrim';
      scrim.addEventListener('click', (e) => { if (e.target === scrim) endPreview(); });
      document.body.appendChild(scrim);
    }
    let bar = document.getElementById('ssnPvBar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'ssnPvBar';
      bar.innerHTML = '<span class="ssn-pv-name"></span><button type="button">&#8617; Back to Stash</button>';
      bar.querySelector('button').addEventListener('click', (e) => { e.stopPropagation(); endPreview(); });
      document.body.appendChild(bar);
    }
    let pill = document.getElementById('ssnPvPill');
    if (!pill) {
      pill = document.createElement('button');
      pill.type = 'button';
      pill.id = 'ssnPvPill';
      pill.innerHTML = '&#8617; Back to Stash';
      pill.addEventListener('click', (e) => { e.stopPropagation(); endPreview(); });
      document.body.appendChild(pill);
    }
    return { scrim, bar, pill };
  }

  // The now-playing strip under the preview (picker 15.34 / native 15.43).
  // #currentVideoInfo - folders, name, score, size and its P D ★ B S BM
  // buttons - is MOVED into the floated player, after the video, so it sits
  // right underneath it. Moved rather than copied, the way FLS moves it into
  // the title, so its listeners stay put and everything that rebuilds it
  // (they find it by id) still does. It goes back under the player when the
  // preview ends. If FLS borrows it mid-preview and hands it back to the page,
  // the observer brings it back into the float.
  let pvStripObs = null;
  function pvPlaceStrip() {
    if (!pv || !pv.floated) return;
    const container = document.getElementById('inlineVideoContainer');
    const strip = document.getElementById('currentVideoInfo');
    if (!container || !strip || strip.closest('.fls-video-title')) return;
    if (strip.parentElement !== container) container.appendChild(strip);
  }
  function pvHoldStrip() {
    pvPlaceStrip();
    if (pvStripObs || typeof MutationObserver !== 'function') return;
    pvStripObs = new MutationObserver(pvPlaceStrip);
    pvStripObs.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }
  function pvReleaseStrip() {
    if (pvStripObs) { pvStripObs.disconnect(); pvStripObs = null; }
    const container = document.getElementById('inlineVideoContainer');
    const strip = document.getElementById('currentVideoInfo');
    if (container && strip && strip.parentElement === container) container.insertAdjacentElement('afterend', strip);
  }

  function preview(video, overlay) {
    const player = window.inlineVideoPlayer;
    if (!player || typeof player.play !== 'function') {
      alert('The player isn’t ready yet.');
      return;
    }
    ensurePreviewCss();
    if (pv) endPreview();
    const ch = pvChrome();
    const same = !!window.currentPlayingVideo && keyOf(window.currentPlayingVideo) === keyOf(video);
    pv = { overlay, same, displayWas: overlay ? overlay.style.display : '' };
    if (overlay) overlay.style.display = 'none';

    const container = document.getElementById('inlineVideoContainer');
    const floatable = !same && container && !document.body.classList.contains('fullscreen-active');
    if (floatable) {
      ch.bar.querySelector('.ssn-pv-name').textContent = (video.path ? video.path + '/' : '') + (video.filename || '');
      if (ch.bar.parentNode !== container) container.appendChild(ch.bar);
      document.body.classList.add('ssn-pv-open');
      container.classList.add('float-player');
      pv.floated = true;
      pvHoldStrip();
      if (typeof window.computeBottomDock === 'function') window.computeBottomDock();
    } else {
      ch.pill.classList.add('on');
      pinPill(ch.pill);
    }

    if (same) {
      try { if (window.plyrPlayer && window.plyrPlayer.paused) window.plyrPlayer.play(); } catch (e) { /* stays paused */ }
      return;
    }
    const durationSec = Number(video.durationMs) > 0 ? video.durationMs / 1000
                      : (Number(video.duration) > 0 ? Number(video.duration) : 0);
    const startAt = durationSec > 0 ? durationSec * PREVIEW_START_FRACTION : null;
    window.lastPlayLabel = 'Preview' + (startAt != null ? ' @ ' + Math.round(PREVIEW_START_FRACTION * 100) + '%' : '');
    try {
      Promise.resolve(player.play(video, null, null, startAt, { preview: true }))
        .catch(err => console.error('[stash] preview failed:', err));
    } catch (err) {
      console.error('[stash] preview failed:', err);
    }
  }

  // Back to Stash beside the video (native 13.189). When the file was already
  // playing, the player stays where it is on the page, so the pill follows it:
  // centred just above the video, kept on screen, and over the top of the
  // video when there is no room above. In fullscreen the stylesheet's top
  // placement stands - the video is the whole screen there anyway.
  let pillRaf = 0;
  let safeTop = null;
  function readSafeTop() {
    if (safeTop !== null) return safeTop;
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;top:0;left:0;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top, 0px);';
    document.body.appendChild(probe);
    safeTop = parseFloat(getComputedStyle(probe).paddingTop) || 0;
    probe.remove();
    return safeTop;
  }
  function pinPill(pill) {
    cancelAnimationFrame(pillRaf);
    const tick = () => {
      if (!pill.classList.contains('on')) { pillRaf = 0; return; }
      const container = document.getElementById('inlineVideoContainer');
      const target = container && (container.querySelector('.plyr') || container.querySelector('video') || container);
      const r = target && target.getBoundingClientRect();
      if (document.body.classList.contains('fullscreen-active') || !r || !r.width || !r.height) {
        pill.style.top = ''; pill.style.left = '';
      } else {
        const h = pill.offsetHeight || 30;
        const minTop = readSafeTop() + 6;
        const maxTop = window.innerHeight - h - 6;
        let t = r.top - h - 6;
        if (t < minTop) t = Math.min(r.top + 6, maxTop);
        pill.style.top = Math.max(minTop, Math.min(maxTop, t)) + 'px';
        pill.style.left = Math.max(8, Math.min(window.innerWidth - 8, r.left + r.width / 2)) + 'px';
      }
      pillRaf = requestAnimationFrame(tick);
    };
    tick();
  }

  function endPreview() {
    if (!pv) return;
    const st = pv;
    pv = null;
    cancelAnimationFrame(pillRaf);
    pillRaf = 0;
    const bar = document.getElementById('ssnPvBar');
    const pill = document.getElementById('ssnPvPill');
    if (pill) { pill.classList.remove('on'); pill.style.top = ''; pill.style.left = ''; }
    if (st.floated) {
      pvReleaseStrip();
      if (bar && bar.parentNode !== document.body) document.body.appendChild(bar);
      document.body.classList.remove('ssn-pv-open');
      document.getElementById('inlineVideoContainer')?.classList.remove('float-player');
      if (typeof window.computeBottomDock === 'function') window.computeBottomDock();
    }
    if (!st.same) {
      // The popup IS the player: hiding it alone would leave the audio going.
      try { window.inlineVideoPlayer?.stop?.(); } catch (e) { /* already stopped */ }
    } else {
      try { if (window.plyrPlayer && !window.plyrPlayer.paused) window.plyrPlayer.pause(); } catch (e) { /* fine */ }
    }
    if (st.overlay && document.body.contains(st.overlay)) st.overlay.style.display = st.displayWas || '';
  }

  // ---- performer name in a list row (13.163 / 13.162) ----------------------
  // The purple performer names used to filter on a tap. Now they ask: filter
  // by the name, or look the performer up in the Stash navigator - which opens
  // this file's Stash modal straight onto their profile.
  //
  // picker 14.3 / native 14.6: "Add to search" as well - the name goes into
  // the search box (quoted if it has a space, appended to what's there), which
  // matches it anywhere in a file's text rather than only in that one field.
  // Studios get the same modal now (they used to filter straight away).
  // picker 14.6 / native 14.10: and Stash nav too, onto the studio view.
  function performerChoice(video, name, kind) {
    kind = kind === 'studio' ? 'studio' : 'performer';
    document.getElementById('scrayPerfChoice')?.remove();
    const modal = document.createElement('div');
    modal.className = 'basket-json-modal';
    modal.id = 'scrayPerfChoice';
    modal.style.zIndex = '2147483647';
    const set = typeof window.scrayFacetSet === 'function' ? window.scrayFacetSet(kind) : null;
    const on = !!(set && set.has(String(name).trim().toLowerCase()));
    modal.innerHTML =
      '<div class="basket-json-modal-content" style="max-width:340px;">' +
        '<h3 style="margin-top:0;">' + esc(name) + '</h3>' +
        '<div style="display:flex;flex-direction:column;gap:8px;">' +
          '<button type="button" class="modal-btn modal-btn-primary" data-c="filter">' +
            (on ? '&#10005; Remove from filter' : '&#8853; Filter as a tag') + '</button>' +
          '<button type="button" class="modal-btn modal-btn-secondary" data-c="search">&#43; Add to search</button>' +
          '<button type="button" class="modal-btn modal-btn-secondary" data-c="nav">&#128269; Search in Stash nav</button>' +
          '<button type="button" class="modal-btn modal-btn-cancel" data-c="">Cancel</button>' +
        '</div>' +
      '</div>';
    const done = () => modal.remove();
    modal.addEventListener('click', (e) => {
      if (e.target === modal) { done(); return; }
      const b = e.target.closest('[data-c]');
      if (!b) return;
      e.stopPropagation();
      done();
      if (b.dataset.c === 'filter') {
        if (on) window.scrayRemoveTagFilter?.(kind, name);
        else if (typeof window.scrayAddTagFilter === 'function') window.scrayAddTagFilter(kind, name);
        else if (typeof window.scrayAddSearchTerm === 'function') window.scrayAddSearchTerm(name);
      } else if (b.dataset.c === 'search') {
        if (typeof window.scrayAddSearchTerm === 'function') window.scrayAddSearchTerm(name);
      } else if (b.dataset.c === 'nav') {
        if (typeof window.showStashModal === 'function') {
          window.showStashModal(video, kind === 'studio' ? { studio: name } : { performer: name });
        }
      }
    });
    document.body.appendChild(modal);
  }

  // ---- ?play=<video_key> (picker 13.189 / native 13.190) ------------------
  // What Native's In library link opens. Waits for the lock screen, the player
  // and the library, plays the file in the main list's context where it can,
  // then takes the parameter off the address so a reload doesn't play it again.
  // Native's own index.html is never opened with it, so this only ever runs in
  // Picker - in a desktop browser or in Native's in-app browser.
  (function playFromUrl() {
    // Native's main web view has the full bridge (openBrowser). Picker inside
    // Native's in-app browser gets a smaller bridge without it, and must run.
    if (window.ScrayBridge && window.ScrayBridge.openBrowser) return;
    let key = '';
    try { key = new URL(location.href).searchParams.get('play') || ''; } catch (e) { return; }
    key = String(key).normalize('NFC').trim().toLowerCase();
    if (!key) return;

    const dropParam = () => {
      try {
        const u = new URL(location.href);
        u.searchParams.delete('play');
        history.replaceState(history.state, '', u.toString());
      } catch (e) { /* the address keeps it; harmless */ }
    };
    // ⚙️ How long to wait for the library before giving up (a first sync on a
    // fresh browser can take a while).
    const GIVE_UP_MS = 120000;
    const started = Date.now();
    let busy = false;

    const tick = async () => {
      if (busy) return;
      busy = true;
      try {
        const lock = document.getElementById('lockOverlay');
        const locked = lock && getComputedStyle(lock).display !== 'none';
        const player = window.inlineVideoPlayer;
        if (!locked && player && typeof player.play === 'function' && typeof window.getAllVideos === 'function') {
          const all = await window.getAllVideos();
          const match = (all || []).find(v =>
            (v.videoKey || (window.scrayVideoKey ? window.scrayVideoKey(v.filename || '') : '')) === key);
          if (match) {
            clearInterval(timer);
            dropParam();
            const list = (window.paginationState && window.paginationState.allVideos) || [];
            const idx = list.findIndex(v => v.oneDriveId === match.oneDriveId);
            window.lastPlayLabel = 'From Stash';
            player.play(match, idx >= 0 ? 'main' : null, idx >= 0 ? idx : null);
            return;
          }
        }
        if (Date.now() - started > GIVE_UP_MS) {
          clearInterval(timer);
          dropParam();
          alert('Couldn\u2019t find that file in the library.\n\nKey: ' + key);
        }
      } catch (err) {
        console.error('[stash] play from URL failed:', err);
      } finally {
        busy = false;
      }
    };
    const timer = setInterval(tick, 1000);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tick, { once: true });
    else tick();
  })();

  // ---- a profile with no file (picker 14.13 / native 14.19) ---------------
  // The tag cloud's "Open in Stash" opens a studio's or performer's page. If
  // something is playing it goes through the Stash modal for that file (cards
  // scored against it, scenes acceptable); if nothing is, the navigator opens
  // on its own in the same card, just browsing - nothing to accept or score.
  // fromKey (picker 14.17 / native 14.30): a catalogue file carrying this
  // studio / performer - the server reads the id off its matched scene.
  function openProfile(kind, name, fromKey) {
    const start = kind === 'studio' ? { type: 'studio', name: String(name), fromKey: fromKey || '' }
                                    : { type: 'performer', name: String(name), fromKey: fromKey || '' };
    const playing = window.currentPlayingVideo;
    if (playing && typeof window.showStashModal === 'function') {
      window.showStashModal(playing, kind === 'studio' ? { studio: start.name, fromKey: start.fromKey }
                                                       : { performer: start.name, fromKey: start.fromKey });
      return;
    }
    openSolo(start);
  }

  // The navigator in a card of its own, no file behind it - just browsing.
  // openProfile with nothing playing, and the Stash button (openHome).
  function openSolo(start) {
    document.getElementById('stashModal')?.remove();
    const modal = document.createElement('div');
    modal.className = 'basket-json-modal';
    modal.id = 'stashModal';
    modal.style.cssText = 'transform:none;padding:0;z-index:2147483647;';
    modal.innerHTML =
      '<div class="basket-json-modal-content" style="transform:none;max-width:640px;' +
           'max-height:82vh;display:flex;flex-direction:column;overflow:hidden;">' +
        '<h3 style="margin-top:0;flex:0 0 auto;">Stash</h3>' +
        '<div class="ssn-solo-body" style="flex:1 1 auto;min-height:0;overflow-y:auto;' +
             '-webkit-overflow-scrolling:touch;"></div>' +
        '<div class="ssn-solo-footer" style="display:flex;gap:8px;margin-top:14px;flex:0 0 auto;"></div>' +
      '</div>';
    document.body.appendChild(modal);

    // Clear of the keyboard (picker 14.20 / native 14.32). WKWebView doesn't
    // shrink the page for the keyboard, so a centred card sat behind it with
    // the results and Done under the keys. The card is pinned near the top
    // instead and its height follows the visible strip (visualViewport), so
    // its own body scrolls and the footer stays just above the keyboard.
    const card = modal.firstElementChild;
    modal.style.alignItems = 'flex-start';
    modal.style.paddingTop = 'calc(env(safe-area-inset-top, 0px) + 12px)';
    const vv = window.visualViewport;
    const fit = () => {
      if (!modal.isConnected) return;
      const top = card.getBoundingClientRect().top;
      const visBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
      // ⚙️ 8px clear above the keys; never taller than the old 82vh.
      card.style.maxHeight = Math.max(160, Math.min(window.innerHeight * 0.82, visBottom - top - 8)) + 'px';
    };
    const refit = () => { fit(); setTimeout(fit, 350); };   // again once the keyboard has settled
    if (vv) { vv.addEventListener('resize', fit); vv.addEventListener('scroll', fit); }
    modal.addEventListener('focusin', refit);
    modal.addEventListener('focusout', refit);
    fit();
    const done = () => {
      if (vv) { vv.removeEventListener('resize', fit); vv.removeEventListener('scroll', fit); }
      modal.remove();
    };
    // Same three ways out as the Stash modal's own opener.
    const openExternal = (url) => {
      if (window.SCRAY_IN_APP_BROWSER) {
        window.location.href = 'scraynative://newtab?url=' + encodeURIComponent(url);
        return;
      }
      if (window.ScrayBridge && window.ScrayBridge.openBrowser) {
        window.ScrayBridge.openBrowser(url).catch(err => console.error('[stash] openBrowser failed:', err));
        return;
      }
      window.open(url, '_blank');
    };
    open({
      host: modal.querySelector('.ssn-solo-body'),
      actions: modal.querySelector('.ssn-solo-footer'),
      heading: modal.querySelector('h3'),
      video: {},
      videoKey: '',
      canAccept: false,
      rootBackLabel: '‹ Done',
      start,
      openExternal,
      onAccept: () => Promise.reject(new Error('No file to attach a scene to.')),
      onClose: done,
      onDone: done
    });
  }

  /** The Stash button under the console (picker 14.19 / native 14.31). */
  function openHome() { openSolo({ type: 'home' }); }

  // Delegated, so the button can sit in either app's markup with no wiring there.
  document.addEventListener('click', (ev) => {
    const b = ev.target && ev.target.closest && ev.target.closest('#openStashNavBtn');
    if (!b) return;
    ev.preventDefault();
    openHome();
  });

  /**
   * Studio names a file's folder tags stand for (picker 14.28 / native 14.41).
   *
   * A folder is often named after a studio's short name in manage-data ("aa"
   * for Amateur Allure), which StashDB has never heard of. Either direction
   * counts: a tag matching a mapped name suggests the studio it was mapped
   * from, and one matching a studio suggests its mapped name. The dictionary
   * only carries the raw names folded to lowercase, so those are title-cased;
   * StashDB's search ignores case. Nothing already in `tags` comes back.
   * Shared with the lookup panel's not-found pills (file-operations.js).
   */
  function studioSuggestions(tags) {
    const nm = window.scrayNameMap;
    const studios = (nm && nm.dump && nm.dump().studio) || {};
    const fold = nm && nm.key ? nm.key : (x => String(x ?? '').normalize('NFC').trim().toLowerCase());
    const titled = (x) => x.replace(/(^|[\s\-])(\S)/g, (m, a, c) => a + c.toUpperCase());
    const seen = new Set((tags || []).map(fold));
    const extra = [];
    // Folder tags are hyphenated ("amateur-allure"), names are not, so each
    // is compared with its hyphens as spaces too.
    const alt = k => k.replace(/-/g, ' ');
    (tags || []).forEach(t => {
      const k = fold(t);
      if (!k) return;
      Object.keys(studios).forEach(rk => {
        const mapped = String(studios[rk] || '');
        const mk = fold(mapped);
        let hit = '';
        if (mapped && (mk === k || mk === alt(k)) && rk !== k && rk !== alt(k)) hit = titled(rk);
        else if ((rk === k || rk === alt(k)) && mapped && mk !== k && mk !== alt(k)) hit = mapped;
        const hk = fold(hit);
        if (!hit || seen.has(hk)) return;
        seen.add(hk);
        extra.push(hit);
      });
    });
    return extra;
  }

  window.scrayStashNav = { open, words, clean, preview, endPreview, openProfile, openHome, studioSuggestions };
  window.scrayPerformerChoice = performerChoice;
})();

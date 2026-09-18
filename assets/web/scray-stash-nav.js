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
    return noise(noise(String(text ?? '').replace(/[^\p{L}\p{N}'\s]+/gu, ' '))
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2'))
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
#stashModal .ssn input.ssn-term:focus { outline: none; border-color: #8b7cf0; box-shadow: 0 0 0 2px rgba(139,124,240,.25); }
#stashModal .ssn-btns { display: flex; gap: 6px; flex-wrap: wrap; }
#stashModal .ssn-ptags { display: flex; flex-wrap: wrap; gap: 5px; margin: 0 0 7px; }
#stashModal .ssn-ptags:empty { display: none; }
#stashModal .ssn .ssn-ptag { padding: 2px 9px; border-radius: 12px; border: 1px solid #b9d4f5; background: #eaf3ff; color: #0b5ed7; font-size: .76rem; }
#stashModal .ssn .ssn-ptag.on { background: #28a745; border-color: #28a745; color: #fff; }
#stashModal .ssn .ssn-play { padding: 6px 11px; }
#stashModal .ssn .ssn-unblur { margin-left: auto; }
#stashModal .ssn .ssn-google.ssn-google-card { margin-left: 0; padding: 6px 12px; font-size: .8rem; }
#stashModal .ssn .ssn-lib { background: #28a745; border-color: #28a745; color: #fff; }
#stashModal .ssn-topbar { justify-content: flex-end; margin: 0 0 8px; }
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
    const headingWas = heading ? heading.textContent : '';

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
    actions.appendChild(backBtn);
    actions.appendChild(closeBtn);

    const finish = (result) => {
      if (finished) return;
      finished = true;
      loadSeq++;
      host.removeEventListener('click', onClick);
      host.removeEventListener('keydown', onKey);
      host.removeEventListener('input', onInput);
      host.removeEventListener('focusin', onFocusIn);
      backBtn.remove();
      closeBtn.remove();
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
      load(top(), false);
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
        if (!entry.sort) entry.sort = (entry.type === 'search' && res.scored) ? 'match' : 'order';
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

      if (heading) {
        heading.textContent = e.type === 'search'
          ? 'Stash search'
          : e.type === 'studio'
            ? (e.data && e.data.studio ? e.data.studio.name : (e.name || 'Studio'))
            : (e.data && e.data.performer ? e.data.performer.name : (e.name || 'Performer'));
      }
      backBtn.textContent = stack.length > 1 ? '‹ Back' : (opts.rootBackLabel || '‹ Back to lookup');

      host.innerHTML = '<div class="ssn">' +
        (e.type === 'search' ? searchHtml(e) : e.type === 'studio' ? studioViewHtml(e) : performerHtml(e)) + '</div>';

      if (restore) host.scrollTop = e.scroll || 0;
      else if (keepScroll) host.scrollTop = scrollWas;
      else host.scrollTop = 0;

      if (hadFocus) {
        const nb = host.querySelector('input.ssn-term');
        if (nb) { nb.focus(); nb.setSelectionRange(nb.value.length, nb.value.length); }
      }
      const wantDd = focusDd || (e.studioFocus ? 'main' : e.subFocus ? 'sub' : '');
      if (wantDd) {
        e.studioFocus = false;
        e.subFocus = false;
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
    const pathTags = (() => {
      const seen = new Set(), out = [];
      [].concat(video.tags || [], video.bracketTags || []).forEach(t => {
        const v = String(t ?? '').trim();
        const k = v.toLowerCase();
        if (!v || seen.has(k) || k === 'yet-to-upload') return;
        seen.add(k);
        out.push(v);
      });
      return out;
    })();
    const ptagsHtml = () => '<div class="ssn-ptags">' +
      pathTags.map((t, i) => '<button type="button" class="ssn-ptag" data-ptag="' + i + '">' + esc(t) + '</button>').join('') +
      '</div>';
    const reEsc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const tagRe = (t) => new RegExp('(^|\\s)' + reEsc(t) + '(?=\\s|$)', 'i');
    function paintPtags() {
      const box = host.querySelector('input.ssn-term');
      if (!box) return;
      host.querySelectorAll('.ssn-ptag').forEach(b => {
        const t = pathTags[+b.dataset.ptag];
        b.classList.toggle('on', !!t && tagRe(t).test(box.value));
      });
    }
    function togglePtag(i) {
      const box = host.querySelector('input.ssn-term');
      const t = pathTags[i];
      if (!box || !t) return;
      box.value = tagRe(t).test(box.value)
        ? box.value.replace(tagRe(t), ' ').replace(/\s+/g, ' ').trim()
        : (box.value.trim() + ' ' + t).trim();
      paintPtags();
    }

    function searchHtml(e) {
      const n = e.data ? e.data.scenes.length : 0;
      const label = e.data ? (n ? n + ' result' + (n === 1 ? '' : 's') : '') : '';
      const list = e.data && !n && !e.busy && !e.error
        ? '<div class="ssn-empty">Nothing came back for those words.<br>' +
          'Try the performer&rsquo;s name, or the studio and a couple of words from the title.</div>'
        : sortedScenes(e).map(x => cardHtml(x.s, x.i, null)).join('');
      return '' +
        '<div class="ssn-refine">' +
          '<input class="ssn-term" type="search" enterkeyhint="search" spellcheck="false" autocomplete="off" ' +
                 'autocorrect="off" autocapitalize="off" placeholder="performer name, studio, title words&hellip;" ' +
                 'value="' + esc(e.term) + '">' +
          ptagsHtml() +
          '<div class="ssn-btns">' +
            '<button type="button" data-go>Search</button>' +
            '<button type="button" class="ssn-play" data-play title="Preview this file">&#9654;</button>' +
            '<button type="button" data-camel title="Split CamelCase and separators into words, drop resolution noise, then search">de-Camel</button>' +
            '<button type="button" data-fname title="Start again from this file&rsquo;s name">Filename</button>' +
            unblurBtn() +
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
          '<div class="ssn-btnrow ssn-topbar">' + unblurBtn() + '</div>' +
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
      const label = d ? ('Scenes' + (d.count != null ? ' &middot; ' + d.count : '') +
                         (e.sort === 'order' ? ' &middot; newest first' : '')) : '';
      const list = d && !n && !e.busy
        ? (d.note ? '' : '<div class="ssn-empty">No scenes listed for this performer.</div>')
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
                           d.count != null && !(e.picks && e.picks.length) && !(e.subPicks && e.subPicks.length) ? String(d.count) : '') +
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
          '<div class="ssn-btnrow ssn-topbar">' + unblurBtn() + '</div>' +
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
      const label = d ? ('Scenes' + (d.count != null ? ' &middot; ' + d.count : '') +
                         (e.sort === 'order' ? ' &middot; newest first' : '')) : '';
      const list = d && !n && !e.busy
        ? (d.note ? '' : '<div class="ssn-empty">No scenes listed for this studio' +
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
      sub:  { picks: 'subPicks', open: 'subOpen',    term: 'subTerm',    focus: 'subFocus' }
    };

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
          '<input class="ssn-studio-find" type="search" enterkeyhint="done" spellcheck="false" autocomplete="off" ' +
            'autocorrect="off" autocapitalize="off" placeholder="Search ' + many + '&hellip;" value="' + esc(e[K.term] || '') + '">' +
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
      const l = c && libOthers(c)[0];
      if (!l) return;

      // Native's main web view: the file belongs to the catalogue, which this
      // phone may not hold, so it opens in Picker in the in-app browser. The
      // modal stays as it was underneath.
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

      // Picker: it's in this library, so preview it right here.
      let match = null;
      try {
        const all = typeof window.getAllVideos === 'function' ? await window.getAllVideos() : [];
        match = all.find(v => (v.videoKey || (window.scrayVideoKey ? window.scrayVideoKey(v.filename || '') : '')) === l.video_key) || null;
      } catch (err) {
        console.error('[stash] library lookup failed:', err);
      }
      if (finished) return;
      if (!match) {
        alert('That file isn\u2019t in the library here yet - it may need a sync.\n\n' + (l.path ? l.path + '/' : '') + l.filename);
        return;
      }
      preview(match, host.closest('.basket-json-modal') || null);
    }

    function cardHtml(c, i, herePid, hereSid) {
      const fileSec = Number(c.file_duration_sec) || 0;
      const sceneSec = Number(c.stash_duration_sec) || 0;
      let durClass = '', durNote = sceneSec ? 'no file length' : 'no scene runtime';
      if (fileSec > 60 && sceneSec > 60) {
        const drift = Math.abs(fileSec - sceneSec) / Math.max(fileSec, sceneSec);
        // Same bands as bulk-stash: within 3% reads right, past 5% reads wrong.
        durClass = drift <= 0.03 ? 'okv' : (drift <= 0.05 ? '' : 'warnv');
        durNote = (drift * 100).toFixed(1) + '% apart';
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
            (scored ? '<div class="ssn-conf ' + confClass + '"><b>' + conf.toFixed(0) + '</b> <small>CONFIDENCE</small></div>' : '') +
          '</div>' +
        '</div>' +
        '<div class="ssn-facts">' +
          '<div class="ssn-fact ' + durClass + '"><span>File length</span><b>' + clock(fileSec) + '</b></div>' +
          '<div class="ssn-fact ' + durClass + '"><span>Scene length</span><b>' + clock(sceneSec) + '</b></div>' +
          '<div class="ssn-fact ' + durClass + '"><span>Difference</span><b>' + esc(durNote) + '</b></div>' +
          '<div class="ssn-fact gm"><span>Cast shape</span><b>' + esc(c.gender_mix || '—') + '</b></div>' +
        '</div>' +
        (cast ? '<div class="ssn-cast">' + cast + '</div>' : '<div class="ssn-sub" style="margin:0 0 8px;">no performers listed</div>') +
        (moreBits ? '<details class="ssn-more"><summary>' + moreLabel + '</summary>' + moreBits + '</details>' : '') +
        '<div class="ssn-foot">' +
          (canAccept ? '<button type="button" class="ssn-accept" data-accept="' + i + '">Accept &amp; submit</button>' : '') +
          (c.stash_url ? '<button type="button" class="ssn-ext" data-ext="' + esc(c.stash_url) + '">StashDB &#8599;</button>' : '') +
          (googleUrl(c) ? '<button type="button" class="ssn-google ssn-google-card" title="Search Google for this scene" data-ext="' +
                          esc(googleUrl(c)) + '">Google &#8599;</button>' : '') +
          libHtml(c, i) +
        '</div>' +
        '<div class="ssn-cerr"></div>' +
      '</div>';
    }

    // The filter button paints from the live filter, like the modal's chips.
    function paintFilter() {
      const b = host.querySelector('[data-filter]');
      const e = top();
      const kind = e && e.type === 'studio' ? 'studio' : 'performer';
      const who = e && e.data && (kind === 'studio' ? e.data.studio : e.data.performer);
      if (!b || !who) return;
      const set = typeof window.scrayFacetSet === 'function' ? window.scrayFacetSet(kind) : null;
      const on = !!(set && set.has(String(who.name).trim().toLowerCase()));
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
      const btn = t.closest('button');
      if (!btn || !host.contains(btn)) return;
      const box = host.querySelector('input.ssn-term');

      if (btn.hasAttribute('data-go')) { search(box && box.value); box && box.blur(); return; }
      if (btn.dataset.ptag !== undefined) { togglePtag(+btn.dataset.ptag); return; }
      if (btn.hasAttribute('data-unblur')) {
        revealAll = !revealAll;
        host.querySelectorAll('.ssn-cover[data-cover]').forEach(c => {
          c.classList.toggle('shown', revealAll);
          coverTaps.delete(c);
          const v = c.querySelector('.ssn-veil');
          if (v) v.textContent = 'Tap 3 times';
        });
        host.querySelectorAll('[data-unblur]').forEach(b => {
          b.innerHTML = revealAll ? '&#128584; Blur all' : '&#128065; Unblur all';
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
        return;
      }
      if (btn.dataset.ext) { openExternal(btn.dataset.ext); return; }
      if (btn.dataset.lib !== undefined) { openLibrary(+btn.dataset.lib); return; }
      if (btn.dataset.accept !== undefined) { accept(btn); return; }
      if (btn.hasAttribute('data-more')) { const e = top(); if (e && !e.busy) load(e, true); return; }
      if (btn.hasAttribute('data-filter')) {
        const e = top();
        const kind = e && e.type === 'studio' ? 'studio' : 'performer';
        const who = e && e.data && (kind === 'studio' ? e.data.studio : e.data.performer);
        const name = who && who.name;
        if (!name) return;
        const set = typeof window.scrayFacetSet === 'function' ? window.scrayFacetSet(kind) : null;
        if (set && set.has(String(name).trim().toLowerCase())) window.scrayRemoveTagFilter?.(kind, name);
        else window.scrayAddTagFilter?.(kind, name);
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
    push(start.type === 'performer'
      ? { type: 'performer', id: start.id || '', name: start.name || '', sceneId: start.sceneId || '' }
      : start.type === 'studio'
        ? { type: 'studio', id: start.id || '', name: start.name || '', sceneId: start.sceneId || '' }
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
  // The tag cloud's "Search in Stash" opens a studio's or performer's page. If
  // something is playing it goes through the Stash modal for that file (cards
  // scored against it, scenes acceptable); if nothing is, the navigator opens
  // on its own in the same card, just browsing - nothing to accept or score.
  function openProfile(kind, name) {
    const start = kind === 'studio' ? { type: 'studio', name: String(name) }
                                    : { type: 'performer', name: String(name) };
    const playing = window.currentPlayingVideo;
    if (playing && typeof window.showStashModal === 'function') {
      window.showStashModal(playing, kind === 'studio' ? { studio: start.name } : { performer: start.name });
      return;
    }
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
    const done = () => modal.remove();
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

  window.scrayStashNav = { open, words, clean, preview, endPreview, openProfile };
  window.scrayPerformerChoice = performerChoice;
})();

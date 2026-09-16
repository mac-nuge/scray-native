// scray-stash-nav.js — the Stash modal's own StashDB navigator
// (picker 13.162 / native 13.161, needs browse 13.68's stash_nav action).
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
//            start: { type: 'search', term } | { type: 'performer', id?, name, sceneId? },
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
#stashModal .ssn input.ssn-term { display: block; width: 100%; box-sizing: border-box; margin: 0 0 6px; padding: 8px 10px; font-size: 16px; border: 1px solid #ccc; border-radius: 6px; background: #fff; color: inherit; -webkit-appearance: none; appearance: none; }
#stashModal .ssn input.ssn-term:focus { outline: none; border-color: #8b7cf0; box-shadow: 0 0 0 2px rgba(139,124,240,.25); }
#stashModal .ssn-btns { display: flex; gap: 6px; flex-wrap: wrap; }
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
    async function load(entry, more) {
      const seq = ++loadSeq;
      entry.busy = true;
      entry.error = '';
      if (!more) entry.data = null;
      paint(false, true);
      let res;
      try {
        const body = { video_key: key, score_term: scoreTerm };
        if (entry.type === 'search') {
          body.op = 'search';
          body.term = entry.term;
        } else {
          body.op = 'performer';
          if (entry.id) body.id = entry.id;
          body.name = entry.name || '';
          if (entry.sceneId) body.scene_id = entry.sceneId;
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

      if (heading) {
        heading.textContent = e.type === 'search'
          ? 'Stash search'
          : (e.data && e.data.performer ? e.data.performer.name : (e.name || 'Performer'));
      }
      backBtn.textContent = stack.length > 1 ? '‹ Back' : '‹ Back to lookup';

      host.innerHTML = '<div class="ssn">' + (e.type === 'search' ? searchHtml(e) : performerHtml(e)) + '</div>';

      if (restore) host.scrollTop = e.scroll || 0;
      else if (keepScroll) host.scrollTop = scrollWas;
      else host.scrollTop = 0;

      if (hadFocus) {
        const nb = host.querySelector('input.ssn-term');
        if (nb) { nb.focus(); nb.setSelectionRange(nb.value.length, nb.value.length); }
      }
      paintFilter();
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
          '<div class="ssn-btns">' +
            '<button type="button" data-go>Search</button>' +
            '<button type="button" data-camel title="Split CamelCase and separators into words, drop resolution noise, then search">de-Camel</button>' +
            '<button type="button" data-fname title="Start again from this file&rsquo;s name">Filename</button>' +
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
          '<div class="ssn-prof">' +
            (p.image
              ? '<div class="ssn-cover ssn-pimg" data-cover><img src="' + esc(p.image) + '" alt="" loading="lazy">' +
                '<div class="ssn-veil">Tap 3 times</div></div>'
              : '<div class="ssn-cover ssn-pimg none">no image</div>') +
            '<div class="ssn-pmain">' +
              '<div class="ssn-pname">' + esc(p.name) +
                (p.disambiguation ? ' <small>(' + esc(p.disambiguation) + ')</small>' : '') + '</div>' +
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
      return prof +
        '<div class="ssn-state"><span class="ssn-h">' + label + '</span>' + sortHtml(e, 'Newest') + '</div>' +
        errHtml(e.error) + errHtml(d && d.note) +
        list + more;
    }

    function cardHtml(c, i, herePid) {
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
      const sub = [c.studio || 'no studio', c.release_date, c.code].filter(Boolean).map(esc).join(' &middot; ');

      const cast = (c.cast || []).map(p =>
        '<button type="button" class="ssn-perf' + (herePid && p.id === herePid ? ' here' : '') + '" ' +
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
            ? '<div class="ssn-cover ssn-thumb" data-cover><img src="' + esc(c.cover) + '" alt="" loading="lazy">' +
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
        '</div>' +
        '<div class="ssn-cerr"></div>' +
      '</div>';
    }

    // The filter button paints from the live filter, like the modal's chips.
    function paintFilter() {
      const b = host.querySelector('[data-filter]');
      const e = top();
      if (!b || !e || !e.data || !e.data.performer) return;
      const set = typeof window.scrayFacetSet === 'function' ? window.scrayFacetSet('performer') : null;
      const on = !!(set && set.has(String(e.data.performer.name).trim().toLowerCase()));
      b.classList.toggle('on', on);
      b.innerHTML = on ? '&#10005; Remove from filter' : '&#8853; Filter by this performer';
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
    function onClick(ev) {
      if (finished) return;
      const t = ev.target;
      const cover = t.closest('.ssn-cover[data-cover]');
      if (cover && host.contains(cover)) { tapCover(cover); return; }
      const btn = t.closest('button');
      if (!btn || !host.contains(btn)) return;
      const box = host.querySelector('input.ssn-term');

      if (btn.hasAttribute('data-go')) { search(box && box.value); box && box.blur(); return; }
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
      if (btn.dataset.sort) {
        const e = top();
        if (e && e.sort !== btn.dataset.sort) { e.sort = btn.dataset.sort; paint(false, true); }
        return;
      }
      if (btn.dataset.ext) { openExternal(btn.dataset.ext); return; }
      if (btn.dataset.accept !== undefined) { accept(btn); return; }
      if (btn.hasAttribute('data-more')) { const e = top(); if (e && !e.busy) load(e, true); return; }
      if (btn.hasAttribute('data-filter')) {
        const e = top();
        const name = e && e.data && e.data.performer && e.data.performer.name;
        if (!name) return;
        const set = typeof window.scrayFacetSet === 'function' ? window.scrayFacetSet('performer') : null;
        if (set && set.has(String(name).trim().toLowerCase())) window.scrayRemoveTagFilter?.('performer', name);
        else window.scrayAddTagFilter?.('performer', name);
        paintFilter();
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
      : { type: 'search', term: String(start.term || '').trim() || words(video.filename || '') });

    return {
      close: () => finish(null),
      get busy() { return busyAccept; }
    };
  }

  window.scrayStashNav = { open, words, clean };
})();

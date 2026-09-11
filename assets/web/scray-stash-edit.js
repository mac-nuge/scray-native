// scray-stash-edit.js — enter or correct a file's Stash details from the
// player's Stash modal (13.63). Identical in Picker and Native.
//
// The same fields as the Manual Stash page, for one file at a time:
//   - a file with no match gets a hand-entered scene (stash_edit_manual_save),
//     which replaces the whole entry, so every field goes up;
//   - a hand-entered file is edited the same way;
//   - a real StashDB match is CORRECTED (stash_edit_override_save): only the
//     fields you changed, plus the ones already corrected, go up. StashDB's
//     own copy is never touched, and "Revert to StashDB" drops the lot.
//
// The stash_edit_* actions are one-file versions of the console's, open to
// the app key, so Native can use them without the bulk actions being opened.
//
// Usage: const ctl = window.scrayStashEdit.open({ host, actions, overlay,
//            video, videoKey, onDone(saved) });
// host takes the form, actions takes Save/Cancel, overlay takes the dropdown.
(function () {
  'use strict';

  const FIELDS = ['title', 'studio', 'performers', 'tags', 'release_date',
                  'code', 'director', 'duration_sec'];
  const LABEL = {
    title: 'Title', studio: 'Studio', performers: 'Performers', tags: 'Tags',
    release_date: 'Released', code: 'Code', director: 'Director', duration_sec: 'Duration'
  };
  const KIND_LABEL = { studio: 'studio', performer: 'performer', tag: 'tag' };
  const GENDERS = [
    ['FEMALE', 'F', 'Female'], ['MALE', 'M', 'Male'],
    ['TRANSGENDER_FEMALE', 'TF', 'Trans female'], ['TRANSGENDER_MALE', 'TM', 'Trans male'],
    ['NON_BINARY', 'NB', 'Non-binary'], ['INTERSEX', 'I', 'Intersex'], ['', '?', 'Unknown']
  ];
  const shortGender = (g) => {
    if (!g) return '';
    const hit = GENDERS.find(x => x[0] === String(g).toUpperCase());
    return hit ? hit[1] : '?';
  };

  const esc = (s) => String(s ?? '').replace(/[&<>"]/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // Same key the server folds names on, so "evil angel" and "Evil Angel" are
  // one name here exactly as they are in the dropdown's source.
  const nameKey = (s) => String(s ?? '').normalize('NFC').trim().toLowerCase();
  // Looser still, for matching only: accents off, so "Zoe" finds "Zoë".
  const fold = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().trim();
  const titleFromFilename = (name) => {
    const s = String(name == null ? '' : name).trim();
    return s.replace(/\.[a-z0-9]{1,5}$/i, '').trim() || s;
  };

  const pad = (n) => String(n).padStart(2, '0');
  const fmtDur = (s) => {
    if (s === null || s === undefined || s === '' || !Number.isFinite(+s)) return '';
    s = Math.max(0, Math.round(+s));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return h ? `${h}:${pad(m)}:${pad(x)}` : `${m}:${pad(x)}`;
  };
  // "12:34", "1:02:03", or plain seconds. NaN means it could not be read.
  const parseDur = (t) => {
    t = String(t ?? '').trim();
    if (!t) return null;
    if (/^\d+$/.test(t)) return parseInt(t, 10);
    const m = t.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
    if (!m) return NaN;
    if (m[3] !== undefined) {
      if (+m[2] > 59 || +m[3] > 59) return NaN;
      return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
    }
    if (+m[2] > 59) return NaN;
    return (+m[1]) * 60 + (+m[2]);
  };
  const readableDur = (s) => {
    if (s === null || !Number.isFinite(s)) return '';
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return (h ? h + 'h ' : '') + m + 'm ' + pad(x) + 's';
  };

  const api = (action, opts) => window.scrayApiCall(action, opts || {});

  // ---- vocabulary --------------------------------------------------------
  // Fetched once and kept for a few minutes: opening the editor on the next
  // file should not wait on three lists that almost never change in between.
  const VOCAB = { studio: null, performer: null, tag: null };
  let vocabAt = 0;
  async function loadVocab(force) {
    if (!force && VOCAB.studio && VOCAB.performer && VOCAB.tag && Date.now() - vocabAt < 5 * 60 * 1000) return;
    const kinds = ['studio', 'performer', 'tag'];
    const res = await Promise.all(kinds.map(k => api('stash_edit_vocab', { params: { kind: k } })));
    kinds.forEach((k, i) => {
      VOCAB[k] = (res[i].names || []).map(n => ({
        name: String(n.name), uses: +n.uses || 0, gender: n.gender || null, f: fold(n.name)
      }));
    });
    vocabAt = Date.now();
  }
  const vocabFind = (kind, name) => (VOCAB[kind] || []).find(n => nameKey(n.name) === nameKey(name));

  // Best first: exact, starts with, a word starts with, contains, then the
  // letters in order with gaps ("jsmth" finds "Jane Smith"). Ties go to the
  // name used most, which is usually the one you mean.
  function rank(kind, term, exclude) {
    const q = fold(term);
    const list = VOCAB[kind] || [];
    const out = [];
    for (const n of list) {
      if (exclude && exclude.has(nameKey(n.name))) continue;
      let s;
      if (!q) s = 5;
      else if (n.f === q) s = 0;
      else if (n.f.startsWith(q)) s = 1;
      else if (n.f.split(/[^a-z0-9]+/).some(w => w && w.startsWith(q))) s = 2;
      else if (n.f.includes(q)) s = 3;
      else {
        const qq = q.replace(/\s+/g, '');
        let i = 0;
        for (const ch of n.f) { if (ch === qq[i]) i++; if (i === qq.length) break; }
        if (qq.length >= 2 && i === qq.length) s = 4; else continue;
      }
      out.push([s, n]);
    }
    out.sort((a, b) => a[0] - b[0] || b[1].uses - a[1].uses || a[1].name.localeCompare(b[1].name));
    return out.slice(0, 40).map(x => x[1]);
  }

  // ---- styles --------------------------------------------------------------
  // Scoped under the ids, which outrank the mobile `input { width:100%;
  // padding:12px }` rule without any !important.
  function ensureCss() {
    if (document.getElementById('scrayStashEditCss')) return;
    const css = document.createElement('style');
    css.id = 'scrayStashEditCss';
    css.textContent = `
#stashModal .sse { font-size: .9rem; text-align: left; }
#stashModal .sse-head { margin: 0 0 10px; }
#stashModal .sse-head strong { font-size: 1rem; }
#stashModal .sse-head div { opacity: .7; font-size: .8rem; margin-top: 2px; }
#stashModal .sse-warn { margin: 0 0 8px; padding: 6px 8px; border-radius: 5px; background: #fff4d6; border-left: 3px solid #b8860b; font-size: .8rem; }
#stashModal .sse-f { display: block; margin: 0 0 10px; padding-left: 7px; border-left: 3px solid transparent; }
#stashModal .sse-f.sse-changed { border-left-color: #8b7cf0; }
#stashModal .sse-l { display: flex; align-items: baseline; gap: 6px; font-weight: 600; font-size: .78rem; margin: 0 0 3px; opacity: .85; }
#stashModal .sse-l small { font-weight: 400; opacity: .75; }
#stashModal .sse input.sse-in { display: block; width: 100%; min-width: 0; box-sizing: border-box; margin: 0; padding: 7px 8px; font-size: 16px; border: 1px solid #ccc; border-radius: 5px; background: #fff; color: inherit; }
#stashModal .sse input.sse-in:focus { outline: none; border-color: #8b7cf0; box-shadow: 0 0 0 2px rgba(139,124,240,.25); }
#stashModal .sse-pair { display: flex; gap: 8px; }
#stashModal .sse-pair > .sse-f { flex: 1 1 0; min-width: 0; }
#stashModal .sse-durrow { display: flex; gap: 6px; align-items: stretch; }
#stashModal .sse-durrow input.sse-in { flex: 1 1 auto; width: auto; }
#stashModal .sse button.sse-small { flex: 0 0 auto; width: auto; margin: 0; padding: 4px 10px; font-size: .78rem; border: 1px solid #ccc; border-radius: 5px; background: #f4f4f6; color: inherit; cursor: pointer; white-space: nowrap; }
#stashModal .sse-chips { display: flex; flex-wrap: wrap; gap: 4px; margin: 0 0 5px; }
#stashModal .sse-chips:empty { display: none; }
#stashModal .sse-chip { display: inline-flex; align-items: center; gap: 4px; padding: 2px 4px 2px 8px; border-radius: 12px; font-size: .8rem; background: #eef1f4; white-space: nowrap; max-width: 100%; }
#stashModal .sse-chip[data-kind="performer"] { background: #efe9fb; }
#stashModal .sse-chip .sse-g { font-size: .68rem; opacity: .65; }
#stashModal .sse-chip .sse-new { font-size: .62rem; background: #28a745; color: #fff; border-radius: 6px; padding: 0 4px; }
#stashModal .sse-chip button { width: auto; min-width: 0; margin: 0; padding: 0 5px; border: none; background: transparent; color: inherit; font-size: .95rem; line-height: 1.2; opacity: .6; cursor: pointer; }
#stashModal .sse-said { font-size: .74rem; opacity: .75; margin-top: 3px; display: flex; gap: 6px; align-items: baseline; flex-wrap: wrap; }
#stashModal .sse-said[hidden] { display: none; }
#stashModal .sse-said a { color: #6c5ce7; cursor: pointer; white-space: nowrap; }
#stashModal .sse-danger { margin: 14px 0 4px; padding-top: 10px; border-top: 1px solid rgba(128,128,128,.3); display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
#stashModal .sse-danger button.sse-small { border-color: #dc3545; color: #dc3545; background: transparent; }
#stashModal .sse-danger button.sse-small.sse-armed { background: #dc3545; color: #fff; }
#stashModal .sse-err { color: #dc3545; font-size: .85rem; margin: 6px 0 0; }
#stashModal .sse-err:empty { display: none; }
#stashModal .sse-dd { position: fixed; z-index: 2147483647; background: #fff; color: #222; border: 1px solid #ccc; border-radius: 8px; box-shadow: 0 6px 20px rgba(0,0,0,.25); overflow-y: auto; -webkit-overflow-scrolling: touch; font-size: .85rem; text-align: left; }
#stashModal .sse-dd[hidden] { display: none; }
#stashModal .sse-it { display: flex; align-items: center; gap: 8px; padding: 9px 10px; cursor: pointer; border-bottom: 1px solid rgba(128,128,128,.12); }
#stashModal .sse-it:last-child { border-bottom: none; }
#stashModal .sse-it.sel { background: #efe9fb; }
#stashModal .sse-it .nm { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#stashModal .sse-it .g { flex: 0 0 auto; font-size: .7rem; opacity: .65; }
#stashModal .sse-it .ct { flex: 0 0 auto; font-size: .7rem; opacity: .5; font-variant-numeric: tabular-nums; }
#stashModal .sse-it.new .nm { color: #1e7e34; font-weight: 600; }
#stashModal .sse-none { padding: 9px 10px; opacity: .6; }
#stashModal .sse-gpick { padding: 8px 10px; }
#stashModal .sse-gpick div { margin-bottom: 6px; }
#stashModal .sse-gpick .sse-gbtns { display: flex; flex-wrap: wrap; gap: 5px; margin: 0; }
#stashModal .sse-gpick button { width: auto; min-width: 0; margin: 0; padding: 6px 10px; font-size: .8rem; border: 1px solid #ccc; border-radius: 6px; background: #f4f4f6; color: #222; cursor: pointer; }
`;
    document.head.appendChild(css);
  }

  // ---- the editor ------------------------------------------------------------
  function open(opts) {
    ensureCss();
    const host    = opts.host;
    const actions = opts.actions;
    const overlay = opts.overlay || document.body;
    const video   = opts.video || {};
    const key     = opts.videoKey;

    let row = null;           // stash_edit_get's row
    let orig = null;          // field values as loaded
    let base = null;          // what StashDB says (real matches only)
    let cur = null;           // field values in the form
    const newPerformers = new Map();   // nameKey -> gender, added in this form
    const newNames = { studio: new Set(), tag: new Set() };
    let busy = false, finished = false;

    host.innerHTML = '<div class="sse">Loading details&hellip;</div>';

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'modal-btn modal-btn-primary';
    saveBtn.style.cssText = 'flex:1;background:#28a745;';
    saveBtn.textContent = 'Save';
    saveBtn.disabled = true;
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'modal-btn modal-btn-cancel';
    cancelBtn.textContent = 'Cancel';
    actions.appendChild(saveBtn);
    actions.appendChild(cancelBtn);

    const dd = document.createElement('div');
    dd.className = 'sse-dd';
    dd.hidden = true;
    overlay.appendChild(dd);

    const finish = (saved) => {
      if (finished) return;
      finished = true;
      gone.disconnect();
      detach();
      dd.remove();
      saveBtn.remove();
      cancelBtn.remove();
      if (typeof opts.onDone === 'function') opts.onDone(saved);
    };
    cancelBtn.addEventListener('click', () => { if (!busy) finish(false); });
    saveBtn.addEventListener('click', () => save());

    const same = (f, a, b) => {
      if (f === 'performers' || f === 'tags') {
        const x = (a || []).map(nameKey), y = (b || []).map(nameKey);
        return x.length === y.length && x.every((v, i) => v === y[i]);
      }
      if (f === 'duration_sec') return (a ?? null) === (b ?? null);
      return String(a ?? '').trim() === String(b ?? '').trim();
    };
    const show = (f, v) => {
      if (f === 'performers' || f === 'tags') return (v || []).length ? v.join(', ') : '(none)';
      if (f === 'duration_sec') return v === null || v === undefined ? '(none)' : fmtDur(v);
      return String(v ?? '') === '' ? '(empty)' : String(v);
    };

    (async () => {
      try {
        const [got] = await Promise.all([
          api('stash_edit_get', { method: 'POST', body: { video_key: key } }),
          loadVocab(false)
        ]);
        if (finished) return;
        row = got.row;
        orig = {};
        FIELDS.forEach(f => {
          const v = row[f];
          orig[f] = (f === 'performers' || f === 'tags') ? (Array.isArray(v) ? v.slice() : [])
                  : f === 'duration_sec' ? (v === null || v === undefined ? null : +v)
                  : String(v ?? '');
        });
        if (row.matched) {
          const said = row.stash_said || {};
          const over = row.override_fields || [];
          base = {};
          FIELDS.forEach(f => {
            base[f] = over.includes(f)
              ? (f === 'duration_sec' ? (said[f] ?? null) : (said[f] ?? ((f === 'performers' || f === 'tags') ? [] : '')))
              : orig[f];
          });
        }
        cur = JSON.parse(JSON.stringify(orig));
        render();
        saveBtn.disabled = false;
      } catch (err) {
        if (finished) return;
        host.innerHTML = '<div class="sse"><p class="sse-err">Could not load this file&rsquo;s details: ' +
          esc(err.message) + '</p></div>';
      }
    })();

    function mode() {
      if (row.matched) return 'correct';
      if (row.manual) return 'manual';
      return 'new';
    }

    function render() {
      const m = mode();
      const head = m === 'correct'
        ? '<strong>Correct StashDB&rsquo;s details</strong><div>Only what you change is kept, as your ' +
          'correction. StashDB&rsquo;s own copy is left alone.</div>'
        : m === 'manual'
          ? '<strong>Edit your details</strong><div>Entered by hand for this file.</div>'
          : '<strong>Enter details by hand</strong><div>For a file StashDB doesn&rsquo;t have. ' +
            'Leave anything you don&rsquo;t know blank.</div>';
      const filenameTitle = titleFromFilename(row.filename || video.filename || '');

      const combo = (f, kind, many, ph) =>
        '<div class="sse-f" data-f="' + f + '">' +
          '<div class="sse-l">' + LABEL[f] + '</div>' +
          (many ? '<div class="sse-chips" data-chips="' + f + '"></div>' : '') +
          '<input class="sse-in sse-combo" type="text" data-f="' + f + '" data-kind="' + kind + '"' +
            (many ? ' data-many="1"' : '') + ' placeholder="' + esc(ph) + '"' +
            ' autocomplete="off" autocorrect="off" autocapitalize="words" spellcheck="false"' +
            (many ? '' : ' value="' + esc(cur[f]) + '"') + '>' +
          '<div class="sse-said" data-said="' + f + '" hidden></div>' +
        '</div>';
      const text = (f, ph, extra) =>
        '<div class="sse-f" data-f="' + f + '">' +
          '<div class="sse-l">' + LABEL[f] + (extra || '') + '</div>' +
          '<input class="sse-in" type="text" data-f="' + f + '" placeholder="' + esc(ph) + '"' +
            ' autocomplete="off" value="' + esc(cur[f]) + '">' +
          '<div class="sse-said" data-said="' + f + '" hidden></div>' +
        '</div>';

      const fileDur = row.file_duration_sec !== null && row.file_duration_sec !== undefined
        ? +row.file_duration_sec : null;

      host.innerHTML =
        '<div class="sse">' +
          '<div class="sse-head">' + head + '</div>' +
          (row.override_stale
            ? '<div class="sse-warn">This file was matched to a different scene after these corrections ' +
              'were made, so they sit on top of details you may not have seen.</div>'
            : '') +
          text('title', m === 'correct' ? '' : filenameTitle,
               m === 'correct' ? '' : ' <small>(blank uses the filename)</small>') +
          combo('studio', 'studio', false, 'Studio') +
          combo('performers', 'performer', true, 'Add a performer') +
          combo('tags', 'tag', true, 'Add a tag') +
          '<div class="sse-pair">' +
            text('release_date', 'YYYY-MM-DD') +
            text('code', '') +
          '</div>' +
          text('director', '') +
          '<div class="sse-f" data-f="duration_sec">' +
            '<div class="sse-l">Duration <small data-durread></small></div>' +
            '<div class="sse-durrow">' +
              '<input class="sse-in" type="text" data-f="duration_sec" inputmode="numeric" ' +
                'placeholder="m:ss" autocomplete="off" value="' + esc(fmtDur(cur.duration_sec)) + '">' +
              (fileDur ? '<button type="button" class="sse-small" data-usefile>Use file (' +
                         esc(fmtDur(fileDur)) + ')</button>' : '') +
            '</div>' +
            '<div class="sse-said" data-said="duration_sec" hidden></div>' +
          '</div>' +
          ((m === 'correct' && (row.override_fields || []).length) || m === 'manual'
            ? '<div class="sse-danger">' +
                (m === 'correct'
                  ? '<button type="button" class="sse-small" data-revert>Revert all to StashDB</button>'
                  : '<button type="button" class="sse-small" data-remove>Remove these details</button>') +
              '</div>'
            : '') +
          '<div class="sse-err"></div>' +
        '</div>';

      FIELDS.forEach(f => { if (f === 'performers' || f === 'tags') paintChips(f); });
      host.querySelectorAll('input.sse-in').forEach(wireInput);
      host.querySelector('[data-usefile]')?.addEventListener('click', () => {
        const inp = host.querySelector('input[data-f="duration_sec"]');
        inp.value = fmtDur(fileDur);
        readInput(inp);
      });
      armDanger(host.querySelector('[data-revert]'), 'Tap again to revert', revertAll);
      armDanger(host.querySelector('[data-remove]'), 'Tap again to remove', removeManual);
      FIELDS.forEach(paintSaid);
      paintDur();
    }

    const errEl = () => host.querySelector('.sse-err');
    const setErr = (msg) => { const e = errEl(); if (e) e.textContent = msg || ''; };

    // A two-tap confirm rather than confirm(): a native dialog in FLS lands
    // unrotated behind the player, and on iOS it can wedge the web view.
    function armDanger(btn, armedText, fn) {
      if (!btn) return;
      const idle = btn.textContent;
      let timer = null;
      btn.addEventListener('click', () => {
        if (busy) return;
        if (!btn.classList.contains('sse-armed')) {
          btn.classList.add('sse-armed');
          btn.textContent = armedText;
          timer = setTimeout(() => { btn.classList.remove('sse-armed'); btn.textContent = idle; }, 3000);
          return;
        }
        clearTimeout(timer);
        fn(btn);
      });
    }

    function paintChips(f) {
      const box = host.querySelector('[data-chips="' + f + '"]');
      if (!box) return;
      const kind = f === 'performers' ? 'performer' : 'tag';
      box.innerHTML = cur[f].map((n, i) => {
        const isNew = kind === 'performer' ? newPerformers.has(nameKey(n)) : newNames.tag.has(nameKey(n));
        const g = kind === 'performer'
          ? (newPerformers.has(nameKey(n)) ? newPerformers.get(nameKey(n)) : (vocabFind('performer', n) || {}).gender)
          : null;
        return '<span class="sse-chip" data-kind="' + kind + '">' + esc(n) +
          (kind === 'performer' && g ? ' <span class="sse-g">' + esc(shortGender(g)) + '</span>' : '') +
          (isNew ? ' <span class="sse-new">new</span>' : '') +
          '<button type="button" data-rm="' + i + '" aria-label="Remove ' + esc(n) + '">&times;</button></span>';
      }).join('');
      box.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => {
        const [gone] = cur[f].splice(+b.dataset.rm, 1);
        if (gone !== undefined) {
          newPerformers.delete(nameKey(gone));
          newNames.tag.delete(nameKey(gone));
        }
        paintChips(f);
        paintSaid(f);
      }));
    }

    function paintSaid(f) {
      const wrap = host.querySelector('.sse-f[data-f="' + f + '"]');
      const said = host.querySelector('[data-said="' + f + '"]');
      if (!wrap || !said) return;
      if (!base) { said.hidden = true; return; }
      const differs = !same(f, cur[f], base[f]);
      wrap.classList.toggle('sse-changed', differs);
      said.hidden = !differs;
      if (differs) {
        said.innerHTML = '<span>StashDB: ' + esc(show(f, base[f])) + '</span>' +
                         '<a data-undo="' + f + '">&#8634; use StashDB&rsquo;s</a>';
        said.querySelector('[data-undo]').addEventListener('click', () => {
          cur[f] = (f === 'performers' || f === 'tags') ? base[f].slice() : base[f];
          const inp = host.querySelector('input[data-f="' + f + '"]');
          if (f === 'performers' || f === 'tags') paintChips(f);
          else if (inp) inp.value = f === 'duration_sec' ? fmtDur(base[f]) : String(base[f] ?? '');
          if (f === 'duration_sec') paintDur();
          paintSaid(f);
        });
      }
    }

    function paintDur() {
      const el = host.querySelector('[data-durread]');
      if (!el) return;
      const v = parseDur(host.querySelector('input[data-f="duration_sec"]')?.value);
      el.textContent = v === null ? '' : Number.isNaN(v) ? '(not a time — use m:ss)' : '(' + readableDur(v) + ')';
    }

    function readInput(inp) {
      const f = inp.dataset.f;
      if (inp.dataset.many) return;               // chips hold the value
      if (f === 'duration_sec') {
        const v = parseDur(inp.value);
        cur[f] = Number.isNaN(v) ? cur[f] : v;
        paintDur();
      } else {
        cur[f] = inp.value;
        if (f === 'studio') newNames.studio.clear();
      }
      paintSaid(f);
    }

    // ---- dropdown ----------------------------------------------------------
    let ddInput = null, ddItems = [], ddSel = -1, ddBlurTimer = null, ddGender = null;

    function wireInput(inp) {
      inp.addEventListener('input', () => {
        readInput(inp);
        setErr('');
        if (inp.classList.contains('sse-combo')) openDD(inp);
      });
      if (!inp.classList.contains('sse-combo')) {
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } });
        return;
      }
      inp.addEventListener('focus', () => { clearTimeout(ddBlurTimer); openDD(inp); });
      inp.addEventListener('blur', () => {
        // Deferred: a tap on the list blurs the input first on some devices,
        // and closing here would swallow the pick.
        ddBlurTimer = setTimeout(() => { if (ddInput === inp) closeDD(); }, 220);
      });
      inp.addEventListener('keydown', (e) => {
        if (ddGender && e.key === 'Escape') { e.preventDefault(); closeDD(); return; }
        if (e.key === 'ArrowDown' && !dd.hidden) { e.preventDefault(); highlight(ddSel + 1); return; }
        if (e.key === 'ArrowUp' && !dd.hidden)   { e.preventDefault(); highlight(ddSel - 1); return; }
        if (e.key === 'Escape' && !dd.hidden)    { e.preventDefault(); closeDD(); return; }
        if (e.key === 'Enter') {
          e.preventDefault();
          if (!dd.hidden && ddItems[ddSel]) { pick(ddItems[ddSel]); return; }
          const term = inp.value.trim();
          if (inp.dataset.many && term) {
            const kind = inp.dataset.kind;
            const hit = vocabFind(kind, term);
            pick(hit ? { type: 'pick', name: hit.name } : { type: 'new', name: term });
          } else {
            closeDD();
            inp.blur();
          }
          return;
        }
        if (e.key === 'Backspace' && inp.dataset.many && inp.value === '') {
          const f = inp.dataset.f;
          if (cur[f].length) {
            const gone = cur[f].pop();
            newPerformers.delete(nameKey(gone));
            newNames.tag.delete(nameKey(gone));
            paintChips(f);
            paintSaid(f);
            openDD(inp);
          }
        }
      });
    }

    function openDD(inp) {
      ddInput = inp;
      ddGender = null;
      const kind = inp.dataset.kind;
      const many = !!inp.dataset.many;
      const f = inp.dataset.f;
      const term = inp.value.trim();
      // Nothing typed, no list. A list opened on focus hangs over the fields
      // below, and the next tap meant for one of them picks a name instead.
      if (!term) { closeDD(); return; }
      const exclude = many ? new Set(cur[f].map(nameKey)) : null;
      const names = rank(kind, term, exclude);
      const exact = term && ((VOCAB[kind] || []).some(n => nameKey(n.name) === nameKey(term)) ||
                             (many && exclude.has(nameKey(term))));
      ddItems = names.map(n => ({ type: 'pick', name: n.name, uses: n.uses, gender: n.gender }));
      // A single-value field showing exactly its own value has nothing to
      // offer but itself - leave the list closed rather than parroting it.
      if (!many && term && ddItems.length === 1 && nameKey(ddItems[0].name) === nameKey(term)) ddItems = [];
      if (term && !exact) ddItems.push({ type: 'new', name: term });
      ddSel = term && ddItems.length ? 0 : -1;

      if (!ddItems.length) {
        dd.innerHTML = '<div class="sse-none">No ' + KIND_LABEL[kind] + ' matches.</div>';
      } else {
        dd.innerHTML = ddItems.map((it, i) =>
          it.type === 'new'
            ? '<div class="sse-it new' + (i === ddSel ? ' sel' : '') + '" data-i="' + i + '">' +
                '<span class="nm">+ Add ' + KIND_LABEL[kind] + ' &ldquo;' + esc(it.name) + '&rdquo;</span></div>'
            : '<div class="sse-it' + (i === ddSel ? ' sel' : '') + '" data-i="' + i + '">' +
                '<span class="nm">' + esc(it.name) + '</span>' +
                (kind === 'performer' ? '<span class="g">' + esc(shortGender(it.gender)) + '</span>' : '') +
                '<span class="ct">' + (it.uses ? Number(it.uses).toLocaleString() : '') + '</span></div>'
        ).join('');
      }
      dd.hidden = false;
      place();
    }

    function highlight(i) {
      if (!ddItems.length) return;
      ddSel = Math.max(0, Math.min(ddItems.length - 1, i));
      dd.querySelectorAll('.sse-it').forEach((el, n) => el.classList.toggle('sel', n === ddSel));
      dd.querySelector('.sse-it.sel')?.scrollIntoView({ block: 'nearest' });
    }

    function closeDD() {
      dd.hidden = true;
      dd.innerHTML = '';
      ddInput = null; ddItems = []; ddSel = -1; ddGender = null;
    }

    // Below the input when there is room, above it when the keyboard has
    // eaten the space underneath. Measured against the visual viewport,
    // which is the part of the screen the keyboard has not covered.
    function place() {
      if (!ddInput || dd.hidden) return;
      if (!document.body.contains(ddInput)) { closeDD(); return; }
      const r = ddInput.getBoundingClientRect();
      const vv = window.visualViewport;
      const top0 = vv ? vv.offsetTop : 0;
      const bottom0 = vv ? vv.offsetTop + vv.height : window.innerHeight;
      const below = bottom0 - r.bottom - 8;
      const above = r.top - top0 - 8;
      const width = Math.min(Math.max(r.width, 240), window.innerWidth - 16);
      dd.style.width = width + 'px';
      dd.style.left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8)) + 'px';
      const up = below < 150 && above > below;
      const room = Math.max(90, Math.min(280, up ? above : below));
      dd.style.maxHeight = room + 'px';
      const h = Math.min(dd.scrollHeight, room);
      dd.style.top = (up ? r.top - h - 2 : r.bottom + 2) + 'px';
    }

    function pick(it) {
      const inp = ddInput;
      if (!inp) return;
      const kind = inp.dataset.kind;
      const f = inp.dataset.f;
      const many = !!inp.dataset.many;
      if (it.type === 'new' && kind === 'performer') { askGender(inp, it.name); return; }
      if (many) {
        if (!cur[f].some(n => nameKey(n) === nameKey(it.name))) cur[f].push(it.name);
        if (it.type === 'new') newNames.tag.add(nameKey(it.name));
        inp.value = '';
        paintChips(f);
        paintSaid(f);
        openDD(inp);
        inp.focus();
      } else {
        inp.value = it.name;
        cur[f] = it.name;
        if (it.type === 'new') newNames.studio.add(nameKey(it.name));
        paintSaid(f);
        closeDD();
      }
    }

    function askGender(inp, name) {
      ddGender = name;
      ddItems = []; ddSel = -1;
      dd.innerHTML = '<div class="sse-gpick"><div>New performer <strong>' + esc(name) + '</strong> &mdash; gender?</div>' +
        '<div class="sse-gbtns">' + GENDERS.map(g =>
          '<button type="button" data-g="' + g[0] + '" title="' + esc(g[2]) + '">' + esc(g[1] === '?' ? 'Not sure' : g[1]) + '</button>'
        ).join('') + '</div></div>';
      dd.hidden = false;
      place();
      dd.querySelectorAll('[data-g]').forEach(b => b.addEventListener('click', () => {
        const f = inp.dataset.f;
        newPerformers.set(nameKey(name), b.dataset.g || '');
        if (!cur[f].some(n => nameKey(n) === nameKey(name))) cur[f].push(name);
        inp.value = '';
        ddGender = null;
        paintChips(f);
        paintSaid(f);
        closeDD();
        inp.focus();
      }));
    }

    // mousedown on the list must not take focus from the input: that is what
    // keeps the keyboard up on a phone while you pick several in a row.
    dd.addEventListener('mousedown', (e) => { e.preventDefault(); clearTimeout(ddBlurTimer); });
    dd.addEventListener('touchstart', () => clearTimeout(ddBlurTimer), { passive: true });
    dd.addEventListener('click', (e) => {
      clearTimeout(ddBlurTimer);
      const el = e.target.closest('.sse-it');
      if (!el) return;
      const it = ddItems[+el.dataset.i];
      if (it) pick(it);
    });

    const onScroll = (e) => { if (!dd.hidden && !dd.contains(e.target)) place(); };
    const onResize = () => place();
    const onDocDown = (e) => {
      if (dd.hidden) return;
      if (dd.contains(e.target) || (ddInput && e.target === ddInput)) return;
      closeDD();
    };
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    window.visualViewport?.addEventListener('resize', onResize);
    window.visualViewport?.addEventListener('scroll', onResize);
    document.addEventListener('pointerdown', onDocDown, true);
    function detach() {
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
      window.visualViewport?.removeEventListener('resize', onResize);
      window.visualViewport?.removeEventListener('scroll', onResize);
      document.removeEventListener('pointerdown', onDocDown, true);
      clearTimeout(ddBlurTimer);
    }
    // The modal can be closed out from under the form (Close, backdrop,
    // another modal replacing it). Nothing calls finish() then, so notice.
    const gone = new MutationObserver(() => {
      if (!document.body.contains(host)) { gone.disconnect(); finished = true; detach(); dd.remove(); }
    });
    gone.observe(document.body, { childList: true, subtree: true });

    // ---- save ----------------------------------------------------------------
    function collect() {
      const out = {};
      host.querySelectorAll('input.sse-in').forEach(inp => {
        const f = inp.dataset.f;
        if (inp.dataset.many) return;
        if (f === 'duration_sec') out[f] = parseDur(inp.value);
        else out[f] = inp.value.trim();
      });
      out.performers = cur.performers.slice();
      out.tags = cur.tags.slice();
      // Text typed into a list box but never turned into a chip is almost
      // always meant: take it rather than drop it on the floor silently.
      ['performers', 'tags'].forEach(f => {
        const inp = host.querySelector('input[data-f="' + f + '"]');
        const t = inp ? inp.value.trim() : '';
        const hit = t ? vocabFind(f === 'performers' ? 'performer' : 'tag', t) : null;
        const nm = hit ? hit.name : t;
        if (nm && !out[f].some(n => nameKey(n) === nameKey(nm))) out[f].push(nm);
      });
      return out;
    }

    async function refreshAfter() {
      vocabAt = 0;
      try { if (window.scrayStashNames) await window.scrayStashNames.refresh(true); } catch (e) { /* lists catch up later */ }
      try {
        if (typeof window.scrayLoadStashState === 'function') await window.scrayLoadStashState(true);
      } catch (e) { /* the S button catches up on the next poll */ }
    }

    const setBusy = (on, label) => {
      busy = on;
      saveBtn.disabled = on;
      cancelBtn.disabled = on;
      saveBtn.textContent = on ? (label || 'Saving…') : 'Save';
    };

    async function save() {
      if (busy || !row) return;
      closeDD();
      setErr('');
      const v = collect();

      if (Number.isNaN(v.duration_sec)) { setErr('Duration should look like 12:34 (or plain seconds).'); return; }
      if (v.release_date && !/^\d{4}(-\d{2}(-\d{2})?)?$/.test(v.release_date)) {
        setErr('Released should look like 2024-05-31.');
        return;
      }
      // A typed performer that is not in the list yet still needs a gender
      // asked, exactly as if it had been added from the dropdown.
      const unknown = v.performers.find(n => !vocabFind('performer', n) && !newPerformers.has(nameKey(n)));
      if (unknown) {
        const inp = host.querySelector('input[data-f="performers"]');
        if (inp) {
          inp.value = unknown;
          inp.focus();
          ddInput = inp;
          askGender(inp, unknown);
        }
        setErr('Pick a gender for ' + unknown + ' first.');
        return;
      }

      const m = mode();
      let body;
      if (m === 'correct') {
        const row1 = { video_key: key };
        const over = row.override_fields || [];
        FIELDS.forEach(f => { if (over.includes(f) || !same(f, v[f], orig[f])) row1[f] = v[f]; });
        if (Object.keys(row1).length === 1) { finish(false); return; }
        body = row1;
      } else {
        const blank = FIELDS.every(f => (f === 'performers' || f === 'tags') ? !v[f].length
                                        : f === 'duration_sec' ? v[f] === null : v[f] === '');
        if (blank) { setErr('Nothing to save yet — fill in at least one field.'); return; }
        body = Object.assign({ video_key: key }, v);
        if (!body.title) body.title = titleFromFilename(row.filename || video.filename || '');
      }

      setBusy(true);
      try {
        // New performers go into the list first, with their gender, so the
        // save that follows credits them correctly.
        const names = (body.performers || []).filter(n => newPerformers.has(nameKey(n)));
        for (const n of names) {
          const g = newPerformers.get(nameKey(n));
          await api('stash_edit_vocab_add', { method: 'POST',
            body: { kind: 'performer', name: n, meta: g ? { gender: g } : {} } });
        }
        const res = await api(m === 'correct' ? 'stash_edit_override_save' : 'stash_edit_manual_save',
                              { method: 'POST', body: { rows: [body] } });
        if (res.skipped) {
          const why = (res.details && res.details[0] && res.details[0].why) || 'the server skipped it';
          throw new Error(why);
        }
        await refreshAfter();
        finish(true);
      } catch (err) {
        setBusy(false);
        setErr('Could not save: ' + err.message);
      }
    }

    async function revertAll(btn) {
      setBusy(true, 'Reverting…');
      try {
        await api('stash_edit_override_delete', { method: 'POST', body: { video_keys: [key] } });
        await refreshAfter();
        finish(true);
      } catch (err) {
        setBusy(false);
        if (btn) { btn.classList.remove('sse-armed'); btn.textContent = 'Revert all to StashDB'; }
        setErr('Could not revert: ' + err.message);
      }
    }

    async function removeManual(btn) {
      setBusy(true, 'Removing…');
      try {
        const res = await api('stash_edit_manual_delete', { method: 'POST', body: { video_keys: [key] } });
        if (res.refused) throw new Error('this file is matched to StashDB, not entered by hand');
        await refreshAfter();
        finish(true);
      } catch (err) {
        setBusy(false);
        if (btn) { btn.classList.remove('sse-armed'); btn.textContent = 'Remove these details'; }
        setErr('Could not remove: ' + err.message);
      }
    }

    return {
      close: () => finish(false),
      get busy() { return busy; }
    };
  }

  window.scrayStashEdit = { open, _rank: rank, _parseDur: parseDur, _vocab: VOCAB };
})();

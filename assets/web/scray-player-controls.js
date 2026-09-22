console.log("scray-player-controls.js loaded");

/* =========================================
SETTINGS > PLAYER CONTROLS (picker 15.5 / native 15.3)
=========================================
Per-mode layout of the player's control bar, for the three phone surfaces
(see PLAYER MODES - CANONICAL NAMES in player.js):

  MPB   docked portrait player
  MPFS  portrait fullscreen
  FLS   forced landscape

For each mode, every control is in one of three places, in an order you pick:

  bar   on the control bar
  menu  in the ... player overflow menu (as a tap-through to the same button)
  hide  nowhere

A mode with nothing saved is left EXACTLY as style.css lays it out - this file
styles nothing there. Only a mode you have customised is touched, and then
only with inline `order` / `display` (!important, so it beats the per-mode
hide rules in style.css) on the buttons the attach* functions in player.js
already make. Nothing is created or removed: X stays in the DOM even when
hidden, which the swipe-up random relies on.

Hooks:
  window.scrayApplyPlayerControls()     re-apply; player.js calls it after
                                        each control rebuild, and a body
                                        class watcher calls it on mode change
  window.scrayPlayerControlsOverflow(a) player.js's overflow menu hands its
                                        own items (native fullscreen, TinEye)
                                        through this, and shows what it returns

Saved per device in localStorage (scray_player_controls_v1): picker in each
browser and the native app keep their own layouts.
========================================= */
(() => {
  const STORE_KEY = 'scray_player_controls_v1';
  const MODES = ['MPB', 'MPFS', 'FLS'];
  const MODE_NAMES = {
    MPB: 'MPB - docked player',
    MPFS: 'MPFS - portrait fullscreen',
    FLS: 'FLS - forced landscape'
  };

  // In the bar's built-in DOM order (the order the attach* functions leave
  // them in). `modes` limits a control to some surfaces; `virtual` ones are
  // menu-only items player.js builds itself; `barOnly` can't go in the menu.
  const CONTROLS = [
    { k: 'play',       face: '▶',  name: 'Play / pause',              sel: '[data-plyr="play"]' },
    { k: 'stop',       face: '■',  name: 'Stop',                      sel: '.plyr-stop' },
    { k: 'rotate',     face: '↻',  name: 'Rotate to FLS / back',      sel: '.plyr-manual-rotate' },
    { k: 'flsToMpfs',  face: '↺',  name: 'Back to portrait fullscreen', sel: '.plyr-fls-to-mpfs', modes: ['FLS'] },
    { k: 'lock',       face: '🔒', name: 'Position lock',             sel: '.plyr-scroll-lock', modes: ['FLS'], display: 'flex' },
    { k: 'random',     face: 'X',  name: 'Random video',              sel: '.plyr-random-video' },
    { k: 'randomBm',   face: 'Xb', name: 'Random bookmark',           sel: '.plyr-random-bookmark' },
    { k: 'history',    face: 'H<', name: 'Play through history',      sel: '.plyr-history-sequence' },
    { k: 'next',       face: '>',  name: 'Play next in list',         sel: '.plyr-play-next' },
    { k: 'nextBm',     face: 'M>', name: 'Next bookmark',             sel: '.plyr-basket-quick' },
    { k: 'bookmark',   face: 'BM', name: 'Add bookmark',              sel: '.plyr-bookmark-quick' },
    { k: 'fullscreen', face: '⤢',  name: 'Fullscreen on / off',       sel: '[data-plyr="fullscreen"]' },
    { k: 'mute',       face: '🔇', name: 'Mute',                      sel: '[data-plyr="mute"]', also: '.plyr__volume' },
    { k: 'more',       face: '...', name: 'Overflow menu button',     sel: '.plyr-more', barOnly: true },
    { k: 'nativeFs',   face: '⛶',  name: 'Native fullscreen',         virtual: true },
    { k: 'tineye',     face: '🔍', name: 'TinEye',                    virtual: true }
  ];
  const BY_KEY = {};
  CONTROLS.forEach(c => { BY_KEY[c.k] = c; });

  const forMode = (mode) => CONTROLS.filter(c => !c.modes || c.modes.includes(mode));

  // What style.css shows in each mode today, so the editor starts from the
  // bar you already have. (Only the editor's starting point - a mode you
  // haven't saved is never styled by this file.)
  const HIDDEN_BY_DEFAULT = {
    MPB:  ['random', 'randomBm', 'history', 'bookmark'],
    MPFS: ['random', 'randomBm', 'history', 'bookmark'],
    FLS:  ['rotate', 'bookmark']
  };

  function defaultLayout(mode) {
    return forMode(mode).map(c => ({
      k: c.k,
      s: c.virtual ? 'menu' : (HIDDEN_BY_DEFAULT[mode].includes(c.k) ? 'hide' : 'bar')
    }));
  }

  // A saved layout, tidied: unknown keys dropped, bad states fixed, and any
  // control added since it was saved appended in its default state.
  function normalise(mode, list) {
    const allowed = forMode(mode).map(c => c.k);
    const out = [];
    (Array.isArray(list) ? list : []).forEach(item => {
      if (!item || !allowed.includes(item.k) || out.some(o => o.k === item.k)) return;
      const def = BY_KEY[item.k];
      let s = ['bar', 'menu', 'hide'].includes(item.s) ? item.s : 'bar';
      if (def.virtual && s === 'bar') s = 'menu';
      if (def.barOnly && s === 'menu') s = 'bar';
      out.push({ k: item.k, s });
    });
    defaultLayout(mode).forEach(d => { if (!out.some(o => o.k === d.k)) out.push(d); });
    return out;
  }

  function loadAll() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (e) { raw = null; }
    const out = {};
    MODES.forEach(m => { if (raw && Array.isArray(raw[m])) out[m] = normalise(m, raw[m]); });
    return out;
  }

  const sameLayout = (a, b) => a.length === b.length && a.every((x, i) => x.k === b[i].k && x.s === b[i].s);

  function saveAll(layouts) {
    const out = {};
    MODES.forEach(m => {
      const l = layouts && layouts[m] ? normalise(m, layouts[m]) : null;
      if (l && !sameLayout(l, defaultLayout(m))) out[m] = l;   // default = nothing saved
    });
    try {
      if (Object.keys(out).length) localStorage.setItem(STORE_KEY, JSON.stringify(out));
      else localStorage.removeItem(STORE_KEY);
    } catch (e) {
      throw new Error("Couldn't save the player controls on this device");
    }
  }

  // ---- which surface is live ----------------------------------------------
  // FLS first: portrait-fullscreen is set during FLS too.
  function currentMode() {
    const b = document.body && document.body.classList;
    if (!b) return null;
    if (b.contains('manual-rotate-landscape')) return 'FLS';
    if (window.innerWidth > 768) return null;                      // desktop
    if (!window.matchMedia('(orientation: portrait)').matches) return null; // device landscape
    const container = document.getElementById('inlineVideoContainer');
    if (container && container.classList.contains('mini-player')) return null;
    if (b.contains('portrait-fullscreen') || (window.plyrPlayer && window.plyrPlayer.fullscreen && window.plyrPlayer.fullscreen.active)) return 'MPFS';
    if (b.contains('portrait-inline')) return 'MPB';
    return null;
  }

  // ---- applying a layout ----------------------------------------------------
  function clearStyling(controls) {
    controls.querySelectorAll('[data-scray-pc]').forEach(el => {
      el.style.removeProperty('order');
      el.style.removeProperty('display');
      delete el.dataset.scrayPc;
    });
  }

  function mark(el, order, display) {
    el.dataset.scrayPc = '1';
    el.style.setProperty('order', String(order), 'important');
    if (display) el.style.setProperty('display', display, 'important');
  }

  function menuCount(layout) {
    return layout.filter(item => {
      if (item.s !== 'menu') return false;
      // Native fullscreen only exists on touch devices; count it only there.
      if (item.k === 'nativeFs') return (('ontouchstart' in window) || navigator.maxTouchPoints > 0);
      return true;
    }).length;
  }

  function apply() {
    const controls = document.querySelector('.plyr__controls');
    if (!controls) return;
    clearStyling(controls);
    const mode = currentMode();
    const layout = mode ? loadAll()[mode] : null;
    if (!layout) return;                      // not customised - style.css as is

    let order = 1;
    layout.forEach(item => {
      const def = BY_KEY[item.k];
      if (!def || def.virtual) return;
      const n = order++;
      controls.querySelectorAll(':scope > ' + def.sel).forEach(el => {
        if (def.k === 'more') {
          mark(el, n, menuCount(layout) ? (def.display || 'flex') : 'none');
        } else {
          mark(el, n, item.s === 'bar' ? (def.display || 'flex') : 'none');
        }
      });
      // Volume slider rides with mute: same slot, gone when mute is. Left to
      // Plyr/iOS otherwise (it hides the slider on iOS itself).
      if (def.also) {
        controls.querySelectorAll(':scope > ' + def.also).forEach(el => {
          mark(el, n, item.s === 'bar' ? null : 'none');
        });
      }
    });
  }

  let applyQueued = false;
  function scheduleApply() {
    if (applyQueued) return;
    applyQueued = true;
    requestAnimationFrame(() => { applyQueued = false; apply(); });
  }

  window.scrayApplyPlayerControls = apply;

  // Built-in overflow items come in from player.js, each with a `key`.
  window.scrayPlayerControlsOverflow = function (builtins) {
    const mode = currentMode();
    const layout = mode ? loadAll()[mode] : null;
    if (!layout) return builtins;
    const controls = document.querySelector('.plyr__controls');
    const out = [];
    layout.forEach(item => {
      if (item.s !== 'menu') return;
      const def = BY_KEY[item.k];
      if (!def) return;
      if (def.virtual) {
        const a = (builtins || []).find(x => x.key === item.k);
        if (a) out.push(a);
        return;
      }
      if (!controls || !controls.querySelector(':scope > ' + def.sel)) return;
      out.push({
        label: `${def.face}  ${def.name}`,
        // Re-queried and deferred, like the swipe-up random: several of these
        // rebuild the player, so they get a clean stack and the live button.
        onClick: () => setTimeout(() => {
          const el = document.querySelector('.plyr__controls > ' + def.sel);
          if (el) el.click();
        }, 0)
      });
    });
    return out;
  };

  // Mode changes: body classes (FLS/MPFS/MPB), rotation and size.
  function watch() {
    if (!document.body) return;
    new MutationObserver(scheduleApply).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('resize', scheduleApply);
    try { window.matchMedia('(orientation: portrait)').addEventListener('change', scheduleApply); } catch (e) {}
    scheduleApply();
  }

  // ---- Settings row ------------------------------------------------------------
  function buildEditor() {
    const saved = loadAll();
    const work = {};
    MODES.forEach(m => { work[m] = (saved[m] || defaultLayout(m)).map(x => ({ ...x })); });
    let mode = currentMode() || 'MPB';

    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:8px;margin-top:6px;';

    const btnCss = 'width:auto;margin:0;border:none;border-radius:4px;color:#fff;font-size:0.8rem;';

    const tabs = document.createElement('div');
    tabs.style.cssText = 'display:flex;gap:4px;';
    wrap.appendChild(tabs);

    const modeNote = document.createElement('div');
    modeNote.style.cssText = 'font-size:0.75rem;color:#aaa;';
    wrap.appendChild(modeNote);

    const preview = document.createElement('div');
    preview.style.cssText = 'font-size:0.75rem;color:#ddd;font-family:ui-monospace,Menlo,monospace;'
      + 'background:#111;border-radius:4px;padding:6px 8px;line-height:1.5;word-break:break-word;';
    wrap.appendChild(preview);

    const list = document.createElement('div');
    list.style.cssText = 'display:flex;flex-direction:column;gap:4px;padding:8px;border:1px solid #3a3a3a;border-radius:6px;';
    wrap.appendChild(list);

    const foot = document.createElement('div');
    foot.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;';
    wrap.appendChild(foot);

    const reset = document.createElement('button');
    reset.type = 'button';
    reset.style.cssText = btnCss + 'padding:6px 10px;background:#444;';
    reset.addEventListener('click', () => { work[mode] = defaultLayout(mode); paint(); });
    foot.appendChild(reset);

    const copyTo = document.createElement('select');
    copyTo.style.cssText = 'width:auto;margin:0;padding:6px;background:#2a2a2a;color:#fff;border:1px solid #555;border-radius:4px;font-size:0.8rem;';
    copyTo.addEventListener('change', () => {
      const target = copyTo.value;
      copyTo.value = '';
      if (!target) return;
      // Copy the order and places; controls the target mode doesn't have are
      // skipped, and its own extras (↺, lock) keep their current places.
      const src = work[mode];
      const extras = work[target].filter(x => !src.some(s => s.k === x.k));
      work[target] = normalise(target, src.concat(extras));
      mode = target;
      paint();
    });
    foot.appendChild(copyTo);

    const stateBtn = (label, active, disabled) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.disabled = !!disabled;
      b.style.cssText = btnCss + 'padding:5px 7px;min-width:2.6rem;'
        + (active ? 'background:#007bff;' : 'background:#333;')
        + (disabled ? 'opacity:0.3;' : '');
      return b;
    };

    function paint() {
      const layout = work[mode];

      tabs.innerHTML = '';
      MODES.forEach(m => {
        const t = document.createElement('button');
        t.type = 'button';
        const custom = !sameLayout(normalise(m, work[m]), defaultLayout(m));
        t.textContent = m + (custom ? ' •' : '');
        t.style.cssText = btnCss + 'flex:1;padding:8px 4px;font-weight:600;'
          + (m === mode ? 'background:#007bff;' : 'background:#333;');
        t.addEventListener('click', () => { mode = m; paint(); });
        tabs.appendChild(t);
      });

      const custom = !sameLayout(normalise(mode, layout), defaultLayout(mode));
      modeNote.textContent = MODE_NAMES[mode] + (custom ? ' · customised' : ' · built-in layout');
      reset.textContent = `Reset ${mode} to built-in`;

      copyTo.innerHTML = '';
      const ph = document.createElement('option');
      ph.value = ''; ph.textContent = `Copy ${mode} to…`;
      copyTo.appendChild(ph);
      MODES.filter(m => m !== mode).forEach(m => {
        const o = document.createElement('option');
        o.value = m; o.textContent = m;
        copyTo.appendChild(o);
      });

      const bar = layout.filter(x => x.s === 'bar' && !BY_KEY[x.k].virtual)
        .filter(x => x.k !== 'more' || menuCount(layout))
        .map(x => BY_KEY[x.k].face);
      const menu = layout.filter(x => x.s === 'menu').map(x => BY_KEY[x.k].face + ' ' + BY_KEY[x.k].name);
      const hidden = layout.filter(x => x.s === 'hide').map(x => BY_KEY[x.k].face);
      preview.innerHTML = '';
      [['Bar', bar.join('  ') || '(empty)'],
       ['...', menu.join(', ') || '(empty - ... button hidden)'],
       ['Hidden', hidden.join('  ') || '-']].forEach(([k, v]) => {
        const line = document.createElement('div');
        line.textContent = `${k}: ${v}`;
        preview.appendChild(line);
      });

      list.innerHTML = '';
      layout.forEach((item, i) => {
        const def = BY_KEY[item.k];
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:4px;';

        const up = stateBtn('▲', false, i === 0);
        const down = stateBtn('▼', false, i === layout.length - 1);
        up.style.minWidth = down.style.minWidth = '2rem';
        up.addEventListener('click', () => { [layout[i - 1], layout[i]] = [layout[i], layout[i - 1]]; paint(); });
        down.addEventListener('click', () => { [layout[i + 1], layout[i]] = [layout[i], layout[i + 1]]; paint(); });

        const name = document.createElement('span');
        name.style.cssText = 'flex:1;min-width:0;font-size:0.8rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'
          + (item.s === 'hide' ? 'color:#777;' : '');
        const face = document.createElement('b');
        face.textContent = def.face;
        face.style.cssText = 'display:inline-block;min-width:1.8rem;';
        name.append(face, document.createTextNode(def.name));

        const places = [['bar', 'Bar'], ['menu', '...'], ['hide', 'Hide']];
        const group = document.createElement('div');
        group.style.cssText = 'display:flex;gap:2px;';
        places.forEach(([s, label]) => {
          const disabled = (def.virtual && s === 'bar') || (def.barOnly && s === 'menu');
          const b = stateBtn(label, item.s === s, disabled);
          b.addEventListener('click', () => { item.s = s; paint(); });
          group.appendChild(b);
        });

        row.append(up, down, name, group);
        list.appendChild(row);
      });
    }

    paint();
    return {
      el: wrap,
      value: () => {
        const out = {};
        MODES.forEach(m => { out[m] = work[m].map(x => ({ ...x })); });
        return out;
      },
      focus: () => {}
    };
  }

  document.addEventListener('DOMContentLoaded', () => {
    watch();
    if (!window.scraySettings || typeof window.scraySettings.register !== 'function') return;
    window.scraySettings.register({
      id: 'playerControls',
      label: 'Player controls',
      type: 'custom',
      hint: 'For each player - MPB, MPFS and FLS - put each control on the bar, in the ... menu, or hide it. ▲ ▼ set the order (the ... menu follows the same order). A mode you leave on its built-in layout is untouched.',
      get: () => loadAll(),
      build: buildEditor,
      set: (value) => { saveAll(value); apply(); }
    });
  });

  window.scrayPlayerControls = { loadAll, defaultLayout, currentMode, apply };
})();

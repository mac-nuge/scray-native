// ===== disguise.js =====
// Cosmetic overlay for Scray Picker (web) and Scray Native (WKWebView).
// Purely visual — no app logic is touched.
//
//  1. Recolours the page via backdrop-filter, cycling Colour -> Greyscale ->
//     Invert -> Grey+Invert. backdrop-filter is used rather than an ancestor
//     `filter` so nothing becomes a containing block and position:fixed keeps
//     working throughout the app.
//  2. Lays one of N screenshots over the whole viewport.
//  3. Shot / Page opacity sliders, 10 preset slots, and a collapse handle.
//     Desktop: presets also fire on Alt+0-9. Mobile: tap the numbered chips.
//
// Desktop shows an expanded panel top-right; mobile shows a collapsed handle
// in the corner that expands on tap.

(function () {
  'use strict';

  // ---------------------------------------------------------------- CONFIG
  const ENABLED = true;              // flip to false to switch the whole thing off

  // Which viewports get the compact corner layout. Mirrors the app's own phone
  // breakpoints, so a phone in landscape still counts as mobile.
  const MOBILE_MEDIA =
    '(max-width: 768px), (max-width: 1024px) and (orientation: landscape)';

  // Screenshots, per layout — one is picked at random per load.
  // An entry is a path, or { src, fit, position } to override the defaults
  // below for that one screenshot.
  const SHOTS_DESKTOP = [
    'disguise/shot1.png',
    'disguise/shot2.png'
  ];
  const SHOTS_MOBILE = [
    'disguise/mobile1.png'
  ];

  // 'cover'     = fill the viewport, crop overflow (recommended)
  // '100% 100%' = stretch to fit exactly, ignores aspect ratio
  // 'contain'   = fit whole screenshot, letterboxed
  const SHOT_FIT = 'cover';

  // Where the screenshot anchors when cover crops it. 'top center' aligns a
  // fake status bar to the top of the viewport; 'bottom center' pins a dock
  // to the bottom instead.
  const SHOT_POSITION = 'top center';

  // Runtime white-knockout. OFF by default — the shipped PNGs already have
  // transparency baked in, and this CANNOT work in the Native production
  // build: assets load over file://, which taints the canvas and makes
  // getImageData() throw. Only switch on for a quick test of a new screenshot
  // in the browser; bake it into the PNG before shipping.
  const KNOCKOUT_WHITE = false;
  const TRANSPARENT_ABOVE = 0.94;   // 0-1 luminance, lighter than this goes
  const OPAQUE_BELOW = 0.80;        // 0-1 luminance, darker than this stays

  // Colour the page fades toward as the Page slider drops. Inverted modes fade
  // to black so a dark page doesn't wash out to white as it disappears.
  const FADE_COLOUR = '#ffffff';
  const FADE_COLOUR_INVERTED = '#000000';

  // Cycle order for the mode button. Trim entries to shorten the cycle.
  const MODES = ['colour', 'grey', 'invert', 'greyinvert'];

  // Should the mode also recolour the screenshot?
  // false keeps the dashboard looking like a real dashboard.
  const MODE_AFFECTS_SCREENSHOT = false;

  // ---- Presets --------------------------------------------------------
  // NOTE: keyboard-config.js already binds bare 0-9 to the player's
  // "jump to X%" seek, so presets take a modifier by default.
  // 'alt' | 'ctrl' | 'shift' | 'meta' | 'none'
  // 'none' only intercepts digits you have actually assigned.
  const PRESET_MODIFIER = 'alt';

  // Whether a preset also stores/restores the colour mode.
  const PRESETS_INCLUDE_MODE = false;

  // First-ever-load defaults.
  const DEFAULTS = { shot: 0, page: 100, mode: 'grey', open: null };
  const REMEMBER = true;
  const STORAGE_KEY = 'scray_disguise_state';
  const PRESET_STORAGE_KEY = 'scray_disguise_presets';

  const Z = 2147483647;              // same ceiling the player/modals use
  // ------------------------------------------------------------ END CONFIG

  if (!ENABLED) return;

  const MODE_FILTER = {
    colour: '',
    grey: 'grayscale(1)',
    invert: 'invert(1)',
    greyinvert: 'grayscale(1) invert(1)'
  };
  const MODE_LABEL = {
    colour: 'Colour',
    grey: 'Greyscale',
    invert: 'Invert',
    greyinvert: 'Grey + Invert'
  };
  const MODE_LABEL_SHORT = {
    colour: 'Colour',
    grey: 'Grey',
    invert: 'Invert',
    greyinvert: 'Gr+Inv'
  };

  function isInverted(mode) { return mode === 'invert' || mode === 'greyinvert'; }

  const mq = window.matchMedia(MOBILE_MEDIA);
  function isMobile() { return mq.matches; }

  function normaliseShot(entry) {
    if (!entry) return null;
    if (typeof entry === 'string') {
      return { src: entry, fit: SHOT_FIT, position: SHOT_POSITION };
    }
    return {
      src: entry.src,
      fit: entry.fit || SHOT_FIT,
      position: entry.position || SHOT_POSITION
    };
  }

  // Pick from the list matching the current layout, falling back to the other
  // list if one is empty, so an unpopulated set never leaves a blank overlay.
  function pickShot() {
    const primary = (isMobile() ? SHOTS_MOBILE : SHOTS_DESKTOP).filter(Boolean);
    const backup  = (isMobile() ? SHOTS_DESKTOP : SHOTS_MOBILE).filter(Boolean);
    const list = primary.length ? primary : backup;
    if (!list.length) return null;
    return normaliseShot(list[Math.floor(Math.random() * list.length)]);
  }

  let currentShot = pickShot();
  let currentShotIsMobile = isMobile();

  // ---- State ----
  const state = Object.assign({}, DEFAULTS);
  if (REMEMBER) {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      if (Number.isFinite(saved.shot)) state.shot = Math.min(Math.max(saved.shot, 0), 100);
      if (Number.isFinite(saved.page)) state.page = Math.min(Math.max(saved.page, 0), 100);
      if (typeof saved.mode === 'string' && MODE_FILTER[saved.mode] !== undefined) {
        state.mode = saved.mode;
      } else if (typeof saved.grey === 'boolean') {
        state.mode = saved.grey ? 'grey' : 'colour';   // migrate the old boolean
      }
      if (typeof saved.open === 'boolean') state.open = saved.open;
    } catch (e) { /* ignore malformed state */ }
  }
  if (state.open === null) state.open = !isMobile();
  if (MODES.indexOf(state.mode) === -1) state.mode = MODES[0];

  function save() {
    if (!REMEMBER) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }

  let presets = {};
  try {
    const raw = JSON.parse(localStorage.getItem(PRESET_STORAGE_KEY) || '{}');
    Object.keys(raw).forEach(k => {
      const p = raw[k];
      if (/^[0-9]$/.test(k) && p && Number.isFinite(p.shot) && Number.isFinite(p.page)) {
        presets[k] = p;
      }
    });
  } catch (e) { presets = {}; }

  function savePresets() {
    try { localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(presets)); } catch (e) { /* ignore */ }
  }

  // Read the digit off the physical key, not e.key — Shift+1 reports '!' and
  // Alt+digit is layout-dependent on some keyboards.
  function digitFrom(e) {
    if (/^[0-9]$/.test(e.key)) return e.key;
    const m = /^(?:Digit|Numpad)([0-9])$/.exec(e.code || '');
    return m ? m[1] : null;
  }

  function modifierHeld(e) {
    switch (PRESET_MODIFIER) {
      case 'alt':   return e.altKey && !e.ctrlKey && !e.metaKey;
      case 'ctrl':  return e.ctrlKey && !e.altKey && !e.metaKey;
      case 'shift': return e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey;
      case 'meta':  return e.metaKey && !e.ctrlKey && !e.altKey;
      default:      return !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey;
    }
  }

  function modifierLabel() {
    if (PRESET_MODIFIER === 'none') return '';
    return PRESET_MODIFIER.charAt(0).toUpperCase() + PRESET_MODIFIER.slice(1) + '+';
  }

  function injectStyles() {
    if (document.getElementById('scrayDisguiseStyles')) return;
    const css = `
#scrayDisguise {
  position: fixed; inset: 0;
  pointer-events: none;
  z-index: ${Z};
}
#scrayDisguiseTint,
#scrayDisguiseFade,
#scrayDisguiseShot {
  position: absolute; inset: 0;
  pointer-events: none;
}
#scrayDisguiseFade {
  background: ${FADE_COLOUR};
  opacity: 0;
}
#scrayDisguiseShot {
  background-color: transparent;
  background-repeat: no-repeat;
  opacity: 0;
}
#scrayDisguiseControl {
  position: absolute;
  top: calc(env(safe-area-inset-top, 0px) + 10px);
  right: calc(env(safe-area-inset-right, 0px) + 10px);
  pointer-events: auto;
  display: flex; flex-direction: column; gap: 6px;
  padding: 8px 10px;
  border-radius: 10px;
  background: rgba(255,255,255,0.94);
  border: 1px solid #c9c9c9;
  box-shadow: 0 1px 5px rgba(0,0,0,0.18);
  font: 12px/1 -apple-system, "Segoe UI", Roboto, sans-serif;
  color: #6b6b6b;
  user-select: none;
  -webkit-user-select: none;
  -webkit-tap-highlight-color: transparent;
}
#scrayDisguiseBody {
  display: flex; flex-direction: column; gap: 6px;
}
.scray-disguise-row {
  display: flex; align-items: center; gap: 8px;
}
.scray-disguise-row > span.scray-disguise-lbl {
  width: 30px;
}
.scray-disguise-row input[type="range"] {
  width: 120px;
  accent-color: #9a9a9a;
  cursor: pointer;
  margin: 0;
}
.scray-disguise-val {
  min-width: 32px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
#scrayDisguiseModeBtn,
#scrayDisguiseAssignBtn {
  width: 100%;
  padding: 4px 6px;
  margin: 0;
  border: 1px solid #c9c9c9;
  border-radius: 6px;
  background: #f2f2f2;
  color: #6b6b6b;
  font: inherit;
  cursor: pointer;
}
#scrayDisguiseModeBtn.is-on,
#scrayDisguiseAssignBtn.is-on {
  background: #6b6b6b;
  border-color: #6b6b6b;
  color: #ffffff;
}
#scrayDisguiseHandle {
  align-self: flex-end;
  padding: 0;
  margin: 0;
  width: 100%;
  min-height: 14px;
  border: none;
  background: transparent;
  color: #b0b0b0;
  font: inherit;
  line-height: 1;
  cursor: pointer;
}
#scrayDisguisePresets {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
}
.scray-disguise-chip {
  flex: 1 1 0;
  min-width: 18px;
  padding: 3px 0;
  margin: 0;
  border: 1px solid #dcdcdc;
  border-radius: 4px;
  background: #f7f7f7;
  color: #b8b8b8;
  font: inherit;
  cursor: pointer;
}
.scray-disguise-chip.is-set {
  background: #ffffff;
  border-color: #6b6b6b;
  color: #6b6b6b;
  font-weight: 700;
}

/* ---- Collapsed: handle plus any assigned presets, nothing else ---- */
#scrayDisguiseControl.is-collapsed #scrayDisguiseBody,
#scrayDisguiseControl.is-collapsed #scrayDisguiseAssignBtn {
  display: none;
}
#scrayDisguiseControl.is-collapsed .scray-disguise-chip:not(.is-set) {
  display: none;
}
#scrayDisguiseControl.is-collapsed {
  padding: 6px 8px;
  gap: 4px;
}

/* ---- Compact layout for phones ---- */
@media ${MOBILE_MEDIA} {
  #scrayDisguiseControl {
    top: calc(env(safe-area-inset-top, 0px) + 6px);
    right: calc(env(safe-area-inset-right, 0px) + 6px);
    padding: 6px 8px;
    font-size: 11px;
    max-width: 46vw;
  }
  .scray-disguise-row > span.scray-disguise-lbl { width: 26px; }
  .scray-disguise-row input[type="range"] { width: 88px; }
  .scray-disguise-val { min-width: 28px; }
  #scrayDisguisePresets {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 4px;
  }
  .scray-disguise-chip {
    min-width: 0;
    min-height: 26px;
    padding: 0;
  }
  #scrayDisguiseControl.is-collapsed #scrayDisguisePresets {
    display: flex;
  }
  #scrayDisguiseModeBtn,
  #scrayDisguiseAssignBtn { padding: 6px; }
  #scrayDisguiseHandle { min-height: 18px; }
}`;
    const styleEl = document.createElement('style');
    styleEl.id = 'scrayDisguiseStyles';
    styleEl.textContent = css;
    document.head.appendChild(styleEl);
  }

  // Browser-only convenience for testing a fresh screenshot. See KNOCKOUT_WHITE.
  function knockoutWhite(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onerror = () => reject(new Error('could not load ' + url));
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);

          const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const px = frame.data;
          const hi = TRANSPARENT_ABOVE * 255;
          const lo = OPAQUE_BELOW * 255;
          const span = Math.max(hi - lo, 1);

          for (let i = 0; i < px.length; i += 4) {
            const lum = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
            let a;
            if (lum >= hi) a = 0;
            else if (lum <= lo) a = 1;
            else a = (hi - lum) / span;
            px[i + 3] = Math.round(px[i + 3] * a);
          }

          ctx.putImageData(frame, 0, 0);
          canvas.toBlob(blob => {
            if (blob) resolve(URL.createObjectURL(blob));
            else reject(new Error('toBlob returned null'));
          }, 'image/png');
        } catch (err) {
          reject(err);   // tainted canvas under file:// lands here
        }
      };
      img.src = url;
    });
  }

  function makeRow(label, key, onChange) {
    const row = document.createElement('div');
    row.className = 'scray-disguise-row';

    const lbl = document.createElement('span');
    lbl.className = 'scray-disguise-lbl';
    lbl.textContent = label;

    const range = document.createElement('input');
    range.type = 'range';
    range.min = '0';
    range.max = '100';
    range.step = '1';
    range.value = String(state[key]);
    range.setAttribute('aria-label', label + ' opacity');

    const val = document.createElement('span');
    val.className = 'scray-disguise-val';
    val.textContent = state[key] + '%';

    range.addEventListener('input', () => {
      state[key] = parseInt(range.value, 10);
      val.textContent = state[key] + '%';
      onChange();
      save();
    });

    row.appendChild(lbl);
    row.appendChild(range);
    row.appendChild(val);
    return { row, range, val };
  }

  function build() {
    if (document.getElementById('scrayDisguise')) return;

    injectStyles();

    const root = document.createElement('div');
    root.id = 'scrayDisguise';

    const tint = document.createElement('div');
    tint.id = 'scrayDisguiseTint';

    const fade = document.createElement('div');
    fade.id = 'scrayDisguiseFade';

    const shot = document.createElement('div');
    shot.id = 'scrayDisguiseShot';

    function applyShot(entry) {
      if (!entry) { shot.style.backgroundImage = 'none'; return; }
      shot.style.backgroundImage = `url("${entry.src}")`;
      shot.style.backgroundSize = entry.fit;
      shot.style.backgroundPosition = entry.position;
      if (KNOCKOUT_WHITE) {
        const src = entry.src;
        knockoutWhite(src)
          .then(processed => {
            // Ignore a late result for a screenshot we've since swapped away from.
            if (currentShot && currentShot.src === src) {
              shot.style.backgroundImage = `url("${processed}")`;
            }
          })
          .catch(err => console.warn('Disguise: white knockout failed, showing raw screenshot', err));
      }
    }

    const control = document.createElement('div');
    control.id = 'scrayDisguiseControl';

    const handle = document.createElement('button');
    handle.id = 'scrayDisguiseHandle';
    handle.type = 'button';

    const bodyWrap = document.createElement('div');
    bodyWrap.id = 'scrayDisguiseBody';

    const modeBtn = document.createElement('button');
    modeBtn.id = 'scrayDisguiseModeBtn';
    modeBtn.type = 'button';

    // ---- Renderers ----
    function renderShot() { shot.style.opacity = String(state.shot / 100); }
    function renderPage() { fade.style.opacity = String((100 - state.page) / 100); }
    function renderMode() {
      const f = MODE_FILTER[state.mode] || '';
      tint.style.backdropFilter = f;
      tint.style.webkitBackdropFilter = f;
      fade.style.background = isInverted(state.mode) ? FADE_COLOUR_INVERTED : FADE_COLOUR;
      shot.style.filter = MODE_AFFECTS_SCREENSHOT ? (f || 'none') : 'none';
      modeBtn.classList.toggle('is-on', state.mode !== 'colour');
      modeBtn.textContent = isMobile() ? MODE_LABEL_SHORT[state.mode] : MODE_LABEL[state.mode];
      modeBtn.title = 'Colour mode — tap to cycle';
    }
    function renderOpen() {
      control.classList.toggle('is-collapsed', !state.open);
      handle.textContent = state.open ? '▴' : '▾';
      handle.title = state.open ? 'Collapse' : 'Expand';
      handle.setAttribute('aria-expanded', String(state.open));
    }

    modeBtn.addEventListener('click', () => {
      const i = MODES.indexOf(state.mode);
      state.mode = MODES[(i + 1) % MODES.length];
      renderMode();
      save();
    });

    handle.addEventListener('click', () => {
      state.open = !state.open;
      renderOpen();
      save();
    });

    const shotRow = makeRow('Shot', 'shot', renderShot);
    const pageRow = makeRow('Page', 'page', renderPage);
    bodyWrap.appendChild(shotRow.row);
    bodyWrap.appendChild(pageRow.row);
    bodyWrap.appendChild(modeBtn);

    // ---- Presets ----
    let capturing = false;

    const presetWrap = document.createElement('div');
    presetWrap.id = 'scrayDisguisePresets';

    const assignBtn = document.createElement('button');
    assignBtn.id = 'scrayDisguiseAssignBtn';
    assignBtn.type = 'button';

    const LONG_PRESS_MS = 600;
    const chips = {};
    for (let i = 0; i <= 9; i++) {
      const d = String(i);
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'scray-disguise-chip';
      chip.textContent = d;

      // Long-press clears, on touch and mouse alike; right-click does the
      // same on desktop.
      let pressTimer = null;
      let longFired = false;
      const startPress = () => {
        longFired = false;
        clearTimeout(pressTimer);
        pressTimer = setTimeout(() => { longFired = true; clearSlot(d); }, LONG_PRESS_MS);
      };
      const endPress = () => { clearTimeout(pressTimer); };
      chip.addEventListener('pointerdown', startPress);
      chip.addEventListener('pointerup', endPress);
      chip.addEventListener('pointerleave', endPress);
      chip.addEventListener('pointercancel', endPress);

      chip.addEventListener('click', () => {
        if (longFired) { longFired = false; return; }
        if (capturing) assignTo(d);
        else applyPreset(d);
      });
      chip.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        clearSlot(d);
      });

      presetWrap.appendChild(chip);
      chips[d] = chip;
    }

    function clearSlot(d) {
      if (!presets[d]) return;
      delete presets[d];
      savePresets();
      renderChips();
    }

    function renderChips() {
      const clearHint = isMobile() ? 'long-press to clear' : 'right-click to clear';
      for (let i = 0; i <= 9; i++) {
        const d = String(i);
        const p = presets[d];
        chips[d].classList.toggle('is-set', !!p);
        chips[d].title = p
          ? `${isMobile() ? '' : modifierLabel()}${d} → Shot ${p.shot}% / Page ${p.page}%`
            + (PRESETS_INCLUDE_MODE && p.mode ? ` / ${MODE_LABEL[p.mode] || p.mode}` : '')
            + ` — ${clearHint}`
          : `${isMobile() ? 'Slot ' : modifierLabel()}${d} — unassigned`;
      }
      assignBtn.classList.toggle('is-on', capturing);
      if (capturing) {
        assignBtn.textContent = isMobile() ? 'Tap a slot…' : 'Press 0–9 (Esc cancels)';
      } else {
        assignBtn.textContent = isMobile() ? 'Assign to slot' : 'Assign to key…';
      }
    }

    function assignTo(d) {
      const p = { shot: state.shot, page: state.page };
      if (PRESETS_INCLUDE_MODE) p.mode = state.mode;
      presets[d] = p;
      savePresets();
      capturing = false;
      renderChips();
    }

    function applyPreset(d) {
      const p = presets[d];
      if (!p) return;
      state.shot = p.shot;
      state.page = p.page;
      if (PRESETS_INCLUDE_MODE && p.mode && MODE_FILTER[p.mode] !== undefined) state.mode = p.mode;
      shotRow.range.value = String(state.shot);
      shotRow.val.textContent = state.shot + '%';
      pageRow.range.value = String(state.page);
      pageRow.val.textContent = state.page + '%';
      renderShot();
      renderPage();
      renderMode();
      save();
    }

    assignBtn.addEventListener('click', () => {
      capturing = !capturing;
      if (capturing && !state.open) { state.open = true; renderOpen(); }
      renderChips();
    });

    control.appendChild(handle);
    control.appendChild(bodyWrap);
    control.appendChild(presetWrap);
    control.appendChild(assignBtn);

    root.appendChild(tint);
    root.appendChild(fade);
    root.appendChild(shot);
    root.appendChild(control);
    document.body.appendChild(root);

    applyShot(currentShot);
    renderShot();
    renderPage();
    renderMode();
    renderOpen();
    renderChips();

    // Relabel when the viewport crosses the breakpoint (rotation, resize).
    const onBreakpoint = () => {
      // Swap to a screenshot from the newly active list, but only when the
      // layout has genuinely flipped — not on every resize event.
      if (isMobile() !== currentShotIsMobile) {
        currentShotIsMobile = isMobile();
        currentShot = pickShot();
        applyShot(currentShot);
      }
      renderMode();
      renderChips();
    };
    if (mq.addEventListener) mq.addEventListener('change', onBreakpoint);
    else if (mq.addListener) mq.addListener(onBreakpoint);

    // ---- Keyboard presets (desktop; harmless on mobile) ----
    // Anything that might be receiving typed characters blocks the preset
    // keys. Tested against e.target rather than document.activeElement, since
    // the two can disagree mid focus-change.
    function isTypingTarget(node) {
      if (!node || node.nodeType !== 1) return false;
      if (root.contains(node)) return false;   // our own sliders/buttons are fine
      const field = node.closest(
        'input, textarea, select, [contenteditable]:not([contenteditable="false"])'
      );
      if (!field) return false;
      // Non-text inputs don't swallow characters, so presets can still fire.
      if (field.tagName === 'INPUT') {
        const t = (field.type || 'text').toLowerCase();
        return ['checkbox','radio','range','button','submit','reset','file','color','image']
          .indexOf(t) === -1;
      }
      return true;
    }

    document.addEventListener('keydown', (e) => {
      // Mid-IME-composition the keystroke belongs to the composer, not us.
      if (e.isComposing || e.keyCode === 229) return;

      const target = (e.target && e.target.nodeType === 1) ? e.target : document.activeElement;
      if (isTypingTarget(target)) return;

      // Select2's search field lives in a detached dropdown, so the check
      // above can miss it. Mirror the player's own convention.
      if (window.jQuery && window.jQuery('.select2-container--open').length) return;

      if (capturing && e.key === 'Escape') {
        capturing = false;
        renderChips();
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      const d = digitFrom(e);
      if (!d) return;

      if (capturing) {
        assignTo(d);
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      if (!modifierHeld(e)) return;
      if (!presets[d]) return;
      applyPreset(d);
      e.preventDefault();
      e.stopPropagation();
    }, true);

    // Keep the layer as the last child of <body> so late-mounted elements
    // (docked player, modals, toasts — all at the same z-index ceiling)
    // still sit underneath it.
    const keepLast = new MutationObserver(() => {
      if (document.body.lastElementChild !== root) document.body.appendChild(root);
    });
    keepLast.observe(document.body, { childList: true });

    // Don't cover the password lock screen.
    const lock = document.getElementById('lockOverlay');
    if (lock) {
      const syncLock = () => {
        const locked = getComputedStyle(lock).display !== 'none';
        root.style.display = locked ? 'none' : 'block';
      };
      syncLock();
      new MutationObserver(syncLock).observe(lock, {
        attributes: true,
        attributeFilter: ['style', 'class']
      });
    }

    console.log(`✓ Disguise layer mounted (${currentShot ? currentShot.src : 'no screenshot'}, `
      + `${state.mode}, ${isMobile() ? 'mobile' : 'desktop'})`);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }
})();
// ===== END disguise.js =====

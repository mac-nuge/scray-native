// ===== disguise.js =====
// Cosmetic overlay for Scray Picker (web) and Scray Native (WKWebView).
// Purely visual — no app logic is touched.
//
//  1. Recolours the page via backdrop-filter, cycling Colour -> Greyscale ->
//     Invert -> Grey+Invert. backdrop-filter is used rather than an ancestor
//     `filter` so nothing becomes a containing block and position:fixed keeps
//     working throughout the app.
//  2. Lays one of N screenshots BEHIND the page, so dropping Page opacity
//     reveals it rather than washing the page out to white.
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

  // Mobile panel sits bottom-right. In portrait that corner is clear, but in
  // landscape the app moves #cornerButtons to bottom-right too, so the panel
  // lifts above that button row. Nudge these if either looks tight.
  const MOBILE_BOTTOM_OFFSET = '6px';
  // ⚙️ MPFS only: the player's own control row owns the bottom-right corner.
  // style.css anchors those controls at `bottom: 7vh`, so clearing them means
  // 7vh PLUS their height - a flat pixel offset lands inside the row on some
  // screens and above it on others. The 62px is the control row's height plus
  // a little air; that's the number to nudge if it's still tight.
  const MOBILE_BOTTOM_OFFSET_MPFS = 'calc(7vh + 62px)';
  // ⚙️ Air left between the top of the control row and the bottom of this
  // panel once the row can actually be measured. With the measurement in
  // place this is the only number worth nudging.
  const MPFS_CONTROLS_CLEARANCE_PX = 12;
  const MOBILE_BOTTOM_OFFSET_LANDSCAPE = '58px';

  // Native's WKWebView runs edge-to-edge with no browser chrome below it, so
  // the same offset lands lower on the glass and closer to the home-swipe
  // area. Extra lift added on top of the offsets above, Native only.
  const NATIVE_EXTRA_LIFT = '30px';

  // Mobile only: tapping anywhere off the panel collapses it.
  const CLOSE_ON_OUTSIDE_TAP = true;

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

  // Painted behind the screenshot, so a knocked-out screenshot has something
  // to sit on once the page above it goes transparent.
  // This sits BELOW the tint, so inverted modes invert it too: white here
  // shows as black on screen. Set the pre-tint value, not what you want to
  // see. Leaving it white is what makes inverted modes read as a dark page.
  const BACKDROP_COLOUR = '#ffffff';

  // Cycle order for the mode button. Six is a lot of taps — trim entries you
  // don't use. The "(player ok)" modes leave the player in true colour.
  const MODES = [
    'colour', 'grey', 'invert', 'invertsafe', 'greyinvert', 'greyinvertsafe'
  ];

  // Exempted from the tint in the "(player ok)" modes — video, controls,
  // poster, overlays. Extra selectors are safe: overlapping boxes are merged,
  // disjoint ones are not, so listing player chrome that sits outside the
  // container only makes the exemption more accurate.
  const PLAYER_EXEMPT_SELECTOR = [
    '#inlineVideoContainer',
    '#pipPlayerContainer',
    '.plyr',
    '.plyr--fullscreen',
    '.plyr__video-wrapper',
    '.plyr__controls'
  ].join(', ');

  // Body classes meaning "the player owns the whole screen" (FLS, forced
  // landscape). In these states the tint switches off completely rather than
  // trying to cut a box out of itself.
  const FULLSCREEN_BODY_CLASSES = [
    'fullscreen-active',
    'portrait-fullscreen',
    'manual-rotate-landscape'
  ];

  // 'clip'     — cut a hole in the tint over the player's box (default)
  // 'tint-off' — switch the tint off entirely whenever a player is on screen
  // Use 'tint-off' if clip-path turns out to be unreliable over
  // backdrop-filter in WKWebView; the page loses its tint while a video is up,
  // but the player is guaranteed true colour.
  const PLAYER_EXEMPT_STRATEGY = 'clip';

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
    invertsafe: 'invert(1)',
    greyinvert: 'grayscale(1) invert(1)',
    greyinvertsafe: 'grayscale(1) invert(1)'
  };
  const MODE_LABEL = {
    colour: 'Colour',
    grey: 'Greyscale',
    invert: 'Invert',
    invertsafe: 'Invert (player ok)',
    greyinvert: 'Grey + Invert',
    greyinvertsafe: 'Grey + Invert (player ok)'
  };
  const MODE_LABEL_SHORT = {
    colour: 'Colour',
    grey: 'Grey',
    invert: 'Invert',
    invertsafe: 'Inv +P',
    greyinvert: 'Gr+Inv',
    greyinvertsafe: 'GrInv +P'
  };
  // Shown on the collapsed mobile launch button — keep these to 3 characters.
  const MODE_LABEL_TINY = {
    colour: 'COL',
    grey: 'GRY',
    invert: 'INV',
    invertsafe: 'I+P',
    greyinvert: 'G+I',
    greyinvertsafe: 'G+P'
  };
  // Modes that cut the player out of the tint entirely.
  const MODE_EXEMPT_PLAYER = { invertsafe: true, greyinvertsafe: true };

  function isInverted(mode) {
    return (MODE_FILTER[mode] || '').indexOf('invert') !== -1;
  }

  /**
   * MPFS puts a full-width player control row across the bottom of the
   * screen, and a fixed bottom offset kept landing on the volume button.
   * The row's height AND its distance from the bottom are both set in vh by
   * the app's stylesheet - and two competing !important rules put it at
   * either 7vh or 20vh depending on which fullscreen class Plyr applied - so
   * no fixed pixel value clears it on every device. Measure the row instead
   * and sit above whatever it actually is. Every other mode clears the inline
   * value so the stylesheet keeps control there.
   */
  function positionAbovePlayerControls() {
    const el = document.getElementById('scrayDisguiseControl');
    if (!el) return;
    const body = document.body;
    const inMpfs = body.classList.contains('portrait-fullscreen')
      && !body.classList.contains('manual-rotate-landscape');
    if (!inMpfs || !isMobile()) { el.style.removeProperty('bottom'); return; }

    const controls = document.querySelector('.plyr__controls');
    const rect = controls && controls.getBoundingClientRect();
    if (!rect || !rect.height) { el.style.removeProperty('bottom'); return; }

    // rect.top is the top of the row; measuring from the viewport bottom
    // clears the whole row plus whatever gap it sits on.
    const clearRow = window.innerHeight - rect.top;
    el.style.setProperty('bottom', (clearRow + MPFS_CONTROLS_CLEARANCE_PX) + 'px', 'important');
  }

  function watchPlayerControls() {
    const run = () => positionAbovePlayerControls();
    window.addEventListener('resize', run);
    window.addEventListener('orientationchange', run);
    // Entering and leaving MPFS is a body class change, and Plyr rebuilds the
    // control row on every source change, so watch both.
    new MutationObserver(run).observe(document.body, {
      attributes: true, attributeFilter: ['class'],
    });
    run();
  }

  const mq = window.matchMedia(MOBILE_MEDIA);
  function isMobile() { return mq.matches; }

  // True only inside Scray Native's WKWebView. Checks for the app's own
  // message handler rather than window.webkit, which iOS Safari also has.
  const IS_NATIVE = !!(
    (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.scrayBridge)
    || window.ScrayBridge
  );

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
/* Negative z-index under <html> paints above the canvas background but below
   every in-flow descendant of <body> — i.e. behind the page. */
#scrayDisguiseBack {
  position: fixed; inset: 0;
  pointer-events: none;
  z-index: -1;
  background: ${BACKDROP_COLOUR};
}
#scrayDisguiseTint,
#scrayDisguiseShot {
  position: absolute; inset: 0;
  pointer-events: none;
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
#scrayDisguiseNav {
  display: flex; flex-wrap: wrap; gap: 4px;
  padding-bottom: 6px; margin-bottom: 2px;
  border-bottom: 1px solid #e0e0e0;
}
.scray-disguise-nav-link {
  flex: 1 1 auto; text-align: center;
  padding: 4px 6px; margin: 0;
  border: 1px solid #c9c9c9; border-radius: 6px;
  background: #f2f2f2; color: #6b6b6b;
  font: inherit; text-decoration: none; cursor: pointer;
}
.scray-disguise-nav-link.is-here {
  background: #6b6b6b; border-color: #6b6b6b; color: #ffffff; cursor: default;
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
#scrayDisguiseControl.is-collapsed #scrayDisguisePresets,
#scrayDisguiseControl.is-collapsed #scrayDisguiseAssignBtn {
  display: none;
}
#scrayDisguiseControl.is-collapsed {
  padding: 4px 6px;
  gap: 0;
}

/* ---- Compact layout for phones ---- */
@media ${MOBILE_MEDIA} {
  #scrayDisguiseControl {
    top: auto;
    bottom: calc(env(safe-area-inset-bottom, 0px) + ${MOBILE_BOTTOM_OFFSET});
    right: calc(env(safe-area-inset-right, 0px) + 6px);
    padding: 6px 8px;
    font-size: 11px;
    max-width: 46vw;
  }
  /* Bottom-anchored, so the handle belongs at the bottom edge and the panel
     grows upward from it. */
  #scrayDisguiseHandle { order: 2; }
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
  #scrayDisguiseModeBtn,
  #scrayDisguiseAssignBtn { padding: 6px; }
  #scrayDisguiseHandle {
    min-height: 24px;
    font-size: 13px;
  }
  #scrayDisguiseControl.is-collapsed #scrayDisguiseHandle {
    min-width: 30px;
    min-height: 26px;
  }
  #scrayDisguiseHandle.has-mode-tag {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.03em;
    color: #6b6b6b;
  }
  #scrayDisguise.is-native #scrayDisguiseControl {
    bottom: calc(env(safe-area-inset-bottom, 0px) + ${MOBILE_BOTTOM_OFFSET} + ${NATIVE_EXTRA_LIFT});
  }
  /* MPFS. Both variants are needed: the .is-native selector above carries two
     IDs, so a single body-scoped rule would lose to it on specificity. */
  body.portrait-fullscreen:not(.manual-rotate-landscape) #scrayDisguiseControl {
    bottom: calc(env(safe-area-inset-bottom, 0px) + ${MOBILE_BOTTOM_OFFSET_MPFS});
  }
  body.portrait-fullscreen:not(.manual-rotate-landscape) #scrayDisguise.is-native #scrayDisguiseControl {
    bottom: calc(env(safe-area-inset-bottom, 0px) + ${MOBILE_BOTTOM_OFFSET_MPFS} + ${NATIVE_EXTRA_LIFT});
  }
}

/* Landscape phone: the app right-anchors #cornerButtons at bottom: 10px, so
   clear that row rather than covering the burger buttons. */
@media (max-width: 1024px) and (orientation: landscape) {
  #scrayDisguiseControl {
    bottom: calc(env(safe-area-inset-bottom, 0px) + ${MOBILE_BOTTOM_OFFSET_LANDSCAPE});
  }
  #scrayDisguise.is-native #scrayDisguiseControl {
    bottom: calc(env(safe-area-inset-bottom, 0px) + ${MOBILE_BOTTOM_OFFSET_LANDSCAPE} + ${NATIVE_EXTRA_LIFT});
  }
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
    if (IS_NATIVE) root.classList.add('is-native');

    // Separate root so the screenshot can sit behind <body> while the tint and
    // controls stay above it. Both live under <html>, not <body>, so the page
    // opacity below doesn't fade the overlay along with the app.
    const backRoot = document.createElement('div');
    backRoot.id = 'scrayDisguiseBack';

    const tint = document.createElement('div');
    tint.id = 'scrayDisguiseTint';

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
    // ---- Player exemption -------------------------------------------------
    // Plyr's fullscreen here is the CSS fallback: position:fixed inset:0, still
    // inside <body>, so the player never escapes the tint the way real
    // top-layer fullscreen would. Counter-filtering only works for invert
    // (greyscale is lossy), so instead the tint is either clipped around the
    // player's box or switched off entirely.
    let holeRaf = null;
    let lastClip = '';
    let lastFilter = null;

    function playerOwnsScreen() {
      for (let i = 0; i < FULLSCREEN_BODY_CLASSES.length; i++) {
        if (document.body.classList.contains(FULLSCREEN_BODY_CLASSES[i])) return true;
      }
      return !!(document.fullscreenElement || document.webkitFullscreenElement);
    }

    // Largest visible player box, merged with any matching box that overlaps
    // it. Overlap is the test on purpose: it pulls in player chrome sitting
    // outside the container without merging two separate players.
    function playerRect() {
      const nodes = document.querySelectorAll(PLAYER_EXEMPT_SELECTOR);
      const boxes = [];
      let best = null;
      for (let i = 0; i < nodes.length; i++) {
        const r = nodes[i].getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        boxes.push(r);
        const area = r.width * r.height;
        if (!best || area > best.area) best = { r: r, area: area };
      }
      if (!best) return null;
      const u = { left: best.r.left, top: best.r.top, right: best.r.right, bottom: best.r.bottom };
      for (let i = 0; i < boxes.length; i++) {
        const b = boxes[i];
        const overlaps = b.left < u.right && b.right > u.left && b.top < u.bottom && b.bottom > u.top;
        if (!overlaps) continue;
        u.left = Math.min(u.left, b.left);
        u.top = Math.min(u.top, b.top);
        u.right = Math.max(u.right, b.right);
        u.bottom = Math.max(u.bottom, b.bottom);
      }
      return u;
    }

    function holeClip(r) {
      if (!r) return '';
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const x1 = Math.max(0, Math.round(r.left));
      const y1 = Math.max(0, Math.round(r.top));
      const x2 = Math.min(vw, Math.round(r.right));
      const y2 = Math.min(vh, Math.round(r.bottom));
      if (x2 <= x1 || y2 <= y1) return '';
      // evenodd: outer viewport ring, then the player box as a hole.
      return 'polygon(evenodd, '
        + `0px 0px, ${vw}px 0px, ${vw}px ${vh}px, 0px ${vh}px, 0px 0px, `
        + `${x1}px ${y1}px, ${x1}px ${y2}px, ${x2}px ${y2}px, ${x2}px ${y1}px, ${x1}px ${y1}px)`;
    }

    // Single place that decides what the tint is doing. Writes are skipped
    // when nothing changed, so this is cheap to call every frame.
    function applyTint() {
      const base = MODE_FILTER[state.mode] || '';
      const exempt = !!MODE_EXEMPT_PLAYER[state.mode];
      let filter = base;
      let clip = '';

      if (exempt) {
        const rect = playerRect();
        const whole = playerOwnsScreen();
        if (whole || (PLAYER_EXEMPT_STRATEGY === 'tint-off' && rect)) {
          filter = '';                       // player owns the screen: no tint
        } else if (rect) {
          clip = holeClip(rect);
          if (!clip) filter = '';            // box covers the viewport
        }
      }

      if (filter !== lastFilter) {
        lastFilter = filter;
        tint.style.backdropFilter = filter;
        tint.style.webkitBackdropFilter = filter;
        // The screenshot sits under the tint, so its counter-invert only
        // applies while the tint is actually inverting.
        shot.style.filter = (!MODE_AFFECTS_SCREENSHOT && filter.indexOf('invert') !== -1)
          ? 'invert(1)' : 'none';
      }
      if (clip !== lastClip) {
        lastClip = clip;
        tint.style.clipPath = clip;
        tint.style.webkitClipPath = clip;
      }
    }

    function trackHole() {
      applyTint();
      holeRaf = MODE_EXEMPT_PLAYER[state.mode] ? requestAnimationFrame(trackHole) : null;
    }

    function startHoleTracking() {
      if (holeRaf || !MODE_EXEMPT_PLAYER[state.mode]) return;
      holeRaf = requestAnimationFrame(trackHole);
    }

    // Diagnostic: run scrayDisguiseDebug() in the console while a video is up.
    window.scrayDisguiseDebug = function () {
      const nodes = document.querySelectorAll(PLAYER_EXEMPT_SELECTOR);
      const rows = [];
      for (let i = 0; i < nodes.length; i++) {
        const r = nodes[i].getBoundingClientRect();
        rows.push({
          el: nodes[i].id || ('.' + (nodes[i].className || '').toString().split(' ')[0]),
          left: Math.round(r.left), top: Math.round(r.top),
          w: Math.round(r.width), h: Math.round(r.height)
        });
      }
      console.table(rows);
      console.log({
        mode: state.mode,
        exemptMode: !!MODE_EXEMPT_PLAYER[state.mode],
        strategy: PLAYER_EXEMPT_STRATEGY,
        playerOwnsScreen: playerOwnsScreen(),
        bodyClasses: document.body.className,
        mergedRect: playerRect(),
        appliedFilter: tint.style.backdropFilter,
        appliedClip: tint.style.clipPath || '(none)',
        viewport: [window.innerWidth, window.innerHeight]
      });
    };

    function renderShot() { shot.style.opacity = String(state.shot / 100); }

    // Real opacity on <body>, so lowering it reveals the screenshot underneath.
    // Cleared entirely at 100 rather than set to 1, to avoid leaving the whole
    // page in its own compositing layer for nothing.
    function renderPage() {
      const v = state.page / 100;
      document.body.style.opacity = v >= 1 ? '' : String(v);
    }

    function renderMode() {
      lastFilter = null;      // force a write on mode change
      applyTint();
      startHoleTracking();
      modeBtn.classList.toggle('is-on', state.mode !== 'colour');
      modeBtn.textContent = isMobile() ? MODE_LABEL_SHORT[state.mode] : MODE_LABEL[state.mode];
      modeBtn.title = 'Colour mode — tap to cycle';
      renderOpen();   // the collapsed launch button carries the mode tag
    }
    function renderOpen() {
      control.classList.toggle('is-collapsed', !state.open);
      // Mobile anchors to the bottom and grows upward, so the caret has to
      // point the other way to still mean "this is where it will go".
      const upward = isMobile();
      // Collapsed on mobile the button is the only thing on screen, so it
      // carries the current mode rather than a caret.
      const showModeTag = isMobile() && !state.open;
      handle.textContent = showModeTag
        ? (MODE_LABEL_TINY[state.mode] || '')
        : (state.open ? (upward ? '▾' : '▴') : (upward ? '▴' : '▾'));
      handle.classList.toggle('has-mode-tag', showModeTag);
      handle.title = state.open
        ? 'Collapse'
        : 'Expand — ' + (MODE_LABEL[state.mode] || state.mode);
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
    // ⚙️ NAV — the colour panel doubles as this app's navigation. Add a line
    // to add a destination. The page you are already on renders as a plain
    // label rather than a link.
    const NAV_LINKS = [
      { href: 'index.html',     label: 'Native' },
      { href: 'bookmarks.html', label: 'Bookmarks' }
    ];

    const navWrap = document.createElement('div');
    navWrap.id = 'scrayDisguiseNav';
    const here = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
    NAV_LINKS.forEach(({ href, label }) => {
      const isHere = href.toLowerCase() === here;
      const el = document.createElement(isHere ? 'span' : 'a');
      el.className = 'scray-disguise-nav-link' + (isHere ? ' is-here' : '');
      el.textContent = label;
      if (!isHere) el.href = href;
      navWrap.appendChild(el);
    });
    bodyWrap.appendChild(navWrap);

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

    backRoot.appendChild(shot);
    root.appendChild(tint);
    root.appendChild(control);
    document.documentElement.appendChild(backRoot);
    document.documentElement.appendChild(root);

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
      renderOpen();
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

    // ---- Tap off the panel to collapse it (mobile) ----
    // Capture phase and read-only: never preventDefault, so the tap still
    // does whatever it was going to do in the app underneath.
    if (CLOSE_ON_OUTSIDE_TAP) {
      document.addEventListener('pointerdown', (e) => {
        if (!state.open || !isMobile()) return;
        if (e.target && control.contains(e.target)) return;
        state.open = false;
        capturing = false;
        renderOpen();
        renderChips();
        save();
      }, true);
    }

    // No keep-last observer any more: the overlay is a sibling of <body>
    // rather than a child, so nothing the app mounts can paint above it and
    // DOM order stops mattering.

    // Don't cover or fade the password lock screen.
    const lock = document.getElementById('lockOverlay');
    if (lock) {
      const syncLock = () => {
        const locked = getComputedStyle(lock).display !== 'none';
        root.style.display = locked ? 'none' : 'block';
        backRoot.style.display = locked ? 'none' : 'block';
        if (locked) document.body.style.opacity = '';
        else renderPage();
      };
      syncLock();
      new MutationObserver(syncLock).observe(lock, {
        attributes: true,
        attributeFilter: ['style', 'class']
      });
    }

    // Must come after the panel is in the DOM: the positioner looks the panel
    // up by id, so starting it any earlier makes its first run a no-op and
    // leaves a session that BOOTS in MPFS on the CSS fallback for ever.
    watchPlayerControls();

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

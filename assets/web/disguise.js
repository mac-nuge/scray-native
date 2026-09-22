// ===== disguise.js =====
// Cosmetic overlay for Scray Picker (web) and Scray Native (WKWebView).
//
// NAMING: the control panel this file builds (#scrayDisguiseControl - colour
// mode, Shot/Page sliders, nav links, preset slots, Assign, Jira Report) is
// referred to as the FLOATING MENU. The scrayDisguise* ids are historical and
// stay as they are; "Floating Menu" is the name to use in conversation.
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
// Both desktop and mobile show a collapsed handle in the corner that expands
// on click; desktop sits top-right, mobile bottom-right and grows upward.

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
  // ⚙️ MPFS BOTTOM STACK (13.124). Three rows, measured up from the screen edge,
  // rotated on Mac's instruction so the anchor row is under the thumb:
  //
  //   row 3   circle pause row   calc(6vh + 107px)   style.css
  //   row 2   player controls    calc(6vh + 39px)    player.js, written inline
  //   row 1   anchor dock        6vh                 disguise.js
  //   ----    progress rail      4vh                 player.js (unmoved)
  //
  // 6vh is where the player controls used to sit, so row 1 lands exactly where the
  // thumb already expects a control row. The offsets above it are row 1 plus the
  // measured heights (dock 30, controls 59) plus a 9px gap each, rather than the old
  // hand-picked numbers - which had the circles at 118 and the dock at 149 and
  // therefore OVERLAPPING BY 13px, live, before any of this. Change row 1 and the
  // two above it follow.
  // ⚙️ DORMANT since 13.134: the dock is not drawn in MPFS at all, so nothing
  // reads this. Kept at row 1 of the MPFS stack - where it was through 13.131 -
  // so that if the anchors are ever wanted back there they land on the documented
  // row rather than at whichever offset the last experiment left behind.
  const MOBILE_BOTTOM_OFFSET_MPFS = 'var(--mpfs-row-1, 6vh)';
  // ⚙️ Landscape phone. 10px, matching the `bottom: 10px !important` the app
  // pins #cornerButtons at in landscape, so the anchor buttons sit on the SAME
  // baseline as the burger buttons rather than floating above them. It was
  // 58px, which lifted them clear of that row - necessary when the row ran the
  // full width, pointless now the row reserves horizontal space for them
  // (13.123). Mac spotted it in a narrow landscape window: level on the phone,
  // 48px high in picker on the desktop.
  const MOBILE_BOTTOM_OFFSET_LANDSCAPE = '10px';

  // Native's WKWebView runs edge-to-edge with no browser chrome below it, so
  // the same offset lands lower on the glass and closer to the home-swipe
  // area. Extra lift added on top of the offsets above, Native only.
  const NATIVE_EXTRA_LIFT = '30px';

  // Mobile only: tapping anywhere off the panel collapses it.
  const CLOSE_ON_OUTSIDE_TAP = true;

  // In FLS and MPFS the anchor buttons sit over the video. They go this
  // transparent there, and fade out completely with the player's own controls.
  // ⚙️ 1 = fully opaque, 0 = invisible.
  const FS_ANCHOR_OPACITY = 0.45;

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

  // ---- MPFS: why there is no measuring here (13.121) --------------------
  // There used to be a positionAbovePlayerControls() that measured
  // .plyr__controls and wrote an inline `bottom` on the dock, so the panel
  // would auto-fit whatever height the control row happened to be.
  //
  // It is gone, because it is what made the anchor buttons walk up the screen
  // in MPFS. It re-ran on a MutationObserver watching BODY CLASS changes -
  // scray-paused, scray-scrubbing, scray-guides-awake, keyboard-active - all
  // of which fire while you swipe, and each run wrote a fresh number measured
  // against whatever the row was doing at that instant. 13.120 tried to make
  // the measurement honest by subtracting the row's animated translate; it did
  // not hold. Picker has never had this function and has never drifted, which
  // is the whole argument: the CSS offset below is a constant, a constant
  // cannot drift, and matching Picker is worth more than an auto-fit.
  //
  // If the panel sits too close to the control row on some device, nudge
  // MOBILE_BOTTOM_OFFSET_MPFS at the top of this file. That is the knob now.

  const mq = window.matchMedia(MOBILE_MEDIA);
  function isMobile() { return mq.matches; }

  // Picker running inside Native's own in-app browser. ScrayBrowser.swift
  // injects this at documentStart and nothing else does, so it is exact.
  const IN_APP_BROWSER = !!window.SCRAY_IN_APP_BROWSER;

  // True only in Scray Native's MAIN web view - the app itself.
  //
  // The scrayBridge message handler is NOT enough on its own (13.125).
  // ScrayBrowser.swift registers a handler under that very same name for the
  // pages it hosts, so Picker running inside Native's browser passed this test
  // too and was treated as the app: it kept the blue "open the browser" button
  // while already being in the browser, and it took NATIVE_EXTRA_LIFT, which
  // put the anchor buttons 30px above the corner row. Both of Mac's complaints,
  // one cause. The in-app browser is excluded explicitly rather than by
  // reaching for a different signal, because the handler genuinely is there -
  // it is the surface that differs, not the bridge.
  const IS_NATIVE = !IN_APP_BROWSER && !!(
    (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.scrayBridge)
    || window.ScrayBridge
    || window.SCRAY_NATIVE
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
  // Collapsed by default on every viewport. Desktop used to open expanded,
  // which parked a permanent white panel over the top-right corner. The
  // saved value still wins, so a deliberate expand sticks across reloads.
  if (state.open === null) state.open = false;
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
/* ⚙️ THE DOCK - the one positioned element (13.119).
   Everything that decides WHERE the anchor buttons sit lives on this rule and
   its overrides: desktop top-right, phone bottom-right, the Native lift, the
   landscape lift, and the MPFS lift that Native writes here as an inline
   style. The COL panel and the 🌐 button are laid out INSIDE it by flexbox, so
   their relationship to each other is never computed and can never drift.
   pointer-events stays none so the empty gap between them isn't a dead zone
   over the page; both children opt back in. */
#scrayDisguiseDock {
  position: absolute;
  top: calc(env(safe-area-inset-top, 0px) + 10px);
  right: calc(env(safe-area-inset-right, 0px) + 10px);
  /* ⚙️ SPANS THE WIDTH since the corner row moved in (13.121). The dock used to
     be shrink-to-fit, because it held two buttons. It now also holds the
     scrolling strip, which needs somewhere to scroll - so it is stretched to
     the opposite edge and the strip takes whatever the frozen buttons leave.
     Safe because the dock is pointer-events:none and only its children opt
     back in: the empty part of the row is not a dead zone over the page. */
  left: calc(env(safe-area-inset-left, 0px) + 10px);
  pointer-events: none;
  display: flex;
  flex-direction: row;
  align-items: flex-start;   /* desktop anchors by the TOP edge */
  gap: 6px;

  /* ⚙️ ONE BOX FOR EVERY BUTTON IN THE ROW (13.122), and it is the corner
     button's, because that is the one there are ten of: 32x27, padding 6px 8px,
     identical at every breakpoint. The anchor buttons used to carry their own
     sizes - 38px tall on a phone against the corner row's 27 - which was
     invisible while they were separate rows and obvious the moment they shared
     one. Change these two numbers, not the rules below.

     ⚙️ 30px, not the 27 a corner button measures on its own: X^T's superscript
     makes it 30, and a flex row stretches its siblings to match - so 30 is what
     the corner row has always actually been. The height is pinned here rather
     than left to whichever button happens to be tallest, so adding or removing
     X^T later cannot silently resize the whole row. */
  --scray-btn-h: 30px;
  --scray-btn-min-w: 32px;
}
#scrayDisguiseControl {
  position: relative;
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

/* 🌐 Browser button - a plain flex item in the dock, sitting left of the COL
   panel because it comes first in the DOM. Blue to match .burger-btn-blue;
   skinnier than it is tall because it sits in the corner-button row's lane.

   It is NOT inside #scrayDisguiseControl: on phones the control carries
   overflow-y:auto (so a tall expanded panel can scroll in landscape), and an
   overflow ancestor clips absolutely positioned descendants that sit outside
   its box - which is where this button would have to live. It was in the DOM
   and invisible on screen (13.114).

   It is not positioned by measuring the control's rect either (13.115). On iOS
   that drifts: getBoundingClientRect() reports VISUAL-viewport coordinates,
   while an absolutely positioned child of a fixed root is laid out against the
   LAYOUT viewport. The two diverge the moment Safari's toolbar collapses under
   a swipe, so each re-sync wrote a coordinate from one system into the other
   and the button crawled up the screen. Flexbox in the dock needs no
   coordinates at all, so there is nothing left to drift. */
#scrayDisguiseGlobe {
  flex: 0 0 auto;
  /* The corner button's box, from the dock's tokens (13.122). */
  width: auto;
  min-width: var(--scray-btn-min-w);
  height: var(--scray-btn-h);
  padding: 0 8px;
  /* style.css sets  button, select, input  to width:100%, padding:12px and
     margin-bottom:10px for everything under 1024px. The ID beats a bare
     element selector so width and padding were already safe, but margin was
     not: 10px of margin under a 38px button made its MARGIN box 48px, and
     align-items:flex-end aligns MARGIN boxes - so the button rendered 10px
     ABOVE the COL panel it is supposed to sit level with. The dock measured
     78x48 instead of 78x38, which is what gave it away (13.120). */
  margin: 0;
  border: none;
  border-radius: 4px;
  background: #1565c0;
  color: #ffffff;
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
  pointer-events: auto;
  -webkit-tap-highlight-color: transparent;
}
#scrayDisguiseGlobe:hover { background: #1976d2; }
/* ⚙️ Picker inside Native's in-app browser: the same button, opposite job -
   close the browser rather than open one. Red because it dismisses something
   (the same red the Exclude pill and the modals' Clear buttons use), and 📱
   because what matters is where you land, not that a thing is being closed. */
#scrayDisguiseGlobe.is-close { background: #d32f2f; }
#scrayDisguiseGlobe.is-close:hover { background: #e53935; }

/* ⚙️ ANCHOR ROW GUIDE (13.128). One orange rule through the middle of the anchor
   row, so the double-tap grid tells you where the buttons are as well as which
   zone you are in.

   It belongs to the DOUBLE-TAP GRID, not to the controls - up only while
   body.scray-guides-awake is set, exactly as .fls-tap-guides is, with the same
   asymmetric timing (instant up, 0.1s out). That class is on body and this
   overlay is a sibling of body, so syncStateClasses mirrors it onto the root as
   .is-guides-awake.

   ⚙️ ONE LINE, AND ONLY FOR THE ANCHOR ROW. 13.126 and 13.127 also bracketed the
   player controls, which meant tracking a row that FLS rotates 90deg into a
   column - two vertical lines there, two horizontal ones in MPFS, decided by
   measuring the rect. Mac dropped the controls guide, and with it all of that:
   the anchor row lives in this overlay rather than in the player, so it is never
   rotated and a horizontal rule is right in both modes. Nothing here needs to
   know which mode is running.

   It lives in the OVERLAY, not inside .fls-tap-guides with the rest of the grid.
   The guide container is bounded in MPFS (top:33.333%, bottom:152px) - it IS the
   gesture band - so a child of it cannot reach the anchor row below 152px. And
   it lives inside .plyr__video-wrapper, which the zoom gesture AND the FLS
   rotation both transform; a transformed ancestor becomes the containing block
   for position:fixed, so a fixed child there would rotate along with it. */
#scrayMpfsRowGuides {
  position: fixed;
  inset: 0;
  pointer-events: none;
  display: none;
  z-index: 1;
}
/* Both fullscreen modes. is-fs is FLS or MPFS; MPB gets no grid, so no guide. */
#scrayDisguise.is-fs #scrayMpfsRowGuides {
  display: block;
  opacity: 0;
  transition: opacity 0.1s ease;
}
/* ⚙️ The tap grid's own visibility contract, copied rather than approximated:
   see the .fls-tap-guides pair in style.css - change one, change the other. */
#scrayDisguise.is-fs.is-guides-awake #scrayMpfsRowGuides {
  opacity: 1;
  transition: none;
}

.scray-row-line {
  position: absolute;
  left: 0;
  right: 0;
  height: 2px;
  /* Hidden until placeRowGuides() has a real row to centre on, so the line never
     sits at an arbitrary place claiming the buttons are there. */
  display: none;
  /* ⚙️ Orange at 70% transparent, per Mac. 2px rather than the tap grid's 1px:
     at alpha 0.3 over moving picture a hairline is not reliably visible. */
  background: rgba(255, 140, 0, 0.3);
}

/* ⚙️ VID / BM - the index page's view switch (scray-views.js, 13.120). First in
   the dock's DOM order, so it sits left of 🌐 and the COL panel; same box as the
   globe so the three read as one row.

   It is drawn HIDDEN and stays that way unless scray-views.js reveals it, which
   only the index does - the dock is on every page, and a switch on a page with
   no list to switch would do nothing.

   Green in Videos view because it offers bookmarks; BM purple - the colour the
   note cells and note pills already use - once bookmarks are what you are
   looking at, so the view you are in is readable from the button alone. */
#scrayDisguiseView {
  flex: 0 0 auto;
  /* The corner button's box, from the dock's tokens (13.122). */
  width: auto;
  min-width: var(--scray-btn-min-w);
  height: var(--scray-btn-h);
  padding: 0 8px;
  /* Same margin note as the globe above: style.css's bare-element rule puts
     10px under every button below 1024px, and the dock aligns MARGIN boxes. */
  margin: 0;
  border: none;
  border-radius: 4px;
  background: #2e7d32;
  color: #ffffff;
  font-size: 11px;
  font-weight: bold;
  line-height: 1;
  cursor: pointer;
  pointer-events: auto;
  -webkit-tap-highlight-color: transparent;
}
#scrayDisguiseView:hover { background: #388e3c; }
/* ⚙️ No view switch in fullscreen (13.129). Videos/Bookmarks changes what the
   LIST underneath shows, which you cannot see while a video is over it - and the
   frozen group is tighter in fullscreen. A CSS rule rather than the hidden
   property, deliberately: scray-views.js owns that property and re-asserts it on
   every toggle, so the two would fight. */
#scrayDisguise.is-fs:not(.is-peek) #scrayDisguiseView { display: none; }

/* ⚙️ 13.132: the consolidated X is gone. X^n, Xb and X^T are ordinary buttons
   in the row again, after H - one tap each, no stack to open, and nothing
   sitting above the row to keep track of. The stack's rules went with it.

   ⚙️ AND THE ROW ITSELF IS GONE IN FULLSCREEN. FLS and MPFS show only the
   frozen three - 🔍, 🌐 and COL. Everything the scrolling row carried is
   reachable from the circles, which 13.132 put back, and a row of buttons over
   the picture was the thing they duplicated. Hidden rather than emptied: the
   strip keeps its scroll position and its buttons keep their handlers, so
   leaving fullscreen brings the row back exactly as it was. */
/* ⚙️ NO DOCK IN FULLSCREEN AT ALL (13.134). 13.132 cut the row down to the
   frozen three and 13.133 moved those out of the way; Mac's answer is that they
   are not wanted over the picture at all. Everything they did is reachable from
   the circles, and the one thing that was not - the filter - is reachable by
   peeking.

   ⚙️ EXCEPT WHILE PEEKING. An up-swipe in FLS slides the rotated player aside
   and body.fls-peek gives the page back - that is what the :not(.fls-peek) on
   every page-element hide in style.css is for. In that state the page is
   ordinary, so the dock is ordinary too: the whole row, in its normal place, at
   full opacity, with the same buttons it shows when nothing is playing. It costs
   one relayed class rather than a second layout.

   Hiding the dock also retires the orange row guide on its own: placeRowGuides
   drops a line whose target has no box, and a display:none dock has none. */
#scrayDisguise.is-fs:not(.is-peek) #scrayDisguiseDock { display: none; }
#scrayDisguise.is-fs:not(.is-peek) #scrayDisguiseStrip { display: none; }

/* ⚙️ COL IS BACK IN FLS (picker 15.7 / native 15.5). 13.134 took the whole dock
   out of fullscreen; Mac wants COL back in FLS - FLS only, MPFS keeps no dock.
   The dock is drawn again where it always sits (bottom-right on a phone, the
   screen's own corner, not rotated with the player), with every child except
   COL hidden, so COL is alone in its usual spot.
   Visible in line with the player controls: full opacity while they are up
   (instead of FS_ANCHOR_OPACITY), and the existing is-controls-hidden pair
   below still takes it to 0 - with the tap-to-wake catcher - when they idle. */
/* The strip is what normally fills the row and pushes the frozen group to the
   right; with it hidden COL fell to flex-start - the left (picker 15.8 /
   native 15.6). flex-end puts it back at the right edge, exactly where it sits
   outside FLS. */
#scrayDisguise.is-fs:not(.is-mpfs):not(.is-peek) #scrayDisguiseDock { display: flex; justify-content: flex-end; }
#scrayDisguise.is-fs:not(.is-mpfs):not(.is-peek) #scrayDisguiseDock > :not(#scrayDisguiseControl) { display: none !important; }

/* ⚙️ THE FUSED ROW (13.121). #cornerButtons' inner .corner-btn-row is MOVED
   into the dock at build time and renamed #scrayDisguiseStrip; the shell it
   came from is hidden. So the two rows that used to sit beside each other,
   with a hand-maintained 92px reserve between them, are now one flex row:

     [ ---- strip, scrolls ---- ][ 🔍 ][ VID/BM ][ 🌐 ][ COL ]
                                 \_________ frozen __________/

   The freeze needs no code. The four on the right are ordinary flex items at
   their natural width; the strip is the only one that flexes, so it takes what
   is left and scrolls its overflow. Buttons that do not fit pass under the
   frozen group's shadow, which is what the shadow is for.

   min-width: 0 is load-bearing - a flex item will not shrink below its content
   width without it, so the strip would push the frozen four off the screen
   instead of scrolling.

   The old row's rules stop applying the moment it leaves #cornerButtons (they
   are all descendant selectors), so the scroll behaviour and the button metrics
   are restated here rather than inherited. That is the point: the fused row's
   appearance is now described in one place instead of eight. */
#scrayDisguiseStrip {
  flex: 1 1 auto;
  min-width: 0;
  /* ⚙️ One button and one gap of clear space before the row starts, so the
     first button sits where the second one used to (13.122). Padding rather
     than margin, deliberately: it belongs to the scrolling content, so the
     buttons pass through it as you scroll instead of stopping at a hard edge,
     and the strip keeps its full width for measuring. */
  padding-left: calc(var(--scray-btn-min-w) + 6px);
  display: flex;
  flex-wrap: nowrap;
  justify-content: flex-start;
  gap: 6px;
  /* center, not the default stretch: with every button pinned to the token
     height nothing should be stretched to match a taller sibling. */
  align-items: center;
  overflow-x: auto;
  overflow-y: hidden;
  white-space: nowrap;
  -webkit-overflow-scrolling: touch;
  touch-action: pan-x;
  scrollbar-width: none;
  -ms-overflow-style: none;
  pointer-events: auto;
}
#scrayDisguiseStrip::-webkit-scrollbar { display: none; }

/* Both the scrolling buttons and the frozen 🔍. One id + one class, so this
   beats style.css's bare button rule (width:100%, padding:12px, margin) the
   same way #cornerButtons .burger-btn used to. */
#scrayDisguiseStrip .burger-btn,
#scrayDisguiseDock > .burger-btn {
  flex: 0 0 auto;
  box-sizing: border-box;
  width: auto;
  min-width: var(--scray-btn-min-w);
  height: var(--scray-btn-h);
  margin: 0;
  padding: 0 8px;
  align-items: center;
  justify-content: center;
  pointer-events: auto;
}

/* ⚙️ The freeze line. A shadow cast leftward by the first frozen button, so the
   strip reads as passing UNDERNEATH the group rather than stopping dead at an
   arbitrary edge - which is the only thing that tells you there is more row to
   scroll to. */
#scrayDisguiseDock > #jumpSearchBtn {
  box-shadow: -7px 0 7px -4px rgba(0, 0, 0, 0.4);
}

/* ⚙️ FULLSCREEN: transparent, and fades with the player controls (13.122).
   In FLS and MPFS these sit on top of the picture, so they drop to
   FS_ANCHOR_OPACITY and then go entirely when Plyr idles its controls away -
   the same .plyr--hide-controls signal .fls-video-title already keys off,
   relayed onto this root by syncStateClasses because the overlay lives
   outside <body> and cannot see that class itself.
   The :has() guard keeps an OPEN panel on screen: the controls idle out after
   three seconds, and a menu vanishing mid-tap is not a fade, it is a bug.
   pointer-events goes on the children, not the dock - the dock is already
   pointer-events:none and its children opt back in, so clearing it here would
   do nothing. */
#scrayDisguise.is-fs:not(.is-peek) #scrayDisguiseDock {
  opacity: ${FS_ANCHOR_OPACITY};
  transition: opacity 0.3s ease;
}
/* FLS: COL alone, at full strength while the controls are up (see COL IS BACK). */
#scrayDisguise.is-fs:not(.is-mpfs):not(.is-peek):not(.is-controls-hidden) #scrayDisguiseDock {
  opacity: 1;
}
/* ⚙️ THE BLIND STATE (13.123). Invisible, and it must behave invisible: an
   button you cannot see must not be pressable, and tapping where it lives has
   to bring it back rather than doing nothing. Same contract .fls-video-title
   already has.

   The dock itself becomes the catcher - pointer-events goes to auto, the one
   place in this file where it does - and EVERY descendant goes dead. The
   descendant rule has to be there: #scrayDisguiseStrip .burger-btn and
   #scrayDisguiseDock > .burger-btn both set pointer-events:auto, and turning it
   off on the strip alone left every corner button inside it perfectly tappable
   while invisible (13.121's regression, and exactly what Mac hit). It out-
   specifies both, so no !important is needed.

   The dock's pointerdown handler reads this same state and raises the controls
   instead of letting the tap land, so one tap wakes the row and a second tap
   presses the button - never the blind press. */
/* ⚙️ :not(.is-peek) here too (13.136). The video keeps playing behind a peek, so
   Plyr still idles its controls away and is-controls-hidden still goes true -
   which faded the dock to nothing while the page was supposed to be back. 13.134
   put the exclusion on the FS_ANCHOR_OPACITY rule and missed this pair, which is
   the one that actually hides it. */
#scrayDisguise.is-fs.is-controls-hidden:not(.is-peek) #scrayDisguiseDock:has(#scrayDisguiseControl.is-collapsed) {
  opacity: 0;
  pointer-events: auto;
}
#scrayDisguise.is-fs.is-controls-hidden:not(.is-peek) #scrayDisguiseDock:has(#scrayDisguiseControl.is-collapsed) * {
  pointer-events: none;
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

/* Jira Report - same shape as the Assign button, deliberately not sharing its
   rule so the .is-on inversion never applies to it. */
#scrayDisguiseBugBtn {
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

/* ---- Collapsed: handle plus any assigned presets, nothing else ---- */
#scrayDisguiseControl.is-collapsed #scrayDisguiseBody,
#scrayDisguiseControl.is-collapsed #scrayDisguisePresets,
#scrayDisguiseControl.is-collapsed #scrayDisguiseAssignBtn,
#scrayDisguiseControl.is-collapsed #scrayDisguiseBugBtn {
  display: none;
}
/* ⚙️ Collapsed, COL is not a panel - it is a button among buttons, so it is
   drawn as one (13.123): .burger-btn's box AND its skin, which is dark grey,
   4px corners, white type and no border or shadow. It used to be a white 10px
   pill with a grey hairline - the card look of the menu it becomes - which read
   as a stray UI element sitting in the row rather than the last button in it.

   Strictly .is-collapsed. EXPANDED it is a menu again and keeps the white card,
   which is what makes it readable over a video. */
/* ⚙️ OPEN, THE PANEL LEAVES THE ROW (13.135). The dock is a flex row, and since
   13.121 the scrolling strip is in it at flex:1 1 auto - so an expanded COL was
   a flex item competing with the strip for width and lost most of it. Measured
   at 402px: it asked for its 62vw (249px) and got 107.

   Taking it out of flow when open gives it its own size back and puts it where
   Mac wants it - above the buttons rather than inside them. Anchored to the
   dock's own bottom-right, so the handle stays exactly where the COL button was
   and the panel simply grows upward out of it; nothing in the row moves.

   The dock is position:absolute and has no overflow, so it is both the
   containing block and not a clip. Desktop anchors by the top instead, in the
   media query below, because the dock is up there and a panel growing upward
   would leave the screen. */
#scrayDisguiseControl:not(.is-collapsed) {
  position: absolute;
  right: 0;
  top: 0;
  z-index: 4;
}
/* ⚙️ And the row keeps the space it left behind - see renderOpen(), which
   measures the collapsed button and writes the reservation as the dock's
   padding-right. Out of flow, COL stops being a flex item, so without it the
   strip grows into the slot and 🔍, VID and 🌐 all slide right, then slide back
   when the panel closes: a jiggle on every open.
   Measured rather than expressed in tokens because the collapsed width is not
   the token - min-width is a floor, and the mode tag's text decides the rest, so
   it differs by breakpoint. A calc of --scray-btn-min-w was 4px out on desktop. */

#scrayDisguiseControl.is-collapsed {
  gap: 0;
  /* Pinned with border-box so the border cannot push COL a pixel taller than
     the buttons beside it, which is exactly what it did at first. */
  box-sizing: border-box;
  height: var(--scray-btn-h);
  min-width: var(--scray-btn-min-w);
  padding: 0 8px;
  border-radius: 4px;
  background: #333;
  border: none;
  box-shadow: none;
  color: #ffffff;
}
/* The mode tag is the button's label now, so it takes the button's colour.
   Restated for both the plain and the has-mode-tag handle: the tag rule carries
   its own grey and would otherwise keep winning. */
#scrayDisguiseControl.is-collapsed #scrayDisguiseHandle,
#scrayDisguiseControl.is-collapsed #scrayDisguiseHandle.has-mode-tag {
  color: #ffffff;
}
/* Collapsed, the handle IS the panel, so it needs a real target and room for
   the three-character mode tag. The mobile block below restates both at thumb
   size; same specificity, later in the sheet, so it still wins on phones. */
#scrayDisguiseControl.is-collapsed #scrayDisguiseHandle {
  /* The control carries the min-width now, so the handle just fills it. */
  min-width: 0;
  width: 100%;
  min-height: var(--scray-btn-h);
}
#scrayDisguiseHandle.has-mode-tag {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.03em;
  color: #6b6b6b;
}

/* ---- Compact layout for phones ---- */
@media ${MOBILE_MEDIA} {
  #scrayDisguiseDock {
    top: auto;
    bottom: calc(env(safe-area-inset-bottom, 0px) + ${MOBILE_BOTTOM_OFFSET});
    right: calc(env(safe-area-inset-right, 0px) + 6px);
    /* Matches the right offset, so the strip's gutters are even. */
    left: calc(env(safe-area-inset-left, 0px) + 6px);
    align-items: flex-end;   /* phones anchor by the BOTTOM edge */
  }
  /* Phones anchor the dock by its BOTTOM, so the open panel grows upward from
     where the button was rather than downward off the screen. */
  #scrayDisguiseControl:not(.is-collapsed) {
    top: auto;
    bottom: 0;
  }
  #scrayDisguiseControl {
    padding: 6px 8px;
    font-size: 11px;
    /* Widened from 46vw: the menu now carries an extra full-width button and
       46vw wrapped "Jira Report" onto two lines in portrait. */
    max-width: 62vw;
    /* Landscape on a phone leaves ~390px of height, and the menu is anchored
       to the BOTTOM and grows upward - so once the content is taller than the
       screen the top silently runs off it. Capping the height and scrolling
       means nothing can be clipped out of reach, however many rows get added
       later. dvh second so it wins where supported and vh covers the rest. */
    max-height: calc(100vh - env(safe-area-inset-bottom, 0px) - 20px);
    max-height: calc(100dvh - env(safe-area-inset-bottom, 0px) - 20px);
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
  }
  /* Bottom-anchored, so the handle belongs at the bottom edge and the panel
     grows upward from it. */
  #scrayDisguiseHandle { order: 2; }
  /* Phone: bigger tap target. Which EDGE it lines up with is the dock's
     align-items, so the button follows the panel without knowing which. */
  /* Only the type gets bigger on a phone now: the box is the corner button's
     at every breakpoint, and the corner button never changed size either. */
  #scrayDisguiseGlobe { font-size: 16px; }
  #scrayDisguiseView  { font-size: 12px; }
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
  #scrayDisguiseAssignBtn,
  #scrayDisguiseBugBtn { padding: 6px; }
  #scrayDisguiseHandle {
    min-height: 24px;
    font-size: 13px;
  }
  #scrayDisguiseControl.is-collapsed #scrayDisguiseHandle {
    min-width: 0;
    min-height: var(--scray-btn-h);
  }
  #scrayDisguiseHandle.has-mode-tag {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.03em;
    color: #6b6b6b;
  }
  #scrayDisguise.is-native #scrayDisguiseDock {
    bottom: calc(env(safe-area-inset-bottom, 0px) + ${MOBILE_BOTTOM_OFFSET} + ${NATIVE_EXTRA_LIFT});
  }
  /* MPFS (13.121). Keyed off .is-mpfs on the OVERLAY ROOT, not off body.
     These used to read  body.portrait-fullscreen:not(.manual-rotate-landscape)
     #scrayDisguiseDock  - a DESCENDANT-OF-BODY selector - and this
     overlay is appended to documentElement, a SIBLING of body. So it matched
     nothing, in either app, for as long as it has existed. Native did not
     notice because positionAbovePlayerControls was writing an inline bottom
     over the top of it; deleting that function is what exposed it.
     syncStateClasses() mirrors the body class onto the root, so the selector
     has something to bite on. Both variants are needed: the .is-native rule
     above carries the same weight, so the plain one would lose to it. */
  /* ⚙️ Row 1, and deliberately WITHOUT the safe-area term the other states
     carry: this row has to land exactly where the player controls used to,
     and those are anchored at a plain 6vh with no inset of their own. Adding
     one here would float the dock above the row it is replacing.
     Native takes no extra lift for the same reason - the controls did not -
     so the .is-native rule restates the same value purely to out-weigh the
     .is-native portrait rule above, which carries two IDs and would otherwise
     keep winning inside this block. Same trick, and same reason, as landscape. */
  #scrayDisguise.is-mpfs #scrayDisguiseDock,
  #scrayDisguise.is-mpfs.is-native #scrayDisguiseDock {
    bottom: ${MOBILE_BOTTOM_OFFSET_MPFS};
  }
}

/* Landscape phone: the app right-anchors #cornerButtons at bottom: 10px, so
   clear that row rather than covering the burger buttons. */
@media (max-width: 1024px) and (orientation: landscape) {
  #scrayDisguiseDock {
    bottom: calc(env(safe-area-inset-bottom, 0px) + ${MOBILE_BOTTOM_OFFSET_LANDSCAPE});
  }
  /* Native takes NO extra lift in landscape. The rule is here purely to beat
     the .is-native portrait rule above, which carries two IDs and would
     otherwise keep winning inside this media query and put Native's buttons
     36px up while Picker's sat at 10px. Same value on purpose. */
  #scrayDisguise.is-native #scrayDisguiseDock {
    bottom: calc(env(safe-area-inset-bottom, 0px) + ${MOBILE_BOTTOM_OFFSET_LANDSCAPE});
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

    // ---- 🌐 Browser button ------------------------------------------------
    // Always on top, pinned immediately LEFT of the COL panel, and deliberately
    // NOT inside #scrayDisguiseBody - it has to survive the panel collapsing,
    // which is the state it spends most of its life in. Absolute against the
    // control, so it tracks every one of the control's anchoring rules (top on
    // desktop, bottom on phones, the MPFS lift) without restating any of them.
    //
    // In Native this is the corner "P" that used to sit in #cornerButtons: the
    // bridge resumes the in-app browser wherever it was left. On the web there
    // is no bridge, so it opens the browse console in a new tab.
    // ---- The browser button, which is two different buttons (13.124) ------
    // Native's job is to SUMMON the browser: blue 🌐, resumes the in-app
    // browser wherever it was left.
    // Picker's job is the opposite. Picker only ever runs inside that browser
    // or in a desktop/Safari tab - so "open the browser" is either redundant
    // (you are in it) or meaningless (there isn't one). Inside the in-app
    // browser it becomes a red 📱: dismiss the browser, back to Native.
    // Anywhere else in Picker there is nothing for it to do, so it is not
    // drawn at all and COL sits on its own.
    //
    // window.SCRAY_IN_APP_BROWSER is injected at documentStart by
    // ScrayBrowser.swift, and ONLY there, so it is an exact test for "this
    // Picker is running inside Native's browser".
    const inAppBrowser = IN_APP_BROWSER;
    const wantsGlobe = IS_NATIVE || inAppBrowser;

    // ---- VID / BM, the index page's view switch (13.120) -----------------
    // Built here because the dock is the one thing already anchored correctly
    // on every screen and in every fullscreen state - a switch pinned anywhere
    // else would have to restate all of that.
    //
    // Deliberately dumb: it is drawn hidden with no label, and calls whatever
    // window.scrayToggleView is AT CLICK TIME. scray-views.js reveals it, names
    // it and colours it, so this file needs to know nothing about views, and a
    // page without that script (a bookmarks page still in place, browse) simply
    // never shows a button.
    const viewBtn = document.createElement('button');
    viewBtn.id = 'scrayDisguiseView';
    viewBtn.type = 'button';
    viewBtn.hidden = true;
    viewBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (typeof window.scrayToggleView === 'function') window.scrayToggleView();
    });

    const globeBtn = document.createElement('button');
    globeBtn.id = 'scrayDisguiseGlobe';
    globeBtn.type = 'button';
    if (IS_NATIVE) {
      globeBtn.textContent = '\uD83C\uDF10';          // 🌐
      globeBtn.title = 'Open the browser';
    } else {
      globeBtn.classList.add('is-close');
      globeBtn.textContent = '\uD83D\uDCF1';          // 📱
      globeBtn.title = 'Close the browser - back to Scray Native';
    }
    globeBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();

      // Picker inside the in-app browser: hop to scraynative://close.
      // ScrayBrowser.swift cancels any scraynative:// navigation, and every
      // host except "newtab" falls through to `dismiss(animated: true)`,
      // playing a video afterwards only when a ?key= came with it. No key, no
      // playback - just the dismissal. That path already ships in the
      // installed IPA, so this needs no Swift change and no rebuild.
      if (!IS_NATIVE) {
        if (inAppBrowser) window.location.href = 'scraynative://close';
        return;
      }

      if (typeof window.scrayOpenBrowser === 'function') { window.scrayOpenBrowser(); return; }
      if (window.ScrayBridge && window.ScrayBridge.openBrowser) {
        window.ScrayBridge.openBrowser()
          .catch(err => console.error('[browser] openBrowser failed:', err));
        return;
      }
      const url = (window.SCRAY_SYNC && window.SCRAY_SYNC.BROWSE_URL) || 'browse.html';
      window.open(url, '_blank');
    });


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

    // ✅ PERFORMANCE (native 13.182): the "+P" modes used to run this every
    // frame for the whole session - a querySelectorAll over six selectors
    // and a getBoundingClientRect on each match, 60 times a second, playing
    // or not, forcing a layout per frame in the middle of every gesture. The
    // player only moves when something happens, so tracking now runs in short
    // bursts after the things that can move it (touches, scrolls, resizes,
    // transitions, player/body class changes), plus one quiet check a second
    // as a safety net. The hole follows exactly as before while anything is
    // moving; it just stops measuring when nothing is.
    const HOLE_BURST_MS = 900;      // ⚙️ keep tracking this long after a wake
    const HOLE_IDLE_CHECK_MS = 1000; // ⚙️ safety-net check while idle
    let holeUntil = 0;

    function trackHole() {
      applyTint();
      holeRaf = (MODE_EXEMPT_PLAYER[state.mode] && !document.hidden
                 && performance.now() < holeUntil)
        ? requestAnimationFrame(trackHole) : null;
    }

    function startHoleTracking(ms) {
      if (!MODE_EXEMPT_PLAYER[state.mode]) return;
      holeUntil = Math.max(holeUntil, performance.now() + (ms || HOLE_BURST_MS));
      if (!holeRaf) holeRaf = requestAnimationFrame(trackHole);
    }

    const wakeHole = () => { if (MODE_EXEMPT_PLAYER[state.mode]) startHoleTracking(); };
    ['touchstart', 'touchmove', 'touchend', 'scroll', 'transitionend', 'animationend']
      .forEach(t => document.addEventListener(t, wakeHole, { capture: true, passive: true }));
    window.addEventListener('resize', wakeHole, { passive: true });
    if (window.visualViewport) window.visualViewport.addEventListener('resize', wakeHole, { passive: true });
    document.addEventListener('play', wakeHole, true);
    document.addEventListener('loadedmetadata', wakeHole, true);
    setInterval(() => {
      if (!holeRaf && MODE_EXEMPT_PLAYER[state.mode] && !document.hidden) applyTint();
    }, HOLE_IDLE_CHECK_MS);

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
      // ⚙️ Reserve the collapsed button's slot BEFORE it leaves the flow, while
      // it is still the size we need to stand in for.
      if (state.open && !control.style.getPropertyValue('--scray-col-reserve')) {
        const w = Math.round(control.getBoundingClientRect().width);
        if (w > 0) dock.style.paddingRight = (w + 6) + 'px';
        control.style.setProperty('--scray-col-reserve', '1');
      } else if (!state.open) {
        dock.style.paddingRight = '';
        control.style.removeProperty('--scray-col-reserve');
      }
      control.classList.toggle('is-collapsed', !state.open);
      // Mobile anchors to the bottom and grows upward, so the caret has to
      // point the other way to still mean "this is where it will go".
      const upward = isMobile();
      // Collapsed, the handle is the only thing on screen, so it carries the
      // current mode rather than a caret. Desktop included now that it starts
      // collapsed: a bare caret says nothing about what the tint is doing.
      const showModeTag = !state.open;
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
    //
    // NAMING: "index" is the main page - the list + player screen - as opposed
    // to Bookmarks and whatever pages come later. It was labelled "Native",
    // which named the APP rather than the page and left the app's own main
    // screen with no name of its own.
    //
    // An entry with `open` instead of `href` runs that function rather than
    // navigating: Picker lives on the web, and pointing the WKWebView at it
    // would replace the app with it. Sending it to the in-app browser leaves
    // the app running underneath, which is what the corner "P" always did.
    const NAV_LINKS = [
      { href: 'index.html',     label: 'Index' },
      { label: 'Picker', open: () => {
          const url = (typeof window.scrayPickerUrl === 'function')
            ? window.scrayPickerUrl() : null;
          if (!url) return;
          if (window.ScrayBridge && window.ScrayBridge.openBrowser) {
            window.ScrayBridge.openBrowser(url)
              .catch(err => console.error('[nav] openBrowser failed:', err));
          } else {
            window.open(url, '_blank');
          }
        } },
      { href: 'bookmarks.html', label: 'Bookmarks' }
    ];

    const navWrap = document.createElement('div');
    navWrap.id = 'scrayDisguiseNav';
    const here = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
    NAV_LINKS.forEach(({ href, label, open }) => {
      const isHere = !!href && href.toLowerCase() === here;
      const el = document.createElement(isHere ? 'span' : 'a');
      el.className = 'scray-disguise-nav-link' + (isHere ? ' is-here' : '');
      el.textContent = label;
      if (isHere) {
        // nothing to wire - you are already on it
      } else if (open) {
        el.href = '#';
        el.addEventListener('click', (ev) => { ev.preventDefault(); open(); });
      } else {
        el.href = href;
      }
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

    // ---- Jira Report ----
    // Guarded on scrayReportBug rather than assumed: a page that loads
    // disguise.js without scray-bugreport.js gets no button at all, which is
    // better than a button that silently does nothing.
    if (typeof window.scrayReportBug === 'function') {
      const bugBtn = document.createElement('button');
      bugBtn.id = 'scrayDisguiseBugBtn';
      bugBtn.type = 'button';
      bugBtn.textContent = 'Jira Report';
      bugBtn.title = 'File a bug or task on the SO board';
      bugBtn.addEventListener('click', () => window.scrayReportBug());
      control.appendChild(bugBtn);
    }

    backRoot.appendChild(shot);
    root.appendChild(tint);

    // ---- Anchor row guide (13.128) ---------------------------------------
    // One line, appended before the dock so it paints under the buttons rather
    // than across them.
    const rowGuides = document.createElement('div');
    rowGuides.id = 'scrayMpfsRowGuides';
    const anchorLine = document.createElement('div');
    anchorLine.className = 'scray-row-line is-anchors';
    rowGuides.appendChild(anchorLine);
    root.appendChild(rowGuides);

    /**
     * Centre the line on the anchor row.
     *
     * ⚙️ Both rects come from the SAME batch and the offset is expressed against
     * the guide container's own rect - the element the line sits inside. That is
     * what keeps this out of 13.119's trap: the bug there was writing a
     * coordinate measured in the VISUAL viewport onto an element laid out
     * against the LAYOUT viewport, two systems that diverge the moment Safari's
     * toolbar collapses. Container-relative arithmetic has no second system in
     * it, so there is nothing to diverge.
     *
     * Runs on the discrete moment the guide wakes, and on resize - never in a
     * loop and never mid-animation, which is the other half of what drifted.
     * Only opacity animates on the row; its position is CSS-anchored.
     */
    function placeRowGuides() {
      const r = dock && dock.getBoundingClientRect();
      if (!r || !r.height) { anchorLine.style.display = 'none'; return; }
      const box = rowGuides.getBoundingClientRect();
      anchorLine.style.display = 'block';
      // Less half the line's own 2px, so the line is centred rather than
      // starting at the centre.
      anchorLine.style.top = Math.round(r.top + r.height / 2 - box.top - 1) + 'px';
    }
    window.addEventListener('resize', placeRowGuides);
    window.addEventListener('orientationchange', placeRowGuides);

    // ---- Edge swipes open the panels (13.132) ----------------------------
    // Swipe in from the left edge for history, from the right edge for the
    // basket - the same two panels H() and B() open, without reaching for the
    // row. NOTHING PLAYING ONLY: in FLS and MPFS the horizontal edges are the
    // player's own seek and zoom territory, and this must not sit on top of it.
    //
    // ⚙️ The gesture is deliberately narrow. It has to start within EDGE px of
    // the screen edge, travel inward at least SWIPE px, stay more horizontal
    // than vertical, and be a single finger - so a diagonal thumb on a
    // vertically scrolling list never trips it. Read-only: it never calls
    // preventDefault, so a swipe it decides against still does whatever the
    // page was going to do with it.
    const EDGE = 24;      // ⚙️ how close to the edge a swipe has to start
    const SWIPE = 55;     // ⚙️ how far in it has to travel to count
    let sx = 0, sy = 0, fromEdge = null;

    document.addEventListener('touchstart', (ev) => {
      fromEdge = null;
      if (!ev.touches || ev.touches.length !== 1) return;
      // Fullscreen is the player's; a panel open over the page is not either.
      if (root.classList.contains('is-fs')) return;
      if (document.querySelector('#historyPanel.history-open, #basketPanel.basket-open')) return;
      const t0 = ev.touches[0];
      sx = t0.clientX; sy = t0.clientY;
      const box = root.getBoundingClientRect();
      if (sx - box.left <= EDGE) fromEdge = 'left';
      else if (box.right - sx <= EDGE) fromEdge = 'right';
    }, { passive: true, capture: true });

    document.addEventListener('touchend', (ev) => {
      const edge = fromEdge;
      fromEdge = null;
      if (!edge) return;
      const t0 = ev.changedTouches && ev.changedTouches[0];
      if (!t0) return;
      const dx = t0.clientX - sx;
      const dy = t0.clientY - sy;
      if (Math.abs(dx) < SWIPE || Math.abs(dy) > Math.abs(dx)) return;
      // Inward only: left edge must travel right, right edge must travel left.
      if (edge === 'left' && dx > 0) {
        if (typeof window.toggleHistory === 'function') window.toggleHistory(true);
      } else if (edge === 'right' && dx < 0) {
        if (typeof window.toggleBasket === 'function') window.toggleBasket(true);
      }
    }, { passive: true, capture: true });
    // The dock is the positioned element; everything below is laid out inside
    // it by flexbox, in DOM order. No measuring.
    const dock = document.createElement('div');
    dock.id = 'scrayDisguiseDock';

    // ---- Fuse the corner row into the dock (13.121) ----------------------
    // The corner row and the anchor buttons were two separately positioned
    // rows sharing one baseline, kept apart by a 92px reserve written by hand
    // into six !important blocks in style.css (13.122, 13.123). Every time a
    // button was added to either side that number was wrong again.
    //
    // They are now ONE flex row. `.corner-btn-row` is MOVED - not copied - into
    // the dock, so every handler bound by id is still bound to the same node,
    // and its ids are untouched. 🔍 comes out of it and joins the frozen
    // group, per Mac: the four on the right are always reachable and the rest
    // scroll under them.
    //
    // Moving it out of <body> has two effects worth knowing, both wanted:
    //   - `body.fullscreen-active:not(.fls-peek) #cornerButtons` no longer
    //     reaches it, so the row survives fullscreen instead of being hidden
    //     outright - and being a dock child it now fades with the player
    //     controls like the anchor buttons do.
    //   - every other #cornerButtons rule (the centring, the history-panel
    //     shifts, the three right-anchor blocks, the reserve) stops applying
    //     too. They are dead rather than fighting; see the CSS note above.
    // The shell stays in the DOM, hidden: it still holds the retired parked
    // buttons, whose handlers are wired by id and would be dead listeners if
    // the elements went away.
    const cornerRoot = document.getElementById('cornerButtons');
    const strip = cornerRoot && cornerRoot.querySelector('.corner-btn-row');
    if (strip) {
      // ⚙️ Captured BEFORE the strip moves, and off the strip rather than off
      // the document. The dock is not in the document until root.appendChild()
      // at the end of this function, so the moment the strip goes into it the
      // whole row becomes a DETACHED subtree - and document.getElementById
      // cannot see into one. Querying the document here returned null, the
      // search button silently stayed in the scroller, and the frozen group was
      // three buttons instead of four.
      const searchBtn = strip.querySelector('#jumpSearchBtn');
      strip.id = 'scrayDisguiseStrip';
      dock.appendChild(strip);
      if (searchBtn) dock.appendChild(searchBtn);
      cornerRoot.style.display = 'none';
    }

    // ---- X^n, Xb and X^T rejoin the row (13.132) -------------------------
    // 13.129 folded them into a stack above X; they are ordinary buttons again,
    // sitting after H. MOVED, not rebuilt, so their id-bound handlers in
    // randomiser.js keep working - and X^n comes out of the parked section it
    // has been in since 13.114, which is a different container from the row, so
    // each is asked of its own home (13.130's lesson).
    //
    // Xb is the exception: it has never been a corner button, only a control
    // inside the player, so it is built here against the same window function
    // that one calls. It is created whether or not the row exists, so the row
    // state below always has something to place.
    const findX = (id) => (strip && strip.querySelector('#' + id))
                       || (cornerRoot && cornerRoot.querySelector('#' + id));
    const xbBtn = document.createElement('button');
    xbBtn.id = 'scrayXbBtn';
    xbBtn.type = 'button';
    xbBtn.className = 'burger-btn burger-btn-pink';
    xbBtn.textContent = 'Xb';
    xbBtn.title = 'Play a random bookmark';
    xbBtn.addEventListener('click', () => {
      if (typeof window.scrayPlayRandomBookmark === 'function') {
        window.scrayPlayRandomBookmark().catch(err => console.warn('[Xb] failed:', err));
      }
    });
    if (strip) {
      // In DOM order after H: X^n, Xb, X^T. The visible order is set by flex
      // `order` in applyRowState, but the DOM is the record of tap order, so it
      // is put right here too. The anchor walks forward with each insert -
      // inserting all three after a FIXED anchor would reverse them.
      let anchorEl = strip.querySelector('#playHistorySequenceBtn');
      [findX('playRandomWeightedBtn'), xbBtn, findX('playRandomTimeBtn')].forEach(b => {
        if (!b) return;
        b.style.display = '';
        if (anchorEl) { anchorEl.insertAdjacentElement('afterend', b); anchorEl = b; }
        else strip.appendChild(b);
      });
    }

    dock.appendChild(viewBtn);
    if (wantsGlobe) dock.appendChild(globeBtn);
    dock.appendChild(control);
    root.appendChild(dock);

    // ---- Which buttons the row shows, by app state (13.132) ---------------
    // Nothing playing: the things that start something, in Mac's order -
    //   X  R  H  X^n  Xb  X^T  B()  H()
    // Fullscreen: nothing at all. The row is hidden there and the circles carry
    // its jobs, so a second set of them over the picture is just clutter.
    //
    // hidden, not removed: every one of these is wired by id elsewhere, and the
    // parked-button rule applies just as much to a button that comes back.
    const ROW_IDLE = ['playRandomFilteredBtn', 'quickRandomBtn', 'playHistorySequenceBtn',
                      'playRandomWeightedBtn', 'scrayXbBtn', 'playRandomTimeBtn',
                      'basketToggleBtn', 'historyToggleBtn'];
    // ⚙️ Empty in fullscreen (13.132). The row is hidden outright by CSS there -
    // this is belt and braces, and it is what the state function reads, so the
    // two cannot disagree about what fullscreen shows.
    const ROW_FULLSCREEN = [];
    let lastRowState = null;
    function applyRowState(isFullscreen) {
      if (!strip) return;
      // Runs on every class change in the player - only rewrite the row when
      // the state it depends on actually flipped (13.182).
      const btns = strip.querySelectorAll('.burger-btn');
      const key = (isFullscreen ? 'fs' : 'idle') + ':' + btns.length;
      if (key === lastRowState) return;
      lastRowState = key;
      const want = isFullscreen ? ROW_FULLSCREEN : ROW_IDLE;
      btns.forEach(btn => {
        const at = want.indexOf(btn.id);
        btn.hidden = at === -1;
        // flex order, so the row reads in the requested sequence without the
        // DOM being reshuffled - which would break nothing, but would make the
        // markup stop describing the tap order it is the record of.
        btn.style.order = at === -1 ? '' : String(at);
      });
    }

    // ---- Mirror the player's state onto the overlay root ------------------
    // The overlay lives on documentElement, a SIBLING of body, so no
    // `body.something .scrayDisguise*` selector can ever reach it. Copying the
    // one class the layout cares about onto the root is what lets the MPFS
    // offset above apply at all. A class toggle, deliberately - the thing it
    // replaces was a live measurement, and that is what drifted (13.121).
    //
    // Plyr's controls-hidden flag lives on the .plyr element, which is inside
    // body and gets rebuilt on every source change - so the observer is bound
    // to #inlineVideoContainer (the stable wrapper) rather than to .plyr, and
    // rebound if that wrapper is ever replaced. Scoped to that subtree rather
    // than to body's, deliberately: a class-change observer over the whole
    // list would fire on every row highlight.
    let controlsHost = null;
    let controlsObserver = null;
    function bindControlsWatcher() {
      const host = document.getElementById('inlineVideoContainer');
      if (!host || host === controlsHost) return;
      if (controlsObserver) controlsObserver.disconnect();
      controlsHost = host;
      controlsObserver = new MutationObserver(syncStateClasses);
      controlsObserver.observe(host, {
        subtree: true, attributes: true, attributeFilter: ['class'],
      });
    }

    function syncStateClasses() {
      const b = document.body;
      if (typeof startHoleTracking === 'function') startHoleTracking(); // +P hole may move (13.182)
      const mpfs = b.classList.contains('portrait-fullscreen')
        && !b.classList.contains('manual-rotate-landscape');
      // FLS counts too: both put the player over the whole screen, and the
      // fade wants either. Only the POSITION offset is MPFS-only.
      const fs = FULLSCREEN_BODY_CLASSES.some(c => b.classList.contains(c));
      bindControlsWatcher();
      const plyr = document.querySelector('.plyr');
      const hidden = !!plyr && plyr.classList.contains('plyr--hide-controls');

      root.classList.toggle('is-mpfs', mpfs);
      root.classList.toggle('is-fs', fs);
      root.classList.toggle('is-controls-hidden', hidden);

      // ⚙️ The double-tap grid's own awake flag, relayed for the row guides.
      // body carries it (CONTROLS POLICY in player.js sets it from the touch
      // and clears it ~300ms after the taps stop); this overlay is a sibling of
      // body and cannot see it, exactly as with is-mpfs.
      // ⚙️ Peek relayed (13.134). An up-swipe in FLS slides the player aside and
      // hands the page back; FLS itself stays on, so body keeps both
      // fullscreen-active and manual-rotate-landscape and is-fs stays true. This
      // is the class that says "but the page is usable", and every dock rule
      // that means "over the picture" excludes it.
      root.classList.toggle('is-peek', b.classList.contains('fls-peek'));

      const awake = b.classList.contains('scray-guides-awake');
      const wasAwake = root.classList.contains('is-guides-awake');
      root.classList.toggle('is-guides-awake', awake);
      // Measure on the rising edge only: the rows are where they are, and the
      // moment they are about to be shown is the one moment worth asking.
      if (awake && !wasAwake) placeRowGuides();

      // The row's contents follow the app's state (13.129).
      // Peeking counts as not-playing: the player has slid aside and the page
      // is back, so the row that belongs to the page is the one to show (13.134).
      applyRowState(fs && !b.classList.contains('fls-peek'));

    }
    new MutationObserver(syncStateClasses).observe(document.body, {
      attributes: true, attributeFilter: ['class'],
    });
    syncStateClasses();
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

    // ---- Tapping the blind row wakes it instead of pressing it (13.123) --
    // In FLS and MPFS the row fades out with the player controls. While it is
    // faded the CSS above makes the dock itself the only live target, so this
    // sees the tap and nothing inside it can fire. Raising the controls brings
    // the row back - the same gesture, and the same result, as tapping the
    // video: one tap to wake, a second to press.
    //
    // Capture phase, and it stops the event: a tap meant to reveal the row is
    // not also a tap on the app behind it.
    function dockIsBlind() {
      // Peeking is never blind (13.136): the dock is fully visible and its
      // buttons do their own jobs. Without this, a tap on one of them while the
      // controls happened to be idle would raise the player's controls instead
      // of pressing the button - the same miss as the fade rules above.
      return root.classList.contains('is-fs')
          && !root.classList.contains('is-peek')
          && root.classList.contains('is-controls-hidden')
          && control.classList.contains('is-collapsed');
    }
    dock.addEventListener('pointerdown', (ev) => {
      if (!dockIsBlind()) return;
      ev.preventDefault();
      ev.stopPropagation();
      // scrayRaiseControlsForTouch also re-arms Plyr's hide timer, so the row
      // stays up for the usual dwell rather than vanishing again immediately.
      // scrayShowControlsNow is the fallback: it reveals but does not re-arm.
      if (typeof window.scrayRaiseControlsForTouch === 'function') {
        window.scrayRaiseControlsForTouch();
      } else if (typeof window.scrayShowControlsNow === 'function') {
        window.scrayShowControlsNow();
      }
    }, true);

    // ---- Tap off the panel to collapse it (mobile) ----
    // Capture phase and read-only: never preventDefault, so the tap still
    // does whatever it was going to do in the app underneath.
    if (CLOSE_ON_OUTSIDE_TAP) {
      document.addEventListener('pointerdown', (e) => {
        if (!state.open) return;
        // The panel's own furniture, not the whole dock (13.121). 🌐 and
        // VID/BM sit beside the panel and a tap on one is not a tap "off the
        // panel" - but since the corner row moved INTO the dock, a dock-wide
        // test would mean tapping R or X left an open panel sitting over the
        // app. Those buttons are the app underneath, so they close it, and so
        // does 🔍, which scrolls the page out from under the panel anyway.
        const furniture = [control, globeBtn, viewBtn];
        if (e.target && furniture.some(el => el && el.contains(e.target))) return;
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

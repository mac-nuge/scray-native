// ===== scray-modal-guard.js =====
//
// Native 15.156. Clears a stuck overlay: the screen is dimmed as if a modal
// were open, there is no modal, and nothing can be tapped (the dim layer is
// catching every touch). The page behind can still be scrolled, which is what
// makes it look frozen rather than broken.
//
// Two ways out, neither needing a button (nothing is tappable in that state):
//
//   1. Automatic. Once a second it looks for a full-screen, dimming, fixed
//      layer that is the topmost thing at nine points across the screen and
//      holds nothing in it (no text, picture, button or box with content), with
//      no other modal layer above it. If that is still true three scans in a
//      row it is cleared. A layer with a box showing in it is never touched.
//
//   2. By hand. Tap the dimmed area four times quickly. That clears the layer
//      under your finger whether or not it looks empty (a tap on the dim area
//      outside a real modal's box closes that modal anyway, so nothing is lost).
//
// Every clear is written to the console log (which layer: tag, id, classes, the
// start of its markup) and shown as a short message, so the next time it
// happens the "send report" log says which modal was left behind.
//
// Only looks at modal-style layers - ids or classes containing modal, overlay,
// backdrop, popup, sheet or dialog - and never anything holding a video, canvas
// or iframe or named for the player, so the fullscreen player is never a target.

(function scrayModalGuard() {
  'use strict';
  if (window.__scrayModalGuard) return;
  window.__scrayModalGuard = true;

  const EVERY_MS = 1000;      // scan interval
  const STRIKES = 3;          // empty scans in a row before it clears
  const MIN_DIM = 0.15;       // background alpha that counts as dimming (auto path)
  const TAPS = 4;             // quick taps that force a clear
  const TAP_WINDOW_MS = 2500;

  const SELECTOR = [
    '[class*="modal" i]', '[class*="overlay" i]', '[class*="backdrop" i]',
    '[class*="popup" i]', '[class*="sheet" i]', '[class*="dialog" i]',
    '[id*="modal" i]', '[id*="overlay" i]', '[id*="backdrop" i]',
    '[id*="popup" i]', '[id*="sheet" i]', '[id*="dialog" i]'
  ].join(',');

  const initial = new WeakSet();   // layers that were in the page's own markup
  const strikes = new Map();       // layer -> empty scans in a row

  function alphaOf(bg) {
    const m = /rgba?\(([^)]+)\)/.exec(bg || '');
    if (!m) return 0;
    const p = m[1].split(/[\s,\/]+/).filter(Boolean);
    return p.length >= 4 ? parseFloat(p[3]) : 1;
  }

  function describe(el) {
    const id = el.id ? '#' + el.id : '';
    const cls = typeof el.className === 'string' && el.className.trim()
      ? '.' + el.className.trim().split(/\s+/).join('.') : '';
    let html = '';
    try { html = el.outerHTML.slice(0, 160).replace(/\s+/g, ' '); } catch (e) { /* ignore */ }
    return `${el.tagName.toLowerCase()}${id}${cls} ${html}`;
  }

  function isPlayerish(el) {
    const name = `${el.id || ''} ${typeof el.className === 'string' ? el.className : ''}`;
    if (/plyr|player|fls|pip/i.test(name)) return true;
    try { return !!el.querySelector('video, audio, canvas, iframe'); } catch (e) { return false; }
  }

  function coversScreen(el) {
    const r = el.getBoundingClientRect();
    return r.width >= window.innerWidth * 0.9 && r.height >= window.innerHeight * 0.9 &&
           r.bottom > 0 && r.right > 0 && r.top < window.innerHeight && r.left < window.innerWidth;
  }

  // A full-screen fixed layer that takes touches. `minDim` 0 also accepts an
  // invisible one (the tap escape); the automatic path wants it dimming.
  function asScrim(el, minDim) {
    if (!el || !el.isConnected || el === document.body || el === document.documentElement) return null;
    if (/^(SCRIPT|STYLE|LINK|META)$/.test(el.tagName)) return null;
    if (isPlayerish(el) || !coversScreen(el)) return null;
    const cs = getComputedStyle(el);
    if (cs.position !== 'fixed' || cs.display === 'none' || cs.visibility !== 'visible' || cs.pointerEvents === 'none') return null;
    if (parseFloat(cs.opacity) < 0.05) return null;
    if (alphaOf(cs.backgroundColor) < minDim) return null;
    return { el, z: parseInt(cs.zIndex, 10) || 0 };
  }

  // Nothing in it: no children, no text, not a picture or a control.
  function isEmptyEl(el) {
    return el.children.length === 0 && !(el.textContent || '').trim() &&
           !/^(IMG|VIDEO|CANVAS|SVG|INPUT|TEXTAREA|SELECT|BUTTON|IFRAME|AUDIO)$/i.test(el.tagName);
  }

  function topmostIsOnlyScrim(scrim) {
    const W = window.innerWidth, H = window.innerHeight;
    for (const fx of [0.2, 0.5, 0.8]) {
      for (const fy of [0.2, 0.5, 0.8]) {
        const t = document.elementFromPoint(W * fx, H * fy);
        if (!t) continue;
        if (t === scrim.el) continue;
        if (scrim.el.contains(t) && isEmptyEl(t)) continue;
        return false;
      }
    }
    return true;
  }

  // Another modal-style layer, at or above this one, with something showing.
  function layerAbove(scrim, list) {
    const W = window.innerWidth, H = window.innerHeight;
    return list.some(o => {
      if (o === scrim.el || scrim.el.contains(o) || !o.isConnected) return false;
      const r = o.getBoundingClientRect();
      if (r.width * r.height < 400 || r.bottom <= 0 || r.right <= 0 || r.top >= H || r.left >= W) return false;
      const cs = getComputedStyle(o);
      if (cs.display === 'none' || cs.visibility !== 'visible' || parseFloat(cs.opacity) < 0.05) return false;
      if (cs.position !== 'fixed' && cs.position !== 'absolute') return false;
      if ((parseInt(cs.zIndex, 10) || 0) < scrim.z) return false;
      return !isEmptyEl(o);
    });
  }

  function say(msg) {
    if (typeof window.showSyncConfirmation === 'function') window.showSyncConfirmation(msg, '#c0392b');
  }

  function clear(el, how) {
    strikes.delete(el);
    console.warn(`[modal-guard] cleared a stuck overlay (${how}): ${describe(el)}`);
    if (el.id === 'scrayFsPanelBackdrop') {
      // Shown by the body class alone (player.js); dropping the class hides it
      // and the next panel opens it again as usual.
      document.body.classList.remove('scray-fs-panel-open');
    } else if (initial.has(el)) {
      // Part of the page's own markup: hide it, don't delete it, so whatever
      // opens it next time still has it.
      el.style.display = 'none';
    } else {
      el.remove();
    }
    say('Cleared a stuck overlay');
  }

  function scan() {
    if (document.hidden || !document.body) return;
    const list = [...document.querySelectorAll(SELECTOR)];
    const seen = new Set();
    for (const el of list) {
      const scrim = asScrim(el, MIN_DIM);
      if (!scrim) continue;
      if (!topmostIsOnlyScrim(scrim) || layerAbove(scrim, list)) { strikes.delete(el); continue; }
      seen.add(el);
      const n = (strikes.get(el) || 0) + 1;
      strikes.set(el, n);
      if (n >= STRIKES) clear(el, 'automatic');
    }
    for (const el of [...strikes.keys()]) if (!seen.has(el) || !el.isConnected) strikes.delete(el);
  }

  // ---- four quick taps on the dim area (capture, so it works even when the
  // layer swallows the touch) ----
  let taps = [];
  document.addEventListener('pointerup', (e) => {
    const now = Date.now();
    taps = taps.filter(t => now - t < TAP_WINDOW_MS);
    taps.push(now);
    if (taps.length < TAPS) return;
    taps = [];
    let el = document.elementFromPoint(e.clientX, e.clientY);
    while (el && el !== document.body) {
      const scrim = asScrim(el, 0);
      if (scrim && el.matches(SELECTOR)) { clear(el, 'four taps'); return; }
      el = el.parentElement;
    }
  }, true);

  function start() {
    document.querySelectorAll(SELECTOR).forEach(el => initial.add(el));
    setInterval(scan, EVERY_MS);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  window.scrayModalGuardScan = scan;   // for the console: window.scrayModalGuardScan()
})();

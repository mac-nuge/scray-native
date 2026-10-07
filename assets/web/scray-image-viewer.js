// ===== scray-image-viewer.js =====
// Image viewer (picker 15.112 / native 15.133 / browse 15.186).
//
// Pictures live in the library beside the videos: a jpg / png / heic... is
// catalogued, filtered (TYPE), uploaded and migrated exactly like a video, and
// when one is played this opens instead of the video player.
//
//   - pinch, wheel or double-tap to zoom (up to 8x), drag to pan when zoomed
//   - ⟲ / ⟳ rotate a quarter turn (R / Shift+R)
//   - ⛶ full screen (the browser's own where it has one; on an iPhone, where
//     only <video> can go full screen, it hides the bars instead)
//   - swipe left / right (or ‹ › and the arrow keys) for the next / previous
//     picture in the list it was opened from; swipe down or Esc to close
//   - a single tap shows / hides the bars
//
// The same file is copied into scray-picker, scray-native/assets/web and
// scray-browse: keep the three in step. It touches nothing at load - player.js
// and friends load from <head> via document.write, before <body> exists - and
// builds its overlay the first time it opens.
//
//   scrayImageViewer.open({ items, index, onShow, onClose })
//       items: [{ name, sub?, url? | load: async () => url }]
//   scrayImageViewer.close() · isOpen()
//   scrayImageViewer.isImageName(filename) · extOf(filename) · IMAGE_EXT
//   scrayImageViewer.showIn(container, url, name, noteEl)   (browse peek panels)
(function () {
  'use strict';
  if (window.scrayImageViewer) return;

  // The picture types the library takes. Kept in step with api.php's
  // SCRAY_IMAGE_EXT, onedrive.js's IMAGE_EXTENSIONS and randomiser.js's
  // SCRAY_IMAGE_TYPES.
  const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'bmp', 'tif', 'tiff', 'avif'];
  const extOf = n => { const m = /\.([a-z0-9]{1,6})$/i.exec(String(n || '')); return m ? m[1].toLowerCase() : ''; };
  const isImageName = n => IMAGE_EXT.includes(extOf(n));

  const Z = 2147483000;              // over the player and its dock; disguise.js's panel (2147483647) stays on top
  const MAX_SCALE = 8;
  const URL_TTL_MS = 40 * 60 * 1000; // OneDrive's pre-authenticated links last about an hour
  const DOUBLE_TAP_MS = 280;

  let root = null, stage = null, img = null, nameEl = null, subEl = null, countEl = null, noteEl = null;
  let prevBtn = null, nextBtn = null;
  let S = null;                      // { items, index, onShow, onClose }
  let scale = 1, tx = 0, ty = 0, rot = 0, baseW = 0, baseH = 0;
  let loadSeq = 0, bare = false, savedOverflow = null, tapTimer = null, lastTap = null;
  const pointers = new Map();
  let gesture = null;                // { kind: 'drag' | 'pinch', ... }

  // ---------------------------------------------------------------- styles
  function ensureStyle() {
    if (document.getElementById('scrayImageViewerStyle')) return;
    const st = document.createElement('style');
    st.id = 'scrayImageViewerStyle';
    st.textContent = `
.siv{position:fixed;inset:0;z-index:${Z};background:#000;color:#fff;touch-action:none;user-select:none;-webkit-user-select:none;
  overscroll-behavior:contain;font:14px/1.3 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;-webkit-tap-highlight-color:transparent}
.siv-stage{position:absolute;inset:0;overflow:hidden;cursor:grab}
.siv-stage.is-zoomed{cursor:move}
.siv-img{position:absolute;left:50%;top:50%;max-width:none!important;max-height:none!important;transform-origin:50% 50%;
  will-change:transform;-webkit-user-drag:none;pointer-events:none;image-orientation:from-image}
.siv-top{position:absolute;left:0;right:0;top:0;display:flex;align-items:center;gap:10px;
  padding:calc(env(safe-area-inset-top, 0px) + 8px) 12px 22px;background:linear-gradient(rgba(0,0,0,.75),rgba(0,0,0,0));transition:opacity .2s}
.siv-title{flex:1;min-width:0}
.siv-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
.siv-sub{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;opacity:.65}
.siv-count{font-size:12px;opacity:.8;white-space:nowrap}
.siv-bar{position:absolute;left:50%;bottom:calc(env(safe-area-inset-bottom, 0px) + 16px);transform:translateX(-50%);display:flex;gap:6px;
  background:rgba(24,24,24,.8);border-radius:26px;padding:6px 8px;transition:opacity .2s;max-width:calc(100vw - 24px)}
.siv button{background:rgba(255,255,255,.14);border:0;color:#fff;min-width:42px;height:42px;border-radius:21px;font-size:19px;
  padding:0 10px;cursor:pointer;line-height:42px;display:inline-flex;align-items:center;justify-content:center;width:auto;margin:0}
.siv button:active{background:rgba(255,255,255,.3)}
.siv button[disabled]{opacity:.35}
.siv-side{position:absolute;top:50%;transform:translateY(-50%);height:72px!important;border-radius:12px!important;
  background:rgba(0,0,0,.35)!important;font-size:30px!important;transition:opacity .2s}
.siv-prev{left:8px}.siv-next{right:8px}
@media (hover:none){.siv-side{display:none!important}}
.siv-note{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,.65);padding:9px 15px;
  border-radius:9px;max-width:80%;text-align:center;pointer-events:none}
.siv-note:empty{display:none}
.siv.siv-bare .siv-top,.siv.siv-bare .siv-bar,.siv.siv-bare .siv-side{opacity:0;pointer-events:none}
.siv-inline{display:block;max-width:100%;max-height:100%;margin:auto;object-fit:contain;cursor:zoom-in;image-orientation:from-image}
`;
    (document.head || document.documentElement).appendChild(st);
  }

  // ---------------------------------------------------------------- DOM
  function mkBtn(label, title, fn, cls) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.title = title;
    if (cls) b.className = cls;
    b.addEventListener('click', e => { e.stopPropagation(); fn(e); });
    return b;
  }

  function build() {
    if (root) return;
    ensureStyle();
    root = document.createElement('div');
    root.className = 'siv';
    root.id = 'scrayImageViewer';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Image viewer');

    stage = document.createElement('div');
    stage.className = 'siv-stage';
    img = document.createElement('img');
    img.className = 'siv-img';
    img.alt = '';
    img.draggable = false;
    stage.appendChild(img);

    const top = document.createElement('div');
    top.className = 'siv-top';
    const title = document.createElement('div');
    title.className = 'siv-title';
    nameEl = document.createElement('div'); nameEl.className = 'siv-name';
    subEl = document.createElement('div'); subEl.className = 'siv-sub';
    title.append(nameEl, subEl);
    countEl = document.createElement('div'); countEl.className = 'siv-count';
    top.append(mkBtn('✕', 'Close (Esc)', close), title, countEl);

    const bar = document.createElement('div');
    bar.className = 'siv-bar';
    prevBtn = mkBtn('‹', 'Previous (←)', () => go(-1));
    nextBtn = mkBtn('›', 'Next (→)', () => go(1));
    bar.append(
      prevBtn,
      mkBtn('⟲', 'Rotate left (Shift+R)', () => rotate(-90)),
      mkBtn('⟳', 'Rotate right (R)', () => rotate(90)),
      mkBtn('−', 'Zoom out (-)', () => zoomBy(1 / 1.6)),
      mkBtn('+', 'Zoom in (+)', () => zoomBy(1.6)),
      mkBtn('⛶', 'Full screen (F)', toggleFullscreen),
      nextBtn
    );

    const sidePrev = mkBtn('‹', 'Previous (←)', () => go(-1), 'siv-side siv-prev');
    const sideNext = mkBtn('›', 'Next (→)', () => go(1), 'siv-side siv-next');

    noteEl = document.createElement('div');
    noteEl.className = 'siv-note';

    root.append(stage, sidePrev, sideNext, top, bar, noteEl);
    root._side = [sidePrev, sideNext];

    stage.addEventListener('pointerdown', onDown);
    stage.addEventListener('pointermove', onMove);
    stage.addEventListener('pointerup', onUp);
    stage.addEventListener('pointercancel', onUp);
    stage.addEventListener('wheel', onWheel, { passive: false });
    // iOS still fires its own pinch-zoom of the page alongside pointer events.
    ['gesturestart', 'gesturechange', 'gestureend'].forEach(t => root.addEventListener(t, e => e.preventDefault()));
    root.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
  }

  // ---------------------------------------------------------------- geometry
  const W = () => (stage && stage.clientWidth) || window.innerWidth;
  const H = () => (stage && stage.clientHeight) || window.innerHeight;
  const odd = () => Math.abs(rot) % 180 === 90;

  function fit() {
    const nw = img.naturalWidth || 1, nh = img.naturalHeight || 1;
    const fw = odd() ? nh : nw, fh = odd() ? nw : nh;
    const k = Math.min(W() / fw, H() / fh);
    baseW = nw * k; baseH = nh * k;
    img.style.width = baseW + 'px';
    img.style.height = baseH + 'px';
  }

  function clamp() {
    const bw = (odd() ? baseH : baseW) * scale, bh = (odd() ? baseW : baseH) * scale;
    const mx = Math.max(0, (bw - W()) / 2), my = Math.max(0, (bh - H()) / 2);
    tx = Math.min(mx, Math.max(-mx, tx));
    ty = Math.min(my, Math.max(-my, ty));
  }

  function apply(animate) {
    img.style.transition = animate ? 'transform .2s ease, opacity .2s ease' : 'none';
    img.style.transform = `translate(-50%,-50%) translate(${tx}px,${ty}px) rotate(${rot}deg) scale(${scale})`;
    stage.classList.toggle('is-zoomed', scale > 1.01);
  }

  /** Zoom to s2, keeping the stage point (px, py) where it is. */
  function zoomAt(s2, px, py, animate) {
    s2 = Math.min(MAX_SCALE, Math.max(1, s2));
    const cx = px - W() / 2, cy = py - H() / 2;
    tx = cx - (cx - tx) * (s2 / scale);
    ty = cy - (cy - ty) * (s2 / scale);
    scale = s2;
    if (scale <= 1.001) { scale = 1; tx = 0; ty = 0; }
    clamp();
    apply(animate);
  }
  const zoomBy = f => zoomAt(scale * f, W() / 2, H() / 2, true);

  function resetView(animate) {
    scale = 1; tx = 0; ty = 0;
    if (img.naturalWidth) fit();
    apply(animate);
  }

  function rotate(deg) {
    rot = (rot + deg) % 360;
    scale = 1; tx = 0; ty = 0;
    if (img.naturalWidth) fit();
    apply(true);
  }

  // ---------------------------------------------------------------- gestures
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  function local(e) { const r = stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

  function onDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    try { stage.setPointerCapture(e.pointerId); } catch (_) { /* fine */ }
    pointers.set(e.pointerId, local(e));
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      gesture = { kind: 'pinch', d0: dist(a, b) || 1, s0: scale, m0: mid(a, b), tx0: tx, ty0: ty };
    } else if (pointers.size === 1) {
      const p = local(e);
      gesture = { kind: 'drag', x0: p.x, y0: p.y, tx0: tx, ty0: ty, t0: Date.now(), axis: null, moved: false, pinched: false };
    }
  }

  function onMove(e) {
    if (!pointers.has(e.pointerId) || !gesture) return;
    pointers.set(e.pointerId, local(e));
    if (gesture.kind === 'pinch' && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const m = mid(a, b);
      const s2 = Math.min(MAX_SCALE, Math.max(1, gesture.s0 * dist(a, b) / gesture.d0));
      const cx0 = gesture.m0.x - W() / 2, cy0 = gesture.m0.y - H() / 2;
      scale = s2;
      tx = (m.x - W() / 2) - (cx0 - gesture.tx0) * (s2 / gesture.s0);
      ty = (m.y - H() / 2) - (cy0 - gesture.ty0) * (s2 / gesture.s0);
      clamp();
      apply(false);
      return;
    }
    if (gesture.kind !== 'drag') return;
    const p = local(e);
    const dx = p.x - gesture.x0, dy = p.y - gesture.y0;
    if (!gesture.moved && Math.hypot(dx, dy) > 8) gesture.moved = true;
    if (!gesture.moved) return;
    if (scale > 1.01) {
      tx = gesture.tx0 + dx; ty = gesture.ty0 + dy;
      clamp();
      apply(false);
      return;
    }
    if (!gesture.axis) gesture.axis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
    if (gesture.axis === 'x') {
      tx = dx; ty = 0;
      apply(false);
    } else if (dy > 0) {
      ty = dy; tx = 0;
      apply(false);
      root.style.background = `rgba(0,0,0,${Math.max(0.25, 1 - dy / (H() * 0.8))})`;
    }
  }

  function onUp(e) {
    if (!pointers.has(e.pointerId)) return;
    const p = local(e);
    pointers.delete(e.pointerId);
    if (!gesture) return;

    if (gesture.kind === 'pinch') {
      if (pointers.size === 1) {
        // One finger left on the glass: it carries on as a pan, never a tap.
        const [q] = [...pointers.values()];
        gesture = { kind: 'drag', x0: q.x, y0: q.y, tx0: tx, ty0: ty, t0: Date.now(), axis: null, moved: true, pinched: true };
      } else if (!pointers.size) {
        gesture = null;
        if (scale <= 1.02) resetView(true);
      }
      return;
    }

    if (pointers.size) return;
    const g = gesture;
    gesture = null;
    const dx = p.x - g.x0, dy = p.y - g.y0, dt = Math.max(1, Date.now() - g.t0);

    if (!g.moved) { if (!g.pinched) tap(p); return; }
    if (scale > 1.01) return;                            // a pan; it's already where it was left

    root.style.background = '';
    if (g.axis === 'x' && S && S.items.length > 1 && (Math.abs(dx) > W() * 0.18 || Math.abs(dx) / dt > 0.45)) {
      slideTo(dx < 0 ? 1 : -1);
      return;
    }
    if (g.axis === 'y' && (dy > H() * 0.2 || dy / dt > 0.6)) { close(); return; }
    tx = 0; ty = 0;
    apply(true);
  }

  function tap(p) {
    const now = Date.now();
    if (lastTap && now - lastTap.t < DOUBLE_TAP_MS && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < 40) {
      clearTimeout(tapTimer); tapTimer = null; lastTap = null;
      if (scale > 1.01) resetView(true); else zoomAt(2.5, p.x, p.y, true);
      return;
    }
    lastTap = { t: now, x: p.x, y: p.y };
    clearTimeout(tapTimer);
    tapTimer = setTimeout(() => { tapTimer = null; lastTap = null; setBare(!bare); }, DOUBLE_TAP_MS);
  }

  function onWheel(e) {
    e.preventDefault();
    const p = local(e);
    zoomAt(scale * Math.exp(-e.deltaY * 0.0018), p.x, p.y, false);
  }

  function onKey(e) {
    if (!S) return;
    const k = e.key;
    let used = true;
    if (k === 'Escape') close();
    else if (k === 'ArrowRight' || k === 'PageDown' || k === ' ') go(1);
    else if (k === 'ArrowLeft' || k === 'PageUp') go(-1);
    else if (k === 'r' || k === 'R') rotate(e.shiftKey ? -90 : 90);
    else if (k === 'f' || k === 'F') toggleFullscreen();
    else if (k === '+' || k === '=') zoomBy(1.6);
    else if (k === '-' || k === '_') zoomBy(1 / 1.6);
    else if (k === '0') resetView(true);
    else used = false;
    // The player's own shortcuts listen on the document too: this one is ours.
    e.stopPropagation();
    e.stopImmediatePropagation();
    if (used) e.preventDefault();
  }

  function onResize() {
    if (!S || !img.naturalWidth) return;
    fit();
    clamp();
    apply(false);
  }

  // ---------------------------------------------------------------- chrome
  function setBare(on) {
    bare = !!on;
    if (root) root.classList.toggle('siv-bare', bare);
  }

  function fsElement() { return document.fullscreenElement || document.webkitFullscreenElement || null; }
  function toggleFullscreen() {
    if (fsElement()) {
      (document.exitFullscreen || document.webkitExitFullscreen || function () {}).call(document);
      return;
    }
    const req = root.requestFullscreen || root.webkitRequestFullscreen;
    if (req) {
      try {
        const r = req.call(root);
        if (r && typeof r.then === 'function') r.then(() => setBare(true)).catch(() => setBare(!bare));
        else setBare(true);
        return;
      } catch (_) { /* falls through */ }
    }
    // iPhone: only <video> goes full screen. The overlay already fills the
    // screen, so "full screen" means nothing on it but the picture.
    setBare(!bare);
  }

  // ---------------------------------------------------------------- items
  async function urlFor(it) {
    if (it.url && !it.load) return it.url;
    if (it._url && Date.now() - (it._urlAt || 0) < URL_TTL_MS) return it._url;
    const u = it.load ? await it.load() : it.url;
    it._url = u; it._urlAt = Date.now();
    return u;
  }

  function preload(i) {
    if (!S || S.items.length < 2) return;
    const it = S.items[(i + S.items.length) % S.items.length];
    if (!it || it._pre) return;
    it._pre = true;
    urlFor(it).then(u => { if (u) { const im = new Image(); im.src = u; } }).catch(() => { it._pre = false; });
  }

  function paintHead() {
    const it = S.items[S.index];
    nameEl.textContent = it.name || '';
    subEl.textContent = it.sub || '';
    countEl.textContent = S.items.length > 1 ? `${S.index + 1} / ${S.items.length}` : '';
    const many = S.items.length > 1;
    [prevBtn, nextBtn].forEach(b => { b.disabled = !many; });
    root._side.forEach(b => { b.style.display = many ? '' : 'none'; });
  }

  async function show(i, from) {
    if (!S) return;
    const n = S.items.length;
    S.index = ((i % n) + n) % n;
    const it = S.items[S.index];
    const seq = ++loadSeq;
    paintHead();
    rot = 0; scale = 1; tx = from ? from * W() * 0.25 : 0; ty = 0;
    img.style.opacity = '0';
    img.removeAttribute('src');
    noteEl.textContent = 'Loading…';
    if (typeof S.onShow === 'function') { try { S.onShow(it, S.index); } catch (err) { console.warn('[image-viewer] onShow', err); } }

    let url;
    try {
      url = await urlFor(it);
      if (!url) throw new Error('no link for this picture');
    } catch (err) {
      if (seq === loadSeq) noteEl.textContent = `Couldn't open ${it.name || 'this picture'}: ${(err && err.message) || err}`;
      return;
    }
    if (seq !== loadSeq) return;
    img.onload = () => {
      if (seq !== loadSeq) return;
      noteEl.textContent = '';
      fit();
      apply(false);
      // Fade (and, after a swipe, slide) in.
      requestAnimationFrame(() => { tx = 0; img.style.opacity = '1'; apply(true); });
      preload(S.index + 1);
      preload(S.index - 1);
    };
    img.onerror = () => {
      if (seq !== loadSeq) return;
      const ext = extOf(it.name);
      noteEl.textContent = (ext === 'heic' || ext === 'heif')
        ? `This browser can't show .${ext} pictures (Safari and the app can).`
        : ext === 'tif' || ext === 'tiff'
          ? 'This browser can\'t show .tiff pictures (Safari and the app can).'
          : `Couldn't load ${it.name || 'this picture'} - the link may have expired; close and open it again.`;
      it._url = null;
    };
    img.src = url;
  }

  function slideTo(dir) {
    if (!S || S.items.length < 2) return;
    tx = -dir * W(); ty = 0;
    img.style.transition = 'transform .16s ease-out, opacity .16s';
    img.style.transform = `translate(-50%,-50%) translate(${tx}px,0px) rotate(${rot}deg) scale(${scale})`;
    img.style.opacity = '0';
    setTimeout(() => show(S ? S.index + dir : 0, dir), 150);
  }

  function go(dir) {
    if (!S || S.items.length < 2) return;
    if (scale > 1.01) { show(S.index + dir, dir); return; }
    slideTo(dir);
  }

  // ---------------------------------------------------------------- open / close
  function open(opts) {
    const items = (opts && Array.isArray(opts.items) ? opts.items : []).filter(Boolean);
    if (!items.length) return false;
    build();
    const wasOpen = !!S;
    S = { items, index: Math.max(0, Math.min(items.length - 1, (opts.index | 0))), onShow: opts.onShow, onClose: opts.onClose };
    if (!wasOpen) {
      setBare(false);
      root.style.background = '';
      // Opened from a player in the browser's own full screen (a desktop
      // MPFS): only that element is drawn, so the viewer goes inside it.
      const fsEl = fsElement();
      let host = document.body;
      if (fsEl && fsEl.tagName !== 'VIDEO') host = fsEl;
      else if (fsEl) { try { (document.exitFullscreen || document.webkitExitFullscreen).call(document); } catch (_) { /* fine */ } }
      host.appendChild(root);
      savedOverflow = document.documentElement.style.overflow;
      document.documentElement.style.overflow = 'hidden';
      document.addEventListener('keydown', onKey, true);
      window.addEventListener('resize', onResize);
      document.addEventListener('fullscreenchange', onResize);
      document.addEventListener('webkitfullscreenchange', onResize);
    }
    show(S.index, 0);
    return true;
  }

  function close() {
    if (!S) return;
    const s = S;
    S = null;
    loadSeq++;
    clearTimeout(tapTimer); tapTimer = null; lastTap = null;
    pointers.clear(); gesture = null;
    if (fsElement() === root) { try { (document.exitFullscreen || document.webkitExitFullscreen).call(document); } catch (_) { /* fine */ } }
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', onResize);
    document.removeEventListener('fullscreenchange', onResize);
    document.removeEventListener('webkitfullscreenchange', onResize);
    document.documentElement.style.overflow = savedOverflow || '';
    img.removeAttribute('src');
    if (root.parentNode) root.parentNode.removeChild(root);
    if (typeof s.onClose === 'function') { try { s.onClose(s.items[s.index], s.index); } catch (err) { console.warn('[image-viewer] onClose', err); } }
  }

  /** A picture in a page's preview panel (browse); a tap opens it full screen. */
  function showIn(container, url, name, note) {
    ensureStyle();
    const im = document.createElement('img');
    im.className = 'siv-inline';
    im.alt = name || '';
    im.title = 'Open full screen - zoom, rotate';
    im.addEventListener('load', () => {
      if (note) note.textContent = `picture · ${im.naturalWidth}×${im.naturalHeight} · tap it to open full screen`;
    });
    im.addEventListener('error', () => {
      if (!note) return;
      note.className = (note.className || '').replace(/\berr\b/, '') + ' err';
      const ext = extOf(name);
      note.textContent = /^(heic|heif|tif|tiff)$/.test(ext)
        ? `This browser can't show .${ext} pictures - Safari can.`
        : 'Couldn\'t load the picture - the link may have expired. Preview it again.';
    });
    im.addEventListener('click', () => open({ items: [{ name, url }], index: 0 }));
    im.src = url;
    container.appendChild(im);
    return im;
  }

  /** A small JPEG data URL of a picture - its "frame" for the browse grids. */
  function thumb(url, maxW, q) {
    return new Promise((resolve, reject) => {
      const im = new Image();
      im.crossOrigin = 'anonymous';
      const t = setTimeout(() => reject(new Error('timed out loading the picture')), 20000);
      im.onload = () => {
        clearTimeout(t);
        try {
          const k = Math.min(1, (maxW || 320) / (im.naturalWidth || 1));
          const c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(im.naturalWidth * k));
          c.height = Math.max(1, Math.round(im.naturalHeight * k));
          c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
          resolve(c.toDataURL('image/jpeg', q || 0.72));
        } catch (err) {
          reject(new Error(err && err.name === 'SecurityError' ? 'the link doesn\'t allow the picture to be copied' : ((err && err.message) || String(err))));
        }
      };
      im.onerror = () => { clearTimeout(t); reject(new Error('this browser can\'t show the picture, or the link was refused')); };
      im.src = url;
    });
  }

  window.scrayImageViewer = {
    open, close, showIn, thumb,
    isOpen: () => !!S,
    isImageName, extOf, IMAGE_EXT,
    // For the Settings / test harness: where the view stands.
    _state: () => ({ scale, tx, ty, rot, index: S ? S.index : -1, bare })
  };
})();

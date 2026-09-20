// ===== scray-bulk-select.js =====
//
// Bulk actions on the main list (picker 13.201 / native 13.199).
//
// picker 13.203 / native 13.201: bulk select is now a MODE. The yellow Bulk
// button at the left of the sort row turns it on and shows the action bar;
// while it is on, a tap anywhere on a line selects it (the line goes yellow)
// and a short hold then drag down takes a run of lines in one go. Turning it
// off deselects everything, and so does the sort row's Clear. Tapping the
// number or studio no longer selects anything outside the mode.
//
// On a phone the hold is what tells a drag-select from a scroll: move straight
// away and the list scrolls as usual; hold still for a moment first and the
// drag selects instead. A mouse drags straight away - it never scrolls.
//
// Deliberately NOT part of scrayBuildListRow: the rows are rebuilt constantly
// (pagination, variants, a re-filter), so this hangs off the containers
// instead. Selection is kept by video id, and a MutationObserver re-paints
// rows as they come back. Nothing in render.js had to change.
//
// The history and basket lists have their own tick on the number
// (cfg.select) - they are not in SCRAY_BULK_LISTS, so the two never meet.

(function scrayBulkSelect() {
  if (window.__scrayBulkSelectBound) return;
  window.__scrayBulkSelectBound = true;

  // ⚙️ Which lists take part. The main list, and only the main list.
  const SCRAY_BULK_LISTS = ['taggedVideosContainer'];
  // ⚙️ Gap between the action bar and the corner buttons it sits above.
  const BAR_GAP_PX = 8;
  // ⚙️ How long a finger has to rest on a line before a drag selects rather
  //    than scrolls, and how far it may wander in that time.
  const HOLD_MS = 220;
  const SLOP_PX = 8;
  // ⚙️ Drag this close to the top or bottom of the screen and the list
  //    scrolls on by itself, so a run can go past what's on screen.
  const EDGE_PX = 70;
  const EDGE_SPEED = 14;           // px per frame at the very edge

  /** id -> video, so an action still has the file after a re-render. */
  const selected = new Map();
  let bulkOn = false;
  /** The drag in progress: { adding } - whether it selects or deselects. */
  let drag = null;
  /** A touch that has not yet shown whether it is a tap, a hold or a scroll. */
  let pending = null;
  let lastPoint = null;
  let edgeRaf = 0;
  let bar = null;

  const containers = () => SCRAY_BULK_LISTS
    .map(id => document.getElementById(id))
    .filter(Boolean);

  const idOf = (video) => String(video?.oneDriveId ?? video?.idFromAPI ?? '');

  /** The file line under el, while the mode is on - or null. */
  const rowOf = (el) => {
    if (!bulkOn) return null;
    const li = el?.closest?.('li.lc-row');
    if (!li || !li._scrayVideo) return null;            // group lines have no file
    const host = li.closest('#' + SCRAY_BULK_LISTS.join(', #'));
    return host ? li : null;
  };

  // ---------------------------------------------------------------- painting

  function paintRow(li) {
    const on = selected.has(idOf(li._scrayVideo));
    li.classList.toggle('lc-bulk-selected', on);
  }

  function paintAll() {
    containers().forEach(c => {
      c.querySelectorAll('li.lc-row').forEach(li => { if (li._scrayVideo) paintRow(li); });
    });
    paintBar();
  }

  // ---------------------------------------------------------------- the mode

  function setBulkMode(on) {
    bulkOn = !!on;
    document.body.classList.toggle('scray-bulk-mode', bulkOn);
    const btn = document.getElementById('bulkModeBtn');
    if (btn) {
      btn.classList.toggle('active', bulkOn);
      btn.setAttribute('aria-pressed', bulkOn ? 'true' : 'false');
    }
    cancelGesture();
    if (!bulkOn) selected.clear();
    paintAll();
  }

  // ---------------------------------------------------------------- the bar

  const BIN_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>';

  function ensureBar() {
    if (bar && bar.isConnected) return bar;
    bar = document.createElement('div');
    bar.id = 'bulkActionBar';
    bar.hidden = true;
    bar.innerHTML = `
      <span class="bulk-count" id="bulkCount">0</span>
      <button type="button" class="bulk-btn bulk-all" data-bulk="all" title="Select every file in the list">Select all</button>
      <button type="button" class="bulk-btn bulk-basket" data-bulk="basket" title="Add to the basket">B</button>
      <button type="button" class="bulk-btn bulk-refresh" data-bulk="refresh" title="Refresh data">Ref</button>
      <button type="button" class="bulk-btn bulk-stash" data-bulk="stash" title="Edit stash details (studio, performers, tags)">S</button>
      <button type="button" class="bulk-btn bulk-delete" data-bulk="delete" title="Delete" aria-label="Delete">${BIN_SVG}</button>
      <button type="button" class="bulk-btn bulk-clear" data-bulk="close" title="Turn bulk select off">✕</button>`;
    bar.addEventListener('click', (e) => {
      const what = e.target?.closest?.('[data-bulk]')?.dataset?.bulk;
      if (!what) return;
      e.preventDefault();
      e.stopPropagation();
      runAction(what);
    });
    document.body.appendChild(bar);
    return bar;
  }

  /**
   * Sit just above the corner buttons, whatever height that stack is.
   *
   * Measured as a HEIGHT and added to the corner stack's own bottom offset,
   * not as a distance from the top of the window (picker 13.202 / native
   * 13.200). The first version read getBoundingClientRect().top, which is 0
   * while the stack is hidden or not laid out yet - and a bottom of nearly
   * the window's height put the bar up under the Dynamic Island.
   */
  function placeBar() {
    if (!bar) return;
    const corner = document.getElementById('cornerButtons');
    const h = corner ? corner.offsetHeight : 0;
    // A sane height when the stack is hidden, so the bar still clears it
    // when it comes back.
    const clearance = (h > 0 ? h : 90) + BAR_GAP_PX;
    bar.style.bottom = `calc(env(safe-area-inset-bottom, 0px) + 10px + ${Math.round(clearance)}px)`;
  }

  function paintBar() {
    const n = selected.size;
    ensureBar();
    bar.hidden = !bulkOn;
    if (!bulkOn) return;
    const count = bar.querySelector('#bulkCount');
    if (count) count.textContent = String(n);
    const all = bar.querySelector('.bulk-all');
    if (all) {
      const everything = n > 0 && n >= listVideos().length;
      all.textContent = everything ? 'Select none' : 'Select all';
    }
    bar.querySelectorAll('.bulk-basket, .bulk-refresh, .bulk-stash, .bulk-delete')
      .forEach(b => { b.disabled = n === 0; });
    placeBar();
  }

  // ---------------------------------------------------------------- select

  function setSelected(li, on) {
    const video = li._scrayVideo;
    const id = idOf(video);
    if (!id) return;
    if (on) selected.set(id, video); else selected.delete(id);
    // Every row for this file, not just the one under the finger: a linked
    // variant can be on screen twice.
    containers().forEach(c => {
      c.querySelectorAll('li.lc-row').forEach(row => {
        if (row._scrayVideo && idOf(row._scrayVideo) === id) paintRow(row);
      });
    });
    paintBar();
  }

  function clearSelection() {
    selected.clear();
    paintAll();
  }

  /** Every file in the current list - all pages, not just what's drawn. */
  function listVideos() {
    const ps = window.paginationState;
    const list = (ps && Array.isArray(ps.allVideos)) ? ps.allVideos : [];
    return list.filter(v => v && idOf(v));
  }

  function selectAll() {
    const all = listVideos();
    if (all.length && selected.size >= all.length) { clearSelection(); return; }
    all.forEach(v => selected.set(idOf(v), v));
    // Anything on screen the list array doesn't know about (it shouldn't
    // happen, but a half-finished render would otherwise look unselected).
    containers().forEach(c => c.querySelectorAll('li.lc-row').forEach(li => {
      if (li._scrayVideo && idOf(li._scrayVideo)) selected.set(idOf(li._scrayVideo), li._scrayVideo);
    }));
    paintAll();
  }

  // ---------------------------------------------------------------- gestures
  //
  // Touch and mouse are handled apart. A touch has to leave scrolling alone
  // unless it has been held still first; a mouse never scrolls by dragging,
  // so it selects from the first move.
  //
  // Everything is on the capture phase at document, so while the mode is on
  // the line's own handlers - open, long-press menu, swipe (render.js) -
  // never hear about the touch at all. elementFromPoint rather than
  // pointerenter, because a touch is held by the element it started on.

  function dragTo(x, y) {
    lastPoint = { x, y };
    const li = rowOf(document.elementFromPoint(x, y));
    if (!li) return;
    if (selected.has(idOf(li._scrayVideo)) !== drag.adding) setSelected(li, drag.adding);
  }

  function startDrag(li) {
    const adding = !selected.has(idOf(li._scrayVideo));
    drag = { adding };
    setSelected(li, adding);
  }

  function cancelGesture() {
    if (pending?.timer) clearTimeout(pending.timer);
    pending = null;
    drag = null;
    lastPoint = null;
    if (edgeRaf) cancelAnimationFrame(edgeRaf);
    edgeRaf = 0;
  }

  /** What scrolls the list - the nearest scrolling box, else the page. */
  function scrollerFor(el) {
    for (let n = el?.parentElement; n && n !== document.body; n = n.parentElement) {
      const oy = getComputedStyle(n).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight) return n;
    }
    return document.scrollingElement || document.documentElement;
  }

  function edgeLoop() {
    edgeRaf = 0;
    if (!drag || !lastPoint) return;
    const h = window.innerHeight;
    let dy = 0;
    if (lastPoint.y < EDGE_PX) dy = -EDGE_SPEED * (1 - lastPoint.y / EDGE_PX);
    else if (lastPoint.y > h - EDGE_PX) dy = EDGE_SPEED * (1 - (h - lastPoint.y) / EDGE_PX);
    if (dy) {
      const sc = scrollerFor(containers()[0]);
      sc.scrollTop += Math.round(dy) || Math.sign(dy);
      dragTo(lastPoint.x, lastPoint.y);
    }
    edgeRaf = requestAnimationFrame(edgeLoop);
  }

  function kickEdge() { if (!edgeRaf) edgeRaf = requestAnimationFrame(edgeLoop); }

  // --- touch

  document.addEventListener('touchstart', (e) => {
    if (!bulkOn) return;
    const li = rowOf(e.target);
    if (!li) return;
    e.stopPropagation();             // no swipe tray, no long-press menu
    cancelGesture();
    if (!e.touches || e.touches.length !== 1) return;
    const t = e.touches[0];
    pending = { li, x0: t.clientX, y0: t.clientY, moved: false, timer: 0 };
    pending.timer = setTimeout(() => {
      if (!pending || pending.moved) return;
      const p = pending;
      pending = null;
      startDrag(p.li);
      lastPoint = { x: p.x0, y: p.y0 };
      try { navigator.vibrate?.(10); } catch (_) {}
    }, HOLD_MS);
  }, { capture: true, passive: true });

  document.addEventListener('touchmove', (e) => {
    if (!bulkOn) return;
    const t = e.touches && e.touches[0];
    if (!t) return;
    if (drag) {
      e.stopPropagation();
      if (e.cancelable) e.preventDefault();   // selecting, not scrolling
      dragTo(t.clientX, t.clientY);
      kickEdge();
      return;
    }
    if (pending && !pending.moved) {
      if (Math.abs(t.clientX - pending.x0) > SLOP_PX || Math.abs(t.clientY - pending.y0) > SLOP_PX) {
        // Moved before the hold - it's a scroll. Leave it to the browser.
        clearTimeout(pending.timer);
        pending.moved = true;
      }
    }
  }, { capture: true, passive: false });

  document.addEventListener('touchend', (e) => {
    if (!bulkOn) return;
    if (pending && !pending.moved) {
      // A plain tap: flip that one line.
      const li = pending.li;
      cancelGesture();
      setSelected(li, !selected.has(idOf(li._scrayVideo)));
      if (e.cancelable) e.preventDefault();   // no synthetic click behind it
      e.stopPropagation();
      return;
    }
    if (drag) { e.stopPropagation(); if (e.cancelable) e.preventDefault(); }
    cancelGesture();
  }, { capture: true, passive: false });

  document.addEventListener('touchcancel', () => { cancelGesture(); }, { capture: true });

  // --- mouse

  document.addEventListener('mousedown', (e) => {
    if (!bulkOn || e.button !== 0) return;
    if (e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents) return;
    const li = rowOf(e.target);
    if (!li) return;
    e.preventDefault();              // no text selection while dragging
    e.stopPropagation();
    startDrag(li);
  }, true);

  document.addEventListener('mousemove', (e) => {
    if (!drag || pending) return;
    if (e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents) return;
    dragTo(e.clientX, e.clientY);
    kickEdge();
  }, true);

  document.addEventListener('mouseup', () => { if (drag && !pending) cancelGesture(); }, true);

  // While the mode is on, a line does nothing but select: no open, no play,
  // no link, no menu. Capture phase, so it never reaches the line's handlers.
  document.addEventListener('click', (e) => {
    if (rowOf(e.target)) { e.preventDefault(); e.stopPropagation(); }
  }, true);
  document.addEventListener('contextmenu', (e) => {
    if (rowOf(e.target)) { e.preventDefault(); e.stopPropagation(); }
  }, true);

  // ---------------------------------------------------------------- actions

  function say(message, colour) {
    if (typeof window.showSyncConfirmation === 'function') window.showSyncConfirmation(message, colour);
    else console.log('[bulk]', message);
  }

  async function runAction(what) {
    if (what === 'close') { setBulkMode(false); return; }
    if (what === 'all') { selectAll(); return; }

    const videos = [...selected.values()];
    if (!videos.length) return;

    if (what === 'basket') {
      if (typeof window.addToBasket !== 'function') { alert('The basket is not available here.'); return; }
      // addToBasket already ignores a file that's in there, so the count
      // comes from the basket itself rather than from a second check here.
      const before = Array.isArray(window.basketVideos) ? window.basketVideos.length : 0;
      videos.forEach(v => window.addToBasket({
        ...v,
        oneDriveId: v.oneDriveId ?? v.idFromAPI,
        driveId: v.driveId ?? null
      }));
      const added = (Array.isArray(window.basketVideos) ? window.basketVideos.length : 0) - before;
      if (typeof window.updateBasketHighlights === 'function') window.updateBasketHighlights();
      say(`✅ Added ${added} to the basket${added !== videos.length ? ` (${videos.length - added} already in it)` : ''}`);
      clearSelection();
      return;
    }

    if (what === 'refresh') {
      if (typeof window.refreshVideoFromDb !== 'function') { alert('Refresh is not available here.'); return; }
      const count = bar?.querySelector('#bulkCount');
      let done = 0, failed = 0;
      for (const v of videos) {
        try {
          await window.refreshVideoFromDb(v, { silent: true });
          if (typeof window.refreshAfterDbPull === 'function') await window.refreshAfterDbPull(v);
          done++;
        } catch (err) {
          console.warn('[bulk] refresh failed for', v.filename, err);
          failed++;
        }
        if (count) count.textContent = `${done + failed}/${videos.length}`;
      }
      say(failed ? `⚠️ Refreshed ${done}, ${failed} failed` : `✅ Refreshed ${done}`, failed ? '#c0392b' : undefined);
      clearSelection();
      return;
    }

    if (what === 'stash') { await openBulkStash(videos); return; }

    if (what === 'delete') {
      if (typeof window.showBulkDeleteModal !== 'function') { alert('Delete is not available here.'); return; }
      // Its own confirmation, its own progress, and it removes the rows.
      await window.showBulkDeleteModal(videos);
      clearSelection();
    }
  }

  /**
   * Stash details for the whole selection (picker 14.30 / native 14.44).
   *
   * The Correct details form from the player's Stash modal, in bulk mode: the
   * same fields, the same vocabulary and the same dropdowns, applied to every
   * selected file. Borrows that modal's id so it wears its stylesheet.
   */
  async function openBulkStash(videos) {
    if (!window.scrayStashEdit || typeof window.scrayStashEdit.open !== 'function') {
      alert('Stash editing is not available here.');
      return;
    }
    const keys = [...new Set(videos
      .map(v => v.videoKey || (window.scrayVideoKey ? window.scrayVideoKey(v.filename) : ''))
      .filter(Boolean))];
    if (!keys.length) { alert('Those files have no catalogue key.'); return; }

    document.getElementById('stashModal')?.remove();
    const modal = document.createElement('div');
    modal.className = 'basket-json-modal';
    modal.id = 'stashModal';
    modal.style.cssText = 'transform:none;padding:0;z-index:2147483647;';
    modal.innerHTML =
      '<div class="basket-json-modal-content" style="transform:none;max-width:640px;max-height:82vh;' +
           'display:flex;flex-direction:column;overflow:hidden;">' +
        '<h3 style="margin-top:0;flex:0 0 auto;">Stash details</h3>' +
        '<div id="bulkStashBody" style="flex:1 1 auto;min-height:0;overflow-y:auto;' +
             '-webkit-overflow-scrolling:touch;">Loading&hellip;</div>' +
        '<div id="bulkStashFooter" style="display:flex;gap:8px;margin-top:14px;flex:0 0 auto;"></div>' +
      '</div>';
    document.body.appendChild(modal);

    await new Promise(resolve => {
      window.scrayStashEdit.open({
        host: modal.querySelector('#bulkStashBody'),
        actions: modal.querySelector('#bulkStashFooter'),
        overlay: modal,
        video: videos[0] || {},
        videoKey: keys[0],
        bulkKeys: keys,
        onDone: (res) => {
          modal.remove();
          if (res && res.saved !== undefined) {
            say(res.skipped
              ? `⚠️ ${res.saved} updated, ${res.skipped} skipped${res.why ? ` (${res.why})` : ''}`
              : `✅ Stash details set on ${res.saved} file${res.saved === 1 ? '' : 's'}`,
              res.skipped ? '#c0392b' : undefined);
            clearSelection();
            if (typeof window.filterDisplayedByFilename === 'function') {
              window.skipSearchScroll = true;
              window.skipPanelAutoOpen = true;
              window.filterDisplayedByFilename();
            }
          }
          resolve();
        }
      });
    });
  }

  // ---------------------------------------------------------------- buttons

  // Bulk (index.html / index.php, left of Clear) and the sort row's Clear.
  // Delegated, so it doesn't matter which of the two is drawn first.
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (!t?.closest) return;
    if (t.closest('#bulkModeBtn')) { e.preventDefault(); setBulkMode(!bulkOn); return; }
    if (t.closest('.sort-btn[data-list-sort="clear"]') && selected.size) clearSelection();
  });

  // ---------------------------------------------------------------- upkeep

  // Rows come and go constantly - pagination, a re-filter, a variant swap.
  // Re-paint whatever arrives rather than asking render.js to tell us.
  const observer = new MutationObserver((records) => {
    let touched = false;
    records.forEach(r => r.addedNodes.forEach(node => {
      if (node.nodeType !== 1) return;
      if (node.matches?.('li.lc-row') && node._scrayVideo) { paintRow(node); touched = true; }
      node.querySelectorAll?.('li.lc-row').forEach(li => { if (li._scrayVideo) { paintRow(li); touched = true; } });
    }));
    if (touched) paintBar();
  });

  function watch() {
    containers().forEach(c => observer.observe(c, { childList: true, subtree: true }));
  }

  window.addEventListener('resize', placeBar);
  window.addEventListener('orientationchange', () => setTimeout(placeBar, 250));

  document.addEventListener('DOMContentLoaded', () => { ensureBar(); watch(); paintAll(); });
  if (document.readyState !== 'loading') { ensureBar(); watch(); paintAll(); }

  // For the console, and for anything that wants to clear up after itself.
  window.scrayBulkSelection = {
    ids: () => [...selected.keys()],
    videos: () => [...selected.values()],
    clear: clearSelection,
    setMode: setBulkMode,
    // A column set to "Bulk select this line" (render.js, Tap a column):
    // turns the mode on and takes that line.
    selectRow: (li) => {
      if (!li || !li._scrayVideo) return;
      if (!bulkOn) setBulkMode(true);
      if (!selected.has(idOf(li._scrayVideo))) setSelected(li, true);
    },
    isOn: () => bulkOn
  };
})();
// ===== END FILE: scray-bulk-select.js =====

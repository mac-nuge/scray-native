// ===== scray-bulk-select.js =====
//
// Bulk actions on the main list and the random panel (picker 13.201 / native 13.199).
//
// Tap a row's number to select it - the line goes yellow - or press and drag
// down the numbers to take a run of them in one go. A bar appears above the
// corner buttons with Basket, Refresh Data and Delete, each applied to
// everything selected.
//
// Deliberately NOT part of scrayBuildListRow: the rows are rebuilt constantly
// (pagination, variants, a re-filter), so this hangs off the containers
// instead. Selection is kept by video id, and a MutationObserver re-paints
// rows as they come back. Nothing in render.js had to change.
//
// The history and basket lists have their own tick on the number
// (cfg.select) - they are not in SCRAY_BULK_LISTS, so the two never meet.
//
// picker 13.202 / native 13.200: the main list only (the random panel was
// dropped), and the studio cell selects as well as the number - the number
// alone is a narrow target on a phone.

(function scrayBulkSelect() {
  if (window.__scrayBulkSelectBound) return;
  window.__scrayBulkSelectBound = true;

  // ⚙️ Which lists take part. The main list, and only the main list.
  const SCRAY_BULK_LISTS = ['taggedVideosContainer'];
  // ⚙️ What a tap or drag lands on to select a row.
  const SCRAY_BULK_HANDLES = '.lc-num, .lc-studio';
  // ⚙️ Gap between the action bar and the corner buttons it sits above.
  const BAR_GAP_PX = 8;

  /** id -> video, so an action still has the file after a re-render. */
  const selected = new Map();
  /** The drag in progress: { adding } - whether it selects or deselects. */
  let drag = null;
  let bar = null;

  const containers = () => SCRAY_BULK_LISTS
    .map(id => document.getElementById(id))
    .filter(Boolean);

  const idOf = (video) => String(video?.oneDriveId ?? video?.idFromAPI ?? '');

  const rowOf = (el) => {
    const handle = el?.closest?.(SCRAY_BULK_HANDLES);
    if (!handle) return null;
    const li = handle.closest('li.lc-row');
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

  // ---------------------------------------------------------------- the bar

  function ensureBar() {
    if (bar && bar.isConnected) return bar;
    bar = document.createElement('div');
    bar.id = 'bulkActionBar';
    bar.hidden = true;
    bar.innerHTML = `
      <span class="bulk-count" id="bulkCount">0</span>
      <button type="button" class="bulk-btn bulk-basket" data-bulk="basket">Basket</button>
      <button type="button" class="bulk-btn bulk-refresh" data-bulk="refresh">Refresh Data</button>
      <button type="button" class="bulk-btn bulk-delete" data-bulk="delete">Delete</button>
      <button type="button" class="bulk-btn bulk-clear" data-bulk="clear" title="Clear the selection">✕</button>`;
    bar.addEventListener('click', (e) => {
      const what = e.target?.dataset?.bulk;
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
    bar.hidden = n === 0;
    if (!n) return;
    const count = bar.querySelector('#bulkCount');
    if (count) count.textContent = String(n);
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

  // ---------------------------------------------------------------- gestures
  //
  // Pointer events, not click: the drag has to keep selecting as the finger
  // moves over numbers it never pressed. elementFromPoint rather than
  // pointerenter, because a touch pointer is captured by the element it
  // started on and no other element hears from it.

  document.addEventListener('pointerdown', (e) => {
    const li = rowOf(e.target);
    if (!li) return;
    // Stops the list scrolling under the finger AND stops the row opening.
    e.preventDefault();
    const adding = !selected.has(idOf(li._scrayVideo));
    drag = { adding };
    setSelected(li, adding);
  }, { passive: false });

  document.addEventListener('pointermove', (e) => {
    if (!drag) return;
    e.preventDefault();
    const li = rowOf(document.elementFromPoint(e.clientX, e.clientY));
    if (!li) return;
    if (selected.has(idOf(li._scrayVideo)) !== drag.adding) setSelected(li, drag.adding);
  }, { passive: false });

  const endDrag = () => { drag = null; };
  document.addEventListener('pointerup', endDrag);
  document.addEventListener('pointercancel', endDrag);

  // The tap on the number must not also open the row. Capture phase, so it
  // never reaches the line's own handler.
  document.addEventListener('click', (e) => {
    if (rowOf(e.target)) { e.preventDefault(); e.stopPropagation(); }
  }, true);

  // ---------------------------------------------------------------- actions

  function say(message, colour) {
    if (typeof window.showSyncConfirmation === 'function') window.showSyncConfirmation(message, colour);
    else console.log('[bulk]', message);
  }

  async function runAction(what) {
    if (what === 'clear') { clearSelection(); return; }

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

    if (what === 'delete') {
      if (typeof window.showBulkDeleteModal !== 'function') { alert('Delete is not available here.'); return; }
      // Its own confirmation, its own progress, and it removes the rows.
      await window.showBulkDeleteModal(videos);
      clearSelection();
    }
  }

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
    clear: clearSelection
  };
})();
// ===== END FILE: scray-bulk-select.js =====

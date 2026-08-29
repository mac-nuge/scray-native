
// bookmarks-page.js  —  Scray Native
//
// Drives bookmarks.html. The page is a copy of index.html's shell, so every
// element the shared scripts reach for at DOMContentLoaded still exists; the
// parts this page doesn't use are hidden rather than removed. This file owns
// three things and nothing else:
//
//   1. The bookmark list itself (#bmList), one row per bookmark.
//   2. The note cloud (#bmNoteCloud), which replaces the AT dropdown.
//   3. The sort buttons, which carry bm-prefixed IDs so randomiser.js's own
//      (null-guarded) binds simply don't find them.
//
// Rows are drawn by window.scrayBuildVideoRow, the same builder the main list
// uses, so the buttons, context menu and click behaviour stay identical for
// free. Each row gets a shallow CLONE of its video carrying __bmStartAt, which
// playVideoInline reads as the start point - that is what makes P, > and <
// and the random list all open at the bookmark rather than at 0.

(function () {
  'use strict';

  // ⚙️ How many bookmarks a random list holds. Mirrors the main page's random
  // count if that dropdown has a value, otherwise this.
  const DEFAULT_RANDOM_COUNT = 25;

  // Every bookmark on the device, one entry per bookmark (not per video).
  let allEntries = [];
  // What's on screen right now, after note filter + search + sort.
  let visibleEntries = [];
  // Notes currently selected in the cloud. Empty = no note filter.
  const selectedNotes = new Set();

  let noteSortMode = 'count';   // 'count' | 'alpha'
  let rowSort = { key: null, dir: 'none' };

  const NO_NOTE = '(no note)';

  // ---------------------------------------------------------------- data

  /**
   * Flatten the local mirror into one entry per bookmark.
   *
   * Reads IndexedDB, not the API: bookmarks ride the same delta stream as the
   * video rows (see api.php's `pull`), so the mirror already holds them and
   * this works offline. It also means the note counts match the rows exactly -
   * a cloud pill can never advertise bookmarks the page can't show.
   */
  async function loadEntries() {
    const videos = await window.getAllVideos();
    const entries = [];

    videos.forEach(video => {
      if (!Array.isArray(video.bookmarks) || !video.bookmarks.length) return;
      video.bookmarks.forEach(bm => {
        const note = (bm.note || '').trim();
        // A shallow clone per bookmark. oneDriveId is preserved, so the basket,
        // history, scoring and every file operation still address the right
        // video; __bmStartAt is the only addition.
        const clone = Object.assign({}, video, {
          __bmStartAt: bm.time,
          __bmNote: note
        });
        entries.push({ video: clone, time: bm.time, note });
      });
    });

    allEntries = entries;
    console.log(`[bookmarks] ${entries.length} bookmark(s) across ${videos.length} video(s)`);
  }

  /** note -> count, over every entry (not just the visible ones). */
  function noteCounts() {
    const counts = new Map();
    allEntries.forEach(e => {
      const key = e.note || NO_NOTE;
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return counts;
  }

  // ---------------------------------------------------------------- filter + sort

  function applyFilters() {
    const searchEl = document.getElementById('filenameSearchBox');
    const term = (searchEl?.value || '').trim().toLowerCase();

    let list = allEntries;

    if (selectedNotes.size) {
      list = list.filter(e => selectedNotes.has(e.note || NO_NOTE));
    }

    if (term) {
      list = list.filter(e =>
        (e.note || '').toLowerCase().includes(term) ||
        (e.video.filename || '').toLowerCase().includes(term) ||
        (e.video.path || '').toLowerCase().includes(term)
      );
    }

    visibleEntries = sortEntries(list);
  }

  /**
   * Sort by whichever button is armed. The five video-attribute sorts reuse
   * randomiser.js's exported comparators rather than re-implementing them, so
   * the ordering is identical to the main list. Time and Note are this page's
   * own, since a bookmark has no equivalent on the main page.
   */
  function sortEntries(list) {
    if (!rowSort.key || rowSort.dir === 'none') return list.slice();

    if (rowSort.key === 'time') {
      return list.slice().sort((a, b) =>
        rowSort.dir === 'asc' ? a.time - b.time : b.time - a.time);
    }
    if (rowSort.key === 'note') {
      return list.slice().sort((a, b) => {
        const an = (a.note || '').toLowerCase();
        const bn = (b.note || '').toLowerCase();
        return rowSort.dir === 'asc' ? an.localeCompare(bn) : bn.localeCompare(an);
      });
    }

    const fn = {
      size: window.sortVideosBySize,
      created: window.sortVideosByCreated,
      modified: window.sortVideosByModified,
      filename: window.sortVideosByFilename,
      score: window.sortVideosByScore
    }[rowSort.key];
    if (typeof fn !== 'function') return list.slice();

    // The comparators take videos, not entries. Sort the videos, then walk the
    // result and pull the matching entries back out - a video can appear more
    // than once (several bookmarks), so entries are consumed in order.
    const sortedVideos = fn(list.map(e => e.video), rowSort.dir);
    const byVideo = new Map();
    list.forEach(e => {
      if (!byVideo.has(e.video)) byVideo.set(e.video, []);
      byVideo.get(e.video).push(e);
    });
    const out = [];
    sortedVideos.forEach(v => {
      const bucket = byVideo.get(v);
      if (bucket && bucket.length) out.push(bucket.shift());
    });
    return out;
  }

  // ---------------------------------------------------------------- render

  /** "Kissing  00:07:08 " - the bit that leads each row. */
  function buildRowPrefix(entry) {
    const frag = document.createDocumentFragment();

    const noteEl = document.createElement('span');
    noteEl.className = 'bm-row-note' + (entry.note ? '' : ' is-empty');
    noteEl.textContent = entry.note || 'no note';
    frag.appendChild(noteEl);

    const timeEl = document.createElement('span');
    timeEl.className = 'bm-row-time';
    timeEl.textContent = formatDuration(entry.time * 1000);
    frag.appendChild(timeEl);

    return frag;
  }

  function renderList() {
    const container = document.getElementById('bmList');
    if (!container) return;
    container.innerHTML = '';

    if (!visibleEntries.length) {
      const li = document.createElement('li');
      li.style.cssText = 'color:#999; font-style:italic; list-style:none;';
      li.textContent = allEntries.length
        ? 'No bookmarks match the current filter.'
        : 'No bookmarks found. Sync, or add some from the player.';
      container.appendChild(li);
    } else {
      visibleEntries.forEach((entry, index) => {
        const li = window.scrayBuildVideoRow(entry.video, 'bookmarks', index, {
          prefix: buildRowPrefix(entry)
        });
        container.appendChild(li);
      });
    }

    // What > and < walk. playVideoInline reads __bmStartAt off each clone, so
    // stepping through the list keeps landing on the bookmarks.
    window.scrayBookmarkVideos = visibleEntries.map(e => e.video);

    const stats = document.getElementById('videoStats');
    if (stats) {
      const videos = new Set(visibleEntries.map(e => e.video.oneDriveId)).size;
      stats.textContent = `Bookmarks: ${visibleEntries.length}`
        + ` of ${allEntries.length} | Videos: ${videos}`;
    }
  }

  /**
   * The random list lives in #playlist - the blue panel - exactly as it does
   * on the main page, and leaves #bmList untouched. The two lists are separate.
   *
   * Rows get the 'random' context and filteredVideosGlobal is pointed at them,
   * which is the pairing player.js already understands. So > and < walk the
   * random list when you played from it, and the bookmark list when you
   * played from that - no extra player changes needed.
   */
  function renderRandomList(entries) {
    const container = document.getElementById('playlist');
    if (!container) return;
    container.innerHTML = '';

    entries.forEach((entry, index) => {
      container.appendChild(
        window.scrayBuildVideoRow(entry.video, 'random', index, {
          prefix: buildRowPrefix(entry)
        })
      );
    });

    window.filteredVideosGlobal = entries.map(e => e.video);
    console.log(`[bookmarks] random list: ${entries.length} bookmark(s)`);
  }

  function renderNoteCloud() {
    const cloud = document.getElementById('bmNoteCloud');
    if (!cloud) return;
    cloud.innerHTML = '';

    const counts = noteCounts();
    let notes = Array.from(counts.keys());

    if (noteSortMode === 'alpha') {
      notes.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    } else {
      notes.sort((a, b) => (counts.get(b) - counts.get(a)) || a.localeCompare(b));
    }

    notes.forEach(note => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'bm-note-pill' + (selectedNotes.has(note) ? ' is-on' : '');
      btn.title = note;
      btn.textContent = note;

      const count = document.createElement('span');
      count.className = 'bm-note-count';
      count.textContent = `(${counts.get(note)})`;
      btn.appendChild(count);

      btn.addEventListener('click', () => {
        if (selectedNotes.has(note)) selectedNotes.delete(note);
        else selectedNotes.add(note);
        renderNoteCloud();
        refresh();
      });

      cloud.appendChild(btn);
    });
  }

  function refresh() {
    applyFilters();
    renderList();
  }

  // ---------------------------------------------------------------- controls

  /**
   * Cycle none -> asc -> desc, clearing the other buttons. Deliberately simple
   * and local: randomiser.js's equivalent also drives paginationState and the
   * landscape panel, neither of which this page uses.
   */
  const SORT_BUTTONS = [
    { id: 'bmSortSizeBtn',     key: 'size',     label: 'Size'   },
    { id: 'bmSortCreatedBtn',  key: 'created',  label: 'Create' },
    { id: 'bmSortModifiedBtn', key: 'modified', label: 'Mod'    },
    { id: 'bmSortFilenameBtn', key: 'filename', label: 'File'   },
    { id: 'bmSortScoreBtn',    key: 'score',    label: 'Score'  },
    { id: 'bmSortTimeBtn',     key: 'time',     label: 'Time'   },
    { id: 'bmSortNoteBtn',     key: 'note',     label: 'Note'   }
  ];

  function paintSortButtons() {
    SORT_BUTTONS.forEach(({ id, key, label }) => {
      const btn = document.getElementById(id);
      if (!btn) return;
      const on = rowSort.key === key && rowSort.dir !== 'none';
      const arrow = !on ? '' : (rowSort.dir === 'asc' ? ' ↑' : ' ↓');
      btn.textContent = label + arrow;
      btn.dataset.sortState = on ? rowSort.dir : 'none';
      btn.style.background = on ? '#007bff' : '#555';
    });
  }

  function wireSortButtons() {
    SORT_BUTTONS.forEach(({ id, key }) => {
      const btn = document.getElementById(id);
      if (!btn) return;
      btn.addEventListener('click', () => {
        const states = ['none', 'asc', 'desc'];
        const next = (rowSort.key === key)
          ? states[(states.indexOf(rowSort.dir) + 1) % states.length]
          : 'asc';
        rowSort = { key: next === 'none' ? null : key, dir: next };
        paintSortButtons();
        refresh();
      });
    });
    paintSortButtons();
  }

  function wireNoteSortButtons() {
    const alpha = document.getElementById('bmNoteSortAlphaBtn');
    const count = document.getElementById('bmNoteSortCountBtn');
    const clear = document.getElementById('bmNoteClearBtn');

    const paint = () => {
      if (alpha) alpha.style.background = noteSortMode === 'alpha' ? '#007bff' : '#555';
      if (count) count.style.background = noteSortMode === 'count' ? '#007bff' : '#555';
    };

    alpha?.addEventListener('click', () => { noteSortMode = 'alpha'; paint(); renderNoteCloud(); });
    count?.addEventListener('click', () => { noteSortMode = 'count'; paint(); renderNoteCloud(); });
    clear?.addEventListener('click', () => {
      selectedNotes.clear();
      renderNoteCloud();
      refresh();
    });
    paint();
  }

  /**
   * R generates a random list of bookmarks, the same way the main page's R
   * generates a random list of videos.
   *
   * Clone-and-replace rather than addEventListener: randomiser.js already
   * bound its own handler to this button at DOMContentLoaded, and that one
   * calls generateRandomPlaylistByTags(), which has nothing to do with
   * bookmarks. Replacing the node drops the old listener with it.
   */
  function takeOverRandomButton() {
    // Clone-and-replace does NOT work here. randomiser.js's DOMContentLoaded
    // handler is async - it awaits populateTagDropdowns() and friends before
    // binding #quickRandomBtn, so it binds after this file has already run and
    // simply binds to the clone. A capture-phase listener on document fires
    // before any listener on the button itself, regardless of when they were
    // added, and stopping propagation there means the event never reaches it.
    document.addEventListener('click', (e) => {
      const btn = (e.target instanceof Element) ? e.target.closest('#quickRandomBtn') : null;
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();

      const countEl = document.getElementById('randomCount');
      const wanted = parseInt(countEl?.value, 10) || DEFAULT_RANDOM_COUNT;

      // Pick from whatever the note cloud and search box currently allow, so
      // "random" respects the filter rather than ignoring it.
      applyFilters();
      const pool = visibleEntries.slice();
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      renderRandomList(pool.slice(0, Math.min(wanted, pool.length)));

      document.getElementById('playlist')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, true);
  }

  function wireSearchBox() {
    const box = document.getElementById('filenameSearchBox');
    if (!box) return;
    box.placeholder = 'Filter notes / files';
    // randomiser.js binds its own input handler here and calls
    // filterDisplayedByFilename(), which repaints #taggedVideosContainer -
    // hidden on this page, so it is a no-op rather than a conflict. Ours runs
    // alongside it.
    box.addEventListener('input', refresh);
  }

  // ---------------------------------------------------------------- boot

  document.addEventListener('DOMContentLoaded', async () => {
    document.body.classList.add('scray-bookmarks-page');

    wireSortButtons();
    wireNoteSortButtons();
    wireSearchBox();
    takeOverRandomButton();

    try {
      await loadEntries();
    } catch (err) {
      console.error('[bookmarks] could not load bookmarks:', err);
    }

    renderNoteCloud();
    refresh();
  });

  // Let other code (and the console) force a rebuild after a sync or an edit.
  window.scrayRefreshBookmarksPage = async function () {
    await loadEntries();
    renderNoteCloud();
    refresh();
  };
})();

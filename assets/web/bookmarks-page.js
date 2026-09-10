
// bookmarks-page.js  —  Scray Native
//
// Drives bookmarks.html. The page is a copy of index.html's shell, so it has the same
// list, filters, tag clouds, pills bar, basket, history and player as the main
// page - and this file's job is to make all of that work on BOOKMARKS instead
// of videos, while re-using it rather than keeping a second copy of any of it.
//
// How: one entry per bookmark, as a shallow clone of its video carrying
//   __bmStartAt  the bookmark's time - playVideoInline starts there, so P, the
//                row title, > and <, and X all open at the bookmark
//   __bmNote     its note, mapped to its display name
// and the main page's own pipeline is pointed at those entries:
//
//   getFilteredVideos    the main filter (tags, studios, performers, stash tags,
//                        excludes, toggles) runs on the videos as usual; its
//                        result is then expanded to bookmarks and the note
//                        filter applied. Everything that asks it - the list,
//                        R's random list, X - therefore gets bookmarks.
//   matchesSearchQuery   the search box also matches the note.
//   updateVideoStats     counts bookmarks, and keeps the last filtered set for
//                        the player's Xb.
//   scrayFacetCounts     the tag clouds count bookmarks, and only over
//                        bookmarked videos.
//
// So the list is the main list: the same column rows (plus a Note column),
// the same heading sorts and sort buttons, the same open rows and taps.
//
// Notes are a fourth facet class, 'note', opened by the NOTE button into the
// same cloud modal as AT / STU / PERF / STAG, with its own pills in the bar.

(function () {
  'use strict';

  // The cloud's name for a bookmark with no note, so it can be picked too.
  const NO_NOTE = '(no note)';

  document.documentElement.classList.add('scray-bookmarks-page');

  // ---------------------------------------------------------------- columns

  // # | Note | Studio | Perf | File | ★ | Size, on the list and the random list.
  if (window.SCRAY_LIST_COLUMNS_FOR) {
    ['main', 'random'].forEach(list => {
      const cols = window.SCRAY_LIST_COLUMNS_FOR[list];
      if (cols && !cols.includes('lc-note')) cols.splice(1, 0, 'lc-note');
    });
  }

  // ---------------------------------------------------------------- entries

  function noteOf(bm) {
    const raw = (bm.note || '').trim();
    // Mapped, so two raw spellings of one note are one cloud value and one
    // pill. This page never writes a bookmark back, so the stored note is
    // never replaced by its display form.
    return window.scrayMapName ? window.scrayMapName('note', raw) : raw;
  }

  /** Videos -> one entry per bookmark, in time order within each video. */
  function expandToBookmarks(videos) {
    const out = [];
    (videos || []).forEach(video => {
      if (!video || !Array.isArray(video.bookmarks) || !video.bookmarks.length) return;
      video.bookmarks
        .filter(bm => bm && typeof bm.time === 'number')
        .sort((a, b) => a.time - b.time)
        .forEach(bm => {
          // oneDriveId is untouched, so the basket, history, scores and every
          // file operation still address the real video.
          out.push(Object.assign({}, video, { __bmStartAt: bm.time, __bmNote: noteOf(bm) }));
        });
    });
    return out;
  }

  // ---------------------------------------------------------------- note facet

  window.scrayFacetFilters = window.scrayFacetFilters || {};
  window.scrayFacetExcludes = window.scrayFacetExcludes || {};
  window.scrayFacetFilters.note = window.scrayFacetFilters.note || new Set();
  window.scrayFacetExcludes.note = window.scrayFacetExcludes.note || new Set();
  if (window.SCRAY_FACET_META) {
    window.SCRAY_FACET_META.note = { label: 'Notes', pill: 'floating-tag-note' };
  }
  const noteIncludes = window.scrayFacetFilters.note;
  const noteExcludes = window.scrayFacetExcludes.note;

  /**
   * Notes narrow the bookmarks the rest of the filter leaves. Picked notes are
   * ANY-of among themselves - a bookmark has one note, so ALL could never
   * match - and an excluded note always drops its bookmarks.
   */
  function passesNoteFilter(entry) {
    const key = entry.__bmNote || NO_NOTE;
    if (noteExcludes.size && noteExcludes.has(key)) return false;
    if (noteIncludes.size && !noteIncludes.has(key)) return false;
    return true;
  }

  // ---------------------------------------------------------------- pipeline

  // All four are top-level functions in randomiser.js, so their global
  // bindings are properties of window: replacing them here changes what the
  // bare-name calls inside randomiser.js reach.
  const baseGetFilteredVideos = window.getFilteredVideos;
  if (typeof baseGetFilteredVideos === 'function') {
    window.getFilteredVideos = async function (...args) {
      const videos = await baseGetFilteredVideos.apply(this, args);
      return expandToBookmarks(videos).filter(passesNoteFilter);
    };
  }

  const baseMatchesSearchQuery = window.matchesSearchQuery;
  if (typeof baseMatchesSearchQuery === 'function') {
    window.matchesSearchQuery = function (video, query) {
      if (!video || video.__bmStartAt == null) return baseMatchesSearchQuery(video, query);
      // The main haystack, with the note in front.
      const haystack = `${video.__bmNote || ''} ${video.filename} ${video.path} `
        + `${window.scrayStashNames ? window.scrayStashNames.text(video) : ''}`;
      const hay = haystack.toLowerCase();
      const has = t => hay.includes(t);
      return query.phrases.every(has) && query.required.every(has)
        && !query.excluded.some(has) && query.optional.every(has);
    };
  }

  // The last filtered set of bookmarks, after the search box. Xb reads it.
  let lastFilteredEntries = null;

  // Stats line: bookmarks and the files they're in, instead of files and size.
  window.updateVideoStats = async function (filteredList = null) {
    let entries = filteredList;
    if (Array.isArray(entries)) {
      lastFilteredEntries = entries;
    } else {
      try {
        entries = expandToBookmarks(await window.getAllVideos());
      } catch (err) {
        entries = [];
      }
    }
    const statsDiv = document.getElementById('videoStats');
    if (!statsDiv) return;
    const files = new Set(entries.map(e => e.oneDriveId ?? e.idFromAPI)).size;
    statsDiv.textContent = `Bookmarks: ${entries.length} | Videos: ${files}`;
  };

  /**
   * The FLS player's Xb asks here first. The currently filtered bookmarks when
   * any filter or the search box is armed; null ("no opinion") when nothing
   * is, so Xb then picks from every bookmark, as on the main page.
   */
  window.scrayFilteredBookmarkEntries = function () {
    const term = (document.getElementById('filenameSearchBox')?.value || '').trim();
    const terms = typeof window.scrayTotalFilterTerms === 'function' ? window.scrayTotalFilterTerms() : 0;
    const excluded = noteExcludes.size
      + ['studio', 'performer', 'stashtag'].reduce((n, k) => n + ((window.scrayFacetExcludes[k] || {}).size || 0), 0)
      + (window.$ ? (($('#excludeTagSelect').val() || []).length) : 0);
    if (!term && !terms && !excluded) return null;
    return (lastFilteredEntries || []).map(v => ({ video: v, time: v.__bmStartAt, note: v.__bmNote }));
  };

  // ---------------------------------------------------------------- clouds

  /**
   * value -> number of BOOKMARKS carrying it, over bookmarked videos only.
   * A studio's count is how many bookmarks you'd get by picking it, which is
   * what matters on this page; a note's is how many bookmarks have that note.
   */
  window.scrayFacetCounts = async function (kind, genderMode) {
    const videos = await window.getAllVideos();
    const counts = new Map();
    const bump = (val, n) => { if (val) counts.set(val, (counts.get(val) || 0) + n); };
    videos.forEach(v => {
      const bms = Array.isArray(v.bookmarks) ? v.bookmarks.filter(b => b && typeof b.time === 'number') : [];
      if (!bms.length) return;
      if (kind === 'note') {
        bms.forEach(bm => bump(noteOf(bm) || NO_NOTE, 1));
        return;
      }
      let values;
      if (kind === 'performer') {
        const p = window.scrayStashNames && window.scrayStashNames.parts(v);
        if (!p) return;
        values = genderMode === 'female' ? (p.performerListF || [])
               : genderMode === 'male'   ? (p.performerListM || [])
               : (p.performerListAll || []);
      } else {
        values = typeof window.scrayFacetValues === 'function' ? window.scrayFacetValues(v, kind) : [];
      }
      new Set(values || []).forEach(val => bump(val, bms.length));
    });
    return counts;
  };

  // Notes count towards "more than one term" (the intersect and Clear all
  // pills) and are cleared by Clear all.
  const baseTotalFilterTerms = window.scrayTotalFilterTerms;
  if (typeof baseTotalFilterTerms === 'function') {
    window.scrayTotalFilterTerms = function () {
      return baseTotalFilterTerms() + noteIncludes.size;
    };
  }

  const baseClearAll = window.scrayClearAllFilters;
  if (typeof baseClearAll === 'function') {
    window.scrayClearAllFilters = function (ev) {
      noteIncludes.clear();
      noteExcludes.clear();
      return baseClearAll(ev);
    };
  }

  const baseClearAllFilters = window.clearAllFilters;
  if (typeof baseClearAllFilters === 'function') {
    window.clearAllFilters = function (...args) {
      noteIncludes.clear();
      noteExcludes.clear();
      return baseClearAllFilters.apply(this, args);
    };
  }

  // ---------------------------------------------------------------- pills

  /**
   * Note pills in the floating bar. updateFloatingTagPillsFromCommon lives
   * inside populateTagDropdowns and repaints the bar from scratch whenever a
   * filter changes, knowing only its own four classes - so this watches the
   * bar and adds the note pills after each repaint, beside the other facet
   * pills and before the intersect / clear / search pills.
   */
  function paintNotePills(bar) {
    const want = [...Array.from(noteIncludes).map(n => 'in:' + n), ...Array.from(noteExcludes).map(n => 'ex:' + n)];
    const have = Array.from(bar.querySelectorAll(':scope > [data-bm-note]')).map(p => p.dataset.bmNote);
    if (want.length === have.length && want.every((w, i) => w === have[i])) return;

    bar.querySelectorAll(':scope > [data-bm-note]').forEach(p => p.remove());
    const before = bar.querySelector(':scope > .floating-tag-intersect, :scope > .floating-tag-intersect-off, '
      + ':scope > .floating-tag-clearall, :scope > .floating-tag-search, :scope > .floating-tag-search-wrap, '
      + ':scope > .floating-tag-exclude');

    const add = (pill) => bar.insertBefore(pill, before || null);
    noteIncludes.forEach(note => {
      const pill = document.createElement('span');
      pill.className = 'floating-tag-pill floating-tag-note';
      pill.dataset.bmNote = 'in:' + note;
      pill.textContent = note;
      pill.title = 'Click to remove this note filter';
      pill.addEventListener('click', () => {
        noteIncludes.delete(note);
        window.scrayRefreshFilters?.();
      });
      add(pill);
    });
    noteExcludes.forEach(note => {
      const pill = document.createElement('span');
      pill.className = 'floating-tag-pill floating-tag-fexclude fx-note';
      pill.dataset.bmNote = 'ex:' + note;
      pill.textContent = '− ' + note;
      pill.title = 'Excluded - click to stop excluding it';
      pill.addEventListener('click', () => {
        noteExcludes.delete(note);
        window.scrayRefreshFilters?.();
      });
      add(pill);
    });
  }

  function watchPillsBar() {
    const bar = document.getElementById('floatingTagPillsBar');
    if (!bar) return;
    new MutationObserver(() => paintNotePills(bar)).observe(bar, { childList: true });
    paintNotePills(bar);
  }

  // ---------------------------------------------------------------- controls

  function wireNoteButton() {
    document.getElementById('btnNOTE')?.addEventListener('click', () => {
      if (typeof window.showTagCloudModal === 'function') window.showTagCloudModal('note');
    });
  }

  function wireSearchBox() {
    const box = document.getElementById('filenameSearchBox');
    if (box) box.placeholder = 'Filter notes / files';
  }

  // ---------------------------------------------------------------- boot

  document.addEventListener('DOMContentLoaded', async () => {
    document.body.classList.add('scray-bookmarks-page');
    wireNoteButton();
    wireSearchBox();
    watchPillsBar();

    // The mirror is all this page reads. index.php/index.html pull on boot and
    // this page never used to, so a bookmark that arrived server-side stayed
    // invisible here until the main page had been visited. Pull, then draw.
    //
    // Two engines, because the apps boot differently: Picker's
    // refreshMetadataFromDb re-reads from since=0; Native goes through the
    // ordinary delta pull.
    try {
      if (typeof window.ensureMetadataFresh === 'function') {
        await window.ensureMetadataFresh();
      } else if (typeof window.scrayPullDeltas === 'function' &&
                 typeof window.scrayApplyPulledRow === 'function') {
        await window.scrayPullDeltas(window.scrayApplyPulledRow);
      }
    } catch (err) {
      // A failed sync is not a failed page. Show the local copy.
      console.warn('[bookmarks] sync before load failed, showing the local copy:', err);
    }

    window.skipSearchScroll = true;
    window.skipPanelAutoOpen = true;
    window.scrayRefreshBookmarksPage();
  });

  // Let other code (and the console) redraw after a sync or an edit, at the
  // depth already showing.
  window.scrayRefreshBookmarksPage = async function () {
    window.skipSearchScroll = true;
    window.scrayKeepListDepth = true;
    if (typeof window.filterDisplayedByFilename === 'function') await window.filterDisplayedByFilename();
    else if (typeof filterDisplayedByFilename === 'function') await filterDisplayedByFilename();
  };
})();


// scray-views.js  —  Scray Native
//
// NAMING: the index page shows two VIEWS of the same library, and this file
// owns the switch between them.
//
//   Videos     one row per file. The page's own pipeline, untouched.
//   Bookmarks  one row per bookmark, as a shallow clone of its video carrying
//                __bmStartAt  the bookmark's time - playVideoInline starts
//                             there, so P, the row title, > and <, and X all
//                             open at the bookmark
//                __bmNote     its note, mapped to its display name
//
// "the index" still names the page; Videos and Bookmarks name what it is
// showing. Use those words in conversation and in bug reports.
//
// ---------------------------------------------------------------------------
// WHY THIS REPLACES bookmarks.html / bookmarks-page.js
//
// That page was a copy of the index shell, so the two drifted (it never got
// wholesale mode, and its corner row still carried buttons retired in 13.114)
// and every list change had to be made twice. Worse, it was a separate
// document: navigating to it threw the JS context away, so the filters you had
// armed on the index were gone by the time you arrived, and anything you spotted
// in a bookmark row could not be taken back the other way.
//
// Everything that made that page work is still here - the entries, the pipeline
// overrides, the note column - but the overrides now ASK WHICH VIEW IS SHOWING
// instead of applying unconditionally at load. One page serves both, so the
// filters, clouds, search box and basket simply carry across the switch. That
// carrying-across is the whole point of the change; it needs no code of its own,
// because scrayFacetFilters and friends were always window globals and only ever
// died at navigation.
//
// ---------------------------------------------------------------------------
// WHAT IS DELIBERATELY NOT HERE ANY MORE
//
// The index page grew its own note facet (13.114), so bookmarks-page.js's
// private copies of all of this are gone rather than ported:
//   - the note Sets      randomiser.js declares 'note' in SCRAY_FACET_CLASSES
//                        and creates both the include and the exclude set from it
//   - the note pills     the generic pill loop in populateTagDropdowns draws them
//   - the NOTE button    ui.js binds it on every page
//   - the term count     scrayTotalFilterTerms counts notes with the rest
//   - Clear all          both clear paths run off SCRAY_FACET_CLASSES
// Both views therefore share ONE set of note filters. That is what makes
// "filter by this note, then flip to Videos to see the rest of the file" work.
//
// ---------------------------------------------------------------------------
// The switch is the green VID/BM button on the disguise dock, left of 🌐 and
// COL (disguise.js draws it hidden; this file reveals and labels it, so pages
// with no list never show one).
//
// Always boots into Videos (13.120). The mode is deliberately not persisted: a
// reload is a clean start, and nothing has to be restored before first paint to
// stop the list grid flashing the wrong column count.

(function () {
  'use strict';

  // The cloud's name for a bookmark with no note, so it can be picked too.
  const NO_NOTE = '(no note)';

  let bookmarksView = false;

  /** 'videos' | 'bookmarks'. Read by anything that needs to know. */
  window.scrayViewMode = () => (bookmarksView ? 'bookmarks' : 'videos');

  // ---------------------------------------------------------------- entries

  function noteOf(bm) {
    const raw = (bm.note || '').trim();
    // Mapped, so two raw spellings of one note are one cloud value and one
    // pill. This view never writes a bookmark back, so the stored note is
    // never replaced by its display form.
    return window.scrayMapName ? window.scrayMapName('note', raw) : raw;
  }

  /** Videos -> one entry per bookmark, in time order within each video. */
  function expandToBookmarks(videos) {
    const out = [];
    (videos || []).forEach(video => {
      if (!video || !Array.isArray(video.bookmarks) || !video.bookmarks.length) return;
      // Blacklisted notes never become a row here.
      (window.scrayVisibleBookmarks ? window.scrayVisibleBookmarks(video) : video.bookmarks)
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

  // ---------------------------------------------------------------- note filter

  const noteIncludes = () => (window.scrayFacetFilters || {}).note || new Set();
  const noteExcludes = () => (window.scrayFacetExcludes || {}).note || new Set();

  /**
   * Notes narrow the bookmarks the rest of the filter leaves. Picked notes are
   * ANY-of among themselves - a bookmark has one note, so ALL could never
   * match - and an excluded note always drops its own bookmarks.
   */
  function passesNoteFilter(entry) {
    const key = entry.__bmNote || NO_NOTE;
    const ex = noteExcludes();
    const inc = noteIncludes();
    if (ex.size && ex.has(key)) return false;
    if (inc.size && !inc.has(key)) return false;
    return true;
  }

  // ---------------------------------------------------------------- pipeline
  //
  // These are top-level functions in randomiser.js, so their global bindings
  // are properties of window: replacing them here changes what the bare-name
  // calls inside randomiser.js reach. Each one hands straight back to the
  // original in Videos view, so the main list is bit-for-bit what it was.

  const baseGetFilteredVideos = window.getFilteredVideos;
  if (typeof baseGetFilteredVideos === 'function') {
    window.getFilteredVideos = async function (...args) {
      if (!bookmarksView) return baseGetFilteredVideos.apply(this, args);

      // ⚙️ A note EXCLUDE means different things in the two views, so the base
      // filter must not see it here:
      //   Videos view     "- kiss" = no video that has a kiss bookmark, and
      //                   getFilteredVideos drops the whole record. Right: the
      //                   row IS the file.
      //   Bookmarks view  "- kiss" = not the kiss bookmarks. The same video's
      //                   other bookmarks are still wanted, so dropping the
      //                   record would take them with it.
      // So the exclude set is lifted out for the base pass and re-applied per
      // entry below. Includes need no such care: the base pass keeps a video if
      // ANY of its notes match and passesNoteFilter then narrows to the matching
      // bookmarks, which is a narrowing of the same question rather than a
      // different one.
      const excludes = window.scrayFacetExcludes || {};
      const held = excludes.note;
      let videos;
      try {
        excludes.note = new Set();
        videos = await baseGetFilteredVideos.apply(this, args);
      } finally {
        excludes.note = held;
      }
      return expandToBookmarks(videos).filter(passesNoteFilter);
    };
  }

  // Guards on the entry, not the view: only Bookmarks view ever produces one,
  // and a video falls through to the original untouched.
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

  const baseUpdateVideoStats = window.updateVideoStats;
  window.updateVideoStats = async function (...args) {
    if (!bookmarksView) {
      // Nothing of the old view is worth keeping across the switch, and a stale
      // set here would make Xb pick from a list that is no longer on screen.
      lastFilteredEntries = null;
      return typeof baseUpdateVideoStats === 'function'
        ? baseUpdateVideoStats.apply(this, args)
        : undefined;
    }

    let entries = args.length ? args[0] : null;
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
   * any filter or the search box is armed; null ("no opinion") when nothing is,
   * so Xb then picks from every bookmark.
   *
   * Videos view always answers null. Xb on the main list has to behave exactly
   * as it did before this file existed, and the main list is not a list of
   * bookmarks to pick from.
   */
  window.scrayFilteredBookmarkEntries = function () {
    if (!bookmarksView) return null;
    const term = (document.getElementById('filenameSearchBox')?.value || '').trim();
    const terms = typeof window.scrayTotalFilterTerms === 'function' ? window.scrayTotalFilterTerms() : 0;
    const excluded = (window.SCRAY_FACET_CLASSES || []).reduce(
      (n, k) => n + (((window.scrayFacetExcludes || {})[k] || {}).size || 0), 0)
      + (window.$ ? (($('#excludeTagSelect').val() || []).length) : 0);
    if (!term && !terms && !excluded) return null;
    return (lastFilteredEntries || []).map(v => ({ video: v, time: v.__bmStartAt, note: v.__bmNote }));
  };

  // ---------------------------------------------------------------- clouds

  /**
   * Bookmarks view: value -> number of BOOKMARKS carrying it, over bookmarked
   * videos only. A studio's count is how many bookmarks picking it gives, which
   * is what the list is about to show you; a note's is how many bookmarks have
   * that note.
   *
   * Videos view hands back to the original, so a studio's count is videos again.
   * The same cloud therefore answers a different question in each view - which
   * is correct in both, and is the thing most likely to look like a bug when you
   * flip back and forth.
   */
  const baseFacetCounts = window.scrayFacetCounts;
  window.scrayFacetCounts = async function (kind, genderMode, ...rest) {
    if (!bookmarksView) {
      return typeof baseFacetCounts === 'function'
        ? baseFacetCounts.call(this, kind, genderMode, ...rest)
        : new Map();
    }
    const videos = await window.getAllVideos();
    const counts = new Map();
    const bump = (val, n) => { if (val) counts.set(val, (counts.get(val) || 0) + n); };
    videos.forEach(v => {
      const bms = (window.scrayVisibleBookmarks ? window.scrayVisibleBookmarks(v)
                   : (Array.isArray(v.bookmarks) ? v.bookmarks : []))
                   .filter(b => b && typeof b.time === 'number');
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

  // ---------------------------------------------------------------- chrome

  // # | Note | Studio | Perf | File | ★ | Size in Bookmarks view; the note
  // column comes straight back out in Videos view, where no row has one.
  function setNoteColumn(on) {
    const map = window.SCRAY_LIST_COLUMNS_FOR;
    if (!map) return;
    ['main', 'random'].forEach(list => {
      const cols = map[list];
      if (!cols) return;
      const at = cols.indexOf('lc-note');
      if (on && at === -1) cols.splice(1, 0, 'lc-note');
      else if (!on && at !== -1) cols.splice(at, 1);
    });
  }

  // The Videos view's own wording, read off the page at boot rather than
  // hard-coded, so this file is identical in Picker and Native.
  let videosH1 = '';
  let videosCountLabel = '';
  let videosSearchPlaceholder = '';

  function paintChrome() {
    const h1 = document.querySelector('h1');
    if (h1) h1.textContent = bookmarksView ? 'Universal Bookmarks' : videosH1;

    const countLbl = document.querySelector('label[for="randomCount"]');
    if (countLbl) countLbl.textContent = bookmarksView ? 'No. random bookmarks' : videosCountLabel;

    const box = document.getElementById('filenameSearchBox');
    if (box) box.placeholder = bookmarksView ? 'Filter notes / files' : videosSearchPlaceholder;

    // The Time sort is bookmark time. Hidden rather than removed: the sort row
    // is wired by data-list-sort at boot, and a button that comes and goes from
    // the DOM would lose its handler.
    const timeBtn = document.querySelector('.sort-btn[data-list-sort="bmtime"]');
    if (timeBtn) timeBtn.hidden = !bookmarksView;

    const viewBtn = document.getElementById('scrayDisguiseView');
    if (viewBtn) {
      viewBtn.hidden = false;
      viewBtn.textContent = bookmarksView ? 'VID' : 'BM';
      viewBtn.title = bookmarksView ? 'Back to videos' : 'Show bookmarks instead of videos';
      viewBtn.classList.toggle('is-bookmarks', bookmarksView);
    }
  }

  // ---------------------------------------------------------------- switch

  async function redraw(keepDepth) {
    window.skipSearchScroll = true;
    window.scrayKeepListDepth = !!keepDepth;
    if (typeof window.filterDisplayedByFilename === 'function') await window.filterDisplayedByFilename();
  }

  function setView(toBookmarks) {
    if (bookmarksView === toBookmarks) return;
    bookmarksView = toBookmarks;

    // html as well as body: style.css hangs --lc-cols off the html class so the
    // grid is right on the first paint of a redraw, before body's class would
    // have settled.
    document.documentElement.classList.toggle('scray-bookmarks-page', bookmarksView);
    document.body.classList.toggle('scray-bookmarks-page', bookmarksView);

    setNoteColumn(bookmarksView);

    // ⚙️ ONE SHARED SORT. A note or bmtime key has no value on a video, so it
    // is dropped on the way OUT rather than remembered - left in, it would sort
    // the whole main list by undefined and look as if the sort had broken. The
    // video keys need no such care going the other way: an entry is a clone of
    // its video and still carries every one of them.
    if (!bookmarksView && typeof window.scrayListSortDrop === 'function') {
      window.scrayListSortDrop(['note', 'bmtime']);
    }

    // Row keys differ between the views - `id` for a video, `id@time` for a
    // bookmark - so an open row carried across could never match a row again and
    // would sit in the set for the rest of the session.
    if (window.scrayOpenListRows) {
      Object.keys(window.scrayOpenListRows).forEach(k => {
        const s = window.scrayOpenListRows[k];
        if (s && typeof s.clear === 'function') s.clear();
      });
    }

    paintChrome();
    // Not at the old depth: the two views are different lengths and "page 5 of
    // videos" means nothing in bookmarks. Start at the top of the new list.
    redraw(false);
  }

  window.scrayToggleView = () => setView(!bookmarksView);
  window.scrayShowBookmarks = () => setView(true);
  window.scrayShowVideos = () => setView(false);

  /** Redraw the current view in place, at the depth already showing. */
  window.scrayRefreshView = () => redraw(true);
  // bookmarks-page.js's name for the same thing, kept so anything that calls it
  // (the console, a sync hook) still works.
  window.scrayRefreshBookmarksPage = window.scrayRefreshView;

  // ---------------------------------------------------------------- boot

  document.addEventListener('DOMContentLoaded', () => {
    const h1 = document.querySelector('h1');
    videosH1 = h1 ? h1.textContent : '';
    const countLbl = document.querySelector('label[for="randomCount"]');
    videosCountLabel = countLbl ? countLbl.textContent : '';
    const box = document.getElementById('filenameSearchBox');
    videosSearchPlaceholder = box ? box.placeholder : 'Filter';

    // Boots into Videos, so nothing is switched here - only the switch itself
    // is revealed and labelled, and the Time button hidden.
    paintChrome();
  });
})();

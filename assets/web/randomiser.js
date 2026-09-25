/****************************************************
* Scray Picker - Randomiser & Tag Filtering Module
****************************************************/

// ✅ Global set of selected tags, accessible everywhere
window.commonSelectedTags = new Set();

let filteredVideosGlobal = [];
let currentPage = 1;
const PAGE_SIZE = 500;

// ✅ Export so external modules (e.g. player.js modal) can read live data.
// filteredVideosGlobal is reassigned in many places below, so we use a
// getter/setter pair to keep window.filteredVideosGlobal always in sync.
Object.defineProperty(window, 'filteredVideosGlobal', {
    get() { return filteredVideosGlobal; },
    set(value) { filteredVideosGlobal = value; },
    configurable: true
});
let currentSortState = 'none'; // 'none', 'asc', 'desc'
// The five sort toggles below call renderNextChunk(firstChunk), but firstChunk
// was a const inside filterDisplayedByFilename() — out of scope there, so a
// sort tap threw immediately after clearing the container and the list came
// back empty. Hoisted here so the toggles get the depth currently on screen.
let firstChunk = 25;
// The landscape panel's own sort buttons (random-panel.js) are the only thing
// still reading these five. The main list's sort is scrayListSort below; its
// boot default lives there.
let currentCreatedSortState = 'desc';
let currentModifiedSortState = 'none';
let currentFilenameSortState = 'none';
let currentScoreSortState = 'none';
// Track last 10 played videos
let recentlyPlayedVideos = [];
// Track selected score filters (0 = unscored)
let selectedScoreFilters = new Set();
window.selectedScoreFilters = selectedScoreFilters;

// ⚙️ ADJUSTABLE: extra pixels of buffer above the "+B"/sort buttons row
// when auto-scrolling there on mobile portrait (e.g. tapping the F button)
const MOBILE_FILTER_SCROLL_BUFFER_PX = 80;

/**
* Sort videos by file size
*/
function sortVideosBySize(videos, mode) {
  if (mode === 'none') return videos;
  
  const sorted = [...videos].sort((a, b) => {
      const sizeA = a.sizeBytes ?? 0;
      const sizeB = b.sizeBytes ?? 0;
      return mode === 'asc' ? sizeA - sizeB : sizeB - sizeA;
  });
  
  return sorted;
}

// ✅ NEW: Sort videos by date created
function sortVideosByCreated(videos, mode) {
  if (mode === 'none') return videos;
  
  const sorted = [...videos].sort((a, b) => {
      const dateA = a.createdDateTime ? new Date(a.createdDateTime).getTime() : 0;
      const dateB = b.createdDateTime ? new Date(b.createdDateTime).getTime() : 0;
      return mode === 'asc' ? dateA - dateB : dateB - dateA;
  });
  
  return sorted;
}

// ✅ NEW: Sort videos by date modified
function sortVideosByModified(videos, mode) {
 if (mode === 'none') return videos;
 
 const sorted = [...videos].sort((a, b) => {
     const dateA = a.lastModifiedDateTime ? new Date(a.lastModifiedDateTime).getTime() : 0;
     const dateB = b.lastModifiedDateTime ? new Date(b.lastModifiedDateTime).getTime() : 0;
     return mode === 'asc' ? dateA - dateB : dateB - dateA;
 });
 
 return sorted;
}

// ✅ NEW: Sort videos by filename
function sortVideosByFilename(videos, mode) {
if (mode === 'none') return videos;

const sorted = [...videos].sort((a, b) => {
    const filenameA = (a.filename || '').toLowerCase();
    const filenameB = (b.filename || '').toLowerCase();
    return mode === 'asc' ? filenameA.localeCompare(filenameB) : filenameB.localeCompare(filenameA);
});

return sorted;
}

// ✅ NEW: Sort videos by score
function sortVideosByScore(videos, mode) {
if (mode === 'none') return videos;

const sorted = [...videos].sort((a, b) => {
    const scoreA = a.user_score ?? 0;
    const scoreB = b.user_score ?? 0;
    return mode === 'asc' ? scoreA - scoreB : scoreB - scoreA;
});

return sorted;
}

/* =========================================
LIST SORT - one ordered sort for the main list
=========================================

The column headings (studio, performers, file, score, size) and the sort
buttons (views, watched, played, created) all feed the SAME sort, in the order
they were tapped. The first key decides; the next breaks its ties; and so on,
up to every key at once. Tap a key to add it, again to reverse it, a third
time to take it out. Clear empties it.

Nulls sort last whichever way a key runs: an unscored file is not a
zero-scored one, and a file never played has no date to put first. View count
and watch time are the exception - they are counters, so a missing one is 0.

The five current*SortState variables above are no longer read by the main
list. random-panel.js still drives them from the landscape panel's own
buttons, so they stay declared rather than leave those handlers throwing.
========================================= */

const SCRAY_LIST_SORT_KEYS = {
  studio:     { type: 'text', first: 'asc',  value: v => window.scrayListColumns ? window.scrayListColumns(v).studio : '' },
  performers: { type: 'text', first: 'asc',  value: v => window.scrayListColumns ? window.scrayListColumns(v).performers : '' },
  filename:   { type: 'text', first: 'asc',  value: v => v.filename },
  score:      { type: 'num',  first: 'desc', value: v => window.scrayListScore ? window.scrayListScore(v) : (v.userScore ?? v.user_score) },
  size:       { type: 'num',  first: 'desc', value: v => v.sizeBytes },
  views:      { type: 'num',  first: 'desc', zero: true, value: v => v.view_count },
  watched:    { type: 'num',  first: 'desc', zero: true, value: v => v.time_viewed },
  played:     { type: 'date', first: 'desc', value: v => v.last_played },
  created:    { type: 'date', first: 'desc', value: v => v.createdDateTime },
  // When migrate last copied it OneDrive -> Hetzner (native 15.10 / picker
  // 15.14, browse 15.53's videos.migrated_at). Never-migrated files go last.
  migrated:   { type: 'date', first: 'desc', value: v => v.migrated_at },
  // Bookmarks page: a bookmark entry carries its note and time (bookmarks-page.js).
  // Nothing on the main list has either, so these never move a video there.
  note:       { type: 'text', first: 'asc',  value: v => v.__bmNote },
  bmtime:     { type: 'num',  first: 'asc',  value: v => v.__bmStartAt }
};

// ⚙️ DEFAULT SORT ON BOOT: newest created first, as before. [] boots unsorted.
let scrayListSort = [{ key: 'created', dir: 'desc' }];

// The boot default is a starting point, not a first choice. Left in place,
// the first heading you tapped would only break ties between identical
// created dates - which never happen - and look as if it did nothing. So the
// first tap replaces the default, unless it is a tap on the default's own
// key, which just carries on cycling it.
let scrayListSortIsDefault = true;

// numeric: "clip 9" before "clip 10". sensitivity base: case never splits a studio.
const scrayListCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function scrayListSortValue(def, video) {
  const raw = def.value(video);
  if (def.type === 'text') {
    const s = String(raw ?? '').trim();
    return s === '' ? null : s;
  }
  if (def.type === 'date') {
    const t = raw ? Date.parse(raw) : NaN;
    return isNaN(t) ? null : t;
  }
  if (raw === null || raw === undefined || raw === '') return def.zero ? 0 : null;
  const n = Number(raw);
  return isFinite(n) ? n : (def.zero ? 0 : null);
}

/**
 * Sort by the current key list.
 *
 * Every key is read ONCE per video up front, not inside the comparator:
 * studio and performers go through the StashDB name lookup, and doing that
 * on every comparison of a few thousand rows is the difference between
 * instant and a visible stall.
 *
 * @param {Array} videos
 * @param {Array|null} baseOrder - the unsorted list. Ties fall back to its
 *        order, so taking a key out puts rows back where the filter left
 *        them rather than where the previous sort did. Null: ties keep the
 *        order they arrived in.
 */
function scraySortVideos(videos, baseOrder) {
  if (!Array.isArray(videos)) return videos;
  const spec = scrayListSort.filter(s => SCRAY_LIST_SORT_KEYS[s.key]);
  if (!spec.length && !baseOrder) return videos;

  const base = baseOrder ? new Map(baseOrder.map((v, i) => [v, i])) : null;
  const rows = videos.map((v, i) => ({
    v,
    i: (base && base.has(v)) ? base.get(v) : i,
    k: spec.map(s => scrayListSortValue(SCRAY_LIST_SORT_KEYS[s.key], v))
  }));

  rows.sort((a, b) => {
    for (let j = 0; j < spec.length; j++) {
      const x = a.k[j], y = b.k[j];
      if (x === y) continue;
      if (x === null) return 1;
      if (y === null) return -1;
      const c = SCRAY_LIST_SORT_KEYS[spec[j].key].type === 'text'
        ? scrayListCollator.compare(x, y)
        : (x < y ? -1 : x > y ? 1 : 0);
      if (c) return spec[j].dir === 'asc' ? c : -c;
    }
    return a.i - b.i;
  });
  return rows.map(r => r.v);
}
window.scraySortVideos = scraySortVideos;

/** A copy, for render.js to draw the heading arrows from. */
window.scrayListSortState = () => scrayListSort.map(s => ({ ...s }));

function scrayListSortTap(key) {
  const def = SCRAY_LIST_SORT_KEYS[key];
  if (!def) return;
  if (scrayListSortIsDefault) {
    scrayListSortIsDefault = false;
    if (!scrayListSort.some(s => s.key === key)) scrayListSort = [];
  }
  const at = scrayListSort.findIndex(s => s.key === key);
  if (at === -1) {
    scrayListSort.push({ key, dir: def.first });
  } else if (scrayListSort[at].dir === def.first) {
    scrayListSort[at].dir = def.first === 'asc' ? 'desc' : 'asc';
  } else {
    scrayListSort.splice(at, 1);
  }
  scrayApplyListSort();
}
window.scrayListSortTap = scrayListSortTap;

function scrayListSortClear() {
  scrayListSortIsDefault = false;
  scrayListSort = [];
  scrayApplyListSort();
}
window.scrayListSortClear = scrayListSortClear;

/**
 * Take named keys out of the sort, leaving the rest of the stack in order.
 *
 * For the view switch (scray-views.js): 'note' and 'bmtime' read fields only a
 * bookmark entry has, so they have to come out when the index goes back to
 * Videos - left in, they would sort every row by undefined and read as a broken
 * sort rather than an inapplicable one. Only the buttons are re-synced; the
 * caller redraws, so there is no second sort of a list about to be replaced.
 */
function scrayListSortDrop(keys) {
  const drop = Array.isArray(keys) ? keys : [keys];
  const before = scrayListSort.length;
  scrayListSort = scrayListSort.filter(s => !drop.includes(s.key));
  if (scrayListSort.length !== before) syncListSortButtons();
}
window.scrayListSortDrop = scrayListSortDrop;

/** Re-sort what's on screen and redraw it, at the depth already showing. */
function scrayApplyListSort() {
  syncListSortButtons();
  const ps = paginationState;
  const container = document.getElementById(ps.containerId);
  if (!ps.allVideos || !ps.allVideos.length || !container) {
    if (typeof window.scrayRefreshMainListHeader === 'function') window.scrayRefreshMainListHeader();
    return;
  }
  // A heading tap on a 200-row list shouldn't also cut it back to 25.
  const depth = Math.max(25, ps.currentEndIndex || 0);
  ps.allVideos = scrayGroupMainList(scraySortVideos(ps.allVideos, ps.unsortedVideos || null));
  ps.currentEndIndex = 0;
  container.innerHTML = '';
  renderNextChunk(depth);
}

/**
 * Button labels follow the sort: an arrow for direction and, once there is
 * more than one key, the key's place in the order. The blue comes from
 * data-sort-state in style.css.
 */
function syncListSortButtons() {
  document.querySelectorAll('.sort-btn[data-list-sort]').forEach(btn => {
    if (!btn.dataset.label) btn.dataset.label = btn.textContent.trim();
    const base = btn.dataset.label;
    const key = btn.dataset.listSort;

    if (key === 'clear') {
      btn.dataset.sortState = 'none';
      btn.classList.toggle('sort-btn-idle', scrayListSort.length === 0);
      return;
    }

    const at = scrayListSort.findIndex(s => s.key === key);
    if (at === -1) {
      btn.textContent = base;
      btn.dataset.sortState = 'none';
      return;
    }
    const s = scrayListSort[at];
    btn.textContent = `${base} ${s.dir === 'asc' ? '↑' : '↓'}${scrayListSort.length > 1 ? at + 1 : ''}`;
    btn.dataset.sortState = s.dir;
  });
}

window.sortVideosBySize = sortVideosBySize;

/**
* Merge Excel Online scores into video objects (FAST - uses cache)
* @param {Array} videos - Videos to enrich with scores
* @returns {Promise<Array>} - Videos with userScore property added
*/
async function mergeExcelScoresIntoVideos(videos) {
 // Only run if Excel Online is connected
 if (!window.excelAccessToken) {
     return videos;
 }
 
 try {
     // ✅ Get cached scores (fast)
     const scoreMap = await window.getCachedVideoScores();
     
     // Merge scores into video objects
     videos.forEach(video => {
         const score = scoreMap.get(video.oneDriveId);
         if (score !== undefined) {
             video.userScore = score;
         }
     });
     
     return videos;
     
 } catch (err) {
     console.warn('Failed to merge scores:', err);
     return videos; // Return videos without scores on error
 }
}

// Export globally
window.mergeExcelScoresIntoVideos = mergeExcelScoresIntoVideos;

/**
* Show modal with all active exclude tags
*/
function showExcludeTagsModal() {
   // Default excludes (the exclude_tags table, scray-exclude.js) and the ones
   // added this session are told apart (picker 13.172 / native 13.167): the
   // defaults in slate with a "default" mark, session ones in the usual red,
   // listed first. Clear All clears the session ones and leaves the defaults
   // on, the same as the pills bar's Clear all.
   const defaultSet = window.scrayDefaultExcludeTags || new Set();
   const isDefault = (t) => defaultSet.has(t);
   const excludeTags = ($('#excludeTagSelect').val() || [])
       .slice().sort((a, b) => (isDefault(a) - isDefault(b)) || a.localeCompare(b));
   
   if (excludeTags.length === 0) {
       alert("No exclude tags active");
       return;
   }
   
   // Create overlay
   const overlay = document.createElement('div');
   overlay.className = 'tag-selection-overlay';
   
   const content = document.createElement('div');
   content.className = 'tag-selection-content';
   
   const title = document.createElement('h3');
   title.textContent = `Exclude Tags (${excludeTags.length})`;
   content.appendChild(title);

   const legend = document.createElement('div');
   legend.style.cssText = 'font-size:0.75rem;color:#666;margin:-4px 0 10px;display:flex;gap:12px;flex-wrap:wrap;align-items:center;';
   const swatch = (bg, label) => '<span style="display:inline-flex;align-items:center;gap:5px;">' +
       '<span style="width:10px;height:10px;border-radius:3px;background:' + bg + ';display:inline-block;"></span>' + label + '</span>';
   const syncLegend = () => {
       const now = $('#excludeTagSelect').val() || [];
       const nDef = now.filter(isDefault).length;
       legend.innerHTML = swatch('#f94144', `Added this session (${now.length - nDef})`) +
                          swatch('#5a6b7d', `Default (${nDef})`);
   };
   syncLegend();
   content.appendChild(legend);
   
   const grid = document.createElement('div');
   grid.className = 'tag-selection-grid';
   
   excludeTags.forEach(tag => {
       const pill = document.createElement('div');
       pill.className = 'tag-selection-item tag-selection-item-exclude';
       pill.textContent = tag;
       pill.title = `Click to remove "${tag}" from excludes`;
       if (isDefault(tag)) {
           // Inline and !important, to beat .tag-selection-item-exclude's own
           // !important red in style.css.
           pill.style.setProperty('background', '#5a6b7d', 'important');
           pill.classList.add('tag-selection-item-exclude-default');
           const mark = document.createElement('span');
           mark.textContent = ' default';
           mark.style.cssText = 'font-size:0.65em;opacity:0.8;margin-left:4px;';
           pill.appendChild(mark);
           pill.title = `Default exclude - click to stop excluding "${tag}" for this session ` +
                        `(it stays on the default list)`;
       }
       
       pill.addEventListener('click', () => {
           // Remove from exclude dropdown
           const currentExcludes = $('#excludeTagSelect').val() || [];
           $('#excludeTagSelect').val(currentExcludes.filter(t => t !== tag)).trigger('change');
           
           // Visual feedback
           pill.style.setProperty('background', '#28a745', 'important');
           pill.textContent = `${tag} ✓`;
           syncLegend();
           
           setTimeout(() => {
               pill.remove();
               
               // If no more tags, close modal
               if (grid.children.length === 0) {
                   document.body.removeChild(overlay);
               }
               
               // Update title count
               const remaining = grid.children.length;
               title.textContent = `Exclude Tags (${remaining})`;
           }, 300);
       });
       
       grid.appendChild(pill);
   });
   
  content.appendChild(grid);

// Add button row with Clear All and Close
const buttonRow = document.createElement('div');
buttonRow.style.cssText = `
    display: flex;
    gap: 10px;
    width: 100%;
`;

// Clear All button
const clearAllBtn = document.createElement('button');
clearAllBtn.className = 'tag-selection-close';
clearAllBtn.style.background = '#f44336';
clearAllBtn.style.flex = '1';
clearAllBtn.textContent = defaultSet.size ? 'Clear All (keep defaults)' : 'Clear All';
if (window.scrayWholesaleMode && window.scrayWholesaleMode.isOn()) {
    // Wholesale (picker 13.173): this clears every filter, not just excludes,
    // so it says so and wears the pills bar Clear all's dark red.
    clearAllBtn.textContent = 'Clear all filters (keep defaults)';
    clearAllBtn.style.background = '#8b0000';
}
clearAllBtn.title = 'Clear the excludes added this session; the default list stays on';
clearAllBtn.addEventListener('click', () => {
    // The session excludes go; the defaults stay excluded (13.172 / 13.167).
    window.scraySuppressScrollUntil = Date.now() + 1500;
    if (window.scrayWholesaleMode && window.scrayWholesaleMode.isOn() &&
        typeof window.scrayClearAllFilters === 'function') {
        // Wholesale mode (picker 13.173): the same as the pills bar's Clear
        // all there - every other filter pill goes too.
        window.scrayClearAllFilters();
    } else {
        const keep = ($('#excludeTagSelect').val() || []).filter(isDefault);
        $('#excludeTagSelect').val(keep).trigger('change');
    }
    
    // Show success feedback
    clearAllBtn.textContent = '✅ Cleared';
    clearAllBtn.style.background = '#28a745';
    
    // Close modal after brief delay
    setTimeout(() => {
        document.body.removeChild(overlay);
    }, 500);
});
buttonRow.appendChild(clearAllBtn);

// Close button
const closeBtn = document.createElement('button');
closeBtn.className = 'tag-selection-close';
closeBtn.style.flex = '1';
closeBtn.textContent = 'Close';
closeBtn.addEventListener('click', () => {
    document.body.removeChild(overlay);
});
buttonRow.appendChild(closeBtn);

content.appendChild(buttonRow);
overlay.appendChild(content);
   
   // Close on background click
overlay.addEventListener('click', (e) => {
  if (e.target === overlay) {
      document.body.removeChild(overlay);
  }
});

// ESC key to close
const excludeTagEscHandler = (e) => {
  if (e.key === 'Escape') {
      overlay.remove();
      document.removeEventListener('keydown', excludeTagEscHandler);
  }
};
window.scrayEscapeWhileOpen(overlay, excludeTagEscHandler); // not left behind on close (13.182)

document.body.appendChild(overlay);
}

// Export the new function
window.showExcludeTagsModal = showExcludeTagsModal;

/* =========================================
   FACET TAG FILTERS - studios, performers, stash tags
   =========================================

   Three more classes of include filter, kept in their own sets rather than
   folded into commonSelectedTags. They are not catalogue tags: nothing in
   rec.tags will ever hold them, they come from the StashDB name table, and a
   pill has to know its class in order to colour itself and to know which list
   to remove itself from.

   window.scrayTagIntersect flips every include filter - catalogue tags and all
   three facet classes together - from ANY to ALL. One switch rather than one
   per class: "show me the overlap" is a single question.
   ========================================= */
/* The facet classes, in the order they are drawn. 'tag' is deliberately not
   one of them: catalogue tags have their own selects, their own exclude pill
   and their own place in getFilteredVideos.

   Declared once because it was written out six times, and adding a class meant
   finding all six - miss one and the filter half-works in a way that takes a
   while to notice. */
window.SCRAY_FACET_CLASSES = ['studio', 'performer', 'stashtag', 'note'];

window.scrayFacetFilters = window.scrayFacetFilters || {
   studio:    new Set(),
   performer: new Set(),
   stashtag:  new Set(),
   note:      new Set()
};
// bookmarks-page.js creates its own note set when it loads first; either way
// there is exactly one, because both sides only ever fill a gap.
window.SCRAY_FACET_CLASSES.forEach(k => {
   if (!window.scrayFacetFilters[k]) window.scrayFacetFilters[k] = new Set();
});
window.scrayTagIntersect = !!window.scrayTagIntersect;

/* Excludes, one set per facet class.
   Catalogue tags are deliberately absent: they already have #excludeTagSelect,
   which the Exclude (n) pill, its modal, the row menu and getFilteredVideos all
   read. A second parallel store for the same thing is how the two end up
   disagreeing, so 'tag' goes through the select and only the three facet
   classes live here. */
/**
 * Scroll the results into view after a filter changes.
 *
 * Target is #videoStats - the "Items: N | Total size: X" line - so the count is
 * the first thing under the field and the rows start immediately below it.
 *
 * Not the search row (#filenameSearchBox), which style.css has hidden under
 * 1024px since 13.84 when the pill took it over, and not the sort buttons
 * either: those only respond with the term at rest, so a row of controls that
 * does nothing mid-type is a row of viewport spent on nothing.
 *
 * scrollIntoView is not used because #floatingTagPillsBar is position:fixed
 * across the top, so its "start" parks the target UNDERNEATH it. What is
 * covering the top is measured rather than assumed - the bar wraps to a second
 * row once enough pills are on, and the focused search field is taller again.
 */
window.scrayScrollToResults = function (behavior) {
   const target = document.getElementById('videoStats')
               || document.querySelector('.sort-buttons-container')
               || document.getElementById('filenameSearchBox');
   if (!target) return;

   let clear = 0;
   const bar = document.getElementById('floatingTagPillsBar');
   if (bar) {
       const r = bar.getBoundingClientRect();
       // Only when it is actually painted across the top - in landscape it
       // moves, and an off-screen bar should not push the list down.
       if (r.height && r.top < 80) clear = r.bottom + 6;
   }
   // Focused, the search field leaves the bar's flex flow (13.118) and is
   // taller than it, so the bar's own rect no longer describes what is over the
   // top of the screen. Whichever reaches further down wins.
   const live = document.querySelector('.floating-tag-search-wrap.is-focused');
   if (live) {
       const lr = live.getBoundingClientRect();
       if (lr.height && lr.top < 140) clear = Math.max(clear, lr.bottom + 6);
   }

   const top = window.scrollY + target.getBoundingClientRect().top - clear;
   window.scrollTo({ top: Math.max(0, top), behavior: behavior || 'smooth' });
};

window.scrayFacetExcludes = window.scrayFacetExcludes || {
   studio:    new Set(),
   performer: new Set(),
   stashtag:  new Set()
};
// Same gap-fill as the includes above, and for the same reason (13.108): a
// class with no exclude set here makes scraySetExcluded a no-op, so its cloud
// chips cycle off -> include -> off and the exclude leg silently vanishes.
// That is exactly what 'note' did on the index page, while the bookmarks page
// - which creates its own note exclude set - cycled all three states. Driving
// it off SCRAY_FACET_CLASSES means the next class added gets both halves
// without anyone having to remember this file.
window.SCRAY_FACET_CLASSES.forEach(k => {
   if (!window.scrayFacetExcludes[k]) window.scrayFacetExcludes[k] = new Set();
});

/* ---- keyword filter (picker 13.149 / stg-native 13.147) -------------
   Notes work like tags now (browse 13.62): a bookmark files under every one
   of its keywords - by default the words of the note. Keywords are
   the primary way to filter bookmarks, so a picked keyword decides the videos
   (and, in Bookmarks view, the bookmarks) shown. The mapped notes still sit
   under the keywords in the cloud and narrow further.

   Tested PER BOOKMARK, not per video: "kiss" + "neck" with intersect on means
   a bookmark that is both, not a video that has a kiss bookmark somewhere and
   a neck bookmark somewhere else - which is the whole reason a bookmark can
   have several keywords.

   Additive (any picked keyword) by default; intersect (all of them) is its own
   switch rather than scrayTagIntersect, because it is a question about one
   bookmark rather than about how the filter classes combine.
--------------------------------------------------------------------------- */
window.scrayNoteKeywordFilter = window.scrayNoteKeywordFilter || new Set();
window.scrayNoteKeywordIntersect = !!window.scrayNoteKeywordIntersect;

/* ---------------------------------------------------------------------------
   Network filter (picker 14.8 / native 14.12, browse 14.4).

   A studio's Parent (manage-data, now fillable from StashDB) is its network.
   Picking a Parent chip in the STU cloud used to only narrow the cloud; now it
   is a real filter: every file from any studio under a picked network. It
   joins the studio class - additive with picked studios, like any other term
   - and shows as its own pill.
--------------------------------------------------------------------------- */
window.scrayStudioParentFilter = window.scrayStudioParentFilter || new Set();

/** A studio's network (its Parent), lower-cased, or ''. */
function scrayStudioParentOf(studio) {
   const nm = window.scrayNameMap;
   const a = (nm && typeof nm.attrsFor === 'function' && studio) ? nm.attrsFor('studio', studio) : null;
   return String((a && a.parent) || '').trim().toLowerCase();
}
window.scrayStudioParentOf = scrayStudioParentOf;

/** Does a note (raw or mapped) satisfy the picked keywords? True when none are picked. */
function scrayNoteKeywordsPass(note) {
   const picks = window.scrayNoteKeywordFilter;
   if (!picks || !picks.size) return true;
   // Expanded: a child keyword counts as its parent note (browse 13.64).
   const keywords = typeof window.scrayNoteKeywordsExpanded === 'function' ? window.scrayNoteKeywordsExpanded(note)
       : typeof window.scrayNoteKeywords === 'function' ? window.scrayNoteKeywords(note) : [];
   if (!keywords.length) return false;
   return window.scrayNoteKeywordIntersect
       ? [...picks].every(p => keywords.includes(p))
       : keywords.some(p => picks.has(p));
}
window.scrayNoteKeywordsPass = scrayNoteKeywordsPass;

/**
 * A video passes the keyword filter when ONE of its bookmarks does - and, if
 * mapped notes are picked too, that same bookmark's note is one of them.
 */
function scrayVideoPassesNoteKeywords(video) {
   const bms = window.scrayVisibleBookmarks
       ? window.scrayVisibleBookmarks(video)
       : (video && Array.isArray(video.bookmarks) ? video.bookmarks : []);
   const inc = (window.scrayFacetFilters || {}).note;
   return bms.some(b => {
       const raw = String((b && b.note) || '').trim();
       if (!raw || !scrayNoteKeywordsPass(raw)) return false;
       if (inc && inc.size) {
           const name = window.scrayMapName ? window.scrayMapName('note', raw) : raw;
           if (!inc.has(name)) return false;
       }
       return true;
   });
}
window.scrayVideoPassesNoteKeywords = scrayVideoPassesNoteKeywords;

/**
 * keyword -> how many videos carry it (Videos view) or how many bookmarks do
 * (Bookmarks view), over the whole catalogue - the same scope the other cloud
 * counts use. Counted here rather than by adding up the notes' counts, which
 * would count a video once per note it has under a keyword.
 */
async function scrayNoteKeywordCounts(perBookmarkArg) {
   const videos = await getAllVideos();
   // true = always count bookmarks - the bookmark modal ranks keywords by how
   // many bookmarks use them, whichever view is showing (13.151 / 13.149).
   const perBookmark = perBookmarkArg === true
       || (typeof window.scrayViewMode === 'function' && window.scrayViewMode() === 'bookmarks');
   const counts = new Map();
   videos.forEach(v => {
       const bms = window.scrayVisibleBookmarks
           ? window.scrayVisibleBookmarks(v)
           : (Array.isArray(v && v.bookmarks) ? v.bookmarks : []);
       const seen = new Set();
       bms.forEach(b => {
           const raw = String((b && b.note) || '').trim();
           if (!raw || typeof window.scrayNoteKeywords !== 'function') return;
           // Expanded, so a parent note's count includes its children's bookmarks.
           (window.scrayNoteKeywordsExpanded || window.scrayNoteKeywords)(raw).forEach(pn => {
               if (perBookmark) counts.set(pn, (counts.get(pn) || 0) + 1);
               else seen.add(pn);
           });
       });
       seen.forEach(pn => counts.set(pn, (counts.get(pn) || 0) + 1));
   });
   return counts;
}
window.scrayNoteKeywordCounts = scrayNoteKeywordCounts;

function scrayFacetExcludeSet(kind) {
   return (window.scrayFacetExcludes || {})[kind] || null;
}
window.scrayFacetExcludeSet = scrayFacetExcludeSet;

/** Is this value currently excluded for its class? */
function scrayIsExcluded(kind, name) {
   if (kind === 'tag') return ($('#excludeTagSelect').val() || []).includes(name);
   const s = scrayFacetExcludeSet(kind);
   return !!(s && s.has(name));
}
window.scrayIsExcluded = scrayIsExcluded;

/**
 * Turn one value's exclude state on or off.
 *
 * Returns TRUE when the caller still has to fire a refresh. The tag path
 * returns false on purpose: triggering 'change' on the select runs its own
 * handler, which repaints the pills and re-filters already, and a second pass
 * on top of it is a whole extra sweep of the catalogue for nothing.
 */
function scraySetExcluded(kind, name, on) {
   if (kind === 'tag') {
       const $sel = $('#excludeTagSelect');
       if (!$sel.length) return false;
       const cur = $sel.val() || [];
       if (on) {
           if (cur.includes(name)) return false;
           // The dropdown is filled from tags in the DB, but a cloud value can
           // outrun it after a re-index, and select2 silently drops a value it
           // has no option for. Add one rather than lose the exclude.
           if (!$sel.find('option').filter(function () { return this.value === name; }).length) {
               $sel.append(new Option(name, name, false, false));
           }
           $sel.val(cur.concat([name])).trigger('change');
       } else {
           if (!cur.includes(name)) return false;
           $sel.val(cur.filter(t => t !== name)).trigger('change');
       }
       return false;
   }
   const s = scrayFacetExcludeSet(kind);
   if (!s) return false;
   if (on) s.add(name); else s.delete(name);
   return true;
}
window.scraySetExcluded = scraySetExcluded;

/** How many values are excluded in one class, for the modal title. */
function scrayExcludeCount(kind) {
   if (kind === 'tag') return ($('#excludeTagSelect').val() || []).length;
   const s = scrayFacetExcludeSet(kind);
   return s ? s.size : 0;
}
window.scrayExcludeCount = scrayExcludeCount;

// Label and pill class per filter class, in the order the button row and the
// pills bar render them.
window.SCRAY_FACET_META = {
   tag:       { label: 'Tags',       pill: 'floating-tag-include'   },
   studio:    { label: 'Studios',    pill: 'floating-tag-studio'    },
   performer: { label: 'Performers', pill: 'floating-tag-performer' },
   stashtag:  { label: 'Stash tags', pill: 'floating-tag-stashtag'  },
   // Bookmark notes (13.110). On the bookmarks page a picked note narrows to
   // the BOOKMARKS carrying it; here it narrows to the VIDEOS that have one,
   // which is the same question asked of a list of files.
   note:      { label: 'Notes',      pill: 'floating-tag-note'      }
};

/**
 * Re-run the filter and repaint the pills bar.
 *
 * refreshFiltersFromCommonSet is declared INSIDE populateTagDropdowns, so at
 * this file's top level the bare name is not in scope at all. A `typeof x ===
 * 'function'` guard wrapped around it is therefore always false, and every
 * call silently does nothing - which is precisely what happened: the Sets
 * filled up correctly and nothing ever repainted.
 *
 * So: go through window. The fallback covers the gap between this file being
 * parsed and populateTagDropdowns having run, where the export does not exist
 * yet - filterDisplayedByFilename is top-level and reachable throughout.
 */
function scrayRefreshFilters() {
   if (typeof window.refreshFiltersFromCommonSet === 'function') {
       window.refreshFiltersFromCommonSet();
       return;
   }
   if (typeof window.updateFloatingTagPillsFromCommon === 'function') {
       window.updateFloatingTagPillsFromCommon();
   }
   window.skipSearchScroll = true;
   if (typeof filterDisplayedByFilename === 'function') filterDisplayedByFilename();
}
window.scrayRefreshFilters = scrayRefreshFilters;

/**
 * Clear every filter the floating bar can represent, in one tap.
 *
 * Deliberately NOT clearAllFilters(): that one belongs to the big Clear
 * button and also stops the player, empties #playlist and
 * #taggedVideosContainer and scrolls the page. From a pill sitting in the
 * filter bar the expected result is the unfiltered catalogue still on screen,
 * not a blank one.
 *
 * `ev` is passed through only so clearSearchPillFilter can position its
 * "Filter cleared" tooltip. Without one, the search boxes are cleared here
 * directly rather than risking showButtonFeedback on an undefined event.
 */
/**
 * $(sel).val(value).trigger('change'), without letting select2 abort whatever
 * called it (picker 14.34 / native 14.54).
 *
 * The tag dropdowns' cascade handlers (bindDropdownWithCascade) refill the
 * other dropdowns - and "All tags" refills itself - through fillSelect, which
 * re-initialises select2 on each one. That destroys the instance whose own
 * change handler jQuery has already queued for the same event, so when that
 * handler runs it finds its data adapter gone and throws ("Cannot read
 * properties of null (reading 'current')"). By then everything that matters
 * has run: the cascade came first, and the new instance painted itself when
 * it was built. But the throw came up through .trigger() into the caller, so
 * Clear all (the pill, and holding the corner 🔍) stopped at "All tags" and
 * never reached the excludes, the search term or the score filters.
 */
function scrayResetSelect(sel, value = null) {
   const $s = $(sel);
   if (!$s.length) return;
   try {
       $s.val(value).trigger('change');
   } catch (err) {
       console.warn(`[filters] ${sel}: select2 threw while clearing - harmless, the clear went through:`, err && err.message);
   }
}
window.scrayResetSelect = scrayResetSelect;

window.scrayClearAllFilters = function (ev) {
   if (window.commonSelectedTags) window.commonSelectedTags.clear();
   window.SCRAY_FACET_CLASSES.forEach(k => {
       const s = (window.scrayFacetFilters || {})[k];
       if (s) s.clear();
       const x = (window.scrayFacetExcludes || {})[k];
       if (x) x.clear();
   });
   window.scrayTagIntersect = false;
   if (window.scrayNoteKeywordFilter) window.scrayNoteKeywordFilter.clear();
   if (window.scrayStudioParentFilter) window.scrayStudioParentFilter.clear();
   window.scrayNoteKeywordIntersect = false;

   // Cleared through jQuery so each select's own change handler runs and the
   // cascade re-widens the option lists. Every one of these fires a filter
   // pass, which is why this is a deliberate single action rather than
   // something done on each individual pill removal.
   // No scroll from any of the passes this sets off (13.170 / 13.166). Each
   // select's change handler runs its own filter pass, and skipSearchScroll is
   // one-shot: the first pass to finish used it up and a later one scrolled
   // the page to the results. A short window covers all of them.
   window.scraySuppressScrollUntil = Date.now() + 1500;
   window.skipPanelAutoOpen = true;
   ['#tagFilterLevel1Select', '#tagFilterLevel2Select', '#tagFilterLevel3Select',
    '#tagFilterAllSelect'].forEach(sel => scrayResetSelect(sel));
   // Folder excludes: only the DEFAULT ones stay - wholesale's Clear all rule
   // (picker 13.173), now outside wholesale too (picker 13.192 / native 13.193).
   // Of what is excluded right now, a tag stays only if it is on the default
   // list, matched without regard to case. Before, this set the select to the
   // default list outright: a default whose case differed from the tag's own
   // option was silently dropped by select2, and with the list not loaded yet
   // every exclude went, defaults included. If start-up never recorded the
   // list it is read from the server first, so a missing list can't clear
   // the defaults.
   const $ex = $('#excludeTagSelect');
   if ($ex.length) {
       const keepDefaults = (defaults) => {
           const defLower = new Set([...(defaults || [])].map(t => String(t).toLowerCase()));
           const now  = $ex.val() || [];
           const keep = now.filter(t => defLower.has(String(t).toLowerCase()));
           if (keep.length !== now.length) scrayResetSelect('#excludeTagSelect', keep);
       };
       if (window.scrayDefaultExcludeTags) {
           keepDefaults(window.scrayDefaultExcludeTags);
       } else if (typeof window.fetchDefaultExcludeTags === 'function') {
           window.fetchDefaultExcludeTags().then(tags => {
               window.scrayDefaultExcludeTags = window.scrayDefaultExcludeTags || new Set(tags);
               keepDefaults(window.scrayDefaultExcludeTags);
           }).catch(() => { /* list unreadable: leave the excludes as they are */ });
       }
   }

   if (ev && typeof window.clearSearchPillFilter === 'function') {
       window.clearSearchPillFilter(ev);
   } else {
       const box   = document.getElementById("filenameSearchBox");
       const panel = document.getElementById("panelSearchBox");
       if (box)   { box.value = "";   box.dispatchEvent(new Event('input', { bubbles: true })); }
       if (panel) { panel.value = ""; }
       const x  = document.getElementById("clearSearchX");
       const px = document.getElementById("panelSearchClearX");
       if (x)  x.style.display  = "none";
       if (px) px.style.display = "none";
   }

   if (window.selectedScoreFilters) window.selectedScoreFilters.clear();

   // Orientation goes through its change handler rather than being set
   // silently, so the toggle button's label can never drift from the select.
   const orient = document.getElementById("orientationFilter");
   if (orient && orient.value !== "any") {
       orient.value = "any";
       orient.dispatchEvent(new Event("change", { bubbles: true }));
   }
   window.syncOrientationToggleLabel?.();

   const offlineBtn = document.getElementById("offlineOnlyToggleBtn");
   if (offlineBtn) offlineBtn.dataset.active = "0";
   window.syncOfflineOnlyToggleLabel?.();

   const stashBtn = document.getElementById("stashFilterToggleBtn");
   if (stashBtn) stashBtn.dataset.state = "any";
   window.syncStashFilterToggleLabel?.();

   const bmBtn = document.getElementById("bookmarkFilterToggleBtn");
   if (bmBtn) bmBtn.dataset.state = "any";
   window.syncBookmarkFilterToggleLabel?.();

   const uncatBtn = document.getElementById("uncataloguedToggleBtn");
   if (uncatBtn) uncatBtn.dataset.active = "0";
   window.syncUncataloguedToggleLabel?.();

   const hetzBtn = document.getElementById("hetznerOnlyToggleBtn");
   if (hetzBtn) hetzBtn.dataset.state = "any";
   window.syncHetznerOnlyToggleLabel?.();

   window.skipSearchScroll = true;
   scrayRefreshFilters();
};

/** Which Set holds a given class. 'tag' is the pre-existing global. */
function scrayFacetSet(kind) {
   return kind === 'tag'
       ? window.commonSelectedTags
       : (window.scrayFacetFilters || {})[kind];
}
window.scrayFacetSet = scrayFacetSet;

/**
 * The values one video offers for one class. Everything from parts() is
 * already lower-cased at source, so this compares by plain equality rather
 * than case-folding every row on every keystroke.
 *
 * 'performer' deliberately returns the WHOLE cast. performerList is the
 * display list and stays female-only so row names do not change, but
 * filtering by a male performer has to actually find him.
 */
function scrayFacetValues(video, kind) {
   if (kind === 'tag') return Array.isArray(video && video.tags) ? video.tags : [];
   if (kind === 'note') return scrayVideoNotes(video);
   const p = window.scrayStashNames && window.scrayStashNames.parts(video);
   if (!p) return [];
   if (kind === 'studio')    return p.studio ? [p.studio] : [];
   if (kind === 'performer') return p.performerListAll || p.performerList || [];
   if (kind === 'stashtag')  return p.stashTagList || [];
   return [];
}

/**
 * The bookmark notes one video carries, as the MAPPED display names.
 *
 * Handled outside scrayFacetValues' parts() block because notes are not stash
 * data at all - they hang off the video's own bookmarks - but it answers the
 * same question the other classes do, so the filter and the cloud counts both
 * reach it through the same call.
 *
 * Mapped and de-duplicated: two raw spellings tidied onto one name are one
 * value here, which is what makes picking that name find both. Blacklisted
 * notes are already gone, because scrayVisibleBookmarks dropped them.
 */
function scrayVideoNotes(video) {
   const bms = window.scrayVisibleBookmarks
       ? window.scrayVisibleBookmarks(video)
       : (video && Array.isArray(video.bookmarks) ? video.bookmarks : []);
   const out = new Set();
   bms.forEach(b => {
       const raw = String((b && b.note) || '').trim();
       if (!raw) return;
       const name = window.scrayMapName ? window.scrayMapName('note', raw) : raw;
       if (name) out.add(name);
   });
   return Array.from(out);
}
window.scrayVideoNotes = scrayVideoNotes;
window.scrayFacetValues = scrayFacetValues;

/**
 * Add one term to a class and re-run the filter.
 *
 * This is what the list-row chips and the stash modal call. It replaces the
 * old behaviour of pushing the name into the search box: a search term matches
 * anywhere in the haystack, so tapping a studio also dragged in every scene
 * whose TITLE happened to contain the word.
 *
 * Adding, not toggling. It is reachable from a list row, from the stash modal
 * and from the cloud, and re-tapping the same performer across three rows must
 * not switch the filter back off. The cloud toggles for itself, where the
 * current state is visible.
 */
window.scrayAddTagFilter = function (kind, name) {
   const set = scrayFacetSet(kind);
   if (!set) return false;
   // Catalogue tags keep their original case - they are compared against
   // rec.tags, which is not normalised. Facet values are lower-cased at source
   // in parts(), so they are lower-cased here to match.
   const raw   = String(name == null ? '' : name).trim();
   const clean = kind === 'tag' ? raw : raw.toLowerCase();
   if (!clean || set.has(clean)) return false;
   set.add(clean);
   scrayRefreshFilters();
   return true;
};

window.scrayRemoveTagFilter = function (kind, name) {
   const set = scrayFacetSet(kind);
   if (!set) return;
   const raw = String(name == null ? '' : name).trim();
   set.delete(kind === 'tag' ? raw : raw.toLowerCase());
   scrayRefreshFilters();
};

/** How many terms are selected across every class. */
function scrayTotalFilterTerms() {
   // Driven off SCRAY_FACET_CLASSES rather than a written-out list, for the same
   // reason the exclude sets are (13.114): the four names here were written
   // before 'note' became a class, so a note-only filter counted as no terms at
   // all - the intersect and Clear all pills stayed away, and the bookmarks page
   // had to add notes back on top of this. 'tag' is not a facet class and keeps
   // its own place at the front.
   return ['tag'].concat(window.SCRAY_FACET_CLASSES || []).reduce((n, k) => {
       const s = scrayFacetSet(k);
       return n + (s ? s.size : 0);
   }, 0) + ((window.scrayNoteKeywordFilter && window.scrayNoteKeywordFilter.size) || 0)
     + ((window.scrayStudioParentFilter && window.scrayStudioParentFilter.size) || 0);
}
window.scrayTotalFilterTerms = scrayTotalFilterTerms;

/**
 * value -> how many videos in the catalogue carry it, for one class.
 *
 * Counted over the WHOLE catalogue rather than the current result set. A cloud
 * that only showed what is already visible could never widen a filter, and
 * with intersect on it would empty itself after the first pick.
 */
async function scrayFacetCounts(kind, genderMode) {
   const videos = await getAllVideos();
   const counts = new Map();
   videos.forEach(v => {
       let values;
       if (kind === 'performer') {
           const p = window.scrayStashNames && window.scrayStashNames.parts(v);
           if (!p) return;
           values = genderMode === 'female' ? (p.performerListF || [])
                  : genderMode === 'male'   ? (p.performerListM || [])
                  : (p.performerListAll || []);
       } else {
           values = scrayFacetValues(v, kind);
       }
       // A scene listing the same tag twice must not count its video twice.
       new Set(values).forEach(val => {
           if (!val) return;
           counts.set(val, (counts.get(val) || 0) + 1);
       });
   });
   return counts;
}
window.scrayFacetCounts = scrayFacetCounts;

// Remembered across opens within a session, not persisted: these are "how am I
// reading this list right now" settings, not filters.
let scrayCloudGender = 'all';
let scrayCloudSort   = 'count';

// Attribute narrowing, per class. Session-only for the same reason as the two
// above. kind -> attrKey -> Set of chosen values.
let scrayCloudAttrPick = {};
// The bucket a value with no attribute filed against it falls into, so "which
// studios have I not classified yet" is one tap rather than a trip back to
// manage-data.html.
const SCRAY_CLOUD_UNSET = '—';

/**
 * The attributes a cloud can narrow by.
 *
 * Only a class with a name-map kind behind it can have any: performers and
 * stash tags are derived live from StashDB and never pass through
 * manage-data.html, so they get an empty list and no rows at all. The list
 * itself is declared once, in api.php - adding a third studio attribute needs
 * no change here.
 */
function scrayCloudAttrDefs(kind) {
   // Studios and notes both carry attributes from manage-data; the rest are
   // derived live and have no row to hang one on.
   if (kind !== 'studio' && kind !== 'note') return [];
   const nm = window.scrayNameMap;
   const defs = (nm && typeof nm.attrDefs === 'function') ? (nm.attrDefs(kind) || []) : [];
   // A check is a flag, not a grouping. Blacklist as a level would offer two
   // buckets, one of which is always empty - those rows are gone from the
   // cloud before it is drawn.
   return defs.filter(d => d && d.type !== 'check');
}

function scrayCloudAttrPickSet(kind, attrKey) {
   const perKind = scrayCloudAttrPick[kind] || (scrayCloudAttrPick[kind] = {});
   return perKind[attrKey] || (perKind[attrKey] = new Set());
}

/**
 * One cloud value's attribute, folded to the unset bucket when it has none.
 *
 * The cloud's names are the MAPPED spellings, already lower-cased by parts().
 * scrayNameMap indexes attributes under both spellings for exactly this, so
 * nothing here has to know whether a studio has been renamed.
 */
function scrayCloudAttrValue(kind, name, attrKey) {
   const nm = window.scrayNameMap;
   const a  = (nm && typeof nm.attrsFor === 'function') ? nm.attrsFor(kind, name) : null;
   const v  = a && a[attrKey];
   return (typeof v === 'string' && v.trim()) ? v.trim() : SCRAY_CLOUD_UNSET;
}

/**
 * Every bucket one cloud value files under for an attribute.
 *
 * A multi attribute (a note's keywords, browse 13.59) is stored as one string
 * joined with " | ", and a note with two keywords belongs in BOTH chips - so it
 * is counted under each, and picking either keyword keeps it. A plain attribute
 * is a list of one, which is what it always was.
 */
function scrayCloudAttrValues(kind, name, def) {
   // A note's keywords are no longer only what was filed (browse 13.62): by
   // default they are the words of the note itself, and scray-config.js owns
   // that rule, including a hand-filed list replacing it.
   if (kind === 'note' && def.key === 'keywords' && typeof window.scrayNoteKeywords === 'function') {
       // With the parent notes they count as, so a search for a parent finds
       // the notes filed under its children too (browse 13.64).
       const list = (window.scrayNoteKeywordsExpanded || window.scrayNoteKeywords)(name);
       return list.length ? list : [SCRAY_CLOUD_UNSET];
   }
   const v = scrayCloudAttrValue(kind, name, def.key);
   if (!def.multi || v === SCRAY_CLOUD_UNSET) return [v];
   const seen = new Map();
   v.split('|').forEach(p => {
       const t = p.trim();
       if (t && !seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t);
   });
   return seen.size ? [...seen.values()] : [SCRAY_CLOUD_UNSET];
}

/* =========================================
   Cross-app hand-off (native 13.192 / picker 13.191)

   Native and Picker can pass a filter or a search to each other:
     - Native's main web view opens Picker in the in-app browser with
       ?xapp=<payload>, and Picker applies it once it has loaded.
     - Picker inside that browser hops to scraynative://play?key=scraycmd:<payload>.
       ScrayBrowser.swift already treats every scraynative:// link other than
       newtab as "dismiss, then hand `key` to scrayPlayByKey", so scray-bridge.js
       spots the prefix and applies it here - no Swift change, no IPA build.
   Picker in an ordinary browser has no way into the app, so it offers
   nothing (the same rule as the list rows' "N" button).

   Payload: base64url of JSON, one of
     { filter: { kind, inc: [...], exc: [...], kw?: [...], kwAll?, intersect? } }
     { search: "term", quote: bool }
   A filter REPLACES that one class in the receiving app (its includes,
   excludes and, for notes, keywords) and leaves the other classes alone.
   ========================================= */
window.scrayCrossAppTarget = function () {
   if (window.ScrayBridge && window.ScrayBridge.openBrowser) return 'Picker';
   if (window.SCRAY_IN_APP_BROWSER) return 'Native';
   return null;
};

function scrayXappEncode(obj) {
   return btoa(unescape(encodeURIComponent(JSON.stringify(obj))))
       .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function scrayXappDecode(str) {
   const s = String(str || '').replace(/-/g, '+').replace(/_/g, '/');
   return JSON.parse(decodeURIComponent(escape(atob(s + '==='.slice((s.length + 3) % 4)))));
}

window.scrayCrossAppOpen = function (cmd) {
   const target = window.scrayCrossAppTarget();
   if (!target || !cmd) return false;
   const payload = scrayXappEncode(cmd);
   if (target === 'Picker') {
       const base = typeof window.scrayPickerUrl === 'function' ? window.scrayPickerUrl() : '';
       if (!base) { alert('No Picker address is set.'); return false; }
       let url;
       try {
           const u = new URL(base);
           u.searchParams.set('xapp', payload);
           url = u.toString();
       } catch (e) {
           url = base + (base.indexOf('?') >= 0 ? '&' : '?') + 'xapp=' + encodeURIComponent(payload);
       }
       window.ScrayBridge.openBrowser(url).catch(err => console.error('[xapp] openBrowser failed:', err));
       return true;
   }
   window.location.href = 'scraynative://play?key=' + encodeURIComponent('scraycmd:' + payload);
   return true;
};

function scrayXappConfirm(msg) {
   const fn = window.showScoreConfirmation || (typeof showScoreConfirmation === 'function' ? showScoreConfirmation : null);
   if (fn) fn(msg);
}

/** Apply a received command. Returns true when something was applied. */
window.scrayCrossAppApply = function (cmd) {
   if (!cmd || typeof cmd !== 'object') return false;
   const from = window.scrayCrossAppTarget() === 'Picker' ? 'Picker' : 'Native';

   if (cmd.filter && cmd.filter.kind) {
       const f = cmd.filter;
       const kind = String(f.kind);
       const set = scrayFacetSet(kind);
       if (!set) return false;
       const norm = (v) => kind === 'tag' ? String(v).trim() : String(v).trim().toLowerCase();
       set.clear();
       (f.inc || []).map(norm).filter(Boolean).forEach(v => set.add(v));
       if (kind === 'tag') {
           const $sel = typeof $ === 'function' ? $('#excludeTagSelect') : null;
           if ($sel && $sel.length) {
               const exc = (f.exc || []).map(norm).filter(Boolean);
               exc.forEach(v => {
                   if (!$sel.find('option').filter(function () { return this.value === v; }).length) {
                       $sel.append(new Option(v, v, false, false));
                   }
               });
               $sel.val(exc).trigger('change');
           }
       } else {
           const ex = scrayFacetExcludeSet(kind);
           if (ex) { ex.clear(); (f.exc || []).map(norm).filter(Boolean).forEach(v => ex.add(v)); }
       }
       if (kind === 'note' && window.scrayNoteKeywordFilter) {
           window.scrayNoteKeywordFilter.clear();
           (f.kw || []).map(v => String(v).trim()).filter(Boolean).forEach(v => window.scrayNoteKeywordFilter.add(v));
           if (typeof f.kwAll === 'boolean') window.scrayNoteKeywordIntersect = f.kwAll;
       }
       if (typeof f.intersect === 'boolean') window.scrayTagIntersect = f.intersect;
       window.skipSearchScroll = true;
       scrayRefreshFilters();
       const label = (window.SCRAY_FACET_META[kind] || {}).label || kind;
       scrayXappConfirm('✅ ' + label + ' filter from ' + from);
       return true;
   }

   if (typeof cmd.search === 'string' && cmd.search.trim()) {
       const box = document.getElementById('filenameSearchBox');
       if (!box) return false;
       // The search REPLACES what was in the box, the way the rename modal's
       // own 🔍 does.
       box.value = '';
       const panelBox = document.getElementById('panelSearchBox');
       if (panelBox) panelBox.value = '';
       const term = cmd.search.trim();
       if (cmd.quote && typeof window.scrayAddSearchTerm === 'function') {
           window.scrayAddSearchTerm(term);
       } else {
           box.value = term;
           const clearX = document.getElementById('clearSearchX');
           if (clearX) clearX.style.display = 'block';
           if (panelBox) panelBox.value = term;
           window.skipSearchScroll = true;
           window.skipPanelAutoOpen = true;
           if (typeof filterDisplayedByFilename === 'function') filterDisplayedByFilename();
       }
       // The pills bar mirrors the box; nudge it so the pill shows the term.
       if (typeof updateFloatingTagPillsFromCommon === 'function') updateFloatingTagPillsFromCommon();
       scrayXappConfirm('✅ Search from ' + from);
       return true;
   }
   return false;
};

/** scray-bridge.js hands over the part after "scraycmd:". */
window.scrayCrossAppReceive = function (payload) {
   try {
       return window.scrayCrossAppApply(scrayXappDecode(payload));
   } catch (err) {
       console.error('[xapp] could not read the hand-off:', err);
       alert('Couldn’t read what was sent from Picker.');
       return false;
   }
};

// Picker opened with ?xapp=. Waits for the lock screen, the filters and the
// library, applies it, then takes the parameter off the address so a reload
// doesn't apply it again. Not in Native's main web view, which is never opened
// with it.
(function scrayXappFromUrl() {
   if (window.ScrayBridge && window.ScrayBridge.openBrowser) return;
   let payload = '';
   try { payload = new URL(location.href).searchParams.get('xapp') || ''; } catch (e) { return; }
   if (!payload) return;
   const dropParam = () => {
       try {
           const u = new URL(location.href);
           u.searchParams.delete('xapp');
           history.replaceState(history.state, '', u.toString());
       } catch (e) { /* stays in the address; harmless */ }
   };
   let cmd;
   try { cmd = scrayXappDecode(payload); } catch (e) { dropParam(); return; }
   // ⚙️ How long to wait for the page to be ready before giving up.
   const GIVE_UP_MS = 120000;
   const started = Date.now();
   let busy = false, timer = null;
   const tick = async () => {
       if (busy) return;
       busy = true;
       try {
           const lock = document.getElementById('lockOverlay');
           const locked = lock && getComputedStyle(lock).display !== 'none';
           const ready = !locked
               && document.getElementById('filenameSearchBox')
               && typeof window.refreshFiltersFromCommonSet === 'function'
               && typeof window.getAllVideos === 'function';
           if (ready) {
               const all = await window.getAllVideos();
               if (all && all.length) {
                   clearInterval(timer);
                   dropParam();
                   window.scrayCrossAppApply(cmd);
                   return;
               }
           }
           if (Date.now() - started > GIVE_UP_MS) { clearInterval(timer); dropParam(); }
       } catch (err) {
           console.error('[xapp] apply from URL failed:', err);
       } finally {
           busy = false;
       }
   };
   timer = setInterval(tick, 1000);
})();

/**
 * The big picker that replaced the AT dropdown.
 *
 * One button per value with its count. Tapping toggles it and the modal STAYS
 * OPEN, which is the whole reason it exists: select2 closed on every pick, so
 * adding six performers meant six round trips through the dropdown.
 */
async function showTagCloudModal(kind) {
   const meta = window.SCRAY_FACET_META[kind];
   const set  = scrayFacetSet(kind);
   if (!meta || !set) return;

   const overlay = document.createElement('div');
   overlay.className = 'tag-selection-overlay';

   const content = document.createElement('div');
   content.className = 'tag-selection-content scray-cloud-content';
   overlay.appendChild(content);

   const title = document.createElement('h3');
   title.textContent = meta.label;
   content.appendChild(title);

   const controls = document.createElement('div');
   controls.className = 'scray-cloud-controls';
   content.appendChild(controls);

   // Narrows the CLOUD only, never the list behind it. With several hundred
   // performers a flat wall of pills is unusable without it.
   const search = document.createElement('input');
   search.type = 'search';
   search.className = 'scray-cloud-search';
   search.placeholder = 'Narrow this list\u2026';
   controls.appendChild(search);

   // Filter / search in the other app (native 13.192 / picker 13.191), and
   // Search in Stash (picker 14.12 / native 14.18). Built here, placed under
   // the Clear / Close footer (it used to sit under the box). Filter takes
   // this class's selection - includes, excludes and a note cloud's keywords;
   // the Search buttons (studios and performers) take the one selected value
   // and need exactly one. The cross-app pair only exists where there is an
   // other app to hand to (Native's main view, or Picker inside Native's
   // in-app browser) - a plain desktop browser has neither.
   const xappTarget = typeof window.scrayCrossAppTarget === 'function' ? window.scrayCrossAppTarget() : null;
   const searchable = kind === 'studio' || kind === 'performer';
   const oneLabel = kind === 'studio' ? 'studio' : 'performer';
   let xappFilterBtn = null, xappSearchBtn = null, stashSearchBtn = null, xrow = null;
   if (xappTarget || searchable) {
       xrow = document.createElement('div');
       xrow.className = 'scray-cloud-xapp';
       xrow.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 0;width:100%;';
   }
   const mkX = (label, fn) => {
       const b = document.createElement('button');
       b.type = 'button';
       b.className = 'scray-cloud-toggle';
       b.style.cssText = 'background:#6c5ce7;border-color:#6c5ce7;color:#fff;';
       b.textContent = label;
       b.addEventListener('click', fn);
       xrow.appendChild(b);
       return b;
   };
   if (xappTarget) {
       xappFilterBtn = mkX('Filter in ' + xappTarget, () => {
           const exc = kind === 'tag'
               ? ((typeof $ === 'function' && $('#excludeTagSelect').val()) || [])
               : [...(scrayFacetExcludeSet(kind) || [])];
           const kw = kind === 'note' ? [...(window.scrayNoteKeywordFilter || [])] : [];
           if (!set.size && !exc.length && !kw.length) {
               alert('Select something first.');
               return;
           }
           const filter = { kind, inc: [...set], exc, intersect: !!window.scrayTagIntersect };
           if (kind === 'note') { filter.kw = kw; filter.kwAll = !!window.scrayNoteKeywordIntersect; }
           window.scrayCrossAppOpen({ filter });
       });
       if (searchable) {
           xappSearchBtn = mkX('Search in ' + xappTarget, () => {
               if (set.size !== 1) {
                   alert('Search needs exactly one selected (green) ' + oneLabel + '.');
                   return;
               }
               window.scrayCrossAppOpen({ search: [...set][0], quote: true });
           });
       }
   }
   if (searchable) {
       // Opens that studio's / performer's page in the Stash navigator - via
       // the playing file's Stash modal if there is one. "Open", not "Search"
       // (picker 14.17 / native 14.30): every value here came off a matched
       // scene, so one of those files is sent along and the server takes the
       // studio / performer straight from that scene rather than searching
       // StashDB for the (possibly mapped) name.
       stashSearchBtn = mkX('Open in Stash', async () => {
           if (set.size !== 1) {
               alert('Open needs exactly one selected (green) ' + oneLabel + '.');
               return;
           }
           // Nothing needs to be playing (picker 14.13 / native 14.19): with no
           // file the navigator opens on its own, just browsing.
           if (!window.scrayStashNav || typeof window.scrayStashNav.openProfile !== 'function') return;
           const name = [...set][0];
           close();
           let fromKey = '';
           try {
               const all = await getAllVideos();
               const hit = all.find(v => scrayFacetValues(v, kind).includes(name));
               if (hit && window.scrayStashNames) fromKey = window.scrayStashNames.keyFor(hit);
           } catch { /* no file to go by - the server falls back to the name */ }
           window.scrayStashNav.openProfile(kind, name, fromKey);
       });
   }
   const paintXapp = () => {
       const dim = set.size === 1 ? '' : '.45';
       if (xappSearchBtn) xappSearchBtn.style.opacity = dim;
       if (stashSearchBtn) stashSearchBtn.style.opacity = dim;
   };
   // NOTE cloud (picker 13.148 / stg-native 13.146): keywords are the way
   // in now, so the box narrows the Keyword chips, and the notes below
   // follow - a note shows when one of its keywords matches the term.
   const searchesKeywords = kind === 'note';
   // Loose on purpose (picker 13.150 / stg-native 13.148): every word typed is
   // its own term and a keyword matching ANY of them shows, so "mish ts" brings
   // up both "mish" and "ts" rather than nothing.
   const termHit = (v) => {
       const s = String(v).toLowerCase();
       return term.split(/\s+/).some(w => w && s.includes(w));
   };
   if (searchesKeywords) search.placeholder = 'Search keywords\u2026';

   const btnRow = document.createElement('div');
   btnRow.className = 'scray-cloud-btnrow';
   controls.appendChild(btnRow);

   // The attribute rows sit between the controls and the grid because that is
   // the order they get used in: narrow to a region, then pick studios out of
   // what is left.
   const attrDefs = scrayCloudAttrDefs(kind);
   const attrWrap = document.createElement('div');
   attrWrap.className = 'scray-cloud-attrs';
   controls.appendChild(attrWrap);
   // NOTE cloud: the keyword chips scroll in a box of their own. In the flow
   // they were hundreds of chips, and the notes grid below - the part that
   // takes the rest of the height - was squeezed to nothing.
   if (kind === 'note') {
       attrWrap.classList.add('scray-cloud-note-keywords');
       const notesLabel = document.createElement('div');
       notesLabel.className = 'scray-cloud-sectionlabel';
       notesLabel.textContent = 'Mapped notes';
       content.appendChild(notesLabel);
   }

   const grid = document.createElement('div');
   grid.className = 'tag-selection-grid scray-cloud-grid' + (kind === 'note' ? ' scray-cloud-note-grid' : '');
   content.appendChild(grid);

   let counts = new Map();
   let keywordCounts = new Map();
   let shown  = [];
   let term   = '';
   // The picked keywords live in the real filter, not the cloud's own narrowing.
   const keywordPicks = () => window.scrayNoteKeywordFilter;
   // A studio's Parent row IS the network filter (picker 14.8 / native 14.12):
   // its picks live in scrayStudioParentFilter and filter the videos, not just
   // the cloud. Every other attribute row still only narrows the cloud.
   const isNetworkDef = (def) => kind === 'studio' && def && def.key === 'parent';
   const attrPickSet = (def) => isNetworkDef(def)
       ? window.scrayStudioParentFilter
       : scrayCloudAttrPickSet(kind, def.key);
   const isKeywordsDef = (def) => kind === 'note' && def.key === 'keywords';

   const close = () => {
       document.removeEventListener('keydown', escHandler);
       if (overlay.parentNode) document.body.removeChild(overlay);
   };
   const escHandler = (e) => { if (e.key === 'Escape') close(); };

   function mkToggle(label, on, fn) {
       const b = document.createElement('button');
       b.type = 'button';
       b.className = 'scray-cloud-toggle' + (on ? ' is-on' : '');
       b.textContent = label;
       b.addEventListener('click', fn);
       btnRow.appendChild(b);
       return b;
   }

   function renderControls() {
       btnRow.innerHTML = '';

       // Female / Male / All. Performers only - no other class has a gender.
       // "All" includes the codes StashDB reports that are neither F nor M, so
       // nobody is unreachable.
       if (kind === 'performer') {
           [['Female', 'female'], ['Male', 'male'], ['All', 'all']].forEach(pair => {
               mkToggle(pair[0], scrayCloudGender === pair[1], async () => {
                   scrayCloudGender = pair[1];
                   await rebuild();
               });
           });
       }

       mkToggle(scrayCloudSort === 'count' ? 'Sort: count' : 'Sort: A\u2013Z', false, () => {
           scrayCloudSort = scrayCloudSort === 'count' ? 'alpha' : 'count';
           renderControls();
           if (kind === 'note') renderAttrRows();
           renderGrid();
       });

       // Keywords: a bookmark with ANY picked keyword, or with ALL of them.
       if (kind === 'note') {
           mkToggle(window.scrayNoteKeywordIntersect ? 'Keywords: all \u2229' : 'Keywords: any \u222A',
               window.scrayNoteKeywordIntersect, () => {
                   window.scrayNoteKeywordIntersect = !window.scrayNoteKeywordIntersect;
                   scrayRefreshFilters();
                   renderControls();
                   renderGrid();
               });
       }

       // The intersect switch. Global rather than per-class, and offered in
       // every cloud so it is reachable from whichever one happens to be open.
       mkToggle('Tag intersect', window.scrayTagIntersect, () => {
           window.scrayTagIntersect = !window.scrayTagIntersect;
           scrayRefreshFilters();
           renderControls();
       });

       // With a narrowing on, "every studio in this region" is usually the
       // whole point, and tapping thirty of them one at a time is not.
       if (attrDefs.length) {
           mkToggle('Select all shown', false, () => {
               shown.forEach(n => set.add(n));
               scrayRefreshFilters();
               renderGrid();
           });
       }
   }

   /**
    * A chip row per attribute, built from the values actually in use.
    *
    * The tallies are counted over EVERY name in the cloud rather than over
    * what the other rows have already narrowed to: a chip that vanished the
    * moment a sibling chip was used would be a trap door.
    */
   function renderAttrRows() {
       attrWrap.innerHTML = '';
       if (!attrDefs.length || !counts.size) return;

       attrDefs.forEach(def => {
           const tally = new Map();
           if (isKeywordsDef(def)) {
               keywordCounts.forEach((n, v) => tally.set(v, n));
               // A picked keyword nothing carries any more still needs its chip.
               keywordPicks().forEach(v => { if (!tally.has(v)) tally.set(v, 0); });
           } else {
               counts.forEach((n, name) => {
                   scrayCloudAttrValues(kind, name, def).forEach(v =>
                       tally.set(v, (tally.get(v) || 0) + n));
               });
           }
           // Nothing filled in for this attribute yet, so no row - rather than
           // a row with a single "everything is unset" chip in it.
           if (tally.size <= 1 && tally.has(SCRAY_CLOUD_UNSET)) return;

           const picked = isKeywordsDef(def) ? keywordPicks() : attrPickSet(def);
           // The search box narrows the keyword chips. A picked one stays, so
           // the way to undo it is never hidden behind clearing the box.
           if (searchesKeywords && def.key === 'keywords' && term) {
               [...tally.keys()].forEach(v => {
                   if (v === SCRAY_CLOUD_UNSET) { tally.delete(v); return; }
                   // A parent note brings its children with it (browse 13.64).
                   const par = window.scrayKeywordParentOf ? window.scrayKeywordParentOf(v) : null;
                   if (!termHit(v) && !picked.has(v) && !(par && (picked.has(par) || termHit(par)))) tally.delete(v);
               });
           }
           const row = document.createElement('div');
           row.className = 'scray-cloud-attrrow';

           const label = document.createElement('span');
           label.className = 'scray-cloud-attrlabel';
           label.textContent = def.label;
           row.appendChild(label);

           const chip = (text, on, fn, n, cls) => {
               const b = document.createElement('button');
               b.type = 'button';
               b.className = 'scray-cloud-attrchip' + (on ? ' is-on' : '') + (cls ? ' ' + cls : '');
               b.textContent = text;
               if (n != null) {
                   const c = document.createElement('span');
                   c.className = 'scray-cloud-count';
                   c.textContent = '(' + n + ')';
                   b.appendChild(c);
               }
               b.addEventListener('click', fn);
               row.appendChild(b);
           };

           // Picking a keyword changes the real filter (videos, pills), so it
           // re-runs it; the other rows only narrow what the cloud shows.
           const afterPick = () => {
               if (isKeywordsDef(def) || isNetworkDef(def)) scrayRefreshFilters();
               renderAttrRows();
               renderGrid();
           };

           chip('All', !picked.size, () => {
               picked.clear();
               afterPick();
           });

           const byCount = isKeywordsDef(def) && scrayCloudSort === 'count';
           let ordered = [...tally.keys()].sort((a, b) =>
               a === SCRAY_CLOUD_UNSET ? 1
             : b === SCRAY_CLOUD_UNSET ? -1
             : (byCount && tally.get(b) !== tally.get(a)) ? tally.get(b) - tally.get(a)
             : a.localeCompare(b, undefined, { sensitivity: 'base' })
           );
           // Parent notes (browse 13.64): bold, with their children straight
           // after them rather than scattered through the sort.
           const kwTree = isKeywordsDef(def) && typeof window.scrayKeywordTree === 'function' ? window.scrayKeywordTree() : null;
           if (kwTree && kwTree.parentOf.size) {
               const inList = new Set(ordered);
               const placed = new Set();
               const out = [];
               ordered.forEach(v => {
                   if (placed.has(v)) return;
                   const par = kwTree.parentOf.get(v);
                   if (par && inList.has(par)) return;          // goes under its parent
                   out.push(v); placed.add(v);
                   (kwTree.children.get(v) || []).forEach(c => {
                       if (inList.has(c) && !placed.has(c)) { out.push(c); placed.add(c); }
                   });
               });
               ordered = out;
           }
           ordered.forEach(v => chip(v, picked.has(v), () => {
               if (picked.has(v)) picked.delete(v); else picked.add(v);
               afterPick();
           }, tally.get(v), kwTree && kwTree.parents.has(v) ? 'is-parent' : ''));

           attrWrap.appendChild(row);
       });
   }

   function syncTitle(shown) {
       const ex = scrayExcludeCount(kind);
       const np = kind === 'note' ? keywordPicks().size : 0;
       title.textContent = meta.label + ' \u2014 '
           + (kind === 'note' ? np + (np === 1 ? ' keyword, ' : ' keywords, ') : '')
           + set.size + ' selected'
           + (ex ? ', ' + ex + ' excluded' : '')
           + ', ' + shown + ' shown';
       paintXapp();
   }

   function renderGrid() {
       grid.innerHTML = '';
       let names = Array.from(counts.keys());

       // Every active attribute row has to agree - two Regions is "either", a
       // Region and a Class is "both", which is how a two-axis grid is
       // normally read. A value already selected stays visible either way, on
       // the same principle as the search box below.
       attrDefs.forEach(def => {
           if (isKeywordsDef(def)) {
               // Same test the filter itself uses, intersect included.
               if (!keywordPicks().size) return;
               names = names.filter(n =>
                   set.has(n) || scrayIsExcluded(kind, n) || scrayNoteKeywordsPass(n));
               return;
           }
           const picked = attrPickSet(def);
           if (!picked.size) return;
           names = names.filter(n =>
               set.has(n) || scrayIsExcluded(kind, n) ||
               scrayCloudAttrValues(kind, n, def).some(v => picked.has(v)));
       });

       // A selected value stays visible even once it stops matching the search
       // box, so the way to undo a pick is never hidden behind clearing the
       // box first. An EXCLUDED one has to stay for the same reason and more
       // so: the only way back to neutral is the third tap on that same chip,
       // and a chip that vanished on tap two would strand it.
       const keywordsDef = searchesKeywords ? attrDefs.find(d => d.key === 'keywords') : null;
       // Once keywords are picked, the notes shown are the ones under them; the
       // box is then only for finding more keywords, so it leaves the grid be.
       if (term && !(keywordsDef && keywordPicks().size)) names = names.filter(n =>
           (keywordsDef
               ? scrayCloudAttrValues(kind, n, keywordsDef).some(v =>
                     v !== SCRAY_CLOUD_UNSET && termHit(v))
               : n.toLowerCase().includes(term))
           || set.has(n) || scrayIsExcluded(kind, n));

       names.sort(scrayCloudSort === 'alpha'
           ? (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })
           : (a, b) => (counts.get(b) - counts.get(a)) || a.localeCompare(b));

       // What "Select all shown" means, kept here so it can never disagree
       // with what is actually painted.
       shown = names;
       syncTitle(names.length);

       if (!names.length) {
           const empty = document.createElement('span');
           empty.className = 'scray-cloud-empty';
           empty.textContent = 'Nothing matches.';
           grid.appendChild(empty);
           return;
       }

       // One chip, three states, so include and exclude live on the same
       // control rather than in two lists that have to be kept in step.
       const paintItem = (btn, name) => {
           const on = set.has(name);
           const ex = scrayIsExcluded(kind, name);
           btn.classList.toggle('is-on', on);
           btn.classList.toggle('is-ex', ex);
           btn.title = ex ? name + ' \u2014 excluded (tap to clear)'
                     : on ? name + ' \u2014 included (tap to exclude)'
                          : name;
       };

       names.forEach(name => {
           const btn = document.createElement('button');
           btn.type = 'button';
           btn.className = 'tag-selection-item scray-cloud-item scray-cloud-' + kind;
           btn.textContent = name;

           const c = document.createElement('span');
           c.className = 'scray-cloud-count';
           c.textContent = '(' + counts.get(name) + ')';
           btn.appendChild(c);

           paintItem(btn, name);

           btn.addEventListener('click', () => {
               // off -> include -> exclude -> off. Cycling rather than
               // toggling because inside the cloud the current state is on
               // screen, so the next tap always has an obvious meaning; the
               // row chips still only ADD, where nothing is visible.
               const wasIn = set.has(name);
               const wasEx = scrayIsExcluded(kind, name);
               let refresh = true;

               if (wasEx) {
                   refresh = scraySetExcluded(kind, name, false);
               } else if (wasIn) {
                   // Include and exclude are mutually exclusive states of one
                   // chip, so the include comes off in the same step.
                   set.delete(name);
                   refresh = scraySetExcluded(kind, name, true);
               } else {
                   set.add(name);
               }

               paintItem(btn, name);
               syncTitle(names.length);
               if (refresh) scrayRefreshFilters();
           });

           grid.appendChild(btn);
       });
   }

   async function rebuild() {
       counts = await scrayFacetCounts(kind, scrayCloudGender);
       if (kind === 'note') keywordCounts = await scrayNoteKeywordCounts();
       renderControls();
       renderAttrRows();
       renderGrid();
   }

   search.addEventListener('input', () => {
       term = search.value.trim().toLowerCase();
       if (searchesKeywords) renderAttrRows();
       renderGrid();
   });

   const footer = document.createElement('div');
   footer.className = 'scray-cloud-footer';

   const clearBtn = document.createElement('button');
   clearBtn.className = 'tag-selection-close';
   clearBtn.style.background = '#f44336';
   clearBtn.style.flex = '1';
   clearBtn.textContent = 'Clear ' + meta.label.toLowerCase();
   clearBtn.addEventListener('click', () => {
       set.clear();
       // Both halves of this class, not just the includes: the button says
       // "clear studios" and leaving three excluded ones behind would be a
       // filter still running with nothing on screen to show for it.
       if (kind === 'tag') {
           if ($('#excludeTagSelect').length) $('#excludeTagSelect').val([]).trigger('change');
       } else {
           const ex = scrayFacetExcludeSet(kind);
           if (ex) ex.clear();
       }
       if (kind === 'note') keywordPicks().clear();
       scrayRefreshFilters();
       renderAttrRows();
       renderGrid();
   });
   footer.appendChild(clearBtn);

   const closeBtn = document.createElement('button');
   closeBtn.className = 'tag-selection-close';
   closeBtn.style.flex = '1';
   closeBtn.textContent = 'Close';
   closeBtn.addEventListener('click', close);
   footer.appendChild(closeBtn);

   content.appendChild(footer);
   if (xrow) content.appendChild(xrow);

   overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
   document.addEventListener('keydown', escHandler);
   document.body.appendChild(overlay);

   // Painted empty first, then filled: counting runs over the whole catalogue
   // and on a large library that is long enough to look like a dead tap.
   grid.innerHTML = '<span class="scray-cloud-empty">Counting\u2026</span>';
   renderControls();
   await rebuild();
}
window.showTagCloudModal = showTagCloudModal;

/* =========================================
Dynamic bottom spacer to keep search bar at top
========================================= */
function adjustBottomSpacer(bufferPx = 80) {
const viewportHeight = window.innerHeight;
const bodyHeight = document.body.scrollHeight;
const spacer = document.getElementById("bottomSpacer");
if (!spacer) return;

// Add bufferPx on top of the difference
if (bodyHeight < viewportHeight - 20) {
   spacer.style.height = (viewportHeight - bodyHeight + bufferPx) + "px";
} else {
   spacer.style.height = bufferPx + "px"; // always a small buffer
}
}

/* =========================================
External Tag Pills Helper Functions
========================================= */
function ensureTagContainer(selectElem, containerId) {
let container = document.getElementById(containerId);
if (!container) {
   container = document.createElement('div');
   container.id = containerId;
   container.className = 'tag-container';
   selectElem.parentNode.insertBefore(container, selectElem);
}
return container;
}

function updateTagPills(containerSelector, selectElem) {
const container = document.querySelector(containerSelector);
container.innerHTML = '';
const values = $(selectElem).val() || [];

values.forEach(val => {
   const pill = document.createElement('span');
   pill.className = 'tag-pill';
   pill.textContent = val;

   const removeBtn = document.createElement('button');
   removeBtn.innerHTML = '&times;';
   removeBtn.onclick = () => {
       const updated = values.filter(tag => tag !== val);
       $(selectElem).val(updated).trigger('change');
   };

   pill.appendChild(removeBtn);
   container.appendChild(pill);
});
}

/**
* ✅ Floating pills bar at bottom
*/
function updateFloatingTagPills() {
const includes = [
...($('#tagFilterLevel1Select').val() || []),
...($('#tagFilterLevel2Select').val() || []),
...($('#tagFilterLevel3Select').val() || []),
...($('#tagFilterAllSelect').val() || [])
];

const excludes = $('#excludeTagSelect').val() || [];
const container = document.getElementById("floatingTagPillsBar");
if (!container) return;
container.innerHTML = '';

includes.forEach(tag => {
   const pill = document.createElement("span");
   pill.className = "floating-tag-pill floating-tag-include";
   pill.textContent = tag;
   pill.title = "Click to remove this include tag";
   pill.addEventListener("click", () => {
       // Remove from whichever dropdown it's in
       ["Level1","Level2","Level3","Remaining"].forEach(levelName => {
           const sel = $(`#tagFilter${levelName}Select`);
           if (sel.val().includes(tag)) {
               sel.val(sel.val().filter(t => t !== tag)).trigger('change');
           }
       });
   });
   container.appendChild(pill);
});

excludes.forEach(tag => {
   const pill = document.createElement("span");
   pill.className = "floating-tag-pill floating-tag-exclude";
   pill.textContent = tag;
   pill.title = "Click to remove this exclude tag";
   pill.addEventListener("click", () => {
       $('#excludeTagSelect').val(excludes.filter(t => t !== tag)).trigger('change');
   });
   container.appendChild(pill);
});
}

/* =========================================
Populate Tag Dropdowns
========================================= */
async function populateTagDropdowns() {
const videos = await getAllVideos();

// Helper: populate a select from a set of tags
function fillSelect(selectId, containerId, tags) {
   const selectElem = document.getElementById(selectId);
   ensureTagContainer(selectElem, containerId);
   const select = $(`#${selectId}`);

   // Get current selection so we can keep it when options change
   const currentSelection = select.val() || [];

   select.empty();
   Array.from(tags).sort().forEach(tag => {
       select.append(new Option(tag, tag, false, false));
   });

   // Restore currentSelection but only keep tags that still exist in options
   const validSelection = currentSelection.filter(tag => tags.has(tag));
   select.val(validSelection);

   select.select2({
   placeholder:
 selectId === "tagFilterLevel1Select" ? "Level 1 tags"
: selectId === "tagFilterLevel2Select" ? "Level 2 tags"
: selectId === "tagFilterLevel3Select" ? "Level 3 tags"
: selectId.includes("All") ? "All tags"
: "Search tags",
   allowClear: false,
   dropdownAutoWidth: true,
   closeOnSelect: false,
   dropdownCssClass: "full-height-dropdown",
   minimumResultsForSearch: 0 // ✅ Always show search box but don't auto-focus it
   });

}

// Initial sets — full tag options
const level1Set = new Set(videos.map(v => v.level_1).filter(Boolean));
const level2Set = new Set(videos.map(v => v.level_2).filter(Boolean));
const level3Set = new Set(videos.map(v => v.level_3).filter(Boolean));

// ✅ Add level_5 bracket tags to Level 3 dropdown
videos.forEach(v => {
if (v.level_5) {
    // level_5 may contain folder data (with underscores) and/or bracket tags (with semicolons)
    // Split by semicolon to get bracket tags, filter out folder data (contains underscore)
    const level5Parts = v.level_5.split(';').filter(Boolean);
    level5Parts.forEach(part => {
        // Only add parts without underscores (pure bracket tags, not folder joins)
        if (!part.includes('_')) {
            level3Set.add(part);
        }
    });
}
});

const allTagsSet = new Set();

// ✅ Add ALL tags to All Tags dropdown (no exclusions)
videos.forEach(v => {
(v.tags || []).forEach(tag => {
 allTagsSet.add(tag);
});
});

// Fill all selects initially
fillSelect("tagFilterLevel1Select", "includeTagsLevel1Container", level1Set);
fillSelect("tagFilterLevel2Select", "includeTagsLevel2Container", level2Set);
fillSelect("tagFilterLevel3Select", "includeTagsLevel3Container", level3Set);
fillSelect("tagFilterAllSelect", "includeTagsAllContainer", allTagsSet);

// Floating pills from global set
// ---------------------------------------------------------------
// The clear-search bin. Driven by keyboard state rather than by a tap on
// the pill, so it appears whenever the pill is actually being edited -
// including when the search box is focused directly.
//
// Idempotent: safe to call on every keyboard/viewport event. It creates
// the popup once and then leaves it alone.
// ---------------------------------------------------------------
function ensureSearchPillPopup() {
    // Retired in 13.80. The pill carries its own x now, so there is nothing
    // left for this to offer - it only ever held a bin. Kept as a function
    // rather than deleted because the keyboard and viewport handlers call it
    // on every event; it now just makes sure nothing is left on screen.
    dismissSearchPillPopup();
    return;

    /* eslint-disable no-unreachable */
    const pill = document.querySelector('.floating-tag-search');
    const editing = document.body.classList.contains('keyboard-active') &&
                    document.body.classList.contains('search-pill-active');

    if (!pill || !editing) { dismissSearchPillPopup(); return; }
    if (document.getElementById('searchPillPopup')) return;   // already up

    const popup = document.createElement('div');
    popup.id = 'searchPillPopup';
    popup.className = 'search-pill-popup';

    const clearBtn = document.createElement('button');
    clearBtn.className = 'search-pill-popup-btn';
    clearBtn.textContent = '🗑️';
    clearBtn.title = 'Clear search';
    // mousedown/touchstart would fire before the button gets its click, and
    // blurring the search box closes the keyboard, which dismisses this
    // popup out from under the tap. preventDefault keeps focus put.
    clearBtn.addEventListener('mousedown', (ev) => ev.preventDefault());
    clearBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        popup.remove();
        window.clearSearchPillFilter?.(ev);
    });

    popup.appendChild(clearBtn);
    document.body.appendChild(popup);

    const reposition = () => {
        // Re-query every time. The pills bar rebuilds itself
        // (container.innerHTML = '') on every keystroke, so any captured
        // node is detached within a character or two - and a detached
        // node's getBoundingClientRect() is all zeros, which is what used
        // to park this in the top-left corner.
        const live = document.querySelector('.floating-tag-search');
        if (!live) { popup.style.display = 'none'; return; }

        const rect = live.getBoundingClientRect();
        if (!rect.width && !rect.height) { popup.style.display = 'none'; return; }
        popup.style.display = 'flex';

        const pRect = popup.getBoundingClientRect();
        const gap = 6;

        let left = rect.left + (rect.width / 2) - (pRect.width / 2);
        left = Math.max(4, Math.min(left, window.innerWidth - pRect.width - 4));

        let top = rect.top - pRect.height - gap;
        if (top < 4) top = rect.bottom + gap;   // no room above

        popup.style.left = left + 'px';
        popup.style.top  = top + 'px';
    };

    // Per-frame rather than event-driven: a pills-bar rebuild fires no
    // resize or scroll event, and the pill changes width as you type. The
    // loop ends itself the moment the popup leaves the DOM.
    const track = () => {
        if (!popup.isConnected) return;
        reposition();
        requestAnimationFrame(track);
    };
    requestAnimationFrame(track);

    // No outside-click dismissal any more. Keyboard state owns visibility
    // now, and an outside-click handler would kill the bin the moment you
    // tapped back into the search box - which is exactly when you want it.
    const escHandler = (ev) => {
        if (ev.key === 'Escape') {
            popup.remove();
            document.removeEventListener('keydown', escHandler);
        }
    };
    window.scrayEscapeWhileOpen(popup, escHandler); // not left behind on close (13.182)
}

function dismissSearchPillPopup() {
    document.getElementById('searchPillPopup')?.remove();
}

window.ensureSearchPillPopup = ensureSearchPillPopup;
window.dismissSearchPillPopup = dismissSearchPillPopup;

// Defined out here, NOT inside the pill's click handler. It used to be
// assigned in there, which meant it didn't exist until you'd tapped the pill
// once - so on a fresh launch the bin's `window.clearSearchPillFilter?.(ev)`
// optional-chained into nothing and the tap appeared to do nothing at all.
// It closes over no local state, so there was never a reason for it to live
// inside the handler.
window.clearSearchPillFilter = function (e) {
    // Dismiss the on-screen keyboard. Necessary explicitly: the bin
    // preventDefaults its press to avoid losing focus mid-tap, so nothing
    // else is going to blur the input. Done first so the keyboard starts
    // animating away immediately rather than after the re-filter.
    const mainSearchBox  = document.getElementById("filenameSearchBox");
    const panelSearchBox = document.getElementById("panelSearchBox");
    mainSearchBox?.blur();
    panelSearchBox?.blur();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();

    // Clear main search box
    const mainClearX = document.getElementById("clearSearchX");
    if (mainSearchBox) {
        mainSearchBox.value = "";
        if (mainClearX) mainClearX.style.display = "none";
    }

    // Clear panel search box
    const panelClearX = document.getElementById("panelSearchClearX");
    if (panelSearchBox) {
        panelSearchBox.value = "";
        if (panelClearX) panelClearX.style.display = "none";
    }

    // Show "Filter cleared" tooltip
    if (typeof showButtonFeedback === 'function') {
        showButtonFeedback("Filter cleared", e);
    }

    // ✅ Prevent panel from auto-opening
    window.skipPanelAutoOpen = true;
    // Clearing the search is not a reason to move the page (picker 13.192 /
    // native 13.193). Holding the corner 🔍 comes through here, and the filter
    // pass below ended by scrolling to the results. The short window covers
    // a second pass as well (the pill's blur, wholesale's random re-filter).
    window.skipSearchScroll = true;
    window.scraySuppressScrollUntil = Date.now() + 1500;

    // Trigger filter refresh
    if (typeof filterDisplayedByFilename === 'function') {
        filterDisplayedByFilename();
    }
};

/* =========================================================================
   THE SEARCH PILL  (13.84)
   =========================================================================
   The pill IS the filter box on a phone now.

   #filenameSearchBox is still the single source of truth - the context
   menu's "search this", Clear all, the panel box and the fullscreen filter
   pill all read and write it, and its own input listener is the only thing
   that knows how to filter - but on a phone it is hidden, and what you type
   into is a real <input> living inside the pill. Two things fall out of that
   which were awkward before:

     - the caret is the browser's own, so it blinks where the text actually
       is. It used to be a '|' glued on with ::after, which sat after the x.
     - the pill grows with the text, because an input can be sized in ch.

   Empty and unfocused, it collapses to a grey stub with just the magnifier,
   at the same text size as every other pill in the bar. Tapping it wakes it
   up: full pink, and the text two steps larger for as long as you are typing
   in it.

   The one rule this imposes on the rest of the bar: the pill must SURVIVE a
   rebuild. The bar is rebuilt on every keystroke, and detaching a focused
   input blurs it - which on a phone shuts the keyboard mid-word. So the
   rebuilds empty the bar AROUND it; see clearPillsExceptSearch.
   ====================================================================== */

/** Empty the pills bar without touching the search pill. */
function clearPillsExceptSearch(container) {
    Array.from(container.children).forEach((child) => {
        if (!child.classList.contains('floating-tag-search-wrap')) child.remove();
    });
}

/** The real box. Still where the filter lives, hidden or not. */
function mainSearchEl() { return document.getElementById('filenameSearchBox'); }

/**
 * Collapsed or open, and how wide. ch is relative to the input's own
 * font-size, so this measures in the input's characters whatever the pill's
 * font happens to be.
 */
// ⚙️ px kept past the last character so the caret has somewhere to sit.
const SEARCH_PILL_CARET_PX = 3;

/**
 * How wide the text actually is, in the input's own font.
 *
 * 13.86 sized this in ch, which is the width of a "0" - fine for a monospace
 * font and wrong for Arial. A term of thin letters ("jjjjjjjjjj") measured
 * far wider than it drew, leaving a pool of empty pill to the right of the
 * text that grew with the term. Measuring the string settles it.
 *
 * One offscreen span, reused: creating one per keystroke would be a layout
 * thrash on every character.
 */
function searchPillTextWidth(input, text) {
    let sizer = document.getElementById('scraySearchPillSizer');
    if (!sizer) {
        sizer = document.createElement('span');
        sizer.id = 'scraySearchPillSizer';
        sizer.setAttribute('aria-hidden', 'true');
        document.body.appendChild(sizer);
    }
    const cs = getComputedStyle(input);
    // The `font` shorthand is empty in a few browsers; the parts always work.
    sizer.style.font = cs.font || `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    sizer.style.letterSpacing = cs.letterSpacing;
    sizer.textContent = text;
    return sizer.getBoundingClientRect().width;
}

function sizeSearchPill(input) {
    const wrap = input.closest('.floating-tag-search-wrap');
    if (!wrap) return;
    const text = input.value;
    const open = !!text || wrap.classList.contains('is-focused');
    const xapp = wrap.querySelector('.search-pill-xapp');
    if (xapp) {
        const letter = searchPillXappLetter();
        if (xapp.textContent !== letter) xapp.textContent = letter;
        xapp.title = letter ? `Tap 🔍 to search in ${letter === 'N' ? 'Native' : 'Picker'}` : '';
    }
    wrap.classList.toggle('is-idle', !open);
    wrap.classList.toggle('is-empty', !text);
    // Idle and empty: the CSS gives the stub its own width, so leave it be.
    // That width - the couple of characters beside the magnifier - applies
    // ONLY here, because its rule needs both is-idle and is-empty. The moment
    // a term arrives the rule stops matching and the width below takes over,
    // so the stub's extra room is never carried into a pill that has text.
    if (!open && !text) { input.style.width = ''; return; }
    // The caret's own place past the last character is only wanted while there
    // IS a caret. At rest it was 3px of nothing on the end of every term, so
    // the pill now hugs the text exactly once you stop typing (13.94).
    const caret = wrap.classList.contains('is-focused') ? SEARCH_PILL_CARET_PX : 0;
    input.style.width = Math.ceil(searchPillTextWidth(input, text) + caret) + 'px';
}

/** The other app's letter for the superscript: N from Picker, P from Native. */
function searchPillXappLetter() {
    const target = typeof window.scrayCrossAppTarget === 'function' ? window.scrayCrossAppTarget() : null;
    return target === 'Native' ? 'N' : target === 'Picker' ? 'P' : '';
}

/**
 * Hand the pill's term to the other app (picker 14.2 / native 14.5). Only
 * while the pill is ACTIVE - being typed in - and only with a term. At rest
 * in the corner, even holding a term, 🔍 just opens the pill as it always did
 * (picker 14.4 / native 14.7). Returns true when it went.
 */
function searchPillCrossApp(wrap, input) {
    if (!searchPillXappLetter()) return false;
    const term = input.value.trim();
    if (!wrap.classList.contains('is-focused') || !term) return false;
    input.blur();
    return !!(window.scrayCrossAppOpen && window.scrayCrossAppOpen({ search: term, quote: false }));
}

function buildSearchPill() {
    const wrap = document.createElement('span');
    wrap.className = 'floating-tag-search-wrap is-idle';

    const pill = document.createElement('span');
    pill.className = 'floating-tag-pill floating-tag-search';
    pill.title = 'Filter by filename';

    const glass = document.createElement('span');
    glass.className = 'search-pill-glass';
    glass.textContent = '🔍';
    // Superscript N (in Picker) or P (in Native) on the magnifier: while the
    // pill is open, tapping 🔍 sends the term to the other app (picker 14.2 /
    // native 14.5). Filled in by sizeSearchPill, which runs on every change,
    // because the bridge that says which app is on the other end can arrive
    // after this is built. Empty - and so invisible - in an ordinary browser.
    const xapp = document.createElement('sup');
    xapp.className = 'search-pill-xapp';
    glass.appendChild(xapp);

    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'scraySearchPillInput';
    input.className = 'search-pill-input';
    input.autocomplete = 'off';
    input.autocapitalize = 'off';
    input.setAttribute('autocorrect', 'off');
    input.spellcheck = false;
    input.setAttribute('aria-label', 'Filter by filename');

    const clearX = document.createElement('span');
    clearX.className = 'search-pill-x';
    clearX.textContent = '×';
    clearX.setAttribute('role', 'button');
    clearX.setAttribute('aria-label', 'Clear the filter');

    // preventDefault on the press stops the x stealing focus from the input -
    // otherwise the keyboard closes the moment you reach for it. But on iOS
    // preventDefault on touchstart also cancels the synthesized mouse
    // sequence, click included, so the work happens on touchend there and on
    // click everywhere else.
    clearX.addEventListener('mousedown', (ev) => ev.preventDefault());
    clearX.addEventListener('touchstart', (ev) => ev.preventDefault(), { passive: false });
    let xFiring = false;
    const clearFromX = (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (xFiring) return;      // a browser that sends both must not clear twice
        xFiring = true;
        setTimeout(() => { xFiring = false; }, 400);
        input.value = '';
        sizeSearchPill(input);
        window.clearSearchPillFilter?.(ev);
    };
    clearX.addEventListener('touchend', clearFromX, { passive: false });
    clearX.addEventListener('click', clearFromX);

    // Typing here drives the real box, and the real box's own listener does
    // the filtering - so there is still exactly one place that knows how.
    input.addEventListener('input', () => {
        const box = mainSearchEl();
        if (box && box.value !== input.value) {
            box.value = input.value;
            box.dispatchEvent(new Event('input', { bubbles: true }));
        }
        sizeSearchPill(input);
    });
    // The class change and the measurement have to happen in that order, and
    // the measurement has to see the settled font - hence no transition on
    // font-size in the CSS. The second pass on the next frame is belt and
    // braces: if a font is still loading, or anything else moves the text
    // after this tick, the width follows it rather than staying wrong.
    const resize = () => { sizeSearchPill(input); requestAnimationFrame(() => sizeSearchPill(input)); };

    // Waking the pill puts the caret at the END, wherever the finger landed.
    //
    // Hung on FOCUS, not on the tap. Focus fires only when the pill was not
    // already being edited, which is exactly "waking it up" - and a tap while
    // you are already editing fires none, so that still repositions the caret
    // the ordinary way. The first attempt at this keyed off pointerdown and
    // acted on the click, which turned out to be unreliable for a reason worth
    // recording: focusing grows the text from 0.75rem to 1.1rem, the pill
    // re-lays out under the finger, and the click can then land on the page
    // behind it - target BODY, handler never runs.
    //
    // Three passes because the browser sets its own caret AFTER focus, and
    // when varies by platform: same tick, next frame, or on touchend.
    input.addEventListener('focus', () => {
        wrap.classList.add('is-focused');
        resize();
        const end = input.value.length;
        const toEnd = () => { try { input.setSelectionRange(end, end); } catch (_) {} };
        toEnd();
        requestAnimationFrame(toEnd);
        setTimeout(toEnd, 60);
    });
    input.addEventListener('blur',  () => { wrap.classList.remove('is-focused'); resize(); });
    input.addEventListener('keydown', (e) => {
        // ui.js binds bare letters on window; it exempts inputs, but the tag
        // buttons behind this are one stray keystroke away either way.
        e.stopPropagation();
        if (e.key === 'Enter' || e.key === 'Return') { e.preventDefault(); input.blur(); }
    });

    // Tapping anywhere that is not the x puts the caret in the text.
    //
    // 13.92: waking the pill puts the caret at the END, not wherever the
    // finger landed. Tapping a word in the middle of a term you are already
    // editing is a deliberate act and still works; tapping a pill at rest is
    // not - you are reaching for the filter, and what you want next is to
    // carry on typing.
    //
    // The state has to be read on POINTERDOWN. By the time click fires the
    // browser has already focused the input and placed its own caret, so
    // "was it focused?" can no longer be asked - which is why this looked
    // like it was following the tap.
    // Focus from the DOWN event, not the click: by click time the text has
    // grown and the pill may no longer be under the finger (see above). This
    // matters for a tap on the magnifier, which is not the input itself and so
    // gets no focus of its own.
    pill.addEventListener('pointerdown', (e) => {
        if (e.target === clearX) return;
        // 🔍 on an open pill with a term in it: search the other app instead
        // (picker 14.2 / native 14.5). Decided here, on the way down, because
        // by click time the tap has already blurred the input and the pill
        // has gone back to rest.
        if (e.target.closest && e.target.closest('.search-pill-glass') && searchPillCrossApp(wrap, input)) {
            e.preventDefault();
            e.stopPropagation();
            return;
        }
        if (document.activeElement !== input) input.focus();
    }, true);

    // Kept as the fallback for anything that delivers no pointer events.
    pill.addEventListener('click', (e) => {
        e.stopPropagation();
        if (e.target !== clearX && document.activeElement !== input) input.focus();
    });

    pill.append(glass, input, clearX);
    wrap.appendChild(pill);
    return wrap;
}

/**
 * Build the pill once, then keep it. Called on every rebuild of the bar; it
 * is the reuse that keeps focus and the caret alive while you type.
 */
function ensureSearchPill(container) {
    let wrap = container.querySelector('.floating-tag-search-wrap');
    if (!wrap) {
        wrap = buildSearchPill();
        container.appendChild(wrap);
    }
    // Deliberately NOT re-appended to put it last in the DOM. appendChild on a
    // node that is already a child MOVES it, and moving a focused element
    // blurs it - which is the whole thing this function exists to avoid. It
    // cost a keyboard after one character when this was written. The CSS
    // `order: 99` puts it last on screen, which is all that was wanted.
    const input = wrap.querySelector('.search-pill-input');
    const box = mainSearchEl();
    // Follow the box whenever the two disagree, focused or not. This looked
    // like it needed a "not while typing" guard, and it does not: the input
    // handler writes the box BEFORE it dispatches, so during a keystroke the
    // two already agree and this is a no-op. Guarding on focus instead left a
    // stale pill whenever something else changed the filter while the caret
    // was still in it - Clear all, or the context menu's "search this".
    if (box && input.value !== box.value) {
        const wasFocused = document.activeElement === input;
        input.value = box.value;
        // Adopting a value out from under the caret would otherwise drop it
        // back to position 0 on some browsers.
        if (wasFocused) {
            const end = input.value.length;
            try { input.setSelectionRange(end, end); } catch (_) { /* not all types allow it */ }
        }
    }
    sizeSearchPill(input);
    return wrap;
}

function updateFloatingTagPillsFromCommon() {
const container = document.getElementById("floatingTagPillsBar");
if (!container) return;
// Not innerHTML = '': the search pill holds a focused input and has to live
// through this. See the block above.
clearPillsExceptSearch(container);

// Include pills
Array.from(window.commonSelectedTags).forEach(tag => {
   const pill = document.createElement("span");
   pill.className = "floating-tag-pill floating-tag-include";
   pill.textContent = tag;
   pill.title = "Click to remove this tag";
   pill.addEventListener("click", () => {
       window.commonSelectedTags.delete(tag);
       refreshFiltersFromCommonSet();
       ['tagFilterLevel1Select','tagFilterLevel2Select','tagFilterLevel3Select','tagFilterAllSelect']
           .forEach(id => {
               const sel = $(`#${id}`);
               const current = sel.val() || [];
               if (current.includes(tag)) {
                   sel.val(current.filter(t => t !== tag)).trigger('change');
               }
           });
   });
   container.appendChild(pill);
});

// Facet pills - studios, performers and stash tags, each in its own colour so
// a bar carrying a dozen terms still reads as three groups instead of one
// undifferentiated wall. Rendered in class order rather than selection order,
// for the same reason.
window.SCRAY_FACET_CLASSES.forEach(kind => {
   // A page that renders a class's pills itself says so, and this leaves them
   // alone. The bookmarks page does exactly that for notes - it has its own
   // include/exclude handling behind them - and without this the bar carried
   // each note twice (13.112).
   if ((window.scrayFacetPillsOwn || {})[kind]) return;
   const set  = (window.scrayFacetFilters || {})[kind];
   const meta = (window.SCRAY_FACET_META  || {})[kind];
   if (!set || !meta) return;
   // Networks (picker 14.8 / native 14.12) lead the studio pills, in the
   // studio colour with a roof in front so they read as "everything under".
   if (kind === 'studio' && window.scrayStudioParentFilter && window.scrayStudioParentFilter.size) {
       Array.from(window.scrayStudioParentFilter).forEach(val => {
           const np = document.createElement("span");
           np.className = "floating-tag-pill " + meta.pill + " floating-tag-network";
           // The parent's mapped name from manage-data, when it has one.
           np.textContent = "\u2302 " + (window.scrayMapName ? window.scrayMapName('network', val) : val);
           np.title = "Network - every studio under " + val + ". Click to remove";
           np.addEventListener("click", () => {
               window.scrayStudioParentFilter.delete(val);
               scrayRefreshFilters();
           });
           container.appendChild(np);
       });
   }
   // Keywords go in front of the mapped notes they lead to, in their own
   // darker purple, with their any/all switch once there are two to combine.
   if (kind === 'note' && window.scrayNoteKeywordFilter && window.scrayNoteKeywordFilter.size) {
       Array.from(window.scrayNoteKeywordFilter).forEach(val => {
           const pp = document.createElement("span");
           pp.className = "floating-tag-pill floating-tag-notekeyword"
               + (window.scrayKeywordIsParent && window.scrayKeywordIsParent(val) ? " is-parent" : "");
           pp.textContent = val;
           pp.title = "Keyword - click to remove";
           pp.addEventListener("click", () => {
               window.scrayNoteKeywordFilter.delete(val);
               scrayRefreshFilters();
           });
           container.appendChild(pp);
       });
       if (window.scrayNoteKeywordFilter.size > 1) {
           const px = document.createElement("span");
           px.className = "floating-tag-pill floating-tag-notekeyword-mode";
           px.textContent = window.scrayNoteKeywordIntersect ? "\u2229 all keywords" : "\u222A any keyword";
           px.title = "Tap to switch between bookmarks with ANY picked keyword and ALL of them";
           px.addEventListener("click", () => {
               window.scrayNoteKeywordIntersect = !window.scrayNoteKeywordIntersect;
               scrayRefreshFilters();
           });
           container.appendChild(px);
       }
   }
   Array.from(set).forEach(val => {
       const fPill = document.createElement("span");
       fPill.className = "floating-tag-pill " + meta.pill;
       fPill.textContent = val;
       fPill.title = "Click to remove this filter";
       fPill.addEventListener("click", () => {
           window.scrayRemoveTagFilter(kind, val);
       });
       container.appendChild(fPill);
   });
});

// Facet excludes. Red like every other "this removes something" control in
// the bar, with the class colour kept as a left edge - a fifth and sixth and
// seventh shade of red would be three more colours to learn for one idea.
// Catalogue-tag excludes are NOT here: they keep their consolidated
// Exclude (n) pill further down, which already has a modal behind it.
window.SCRAY_FACET_CLASSES.forEach(kind => {
   if ((window.scrayFacetPillsOwn || {})[kind]) return;
   const exSet = (window.scrayFacetExcludes || {})[kind];
   if (!exSet || !exSet.size) return;
   Array.from(exSet).forEach(val => {
       const xPill = document.createElement("span");
       xPill.className = "floating-tag-pill floating-tag-fexclude fx-" + kind;
       xPill.textContent = "\u2212 " + val;
       xPill.title = "Excluded - click to stop excluding it";
       xPill.addEventListener("click", () => {
           exSet.delete(val);
           if (typeof window.scrayRefreshFilters === 'function') window.scrayRefreshFilters();
       });
       container.appendChild(xPill);
   });
});

// The intersect switch, mirrored out of the cloud modal so it can be flipped
// without opening one. Hidden below two terms: with nothing or one thing
// selected ANY and ALL return the same rows, so the pill would be advertising
// a distinction that does not exist yet.
if (typeof window.scrayTotalFilterTerms === 'function' && window.scrayTotalFilterTerms() > 1) {
   const ixPill = document.createElement("span");
   ixPill.className = "floating-tag-pill " +
       (window.scrayTagIntersect ? "floating-tag-intersect" : "floating-tag-intersect-off");
   ixPill.textContent = window.scrayTagIntersect ? "\u2229 Intersect" : "\u222A Additive";
   ixPill.title = "Tap to switch between matching ANY selected term and ALL of them";
   ixPill.addEventListener("click", () => {
       window.scrayTagIntersect = !window.scrayTagIntersect;
       refreshFiltersFromCommonSet();
   });
   container.appendChild(ixPill);
}

/**
 * Is any tag / studio / score / orientation-style filter on right now?
 * (picker 14.30 / native 14.44)
 *
 * The same count the Clear all pill appears on, as a function, so holding the
 * corner magnifier can clear the filters as well as the search term.
 */
window.scrayAnyFilterOn = function () {
   const ex = (window.SCRAY_FACET_CLASSES || []).reduce((n, k) => {
      const x = (window.scrayFacetExcludes || {})[k];
      return n + (x ? x.size : 0);
   }, 0) + (($('#excludeTagSelect').val() || [])
      .filter(t => !(window.scrayDefaultExcludeTags && window.scrayDefaultExcludeTags.has(t))).length);
   const inc = typeof window.scrayTotalFilterTerms === 'function' ? window.scrayTotalFilterTerms() : 0;
   return inc + ex > 0;
};

// Clear all (picker 13.169 / native 13.165): shown as soon as ANY include or
// exclude is on - one tag, one studio filtered out, anything. The default
// exclude list doesn't count (13.170 / 13.166): it is always applied, so
// counting it kept the pill on screen permanently. It used to share
// the intersect switch's two-term gate, and that gate only counted includes,
// so a bar of excludes (which is what wholesale mode's name taps make first)
// had no way to clear them in one go.
//
// The action itself still clears everything, search and toggles included.
const scrayExcludeTerms = (window.SCRAY_FACET_CLASSES || []).reduce((n, k) => {
   const x = (window.scrayFacetExcludes || {})[k];
   return n + (x ? x.size : 0);
}, 0) + (($('#excludeTagSelect').val() || [])
   .filter(t => !(window.scrayDefaultExcludeTags && window.scrayDefaultExcludeTags.has(t))).length);
const scrayIncludeTerms = typeof window.scrayTotalFilterTerms === 'function' ? window.scrayTotalFilterTerms() : 0;
if (scrayIncludeTerms + scrayExcludeTerms > 0) {
   const clearPill = document.createElement("span");
   clearPill.className = "floating-tag-pill floating-tag-clearall";
   clearPill.textContent = "\u2715 Clear all";
   clearPill.title = "Clear every active filter";
   clearPill.addEventListener("click", (ev) => {
       if (typeof window.scrayClearAllFilters === 'function') window.scrayClearAllFilters(ev);
   });
   container.appendChild(clearPill);
}

// ✅ Search filter pill - PINK. Always on screen now (13.84): pale and stubby
// until you tap it, then it is the filter box. See ensureSearchPill above.
ensureSearchPill(container);

// Re-check keyboard/search-pill state now that pills have been rebuilt
setTimeout(() => {
if (window.visualViewport) {
    const kbHeight = window.innerHeight - window.visualViewport.height;
    document.body.classList.toggle('keyboard-active', kbHeight > 150);
}
const hasSearchPill = !!document.querySelector('.floating-tag-search');
document.body.classList.toggle('search-pill-active', hasSearchPill);
}, 0);

// Score filter pill - ALWAYS shown
// Grey when inactive, orange when active
const scorePill = document.createElement("span");
if (selectedScoreFilters.size > 0) {
  // Active - show selected scores in orange
  scorePill.className = "floating-tag-pill floating-tag-score";
  const scoresList = Array.from(selectedScoreFilters)
      .sort((a, b) => a - b)
      .map(s => s === 0 ? 'N/A' : s)
      .join(',');
  scorePill.textContent = `Score (${scoresList})`;
  scorePill.title = "Click to change score filter";
} else {
  // Inactive - grey pill with just "Score"
  scorePill.className = "floating-tag-pill floating-tag-score-inactive";
  scorePill.textContent = "Score";
  scorePill.title = "Click to filter by score";
}
scorePill.addEventListener("click", () => {
  showScoreFilterModal();
});
container.appendChild(scorePill);

// Exclude pills consolidated into single pill
const excludeTags = $('#excludeTagSelect').val() || [];
if (excludeTags.length > 0) {
  const pill = document.createElement("span");
  pill.className = "floating-tag-pill floating-tag-exclude";
  pill.textContent = `Exclude (${excludeTags.length})`;
  pill.title = "Click to view/manage exclude tags";
  pill.addEventListener("click", () => {
      showExcludeTagsModal();
  });
  container.appendChild(pill);
}

// Excel connection status pill removed - Excel path is retired.
}
// Refresh filters & pills
function refreshFiltersFromCommonSet() {
   updateFloatingTagPillsFromCommon();
   window.skipSearchScroll = true;
   filterDisplayedByFilename();
}

// Bind dropdown changes to update global set & cascade options
function bindDropdownWithCascade(selectId, cascadeFn) {
   const sel = $(`#${selectId}`);
   // ✅ PERFORMANCE (native 13.180): populateTagDropdowns runs again after
   // every rename, move, refresh, folder scan... Re-initialising select2 only
   // drops ITS OWN handlers, so a plain .on('change') stacked one more
   // cascade per run - each holding a full copy of the catalogue - and a
   // single tag change ended up running the whole filter N times over.
   // Namespaced and replaced, there is only ever the latest one.
   sel.off('change.scray').on('change.scray', function () {
       const newSelection = sel.val() || [];

       // Find tags from this dropdown in the global set
       const prevTagsFromThisDropdown = Array.from(window.commonSelectedTags)
           .filter(tag => sel.find(`option[value="${tag}"]`).length);

       const removed = prevTagsFromThisDropdown.filter(t => !newSelection.includes(t));
       const added   = newSelection.filter(t => !window.commonSelectedTags.has(t));

       removed.forEach(t => window.commonSelectedTags.delete(t));
       added.forEach(t => window.commonSelectedTags.add(t));

       if (typeof cascadeFn === 'function') cascadeFn();

       refreshFiltersFromCommonSet();
   });
}

// Bind with cascade functions
bindDropdownWithCascade("tagFilterLevel1Select", () => {
const selectedL1 = $('#tagFilterLevel1Select').val() || [];
let filteredVideos = videos;
if (selectedL1.length > 0) {
    filteredVideos = videos.filter(v => selectedL1.includes(v.level_1));
}
const lvl2FilteredSet = new Set(filteredVideos.map(v => v.level_2).filter(Boolean));
fillSelect("tagFilterLevel2Select", "includeTagsLevel2Container", lvl2FilteredSet);

const lvl3FilteredSet = new Set(filteredVideos.map(v => v.level_3).filter(Boolean));
 // ✅ Add level_5 bracket tags to Level 3 dropdown
 filteredVideos.forEach(v => {
     if (v.level_5) {
         const level5Parts = v.level_5.split(';').filter(Boolean);
         level5Parts.forEach(part => {
             if (!part.includes('_')) {
                 lvl3FilteredSet.add(part);
             }
         });
     }
 });
 fillSelect("tagFilterLevel3Select", "includeTagsLevel3Container", lvl3FilteredSet);

 const allTagsFilteredSet = new Set();

// ✅ Add ALL tags to All Tags dropdown (no exclusions)
filteredVideos.forEach(v => {
 (v.tags || []).forEach(tag => {
     allTagsFilteredSet.add(tag);
 });
});

fillSelect("tagFilterAllSelect", "includeTagsAllContainer", allTagsFilteredSet);
});

bindDropdownWithCascade("tagFilterLevel2Select", () => {
const selectedL1 = $('#tagFilterLevel1Select').val() || [];
const selectedL2 = $('#tagFilterLevel2Select').val() || [];
let filteredVideos = videos;
if (selectedL1.length > 0) {
    filteredVideos = filteredVideos.filter(v => selectedL1.includes(v.level_1));
}
if (selectedL2.length > 0) {
    filteredVideos = filteredVideos.filter(v => selectedL2.includes(v.level_2));
}
const lvl3FilteredSet = new Set(filteredVideos.map(v => v.level_3).filter(Boolean));
 // ✅ Add level_5 bracket tags to Level 3 dropdown
 filteredVideos.forEach(v => {
     if (v.level_5) {
         const level5Parts = v.level_5.split(';').filter(Boolean);
         level5Parts.forEach(part => {
             if (!part.includes('_')) {
                 lvl3FilteredSet.add(part);
             }
         });
     }
 });
 fillSelect("tagFilterLevel3Select", "includeTagsLevel3Container", lvl3FilteredSet);

 const allTagsFilteredSet = new Set();

// ✅ Add ALL tags to All Tags dropdown (no exclusions)
filteredVideos.forEach(v => {
 (v.tags || []).forEach(tag => {
     allTagsFilteredSet.add(tag);
 });
});

fillSelect("tagFilterAllSelect", "includeTagsAllContainer", allTagsFilteredSet);
});

bindDropdownWithCascade("tagFilterAllSelect", () => {
const selectedL1 = $('#tagFilterLevel1Select').val() || [];
const selectedL2 = $('#tagFilterLevel2Select').val() || [];
const selectedL3 = $('#tagFilterLevel3Select').val() || [];
let filteredVideos = videos;
if (selectedL1.length > 0) {
 filteredVideos = filteredVideos.filter(v => selectedL1.includes(v.level_1));
}
if (selectedL2.length > 0) {
 filteredVideos = filteredVideos.filter(v => selectedL2.includes(v.level_2));
}
if (selectedL3.length > 0) {
// ✅ Filter by level_3 (folders) OR level_5 (bracket tags)
filteredVideos = filteredVideos.filter(v => {
    const hasLevel3Match = selectedL3.includes(v.level_3);
    // Check if any bracket tag in level_5 matches selection (exclude folder data with underscores)
    const hasBracketMatch = v.level_5 && v.level_5.split(';').filter(t => !t.includes('_')).some(tag => selectedL3.includes(tag));
    return hasLevel3Match || hasBracketMatch;
});
}

const allTagsFilteredSet = new Set();

// ✅ Add ALL tags to All Tags dropdown (no exclusions)
filteredVideos.forEach(v => {
(v.tags || []).forEach(tag => {
    allTagsFilteredSet.add(tag);
});
});

fillSelect("tagFilterAllSelect", "includeTagsAllContainer", allTagsFilteredSet);
});

bindDropdownWithCascade("tagFilterLevel3Select", () => {
const selectedL1 = $('#tagFilterLevel1Select').val() || [];
const selectedL2 = $('#tagFilterLevel2Select').val() || [];
const selectedL3 = $('#tagFilterLevel3Select').val() || [];
let filteredVideos = videos;
if (selectedL1.length > 0) {
    filteredVideos = filteredVideos.filter(v => selectedL1.includes(v.level_1));
}
if (selectedL2.length > 0) {
    filteredVideos = filteredVideos.filter(v => selectedL2.includes(v.level_2));
}
if (selectedL3.length > 0) {
   // ✅ Filter by level_3 (folders) OR level_5 (bracket tags)
   filteredVideos = filteredVideos.filter(v => {
       const hasLevel3Match = selectedL3.includes(v.level_3);
       // Check if any bracket tag in level_5 matches selection (exclude folder data with underscores)
       const hasBracketMatch = v.level_5 && v.level_5.split(';').filter(t => !t.includes('_')).some(tag => selectedL3.includes(tag));
       return hasLevel3Match || hasBracketMatch;
   });
}

const allTagsFilteredSet = new Set();

// ✅ Add ALL tags to All Tags dropdown (no exclusions)
filteredVideos.forEach(v => {
(v.tags || []).forEach(tag => {
    allTagsFilteredSet.add(tag);
});
});

fillSelect("tagFilterAllSelect", "includeTagsAllContainer", allTagsFilteredSet);
});

// Init pill bar 
updateFloatingTagPillsFromCommon();

// Export globally so score modal can use it
window.updateFloatingTagPillsFromCommon = updateFloatingTagPillsFromCommon;

// Both of these live inside populateTagDropdowns, so the bare names are
// invisible to anything at this file's top level - including the facet filter
// module above. Exported for the same reason the pills function already was.
window.refreshFiltersFromCommonSet = refreshFiltersFromCommonSet;

// Populate exclude tags dropdown with ALL tags from DB
async function populateExcludeTagDropdown() {
const allVideos = await getAllVideos();
const tagSet = new Set();

// Gather all tags from all videos
allVideos.forEach(v => {
    if (Array.isArray(v.tags)) {
        v.tags.forEach(tag => tagSet.add(tag));
    }
});

const select = $('#excludeTagSelect');

// ✅ Get current selection so we can keep it when options change
const currentSelection = select.val() || [];

select.empty();

Array.from(tagSet).sort().forEach(tag => {
select.append(new Option(tag, tag, false, false));
});

// ✅ Restore currentSelection but only keep tags that still exist in options
const validSelection = currentSelection.filter(tag => tagSet.has(tag));
select.val(validSelection);

select.select2({
 placeholder: "Exclude tags",
 allowClear: false,
 dropdownAutoWidth: true,
 closeOnSelect: false,
 minimumResultsForSearch: 0 // ✅ Always show search box but don't auto-focus it
});

// Bind change event: refresh pill bar and filter list immediately
// (namespaced + replaced so repeat populates don't stack handlers - 13.180)
select.off('change.scray').on('change.scray', function () {
    updateFloatingTagPillsFromCommon(); // pills bar now shows exclude pills too
    window.skipSearchScroll = true;
    filterDisplayedByFilename();        // re-filter using current includes/excludes
});
}

// Call exclude dropdown population
await populateExcludeTagDropdown();

// Default exclude list, straight after the options exist — select2 silently
// discards a val() with no matching <option>, so loading this any earlier
// looks like it worked and changes nothing.
if (typeof window.loadDefaultExcludeTags === 'function') {
    await window.loadDefaultExcludeTags();
}
}

/* =========================================
Seconds Dropdowns & Helpers
========================================= */
function populateSecondsDropdowns() {
const randomCountSelect = document.getElementById("randomCount");
for (let i = 1; i <= 50; i++) {
   const opt = document.createElement("option");
   opt.value = i; opt.textContent = i;
   randomCountSelect.appendChild(opt);
}
randomCountSelect.value = 10;
}

function populateSizeDropdowns() {
 const gbValues = Array.from({ length: 11 }, (_, i) => i); // 0..10
 const mbValues = Array.from({ length: 100 }, (_, i) => i * 10).filter(mb => mb < 1000);

 gbValues.forEach(gb => {
     ["minSizeGB", "maxSizeGB"].forEach(id => {
         const opt = document.createElement("option");
         opt.value = gb;
         opt.textContent = gb;
         document.getElementById(id).appendChild(opt);
     });
 });

 mbValues.forEach(mb => {
     ["minSizeMB", "maxSizeMB"].forEach(id => {
         const opt = document.createElement("option");
         opt.value = mb;
         opt.textContent = mb;
         document.getElementById(id).appendChild(opt);
     });
 });

 // Defaults
 document.getElementById("minSizeGB").value = 0;
 document.getElementById("minSizeMB").value = 0;
 document.getElementById("maxSizeGB").value = 10;
 document.getElementById("maxSizeMB").value = 0;
}

/**
* Show score filter modal with multi-select grid (0-10)
* 0 = unscored videos
*/
function showScoreFilterModal() {
 // ✅ FIX: Create full-screen overlay to catch all clicks
 const overlay = document.createElement('div');
 overlay.className = 'score-modal-overlay';
 overlay.style.cssText = `
     position: fixed;
     top: 0;
     left: 0;
     width: 100%;
     height: 100%;
     background: rgba(0, 0, 0, 0.5);
     z-index: 10001;
     display: flex;
     align-items: center;
     justify-content: center;
 `;
 
 const modal = document.createElement('div');
 modal.className = 'score-context-menu';
 modal.style.cssText = `
     position: relative;
     z-index: 10002;
 `;
   
   // Create header
   const header = document.createElement('div');
   header.style.cssText = `
       padding: 8px;
       text-align: center;
       font-weight: bold;
       background: #f0f0f0;
       border-bottom: 2px solid #007bff;
       border-radius: 8px 8px 0 0;
       font-size: 0.9rem;
   `;
   header.textContent = 'Select Scores to Include';
   modal.appendChild(header);
   
   // Create grid container
   const gridContainer = document.createElement('div');
   gridContainer.className = 'score-grid';
   
   // Add buttons for 0-10 (0 = unscored)
  for (let i = 0; i <= 10; i++) {
      const scoreBtn = document.createElement('button');
      scoreBtn.className = 'score-grid-btn';
      scoreBtn.textContent = i === 0 ? 'N/A' : i;
      scoreBtn.dataset.score = i;
      scoreBtn.title = i === 0 ? 'Unscored videos' : `Score ${i}/10`;
      
      // Highlight if already selected
      if (selectedScoreFilters.has(i)) {
          scoreBtn.classList.add('score-selected');
      }
      
      scoreBtn.addEventListener('click', (e) => {
       e.stopPropagation();
       
       const scoreValue = i; // Ensure it's a number
       
       // Toggle selection
       if (selectedScoreFilters.has(scoreValue)) {
           selectedScoreFilters.delete(scoreValue);
           scoreBtn.classList.remove('score-selected');
           console.log(`Removed score ${scoreValue}. Now have:`, Array.from(selectedScoreFilters));
       } else {
           selectedScoreFilters.add(scoreValue);
           scoreBtn.classList.add('score-selected');
           console.log(`Added score ${scoreValue}. Now have:`, Array.from(selectedScoreFilters));
       }
       
       // DON'T filter yet - just update the selection visually
       // Filtering will happen when modal closes
   });
       
       gridContainer.appendChild(scoreBtn);
   }
   
   modal.appendChild(gridContainer);
  
  // Add button row with Clear and Close
  const buttonRow = document.createElement('div');
  buttonRow.style.cssText = `
      display: flex;
      gap: 8px;
      margin-top: 4px;
  `;
  
// Clear button
const clearBtn = document.createElement('button');
clearBtn.textContent = 'Clear All';
clearBtn.style.cssText = `
    flex: 1;
    padding: 8px;
    background: #f44336;
    color: white;
    border: none;
    border-radius: 0 0 0 8px;
    cursor: pointer;
    font-size: 0.9rem;
`;
clearBtn.addEventListener('click', (e) => {
e.stopPropagation();
e.preventDefault();

// Clear all selections
selectedScoreFilters.clear();

// Update all button states
modal.querySelectorAll('.score-grid-btn').forEach(btn => {
    btn.classList.remove('score-selected');
});

// ✅ FIX: Disable all close handlers during feedback period
overlay.removeEventListener('click', closeHandler);
overlay.removeEventListener('touchstart', closeHandler);
document.removeEventListener('keydown', escapeHandler);

// Disable buttons
clearBtn.disabled = true;
closeBtn.disabled = true;

// Show feedback
clearBtn.textContent = '✅ Cleared';
clearBtn.style.background = '#28a745';

setTimeout(() => {
    overlay.remove();
    
    // Update pills and apply filter
    if (typeof window.updateFloatingTagPillsFromCommon === 'function') {
        window.updateFloatingTagPillsFromCommon();
    }
    window.skipSearchScroll = true;
    filterDisplayedByFilename();
}, 800);

console.log('✅ Cleared all score filters');
});

buttonRow.appendChild(clearBtn);
  
  // Close button
const closeBtn = document.createElement('button');
closeBtn.textContent = 'Close';
closeBtn.style.cssText = `
    flex: 1;
    padding: 8px;
    background: #6c757d;
    color: white;
    border: none;
    border-radius: 0 0 8px 0;
    cursor: pointer;
    font-size: 0.9rem;
`;
closeBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  e.preventDefault();
  
  overlay.remove();
    
    // ✅ Now update pills and apply filter
    if (typeof window.updateFloatingTagPillsFromCommon === 'function') {
        window.updateFloatingTagPillsFromCommon();
    }
    
    window.skipSearchScroll = true;
    filterDisplayedByFilename();
});
buttonRow.appendChild(closeBtn);
  
  modal.appendChild(buttonRow);
 
 overlay.appendChild(modal);
 document.body.appendChild(overlay);
   
   // Close on click outside
const closeHandler = (e) => {
// ✅ FIX: Only trigger if clicking on overlay background (not modal content)
if (e.target === overlay) {
    e.stopPropagation();
    e.preventDefault();
    
    overlay.remove();
    document.removeEventListener('click', closeHandler);
    document.removeEventListener('touchstart', closeHandler);
    document.removeEventListener('keydown', escapeHandler);
    
    // ✅ Update pills and apply filter when closing
    if (typeof window.updateFloatingTagPillsFromCommon === 'function') {
        window.updateFloatingTagPillsFromCommon();
    }
    window.skipSearchScroll = true;
    filterDisplayedByFilename();
}
};

// Close on ESC key
const escapeHandler = (e) => {
if (e.key === 'Escape') {
    e.stopPropagation();
    e.preventDefault();
    
    overlay.remove();
    document.removeEventListener('click', closeHandler);
    document.removeEventListener('touchstart', closeHandler);
    document.removeEventListener('keydown', escapeHandler);
    
    // ✅ Update pills and apply filter when closing
    if (typeof window.updateFloatingTagPillsFromCommon === 'function') {
        window.updateFloatingTagPillsFromCommon();
    }
    window.skipSearchScroll = true;
    filterDisplayedByFilename();
}
};
   
   // ✅ FIX: Attach to overlay instead of document
 overlay.addEventListener('click', closeHandler);
 overlay.addEventListener('touchstart', closeHandler);
 window.scrayEscapeWhileOpen(overlay, escapeHandler); // not left behind on close (13.182)
}

window.showScoreFilterModal = showScoreFilterModal;

/* =========================================
Populate MIME Type Filter
========================================= */
async function populateMimeTypeFilter() {
 const videos = await getAllVideos();
 const mimeTypes = new Set();
 
 videos.forEach(v => {
   if (v.mimeType) {
     mimeTypes.add(v.mimeType);
   }
 });
 
 const select = $('#mimeTypeFilter');
 select.empty();
 
 // Sort mime types alphabetically
 Array.from(mimeTypes).sort().forEach(type => {
   // Create friendly display name
   const displayName = type.replace('video/', '').toUpperCase();
   select.append(new Option(`${displayName} (${type})`, type, false, false));
 });
 
 select.select2({
   placeholder: "All file types",
   allowClear: true,
   dropdownAutoWidth: true,
   closeOnSelect: false,
   minimumResultsForSearch: 0
 });
 
 // Refresh filters when selection changes (replaced, not stacked - 13.180)
 select.off('change.scray').on('change.scray', function() {
   window.skipSearchScroll = true;
   filterDisplayedByFilename();
 });
}


function getSizeBytesFromDropdowns(gbId, mbId) {
  const gbEl = document.getElementById(gbId);
  const mbEl = document.getElementById(mbId);
  if (!gbEl || !mbEl) return null;
  const gb = parseInt(gbEl.value, 10) || 0;
  const mb = parseInt(mbEl.value, 10) || 0;
  return gb * 1024 * 1024 * 1024 + mb * 1024 * 1024;
}

function getDurationMsFromInputs(minutesId, secondsId) {
const minutesEl = document.getElementById(minutesId);
const secondsEl = document.getElementById(secondsId);
if (!minutesEl || !secondsEl) return null;
const mins = parseInt(minutesEl.value, 10) || 0;
const secs = parseInt(secondsEl.value, 10) || 0;
return ((mins * 60) + secs) * 1000;
}

/* =========================================
Filtering Functions
========================================= */
async function getFilteredVideos(includeTags, excludeTags, minDurationMs, maxDurationMs) {
let videos = await getAllVideos();

// ✅ Use arguments if provided, otherwise pull from commonSelectedTags
let includeAll;
if (Array.isArray(includeTags) && includeTags.length > 0) {
 includeAll = includeTags;
} else {
includeAll = Array.from(window.commonSelectedTags); // unified selection
}

// Filter by include tags, if any.
//
// Two modes. Additive - the default - keeps a video carrying ANY selected
// term. Intersect keeps only videos carrying EVERY one. The switch spans all
// four classes at once, because "show me the overlap" is one question and not
// four.
// With keywords picked, the mapped-note picks stop being a class of their
// own and narrow the keyword test instead, on the same bookmark - see
// scrayVideoPassesNoteKeywords, applied just below the include pass.
const keywordsOn = !!(window.scrayNoteKeywordFilter && window.scrayNoteKeywordFilter.size);
const facetPicks = window.SCRAY_FACET_CLASSES
   .map(kind => [kind, Array.from((window.scrayFacetFilters || {})[kind] || [])])
   .filter(pair => pair[1].length > 0 && !(keywordsOn && pair[0] === 'note'));

// Networks (picker 14.8 / native 14.12): a file counts when its studio's
// Parent is one of them. Part of the studio class, so additive with the rest.
const networkPicks = window.scrayStudioParentFilter && window.scrayStudioParentFilter.size
   ? Array.from(window.scrayStudioParentFilter).map(v => String(v).trim().toLowerCase())
   : [];

if (includeAll.length > 0 || facetPicks.length > 0 || networkPicks.length > 0) {
   const intersect = !!window.scrayTagIntersect;
   videos = videos.filter(rec => {
       const tags    = Array.isArray(rec.tags) ? rec.tags : [];
       const tagHits = includeAll.filter(t => tags.includes(t)).length;

       // parts() is resolved ONCE per record rather than once per class: it
       // splits three comma-separated strings on every call, and this runs
       // over the whole catalogue on every keystroke.
       let facetHits = 0, facetTotal = 0;
       if (networkPicks.length) {
           const np = window.scrayStashNames ? window.scrayStashNames.parts(rec) : null;
           facetTotal += networkPicks.length;
           const par = np && np.studio ? scrayStudioParentOf(np.studio) : '';
           if (par && networkPicks.includes(par)) facetHits++;
       }
       if (facetPicks.length) {
           const p = window.scrayStashNames ? window.scrayStashNames.parts(rec) : null;
           facetPicks.forEach(pair => {
               const kind = pair[0], list = pair[1];
               facetTotal += list.length;
               // Notes come off the video's OWN bookmarks, not from parts().
               // Answered before the stash guard above would have mattered,
               // and before the chain below - which, without this, fell
               // through to stashTagList and compared notes against stash
               // tags. That matched nothing, so picking a note emptied the
               // list on both this page and the bookmarks one (13.112).
               if (kind === 'note') {
                   const notes = scrayVideoNotes(rec);
                   list.forEach(val => { if (notes.includes(val)) facetHits++; });
                   return;
               }
               if (!p) return;
               const have = kind === 'studio'    ? (p.studio ? [p.studio] : [])
                          : kind === 'performer' ? (p.performerListAll || p.performerList || [])
                          : (p.stashTagList || []);
               list.forEach(val => { if (have.includes(val)) facetHits++; });
           });
       }

       return intersect
           ? (tagHits === includeAll.length && facetHits === facetTotal)
           : (tagHits > 0 || facetHits > 0);
   });
}

// Keywords, always AND with the rest: they are the way into bookmarks,
// not one more term to be OR-ed with a studio.
if (keywordsOn) videos = videos.filter(scrayVideoPassesNoteKeywords);

// Filter by exclude tags, if passed
if (Array.isArray(excludeTags) && excludeTags.length > 0) {
   videos = videos.filter(rec => !(Array.isArray(rec.tags) && rec.tags.some(t => excludeTags.includes(t))));
}

// Facet excludes - studios, performers, stash tags.
//
// Applied AFTER the includes and always as ANY, whatever scrayTagIntersect
// says: exclude wins, and "not these" has no ALL reading worth offering - a
// video would have to carry every excluded studio at once to be dropped.
const facetExcl = window.SCRAY_FACET_CLASSES
   .map(kind => [kind, Array.from((window.scrayFacetExcludes || {})[kind] || [])])
   .filter(pair => pair[1].length > 0);

if (facetExcl.length > 0) {
   videos = videos.filter(rec => {
       // parts() once per record, same reason as the include pass above.
       const p = window.scrayStashNames ? window.scrayStashNames.parts(rec) : null;
       return !facetExcl.some(pair => {
           const kind = pair[0], list = pair[1];
           // Notes come off the video's OWN bookmarks, not from parts() - so
           // they are tested BEFORE the no-StashDB-row guard below, which
           // otherwise waved every unmatched video past its note excludes.
           if (kind === 'note') {
               const notes = scrayVideoNotes(rec);
               return list.some(val => notes.includes(val));
           }
           if (!p) return false;   // no StashDB row - nothing to exclude on
           const have = kind === 'studio'    ? (p.studio ? [p.studio] : [])
                      : kind === 'performer' ? (p.performerListAll || p.performerList || [])
                      : (p.stashTagList || []);
           return list.some(val => have.includes(val));
       });
   });
}

// Duration filter (skipped if the min/max duration dropdowns don't exist)
if (minDurationMs !== null && maxDurationMs !== null) {
videos = videos.filter(rec => {
   if (typeof rec.durationMs !== "number" || isNaN(rec.durationMs)) return true;
   return rec.durationMs >= minDurationMs && rec.durationMs <= maxDurationMs;
});
}

// Size filter (skipped if the min/max size dropdowns don't exist)
const minSizeBytes = getSizeBytesFromDropdowns("minSizeGB", "minSizeMB");
const maxSizeBytes = getSizeBytesFromDropdowns("maxSizeGB", "maxSizeMB");

if (minSizeBytes !== null && maxSizeBytes !== null) {
videos = videos.filter(rec => {
 if (typeof rec.sizeBytes !== "number" || isNaN(rec.sizeBytes)) return true;
 return rec.sizeBytes >= minSizeBytes && rec.sizeBytes <= maxSizeBytes;
});
}

// MP4-only checkbox filtering
const mp4Only = document.getElementById("filterMp4Only")?.checked;
if (mp4Only) {
videos = videos.filter(v => {
   const ext = (v.filename || '').split('.').pop().toLowerCase();
   return ext === 'mp4';
});
}

// ✅ NEW: Duplicates-only checkbox filtering
const duplicatesOnly = document.getElementById("filterDuplicatesOnly")?.checked;
if (duplicatesOnly) {
 // Build a frequency map of filenames (case-insensitive)
 const allVideos = await getAllVideos();
 const filenameMap = new Map();
 allVideos.forEach(v => {
     if (v.filename) {
         const lowerName = v.filename.toLowerCase();
         filenameMap.set(lowerName, (filenameMap.get(lowerName) || 0) + 1);
     }
 });
 
 // Filter to only show videos whose filename appears more than once
 videos = videos.filter(v => {
     if (!v.filename) return false;
     const lowerName = v.filename.toLowerCase();
     return (filenameMap.get(lowerName) || 0) > 1;
 });
}

// Orientation filter - falls back to comparing width/height directly, so
// rows whose stored orientation is still null (scanned before native
// metadata existed, or mid-backfill) match correctly instead of vanishing.
const orientationFilter = document.getElementById("orientationFilter")?.value;
if (orientationFilter && orientationFilter !== "any") {
 videos = videos.filter(v => {
     const orientation = v.orientation ?? (typeof deriveOrientation === 'function'
         ? deriveOrientation(v.width, v.height)
         : null);
     return orientation === orientationFilter;
 });
}

// ✅ NEW: StashDB match filter. State lives on the button's own dataset - see
// the toggle wiring further down this file. scrayHasStashMatch reads the same
// cached matched-key set that colours the S buttons, so the filter and the
// button colours can never disagree.
const stashFilterState = document.getElementById("stashFilterToggleBtn")?.dataset.state || "any";
if (stashFilterState !== "any" && typeof window.scrayHasStashMatch === "function") {
 const wantMatched = stashFilterState === "matched";
 videos = videos.filter(v => window.scrayHasStashMatch(v) === wantMatched);
}

// ✅ NEW: Bookmark filter. scrayHasBookmarks prefers the row's own array and
// falls back to the bookmark cache, so basket and history entries - stored
// without one - are judged correctly rather than all reading as unbookmarked.
const bookmarkFilterState = document.getElementById("bookmarkFilterToggleBtn")?.dataset.state || "any";
if (bookmarkFilterState !== "any" && typeof window.scrayHasBookmarks === "function") {
 const wantBookmarked = bookmarkFilterState === "only";
 videos = videos.filter(v => window.scrayHasBookmarks(v) === wantBookmarked);
}

// ✅ Native (13.50): only the files on this phone that still need uploading -
// the ones "Upload" offers: not in the catalogue, or (13.52) in
// it with no OneDrive copy. Strictly false, so a row the sync hasn't judged
// yet isn't counted.
if (document.getElementById("uncataloguedToggleBtn")?.dataset.active === "1") {
 videos = videos.filter(v => typeof window.scrayIsPhoneOnly === "function"
     ? window.scrayIsPhoneOnly(v)
     : v.inCatalogue === false);
}

// Offline filter (native 15.11, as Picker's): only files on this phone - the
// ones that play with no connection - not the ones that stream from Hetzner.
if (document.getElementById("offlineOnlyToggleBtn")?.dataset.active === "1" &&
    typeof window.scrayIsOffline === "function") {
 videos = videos.filter(v => window.scrayIsOffline(v));
}

// Hetzner filter (native 15.10, as picker 15.9). Judged by scrayIsHetznerVideo
// (scray-hetzner.js): a row that streams from the box.
//   any  - no filter        only - on the box        none - not on the box
const hetznerState = document.getElementById("hetznerOnlyToggleBtn")?.dataset.state || "any";
if (hetznerState !== "any" && typeof window.scrayIsHetznerVideo === "function") {
 const wantHz = hetznerState === "only";
 videos = videos.filter(v => !!window.scrayIsHetznerVideo(v) === wantHz);
}

// ✅ NEW: MIME type filter
const mimeTypeFilter = $('#mimeTypeFilter').val() || [];
if (mimeTypeFilter.length > 0) {
videos = videos.filter(v => v.mimeType && mimeTypeFilter.includes(v.mimeType));
}

// Score filter (filters by user_score already in IndexedDB)
if (selectedScoreFilters.size > 0) {
   console.log(`✅ Applying score filter with selected scores:`, Array.from(selectedScoreFilters).sort());
   
   const beforeCount = videos.length;
   videos = videos.filter(v => {
       const score = v.user_score ?? 0; // Get score from IndexedDB (0 if unscored)
       return selectedScoreFilters.has(score);
   });
   
   console.log(`✅ Score filter applied: ${beforeCount} → ${videos.length} videos`);
}

return videos;
}

/* =========================================
Enhanced Search Parser
========================================= */
function parseSearchQuery(searchText) {
const result = {
   phrases: [],      // "exact phrases"
   required: [],     // +required
   excluded: [],     // -excluded
   optional: []      // plain terms (AND logic by default)
};

let remaining = searchText;

// 1. Extract quoted phrases first
const phraseRegex = /"([^"]+)"/g;
let match;
while ((match = phraseRegex.exec(searchText)) !== null) {
   result.phrases.push(match[1].toLowerCase());
   remaining = remaining.replace(match[0], ' '); // remove from remaining
}

// 2. Split remaining tokens by whitespace
const tokens = remaining.split(/\s+/).filter(Boolean);

tokens.forEach(token => {
   if (token.startsWith('+')) {
       // Required term
       result.required.push(token.substring(1).toLowerCase());
   } else if (token.startsWith('-')) {
       // Excluded term
       result.excluded.push(token.substring(1).toLowerCase());
   } else if (token.toLowerCase() !== 'or') {
       // Regular term (treated as AND by default, ignore 'OR' keyword)
       result.optional.push(token.toLowerCase());
   }
});

return result;
}

function matchesSearchQuery(video, query) {
const haystack = `${video.filename} ${video.cataloguePath || ''} ${video.path} ${window.scrayStashNames ? window.scrayStashNames.text(video) : ''}`.toLowerCase();

// ✅ All exact phrases must match
for (const phrase of query.phrases) {
   if (!haystack.includes(phrase)) return false;
}

// ✅ All required (+) terms must be present
for (const term of query.required) {
   if (!haystack.includes(term)) return false;
}

// ✅ No excluded (-) terms can be present
for (const term of query.excluded) {
   if (haystack.includes(term)) return false;
}

// ✅ All optional terms must match (AND logic by default)
for (const term of query.optional) {
   if (!haystack.includes(term)) return false;
}

return true;
}

/* =========================================
Updated filterDisplayedByFilename
========================================= */
// ✅ PERFORMANCE (native 13.182): OVERTAKEN PASSES. A pass reads the whole
// catalogue (async) before it draws, so quick changes - typing, a Clear all
// that fires five selects - used to leave several passes in flight at once,
// each drawing the full list in turn, and an older one could land LAST and
// put stale results on screen. Each call now takes a number; a pass that
// finds a newer one started while it was reading stops before drawing, and
// its caller waits for the newest to finish, so anything awaiting this still
// sees the list as it ends up.
let scrayFilterSeq = 0;
let scrayFilterLatest = Promise.resolve();

async function filterDisplayedByFilename() {
const seq = ++scrayFilterSeq;
const run = scrayFilterDisplayedPass(seq);
scrayFilterLatest = run.catch(() => {});
try {
    await run;
} finally {
    let waited = null;
    while (waited !== scrayFilterLatest) {
        waited = scrayFilterLatest;
        await waited;
    }
}
}

async function scrayFilterDisplayedPass(seq) {
const searchEl = document.getElementById("filenameSearchBox");
const searchText = searchEl.value.trim();

const includeTags = $('#tagFilterSelect').val() || [];
const excludeTags = $('#excludeTagSelect').val() || [];
const minDurationMs = getDurationMsFromInputs("minMinutes", "minSeconds");
const maxDurationMs = getDurationMsFromInputs("maxMinutes", "maxSeconds");

let videos = await getFilteredVideos(includeTags, excludeTags, minDurationMs, maxDurationMs);
if (seq !== scrayFilterSeq) return; // overtaken - the newer pass draws

// ✅ Track search terms for highlighting
 if (searchText.length > 0) {
     const query = parseSearchQuery(searchText);
     // Combine all search terms for highlighting
     window.currentSearchTerms = [
         ...query.phrases,
         ...query.required,
         ...query.optional
     ];
     videos = videos.filter(video => matchesSearchQuery(video, query));
 } else {
    window.currentSearchTerms = [];
}

// Scores already in IndexedDB - no need to merge
filteredVideosGlobal = videos;
 renderPaginatedListSetup(videos);

adjustBottomSpacer(80);
updateVideoStats(filteredVideosGlobal);

// ✅ Show/hide "Add Filtered to Basket" button based on filter state
const addFilteredBtn = document.getElementById("addFilteredToBasketBtn");
if (addFilteredBtn) {
   // Check if any filters are active
   const hasSearchText = searchText.length > 0;
   // Counts all four classes, not just catalogue tags - otherwise a list
   // filtered to one performer looks unfiltered and the +B button hides.
   const hasIncludeTags = (typeof window.scrayTotalFilterTerms === 'function')
       ? window.scrayTotalFilterTerms() > 0
       : window.commonSelectedTags.size > 0;
   const hasExcludeTags = excludeTags.length > 0;
   const hasFilters = hasSearchText || hasIncludeTags || hasExcludeTags;
   
   // Show button only if filters are active AND there are results
   if (hasFilters && videos.length > 0) {
       addFilteredBtn.style.display = 'block';
       addFilteredBtn.textContent = `+B (${videos.length})`;
       
       // ✅ Disable if more than 500 items
       if (videos.length > 500) {
         addFilteredBtn.disabled = true;
         addFilteredBtn.title = 'Maximum 500 items - refine your filters';
     } else {
         addFilteredBtn.disabled = false;
         addFilteredBtn.title = `Add ${videos.length} filtered videos to basket`;
     }
   } else {
       addFilteredBtn.style.display = 'none';
   }
}

// One-shot, not a mode. Forty-odd places set skipSearchScroll = true meaning
// "don't scroll on THIS refresh", and exactly one ever set it back to false -
// inside a setTimeout on the clear-filters path. So the first player open,
// history panel or sync of the session latched it on and this scroll never
// ran again. Consuming it here is what every one of those callers assumes.
const skipScroll = !!window.skipSearchScroll || Date.now() < (window.scraySuppressScrollUntil || 0);
window.skipSearchScroll = false;
if (!skipScroll) {
window.scrayScrollToResults();
}

// ✅ Refresh floating pills to show/hide search pill
if (typeof updateFloatingTagPillsFromCommon === 'function') {
 updateFloatingTagPillsFromCommon();
}

// Keep the FLS/MPFS in-player filter pill in step with the filter, however
// the filter was changed (pill, main box, panel box, bin, clear-all).
if (typeof window.syncFullscreenFilterPill === 'function') {
 window.syncFullscreenFilterPill();
}
}

async function clearAllFilters() {
window.skipSearchScroll = true;

// ✅ Stop video player first
if (window.inlineVideoPlayer) {
    window.inlineVideoPlayer.stop();
}

// Also clear the global common tags set, and the three facet classes beside
// it. Intersect goes back to off too: it is a filter mode, and leaving it
// armed after a Clear makes the next single tag look like it matched nothing.
if (window.commonSelectedTags) {
  window.commonSelectedTags.clear();
}
if (window.scrayFacetFilters) {
  window.SCRAY_FACET_CLASSES.forEach(k => {
      if (window.scrayFacetFilters[k]) window.scrayFacetFilters[k].clear();
      if (window.scrayFacetExcludes && window.scrayFacetExcludes[k]) {
          window.scrayFacetExcludes[k].clear();
      }
  });
}
window.scrayTagIntersect = false;
if (window.scrayNoteKeywordFilter) window.scrayNoteKeywordFilter.clear();
if (window.scrayStudioParentFilter) window.scrayStudioParentFilter.clear();
window.scrayNoteKeywordIntersect = false;

// Reset all filters – clear level-based include dropdowns
// Through scrayResetSelect (picker 14.34 / native 14.54): a select2 throw on
// "All tags" used to stop this function here.
scrayResetSelect('#tagFilterLevel1Select');
scrayResetSelect('#tagFilterLevel2Select');
scrayResetSelect('#tagFilterLevel3Select');
scrayResetSelect('#tagFilterAllSelect');

// Clear exclude tags dropdown
scrayResetSelect('#excludeTagSelect');

// Reset durations (guarded - dropdowns may no longer be in the UI)
if (document.getElementById("minMinutes")) document.getElementById("minMinutes").value = 0;
if (document.getElementById("minSeconds")) document.getElementById("minSeconds").value = 0;
if (document.getElementById("maxMinutes")) document.getElementById("maxMinutes").value = 999;
if (document.getElementById("maxSeconds")) document.getElementById("maxSeconds").value = 0;

// Clear search box and trigger input event to hide X button
const filenameSearchBox = document.getElementById("filenameSearchBox");
if (filenameSearchBox) {
filenameSearchBox.value = "";
filenameSearchBox.dispatchEvent(new Event('input', { bubbles: true }));
}

// ✅ Hide add filtered to basket button
const addFilteredBtn = document.getElementById("addFilteredToBasketBtn");
if (addFilteredBtn) {
   addFilteredBtn.style.display = 'none';
}

// ✅ NEW: Reset orientation filter
const orientationFilter = document.getElementById("orientationFilter");
if (orientationFilter) orientationFilter.value = "any";
if (typeof window.syncOrientationToggleLabel === "function") window.syncOrientationToggleLabel();

// ✅ NEW: Reset the Stash and BM cycles
const stashFilterBtn = document.getElementById("stashFilterToggleBtn");
if (stashFilterBtn) stashFilterBtn.dataset.state = "any";
if (typeof window.syncStashFilterToggleLabel === "function") window.syncStashFilterToggleLabel();

const bookmarkFilterBtn = document.getElementById("bookmarkFilterToggleBtn");
if (bookmarkFilterBtn) bookmarkFilterBtn.dataset.state = "any";
if (typeof window.syncBookmarkFilterToggleLabel === "function") window.syncBookmarkFilterToggleLabel();

// ✅ Native: reset the uncatalogued toggle
const uncataloguedBtn = document.getElementById("uncataloguedToggleBtn");
if (uncataloguedBtn) uncataloguedBtn.dataset.active = "0";
if (typeof window.syncUncataloguedToggleLabel === "function") window.syncUncataloguedToggleLabel();

// Reset the offline filter (native 15.11)
const offlineOnlyBtn = document.getElementById("offlineOnlyToggleBtn");
if (offlineOnlyBtn) offlineOnlyBtn.dataset.active = "0";
if (typeof window.syncOfflineOnlyToggleLabel === "function") window.syncOfflineOnlyToggleLabel();

// Reset the Hetzner filter (native 15.10)
const hetznerOnlyBtn = document.getElementById("hetznerOnlyToggleBtn");
if (hetznerOnlyBtn) hetznerOnlyBtn.dataset.state = "any";
if (typeof window.syncHetznerOnlyToggleLabel === "function") window.syncHetznerOnlyToggleLabel();

// ✅ NEW: Reset MIME type filter
$('#mimeTypeFilter').val(null).trigger('change');

// Reset score filter
selectedScoreFilters.clear();
window.selectedScoreFilters = selectedScoreFilters;

// Clear UI lists
document.getElementById("playlist").innerHTML = "";
document.getElementById("taggedVideosContainer").innerHTML = "";
filteredVideosGlobal = [];
window.currentSearchTerms = []; // ✅ Clear search highlighting

console.log("Filters cleared, commonSelectedTags emptied, and lists reset");

// Ensure floating pills bar is refreshed
if (typeof updateFloatingTagPillsFromCommon === "function") {
  updateFloatingTagPillsFromCommon();
}

const tagsSelect = document.getElementById("tagFilterSelect");
if (tagsSelect) {
  tagsSelect.scrollIntoView({ behavior: "smooth", block: "start" });
  $('#tagFilterSelect').select2('open');
  setTimeout(() => {
      const searchBox = $('.select2-container--open .select2-search__field');
      if (searchBox.length) {
          searchBox.val('').trigger('input').focus();
      }
      window.skipSearchScroll = false;
  }, 150);

    // 🔹 Update stats for *all videos* after clearing
updateVideoStats();

}
}

/* =========================================
Random Tag Selector (excludes level 1)
========================================= */
async function selectRandomTag() {
const videos = await getAllVideos();

// Collect all unique tags excluding level_1 AND already selected tags
const tagSet = new Set();
videos.forEach(video => {
  if (Array.isArray(video.tags)) {
    video.tags.forEach(tag => {
      // ✅ Exclude level_1 tags AND already selected tags
      if (tag !== video.level_1 && !window.commonSelectedTags.has(tag)) {
        tagSet.add(tag);
      }
    });
  }
});

const eligibleTags = Array.from(tagSet);

if (eligibleTags.length === 0) {
  alert("No unselected non-level-1 tags available");
  return;
}

// Pick a random tag
const randomTag = eligibleTags[Math.floor(Math.random() * eligibleTags.length)];

console.log(`Selected random tag: ${randomTag}`);

// Add to global selected tags
window.commonSelectedTags.add(randomTag);

// ✅ Show pill immediately BEFORE dropdown selection
if (typeof updateFloatingTagPillsFromCommon === 'function') {
 updateFloatingTagPillsFromCommon();
}

// Find which dropdown contains this tag and select it
['Level2', 'Level3', 'All'].forEach(levelName => {
 const selectId = `tagFilter${levelName}Select`;
 const $select = $(`#${selectId}`); // ✅ FIX: Add missing variable declaration
 
 // Check if this dropdown has this tag as an option
 if ($select.find(`option[value="${randomTag}"]`).length) {
   const currentVals = $select.val() || [];
   if (!currentVals.includes(randomTag)) {
     currentVals.push(randomTag);
     $select.val(currentVals).trigger('change');
   }
 }
});

// ✅ Refresh pills again after dropdown changes (in case cascade updated options)
setTimeout(() => {
 if (typeof updateFloatingTagPillsFromCommon === 'function') {
   updateFloatingTagPillsFromCommon();
 }
}, 100);

window.skipSearchScroll = true;
if (typeof filterDisplayedByFilename === 'function') {
 filterDisplayedByFilename();
}

// Show feedback
console.log(`Random tag "${randomTag}" selected and filters applied`);
}

window.sortVideosBySize = sortVideosBySize;
window.sortVideosByCreated = sortVideosByCreated;
window.sortVideosByModified = sortVideosByModified;
window.sortVideosByFilename = sortVideosByFilename;
window.sortVideosByScore = sortVideosByScore;

/* =========================================
Rendering Lists
========================================= */
async function renderPlaylist(videos) {
// Linked copies of one video become one row (render.js, LINKED VARIANTS).
// Before filteredVideosGlobal is set, so next and previous walk the rows.
if (typeof window.scrayCollapseVariants === 'function') {
  const collapsed = window.scrayCollapseVariants(videos);
  videos = collapsed.videos;
  window.scrayRandomVariants = collapsed.groups.size ? collapsed.groups : null;
}
// Scores already in IndexedDB - no need to merge
filteredVideosGlobal = videos;

 // ✅ Check if in landscape mobile mode
 const isLandscape = window.matchMedia('(orientation: landscape)').matches;
 const isMobile = window.innerWidth <= 1024;

 if (isLandscape && isMobile) {
     // Render in panel and open it
     if (typeof window.renderRandomPlaylistInPanel === 'function') {
         window.renderRandomPlaylistInPanel(videos);
         window.toggleRandomPlaylistPanel(true);
     }
     return;
 }

 // Clear first
 const playlistContainer = document.getElementById('playlist');
 playlistContainer.innerHTML = '';

 // Render video list
 renderVideoList(videos, 'playlist');

 // ✅ Calculate & append total after rendering list (so renderVideoList doesn't wipe it)
 const totalSize = videos.reduce((acc, v) => acc + (v.sizeBytes || 0), 0);
 const totalDiv = document.createElement("div");
 totalDiv.className = "randomlist-total-size";
 totalDiv.style.fontWeight = "bold";
 totalDiv.style.fontSize = "0.85rem";  // smaller font
 totalDiv.style.padding = "6px";
 totalDiv.textContent = `Total size: ${formatFileSize(totalSize)}`;
 playlistContainer.insertBefore(totalDiv, playlistContainer.firstChild);
}

const paginationState = {
allVideos: [],
pageSize: 50,
currentEndIndex: 0,
containerId: "taggedVideosContainer"
};

// ✅ Export so external modules (e.g. player.js modal) can read live data.
// paginationState itself is never reassigned (only its properties mutate),
// so a plain reference assignment is safe here.
window.paginationState = paginationState;

/**
* Show a "NO RESULTS" placeholder in whichever results container is
* currently active (normal desktop/portrait list, or the landscape-mobile
* panel list), and hide that view's pagination controls.
*/
function showNoResultsMessage() {
const isLandscape = window.matchMedia('(orientation: landscape)').matches;
const isMobile = window.innerWidth <= 1024;

if (isLandscape && isMobile) {
  const container = document.getElementById("panelTaggedList");
  if (container) container.innerHTML = `<div class="no-results-message">NO RESULTS</div>`;

  const randomSection = document.getElementById("panelRandomSection");
  const taggedSection = document.getElementById("panelTaggedSection");
  if (randomSection) randomSection.style.display = 'none';
  if (taggedSection) taggedSection.style.display = 'flex';

  const panelPagination = document.getElementById("panelPaginationControls");
  if (panelPagination) panelPagination.style.display = 'none';

  if (!window.skipPanelAutoOpen && typeof window.toggleRandomPlaylistPanel === 'function') {
      window.toggleRandomPlaylistPanel(true);
  }
  window.skipPanelAutoOpen = false;
} else {
  const container = document.getElementById("taggedVideosContainer");
  if (container) container.innerHTML = `<div class="no-results-message">NO RESULTS</div>`;

  const paginationControls = document.getElementById("paginationControls");
  if (paginationControls) paginationControls.style.display = 'none';
}
}

function renderPaginatedListSetup(videos) {
// ✅ If a search term is active but returned nothing, show a "NO RESULTS"
// placeholder instead of an empty list
const searchBoxEl = document.getElementById("filenameSearchBox");
const hasActiveSearchTerm = !!(searchBoxEl && searchBoxEl.value.trim().length > 0);
if (hasActiveSearchTerm && (!videos || videos.length === 0)) {
  showNoResultsMessage();
  return;
}

// The list's one sort - headings and buttons together. The unsorted list is
// kept so a later heading tap can restore filter order for its ties.
paginationState.unsortedVideos = videos;
let sortedVideos = scrayGroupMainList(scraySortVideos(videos, null));

// The reset to 25 is right for a genuine filter/search change and wrong for
// a plain refresh - same function serves both, which is why the list
// collapsed after every score, delete or sync pull. Render the first chunk
// at the depth the list was already showing instead.
const keepDepth = !!window.scrayKeepListDepth;
const prevDepth = keepDepth ? (paginationState.currentEndIndex || 0) : 0;
window.scrayKeepListDepth = false;
firstChunk = Math.max(25, Math.min(prevDepth, sortedVideos.length));
// Scroll has to come with it, or restoring the rows still lands you at
// whatever offset the shorter list had.
const scrollEl = document.scrollingElement || document.documentElement;
const prevScroll = keepDepth ? scrollEl.scrollTop : 0;
if (keepDepth) requestAnimationFrame(() => { scrollEl.scrollTop = prevScroll; });

paginationState.allVideos = sortedVideos;
paginationState.pageSize = firstChunk;
paginationState.currentEndIndex = 0;
// pageSize is the chunk size for "show more" too, so put it back once the
// initial render has consumed it. The renderers below are synchronous, so
// this lands after them and before any interaction.
queueMicrotask(() => { paginationState.pageSize = 25; });

// ✅ Check if in landscape mobile mode
const isLandscape = window.matchMedia('(orientation: landscape)').matches;
const isMobile = window.innerWidth <= 1024;

if (isLandscape && isMobile && !window.skipPanelAutoOpen) { // ✅ Check global flag
  // Render in panel and open it
  paginationState.containerId = "panelTaggedList";
  if (typeof window.renderTaggedListInPanel === 'function') {
    window.renderTaggedListInPanel(sortedVideos, paginationState);
    window.toggleRandomPlaylistPanel(true);
  }
  return;
} else if (isLandscape && isMobile && window.skipPanelAutoOpen) {
  // ✅ Still render in panel but DON'T open it
  paginationState.containerId = "panelTaggedList";
  if (typeof window.renderTaggedListInPanel === 'function') {
    window.renderTaggedListInPanel(sortedVideos, paginationState);
  }
  // ✅ Reset the suppression flag
  window.skipPanelAutoOpen = false;
  return;
}

 // Normal rendering for non-landscape-mobile
 paginationState.containerId = "taggedVideosContainer";
 const container = document.getElementById(paginationState.containerId);
 container.innerHTML = "";
 document.getElementById("paginationControls").style.display = "flex";
 renderNextChunk(firstChunk);
}

/**
 * Small files from one folder become a single group line (render.js,
 * scrayGroupVideos). Done AFTER sorting, so a group sits where its best-placed
 * file would, and its files are moved together in allVideos itself - that
 * array is what next/previous play through, so it has to match the screen.
 */
function scrayGroupMainList(list) {
  const ps = paginationState;
  // Linked copies first (render.js, LINKED VARIANTS): one entry per video,
  // judged against the whole filtered list, so a re-sort of what's on screen
  // - which only holds the copy each row shows - still knows every copy.
  if (typeof window.scrayCollapseVariants === 'function') {
    const collapsed = window.scrayCollapseVariants(list, ps.unsortedVideos || list);
    ps.variants = collapsed.groups.size ? collapsed.groups : null;
    list = collapsed.videos;
  } else {
    ps.variants = null;
  }
  if (typeof window.scrayGroupVideos !== 'function') {
    ps.groups = null; ps.groupOf = null; ps.indexOf = null;
    return list;
  }
  const grouped = window.scrayGroupVideos(list);
  ps.groups = grouped.groups;
  ps.groupOf = grouped.keyOf.size ? grouped.keyOf : null;
  ps.indexOf = new Map(grouped.videos.map((v, i) => [v, i]));
  return grouped.videos;
}

/**
 * Where a chunk of `lines` lines starting at `start` ends, in allVideos
 * positions. A group counts as one line however many files it holds, and is
 * never split across two chunks.
 */
function scrayChunkEnd(start, lines) {
  const ps = paginationState;
  const list = ps.allVideos;
  if (!ps.groupOf) return Math.min(start + lines, list.length);
  let i = start, n = 0;
  while (i < list.length && n < lines) {
    const key = ps.groupOf.get(list[i]);
    if (key) { while (i < list.length && ps.groupOf.get(list[i]) === key) i++; }
    else i++;
    n++;
  }
  return i;
}

function renderNextChunk(amount = null) {
const increment = amount ?? paginationState.pageSize;
const nextEnd = scrayChunkEnd(paginationState.currentEndIndex, increment);

const chunk = paginationState.allVideos.slice(paginationState.currentEndIndex, nextEnd);

// ✅ Check if rendering in panel
const isLandscape = window.matchMedia('(orientation: landscape)').matches;
const isMobile = window.innerWidth <= 1024;

if (isLandscape && isMobile && paginationState.containerId === "panelTaggedList") {
 // Use panel append function
 if (typeof window.appendToTaggedListInPanel === 'function') {
   window.appendToTaggedListInPanel(chunk, paginationState);
 }
} else {
 // Normal rendering
 appendVideoList(chunk, paginationState.containerId);
 paginationState.currentEndIndex = nextEnd;
 // Scrolling past the first chunk moves the real depth, and a sort should
 // redraw everything that was on screen, not just the initial batch.
 firstChunk = nextEnd;

 if (paginationState.currentEndIndex >= paginationState.allVideos.length) {
   document.getElementById("paginationControls").style.display = "none";
 }
}
}

/* =========================================
Playlist Generators
========================================= */
async function generateRandomPlaylistByTags() {
const includeTags = $('#tagFilterSelect').val() || [];
const excludeTags = $('#excludeTagSelect').val() || [];
const minDurationMs = getDurationMsFromInputs("minMinutes", "minSeconds");
const maxDurationMs = getDurationMsFromInputs("maxMinutes", "maxSeconds");

const videos = await getFilteredVideos(includeTags, excludeTags, minDurationMs, maxDurationMs);
let count = parseInt(document.getElementById("randomCount").value, 10);
if (isNaN(count) || count <= 0) count = 10;
if (count > videos.length) count = videos.length;

const shuffled = [...videos].sort(() => 0.5 - Math.random());
 await renderPlaylist(shuffled.slice(0, count));
}

/* =========================================
Full List Function with Spacer
========================================= */
async function listAllVideos(page = 1) {
const includeTags = $('#tagFilterSelect').val() || [];
const excludeTags = $('#excludeTagSelect').val() || [];
const minDurationMs = getDurationMsFromInputs("minMinutes", "minSeconds");
const maxDurationMs = getDurationMsFromInputs("maxMinutes", "maxSeconds");
const searchText = document.getElementById("filenameSearchBox").value.toLowerCase().trim();
const tokens = searchText.split(/\s+/).filter(Boolean);

let videos = await getFilteredVideos(includeTags, excludeTags, minDurationMs, maxDurationMs);
if (tokens.length > 0) {
 videos = videos.filter(video => {
     const haystack = `${video.filename} ${video.cataloguePath || ''} ${video.path} ${window.scrayStashNames ? window.scrayStashNames.text(video) : ''}`.toLowerCase();
     return tokens.every(token => haystack.includes(token));
 });
}

// Scores already in IndexedDB - no need to merge
renderPaginatedListSetup(videos);

adjustBottomSpacer(80);
updateVideoStats(videos);

// Don't scroll in landscape mobile (list is in panel)
const isLandscape = window.matchMedia('(orientation: landscape)').matches;
const isMobile = window.innerWidth <= 1024;

if (!(isLandscape && isMobile)) {
 window.scrayScrollToResults();
}
}

/* =========================================
Video Stats Updater
========================================= */

/**
* Free space on the device, cached briefly. Returns null outside Native, where
* there's no bridge — the stats line then reads exactly as it does today.
*/
let _scrayFreeSpace = { text: null, at: 0 };

/// Called by anything that adds or removes a file, so the next stats render
/// asks native again rather than serving a figure from before the change.
window.scrayInvalidateFreeSpace = function () {
  _scrayFreeSpace = { text: null, at: 0 };
};

async function scrayFreeSpaceText() {
  if (!window.ScrayBridge || typeof window.ScrayBridge.deviceStorage !== "function") return null;
  const now = Date.now();
  if (_scrayFreeSpace.text && now - _scrayFreeSpace.at < 15000) return _scrayFreeSpace.text;
  try {
    const s = await window.ScrayBridge.deviceStorage();
    if (!s || s.freeBytes == null) return null;
    _scrayFreeSpace = { text: `${formatFileSize(s.freeBytes)} free`, at: now };
    return _scrayFreeSpace.text;
  } catch (err) {
    console.warn("deviceStorage failed:", err.message);
    return null;
  }
}

async function updateVideoStats(filteredList = null) {
let listToMeasure = filteredList;

if (!listToMeasure) {
   try {
       listToMeasure = await getAllVideos();
   } catch (err) {
       console.error("Error loading all videos for stats:", err);
       listToMeasure = [];
   }
}

const totalCount = listToMeasure.length;
const totalSize  = listToMeasure.reduce((sum, v) => sum + (v.sizeBytes || 0), 0);

const statsDiv = document.getElementById("videoStats");
if (statsDiv) {
   statsDiv.textContent = [
     `Items: ${totalCount}`,
     `Total size: ${formatFileSize(totalSize)}`,
     await scrayFreeSpaceText()
   ].filter(Boolean).join(" | ");
}
}

/* =========================================
Init
========================================= */


window.addEventListener("DOMContentLoaded", async () => {

// ✅ Refresh button - just refreshes Excel authentication (same as modal button)
const refreshScoresBtn = document.getElementById('refreshScoresBtn');
if (refreshScoresBtn) {
  refreshScoresBtn.addEventListener('click', async () => {
      refreshScoresBtn.disabled = true;
      refreshScoresBtn.textContent = '🔄 ...';
      
      try {
          // Just call the same sign-in function as the Excel modal uses
          await window.signInToExcelOnline();
          
          console.log('✅ Excel connection refreshed');
          
          // Button text will be updated by signInToExcelOnline()
          // Reset button after a delay
          setTimeout(() => {
              refreshScoresBtn.disabled = false;
          }, 2000);
          
      } catch (err) {
          console.error('Excel refresh failed:', err);
          alert(`Excel refresh failed: ${err.message || 'Unknown error'}`);
          refreshScoresBtn.disabled = false;
          refreshScoresBtn.textContent = '🔄 Refresh';
      }
  });
}

// Clear / Views / Watched / Played / Created. The column headings are wired
// in render.js, each time the header is drawn.
document.querySelectorAll('.sort-btn[data-list-sort]').forEach(btn => {
    btn.addEventListener('click', () => {
        if (btn.dataset.listSort === 'clear') scrayListSortClear();
        else scrayListSortTap(btn.dataset.listSort);
    });
});
syncListSortButtons();

// Mirror the boot default onto the landscape panel's own sort button,
// which otherwise stays showing a plain "Create".
if (typeof updatePanelSortButton === 'function') {
    updatePanelSortButton('panelSortCreatedBtn', currentCreatedSortState);
}

 ["generateRandomByTagsBtn", "listAllByTagsBtn"].forEach(id => {
       const btn = document.getElementById(id);
       if (btn) btn.disabled = false;
   });

 await populateTagDropdowns();
 populateSecondsDropdowns();
 await populateMimeTypeFilter();
  updateVideoStats();

  // ✅ Auto-show the full list as soon as videos are loaded (same effect as
  // pressing the old L button) - no button press needed
  listAllVideos();

    document.getElementById("generateRandomByTagsBtn")
     .addEventListener("click", async () => {
         await generateRandomPlaylistByTags();
        
        // ✅ Only scroll in non-landscape mobile modes
        const isLandscape = window.matchMedia('(orientation: landscape)').matches;
        const isMobile = window.innerWidth <= 1024;
        
        if (!(isLandscape && isMobile)) {
            setTimeout(() => {
                document.getElementById("playlist")?.scrollIntoView({ behavior: "smooth", block: "start" });
            }, 200);
        }
    });

   document.getElementById("listAllByTagsBtn")
       .addEventListener("click", () => listAllVideos());

    document.getElementById("quickRandomBtn")
     ?.addEventListener("click", async () => {
         await generateRandomPlaylistByTags();
        
        // ✅ Only scroll in non-landscape mobile modes
        const isLandscape = window.matchMedia('(orientation: landscape)').matches;
        const isMobile = window.innerWidth <= 1024;
        
        if (!(isLandscape && isMobile)) {
            setTimeout(() => {
                document.getElementById("playlist")?.scrollIntoView({ behavior: "smooth", block: "start" });
            }, 200);
        }
    });

   const searchBox = document.getElementById("filenameSearchBox");
  const clearX = document.getElementById("clearSearchX");
  const clearFiltersBtn = document.getElementById("clearFiltersBtn");

  // ⚙️ How long typing has to pause before the list filters.
  const SEARCH_TYPING_PAUSE_MS = 150;
  let searchTypingTimer = null;

  searchBox.addEventListener("input", () => {
  clearX.style.display = searchBox.value ? "block" : "none";
  
  // Sync to panel search box if it exists
  const panelSearchBox = document.getElementById("panelSearchBox");
  const panelSearchClearX = document.getElementById("panelSearchClearX");
  if (panelSearchBox) {
    panelSearchBox.value = searchBox.value;
    if (panelSearchClearX) {
      panelSearchClearX.style.display = searchBox.value ? "block" : "none";
    }
  }
  
  // ✅ PERFORMANCE (native 13.182): the whole filter - catalogue read, sort,
  // grouping, list rebuild, pills - used to run on EVERY keystroke. It now
  // runs once typing pauses. The X and the panel box above still update
  // instantly.
  clearTimeout(searchTypingTimer);
  searchTypingTimer = setTimeout(() => {
      // Prevent panel from auto-opening in landscape mobile
      window.skipPanelAutoOpen = true;
      // Prevent scroll jump while typing in the filter bar
      window.skipSearchScroll = true;
      filterDisplayedByFilename();
      // Re-apply top-of-page scroll after the re-render - it can otherwise
      // shift the page and pull scroll back down
      scrollListIntoViewForFilter();
  }, SEARCH_TYPING_PAUSE_MS);
});

// ✅ Enter key to blur and dismiss keyboard (all devices)
searchBox.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === "Return") {
        e.preventDefault();
        searchBox.blur();
        console.log("Main search box blurred via Enter key");
    }
});

 clearX.addEventListener("click", () => {
    searchBox.value = "";
    clearX.style.display = "none";
    
    // Also clear panel search
    const panelSearchBox = document.getElementById("panelSearchBox");
    const panelSearchClearX = document.getElementById("panelSearchClearX");
    if (panelSearchBox) {
      panelSearchBox.value = "";
      if (panelSearchClearX) panelSearchClearX.style.display = "none";
    }
    
    // Prevent panel from auto-opening in landscape mobile
    window.skipPanelAutoOpen = true;
    // Prevent scroll jump when clearing the filter bar
    window.skipSearchScroll = true;
    filterDisplayedByFilename();
    searchBox.focus();
});

   clearFiltersBtn?.addEventListener("click", clearAllFilters);

   // Typing in the filter (pill, main box or the 🔍 button) parks the stats
   // line at the top, so the count and the first results sit directly under
   // what you are typing into and narrow as you type.
   //
   // THIS is the function that runs while you type, not the scroll at the end
   // of filterDisplayedByFilename - the input handler above deliberately sets
   // skipSearchScroll before each keystroke to suppress that one. So a change
   // to how typing scrolls belongs here.
   //
   // It anchored on #searchFilterRow, which style.css has hidden with
   // `display: none !important` under 1024px since 13.84, when the search pill
   // took that row over. A display:none element measures as all zeros, so the
   // target came out as pageYOffset - 80 and every keystroke nudged the page
   // UP by 80px instead of moving to the results. Dead since 13.84, and only
   // on the phones this function is for, which is why it went unnoticed.
   //
   // Instant, not smooth, and repeated: the list re-renders under us as the
   // filter narrows and can pull the scroll back down.
   function scrollListIntoViewForFilter() {
       // Landscape on a phone puts the list in the side panel, where scrolling
       // the page behind it achieves nothing. Everywhere else scrolls.
       const isLandscape = window.matchMedia('(orientation: landscape)').matches;
       const isMobile    = window.innerWidth <= 1024;
       if (isLandscape && isMobile) return;
       const scrollToRow = () => window.scrayScrollToResults('auto');
       requestAnimationFrame(scrollToRow);
       setTimeout(scrollToRow, 50);
       setTimeout(scrollToRow, 150);
       setTimeout(scrollToRow, 350);
   }
   searchBox.addEventListener("focus", scrollListIntoViewForFilter);
   // Default MP4-only checkbox to checked on mobile
  const mp4Checkbox = document.getElementById("filterMp4Only");
  if (mp4Checkbox) {
      if (window.innerWidth <= 768) { // mobile breakpoint
          mp4Checkbox.checked = true;
      }
      // Auto-refresh lists when MP4-only checkbox changes
      mp4Checkbox.addEventListener("change", () => {
          filterDisplayedByFilename();
      });
  }

  // ✅ NEW: Duplicates filter checkbox
  const duplicatesCheckbox = document.getElementById("filterDuplicatesOnly");
  if (duplicatesCheckbox) {
      duplicatesCheckbox.addEventListener("change", () => {
          window.skipSearchScroll = true;
          filterDisplayedByFilename();
      });
  }

 // Orientation filter change handler
 const orientationFilter = document.getElementById("orientationFilter");
  if (orientationFilter) {
      orientationFilter.addEventListener("change", () => {
          window.skipSearchScroll = true;
          filterDisplayedByFilename();
      });
  }

  // ✅ Mobile portrait secondary row: orientation toggle + CSV buttons
  // 13.62: bare labels. The idle one names the filter; once it's on, the blue
  // says a filter is armed and the value alone says which.
  // picker 15.7 / native 15.5: drawn as rectangles instead of words - both
  // (landscape + portrait) when off, then the one being filtered for.
  const ORIENT_SVG = (w, h) => `<rect x="${(w === 14 ? 1 : 4)}" y="${(w === 14 ? 4 : 1)}" width="${w}" height="${h}" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.8"></rect>`;
  const ORIENT_ICON = (inner, vbW) => `<svg viewBox="0 0 ${vbW} 16" width="${vbW}" height="16" aria-hidden="true" focusable="false" style="display:block;margin:0 auto;">${inner}</svg>`;
  const ORIENTATION_CYCLE = [
      { value: "any", label: "Orientation", icon: ORIENT_ICON(ORIENT_SVG(14, 8) + `<g transform="translate(16 0)">${ORIENT_SVG(8, 14)}</g>`, 32) },
      { value: "L",   label: "Landscape",   icon: ORIENT_ICON(ORIENT_SVG(14, 8), 16) },
      { value: "P",   label: "Portrait",    icon: ORIENT_ICON(ORIENT_SVG(8, 14), 16) }
  ];

  window.syncOrientationToggleLabel = function () {
      const sel = document.getElementById("orientationFilter");
      const btn = document.getElementById("orientationToggleBtn");
      if (!sel || !btn) return;
      const entry = ORIENTATION_CYCLE.find(o => o.value === sel.value) || ORIENTATION_CYCLE[0];
      btn.innerHTML = entry.icon;
      btn.title = entry.value === "any" ? "Orientation filter: all (tap to cycle)" : `Orientation filter: ${entry.label}`;
      btn.setAttribute("aria-label", entry.value === "any" ? "Orientation: all" : entry.label);
      btn.style.background = entry.value === "any" ? "#555" : "#007bff";
  };

  // ✅ StashDB-match cycle and bookmark cycle. Both keep their state on the
  // button's own dataset, like the offline toggle - there is no filter-panel
  // control to mirror here, so a hidden <select> would be dead weight.
  const STASH_FILTER_CYCLE = [
      { value: "any",       label: "Stash" },
      { value: "matched",   label: "Matched" },
      { value: "unmatched", label: "Unmatched" }
  ];

  window.syncStashFilterToggleLabel = function () {
      const b = document.getElementById("stashFilterToggleBtn");
      if (!b) return;
      // No stash-state cache on this build means nothing to filter against.
      // Hiding beats showing a control that silently does nothing.
      if (typeof window.scrayHasStashMatch !== "function") {
          b.style.display = "none";
          return;
      }
      const entry = STASH_FILTER_CYCLE.find(o => o.value === b.dataset.state)
          || STASH_FILTER_CYCLE[0];
      b.textContent = entry.label;
      // Same treatment as the orientation toggle: grey off, blue on. Colour is
      // not carrying WHICH of the two on-states is armed - the label does that.
      b.style.background = entry.value === "any" ? "#555" : "#007bff";
  };

  const stashFilterToggleBtn = document.getElementById("stashFilterToggleBtn");
  if (stashFilterToggleBtn) {
      stashFilterToggleBtn.addEventListener("click", () => {
          const idx = STASH_FILTER_CYCLE.findIndex(o => o.value === stashFilterToggleBtn.dataset.state);
          const next = STASH_FILTER_CYCLE[(idx + 1) % STASH_FILTER_CYCLE.length];
          stashFilterToggleBtn.dataset.state = next.value;
          window.syncStashFilterToggleLabel();
          // A cold start has only the localStorage copy of the matched set.
          // Kick a refresh the moment the filter is actually armed, so an
          // answer that costs nothing when unchanged is never stale.
          if (next.value !== "any" && typeof window.scrayLoadStashState === "function") {
              window.scrayLoadStashState()
                  // 13.187: this second pass didn't set skipSearchScroll, so
                  // it was the one that scrolled the page down to the list.
                  .then(() => { window.skipSearchScroll = true; filterDisplayedByFilename(); })
                  .catch(() => {});
          }
          window.skipSearchScroll = true;
          filterDisplayedByFilename();
      });
      window.syncStashFilterToggleLabel();
  }

  const BOOKMARK_FILTER_CYCLE = [
      { value: "any",  label: "BM" },
      { value: "only", label: "Bookmarked" },
      { value: "none", label: "No BM" }
  ];

  window.syncBookmarkFilterToggleLabel = function () {
      const b = document.getElementById("bookmarkFilterToggleBtn");
      if (!b) return;
      const entry = BOOKMARK_FILTER_CYCLE.find(o => o.value === b.dataset.state)
          || BOOKMARK_FILTER_CYCLE[0];
      b.textContent = entry.label;
      b.style.background = entry.value === "any" ? "#555" : "#007bff";
  };

  const bookmarkFilterToggleBtn = document.getElementById("bookmarkFilterToggleBtn");
  if (bookmarkFilterToggleBtn) {
      bookmarkFilterToggleBtn.addEventListener("click", () => {
          const idx = BOOKMARK_FILTER_CYCLE.findIndex(o => o.value === bookmarkFilterToggleBtn.dataset.state);
          const next = BOOKMARK_FILTER_CYCLE[(idx + 1) % BOOKMARK_FILTER_CYCLE.length];
          bookmarkFilterToggleBtn.dataset.state = next.value;
          window.syncBookmarkFilterToggleLabel();
          window.skipSearchScroll = true;
          filterDisplayedByFilename();
      });
      window.syncBookmarkFilterToggleLabel();
  }

  // ✅ Native (13.50): uncatalogued-only toggle. Two states on the button's
  // own dataset, grey off / blue on like the others.
  window.syncUncataloguedToggleLabel = function () {
      const b = document.getElementById("uncataloguedToggleBtn");
      if (!b) return;
      const on = b.dataset.active === "1";
      b.textContent = "Uncat"; // picker 15.7 / native 15.5: one label, the blue says it is on
      b.style.background = on ? "#007bff" : "#555";
  };

  const uncataloguedToggleBtn = document.getElementById("uncataloguedToggleBtn");
  if (uncataloguedToggleBtn) {
      uncataloguedToggleBtn.addEventListener("click", () => {
          uncataloguedToggleBtn.dataset.active = uncataloguedToggleBtn.dataset.active === "1" ? "0" : "1";
          window.syncUncataloguedToggleLabel();
          window.skipSearchScroll = true;
          filterDisplayedByFilename();
      });
      window.syncUncataloguedToggleLabel();
  }

  // ✅ Offline filter (native 15.11, as Picker's). Orange when on, with the
  // count of files on this phone in the label.
  window.syncOfflineOnlyToggleLabel = function () {
      const b = document.getElementById("offlineOnlyToggleBtn");
      if (!b) return;
      const on = b.dataset.active === "1";
      const all = Array.isArray(window.allVideos) ? window.allVideos : [];
      const n = typeof window.scrayIsOffline === "function" ? all.filter(window.scrayIsOffline).length : 0;
      b.textContent = on ? `Offline (${n})` : "Offline: All";
      b.style.background = on ? "#ff9800" : "#555";
      b.style.color = "#fff";
  };

  const offlineOnlyToggleBtn = document.getElementById("offlineOnlyToggleBtn");
  if (offlineOnlyToggleBtn) {
      offlineOnlyToggleBtn.addEventListener("click", () => {
          offlineOnlyToggleBtn.dataset.active =
              offlineOnlyToggleBtn.dataset.active === "1" ? "0" : "1";
          window.syncOfflineOnlyToggleLabel();
          window.skipSearchScroll = true;
          filterDisplayedByFilename();
      });
      window.syncOfflineOnlyToggleLabel();
  }

  // ✅ Hetzner filter (native 15.10, as picker 15.9). Three states on the
  // button's own dataset: off, on the box, not on the box. Red either way a
  // filter is armed - the label says which.
  const HETZNER_FILTER_CYCLE = [
      { value: "any",  label: "Hetz",    bg: "#555" },
      { value: "only", label: "Hetz",    bg: "#dc3545" },
      { value: "none", label: "No Hetz", bg: "#dc3545" }
  ];

  window.syncHetznerOnlyToggleLabel = function () {
      const b = document.getElementById("hetznerOnlyToggleBtn");
      if (!b) return;
      const entry = HETZNER_FILTER_CYCLE.find(o => o.value === b.dataset.state) || HETZNER_FILTER_CYCLE[0];
      b.textContent = entry.label;
      b.style.background = entry.bg;
      b.style.color = "#fff";
      b.title = entry.value === "only" ? "Showing only files on the Hetzner Storage Box"
              : entry.value === "none" ? "Showing only files NOT on the Hetzner Storage Box"
              : "Hetzner filter: off (tap to cycle)";
  };

  const hetznerOnlyToggleBtn = document.getElementById("hetznerOnlyToggleBtn");
  if (hetznerOnlyToggleBtn) {
      hetznerOnlyToggleBtn.addEventListener("click", () => {
          const i = HETZNER_FILTER_CYCLE.findIndex(o => o.value === (hetznerOnlyToggleBtn.dataset.state || "any"));
          hetznerOnlyToggleBtn.dataset.state = HETZNER_FILTER_CYCLE[(i + 1) % HETZNER_FILTER_CYCLE.length].value;
          window.syncHetznerOnlyToggleLabel();
          window.skipSearchScroll = true;
          filterDisplayedByFilename();
      });
      window.syncHetznerOnlyToggleLabel();
  }

  const orientationToggleBtn = document.getElementById("orientationToggleBtn");
  if (orientationToggleBtn) {
      orientationToggleBtn.addEventListener("click", () => {
          const sel = document.getElementById("orientationFilter");
          if (!sel) return;
          const idx = ORIENTATION_CYCLE.findIndex(o => o.value === sel.value);
          const next = ORIENTATION_CYCLE[(idx + 1) % ORIENTATION_CYCLE.length];
          sel.value = next.value;
          // Reuse the existing change handler so filtering behaviour is identical
          sel.dispatchEvent(new Event("change", { bubbles: true }));
          window.syncOrientationToggleLabel();
      });
      window.syncOrientationToggleLabel();
  }

  // Proxy to the existing controls in <section> so behaviour stays in one place
  document.getElementById("mobileExportCsvBtn")?.addEventListener("click", () => {
      document.getElementById("exportCsvBtn")?.click();
  });

   // Corner C Button - now mirrors the player Stop button exactly
const clearBtnCorner = document.getElementById("clearBtnCorner");
if (clearBtnCorner) {
    clearBtnCorner.addEventListener("click", (e) => {
        if (window.inlineVideoPlayer) {
            window.inlineVideoPlayer.reset();
        }
        e.currentTarget.blur();
    });
}


// Corner Stop Button
const stopBtnCorner = document.getElementById("stopBtnCorner");
   if (stopBtnCorner) {
       stopBtnCorner.addEventListener("click", () => {
           if (window.inlineVideoPlayer) {
               window.inlineVideoPlayer.stop();
           }
       });
   }

});

// =========================================
// PLAY RANDOM FILTERED VIDEO - WEIGHTED TOWARD LESS-WATCHED (all screens)
// =========================================
document.addEventListener("DOMContentLoaded", () => {
const playRandomWeightedBtn = document.getElementById("playRandomWeightedBtn");

if (playRandomWeightedBtn) {
playRandomWeightedBtn.addEventListener("click", async () => {

const isLandscape = window.matchMedia('(orientation: landscape)').matches;
const isMobile = window.innerWidth <= 1024;

if (typeof toggleBasket === 'function') toggleBasket(false);
if (typeof toggleHistory === 'function') toggleHistory(false);
if (!(isLandscape && isMobile)) {
 if (typeof toggleRandomPlaylistPanel === 'function') toggleRandomPlaylistPanel(false);
}

const includeTags = Array.from(window.commonSelectedTags);
const excludeTags = $('#excludeTagSelect').val() || [];
const minDurationMs = getDurationMsFromInputs("minMinutes", "minSeconds");
const maxDurationMs = getDurationMsFromInputs("maxMinutes", "maxSeconds");

let videosToChooseFrom = await getFilteredVideos(includeTags, excludeTags, minDurationMs, maxDurationMs);

const searchBoxWeighted = document.getElementById("filenameSearchBox");
const searchTextWeighted = searchBoxWeighted?.value.trim() || '';
if (searchTextWeighted.length > 0) {
const query = parseSearchQuery(searchTextWeighted);
videosToChooseFrom = videosToChooseFrom.filter(video => matchesSearchQuery(video, query));
}

if (!videosToChooseFrom || videosToChooseFrom.length === 0) {
alert("No videos match current filters");
return;
}

const eligibleVideos = videosToChooseFrom.filter(v => {
const vidId = v.oneDriveId ?? v.idFromAPI ?? null;
return !recentlyPlayedVideos.includes(vidId);
});
const finalPool = eligibleVideos.length > 0 ? eligibleVideos : videosToChooseFrom;

if (finalPool.length === 0) {
alert("No videos available in database");
return;
}

let viewCountMap = new Map();
if (typeof window.getCachedViewCounts === 'function') {
    try {
        viewCountMap = await window.getCachedViewCounts();
    } catch (err) {
        console.warn('Could not load view counts for weighted random:', err);
    }
}

const weights = finalPool.map(v => {
    const viewCount = viewCountMap.get(v.oneDriveId) ?? 0;
    return 1 / (viewCount + 1);
});
const totalWeight = weights.reduce((sum, w) => sum + w, 0);

let randomVideo;
if (totalWeight <= 0) {
    randomVideo = finalPool[Math.floor(Math.random() * finalPool.length)];
} else {
    let r = Math.random() * totalWeight;
    randomVideo = finalPool[finalPool.length - 1];
    for (let i = 0; i < finalPool.length; i++) {
        r -= weights[i];
        if (r <= 0) {
            randomVideo = finalPool[i];
            break;
        }
    }
}

const actualIndex = videosToChooseFrom.findIndex(v => v.oneDriveId === randomVideo.oneDriveId);

const vidIdWeighted = randomVideo.oneDriveId ?? randomVideo.idFromAPI ?? null;
if (vidIdWeighted) {
recentlyPlayedVideos.unshift(vidIdWeighted);
if (recentlyPlayedVideos.length > 10) {
  recentlyPlayedVideos = recentlyPlayedVideos.slice(0, 10);
}
}

if (window.inlineVideoPlayer && randomVideo) {
console.log(`Playing weighted-random video (favouring less-watched): ${randomVideo.filename}`);
window.lastPlayLabel = 'Weighted Random'; // Shown above the loading video details
window.inlineVideoPlayer.play(randomVideo, 'main', actualIndex >= 0 ? actualIndex : 0);

if (window.innerWidth <= 1024) {
  setTimeout(() => {
    const player = document.getElementById("inlineVideoContainer");
    if (player) {
      player.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, 300);
}
} else {
alert("Video player not available");
}
});
}
});

// =========================================
// PLAY RANDOM FILTERED VIDEO (all screens)
// =========================================
document.addEventListener("DOMContentLoaded", () => {
// =========================================
// PLAY RANDOM FILTERED VIDEO AT A RANDOM TIME POINT - X^T (all screens)
// =========================================
// Picks exactly like X does, but instead of opening at 0:00 it drops you
// somewhere in the middle. playVideoInline's 4th argument is a start point in
// seconds; the existing scrayApplyPendingStartAt machinery waits for a
// seekable source before writing it, so nothing extra is needed here.
const playRandomTimeBtn = document.getElementById("playRandomTimeBtn");

if (playRandomTimeBtn) {
playRandomTimeBtn.addEventListener("click", async () => {

// ⚙️ Where X^T is allowed to land, as a fraction of the video's length.
// Keeps it clear of the opening and of the closing stretch.
const START_MIN_FRACTION = 0.05;
const START_MAX_FRACTION = 0.95;

const isLandscape = window.matchMedia('(orientation: landscape)').matches;
const isMobile = window.innerWidth <= 1024;

if (typeof toggleBasket === 'function') toggleBasket(false);
if (typeof toggleHistory === 'function') toggleHistory(false);
if (!(isLandscape && isMobile)) {
 if (typeof toggleRandomPlaylistPanel === 'function') toggleRandomPlaylistPanel(false);
}

const includeTags = Array.from(window.commonSelectedTags);
const excludeTags = $('#excludeTagSelect').val() || [];
const minDurationMs = getDurationMsFromInputs("minMinutes", "minSeconds");
const maxDurationMs = getDurationMsFromInputs("maxMinutes", "maxSeconds");

let videosToChooseFrom = await getFilteredVideos(includeTags, excludeTags, minDurationMs, maxDurationMs);

const searchBoxTime = document.getElementById("filenameSearchBox");
const searchTextTime = searchBoxTime?.value.trim() || '';
if (searchTextTime.length > 0) {
const queryTime = parseSearchQuery(searchTextTime);
videosToChooseFrom = videosToChooseFrom.filter(video => matchesSearchQuery(video, queryTime));
}

if (!videosToChooseFrom || videosToChooseFrom.length === 0) {
alert("No videos match current filters");
return;
}

const eligibleTime = videosToChooseFrom.filter(v => {
const vidId = v.oneDriveId ?? v.idFromAPI ?? null;
return !recentlyPlayedVideos.includes(vidId);
});
let finalPoolTime = eligibleTime.length > 0 ? eligibleTime : videosToChooseFrom;

if (finalPoolTime.length === 0) {
alert("No videos available in database");
return;
}

// Prefer videos whose length is already known - without a duration there is
// no "45% of the way in" to aim for. If nothing in the pool has one, keep
// the pool as-is and just open at the start.
const timedPool = finalPoolTime.filter(v => Number(v.durationMs) > 0);
if (timedPool.length > 0) finalPoolTime = timedPool;

const randomVideo = finalPoolTime[Math.floor(Math.random() * finalPoolTime.length)];
const actualIndex = videosToChooseFrom.findIndex(v => v.oneDriveId === randomVideo.oneDriveId);

const durationSec = Number(randomVideo.durationMs) > 0 ? randomVideo.durationMs / 1000 : 0;
const fraction = START_MIN_FRACTION + Math.random() * (START_MAX_FRACTION - START_MIN_FRACTION);
const startAt = durationSec > 0 ? durationSec * fraction : null;

const vidIdTime = randomVideo.oneDriveId ?? randomVideo.idFromAPI ?? null;
if (vidIdTime) {
recentlyPlayedVideos.unshift(vidIdTime);
if (recentlyPlayedVideos.length > 10) {
  recentlyPlayedVideos = recentlyPlayedVideos.slice(0, 10);
}
}

if (window.inlineVideoPlayer && randomVideo) {
console.log(`Playing random video at a random point: ${randomVideo.filename}`
  + (startAt != null
      ? ` - starting at ${Math.round(startAt)}s (${Math.round(fraction * 100)}% in)`
      : ' - duration unknown, starting at 0'));
window.lastPlayLabel = startAt != null
  ? `Random @ ${Math.round(fraction * 100)}%`
  : 'Random (no duration)';
window.inlineVideoPlayer.play(randomVideo, 'main', actualIndex >= 0 ? actualIndex : 0, startAt);

if (window.innerWidth <= 1024) {
  setTimeout(() => {
    const player = document.getElementById("inlineVideoContainer");
    if (player) {
      player.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, 300);
}
} else {
alert("Video player not available");
}
});
}

const playRandomBtn = document.getElementById("playRandomFilteredBtn");

if (playRandomBtn) {
playRandomBtn.addEventListener("click", async () => {

// ✅ Check if in landscape mobile mode
const isLandscape = window.matchMedia('(orientation: landscape)').matches;
const isMobile = window.innerWidth <= 1024;

// ✅ Dismiss panels - but NOT random panel if in landscape mobile (main list is there)
if (typeof toggleBasket === 'function') toggleBasket(false);
if (typeof toggleHistory === 'function') toggleHistory(false);
if (!(isLandscape && isMobile)) {
 // Only close random panel if NOT in landscape mobile
 if (typeof toggleRandomPlaylistPanel === 'function') toggleRandomPlaylistPanel(false);
}

// Get current filter settings
const includeTags = Array.from(window.commonSelectedTags);
const excludeTags = $('#excludeTagSelect').val() || [];
const minDurationMs = getDurationMsFromInputs("minMinutes", "minSeconds");
const maxDurationMs = getDurationMsFromInputs("maxMinutes", "maxSeconds");

// Apply filters to get eligible videos (includes MP4-only checkbox)
let videosToChooseFrom = await getFilteredVideos(includeTags, excludeTags, minDurationMs, maxDurationMs);

// ✅ Apply text search filter if search box has text
const searchBox = document.getElementById("filenameSearchBox");
const searchText = searchBox?.value.trim() || '';
if (searchText.length > 0) {
const query = parseSearchQuery(searchText);
videosToChooseFrom = videosToChooseFrom.filter(video => matchesSearchQuery(video, query));
console.log(`Applied search filter "${searchText}" - ${videosToChooseFrom.length} videos match`);
}

if (!videosToChooseFrom || videosToChooseFrom.length === 0) {
alert("No videos match current filters");
return;
}

// ✅ Exclude recently played videos (last 10)
const eligibleVideos = videosToChooseFrom.filter(v => {
const vidId = v.oneDriveId ?? v.idFromAPI ?? null;
return !recentlyPlayedVideos.includes(vidId);
});

// If all videos have been played recently, allow repeats
const finalPool = eligibleVideos.length > 0 ? eligibleVideos : videosToChooseFrom;

if (finalPool.length === 0) {
alert("No videos available in database");
return;
}

// Pick a random video
const randomIndex = Math.floor(Math.random() * finalPool.length);
const randomVideo = finalPool[randomIndex];

// ✅ Track this video as recently played
const vidId = randomVideo.oneDriveId ?? randomVideo.idFromAPI ?? null;
if (vidId) {
recentlyPlayedVideos.unshift(vidId);
// Keep only last 10
if (recentlyPlayedVideos.length > 10) {
  recentlyPlayedVideos = recentlyPlayedVideos.slice(0, 10);
}
}

// Play it
if (window.inlineVideoPlayer && randomVideo) {
console.log(`Playing random video: ${randomVideo.filename} (avoiding last ${recentlyPlayedVideos.length - 1} played)`);
window.lastPlayLabel = 'Random';
window.inlineVideoPlayer.play(randomVideo, 'main', randomIndex);

// ✅ Mobile: auto-scroll to player after brief delay
if (window.innerWidth <= 1024) {
  setTimeout(() => {
    const player = document.getElementById("inlineVideoContainer");
    if (player) {
      player.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, 300);
}
} else {
alert("Video player not available");
}
});
}

// ADD RANDOM TAG BUTTON LISTENER HERE
const randomTagBtn = document.getElementById("randomTagBtn");
if (randomTagBtn) {
randomTagBtn.addEventListener("click", async () => {
 await selectRandomTag();
});
}

// Score filter button
const scoreFilterBtn = document.getElementById("scoreFilterBtn");
if (scoreFilterBtn) {
   scoreFilterBtn.addEventListener("click", () => {
       showScoreFilterModal();
   });
}

});

// =========================================
// Mobile Keyboard Adjustment for anchored corner buttons
// =========================================

if (window.visualViewport) {
const adjustForKeyboard = () => {
 const kbHeight = window.innerHeight - window.visualViewport.height;
 const isKeyboard = kbHeight > 150; // threshold

 document.body.classList.toggle('keyboard-active', isKeyboard);

 // Track whether the pink search pill is currently visible, so the
 // CSS above only hides the player/filter bar when there's an active
 // search term the user can reference instead.
 const searchPill = document.querySelector('.floating-tag-search');
 document.body.classList.toggle('search-pill-active', !!searchPill);

 if (isKeyboard) {
   // Distance above keyboard
   document.documentElement.style.setProperty('--keyboard-offset', `${kbHeight}px`);

   // Compensate for scroll movement while keyboard is open
   // translateY repositions element to stay fixed relative to keyboard
   const vpTop = window.visualViewport.offsetTop || window.visualViewport.pageTop || 0;
   document.documentElement.style.setProperty('--keyboard-scroll-offset', `${vpTop}px`);

   // 13.82: the same problem, from the other end. `position: fixed` is laid
   // out against the LAYOUT viewport, and when iOS opens the keyboard it
   // scrolls the page to bring the focused input above it - so a bar pinned
   // to top:0 ends up above what you can actually see, and the pills vanish
   // exactly when you are typing the filter they describe.
   //
   // The gap between the two viewports is what has to be added back.
   // offsetTop is the direct answer where a browser reports it; iOS Safari
   // usually leaves it at 0 and moves pageTop instead, which is measured
   // from the top of the DOCUMENT, so the page's own scroll comes off it.
   //
   // 13.138: the name is now historical. This is the viewport gap, and anything
   // `position: fixed` needs it - applyManualRotationStyles() reads it too, to
   // stop the whole FLS surface riding up while you type. Don't rename or drop
   // it without checking player.js as well as the pills-bar rule in style.css.
   const vv = window.visualViewport;
   const seenTop = vv.offsetTop || Math.max(0, (vv.pageTop || 0) - (window.scrollY || 0));
   document.documentElement.style.setProperty('--pills-top-offset', `${seenTop}px`);
 } else {
   document.documentElement.style.removeProperty('--keyboard-offset');
   document.documentElement.style.removeProperty('--keyboard-scroll-offset');
   document.documentElement.style.removeProperty('--pills-top-offset');
 }

 // Nudge ONLY the filter bar above the keyboard, without touching
 // corner buttons / info bar / player positions. This avoids
 // recomputing computeBottomDock() (which relies on corner button
 // rects and would otherwise cause a layout jump).
 const isMobilePortrait = window.innerWidth <= 768 && window.matchMedia('(orientation: portrait)').matches;
 const searchWrapper = document.querySelector('#mobileElements .search-wrapper.filter-bottom-docked');
 if (isMobilePortrait && searchWrapper) {
   if (isKeyboard) {
     const currentBottom = parseFloat(searchWrapper.dataset.originalBottom || searchWrapper.style.bottom || 0);
     if (!searchWrapper.dataset.originalBottom) {
       searchWrapper.dataset.originalBottom = currentBottom;
     }
     searchWrapper.style.bottom = (currentBottom + kbHeight) + 'px';
   } else if (searchWrapper.dataset.originalBottom) {
     searchWrapper.style.bottom = searchWrapper.dataset.originalBottom + 'px';
     delete searchWrapper.dataset.originalBottom;
   }
 }
};

window.visualViewport.addEventListener('resize', adjustForKeyboard);
window.visualViewport.addEventListener('scroll', adjustForKeyboard);
}
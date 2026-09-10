// render.js

/**
* Update the pink highlight state in both main list and random list
* based purely on whether the video exists in basketVideos.
*/
function updateBasketHighlights() {
  const allListItems = document.querySelectorAll('#playlist li, #taggedVideosContainer li');
  allListItems.forEach(li => {
      const videoIdInLi = li.dataset.videoId;
      if (basketVideos.some(v => v.oneDriveId === videoIdInLi)) {
          li.classList.add('basket-added');
      } else {
          li.classList.remove('basket-added');
      }
  });
}

/**
* Build one <li> for a video row: numbering, clickable path, score badge,
* size/duration, the button group and the row-level click handlers.
*
* This block used to be pasted twice - once in renderVideoList, once in
* appendVideoList - and the two copies had already drifted in whitespace and
* comments. Both now call this, and so does the bookmarks page.
*
* @param {Object} video       - the video to render
* @param {string} listContext - which list this row belongs to ('main',
*                               'random', 'bookmarks'). Handed to
*                               inlineVideoPlayer.play so next/previous walk
*                               the right list.
* @param {number} index       - 0-based position within that list
* @param {Object} [options]
*        onPlay - replaces the P button's action outright. The bookmarks page
*                 uses this to start at the bookmark's timestamp.
*        prefix - a Node inserted ahead of the row numbering. The bookmarks
*                 page uses this for the note + timestamp.
* @returns {HTMLLIElement}
*/
function buildVideoRow(video, listContext, index, options = {}) {
   const li = document.createElement('li');
   li.style.marginBottom = "4px";

   const vidId = video.oneDriveId ?? video.idFromAPI ?? null;
   li.dataset.videoId = vidId;

// Display name/path
const nameSpan = document.createElement("span");
nameSpan.textContent = `${index + 1}. `;
nameSpan.style.whiteSpace = "normal";
nameSpan.style.wordBreak = "break-word";
nameSpan.style.overflowWrap = "break-word";

// Add clickable path
const pathFragment = createClickablePath(video, true, true);
pathFragment.childNodes.forEach(node => {
if (node.nodeType === 1) {
  node.style.fontSize = "0.75rem";
  // Apply non-MP4 color to filename only
  if (node.textContent === video.filename && 
      (video.filename || '').split('.').pop().toLowerCase() !== 'mp4') {
    node.style.color = '#be7b7bff';
  }
}
});
nameSpan.appendChild(pathFragment);

// Apply highlighting AFTER appending to DOM
if (window.currentSearchTerms && window.currentSearchTerms.length > 0) {
   applyHighlightingToElement(nameSpan, window.currentSearchTerms);
}

 nameSpan.style.display = "inline";
 li.appendChild(nameSpan);

  // Score display (if available from Excel)
 const scoreSpan = document.createElement("span");
 scoreSpan.className = "list-score-badge";
 if (video.user_score !== undefined && video.user_score !== null) {
   scoreSpan.textContent = ` [${video.user_score}]`;
     scoreSpan.style.marginLeft = "4px";
     scoreSpan.style.fontSize = "0.65rem";
     scoreSpan.style.color = "#ff9800";
     scoreSpan.style.fontWeight = "bold";
     scoreSpan.style.display = "inline";
     li.appendChild(scoreSpan);
 }

// Flag videos on this device that have no row in the SQLite catalogue.
 // They still play and still score — the scores just stay local, because
 // Native never auto-creates catalogue rows. Tapping the badge looks for a
 // catalogue entry with the same file size and adopts its key on confirmation.
 if (video.inCatalogue === false) {
     const notInCatSpan = document.createElement("span");
     notInCatSpan.className = "not-in-catalogue-badge";
     notInCatSpan.textContent = "⚠";
     notInCatSpan.title = "Not in the SQLite catalogue — tap to check for a match";
     notInCatSpan.style.cursor = "pointer";
     notInCatSpan.style.padding = "4px 6px";
     notInCatSpan.onclick = (e) => { e.stopPropagation(); window.scrayTryFingerprintMatch(video, notInCatSpan); };
     li.appendChild(notInCatSpan);
 }

// Size + Duration
 const sizeDurSpan = document.createElement("span");
 if (video.path === "yet-to-upload" || (Array.isArray(video.tags) && video.tags.includes("yet-to-upload"))) {
     sizeDurSpan.textContent = "";
 } else {
     sizeDurSpan.textContent = ` [${formatFileSize(video.sizeBytes)}, ${formatDuration(window.scrayDisplayDurationMs ? window.scrayDisplayDurationMs(video) : video.durationMs)}]`;
 }
 sizeDurSpan.style.marginLeft = "6px";
 sizeDurSpan.style.display = "inline";
 li.appendChild(sizeDurSpan);

 const buttons = buildVideoRowButtons(video, listContext, index, options);

const btnContainer = createCompactButtonGroup(buttons, 5, video);

li.appendChild(btnContainer);

// ✅ Right-click context menu
li.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showContextMenu(buttons.slice(3), e); // Show overflow menu (buttons after first 3)
});

// ✅ Click anywhere on list item (except buttons and clickable tags) to open rename modal
li.style.cursor = 'pointer';
li.addEventListener('click', async (e) => {
   // Don't trigger if clicking on buttons
   if (e.target.closest('.compact-btn-group')) return;
   if (e.target.closest('button')) return;
   
   // Don't trigger if clicking on clickable tags (folders or bracket tags)
   if (e.target.style.textDecoration === 'underline') return;
   
   // Open rename modal
   if (typeof window.showRenameModal === 'function') {
       await window.showRenameModal(video);
   }
});

 if (options.prefix) li.insertBefore(options.prefix, li.firstChild);

 return li;
}
window.scrayBuildVideoRow = buildVideoRow;

/**
* The per-video button specs: P, D, ★, B, BM and the overflow actions.
* Lifted out of buildVideoRow so the main list's open rows get the
* identical set - one list of actions, not two drifting copies.
*/
function buildVideoRowButtons(video, listContext, index, options = {}) {
  // Check if yet-to-upload
 const isYetToUpload = video.path === "yet-to-upload" || 
                       (Array.isArray(video.tags) && video.tags.includes("yet-to-upload"));
  
 // ✅ Create compact button group
 const buttons = [
  {
      label: "P",
      title: "Play video",
      color: "#28a745",
      onClick: () => (options.onPlay
          ? options.onPlay()
          : inlineVideoPlayer.play(video, listContext, index))
  },
  {
     label: "D",
     title: "Download",
     disabled: isYetToUpload,
     onClick: async () => {
         try {
             let vid = video;
             vid = await refreshVideoBeforeUse(vid);
             if (vid && vid.downloadUrl) {
                 window.location.href = vid.downloadUrl;
             } else {
                 showDownloadError("Missing or expired download URL", video);
             }
         } catch (err) {
             console.error("Download failed", err);
             showDownloadError(err.message || 'Download failed', video);
         }
     }
 },
 {
   label: "★",
   title: "Score video",
   color: "#ffc107",
   onClick: (e) => {
       e.stopPropagation();
       if (typeof window.showVideoScoringModal === 'function') {
           window.showVideoScoringModal(video, e);
       }
   }
},
{
  label: "B",
  title: "Add to basket",
  color: "#e91e63",
  onClick: () => {
      let oneDriveId = video.oneDriveId ?? video.idFromAPI ?? null;
      let driveId = video.driveId ?? null;
      if ((!oneDriveId || !driveId) && video.webUrl) {
          try {
              const u = new URL(video.webUrl);
              const cidParam = u.searchParams.get("cid");
              const idParam = u.searchParams.get("id");
              if (cidParam) driveId = driveId || cidParam;
              if (idParam) oneDriveId = oneDriveId || idParam;
          } catch {}
      }
      const existingIndex = basketVideos.findIndex(v => v.oneDriveId === oneDriveId);
      if (existingIndex >= 0) {
          // remove from basket
          basketVideos.splice(existingIndex, 1);
          saveBasket();
          renderBasket();
      } else {
          addToBasket({ ...video, oneDriveId, driveId });
      }
      updateBasketHighlights();
  }
},
{
   label: "BM",
   title: "Bookmarks",
   color: window.scrayHasBookmarks(video) ? "#6f42c1" : "#ece6f6",
   textColor: window.scrayHasBookmarks(video) ? "white" : "#6f42c1",
   onClick: (e) => {
       e.stopPropagation();
       if (typeof window.showBookmarksModal === 'function') {
           window.showBookmarksModal(video);
       }
   }
 },
 {
   label: "Move",
   title: "Move file to different folder",
   color: "#9c27b0",
   disabled: isYetToUpload,
   onClick: async () => {
       if (typeof window.showMoveFileModal === 'function') {
           await window.showMoveFileModal(video);
       }
   }
},

{
label: "Refresh Data",
title: "Pull the latest score, bookmarks and counters from the database",
color: "#17a2b8",
onClick: async (e) => {
   e.stopPropagation();
   try {
       await window.refreshVideoFromDb(video);
       await window.refreshAfterDbPull(video);
   } catch (err) {
       console.error('DB refresh failed:', err);
       alert(`Refresh failed: ${err.message}`);
   }
}
},

{
   label: "Open Link",
   title: "Open in OneDrive",
   disabled: !video.webUrl || isYetToUpload,
   onClick: () => {
       if (video.webUrl) window.open(video.webUrl, '_blank');
   }
},
{
   label: "Copy Name",
   title: "Copy filename to clipboard",
   onClick: (e) => {
       const textToCopy = video.filename || '';
       copyToClipboardWithFeedback(textToCopy, e);
    }
},
{
label: "F tally",
title: "Increment F tally",
color: "#17a2b8",
onClick: async (e) => {
    e.stopPropagation();
    if (typeof window.showFTallyConfirmModal === 'function') {
        await window.showFTallyConfirmModal(video, e);
    } else {
      alert('Excel Online not connected');
    }
}
},
 {
   label: "Stats",
   title: "View stats",
    color: "#17a2b8",
    onClick: (e) => {
        e.stopPropagation();
        if (typeof window.showVideoStatsModal === 'function') {
            window.showVideoStatsModal(video);
        }
    }
},
{
    label: "X",
    title: "Delete file",
    color: "#f44336",
    disabled: isYetToUpload,
    onClick: async () => {
        if (typeof window.showDeleteModal === 'function') {
            await window.showDeleteModal(video);
        }
    }
}
];

return buttons;
}
window.scrayBuildVideoRowButtons = buildVideoRowButtons;

/* =========================================
LISTS - column rows
=========================================

The main, random, history and basket lists borrow Wholesale step 1's
condensed layout: one line per file, in columns, with everything else one tap
away.

  collapsed   #  studio  performers  filename  score  size
              (history and basket: no size, and the # is a tick)
  open        path
              studio / performers / title          (where StashDB has one)
              filename [score] (size, duration)
              views · watched · last played · created
              the button group

The open half is built the FIRST time a row is opened, not for every row up
front, so a 200-row list costs 200 short lines rather than 200 button groups.

#taggedVideosContainer (main) and #playlist (random) are drawn from
render.js; history.js and basket.js call scrayBuildListRow with their own
buttons. The bookmarks page and the landscape panel keep buildVideoRow's
rendering above.
========================================= */

// ⚙️ ADJUSTABLE: true closes the open row when another one is opened.
// false lets several stay open at once.
const SCRAY_LIST_ONE_OPEN = true;

// Which rows are open, per list, by row key. Held outside the DOM because
// nearly every edit made from an open row - score, rename, bookmark, sync
// pull, ticking it - re-renders the list, and the row you were working in
// shouldn't snap shut under you.
const scrayOpenListRows = { main: new Set(), random: new Set(), history: new Set(), basket: new Set() };

/** The score this app displays, or null when there isn't one. */
function scrayListScore(video) {
  const s = video ? (video.user_score ?? video.userScore) : null;
  return (s === undefined || s === null || s === '') ? null : s;
}
window.scrayListScore = scrayListScore;

function scrayListIsYetToUpload(video) {
  return video.path === "yet-to-upload" ||
         (Array.isArray(video.tags) && video.tags.includes("yet-to-upload"));
}

/**
 * The folder crumbs the studio and performer columns fall back to. The
 * catalogue path where the app has one (Native), video.path otherwise, and
 * the top of the tree trimmed by the same rule that trims every name.
 */
function scrayListCrumbs(video) {
  let raw;
  if (typeof window.scrayResolvePathParts === 'function') {
    raw = window.scrayResolvePathParts(video).catalogue;
  } else {
    const p = (video && video.path) || '';
    raw = (p.startsWith('*') ? p.slice(1) : p).split('/').filter(Boolean);
  }
  return (typeof window.scrayNameCrumbs === 'function') ? window.scrayNameCrumbs(raw) : raw;
}

/**
 * Studio and performers as the columns print them. StashDB wins wherever it
 * has an answer. Otherwise the path stands in, the way the library is laid
 * out: everything above the last folder is the studio, the last folder is
 * the performers. The two fall back independently - a studio-only match
 * still takes its performers from the folder.
 *
 * The sort reads this too, so a column sorts by exactly what it shows.
 */
function scrayListColumns(video) {
  const parts  = window.scrayStashNames ? window.scrayStashNames.parts(video) : null;
  const crumbs = scrayListCrumbs(video);
  const stashStudio = (parts && parts.studio) || '';
  const stashCast   = (parts && parts.performerList.length) ? parts.performerList.join(', ') : '';
  return {
    studio: stashStudio || crumbs.slice(0, -1).join(' / '),
    studioFromPath: !stashStudio,
    performers: stashCast || (crumbs.length ? crumbs[crumbs.length - 1] : ''),
    performersFromPath: !stashCast
  };
}
window.scrayListColumns = scrayListColumns;

// Short forms for the columns. The open row prints the long forms through
// formatFileSize / formatDuration like everywhere else.
function scrayListSize(bytes) {
  if (bytes == null || !isFinite(bytes) || bytes <= 0) return '';
  const KB = 1024, MB = KB * 1024, GB = MB * 1024;
  if (bytes >= GB) return (bytes / GB).toFixed(bytes >= 10 * GB ? 0 : 1) + ' GB';
  if (bytes >= MB) return Math.round(bytes / MB) + ' MB';
  return Math.max(1, Math.round(bytes / KB)) + ' KB';
}

function scrayListScoreText(score) {
  if (score == null) return '—';
  const n = Number(score);
  return isFinite(n) ? (Number.isInteger(n) ? String(n) : n.toFixed(1)) : String(score);
}

function scrayListDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  return isNaN(d) ? '—' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// time_viewed is seconds of playback accumulated, not a timestamp.
function scrayListWatched(seconds) {
  const s = Number(seconds) || 0;
  return s > 0 ? formatDuration(s * 1000) : '—';
}

// ---------------------------------------------------------------- header

// ⚙️ Column labels. Short because each header cell is only as wide as the
// column under it: "Perf" for performers, and ★ for score, whose column is
// narrowed to fit the number rather than the word. `name` is the long form,
// for the tooltip.
const SCRAY_LIST_COLUMN_DEFS = [
  { key: null,         label: '#',      name: 'Number',     cls: 'lc-num' },
  { key: 'studio',     label: 'Studio', name: 'Studio',     cls: 'lc-studio' },
  { key: 'performers', label: 'Perf',   name: 'Performers', cls: 'lc-perf' },
  { key: 'filename',   label: 'File',   name: 'Filename',   cls: 'lc-file' },
  { key: 'score',      label: '★',      name: 'Score',      cls: 'lc-score' },
  { key: 'size',       label: 'Size',   name: 'Size',       cls: 'lc-size' }
];

// ⚙️ Which columns each list draws. History and the basket live in side
// panels, so they drop size. style.css gives each list the matching
// --lc-cols - change one, change the other.
const SCRAY_LIST_COLUMNS_FOR = {
  main:    ['lc-num', 'lc-studio', 'lc-perf', 'lc-file', 'lc-score', 'lc-size'],
  random:  ['lc-num', 'lc-studio', 'lc-perf', 'lc-file', 'lc-score', 'lc-size'],
  history: ['lc-num', 'lc-studio', 'lc-perf', 'lc-file', 'lc-score'],
  basket:  ['lc-num', 'lc-studio', 'lc-perf', 'lc-file', 'lc-score']
};

function scrayListColumnDefs(list) {
  const want = SCRAY_LIST_COLUMNS_FOR[list] || SCRAY_LIST_COLUMNS_FOR.main;
  return SCRAY_LIST_COLUMN_DEFS.filter(c => want.includes(c.cls));
}

/**
 * The header row. Drawn INSIDE the list, so it goes wherever the list goes -
 * desktop-layout.js moves the main container into a column, and a static
 * header in the page would be left behind.
 *
 * Only the main list's headings sort. Tap one to add it to the sort; tap again
 * to reverse it; a third tap takes it back out. With more than one key the
 * arrow carries its place in the order. The random list keeps the order it
 * was drawn in (which is also the order next/previous plays), and history
 * and the basket keep their own order.
 */
function buildListHeader(list) {
  const head = document.createElement('div');
  head.className = 'lc-head';
  const sortable = list === 'main';
  const sort = (sortable && typeof window.scrayListSortState === 'function') ? window.scrayListSortState() : [];

  scrayListColumnDefs(list).forEach(col => {
    const cell = document.createElement('span');
    cell.className = 'lc-cell lc-hcell ' + col.cls;
    cell.title = col.name;

    const label = document.createElement('span');
    label.className = 'lc-hlabel';
    label.textContent = col.label;
    cell.appendChild(label);

    if (sortable && col.key) {
      cell.dataset.sortKey = col.key;
      cell.title = `${col.name}: tap to sort, again to reverse, a third time to remove`;
      const at = sort.findIndex(s => s.key === col.key);
      if (at >= 0) {
        cell.classList.add('lc-sorted');
        const mark = document.createElement('span');
        mark.className = 'lc-hmark';
        mark.textContent = (sort[at].dir === 'asc' ? '↑' : '↓') + (sort.length > 1 ? String(at + 1) : '');
        cell.appendChild(mark);
      }
      cell.addEventListener('click', (e) => {
        e.stopPropagation();
        if (typeof window.scrayListSortTap === 'function') window.scrayListSortTap(col.key);
      });
    }
    head.appendChild(cell);
  });
  return head;
}
window.scrayBuildListHeader = buildListHeader;

function ensureListHeader(container, list) {
  if (container.querySelector(':scope > .lc-head')) return;
  container.insertBefore(buildListHeader(list), container.firstChild);
}

// ---------------------------------------------------------------- rows

/**
 * One collapsed line, for any of the four lists. Everything the open row
 * needs is hung off the <li> so it can be built later.
 *
 * @param {Object} video
 * @param {number} index  0-based position; the row prints index + 1
 * @param {Object} cfg
 *   list      'main' | 'random' | 'history' | 'basket' - columns, open state
 *   buttons   () => that list's own button specs, as a fresh array. The open
 *             row rearranges them (scrayArrangeOpenRowButtons), so each list
 *             keeps its own actions - history's P closes the panel, the
 *             basket's plays in basket order - in one shared layout.
 *   rowKey    what "this row is open" is remembered by. Defaults to the video
 *             id; history passes its entry id, since one file can be in
 *             history more than once.
 *   select    { on, toggle } - makes the # a tick (history and basket)
 *   playedAt  history only: when this entry was played, for the open row
 */
function scrayBuildListRow(video, index, cfg) {
  const list = cfg.list || 'main';
  const li = document.createElement('li');
  li.className = 'lc-row';

  const vidId = video.oneDriveId ?? video.idFromAPI ?? null;
  li.dataset.videoId = vidId;
  li._scrayVideo = video;
  li._scrayIndex = index;
  li._scrayCfg = cfg;
  li._scrayRowKey = String(cfg.rowKey ?? vidId);

  const want = SCRAY_LIST_COLUMNS_FOR[list] || SCRAY_LIST_COLUMNS_FOR.main;
  const cols = scrayListColumns(video);
  const score = scrayListScore(video);

  const line = document.createElement('div');
  line.className = 'lc-line';

  const cell = (cls, text) => {
    const s = document.createElement('span');
    s.className = 'lc-cell ' + cls;
    s.textContent = text;
    return s;
  };

  // "N. " as a bare text node at the front of the row's FIRST span. That is
  // exactly what removeRowFromLists rewrites to renumber after a delete, so
  // it keeps working on these rows without knowing they changed.
  const num = cell('lc-num', `${index + 1}. `);
  if (cfg.select) {
    // The number doubles as the tick, so the rest of the line is free to open
    // the row. A ticked row shows ✓ in place of its number.
    num.classList.add('lc-tick');
    num.title = cfg.select.on ? 'Tap to deselect' : 'Tap to select';
    if (cfg.select.on) {
      li.classList.add('lc-selected');
      num.textContent = '✓';
    }
    num.addEventListener('click', (e) => {
      e.stopPropagation();
      cfg.select.toggle();
    });
  }

  const studio = cell('lc-studio', cols.studio);
  studio.title = cols.studio;
  if (cols.studioFromPath) studio.classList.add('lc-from-path');

  const perf = cell('lc-perf', cols.performers);
  perf.title = cols.performers;
  if (cols.performersFromPath) perf.classList.add('lc-from-path');

  const filename = video.filename || '';
  const file = cell('lc-file', filename);
  file.title = filename;
  if (filename.split('.').pop().toLowerCase() !== 'mp4') file.classList.add('lc-non-mp4');
  // A class, never an inline underline - see scray-offline-title in style.css.
  if (window.scrayIsOffline && window.scrayIsOffline(video)) file.classList.add('scray-offline-title');
  // Native only: on this device but not in the catalogue. The tappable ⚠ that
  // looks for a match lives in the open row.
  if (video.inCatalogue === false) file.classList.add('lc-uncatalogued');

  const scoreCell = cell('lc-score', scrayListScoreText(score));
  if (score == null) scoreCell.classList.add('lc-blank');

  line.append(num, studio, perf, file, scoreCell);
  if (want.includes('lc-size')) {
    line.appendChild(cell('lc-size', scrayListIsYetToUpload(video) ? '' : scrayListSize(video.sizeBytes)));
  }
  li.appendChild(line);

  if (window.currentSearchTerms && window.currentSearchTerms.length > 0) {
    [studio, perf, file].forEach(el => applyHighlightingToElement(el, window.currentSearchTerms));
  }

  line.addEventListener('click', () => toggleListRow(li));

  // Right-click still gives the overflow menu on a closed row. The buttons
  // are built for it if the row has never been opened - the menu reads the
  // same array the button group was built from.
  li.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const buttons = ensureListRowDetail(li);
    showContextMenu(buttons.slice(3), e);
  });

  if (scrayOpenRowsFor(list).has(li._scrayRowKey)) setListRowOpen(li, true);

  return li;
}
window.scrayBuildListRow = scrayBuildListRow;

function scrayOpenRowsFor(list) {
  if (!scrayOpenListRows[list]) scrayOpenListRows[list] = new Set();
  return scrayOpenListRows[list];
}

function setDetailScore(badge, score) {
  badge.textContent = score == null ? '' : ` [${score}]`;
  badge.hidden = score == null;
}

/**
 * Put any list's button specs into the open row's layout:
 *
 *   B  D  ★  S  BM  R  …
 *
 * - P is held back and returned: tapping the open row's text plays, through
 *   P's own handler, so it does exactly what that list's P did.
 * - B leads, where the list has one. The basket's rows don't: their "Remove"
 *   is dropped, since Remove selected in the toolbar does that job.
 * - S is placed explicitly. Left to createCompactButtonGroup, it would find a
 *   B, swap S into B's slot - index 0 - and push a second "Add to Basket" into
 *   the overflow. With an S already present it skips all of that, and still
 *   colours S the same way.
 * - BM: history and the basket call it "Bookmarks". Renamed, so it sits in
 *   the row and createCompactButtonGroup gives it the bookmarked colour.
 * - R is rename. The basket brings its own; the others get one.
 *
 * Mutates and returns the array it is given.
 */
function scrayArrangeOpenRowButtons(buttons, video) {
  const take = (...labels) => {
    const at = buttons.findIndex(b => b && labels.includes(b.label));
    return at >= 0 ? buttons.splice(at, 1)[0] : null;
  };

  const playSpec = take('P');

  // The basket's own rows have "Remove" instead of a B. It is dropped rather
  // than drawn: a row in the basket doesn't need a basket button, and taking
  // things out is what the toolbar's Remove selected is for.
  const basketSpec = take('B');
  take('Remove');

  const bmSpec = take('BM', 'Bookmarks');
  if (bmSpec) bmSpec.label = 'BM';

  const stashSpec = take('S') || {
    label: "S",
    title: "Look up scene data and timestamps",
    color: "#6c5ce7",
    onClick: (e) => {
      e.stopPropagation();
      if (typeof window.showStashModal === 'function') {
        window.showStashModal(video);
      }
    }
  };

  const renameSpec = take('R') || {
    onClick: async (e) => {
      e.stopPropagation();
      if (typeof window.showRenameModal === 'function') {
        await window.showRenameModal(video);
      }
    }
  };
  Object.assign(renameSpec, { label: 'R', title: 'Rename', color: '#795548' });

  if (basketSpec) buttons.unshift(basketSpec);
  const starAt = buttons.findIndex(b => b && b.label === '★');
  const row = [stashSpec].concat(bmSpec ? [bmSpec] : [], [renameSpec]);
  buttons.splice(starAt >= 0 ? starAt + 1 : buttons.length, 0, ...row);

  return { buttons, playSpec };
}

function scrayListPlayedAt(ms) {
  if (!ms) return '—';
  const d = new Date(ms);
  if (isNaN(d)) return '—';
  return d.toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

/**
 * Build the open half of a row, once. Returns the button spec array, which
 * the context menu needs whether or not the row is showing.
 */
function ensureListRowDetail(li) {
  if (li._scrayButtons) return li._scrayButtons;

  const video = li._scrayVideo;
  const cfg = li._scrayCfg || {};
  const terms = (window.currentSearchTerms && window.currentSearchTerms.length) ? window.currentSearchTerms : null;

  const detail = document.createElement('div');
  detail.className = 'lc-detail';
  detail.hidden = true;

  const lineOf = (cls) => {
    const d = document.createElement('div');
    d.className = 'lc-d-line ' + cls;
    return d;
  };

  // 1 · Where it lives. Through createClickablePath so the folder crumbs keep
  // their filter / search / exclude modal - handed a copy whose key no
  // StashDB row can have, or a matched video would print its scene name here
  // instead of its path. The key is only used for that lookup; nothing is
  // written back.
  const pathLine = lineOf('lc-d-path');
  pathLine.appendChild(createClickablePath({ ...video, videoKey: '~no stash match~' }, false, true));
  if (pathLine.childNodes.length) detail.appendChild(pathLine);

  // 2 · The scene name, where StashDB has one. A copy with no path this time,
  // so a studio-only match prints just its studio rather than repeating line 1.
  if (window.scrayStashNamePlan && window.scrayStashNamePlan(video)) {
    const sceneLine = lineOf('lc-d-scene');
    sceneLine.appendChild(createClickablePath({ ...video, path: '', cataloguePath: '' }, false, true));
    if (sceneLine.childNodes.length) detail.appendChild(sceneLine);
  }

  // 3 · filename [score] (size, duration)
  const fileLine = lineOf('lc-d-file');
  const fname = document.createElement('span');
  fname.className = 'lc-d-filename';
  if ((video.filename || '').split('.').pop().toLowerCase() !== 'mp4') fname.classList.add('lc-non-mp4');
  if (window.scrayIsOffline && window.scrayIsOffline(video)) fname.classList.add('scray-offline-title');
  fname.appendChild(createClickableFilename(video.filename));
  fileLine.appendChild(fname);

  const scoreBadge = document.createElement('span');
  scoreBadge.className = 'lc-d-score';
  setDetailScore(scoreBadge, scrayListScore(video));
  fileLine.appendChild(scoreBadge);

  if (video.inCatalogue === false && typeof window.scrayTryFingerprintMatch === 'function') {
    const warn = document.createElement('span');
    warn.className = 'not-in-catalogue-badge';
    warn.textContent = '⚠';
    warn.title = 'Not in the SQLite catalogue — tap to check for a match';
    warn.style.cursor = 'pointer';
    warn.style.padding = '0 6px';
    warn.onclick = (e) => { e.stopPropagation(); window.scrayTryFingerprintMatch(video, warn); };
    fileLine.appendChild(warn);
  }

  if (!scrayListIsYetToUpload(video)) {
    const sizeDur = document.createElement('span');
    sizeDur.className = 'lc-d-sizedur';
    const dur = window.scrayDisplayDurationMs ? window.scrayDisplayDurationMs(video) : video.durationMs;
    sizeDur.textContent = ` (${formatFileSize(video.sizeBytes)}, ${formatDuration(dur)})`;
    fileLine.appendChild(sizeDur);
  }
  detail.appendChild(fileLine);

  // 4 · History. A history row's "Played" is when THAT entry was played, to
  // the minute - the time the old history row printed - rather than the
  // catalogue's last_played, which may be a later play somewhere else.
  const stats = lineOf('lc-d-stats');
  stats.textContent = [
    `Views ${video.view_count ?? 0}`,
    `Watched ${scrayListWatched(video.time_viewed)}`,
    cfg.playedAt !== undefined
      ? `Played ${scrayListPlayedAt(cfg.playedAt)}`
      : `Played ${scrayListDate(video.last_played)}`,
    `Created ${scrayListDate(video.createdDateTime)}`
  ].join('  ·  ');
  detail.appendChild(stats);

  if (terms) {
    detail.querySelectorAll('.lc-d-path, .lc-d-scene, .lc-d-filename')
      .forEach(el => applyHighlightingToElement(el, terms));
  }

  // 5 · Buttons: that list's own actions in the shared layout, visible up to
  // and including R. The basket has no B, so one fewer.
  const raw = typeof cfg.buttons === 'function' ? cfg.buttons() : [];
  const { buttons, playSpec } = scrayArrangeOpenRowButtons(raw, video);
  const visible = buttons.findIndex(b => b && b.label === 'R') + 1 || 6;
  detail.appendChild(createCompactButtonGroup(buttons, visible, video));

  // Tapping the open row's text plays it, through the P button's own handler
  // (held back from the row above) so it plays exactly what P would. Only the
  // text lines count - a thumb landing in the padding under the buttons
  // shouldn't start a video. Buttons and tags (underlined, and they stop
  // propagation anyway) don't.
  detail.addEventListener('click', (e) => {
    if (!e.target.closest('.lc-d-line')) return;
    if (e.target.closest('button')) return;
    if (e.target.style && e.target.style.textDecoration === 'underline') return;
    if (playSpec && playSpec.onClick) playSpec.onClick(e);
  });

  li.appendChild(detail);
  li._scrayButtons = buttons;
  return buttons;
}

function setListRowOpen(li, open) {
  if (open) ensureListRowDetail(li);
  const detail = li.querySelector(':scope > .lc-detail');
  if (detail) detail.hidden = !open;
  li.classList.toggle('lc-open', open);
  const rows = scrayOpenRowsFor((li._scrayCfg && li._scrayCfg.list) || 'main');
  if (open) rows.add(li._scrayRowKey); else rows.delete(li._scrayRowKey);
}

function toggleListRow(li) {
  const opening = !li.classList.contains('lc-open');
  // Closing a taller row ABOVE this one would pull the row you just tapped
  // up the screen, out from under your finger. Measure, change, then scroll
  // by whatever it moved - the page for the main and random lists, the
  // panel's own list for history and the basket.
  const before = li.getBoundingClientRect().top;

  if (opening && SCRAY_LIST_ONE_OPEN && li.parentElement) {
    li.parentElement.querySelectorAll(':scope > li.lc-open').forEach(other => {
      if (other !== li) setListRowOpen(other, false);
    });
    scrayOpenRowsFor((li._scrayCfg && li._scrayCfg.list) || 'main').clear();
  }
  setListRowOpen(li, opening);

  const moved = li.getBoundingClientRect().top - before;
  if (!moved) return;
  const scroller = li.parentElement;
  if (scroller && /(auto|scroll)/.test(getComputedStyle(scroller).overflowY) &&
      scroller.scrollHeight > scroller.clientHeight) {
    scroller.scrollTop += moved;
  } else {
    window.scrollBy(0, moved);
  }
}

/**
 * patchScoreInLists hands these rows here: the score is a column and a
 * badge on the open line, not the single badge span the old rows had.
 */
window.scrayListRowSetScore = function (li, score) {
  const s = (score === undefined || score === '') ? null : score;
  const cellEl = li.querySelector('.lc-score');
  if (cellEl) {
    cellEl.textContent = scrayListScoreText(s);
    cellEl.classList.toggle('lc-blank', s == null);
  }
  const badge = li.querySelector('.lc-d-score');
  if (badge) setDetailScore(badge, s);
};

/** Redraw just the main header - the sort buttons call this when there is no list to re-render. */
window.scrayRefreshMainListHeader = function () {
  const container = document.getElementById('taggedVideosContainer');
  const old = container && container.querySelector(':scope > .lc-head');
  if (old) old.replaceWith(buildListHeader('main'));
};


/**
* Render a list of videos into a given container.
*
* #playlist - the random list - draws column rows. Any other container keeps
* buildVideoRow's old row.
*/
function renderVideoList(videos, containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';

  const columns = containerId === 'playlist';
  if (columns) ensureListHeader(container, 'random');

  videos.forEach((video, index) => {
    container.appendChild(columns
      ? scrayBuildListRow(video, index, {
          list: 'random',
          buttons: () => buildVideoRowButtons(video, 'random', index)
        })
      : buildVideoRow(video, 'random', index));
  });

  updateBasketHighlights();
}
window.renderVideoList = renderVideoList;

/**
* Append a chunk of videos to an existing container (for pagination).
*
* The global index is snapshotted per row rather than read at click time:
* paginationState.currentEndIndex keeps moving as further chunks load, so a
* lazily-read index was stale for every row except the newest chunk.
*/
function appendVideoList(videos, containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  // The main list is the column layout; anything else handed here keeps the
  // old row. The header is re-added whenever the container has been cleared.
  const columns = containerId === 'taggedVideosContainer';
  if (columns) ensureListHeader(container, 'main');

  videos.forEach((video, index) => {
    const globalIndex = paginationState.currentEndIndex + index;
    container.appendChild(columns
      ? scrayBuildListRow(video, globalIndex, {
          list: 'main',
          buttons: () => buildVideoRowButtons(video, 'main', globalIndex)
        })
      : buildVideoRow(video, 'main', globalIndex));
  });

  updateBasketHighlights();
}
window.appendVideoList = appendVideoList;

// Export for global use
window.updateBasketHighlights = updateBasketHighlights;

/**
* Highlight search terms in text content
* @param {string} text - Original text
* @param {Array<string>} searchTerms - Terms to highlight
* @returns {DocumentFragment} - Fragment with highlighted spans
*/
function highlightSearchTerms(text, searchTerms) {
  const fragment = document.createDocumentFragment();
  
  if (!text || !searchTerms || searchTerms.length === 0) {
      fragment.appendChild(document.createTextNode(text || ''));
      return fragment;
  }
  
  // Create regex pattern to match any search term (case insensitive)
  const pattern = searchTerms
      .filter(term => term.length > 0)
      .map(term => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) // Escape special chars
      .join('|');
  
  if (!pattern) {
      fragment.appendChild(document.createTextNode(text));
      return fragment;
  }
  
  const regex = new RegExp(`(${pattern})`, 'gi');
  const parts = text.split(regex);
  
  parts.forEach(part => {
      if (regex.test(part)) {
          // This is a match - wrap in highlight span
          const highlight = document.createElement('span');
          highlight.textContent = part;
          highlight.style.background = '#ffeb3b';
          highlight.style.fontWeight = 'bold';
          highlight.style.padding = '0 2px';
          highlight.style.borderRadius = '2px';
          fragment.appendChild(highlight);
          regex.lastIndex = 0; // Reset regex
      } else if (part) {
          // Regular text
          fragment.appendChild(document.createTextNode(part));
      }
  });
  
  return fragment;
}

/**
* Apply highlighting to all text nodes within an element (recursive)
* @param {Element} element - Element to process
* @param {Array<string>} searchTerms - Terms to highlight
*/
function applyHighlightingToElement(element, searchTerms) {
   if (!element || !searchTerms || searchTerms.length === 0) return;
   
   // Create a TreeWalker to find all text nodes
   const walker = document.createTreeWalker(
       element,
       NodeFilter.SHOW_TEXT,
       null,
       false
   );
   
   const textNodes = [];
   let node;
   while (node = walker.nextNode()) {
       // Skip if parent is already a highlight span
       if (node.parentElement && node.parentElement.style.background === 'rgb(255, 235, 59)') {
           continue;
       }
       textNodes.push(node);
   }
   
   // Process each text node
   textNodes.forEach(textNode => {
       const text = textNode.textContent;
       if (!text || !text.trim()) return;
       
       // Check if any search term matches
       const pattern = searchTerms
           .filter(term => term.length > 0)
           .map(term => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
           .join('|');
       
       if (!pattern) return;
       
       const regex = new RegExp(`(${pattern})`, 'gi');
       
       if (!regex.test(text)) return;
       regex.lastIndex = 0; // Reset for split
       
       // Split and create highlighted spans
       const parts = text.split(regex);
       const fragment = document.createDocumentFragment();
       
       parts.forEach(part => {
           if (regex.test(part)) {
               const highlight = document.createElement('span');
               highlight.textContent = part;
               highlight.style.background = '#ffeb3b';
               highlight.style.fontWeight = 'bold';
               highlight.style.padding = '0 2px';
               highlight.style.borderRadius = '2px';
               fragment.appendChild(highlight);
               regex.lastIndex = 0;
           } else if (part) {
               fragment.appendChild(document.createTextNode(part));
           }
       });
       
       // Replace original text node with highlighted version
       textNode.parentNode.replaceChild(fragment, textNode);
   });
}

// Export globally
window.highlightSearchTerms = highlightSearchTerms;
window.applyHighlightingToElement = applyHighlightingToElement;
window.currentSearchTerms = []; // Track current search for highlighting

/**
 * Manual fallback for the ⚠ badge: look the file up by size and, on
 * confirmation, adopt the catalogue's key locally. Top-level on purpose —
 * both list renderers reference it, and defining it inside one of them left
 * it undefined depending on which list drew first.
 */
window.scrayTryFingerprintMatch = async function (video, badgeEl) {
  console.log("[fp] badge tapped", { file: video.filename, size: video.sizeBytes });
  if (!video.sizeBytes) { alert("No file size known for this video — can't look up a match."); return; }
  const original = badgeEl.textContent;
  badgeEl.textContent = "…";
  try {
    const res = await window.scrayApiCall("fingerprint_lookup", {
      method: "POST",
      body: { size: video.sizeBytes, duration_ms: video.durationMs, width: video.width, height: video.height }
    });
    const candidates = res.candidates || [];
    console.log(`[fp] ${candidates.length} candidate(s)`, candidates.map(c => c.video_key));
    if (!candidates.length) { alert(`No catalogue entry has this file's size (${video.sizeBytes} bytes).`); return; }
    const best = candidates.length === 1
      ? candidates[0]
      : (candidates.find(c => c.corroborated) || candidates[0]);
    const extra = candidates.length > 1
      ? `\n\n(${candidates.length - 1} other size match(es) found — check Picker's Duplicates panel if this isn't right.)`
      : "";
    if (!confirm(`Found a likely match in the catalogue:\n\n"${best.video_key}"\n\nAdopt its score, view count and bookmarks?${extra}`)) return;

    // Adopt the catalogue's key locally — never move the server row onto this
    // device's filename, or Picker's next push/scan mints a duplicate.
    const newKey = best.video_key;
    const localId = video.oneDriveId ?? video.idFromAPI ?? null;
    if (localId) {
      const db = await openDB();
      const tx = db.transaction(STORE_NAME, "readwrite");
      const row = await new Promise((r2) => {
        const r = tx.objectStore(STORE_NAME).get(localId);
        r.onsuccess = () => r2(r.result); r.onerror = () => r2(null);
      });
      if (row) tx.objectStore(STORE_NAME).put({ ...row, videoKey: newKey, inCatalogue: true });
      await new Promise((r2, rej) => { tx.oncomplete = r2; tx.onerror = () => rej(tx.error); });
      video.videoKey = newKey;
    }
    alert("Matched — sync or reload to pull its score and bookmarks.");
  } catch (err) {
    console.error("[fp] lookup failed", err);
    alert(`Lookup failed: ${err.message}`);
  } finally {
    badgeEl.textContent = original;
  }
};
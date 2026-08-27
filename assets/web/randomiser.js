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
// ✅ NEW: Add sort states for created and modified dates
// ⚙️ DEFAULT SORT ON BOOT/REFRESH: newest created first. Set back to 'none'
// for the old unsorted default, or 'asc' for oldest first.
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

/**
* Toggle sort state and re-render list
*/
function toggleSortState() {
const states = ['none', 'asc', 'desc'];
const currentIndex = states.indexOf(currentSortState);
currentSortState = states[(currentIndex + 1) % states.length];

// ✅ Reset other sorts when size sort is activated
currentCreatedSortState = 'none';
currentModifiedSortState = 'none';
currentFilenameSortState = 'none';
currentScoreSortState = 'none';
updateCreatedSortButton();
updateModifiedSortButton();
updateFilenameSortButton();
updateScoreSortButton();
updateSortButton();

// ✅ Update panel button too
if (typeof updatePanelSortButton === 'function') {
  updatePanelSortButton('panelSortSizeBtn', currentSortState);
}
  
  // Re-render current list with new sort
  if (paginationState.allVideos && paginationState.allVideos.length > 0) {
      const sorted = sortVideosBySize(paginationState.allVideos, currentSortState);
      paginationState.allVideos = sorted;
      paginationState.currentEndIndex = 0;
      
      const container = document.getElementById(paginationState.containerId);
      container.innerHTML = "";
      renderNextChunk(firstChunk);
  }
}

// ✅ NEW: Toggle created date sort state and re-render list
function toggleCreatedSortState() {
const states = ['none', 'asc', 'desc'];
const currentIndex = states.indexOf(currentCreatedSortState);
currentCreatedSortState = states[(currentIndex + 1) % states.length];

// Reset other sorts
currentSortState = 'none';
currentModifiedSortState = 'none';
currentFilenameSortState = 'none';
currentScoreSortState = 'none';
updateSortButton();
updateModifiedSortButton();
updateFilenameSortButton();
updateScoreSortButton();
updateCreatedSortButton();

// ✅ Update panel button too
if (typeof updatePanelSortButton === 'function') {
  updatePanelSortButton('panelSortCreatedBtn', currentCreatedSortState);
}
 
 // Re-render current list with new sort
 if (paginationState.allVideos && paginationState.allVideos.length > 0) {
      const sorted = sortVideosByCreated(paginationState.allVideos, currentCreatedSortState);
      paginationState.allVideos = sorted;
      paginationState.currentEndIndex = 0;
      
      const container = document.getElementById(paginationState.containerId);
      container.innerHTML = "";
      renderNextChunk(firstChunk);
  }
}

// ✅ NEW: Toggle modified date sort state and re-render list
function toggleModifiedSortState() {
const states = ['none', 'asc', 'desc'];
const currentIndex = states.indexOf(currentModifiedSortState);
currentModifiedSortState = states[(currentIndex + 1) % states.length];

// Reset other sorts
currentSortState = 'none';
currentCreatedSortState = 'none';
currentFilenameSortState = 'none';
currentScoreSortState = 'none';
updateSortButton();
updateCreatedSortButton();
updateFilenameSortButton();
updateScoreSortButton();
updateModifiedSortButton();

// ✅ Update panel button too
if (typeof updatePanelSortButton === 'function') {
  updatePanelSortButton('panelSortModifiedBtn', currentModifiedSortState);
}
 
 // Re-render current list with new sort
 if (paginationState.allVideos && paginationState.allVideos.length > 0) {
      const sorted = sortVideosByModified(paginationState.allVideos, currentModifiedSortState);
      paginationState.allVideos = sorted;
      paginationState.currentEndIndex = 0;
      
      const container = document.getElementById(paginationState.containerId);
      container.innerHTML = "";
      renderNextChunk(firstChunk);
  }
}

/**
* Update sort button appearance
*/
function updateSortButton() {
 const btn = document.getElementById('sortSizeBtn');
 if (!btn) return;
 
 const labels = {
     'none': 'Size',
     'asc': 'Size ↑',
     'desc': 'Size ↓'
 };
  
  btn.textContent = labels[currentSortState];
  btn.dataset.sortState = currentSortState;
  
  if (currentSortState === 'none') {
      btn.style.background = '#555';
  } else {
      btn.style.background = '#007bff';
  }
}

// ✅ NEW: Update created sort button appearance
function updateCreatedSortButton() {
 const btn = document.getElementById('sortCreatedBtn');
 if (!btn) return;
 
 const labels = {
     'none': 'Create',
     'asc': 'Create ↑',
     'desc': 'Create ↓'
 };
  
  btn.textContent = labels[currentCreatedSortState];
  btn.dataset.sortState = currentCreatedSortState;
  
  if (currentCreatedSortState === 'none') {
      btn.style.background = '#555';
  } else {
      btn.style.background = '#007bff';
  }
}

// ✅ NEW: Update modified sort button appearance
function updateModifiedSortButton() {
const btn = document.getElementById('sortModifiedBtn');
if (!btn) return;

const labels = {
    'none': 'Mod',
    'asc': 'Mod ↑',
    'desc': 'Mod ↓'
};
 
 btn.textContent = labels[currentModifiedSortState];
 btn.dataset.sortState = currentModifiedSortState;
 
 if (currentModifiedSortState === 'none') {
     btn.style.background = '#555';
 } else {
     btn.style.background = '#007bff';
 }
}

// ✅ NEW: Toggle filename sort state and re-render list
function toggleFilenameSortState() {
const states = ['none', 'asc', 'desc'];
const currentIndex = states.indexOf(currentFilenameSortState);
currentFilenameSortState = states[(currentIndex + 1) % states.length];

// Reset other sorts
currentSortState = 'none';
currentCreatedSortState = 'none';
currentModifiedSortState = 'none';
currentScoreSortState = 'none';
updateSortButton();
updateCreatedSortButton();
updateModifiedSortButton();
updateScoreSortButton();
updateFilenameSortButton();

// ✅ Update panel button too
if (typeof updatePanelSortButton === 'function') {
  updatePanelSortButton('panelSortFilenameBtn', currentFilenameSortState);
}

// Re-render current list with new sort
if (paginationState.allVideos && paginationState.allVideos.length > 0) {
     const sorted = sortVideosByFilename(paginationState.allVideos, currentFilenameSortState);
     paginationState.allVideos = sorted;
     paginationState.currentEndIndex = 0;
     
     const container = document.getElementById(paginationState.containerId);
     container.innerHTML = "";
     renderNextChunk(firstChunk);
 }
}

// ✅ NEW: Update filename sort button appearance
function updateFilenameSortButton() {
const btn = document.getElementById('sortFilenameBtn');
if (!btn) return;

const labels = {
    'none': 'File',
    'asc': 'File ↑',
    'desc': 'File ↓'
};

btn.textContent = labels[currentFilenameSortState];
btn.dataset.sortState = currentFilenameSortState;

if (currentFilenameSortState === 'none') {
    btn.style.background = '#555';
} else {
    btn.style.background = '#007bff';
}
}

// ✅ NEW: Toggle score sort state and re-render list
function toggleScoreSortState() {
const states = ['none', 'asc', 'desc'];
const currentIndex = states.indexOf(currentScoreSortState);
currentScoreSortState = states[(currentIndex + 1) % states.length];

// Reset other sorts
currentSortState = 'none';
currentCreatedSortState = 'none';
currentModifiedSortState = 'none';
currentFilenameSortState = 'none';
updateSortButton();
updateCreatedSortButton();
updateModifiedSortButton();
updateFilenameSortButton();
updateScoreSortButton();

// ✅ Update panel button too
if (typeof updatePanelSortButton === 'function') {
 updatePanelSortButton('panelSortScoreBtn', currentScoreSortState);
}

// Re-render current list with new sort
if (paginationState.allVideos && paginationState.allVideos.length > 0) {
    const sorted = sortVideosByScore(paginationState.allVideos, currentScoreSortState);
    paginationState.allVideos = sorted;
    paginationState.currentEndIndex = 0;
    
    const container = document.getElementById(paginationState.containerId);
    container.innerHTML = "";
    renderNextChunk(firstChunk);
}
}

// ✅ NEW: Update score sort button appearance
function updateScoreSortButton() {
const btn = document.getElementById('sortScoreBtn');
if (!btn) return;

const labels = {
    'none': 'Score',
    'asc': 'Score ↑',
    'desc': 'Score ↓'
};

btn.textContent = labels[currentScoreSortState];
btn.dataset.sortState = currentScoreSortState;

if (currentScoreSortState === 'none') {
    btn.style.background = '#555';
} else {
    btn.style.background = '#007bff';
}
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
   const excludeTags = $('#excludeTagSelect').val() || [];
   
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
   
   const grid = document.createElement('div');
   grid.className = 'tag-selection-grid';
   
   excludeTags.forEach(tag => {
       const pill = document.createElement('div');
       pill.className = 'tag-selection-item tag-selection-item-exclude';
       pill.textContent = tag;
       pill.title = `Click to remove "${tag}" from excludes`;
       
       pill.addEventListener('click', () => {
           // Remove from exclude dropdown
           const currentExcludes = $('#excludeTagSelect').val() || [];
           $('#excludeTagSelect').val(currentExcludes.filter(t => t !== tag)).trigger('change');
           
           // Visual feedback
           pill.style.background = '#28a745';
           pill.textContent = `${tag} ✓`;
           
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
clearAllBtn.textContent = 'Clear All';
clearAllBtn.addEventListener('click', () => {
    // Clear all exclude tags
    $('#excludeTagSelect').val([]).trigger('change');
    
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
      document.body.removeChild(overlay);
      document.removeEventListener('keydown', excludeTagEscHandler);
  }
};
document.addEventListener('keydown', excludeTagEscHandler);

document.body.appendChild(overlay);
}

// Export the new function
window.showExcludeTagsModal = showExcludeTagsModal;

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
    document.addEventListener('keydown', escHandler);
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

    // Trigger filter refresh
    if (typeof filterDisplayedByFilename === 'function') {
        filterDisplayedByFilename();
    }
};

function updateFloatingTagPillsFromCommon() {
const container = document.getElementById("floatingTagPillsBar");
if (!container) return;
container.innerHTML = '';

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

// ✅ Search filter pill - PINK (only shown when search is active)
const searchBox = document.getElementById("filenameSearchBox");
const searchText = searchBox?.value.trim() || '';
if (searchText.length > 0) {
const searchPill = document.createElement("span");
searchPill.className = "floating-tag-pill floating-tag-search";
searchPill.textContent = `🔍 ${searchText}`;
searchPill.title = "Tap to edit";
searchPill.addEventListener("click", (e) => {
e.stopPropagation();

// ✅ Tapping the pill immediately activates Edit (no more E/C choice popup)
// ✅ Custom focus logic (NOT the jumpSearchBtn path) - deliberately
// avoids calling .select(), which would highlight all existing text
// and cause the next keystroke to wipe it out instead of appending.
// Places the cursor at the end of the existing text instead, so
// typing continues/adds onto the current search term.
const isLandscape = window.matchMedia('(orientation: landscape)').matches;
const isMobile = window.innerWidth <= 1024;

if (isLandscape && isMobile) {
    const panelSearchBox = document.getElementById("panelSearchBox");
    if (panelSearchBox) {
        panelSearchBox.focus();
        panelSearchBox.click();
        setTimeout(() => {
            const len = panelSearchBox.value.length;
            panelSearchBox.setSelectionRange(len, len);
        }, 50);
    }
    if (typeof window.toggleRandomPlaylistPanel === 'function') {
        const panel = document.getElementById("randomPlaylistPanel");
        if (panel && !panel.classList.contains("random-panel-open")) {
            window.toggleRandomPlaylistPanel(true);
        }
    }
    if (typeof filterDisplayedByFilename === 'function') {
        window.skipSearchScroll = true;
        filterDisplayedByFilename();
    }
} else {
    const searchBox = document.getElementById("filenameSearchBox");
    if (searchBox) {
        const isMobilePortrait = window.innerWidth <= 768 && window.matchMedia('(orientation: portrait)').matches;
        if (!isMobilePortrait && typeof scrollToSearchBox === 'function') {
            scrollToSearchBox(searchBox);
        }
        searchBox.focus({ preventScroll: true });
        setTimeout(() => {
            const len = searchBox.value.length;
            searchBox.setSelectionRange(len, len);
        }, 50);
    }
}

// The popup itself is created by ensureSearchPillPopup, which the keyboard
// state handlers also call. Calling it here covers the case where the
// keyboard was already open before the pill was tapped.


});

// The bin is a CHILD of the pill, not a fixed element positioned against it.
//
// The previous approach measured the pill with getBoundingClientRect and set
// fixed coordinates - but the pills bar is simultaneously being moved by CSS
// (bottom: var(--keyboard-offset) plus a translateY) while iOS resizes the
// visual viewport, and the bar rebuilds itself on every keystroke. Any frame
// that measured mid-move produced a bad number and the bin shot to the top
// of the screen.
//
// As a child, the browser positions it. No measuring, no rAF loop, no
// viewport maths, and it moves with the pill for free.
const searchWrap = document.createElement("span");
searchWrap.className = "floating-tag-search-wrap";
searchWrap.appendChild(searchPill);

const binBtn = document.createElement("button");
binBtn.className = "search-pill-bin";
binBtn.textContent = '🗑️';
binBtn.title = 'Clear search';
// preventDefault on the press stops the button stealing focus - otherwise
// the search box blurs, the keyboard closes, and the CSS hides the bin
// before the tap resolves.
//
// But on iOS, preventDefault on touchstart also cancels the whole
// synthesized mouse sequence, click included. So the action runs on
// touchend instead. touchend still fires even though the default was
// prevented: the touch target is fixed at touchstart and doesn't change
// if the element is hidden or moved mid-gesture.
binBtn.addEventListener('mousedown', (ev) => ev.preventDefault());
binBtn.addEventListener('touchstart', (ev) => ev.preventDefault(), { passive: false });

let binFiring = false;
const clearFromBin = (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    // On desktop only click fires; on iOS only touchend. Guard anyway so a
    // browser that delivers both can't clear twice.
    if (binFiring) return;
    binFiring = true;
    setTimeout(() => { binFiring = false; }, 400);
    window.clearSearchPillFilter?.(ev);
};

binBtn.addEventListener('touchend', clearFromBin, { passive: false });
binBtn.addEventListener('click', clearFromBin);
searchWrap.appendChild(binBtn);

container.appendChild(searchWrap);
}

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
   sel.on('change', function () {
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
select.on('change', function () {
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
 document.addEventListener('keydown', escapeHandler);
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
 
 // Refresh filters when selection changes
 select.on('change', function() {
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

// Filter by include tags, if any
if (includeAll.length > 0) {
   videos = videos.filter(rec => Array.isArray(rec.tags) && rec.tags.some(t => includeAll.includes(t)));
}

// Filter by exclude tags, if passed
if (Array.isArray(excludeTags) && excludeTags.length > 0) {
   videos = videos.filter(rec => !(Array.isArray(rec.tags) && rec.tags.some(t => excludeTags.includes(t))));
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
const haystack = `${video.filename} ${video.cataloguePath || ''} ${video.path}`.toLowerCase();

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
async function filterDisplayedByFilename() {
const searchEl = document.getElementById("filenameSearchBox");
const searchText = searchEl.value.trim();

const includeTags = $('#tagFilterSelect').val() || [];
const excludeTags = $('#excludeTagSelect').val() || [];
const minDurationMs = getDurationMsFromInputs("minMinutes", "minSeconds");
const maxDurationMs = getDurationMsFromInputs("maxMinutes", "maxSeconds");

let videos = await getFilteredVideos(includeTags, excludeTags, minDurationMs, maxDurationMs);

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
   const hasIncludeTags = window.commonSelectedTags.size > 0;
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

if (!window.skipSearchScroll) {
const searchBar = document.getElementById("filenameSearchBox");
if (searchBar) {
searchBar.scrollIntoView({ behavior: "smooth", block: "start" });
}
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

// Also clear the global common tags set
if (window.commonSelectedTags) {
  window.commonSelectedTags.clear();
}

// Reset all filters – clear level-based include dropdowns
$('#tagFilterLevel1Select').val(null).trigger('change');
$('#tagFilterLevel2Select').val(null).trigger('change');
$('#tagFilterLevel3Select').val(null).trigger('change');
$('#tagFilterAllSelect').val(null).trigger('change');

// Clear exclude tags dropdown
$('#excludeTagSelect').val(null).trigger('change');

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

// ✅ Apply current sort state - check all five sort types
let sortedVideos = videos;
if (currentSortState !== 'none') {
  sortedVideos = sortVideosBySize(videos, currentSortState);
} else if (currentCreatedSortState !== 'none') {
  sortedVideos = sortVideosByCreated(videos, currentCreatedSortState);
} else if (currentModifiedSortState !== 'none') {
  sortedVideos = sortVideosByModified(videos, currentModifiedSortState);
} else if (currentFilenameSortState !== 'none') {
  sortedVideos = sortVideosByFilename(videos, currentFilenameSortState);
} else if (currentScoreSortState !== 'none') {
  sortedVideos = sortVideosByScore(videos, currentScoreSortState);
}

// The reset to 25 is right for a genuine filter/search change and wrong for
// a plain refresh - same function serves both, which is why the list
// collapsed after every score, delete or sync pull. Render the first chunk
// at the depth the list was already showing instead.
const keepDepth = !!window.scrayKeepListDepth;
const prevDepth = keepDepth ? (paginationState.currentEndIndex || 0) : 0;
window.scrayKeepListDepth = false;
const firstChunk = Math.max(25, Math.min(prevDepth, sortedVideos.length));
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

function renderNextChunk(amount = null) {
const increment = amount ?? paginationState.pageSize;
const nextEnd = Math.min(
  paginationState.currentEndIndex + increment,
  paginationState.allVideos.length
);

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
     const haystack = `${video.filename} ${video.cataloguePath || ''} ${video.path}`.toLowerCase();
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
 const searchBar = document.getElementById("filenameSearchBox");
 if (searchBar) {
   searchBar.scrollIntoView({ behavior: "smooth", block: "start" });
 }
}
}

/* =========================================
Video Stats Updater
========================================= */

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
   statsDiv.textContent = `Items: ${totalCount} | Total size: ${formatFileSize(totalSize)}`;
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

const sortBtn = document.getElementById('sortSizeBtn');
   if (sortBtn) {
       sortBtn.addEventListener('click', toggleSortState);
       updateSortButton();
   }
   
   // ✅ NEW: Add event listeners for created and modified sort buttons
   const sortCreatedBtn = document.getElementById('sortCreatedBtn');
   if (sortCreatedBtn) {
       sortCreatedBtn.addEventListener('click', toggleCreatedSortState);
       updateCreatedSortButton();
   }
   // Mirror the boot default onto the landscape panel's own sort button,
   // which otherwise stays showing a plain "Create" while the list is
   // already sorted newest-first.
   if (typeof updatePanelSortButton === 'function') {
       updatePanelSortButton('panelSortCreatedBtn', currentCreatedSortState);
   }
   
   const sortModifiedBtn = document.getElementById('sortModifiedBtn');
  if (sortModifiedBtn) {
      sortModifiedBtn.addEventListener('click', toggleModifiedSortState);
      updateModifiedSortButton();
  }
  
  // ✅ NEW: Add event listener for filename sort button
 const sortFilenameBtn = document.getElementById('sortFilenameBtn');
 if (sortFilenameBtn) {
     sortFilenameBtn.addEventListener('click', toggleFilenameSortState);
     updateFilenameSortButton();
 }
 
 // ✅ NEW: Add event listener for score sort button
 const sortScoreBtn = document.getElementById('sortScoreBtn');
 if (sortScoreBtn) {
     sortScoreBtn.addEventListener('click', toggleScoreSortState);
     updateScoreSortButton();
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
  
  // Prevent panel from auto-opening in landscape mobile
  window.skipPanelAutoOpen = true;
  // Prevent scroll jump while typing in the filter bar
  window.skipSearchScroll = true;
  filterDisplayedByFilename();
  // Re-apply top-of-page scroll after every keystroke - the list
  // re-render can otherwise shift the page and pull scroll back down
  scrollListIntoViewForFilter();
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

   // On mobile portrait, when the filter bar is focused/typed in (e.g. via
   // the F button), scroll the page so the "+B" add-filtered-to-basket
   // button and sort buttons row sit at the top of the visible screen
   // (above the keyboard), with an adjustable buffer above them.
   function scrollListIntoViewForFilter() {
       const isMobilePortrait = window.innerWidth <= 768 && window.matchMedia('(orientation: portrait)').matches;
       if (!isMobilePortrait) return;
       const scrollToRow = () => {
           const anchorEl = document.getElementById("searchFilterRow");
           if (!anchorEl) return;
           const targetY = anchorEl.getBoundingClientRect().top + window.pageYOffset - MOBILE_FILTER_SCROLL_BUFFER_PX;
           window.scrollTo({ top: Math.max(0, targetY), behavior: "auto" });
       };
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
  const ORIENTATION_CYCLE = [
      { value: "any", label: "Orientation: All" },
      { value: "L",   label: "Orientation: Landscape" },
      { value: "P",   label: "Orientation: Portrait" }
  ];

  window.syncOrientationToggleLabel = function () {
      const sel = document.getElementById("orientationFilter");
      const btn = document.getElementById("orientationToggleBtn");
      if (!sel || !btn) return;
      const entry = ORIENTATION_CYCLE.find(o => o.value === sel.value) || ORIENTATION_CYCLE[0];
      btn.textContent = entry.label;
      btn.style.background = entry.value === "any" ? "#555" : "#007bff";
  };

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
 } else {
   document.documentElement.style.removeProperty('--keyboard-offset');
   document.documentElement.style.removeProperty('--keyboard-scroll-offset');
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
console.log("history.js loaded, version X");

// ===== history.js =====
let   // (P) play link
historyVideos = JSON.parse(localStorage.getItem("scray_history") || "[]");
let selectedHistoryIds = new Set();

// ✅ Export globally IMMEDIATELY
window.historyVideos = historyVideos;
window.selectedHistoryIds = selectedHistoryIds;

// ✅ Generate unique ID for each history entry
function generateHistoryId() {
return `hist-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// Toggle selection for a history item (now using historyId instead of oneDriveId)
function toggleHistorySelection(historyId) {
if (selectedHistoryIds.has(historyId)) {
    selectedHistoryIds.delete(historyId);
} else {
    selectedHistoryIds.add(historyId);
}
renderHistory();
}

// Clear all selections
function clearHistorySelection() {
selectedHistoryIds.clear();
renderHistory();
}

function saveHistory() {
localStorage.setItem("scray_history", JSON.stringify(historyVideos));
window.historyVideos = historyVideos;
}

/**
 * Drop every history entry for a file that no longer exists on the device.
 *
 * Has to live here: historyVideos is a module-level `let` and window.historyVideos
 * is only a mirror of it, so reassigning the mirror from file-operations.js
 * would leave renderHistory() still reading the old array.
 *
 * Returns how many entries went, so the caller can decide whether to repaint.
 */
function removeFromHistoryByVideoId(oneDriveId) {
if (!oneDriveId) return 0;
const before = historyVideos.length;
historyVideos = historyVideos.filter(v => (v.oneDriveId ?? v.idFromAPI) !== oneDriveId);
const removed = before - historyVideos.length;
if (!removed) return 0;

window.historyVideos = historyVideos;
// Positions shifted, so a queued play-through would jump to the wrong item.
if (typeof resetHistoryPlayIndex === "function") resetHistoryPlayIndex();
saveHistory();
if (typeof updateHistoryCount === "function") updateHistoryCount();
return removed;
}
window.removeFromHistoryByVideoId = removeFromHistoryByVideoId;

function updateHistoryCount() {
const countEl = document.getElementById("historyCount");
if (countEl) countEl.textContent = historyVideos.length;
}

// ✅ Update history highlights based on basket contents
function updateHistoryHighlights() {
const allHistoryItems = document.querySelectorAll('#historyList li');
allHistoryItems.forEach(li => {
    const videoIdInLi = li.dataset.videoId;
    if (basketVideos.some(v => v.oneDriveId === videoIdInLi)) {
        li.classList.add('basket-added');
    } else {
        li.classList.remove('basket-added');
    }
});
}

function renderHistory() {
const historyList = document.getElementById("historyList");
if (!historyList) return;
historyList.innerHTML = '';

const totalSize = historyVideos.reduce((acc, v) => acc + (v.sizeBytes || 0), 0);

const totalDiv = document.createElement("div");
totalDiv.className = "history-total-size";
totalDiv.style.fontSize = "0.85rem";
totalDiv.style.padding = "6px";
totalDiv.textContent = `Total size: ${formatFileSize(totalSize)}`;
historyList.appendChild(totalDiv);

historyVideos.forEach((video, idx) => {
const li = document.createElement("li");

const vidId = video.oneDriveId ?? video.idFromAPI ?? null;
li.dataset.videoId = vidId;
li.dataset.historyId = video.historyId;

if (selectedHistoryIds.has(video.historyId)) {
    li.classList.add("history-selected");
}

// ✅ Checkbox on the left
const checkbox = document.createElement("input");
checkbox.type = "checkbox";
checkbox.className = "history-checkbox";
checkbox.checked = selectedHistoryIds.has(video.historyId);
checkbox.style.cursor = "pointer";
checkbox.style.width = "auto";
checkbox.style.flexShrink = "0";

checkbox.addEventListener("click", (e) => {
e.stopPropagation();
toggleHistorySelection(video.historyId);
});

li.appendChild(checkbox);

// ✅ Add item number next to checkbox
const numberSpan = document.createElement("span");
numberSpan.textContent = `${idx + 1}. `;
numberSpan.style.fontSize = "0.65rem";
numberSpan.style.color = "#666";
numberSpan.style.marginLeft = "4px";
numberSpan.style.marginRight = "4px";
numberSpan.style.flexShrink = "0";
numberSpan.style.display = "inline";
li.appendChild(numberSpan);

// ✅ Display path and filename
const filenameSpan = document.createElement("span");
filenameSpan.style.display = "inline";

// ✅ Always show full clickable path (removed landscape exception)
const pathFragment = createClickablePath(video, true);
// Transfer all children to filenameSpan
while (pathFragment.firstChild) {
 filenameSpan.appendChild(pathFragment.firstChild);
}

// Score display (if available from Excel)
const scoreSpan = document.createElement("span");
if (video.user_score !== undefined && video.user_score !== null) {
   scoreSpan.textContent = ` [${video.user_score}]`;
   scoreSpan.style.marginLeft = "4px";
   scoreSpan.style.fontSize = "0.65rem";
   scoreSpan.style.color = "#ff9800";
   scoreSpan.style.fontWeight = "bold";
   scoreSpan.style.display = "inline";
   filenameSpan.appendChild(scoreSpan);
}

filenameSpan.style.fontSize = "0.75rem";

if ((video.filename || '').split('.').pop().toLowerCase() !== 'mp4') {
    // Find and color only the filename part
    const textNodes = Array.from(filenameSpan.childNodes);
    textNodes.forEach(node => {
      if (node.textContent === video.filename) {
        node.style.color = '#be7b7bff';
      }
    });
}

const sizeSpan = document.createElement("span");
if (typeof video.sizeBytes === 'number') {
    sizeSpan.textContent = ` [${formatFileSize(video.sizeBytes)}]`;
    sizeSpan.style.whiteSpace = "nowrap";
    sizeSpan.style.wordBreak = "normal";
    sizeSpan.style.overflowWrap = "normal";
}
sizeSpan.style.fontSize = "0.65rem";
sizeSpan.style.color = "#666";

const timestampSpan = document.createElement("span");
if (video.playedAt) {
    const date = new Date(video.playedAt);
    const timeStr = date.toLocaleString();
    timestampSpan.textContent = ` [${timeStr}]`;
    timestampSpan.style.fontSize = "0.6rem";
    timestampSpan.style.color = "#999";
    timestampSpan.style.marginLeft = "4px";
    timestampSpan.style.whiteSpace = "nowrap";
timestampSpan.style.display = "inline";
}

li.appendChild(filenameSpan);
li.appendChild(sizeSpan);
li.appendChild(timestampSpan);

// ✅ Compact buttons with overflow menu
const buttons = [
{
label: "P",
title: "Play video",
color: "#28a745",
onClick: () => {
  const vid = historyVideos[idx];
  window.inlineVideoPlayer?.play(vid);
  // ✅ Close history panel after playing
  if (typeof toggleHistory === 'function') {
      toggleHistory(false);
  }
}
},
{
  label: "D",
  title: "Download",
  onClick: async () => {
      try {
          let vid = historyVideos[idx];
          vid = await refreshVideoBeforeUse(vid);
          if (vid && vid.downloadUrl) {
              window.location.href = vid.downloadUrl;
          } else {
              showDownloadError("Missing or expired download URL", historyVideos[idx]);
          }
      } catch (err) {
          console.error("Download failed", err);
          showDownloadError(err.message || 'Download failed', historyVideos[idx]);
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
title: "Toggle basket",
color: "#e91e63",
onClick: (e) => {
    e.stopPropagation();
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
        basketVideos.splice(existingIndex, 1);
        saveBasket();
        renderBasket();
    } else {
        addToBasket({ ...video, oneDriveId, driveId });
    }
    updateHistoryHighlights();
    if (window.updateBasketHighlights) window.updateBasketHighlights();
}
},
{
 label: "Move",
 title: "Move file to different folder",
 color: "#9c27b0",
 onClick: async (e) => {
     e.stopPropagation();
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
  disabled: !video.webUrl,
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
   label: "Bookmarks",
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
  onClick: async (e) => {
      e.stopPropagation();
      if (typeof window.showDeleteModal === 'function') {
          await window.showDeleteModal(video);
      }
  }
}
];

const btnContainer = createCompactButtonGroup(buttons, 4);
li.appendChild(btnContainer);

// ✅ Right-click context menu
li.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  showContextMenu(buttons.slice(3), e); // Show overflow menu (buttons after first 3)
});

// ✅ Click anywhere on list item (except buttons, clickable tags, and checkbox) to open rename modal
li.style.cursor = 'pointer';
li.addEventListener('click', async (e) => {
  // Don't trigger if clicking on buttons
  if (e.target.closest('.compact-btn-group')) return;
  if (e.target.closest('button')) return;
  if (e.target.closest('.history-checkbox')) return;
  
  // Don't trigger if clicking on clickable tags (folders or bracket tags)
  if (e.target.style.textDecoration === 'underline') return;
  
  // Open rename modal
  if (typeof window.showRenameModal === 'function') {
      await window.showRenameModal(video);
  }
});

historyList.appendChild(li);
});
updateHistoryCount();
updateHistoryHighlights();
}

// ✅ Allow duplicates BUT NOT consecutive - only add if different from last played
function addToHistory(video) {
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

// ✅ Check if last played video is the same - if so, just update timestamp
if (historyVideos.length > 0) {
    const lastPlayed = historyVideos[0];
    if (lastPlayed.oneDriveId === oneDriveId) {
        // Same video as last time - just update timestamp
        lastPlayed.playedAt = Date.now();
        window.historyVideos = historyVideos;
        saveHistory();
        renderHistory();
        console.log(`Updated timestamp for already-recent video: ${video.filename}`);
        return; // ✅ Don't add duplicate
    }
}

// ✅ Different video - add to beginning with unique ID and timestamp
historyVideos.unshift({ 
    ...video, 
    oneDriveId, 
    driveId,
    historyId: generateHistoryId(), // ✅ Unique ID for this history entry
    playedAt: Date.now()
});


// Keep only last 500 items
if (historyVideos.length > 500) {
historyVideos = historyVideos.slice(0, 500);
}

window.historyVideos = historyVideos;
saveHistory();
renderHistory();
console.log(`Added to history: ${video.filename}`);
}

function toggleHistory(open = null) {
const panel = document.getElementById("historyPanel");
if (!panel) return;
const isOpening = open ?? !panel.classList.contains("history-open");
panel.classList.toggle("history-open", isOpening);
}

function clearHistory() {
historyVideos = [];
window.historyVideos = historyVideos;
resetHistoryPlayIndex(); // ✅ Reset play index when history clears
saveHistory();
renderHistory();
console.log("History cleared");
}

function exportHistorySubsetToCSV(subset) {
if (!subset || !subset.length) {
    alert("No history items to export");
    return;
}

const headers = [
    "history_id", "id", "path", "filename", "web_url", "download_url",
    "size_bytes", "duration_ms", "account_name", "account_key", "tags", "played_at"
];

const rows = subset.map(v => [
    `"${(v.historyId || "").replace(/"/g,'""')}"`, // ✅ Include historyId
    `"${(v.oneDriveId || "").replace(/"/g,'""')}"`,
    `"${(v.path || "").replace(/"/g,'""')}"`,
    `"${(v.filename || "").replace(/"/g,'""')}"`,
    `"${v.webUrl || ""}"`,
    `"${v.downloadUrl || ""}"`,
    v.sizeBytes ?? "",
    v.durationMs ?? "",
    `"${(v.accountName || "").replace(/"/g,'""')}"`,
    `"${(v.accountKey || "").replace(/"/g,'""')}"`,
    `"${(Array.isArray(v.tags) ? v.tags.join(";") : "").replace(/"/g,'""')}"`,
    v.playedAt ? new Date(v.playedAt).toISOString() : ""
]);

const csvContent = [headers, ...rows].map(r => r.join(",")).join("\n");
const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
const url = URL.createObjectURL(blob);

const a = document.createElement("a"); 
a.href = url;
a.download = `history_export_${new Date().toISOString().slice(0,10)}.csv`;
document.body.appendChild(a); 
a.click(); 
document.body.removeChild(a);
}

// =========================================
// PLAY LAST PLAYED VIDEO
// =========================================
function playLastPlayedVideo() {
if (!historyVideos || historyVideos.length === 0) {
alert("History is empty");
return;
}

// Skip the most recent (currently playing) and play the one before it
if (historyVideos.length < 2) {
alert("No previous video in history");
return;
}

const video = historyVideos[1];

console.log(`Replaying previous video: ${video.filename}`);

if (window.inlineVideoPlayer) {
window.inlineVideoPlayer.play(video, 'history', 1);

// Mobile: auto-scroll to player
if (window.innerWidth <= 1024) {
  setTimeout(() => {
    const player = document.getElementById("inlineVideoContainer");
    if (player) {
      player.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, 300);
}
}
}

// =========================================
// PLAY THROUGH HISTORY SEQUENTIALLY
// =========================================
let currentHistoryPlayIndex = 0; // Track position in history

function playHistorySequence() {
if (!historyVideos || historyVideos.length === 0) {
  alert("History is empty");
  return;
}

// Play current video
const video = historyVideos[currentHistoryPlayIndex];

console.log(`Playing history item ${currentHistoryPlayIndex + 1}/${historyVideos.length}: ${video.filename}`);

if (window.inlineVideoPlayer) {
  window.inlineVideoPlayer.play(video, 'history', currentHistoryPlayIndex);
  
  // Mobile: auto-scroll to player
  if (window.innerWidth <= 1024) {
    setTimeout(() => {
      const player = document.getElementById("inlineVideoContainer");
      if (player) {
        player.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 300);
  }
}

// Increment for next play
currentHistoryPlayIndex++;

// Wrap around to start
if (currentHistoryPlayIndex >= historyVideos.length) {
  currentHistoryPlayIndex = 0;
  console.log("Reached end of history - will restart from beginning next time");
}
}

// Reset history play index when history changes
function resetHistoryPlayIndex() {
currentHistoryPlayIndex = 0;
console.log("History play index reset to 0");
}

// ✅ Export all functions
window.addToHistory = addToHistory;
window.toggleHistory = toggleHistory;
window.clearHistory = clearHistory;
window.saveHistory = saveHistory;
window.renderHistory = renderHistory;
window.clearHistorySelection = clearHistorySelection;
window.exportHistorySubsetToCSV = exportHistorySubsetToCSV;
window.toggleHistorySelection = toggleHistorySelection;
window.updateHistoryHighlights = updateHistoryHighlights;
window.playLastPlayedVideo = playLastPlayedVideo;
window.playHistorySequence = playHistorySequence;
window.resetHistoryPlayIndex = resetHistoryPlayIndex;

// =========================================
// TAG BUTTON - Show tags from selected history items
// =========================================
function showHistoryTagSelector() {
const selectedVideos = historyVideos.filter(v => selectedHistoryIds.has(v.historyId));

if (selectedVideos.length === 0) {
  alert("No history items selected");
  return;
}

// Gather all unique tags from selected videos
const tagSet = new Set();
selectedVideos.forEach(video => {
  if (Array.isArray(video.tags)) {
    video.tags.forEach(tag => tagSet.add(tag));
  }
});

const tags = Array.from(tagSet).sort();

if (tags.length === 0) {
  alert("Selected items have no tags");
  return;
}

// Create overlay
const overlay = document.createElement('div');
overlay.className = 'tag-selection-overlay';

const content = document.createElement('div');
content.className = 'tag-selection-content';

const title = document.createElement('h3');
title.textContent = `Tags from ${selectedVideos.length} selected item${selectedVideos.length > 1 ? 's' : ''}`;
content.appendChild(title);

const grid = document.createElement('div');
grid.className = 'tag-selection-grid';

tags.forEach(tag => {
  const pill = document.createElement('div');
  pill.className = 'tag-selection-item';
  pill.textContent = tag;
  pill.title = `Click to filter by "${tag}"`;
  
  pill.addEventListener('click', () => {
    // Add to global selected tags
    window.commonSelectedTags.add(tag);
    
    // Find which dropdown contains this tag and select it
    ['Level1', 'Level2', 'Level3', 'All'].forEach(levelName => {
      const selectId = `tagFilter${levelName}Select`;
      const $select = $(`#${selectId}`);
      
      // Check if this dropdown has this tag as an option
      if ($select.find(`option[value="${tag}"]`).length) {
        const currentVals = $select.val() || [];
        if (!currentVals.includes(tag)) {
          currentVals.push(tag);
          $select.val(currentVals).trigger('change');
        }
      }
    });
    
    // Refresh filters and pills
if (typeof updateFloatingTagPillsFromCommon === 'function') {
  updateFloatingTagPillsFromCommon();
}
window.skipSearchScroll = true;
window.skipPanelAutoOpen = true; // ✅ Prevent panel auto-open
if (typeof filterDisplayedByFilename === 'function') {
  filterDisplayedByFilename();
}
    
    // Visual feedback
    pill.style.background = '#28a745';
    setTimeout(() => {
      pill.style.background = '#007bff';
    }, 200);
  });
  
  grid.appendChild(pill);
});

content.appendChild(grid);

const closeBtn = document.createElement('button');
closeBtn.className = 'tag-selection-close';
closeBtn.textContent = 'Close';
closeBtn.addEventListener('click', () => {
  document.body.removeChild(overlay);
});

content.appendChild(closeBtn);
overlay.appendChild(content);

// Close on background click
overlay.addEventListener('click', (e) => {
if (e.target === overlay) {
  document.body.removeChild(overlay);
}
});

// ESC key to close
const historyTagEscHandler = (e) => {
  if (e.key === 'Escape') {
      document.body.removeChild(overlay);
      document.removeEventListener('keydown', historyTagEscHandler);
  }
};
document.addEventListener('keydown', historyTagEscHandler);

document.body.appendChild(overlay);
}

window.showHistoryTagSelector = showHistoryTagSelector;


window.addEventListener("DOMContentLoaded", () => {
document.getElementById("historyToggleBtn")?.addEventListener("click", () => toggleHistory());

document.getElementById("playHistorySequenceBtn")?.addEventListener("click", () => {
window.lastPlayLabel = 'Last Played';
if (typeof window.playHistorySequence === 'function') {
  window.playHistorySequence();
}
});

document.getElementById("historySelectAllBtn")?.addEventListener("click", () => {
 historyVideos.forEach(v => selectedHistoryIds.add(v.historyId));
 renderHistory();
});

// ✅ Overflow menu button for history
document.getElementById("historyMoreBtn")?.addEventListener("click", (e) => {
   const subset = historyVideos.filter(v => selectedHistoryIds.has(v.historyId));
   
   const actions = [
       {
           label: "CLR - Clear Selection",
           onClick: () => clearHistorySelection()
       },
       {
         label: "REM - Remove Selected",
         onClick: () => {
             if (!selectedHistoryIds.size) {
                 alert("No history items selected to remove");
                 return;
             }
             historyVideos = historyVideos.filter(v => !selectedHistoryIds.has(v.historyId));
             window.historyVideos = historyVideos;
             resetHistoryPlayIndex(); // ✅ Reset play index when history changes
             clearHistorySelection();
             saveHistory();
             renderHistory();
         }
     },
       {
           label: "CSV - Export to CSV",
           onClick: () => {
               if (!subset.length) {
                   alert("No history items selected to export");
                   return;
               }
               exportHistorySubsetToCSV(subset);
           }
       },
       {
           label: "TAG - Filter by Tags",
           onClick: () => showHistoryTagSelector()
       },
       {
           label: "CLR ALL - Clear Entire History",
           color: "#f44336",
           onClick: () => {
               if (confirm("Clear entire history?")) {
                   clearHistory();
               }
           }
       }
   ];
   
   showContextMenu(actions, e);
});

renderHistory();

// Swipe to dismiss (mobile only) - WITH INTERACTIVE ITEM EXCEPTION
if (window.innerWidth < 769) {
let touchStartX = 0;
let touchStartY = 0;
let isSwiping = false;
let isScrolling = false;
let scrollableList = null;
let isInteractiveItem = false; // Track if touch is on interactive element

const historyPanel = document.getElementById("historyPanel");
if (historyPanel) {
    // STEP 1: Capture touches but check if they're on interactive items
    historyPanel.addEventListener("touchstart", e => {
        // Check if touch is on checkbox or button - if so, let it through
        const interactiveEl = e.target.closest('input, button, a, .history-checkbox');
        isInteractiveItem = !!interactiveEl;
        
        if (isInteractiveItem) {
            // Don't interfere with clicks/selections
            return;
        }
        
        e.stopPropagation();
        
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        isSwiping = false;
        isScrolling = false;
        
        // Check if touch started inside scrollable list
        scrollableList = e.target.closest('#historyList');
    }, { passive: false, capture: true });
    
    // STEP 2: Handle touchmove
    historyPanel.addEventListener("touchmove", e => {
        // Skip if interacting with buttons/checkboxes
        if (isInteractiveItem) {
            return;
        }
        
        e.stopPropagation();
        
        const touchCurrentX = e.touches[0].clientX;
        const touchCurrentY = e.touches[0].clientY;
        const deltaX = Math.abs(touchCurrentX - touchStartX);
        const deltaY = Math.abs(touchCurrentY - touchStartY);
        
        // Determine direction on first significant movement
        if (!isSwiping && !isScrolling && (deltaX > 5 || deltaY > 5)) {
            if (deltaX > deltaY) {
                isSwiping = true;
            } else {
                isScrolling = true;
            }
        }
        
        // ALWAYS prevent default UNLESS we're scrolling inside the list
        if (isSwiping || !scrollableList) {
            e.preventDefault();
        }
        
    }, { passive: false, capture: true });
    
    // STEP 3: Handle touchend
    historyPanel.addEventListener("touchend", e => {
        // Skip if interacting with buttons/checkboxes
        if (isInteractiveItem) {
            isInteractiveItem = false;
            return;
        }
        
        e.stopPropagation();
        
        const touchEndX = e.changedTouches[0].clientX;
        
        // Swipe left to close
        if (isSwiping && touchStartX - touchEndX > 50) {
            e.preventDefault();
            historyPanel.classList.remove("history-open");
        }
        
        // Reset
        isSwiping = false;
        isScrolling = false;
        scrollableList = null;
        isInteractiveItem = false;
    }, { passive: false, capture: true });
    
    // STEP 4: Also handle touchcancel
    historyPanel.addEventListener("touchcancel", e => {
        isInteractiveItem = false;
        isSwiping = false;
        isScrolling = false;
        scrollableList = null;
    }, { passive: false, capture: true });
}
}
});

// ✅ Re-render history on orientation change (to update path visibility)
window.addEventListener('orientationchange', () => {
setTimeout(() => {
  if (typeof renderHistory === 'function') {
    renderHistory();
  }
}, 300);
});


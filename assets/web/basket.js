console.log("basket.js loaded, version X");

// ===== basket.js =====
let basketVideos = JSON.parse(localStorage.getItem("scray_basket") || "[]");
let selectedBasketIds = new Set();
let currentBasketPlayIndex = 0; // Track position for "next" button

// ✅ Track if we should sync basket changes to Excel current basket
let autoSyncEnabled = true;
window.autoSyncEnabled = autoSyncEnabled;

// ✅ Export globally IMMEDIATELY
window.basketVideos = basketVideos;
window.selectedBasketIds = selectedBasketIds;
window.currentBasketPlayIndex = currentBasketPlayIndex;

// Toggle selection for a basket item
function toggleBasketSelection(oneDriveId) {
if (selectedBasketIds.has(oneDriveId)) {
    selectedBasketIds.delete(oneDriveId);
} else {
    selectedBasketIds.add(oneDriveId);
}
renderBasket();
}

// Clear all selections
function clearBasketSelection() {
selectedBasketIds.clear();
renderBasket();
}

function saveBasket() {
// ✅ CRITICAL: Sync FROM window.basketVideos first (external code may have updated it)
basketVideos = window.basketVideos;
localStorage.setItem("scray_basket", JSON.stringify(basketVideos));
// window.basketVideos already updated above, no need to reassign

// ✅ Auto-sync DISABLED - user must manually push/pull
// Basket changes are saved locally only until user clicks Push
}

function updateBasketCount() {
 const countEl = document.getElementById("basketCount");
 if (countEl) countEl.textContent = basketVideos.length;
}

function renderBasket() {
basketVideos = window.basketVideos;  //  Sync local variable from window

const basketList = document.getElementById("basketList");
if (!basketList) return;
basketList.innerHTML = '';

// ✅ Update now playing highlight
if (typeof window.updateNowPlayingBasketHighlight === 'function') {
  window.updateNowPlayingBasketHighlight();
}

const totalSize = basketVideos.reduce((acc, v) => acc + (v.sizeBytes || 0), 0);

const totalDiv = document.createElement("div");
totalDiv.className = "basket-total-size";
totalDiv.style.fontSize = "0.85rem";
totalDiv.style.padding = "6px";
totalDiv.style.display = "flex";
totalDiv.style.justifyContent = "space-between";
totalDiv.style.alignItems = "center";

const sizeText = document.createElement("span");
sizeText.textContent = `Total size: ${formatFileSize(totalSize)}`;
totalDiv.appendChild(sizeText);

// ✅ No sync indicator - manual push/pull only

basketList.appendChild(totalDiv);

basketVideos.forEach((video, idx) => {
    const li = document.createElement("li");
    
    // Keep draggable=true on all devices - other code (dragover and the
    // touch-based touchmove handler) both rely on the
    // 'li[draggable="true"]' selector to calculate drop positions, so
    // touch dragging breaks entirely if this is false. Native drag ghost
    // is blocked separately below via a dragstart listener instead.
    li.draggable = true;
    li.dataset.index = idx; 

    if (selectedBasketIds.has(video.oneDriveId)) {
        li.classList.add("basket-selected");
    }

// ✅ Click to toggle selection
li.addEventListener("click", (e) => {
     if (e.target.closest(".compact-btn-group")) return;
     if (e.target.closest("button")) return;
     
     // Toggle selection on click
     toggleBasketSelection(video.oneDriveId);
 });

// ✅ Always show full clickable path with item number
const filenameSpan = document.createElement("span");
filenameSpan.style.fontSize = "0.75rem";
filenameSpan.style.display = "inline";
filenameSpan.style.whiteSpace = "normal";
filenameSpan.style.wordBreak = "break-word";

const numberText = document.createElement("span");
numberText.textContent = `${idx + 1}. `;
numberText.style.fontSize = "0.65rem";
numberText.style.color = "#666";
numberText.style.marginRight = "4px";
numberText.style.display = "inline";
filenameSpan.appendChild(numberText);

const pathFragment = createClickablePath(video, true);
pathFragment.childNodes.forEach(node => {
if (node.nodeType === 1) { // Element node
  node.style.fontSize = "0.75rem";
  // Apply non-MP4 color to filename only
  if (node.textContent === video.filename && 
      (video.filename || '').split('.').pop().toLowerCase() !== 'mp4') {
    node.style.color = '#be7b7bff';
  }
}
});
// Transfer all children from pathFragment to filenameSpan
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

const sizeSpan = document.createElement("span");
  if (typeof video.sizeBytes === 'number') {
       sizeSpan.textContent = ` [${formatFileSize(video.sizeBytes)}]`;
       sizeSpan.style.whiteSpace = "nowrap";
       sizeSpan.style.wordBreak = "normal";
       sizeSpan.style.overflowWrap = "normal";
   }
   sizeSpan.style.fontSize = "0.65rem";
   sizeSpan.style.color = "#666";
   sizeSpan.style.display = "inline";

  li.appendChild(filenameSpan);
  li.appendChild(sizeSpan);

    // ✅ Create compact button group with overflow menu
const buttons = [
 {
 label: "R",
 title: "Rename file",
 color: "#9c27b0",
 onClick: async (e) => {
     e.stopPropagation();
     if (typeof window.showRenameModal === 'function') {
         await window.showRenameModal(video);
     }
 }
},
 {
label: "P",
title: "Play video",
color: "#28a745",
onClick: () => {
const vid = basketVideos[idx];
window.inlineVideoPlayer?.play(vid, 'basket', idx);
// Close basket panel after playing
if (window.innerWidth < 769 && typeof toggleBasket === 'function') {
    toggleBasket(false);
}
}
},
    {
     label: "D",
     title: "Download",
     onClick: async (e) => {
         e.stopPropagation();
          try {
              let vid = basketVideos[idx];
              vid = await refreshVideoBeforeUse(vid);
              if (vid && vid.downloadUrl) {
                  window.location.href = vid.downloadUrl;
              } else {
                  showDownloadError("Missing or expired download URL", basketVideos[idx]);
              }
          } catch (err) {
              console.error("Download failed", err);
              showDownloadError(err.message || 'Download failed', basketVideos[idx]);
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
      onClick: (e) => {
          e.stopPropagation();
          if (video.webUrl) window.open(video.webUrl, '_blank');
      }
  },
  {
   label: "Copy Name",
   title: "Copy filename to clipboard",
   onClick: (e) => {
       e.stopPropagation();
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
   color: "#6f42c1",
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
      label: "Remove",
      title: "Remove from basket",
      color: "#6c757d",
      onClick: (e) => {
          e.stopPropagation();
          basketVideos.splice(idx, 1);
          window.basketVideos = basketVideos;
          saveBasket();
          renderBasket();
          if (window.updateBasketHighlights) window.updateBasketHighlights();
      }
   },
   {
      label: "Move to top",
      title: "Move to top of basket",
      color: "#17a2b8",
      onClick: (e) => {
          e.stopPropagation();
          if (idx === 0) return; // Already at top
          const [movedItem] = basketVideos.splice(idx, 1);
          basketVideos.unshift(movedItem);
          window.basketVideos = basketVideos;
          saveBasket();
          renderBasket();
          if (window.updateBasketHighlights) window.updateBasketHighlights();
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
   
   // ✅ Drag and drop event listeners
   setupDragAndDrop(li);
   
   basketList.appendChild(li);
});

updateBasketCount();
if (window.updateBasketHighlights) window.updateBasketHighlights();
if (window.updateHistoryHighlights) window.updateHistoryHighlights();
}

// ✅ Drag and drop functionality
let draggedItem = null;
let draggedIndex = null;
let dropIndicator = null;
let ghostElement = null;
let targetDropIndex = null; // Track where we want to drop

function createGhostElement(video) {
   const ghost = document.createElement('div');
   ghost.className = 'basket-drag-ghost';
   ghost.textContent = video.filename || 'Video';
   document.body.appendChild(ghost);
   return ghost;
}

function setupDragAndDrop(li) {
 // Desktop drag events
 li.addEventListener('dragstart', (e) => {
     // Block native HTML5 drag entirely on touch devices. Some mobile
     // browsers still partially fire dragstart for draggable elements even
     // during a touch interaction, which creates a native drag ghost that
     // races against our custom long-press touch-drag path below. Since
     // our touchmove handler calls preventDefault() mid-drag, it disrupts
     // the native drag lifecycle so dragend (which would normally clean up
     // the ghost) never fires - leaving a stuck drag icon on screen.
     // Bailing out here on touch devices prevents that native path from
     // ever starting, while leaving the 'draggable' attribute itself
     // intact so the touch handlers' selector-based position calculations
     // keep working.
     const isTouchDeviceForDrag = ('ontouchstart' in window) ||
         (navigator.maxTouchPoints > 0) ||
         (navigator.msMaxTouchPoints > 0);
     if (isTouchDeviceForDrag) {
         e.preventDefault();
         return;
     }

     draggedItem = li;
     draggedIndex = parseInt(li.dataset.index);
     const video = basketVideos[draggedIndex];
     
     li.classList.add('dragging');
     
     // ✅ Create custom drag ghost - keep it visible during drag
     ghostElement = createGhostElement(video);
     ghostElement.style.position = 'fixed';
     ghostElement.style.left = e.clientX + 'px';
     ghostElement.style.top = e.clientY + 'px';
     ghostElement.style.transform = 'translate(-50%, -50%)';
     
     // Use a transparent 1px image so browser doesn't show default ghost
     const transparentImg = document.createElement('img');
     transparentImg.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
     e.dataTransfer.setDragImage(transparentImg, 0, 0);
     e.dataTransfer.effectAllowed = 'move';
     e.dataTransfer.setData('text/html', li.innerHTML);
     
     // Create drop indicator line
     if (!dropIndicator) {
         dropIndicator = document.createElement('div');
         dropIndicator.className = 'drop-indicator';
     }
 });

 // ✅ Track mouse position to move ghost on desktop
 li.addEventListener('drag', (e) => {
     if (ghostElement && e.clientX !== 0 && e.clientY !== 0) {
         ghostElement.style.left = e.clientX + 'px';
         ghostElement.style.top = e.clientY + 'px';
     }
 });

 li.addEventListener('dragover', (e) => {
     e.preventDefault();
     e.dataTransfer.dropEffect = 'move';
     
     if (li === draggedItem) return;
     
     const rect = li.getBoundingClientRect();
     const midpoint = rect.top + rect.height / 2;
     
     // Determine drop position
     const allItems = Array.from(li.parentElement.querySelectorAll('li[draggable="true"]'));
     const overIndex = allItems.indexOf(li);
     
     // ✅ Make sure indicator is in the DOM and visible
     if (e.clientY < midpoint) {
         if (dropIndicator.nextSibling !== li) {
             li.parentElement.insertBefore(dropIndicator, li);
         }
         targetDropIndex = overIndex;
     } else {
         if (dropIndicator.previousSibling !== li) {
             li.parentElement.insertBefore(dropIndicator, li.nextSibling);
         }
         targetDropIndex = overIndex + 1;
     }
 });

 li.addEventListener('drop', (e) => {
     e.preventDefault();
     e.stopPropagation();
     
     if (dropIndicator && dropIndicator.parentElement) {
         dropIndicator.remove();
     }
     
     if (draggedIndex !== null && targetDropIndex !== null && draggedIndex !== targetDropIndex) {
         const [movedItem] = basketVideos.splice(draggedIndex, 1);
         
         // Adjust target index if dragging from earlier position
         let insertIndex = targetDropIndex;
         if (draggedIndex < targetDropIndex) {
             insertIndex--;
         }
         
         basketVideos.splice(insertIndex, 0, movedItem);
         
         window.basketVideos = basketVideos;
         saveBasket();
         renderBasket();
         if (window.updateBasketHighlights) window.updateBasketHighlights();
         
         console.log(`Moved item from position ${draggedIndex} to ${insertIndex}`);
     }
     
     targetDropIndex = null;
 });

 li.addEventListener('dragend', () => {
     li.classList.remove('dragging');
     if (dropIndicator && dropIndicator.parentElement) {
         dropIndicator.remove();
     }
     // ✅ Clean up ghost on dragend
     if (ghostElement && ghostElement.parentElement) {
         ghostElement.remove();
         ghostElement = null;
     }
     draggedItem = null;
     draggedIndex = null;
     targetDropIndex = null;
 });

 // ✅ Mobile touch support - FIXED
 let touchStartY = 0;
 let touchStartX = 0;
 let touchStartTime = 0;
 let isTouchDragging = false;
 let longPressTimer = null;
 let mobileGhost = null;
 let hasMoved = false;

li.addEventListener('touchstart', (e) => {
    // Don't interfere with buttons
    if (e.target.closest('.compact-btn-group')) return;
    if (e.target.closest('button')) return;
     
     touchStartY = e.touches[0].clientY;
     touchStartX = e.touches[0].clientX;
     touchStartTime = Date.now();
     draggedIndex = parseInt(li.dataset.index);
     targetDropIndex = null;
     hasMoved = false;
     
     // ✅ DON'T prevent default here - allow scrolling and selection
     
     // Long press detection
     longPressTimer = setTimeout(() => {
         // ✅ Only enter drag mode if we haven't moved (i.e., not scrolling)
         if (!hasMoved) {
             isTouchDragging = true;
             li.classList.add('dragging');
             navigator.vibrate?.(50); // Haptic feedback if available
             
             // Create drop indicator
             if (!dropIndicator) {
                 dropIndicator = document.createElement('div');
                 dropIndicator.className = 'drop-indicator';
             }
             
             // ✅ Create mobile ghost element
             const video = basketVideos[draggedIndex];
             mobileGhost = createGhostElement(video);
             mobileGhost.style.position = 'fixed';
             mobileGhost.style.pointerEvents = 'none';
             mobileGhost.style.zIndex = '9999';
         }
     }, 300); // ✅ Increased to 300ms for more reliable detection
     
 }, { passive: true }); // ✅ Changed to passive: true

 li.addEventListener('touchmove', (e) => {
     // ✅ Track if user has moved (for scroll detection)
     const deltaY = Math.abs(e.touches[0].clientY - touchStartY);
     const deltaX = Math.abs(e.touches[0].clientX - touchStartX);
     
     if (deltaY > 10 || deltaX > 10) {
         hasMoved = true;
         // Cancel long press if we're scrolling
         if (!isTouchDragging) {
             clearTimeout(longPressTimer);
             return;
         }
     }
     
     if (!isTouchDragging) return;
     
     // ✅ Only prevent default once we're actually dragging
     e.preventDefault();
     const touch = e.touches[0];
     const currentY = touch.clientY;
     
     // ✅ Move ghost with touch
     if (mobileGhost) {
         mobileGhost.style.left = touch.clientX + 'px';
         mobileGhost.style.top = currentY + 'px';
     }
     
     // Find which item we're over
     const elements = document.elementsFromPoint(touch.clientX, currentY);
     const overItem = elements.find(el => 
         el.tagName === 'LI' && 
         el.draggable && 
         el !== li &&
         el.parentElement === li.parentElement
     );
     
     if (overItem) {
         const rect = overItem.getBoundingClientRect();
         const midpoint = rect.top + rect.height / 2;
         
         const allItems = Array.from(li.parentElement.querySelectorAll('li[draggable="true"]'));
         const overIndex = allItems.indexOf(overItem);
         
         if (currentY < midpoint) {
             li.parentElement.insertBefore(dropIndicator, overItem);
             targetDropIndex = overIndex;
         } else {
             li.parentElement.insertBefore(dropIndicator, overItem.nextSibling);
             targetDropIndex = overIndex + 1;
         }
     }
     
 }, { passive: false }); // Keep passive: false here since we need preventDefault during drag

 li.addEventListener('touchend', (e) => {
     clearTimeout(longPressTimer);
     
     if (!isTouchDragging) {
         // ✅ Not dragging - allow normal click/selection to proceed
         return;
     }
     
     // ✅ Only prevent default if we were actually dragging
     e.preventDefault();
     
     // ✅ Remove mobile ghost
     if (mobileGhost && mobileGhost.parentElement) {
         mobileGhost.remove();
         mobileGhost = null;
     }
     
     if (dropIndicator && dropIndicator.parentElement) {
         dropIndicator.remove();
     }
     
     // ✅ Use targetDropIndex instead of calculating from DOM
     if (draggedIndex !== null && targetDropIndex !== null && draggedIndex !== targetDropIndex) {
         const [movedItem] = basketVideos.splice(draggedIndex, 1);
         
         // Adjust target index if dragging from earlier position
         let insertIndex = targetDropIndex;
         if (draggedIndex < targetDropIndex) {
             insertIndex--;
         }
         
         basketVideos.splice(insertIndex, 0, movedItem);
         
         window.basketVideos = basketVideos;
         saveBasket();
         renderBasket();
         if (window.updateBasketHighlights) window.updateBasketHighlights();
         
         console.log(`Touch: Moved item from position ${draggedIndex} to ${insertIndex}`);
     }
     
     li.classList.remove('dragging');
     isTouchDragging = false;
     draggedIndex = null;
     targetDropIndex = null;
     hasMoved = false;
     
 }, { passive: false });

 li.addEventListener('touchcancel', () => {
     clearTimeout(longPressTimer);
     li.classList.remove('dragging');
     if (dropIndicator && dropIndicator.parentElement) {
         dropIndicator.remove();
     }
     if (mobileGhost && mobileGhost.parentElement) {
         mobileGhost.remove();
         mobileGhost = null;
     }
     isTouchDragging = false;
     draggedIndex = null;
     targetDropIndex = null;
     hasMoved = false;
 });
}

function getDragAfterElement(container, y) {
   const draggableElements = [...container.querySelectorAll('li:not(.dragging)')];
   
   return draggableElements.reduce((closest, child) => {
       const box = child.getBoundingClientRect();
       const offset = y - box.top - box.height / 2;
       
       if (offset < 0 && offset > closest.offset) {
           return { offset: offset, element: child };
       } else {
           return closest;
       }
   }, { offset: Number.NEGATIVE_INFINITY }).element;
}

// ✅ Add to basket with guaranteed IDs
function addToBasket(video) {
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

if (!basketVideos.some(v => v.oneDriveId === oneDriveId)) {
   basketVideos.unshift({ ...video, oneDriveId, driveId }); // ✅ Changed from push to unshift - adds to TOP
   window.basketVideos = basketVideos; // ✅ Sync global reference
   resetBasketPlayIndex(); // ✅ Reset play index when basket changes
   saveBasket();
   renderBasket();
   if (window.updateBasketHighlights) window.updateBasketHighlights();
  if (window.updateRandomPanelHighlights) window.updateRandomPanelHighlights();
}
}



function clearBasket() {
// Empty the basket array and storage
basketVideos = [];
window.basketVideos = basketVideos;
saveBasket();
renderBasket();

// Reset play index
resetBasketPlayIndex();

// Remove basket-added highlight from both main list & random list
document
     .querySelectorAll('#playlist li, #taggedVideosContainer li, #historyList li, #randomPlaylistPanelList li') // ✅ ADD #randomPlaylistPanelList li
    .forEach(li => li.classList.remove('basket-added'));

console.log("Basket cleared – highlights removed from main and random lists");
}

// Heal IDs if missing
async function healBasketItemIds(video, accountInfo) {
 const allDbVideos = await getAllVideos();
 const match = allDbVideos.find(v => v.filename === video.filename && v.path === video.path);
 if (match) {
     if (!video.oneDriveId && match.oneDriveId) video.oneDriveId = match.oneDriveId;
     if ((!video.driveId || video.driveId === "unknownDrive" || video.driveId === "undefined") && match.driveId) {
         video.driveId = match.driveId;
     }
 }

 if ((!video.driveId || !video.oneDriveId) && video.webUrl) {
     try {
         const u = new URL(video.webUrl);
         const cidParam = u.searchParams.get("cid");
         const idParam = u.searchParams.get("id");
         if (cidParam) video.driveId = video.driveId || cidParam;
         if (idParam) video.oneDriveId = video.oneDriveId || idParam;
     } catch {}
 }

 if (!video.driveId || !video.oneDriveId) {
     try {
         const sharedItems = await fetchAllPages("https://graph.microsoft.com/v1.0/me/drive/sharedWithMe", accountInfo.token);
         const matchItem = sharedItems.find(shared => {
             const ref = shared.remoteItem || shared;
             return ref.name === video.filename;
         });
         if (matchItem?.remoteItem?.parentReference?.driveId) {
             video.driveId = matchItem.remoteItem.parentReference.driveId;
             video.oneDriveId = matchItem.remoteItem.id || video.oneDriveId;
         }
     } catch {}
 }
}

/**
* Comprehensive refresh for a single video item (same logic as bulk refresh)
* Returns the refreshed video object
*/
async function refreshSingleVideoComprehensive(video) {
   console.log(`Starting comprehensive refresh for: ${video.filename}`);

   // ✅ Local files have no expiring URLs and no account to re-auth against.
   // Re-read fresh metadata from disk instead of hitting Graph.
   if (video.driveId === "local" || (video.accountKey || "").startsWith("local::")) {
       try {
           const meta = await ScrayBridge.getVideoMetadata(video.oneDriveId);
           if (meta) {
               const updates = {
                   sizeBytes: meta.sizeBytes ?? video.sizeBytes,
                   durationMs: meta.duration != null ? Math.round(meta.duration * 1000) : video.durationMs,
                   width: meta.width ?? video.width,
                   height: meta.height ?? video.height,
                   bitrate: meta.bitrate ?? video.bitrate,
                   lastModifiedDateTime: meta.modifiedDate ?? video.lastModifiedDateTime
               };
               updates.orientation = deriveOrientation(updates.width, updates.height) || video.orientation;
               await updateVideoInDB(video.oneDriveId, updates);
               Object.assign(video, updates);
           }
       } catch (err) {
           console.warn(`Local metadata refresh failed for ${video.filename}: ${err.message}`);
       }
       return video;
   }

   const [accountIdStored] = (video.accountKey || "").split("::");
   let accountInfo = accountsData.find(acc => acc.accountId === accountIdStored);

   if (!accountInfo) {
       throw new Error(`Account not found for video: ${video.filename}`);
   }

   // Refresh token
   try {
       accountInfo.token = await refreshTokenForAccount(accountIdStored);
       saveAccountsToStorage();
   } catch (err) {
       throw new Error(`Token refresh failed: ${err.message}`);
   }

   // Heal IDs if needed
   if (!video.oneDriveId || !video.driveId || 
       video.driveId === "unknownDrive" || video.driveId === "undefined") {
       console.log(`Healing IDs for ${video.filename}`);
       await healBasketItemIds(video, accountInfo);
   }

   if (!video.driveId || !video.oneDriveId) {
       throw new Error(`Missing OneDrive IDs — cannot refresh ${video.filename}`);
   }

   // Fetch fresh metadata from OneDrive
   const url = `https://graph.microsoft.com/v1.0/drives/${video.driveId}/items/${video.oneDriveId}`;
   const updated = await fetchJSONWithRetry(url, accountInfo.token);

   // Process path for tags
 let refreshedPath = (updated.parentReference?.path || "")
     .replace(/^\/drives\/[^/]+\/root:\s*/i, "")
     .replace(/^\/drive\/root:\s*/i, "");
 if (refreshedPath.startsWith("/") && refreshedPath.length > 1) {
     refreshedPath = refreshedPath.slice(1);
 }

 const pathForTags = refreshedPath;

   // Get existing data from IndexedDB
   const db = await openDB();
   const tx = db.transaction(STORE_NAME, "readwrite");
   const store = tx.objectStore(STORE_NAME);
   const existing = await store.get(video.oneDriveId) || {};

   // Extract and merge tags
   const pathTags = generateTagsFromPath(pathForTags);
   const filenameBracketTags = generateTagsFromFilename(updated.name);
   const mergedTags = [...new Set([...pathTags, ...filenameBracketTags])];
   
   // Store bracket tags as level_5
   let level5Value = existing.level_5 || null;
   if (filenameBracketTags.length > 0) {
       if (level5Value && level5Value.includes('_')) {
           level5Value = level5Value + ';' + filenameBracketTags.join(';');
       } else {
           level5Value = filenameBracketTags.join(';');
       }
   }
   
   // Create merged video object
   const mergedVideo = {
       ...existing,
       ...video,
       filename: updated.name,
       path: refreshedPath,
       sizeBytes: updated.size,
       downloadUrl: updated['@microsoft.graph.downloadUrl'],
       webUrl: updated.webUrl,
       durationMs: updated.video?.duration ?? video.durationMs ?? null,
       tags: mergedTags,
       bracketTags: filenameBracketTags,
       level_5: level5Value,
       oneDriveId: video.oneDriveId
   };

   // Save to IndexedDB
   await store.put(mergedVideo);
   await tx.complete;

   console.log(`Comprehensive refresh complete for: ${updated.name}`);
   return mergedVideo;
}

// Export globally for use in context menus
window.refreshSingleVideoComprehensive = refreshSingleVideoComprehensive;

// FINAL UPDATED refreshBasketFiles — now supports optional subset for selection
async function refreshBasketFiles(refreshBtn, subset = null) {
const targetVideos = subset ?? basketVideos;

if (!targetVideos.length) {
    alert("No basket items to refresh");
    console.warn("No basket items to refresh — nothing to do");
    return;
}

console.log(`Starting basket refresh: ${targetVideos.length} videos`);
initAccountStatusBar('basket');
updateAccountStatus('basket', `Refreshing ${targetVideos.length} videos for basket`);

let count = 0;

for (let idx = 0; idx < targetVideos.length; idx++) {
    const video = targetVideos[idx];
    console.log(`Processing ${idx + 1}/${targetVideos.length}: ${video.filename}`);

    const [accountIdStored] = (video.accountKey || "").split("::");
    let accountInfo = accountsData.find(acc => acc.accountId === accountIdStored);

    if (!accountInfo) {
        console.warn(`Account not found for basket item: ${video.filename}`);
        continue;
    }

    try {
        console.log(`Refreshing token for account: ${accountInfo.username}`);
        const tokenRefreshed = await refreshTokenForAccount(accountIdStored);
        accountInfo.token = tokenRefreshed;
        saveAccountsToStorage();
    } catch (err) {
        console.warn(`Could not refresh token silently for ${video.filename}`, err);
        alert(`Login required for ${accountInfo.username}`);
        try {
            await login();
        } catch {
            continue;
        }
    }

    if (!video.oneDriveId || !video.driveId || 
        video.driveId === "unknownDrive" || video.driveId === "undefined") {
        console.log(`Attempting to heal IDs for ${video.filename}`);
        await healBasketItemIds(video, accountInfo);
    }

    if (!video.driveId || !video.oneDriveId) {
        console.warn(`Cannot refresh: missing driveId or oneDriveId for ${video.filename}`);
        continue;
    }

    try {
        const url = `https://graph.microsoft.com/v1.0/drives/${video.driveId}/items/${video.oneDriveId}`;
        console.log(`Fetching metadata for ${video.filename}: ${url}`);
        const updated = await fetchJSONWithRetry(url, accountInfo.token);

        console.log(`Fetched metadata for ${updated.name}: size=${updated.size} bytes`);

        let refreshedPath = (updated.parentReference?.path || "")
          .replace(/^\/drives\/[^/]+\/root:\s*/i, "")
          .replace(/^\/drive\/root:\s*/i, "");
      if (refreshedPath.startsWith("/") && refreshedPath.length > 1) {
          refreshedPath = refreshedPath.slice(1);
      }

      const pathForTags = refreshedPath;

        const db = await openDB();
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        const existing = await store.get(video.oneDriveId) || {};

        const pathTags = generateTagsFromPath(pathForTags);
         const filenameBracketTags = generateTagsFromFilename(updated.name);
         const mergedTags = [...new Set([...pathTags, ...filenameBracketTags])]; // Merge and deduplicate
         
         // ✅ Store bracket tags as level_5 (append to existing if present)
         let level5Value = existing.level_5 || null;
         if (filenameBracketTags.length > 0) {
             // Check if level_5 has folder data (contains underscore from joined folders)
             if (level5Value && level5Value.includes('_')) {
                 // Append bracket tags to folder data
                 level5Value = level5Value + ';' + filenameBracketTags.join(';');
             } else {
                 // No folder data, just use bracket tags
                 level5Value = filenameBracketTags.join(';');
             }
         }
         
         const mergedVideo = {
             ...existing,
             ...video,
             filename: updated.name,
             path: refreshedPath,
             sizeBytes: updated.size,
             downloadUrl: updated['@microsoft.graph.downloadUrl'],
             webUrl: updated.webUrl,
             durationMs: updated.video?.duration ?? video.durationMs ?? null,
             tags: mergedTags,
             bracketTags: filenameBracketTags, // ✅ Store as array
             level_5: level5Value, // ✅ Store as level_5 field
             oneDriveId: video.oneDriveId
         };
        await store.put(mergedVideo);
        await tx.complete;

        const basketIndex = basketVideos.findIndex(v => v.oneDriveId === video.oneDriveId);
        if (basketIndex >= 0) basketVideos[basketIndex] = mergedVideo;

        window.basketVideos = basketVideos; // ✅ Sync
        saveBasket();
        renderBasket();

        console.log(`Refreshed ${updated.name} successfully`);
    } catch (err) {
        console.warn(`Failed to refresh ${video.filename}`, err);
        continue;
    }

    count++;
    const total = targetVideos.length;
    updateAccountStatus('basket', `Refreshing ${count}/${total} videos for basket`);
    if (refreshBtn) refreshBtn.textContent = `${count}/${total}`;
}

updateAccountStatus('basket', `Basket refresh complete (${targetVideos.length} videos)`);
console.log(`Basket refresh complete — refreshed ${count}/${targetVideos.length} videos`);

// ✅ Refresh tag dropdowns to show new bracket tags
if (typeof populateTagDropdowns === 'function') {
await populateTagDropdowns();
}

if (refreshBtn) {
refreshBtn.textContent = "Done";
setTimeout(() => { refreshBtn.textContent = "REF"; }, 3000);
}
}

function exportBasketSubsetToCSV(subset) {
 if (!subset || !subset.length) {
     alert("No basket items to export");
     return;
 }

 const headers = [
     "id", "path", "filename", "web_url", "download_url",
     "size_bytes", "duration_ms", "account_name", "account_key", "tags"
 ];

 const rows = subset.map(v => [
     `"${(v.oneDriveId || "").replace(/"/g,'""')}"`,
     `"${(v.path || "").replace(/"/g,'""')}"`,
     `"${(v.filename || "").replace(/"/g,'""')}"`,
     `"${v.webUrl || ""}"`,
     `"${v.downloadUrl || ""}"`,
     v.sizeBytes ?? "",
     v.durationMs ?? "",
     `"${(v.accountName || "").replace(/"/g,'""')}"`,
     `"${(v.accountKey || "").replace(/"/g,'""')}"`,
     `"${(Array.isArray(v.tags) ? v.tags.join(";") : "").replace(/"/g,'""')}"`
 ]);

 const csvContent = [headers, ...rows].map(r => r.join(",")).join("\n");
 const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
 const url = URL.createObjectURL(blob);

 const a = document.createElement("a"); 
 a.href = url;
 a.download = `basket_export_${new Date().toISOString().slice(0,10)}.csv`;
 document.body.appendChild(a); 
 a.click(); 
 document.body.removeChild(a);
}

// =========================================
// PLAY NEXT IN BASKET
// =========================================
function playNextInBasket() {
 if (!basketVideos || basketVideos.length === 0) {
   alert("Basket is empty");
   return;
 }
 
 // Play current video
 const video = basketVideos[currentBasketPlayIndex];
 
 console.log(`Playing basket item ${currentBasketPlayIndex + 1}/${basketVideos.length}: ${video.filename}`);
 
 if (window.inlineVideoPlayer) {
   window.inlineVideoPlayer.play(video, 'basket', currentBasketPlayIndex);
   
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
 currentBasketPlayIndex++;
 
 // Wrap around to start
 if (currentBasketPlayIndex >= basketVideos.length) {
   currentBasketPlayIndex = 0;
   console.log("Reached end of basket - will restart from beginning next time");
 }
 
 // Update global reference
 window.currentBasketPlayIndex = currentBasketPlayIndex;
}

// Reset index when basket changes
function resetBasketPlayIndex() {
 currentBasketPlayIndex = 0;
 window.currentBasketPlayIndex = currentBasketPlayIndex;
 console.log("Basket play index reset to 0");
}

// =========================================
// PLAY RANDOM FROM BASKET (with anti-repeat)
// =========================================
let recentlyPlayedBasketVideos = [];

function playRandomFromBasket() {
if (!basketVideos || basketVideos.length === 0) {
  alert('Basket is empty');
  return;
}

// Filter out recently played videos
const eligibleVideos = basketVideos.filter(v => {
  const vidId = v.oneDriveId ?? v.idFromAPI ?? null;
  return !recentlyPlayedBasketVideos.includes(vidId);
});

// If all videos have been played recently (or fewer than 10 items), allow repeats
const finalPool = eligibleVideos.length > 0 ? eligibleVideos : basketVideos;

if (finalPool.length === 0) {
  alert('No videos available in basket');
  return;
}

// Pick random video
const randomIndex = Math.floor(Math.random() * finalPool.length);
const randomVideo = finalPool[randomIndex];

// Find the actual index in the full basket for proper navigation
const actualIndex = basketVideos.findIndex(v => v.oneDriveId === randomVideo.oneDriveId);

// Track this video as recently played
const vidId = randomVideo.oneDriveId ?? randomVideo.idFromAPI ?? null;
if (vidId) {
  recentlyPlayedBasketVideos.unshift(vidId);
  // Keep only last 10
  if (recentlyPlayedBasketVideos.length > 10) {
    recentlyPlayedBasketVideos = recentlyPlayedBasketVideos.slice(0, 10);
  }
}

console.log(`Playing random basket item: ${randomVideo.filename} (avoiding last ${recentlyPlayedBasketVideos.length - 1} played)`);

// Play with basket context so < and > navigate through basket
if (window.inlineVideoPlayer) {
  window.inlineVideoPlayer.play(randomVideo, 'basket', actualIndex);
  
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

// Export all functions
window.addToBasket = addToBasket;
window.clearBasket = clearBasket;
window.saveBasket = saveBasket;
window.renderBasket = renderBasket;
window.autoSyncEnabled = autoSyncEnabled;
window.clearBasketSelection = clearBasketSelection;
window.refreshBasketFiles = refreshBasketFiles;
window.exportBasketSubsetToCSV = exportBasketSubsetToCSV;
window.toggleBasketSelection = toggleBasketSelection;
window.playNextInBasket = playNextInBasket;
window.resetBasketPlayIndex = resetBasketPlayIndex;
window.playRandomFromBasket = playRandomFromBasket;


// =========================================
// JSON EXPORT/IMPORT FOR BASKET - WITH MODALS
// =========================================

// Show export options modal
function showExportOptionsModal() {
  if (!basketVideos.length) {
      alert("Basket is empty - nothing to export");
      return;
  }

  const modal = document.createElement('div');
  modal.className = 'basket-json-modal';
  modal.innerHTML = `
      <div class="basket-json-modal-content">
          <h3>Export Basket (${basketVideos.length} items)</h3>
          <p>Choose export method:</p>
          <div class="basket-json-modal-buttons">
              <button id="exportToFileBtn" class="modal-btn modal-btn-primary">📁 Download File</button>
              <button id="exportToClipboardBtn" class="modal-btn modal-btn-primary">📋 Copy to Clipboard</button>
          </div>
          <button id="exportCancelBtn" class="modal-btn modal-btn-cancel">Cancel</button>
      </div>
  `;
  document.body.appendChild(modal);

  // Close on background click
  modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
  });

  // Download file
  document.getElementById('exportToFileBtn').addEventListener('click', () => {
      modal.remove();
      exportBasketToJSONFile();
  });

  // Copy to clipboard
  document.getElementById('exportToClipboardBtn').addEventListener('click', async () => {
      modal.remove();
      await exportBasketToClipboard();
  });

  // Cancel
document.getElementById('exportCancelBtn').addEventListener('click', () => {
  modal.remove();
});

// ESC key to cancel
const exportEscHandler = (e) => {
  if (e.key === 'Escape') {
      modal.remove();
      document.removeEventListener('keydown', exportEscHandler);
  }
};
document.addEventListener('keydown', exportEscHandler);
}

// Export to file (compressed format - IDs only)
function exportBasketToJSONFile() {
// ✅ COMPRESSED: Only store oneDriveIds (30x smaller)
const videoIds = basketVideos.map(v => v.oneDriveId).filter(Boolean);

const exportData = {
    version: "2.0",  // ✅ Use version 2.0 for compressed format
    exportDate: new Date().toISOString(),
    itemCount: videoIds.length,
    videoIds: videoIds  // ✅ Just the IDs, not full objects
};

const jsonString = JSON.stringify(exportData, null, 2);
  const blob = new Blob([jsonString], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `basket_${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  console.log(`Exported ${basketVideos.length} basket items to JSON file`);
  alert(`Basket exported to file (${basketVideos.length} items)`);
}

// Export to clipboard (compressed format - IDs only)
async function exportBasketToClipboard() {
// ✅ COMPRESSED: Only store oneDriveIds (30x smaller)
const videoIds = basketVideos.map(v => v.oneDriveId).filter(Boolean);

const exportData = {
    version: "2.0",  // ✅ Use version 2.0 for compressed format
    exportDate: new Date().toISOString(),
    itemCount: videoIds.length,
    videoIds: videoIds  // ✅ Just the IDs, not full objects
};

const jsonString = JSON.stringify(exportData, null, 2);

  try {
      await navigator.clipboard.writeText(jsonString);
      console.log(`Exported ${basketVideos.length} basket items to clipboard`);
      alert(`Basket copied to clipboard (${basketVideos.length} items)`);
  } catch (err) {
      console.error("Failed to copy to clipboard:", err);
      alert("Failed to copy to clipboard. Please try file export instead.");
  }
}

// Show import options modal
function showImportOptionsModal() {
  const modal = document.createElement('div');
  modal.className = 'basket-json-modal';
  modal.innerHTML = `
      <div class="basket-json-modal-content">
          <h3>Import Basket</h3>
          <p>Choose import method:</p>
          <div class="basket-json-modal-buttons">
              <button id="importFromFileBtn" class="modal-btn modal-btn-primary">📁 Upload File</button>
              <button id="importFromPasteBtn" class="modal-btn modal-btn-primary">📋 Paste JSON</button>
          </div>
          <button id="importCancelBtn" class="modal-btn modal-btn-cancel">Cancel</button>
      </div>
  `;
  document.body.appendChild(modal);

  // Close on background click
  modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
  });

  // Upload file
  document.getElementById('importFromFileBtn').addEventListener('click', () => {
      modal.remove();
      document.getElementById('basketImportInput')?.click();
  });

  // Paste JSON
  document.getElementById('importFromPasteBtn').addEventListener('click', () => {
      modal.remove();
      showPasteJSONModal();
  });

  // Cancel
document.getElementById('importCancelBtn').addEventListener('click', () => {
  modal.remove();
});

// ESC key to cancel
const importEscHandler = (e) => {
  if (e.key === 'Escape') {
      modal.remove();
      document.removeEventListener('keydown', importEscHandler);
  }
};
document.addEventListener('keydown', importEscHandler);
}

// Show paste JSON textarea modal
function showPasteJSONModal() {
const modal = document.createElement('div');
modal.className = 'basket-json-modal';
modal.innerHTML = `
    <div class="basket-json-modal-content basket-json-modal-wide">
        <h3>Load Basket from Excel Online</h3>
        <textarea id="pasteJSONTextarea" placeholder="Paste your basket JSON here..." rows="15"></textarea>
        <div class="basket-json-modal-buttons">
            <button id="pasteConfirmBtn" class="modal-btn modal-btn-primary">Import</button>
            <button id="pasteClearBtn" class="modal-btn modal-btn-secondary">Clear</button>
        </div>
        <button id="pasteCancelBtn" class="modal-btn modal-btn-cancel">Cancel</button>
    </div>
`;
document.body.appendChild(modal);

const textarea = document.getElementById('pasteJSONTextarea');

// Auto-focus and try to paste from clipboard
setTimeout(async () => {
    textarea.focus();
    try {
        const clipText = await navigator.clipboard.readText();
        if (clipText && clipText.trim().startsWith('{')) {
            textarea.value = clipText;
        }
    } catch (err) {
        // Clipboard read permission denied - user will paste manually
    }
}, 100);

// Close on background click
modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
});

// Confirm paste
document.getElementById('pasteConfirmBtn').addEventListener('click', async () => {
    const jsonText = textarea.value.trim();
    if (!jsonText) {
        alert("Please paste JSON content first");
        return;
    }
    modal.remove();
    await importBasketFromJSONText(jsonText);
});

// Clear button - clears the textarea
document.getElementById('pasteClearBtn').addEventListener('click', () => {
    textarea.value = '';
    textarea.focus();
});

// Cancel
document.getElementById('pasteCancelBtn').addEventListener('click', () => {
  modal.remove();
});

// ESC key to cancel
const pasteEscHandler = (e) => {
  if (e.key === 'Escape') {
      modal.remove();
      document.removeEventListener('keydown', pasteEscHandler);
  }
};
document.addEventListener('keydown', pasteEscHandler);
}

// Import from file (original behavior)
async function importBasketFromJSON(file) {
  try {
      const text = await file.text();
      await importBasketFromJSONText(text);
  } catch (err) {
      console.error("Import from file failed:", err);
      alert(`Import failed: ${err.message}`);
  }
}

// Core import logic (used by both file and paste) - supports v1.0 and v2.0
async function importBasketFromJSONText(jsonText) {
try {
    const importData = JSON.parse(jsonText);

    // ✅ Check version to determine format
    const isCompressed = importData.version === "2.0";
    let videosToLoad = [];

    if (isCompressed) {
        // ✅ NEW FORMAT (v2.0): Reconstruct videos from IndexedDB using IDs
        if (!importData.videoIds || !Array.isArray(importData.videoIds)) {
            throw new Error("Invalid compressed basket format");
        }
        
        console.log(`Loading compressed basket with ${importData.videoIds.length} video IDs...`);
        
        // Get all videos from IndexedDB
        const allVideos = await getAllVideos();
        const videoMap = new Map(allVideos.map(v => [v.oneDriveId, v]));
        
        // Reconstruct video objects
        let missingCount = 0;
        importData.videoIds.forEach(id => {
            const video = videoMap.get(id);
            if (video) {
                videosToLoad.push(video);
            } else {
                missingCount++;
                console.warn(`Video not found in database: ${id}`);
            }
        });
        
        if (missingCount > 0) {
            alert(`Warning: ${missingCount} video${missingCount > 1 ? 's' : ''} from this basket are no longer in your database.\n\nLoaded ${videosToLoad.length} of ${importData.videoIds.length} videos.`);
        }
    } else {
        // ✅ OLD FORMAT (v1.0): Videos already in full format
        if (!importData.videos || !Array.isArray(importData.videos)) {
            throw new Error("Invalid basket format");
        }
        videosToLoad = importData.videos;
        console.log(`Loading legacy basket with ${videosToLoad.length} full video objects...`);
    }

    const importCount = videosToLoad.length;

    // If basket has items, ask user what to do
    if (basketVideos.length > 0) {
        // Show 3-button modal
        const action = await showImportActionModal(basketVideos.length, importCount);
        
        if (action === 'cancel') {
            console.log('Import cancelled by user');
            return; // Abort operation
        }
        
        if (action === 'replace') {
            basketVideos = [...videosToLoad];
            console.log(`Replaced basket with ${importCount} imported items`);
        } else if (action === 'add') {
            // Append, avoiding duplicates by oneDriveId
            let addedCount = 0;
            videosToLoad.forEach(video => {
                if (!basketVideos.some(v => v.oneDriveId === video.oneDriveId)) {
                    basketVideos.push(video);
                    addedCount++;
                }
            });
            console.log(`Added ${addedCount} new items to basket (${importCount - addedCount} duplicates skipped)`);
        }
    } else {
        // Empty basket - just add all
        basketVideos = [...videosToLoad];
        console.log(`Imported ${importCount} items into empty basket`);
    }

    window.basketVideos = basketVideos;
    saveBasket();
    renderBasket();

    alert(`Import successful: ${basketVideos.length} items in basket`);

} catch (err) {
    console.error("Import failed:", err);
    alert(`Import failed: ${err.message}`);
}
}

// Show 3-button modal asking user what to do with import
function showImportActionModal(currentCount, importCount, warningMessage = null) {
return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'basket-json-modal';
    
    let warningHTML = '';
    if (warningMessage) {
        warningHTML = `
            <div style="background: #fff3cd; border: 1px solid #ffc107; border-radius: 4px; padding: 12px; margin-bottom: 16px;">
                <strong style="color: #856404;">⚠️ Warning:</strong>
                <p style="margin: 4px 0 0 0; color: #856404; font-size: 0.9rem;">${warningMessage}</p>
            </div>
        `;
    }
    
    modal.innerHTML = `
        <div class="basket-json-modal-content">
            <h3>Import Basket</h3>
            ${warningHTML}
            <p>Current basket: ${currentCount} items<br>Import data: ${importCount} items</p>
            <p><strong>What would you like to do?</strong></p>
            <div class="basket-json-modal-buttons">
                <button id="importAddBtn" class="modal-btn modal-btn-primary">➕ Add</button>
                <button id="importReplaceBtn" class="modal-btn modal-btn-primary">🔄 Replace</button>
            </div>
            <button id="importAbortBtn" class="modal-btn modal-btn-cancel">Cancel</button>
        </div>
    `;
    document.body.appendChild(modal);

    // ✅ FIX: Use setTimeout to ensure DOM is ready before attaching listeners
    setTimeout(() => {
        const addBtn = document.getElementById('importAddBtn');
        const replaceBtn = document.getElementById('importReplaceBtn');
        const cancelBtn = document.getElementById('importAbortBtn');

        if (!addBtn || !replaceBtn || !cancelBtn) {
            console.error('Import modal buttons not found in DOM');
            modal.remove();
            resolve('cancel');
            return;
        }

        // Add button - append to existing
        addBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            addBtn.disabled = true;
            replaceBtn.disabled = true;
            cancelBtn.disabled = true;
            addBtn.textContent = '✅ Success';
            addBtn.style.background = '#28a745';
            
            setTimeout(() => {
                modal.remove();
                resolve('add');
            }, 1000);
        });

        // Replace button - clear and replace
        replaceBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            addBtn.disabled = true;
            replaceBtn.disabled = true;
            cancelBtn.disabled = true;
            replaceBtn.textContent = '✅ Success';
            replaceBtn.style.background = '#28a745';
            
            setTimeout(() => {
                modal.remove();
                resolve('replace');
            }, 1000);
        });

        // Cancel button - abort operation
        cancelBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            modal.remove();
            resolve('cancel');
        });
    }, 0);

    // Click outside = cancel (but not on modal content)
modal.addEventListener('click', (e) => {
  if (e.target === modal) {
      modal.remove();
      resolve('cancel');
  }
});

// ESC key to cancel
const importActionEscHandler = (e) => {
  if (e.key === 'Escape') {
      modal.remove();
      resolve('cancel');
      document.removeEventListener('keydown', importActionEscHandler);
  }
};
document.addEventListener('keydown', importActionEscHandler);
});
}

// Show Excel Online options modal (disconnect or refresh)
function showExcelOnlineOptionsModal() {
   const modal = document.createElement('div');
   modal.className = 'basket-json-modal';
   const autoTrackChecked = (typeof window.isAutoTrackEnabled === 'function') ? window.isAutoTrackEnabled() : true;
   modal.innerHTML = `
       <div class="basket-json-modal-content">
           <h3>Excel Online Options</h3>
           <p>Choose an action:</p>
           <div class="basket-json-modal-buttons">
               <button id="excelRefreshBtn" class="modal-btn modal-btn-primary">Refresh Authentication</button>
               <button id="excelDisconnectBtn" class="modal-btn modal-btn-primary" style="background: #f44336;">Disconnect</button>
           </div>
           <label style="display: flex; align-items: center; gap: 6px; margin: 16px 0; cursor: pointer;">
               <input type="checkbox" id="autoTrackVideosCheckbox" style="width: auto; margin: 0;" ${autoTrackChecked ? 'checked' : ''}>
               Auto-track plays
           </label>
           <button id="excelCancelBtn" class="modal-btn modal-btn-cancel">Cancel</button>
       </div>
   `;
   document.body.appendChild(modal);

   modal.addEventListener('click', (e) => {
       if (e.target === modal) modal.remove();
   });

   document.getElementById('excelRefreshBtn').addEventListener('click', () => {
       modal.remove();
       window.signInToExcelOnline();
   });

   document.getElementById('excelDisconnectBtn').addEventListener('click', () => {
       modal.remove();
       window.signOutFromExcelOnline();
   });

   document.getElementById('autoTrackVideosCheckbox').addEventListener('change', (e) => {
       localStorage.setItem('auto_track_videos', e.target.checked ? '1' : '0');
       if (typeof window.updateExcelConnectionStatus === 'function') {
           window.updateExcelConnectionStatus(!!window.excelAccessToken);
       }
       if (e.target.checked) {
           alert("Auto-tracking enabled - videos will be logged to Excel Online when played");
       }
   });

   document.getElementById('excelCancelBtn').addEventListener('click', () => {
       modal.remove();
   });
}
// Export functions globally
window.showExcelOnlineOptionsModal = showExcelOnlineOptionsModal;
window.showExportOptionsModal = showExportOptionsModal;
window.showImportOptionsModal = showImportOptionsModal;
window.showImportActionModal = showImportActionModal;
// ✅ These three live in excel-sheets.js, which is NOT loaded in the native build.
// Assigning them unguarded throws a ReferenceError that kills the rest of this file
// (swipe-to-close listeners + renderBasket() on DOMContentLoaded). typeof is safe
// on undeclared identifiers, so this works in both builds.
if (typeof showBasketNameModal === 'function') window.showBasketNameModal = showBasketNameModal;
if (typeof showImportWarningModal === 'function') window.showImportWarningModal = showImportWarningModal;
if (typeof showImportErrorModal === 'function') window.showImportErrorModal = showImportErrorModal;
window.exportBasketToJSONFile = exportBasketToJSONFile;
window.exportBasketToClipboard = exportBasketToClipboard;
window.importBasketFromJSON = importBasketFromJSON;
window.importBasketFromJSONText = importBasketFromJSONText;


// =========================================
// TAG BUTTON - Show tags from selected basket items
// =========================================
function showBasketTagSelector() {
const selectedVideos = basketVideos.filter(v => selectedBasketIds.has(v.oneDriveId));

if (selectedVideos.length === 0) {
  alert("No basket items selected");
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
const basketTagEscHandler = (e) => {
  if (e.key === 'Escape') {
      document.body.removeChild(overlay);
      document.removeEventListener('keydown', basketTagEscHandler);
  }
};
document.addEventListener('keydown', basketTagEscHandler);

document.body.appendChild(overlay);
}

window.showBasketTagSelector = showBasketTagSelector;


window.addEventListener("DOMContentLoaded", () => {

document.getElementById("basketToggleBtn")?.addEventListener("click", () => toggleBasket());

// ✅ PUSH sync button - pushes current basket to Excel
document.getElementById("basketSaveBtn")?.addEventListener("click", async () => {
  const btn = document.getElementById("basketSaveBtn");
  
  if (!window.basketVideos.length) {
      alert("Basket is empty - cannot push");
      return;
  }
  
  if (!window.excelAccessToken) {
      alert("Please connect to Excel Online first");
      if (confirm("Connect now?")) {
          window.signInToExcelOnline();
      }
      return;
  }
  
  btn.disabled = true;
  btn.textContent = "⏳";
  
  try {
    await window.syncCurrentBasketToExcel();
    
    btn.textContent = "✅";
    
    // Show success popup
    if (typeof window.showSyncConfirmation === 'function') {
        window.showSyncConfirmation(`✅ Pushed ${window.basketVideos.length} videos to Excel`);
    }
    
    setTimeout(() => {
        btn.textContent = "↑";
        btn.disabled = false;
    }, 2000);
} catch (err) {
      console.error('Push sync failed:', err);
      btn.textContent = "❌";
      setTimeout(() => {
          btn.textContent = "↑";
          btn.disabled = false;
      }, 2000);
      alert(`Push failed: ${err.message || 'Unknown error'}`);
  }
});

// ✅ PULL sync button - pulls latest basket from Excel
document.getElementById("basketLoadBtn")?.addEventListener("click", async () => {
  const btn = document.getElementById("basketLoadBtn");
  
  if (!window.excelAccessToken) {
      alert("Please connect to Excel Online first");
      if (confirm("Connect now?")) {
          window.signInToExcelOnline();
      }
      return;
  }
  
  btn.disabled = true;
  btn.textContent = "⏳";
  
  try {
    await window.loadCurrentBasketFromExcel();
    
    btn.textContent = "✅";
    
    // Show success popup
    if (typeof window.showSyncConfirmation === 'function') {
        window.showSyncConfirmation(`✅ Pulled basket from Excel`);
    }
    
    setTimeout(() => {
        btn.textContent = "↓";
        btn.disabled = false;
    }, 2000);
} catch (err) {
      console.error('Pull sync failed:', err);
      btn.textContent = "❌";
      setTimeout(() => {
          btn.textContent = "↓";
          btn.disabled = false;
      }, 2000);
      alert(`Pull failed: ${err.message || 'Unknown error'}`);
  }
});

document.getElementById("basketSelectAllBtn")?.addEventListener("click", () => {
 basketVideos.forEach(v => selectedBasketIds.add(v.oneDriveId));
 renderBasket();
});

document.getElementById("basketRemoveBtn")?.addEventListener("click", () => {
 if (!selectedBasketIds.size) {
     alert("No basket items selected to remove");
     return;
 }
 basketVideos = basketVideos.filter(v => !selectedBasketIds.has(v.oneDriveId));
 window.basketVideos = basketVideos;
 resetBasketPlayIndex(); // ✅ Reset play index when basket changes
 clearBasketSelection();
 saveBasket();
 renderBasket();
});

// ✅ Overflow menu button for basket top
document.getElementById("basketMoreBtn")?.addEventListener("click", (e) => {
  const subset = basketVideos.filter(v => selectedBasketIds.has(v.oneDriveId));
  
  const actions = [
     {
         label: "💾 SAVE - Save Basket to Excel",
         onClick: async () => {
             if (!window.basketVideos.length) {
                 alert("Basket is empty");
                 return;
             }
             if (!window.excelAccessToken) {
                 alert("Please connect to Excel Online first");
                 return;
             }
             await window.saveBasketToExcel();
         }
     },
     {
         label: "📂 LOAD - Load Saved Basket",
         onClick: () => {
             if (!window.excelAccessToken) {
                 alert("Please connect to Excel Online first");
                 return;
             }
             window.showBasketPickerModal();
         }
     },
     {
         label: "CLR - Clear Selection",
         onClick: () => clearBasketSelection()
     },
     {
         label: "REF - Refresh Selected",
          onClick: () => {
              if (!subset.length) {
                  alert("No basket items selected to refresh");
                  return;
              }
              // Create a temporary button for status updates
              const tempBtn = { textContent: "REF", disabled: false };
              Object.defineProperty(tempBtn, 'textContent', {
                  set: function(val) { 
                      console.log('Refresh status:', val);
                  },
                  get: function() { return "REF"; }
              });
              refreshBasketFiles(tempBtn, subset);
          }
      },
        {
            label: "CSV - Export to CSV",
            onClick: () => {
                if (!subset.length) {
                    alert("No basket items selected to export");
                    return;
                }
                exportBasketSubsetToCSV(subset);
            }
        },
        {
            label: "JSON↓ - Export JSON",
            onClick: () => showExportOptionsModal()
        },
        {
            label: "JSON↑ - Import JSON",
            onClick: () => showImportOptionsModal()
        },
        {
           label: "TAG - Filter by Tags",
           onClick: () => showBasketTagSelector()
       }
    ];
    
    showContextMenu(actions, e);
});

// File input handler (triggered from modal)
const importInput = document.getElementById("basketImportInput");
importInput?.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    await importBasketFromJSON(file);
    e.target.value = "";
});

// Excel Online connection
document.getElementById("excelOnlineConnectBtn")?.addEventListener("click", () => {
   if (window.excelAccessToken) {
       // Show modal with disconnect and refresh options
       showExcelOnlineOptionsModal();
   } else {
       window.signInToExcelOnline();
   }
});

renderBasket();
});

// ✅ Swipe-to-dismiss basket (mobile only) - registered in its own
// DOMContentLoaded listener so it still runs even if an earlier error
// interrupts the main basket setup callback above
window.addEventListener("DOMContentLoaded", () => {
if (window.innerWidth < 769) {
let touchStartX = 0;
let touchStartY = 0;
let isSwiping = false;
let isScrolling = false;
let scrollableList = null;
let isDraggableItem = false; // Track if touch is on a draggable item

const basketPanel = document.getElementById("basketPanel");
if (basketPanel) {
    // STEP 1: Capture touches but check if they're on draggable items
    basketPanel.addEventListener("touchstart", e => {
        //  Check if touch is on a draggable item - if so, let it through
        const draggableItem = e.target.closest('li[draggable="true"]');
        isDraggableItem = !!draggableItem;
        
        if (isDraggableItem) {
            // Don't interfere with drag-and-drop
            return;
        }
        
        e.stopPropagation();
        
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        isSwiping = false;
        isScrolling = false;
        
        // Check if touch started inside scrollable list
        scrollableList = e.target.closest('#basketList');
    }, { passive: false, capture: true });
    
    // STEP 2: Handle touchmove
  basketPanel.addEventListener("touchmove", e => {
      // ✅ Skip if this is a drag operation
      if (isDraggableItem) {
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
  basketPanel.addEventListener("touchend", e => {
      // ✅ Skip if this is a drag operation
      if (isDraggableItem) {
          isDraggableItem = false;
          return;
      }
        
        e.stopPropagation();
        
        const touchEndX = e.changedTouches[0].clientX;
        
        // Swipe right to close
        if (isSwiping && touchEndX - touchStartX > 50) {
            e.preventDefault();
            basketPanel.classList.remove("basket-open");
        }
        
        // Reset
        isSwiping = false;
        isScrolling = false;
        scrollableList = null;
        isDraggableItem = false;
    }, { passive: false, capture: true });
    
    // STEP 4: Also handle touchcancel
  basketPanel.addEventListener("touchcancel", e => {
      isDraggableItem = false;
      isSwiping = false;
      isScrolling = false;
      scrollableList = null;
  }, { passive: false, capture: true });
}
}
});

// ✅ Re-render basket on orientation change (to update path visibility)
window.addEventListener('orientationchange', () => {
setTimeout(() => {
  if (typeof renderBasket === 'function') {
    renderBasket();
  }
}, 300);
});

// ✅ Corner buttons always visible in landscape - no auto-hide
if (window.innerWidth <= 1024) {
  const cornerButtons = document.getElementById('cornerButtons');
  if (cornerButtons) {
      // Force visible
      cornerButtons.style.opacity = '1';
      cornerButtons.style.pointerEvents = 'auto';
      console.log('✅ Corner buttons set to always visible in landscape mobile');
  }
}

// =========================================
// DESKTOP VIDEO PLAYER TOGGLE
// =========================================
function toggleVideoPlayer() {
const isHidden = document.body.classList.toggle('video-player-hidden');
const btn = document.getElementById('toggleVideoPlayerBtn');

if (btn) {
  btn.textContent = isHidden ? 'Show Player' : 'Hide Player';
}

// Save state to localStorage
localStorage.setItem('videoPlayerHidden', isHidden ? '1' : '0');

console.log(`Video player ${isHidden ? 'hidden' : 'shown'}`);
}

// Restore saved state on load
document.addEventListener('DOMContentLoaded', () => {
const toggleBtn = document.getElementById('toggleVideoPlayerBtn');

if (toggleBtn) {
  toggleBtn.addEventListener('click', toggleVideoPlayer);
  
  // Restore saved state (desktop only)
  if (window.innerWidth >= 769) {
    const savedState = localStorage.getItem('videoPlayerHidden');
    if (savedState === '1') {
      document.body.classList.add('video-player-hidden');
      toggleBtn.textContent = 'Show Player';
    }
  }
}
});

window.toggleVideoPlayer = toggleVideoPlayer;
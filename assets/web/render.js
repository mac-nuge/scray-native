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
* Render a list of videos into a given container
* Each video name/path is clickable to add it to the basket
*/
function renderVideoList(videos, containerId) {
const container = document.getElementById(containerId);
if (!container) return;
container.innerHTML = '';

videos.forEach((video, index) => {
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
const pathFragment = createClickablePath(video, true);
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
 // Native never auto-creates catalogue rows.
 if (video.inCatalogue === false) {
     const notInCatSpan = document.createElement("span");
     notInCatSpan.className = "not-in-catalogue-badge";
     notInCatSpan.textContent = "⚠";
     notInCatSpan.title = "Not in the SQLite catalogue — scores and bookmarks stay on this device";
     li.appendChild(notInCatSpan);
 }

// Size + Duration
 const sizeDurSpan = document.createElement("span");
 if (video.path === "yet-to-upload" || (Array.isArray(video.tags) && video.tags.includes("yet-to-upload"))) {
     sizeDurSpan.textContent = "";
 } else {
     sizeDurSpan.textContent = ` [${formatFileSize(video.sizeBytes)}, ${formatDuration(video.durationMs)}]`;
 }
 sizeDurSpan.style.marginLeft = "6px";
 sizeDurSpan.style.display = "inline";
 li.appendChild(sizeDurSpan);

  // Check if yet-to-upload
 const isYetToUpload = video.path === "yet-to-upload" || 
                       (Array.isArray(video.tags) && video.tags.includes("yet-to-upload"));
  
 // ✅ Create compact button group
 const buttons = [
  {
      label: "P",
      title: "Play video",
      color: "#28a745",
      onClick: () => inlineVideoPlayer.play(video, 'random', index)
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
   color: "#6f42c1",
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
       if (typeof refreshAllLists === 'function') refreshAllLists();
   } catch (err) {
       console.error('DB refresh failed:', err);
       alert(`Refresh failed: ${err.message}`);
   }
}
},
{
label: "Refresh Folder",
title: "Refresh the folder containing this file",
color: "#17a2b8",
onClick: async (e) => {
   e.stopPropagation();
   if (typeof window.showRefreshFolderConfirmModal === 'function') {
       const confirmed = await window.showRefreshFolderConfirmModal(video);
       if (!confirmed) return;
   }
   if (typeof window.refreshVideoFolder === 'function') {
       try {
           await window.refreshVideoFolder(video);
       } catch (err) {
           console.error('Folder refresh failed:', err);
           alert(`Folder refresh failed: ${err.message}`);
       }
   } else {
       alert('Folder refresh not available');
   }
}
},
{
label: "Refresh",
 title: "Refresh",
 color: "#17a2b8",
 disabled: isYetToUpload,
 onClick: async (e) => {
     e.stopPropagation();
     try {
         await refreshSingleVideoComprehensive(video);
         
         // Refresh tag dropdowns
         if (typeof populateTagDropdowns === 'function') {
             await populateTagDropdowns();
         }
         
         // Re-render list
         window.skipSearchScroll = true;
         if (typeof filterDisplayedByFilename === 'function') {
             await filterDisplayedByFilename();
         }
         
         console.log(`Refreshed main list item: ${video.filename}`);
     } catch (err) {
         console.error('Failed to refresh item:', err);
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

const btnContainer = createCompactButtonGroup(buttons, 5);

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

container.appendChild(li);
});

updateBasketHighlights();
}

window.renderVideoList = renderVideoList;

/**
* Append a chunk of videos to an existing container (for pagination)
* Each video name/path is clickable to add it to the basket
*/

function appendVideoList(videos, containerId) {
const container = document.getElementById(containerId);
if (!container) return;

videos.forEach((video, index) => {
  const li = document.createElement('li');
  li.style.marginBottom = "4px";

  const vidId = video.oneDriveId ?? video.idFromAPI ?? null;
  li.dataset.videoId = vidId;

  // ✅ Snapshot the global index NOW, into a local const the onClick
  // closure below can capture - paginationState.currentEndIndex itself
  // keeps changing as more chunks load, so reading it lazily inside the
  // closure (at click time, not render time) was giving stale/wrong
  // indexes for every row rendered before the most recent chunk.
  const globalIndex = paginationState.currentEndIndex + index;

// Display name/path
const nameSpan = document.createElement("span");
nameSpan.textContent = `${globalIndex + 1}. `;
nameSpan.style.whiteSpace = "normal";
nameSpan.style.wordBreak = "break-word";
nameSpan.style.overflowWrap = "break-word";

// Add clickable path
const pathFragment = createClickablePath(video, true);
pathFragment.childNodes.forEach(node => {
if (node.nodeType === 1) {
  node.style.fontSize = "0.75rem";
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
 if (video.inCatalogue === false) {
     const notInCatSpan = document.createElement("span");
     notInCatSpan.className = "not-in-catalogue-badge";
     notInCatSpan.textContent = "⚠";
     notInCatSpan.title = "Not in the SQLite catalogue — scores and bookmarks stay on this device";
     li.appendChild(notInCatSpan);
 }

 // Size + Duration display (skip for "yet-to-upload" videos)
 const sizeDurSpan = document.createElement("span");
  if (video.path === "yet-to-upload" || (Array.isArray(video.tags) && video.tags.includes("yet-to-upload"))) {
      sizeDurSpan.textContent = "";
  } else {
      sizeDurSpan.textContent = ` [${formatFileSize(video.sizeBytes)}, ${formatDuration(video.durationMs)}]`;
  }
  sizeDurSpan.style.marginLeft = "6px";
  sizeDurSpan.style.display = "inline";
  li.appendChild(sizeDurSpan);

// ✅ Check if yet-to-upload
  const isYetToUpload = video.path === "yet-to-upload" || 
                        (Array.isArray(video.tags) && video.tags.includes("yet-to-upload"));
  
  // ✅ Create compact button group
 const buttons = [
  {
      label: "P",
      title: "Play video",
      color: "#28a745",
      onClick: () => inlineVideoPlayer.play(video, 'main', globalIndex)
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
   color: "#6f42c1",
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
       if (typeof refreshAllLists === 'function') refreshAllLists();
   } catch (err) {
       console.error('DB refresh failed:', err);
       alert(`Refresh failed: ${err.message}`);
   }
}
},
{
label: "Refresh Folder",
title: "Refresh the folder containing this file",
color: "#17a2b8",
onClick: async (e) => {
   e.stopPropagation();
   if (typeof window.showRefreshFolderConfirmModal === 'function') {
       const confirmed = await window.showRefreshFolderConfirmModal(video);
       if (!confirmed) return;
   }
   if (typeof window.refreshVideoFolder === 'function') {
       try {
           await window.refreshVideoFolder(video);
       } catch (err) {
           console.error('Folder refresh failed:', err);
           alert(`Folder refresh failed: ${err.message}`);
       }
   } else {
       alert('Folder refresh not available');
   }
}
},
{
label: "Refresh",
 title: "Refresh",
 color: "#17a2b8",
 disabled: isYetToUpload,
 onClick: async (e) => {
     e.stopPropagation();
     try {
         await refreshSingleVideoComprehensive(video);
         
         // Refresh tag dropdowns
         if (typeof populateTagDropdowns === 'function') {
             await populateTagDropdowns();
         }
         
         // Re-render list
         window.skipSearchScroll = true;
         if (typeof filterDisplayedByFilename === 'function') {
             await filterDisplayedByFilename();
         }
         
         console.log(`Refreshed main list item: ${video.filename}`);
     } catch (err) {
         console.error('Failed to refresh item:', err);
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

const btnContainer = createCompactButtonGroup(buttons, 5);
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

 // ▶ Finally append the list item to the container
 container.appendChild(li);
});

// ► Update basket highlights after rendering chunk
updateBasketHighlights();
}

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
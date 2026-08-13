// ===== random-panel.js =====

let randomPanelOpen = false;

function toggleRandomPlaylistPanel(open = null) {
 const panel = document.getElementById("randomPlaylistPanel");
 if (!panel) return;
 
 const isOpening = open ?? !panel.classList.contains("random-panel-open");
 panel.classList.toggle("random-panel-open", isOpening);
 randomPanelOpen = isOpening;
 
 console.log(`Random playlist panel ${isOpening ? 'opened' : 'closed'}`);
}

function renderRandomPlaylistInPanel(videos) {
const panelList = document.getElementById("randomPlaylistPanelList");
if (!panelList) return;

// Show random section, hide tagged section
const randomSection = document.getElementById("panelRandomSection");
const taggedSection = document.getElementById("panelTaggedSection");
if (randomSection) randomSection.style.display = 'flex'; // ✅ Changed from 'block' to 'flex'
if (taggedSection) taggedSection.style.display = 'none';

// ✅ Force scroll properties
setTimeout(() => {
 if (panelList) {
   panelList.style.overflowY = 'scroll';
   panelList.style.webkitOverflowScrolling = 'touch';
   console.log('Forced scroll on randomPlaylistPanelList');
 }
}, 0);

panelList.innerHTML = '';
 
 // Add total size header
 const totalSize = videos.reduce((acc, v) => acc + (v.sizeBytes || 0), 0);
 const totalDiv = document.createElement("div");
 totalDiv.className = "randomlist-total-size";
 totalDiv.style.fontWeight = "bold";
 totalDiv.style.fontSize = "0.75rem"; // ✅ Match small font
 totalDiv.style.padding = "6px";
 totalDiv.style.background = "#b3d9ff";
 totalDiv.style.borderBottom = "1px solid #88c1ff";
 totalDiv.textContent = `Total size: ${formatFileSize(totalSize)}`;
 panelList.appendChild(totalDiv);
 
 // Render each video
 videos.forEach((video, index) => {
   const li = document.createElement('li');
   
   const vidId = video.oneDriveId ?? video.idFromAPI ?? null;
   li.dataset.videoId = vidId;
   
// Display name/path
const nameSpan = document.createElement("span");
nameSpan.textContent = `${index + 1}. `;
nameSpan.style.fontSize = "0.75rem";

// ✅ Add clickable path
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
 
 // Size + Duration
 const sizeDurSpan = document.createElement("span");
  if (video.path === "yet-to-upload" || (Array.isArray(video.tags) && video.tags.includes("yet-to-upload"))) {
    sizeDurSpan.textContent = "";
  } else {
    sizeDurSpan.textContent = ` [${formatFileSize(video.sizeBytes)}, ${formatDuration(video.durationMs)}]`;
  }
  sizeDurSpan.style.marginLeft = "6px";
  sizeDurSpan.style.fontSize = "0.65rem";
  sizeDurSpan.style.color = "#666";
  sizeDurSpan.style.display = "inline";
  li.appendChild(sizeDurSpan);
   
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
       updateBasketHighlights();
       updateRandomPanelHighlights();
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

const btnContainer = createCompactButtonGroup(buttons, 5);
 li.appendChild(btnContainer);
 
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
 
  panelList.appendChild(li);
 });
 
 updateRandomPanelHighlights();
}

function updateRandomPanelHighlights() {
// Update both random and tagged lists in panel
const allItems = document.querySelectorAll('#randomPlaylistPanelList li, #panelTaggedList li');
allItems.forEach(li => {
  const videoIdInLi = li.dataset.videoId;
  if (basketVideos.some(v => v.oneDriveId === videoIdInLi)) {
    li.classList.add('basket-added');
  } else {
    li.classList.remove('basket-added');
  }
});
}

// Export globally
window.toggleRandomPlaylistPanel = toggleRandomPlaylistPanel;
window.renderRandomPlaylistInPanel = renderRandomPlaylistInPanel;
window.updateRandomPanelHighlights = updateRandomPanelHighlights;


// =========================================
// RENDER TAGGED LIST IN PANEL
// =========================================
function renderTaggedListInPanel(videos, paginationState) {
const panelList = document.getElementById("panelTaggedList");
if (!panelList) return;

// Show tagged section, hide random section
const randomSection = document.getElementById("panelRandomSection");
const taggedSection = document.getElementById("panelTaggedSection");
if (randomSection) randomSection.style.display = 'none';
if (taggedSection) taggedSection.style.display = 'flex'; // ✅ Changed from 'block' to 'flex'

// ✅ Debug: Log heights to console
setTimeout(() => {
  console.log('Panel heights:', {
    panel: document.getElementById('randomPlaylistPanel')?.offsetHeight,
    section: taggedSection?.offsetHeight,
    header: document.querySelector('.panel-section-header')?.offsetHeight,
    list: panelList?.offsetHeight,
    pagination: document.getElementById('panelPaginationControls')?.offsetHeight
  });
}, 100);
 
 panelList.innerHTML = '';
 
 // Render videos using pagination state
 const startIndex = paginationState.currentEndIndex;
 const videosToRender = videos.slice(startIndex, startIndex + paginationState.pageSize);
 
 videosToRender.forEach((video, relativeIndex) => {
   const globalIndex = startIndex + relativeIndex;
   const li = document.createElement('li');
   
   const vidId = video.oneDriveId ?? video.idFromAPI ?? null;
   li.dataset.videoId = vidId;
   
   // Display name/path
   const nameSpan = document.createElement("span");
   nameSpan.textContent = `${globalIndex + 1}. `;
   nameSpan.style.fontSize = "0.75rem";
   
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
  
  // Size + Duration
  const sizeDurSpan = document.createElement("span");
   if (video.path === "yet-to-upload" || (Array.isArray(video.tags) && video.tags.includes("yet-to-upload"))) {
     sizeDurSpan.textContent = "";
   } else {
     sizeDurSpan.textContent = ` [${formatFileSize(video.sizeBytes)}, ${formatDuration(video.durationMs)}]`;
   }
   sizeDurSpan.style.marginLeft = "6px";
   sizeDurSpan.style.fontSize = "0.65rem";
   sizeDurSpan.style.color = "#666";
   sizeDurSpan.style.display = "inline";
   li.appendChild(sizeDurSpan);
   
   // Create compact button group (same as main list)
   const buttons = [
    {
      label: "P",
      title: "Play video",
      color: "#28a745",
      onClick: () => {
        inlineVideoPlayer.play(video, 'main', globalIndex);
      }
    },
    {
      label: "D",
      title: "Download",
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
        updateBasketHighlights();
        updateRandomPanelHighlights();
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
   
   const btnContainer = createCompactButtonGroup(buttons, 5);
   li.appendChild(btnContainer);
   
   // Click anywhere on list item (except buttons and clickable tags) to open rename modal
   li.style.cursor = 'pointer';
   li.addEventListener('click', async (e) => {
     if (e.target.closest('.compact-btn-group')) return;
     if (e.target.closest('button')) return;
     if (e.target.style.textDecoration === 'underline') return;
     
     if (typeof window.showRenameModal === 'function') {
       await window.showRenameModal(video);
     }
   });
   
   panelList.appendChild(li);
 });
 
 // Update stats
const totalSize = videos.reduce((acc, v) => acc + (v.sizeBytes || 0), 0);
const statsEl = document.getElementById("panelVideoStats");
if (statsEl) {
  statsEl.textContent = `Items: ${videos.length} | Total size: ${formatFileSize(totalSize)}`;
}

// ✅ Force scroll properties after render
setTimeout(() => {
  if (panelList) {
    panelList.style.overflowY = 'scroll';
    panelList.style.webkitOverflowScrolling = 'touch';
    console.log('Forced scroll on panelTaggedList');
  }
}, 0);

updateRandomPanelHighlights();
}

function appendToTaggedListInPanel(videos, paginationState) {
 const panelList = document.getElementById("panelTaggedList");
 if (!panelList) return;
 
 const startIndex = paginationState.currentEndIndex;
 
 videos.forEach((video, relativeIndex) => {
   const globalIndex = startIndex + relativeIndex;
   const li = document.createElement('li');
   
   const vidId = video.oneDriveId ?? video.idFromAPI ?? null;
   li.dataset.videoId = vidId;
   
   // Display name/path
   const nameSpan = document.createElement("span");
   nameSpan.textContent = `${globalIndex + 1}. `;
   nameSpan.style.fontSize = "0.75rem";
   
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
  
  // Size + Duration
  const sizeDurSpan = document.createElement("span");
   if (video.path === "yet-to-upload" || (Array.isArray(video.tags) && video.tags.includes("yet-to-upload"))) {
     sizeDurSpan.textContent = "";
   } else {
     sizeDurSpan.textContent = ` [${formatFileSize(video.sizeBytes)}, ${formatDuration(video.durationMs)}]`;
   }
   sizeDurSpan.style.marginLeft = "6px";
   sizeDurSpan.style.fontSize = "0.65rem";
   sizeDurSpan.style.color = "#666";
   sizeDurSpan.style.display = "inline";
   li.appendChild(sizeDurSpan);
   
   // Create compact button group (same as main list)
   const buttons = [
    {
      label: "P",
      title: "Play video",
      color: "#28a745",
      onClick: () => {
        inlineVideoPlayer.play(video, 'main', globalIndex);
      }
    },
    {
      label: "D",
      title: "Download",
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
        updateBasketHighlights();
        updateRandomPanelHighlights();
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
   
   const btnContainer = createCompactButtonGroup(buttons, 5);
   li.appendChild(btnContainer);
   
   // Click anywhere on list item (except buttons and clickable tags) to open rename modal
   li.style.cursor = 'pointer';
   li.addEventListener('click', async (e) => {
     if (e.target.closest('.compact-btn-group')) return;
     if (e.target.closest('button')) return;
     if (e.target.style.textDecoration === 'underline') return;
     
     if (typeof window.showRenameModal === 'function') {
       await window.showRenameModal(video);
     }
   });
   
   panelList.appendChild(li);
 });
 
 // Update pagination controls
 paginationState.currentEndIndex = startIndex + videosToRender.length;
 const paginationControls = document.getElementById("panelPaginationControls");
 if (paginationControls) {
   paginationControls.style.display = paginationState.currentEndIndex >= paginationState.allVideos.length ? 'none' : 'flex';
 }
 
 updateRandomPanelHighlights();
}

// Export globally
window.renderTaggedListInPanel = renderTaggedListInPanel;
window.appendToTaggedListInPanel = appendToTaggedListInPanel;

// =========================================
// PANEL SORT BUTTON HANDLERS
// =========================================
function updatePanelSortButton(btnId, sortState) {
 const btn = document.getElementById(btnId);
 if (!btn) return;
 
 const labels = {
   'none': btn.textContent.split(' ')[0], // Base label without arrows
   'asc': btn.textContent.split(' ')[0] + ' ↑',
   'desc': btn.textContent.split(' ')[0] + ' ↓'
 };
 
 btn.textContent = labels[sortState] || labels['none'];
 btn.dataset.sortState = sortState;
 
 if (sortState === 'none') {
   btn.style.background = '#555';
 } else {
   btn.style.background = '#007bff';
 }
}

window.addEventListener("DOMContentLoaded", () => {

 // Panel search box handlers - PRIMARY in landscape mode
 const panelSearchBox = document.getElementById("panelSearchBox");
 const panelSearchClearX = document.getElementById("panelSearchClearX");
 
 if (panelSearchBox && panelSearchClearX) {
   // Check if in landscape mobile mode
   const checkLandscapeMobile = () => {
     const isLandscape = window.matchMedia('(orientation: landscape)').matches;
     const isMobile = window.innerWidth <= 1024;
     return isLandscape && isMobile;
   };
   
   // Prevent native mobile browser auto-scroll-into-view when focusing
   // the fixed/bottom-docked panel filter bar in portrait mode.
   panelSearchBox.addEventListener("focus", () => {
       const isMobilePortrait = window.innerWidth <= 768 && window.matchMedia('(orientation: portrait)').matches;
       if (!isMobilePortrait) return;
       const resetScroll = () => window.scrollTo(0, 0);
       requestAnimationFrame(resetScroll);
       setTimeout(resetScroll, 0);
       setTimeout(resetScroll, 100);
       setTimeout(resetScroll, 300);
   });

   // Sync WITH main search box (so both stay in sync)
  panelSearchBox.addEventListener("input", () => {
    const mainSearchBox = document.getElementById("filenameSearchBox");
    if (mainSearchBox) {
      mainSearchBox.value = panelSearchBox.value;
      const mainClearX = document.getElementById("clearSearchX");
      if (mainClearX) {
        mainClearX.style.display = panelSearchBox.value ? "block" : "none";
      }
    }
    
    // Show/hide panel clear X
    panelSearchClearX.style.display = panelSearchBox.value ? "block" : "none";
    
    // Prevent scroll jump while typing in the panel filter bar
    window.skipSearchScroll = true;
    
    // Trigger filter
    if (typeof filterDisplayedByFilename === 'function') {
      filterDisplayedByFilename();
    }
  });
  
  // ✅ Enter key to blur and dismiss keyboard (all devices)
  panelSearchBox.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === "Return") {
      e.preventDefault();
      panelSearchBox.blur();
      console.log("Panel search box blurred via Enter key");
    }
  });
  
  // Clear button
  panelSearchClearX.addEventListener("click", () => {
    panelSearchBox.value = "";
    panelSearchClearX.style.display = "none";
     
     // Clear main search too
     const mainSearchBox = document.getElementById("filenameSearchBox");
     if (mainSearchBox) {
       mainSearchBox.value = "";
       const mainClearX = document.getElementById("clearSearchX");
       if (mainClearX) mainClearX.style.display = "none";
     }
     
     if (typeof filterDisplayedByFilename === 'function') {
       filterDisplayedByFilename();
     }
     panelSearchBox.focus();
   });
   
   // Also listen to main search box to sync back to panel
   const mainSearchBox = document.getElementById("filenameSearchBox");
   if (mainSearchBox) {
     const syncToPanelSearch = () => {
       panelSearchBox.value = mainSearchBox.value;
       panelSearchClearX.style.display = mainSearchBox.value ? "block" : "none";
     };
     
     // Use MutationObserver to detect value changes from other sources
     const observer = new MutationObserver(syncToPanelSearch);
     observer.observe(mainSearchBox, { attributes: true, attributeFilter: ['value'] });
     
     // Also listen to input event
     mainSearchBox.addEventListener('input', syncToPanelSearch);
   }
 }

// Panel sort button handlers
 document.getElementById("panelSortSizeBtn")?.addEventListener("click", () => {
  const states = ['none', 'asc', 'desc'];
  const currentIndex = states.indexOf(currentSortState);
  currentSortState = states[(currentIndex + 1) % states.length];
  
  // Reset other sorts
  currentCreatedSortState = 'none';
  currentModifiedSortState = 'none';
  currentFilenameSortState = 'none';
  currentScoreSortState = 'none';
  updatePanelSortButton('panelSortCreatedBtn', 'none');
  updatePanelSortButton('panelSortModifiedBtn', 'none');
  updatePanelSortButton('panelSortFilenameBtn', 'none');
  updatePanelSortButton('panelSortScoreBtn', 'none');
  updatePanelSortButton('panelSortSizeBtn', currentSortState);
   
   // Re-render with sort
   if (paginationState.allVideos && paginationState.allVideos.length > 0) {
     const sorted = sortVideosBySize(paginationState.allVideos, currentSortState);
     paginationState.allVideos = sorted;
     paginationState.currentEndIndex = 0;
     
     const panelList = document.getElementById("panelTaggedList");
     if (panelList) {
       panelList.innerHTML = "";
       window.appendToTaggedListInPanel(sorted.slice(0, 25), paginationState);
     }
   }
 });
 
 document.getElementById("panelSortCreatedBtn")?.addEventListener("click", () => {
  const states = ['none', 'asc', 'desc'];
  const currentIndex = states.indexOf(currentCreatedSortState);
  currentCreatedSortState = states[(currentIndex + 1) % states.length];
  
  // Reset other sorts
  currentSortState = 'none';
  currentModifiedSortState = 'none';
  currentFilenameSortState = 'none';
  currentScoreSortState = 'none';
  updatePanelSortButton('panelSortSizeBtn', 'none');
  updatePanelSortButton('panelSortModifiedBtn', 'none');
  updatePanelSortButton('panelSortFilenameBtn', 'none');
  updatePanelSortButton('panelSortScoreBtn', 'none');
  updatePanelSortButton('panelSortCreatedBtn', currentCreatedSortState);
   
   if (paginationState.allVideos && paginationState.allVideos.length > 0) {
     const sorted = sortVideosByCreated(paginationState.allVideos, currentCreatedSortState);
     paginationState.allVideos = sorted;
     paginationState.currentEndIndex = 0;
     
     const panelList = document.getElementById("panelTaggedList");
     if (panelList) {
       panelList.innerHTML = "";
       window.appendToTaggedListInPanel(sorted.slice(0, 25), paginationState);
     }
   }
 });
 
 document.getElementById("panelSortModifiedBtn")?.addEventListener("click", () => {
  const states = ['none', 'asc', 'desc'];
  const currentIndex = states.indexOf(currentModifiedSortState);
  currentModifiedSortState = states[(currentIndex + 1) % states.length];
  
  // Reset other sorts
  currentSortState = 'none';
  currentCreatedSortState = 'none';
  currentFilenameSortState = 'none';
  currentScoreSortState = 'none';
  updatePanelSortButton('panelSortSizeBtn', 'none');
  updatePanelSortButton('panelSortCreatedBtn', 'none');
  updatePanelSortButton('panelSortFilenameBtn', 'none');
  updatePanelSortButton('panelSortScoreBtn', 'none');
  updatePanelSortButton('panelSortModifiedBtn', currentModifiedSortState);
   
   if (paginationState.allVideos && paginationState.allVideos.length > 0) {
     const sorted = sortVideosByModified(paginationState.allVideos, currentModifiedSortState);
     paginationState.allVideos = sorted;
     paginationState.currentEndIndex = 0;
     
     const panelList = document.getElementById("panelTaggedList");
     if (panelList) {
       panelList.innerHTML = "";
       window.appendToTaggedListInPanel(sorted.slice(0, 25), paginationState);
     }
   }
 });
 
document.getElementById("panelSortFilenameBtn")?.addEventListener("click", () => {
  const states = ['none', 'asc', 'desc'];
  const currentIndex = states.indexOf(currentFilenameSortState);
  currentFilenameSortState = states[(currentIndex + 1) % states.length];
  
  // Reset other sorts
  currentSortState = 'none';
  currentCreatedSortState = 'none';
  currentModifiedSortState = 'none';
  currentScoreSortState = 'none';
  updatePanelSortButton('panelSortSizeBtn', 'none');
  updatePanelSortButton('panelSortCreatedBtn', 'none');
  updatePanelSortButton('panelSortModifiedBtn', 'none');
  updatePanelSortButton('panelSortScoreBtn', 'none');
  updatePanelSortButton('panelSortFilenameBtn', currentFilenameSortState);
  
  if (paginationState.allVideos && paginationState.allVideos.length > 0) {
    const sorted = sortVideosByFilename(paginationState.allVideos, currentFilenameSortState);
    paginationState.allVideos = sorted;
    paginationState.currentEndIndex = 0;
    
    const panelList = document.getElementById("panelTaggedList");
    if (panelList) {
      panelList.innerHTML = "";
      window.appendToTaggedListInPanel(sorted.slice(0, 25), paginationState);
    }
  }
});

document.getElementById("panelSortScoreBtn")?.addEventListener("click", () => {
  const states = ['none', 'asc', 'desc'];
  const currentIndex = states.indexOf(currentScoreSortState);
  currentScoreSortState = states[(currentIndex + 1) % states.length];
  
  // Reset other sorts
  currentSortState = 'none';
  currentCreatedSortState = 'none';
  currentModifiedSortState = 'none';
  currentFilenameSortState = 'none';
  updatePanelSortButton('panelSortSizeBtn', 'none');
  updatePanelSortButton('panelSortCreatedBtn', 'none');
  updatePanelSortButton('panelSortModifiedBtn', 'none');
  updatePanelSortButton('panelSortFilenameBtn', 'none');
  updatePanelSortButton('panelSortScoreBtn', currentScoreSortState);
  
  if (paginationState.allVideos && paginationState.allVideos.length > 0) {
    const sorted = sortVideosByScore(paginationState.allVideos, currentScoreSortState);
    paginationState.allVideos = sorted;
    paginationState.currentEndIndex = 0;
    
    const panelList = document.getElementById("panelTaggedList");
    if (panelList) {
      panelList.innerHTML = "";
      window.appendToTaggedListInPanel(sorted.slice(0, 25), paginationState);
    }
  }
});

// ✅ Panel pagination button handlers
 document.querySelectorAll(".panelPageSizeBtn").forEach(btn => {
   btn.addEventListener("click", () => {
     const size = parseInt(btn.dataset.size, 10);
     const nextEnd = Math.min(
       paginationState.currentEndIndex + size,
       paginationState.allVideos.length
     );
     const chunk = paginationState.allVideos.slice(paginationState.currentEndIndex, nextEnd);
     
     if (typeof window.appendToTaggedListInPanel === 'function') {
       window.appendToTaggedListInPanel(chunk, paginationState);
     }
   });
 });
 
// Swipe to dismiss (mobile only)
 if (window.innerWidth <= 1024) {
   let touchStartX = 0;
   let touchStartY = 0;
   let isSwiping = false;
   let isScrolling = false;
   let scrollableList = null;
   let isInteractiveItem = false;
   
   const randomPanel = document.getElementById("randomPlaylistPanel");
   if (randomPanel) {
     randomPanel.addEventListener("touchstart", e => {
      // ✅ Also check for input fields (panel search box)
      const interactiveEl = e.target.closest('a, button, input');
      isInteractiveItem = !!interactiveEl;
      
      if (isInteractiveItem) return;
      
      e.stopPropagation();
      
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      isSwiping = false;
      isScrolling = false;
      
      // ✅ Check for BOTH lists
      scrollableList = e.target.closest('#randomPlaylistPanelList, #panelTaggedList');
    }, { passive: false, capture: true });
     
     randomPanel.addEventListener("touchmove", e => {
       if (isInteractiveItem) return;
       
       e.stopPropagation();
       
       const touchCurrentX = e.touches[0].clientX;
       const touchCurrentY = e.touches[0].clientY;
       const deltaX = Math.abs(touchCurrentX - touchStartX);
       const deltaY = Math.abs(touchCurrentY - touchStartY);
       
       if (!isSwiping && !isScrolling && (deltaX > 5 || deltaY > 5)) {
         if (deltaX > deltaY) {
           isSwiping = true;
         } else {
           isScrolling = true;
         }
       }
       
       if (isSwiping || !scrollableList) {
         e.preventDefault();
       }
     }, { passive: false, capture: true });
     
     randomPanel.addEventListener("touchend", e => {
       if (isInteractiveItem) {
         isInteractiveItem = false;
         return;
       }
       
       e.stopPropagation();
       
       const touchEndX = e.changedTouches[0].clientX;
       
       // Swipe right to close
       if (isSwiping && touchEndX - touchStartX > 50) {
         e.preventDefault();
         randomPanel.classList.remove("random-panel-open");
       }
       
       isSwiping = false;
       isScrolling = false;
       scrollableList = null;
       isInteractiveItem = false;
     }, { passive: false, capture: true });
     
     randomPanel.addEventListener("touchcancel", e => {
       isInteractiveItem = false;
       isSwiping = false;
       isScrolling = false;
       scrollableList = null;
     }, { passive: false, capture: true });
   }
 }
});
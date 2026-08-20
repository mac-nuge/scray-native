// =========================================
// Account Status Bar Functions (now no-op for page)
// =========================================

// In-pill progress updates handled separately; no longer show on page.
const accountStatusBars = {};

function initAccountStatusBar(username) {
  // Just create an entry to track if needed, but no DOM
  if (!accountStatusBars[username]) {
      accountStatusBars[username] = { textContent: '' };
  }
  return accountStatusBars[username];
}

function updateAccountStatus(username, text) {
  // We skip writing to any page element — pill buttons use their own text updates
  if (accountStatusBars[username]) {
      accountStatusBars[username].textContent = text;
  }
}


/**
* Copy text to clipboard and show temporary feedback tooltip
* @param {string} text - Text to copy
* @param {Event} event - Click event to position tooltip (optional)
*/
function copyToClipboardWithFeedback(text, event = null) {
navigator.clipboard.writeText(text).then(() => {
    // Create tooltip
    const tooltip = document.createElement('div');
    tooltip.className = 'copy-feedback-tooltip';
    tooltip.textContent = 'Copied!';
    
    // Position tooltip
    if (event && event.target) {
        const rect = event.target.getBoundingClientRect();
        tooltip.style.position = 'fixed';
        
        // ✅ Better positioning for context menu items vs buttons
        const isContextMenuItem = event.target.classList.contains('context-menu-item');
        
        if (isContextMenuItem) {
            // Context menu item - position to the left
            tooltip.style.left = rect.left + 'px';
            tooltip.style.top = (rect.top + rect.height / 2) + 'px';
            tooltip.style.transform = 'translateY(-50%)';
        } else {
            // Button - position above
            tooltip.style.left = rect.left + (rect.width / 2) + 'px';
            tooltip.style.top = (rect.top - 30) + 'px';
            tooltip.style.transform = 'translateX(-50%)';
        }
    } else {
        // Fallback: center of screen
        tooltip.style.position = 'fixed';
        tooltip.style.left = '50%';
        tooltip.style.top = '20%';
        tooltip.style.transform = 'translateX(-50%)';
    }
       
       document.body.appendChild(tooltip);
       
       // Fade in
       setTimeout(() => tooltip.classList.add('show'), 10);
       
       // Fade out and remove
       setTimeout(() => {
           tooltip.classList.remove('show');
           setTimeout(() => tooltip.remove(), 300);
       }, 1500);
   }).catch(err => {
       console.error('Failed to copy:', err);
       alert('Failed to copy to clipboard');
   });
}

/**
* Show temporary feedback tooltip above a button
* @param {string} message - Message to display
* @param {Event} event - Click event to position tooltip
*/
function showButtonFeedback(message, event) {
// Create tooltip
const tooltip = document.createElement('div');
tooltip.className = 'copy-feedback-tooltip';
tooltip.textContent = message;

// Position tooltip above button
if (event && event.target) {
const rect = event.target.getBoundingClientRect();
tooltip.style.position = 'fixed';

// ✅ Mobile: smart positioning based on button location
const isMobile = window.innerWidth <= 768;
if (isMobile) {
    // Check if button is on left side of screen (< 30% from left)
    const isLeftSide = rect.left < (window.innerWidth * 0.3);
    
    if (isLeftSide) {
        // Button on left - position tooltip using left edge
        tooltip.style.left = rect.left + 'px';
        tooltip.style.right = 'auto';
        tooltip.style.top = (rect.top - 35) + 'px';
        tooltip.style.transform = 'none';
    } else {
        // Button on right or center - position using right edge
        tooltip.style.left = 'auto';
        tooltip.style.right = (window.innerWidth - rect.right + 10) + 'px';
        tooltip.style.top = (rect.top - 35) + 'px';
        tooltip.style.transform = 'none';
    }
} else {
    // Desktop: center above button
    tooltip.style.left = rect.left + (rect.width / 2) + 'px';
    tooltip.style.top = (rect.top - 35) + 'px';
    tooltip.style.transform = 'translateX(-50%)';
}
} else {
   // Fallback: center of screen
   tooltip.style.position = 'fixed';
   tooltip.style.left = '50%';
   tooltip.style.top = '20%';
   tooltip.style.transform = 'translateX(-50%)';
}

document.body.appendChild(tooltip);

// Fade in
setTimeout(() => tooltip.classList.add('show'), 10);

// Fade out and remove
setTimeout(() => {
   tooltip.classList.remove('show');
   setTimeout(() => tooltip.remove(), 300);
}, 1500);
}

// Export globally
window.copyToClipboardWithFeedback = copyToClipboardWithFeedback;
window.showButtonFeedback = showButtonFeedback;

/**
* Smart scroll to search box - scrolls container on desktop, window on mobile
* @param {HTMLElement} searchBox - The search box element to scroll to
*/
function scrollToSearchBox(searchBox) {
if (!searchBox) return;

// Check if on desktop
const isDesktop = window.innerWidth >= 769;

if (isDesktop) {
// Check if player is hidden (controls moved to basket column)
const isPlayerHidden = document.body.classList.contains('video-player-hidden');

if (isPlayerHidden) {
  // Player hidden: left column has no max-height, so scroll the window instead
  const yOffset = -10;
  const y = searchBox.getBoundingClientRect().top + window.pageYOffset + yOffset;
  window.scrollTo({ top: y, behavior: 'smooth' });
  console.log('Scrolled window to search box (player hidden)');
  return;
}

// Player visible: check if search box is inside a scrollable container
const leftColumn = document.getElementById('desktopLeftColumn');

if (leftColumn && leftColumn.contains(searchBox)) {
  // Scroll the left column container
  const columnRect = leftColumn.getBoundingClientRect();
  const searchRect = searchBox.getBoundingClientRect();
  const relativeTop = searchRect.top - columnRect.top;
  const targetScroll = leftColumn.scrollTop + relativeTop - 10; // 10px buffer
  
  leftColumn.scrollTo({ top: targetScroll, behavior: 'smooth' });
  console.log('Scrolled left column to search box (player visible)');
  return;
}
}

// Fallback: scroll the whole window (mobile or if not in container)
const yOffset = -10;
const y = searchBox.getBoundingClientRect().top + window.pageYOffset + yOffset;
window.scrollTo({ top: y, behavior: 'smooth' });
console.log('Scrolled window to search box (fallback)');
}

// Export globally
window.scrollToSearchBox = scrollToSearchBox;

/**
* Show modal asking user how to handle clicked tag (MOBILE ONLY)
* @param {string} tagName - The tag name (lowercase with hyphens)
* @param {string} displayName - The original display name (for UI)
*/
function showTagActionModal(tagName, displayName) {
return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'basket-json-modal';
    modal.innerHTML = `
        <div class="basket-json-modal-content" style="max-width: 300px;">
            <h3 style="font-size: 1rem; margin-bottom: 16px;">Add Tag</h3>
            <p style="margin-bottom: 16px; color: #666; font-size: 0.9rem;">"${displayName}"</p>
            <div style="display: flex; flex-direction: column; gap: 10px;">
                <button id="tagActionFilterBtn" class="modal-btn modal-btn-primary">
                    🏷️ Filter by Tag
                </button>
                <button id="tagActionSearchBtn" class="modal-btn modal-btn-primary">
                    🔍 Add to Search
                </button>
                <button id="tagActionExcludeBtn" class="modal-btn modal-btn-primary" style="background: #f94144;">
                    🚫 Add to Exclude
                </button>
                <button id="tagActionDefaultExcludeBtn" class="modal-btn modal-btn-primary" style="background: #dc3545;">
                    📊 Default Exclude (SQL)
                </button>
            </div>
            <button id="tagActionCancelBtn" class="modal-btn modal-btn-cancel" style="margin-top: 10px;">Cancel</button>
        </div>
    `;
    document.body.appendChild(modal);
     
     // Filter button
     document.getElementById('tagActionFilterBtn').addEventListener('click', () => {
         modal.remove();
         resolve('filter');
     });
     
     // Search button
     document.getElementById('tagActionSearchBtn').addEventListener('click', () => {
         modal.remove();
         resolve('search');
     });
     
     // Exclude button
    document.getElementById('tagActionExcludeBtn').addEventListener('click', () => {
        modal.remove();
        resolve('exclude');
    });
    
    // Default Exclude button (saves to Excel)
    document.getElementById('tagActionDefaultExcludeBtn').addEventListener('click', () => {
        modal.remove();
        resolve('default-exclude');
    });
    
    // Cancel button
document.getElementById('tagActionCancelBtn').addEventListener('click', () => {
  modal.remove();
  resolve('cancel');
});

// Close on background click
modal.addEventListener('click', (e) => {
  if (e.target === modal) {
      modal.remove();
      resolve('cancel');
  }
});

// ESC key to cancel
const tagActionEscHandler = (e) => {
  if (e.key === 'Escape') {
      modal.remove();
      resolve('cancel');
      document.removeEventListener('keydown', tagActionEscHandler);
  }
};
document.addEventListener('keydown', tagActionEscHandler);
 });
}

window.showTagActionModal = showTagActionModal;

// =========================================
// Helper: Create clickable path with folder tags
// =========================================
function createClickablePath(video, includeFilename = true) {
const container = document.createDocumentFragment();

// Parse path into folders
if (video.path) {
// Remove leading "*" if present (legacy format)
const cleanPath = video.path.startsWith('*') ? video.path.substring(1) : video.path;
const folders = cleanPath.split('/').filter(Boolean);
  
  folders.forEach((folder, index) => {
    // Create clickable span for each folder
    const folderSpan = document.createElement('span');
    folderSpan.textContent = folder;
    folderSpan.style.cursor = 'pointer';
    folderSpan.style.color = '#007bff';
    folderSpan.style.textDecoration = 'underline';
    folderSpan.title = `Click to filter by "${folder}"`;
    
    folderSpan.addEventListener('click', async (e) => {
e.stopPropagation();

// Convert folder name to tag format (lowercase with hyphens)
// ✅ Remove leading * if present
const cleanFolder = folder.startsWith('*') ? folder.substring(1) : folder;
const tagName = cleanFolder.trim().replace(/\s+/g, "-").toLowerCase();
const displayName = cleanFolder;

// ✅ Show modal on all devices
const action = await showTagActionModal(tagName, displayName);
  
  if (action === 'filter') {
     // Original behavior - add to tag filters
     window.commonSelectedTags.add(tagName);
     
     // Find which dropdown contains this tag and select it
     ['Level1', 'Level2', 'Level3', 'All'].forEach(levelName => {
       const selectId = `tagFilter${levelName}Select`;
       const $select = $(`#${selectId}`);
       
       // Check if this dropdown has this tag as an option
       if ($select.find(`option[value="${tagName}"]`).length) {
         const currentVals = $select.val() || [];
         if (!currentVals.includes(tagName)) {
           currentVals.push(tagName);
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

   } else if (action === 'search') {
// New behavior - add to search box
const searchBox = document.getElementById('filenameSearchBox');
if (searchBox) {
  // ✅ Check if in landscape mobile mode
  const isLandscape = window.matchMedia('(orientation: landscape)').matches;
  const isMobile = window.innerWidth <= 1024;
  
  // ✅ Only dismiss panels if NOT in landscape mobile
  if (!(isLandscape && isMobile)) {
      if (typeof toggleBasket === 'function') toggleBasket(false);
      if (typeof toggleHistory === 'function') toggleHistory(false);
      if (typeof toggleRandomPlaylistPanel === 'function') toggleRandomPlaylistPanel(false);
  }
  
  // Replace existing text
  searchBox.value = displayName;
  
  // Trigger search
  const clearX = document.getElementById('clearSearchX');
  if (clearX) clearX.style.display = 'block';
  
  // ✅ Also update panel search box if it exists
  const panelSearchBox = document.getElementById('panelSearchBox');
  const panelSearchClearX = document.getElementById('panelSearchClearX');
  if (panelSearchBox) {
      panelSearchBox.value = displayName;
      if (panelSearchClearX) {
          panelSearchClearX.style.display = 'block';
      }
  }
  
  // ✅ PREVENT panel from auto-opening
  window.skipPanelAutoOpen = true;
  
  if (typeof filterDisplayedByFilename === 'function') {
    filterDisplayedByFilename();
  }
   
   // ✅ Only scroll if NOT in landscape mobile
 if (!(isLandscape && isMobile)) {
     if (typeof scrollToSearchBox === 'function') {
         scrollToSearchBox(searchBox);
     }
 }
   
   // Mobile: don't focus (prevents keyboard)
   // Desktop: focus for convenience
   const isMobileDevice = window.innerWidth <= 768;
   if (!isMobileDevice) {
       searchBox.focus({ preventScroll: true });
       setTimeout(() => { searchBox.select(); }, 50);
   }
 }
} else if (action === 'exclude') {
        // Add to exclude dropdown
        const $excludeSelect = $('#excludeTagSelect');
        if ($excludeSelect.length) {
            // Check if this tag exists in the exclude dropdown options
            if ($excludeSelect.find(`option[value="${tagName}"]`).length) {
                const currentExcludes = $excludeSelect.val() || [];
                if (!currentExcludes.includes(tagName)) {
                    currentExcludes.push(tagName);
                    $excludeSelect.val(currentExcludes).trigger('change');
                    console.log(`Added "${tagName}" to exclude tags`);
                }
            } else {
                console.warn(`Tag "${tagName}" not found in exclude dropdown options`);
            }
        }
    } else if (action === 'default-exclude') {
        // Toggle the tag on the shared exclude_tags table. Pressing it on a
        // tag that's already listed offers to remove it, which is how the
        // list gets pruned. All six copies of this handler across the two
        // apps are one-liners into scray-exclude.js now.
        if (typeof window.handleDefaultExcludeAction === 'function') {
            await window.handleDefaultExcludeAction(tagName, displayName);
        }
    }
 });
    
    container.appendChild(folderSpan);
    
    // Add separator
    if (index < folders.length - 1 || includeFilename) {
      const separator = document.createElement('span');
      separator.textContent = ' / ';
      separator.style.color = '#666';
      container.appendChild(separator);
    }
  });
}

// Add filename if requested
if (includeFilename) {
 // Use clickable filename to make bracket tags clickable
 const filenameFragment = createClickableFilename(video.filename);
 
 // Apply styling to all text nodes (non-MP4 color if needed)
 const isNonMp4 = (video.filename || '').split('.').pop().toLowerCase() !== 'mp4';
 if (isNonMp4) {
   // Wrap in span to apply color
   const wrapper = document.createElement('span');
   wrapper.style.color = '#be7b7bff';
   while (filenameFragment.firstChild) {
     wrapper.appendChild(filenameFragment.firstChild);
   }
   // But keep bracket tags blue and clickable
   wrapper.querySelectorAll('span[style*="underline"]').forEach(span => {
     span.style.color = '#007bff';
   });
   container.appendChild(wrapper);
 } else {
   // Normal color
   const wrapper = document.createElement('span');
   wrapper.style.color = '#333';
   while (filenameFragment.firstChild) {
     wrapper.appendChild(filenameFragment.firstChild);
   }
   // Keep bracket tags blue and clickable
   wrapper.querySelectorAll('span[style*="underline"]').forEach(span => {
     span.style.color = '#007bff';
   });
   container.appendChild(wrapper);
 }
}

return container;
}

// Export globally
window.createClickablePath = createClickablePath;

/**
* Parse filename to make bracket tags clickable
* Example: "video[tag1][tag2].mp4" → "video" + clickable[tag1] + clickable[tag2] + ".mp4"
*/
function createClickableFilename(filename) {
   if (!filename) return document.createTextNode('Unknown');
   
   const container = document.createDocumentFragment();
   const bracketRegex = /\[([^\]]+)\]/g;
   let lastIndex = 0;
   let match;
   
   while ((match = bracketRegex.exec(filename)) !== null) {
       // Add text before bracket
       if (match.index > lastIndex) {
           const textBefore = filename.substring(lastIndex, match.index);
           container.appendChild(document.createTextNode(textBefore));
       }
       
       // Create clickable bracket tag
       const bracketTag = match[1];
       const tagName = bracketTag.trim().replace(/\s+/g, "-").toLowerCase();
       
       const tagSpan = document.createElement('span');
       tagSpan.textContent = `[${bracketTag}]`;
       tagSpan.style.cursor = 'pointer';
       tagSpan.style.color = '#007bff';
       tagSpan.style.textDecoration = 'underline';
       tagSpan.title = `Click to filter by "${tagName}"`;
       
       tagSpan.addEventListener('click', async (e) => {
       e.stopPropagation();
       
       const displayName = bracketTag; // Keep original case and spacing
       
       // ✅ Show modal on all devices
       const action = await showTagActionModal(tagName, displayName);
       
       if (action === 'filter') {
            // Original behavior - add to tag filters
            window.commonSelectedTags.add(tagName);
            
            // Find which dropdown contains this tag and select it
            ['Level1', 'Level2', 'Level3', 'All'].forEach(levelName => {
                const selectId = `tagFilter${levelName}Select`;
                const $select = $(`#${selectId}`);
                
                if ($select.find(`option[value="${tagName}"]`).length) {
                    const currentVals = $select.val() || [];
                    if (!currentVals.includes(tagName)) {
                        currentVals.push(tagName);
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

    } else if (action === 'search') {
// New behavior - add to search box
const searchBox = document.getElementById('filenameSearchBox');
if (searchBox) {
  // ✅ Check if in landscape mobile mode
  const isLandscape = window.matchMedia('(orientation: landscape)').matches;
  const isMobile = window.innerWidth <= 1024;
  
  // ✅ Only dismiss panels if NOT in landscape mobile
  if (!(isLandscape && isMobile)) {
      if (typeof toggleBasket === 'function') toggleBasket(false);
      if (typeof toggleHistory === 'function') toggleHistory(false);
      if (typeof toggleRandomPlaylistPanel === 'function') toggleRandomPlaylistPanel(false);
  }
  
  // Replace existing text
  searchBox.value = displayName;
  
  // Trigger search
  const clearX = document.getElementById('clearSearchX');
  if (clearX) clearX.style.display = 'block';
  
  // ✅ Also update panel search box if it exists
  const panelSearchBox = document.getElementById('panelSearchBox');
  const panelSearchClearX = document.getElementById('panelSearchClearX');
  if (panelSearchBox) {
      panelSearchBox.value = displayName;
      if (panelSearchClearX) {
          panelSearchClearX.style.display = 'block';
      }
  }
  
  // ✅ PREVENT panel from auto-opening
  window.skipPanelAutoOpen = true;
  
  if (typeof filterDisplayedByFilename === 'function') {
    filterDisplayedByFilename();
  }
   
   // ✅ Only scroll if NOT in landscape mobile
 if (!(isLandscape && isMobile)) {
     if (typeof scrollToSearchBox === 'function') {
         scrollToSearchBox(searchBox);
     }
 }
   
   // Mobile: don't focus (prevents keyboard)
   // Desktop: focus for convenience
   const isMobileDevice = window.innerWidth <= 768;
   if (!isMobileDevice) {
       searchBox.focus({ preventScroll: true });
       setTimeout(() => { searchBox.select(); }, 50);
   }
 }
} else if (action === 'exclude') {
// Add to exclude dropdown
const $excludeSelect = $('#excludeTagSelect');
if ($excludeSelect.length) {
    // Check if this tag exists in the exclude dropdown options
    if ($excludeSelect.find(`option[value="${tagName}"]`).length) {
        const currentExcludes = $excludeSelect.val() || [];
        if (!currentExcludes.includes(tagName)) {
            currentExcludes.push(tagName);
            $excludeSelect.val(currentExcludes).trigger('change');
            console.log(`Added "${tagName}" to exclude tags`);
        }
    } else {
        console.warn(`Tag "${tagName}" not found in exclude dropdown options`);
    }
}
} else if (action === 'default-exclude') {
// Shared exclude_tags table — see scray-exclude.js.
if (typeof window.handleDefaultExcludeAction === 'function') {
    await window.handleDefaultExcludeAction(tagName, displayName);
}
}
    });
       
       container.appendChild(tagSpan);
       lastIndex = match.index + match[0].length;
   }
   
   // Add remaining text after last bracket
   if (lastIndex < filename.length) {
       const textAfter = filename.substring(lastIndex);
       container.appendChild(document.createTextNode(textAfter));
   }
   
   return container;
}

window.createClickableFilename = createClickableFilename;

// =========================================
// Clear & Export Functions
// =========================================
window.clearAllVideosCache = async function () {
// ✅ Create modal with text input requiring "clear"
const modal = document.createElement('div');
modal.className = 'file-operation-modal';
modal.innerHTML = `
   <div class="file-operation-modal-content">
       <h3 style="color: #f44336;">⚠️ Clear Entire Database</h3>
       <p class="file-operation-warning">This will permanently delete ALL videos from IndexedDB.</p>
       <p style="margin-bottom: 16px;">Type <strong>clear</strong> to confirm:</p>
       <input type="text" id="clearConfirmInput" placeholder="Type 'clear' here" 
              style="width: 100%; padding: 10px; border: 2px solid #f44336; border-radius: 4px; font-size: 1rem; box-sizing: border-box;">
       <div class="file-operation-buttons">
           <button id="confirmClearBtn" class="modal-btn modal-btn-danger" disabled>Clear Database</button>
           <button id="cancelClearBtn" class="modal-btn modal-btn-cancel">Cancel</button>
       </div>
   </div>
`;
document.body.appendChild(modal);

const input = document.getElementById('clearConfirmInput');
const confirmBtn = document.getElementById('confirmClearBtn');

// Enable button only when "clear" is typed
input.addEventListener('input', () => {
   if (input.value.toLowerCase() === 'clear') {
       confirmBtn.disabled = false;
       confirmBtn.style.opacity = '1';
   } else {
       confirmBtn.disabled = true;
       confirmBtn.style.opacity = '0.5';
   }
});

// Focus input
setTimeout(() => {
   input.focus();
}, 100);

// Cancel button
document.getElementById('cancelClearBtn').addEventListener('click', () => {
   modal.remove();
});

// Confirm button
confirmBtn.addEventListener('click', async () => {
   if (input.value.toLowerCase() !== 'clear') {
       alert('Please type "clear" to confirm');
       return;
   }
   
   confirmBtn.disabled = true;
   confirmBtn.textContent = 'Clearing...';
   
   try {
       await clearVideos();
       modal.remove();
       alert('Video database has been cleared.');
       
       // Refresh tag dropdowns and clear lists
       if (typeof populateTagDropdowns === 'function') {
           await populateTagDropdowns();
       }
       
       // Clear displayed lists
       document.getElementById("playlist").innerHTML = "";
       document.getElementById("taggedVideosContainer").innerHTML = "";
       
   } catch (err) {
       console.error('Failed to clear database:', err);
       alert(`Failed to clear database: ${err.message}`);
       confirmBtn.disabled = false;
       confirmBtn.textContent = 'Clear Database';
   }
});

// Close on background click
modal.addEventListener('click', (e) => {
   if (e.target === modal) modal.remove();
});

// Enter key to confirm, ESC to cancel
input.addEventListener('keydown', (e) => {
if (e.key === 'Enter' && input.value.toLowerCase() === 'clear') {
    confirmBtn.click();
} else if (e.key === 'Escape') {
    modal.remove();
}
});
};

window.exportIndexedDBToCSV = async function () {
try {
   const includeTags = Array.from(window.commonSelectedTags);
   const excludeTags = $('#excludeTagSelect').val() || [];

   const minDurationMs = getDurationMsFromInputs("minMinutes", "minSeconds");
   const maxDurationMs = getDurationMsFromInputs("maxMinutes", "maxSeconds");

   const searchText    = document.getElementById("filenameSearchBox").value.toLowerCase().trim();
   const tokens        = searchText.split(/\s+/).filter(Boolean);

   let videos = await getFilteredVideos(includeTags, excludeTags, minDurationMs, maxDurationMs);

   if (tokens.length > 0) {
       videos = videos.filter(video => {
           const haystack = `${video.filename} ${video.path}`.toLowerCase();
           return tokens.every(token => haystack.includes(token));
       });
   }

const allVideosInDB = await getAllVideos();

  // ✅ Build filename frequency map for duplicate detection (case insensitive)
  const filenameMap = new Map();
  allVideosInDB.forEach(v => {
      if (v.filename) {
          const lowerName = v.filename.toLowerCase();
          filenameMap.set(lowerName, (filenameMap.get(lowerName) || 0) + 1);
      }
  });

const headers = [
   "id",
   "path",
   "filename",
   "web_url",
   "download_url",
   "size_bytes",
   "duration_ms",
   "created_date",
   "last_modified_date",
   "mime_type",
   "width",
   "height",
   "orientation",
   "bitrate",
   "account_name",
   "account_key",
   "tags",
   "level_1",
   "level_2",
   "level_3",
   "level_4",
   "level_5",
   "yet_to_upload_match",
   "duplicate",
   "rename",
   "write_delete_to_delete",
   "bookmarks"
];

   const rows = videos.map(v => {
       let matchString = "";

       const isYetToUpload =
           v.path === "yet-to-upload" ||
           (Array.isArray(v.tags) && v.tags.includes("yet-to-upload"));

       if (isYetToUpload && v.filename) {
           const targetName = v.filename.toLowerCase().replace(/,+$/, "");

           const match = allVideosInDB.find(dbVid =>
               dbVid.filename &&
               dbVid.filename.toLowerCase().replace(/,+$/, "") === targetName &&
               dbVid.path !== "yet-to-upload" &&
               !(Array.isArray(dbVid.tags) && dbVid.tags.includes("yet-to-upload"))
           );

           if (match) {
               matchString = `${match.path || ""} / ${match.filename || ""}`;
           }
       }

// ✅ Check if this filename appears multiple times
const isDuplicate = v.filename && filenameMap.get(v.filename.toLowerCase()) > 1 ? "Y" : "";

// ✅ Strip extension from filename for rename column
const currentFilename = v.filename || "";
const extension = currentFilename.includes('.') ? '.' + currentFilename.split('.').pop() : '';
const filenameWithoutExt = currentFilename.replace(new RegExp(extension.replace(/\./g, '\\.') + '$'), '');

return [
   `"${(v.oneDriveId || "").replace(/"/g,'""')}"`,
   `"${(v.path || "").replace(/"/g,'""')}"`,
   `"${(v.filename || "").replace(/"/g,'""')}"`,
   `"${v.webUrl || ""}"`,
   `"${v.downloadUrl || ""}"`,
   v.sizeBytes ?? "",
   v.durationMs ?? "",
   v.createdDateTime ?? "",
   v.lastModifiedDateTime ?? "",
   `"${(v.mimeType || "").replace(/"/g,'""')}"`,
   v.width ?? "",
   v.height ?? "",
   `"${v.orientation || ""}"`,
   v.bitrate ?? "",
   `"${(v.accountName || "").replace(/"/g,'""')}"`,
   `"${(v.accountKey || "").replace(/"/g,'""')}"`,
   `"${(Array.isArray(v.tags) ? v.tags.join(";") : "").replace(/"/g,'""')}"`,
   `"${v.level_1 || ""}"`,
   `"${v.level_2 || ""}"`,
   `"${v.level_3 || ""}"`,
   `"${v.level_4 || ""}"`,
   `"${v.level_5 || ""}"`,
   `"${matchString.replace(/"/g,'""')}"`,
   `"${isDuplicate}"`,
   `"${filenameWithoutExt.replace(/"/g,'""')}"`, // rename column WITHOUT extension
   `""`, // write_delete_to_delete column empty by default
   `"${JSON.stringify(v.bookmarks || []).replace(/"/g,'""')}"`
];
   });

   const csvContent = [headers, ...rows].map(r => r.join(",")).join("\n");
   const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
   const url = URL.createObjectURL(blob);

   const a = document.createElement("a"); 
   a.href = url;
   a.download = `onedrive_videos_${new Date().toISOString().slice(0,10)}.csv`;
   document.body.appendChild(a); 
   a.click(); 
   document.body.removeChild(a);

} catch(err) { 
   console.error("Error exporting to CSV:", err); 
   alert("Export failed – see console."); 
}
};

window.exportYetToUploadMatchingDB = async function () {
try {
    // 🚀 Get *all* videos in DB
    const allVideosInDB = await getAllVideos();

    const headers = [
        "id",
        "path",
        "filename",
        "web_url",
        "download_url",
        "size_bytes",
        "duration_ms",
        "created_date",
        "last_modified_date",
        "account_name",
        "account_key",
        "tags",
        "level_1",
        "level_2",
        "level_3",
        "level_4",
        "level_5",
        "yet_to_upload_match"
    ];

    const rows = allVideosInDB.map(v => {
        let matchString = "";

        const isYetToUpload =
            v.path === "yet-to-upload" ||
            (Array.isArray(v.tags) && v.tags.includes("yet-to-upload"));

        if (isYetToUpload && v.filename) {
            const targetName = v.filename.toLowerCase().replace(/,+$/, "");
            const match = allVideosInDB.find(dbVid =>
                dbVid.filename &&
                dbVid.filename.toLowerCase().replace(/,+$/, "") === targetName &&
                dbVid.path !== "yet-to-upload" &&
                !(Array.isArray(dbVid.tags) && dbVid.tags.includes("yet-to-upload"))
            );
            if (match) {
                matchString = `${match.path || ""} / ${match.filename || ""}`;
            }
        }

        return [
            `"${(v.oneDriveId || "").replace(/"/g,'""')}"`,
            `"${(v.path || "").replace(/"/g,'""')}"`,
            `"${(v.filename || "").replace(/"/g,'""')}"`,
            `"${v.webUrl || ""}"`,
            `"${v.downloadUrl || ""}"`,
            v.sizeBytes ?? "",
            v.durationMs ?? "",
            v.createdDateTime ?? "",
            v.lastModifiedDateTime ?? "",
            `"${(v.accountName || "").replace(/"/g,'""')}"`,
            `"${(v.accountKey || "").replace(/"/g,'""')}"`,
            `"${(Array.isArray(v.tags) ? v.tags.join(";") : "").replace(/"/g,'""')}"`,
            `"${v.level_1 || ""}"`,
            `"${v.level_2 || ""}"`,
            `"${v.level_3 || ""}"`,
            `"${v.level_4 || ""}"`,
            `"${v.level_5 || ""}"`,
            `"${matchString.replace(/"/g,'""')}"`
        ];
    })
    // 🚀 Filter only rows where matchString is not empty
    .filter(row => row[17] && row[17].replace(/"/g,"").trim() !== "");

    if (!rows.length) {
        alert("No yet-to-upload items with matches found.");
        return;
    }

    const csvContent = [headers, ...rows].map(r => r.join(",")).join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a"); 
    a.href = url;
    a.download = `yet_to_upload_matches_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a); 
    a.click(); 
    document.body.removeChild(a);

} catch(err) {
    console.error("Error exporting Yet to Upload Matching DB:", err);
    alert("Export failed — see console");
}
};

// =========================================
// CSV IMPORT FOR RENAME/DELETE OPERATIONS
// =========================================

/**
* Parse CSV/XLSX for rename and delete operations
*/
async function parseRenameDeleteCSV(file) {
   let rows = [];
   
   const ext = file.name.split(".").pop().toLowerCase();
   if (ext === "xlsx") {
       // Read XLSX via SheetJS
       const data = await file.arrayBuffer();
       const workbook = XLSX.read(data, { type: "array" });
       const firstSheetName = workbook.SheetNames[0];
       const sheet = workbook.Sheets[firstSheetName];
       rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
   } else {
       // CSV
       const text = await file.text();
       const lines = text.split(/\r?\n/);
       rows = lines.map(line => {
           // Simple CSV parser (handles quoted fields)
           const result = [];
           let current = '';
           let inQuotes = false;
           
           for (let i = 0; i < line.length; i++) {
               const char = line[i];
               if (char === '"') {
                   if (inQuotes && line[i + 1] === '"') {
                       current += '"';
                       i++;
                   } else {
                       inQuotes = !inQuotes;
                   }
               } else if (char === ',' && !inQuotes) {
                   result.push(current);
                   current = '';
               } else {
                   current += char;
               }
           }
           result.push(current);
           return result;
       });
   }
   
   if (rows.length < 2) {
       throw new Error("CSV file has no data rows");
   }
   
   // Find column indices
   const headers = rows[0].map(h => String(h).trim().toLowerCase());
   const idCol = headers.indexOf('id');
   const filenameCol = headers.indexOf('filename');
   const renameCol = headers.indexOf('rename');
   const deleteCol = headers.indexOf('write_delete_to_delete');
   
   if (idCol === -1 || filenameCol === -1) {
       throw new Error("CSV must have 'id' and 'filename' columns");
   }
   
   // Parse data rows
   const operations = { renames: [], deletions: [] };
   const allVideos = await getAllVideos();
   
   for (let i = 1; i < rows.length; i++) {
       const row = rows[i];
       if (!row || row.length === 0) continue;
       
       const id = String(row[idCol] || '').trim();
       const currentFilename = String(row[filenameCol] || '').trim();
       const newFilename = renameCol >= 0 ? String(row[renameCol] || '').trim() : '';
       const deleteFlag = deleteCol >= 0 ? String(row[deleteCol] || '').trim().toLowerCase() : '';
       
       if (!id) continue;
       
       // Find video in database
       const video = allVideos.find(v => v.oneDriveId === id);
       if (!video) {
           console.warn(`Video not found for ID: ${id}`);
           continue;
       }
       
// Check for rename
     if (newFilename && newFilename !== currentFilename) {
         // ✅ Add extension back to new filename
         const videoFilename = video.filename || '';
         const extension = videoFilename.includes('.') ? '.' + videoFilename.split('.').pop() : '';
         const videoNameWithoutExt = videoFilename.replace(new RegExp(extension.replace(/\./g, '\\.') + '$'), '');
         
         // Only add to operations if the name actually changed
         if (newFilename !== videoNameWithoutExt) {
             const newNameWithExt = newFilename + extension;
             operations.renames.push({
                 video: video,
                 currentName: video.filename,
                 newName: newNameWithExt,
                 extension: extension
             });
         }
     }
     
     // ✅ Check for deletion
     if (deleteFlag === 'delete') {
         operations.deletions.push({
             video: video
         });
     }
}

return operations;
}

/**
* Show confirmation modal for rename/delete operations
*/
async function showRenameDeleteConfirmationModal(operations) {
   return new Promise((resolve) => {
       const modal = document.createElement('div');
       modal.className = 'file-operation-modal';
       modal.style.zIndex = '10001';
       
       let html = `
           <div class="file-operation-modal-content" style="max-width: 800px; max-height: 90vh; overflow-y: auto;">
               <h3>Confirm Bulk Operations</h3>
       `;
       
       // Renames section
       if (operations.renames.length > 0) {
           html += `
               <div style="margin-bottom: 20px;">
                   <h4>Renames (${operations.renames.length})</h4>
                   <div id="renamesList">
           `;
           
operations.renames.forEach((op, idx) => {
         // ✅ Strip extension for display in input, show separately
         const extension = op.extension || '';
         const newNameWithoutExt = op.newName.replace(new RegExp(extension.replace(/\./g, '\\.') + '$'), '');
         
         html += `
             <div class="rename-item" data-index="${idx}" data-extension="${extension}" style="margin-bottom: 12px; padding: 8px; background: #f9f9f9; border-radius: 4px;">
                 <div style="font-size: 0.8rem; color: #666; margin-bottom: 4px;">${op.video.path || 'root'}</div>
                 <div style="display: flex; align-items: center; gap: 8px;">
                     <input type="text" class="rename-new-name" value="${newNameWithoutExt}" 
                            style="flex: 1; padding: 6px; font-size: 0.9rem; border: 1px solid #ddd; border-radius: 4px;">
                     <span style="font-size: 0.9rem; color: #666; white-space: nowrap;">${extension}</span>
                     <button class="remove-rename-btn" data-index="${idx}" 
                             style="background: #f44336; color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer;">
                         Remove
                     </button>
                 </div>
                 <div style="font-size: 0.75rem; color: #999; margin-top: 4px;">Current: ${op.currentName}</div>
             </div>
         `;
     });
           
           html += `
                   </div>
               </div>
           `;
       }
       
       // Deletions section
       if (operations.deletions.length > 0) {
           html += `
               <div style="margin-bottom: 20px;">
                   <h4 style="color: #f44336;">Deletions (${operations.deletions.length})</h4>
                   <div id="deletionsList">
           `;
           
           operations.deletions.forEach((op, idx) => {
               html += `
                   <div class="deletion-item" data-index="${idx}" style="margin-bottom: 8px; padding: 8px; background: #ffebee; border-radius: 4px; display: flex; align-items: center; gap: 8px;">
                       <input type="checkbox" class="keep-deletion-checkbox" checked data-index="${idx}" 
                              style="width: auto; margin: 0; cursor: pointer;">
                       <div style="flex: 1;">
                           <div style="font-size: 0.8rem; color: #666;">${op.video.path || 'root'}</div>
                           <div style="font-size: 0.9rem;">${op.video.filename}</div>
                       </div>
                   </div>
               `;
           });
           
           html += `
                   </div>
               </div>
           `;
       }
       
       if (operations.renames.length === 0 && operations.deletions.length === 0) {
           html += `<p>No operations detected in CSV file.</p>`;
       }
       
       html += `
               <div class="file-operation-buttons">
                   <button id="confirmBulkOpsBtn" class="modal-btn modal-btn-primary" 
                           ${(operations.renames.length === 0 && operations.deletions.length === 0) ? 'disabled' : ''}>
                       Confirm & Execute
                   </button>
                   <button id="cancelBulkOpsBtn" class="modal-btn modal-btn-cancel">Cancel</button>
               </div>
           </div>
       `;
       
       modal.innerHTML = html;
       document.body.appendChild(modal);
       
       // Track which operations are still active
       const activeRenames = new Set(operations.renames.map((_, i) => i));
       const activeDeletions = new Set(operations.deletions.map((_, i) => i));
       
       // Remove rename button handlers
       modal.querySelectorAll('.remove-rename-btn').forEach(btn => {
           btn.addEventListener('click', () => {
               const idx = parseInt(btn.dataset.index);
               activeRenames.delete(idx);
               const item = modal.querySelector(`.rename-item[data-index="${idx}"]`);
               if (item) item.remove();
               
               // Update header count
               const remaining = Array.from(modal.querySelectorAll('.rename-item')).length;
               const header = modal.querySelector('h4');
               if (header && header.textContent.includes('Renames')) {
                   header.textContent = `Renames (${remaining})`;
               }
           });
       });
       
       // Deletion checkbox handlers
       modal.querySelectorAll('.keep-deletion-checkbox').forEach(checkbox => {
           checkbox.addEventListener('change', () => {
               const idx = parseInt(checkbox.dataset.index);
               if (checkbox.checked) {
                   activeDeletions.add(idx);
               } else {
                   activeDeletions.delete(idx);
               }
           });
       });
       
       // Close on background click
       modal.addEventListener('click', (e) => {
           if (e.target === modal) {
               modal.remove();
               resolve(null);
           }
       });
       
       // Cancel button
       document.getElementById('cancelBulkOpsBtn').addEventListener('click', () => {
           modal.remove();
           resolve(null);
       });
       
// Confirm button
      document.getElementById('confirmBulkOpsBtn').addEventListener('click', async () => {
           // Collect updated rename values
           const finalRenames = [];
           activeRenames.forEach(idx => {
               const item = modal.querySelector(`.rename-item[data-index="${idx}"]`);
               if (item) {
                   const input = item.querySelector('.rename-new-name');
                   const extension = item.dataset.extension || '';
                   const newNameWithoutExt = input.value.trim();
                   const newNameWithExt = newNameWithoutExt + extension; // ✅ Add extension back
                   
                   if (newNameWithoutExt && newNameWithExt !== operations.renames[idx].currentName) {
                       finalRenames.push({
                           ...operations.renames[idx],
                           newName: newNameWithExt
                       });
                   }
               }
           });
          
          // Collect deletions that are still checked
          const finalDeletions = [];
          activeDeletions.forEach(idx => {
              finalDeletions.push(operations.deletions[idx]);
          });
          
          // ✅ Don't close modal - execute and show progress instead
          const confirmBtn = document.getElementById('confirmBulkOpsBtn');
          const cancelBtn = document.getElementById('cancelBulkOpsBtn');
          confirmBtn.disabled = true;
          cancelBtn.disabled = true;
          
          // Clear content and show progress
          const content = modal.querySelector('.file-operation-modal-content');
          content.innerHTML = `
              <h3>Executing Operations...</h3>
              <div id="bulkOpsProgress" style="padding: 20px; text-align: center;">
                  <div style="font-size: 1.2rem; margin-bottom: 10px;">Processing...</div>
                  <div id="bulkOpsStatus" style="font-size: 0.9rem; color: #666;">Starting...</div>
              </div>
          `;
          
          // Execute operations with progress updates
          await executeBulkOperationsWithProgress(
              { renames: finalRenames, deletions: finalDeletions },
              modal
          );
      });
   });
}

/**
* Execute bulk rename and delete operations with progress display
*/
async function executeBulkOperationsWithProgress(operations, modal) {
  if (!operations) return;
  
  const totalOps = operations.renames.length + operations.deletions.length;
  if (totalOps === 0) {
      alert('No operations to execute');
      modal.remove();
      return;
  }
  
  let completed = 0;
  let failed = 0;
  const errors = [];
  
  const statusEl = modal.querySelector('#bulkOpsStatus');
  const updateStatus = (text) => {
      if (statusEl) statusEl.textContent = text;
  };
  
  // Execute renames
  for (let i = 0; i < operations.renames.length; i++) {
      const op = operations.renames[i];
      try {
          updateStatus(`Renaming ${i + 1}/${operations.renames.length}: ${op.currentName}`);
          console.log(`Renaming: ${op.currentName} -> ${op.newName}`);
          await renameFile(op.video, op.newName);
          completed++;
      } catch (err) {
          console.error(`Failed to rename ${op.currentName}:`, err);
          errors.push(`Rename failed: ${op.currentName} - ${err.message}`);
          failed++;
      }
  }
  
  // Execute deletions
  for (let i = 0; i < operations.deletions.length; i++) {
      const op = operations.deletions[i];
      try {
          updateStatus(`Deleting ${i + 1}/${operations.deletions.length}: ${op.video.filename}`);
          console.log(`Deleting: ${op.video.filename}`);
          await deleteFile(op.video);
          completed++;
      } catch (err) {
          console.error(`Failed to delete ${op.video.filename}:`, err);
          errors.push(`Delete failed: ${op.video.filename} - ${err.message}`);
          failed++;
      }
  }
  
  // Show summary in modal
  const content = modal.querySelector('.file-operation-modal-content');
  let summaryHTML = `
      <h3>Operations Complete</h3>
      <div style="padding: 20px;">
          <div style="font-size: 1.1rem; margin-bottom: 10px;">
              ✅ Successful: ${completed}<br>
              ❌ Failed: ${failed}
          </div>
  `;
  
  if (errors.length > 0) {
      summaryHTML += `
          <div style="margin-top: 20px;">
              <h4 style="color: #f44336; margin-bottom: 10px;">Errors:</h4>
              <div style="max-height: 200px; overflow-y: auto; background: #fff3f3; padding: 10px; border-radius: 4px; font-size: 0.85rem; text-align: left;">
      `;
      errors.forEach(err => {
          summaryHTML += `<div style="margin-bottom: 4px;">• ${err}</div>`;
      });
      summaryHTML += `
              </div>
          </div>
      `;
  }
  
  summaryHTML += `
          <button id="closeSummaryBtn" class="modal-btn modal-btn-primary" style="margin-top: 20px; width: 100%;">
              Close
          </button>
      </div>
  `;
  
  content.innerHTML = summaryHTML;
  
  document.getElementById('closeSummaryBtn').addEventListener('click', () => {
      modal.remove();
  });
  
  // Refresh all lists
  if (typeof refreshAllLists === 'function') {
      refreshAllLists();
  }
}

/**
* Handle bulk rename/delete CSV upload
*/
async function handleBulkOperationsCSV(file) {
   try {
       console.log('Parsing bulk operations CSV...');
       const operations = await parseRenameDeleteCSV(file);
       
       if (operations.renames.length === 0 && operations.deletions.length === 0) {
           alert('No rename or delete operations found in CSV');
           return;
       }
       
       console.log(`Found ${operations.renames.length} renames and ${operations.deletions.length} deletions`);
       
       // Show confirmation modal
       const confirmed = await showRenameDeleteConfirmationModal(operations);
       
// Note: executeBulkOperationsWithProgress is now called directly from the modal
      // (no need to call it here since the modal handles it internally)
       
   } catch (err) {
       console.error('Bulk operations failed:', err);
       alert(`Failed to process CSV: ${err.message}`);
   }
}

/**
* Clear all yet-to-upload items from database
*/
async function clearYetToUploadItems() {
   try {
       const allVideos = await getAllVideos();
       const yetToUploadVideos = allVideos.filter(v => 
           v.path === "yet-to-upload" || 
           (Array.isArray(v.tags) && v.tags.includes("yet-to-upload"))
       );
       
       if (yetToUploadVideos.length === 0) {
           alert('No yet-to-upload items found in database');
           return;
       }
       
       const confirmMsg = `Delete ${yetToUploadVideos.length} yet-to-upload item${yetToUploadVideos.length > 1 ? 's' : ''} from database?`;
       if (!confirm(confirmMsg)) {
           console.log('Clear yet-to-upload cancelled by user');
           return;
       }
       
// Delete from IndexedDB
      const db = await openDB();
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      
      for (const video of yetToUploadVideos) {
          console.log(`Deleting: ${video.oneDriveId} - ${video.filename}`);
          store.delete(video.oneDriveId);
      }
      
      // ✅ Properly wait for transaction to complete
      await new Promise((resolve, reject) => {
          tx.oncomplete = () => {
              console.log('Transaction completed successfully');
              resolve();
          };
          tx.onerror = () => {
              console.error('Transaction error:', tx.error);
              reject(tx.error);
          };
      });
       
       console.log(`Deleted ${yetToUploadVideos.length} yet-to-upload items from database`);
       alert(`Successfully removed ${yetToUploadVideos.length} yet-to-upload items`);
       
       // Refresh tag dropdowns and lists
       if (typeof populateTagDropdowns === 'function') {
           await populateTagDropdowns();
       }
       
       // Refresh current view if it's showing yet-to-upload items
       if (typeof filterDisplayedByFilename === 'function') {
           window.skipSearchScroll = true;
           filterDisplayedByFilename();
       }
       
   } catch (err) {
       console.error('Failed to clear yet-to-upload items:', err);
       alert(`Failed to clear yet-to-upload items: ${err.message}`);
   }
}

window.clearYetToUploadItems = clearYetToUploadItems;

// =========================================
// Select2 Search Focus Helper
// =========================================
function focusSelect2Search(selector) {
const searchBox = $('.select2-container--open .select2-search__field');
if (searchBox.length) searchBox.val('').trigger('input').focus();
}

// =========================================
// Keyboard Shortcuts
// =========================================
function setupKeyboardShortcuts() {
  const genBtn     = document.getElementById('generateRandomByTagsBtn');
  const listBtn    = document.getElementById('listAllByTagsBtn');
  const searchBox  = document.getElementById("filenameSearchBox");

  window.addEventListener("keydown", function (event) {
      const activeTag  = document.activeElement.tagName.toLowerCase();
      const isEditable = document.activeElement.isContentEditable;

    // T → cycle through the L1 → L2 → L3 → RT buttons
    if (event.key.toLowerCase() === "t" && !event.ctrlKey && !event.metaKey &&
        activeTag !== "input" && activeTag !== "textarea" && !isEditable) {
        event.preventDefault();

        // IDs for the small shortcut buttons
        const tagButtonsCycleIds = ['btnL1', 'btnL2', 'btnL3', 'btnAT'];

        if (typeof window.tagButtonCycleIndex === 'undefined') {
            window.tagButtonCycleIndex = 0;
        }

        const buttonId = tagButtonsCycleIds[window.tagButtonCycleIndex];
        const btnEl = document.getElementById(buttonId);
        if (btnEl) btnEl.click(); // opens the corresponding dropdown

        // Advance pointer for next cycle
        window.tagButtonCycleIndex = (window.tagButtonCycleIndex + 1) % tagButtonsCycleIds.length;
    }
        
      // / → focus search box
  if (event.key.toLowerCase() === "/" && !event.ctrlKey && !event.metaKey &&
      activeTag !== "input" && activeTag !== "textarea" && !isEditable) {
      event.preventDefault();
      if (searchBox) { 
          if (typeof scrollToSearchBox === 'function') {
              scrollToSearchBox(searchBox);
          }
          searchBox.focus({ preventScroll: true }); 
          setTimeout(() => { searchBox.select(); }, 50);
      }
  }

        // L → run full list + jump to list section
        if (event.key.toLowerCase() === "l" && !event.ctrlKey && !event.metaKey &&
        activeTag !== "input" && activeTag !== "textarea" && !isEditable) {
        event.preventDefault();
        listAllVideos(); // generate full list per current filters
        setTimeout(() => {
            const section = document.querySelector("#taggedVideosContainer") 
                        || document.querySelector("section h2");
            if (section) {
                section.scrollIntoView({ behavior: "smooth", block: "start" });
            }
        }, 200); // give render time
        }

        // R → run random list
        if (event.key.toLowerCase() === "r" && !event.ctrlKey && !event.metaKey &&
        activeTag !== "input" && activeTag !== "textarea" && !isEditable) {
        event.preventDefault();
        
        // ✅ In landscape mobile, just generate without scrolling
        const isLandscape = window.matchMedia('(orientation: landscape)').matches;
        const isMobile = window.innerWidth <= 1024;
        
        if (isLandscape && isMobile) {
            generateRandomPlaylistByTags(); // Opens panel automatically, no scroll
        } else {
            if (genBtn) genBtn.click(); // Normal behavior with scroll
        }
        }

     // B → play random from basket
  if (event.key.toLowerCase() === "b" && !event.ctrlKey && !event.metaKey &&
      activeTag !== "input" && activeTag !== "textarea" && !isEditable) {
      event.preventDefault();
      if (typeof window.playRandomFromBasket === 'function') {
          window.playRandomFromBasket();
      }
  }

      
    // H → toggle history
  if (event.key.toLowerCase() === "h" && !event.ctrlKey && !event.metaKey &&
  activeTag !== "input" && activeTag !== "textarea" && !isEditable) {
  event.preventDefault();
  toggleHistory();
  }
  
  // G → play through history sequentially
  if (event.key.toLowerCase() === "g" && !event.ctrlKey && !event.metaKey &&
  activeTag !== "input" && activeTag !== "textarea" && !isEditable) {
  event.preventDefault();
  if (typeof window.playHistorySequence === 'function') {
    window.playHistorySequence();
  }
  }

        // C → Clear filters & scroll to top
        if (event.key.toLowerCase() === "c" && !event.ctrlKey && !event.metaKey &&
        activeTag !== "input" && activeTag !== "textarea" && !isEditable) {
        event.preventDefault();
        if (typeof clearAllFilters === "function") {
            clearAllFilters();
        }
        }

        
        // S → Stop video player
if (event.key.toLowerCase() === "s" && !event.ctrlKey && !event.metaKey &&
    activeTag !== "input" && activeTag !== "textarea" && !isEditable) {
    event.preventDefault();
    if (window.inlineVideoPlayer) {
        window.inlineVideoPlayer.stop();
    }
}

// P → Toggle player visibility (desktop only)
if (event.key.toLowerCase() === "p" && !event.ctrlKey && !event.metaKey &&
    activeTag !== "input" && activeTag !== "textarea" && !isEditable) {
    // Only work on desktop
    if (window.innerWidth >= 769) {
        event.preventDefault();
        if (typeof toggleVideoPlayer === 'function') {
            toggleVideoPlayer();
            
            // Show feedback
            const isHidden = document.body.classList.contains('video-player-hidden');
            if (typeof showButtonFeedback === 'function') {
                const btn = document.getElementById('toggleVideoPlayerBtn');
                if (btn) {
                    const fakeEvent = { target: btn };
                    showButtonFeedback(isHidden ? '📺 Player Hidden' : '📺 Player Shown', fakeEvent);
                }
            }
        }
    }
}

// X → Play random filtered video
  if (event.key.toLowerCase() === "x" && !event.ctrlKey && !event.metaKey &&
      activeTag !== "input" && activeTag !== "textarea" && !isEditable) {
      event.preventDefault();
      const playRandomBtn = document.getElementById("playRandomFilteredBtn");
      if (playRandomBtn) playRandomBtn.click();
  }

  // < → Play previous in current list
  if (event.key === "," && !event.ctrlKey && !event.metaKey &&
      activeTag !== "input" && activeTag !== "textarea" && !isEditable) {
      event.preventDefault();
      if (typeof window.playPreviousInCurrentList === 'function') {
          window.playPreviousInCurrentList();
      }
  }

  // > → Play next in current list
  if (event.key === "." && !event.ctrlKey && !event.metaKey &&
      activeTag !== "input" && activeTag !== "textarea" && !isEditable) {
      event.preventDefault();
      if (typeof window.playNextInCurrentList === 'function') {
          window.playNextInCurrentList();
      }
  }

// Escape → leave tag field OR leave text field
      if (event.key === "Escape") {
          // First, if Select2 tags dropdown is open, close it
          if ($('.select2-container--open').length) {
              $('#tagFilterSelect').select2('close');
              $('#excludeTagSelect').select2('close');
              event.preventDefault();
              return;
          }
          // Otherwise, blur out of active text input/textarea/contentEditable
          if (activeTag === "input" || activeTag === "textarea" || isEditable) {
              event.preventDefault();
              document.activeElement.blur();
          }
      }
  });

  // Desktop: quick re-focus after selecting a tag
 $('#tagFilterSelect').on('select2:select', function () {
     if (window.innerWidth > 768) {
         setTimeout(() => focusSelect2Search('#tagFilterSelect'), 0);
     }
 });
 $('#excludeTagSelect').on('select2:select', function () {
     if (window.innerWidth > 768) {
         setTimeout(() => focusSelect2Search('#excludeTagSelect'), 0);
     }
 });
 
 // Mobile: prevent focus loss after typing (keep search box focused)
 if (window.innerWidth <= 768) {
     ['tagFilterLevel1Select', 'tagFilterLevel2Select', 'tagFilterLevel3Select', 'tagFilterAllSelect', 'excludeTagSelect'].forEach(selectId => {
         $(`#${selectId}`).on('select2:select select2:unselect', function(e) {
             setTimeout(() => {
                 const searchField = document.querySelector('.select2-container--open .select2-search__field');
                 if (searchField) {
                     searchField.focus();
                 }
             }, 10);
         });
     });
 }
}

// =========================================
// DOMContentLoaded Initialisation 
// =========================================
document.addEventListener("DOMContentLoaded", () => {

   setupKeyboardShortcuts(); // ✅ Activate keyboard shortcuts

 // ✅ Add Filtered to Basket button
 const addFilteredBtn = document.getElementById("addFilteredToBasketBtn");
 if (addFilteredBtn) {
     addFilteredBtn.addEventListener("click", (e) => {
         if (!filteredVideosGlobal || filteredVideosGlobal.length === 0) {
             showButtonFeedback("No filtered videos to add", e);
             return;
         }
         
         // ✅ Enforce 500 item limit
         if (filteredVideosGlobal.length > 500) {
           showButtonFeedback("Maximum 500 items - refine your filters", e);
           return;
       }
         
         // Count how many are new vs already in basket
         let addedCount = 0;
         let skippedCount = 0;
         
         filteredVideosGlobal.forEach(video => {
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
             
             // Check if already in basket
             if (!basketVideos.some(v => v.oneDriveId === oneDriveId)) {
                 basketVideos.unshift({ ...video, oneDriveId, driveId });
                 addedCount++;
             } else {
                 skippedCount++;
             }
         });
         
         if (addedCount > 0) {
             window.basketVideos = basketVideos;
             window.resetBasketPlayIndex();
             window.saveBasket();
             window.renderBasket();
             if (window.updateBasketHighlights) window.updateBasketHighlights();
             if (window.updateRandomPanelHighlights) window.updateRandomPanelHighlights();
         }
         
         // ✅ Show tooltip feedback
         if (addedCount > 0) {
             const message = skippedCount > 0 
                 ? `✅ Added ${addedCount} (${skippedCount} duplicates)` 
                 : `✅ Added ${addedCount}`;
             showButtonFeedback(message, e);
         } else {
             showButtonFeedback("All already in basket", e);
         }
         
         console.log(`Added ${addedCount} filtered videos to basket (${skippedCount} skipped as duplicates)`);
     });
 }

  // Jump to Search (F)
const jumpSearchBtn = document.getElementById("jumpSearchBtn");
if (jumpSearchBtn) {
    jumpSearchBtn.addEventListener("click", () => {
        // ✅ Check if in landscape mobile mode
        const isLandscape = window.matchMedia('(orientation: landscape)').matches;
        const isMobile = window.innerWidth <= 1024;
        
        if (isLandscape && isMobile) {
            // ✅ Landscape mobile: Focus panel search box FIRST (within user gesture)
            const panelSearchBox = document.getElementById("panelSearchBox");
            if (panelSearchBox) {
                // ✅ CRITICAL: Focus immediately to preserve user gesture for iOS keyboard
                panelSearchBox.focus();
                panelSearchBox.click();
                
                // ✅ Then select text after a tiny delay (iOS needs focus to settle first)
                setTimeout(() => {
                    panelSearchBox.select();
                }, 50);
            }
            
            // ✅ Open panel if not already open
            if (typeof window.toggleRandomPlaylistPanel === 'function') {
                const panel = document.getElementById("randomPlaylistPanel");
                if (panel && !panel.classList.contains("random-panel-open")) {
                    window.toggleRandomPlaylistPanel(true);
                }
            }
            
            // ✅ Then render the current filtered list (async is OK now)
            if (typeof filterDisplayedByFilename === 'function') {
                window.skipSearchScroll = true;
                filterDisplayedByFilename();
            }
        } else {
    // Normal mode: focus main search box
    const searchBox = document.getElementById("filenameSearchBox");
    if (searchBox) {
        const isMobilePortrait = window.innerWidth <= 768 && window.matchMedia('(orientation: portrait)').matches;
        // On mobile portrait, skip scrollToSearchBox - the focus listener
        // will scroll the results list into view instead
        if (!isMobilePortrait && typeof scrollToSearchBox === 'function') {
            scrollToSearchBox(searchBox);
        }
        searchBox.focus({ preventScroll: true });
        setTimeout(() => { searchBox.select(); }, 50);
    }
}
    });
}
    // Jump to Tags (T)
    const jumpTagsBtn = document.getElementById("jumpTagsBtn");
    if (jumpTagsBtn) {
    jumpTagsBtn.addEventListener("click", () => {
    const tagsSelect = document.getElementById("tagFilterLevel1Select");
    if (tagsSelect) {
        // Scroll to Level-1 tags section
        const yOffset = -10;
        const y = tagsSelect.getBoundingClientRect().top + window.pageYOffset + yOffset;
        window.scrollTo({ top: y, behavior: 'smooth' });
        // Open Level-1 tags dropdown
        $('#tagFilterLevel1Select').select2('open');
        
        // ✅ Blur search box after opening
        setTimeout(() => {
            const searchField = document.querySelector('.select2-container--open .select2-search__field');
            if (searchField) searchField.blur();
        }, 50);
    }
    });
    }

    // Jump to Random List (R^)
   const jumpRandomBtn = document.getElementById("jumpRandomBtn");
   if (jumpRandomBtn) {
   jumpRandomBtn.addEventListener("click", () => {
   const isLandscape = window.matchMedia('(orientation: landscape)').matches;
   const isMobile = window.innerWidth <= 1024;
   
   if (isLandscape && isMobile) {
       // ✅ Toggle random panel in landscape mobile
       window.toggleRandomPlaylistPanel();
   } else {
       // Normal scroll behavior
       const randomList = document.getElementById("playlist");
       if (randomList) {
       const yOffset = -10;
       const y = randomList.getBoundingClientRect().top + window.pageYOffset + yOffset;
       window.scrollTo({ top: y, behavior: 'smooth' });
       }
   }
   });
   }

 // Play Last History (H^)
 const playLastHistoryBtn = document.getElementById("playLastHistoryBtn");
 if (playLastHistoryBtn) {
   playLastHistoryBtn.addEventListener("click", () => {
     if (typeof window.playLastPlayedVideo === 'function') {
       window.playLastPlayedVideo();
     }
   });
 }

// // Play Next Basket (B>)
// const playNextBasketBtn = document.getElementById("playNextBasketBtn");
// if (playNextBasketBtn) {
// playNextBasketBtn.addEventListener("click", () => {
//   if (typeof window.playNextInBasket === 'function') {
//     window.playNextInBasket();
//   }
// });
// }

// Play Random Basket (B*)
const playRandomBasketBtn = document.getElementById("playRandomBasketBtn");
if (playRandomBasketBtn) {
playRandomBasketBtn.addEventListener("click", () => {
  window.lastPlayLabel = 'Basket Random';
  if (typeof window.playRandomFromBasket === 'function') {
    window.playRandomFromBasket();
  }
});
}

// Play Next in Current List (>)
const playNextBtn = document.getElementById("playNextBtn");
if (playNextBtn) {
  playNextBtn.addEventListener("click", () => {
    window.lastPlayLabel = 'Next in List';
    if (typeof window.playNextInCurrentList === 'function') {
      window.playNextInCurrentList();
    }
  });
}

// Play Previous in Current List (<)
const playPreviousBtn = document.getElementById("playPreviousBtn");
if (playPreviousBtn) {
  playPreviousBtn.addEventListener("click", () => {
    if (typeof window.playPreviousInCurrentList === 'function') {
      window.playPreviousInCurrentList();
    }
  });
}

  // Corner List Button
  const listBtnCorner = document.getElementById("listBtnCorner");
  if (listBtnCorner) {
      listBtnCorner.addEventListener("click", () => {
          listAllVideos(); // generate full list per current filters
          setTimeout(() => {
              const section = document.querySelector("#taggedVideosContainer") 
                           || document.querySelector("section h2");
              if (section) {
                  section.scrollIntoView({ behavior: "smooth", block: "start" });
              }
          }, 200); // delay to ensure list rendered
      });
  }

  // Attach CSV export for full DB
    const exportCsvBtn = document.getElementById("exportCsvBtn");
    if (exportCsvBtn) {
        exportCsvBtn.addEventListener("click", window.downloadVideosCsv);
    }

    // Attach Excel Online export
   const exportToExcelBtn = document.getElementById("exportToExcelBtn");
   if (exportToExcelBtn) {
       // exportToExcelOnline lives in excel-sheets.js, which the native build
       // never loads - this handler was always undefined. Native has no
       // OneDrive catalogue to export; that's Picker's job.
   }
    
    // ✅ Attach Clear DB link
const clearCacheBtn = document.getElementById("clearCacheBtn");
if (clearCacheBtn) {
    clearCacheBtn.addEventListener("click", (e) => {
        e.preventDefault();
        window.clearAllVideosCache();
    });
}

    // NEW — Bind fixed-size pagination buttons
    document.querySelectorAll(".pageSizeBtn").forEach(btn => {
    btn.addEventListener("click", () => {
        const size = parseInt(btn.dataset.size, 10);
        renderNextChunk(size);
    });
    });

// ✅ Dropdown Button Activation (L1, L2, L3, RT)
const dropdowns = [
 { btn: 'btnL1', select: 'tagFilterLevel1Select' },
 { btn: 'btnL2', select: 'tagFilterLevel2Select' },
 { btn: 'btnL3', select: 'tagFilterLevel3Select' },
 { btn: 'btnAT', select: 'tagFilterAllSelect' },
];

function openOnly(selectId) {
 // Close all other dropdowns
 dropdowns.forEach(dd => $(`#${dd.select}`).select2('close'));
 // Open the requested dropdown
 $(`#${selectId}`).select2('open');
 
 // Keep focus on search box (mobile behavior)
 setTimeout(() => {
     const searchField = document.querySelector('.select2-container--open .select2-search__field');
     if (searchField) {
         searchField.focus();
     }
 }, 50);
}

// Bind click events to each small button
dropdowns.forEach(dd => {
    document.getElementById(dd.btn)?.addEventListener('click', () => {
        openOnly(dd.select);
    });
});

// Allow Tab key to jump to next dropdown
$(document).on('keydown', function (e) {
    if (e.key === 'Tab') {
        const openIndex = dropdowns.findIndex(dd =>
            $(`#${dd.select}`).data('select2')?.isOpen()
        );
        if (openIndex >= 0) {
            e.preventDefault();
            const nextIndex = (openIndex + 1) % dropdowns.length;
            openOnly(dropdowns[nextIndex].select);
        }
    }
});

// ✅ Metadata CSV re-import (repurposed from the old bulk rename/delete input)
 const bulkOpsInput = document.getElementById("bulkOperationsCsvInput");
 if (bulkOpsInput) {
     bulkOpsInput.addEventListener("change", async (e) => {
         const file = e.target.files[0];
         if (!file) return;
         try {
             await importMetadataCsv(file);
         } catch (err) {
             console.error("Error importing metadata CSV:", err);
             alert("Failed to import metadata CSV. See console for details.");
         }
         e.target.value = ""; // Reset so same file can be uploaded again
     });
 }
});

// Global handler: keep focus on search box for tag dropdowns on mobile
if (window.innerWidth <= 768) {
 $(document).on('select2:open', function(e) {
     const selectId = e.target.id;
     // Only apply to tag filter dropdowns
     if (selectId.includes('tagFilter') || selectId.includes('excludeTag')) {
         setTimeout(() => {
             const searchField = document.querySelector('.select2-container--open .select2-search__field');
             if (searchField) {
                 searchField.focus();
             }
         }, 50);
     }
 });
}
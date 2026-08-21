// ===== file-operations.js =====
// OneDrive file rename and delete operations

/**
* Show rename modal for a video
*/
/**
* Show rename modal for a video
*/
async function showRenameModal(video) {
const currentName = video.filename || '';
const extension = currentName.includes('.') ? '.' + currentName.split('.').pop() : '';
const nameWithoutExt = currentName.replace(new RegExp(extension + '$'), '');

const modal = document.createElement('div');
modal.className = 'basket-json-modal';
modal.innerHTML = `
<div class="basket-json-modal-content">
<h3>Rename File</h3>
<p style="font-size: 0.85rem; color: #666; margin-bottom: 12px; word-break: break-word;">${video.path || ''}</p>

<!-- Tags on top -->
<div style="margin-bottom: 12px;">
    <div id="renameTagsContainer" style="display: flex; flex-wrap: wrap; gap: 6px; min-height: 32px; padding: 8px; background: #f9f9f9; border-radius: 4px;"></div>
</div>

<!-- Editable rename input with extension -->
<div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
    <input type="text" id="renameInput" value="${nameWithoutExt}" placeholder="New filename" 
           style="flex: 1; padding: 10px; font-size: 1rem; border: 2px solid #ddd; border-radius: 4px; box-sizing: border-box;">
    <span style="font-size: 1rem; color: #666; font-weight: bold; white-space: nowrap;">${extension}</span>
</div>

<!-- Non-editable word selector by itself -->
<div style="margin-bottom: 12px;">
    <div id="wordSelectorContainer" class="word-selector-container"></div>
</div>

<!-- All action buttons in one row (Add to Search first on mobile) -->
<div class="rename-action-buttons" style="display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap;">
 <button id="addToSearchBtn" class="bracket-btn bracket-btn-search" title="Add selected words to search filter">🔍</button>
 <button id="addBracketsBtn" class="bracket-btn" title="Add brackets around selected words">[  ]</button>
 <button id="prevWordEdgeBtn" class="bracket-btn" title="Jump to previous word edge">&lt;</button>
 <button id="nextWordEdgeBtn" class="bracket-btn" title="Jump to next word edge">&gt;</button>
 <button id="removeWordsBtn" class="bracket-btn bracket-btn-red" title="Remove selected words and following separator">X</button>
</div>

<!-- Rename and Cancel buttons -->
<div style="display: flex; gap: 8px;">
    <button id="confirmRenameBtn" class="modal-btn modal-btn-primary" style="flex: 1;">Rename</button>
    <button id="cancelRenameBtn" class="modal-btn modal-btn-cancel" style="flex: 1;">Cancel</button>
</div>
</div>
`;
document.body.appendChild(modal);

const input = document.getElementById('renameInput');
const wordSelectorContainer = document.getElementById('wordSelectorContainer');
const addBracketsBtn = document.getElementById('addBracketsBtn');
const removeWordsBtn = document.getElementById('removeWordsBtn');
const renameTagsContainer = document.getElementById('renameTagsContainer');

// Track selected word indices
let selectedWords = new Set();

// Render tags as clickable pills
function renderRenameTags() {
renameTagsContainer.innerHTML = '';

const tags = video.tags || [];

if (tags.length === 0) {
    renameTagsContainer.innerHTML = '<span style="color: #999; font-size: 0.8rem; font-style: italic;">No tags available</span>';
    return;
}

tags.forEach(tag => {
    const tagPill = document.createElement('span');
    tagPill.className = 'rename-tag-pill';
    tagPill.textContent = tag;
    tagPill.title = `Click to insert "${tag}" at cursor`;
    
    tagPill.addEventListener('click', () => {
        // Get cursor position in input
        const cursorPos = input.selectionStart;
        const textBefore = input.value.substring(0, cursorPos);
        const textAfter = input.value.substring(cursorPos);
        
        // Insert tag at cursor position
        input.value = textBefore + tag + textAfter;
        
        // Move cursor to after inserted tag
        const newCursorPos = cursorPos + tag.length;
        input.setSelectionRange(newCursorPos, newCursorPos);
        
        // Re-render word selector with updated text
        renderWordSelector(input.value);
        
        // Refocus input
        input.focus();
        
        // Visual feedback on tag
        tagPill.style.background = '#28a745';
        setTimeout(() => {
            tagPill.style.background = '#007bff';
        }, 200);
    });
    
    renameTagsContainer.appendChild(tagPill);
});
}

// Parse text into selectable words
function parseTextIntoWords(text) {
const words = [];
let currentWord = '';
let startIndex = 0;
let currentType = null; // 'letter', 'number', or 'special'

const getCharType = (char) => {
if (/[a-zA-Z]/.test(char)) return 'letter';
if (/[0-9]/.test(char)) return 'number';
return 'special';
};

const isUpperCase = (char) => /[A-Z]/.test(char);
const isLowerCase = (char) => /[a-z]/.test(char);

for (let i = 0; i < text.length; i++) {
const char = text[i];
const charType = getCharType(char);
const prevChar = i > 0 ? text[i - 1] : null;

// ✅ Detect camelCase boundary: lowercase -> uppercase
const isCamelCaseBoundary = prevChar && 
                            isLowerCase(prevChar) && 
                            isUpperCase(char) && 
                            charType === 'letter' && 
                            currentType === 'letter';

// Start new word if type changes OR if special character OR camelCase boundary
if (currentType === null) {
    // Starting first word
    currentType = charType;
    currentWord = char;
    startIndex = i;
} else if (charType === 'special' || currentType === 'special' || charType !== currentType || isCamelCaseBoundary) {
    // Save current word if exists
    if (currentWord !== '') {
        words.push({ 
            word: currentWord, 
            start: startIndex, 
            end: i,
            isSeparator: currentType === 'special'
        });
    }
    
    // Start new word
    currentType = charType;
    currentWord = char;
    startIndex = i;
} else {
    // Same type, continue building word
    currentWord += char;
}
}

// Add last word if exists
if (currentWord !== '') {
words.push({ 
    word: currentWord, 
    start: startIndex, 
    end: text.length,
    isSeparator: currentType === 'special'
});
}

return words;
}

// Render word selector
function renderWordSelector(text) {
wordSelectorContainer.innerHTML = '';
selectedWords.clear();

const words = parseTextIntoWords(text);

words.forEach((wordObj, index) => {
const span = document.createElement('span');
span.textContent = wordObj.word;
span.dataset.index = index;

// ✅ Make ALL words selectable (including special characters)
if (wordObj.isSeparator) {
    span.className = 'word-selectable word-separator';
} else {
    span.className = 'word-selectable';
}

// ✅ Add click handler to ALL spans
span.addEventListener('click', () => {
    if (selectedWords.has(index)) {
        selectedWords.delete(index);
        span.classList.remove('word-selected');
    } else {
        selectedWords.add(index);
        span.classList.add('word-selected');
    }
});

wordSelectorContainer.appendChild(span);
});
}

// Add brackets button handler
addBracketsBtn.addEventListener('click', () => {
if (selectedWords.size === 0) {
    alert('Please select at least one word');
    return;
}

const selectedIndices = Array.from(selectedWords).sort((a, b) => a - b);
const firstIndex = selectedIndices[0];
const lastIndex = selectedIndices[selectedIndices.length - 1];

const words = parseTextIntoWords(input.value);

// Extract the range from first to last selected word
let selectionStart = -1;
let selectionEnd = -1;
let selectedText = '';

words.forEach((wordObj, index) => {
    if (index >= firstIndex && index <= lastIndex) {
        if (selectionStart === -1) selectionStart = wordObj.start;
        selectionEnd = wordObj.end;
        
        if (wordObj.isSeparator) {
            // Replace special characters with space
            selectedText += ' ';
        } else {
            selectedText += wordObj.word;
        }
    }
});

// Clean up multiple spaces
selectedText = selectedText.replace(/\s+/g, ' ').trim();

// Build new filename: before + [selection] + after
const before = input.value.substring(0, words[firstIndex].start);
const after = input.value.substring(words[lastIndex].end);

const newText = before + '[' + selectedText + ']' + after;

input.value = newText;
renderWordSelector(newText);
});

// Remove words button handler
removeWordsBtn.addEventListener('click', () => {
if (selectedWords.size === 0) {
alert('Please select at least one word to remove');
return;
}

const selectedIndices = Array.from(selectedWords).sort((a, b) => a - b);
const words = parseTextIntoWords(input.value);

// Build new text by excluding selected words and their following separators
let newText = '';
let skipNext = false;

words.forEach((wordObj, index) => {
if (skipNext) {
   skipNext = false;
   return;
}

if (selectedIndices.includes(index)) {
   // Skip this word
   // If next item is a separator, mark it to be skipped too
   if (index + 1 < words.length && words[index + 1].isSeparator) {
       skipNext = true;
   }
} else {
   newText += wordObj.word;
}
});

input.value = newText;
renderWordSelector(newText);
});

// Add to Search button handler
const addToSearchBtn = document.getElementById('addToSearchBtn');
addToSearchBtn.addEventListener('click', () => {
if (selectedWords.size === 0) {
  alert('Please select at least one word to add to search');
  return;
}

const selectedIndices = Array.from(selectedWords).sort((a, b) => a - b);
const firstIndex = selectedIndices[0];
const lastIndex = selectedIndices[selectedIndices.length - 1];

const words = parseTextIntoWords(input.value);

// Extract the range from first to last selected word
let selectedText = '';

words.forEach((wordObj, index) => {
  if (index >= firstIndex && index <= lastIndex) {
      if (wordObj.isSeparator) {
          // Replace special characters with space
          selectedText += ' ';
      } else {
          selectedText += wordObj.word;
      }
  }
});

// Clean up multiple spaces
selectedText = selectedText.replace(/\s+/g, ' ').trim();

// Add to search box
const searchBox = document.getElementById('filenameSearchBox');
if (searchBox) {
 // Close the rename modal
 modal.remove();
 
 // ✅ Check if in landscape mobile mode
 const isLandscape = window.matchMedia('(orientation: landscape)').matches;
 const isMobile = window.innerWidth <= 1024;
 
 // ✅ Only dismiss panels if NOT in landscape mobile (where main list is in panel)
 if (!(isLandscape && isMobile)) {
     if (typeof toggleBasket === 'function') toggleBasket(false);
     if (typeof toggleHistory === 'function') toggleHistory(false);
     if (typeof toggleRandomPlaylistPanel === 'function') toggleRandomPlaylistPanel(false);
 }
 
 // Set search box value
 searchBox.value = selectedText;
 
 // Show clear X button
 const clearX = document.getElementById('clearSearchX');
 if (clearX) clearX.style.display = 'block';
 
 // ✅ Also update panel search box if it exists
 const panelSearchBox = document.getElementById('panelSearchBox');
 const panelSearchClearX = document.getElementById('panelSearchClearX');
 if (panelSearchBox) {
     panelSearchBox.value = selectedText;
     if (panelSearchClearX) {
         panelSearchClearX.style.display = 'block';
     }
 }
 
 // ✅ PREVENT panel from auto-opening
 window.skipPanelAutoOpen = true;
 
 // Trigger search
 if (typeof filterDisplayedByFilename === 'function') {
     filterDisplayedByFilename();
 }
  
  // ✅ Only scroll if NOT in landscape mobile (search is in panel)
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
  
  console.log(`Added selected words to search: "${selectedText}"`);
} else {
  alert('Search box not found');
}
});

// ✅ Track if navigation has been initiated (declared once at top)
let prevButtonInitiated = false;
let nextButtonInitiated = false;

// < button - jump to previous word edge
const prevWordEdgeBtn = document.getElementById('prevWordEdgeBtn');
prevWordEdgeBtn.addEventListener('click', () => {
const cursorPos = input.selectionStart;
const text = input.value;

// ✅ First tap: jump to END of filename
if (!prevButtonInitiated) {
prevButtonInitiated = true;
nextButtonInitiated = false; // Reset the other button
input.setSelectionRange(text.length, text.length);
input.focus();
return;
}

const words = parseTextIntoWords(text);

// Find all word boundaries (start positions)
const boundaries = words.map(w => w.start).filter(pos => pos < cursorPos);

if (boundaries.length === 0) {
// Jump to start if no boundaries before cursor
input.setSelectionRange(0, 0);
} else {
// Jump to nearest boundary before cursor
const newPos = boundaries[boundaries.length - 1];
input.setSelectionRange(newPos, newPos);
}

input.focus();
});

// > button - jump to next word edge
const nextWordEdgeBtn = document.getElementById('nextWordEdgeBtn');
nextWordEdgeBtn.addEventListener('click', () => {
const cursorPos = input.selectionStart;
const text = input.value;

// ✅ First tap: jump to START of filename
if (!nextButtonInitiated) {
nextButtonInitiated = true;
prevButtonInitiated = false; // Reset the other button
input.setSelectionRange(0, 0);
input.focus();
return;
}

const words = parseTextIntoWords(text);

// Find all word boundaries (end positions)
const boundaries = words.map(w => w.end).filter(pos => pos > cursorPos);

if (boundaries.length === 0) {
// Jump to end if no boundaries after cursor
input.setSelectionRange(text.length, text.length);
} else {
// Jump to nearest boundary after cursor
const newPos = boundaries[0];
input.setSelectionRange(newPos, newPos);
}

input.focus();
});

// Sync word selector when input changes
input.addEventListener('input', () => {
renderWordSelector(input.value);
});
// ✅ Initial render of tags
renderRenameTags();

// ✅ Initial render of word selector
renderWordSelector(nameWithoutExt);

// Only auto-focus on desktop
if (window.innerWidth > 768) {
input.focus();
input.select();
}

// Close on background click
modal.addEventListener('click', (e) => {
if (e.target === modal) modal.remove();
});

// Cancel button
document.getElementById('cancelRenameBtn').addEventListener('click', () => {
modal.remove();
});

// Confirm rename
document.getElementById('confirmRenameBtn').addEventListener('click', async () => {
const newName = input.value.trim();
if (!newName) {
    alert('Filename cannot be empty');
    return;
}

const fullNewName = newName + extension;
if (fullNewName === currentName) {
    modal.remove();
    return;
}

const confirmBtn = document.getElementById('confirmRenameBtn');
confirmBtn.disabled = true;
confirmBtn.textContent = 'Renaming...';

try {
    await renameFile(video, fullNewName);
    
    // ✅ Auto-refresh after rename
    confirmBtn.textContent = 'Refreshing...';
    
    try {
        // Update video object with new filename before refresh
        video.filename = fullNewName;
        
        // Call the same comprehensive refresh used by basket
        const refreshedVideo = await refreshSingleVideoComprehensive(video);
        
        // Update in basket if present
        const basketIndex = window.basketVideos?.findIndex(v => v.oneDriveId === video.oneDriveId);
        if (basketIndex >= 0) {
            window.basketVideos[basketIndex] = refreshedVideo;
            window.saveBasket();
            window.renderBasket();
        }
        
        // Update in history if present
        const historyItems = window.historyVideos?.filter(v => v.oneDriveId === video.oneDriveId);
        if (historyItems) {
            historyItems.forEach(item => {
                item.filename = refreshedVideo.filename;
                Object.assign(item, refreshedVideo);
            });
            window.saveHistory();
            window.renderHistory();
        }
        
        // ✅ Update currently playing video info if this is the active video
        if (window.currentPlayingVideo && window.currentPlayingVideo.oneDriveId === video.oneDriveId) {
            window.currentPlayingVideo.filename = refreshedVideo.filename;
            Object.assign(window.currentPlayingVideo, refreshedVideo);
            
            if (typeof window.rebuildVideoInfoDisplay === 'function') {
                window.rebuildVideoInfoDisplay(window.currentPlayingVideo);
            }
        }
        
        // Refresh tag dropdowns
        if (typeof populateTagDropdowns === 'function') {
            await populateTagDropdowns();
        }
        
        // Refresh all lists (main, random, history, basket)
        refreshAllLists();
        
        console.log(`Refreshed after rename: ${refreshedVideo.filename}`);
    
} catch (refreshErr) {
    console.warn('Refresh after rename failed:', refreshErr);
    // Don't block success - rename already worked
}

// ✅ Close modal immediately
modal.remove();

// ✅ Show score-confirmation-style tooltip
showScoreConfirmation(`✅ Renamed to:<br><span style="font-size: 0.5em; opacity: 0.9;">${fullNewName}</span>`);

} catch (err) {
console.error('Rename failed:', err);
alert(`Rename failed: ${err.message}`);
confirmBtn.disabled = false;
confirmBtn.textContent = 'Rename';
}
});

// Enter key to confirm, ESC to cancel
input.addEventListener('keydown', (e) => {
if (e.key === 'Enter') {
  document.getElementById('confirmRenameBtn').click();
} else if (e.key === 'Escape') {
  modal.remove();
}
});
}

/**
* Show delete confirmation modal
*/
async function showDeleteModal(video) {
   const modal = document.createElement('div');
    modal.className = 'basket-json-modal';
    modal.innerHTML = `
   <div class="basket-json-modal-content">
           <h3>Delete File</h3>
           ${(video.driveId === "local" || (video.accountKey || "").startsWith("local::"))
               ? '<p class="file-operation-warning">This permanently deletes the file from your device. There is no recycle bin.</p>'
               : '<p class="file-operation-warning">This will move the file to the OneDrive Recycle bin</p>'}
           <p class="file-operation-path">${video.path || ''}</p>
           <p class="file-operation-filename"><strong>${video.filename || ''}</strong></p>
           <div class="file-operation-buttons">
               <button id="confirmDeleteBtn" class="modal-btn modal-btn-danger">Delete</button>
               <button id="cancelDeleteBtn" class="modal-btn modal-btn-cancel">Cancel</button>
           </div>
       </div>
   `;
   document.body.appendChild(modal);

   // Close on background click
   modal.addEventListener('click', (e) => {
       if (e.target === modal) modal.remove();
   });

   // Cancel button
   document.getElementById('cancelDeleteBtn').addEventListener('click', () => {
       modal.remove();
   });

   // Confirm delete
   document.getElementById('confirmDeleteBtn').addEventListener('click', async () => {
       const confirmBtn = document.getElementById('confirmDeleteBtn');
       confirmBtn.disabled = true;
       confirmBtn.textContent = 'Deleting...';

       try {
           await deleteFile(video);
           modal.remove();
           alert(`Successfully deleted: ${video.filename}`);
       } catch (err) {
           console.error('Delete failed:', err);
           alert(`Delete failed: ${err.message}`);
           confirmBtn.disabled = false;
           confirmBtn.textContent = 'Delete';
       }
   });
}

/**
* Rename a file in OneDrive via Graph API
*/
/**
* Rename a file in OneDrive via Graph API
*/
// =========================================
// LOCAL FILE OPERATIONS
// For local rows, oneDriveId IS the relative path - so a rename changes the
// primary key and the row has to be migrated rather than patched in place.
// =========================================
function isLocalVideo(video) {
   return video?.driveId === "local" || (video?.accountKey || "").startsWith("local::");
}
window.isLocalVideo = isLocalVideo;

/**
* Move a videoSource + videoMeta row from one key to another.
*/
async function migrateLocalVideoKey(oldId, newId, newFilename, newDownloadUrl) {
   const db = await openDB();
   const tx = db.transaction([STORE_NAME, META_STORE_NAME], "readwrite");
   const sourceStore = tx.objectStore(STORE_NAME);
   const metaStore = tx.objectStore(META_STORE_NAME);

   const getOne = (store, key) => new Promise((resolve, reject) => {
       const req = store.get(key);
       req.onsuccess = () => resolve(req.result);
       req.onerror = () => reject(req.error);
   });

   const row = await getOne(sourceStore, oldId);
   if (row) {
       const parts = newId.split('/');
       const newPath = parts.slice(0, -1).join('/');

       const bracketTags = typeof generateTagsFromFilename === "function"
           ? generateTagsFromFilename(newFilename)
           : (row.bracketTags || []);
       const pathTags = typeof generateTagsFromPath === "function"
           ? generateTagsFromPath(newPath)
           : [];

       // videoKey is the join to the catalogue, NOT a mirror of the filename.
       // Once a row has been matched (inCatalogue true) the key belongs to the
       // server and a local rename must never move it — see the comment in
       // render.js's fingerprint adopt. But an unmatched row's key was only
       // ever seeded from the filename at scan time, so leaving it behind
       // points the row at a name this device no longer has.
       const keyPatch = row.inCatalogue === true
           ? {}
           : { videoKey: window.scrayVideoKey(newFilename) };

       sourceStore.delete(oldId);
       sourceStore.put({
           ...row,
           oneDriveId: newId,
           filename: newFilename,
           path: newPath,
           downloadUrl: newDownloadUrl,
           bracketTags,
           tags: [...new Set([...pathTags, ...bracketTags])],
           ...keyPatch
       });
   }

   const metaRow = await getOne(metaStore, oldId);
   if (metaRow) {
       metaStore.delete(oldId);
       metaStore.put({ ...metaRow, oneDriveId: newId });
   }

   return tx.complete;
}

/**
* Re-key an item across basket / history / filtered arrays.
*/
function rekeyVideoInMemory(oldId, newId, updates) {
   const apply = (arr) => {
       if (!arr) return false;
       let changed = false;
       arr.forEach(v => {
           if (v.oneDriveId === oldId) {
               Object.assign(v, updates, { oneDriveId: newId });
               changed = true;
           }
       });
       return changed;
   };

   if (apply(window.basketVideos) && typeof window.saveBasket === "function") window.saveBasket();
   if (apply(window.historyVideos) && typeof window.saveHistory === "function") window.saveHistory();
   apply(window.filteredVideosGlobal);

   if (window.selectedBasketIds?.has(oldId)) {
       window.selectedBasketIds.delete(oldId);
       window.selectedBasketIds.add(newId);
   }
}

async function renameLocalFile(video, newName) {
   const oldRelPath = video.oneDriveId;
   if (!oldRelPath) throw new Error("Missing file path - cannot rename");

   const result = await ScrayBridge.renameFile(oldRelPath, newName);

   // Trust the native layer's returned path if it gives one
   const parts = oldRelPath.split('/');
   parts[parts.length - 1] = newName;
   const newRelPath = (typeof result === "string" ? result : result?.path) || parts.join('/');

   const newDownloadUrl = `scray-video://local/${newRelPath.split('/').map(encodeURIComponent).join('/')}`;

   // Same rule as migrateLocalVideoKey: a matched row's key belongs to the
   // server, an unmatched row's key is just the filename and has to follow it.
   // Kept in step so IndexedDB and the in-memory arrays can't disagree.
   const keyPatch = video.inCatalogue === true
       ? {}
       : { videoKey: window.scrayVideoKey(newName) };

   await migrateLocalVideoKey(oldRelPath, newRelPath, newName, newDownloadUrl);
   rekeyVideoInMemory(oldRelPath, newRelPath, {
       filename: newName,
       downloadUrl: newDownloadUrl,
       ...keyPatch
   });

   // Mutate the caller's object so downstream code uses the new key
   video.oneDriveId = newRelPath;
   video.filename = newName;
   video.downloadUrl = newDownloadUrl;
   Object.assign(video, keyPatch);

   console.log(`Local rename: ${oldRelPath} -> ${newRelPath}`);
   refreshAllLists();
}

async function deleteLocalFile(video) {
   const relPath = video.oneDriveId;
   if (!relPath) throw new Error("Missing file path - cannot delete");

   // Stop playback first - deleting a file the WebView is streaming stalls it
   if (window.currentPlayingVideo?.oneDriveId === relPath && window.inlineVideoPlayer) {
       try { window.inlineVideoPlayer.stop(); } catch {}
   }

   await ScrayBridge.deleteFile(relPath);

   await deleteVideoFromDB(relPath);
   removeVideoFromMemory(relPath);

   console.log(`Local delete: ${relPath}`);
   refreshAllLists();
   if (typeof renderFolderPills === "function") renderFolderPills();
}

async function renameFile(video, newName) {
   // ✅ Local files bypass Graph entirely
   if (isLocalVideo(video)) {
       return renameLocalFile(video, newName);
   }

   // Get account info and refresh token
   const [accountIdStored] = (video.accountKey || "").split("::");
   let accountInfo = accountsData.find(acc => acc.accountId === accountIdStored);
   
   if (!accountInfo) {
       throw new Error(`Account not found for file: ${video.filename}`);
   }

   try {
       accountInfo.token = await refreshTokenForAccount(accountIdStored);
   } catch (err) {
       throw new Error(`Authentication failed: ${err.message}`);
   }

   // Ensure we have the necessary IDs
   if (!video.driveId || !video.oneDriveId) {
       throw new Error('Missing OneDrive IDs - cannot rename file');
   }

   // Call Graph API to rename
   const url = `https://graph.microsoft.com/v1.0/drives/${video.driveId}/items/${video.oneDriveId}`;
   const response = await fetch(url, {
       method: 'PATCH',
       headers: {
           'Authorization': `Bearer ${accountInfo.token}`,
           'Content-Type': 'application/json'
       },
       body: JSON.stringify({ name: newName })
   });

   if (!response.ok) {
       const error = await response.json().catch(() => ({}));
       throw new Error(error.error?.message || `HTTP ${response.status}`);
   }

   const updated = await response.json();
   console.log('File renamed successfully:', updated);

   // Update IndexedDB
   try {
       await updateVideoInDB(video.oneDriveId, { filename: newName });
       console.log('IndexedDB updated successfully');
   } catch (dbErr) {
       console.warn('IndexedDB update failed, but OneDrive rename succeeded:', dbErr);
       // Don't throw - the rename worked in OneDrive which is what matters
   }

   // Update in-memory arrays
   updateVideoInMemory(video.oneDriveId, { filename: newName });

   // Re-render all lists
   refreshAllLists();
}

/**
* Delete a file from OneDrive via Graph API
*/
async function deleteFile(video) {
   // ✅ Local files bypass Graph entirely
   if (isLocalVideo(video)) {
       return deleteLocalFile(video);
   }

   // Get account info and refresh token
   const [accountIdStored] = (video.accountKey || "").split("::");
   let accountInfo = accountsData.find(acc => acc.accountId === accountIdStored);
   
   if (!accountInfo) {
       throw new Error(`Account not found for file: ${video.filename}`);
   }

   try {
       accountInfo.token = await refreshTokenForAccount(accountIdStored);
   } catch (err) {
       throw new Error(`Authentication failed: ${err.message}`);
   }

   // Ensure we have the necessary IDs
   if (!video.driveId || !video.oneDriveId) {
       throw new Error('Missing OneDrive IDs - cannot delete file');
   }

   // Call Graph API to delete
   const url = `https://graph.microsoft.com/v1.0/drives/${video.driveId}/items/${video.oneDriveId}`;
   const response = await fetch(url, {
       method: 'DELETE',
       headers: {
           'Authorization': `Bearer ${accountInfo.token}`
       }
   });

   if (!response.ok && response.status !== 204) {
       const error = await response.json().catch(() => ({}));
       throw new Error(error.error?.message || `HTTP ${response.status}`);
   }

   console.log('File deleted successfully');

   // Remove from IndexedDB
   await deleteVideoFromDB(video.oneDriveId);

   // Remove from in-memory arrays
   removeVideoFromMemory(video.oneDriveId);

   // Re-render all lists
   refreshAllLists();

      // Log what was kept
   console.log('File removed from all lists except history');
}

/**
* Update video metadata in IndexedDB
*/
async function updateVideoInDB(oneDriveId, updates, opts = {}) {
// Split updates between videoMeta (your data) and videoSource (file-derived
// data) so callers don't need to know or care which store a field lives in.
const metaUpdates = {};
const sourceUpdates = {};
for (const [key, value] of Object.entries(updates)) {
    if (window.VIDEO_META_FIELDS && window.VIDEO_META_FIELDS.has(key)) {
        metaUpdates[key] = value;
    } else {
        sourceUpdates[key] = value;
    }
}

if (Object.keys(metaUpdates).length > 0 && typeof saveVideoMeta === 'function') {
    console.log('Updating videoMeta:', metaUpdates);
    await saveVideoMeta(oneDriveId, metaUpdates, "app");
}

if (Object.keys(sourceUpdates).length > 0) {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);

    const existing = await new Promise((resolve, reject) => {
        const request = store.get(oneDriveId);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });

    if (existing) {
        const updated = { ...existing, ...sourceUpdates, oneDriveId };
        console.log('Updating videoSource with merged data:', updated);
        store.put(updated);
    } else {
        console.warn(`No existing videoSource record found for ${oneDriveId}`);
    }

    await new Promise((resolve, reject) => {
        tx.oncomplete = () => {
            console.log('IndexedDB update transaction completed');
            resolve();
        };
        tx.onerror = () => {
            console.error('IndexedDB update transaction error:', tx.error);
            reject(tx.error);
        };
    });
}

// saveVideoMeta (db.js) already enqueued the videoMeta half of `updates`.
// Enqueue only the videoSource-side fields this function is responsible for.
if (!opts.fromSync && typeof window.scrayEnqueueOp === "function") {
    const remaining = {};
    for (const [k, v] of Object.entries(updates)) {
        const isMeta = window.VIDEO_META_FIELDS && window.VIDEO_META_FIELDS.has(k);
        if (!isMeta) remaining[k] = v;
    }
    if (Object.keys(remaining).length) {
        await window.scrayEnqueueOp(oneDriveId, remaining);
    }
}
}

/**
* Delete video from IndexedDB
*/
async function deleteVideoFromDB(oneDriveId, opts = {}) {
   const db = await openDB();

   // Read the row BEFORE deleting it — the outbox op needs the video_key and
   // there is nothing left to derive it from afterwards.
   const row = await new Promise((res) => {
     const r = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(oneDriveId);
     r.onsuccess = () => res(r.result || null);
     r.onerror   = () => res(null);
   });

   const tx = db.transaction(STORE_NAME, "readwrite");
   const store = tx.objectStore(STORE_NAME);
   store.delete(oneDriveId);
   await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });

   // localOnly = "forget this file here", not "this video is gone".
   if (opts.localOnly || opts.fromSync) return;

   // oneDriveId is a RELATIVE PATH for local files. Sending it as the op id
   // made api.php insert a new row keyed "subfolder/file.mp4" and tombstone
   // that instead — 199 junk rows, one per nested video.
   const key = row?.videoKey || (row?.filename ? window.scrayVideoKey(row.filename) : null);
   if (!key) {
       console.warn(`[sync] no video_key for ${oneDriveId} — delete not queued`);
       return;
   }

   // Soft-delete on the server. A hard delete would make the row look "new"
   // to any device that hasn't pulled yet, and it would come straight back.
   if (typeof window.scrayEnqueueOp === "function") {
       try {
           const outboxDb = await openDB();
           const otx = outboxDb.transaction("outbox", "readwrite");
           otx.objectStore("outbox").add({
               oneDriveId,
               op: { id: key, device: window.SCRAY_SYNC.DEVICE_ID, delete: true },
               at: new Date().toISOString()
           });
           await new Promise((res, rej) => { otx.oncomplete = res; otx.onerror = () => rej(otx.error); });
       } catch (err) {
           console.warn("[sync] could not queue delete:", err);
       }
   }
}

/**
* Update video in all in-memory arrays
*/
function updateVideoInMemory(oneDriveId, updates) {
   // Update in basket
   const basketIndex = window.basketVideos?.findIndex(v => v.oneDriveId === oneDriveId);
   if (basketIndex >= 0) {
       window.basketVideos[basketIndex] = { ...window.basketVideos[basketIndex], ...updates };
       window.saveBasket();
   }

   // Update in history
   const historyItems = window.historyVideos?.filter(v => v.oneDriveId === oneDriveId);
   if (historyItems) {
       historyItems.forEach(item => {
           Object.assign(item, updates);
       });
       window.saveHistory();
   }

   // Update in filtered videos global
   if (window.filteredVideosGlobal) {
       const filteredIndex = window.filteredVideosGlobal.findIndex(v => v.oneDriveId === oneDriveId);
       if (filteredIndex >= 0) {
           window.filteredVideosGlobal[filteredIndex] = { ...window.filteredVideosGlobal[filteredIndex], ...updates };
       }
   }
}

/**
* Remove video from all in-memory arrays EXCEPT history
*/
function removeVideoFromMemory(oneDriveId) {
   // Remove from basket
   if (window.basketVideos) {
       const beforeCount = window.basketVideos.length;
       window.basketVideos = window.basketVideos.filter(v => v.oneDriveId !== oneDriveId);
       const afterCount = window.basketVideos.length;
       if (beforeCount !== afterCount) {
           console.log(`Removed from basket (${beforeCount} → ${afterCount})`);
           window.saveBasket();
       }
   }

   // ✅ DO NOT remove from history - keep the play history intact
   // Users may want to see what they watched even if the file is deleted
   
   // Remove from filtered videos global (main list)
   if (window.filteredVideosGlobal) {
       const beforeCount = window.filteredVideosGlobal.length;
       window.filteredVideosGlobal = window.filteredVideosGlobal.filter(v => v.oneDriveId !== oneDriveId);
       const afterCount = window.filteredVideosGlobal.length;
       if (beforeCount !== afterCount) {
           console.log(`Removed from main list (${beforeCount} → ${afterCount})`);
       }
   }
   
   // Remove from pagination state if active
   if (window.paginationState && window.paginationState.allVideos) {
       const beforeCount = window.paginationState.allVideos.length;
       window.paginationState.allVideos = window.paginationState.allVideos.filter(v => v.oneDriveId !== oneDriveId);
       const afterCount = window.paginationState.allVideos.length;
       if (beforeCount !== afterCount) {
           console.log(`Removed from pagination state (${beforeCount} → ${afterCount})`);
       }
   }
}

/**
* Refresh all visible lists
*/
function refreshAllLists() {
// Re-render basket
if (typeof window.renderBasket === 'function') {
   window.renderBasket();
}

// Re-render history
if (typeof window.renderHistory === 'function') {
   window.renderHistory();
}

// Re-render main lists
if (typeof window.filterDisplayedByFilename === 'function') {
   window.skipSearchScroll = true;
   window.skipPanelAutoOpen = true; // ✅ Prevent panel from auto-opening during refresh
   window.filterDisplayedByFilename();
}

// Re-render random panel if open
if (window.randomPanelOpen && typeof window.renderRandomPlaylistInPanel === 'function') {
    const randomList = document.getElementById('randomPlaylistPanelList');
    if (randomList && randomList.children.length > 0) {
        // Get current videos from panel (exclude total size header)
        const currentVideos = window.filteredVideosGlobal || [];
        window.renderRandomPlaylistInPanel(currentVideos);
    }
}

// ✅ Update "now playing" display if video is currently playing
if (window.currentPlayingVideo && typeof window.rebuildVideoInfoDisplay === 'function') {
    window.rebuildVideoInfoDisplay(window.currentPlayingVideo);
}
}

/**
* Show move file modal with path selection
*/
async function showMoveFileModal(video) {
// Get all unique paths from database - NOW INCLUDES ALL ACCOUNTS
const allVideos = await getAllVideos();
const pathMap = new Map(); // Map: path -> { path, accountName, accountKey }

allVideos.forEach(v => {
// ✅ Include paths from ALL accounts (removed account filter)
if (v.path && v.path !== 'yet-to-upload') {
// Split path into segments and add all parent paths
const segments = v.path.split('/').filter(Boolean);
let currentPath = '';
segments.forEach(segment => {
currentPath = currentPath ? `${currentPath}/${segment}` : segment;
// Store path with account info
if (!pathMap.has(currentPath)) {
    pathMap.set(currentPath, {
        path: currentPath,
        accountName: v.accountName,
        accountKey: v.accountKey
    });
}
});
}
});

// Convert to array and sort - current location at top
const allPaths = Array.from(pathMap.values()).sort((a, b) => {
// ✅ Current location always at top
const aIsCurrent = a.path === video.path && a.accountKey === video.accountKey;
const bIsCurrent = b.path === video.path && b.accountKey === video.accountKey;

if (aIsCurrent) return -1; // a is current, move to top
if (bIsCurrent) return 1;  // b is current, move to top

// Sort others by account first, then path
if (a.accountName !== b.accountName) {
    return a.accountName.localeCompare(b.accountName);
}
return a.path.localeCompare(b.path);
});

if (allPaths.length === 0) {
alert('No destination folders found in database');
return;
}

const modal = document.createElement('div');
modal.className = 'basket-json-modal';
modal.innerHTML = `
<div class="basket-json-modal-content basket-json-modal-wide">
<h3>Move File</h3>
<p style="font-size: 0.85rem; color: #666; margin-bottom: 12px; word-break: break-word;">
    <strong>${video.filename}</strong><br>
    Current location: ${video.path ? (video.path.startsWith('*') ? video.path.substring(1) : video.path) : 'root'}
</p>

<!-- ✅ Progress bar (hidden by default) -->
<div id="moveProgressContainer" style="display: none; margin-bottom: 12px; padding: 12px; background: #e3f2fd; border-radius: 4px;">
    <div style="font-size: 0.85rem; margin-bottom: 8px; font-weight: bold;" id="moveProgressText">Processing...</div>
    <div style="width: 100%; background: #ddd; height: 20px; border-radius: 10px; overflow: hidden;">
        <div id="moveProgressBar" style="width: 0%; height: 100%; background: #007bff; transition: width 0.3s ease;"></div>
    </div>
    <div style="font-size: 0.75rem; color: #666; margin-top: 4px;" id="moveProgressDetails"></div>
</div>

<input type="text" id="movePathSearch" placeholder="Search folders..."
           style="width: 100%; padding: 8px; border: 2px solid #ddd; border-radius: 4px; margin-bottom: 8px; box-sizing: border-box;">
    
    <input type="text" id="newFolderName" placeholder="(Optional) Create new folder at selected path..." 
           style="width: 100%; padding: 8px; border: 2px solid #ddd; border-radius: 4px; margin-bottom: 12px; box-sizing: border-box;">
    
    <div id="movePathList" style="max-height: 400px; overflow-y: auto; border: 1px solid #ddd; border-radius: 4px; margin-bottom: 16px;">
        <!-- Populated by renderPaths() -->
    </div>
    
    <div class="basket-json-modal-buttons" style="display: flex; gap: 10px; flex-wrap: wrap;">
        <button id="confirmMoveBtn" class="modal-btn modal-btn-primary" style="flex: 1; min-width: 120px;" disabled>Move</button>
        <button id="goToFolderBtn" class="modal-btn modal-btn-secondary" style="flex: 1; min-width: 120px; display:none;" disabled>Go to Folder</button>
        <button id="deleteSelectedFolderBtn" class="modal-btn modal-btn-danger" style="flex: 1; min-width: 120px; display:none;" disabled>Delete Folder</button>
    </div>
    <button id="cancelMoveBtn" class="modal-btn modal-btn-cancel" style="width: 100%; margin-top: 10px;">Cancel</button>
</div>
`;
document.body.appendChild(modal);

const pathListContainer = document.getElementById('movePathList');
const searchInput = document.getElementById('movePathSearch');
const newFolderInput = document.getElementById('newFolderName');
const confirmBtn = document.getElementById('confirmMoveBtn');
const goToFolderBtn = document.getElementById('goToFolderBtn');
const deleteFolderBtn = document.getElementById('deleteSelectedFolderBtn');
let selectedPath = null;

// Render paths function
function renderPaths(paths) {
pathListContainer.innerHTML = '';

if (paths.length === 0) {
pathListContainer.innerHTML = '<div style="padding: 20px; text-align: center; color: #999;">No matching folders found</div>';
return;
}

paths.forEach(pathInfo => {
const pathItem = document.createElement('div');
pathItem.className = 'move-path-item';
const displayPath = pathInfo.path.startsWith('*') ? pathInfo.path.substring(1) : pathInfo.path;

// ✅ Show account name before path
const accountSpan = document.createElement('span');
accountSpan.textContent = `[${pathInfo.accountName}] `;
accountSpan.style.color = '#666';
accountSpan.style.fontSize = '0.7rem';
accountSpan.style.fontWeight = 'bold';
pathItem.appendChild(accountSpan);

const pathSpan = document.createElement('span');
pathSpan.textContent = displayPath;
pathItem.appendChild(pathSpan);

pathItem.dataset.path = pathInfo.path;
pathItem.dataset.accountKey = pathInfo.accountKey;
pathItem.dataset.accountName = pathInfo.accountName;

// Highlight if this is the current path AND account
if (pathInfo.path === video.path && pathInfo.accountKey === video.accountKey) {
    pathItem.style.background = '#e8f5e9';
    pathItem.style.color = '#2e7d32';
    const currentLabel = document.createElement('span');
    currentLabel.textContent = ' (current)';
    currentLabel.style.fontSize = '0.75rem';
    currentLabel.style.fontStyle = 'italic';
    pathItem.appendChild(currentLabel);
}
    
    pathItem.addEventListener('click', () => {
    // Deselect all
    pathListContainer.querySelectorAll('.move-path-item').forEach(item => {
        item.classList.remove('move-path-selected');
    });
    
    // Select clicked item
    pathItem.classList.add('move-path-selected');
    selectedPath = pathInfo; // ✅ Store full path info (includes accountKey)
    confirmBtn.disabled = false;
        
        // ✅ Show all folder action buttons
        goToFolderBtn.style.display = 'block';
        goToFolderBtn.disabled = false;
        deleteFolderBtn.style.display = 'block';
        deleteFolderBtn.disabled = false;
    });
    
    pathListContainer.appendChild(pathItem);
});
}

// Initial render
renderPaths(allPaths);

// Search functionality
searchInput.addEventListener('input', () => {
const searchTerm = searchInput.value.toLowerCase().trim();
if (searchTerm === '') {
renderPaths(allPaths);
} else {
const filtered = allPaths.filter(pathInfo => 
    pathInfo.path.toLowerCase().includes(searchTerm) ||
    pathInfo.accountName.toLowerCase().includes(searchTerm)
);
renderPaths(filtered);
}
});

// Focus search input
setTimeout(() => searchInput.focus(), 100);

// Cancel button
document.getElementById('cancelMoveBtn').addEventListener('click', () => {
modal.remove();
});

// ESC key to cancel
const moveEscHandler = (e) => {
if (e.key === 'Escape') {
    modal.remove();
    document.removeEventListener('keydown', moveEscHandler);
}
};
document.addEventListener('keydown', moveEscHandler);

// Go to Folder button
goToFolderBtn.addEventListener('click', async () => {
if (!selectedPath) {
    alert('Please select a folder');
    return;
}

goToFolderBtn.disabled = true;
goToFolderBtn.textContent = 'Opening...';

try {
    const folderUrl = await getFolderWebUrl(video, selectedPath);
    
    if (folderUrl) {
        // ✅ Use anchor element click - works reliably on mobile
        const link = document.createElement('a');
        link.href = folderUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        // Show success briefly
        goToFolderBtn.textContent = '✅ Opened';
        goToFolderBtn.style.background = '#28a745';
        
        setTimeout(() => {
            goToFolderBtn.textContent = 'Go to Folder';
            goToFolderBtn.style.background = '';
            goToFolderBtn.disabled = false;
        }, 2000);
    } else {
        throw new Error('Could not get folder URL');
    }
    
} catch (err) {
    console.error('Go to folder failed:', err);
    alert(`Failed to open folder: ${err.message}`);
    goToFolderBtn.textContent = 'Go to Folder';
    goToFolderBtn.style.background = '';
    goToFolderBtn.disabled = false;
}
});

// ✅ Delete folder button
deleteFolderBtn.addEventListener('click', async () => {
if (!selectedPath) {
    alert('Please select a folder to delete');
    return;
}

// Confirmation with folder name
const displayPath = selectedPath.startsWith('*') ? selectedPath.substring(1) : selectedPath;
if (!confirm(`Delete folder "${displayPath}" and ALL its contents?\n\nThis will move the folder to OneDrive Recycle Bin.`)) {
    return;
}

deleteFolderBtn.disabled = true;
deleteFolderBtn.textContent = 'Deleting...';

try {
    await deleteFolder(video, selectedPath);
    
    // Show success
    deleteFolderBtn.textContent = '✅ Deleted';
    deleteFolderBtn.style.background = '#28a745';
    
    setTimeout(() => {
        modal.remove();
    }, 1500);
    
} catch (err) {
    console.error('Delete folder failed:', err);
    alert(`Delete failed: ${err.message}`);
    deleteFolderBtn.disabled = false;
    deleteFolderBtn.textContent = 'Delete Folder';
}
});

// Confirm move button
confirmBtn.addEventListener('click', async () => {
if (!selectedPath) {
alert('Please select a destination folder');
return;
}

// ✅ Check if new folder name provided
const newFolderName = newFolderInput.value.trim();

// ✅ Check if same location AND account
if (selectedPath.path === video.path && 
selectedPath.accountKey === video.accountKey && 
!newFolderName) {
alert('File is already in this location');
return;
}

// ✅ Disable all interactive elements during operation
confirmBtn.disabled = true;
goToFolderBtn.disabled = true;
deleteFolderBtn.disabled = true;
searchInput.disabled = true;
newFolderInput.disabled = true;
pathListContainer.style.pointerEvents = 'none';
confirmBtn.textContent = 'Processing...';

try {
// ✅ Detect cross-account move
if (selectedPath.accountKey !== video.accountKey) {
    confirmBtn.textContent = 'Moving between accounts...';
    await moveFileBetweenAccounts(video, selectedPath, newFolderName);
} else {
    await moveFile(video, selectedPath.path, newFolderName);
}

// Show success
confirmBtn.textContent = '✅ Success';
confirmBtn.style.background = '#28a745';

setTimeout(() => {
    modal.remove();
}, 1500);

} catch (err) {
console.error('Move failed:', err);

// ✅ Hide progress UI on error
const progressContainer = document.getElementById('moveProgressContainer');
if (progressContainer) progressContainer.style.display = 'none';

alert(`Move failed: ${err.message}`);

// Re-enable controls
confirmBtn.disabled = false;
goToFolderBtn.disabled = false;
deleteFolderBtn.disabled = false;
searchInput.disabled = false;
newFolderInput.disabled = false;
pathListContainer.style.pointerEvents = 'auto';
confirmBtn.textContent = 'Move';
}
});
// Close on background click
modal.addEventListener('click', (e) => {
if (e.target === modal) modal.remove();
});
}

/**
* Move a file to a different folder in OneDrive via Graph API
* ✅ Optionally create a new folder at the destination
*/
async function moveFile(video, destinationPath, newFolderName = null) {
// Get account info and refresh token
const [accountIdStored] = (video.accountKey || "").split("::");
let accountInfo = accountsData.find(acc => acc.accountId === accountIdStored);

if (!accountInfo) {
  throw new Error(`Account not found for file: ${video.filename}`);
}

try {
  accountInfo.token = await refreshTokenForAccount(accountIdStored);
} catch (err) {
  throw new Error(`Authentication failed: ${err.message}`);
}

// Ensure we have the necessary IDs
if (!video.driveId || !video.oneDriveId) {
  throw new Error('Missing OneDrive IDs - cannot move file');
}

// Get the destination folder ID
let destinationFolderId;
try {
  const cleanPath = destinationPath.replace(/^\*/, '');
  const segments = cleanPath.split('/').filter(Boolean);
  
  console.log(`Traversing path segments to find folder:`, segments);
  
  // Start from root
  let currentFolderId = 'root';
  
  // Traverse each segment to find the folder
  for (const segment of segments) {
      const childrenUrl = `https://graph.microsoft.com/v1.0/drives/${video.driveId}/items/${currentFolderId}/children?$filter=name eq '${segment.replace(/'/g, "''")}'`;
      const childrenData = await fetchJSONWithRetry(childrenUrl, accountInfo.token);
      
      if (!childrenData.value || childrenData.value.length === 0) {
          throw new Error(`Folder not found: ${segment}`);
      }
      
      const folder = childrenData.value.find(item => item.folder);
      if (!folder) {
          throw new Error(`'${segment}' is not a folder`);
      }
      
      currentFolderId = folder.id;
      console.log(`Found folder '${segment}' with ID: ${currentFolderId}`);
  }
  
  destinationFolderId = currentFolderId;
  
} catch (err) {
  console.error('Destination folder resolution error:', err);
  throw new Error(`Could not find destination folder: ${err.message}`);
}

// Create new folder if name provided (or use existing if it already exists)
if (newFolderName) {
console.log(`Creating new folder "${newFolderName}" at destination`);

const createFolderUrl = `https://graph.microsoft.com/v1.0/drives/${video.driveId}/items/${destinationFolderId}/children`;
const createResponse = await fetch(createFolderUrl, {
    method: 'POST',
    headers: {
        'Authorization': `Bearer ${accountInfo.token}`,
        'Content-Type': 'application/json'
    },
    body: JSON.stringify({
        name: newFolderName,
        folder: {},
        '@microsoft.graph.conflictBehavior': 'fail' // Fail if folder already exists
    })
});

if (!createResponse.ok) {
    const error = await createResponse.json().catch(() => ({}));
    
    // Check if folder already exists
    if (error.error?.code === 'nameAlreadyExists') {
        console.log(`Folder "${newFolderName}" already exists - using existing folder`);
        
        // Search for the existing folder
        const searchUrl = `https://graph.microsoft.com/v1.0/drives/${video.driveId}/items/${destinationFolderId}/children?$filter=name eq '${newFolderName.replace(/'/g, "''")}'&$select=id,name,folder`;
        const searchData = await fetchJSONWithRetry(searchUrl, accountInfo.token);
        
        if (!searchData.value || searchData.value.length === 0) {
            throw new Error(`Folder "${newFolderName}" exists but could not be found`);
        }
        
        const existingFolder = searchData.value.find(item => item.folder);
        if (!existingFolder) {
            throw new Error(`"${newFolderName}" exists but is not a folder`);
        }
        
        destinationFolderId = existingFolder.id;
        console.log(`Using existing folder with ID: ${destinationFolderId}`);
        
    } else {
        // Other error - re-throw
        throw new Error(error.error?.message || `Failed to create folder: HTTP ${createResponse.status}`);
    }
} else {
    // Successfully created new folder
    const newFolder = await createResponse.json();
    destinationFolderId = newFolder.id;
    console.log(`Created new folder with ID: ${destinationFolderId}`);
}

// Update destination path to include new folder
destinationPath = destinationPath ? `${destinationPath}/${newFolderName}` : newFolderName;
}

// ✅ Check for duplicate filename in destination folder
try {
  const childrenUrl = `https://graph.microsoft.com/v1.0/drives/${video.driveId}/items/${destinationFolderId}/children?$filter=name eq '${video.filename.replace(/'/g, "''")}'&$select=id,name`;
  const existingFiles = await fetchJSONWithRetry(childrenUrl, accountInfo.token);
  
  if (existingFiles.value && existingFiles.value.length > 0) {
      // File with same name already exists
      const confirmed = confirm(
          `A file named "${video.filename}" already exists in the destination folder.\n\n` +
          `Choose OK to rename the moved file (OneDrive will add a number), or Cancel to abort.`
      );
      
      if (!confirmed) {
          throw new Error('Move cancelled - duplicate filename exists');
      }
      
      console.log('User confirmed move with duplicate - OneDrive will auto-rename');
  }
} catch (checkErr) {
  // If check fails, continue anyway (better to attempt move than block)
  console.warn('Could not check for duplicates:', checkErr);
}

// Call Graph API to move file
const url = `https://graph.microsoft.com/v1.0/drives/${video.driveId}/items/${video.oneDriveId}`;
const response = await fetch(url, {
method: 'PATCH',
headers: {
    'Authorization': `Bearer ${accountInfo.token}`,
    'Content-Type': 'application/json'
},
body: JSON.stringify({ 
    parentReference: { id: destinationFolderId },
    '@microsoft.graph.conflictBehavior': 'rename' // ✅ Auto-rename if duplicate exists
})
});

if (!response.ok) {
const error = await response.json().catch(() => ({}));

// ✅ Provide user-friendly error for common issues
if (error.error?.code === 'nameAlreadyExists') {
    throw new Error('A file with this name already exists in the destination folder');
}

throw new Error(error.error?.message || `HTTP ${response.status}`);
}

const updated = await response.json();
console.log('File moved successfully:', updated);

// Update path in IndexedDB
try {
  await updateVideoInDB(video.oneDriveId, { path: destinationPath });
  console.log('IndexedDB updated successfully with new path');
} catch (dbErr) {
  console.warn('IndexedDB update failed, but OneDrive move succeeded:', dbErr);
}

console.log(`Moved ${video.filename} to ${destinationPath}`);

// ✅ Auto-refresh file metadata after move
try {
// Update video object's path first so refresh can use it
video.path = destinationPath;

const refreshedVideo = await refreshSingleVideoComprehensive(video);

// ✅ Update the original video object reference with ALL refreshed data
Object.assign(video, refreshedVideo);

// Update in basket if present
const basketIndex = window.basketVideos?.findIndex(v => v.oneDriveId === video.oneDriveId);
if (basketIndex >= 0) {
    window.basketVideos[basketIndex] = refreshedVideo;
    window.saveBasket();
    window.renderBasket();
}

// Update in history if present
const historyItems = window.historyVideos?.filter(v => v.oneDriveId === video.oneDriveId);
if (historyItems) {
  historyItems.forEach(item => {
      Object.assign(item, refreshedVideo);
  });
  window.saveHistory();
  window.renderHistory();
}

// CRITICAL: Update window.currentPlayingVideo FIRST, before any rendering
if (window.currentPlayingVideo && window.currentPlayingVideo.oneDriveId === video.oneDriveId) {
// Direct assignment (not spread) to maintain reference
Object.assign(window.currentPlayingVideo, refreshedVideo);
console.log('Updated currentPlayingVideo with new path:', refreshedVideo.path);
}

// Update in-memory arrays with refreshed data
updateVideoInMemory(video.oneDriveId, refreshedVideo);

// Refresh tag dropdowns (new path may have new tags)
if (typeof populateTagDropdowns === 'function') {
await populateTagDropdowns();
}

// Re-render all lists - this will call rebuildVideoInfoDisplay internally
refreshAllLists();

console.log(`Refreshed metadata after move: ${refreshedVideo.path}`);

} catch (refreshErr) {
console.warn('Refresh after move failed:', refreshErr);
// Fallback: at least update the path manually
updateVideoInMemory(video.oneDriveId, { path: destinationPath });
refreshAllLists();
}

// Show success confirmation tooltip
if (typeof showScoreConfirmation === 'function') {
const displayPath = destinationPath.startsWith('*') ? destinationPath.substring(1) : destinationPath;
showScoreConfirmation(`✅ Moved to:<br><span style="font-size: 0.5em; opacity: 0.9;">${displayPath}</span>`);
}
}

/**
* Move file between different OneDrive accounts via download + upload
* @param {object} video - Source video object
* @param {object} destinationPathInfo - { path, accountName, accountKey }
* @param {string} newFolderName - Optional new folder to create at destination
*/
async function moveFileBetweenAccounts(video, destinationPathInfo, newFolderName = null) {
console.log(`Moving file between accounts: ${video.accountName} → ${destinationPathInfo.accountName}`);

// Get progress UI elements
const progressContainer = document.getElementById('moveProgressContainer');
const progressBar = document.getElementById('moveProgressBar');
const progressText = document.getElementById('moveProgressText');
const progressDetails = document.getElementById('moveProgressDetails');

// Show progress UI
if (progressContainer) progressContainer.style.display = 'block';

// Helper to update progress
const updateProgress = (percent, text, details = '') => {
if (progressBar) progressBar.style.width = `${percent}%`;
if (progressText) progressText.textContent = text;
if (progressDetails) progressDetails.textContent = details;
};

// ✅ Declare destAccountId at function scope so it's accessible for auto-refresh
let destAccountId;

try {
updateProgress(5, 'Authenticating accounts...', 'Refreshing tokens');

// Get source account info
const [sourceAccountId] = (video.accountKey || "").split("::");
let sourceAccountInfo = accountsData.find(acc => acc.accountId === sourceAccountId);

if (!sourceAccountInfo) {
    throw new Error(`Source account not found for file: ${video.filename}`);
}

// Get destination account info (assign to outer scope variable)
[destAccountId] = (destinationPathInfo.accountKey || "").split("::");
let destAccountInfo = accountsData.find(acc => acc.accountId === destAccountId);

if (!destAccountInfo) {
    throw new Error(`Destination account not found: ${destinationPathInfo.accountName}`);
}

// Refresh tokens for both accounts
try {
    sourceAccountInfo.token = await refreshTokenForAccount(sourceAccountId);
    destAccountInfo.token = await refreshTokenForAccount(destAccountId);
} catch (err) {
    throw new Error(`Authentication failed: ${err.message}`);
}

updateProgress(10, 'Authentication complete', 'Verifying file access');

// Ensure we have necessary IDs
if (!video.driveId || !video.oneDriveId) {
    throw new Error('Missing OneDrive IDs - cannot move file');
}

updateProgress(15, 'Resolving destination folder...', destinationPathInfo.path);

// Resolve destination folder ID in destination account
let destinationFolderId;
try {
    const cleanPath = destinationPathInfo.path.replace(/^\*/, '');
    const segments = cleanPath.split('/').filter(Boolean);
    
    console.log(`Traversing destination path in ${destinationPathInfo.accountName}:`, segments);
    
    // Start from root of DESTINATION drive
    let currentFolderId = 'root';
    
    // Traverse each segment to find the folder
    for (const segment of segments) {
        const childrenUrl = `https://graph.microsoft.com/v1.0/drives/${destAccountInfo.driveId}/items/${currentFolderId}/children?$filter=name eq '${segment.replace(/'/g, "''")}'`;
        const childrenData = await fetchJSONWithRetry(childrenUrl, destAccountInfo.token);
        
        if (!childrenData.value || childrenData.value.length === 0) {
            throw new Error(`Folder not found: ${segment}`);
        }
        
        const folder = childrenData.value.find(item => item.folder);
        if (!folder) {
            throw new Error(`'${segment}' is not a folder`);
        }
        
        currentFolderId = folder.id;
    }
    
    destinationFolderId = currentFolderId;
    
} catch (err) {
    console.error('Destination folder resolution error:', err);
    throw new Error(`Could not find destination folder: ${err.message}`);
}

updateProgress(20, 'Destination folder resolved', `ID: ${destinationFolderId}`);

// ✅ Create new folder if name provided
if (newFolderName) {
    updateProgress(25, 'Creating new folder...', newFolderName);
    
    const createFolderUrl = `https://graph.microsoft.com/v1.0/drives/${destAccountInfo.driveId}/items/${destinationFolderId}/children`;
    const createResponse = await fetch(createFolderUrl, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${destAccountInfo.token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            name: newFolderName,
            folder: {},
            '@microsoft.graph.conflictBehavior': 'fail'
        })
    });
    
    if (!createResponse.ok) {
        const error = await createResponse.json().catch(() => ({}));
        throw new Error(error.error?.message || `Failed to create folder: HTTP ${createResponse.status}`);
    }
    
    const newFolder = await createResponse.json();
    destinationFolderId = newFolder.id;
    destinationPathInfo.path = destinationPathInfo.path ? `${destinationPathInfo.path}/${newFolderName}` : newFolderName;
    
    console.log(`Created new folder with ID: ${destinationFolderId}`);
    updateProgress(30, 'New folder created', newFolderName);
} else {
    updateProgress(30, 'Using existing folder', '');
}

// ✅ STEP 1: Download file from source account
updateProgress(35, 'Downloading from source account...', formatFileSize(video.sizeBytes || 0));

// Get download URL (refresh if needed)
let downloadUrl = video.downloadUrl;
if (!downloadUrl) {
    const sourceUrl = `https://graph.microsoft.com/v1.0/drives/${video.driveId}/items/${video.oneDriveId}`;
    const sourceData = await fetchJSONWithRetry(sourceUrl, sourceAccountInfo.token);
    downloadUrl = sourceData['@microsoft.graph.downloadUrl'];
}

if (!downloadUrl) {
    throw new Error('Could not get download URL for source file');
}

// Download file content with progress
const downloadResponse = await fetch(downloadUrl);

if (!downloadResponse.ok) {
    throw new Error(`Download failed: HTTP ${downloadResponse.status}`);
}

const totalBytes = parseInt(downloadResponse.headers.get('content-length') || video.sizeBytes || 0);
const reader = downloadResponse.body.getReader();
const chunks = [];
let downloadedBytes = 0;

while (true) {
    const { done, value } = await reader.read();
    
    if (done) break;
    
    chunks.push(value);
    downloadedBytes += value.length;
    
    // Update progress (35% to 65% for download)
    const downloadPercent = totalBytes > 0 ? (downloadedBytes / totalBytes) * 100 : 0;
    const overallPercent = 35 + (downloadPercent * 0.3); // Maps 0-100% to 35-65%
    updateProgress(
        overallPercent, 
        'Downloading from source account...',
        `${formatFileSize(downloadedBytes)} / ${formatFileSize(totalBytes)} (${downloadPercent.toFixed(0)}%)`
    );
}

// Combine chunks into blob
const fileBlob = new Blob(chunks);
console.log(`✅ Downloaded ${formatFileSize(fileBlob.size)}`);

updateProgress(70, 'Preparing upload to destination...', '');

// ✅ STEP 2: Upload to destination account
updateProgress(75, 'Uploading to destination account...', destinationPathInfo.accountName);

// Create upload session for large files (>4MB) or direct upload for small files
const fileSize = fileBlob.size;
const useLargeFileUpload = fileSize > 4 * 1024 * 1024; // 4MB threshold

let newItemId;

if (useLargeFileUpload) {
    // Large file upload - use upload session
    console.log('Using large file upload session');
    
    // Create upload session
    const sessionUrl = `https://graph.microsoft.com/v1.0/drives/${destAccountInfo.driveId}/items/${destinationFolderId}:/${video.filename}:/createUploadSession`;
    const sessionResponse = await fetch(sessionUrl, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${destAccountInfo.token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            item: {
                '@microsoft.graph.conflictBehavior': 'rename'
            }
        })
    });

    if (!sessionResponse.ok) {
        const error = await sessionResponse.json().catch(() => ({}));
        throw new Error(error.error?.message || `Failed to create upload session: HTTP ${sessionResponse.status}`);
    }

    const session = await sessionResponse.json();
    const uploadUrl = session.uploadUrl;

    // Upload in chunks (adaptive size based on file size)
// Small files: 10MB chunks (more granular progress)
// Large files: 40-60MB chunks (less overhead, faster)
let chunkSize;
if (fileSize < 100 * 1024 * 1024) { // <100MB
    chunkSize = 10 * 1024 * 1024; // 10MB chunks
} else if (fileSize < 500 * 1024 * 1024) { // <500MB
    chunkSize = 40 * 1024 * 1024; // 20MB chunks
} else if (fileSize < 2 * 1024 * 1024 * 1024) { // <2GB
    chunkSize = 60 * 1024 * 1024; // 40MB chunks
} else {
    chunkSize = 60 * 1024 * 1024; // 60MB chunks for huge files
}
console.log(`Using ${chunkSize / (1024 * 1024)}MB chunks for ${formatFileSize(fileSize)} file`);
    let uploadedBytes = 0;

    for (let start = 0; start < fileSize; start += chunkSize) {
        const end = Math.min(start + chunkSize, fileSize);
        const chunk = fileBlob.slice(start, end);

        const uploadResponse = await fetch(uploadUrl, {
            method: 'PUT',
            headers: {
                'Content-Length': chunk.size,
                'Content-Range': `bytes ${start}-${end - 1}/${fileSize}`
            },
            body: chunk
        });

        if (!uploadResponse.ok && uploadResponse.status !== 201 && uploadResponse.status !== 202) {
            throw new Error(`Upload chunk failed: HTTP ${uploadResponse.status}`);
        }

        uploadedBytes = end;

        // Update progress (75% to 95% for upload)
        const uploadPercent = (uploadedBytes / fileSize) * 100;
        const overallPercent = 75 + (uploadPercent * 0.2); // Maps 0-100% to 75-95%
        updateProgress(
            overallPercent,
            'Uploading to destination account...',
            `${formatFileSize(uploadedBytes)} / ${formatFileSize(fileSize)} (${uploadPercent.toFixed(0)}%)`
        );

        // Final chunk returns the item
        if (uploadedBytes === fileSize) {
            const result = await uploadResponse.json();
            newItemId = result.id;
        }
    }

} else {
 // Small file - use upload session for conflict handling
 console.log('Using upload session for small file (enables conflict handling)');
 
 // Create upload session with conflict behavior
 const sessionUrl = `https://graph.microsoft.com/v1.0/drives/${destAccountInfo.driveId}/items/${destinationFolderId}:/${video.filename}:/createUploadSession`;
 
 const sessionBody = {
     item: {}
 };
 sessionBody.item['@microsoft.graph.conflictBehavior'] = 'rename';
 
 const sessionResponse = await fetch(sessionUrl, {
     method: 'POST',
     headers: {
         'Authorization': `Bearer ${destAccountInfo.token}`,
         'Content-Type': 'application/json'
     },
     body: JSON.stringify(sessionBody)
 });

 if (!sessionResponse.ok) {
     const error = await sessionResponse.json().catch(() => ({}));
     throw new Error(error.error?.message || `Failed to create upload session: HTTP ${sessionResponse.status}`);
 }

 const session = await sessionResponse.json();
 const uploadUrl = session.uploadUrl;

 // Upload in single chunk
 const uploadResponse = await fetch(uploadUrl, {
     method: 'PUT',
     headers: {
         'Content-Length': String(fileBlob.size),
         'Content-Range': `bytes 0-${fileBlob.size - 1}/${fileBlob.size}`
     },
     body: fileBlob
 });

 if (!uploadResponse.ok) {
     const error = await uploadResponse.json().catch(() => ({}));
     throw new Error(error.error?.message || `Upload failed: HTTP ${uploadResponse.status}`);
 }

 const result = await uploadResponse.json();
 newItemId = result.id;
 
 updateProgress(95, 'Upload complete', formatFileSize(fileSize));
}

console.log(`✅ File uploaded successfully with ID: ${newItemId}`);

updateProgress(96, 'Deleting original file...', video.accountName);

// ✅ STEP 3: Delete original file from source account
const deleteUrl = `https://graph.microsoft.com/v1.0/drives/${video.driveId}/items/${video.oneDriveId}`;
const deleteResponse = await fetch(deleteUrl, {
    method: 'DELETE',
    headers: {
        'Authorization': `Bearer ${sourceAccountInfo.token}`
    }
});

if (!deleteResponse.ok && deleteResponse.status !== 204) {
    const error = await deleteResponse.json().catch(() => ({}));
    console.error('Failed to delete original file:', error.error?.message || `HTTP ${deleteResponse.status}`);
    
    // Show warning but don't throw - copy succeeded
    updateProgress(100, '⚠️ Copied but original not deleted', 'Please delete manually if needed');
    
    await new Promise(resolve => setTimeout(resolve, 3000)); // Show warning for 3 seconds
    
    alert(`File was copied successfully to ${destinationPathInfo.accountName}, but the original could not be deleted.\n\nYou may need to delete it manually from ${video.accountName}.`);
} else {
    console.log('✅ Original file deleted');
    updateProgress(100, '✅ Move complete!', `${video.filename} → ${destinationPathInfo.accountName}`);
    
    await new Promise(resolve => setTimeout(resolve, 1500)); // Show success for 1.5 seconds
}

// ✅ Remove from IndexedDB
await deleteVideoFromDB(video.oneDriveId);

// Remove from in-memory arrays
removeVideoFromMemory(video.oneDriveId);

// Re-render all lists
refreshAllLists();

// Refresh tag dropdowns
if (typeof populateTagDropdowns === 'function') {
    await populateTagDropdowns();
}

console.log(`Moved ${video.filename} from ${video.accountName} to ${destinationPathInfo.accountName}/${destinationPathInfo.path}`);

// ✅ Show success confirmation tooltip immediately (before refresh folders)
if (typeof showScoreConfirmation === 'function') {
 const displayPath = destinationPathInfo.path.startsWith('*') ? destinationPathInfo.path.substring(1) : destinationPathInfo.path;
 showScoreConfirmation(`✅ Moved to ${destinationPathInfo.accountName}<br><span style="font-size: 0.5em; opacity: 0.9;">${displayPath}</span>`);
}

// ✅ AUTO-REFRESH DESTINATION FOLDER: Reload only the specific destination folder
try {
updateProgress(100, 'Refreshing destination folder...', destinationPathInfo.path);

// Parse destination path to find folder ID
const destPathSegments = destinationPathInfo.path.replace(/^\*/, '').split('/').filter(Boolean);

if (destPathSegments.length > 0) {
    // Traverse to find the destination folder ID
    let destFolderId = 'root';
    
    for (const segment of destPathSegments) {
        const childrenUrl = `https://graph.microsoft.com/v1.0/drives/${destAccountInfo.driveId}/items/${destFolderId}/children?$filter=name eq '${segment.replace(/'/g, "''")}'&$select=name,id,folder`;
        const childrenData = await fetchJSONWithRetry(childrenUrl, destAccountInfo.token);
        
        if (childrenData.value && childrenData.value.length > 0) {
            const folder = childrenData.value.find(item => item.folder);
            if (folder) {
                destFolderId = folder.id;
            }
        }
    }
    
    // Refresh only this destination folder
    const destPill = document.querySelector(`.account-pill[data-username="${destAccountInfo.username}"]`);
    const destBtn = destPill?.querySelector('.account-load-btn');
    
    if (destBtn && destFolderId !== 'root') {
        console.log(`Auto-refreshing destination folder: ${destinationPathInfo.path} (ID: ${destFolderId})`);
        await loadVideosFromSelectedFolders(destAccountInfo, [destFolderId], destBtn);
        console.log('Destination folder refreshed');
    }
}
} catch (refreshErr) {
console.warn('Failed to auto-refresh destination folder:', refreshErr);
// Don't throw - move was successful, refresh is just a bonus
}

// AUTO-REFRESH SOURCE FOLDER: Reload only the specific source folder
try {
updateProgress(100, 'Refreshing source folder...', video.path);

// Parse source path to find folder ID
const sourcePathSegments = video.path.replace(/^\*/, '').split('/').filter(Boolean);

if (sourcePathSegments.length > 0) {
    // Traverse to find the source folder ID
    let sourceFolderId = 'root';
    
    for (const segment of sourcePathSegments) {
        const childrenUrl = `https://graph.microsoft.com/v1.0/drives/${sourceAccountInfo.driveId}/items/${sourceFolderId}/children?$filter=name eq '${segment.replace(/'/g, "''")}'&$select=name,id,folder`;
        const childrenData = await fetchJSONWithRetry(childrenUrl, sourceAccountInfo.token);
        
        if (childrenData.value && childrenData.value.length > 0) {
            const folder = childrenData.value.find(item => item.folder);
            if (folder) {
                sourceFolderId = folder.id;
            }
        }
    }
    
    // Refresh only this source folder
    const sourcePill = document.querySelector(`.account-pill[data-username="${sourceAccountInfo.username}"]`);
    const sourceBtn = sourcePill?.querySelector('.account-load-btn');
    
    if (sourceBtn && sourceFolderId !== 'root') {
        console.log(`Auto-refreshing source folder: ${video.path} (ID: ${sourceFolderId})`);
        await loadVideosFromSelectedFolders(sourceAccountInfo, [sourceFolderId], sourceBtn);
        console.log('Source folder refreshed');
    }
}
} catch (refreshErr) {
console.warn('Failed to auto-refresh source folder:', refreshErr);
// Don't throw - move was successful, refresh is just a bonus
}

} catch (err) {
// Show error in progress UI
if (progressText) {
    progressText.textContent = '❌ Operation failed';
    progressText.style.color = '#f44336';
}
if (progressBar) {
    progressBar.style.background = '#f44336';
}
if (progressDetails) {
    progressDetails.textContent = err.message || 'Unknown error';
}

throw err; // Re-throw so outer handler can show alert
}
}

/**
* Delete a folder from OneDrive via Graph API
*/
async function deleteFolder(video, folderPath) {
// Get account info and refresh token
const [accountIdStored] = (video.accountKey || "").split("::");
let accountInfo = accountsData.find(acc => acc.accountId === accountIdStored);

if (!accountInfo) {
  throw new Error(`Account not found`);
}

try {
  accountInfo.token = await refreshTokenForAccount(accountIdStored);
} catch (err) {
  throw new Error(`Authentication failed: ${err.message}`);
}

if (!video.driveId) {
  throw new Error('Missing drive ID - cannot delete folder');
}

// Resolve folder ID by traversing path
try {
  const cleanPath = folderPath.replace(/^\*/, '');
  const segments = cleanPath.split('/').filter(Boolean);
  
  console.log(`Resolving folder ID for path:`, segments);
  
  let currentFolderId = 'root';
  
  for (const segment of segments) {
      const childrenUrl = `https://graph.microsoft.com/v1.0/drives/${video.driveId}/items/${currentFolderId}/children?$filter=name eq '${segment.replace(/'/g, "''")}'`;
      const childrenData = await fetchJSONWithRetry(childrenUrl, accountInfo.token);
      
      if (!childrenData.value || childrenData.value.length === 0) {
          throw new Error(`Folder not found: ${segment}`);
      }
      
      const folder = childrenData.value.find(item => item.folder);
      if (!folder) {
          throw new Error(`'${segment}' is not a folder`);
      }
      
      currentFolderId = folder.id;
  }
  
  // Delete the folder
  const deleteUrl = `https://graph.microsoft.com/v1.0/drives/${video.driveId}/items/${currentFolderId}`;
  const response = await fetch(deleteUrl, {
      method: 'DELETE',
      headers: {
          'Authorization': `Bearer ${accountInfo.token}`
      }
  });
  
  if (!response.ok && response.status !== 204) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error?.message || `HTTP ${response.status}`);
  }
  
  console.log(`Folder deleted successfully: ${folderPath}`);
  
  // Remove all videos in this folder from IndexedDB
  const allVideos = await getAllVideos();
  const videosInFolder = allVideos.filter(v => 
      v.path === folderPath || v.path?.startsWith(folderPath + '/')
  );
  
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, "readwrite");
  const store = tx.objectStore(STORE_NAME);
  
  for (const vid of videosInFolder) {
      await store.delete(vid.oneDriveId);
      // Remove from memory
      removeVideoFromMemory(vid.oneDriveId);
  }
  
  await tx.complete;
  
  console.log(`Removed ${videosInFolder.length} videos from deleted folder`);
  
  // Refresh all lists
  refreshAllLists();
  
  // Refresh tag dropdowns
  if (typeof populateTagDropdowns === 'function') {
      await populateTagDropdowns();
  }
  
} catch (err) {
  console.error('Folder deletion error:', err);
  throw new Error(`Could not delete folder: ${err.message}`);
}
}

/**
* Get the web URL for a folder path
*/
async function getFolderWebUrl(video, folderPath) {
// Get account info and refresh token
const [accountIdStored] = (video.accountKey || "").split("::");
let accountInfo = accountsData.find(acc => acc.accountId === accountIdStored);

if (!accountInfo) {
throw new Error(`Account not found`);
}

try {
accountInfo.token = await refreshTokenForAccount(accountIdStored);
} catch (err) {
throw new Error(`Authentication failed: ${err.message}`);
}

if (!video.driveId) {
throw new Error('Missing drive ID');
}

try {
const cleanPath = folderPath.replace(/^\*/, '');
const segments = cleanPath.split('/').filter(Boolean);

console.log(`Resolving folder URL for path:`, segments);

let currentFolderId = 'root';

// Traverse to find the folder
for (const segment of segments) {
    const childrenUrl = `https://graph.microsoft.com/v1.0/drives/${video.driveId}/items/${currentFolderId}/children?$filter=name eq '${segment.replace(/'/g, "''")}'`;
    const childrenData = await fetchJSONWithRetry(childrenUrl, accountInfo.token);
    
    if (!childrenData.value || childrenData.value.length === 0) {
        throw new Error(`Folder not found: ${segment}`);
    }
    
    const folder = childrenData.value.find(item => item.folder);
    if (!folder) {
        throw new Error(`'${segment}' is not a folder`);
    }
    
    currentFolderId = folder.id;
}

// Get the folder's webUrl
const folderUrl = `https://graph.microsoft.com/v1.0/drives/${video.driveId}/items/${currentFolderId}`;
const folderData = await fetchJSONWithRetry(folderUrl, accountInfo.token);

if (folderData.webUrl) {
    console.log(`Resolved folder URL: ${folderData.webUrl}`);
    return folderData.webUrl;
} else {
    throw new Error('Folder webUrl not found');
}

} catch (err) {
console.error('Error getting folder URL:', err);
throw err;
}
}



/**
* Show confirmation modal for folder refresh operation
* @param {object} video - Video object with path information
* @returns {Promise<boolean>} - True if confirmed, false if cancelled
*/
async function showRefreshFolderConfirmModal(video) {
return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'basket-json-modal';
    modal.innerHTML = `
        <div class="basket-json-modal-content">
            <h3>Refresh Folder</h3>
            <p style="font-size: 0.85rem; color: #666; margin-bottom: 16px;">This will reload all videos from this folder:</p>
            <p class="file-operation-path">${video.path || 'root'}</p>
            <p style="margin-bottom: 20px;"><strong>Continue?</strong></p>
            <div class="basket-json-modal-buttons">
                <button id="refreshFolderConfirmBtn" class="modal-btn modal-btn-primary">Refresh</button>
                <button id="refreshFolderCancelBtn" class="modal-btn modal-btn-cancel">Cancel</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    
    // Confirm button
    document.getElementById('refreshFolderConfirmBtn').addEventListener('click', () => {
        modal.remove();
        resolve(true);
    });
    
    // Cancel button
    document.getElementById('refreshFolderCancelBtn').addEventListener('click', () => {
        modal.remove();
        resolve(false);
    });
    
    // Close on background click
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.remove();
            resolve(false);
        }
    });
    
    // ESC key to cancel
    const escHandler = (e) => {
        if (e.key === 'Escape') {
            modal.remove();
            resolve(false);
            document.removeEventListener('keydown', escHandler);
        }
    };
    document.addEventListener('keydown', escHandler);
});
}

async function showBookmarksModal(video, autoAddTimestamp = false) {
    // Ensure bookmarks array exists locally first
    video.bookmarks = video.bookmarks || [];
    
    // Pause video when opening bookmarks modal
    if (window.plyrPlayer && !window.plyrPlayer.paused) {
        window.plyrPlayer.pause();
    }
    
    const modal = document.createElement('div');
    modal.className = 'basket-json-modal';
    
    // ✅ Show a lightweight loading state immediately so the UI isn't blank
    // while we sync with Excel, but DON'T allow editing yet.
    modal.innerHTML = `
        <div class="basket-json-modal-content" style="max-width: 500px;">
            <h3>Bookmarks</h3>
            <p style="font-size: 0.85rem; color: #666; margin-bottom: 16px;">${video.filename}</p>
            <p style="color: #999; font-style: italic; text-align: center;">Syncing bookmarks...</p>
        </div>
    `;
    document.body.appendChild(modal);
    
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });
    
    // ✅ CRITICAL FIX: Wait for any pending write for this video to finish,
    // THEN fetch latest bookmarks from Excel, BEFORE rendering the editable
    // modal. This prevents a slow in-flight fetch from later overwriting a
    // bookmark the user added while it was still loading.
    // Read straight from the bookmarks table. The old path was gated on an
    // Excel token (null in Native) and read a `bookmarks` column that no
    // longer exists, so the modal never actually refreshed from the server.
    if (video.inCatalogue !== false) {
        try {
            await window.scrayBmSync(video);
        } catch (err) {
            console.warn('Could not load bookmarks from the database:', err.message);
        }
    }

    
    // ✅Fetch top 10 most common bookmark notes for quick-add buttons
    let topNotes = [];
    if (typeof window.getTopBookmarkNotes === 'function') {
        try {
            topNotes = await window.getTopBookmarkNotes(30);
        } catch (err) {
            console.warn('Could not load top bookmark notes:', err);
        }
    }
    
    // If modal was closed while we were syncing, stop here
    if (!modal.isConnected) return;
    
    // Auto-add a bookmark at the current playhead and focus its note
    // field (used by the "now playing" bar's BM button)
    let focusBookmarkTime = null;
    if (autoAddTimestamp) {
        let currentTime = 0;
        if (window.currentPlayingVideo && window.currentPlayingVideo.oneDriveId === video.oneDriveId && window.plyrPlayer) {
            currentTime = window.plyrPlayer.currentTime;
        }
        video.bookmarks.push({ time: currentTime, note: "" });
        focusBookmarkTime = currentTime;
    }
    
    let activeNoteInput = null;
    
    const renderContent = () => {
        // Sort bookmarks chronologically
        video.bookmarks.sort((a, b) => a.time - b.time);
        
        let html = `
            <div class="basket-json-modal-content" style="max-width: 500px;">
                <form id="bookmarksForm">
                <h3>Bookmarks</h3>
                <p style="font-size: 0.85rem; color: #666; margin-bottom: 16px;">${video.filename}</p>
                
                <div id="bookmarksList" style="max-height: 300px; overflow-y: auto; margin-bottom: 16px;">
        `;
        
        if (video.bookmarks.length === 0) {
            html += `<p style="color: #999; font-style: italic; text-align: center;">No bookmarks yet.</p>`;
        } else {
            video.bookmarks.forEach((bm, idx) => {
                html += `
                <div class="bookmark-item" style="display: flex; gap: 6px; align-items: center; margin-bottom: 8px; background: #f9f9f9; padding: 8px; border-radius: 4px; width: 100%; box-sizing: border-box;">
                    <button class="modal-btn modal-btn-secondary jump-bm-btn" data-time="${bm.time}" style="flex: 0 0 auto !important; width: auto !important; padding: 6px 8px !important; font-family: monospace; font-size: 0.75rem; white-space: nowrap; margin-bottom: 0 !important;">
                        ${formatDuration(bm.time * 1000)}
                    </button>
                    <input type="text" class="bm-note-input" data-index="${idx}" value="${(bm.note || '').replace(/"/g, '&quot;')}" placeholder="Add a note..." style="flex: 1 1 auto !important; width: auto !important; min-width: 0; padding: 6px !important; border: 1px solid #ccc; border-radius: 4px; font-size: 0.85rem; margin-bottom: 0 !important;">
                    <button class="modal-btn modal-btn-danger del-bm-btn" data-index="${idx}" style="flex: 0 0 auto !important; width: auto !important; padding: 6px 8px !important; min-width: 0; margin-bottom: 0 !important;">&times;</button>
                </div>
            `;
            });
        }
        
        html += `
                </div>
        `;
        
        if (topNotes.length > 0) {
            const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
            html += `
                <div style="margin-bottom: 10px;">
                    <div style="font-size: 0.7rem; color: #999; margin-bottom: 4px;">Quick notes (tap a note field, then tap one to insert):</div>
                    <div id="quickNotesRow" style="display: flex; flex-wrap: wrap; gap: 6px; max-height: 120px; overflow-y: auto;">
                        ${topNotes.map((note, i) => `<button class="quick-note-btn modal-btn modal-btn-secondary" data-note-index="${i}" style="flex: 0 0 auto; width: auto; padding: 6px 10px; font-size: 0.75rem; margin: 0;">${escapeHtml(note)}</button>`).join('')}
                    </div>
                </div>
            `;
        }
        
        html += `
                <div class="file-operation-buttons" style="display: flex; flex-direction: row; gap: 8px; margin-bottom: 10px;">
                    <button id="saveBookmarksBtn" class="modal-btn modal-btn-primary" style="flex: 1; background: #28a745;">Save</button>
                    <button id="closeBookmarksBtn" class="modal-btn modal-btn-cancel" style="flex: 1;">Close</button>
                </div>
        `;
        
        html += `
                <div style="display: flex; gap: 6px;">
                    <button id="quickSpaceBtn" class="modal-btn modal-btn-secondary" style="flex: 1; padding: 6px 10px; font-size: 0.75rem; margin: 0;">Space</button>
                    <button id="quickClearBtn" class="modal-btn modal-btn-secondary" style="flex: 1; padding: 6px 10px; font-size: 0.75rem; margin: 0;">Clear</button>
                </div>
                </form>
            </div>
        `; 
        
        modal.innerHTML = html;
        
        // Focus the notes field for a newly auto-added bookmark (once)
        if (focusBookmarkTime !== null) {
            const focusIdx = video.bookmarks.findIndex(bm => bm.time === focusBookmarkTime);
            if (focusIdx >= 0) {
                const noteInput = modal.querySelector(`.bm-note-input[data-index="${focusIdx}"]`);
                if (noteInput) {
                    noteInput.focus();
                    activeNoteInput = noteInput;
                }
            }
            focusBookmarkTime = null;
        }
        
        // Attach events
        modal.querySelectorAll('.jump-bm-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const time = parseFloat(btn.dataset.time);
                
                modal.remove(); // Dismiss modal immediately
                
                // Mobile only: dismiss any open basket/history panels so the
                // player is fully visible when starting playback from a bookmark
                if (window.innerWidth <= 1024) {
                    if (typeof toggleBasket === 'function') toggleBasket(false);
                    if (typeof toggleHistory === 'function') toggleHistory(false);
                    if (typeof window.toggleRandomPlaylistPanel === 'function') window.toggleRandomPlaylistPanel(false);
                }
                
                if (!window.currentPlayingVideo || window.currentPlayingVideo.oneDriveId !== video.oneDriveId) {
                    window.inlineVideoPlayer.play(video).then(() => {
                        setTimeout(() => {
                            if (window.plyrPlayer) window.plyrPlayer.currentTime = time;
                        }, 800); // Allow video time to buffer
                    });
                } else if (window.plyrPlayer) {
                    window.plyrPlayer.currentTime = time;
                    window.plyrPlayer.play();
                }
            });
        });
        
        modal.querySelectorAll('.bm-note-input').forEach(input => {
            input.addEventListener('focus', () => {
                activeNoteInput = input;
            });
            input.addEventListener('change', (e) => {
                const idx = parseInt(input.dataset.index);
                video.bookmarks[idx].note = input.value.trim();
                // Local only - no auto-save, user must tap Save button
            });
        });
        
        modal.querySelectorAll('.del-bm-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const idx = parseInt(btn.dataset.index);
                video.bookmarks.splice(idx, 1);
                renderContent(); // Update modal instantly, save happens on Save tap
            });
        });
        
        const insertIntoActiveNoteInput = (text) => {
            if (!activeNoteInput || !activeNoteInput.isConnected) {
                alert('Tap into a note field first, then tap a quick note to insert it there.');
                return;
            }
            
            const input = activeNoteInput;
            const start = input.selectionStart ?? input.value.length;
            const end = input.selectionEnd ?? input.value.length;
            const before = input.value.substring(0, start);
            const after = input.value.substring(end);
            
            input.value = before + text + after;
            
            const bmIdx = parseInt(input.dataset.index);
            video.bookmarks[bmIdx].note = input.value.trim();
            
            const newPos = start + text.length;
            input.focus();
            input.setSelectionRange(newPos, newPos);
        };
        
        modal.querySelectorAll('.quick-note-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = parseInt(btn.dataset.noteIndex);
                insertIntoActiveNoteInput(topNotes[idx]);
            });
        });
        
        modal.querySelector('#quickSpaceBtn')?.addEventListener('click', () => {
            insertIntoActiveNoteInput(' ');
        });
        
        modal.querySelector('#quickClearBtn')?.addEventListener('click', () => {
            if (!activeNoteInput || !activeNoteInput.isConnected) {
                alert('Tap into a note field first, then tap Clear to empty it.');
                return;
            }
            const input = activeNoteInput;
            input.value = '';
            const bmIdx = parseInt(input.dataset.index);
            video.bookmarks[bmIdx].note = '';
            input.focus();
        });
        
        modal.querySelector('#bookmarksForm')?.addEventListener('submit', (e) => {
            e.preventDefault();
            modal.querySelector('#saveBookmarksBtn')?.click();
        });
        
        modal.querySelector('#saveBookmarksBtn').addEventListener('click', async () => {
            // Dismiss modal immediately
            modal.remove();
            
            // Show persistent "Saving..." tooltip
            let bookmarkTooltip = null;
            if (typeof window.showBookmarkConfirmation === 'function') {
                bookmarkTooltip = window.showBookmarkConfirmation('Saving bookmarks...', '#6c757d', true);
            }
            
            try {
                await saveBookmarks(video, bookmarkTooltip);
                // Re-read so the modal shows exactly what the table now holds,
                // including anything another device changed in the meantime.
                await window.scrayBmSync(video);
                renderContent();
            } catch (err) {
                if (bookmarkTooltip && typeof window.updateBookmarkConfirmation === 'function') {
                    window.updateBookmarkConfirmation(bookmarkTooltip, '❌ Save failed', '#dc3545');
                    window.closeBookmarkConfirmation(bookmarkTooltip);
                }
            }
        });
        
        modal.querySelector('#closeBookmarksBtn').addEventListener('click', () => {
            modal.remove();
        });
    };
    
    renderContent();
}

async function saveBookmarks(video, existingTooltip = null) {
    if (typeof updateVideoInMemory === 'function') {
        updateVideoInMemory(video.oneDriveId, { bookmarks: video.bookmarks });
    }
    if (typeof updateVideoInDB === 'function') {
        await updateVideoInDB(video.oneDriveId, { bookmarks: video.bookmarks });
    }
    
    // Refresh progress bar markers if this is the currently playing video
    if (window.currentPlayingVideo && window.currentPlayingVideo.oneDriveId === video.oneDriveId) {
        window.currentPlayingVideo.bookmarks = video.bookmarks;
        if (typeof window.renderBookmarkMarkers === 'function') {
            window.renderBookmarkMarkers();
        }
    }
    // saveVideoMeta() pushed to the bookmarks table on the way through, so by
    // here the write has already reached the server.
    // Two different tooltip implementations reach this point. The FLS one
    // (showRotatedPlayerConfirmation, in player.js) fades via inline
    // style.opacity and lives inside the rotated container; the portrait one
    // fades via a .show class on body. Closing one with the other's helper
    // leaves it on screen, which is what stranded the FLS "Saving..." message.
    if (existingTooltip) {
        const msg = `${video.bookmarks.length} bookmark${video.bookmarks.length === 1 ? '' : 's'} saved`;
        const isRotated = existingTooltip.classList?.contains('rotated-player-confirmation-tooltip');

        if (isRotated && typeof window.updateRotatedPlayerConfirmation === 'function') {
            window.updateRotatedPlayerConfirmation(existingTooltip, msg, '#28a745');
            window.closeRotatedPlayerConfirmation?.(existingTooltip);
        } else if (typeof window.updateBookmarkConfirmation === 'function') {
            window.updateBookmarkConfirmation(existingTooltip, msg, '#28a745');
            window.closeBookmarkConfirmation?.(existingTooltip);
        }

        // Last-resort reaper. A persist tooltip has nothing else that will
        // ever remove it, so never let a missing helper strand one on screen.
        setTimeout(() => existingTooltip.remove(), 4000);
    }
}
// Export functions globally
window.showBookmarksModal = showBookmarksModal;
window.saveBookmarks = saveBookmarks;
window.showRenameModal = showRenameModal;
window.showDeleteModal = showDeleteModal;
window.showMoveFileModal = showMoveFileModal;
window.showRefreshFolderConfirmModal = showRefreshFolderConfirmModal;
window.renameFile = renameFile;
window.deleteFile = deleteFile;
window.moveFile = moveFile;
window.moveFileBetweenAccounts = moveFileBetweenAccounts;
window.deleteFolder = deleteFolder;
window.getFolderWebUrl = getFolderWebUrl;
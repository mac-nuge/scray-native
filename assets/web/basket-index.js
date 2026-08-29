// ===== basket-index.js =====
// Index layout-specific basket toggle

function toggleBasket(open = null) {
const panel = document.getElementById("basketPanel");
if (!panel) return;
const isOpening = open ?? !panel.classList.contains("basket-open");

// ✅ In landscape mobile: close random panel when opening basket
if (isOpening) {
   const isLandscape = window.matchMedia('(orientation: landscape)').matches;
   const isMobile = window.innerWidth <= 1024;
   
   if (isLandscape && isMobile && typeof window.toggleRandomPlaylistPanel === 'function') {
       window.toggleRandomPlaylistPanel(false);
   }
}

// Narrowing the list reflows the text and changes the document height, and the
// browser rescales the scroll position to match - which reads as the page
// jumping. Pin the offset from the top of the document across the reflow. rAF
// so it runs after layout has settled; scrollTo clamps if the page got shorter.
const scrollBefore = window.scrollY;
panel.classList.toggle("basket-open", isOpening);
requestAnimationFrame(() => {
    if (window.scrollY !== scrollBefore) window.scrollTo(0, scrollBefore);
});
}
// Export for global use
window.toggleBasket = toggleBasket;

// ✅ ADD THIS NEW SECTION HERE:
// Initialize desktop basket for index layout
function initIndexBasket() {
const desktopBasketCol = document.getElementById("desktopBasketColumn");
const mobileBasketPanel = document.getElementById("basketPanel");

if (!desktopBasketCol || !mobileBasketPanel) {
    console.warn("Basket containers not found for index layout");
    return;
}

// Desktop: move basket into column
  if (window.innerWidth >= 769) {
      const basketTools = mobileBasketPanel.querySelector(".basket-tools");
      const basketList = document.getElementById("basketList");
      const basketImportInput = document.getElementById("basketImportInput");

      if (basketTools && basketList) {
          // Clone tools and reattach event listeners
          const clonedTools = basketTools.cloneNode(true);

// ✅ PUSH sync button - pushes current basket to Excel
clonedTools.querySelector("#basketSaveBtn")?.addEventListener("click", async () => {
  const btn = clonedTools.querySelector("#basketSaveBtn");
  
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
clonedTools.querySelector("#basketLoadBtn")?.addEventListener("click", async () => {
  const btn = clonedTools.querySelector("#basketLoadBtn");
  
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

clonedTools.querySelector("#basketSelectAllBtn")?.addEventListener("click", () => {
    window.basketVideos.forEach(v => window.selectedBasketIds.add(v.oneDriveId));
    window.renderBasket();
});

 clonedTools.querySelector("#basketRemoveBtn")?.addEventListener("click", () => {
     if (!window.selectedBasketIds.size) { alert("No items selected"); return; }
     window.basketVideos = window.basketVideos.filter(v => !window.selectedBasketIds.has(v.oneDriveId));
     window.clearBasketSelection();
     window.saveBasket();
     window.renderBasket();
 });

 // ✅ Overflow menu button
 clonedTools.querySelector("#basketMoreBtn")?.addEventListener("click", (e) => {
     const subset = window.basketVideos.filter(v => window.selectedBasketIds.has(v.oneDriveId));
     
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
            onClick: () => window.clearBasketSelection()
        },
        {
            label: "REF - Refresh Selected",
             onClick: () => {
                 if (!subset.length) { alert("No items selected to refresh"); return; }
                 const tempBtn = { textContent: "REF", disabled: false };
                 Object.defineProperty(tempBtn, 'textContent', {
                     set: function(val) { console.log('Refresh status:', val); },
                     get: function() { return "REF"; }
                 });
                 window.refreshBasketFiles(tempBtn, subset);
             }
         },
           {
               label: "CSV - Export to CSV",
               onClick: () => {
                   if (!subset.length) { alert("No items selected"); return; }
                   window.exportBasketSubsetToCSV(subset);
               }
           },
           {
               label: "JSON↓ - Export JSON",
               onClick: () => window.showExportOptionsModal()
           },
           {
               label: "JSON↑ - Import JSON",
               onClick: () => window.showImportOptionsModal()
           },
           {
              label: "TAG - Filter by Tags",
              onClick: () => window.showBasketTagSelector()
          },
          {
             label: "DEL - Bulk Delete Selected",
             color: "#f44336",
             onClick: () => {
                 if (!subset.length) {
                     alert("No items selected to delete");
                     return;
                 }
                 if (typeof window.showBulkDeleteModal === 'function') {
                     window.showBulkDeleteModal(subset);
                 }
             }
          }
       ];
       
       window.showContextMenu(actions, e);
   });

           desktopBasketCol.appendChild(clonedTools);
            desktopBasketCol.appendChild(basketList);
          
          // Also move the hidden file input
          if (basketImportInput) {
              desktopBasketCol.appendChild(basketImportInput);
          }

          console.log("✅ Basket moved to desktop column (index layout)");
      }
  }
}

// Initialize on load
window.addEventListener("DOMContentLoaded", () => {
  initIndexBasket();
});
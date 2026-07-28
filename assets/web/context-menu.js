// ===== context-menu.js =====
// Reusable context menu system for button overflow

let activeContextMenu = null;

/**
* Create and show a context menu with actions
* @param {Array} actions - Array of { label, onClick, color? } objects
* @param {Event} event - Click event to position menu
*/
function showContextMenu(actions, event) {
   // Close any existing menu
   if (activeContextMenu) {
       activeContextMenu.remove();
       activeContextMenu = null;
   }
   
   if (!actions || actions.length === 0) return;
   
   event.preventDefault();
   event.stopPropagation();
   
   // Create menu
   const menu = document.createElement('div');
   menu.className = 'context-menu';
   
   actions.forEach(action => {
       const item = document.createElement('div');
       item.className = 'context-menu-item';
       item.textContent = action.label;
       
       if (action.color) {
           item.style.color = action.color;
       }
       
       if (action.disabled) {
        item.classList.add('disabled');
    } else {
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            
            // ✅ Check if this is a Copy action - delay menu close for tooltip
            const isCopyAction = action.label && action.label.includes('C');
            
            if (isCopyAction) {
                // Delay menu close to allow tooltip to show
                setTimeout(() => {
                    menu.remove();
                    activeContextMenu = null;
                }, 100);
            } else {
                menu.remove();
                activeContextMenu = null;
            }
            
            if (action.onClick) action.onClick(e);  // ✅ Pass event object
        });
    }
       
       menu.appendChild(item);
   });
   
   // Position menu
   const x = event.clientX || (event.touches && event.touches[0].clientX) || 0;
   const y = event.clientY || (event.touches && event.touches[0].clientY) || 0;
   
   menu.style.left = x + 'px';
   menu.style.top = y + 'px';
   
   document.body.appendChild(menu);
   activeContextMenu = menu;
   
// Adjust if off-screen
setTimeout(() => {
    const rect = menu.getBoundingClientRect();
    
    // Check right edge
    if (rect.right > window.innerWidth) {
        menu.style.left = (window.innerWidth - rect.width - 10) + 'px';
    }
    
    // Check left edge
    if (rect.left < 0) {
        menu.style.left = '10px';
    }
    
    // ✅ Check bottom edge - but prefer keeping menu below click point
    if (rect.bottom > window.innerHeight) {
        // Only move up if there's more space above than below
        const spaceBelow = window.innerHeight - y;
        const spaceAbove = y;
        
        if (spaceAbove > spaceBelow && spaceAbove > rect.height) {
            // More space above - move menu above click point
            menu.style.top = (y - rect.height) + 'px';
        } else {
            // Keep menu below, but constrain to fit in viewport
            const maxTop = window.innerHeight - rect.height - 10;
            menu.style.top = Math.min(y, maxTop) + 'px';
        }
    }
    
    // Check top edge
    if (rect.top < 0) {
        menu.style.top = '10px';
    }
}, 0);
   
   // Close on click outside
 const closeHandler = (e) => {
     if (!menu.contains(e.target)) {
         menu.remove();
         activeContextMenu = null;
         document.removeEventListener('click', closeHandler);
         document.removeEventListener('touchstart', closeHandler);
         document.removeEventListener('keydown', escapeHandler);
     }
 };
 
 // Close on ESC key
 const escapeHandler = (e) => {
     if (e.key === 'Escape') {
         menu.remove();
         activeContextMenu = null;
         document.removeEventListener('click', closeHandler);
         document.removeEventListener('touchstart', closeHandler);
         document.removeEventListener('keydown', escapeHandler);
     }
 };
 
 setTimeout(() => {
     document.addEventListener('click', closeHandler);
     document.addEventListener('touchstart', closeHandler);
     document.addEventListener('keydown', escapeHandler);
 }, 100);
}

/**
* Create compact button group with overflow menu
* @param {Array} buttons - Array of { label, onClick, color?, title? } objects
* @param {number} visibleCount - Number of buttons to show before "..."
* @returns {HTMLElement} - Button container element
*/
function createCompactButtonGroup(buttons, visibleCount = 2) {
   const container = document.createElement('div');
   container.className = 'compact-btn-group';
   
   // Show first N buttons
   const visibleButtons = buttons.slice(0, visibleCount);
   const hiddenButtons = buttons.slice(visibleCount);
   
visibleButtons.forEach(btn => {
      const element = document.createElement('button');
      element.textContent = btn.label;
      element.className = 'compact-btn';
      
      // Force consistent styling
      element.style.display = 'flex';
      element.style.alignItems = 'center';
      element.style.justifyContent = 'center';
      element.style.textAlign = 'center';
      element.style.border = 'none';
      element.style.cursor = 'pointer';
      element.style.borderRadius = '2px';
      element.style.fontSize = btn.fontSize || '0.65rem'; // allow per-button override
      element.style.padding = '2px 6px';
      element.style.minHeight = '18px';
      element.style.lineHeight = '1';
      element.style.whiteSpace = 'nowrap';
      element.style.transition = 'background 0.15s ease';
      
      if (btn.color) {
          element.style.background = btn.color;
      } else {
          element.style.background = '#007bff';
      }
      
      element.style.color = 'white';
      
      if (btn.title) element.title = btn.title;
      if (btn.disabled) {
          element.disabled = true;
          element.style.opacity = '0.5';
          element.style.cursor = 'not-allowed';
      }
      
      element.addEventListener('click', (e) => {
          e.stopPropagation();
          if (btn.onClick) btn.onClick(e);
      });
      
      // Hover effect
      element.addEventListener('mouseenter', () => {
          if (!element.disabled) {
              const currentBg = element.style.background;
              if (currentBg === 'rgb(0, 123, 255)' || currentBg === '#007bff') {
                  element.style.background = '#0056b3';
              }
          }
      });
      
      element.addEventListener('mouseleave', () => {
          if (!element.disabled) {
              if (btn.color) {
                  element.style.background = btn.color;
              } else {
                  element.style.background = '#007bff';
              }
          }
      });
      
      container.appendChild(element);
  });
   
// Add "..." overflow button if there are hidden buttons
  if (hiddenButtons.length > 0) {
      const moreBtn = document.createElement('button');
      moreBtn.textContent = '...';
      moreBtn.className = 'compact-btn compact-btn-more';
      moreBtn.title = 'More actions';
      
      // Force consistent styling for more button
      moreBtn.style.display = 'block';
      moreBtn.style.background = '#6c757d';
      moreBtn.style.color = 'white';
      moreBtn.style.border = 'none';
      moreBtn.style.cursor = 'pointer';
      moreBtn.style.borderRadius = '2px';
      moreBtn.style.fontSize = '0.65rem';
      moreBtn.style.padding = '2px 8px';
      moreBtn.style.minHeight = '18px';
      moreBtn.style.lineHeight = '1';
      moreBtn.style.fontWeight = 'bold';
      moreBtn.style.whiteSpace = 'nowrap';
      moreBtn.style.transition = 'background 0.15s ease';
      
      moreBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          showContextMenu(hiddenButtons, e);
      });
      
      moreBtn.addEventListener('mouseenter', () => {
          moreBtn.style.background = '#545b62';
      });
      
      moreBtn.addEventListener('mouseleave', () => {
          moreBtn.style.background = '#6c757d';
      });
      
      container.appendChild(moreBtn);
  }
   
   return container;
}

// Export globally
window.showContextMenu = showContextMenu;
window.createCompactButtonGroup = createCompactButtonGroup;
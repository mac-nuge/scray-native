(function () {

// Track where playback was triggered from
let currentListContext = null; // 'random', 'main', 'basket', 'history'
let currentVideoIndex = null;

// Session memory for volume/mute state
let sessionVolume = null; // null means not yet set by user
let sessionMuted = true; // Start muted by default

// Manual "rotate to landscape" toggle state (portrait mobile fullscreen)
let manualRotationActive = false;

// Manual position offset (px, vertical shift on screen) applied directly
// to the rotated player's transform. This replaces earlier attempts to
// track/restore the mobile browser's address-bar state, which JS can't
// reliably read or set. This offset is our OWN value - we set it and we
// read it back - so saving/restoring it is guaranteed to work every time.
const ROTATE_OFFSET_KEY = 'scray_rotate_offset_y';
const ROTATE_LOCK_KEY = 'scray_rotate_locked';
let manualRotationOffsetY = 0; // px; positive = shifted down on screen
let scrollLockActive = false; // true = position locked, dragging disabled

function loadManualRotationPrefs() {
    try {
        scrollLockActive = localStorage.getItem(ROTATE_LOCK_KEY) === '1';
        const storedOffset = localStorage.getItem(ROTATE_OFFSET_KEY);
        manualRotationOffsetY = storedOffset ? (parseInt(storedOffset, 10) || 0) : 0;
    } catch (e) {
        scrollLockActive = false;
        manualRotationOffsetY = 0;
    }
}
loadManualRotationPrefs();

function saveManualRotationOffset() {
    try {
        localStorage.setItem(ROTATE_OFFSET_KEY, String(manualRotationOffsetY));
    } catch (e) {}
}

// True when the player should behave as "landscape" for gesture/tap-zone
// purposes - either the device really is landscape, or manual rotation is
// forcing a landscape view while the device is still physically portrait
function isForcedOrRealLandscapeMobile() {
    return manualRotationActive || window.matchMedia('(orientation: landscape)').matches;
}

// A CSS rotate() doesn't change where the browser reports a tap/touch on
// screen - it only changes what's rendered there. So when manual rotation
// is forcing a landscape look on a physically-portrait screen, raw tap
// coordinates need to be converted into "what this position would be in
// genuine landscape mode" before feeding them into the existing landscape
// gesture-zone logic. This assumes a 90deg clockwise rotation (matching
// applyManualRotationStyles above) - if zones end up mirrored, swap the
// two lines below to: x: rect.width - (clientY - rect.top), y: clientX - rect.left
function remapForManualRotation(clientX, clientY, rect) {
    return {
        x: clientY - rect.top,
        y: rect.width - (clientX - rect.left),
        width: rect.height,
        height: rect.width
    };
}

// Tweak this number to adjust how far the video is inset from the
// screen edges while in forced (manual) landscape rotation. Same value
// applies to all four sides.
const MANUAL_ROTATE_VIDEO_INSET_PX = 3;

const MANUAL_ROTATE_PROPS = [
    'position', 'top', 'left', 'right', 'bottom', 'width', 'height',
    'max-width', 'max-height', 'min-width', 'min-height', 'margin', 'padding',
    'transform', 'transform-origin', 'display', 'align-items', 'justify-content',
    'overflow', 'object-fit'
];

function getManualRotationFullscreenElement() {
    // Prefer the real Fullscreen API element when available
    const nativeEl = document.fullscreenElement || document.webkitFullscreenElement || null;
    if (nativeEl) {
        console.log('[rotate] using native fullscreen element:', nativeEl.className || nativeEl.tagName);
        return nativeEl;
    }

    // Plyr's CSS-only fallback fullscreen mode uses the class
    // "plyr--fullscreen-fallback" (NOT "plyr--fullscreen" - that name is
    // used elsewhere in this codebase's CSS but doesn't match what Plyr
    // itself actually applies to the DOM)
    const fallbackEl = document.querySelector('.plyr--fullscreen-fallback')
        || document.querySelector('.plyr--fullscreen');
    if (fallbackEl) {
        console.log('[rotate] using fallback fullscreen element:', fallbackEl.className);
        return fallbackEl;
    }

    // Last resort: fullscreen.active is already confirmed true by the
    // caller at this point, so Plyr's own stylesheet has already made
    // the single .plyr container fullscreen even if we can't match its
    // exact modifier class - just grab it directly
    const plyrContainer = document.querySelector('#inlineVideoContainer .plyr') || document.querySelector('.plyr');
    if (plyrContainer) {
        console.log('[rotate] falling back to generic .plyr container');
        return plyrContainer;
    }

    console.warn('[rotate] no fullscreen element found at all');
    return null;
}

function getManualRotationTargets() {
    const container = getManualRotationFullscreenElement();
    if (!container) return null;
    const wrapper = container.querySelector('.plyr__video-wrapper') || (container.classList.contains('plyr__video-wrapper') ? container : null);
    const video = container.querySelector('video, .plyr__video-embed') || (container.tagName === 'VIDEO' ? container : null);
    const controls = container.querySelector('.plyr__controls') || document.querySelector('.plyr__controls');
    const progressBar = document.getElementById('permanentProgressBar');
    console.log('[rotate] targets found:', {
        container: !!container,
        wrapper: !!wrapper,
        video: !!video,
        controls: !!controls,
        progressBar: !!progressBar
    });
    return { container, wrapper, video, controls, progressBar };
}

function setImportantStyles(el, styles) {
    if (!el) return;
    Object.entries(styles).forEach(([prop, val]) => {
        el.style.setProperty(prop, val, 'important');
    });
}

function applyManualRotationStyles() {
    const targets = getManualRotationTargets();
    if (!targets || !targets.container) {
        console.warn('[rotate] applyManualRotationStyles: no container, aborting');
        return;
    }
    const { container, wrapper, video, controls, progressBar } = targets;

    // Use actual pixel dimensions rather than vw/vh - more reliable across
    // mobile browser chrome show/hide during fullscreen transitions
    const screenW = window.innerWidth;
    const screenH = window.innerHeight;
    console.log('[rotate] applying with screen size', screenW, 'x', screenH);

    // Incorporate the manual position offset (px) directly into the
    // container's vertical anchor. Since 'top' sets the untransformed
    // layout position and rotate(90deg) spins the box around its own
    // center afterward (no further displacement), adding pixels here
    // reliably shifts the whole rotated box up/down on the physical
    // screen - unambiguous regardless of the rotation math.
    const centerTopPx = (screenH / 2) + manualRotationOffsetY;

    // Rotate the whole fullscreen box (video + controls together) as one unit
    setImportantStyles(container, {
        position: 'fixed',
        top: centerTopPx + 'px',
        left: '50%',
        right: 'auto',
        bottom: 'auto',
        width: screenH + 'px',
        height: screenW + 'px',
        'max-width': screenH + 'px',
        'max-height': screenW + 'px',
        margin: '0',
        padding: '0',
        transform: 'translate(-50%, -50%) rotate(90deg)',
        'transform-origin': 'center center',
        'z-index': '2147483647'
    });

    setImportantStyles(wrapper, {
        position: 'absolute',
        top: MANUAL_ROTATE_VIDEO_INSET_PX + 'px',
        left: MANUAL_ROTATE_VIDEO_INSET_PX + 'px',
        width: `calc(100% - ${MANUAL_ROTATE_VIDEO_INSET_PX * 2}px)`,
        height: `calc(100% - ${MANUAL_ROTATE_VIDEO_INSET_PX * 2}px)`,
        'max-width': `calc(100% - ${MANUAL_ROTATE_VIDEO_INSET_PX * 2}px)`,
        'max-height': `calc(100% - ${MANUAL_ROTATE_VIDEO_INSET_PX * 2}px)`,
        margin: '0',
        padding: '0',
        display: 'flex',
        'align-items': 'center',
        'justify-content': 'center',
        overflow: 'hidden'
    });

    setImportantStyles(video, {
        position: 'static',
        width: '100%',
        height: '100%',
        'max-width': '100%',
        'max-height': '100%',
        'min-width': '0',
        'min-height': '0',
        transform: 'none',
        'object-fit': 'contain',
        margin: '0',
        padding: '0'
    });

    // Measure the progress bar's own height BEFORE repositioning it, while
    // it's still sitting in its prior (unrotated) layout state
    const progressBarHeightPx = progressBar ? progressBar.offsetHeight : 20;

    setImportantStyles(controls, {
        position: 'absolute',
        bottom: 'calc(5% + 2px)',
        left: '50%',
        right: 'auto',
        transform: 'translateX(-50%)',
        width: 'auto',
        'max-width': '90%',
        display: 'flex',
        'justify-content': 'center',
        'align-items': 'center',
        'z-index': '2147483647'
    });
    // The progress bar goes BELOW the controls, i.e. closer to the
    // container's own local edge - so its "bottom" offset must be SMALLER
    // than the controls' bottom offset, not larger. Sit it in the gap
    // between the edge (bottom: 0) and where the controls bar starts.
    const controlsBottomPx = 0.05 * screenW; // matches the 5% used above
    const stackGapPx = 4;
    const progressBarBottomPx = Math.max(
        stackGapPx,
        controlsBottomPx - progressBarHeightPx - stackGapPx
    );

    // ⚙️ Inset slightly less than the controls bar (which uses 40px each
    // side) so the progress bar reads as a touch wider than the controls,
    // while no longer running edge-to-edge and getting clipped.
    const PROGRESS_BAR_FLS_INSET_PX = 70;
    setImportantStyles(progressBar, {
        position: 'absolute',
        top: 'auto',
        left: PROGRESS_BAR_FLS_INSET_PX + 'px',
        right: 'auto',
        bottom: progressBarBottomPx + 'px',
        width: `calc(100% - ${PROGRESS_BAR_FLS_INSET_PX * 2}px)`,
        margin: '0',
        'z-index': '2147483647'
    });

    // Log the actual computed size after applying, to confirm it took effect
    if (container) {
        const rect = container.getBoundingClientRect();
        console.log('[rotate] container rect after apply:', rect.width, 'x', rect.height, 'at', rect.top, rect.left);
    }
}

function removeManualRotationStyles() {
    const targets = getManualRotationTargets();
    if (!targets) return;
    [targets.container, targets.wrapper, targets.video, targets.controls, targets.progressBar].forEach(el => {
        if (!el) return;
        MANUAL_ROTATE_PROPS.forEach(prop => el.style.removeProperty(prop));
        el.style.removeProperty('z-index');
    });
}

function manualRotationResizeHandler() {
    if (manualRotationActive) {
        applyManualRotationStyles();
    }
}

function activateManualRotation() {
manualRotationActive = true;
console.log('[rotate] manualRotationActive now =', manualRotationActive);

// Small delay lets any in-progress fullscreen transition settle first
setTimeout(() => {
    // Re-applies using manualRotationOffsetY, which is our own saved
    // value - this restores the exact same position every time.
    applyManualRotationStyles();
    updateScrollLockButtonDisplay();
}, 50);
window.addEventListener('resize', manualRotationResizeHandler);

document.body.classList.add('manual-rotate-landscape');
showPlayerFeedback('↻ Landscape view', 'top-left');

const rotateBtn = document.querySelector('.plyr-manual-rotate');
if (rotateBtn) rotateBtn.classList.add('active');
}

function toggleManualRotation() {
console.log('[rotate] toggle clicked, fullscreen active =', window.plyrPlayer?.fullscreen?.active);

if (!window.plyrPlayer?.fullscreen?.active) {
    //  Hide the player while it transitions through native fullscreen
    // entry so the brief "normal portrait fullscreen" frame is never
    // visible - goes straight to the rotated landscape view instead.
    const preEl = getManualRotationFullscreenElement();
    if (preEl) preEl.style.setProperty('opacity', '0', 'important');

    if (window.plyrPlayer?.fullscreen) {
        window.plyrPlayer.once('enterfullscreen', () => {
            setTimeout(() => {
                activateManualRotation();
                const el = getManualRotationFullscreenElement();
                if (el) {
                    el.style.setProperty('transition', 'opacity 0.15s ease', 'important');
                    el.style.setProperty('opacity', '1', 'important');
                }
            }, 100);
        });
        window.plyrPlayer.fullscreen.enter();
    }
    return;
}

//  Delegate to the same activate/reset helpers used by the auto-enter
// path above, so behavior stays consistent regardless of which route got here.
if (manualRotationActive) {
    resetManualRotation();
    showPlayerFeedback('↻ Normal view', 'top-left');
} else {
    activateManualRotation();
}
}  

function resetManualRotation() {
    if (manualRotationActive) {
        window.removeEventListener('resize', manualRotationResizeHandler);
        removeManualRotationStyles();
    }
    manualRotationActive = false;
    document.body.classList.remove('manual-rotate-landscape');
    const rotateBtn = document.querySelector('.plyr-manual-rotate');
    if (rotateBtn) rotateBtn.classList.remove('active');
}

window.toggleManualRotation = toggleManualRotation;
window.toggleScrollLock = toggleScrollLock;

// Mobile portrait: always-on bottom dock (no scroll-triggering needed)
// Stack order bottom -> up: corner buttons, info bar, video player, filter bar
// (Defined at top-level IIFE scope so it's accessible from playVideoInline,
// rebuildVideoInfoDisplay, resetVideoInline, etc. - not just inside createPlayerElement)
function computeBottomDock() {
    const container = document.getElementById('inlineVideoContainer');
    if (!container) return;

    // Skip recalculation entirely while the keyboard is open and the
    // player/filter bar are intentionally hidden for filtering - the
    // player's offsetHeight collapses to 0 in this state, which would
    // otherwise shrink the page and clamp scroll back to the top.
    if (document.body.classList.contains('keyboard-active') &&
        document.body.classList.contains('search-pill-active')) {
        return;
    }

    const videoInfo = document.getElementById('currentVideoInfo');
    const cornerButtons = document.getElementById('cornerButtons');

    const isMobilePortrait = window.innerWidth <= 768 && window.matchMedia('(orientation: portrait)').matches;

    const shouldDock = isMobilePortrait &&
        !window.plyrPlayer?.fullscreen?.active &&
        !container.classList.contains('mini-player');

    const backdrop = document.getElementById('bottomDockBackdrop');

    if (!shouldDock) {
        container.classList.remove('bottom-docked');
        container.style.bottom = '';
        if (videoInfo) {
            videoInfo.classList.remove('info-bottom-docked');
            videoInfo.style.bottom = '';
        }
        document.body.style.paddingBottom = '';
        if (backdrop) backdrop.classList.remove('active');
        const topSpacer = document.getElementById('topSpacer');
        if (topSpacer) topSpacer.style.height = '';
        return;
    }

    container.classList.add('bottom-docked');
    if (videoInfo) videoInfo.classList.add('info-bottom-docked');
    if (backdrop) backdrop.classList.add('active');

    // Read the corner buttons' ACTUAL on-screen position instead of a
    // hardcoded offset. This means if the corner buttons / pills bar CSS
    // bottom values ever change, the info bar automatically keeps a
    // consistent gap above them without needing to update this function.
    const cornerRect = cornerButtons ? cornerButtons.getBoundingClientRect() : null;
    const gapAboveCornerButtons = 14; // slightly larger gap so info bar clears the pills/buttons row
    let runningBottom = cornerRect
        ? (window.innerHeight - cornerRect.top) + gapAboveCornerButtons
        : 60; // fallback if corner buttons aren't found for some reason

    const gapBetweenStackItems = 6; // small breathing room between info bar / player / filter bar

    const infoHeight = videoInfo ? videoInfo.offsetHeight : 0;
    const playerHeight = container.offsetHeight;

    if (videoInfo) {
        videoInfo.style.bottom = runningBottom + 'px';
    }
    runningBottom += infoHeight + gapBetweenStackItems;

    container.style.bottom = runningBottom + 'px';
    runningBottom += playerHeight;

    // Size the backdrop to cover everything from the top of the video
    // player down to the bottom of the screen (i.e. the whole dock stack
    // below the player, including all the small gaps between elements).
    if (backdrop) {
        const playerTop = container.getBoundingClientRect().top;
        backdrop.style.top = Math.max(0, playerTop) + 'px';
    }

    // Push the rest of the page up so it never sits behind the fixed dock
    document.body.style.paddingBottom = runningBottom + 'px';

    // Mirror that same amount as a spacer above the title - absorbs any
    // auto-scroll (e.g. scrollIntoView on the docked player/search box)
    // so the console/buttons/account pills near the top don't get pushed
    // off-screen, requiring a manual scroll back up to reach them.
    const topSpacer = document.getElementById('topSpacer');
    if (topSpacer) topSpacer.style.height = runningBottom + 'px';
}

function getVideoListByContext() {
if (currentListContext === 'random') return filteredVideosGlobal || [];
if (currentListContext === 'main') return paginationState?.allVideos || [];
if (currentListContext === 'basket') return basketVideos || [];
if (currentListContext === 'history') return historyVideos || [];
return [];
}

/**
* Play next video in current list context
* If nothing is playing, play first item from main list
*/
function playNextInCurrentList() {
   // If nothing is playing, play first item from main list
   if (currentListContext === null || currentVideoIndex === null) {
       console.log('No video currently playing - playing first item from main list');
       
       // Get main list (tagged videos container)
       const mainList = paginationState?.allVideos || [];
       
       if (mainList.length === 0) {
           alert('No videos in main list');
           return;
       }
       
       // Play first video from main list
       window.inlineVideoPlayer.play(mainList[0], 'main', 0);
       
       // Mobile: auto-scroll to player
       if (window.innerWidth <= 1024) {
           setTimeout(() => {
               const player = document.getElementById("inlineVideoContainer");
               if (player) {
                   player.scrollIntoView({ behavior: "smooth", block: "center" });
               }
           }, 300);
       }
       
       return;
   }
   
   // Get current list
   const currentList = getVideoListByContext();
   
   if (!currentList || currentList.length === 0) {
       alert(`No videos in ${currentListContext} list`);
       return;
   }
   
   // Calculate next index
   let nextIndex = currentVideoIndex + 1;
   
   // Wrap around to start if at end
   if (nextIndex >= currentList.length) {
       nextIndex = 0;
       console.log(`Reached end of ${currentListContext} list - wrapping to start`);
   }
   
   // Play next video
   const nextVideo = currentList[nextIndex];
   
   console.log(`Playing next in ${currentListContext} list: ${nextIndex + 1}/${currentList.length} - ${nextVideo.filename}`);
   
   if (window.inlineVideoPlayer) {
       window.inlineVideoPlayer.play(nextVideo, currentListContext, nextIndex);
       
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

/**
* Play previous video in current list context
* If nothing is playing, play first item from main list
*/
function playPreviousInCurrentList() {
   // If nothing is playing, play first item from main list
   if (currentListContext === null || currentVideoIndex === null) {
       console.log('No video currently playing - playing first item from main list');
       
       // Get main list (tagged videos container)
       const mainList = paginationState?.allVideos || [];
       
       if (mainList.length === 0) {
           alert('No videos in main list');
           return;
       }
       
       // Play first video from main list
       window.inlineVideoPlayer.play(mainList[0], 'main', 0);
       
       // Mobile: auto-scroll to player
       if (window.innerWidth <= 1024) {
           setTimeout(() => {
               const player = document.getElementById("inlineVideoContainer");
               if (player) {
                   player.scrollIntoView({ behavior: "smooth", block: "center" });
               }
           }, 300);
       }
       
       return;
   }
   
   // Get current list
   const currentList = getVideoListByContext();
   
   if (!currentList || currentList.length === 0) {
       alert(`No videos in ${currentListContext} list`);
       return;
   }
   
   // Calculate previous index
   let prevIndex = currentVideoIndex - 1;
   
   // Wrap around to end if at start
   if (prevIndex < 0) {
       prevIndex = currentList.length - 1;
       console.log(`At start of ${currentListContext} list - wrapping to end`);
   }
   
   // Play previous video
   const prevVideo = currentList[prevIndex];
   
   console.log(`Playing previous in ${currentListContext} list: ${prevIndex + 1}/${currentList.length} - ${prevVideo.filename}`);
   
   if (window.inlineVideoPlayer) {
       window.inlineVideoPlayer.play(prevVideo, currentListContext, prevIndex);
       
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

// ========================
// Anywhere Scrubbing helper (MOBILE ONLY, excludes progress bar)
// ========================
function enableAnywhereScrubbing() {
// ✅ ONLY enable on mobile
if (window.innerWidth > 768) {
//  console.log('Anywhere scrubbing disabled on desktop');
return;
}

const wrapper = document.querySelector('.plyr__video-wrapper');
if (!wrapper) return;

let scrubbing = false;
let startX = 0;
let startY = 0;
let startTime = 0;
let isHorizontalDrag = false;
let isDetermined = false;

const showScrubFeedback = (newTime) => {
showPlayerFeedback(formatDuration(newTime * 1000), 'top-left');
};

const startScrub = (e) => {
// ✅ Only block in mini-player
const isMiniPlayer = document.getElementById('inlineVideoContainer')?.classList.contains('mini-player');

if (isMiniPlayer) {
return;
}

// ✅ Don't start scrubbing while a frame-step circle is being held for
// slow-motion playback - the two gestures conflict on the same wrapper.
if (window.frameStepHolding) {
return;
}

// Ignore if touch started on progress bar or controls
const target = e.target || (e.touches && e.touches[0].target);
if (target && (
target.closest('.plyr__controls') || 
target.closest('.plyr__progress')
)) {
return; // Let Plyr handle it
}

// ✅ Store starting position for direction detection and scrubbing
startX = e.touches ? e.touches[0].clientX : e.clientX;
startY = e.touches ? e.touches[0].clientY : e.clientY;
startTime = window.plyrPlayer.currentTime;
isHorizontalDrag = false;
isDetermined = false;
scrubbing = false; // Don't activate yet - wait to determine direction

// ✅ MOBILE (ALL orientations): Don't prevent default yet - let scrubMove determine direction
const isMobile = window.innerWidth <= 1024;

if (isMobile) {
// Don't block yet - scrubMove will decide based on direction
return;
}

// ✅ Desktop only: prevent default to block scrolling
e.preventDefault();
};

const stopScrub = (e) => {
// Swipe-to-exit fullscreen: works in both FLS and genuine device
// landscape, but the "down" direction differs between the two since
// FLS rotates the video 90° relative to the physical screen.
if (isDetermined && !isHorizontalDrag && e && e.changedTouches && e.changedTouches[0]) {
    const SWIPE_EXIT_THRESHOLD_PX = 60; // ⚙️ adjust sensitivity here

    if (manualRotationActive) {
        // FLS: a physical leftward swipe is "down" from the rotated
        // video's own point of view.
        const endX = e.changedTouches[0].clientX;
        const deltaXPhysical = endX - startX; // negative = swiped left (physical)
        if (deltaXPhysical < -SWIPE_EXIT_THRESHOLD_PX) {
            resetManualRotation();
            if (window.plyrPlayer.fullscreen.active) {
                window.plyrPlayer.fullscreen.exit();
            }
            showPlayerFeedback('⛶ Exit Fullscreen', 'top-left');
        }
    } else if (isForcedOrRealLandscapeMobile() && window.plyrPlayer.fullscreen.active) {
        // Genuine device landscape: no rotation involved, so a real
        // physical downward swipe exits fullscreen directly.
        const endY = e.changedTouches[0].clientY;
        const deltaYPhysical = endY - startY; // positive = swiped down (physical)
        if (deltaYPhysical > SWIPE_EXIT_THRESHOLD_PX) {
            window.plyrPlayer.fullscreen.exit();
            showPlayerFeedback('⛶ Exit Fullscreen', 'top-left');
        }
    }
}

scrubbing = false;
isHorizontalDrag = false;
isDetermined = false;
};

const scrubMove = (e) => {
if (window.frameStepHolding) {
return;
}

const currentX = e.touches ? e.touches[0].clientX : e.clientX;
const currentY = e.touches ? e.touches[0].clientY : e.clientY;

const deltaX = Math.abs(currentX - startX);
     const deltaY = Math.abs(currentY - startY);
     
     // Determine direction on first significant movement
     if (!isDetermined && (deltaX > 10 || deltaY > 10)) {
     isDetermined = true;
     
     // When manually rotated, the seek-axis is vertical screen movement
     // instead of horizontal (the video's own "horizontal" is now aligned
     // with the screen's vertical axis)
     const rotated = manualRotationActive;
     const seekAxisDelta = rotated ? deltaY : deltaX;
     const offAxisDelta = rotated ? deltaX : deltaY;
     
     if (seekAxisDelta > offAxisDelta) {
     // Seek-axis drag - enable scrubbing
     isHorizontalDrag = true;
     scrubbing = true;
     console.log(rotated ? 'Rotated seek-axis drag detected - scrubbing enabled' : 'Horizontal drag detected - scrubbing enabled');
     } else {
     // Off-axis drag detected
     isHorizontalDrag = false;
     scrubbing = false;
     console.log(rotated ? 'Off-axis drag detected (rotated)' : 'Vertical drag detected');
     }
     }

// ✅ If direction not determined yet, don't prevent default (allow natural scrolling)
if (!isDetermined) {
return;
}

// ✅ LANDSCAPE MOBILE (real, or forced via manual rotation): Block ALL vertical scrolling, allow horizontal scrubbing
const isLandscape = isForcedOrRealLandscapeMobile();
const isMobile = window.innerWidth <= 1024;

if (isLandscape && isMobile) {
// Always block vertical scrolling on player in landscape
e.preventDefault();

if (isHorizontalDrag) {
// Horizontal drag - scrub
scrubbing = true;
} else {
// Vertical drag - block it
return;
}
} else {
// ✅ PORTRAIT/DESKTOP: Only prevent default for HORIZONTAL drags (scrubbing)
// Let vertical drags pass through naturally for scrolling
if (isHorizontalDrag) {
e.preventDefault();
scrubbing = true;
} else {
// Vertical drag in portrait - allow natural scrolling, don't block
return;
}
}

// ✅ Execute scrubbing if active
if (!scrubbing) {
return;
}

const rect = wrapper.getBoundingClientRect();
     const rotated = manualRotationActive;
     
     // Seeking distance: normally driven by horizontal screen movement /
     // element width; when rotated, driven by vertical screen movement /
     // element height instead (the video's own horizontal axis)
     let fractionMoved;
     if (rotated) {
         const deltaYSigned = currentY - startY;
         fractionMoved = deltaYSigned / rect.height;
     } else {
         const deltaXSigned = currentX - startX;
         fractionMoved = deltaXSigned / rect.width;
     }
     
     // Zone speed multiplier: normally keyed off vertical tap position
     // (near screen bottom = faster seeking); when rotated, keyed off
     // horizontal tap position instead (the video's own vertical axis)
     let distanceFromEdge, edgeAxisSize;
     if (rotated) {
         const clientX = e.touches ? e.touches[0].clientX : e.clientX;
         edgeAxisSize = rect.width;
         distanceFromEdge = edgeAxisSize - (clientX - rect.left);
     } else {
         const clientY = e.touches ? e.touches[0].clientY : e.clientY;
         edgeAxisSize = rect.height;
         distanceFromEdge = edgeAxisSize - (clientY - rect.top);
     }
     
     let zoneMultiplier = 1;
     if (distanceFromEdge < edgeAxisSize * 0.2) {
     zoneMultiplier = 3;
     } else if (distanceFromEdge < edgeAxisSize * 0.4) {
     zoneMultiplier = 1;
     }
     
     // FIX: Use window.plyrPlayer instead of player
     let newTime = startTime + (fractionMoved * window.plyrPlayer.duration * zoneMultiplier);
     newTime = Math.max(0, Math.min(newTime, window.plyrPlayer.duration));
     
     window.plyrPlayer.currentTime = newTime;
     showScrubFeedback(newTime);
     };

// Touch events - passive: false to allow conditional preventDefault
wrapper.addEventListener('touchstart', startScrub, { passive: false });
window.addEventListener('touchend', stopScrub);
wrapper.addEventListener('touchmove', scrubMove, { passive: false });

// LANDSCAPE MOBILE: Block ALL scrolling on controls area normally, BUT
// while manual rotation is active, this area instead becomes a drag handle
// that adjusts manualRotationOffsetY directly (our own value - see
// applyManualRotationStyles), rather than trying to move the page/browser
// chrome. When locked, dragging is ignored.
const isLandscapeMobile = window.innerWidth <= 1024; // gate on mobile width only; orientation is now checked live inside the handlers below
if (isLandscapeMobile) {
   // Wait for controls to exist in DOM
   setTimeout(() => {
       const controls = document.querySelector('.plyr__controls');
       if (controls) {
           let rotateDragStartY = null;
           let rotateDragStartOffset = 0;

           controls.addEventListener('touchstart', (e) => {
               if (manualRotationActive) {
                   if (scrollLockActive) return; // locked - ignore drags
                   rotateDragStartY = e.touches[0].clientY;
                   rotateDragStartOffset = manualRotationOffsetY;
                   return;
               }
               if (isForcedOrRealLandscapeMobile()) startScrub(e);
           }, { passive: false });

           controls.addEventListener('touchmove', (e) => {
               if (manualRotationActive) {
                   if (scrollLockActive) {
                       // Locked: block the browser's native scroll/pan
                       // here (this is what was missing - previously we
                       // just returned without preventDefault, which let
                       // the page/viewport still move even while "locked").
                       // No repositioning happens - we just swallow the gesture.
                       e.preventDefault();
                       return;
                   }
                   if (rotateDragStartY === null) return;
                   e.preventDefault();
                   const deltaY = e.touches[0].clientY - rotateDragStartY;
                   manualRotationOffsetY = rotateDragStartOffset + deltaY;
                   applyManualRotationStyles();
                   updateScrollLockButtonDisplay();
                   return;
               }
               // Only block scrolling when actually in real landscape
               if (!isForcedOrRealLandscapeMobile()) return;
               e.preventDefault();
               e.stopPropagation();
               // Call scrubMove to handle horizontal scrubbing
               scrubMove(e);
           }, { passive: false });

           controls.addEventListener('touchend', () => {
               if (manualRotationActive && rotateDragStartY !== null) {
                   rotateDragStartY = null;
                   saveManualRotationOffset(); // persist wherever the drag ended
               }
           });

           console.log('Controls touch handlers added for landscape mobile (no scrolling)');
       }
   }, 500); // Wait for Plyr to finish initializing
}

// console.log('Anywhere scrubbing enabled (horizontal drag only)');
}


// ========================
// Player feedback overlay
// ========================
function showPlayerFeedback(message, position = 'top-left') {
try {
let overlay = document.getElementById('plyr-feedback');
if (!overlay) {
    const plyrContainer = document.querySelector('.plyr');
    if (!plyrContainer) {
        console.error('showPlayerFeedback: .plyr container not found in DOM');
        return;
    }
    overlay = document.createElement('div');
    overlay.id = 'plyr-feedback';
    overlay.style.position = 'absolute';
    overlay.style.zIndex = '99999';
    overlay.style.padding = '4px 8px';
    overlay.style.borderRadius = '4px';
    overlay.style.background = 'rgba(0,0,0,0.6)';
    overlay.style.color = '#fff';
    overlay.style.fontSize = '0.8rem';
    overlay.style.pointerEvents = 'none';
    overlay.style.transition = 'opacity 0.3s ease';
    plyrContainer.appendChild(overlay);
}

// Forced landscape mode only: nudge notifications further right (away
// from the left edge) to accommodate browsers with a narrower viewable
// area. ⚙️ Adjust FORCED_LANDSCAPE_FEEDBACK_EXTRA below (currently 25px)
// if it needs more/less.
const FORCED_LANDSCAPE_FEEDBACK_EXTRA = 25; // ⚙️ px
const forcedExtra = manualRotationActive ? FORCED_LANDSCAPE_FEEDBACK_EXTRA : 0;

overlay.style.left = position === 'top-left' ? `${60 + forcedExtra}px` : 'auto'; // Moved inward from 8px
overlay.style.right = position === 'top-right' ? `${120 - forcedExtra}px` : 'auto'; // Moved inward from 70px
overlay.style.top = '8px';
overlay.style.bottom = 'auto';

overlay.textContent = message;
overlay.style.opacity = '1';

clearTimeout(overlay._hideTimer);
overlay._hideTimer = setTimeout(() => {
    overlay.style.opacity = '0';
}, 500);
} catch (err) {
    console.error('showPlayerFeedback failed:', err.message);
}
}

// ========================
// Stop control & reorder all controls (WITHOUT destroying elements)
// ========================
function attachStopButton() {
const controls = document.querySelector('.plyr__controls');
if (!controls) return;
if (controls.querySelector('.plyr-stop')) return; // prevent duplicates

const stopBtn = document.createElement("button");
stopBtn.className = "plyr__control plyr-stop";
stopBtn.textContent = '■';
stopBtn.title = 'Stop playback';
stopBtn.onclick = (e) => {
window.inlineVideoPlayer.reset();
e.currentTarget.blur();
};

// Get references to existing controls
const playBtn = controls.querySelector('[data-plyr="play"]');
const fullscreenBtn = controls.querySelector('[data-plyr="fullscreen"]');
const progressContainer = controls.querySelector('.plyr__progress');
const timeDisplay = controls.querySelector('.plyr__time');
const settingsBtn = controls.querySelector('[data-plyr="settings"]');
const volumeBtn = controls.querySelector('[data-plyr="volume"]');
const muteBtn = controls.querySelector('[data-plyr="mute"]');

// Insert stop button right after play button
if (playBtn && playBtn.nextSibling) {
controls.insertBefore(stopBtn, playBtn.nextSibling);
} else if (playBtn) {
controls.appendChild(stopBtn);
} else {
controls.insertBefore(stopBtn, controls.firstChild);
}

//  Don't reorder other buttons - Plyr init handles the order now

//  FORCE FLEX STYLES WITH SETTABLE PRIORITY
const applyFlexStyles = () => {
// Force controls to be flex container
controls.style.setProperty('display', 'flex', 'important');
controls.style.setProperty('align-items', 'center', 'important');
controls.style.setProperty('gap', '4px', 'important');
controls.style.setProperty('flex-wrap', 'nowrap', 'important');

// Make progress bar stretch to fill space
if (progressContainer) {
progressContainer.style.setProperty('flex', '1 1 auto', 'important');
progressContainer.style.setProperty('min-width', '0', 'important');
progressContainer.style.setProperty('max-width', 'none', 'important');
}

// Make all controls fixed width
[playBtn, stopBtn, fullscreenBtn, timeDisplay, settingsBtn, volumeBtn, muteBtn].forEach(btn => {
if (btn) {
    btn.style.setProperty('flex', '0 0 auto', 'important');
    btn.style.setProperty('flex-shrink', '0', 'important');
}
});

// Stop button sizing
if (stopBtn) {
stopBtn.style.setProperty('min-width', '50px', 'important');
stopBtn.style.setProperty('min-height', '50px', 'important');
}
};

// Apply immediately
applyFlexStyles();

// Apply again after a short delay to override any Plyr initialization
setTimeout(applyFlexStyles, 100);
setTimeout(applyFlexStyles, 500);

// console.log('Stop button attached with forced flex styles');
}

// ========================
// iOS Native Fullscreen control (MOBILE ONLY)
// ========================
function attachIOSFullscreenButton() {
const controls = document.querySelector('.plyr__controls');
if (!controls) return;
if (controls.querySelector('.plyr-ios-fullscreen')) return; // prevent duplicates

// Only add on touch devices (catches tablets and landscape mobile)
const isTouchDevice = ('ontouchstart' in window) || 
                      (navigator.maxTouchPoints > 0) || 
                      (navigator.msMaxTouchPoints > 0);

// Also check if truly desktop by screen size AND touch capability
const isDesktop = window.innerWidth >= 769 && window.innerHeight >= 600 && !isTouchDevice;

if (isDesktop) {
    console.log('Desktop detected - skipping iOS fullscreen button');
    return;
}

 const iosFullscreenBtn = document.createElement("button");
 iosFullscreenBtn.className = "plyr__control plyr-ios-fullscreen";
 iosFullscreenBtn.innerHTML = '⛶'; // Fullscreen symbol
 iosFullscreenBtn.title = 'Native fullscreen (iOS)';
 iosFullscreenBtn.onclick = (e) => {
     triggerIOSNativeFullscreen();
     e.currentTarget.blur();
 };

 // Insert iOS fullscreen button BEFORE the regular fullscreen button
 const fullscreenBtn = controls.querySelector('[data-plyr="fullscreen"]');
 if (fullscreenBtn) {
     controls.insertBefore(iosFullscreenBtn, fullscreenBtn);
 } else {
     // Fallback: add at end if regular fullscreen not found
     controls.appendChild(iosFullscreenBtn);
 }

 console.log('iOS native fullscreen button attached');
}

function attachManualRotateButton() {
const controls = document.querySelector('.plyr__controls');
if (!controls) return;
if (controls.querySelector('.plyr-manual-rotate')) return; // prevent duplicates

// Only add on touch devices (same detection as iOS fullscreen button)
const isTouchDevice = ('ontouchstart' in window) ||
                      (navigator.maxTouchPoints > 0) ||
                      (navigator.msMaxTouchPoints > 0);
const isDesktop = window.innerWidth >= 769 && window.innerHeight >= 600 && !isTouchDevice;
if (isDesktop) return;

const rotateBtn = document.createElement("button");
rotateBtn.className = "plyr__control plyr-manual-rotate";
rotateBtn.innerHTML = '↻';
rotateBtn.title = 'Rotate to landscape view';
rotateBtn.onclick = (e) => {
    toggleManualRotation();
    e.currentTarget.blur();
};

const fullscreenBtn = controls.querySelector('[data-plyr="fullscreen"]');
if (fullscreenBtn) {
    controls.insertBefore(rotateBtn, fullscreenBtn);
} else {
    controls.appendChild(rotateBtn);
}

console.log('Manual rotate button attached');
}

// SVG shackle paths for the padlock icon - swapped via the 'd' attribute.
const LOCK_SHACKLE_CLOSED = 'M7 11V7a5 5 0 0 1 10 0v4';
const LOCK_SHACKLE_OPEN = 'M17 11V7a5 5 0 0 0-9.9-1';

function updateScrollLockButtonDisplay() {
    const btn = document.querySelector('.plyr-scroll-lock');
    if (!btn) return;
    const shackle = btn.querySelector('.scroll-lock-shackle');
    const num = btn.querySelector('.scroll-lock-num');
    if (shackle) shackle.setAttribute('d', scrollLockActive ? LOCK_SHACKLE_CLOSED : LOCK_SHACKLE_OPEN);
    if (num) num.textContent = Math.round(manualRotationOffsetY);
    btn.classList.toggle('active', scrollLockActive);
    btn.title = scrollLockActive
        ? 'Locked - tap to unlock and allow repositioning'
        : 'Unlocked - drag the controls area to reposition, tap to lock';
}

function toggleScrollLock() {
    if (!manualRotationActive) {
        showPlayerFeedback('Enter rotated view first', 'top-left');
        return;
    }

    scrollLockActive = !scrollLockActive;
    showPlayerFeedback(scrollLockActive ? '🔒 Locked' : '🔓 Unlocked', 'top-left');

    try {
        localStorage.setItem(ROTATE_LOCK_KEY, scrollLockActive ? '1' : '0');
    } catch (e) {}

    updateScrollLockButtonDisplay();
}

function attachScrollLockButton() {
    const controls = document.querySelector('.plyr__controls');
    if (!controls) return;
    if (controls.querySelector('.plyr-scroll-lock')) return; // prevent duplicates

    const isTouchDevice = ('ontouchstart' in window) ||
                          (navigator.maxTouchPoints > 0) ||
                          (navigator.msMaxTouchPoints > 0);
    const isDesktop = window.innerWidth >= 769 && window.innerHeight >= 600 && !isTouchDevice;
    if (isDesktop) return;

    const lockBtn = document.createElement("button");
    lockBtn.className = "plyr__control plyr-scroll-lock";
    lockBtn.innerHTML = `
        <svg class="scroll-lock-svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path class="scroll-lock-shackle" d="${LOCK_SHACKLE_OPEN}"></path>
            <rect x="3" y="11" width="18" height="10" rx="2" ry="2" fill="currentColor" stroke="none"></rect>
        </svg>
        <span class="scroll-lock-num">0</span>
    `;

    // Single click listener - fires once per genuine tap on both touch
    // and mouse (the browser handles the synthesis correctly for plain
    // 'click'), avoiding the earlier double-fire bug from separately
    // tracking touchstart/touchend AND mousedown/mouseup.
    lockBtn.addEventListener('click', () => {
        toggleScrollLock();
        lockBtn.blur();
    });

    const fullscreenBtn = controls.querySelector('[data-plyr="fullscreen"]');
    if (fullscreenBtn) {
        controls.insertBefore(lockBtn, fullscreenBtn);
    } else {
        controls.appendChild(lockBtn);
    }

    updateScrollLockButtonDisplay();
    console.log('Scroll lock button attached');
}

// =========================================
// QUICK-ACTION BUTTONS: Random video (X) and Play-through-history (H<)
// These simply trigger the same corner buttons' click handlers, so the
// underlying logic lives in one place (randomiser.js / history.js).
// =========================================
function attachRandomVideoButton() {
    const controls = document.querySelector('.plyr__controls');
    if (!controls) return;
    if (controls.querySelector('.plyr-random-video')) return; // prevent duplicates

    const isTouchDevice = ('ontouchstart' in window) ||
                          (navigator.maxTouchPoints > 0) ||
                          (navigator.msMaxTouchPoints > 0);
    const isDesktop = window.innerWidth >= 769 && window.innerHeight >= 600 && !isTouchDevice;
    if (isDesktop) return;

    const btn = document.createElement("button");
    btn.className = "plyr__control plyr-random-video";
    btn.textContent = 'X';
    btn.title = 'Play random filtered video';
    btn.onclick = (e) => {
        // In forced (FLS) or genuine device landscape fullscreen, behave
        // like the weighted-random (Xn) button instead of the plain one.
        const isForcedLandscape = document.body.classList.contains('manual-rotate-landscape') ||
            document.body.classList.contains('landscape-fullscreen');
        const targetBtnId = isForcedLandscape ? 'playRandomWeightedBtn' : 'playRandomFilteredBtn';
        // Weighted-random sets its own label inside randomiser.js; the
        // plain random button doesn't, so set it here.
        if (!isForcedLandscape) {
            window.lastPlayLabel = 'Random';
        }
        document.getElementById(targetBtnId)?.click();
        e.currentTarget.blur();
    };

    const fullscreenBtn = controls.querySelector('[data-plyr="fullscreen"]');
    if (fullscreenBtn) {
        controls.insertBefore(btn, fullscreenBtn);
    } else {
        controls.appendChild(btn);
    }

    console.log('Random video button attached');
}

function attachHistorySequenceButton() {
    const controls = document.querySelector('.plyr__controls');
    if (!controls) return;
    if (controls.querySelector('.plyr-history-sequence')) return; // prevent duplicates

    const isTouchDevice = ('ontouchstart' in window) ||
                          (navigator.maxTouchPoints > 0) ||
                          (navigator.msMaxTouchPoints > 0);
    const isDesktop = window.innerWidth >= 769 && window.innerHeight >= 600 && !isTouchDevice;
    if (isDesktop) return;

    const btn = document.createElement("button");
    btn.className = "plyr__control plyr-history-sequence";
    btn.textContent = 'H<';
    btn.title = 'Play through history';
    btn.onclick = (e) => {
        window.lastPlayLabel = 'Last Played';
        document.getElementById('playHistorySequenceBtn')?.click();
        e.currentTarget.blur();
    };

    const fullscreenBtn = controls.querySelector('[data-plyr="fullscreen"]');
    if (fullscreenBtn) {
        controls.insertBefore(btn, fullscreenBtn);
    } else {
        controls.appendChild(btn);
    }

    console.log('History sequence button attached');
}

function attachPlayNextButton() {
    const controls = document.querySelector('.plyr__controls');
    if (!controls) return;
    if (controls.querySelector('.plyr-play-next')) return; // prevent duplicates

    const isTouchDevice = ('ontouchstart' in window) ||
                          (navigator.maxTouchPoints > 0) ||
                          (navigator.msMaxTouchPoints > 0);
    const isDesktop = window.innerWidth >= 769 && window.innerHeight >= 600 && !isTouchDevice;
    if (isDesktop) return;

    const btn = document.createElement("button");
    btn.className = "plyr__control plyr-play-next";
    btn.textContent = '>';
    btn.title = 'Play next in current list';
    btn.onclick = (e) => {
        window.lastPlayLabel = 'Next in List';
        if (typeof window.playNextInCurrentList === 'function') {
            window.playNextInCurrentList();
        }
        e.currentTarget.blur();
    };

    const fullscreenBtn = controls.querySelector('[data-plyr="fullscreen"]');
    if (fullscreenBtn) {
        controls.insertBefore(btn, fullscreenBtn);
    } else {
        controls.appendChild(btn);
    }

    console.log('Play-next button attached');
}

// ⚙️ Approximate frame duration for frame-stepping (assumes ~30fps since
// actual per-video frame rate isn't tracked). Adjust if your source
// material commonly runs at a different frame rate.
const FRAME_STEP_DURATION = 1 / 30;
// ⚙️ Hold longer than this (ms) and it switches from a single tap-step
// into continuous frame-by-frame "slow motion" stepping.
const FRAME_HOLD_DELAY_MS = 250;
// ⚙️ Time (ms) between steps while holding - lower = faster slow-mo.
const FRAME_HOLD_INTERVAL_MS = 90;
// ⚙️ Release then re-hold within this window to double the speed.
const FRAME_HOLD_SPEEDUP_WINDOW_MS = 500;
// ⚙️ Speed multiplier caps out here (1x -> 2x -> 4x -> 8x -> 16x -> 32x -> 64x -> 128x).
const FRAME_HOLD_MAX_MULTIPLIER = 128;
// ⚙️ Max gap (ms) between taps for them to count as a double-tap on the
// left-half frame-step zones (toggles play/pause instead of stepping).
const FRAME_STEP_ZONE_DOUBLE_TAP_MS = 300;

// Shared across every frame-step control (the two circle buttons AND the
// new column tap zones below): releasing a hold and starting a new one
// within FRAME_HOLD_SPEEDUP_WINDOW_MS doubles the stepping speed (capped
// at FRAME_HOLD_MAX_MULTIPLIER). Waiting longer resets it back to 1x.
const frameStepHoldSpeedState = { multiplier: 1, lastReleaseTime: 0 };

function stepFrame(direction, multiplier = 1) {
    if (!window.plyrPlayer || !window.plyrPlayer.duration) return;

    if (!window.plyrPlayer.paused) {
        window.plyrPlayer.pause();
    }

    const newTime = Math.max(
        0,
        Math.min(window.plyrPlayer.duration, window.plyrPlayer.currentTime + (direction * FRAME_STEP_DURATION * multiplier))
    );
    window.plyrPlayer.currentTime = newTime;

    if (typeof showPlayerFeedback === 'function') {
        const speedSuffix = multiplier > 1 ? ` (${multiplier}x)` : '';
        const label = direction > 0 ? `+1 frame${speedSuffix}` : `-1 frame${speedSuffix}`;
        showPlayerFeedback(`${label} (${formatDuration(newTime * 1000)})`, direction > 0 ? 'top-right' : 'top-left');
    }
}

// Tap = single frame step. Hold past FRAME_HOLD_DELAY_MS = continuous
// frame-by-frame stepping (slow motion) until released. Uses touch
// events (not pointer events) and stopPropagation so this never bubbles
// up to the anywhere-scrubbing / double-tap-to-seek handlers attached
// higher up on the video wrapper. Shared by the frame-step circle
// buttons AND the column tap zones (single tap on the -3/+3 etc seek
// columns, only active while player controls are visible).
function attachFrameStepHoldHandlers(el, direction) {
    let holdTimeout = null;
    let holdInterval = null;
    let isHolding = false;

    const clearTimers = () => {
        clearTimeout(holdTimeout);
        holdTimeout = null;
        if (holdInterval) {
            clearInterval(holdInterval);
            holdInterval = null;
        }
    };

    el.addEventListener('touchstart', (e) => {
        e.stopPropagation();
        e.preventDefault();
        isHolding = false;
        holdTimeout = setTimeout(() => {
            isHolding = true;
            window.frameStepHolding = true;

            // Escalate speed if this hold started shortly after the last one ended
            const now = Date.now();
            if (now - frameStepHoldSpeedState.lastReleaseTime <= FRAME_HOLD_SPEEDUP_WINDOW_MS) {
                frameStepHoldSpeedState.multiplier = Math.min(FRAME_HOLD_MAX_MULTIPLIER, frameStepHoldSpeedState.multiplier * 2);
            } else {
                frameStepHoldSpeedState.multiplier = 1;
            }

            stepFrame(direction, frameStepHoldSpeedState.multiplier);
            holdInterval = setInterval(() => stepFrame(direction, frameStepHoldSpeedState.multiplier), FRAME_HOLD_INTERVAL_MS);
        }, FRAME_HOLD_DELAY_MS);
    }, { passive: false });

    el.addEventListener('touchend', (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (!isHolding) {
            stepFrame(direction);
        } else {
            frameStepHoldSpeedState.lastReleaseTime = Date.now();
        }
        window.frameStepHolding = false;
        clearTimers();
        isHolding = false;
    }, { passive: false });

    el.addEventListener('touchcancel', (e) => {
        e.stopPropagation();
        window.frameStepHolding = false;
        clearTimers();
        isHolding = false;
    }, { passive: false });

    // Belt-and-braces: swallow any synthetic click too
    el.addEventListener('click', (e) => e.stopPropagation());
}

// ⚙️ Variant of attachFrameStepHoldHandlers used only by the left-half tap
// zones below. Adds double-tap detection on top of the same tap/hold
// behaviour: a single tap still steps one frame (after a short delay, in
// case a second tap follows), but a second tap within
// FRAME_STEP_ZONE_DOUBLE_TAP_MS cancels that pending step and toggles
// play/pause instead - since this zone now occupies the screen area that
// used to be a plain double-tap-to-play/pause region.
function attachFrameStepZoneHandlers(el, direction, tapState) {
    let holdTimeout = null;
    let holdInterval = null;
    let isHolding = false;
    let hasMoved = false;
    let startX = 0, startY = 0;

    el.addEventListener('touchstart', (e) => {
        // ✅ Don't stopPropagation/preventDefault here - we don't yet know
        // if this is a tap, a hold, or a drag. Blocking here unconditionally
        // was what prevented anywhere-scrubbing from ever seeing a drag
        // that started on this zone. Let the event bubble to the wrapper's
        // scrub handlers too; we'll only intercept once we're sure this is
        // a genuine tap or a genuine long-press hold.
        isHolding = false;
        hasMoved = false;
        const touch = e.touches[0];
        startX = touch.clientX;
        startY = touch.clientY;

        holdTimeout = setTimeout(() => {
            if (hasMoved) return; // turned into a drag - don't steal it for frame-stepping
            isHolding = true;
            window.frameStepHolding = true;

            // A hold cancels any pending single/double-tap decision
            clearTimeout(tapState.pendingTimeout);
            tapState.pendingTimeout = null;

            const now = Date.now();
            if (now - frameStepHoldSpeedState.lastReleaseTime <= FRAME_HOLD_SPEEDUP_WINDOW_MS) {
                frameStepHoldSpeedState.multiplier = Math.min(FRAME_HOLD_MAX_MULTIPLIER, frameStepHoldSpeedState.multiplier * 2);
            } else {
                frameStepHoldSpeedState.multiplier = 1;
            }
            stepFrame(direction, frameStepHoldSpeedState.multiplier);
            holdInterval = setInterval(() => stepFrame(direction, frameStepHoldSpeedState.multiplier), FRAME_HOLD_INTERVAL_MS);
        }, FRAME_HOLD_DELAY_MS);
    }, { passive: true });

    el.addEventListener('touchmove', (e) => {
        if (isHolding) {
            // Genuine long-press frame-stepping in progress - block scroll/scrub
            e.preventDefault();
            e.stopPropagation();
            return;
        }

        const touch = e.touches[0];
        const deltaX = Math.abs(touch.clientX - startX);
        const deltaY = Math.abs(touch.clientY - startY);

        if (!hasMoved && (deltaX > 10 || deltaY > 10)) {
            // ✅ This is a drag, not a tap/hold - cancel our pending timers
            // and let anywhere-scrubbing handle it as a normal scrub.
            hasMoved = true;
            clearTimeout(holdTimeout);
            holdTimeout = null;
            clearTimeout(tapState.pendingTimeout);
            tapState.pendingTimeout = null;
        }
        // Don't preventDefault/stopPropagation - let scrub take over
    }, { passive: true });

    el.addEventListener('touchend', (e) => {
        clearTimeout(holdTimeout);
        holdTimeout = null;

        if (isHolding) {
            e.stopPropagation();
            e.preventDefault();
            window.frameStepHolding = false;
            if (holdInterval) { clearInterval(holdInterval); holdInterval = null; }
            frameStepHoldSpeedState.lastReleaseTime = Date.now();
            isHolding = false;
            return;
        }

        if (hasMoved) {
            // ✅ Was a drag/scrub - don't intercept, let the wrapper's own
            // touchend (stopScrub) handle its cleanup normally
            hasMoved = false;
            return;
        }

        // Genuine stationary tap - handle frame-step / double-tap here
        e.stopPropagation();
        e.preventDefault();

        const now = Date.now();
        if (now - tapState.lastTapTime < FRAME_STEP_ZONE_DOUBLE_TAP_MS) {
            // ✅ Second tap within the window - cancel the pending
            // single-step from the first tap and toggle play/pause instead
            clearTimeout(tapState.pendingTimeout);
            tapState.pendingTimeout = null;
            tapState.lastTapTime = 0;
            if (window.plyrPlayer) {
                window.plyrPlayer.togglePlay();
                if (typeof showPlayerFeedback === 'function') {
                    showPlayerFeedback(window.plyrPlayer.paused ? '⏸ Paused' : '▶ Playing', 'top-left');
                }
            }
            return;
        }

        // Possible first tap of a double-tap - wait briefly before
        // committing to the single-step action
        tapState.lastTapTime = now;
        tapState.pendingTimeout = setTimeout(() => {
            stepFrame(direction);
            tapState.pendingTimeout = null;
        }, FRAME_STEP_ZONE_DOUBLE_TAP_MS);
    }, { passive: false });

    el.addEventListener('touchcancel', (e) => {
        clearTimeout(holdTimeout);
        holdTimeout = null;
        if (holdInterval) { clearInterval(holdInterval); holdInterval = null; }
        window.frameStepHolding = false;
        isHolding = false;
        hasMoved = false;
    }, { passive: false });

    el.addEventListener('click', (e) => e.stopPropagation());
}

function attachFrameStepButtons() {
    const isTouchDevice = ('ontouchstart' in window) ||
                          (navigator.maxTouchPoints > 0) ||
                          (navigator.msMaxTouchPoints > 0);
    const isDesktop = window.innerWidth >= 769 && window.innerHeight >= 600 && !isTouchDevice;
    if (isDesktop) return;

    const wrapper = document.querySelector('.plyr__video-wrapper');
    if (!wrapper) return;
    if (wrapper.querySelector('.plyr-frame-step-group')) return; // prevent duplicates

    // Simple tap-to-toggle play/pause. No hold behavior. Same
    // stopPropagation treatment as the frame-step buttons so it never
    // triggers the double-tap-to-seek/rotate gestures underneath.
    function setupPlayPauseButton(btn) {
        btn.addEventListener('touchstart', (e) => {
            e.stopPropagation();
            e.preventDefault();
        }, { passive: false });

        btn.addEventListener('touchend', (e) => {
            e.stopPropagation();
            e.preventDefault();
            if (!window.plyrPlayer) return;
            window.plyrPlayer.togglePlay();
            if (typeof showPlayerFeedback === 'function') {
                showPlayerFeedback(window.plyrPlayer.paused ? '⏸ Paused' : '▶ Playing', 'top-left');
            }
        }, { passive: false });

        btn.addEventListener('touchcancel', (e) => e.stopPropagation());
        btn.addEventListener('click', (e) => e.stopPropagation());
    }

    const group = document.createElement('div');
    group.className = 'plyr-frame-step-group';

    const playPauseBtn = document.createElement('button');
    playPauseBtn.className = 'plyr-frame-step plyr-frame-playpause';
    playPauseBtn.setAttribute('aria-label', 'Play/Pause');
    setupPlayPauseButton(playPauseBtn);

    const leftBtn = document.createElement('button');
    leftBtn.className = 'plyr-frame-step plyr-frame-step-left';
    leftBtn.setAttribute('aria-label', 'Previous frame');
    attachFrameStepHoldHandlers(leftBtn, -1);

    const rightBtn = document.createElement('button');
    rightBtn.className = 'plyr-frame-step plyr-frame-step-right';
    rightBtn.setAttribute('aria-label', 'Next frame');
    attachFrameStepHoldHandlers(rightBtn, 1);

    group.appendChild(playPauseBtn);
    group.appendChild(leftBtn);
    group.appendChild(rightBtn);
    wrapper.appendChild(group);

    console.log('Frame-step buttons attached');
}

// ⚙️ Single-tap zones over the LEFT half of the player (moved off the
// right half, which conflicted with the -3/+3/-10/+10/-30/+30 seek
// quadrants there). While player controls are visible: a single tap in
// the first quarter (0-25%) behaves like the previous-frame button (tap
// = single step, hold = continuous slow motion); the next quarter
// (25-50%) behaves like the next-frame button. A double-tap anywhere in
// either quarter toggles play/pause instead of stepping - this replaces
// the plain double-tap-to-play/pause gesture that used to live across
// the whole left half. While controls are hidden, taps here do nothing
// themselves - CSS gives the zones pointer-events:none in that state, so
// the tap falls through and just reveals the controls as normal, giving
// "one tap shows controls, another tap frame-steps".
function attachColumnFrameStepZones() {
    const isTouchDevice = ('ontouchstart' in window) ||
                          (navigator.maxTouchPoints > 0) ||
                          (navigator.msMaxTouchPoints > 0);
    const isDesktop = window.innerWidth >= 769 && window.innerHeight >= 600 && !isTouchDevice;
    if (isDesktop) return;

    const wrapper = document.querySelector('.plyr__video-wrapper');
    if (!wrapper) return;
    if (wrapper.querySelector('.frame-step-tap-zone-left')) return; // prevent duplicates

    // Shared across both quarters so a double-tap spanning either one
    // (or both) still counts as one double-tap for the play/pause toggle
    const tapState = { lastTapTime: 0, pendingTimeout: null };

    const leftZone = document.createElement('div');
    leftZone.className = 'frame-step-tap-zone frame-step-tap-zone-left';
    attachFrameStepZoneHandlers(leftZone, -1, tapState);

    const rightZone = document.createElement('div');
    rightZone.className = 'frame-step-tap-zone frame-step-tap-zone-right';
    attachFrameStepZoneHandlers(rightZone, 1, tapState);

    wrapper.appendChild(leftZone);
    wrapper.appendChild(rightZone);

    console.log('Column frame-step tap zones attached (left half)');
}

async function downloadCurrentVideoFromModal(video) {
    try {
        let vid = video;
        vid = await window.refreshVideoBeforeUse(vid);
        if (vid && vid.downloadUrl) {
            window.location.href = vid.downloadUrl;
        } else if (typeof window.showDownloadError === 'function') {
            window.showDownloadError("Missing or expired download URL", video);
        }
    } catch (err) {
        console.error("Download failed", err);
        if (typeof window.showDownloadError === 'function') {
            window.showDownloadError(err.message || 'Download failed', video);
        }
    }
}

function showPlayerBasketModal() {
    const existing = document.getElementById('playerBasketModal');
    if (existing) existing.remove();

    const basketVideosList = window.basketVideos || [];
    const isForcedLandscape = document.body.classList.contains('manual-rotate-landscape');

    // ✅ Prevent mobile WebKit text-autosizing from randomly enlarging text
    // when the list content changes/reflows inside the rotated fullscreen box.
    const NO_AUTOSIZE = '-webkit-text-size-adjust: 100%; text-size-adjust: 100%;';

    const overlay = document.createElement('div');
    overlay.id = 'playerBasketModal';
    overlay.style.cssText = `
        position: fixed;
        top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.75);
        z-index: 2147483647;
        display: flex;
        align-items: center;
        justify-content: center;
        ${NO_AUTOSIZE}
    `;

    const inner = document.createElement('div');
    inner.style.cssText = `
        background: #1a1a1a;
        color: #fff;
        border-radius: 8px;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        padding: 6px;
        box-sizing: border-box;
        ${NO_AUTOSIZE}
    `;

    if (isForcedLandscape) {
        const screenW = window.innerWidth;
        const screenH = window.innerHeight;
        // ⚙️ ADJUSTABLE SETTINGS - tweak these to resize/reposition the modal
        // within the rotated (forced landscape) player. Left 50%/top 50% with
        // translate(-50%,-50%) keeps it centered exactly within the player
        // (which fills almost the entire screen in this mode).
        // Final visual HEIGHT (stretches toward top of player) - higher = taller.
        const FORCED_LANDSCAPE_MODAL_HEIGHT_FACTOR = 0.98;
        // Final visual WIDTH - higher = wider.
        const FORCED_LANDSCAPE_MODAL_WIDTH_FACTOR = 0.9;
        // 50 = perfectly centered. Lower = shifted left, higher = shifted right.
        const FORCED_LANDSCAPE_MODAL_LEFT_PERCENT = 50;
        // ⚙️ Extra push to shift the modal further left from the FLS
        // (rotated) point of view - since the modal is rotated 90deg, a
        // local vertical offset becomes a horizontal on-screen shift, and
        // SUBTRACTING here is what actually shifts it left on screen.
        // Increase this value to shift further left.
        const FORCED_LANDSCAPE_MODAL_LEFT_SHIFT_PX = 60;
        inner.style.position = 'fixed';
        // ✅ The rotated player's on-screen center is shifted by
        // manualRotationOffsetY (a pre-rotation vertical offset, which
        // becomes a horizontal shift once rotated 90deg). Match that same
        // offset here so the modal lines up with wherever the player
        // actually sits, instead of plain viewport center, then subtract
        // the extra left-shift constant on top.
        inner.style.top = `calc(50% + ${manualRotationOffsetY - FORCED_LANDSCAPE_MODAL_LEFT_SHIFT_PX}px)`;
        inner.style.left = FORCED_LANDSCAPE_MODAL_LEFT_PERCENT + '%';
        inner.style.width = Math.round(screenH * FORCED_LANDSCAPE_MODAL_HEIGHT_FACTOR) + 'px';
        inner.style.height = Math.round(screenW * FORCED_LANDSCAPE_MODAL_WIDTH_FACTOR) + 'px';
        inner.style.transform = 'translate(-50%, -50%) rotate(90deg)';
        inner.style.maxWidth = '98vw';
        inner.style.maxHeight = '98vh';
    } else {
        inner.style.width = '80vw';
        inner.style.maxWidth = '500px';
        inner.style.maxHeight = '80vh';
    }

    const title = document.createElement('h3');
    title.style.cssText = `margin: 0 0 10px 0; font-size: 0.9rem; flex-shrink: 0; ${NO_AUTOSIZE}`;
    inner.appendChild(title);

    const currentVideo = window.currentPlayingVideo;

    // ✅ Toolbar: score / download current video, and switch which list
    // is shown below (main filtered list / 10 random / basket).
    const actionRow = document.createElement('div');
    actionRow.style.cssText = `display: flex; gap: 6px; margin-bottom: 4px; flex-shrink: 0; ${NO_AUTOSIZE}`;

    const scoreBtn = document.createElement('button');
    scoreBtn.textContent = '★';
    scoreBtn.title = 'Score current video';
    scoreBtn.disabled = !currentVideo;
    scoreBtn.style.cssText = `flex: 1; padding: 5px 8px; background: #ffc107; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.75rem; ${NO_AUTOSIZE}`;
    scoreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!currentVideo) return;
        if (typeof window.showVideoScoringModal === 'function') {
            window.showVideoScoringModal(currentVideo, e);
        }
    });
    actionRow.appendChild(scoreBtn);

    const downloadBtn = document.createElement('button');
    downloadBtn.textContent = 'D';
    downloadBtn.title = 'Download current video';
    downloadBtn.disabled = !currentVideo;
    downloadBtn.style.cssText = `flex: 1; padding: 5px 8px; background: #17a2b8; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.75rem; ${NO_AUTOSIZE}`;
    downloadBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!currentVideo) return;
        downloadCurrentVideoFromModal(currentVideo);
    });
    actionRow.appendChild(downloadBtn);

    const addToBasketBtn = document.createElement('button');
    addToBasketBtn.textContent = '+B';
    addToBasketBtn.title = 'Add current video to basket';
    addToBasketBtn.disabled = !currentVideo;
    addToBasketBtn.style.cssText = `flex: 1; padding: 5px 8px; background: #28a745; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.75rem; ${NO_AUTOSIZE}`;
    addToBasketBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!currentVideo) return;
        if (typeof window.addToBasket === 'function') {
            window.addToBasket(currentVideo);
        }
        const originalText = addToBasketBtn.textContent;
        addToBasketBtn.textContent = '✅';
        setTimeout(() => { addToBasketBtn.textContent = originalText; }, 1000);
        // Refresh the list view if basket is currently being shown
        if (currentMode === 'basket') {
            renderList();
        }
    });
    actionRow.appendChild(addToBasketBtn);

    const historyBtn = document.createElement('button');
    historyBtn.textContent = 'H';
    historyBtn.title = 'Show history - same as corner H button';
    historyBtn.style.cssText = `flex: 1; padding: 5px 8px; background: #6c757d; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.75rem; ${NO_AUTOSIZE}`;
    historyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        currentMode = 'history';
        renderList();
    });
    actionRow.appendChild(historyBtn);

    const listBtn = document.createElement('button');
    listBtn.textContent = 'L';
    listBtn.title = 'Show main list (filtered) - same as corner L button';
    listBtn.style.cssText = `flex: 1; padding: 5px 8px; background: #6c757d; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.75rem; ${NO_AUTOSIZE}`;
    listBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        listBtn.disabled = true;
        listBtn.textContent = '...';
        try {
            if (typeof window.listAllVideos === 'function') {
                await window.listAllVideos();
            }
        } catch (err) {
            console.error('Failed to run listAllVideos from player basket modal:', err);
        }
        listBtn.disabled = false;
        listBtn.textContent = 'L';
        currentMode = 'main';
        renderList();
    });
    actionRow.appendChild(listBtn);

    const randomBtn = document.createElement('button');
    randomBtn.textContent = 'R';
    randomBtn.title = 'Show random videos - same as corner R button';
    randomBtn.style.cssText = `flex: 1; padding: 5px 8px; background: #6c757d; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.75rem; ${NO_AUTOSIZE}`;
    randomBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        randomBtn.disabled = true;
        randomBtn.textContent = '...';
        try {
            if (typeof window.generateRandomPlaylistByTags === 'function') {
                await window.generateRandomPlaylistByTags();
            }
        } catch (err) {
            console.error('Failed to run generateRandomPlaylistByTags from player basket modal:', err);
        }
        randomBtn.disabled = false;
        randomBtn.textContent = 'R';
        currentMode = 'random';
        renderList();
    });
    actionRow.appendChild(randomBtn);

    const basketBtn = document.createElement('button');
    basketBtn.textContent = 'B';
    basketBtn.title = 'Show basket';
    basketBtn.style.cssText = `flex: 1; padding: 5px 8px; background: #e91e63; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.7rem; ${NO_AUTOSIZE}`;
    basketBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        currentMode = 'basket';
        renderList();
    });
    actionRow.appendChild(basketBtn);

    inner.appendChild(actionRow);

    const listContainer = document.createElement('div');
    listContainer.style.cssText = `flex: 1 1 auto; min-height: 0; overflow-y: auto; ${NO_AUTOSIZE}`;
    inner.appendChild(listContainer);

    let currentMode = 'basket';

    // ✅ Pull directly from the same data the corner L/R buttons populate,
    // instead of re-sampling locally - guarantees identical results.
    function getListForMode(mode) {
        if (mode === 'main') {
            return (window.paginationState && window.paginationState.allVideos) || [];
        }
        if (mode === 'random') {
            return window.filteredVideosGlobal || [];
        }
        if (mode === 'history') {
            return window.historyVideos || [];
        }
        return window.basketVideos || [];
    }

    function renderList() {
        const videos = getListForMode(currentMode);
        const modeLabel = currentMode === 'main' ? 'Main List' : currentMode === 'random' ? 'Random' : currentMode === 'history' ? 'History' : 'Basket';
        title.textContent = `${modeLabel} (${videos.length})`;

        listContainer.innerHTML = '';

        if (videos.length === 0) {
            const empty = document.createElement('div');
            empty.textContent = `${modeLabel} is empty`;
            empty.style.cssText = `color: #999; text-align: center; padding: 20px; font-size: 0.75rem; ${NO_AUTOSIZE}`;
            listContainer.appendChild(empty);
            return;
        }

        const list = document.createElement('ul');
        list.style.cssText = `list-style: none; margin: 0; padding: 0; ${NO_AUTOSIZE}`;

        videos.forEach((video, idx) => {
            const item = document.createElement('li');
            item.textContent = `${idx + 1}. ${video.filename || 'Unknown'}`;
            item.style.cssText = `
                padding: 8px 6px;
                border-bottom: 1px solid #333;
                cursor: pointer;
                font-size: 0.7rem;
                word-break: break-word;
                ${NO_AUTOSIZE}
            `;
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                overlay.remove();
                if (window.inlineVideoPlayer) {
                    window.inlineVideoPlayer.play(video, currentMode, idx);
                }
            });
            list.appendChild(item);
        });

        listContainer.appendChild(list);
    }

    renderList();

    overlay.appendChild(inner);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            overlay.remove();
        }
    });

    document.body.appendChild(overlay);
}

window.showPlayerBasketModal = showPlayerBasketModal;

function showPlayerBookmarkModal() {
    const existing = document.getElementById('playerBookmarkModal');
    if (existing) existing.remove();

    const video = window.currentPlayingVideo;
    if (!video || !window.plyrPlayer) return;

    // Pause playback while adding the bookmark
    if (!window.plyrPlayer.paused) {
        window.plyrPlayer.pause();
    }

    video.bookmarks = video.bookmarks || [];
    const currentTime = window.plyrPlayer.currentTime;
    const isForcedLandscape = document.body.classList.contains('manual-rotate-landscape');

    const overlay = document.createElement('div');
    overlay.id = 'playerBookmarkModal';
    overlay.style.cssText = `
        position: fixed;
        top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.75);
        z-index: 2147483647;
        display: flex;
        align-items: center;
        justify-content: center;
    `;

    const inner = document.createElement('div');
    inner.style.cssText = `
        background: #1a1a1a;
        color: #fff;
        border-radius: 8px;
        overflow-y: auto;
        padding: 14px;
        box-sizing: border-box;
    `;

// ⚙️ ADJUSTABLE: how far DOWN, on the physical (portrait-held) screen,
    // the rotated bookmark modal shifts, so the on-screen keyboard doesn't
    // cover the note field while typing. This is a real-screen Y offset -
    // applied BEFORE the box's own rotate(90deg), which only spins the
    // box's appearance around its own center and never changes where that
    // center sits on the physical screen. Increase to shift further down.
    // If you hit a ceiling (modal starts clipping off-screen), shrink
    // FORCED_LANDSCAPE_MODAL_HEIGHT_FACTOR below instead of raising this
    // further.
const FORCED_LANDSCAPE_MODAL_DOWN_SHIFT_PX = 60;
    // ⚙️ ADJUSTABLE: extra physical-down shift (added on top of the
    // keyboard-avoidance shift above) used only to nudge the modal
    // slightly right as seen in the rotated/landscape view - a physical
    // downward shift reads as "shifted right" once the 90° rotation is
    // mentally accounted for. Increase to shift further right-in-landscape.
    const FORCED_LANDSCAPE_MODAL_RIGHT_SHIFT_PX = 20;
    // Skinny axis: pre-rotation WIDTH becomes the visual top-to-bottom
    // extent on the physical portrait screen. Smaller = skinnier modal.
    const FORCED_LANDSCAPE_MODAL_HEIGHT_FACTOR = 0.24;
    // Stacking axis: pre-rotation HEIGHT becomes the visual left-to-right
    // extent on the physical portrait screen. Bigger = more room to stack
    // rows of content (textarea, notes grid, buttons).
    const FORCED_LANDSCAPE_MODAL_WIDTH_FACTOR = 0.92;
    // ⚙️ ADJUSTABLE: extra pixels added to the modal's visual width
    // (landscape view) on top of WIDTH_FACTOR above. Because the pre-
    // rotation bottom edge maps to the visual right edge, growing this
    // extends the modal only to the right - the visual left edge (and
    // the modal's current on-screen position) stays put, compensated via
    // FORCED_LANDSCAPE_MODAL_WIDTH_EXTEND_SHIFT_PX below.
    const FORCED_LANDSCAPE_MODAL_EXTRA_WIDTH_PX = 160;
    // ⚙️ Safety margin (px) kept clear of the phone's actual physical
    // width when the modal is stretched wider - since the box is rotated
    // 90°, its CSS height becomes its on-screen left-right span in raw
    // (un-rotated) portrait terms, and that can never safely exceed the
    // phone's real screen width or it gets clipped by the screen edges
    // (this is the "cut off at top/bottom in landscape" symptom). Shrink
    // this if the modal still feels slightly clipped.
    const FORCED_LANDSCAPE_MODAL_WIDTH_SAFETY_MARGIN_PX = 16;

    if (isForcedLandscape) {
        const screenW = window.innerWidth;
        const screenH = window.innerHeight;
        inner.style.position = 'fixed';
        inner.style.top = '50%';
        inner.style.left = '50%';
        inner.style.width = Math.round(screenH * FORCED_LANDSCAPE_MODAL_HEIGHT_FACTOR) + 'px';
        // Clamp the desired width so it never exceeds the phone's actual
        // physical width (screenW) - exceeding it is what was causing the
        // rotated modal to get clipped ("cut off top/bottom in landscape").
        const baseModalWidthPx = Math.round(screenW * FORCED_LANDSCAPE_MODAL_WIDTH_FACTOR);
        const desiredModalWidthPx = baseModalWidthPx + FORCED_LANDSCAPE_MODAL_EXTRA_WIDTH_PX;
        const maxModalWidthPx = screenW - FORCED_LANDSCAPE_MODAL_WIDTH_SAFETY_MARGIN_PX;
        const modalWidthPx = Math.min(desiredModalWidthPx, maxModalWidthPx);
        const actualExtraWidthPx = modalWidthPx - baseModalWidthPx;
        const widthExtendShiftPx = actualExtraWidthPx / 2;
        inner.style.height = modalWidthPx + 'px';
        inner.style.transform = `translate(-50%, calc(-50% + ${FORCED_LANDSCAPE_MODAL_DOWN_SHIFT_PX + FORCED_LANDSCAPE_MODAL_RIGHT_SHIFT_PX + widthExtendShiftPx}px)) rotate(90deg)`;
        inner.style.padding = '8px';
        // Only the notes grid should scroll - the modal box itself
        // inherits overflow-y:auto from the base style set above, which
        // was letting the whole thing scroll instead of just the grid.
        inner.style.overflowY = 'hidden';
        inner.style.overflowX = 'hidden';
        inner.style.display = 'flex';
        inner.style.flexDirection = 'column';
        inner.style.boxSizing = 'border-box';
    } else {
        inner.style.width = '80vw';
        inner.style.maxWidth = '400px';
    }

    const title = document.createElement('h3');
    title.textContent = 'Add Bookmark';
    title.style.cssText = isForcedLandscape
        ? 'margin: 0 0 6px 0; font-size: 0.8rem;'
        : 'margin: 0 0 10px 0; font-size: 1rem;';
    inner.appendChild(title);

    const timeDisplay = document.createElement('div');
    timeDisplay.textContent = `Time: ${formatDuration(currentTime * 1000)}`;
    timeDisplay.style.cssText = isForcedLandscape
        ? 'font-family: monospace; font-size: 0.75rem; margin-bottom: 6px;'
        : 'font-family: monospace; font-size: 0.9rem; margin-bottom: 10px;';
    inner.appendChild(timeDisplay);

    const noteInput = isForcedLandscape ? document.createElement('textarea') : document.createElement('input');
    if (!isForcedLandscape) {
        noteInput.type = 'text';
    } else {
        noteInput.rows = 2;
    }
    noteInput.placeholder = 'Add a note (optional)...';
    noteInput.style.cssText = isForcedLandscape ? `
        width: 100%;
        box-sizing: border-box;
        padding: 4px 6px;
        border-radius: 4px;
        border: 1px solid #555;
        background: #2a2a2a;
        color: #fff;
        font-size: 0.7rem;
        margin-bottom: 6px;
        resize: none;
        font-family: inherit;
    ` : `
        width: 100%;
        box-sizing: border-box;
        padding: 8px;
        border-radius: 4px;
        border: 1px solid #555;
        background: #2a2a2a;
        color: #fff;
        font-size: 0.85rem;
        margin-bottom: 12px;
    `;
    if (isForcedLandscape) {
        inner.appendChild(noteInput);
    } else {
        // Wrap in a form so any mobile keyboard's Enter/Go/Done action
        // reliably triggers save - browsers fire a 'submit' event for
        // Enter inside a single text input regardless of keyboard quirks,
        // which a bare keydown listener can't guarantee.
        const noteForm = document.createElement('form');
        noteForm.style.cssText = 'margin: 0;';
        noteForm.appendChild(noteInput);
        noteForm.addEventListener('submit', (e) => {
            e.preventDefault();
            saveBtn.click();
        });
        inner.appendChild(noteForm);
    }

    const quickNotesContainer = document.createElement('div');
    quickNotesContainer.id = 'quickNotesContainer';
    quickNotesContainer.style.cssText = isForcedLandscape
        ? 'display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; overflow-y: auto; flex: 1; min-width: 0; min-height: 0; align-content: start;'
        : 'display: grid; grid-template-columns: repeat(6, 1fr); gap: 5px; margin-bottom: 10px; max-height: 160px; overflow-y: auto;';

    // FLS: notes grid sits beside a static (non-scrolling) vertical column
    // of action buttons, instead of those buttons stacking full-width
    // below the grid. Portrait is untouched (quickNotesContainer appended
    // directly, same as before).
    const notesAndActionsRow = isForcedLandscape ? document.createElement('div') : null;
    if (notesAndActionsRow) {
        // flex:1 + min-height:0 makes this row expand to fill whatever
        // vertical space is left in the modal after the title/time/note
        // input above it, instead of shrinking to fit its content - that
        // leftover space is what was sitting empty before.
        notesAndActionsRow.style.cssText = 'display: flex; gap: 5px; align-items: stretch; flex: 1; min-height: 0; min-width: 0; overflow: hidden;';
        notesAndActionsRow.appendChild(quickNotesContainer);
        inner.appendChild(notesAndActionsRow);
    } else {
        inner.appendChild(quickNotesContainer);
    }

    // ⚙️ ADJUSTABLE: width of the static actions column (Space/Clear/Save/
    // Close) sitting to the right of the notes grid in FLS. Widen if the
    // button labels feel cramped.
    const actionsColumn = isForcedLandscape ? document.createElement('div') : null;
    if (actionsColumn) {
        actionsColumn.style.cssText = 'display: flex; flex-direction: column; gap: 6px; flex: 0 0 54px; width: 54px; min-height: 0; overflow: hidden;';
        notesAndActionsRow.appendChild(actionsColumn);
    }

    const spaceClearRow = document.createElement('div');
    spaceClearRow.style.cssText = isForcedLandscape
        ? 'display: flex; flex-direction: column; gap: 6px; flex: 1;'
        : 'display: flex; gap: 8px; margin-bottom: 10px;';

    const spaceBtn = document.createElement('button');
    spaceBtn.textContent = 'Space';
    spaceBtn.style.cssText = isForcedLandscape ? `
        flex: 1;
        padding: 14px 4px;
        background: #6c757d;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 0.8rem;
    ` : `
        flex: 1;
        padding: 6px;
        background: #6c757d;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 0.75rem;
    `;
    spaceBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const start = noteInput.selectionStart ?? noteInput.value.length;
        const end = noteInput.selectionEnd ?? noteInput.value.length;
        const before = noteInput.value.substring(0, start);
        const after = noteInput.value.substring(end);
        noteInput.value = before + ' ' + after;
        const newPos = start + 1;
        noteInput.focus();
        noteInput.setSelectionRange(newPos, newPos);
    });
    spaceClearRow.appendChild(spaceBtn);

    const clearBtn = document.createElement('button');
    clearBtn.textContent = 'Clear';
    clearBtn.style.cssText = isForcedLandscape ? `
        flex: 1;
        padding: 14px 4px;
        background: #6c757d;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 0.8rem;
    ` : `
        flex: 1;
        padding: 6px;
        background: #6c757d;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 0.75rem;
    `;
    clearBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        noteInput.value = '';
        noteInput.focus();
    });
    spaceClearRow.appendChild(clearBtn);

    if (isForcedLandscape) {
        actionsColumn.appendChild(spaceClearRow);
    } else {
        inner.appendChild(spaceClearRow);
    }

    const btnRow = document.createElement('div');
    btnRow.style.cssText = isForcedLandscape
        ? 'display: flex; flex-direction: column; gap: 6px; flex: 1;'
        : 'display: flex; gap: 8px;';

    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save';
    saveBtn.style.cssText = isForcedLandscape ? `
        flex: 1;
        padding: 14px 4px;
        background: #28a745;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 0.85rem;
    ` : `
        flex: 1;
        padding: 8px;
        background: #28a745;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 0.85rem;
    `;
    saveBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        video.bookmarks.push({ time: currentTime, note: noteInput.value.trim() });
        overlay.remove();

        const useRotatedConfirmation = document.body.classList.contains('manual-rotate-landscape');

        let bookmarkTooltip = null;
        if (useRotatedConfirmation) {
            bookmarkTooltip = showRotatedPlayerConfirmation('Saving bookmarks...', '#6c757d', true);
        } else if (typeof window.showBookmarkConfirmation === 'function') {
            bookmarkTooltip = window.showBookmarkConfirmation('Saving bookmarks...', '#6c757d', true);
        }

        if (typeof window.saveBookmarks === 'function') {
            try {
                await window.saveBookmarks(video, bookmarkTooltip);
            } catch (err) {
                console.error('Failed to save bookmark:', err);
                if (bookmarkTooltip) {
                    if (useRotatedConfirmation) {
                        updateRotatedPlayerConfirmation(bookmarkTooltip, '❌ Save failed', '#dc3545');
                        closeRotatedPlayerConfirmation(bookmarkTooltip);
                    } else if (typeof window.updateBookmarkConfirmation === 'function') {
                        window.updateBookmarkConfirmation(bookmarkTooltip, '❌ Save failed', '#dc3545');
                        window.closeBookmarkConfirmation(bookmarkTooltip);
                    }
                }
            }
        }

        if (typeof window.renderBookmarkMarkers === 'function') {
            window.renderBookmarkMarkers();
        }
    });

    // FLS: Enter on the on-screen keyboard triggers Save (a textarea
    // normally just inserts a newline on Enter, so intercept and redirect).
    // Portrait's plain <input> is handled separately below via a <form>
    // submit, since a bare keydown listener is unreliable across mobile
    // virtual keyboards (Gboard/iOS predictive text often don't fire a
    // proper key === 'Enter' keydown for inputs outside a form).
    if (isForcedLandscape) {
        noteInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                saveBtn.click();
            }
        });
    }

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Close';
    cancelBtn.style.cssText = isForcedLandscape ? `
        flex: 1;
        padding: 14px 4px;
        background: #6c757d;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 0.85rem;
    ` : `
        flex: 1;
        padding: 8px;
        background: #6c757d;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 0.85rem;
    `;
    cancelBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        overlay.remove();
    });

    btnRow.appendChild(saveBtn);
    btnRow.appendChild(cancelBtn);
    if (isForcedLandscape) {
        actionsColumn.appendChild(btnRow);
    } else {
        inner.appendChild(btnRow);
    }

    overlay.appendChild(inner);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            overlay.remove();
        }
    });

    document.body.appendChild(overlay);
    setTimeout(() => noteInput.focus(), 50);

    // ✅Load top bookmark notes as quick-add pills (async, non-blocking)
    if (typeof window.getTopBookmarkNotes === 'function') {
        const loadingLabel = document.createElement('div');
        loadingLabel.textContent = 'Loading...';
        loadingLabel.style.cssText = isForcedLandscape ? `
            grid-column: 1 / -1;
            font-size: 0.6rem;
            color: #999;
            text-align: center;
            padding: 4px;
        ` : `
            grid-column: 1 / -1;
            font-size: 0.75rem;
            color: #999;
            text-align: center;
            padding: 6px;
        `;
        quickNotesContainer.appendChild(loadingLabel);

        window.getTopBookmarkNotes(30).then(topNotes => {
            if (!overlay.isConnected) return;
            loadingLabel.remove();
            if (!topNotes.length) return;
            topNotes.forEach(note => {
                const pill = document.createElement('button');
                pill.textContent = note;
                pill.title = note;
                pill.style.cssText = isForcedLandscape ? `
                    padding: 4px 6px;
                    min-height: 34px;
                    background: #6c757d;
                    color: white;
                    border: none;
                    border-radius: 5px;
                    cursor: pointer;
                    font-size: 0.58rem;
                    line-height: 1.15;
                    white-space: normal;
                    word-break: break-word;
                    overflow: hidden;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    text-align: center;
                    min-width: 0;
                    width: 100%;
                    box-sizing: border-box;
                ` : `
                    padding: 3px 4px;
                    background: #6c757d;
                    color: white;
                    border: none;
                    border-radius: 6px;
                    cursor: pointer;
                    font-size: 0.6rem;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    min-width: 0;
                    width: 100%;
                `;
                pill.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const start = noteInput.selectionStart ?? noteInput.value.length;
                    const end = noteInput.selectionEnd ?? noteInput.value.length;
                    const before = noteInput.value.substring(0, start);
                    const after = noteInput.value.substring(end);
                    noteInput.value = before + note + after;
                    const newPos = start + note.length;
                    noteInput.focus();
                    noteInput.setSelectionRange(newPos, newPos);
                });
                quickNotesContainer.appendChild(pill);
            });
        }).catch(err => {
            console.warn('Could not load top bookmark notes:', err);
        });
    }
}

window.showPlayerBookmarkModal = showPlayerBookmarkModal;

/**
* Rotated confirmation tooltip shown on top of the video, matching the
* forced-landscape orientation. Mirrors showBookmarkConfirmation's API
* (message, bgColor, persist) so it can be updated/closed the same way.
*/
function showRotatedPlayerConfirmation(message, bgColor = '#28a745', persist = false) {
    //  Append into the same rotated fullscreen container the UK clock
    // lives in, so it rotates identically and naturally lines up at the
    // clock's height - no manual rotation math needed here.
    const container = typeof getManualRotationFullscreenElement === 'function'
        ? getManualRotationFullscreenElement()
        : null;
    const parent = container || document.body;

    const tooltip = document.createElement('div');
    tooltip.className = 'rotated-player-confirmation-tooltip';
    tooltip.innerHTML = message;
    tooltip.style.background = bgColor;
    tooltip.style.position = 'absolute';
    tooltip.style.top = '12px'; // ⚙️ matches clock's top offset
    tooltip.style.left = '50%';
    tooltip.style.transform = 'translateX(-50%)';
    tooltip.style.zIndex = '99999';
    tooltip.style.color = '#fff';
    tooltip.style.padding = '3px 8px';
    tooltip.style.borderRadius = '4px';
    tooltip.style.fontSize = '0.55rem';
    tooltip.style.fontWeight = 'bold';
    tooltip.style.pointerEvents = 'none';
    tooltip.style.whiteSpace = 'nowrap';
    tooltip.style.opacity = '0';
    tooltip.style.transition = 'opacity 0.3s ease';

    parent.appendChild(tooltip);
    setTimeout(() => { tooltip.style.opacity = '0.85'; }, 10);

    if (!persist) {
        setTimeout(() => {
            tooltip.style.opacity = '0';
            setTimeout(() => tooltip.remove(), 300);
        }, 1300);
    }

    return tooltip;
}

function updateRotatedPlayerConfirmation(tooltip, message, bgColor) {
    if (!tooltip) return;
    tooltip.innerHTML = message;
    tooltip.style.background = bgColor;
}

function closeRotatedPlayerConfirmation(tooltip, delay = 1300) {
    if (!tooltip) return;
    setTimeout(() => {
        tooltip.style.opacity = '0';
        setTimeout(() => tooltip.remove(), 300);
    }, delay);
}

function updateRotatedPlayerConfirmationOpacity(tooltip) {
    if (!tooltip) return;
    tooltip.style.opacity = '0.85';
}

function attachBookmarkQuickButton() {
    const controls = document.querySelector('.plyr__controls');
    if (!controls) return;
    if (controls.querySelector('.plyr-bookmark-quick')) return; // prevent duplicates

    const isTouchDevice = ('ontouchstart' in window) ||
                          (navigator.maxTouchPoints > 0) ||
                          (navigator.msMaxTouchPoints > 0);
    const isDesktop = window.innerWidth >= 769 && window.innerHeight >= 600 && !isTouchDevice;
    if (isDesktop) return;

    const btn = document.createElement("button");
    btn.className = "plyr__control plyr-bookmark-quick";
    btn.textContent = 'BM';
    btn.title = 'Add bookmark at current time';
    btn.onclick = (e) => {
        showPlayerBookmarkModal();
        e.currentTarget.blur();
    };

    const fullscreenBtn = controls.querySelector('[data-plyr="fullscreen"]');
    if (fullscreenBtn) {
        controls.insertBefore(btn, fullscreenBtn);
    } else {
        controls.appendChild(btn);
    }

    console.log(' Bookmark quick-add button attached');
}

function attachBasketQuickButton() {
    const controls = document.querySelector('.plyr__controls');
    if (!controls) return;
    if (controls.querySelector('.plyr-basket-quick')) return; // prevent duplicates

    const isTouchDevice = ('ontouchstart' in window) ||
                          (navigator.maxTouchPoints > 0) ||
                          (navigator.msMaxTouchPoints > 0);
    const isDesktop = window.innerWidth >= 769 && window.innerHeight >= 600 && !isTouchDevice;
    if (isDesktop) return;

    const btn = document.createElement("button");
    btn.className = "plyr__control plyr-basket-quick";
    btn.textContent = 'B';
    btn.title = 'View basket';
    btn.onclick = (e) => {
        showPlayerBasketModal();
        e.currentTarget.blur();
    };

    const fullscreenBtn = controls.querySelector('[data-plyr="fullscreen"]');
    if (fullscreenBtn) {
        controls.insertBefore(btn, fullscreenBtn);
    } else {
        controls.appendChild(btn);
    }

    console.log('Basket quick-view button attached');
}

function activateManualRotation() {
manualRotationActive = true;
console.log('[rotate] manualRotationActive now =', manualRotationActive);

// Small delay lets any in-progress fullscreen transition settle first
setTimeout(() => {
    // Re-applies using manualRotationOffsetY, which is our own saved
    // value - this restores the exact same position every time.
    applyManualRotationStyles();
    updateScrollLockButtonDisplay();
}, 50);
window.addEventListener('resize', manualRotationResizeHandler);

document.body.classList.add('manual-rotate-landscape');
showPlayerFeedback('↻ Landscape view', 'top-left');

const rotateBtn = document.querySelector('.plyr-manual-rotate');
if (rotateBtn) rotateBtn.classList.add('active');
}

function triggerIOSNativeFullscreen() {
// Get the actual video element from Plyr instance
const videoElement = window.plyrPlayer?.media;

if (!videoElement) {
   console.warn('Video element not found - ignoring tap');
   return; // Silent ignore - no alert
}

// Check if video is loaded and ready - SILENT ignore if not
if (!videoElement.duration || videoElement.readyState < 2) {
   console.log('Video not ready - ignoring iOS fullscreen tap (silent)');
   return; // Silent ignore - no alerts, no event listeners
}

console.log('Attempting iOS native fullscreen...');
console.log('Video ready state:', videoElement.readyState);
console.log('Has webkitEnterFullscreen:', !!videoElement.webkitEnterFullscreen);

// iOS Safari supports webkitEnterFullscreen
if (typeof videoElement.webkitEnterFullscreen === 'function') {
    try {
        videoElement.webkitEnterFullscreen();
        console.log('✅ Entered iOS native fullscreen');
    } catch (err) {
        console.error('Failed to enter iOS native fullscreen:', err);
        alert(`Native fullscreen failed: ${err.message || 'Unknown error'}\n\nTry playing the video first.`);
    }
} 
// Android and modern browsers support requestFullscreen
else if (typeof videoElement.requestFullscreen === 'function') {
    videoElement.requestFullscreen().catch(err => {
        console.error('Failed to enter fullscreen:', err);
        alert(`Fullscreen failed: ${err.message || 'Unknown error'}`);
    });
}
// Fallback for older WebKit browsers
else if (typeof videoElement.webkitRequestFullscreen === 'function') {
    videoElement.webkitRequestFullscreen();
}
// Fallback for older Mozilla browsers
else if (typeof videoElement.mozRequestFullScreen === 'function') {
    videoElement.mozRequestFullScreen();
}
// Fallback for older IE/Edge
else if (typeof videoElement.msRequestFullscreen === 'function') {
    videoElement.msRequestFullscreen();
}
else {
    console.warn('No fullscreen API available');
    alert('Fullscreen not supported on this device');
}
}

// ========================
// PIP (Picture-in-Picture) control
// ========================
function attachPIPButton() {
const controls = document.querySelector('.plyr__controls');
if (!controls) return;
if (controls.querySelector('.plyr-pip')) return; // prevent duplicates

// Only add on desktop
if (window.innerWidth < 769) return;

const pipBtn = document.createElement("button");
pipBtn.className = "plyr__control plyr-pip";
pipBtn.innerHTML = '&#9974;'; // ⚎ symbol (box in box)
pipBtn.title = 'Picture-in-Picture mode';
pipBtn.onclick = (e) => {
   togglePIPMode();
   e.currentTarget.blur();
};

// Insert PIP button after fullscreen button
const fullscreenBtn = controls.querySelector('[data-plyr="fullscreen"]');
if (fullscreenBtn && fullscreenBtn.nextSibling) {
   controls.insertBefore(pipBtn, fullscreenBtn.nextSibling);
} else if (fullscreenBtn) {
   controls.appendChild(pipBtn);
} else {
   controls.appendChild(pipBtn);
}

console.log('✅ PIP button attached');
}

// Global PIP state
let pipMode = false;
let pipPlayer = null;
let mainContainer = null;

function togglePIPMode() {
if (window.innerWidth < 769) {
   console.warn('PIP not available on mobile');
   return;
}

// ✅ Don't allow PIP from mini-player or fullscreen
const container = document.getElementById('inlineVideoContainer');
if (container?.classList.contains('mini-player')) {
   alert('Exit mini-player mode first');
   return;
}

if (window.plyrPlayer?.fullscreen?.active) {
   alert('Exit fullscreen first');
   return;
}

if (!pipMode) {
   enterPIPMode();
} else {
   exitPIPMode();
}
}

function enterPIPMode() {
console.log('Entering PIP mode');

// Get main container reference
mainContainer = document.getElementById('inlineVideoContainer');
if (!mainContainer) {
 console.error('Main video container not found');
 return;
}

// Store current playback state BEFORE any changes
const currentTime = window.plyrPlayer.currentTime;
const isPaused = window.plyrPlayer.paused;
const currentVolume = window.plyrPlayer.volume;
const currentMuted = window.plyrPlayer.muted;
const currentSource = window.plyrPlayer.source;

console.log('Stored state:', { currentTime, isPaused, currentVolume, currentMuted, hasSource: !!currentSource });

// Create PIP container if it doesn't exist
let pipContainer = document.getElementById('pipPlayerContainer');
if (!pipContainer) {
 pipContainer = document.createElement('div');
 pipContainer.id = 'pipPlayerContainer';
 
 // Create header with title and close button
 const header = document.createElement('div');
 header.className = 'pip-header';
 
 const title = document.createElement('div');
 title.className = 'pip-title';
 title.textContent = window.currentLoadingFilename || 'Video Player';
 
 const closeBtn = document.createElement('button');
 closeBtn.className = 'pip-close';
 closeBtn.innerHTML = '×';
 closeBtn.title = 'Exit PIP mode';
 closeBtn.onclick = (e) => {
     e.stopPropagation();
     exitPIPMode();
 };
 
 header.appendChild(title);
 header.appendChild(closeBtn);
 pipContainer.appendChild(header);

 // Create resize handle
  const resizeHandle = document.createElement('div');
  resizeHandle.className = 'pip-resize-handle';
  resizeHandle.title = 'Drag to resize';
  pipContainer.appendChild(resizeHandle);
 
 document.body.appendChild(pipContainer);
 
 // Make draggable
  makePIPDraggable(pipContainer, header);
  
  // ✅ Make resizable
  makePIPResizable(pipContainer);
  
  // ✅ Position at bottom-LEFT by default
  pipContainer.style.left = '20px';
  pipContainer.style.bottom = '20px';
  pipContainer.style.right = 'auto';
  pipContainer.style.top = 'auto';
}

// ✅ Move the entire Plyr container (not just video element)
const plyrContainer = mainContainer.querySelector('.plyr');
if (plyrContainer) {
 pipContainer.appendChild(plyrContainer);
 console.log('Moved Plyr container to PIP');
}

// ✅ We don't need to destroy/recreate - Plyr instance still works
// Just need to restore playback state
setTimeout(() => {
 if (!isPaused) {
     window.plyrPlayer.play().catch(err => console.warn('PIP autoplay prevented:', err));
 }
 console.log('Restored playback in PIP');
}, 100);

// Show PIP container
pipContainer.classList.add('active');
pipMode = true;

// Update PIP button state
updatePIPButtonState();

// Update title
const pipTitle = pipContainer.querySelector('.pip-title');
if (pipTitle) {
 pipTitle.textContent = window.currentLoadingFilename || 'Video Player';
}

console.log('✅ Entered PIP mode');
}

function exitPIPMode() {
console.log('Exiting PIP mode');

const pipContainer = document.getElementById('pipPlayerContainer');
if (!pipContainer || !mainContainer) {
 console.error('PIP containers not found');
 return;
}

// ✅ Move the entire Plyr container back to main container
const plyrContainer = pipContainer.querySelector('.plyr');
if (plyrContainer) {
 mainContainer.appendChild(plyrContainer);
 console.log('Moved Plyr container back to main');
}

// ✅ No need to destroy/recreate player - it's the same instance
// Player continues working, just in a different DOM location

// Hide PIP container
pipContainer.classList.remove('active');
pipMode = false;

// Update PIP button state
updatePIPButtonState();

// ✅ Recreate video info and permanent progress bar if needed
setTimeout(() => {
 // Ensure video info exists
 let videoInfo = document.getElementById("currentVideoInfo");
 if (!videoInfo) {
     videoInfo = document.createElement("div");
     videoInfo.id = "currentVideoInfo";
     videoInfo.className = "current-video-info";
     mainContainer.insertAdjacentElement("afterend", videoInfo);
 }
 
 // Recreate permanent progress bar if missing
 if (!document.getElementById('permanentProgressBar')) {
     setupPermanentProgressBar();
 }
 
 console.log('✅ Restored UI elements after exiting PIP');
}, 100);

console.log('✅ Exited PIP mode');
}

function updatePIPButtonState() {
const pipBtn = document.querySelector('.plyr-pip');
if (pipBtn) {
 if (pipMode) {
     pipBtn.classList.add('active');
 } else {
     pipBtn.classList.remove('active');
 }
}
}

function makePIPDraggable(container, handle) {
let isDragging = false;
let currentX;
let currentY;
let initialX;
let initialY;
let xOffset = 0;
let yOffset = 0;

handle.addEventListener('mousedown', dragStart);
document.addEventListener('mousemove', drag);
document.addEventListener('mouseup', dragEnd);

function dragStart(e) {
 if (e.target.closest('.pip-close')) return; // Don't drag when clicking close
 if (e.target.closest('.pip-resize-handle')) return; // Don't drag when resizing
 
 // ✅ Get current position from computed styles
 const rect = container.getBoundingClientRect();
 xOffset = rect.left;
 yOffset = rect.top;
 
 // ✅ Ensure container uses left/top positioning (not right/bottom)
 container.style.left = rect.left + 'px';
 container.style.top = rect.top + 'px';
 container.style.right = 'auto';
 container.style.bottom = 'auto';
 
 initialX = e.clientX - xOffset;
 initialY = e.clientY - yOffset;
 isDragging = true;
 
 container.style.transition = 'none';
 
 console.log('Drag start from position:', { x: xOffset, y: yOffset });

 
// ✅ Optional: Add visual feedback
 container.style.opacity = '0.9';
}

function drag(e) {
if (!isDragging) return;

e.preventDefault();

currentX = e.clientX - initialX;
currentY = e.clientY - initialY;

// Constrain to viewport BEFORE setting position
const rect = container.getBoundingClientRect();
const maxX = window.innerWidth - rect.width;
const maxY = window.innerHeight - rect.height;

currentX = Math.max(0, Math.min(currentX, maxX));
currentY = Math.max(0, Math.min(currentY, maxY));

xOffset = currentX;
yOffset = currentY;

setTranslate(currentX, currentY, container);
}

function dragEnd(e) {
 if (!isDragging) return;
 
 initialX = currentX;
 initialY = currentY;
 isDragging = false;
 
 container.style.transition = '';

 // ✅ Optional: Remove visual feedback
container.style.opacity = '1';
}

function setTranslate(xPos, yPos, el) {
// Use left/top positioning only
el.style.left = xPos + 'px';
el.style.top = yPos + 'px';
// Ensure right/bottom are cleared
el.style.right = 'auto';
el.style.bottom = 'auto';
}
}

function makePIPResizable(container) {
const resizeHandle = container.querySelector('.pip-resize-handle');
if (!resizeHandle) return;

let isResizing = false;
let startX, startY, startWidth, startHeight;

resizeHandle.addEventListener('mousedown', startResize);
document.addEventListener('mousemove', resize);
document.addEventListener('mouseup', stopResize);

function startResize(e) {
  e.stopPropagation(); // Prevent triggering drag
  isResizing = true;
  
  startX = e.clientX;
  startY = e.clientY;
  
  const rect = container.getBoundingClientRect();
  startWidth = rect.width;
  startHeight = rect.height;
  
  container.style.transition = 'none';
  document.body.style.cursor = 'nwse-resize';
  
  console.log('Started resize:', { startWidth, startHeight });
}

function resize(e) {
  if (!isResizing) return;
  
  e.preventDefault();
  
  const deltaX = e.clientX - startX;
  const deltaY = e.clientY - startY;
  
  // Calculate new dimensions (maintain aspect ratio of video)
  let newWidth = startWidth + deltaX;
  let newHeight = startHeight + deltaY;
  
  // Apply minimum size constraints
  const minWidth = 200;
  const minHeight = 180; // ✅ Increased to ensure controls fit
  newWidth = Math.max(minWidth, newWidth);
  newHeight = Math.max(minHeight, newHeight);
  
  // Apply maximum size constraints (don't exceed 80% of viewport)
  const maxWidth = window.innerWidth * 0.8;
  const maxHeight = window.innerHeight * 0.8;
  newWidth = Math.min(maxWidth, newWidth);
  newHeight = Math.min(maxHeight, newHeight);
  
  // Ensure PIP stays on screen during resize
  const rect = container.getBoundingClientRect();
  const currentLeft = rect.left;
  const currentTop = rect.top;
  
  // Check if resize would push PIP off-screen
  if (currentLeft + newWidth > window.innerWidth) {
      newWidth = window.innerWidth - currentLeft - 10;
  }
  
  if (currentTop + newHeight > window.innerHeight) {
      newHeight = window.innerHeight - currentTop - 10;
  }
  
  container.style.width = newWidth + 'px';
  container.style.height = newHeight + 'px';
}

function stopResize(e) {
  if (!isResizing) return;
  
  isResizing = false;
  container.style.transition = '';
  document.body.style.cursor = '';
  
  const rect = container.getBoundingClientRect();
  console.log('Resize complete:', { width: rect.width, height: rect.height });
  
}
}

// Update PIP title when video changes
function updatePIPTitle(filename) {
const pipTitle = document.querySelector('.pip-title');
if (pipTitle && pipMode) {
 pipTitle.textContent = filename || 'Video Player';
}
}

// Export PIP functions globally
window.togglePIPMode = togglePIPMode;
window.enterPIPMode = enterPIPMode;
window.exitPIPMode = exitPIPMode;

// ========================
// Create persistent player
// ========================
function createPlayerElement() {
let container = document.getElementById("inlineVideoContainer");

if (!container) {
    container = document.createElement("div");
    container.id = "inlineVideoContainer";

    const video = document.createElement("video");
    video.id = "inlineVideoPlayer";
    video.setAttribute("playsinline", "");
    video.setAttribute("controls", true);
    video.classList.add("plyr__video-embed");
    container.appendChild(video);

    // Desktop: PREPEND to video column (so it appears BEFORE controls)
    if (window.innerWidth >= 769) {
        const videoColumn = document.getElementById('desktopVideoColumn');
        if (videoColumn) {
            console.log("Creating player at TOP of desktop video column");
            videoColumn.insertBefore(container, videoColumn.firstChild);
        } else {
            console.warn("desktopVideoColumn not found, placing after h1");
            const h1 = document.querySelector("h1");
            if (h1) h1.insertAdjacentElement("afterend", container);
            else document.body.insertBefore(container, document.body.firstChild);
        }

        // ✅ ADD THIS: Create video info display below player
        const videoInfo = document.createElement("div");
        videoInfo.id = "currentVideoInfo";
        videoInfo.className = "current-video-info";
        container.insertAdjacentElement("afterend", videoInfo);
         
    } else {
        // Mobile: place after h1
        const h1 = document.querySelector("h1");
        if (h1) h1.insertAdjacentElement("afterend", container);
        else document.body.insertBefore(container, document.body.firstChild);
    }

// Initialise Plyr with custom control order: play, stop will be inserted, fullscreen, settings, mute, volume, then progress
window.plyrPlayer = new Plyr('#inlineVideoPlayer', {
controls: ['play', 'fullscreen', 'settings', 'mute', 'volume', 'progress', 'current-time'],
fullscreen: { enabled: true, fallback: true, iosNative: false, container: null },
keyboard: { focused: false, global: false }, // Disable Plyr's keyboard shortcuts
loop: { active: true } // Enable video looping
});

// Listen for user volume/mute changes
window.plyrPlayer.on('volumechange', () => {
   sessionVolume = window.plyrPlayer.volume;
   sessionMuted = window.plyrPlayer.muted;
   console.log(`Volume changed - stored: ${sessionVolume.toFixed(2)}, muted: ${sessionMuted}`);
});

// ========================
// Create tappable time clock in top-right corner (timezone selectable)
// ========================
const plyrContainer = document.querySelector('.plyr');
if (plyrContainer) {
const ukClock = document.createElement('div');
ukClock.id = 'plyr-uk-clock';
ukClock.title = 'Tap to change timezone';
plyrContainer.appendChild(ukClock);

// Common timezone list for the picker modal
const COMMON_TIMEZONES = [
    { label: 'London (UK)', value: 'Europe/London' },
    { label: 'New York (US Eastern)', value: 'America/New_York' },
    { label: 'Chicago (US Central)', value: 'America/Chicago' },
    { label: 'Denver (US Mountain)', value: 'America/Denver' },
    { label: 'Los Angeles (US Pacific)', value: 'America/Los_Angeles' },
    { label: 'Paris / Berlin (CET)', value: 'Europe/Paris' },
    { label: 'Moscow', value: 'Europe/Moscow' },
    { label: 'Dubai', value: 'Asia/Dubai' },
    { label: 'Mumbai / Delhi', value: 'Asia/Kolkata' },
    { label: 'Bangkok', value: 'Asia/Bangkok' },
    { label: 'Singapore / Hong Kong', value: 'Asia/Singapore' },
    { label: 'Tokyo', value: 'Asia/Tokyo' },
    { label: 'Sydney', value: 'Australia/Sydney' },
    { label: 'Auckland', value: 'Pacific/Auckland' },
    { label: 'UTC', value: 'UTC' }
];

// Restore saved timezone preference, default to London
let currentClockTimezone = localStorage.getItem('scray_clock_timezone') || 'Europe/London';

// Update clock every second
function updateUKClock() {
    const now = new Date();
    const clockTime = new Intl.DateTimeFormat('en-GB', {
        timeZone: currentClockTimezone,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    }).format(now);
    ukClock.textContent = clockTime;
}

updateUKClock(); // Initial update
const clockIntervalId = setInterval(updateUKClock, 1000); // Update every second

// Tap clock to open timezone picker modal
ukClock.addEventListener('click', (e) => {
    e.stopPropagation();
    showTimezonePickerModal();
});

function showTimezonePickerModal() {
    const modal = document.createElement('div');
    modal.className = 'basket-json-modal';
    modal.style.zIndex = '2147483647'; // Above fullscreen player

    const listHTML = COMMON_TIMEZONES.map(tz => `
        <div class="move-path-item timezone-option" data-tz="${tz.value}" style="${tz.value === currentClockTimezone ? 'background:#e3f2fd; border-left:4px solid #2196F3; font-weight:bold;' : ''}">
            ${tz.label}
        </div>
    `).join('');

    modal.innerHTML = `
        <div class="basket-json-modal-content" style="max-width: 350px;">
            <h3>Select Clock Timezone</h3>
            <div style="max-height: 50vh; overflow-y: auto; border: 1px solid #ddd; border-radius: 4px; margin-bottom: 16px;">
                ${listHTML}
            </div>
            <button id="timezoneCancelBtn" class="modal-btn modal-btn-cancel">Cancel</button>
        </div>
    `;
    document.body.appendChild(modal);

    modal.querySelectorAll('.timezone-option').forEach(item => {
        item.addEventListener('click', () => {
            currentClockTimezone = item.dataset.tz;
            localStorage.setItem('scray_clock_timezone', currentClockTimezone);
            updateUKClock(); // Immediate refresh
            modal.remove();
            console.log(`Clock timezone changed to: ${currentClockTimezone}`);
        });
    });

    document.getElementById('timezoneCancelBtn').addEventListener('click', () => {
        modal.remove();
    });

    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });

    const tzEscHandler = (e) => {
        if (e.key === 'Escape') {
            modal.remove();
            document.removeEventListener('keydown', tzEscHandler);
        }
    };
    document.addEventListener('keydown', tzEscHandler);
}

console.log('Clock added to player (tap to change timezone)');
}
// ========================
// Create and update permanent minimal progress bar below video
// ========================
function setupPermanentProgressBar() {
const plyrContainer = document.querySelector('.plyr');
if (!plyrContainer) {
console.warn('Plyr container not found for permanent progress bar');
return;
}

// Remove existing if present
const existing = document.getElementById('permanentProgressBar');
if (existing) existing.remove();

const permanentProgress = document.createElement('div');
permanentProgress.id = 'permanentProgressBar';
permanentProgress.innerHTML = `
<div class="permanent-progress-timestamp">0:00 / 0:00</div>
<div class="permanent-progress-bar">
<div class="permanent-progress-filled"></div>
</div>
`;

// Insert after video wrapper, before controls
const videoWrapper = plyrContainer.querySelector('.plyr__video-wrapper');
if (videoWrapper && videoWrapper.nextSibling) {
plyrContainer.insertBefore(permanentProgress, videoWrapper.nextSibling);
} else {
plyrContainer.appendChild(permanentProgress);
}

// Make progress bar interactive (seekable)
const progressBar = permanentProgress.querySelector('.permanent-progress-bar');
if (progressBar) {
// Desktop: click and drag to seek
let isDesktopSeeking = false;

const desktopSeek = (e) => {
if (!window.plyrPlayer.duration) return;

const rect = progressBar.getBoundingClientRect();
const clickX = e.clientX - rect.left;
const percent = Math.max(0, Math.min(1, clickX / rect.width));
const seekTime = percent * window.plyrPlayer.duration;

// Update visual progress bar IMMEDIATELY
const filled = progressBar.querySelector('.permanent-progress-filled');
if (filled) {
filled.style.width = `${percent * 100}%`;
}

// Update timestamp display IMMEDIATELY
const timestamp = document.querySelector('.permanent-progress-timestamp');
if (timestamp) {
const remaining = window.plyrPlayer.duration - seekTime; // Calculate remaining
timestamp.textContent = `${formatDuration(seekTime * 1000)} / ${formatDuration(remaining * 1000)}`;
}

// Then update video position
window.plyrPlayer.currentTime = seekTime;
showPlayerFeedback(`${formatDuration(seekTime * 1000)}`, 'top-left');
};

progressBar.addEventListener('mousedown', (e) => {
if (!window.plyrPlayer.duration) return;
armBookmarkMarkers(progressBar);
isDesktopSeeking = true;
desktopSeek(e);
e.preventDefault();
console.log('Started desktop seeking');
});

progressBar.addEventListener('mousemove', (e) => {
if (!isDesktopSeeking) return;
desktopSeek(e);
});

progressBar.addEventListener('mouseup', (e) => {
if (isDesktopSeeking) {
console.log(`Seeked to ${formatDuration(window.plyrPlayer.currentTime * 1000)} via progress bar drag`);
}
isDesktopSeeking = false;
});

progressBar.addEventListener('mouseleave', () => {
isDesktopSeeking = false;
});

window.addEventListener('mouseup', () => {
if (isDesktopSeeking) {
isDesktopSeeking = false;
}
});

// Mobile: touch to seek
let isSeeking = false;

progressBar.addEventListener('touchstart', (e) => {
if (!window.plyrPlayer.duration) return;
armBookmarkMarkers(progressBar);
isSeeking = true;
e.stopPropagation();
}, { passive: false });

progressBar.addEventListener('touchmove', (e) => {
if (!isSeeking || !window.plyrPlayer.duration) return;

e.preventDefault();
e.stopPropagation();

const touch = e.touches[0];
const rect = progressBar.getBoundingClientRect();
const touchX = touch.clientX - rect.left;
const percent = Math.max(0, Math.min(1, touchX / rect.width));
const seekTime = percent * window.plyrPlayer.duration;

window.plyrPlayer.currentTime = seekTime;
showPlayerFeedback(`${formatDuration(seekTime * 1000)}`, 'top-left');
}, { passive: false });

progressBar.addEventListener('touchend', (e) => {
if (isSeeking) {
    console.log(`Seeked to ${formatDuration(window.plyrPlayer.currentTime * 1000)} via progress bar touch`);
}
isSeeking = false;
});

progressBar.addEventListener('touchcancel', () => {
isSeeking = false;
});

console.log('✅ Progress bar is now interactive (click/tap to seek)');
}

console.log('✅ Permanent progress bar created below video');

// Render bookmark markers now that the bar exists
renderBookmarkMarkers();
}

// ⚙️ How long (ms) bookmark markers stay tappable after the progress
// bar itself is tapped, in forced-landscape mode.
const BOOKMARK_ARM_WINDOW_MS = 3000;
let bookmarkArmTimer = null;

/**
*  Forced landscape only: arm bookmark markers for a short window so a
* tap directly on the bar can be followed by a tap on a marker. Outside
* this window (and outside forced-landscape mode) markers ignore taps
* entirely via CSS pointer-events, so control buttons always win.
*/
function armBookmarkMarkers(progressBar) {
if (!document.body.classList.contains('manual-rotate-landscape') &&
    !document.body.classList.contains('landscape-fullscreen')) return;
if (!progressBar) return;

progressBar.classList.add('bookmarks-armed');
if (bookmarkArmTimer) clearTimeout(bookmarkArmTimer);
bookmarkArmTimer = setTimeout(() => {
    progressBar.classList.remove('bookmarks-armed');
    bookmarkArmTimer = null;
}, BOOKMARK_ARM_WINDOW_MS);
}

/**
* Render clickable bookmark markers on the permanent progress bar
* Reads bookmarks from the currently playing video
*/
function renderBookmarkMarkers() {
const progressBar = document.querySelector('.permanent-progress-bar');
if (!progressBar) return;

// Remove any existing markers first
progressBar.querySelectorAll('.progress-bookmark-marker').forEach(m => m.remove());

const video = window.currentPlayingVideo;
if (!video || !Array.isArray(video.bookmarks) || video.bookmarks.length === 0) {
    return; // No bookmarks to render
}

const duration = window.plyrPlayer?.duration;
if (!duration || isNaN(duration) || duration <= 0) {
    // Duration not ready yet - try again shortly (loadedmetadata should have fired though)
    return;
}

// Track which marker is "armed" (tooltip shown) on mobile - tap once to
// show, tap again (on the same marker) to jump. Tapping elsewhere resets.
let armedMarker = null;

// Proper hover-capability detection instead of touch-point detection
// (many desktop trackpads/touchscreens report maxTouchPoints > 0, which
// broke the previous check). This checks if the device can actually hover.
const canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
const isTouchDevice = !canHover;

video.bookmarks.forEach(bm => {
    if (typeof bm.time !== 'number') return;

    const percent = Math.max(0, Math.min(100, (bm.time / duration) * 100));
    const tooltipText = bm.note
        ? `${formatDuration(bm.time * 1000)} ${bm.note}`
        : formatDuration(bm.time * 1000);

    const marker = document.createElement('div');
    marker.className = 'progress-bookmark-marker';
    marker.style.left = `${percent}%`;

    const tooltip = document.createElement('div');
    tooltip.className = 'bookmark-marker-tooltip';
    tooltip.textContent = tooltipText;
    marker.appendChild(tooltip);

    let autoFadeTimer = null;

    const jumpToBookmark = () => {
        if (autoFadeTimer) {
            clearTimeout(autoFadeTimer);
            autoFadeTimer = null;
        }
        if (window.plyrPlayer && !isNaN(bm.time)) {
            window.plyrPlayer.currentTime = bm.time;
            window.plyrPlayer.play();
            showPlayerFeedback(`→ ${formatDuration(bm.time * 1000)}`, 'top-left');
        }
        tooltip.classList.remove('show');
        armedMarker = null;
    };

    // CRITICAL: Block the underlying progress bar's seek handlers from
    // ever firing when interacting with a marker - stop propagation on
    // EVERY pointer event, not just click, since the bar listens on
    // mousedown (desktop seek) and touchstart (mobile seek).
    marker.addEventListener('mousedown', (e) => e.stopPropagation());
    marker.addEventListener('touchstart', (e) => {
        e.stopPropagation();
    }, { passive: true });

    if (isTouchDevice) {
        // Mobile: first tap shows tooltip (auto-fades after 3s), second tap (while armed) jumps
        marker.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();

            if (armedMarker === marker) {
                // Second tap on same marker - jump
                jumpToBookmark();
            } else {
                // First tap (or tapped a different marker) - show tooltip only, no jump
                if (armedMarker && armedMarker !== marker) {
                    armedMarker.querySelector('.bookmark-marker-tooltip')?.classList.remove('show');
                }
                tooltip.classList.add('show');
                armedMarker = marker;

                // Auto-fade after 3 seconds and disarm
                if (autoFadeTimer) clearTimeout(autoFadeTimer);
                autoFadeTimer = setTimeout(() => {
                    tooltip.classList.remove('show');
                    if (armedMarker === marker) armedMarker = null;
                }, 3000);
            }
        });
    } else {
        // Desktop: hover shows tooltip (preview only, no jump), click jumps
        marker.addEventListener('mouseenter', () => {
            tooltip.classList.add('show');
        });
        marker.addEventListener('mouseleave', () => {
            tooltip.classList.remove('show');
        });
        marker.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            jumpToBookmark();
        });
    }

    progressBar.appendChild(marker);
});

// Tapping anywhere else on mobile disarms any armed marker (hides tooltip)
if (isTouchDevice && !progressBar.dataset.bookmarkDisarmBound) {
    progressBar.dataset.bookmarkDisarmBound = 'true';
    progressBar.addEventListener('touchstart', (e) => {
        if (!e.target.closest('.progress-bookmark-marker') && armedMarker) {
            armedMarker.querySelector('.bookmark-marker-tooltip')?.classList.remove('show');
            armedMarker = null;
        }
    }, { passive: true });
}

// Tapping anywhere else on mobile disarms any armed marker (hides tooltip)
if (isTouchDevice && !progressBar.dataset.bookmarkDisarmBound) {
    progressBar.dataset.bookmarkDisarmBound = 'true';
    progressBar.addEventListener('touchstart', (e) => {
        if (!e.target.closest('.progress-bookmark-marker') && armedMarker) {
            armedMarker.querySelector('.bookmark-marker-tooltip')?.classList.remove('show');
            armedMarker = null;
        }
    }, { passive: true });
}
}

// Export globally so bookmark modal can refresh markers after add/delete/save
window.renderBookmarkMarkers = renderBookmarkMarkers;

// Update permanent progress bar
function updatePermanentProgressBar() {
const current = window.plyrPlayer.currentTime;
const duration = window.plyrPlayer.duration;

if (duration && !isNaN(duration) && duration > 0) {
const percent = (current / duration) * 100;
const remaining = duration - current; // Calculate remaining time

const filled = document.querySelector('.permanent-progress-filled');
const timestamp = document.querySelector('.permanent-progress-timestamp');

if (filled) filled.style.width = `${percent}%`;
if (timestamp) {
    // Show elapsed / remaining instead of elapsed / total
    timestamp.textContent = `${formatDuration(current * 1000)} / ${formatDuration(remaining * 1000)}`;
}
}
}

// ========================
// Clean up Plyr controls - remove progress bar and lower position
// ========================
function cleanupPlyrControls() {
const controls = document.querySelector('.plyr__controls');
if (!controls) return;

// Remove progress bar from controls
const progressBar = controls.querySelector('.plyr__progress');
if (progressBar) {
    progressBar.remove();
    console.log('✅ Removed progress bar from controls');
}

// Remove time displays from controls
const timeDisplays = controls.querySelectorAll('.plyr__time');
timeDisplays.forEach(time => time.remove());
console.log('✅ Removed time displays from controls');

// Lower controls position in fullscreen
if (window.plyrPlayer.fullscreen?.active) {
    controls.style.bottom = '7vh';
    console.log('✅ Lowered controls to 7vh');
}
}

// Initialize permanent progress bar on ready
window.plyrPlayer.on('ready', () => {
setupPermanentProgressBar();
cleanupPlyrControls();
console.log('Permanent progress bar ready');
});

// Hide timestamp when controls are hidden
window.plyrPlayer.on('controlshidden', () => {
const timestamp = document.querySelector('.permanent-progress-timestamp');
if (timestamp) timestamp.style.opacity = '0';
});

window.plyrPlayer.on('controlsshown', () => {
const timestamp = document.querySelector('.permanent-progress-timestamp');
if (timestamp) timestamp.style.opacity = '1';
});

// Update on time change
window.plyrPlayer.on('timeupdate', updatePermanentProgressBar);

// Recreate on source change (new video loaded)
window.plyrPlayer.on('loadedmetadata', () => {
console.log('New video loaded, setting up permanent progress bar');
setupPermanentProgressBar(); //  Also calls renderBookmarkMarkers() internally
setTimeout(cleanupPlyrControls, 100); // Delay to ensure Plyr is ready

//  Reapply forced-landscape rotation styles here too - covers the
// window between source-set and playback where video-wrapper/video/
// progress bar can lose their inline styles.
if (manualRotationActive) {
    applyManualRotationStyles();
}
});

// Update controls position when entering/exiting fullscreen
window.plyrPlayer.on('enterfullscreen', () => {
setTimeout(() => {
    const controls = document.querySelector('.plyr__controls');
    if (controls) {
        controls.style.bottom = '7vh';
        controls.style.setProperty('bottom', '7vh', 'important');
        console.log('✅ Lowered controls to 7vh on fullscreen enter');
    }
}, 100);
});

window.plyrPlayer.on('exitfullscreen', () => {
const controls = document.querySelector('.plyr__controls');
if (controls) {
    controls.style.bottom = '';
    console.log('✅ Reset controls position on fullscreen exit');
}
});

// ========================
// Dynamic Keyboard Shortcuts for Player
// ========================
let keyboardShortcutsInitialized = false; // ✅ Prevent duplicate listeners

function setupPlayerKeyboardShortcuts() {
// Check if config is loaded
if (!window.playerKeyboardShortcuts || !Array.isArray(window.playerKeyboardShortcuts)) {
    console.warn('Player keyboard shortcuts config not loaded');
    return;
}

// ✅ Only initialize once
if (keyboardShortcutsInitialized) {
    // console.log('Keyboard shortcuts already initialized');
    return;
}

// Build a key map for quick lookup
const keyMap = new Map();
window.playerKeyboardShortcuts.forEach(shortcut => {
    if (shortcut.key) {
        const normalizedKey = shortcut.key.toLowerCase();
        if (!keyMap.has(normalizedKey)) {
            keyMap.set(normalizedKey, []);
        }
        keyMap.get(normalizedKey).push(shortcut);
    }
});

document.addEventListener('keydown', (e) => {
    // Only trigger when player exists
    if (!window.plyrPlayer) return;
    
    const activeTag = document.activeElement.tagName.toLowerCase();
    const isEditable = document.activeElement.isContentEditable;
    
    // Don't interfere with text inputs
    if (activeTag === 'input' || activeTag === 'textarea' || isEditable) return;
    
    // Don't interfere if Select2 dropdown is open
    if ($('.select2-container--open').length) return;
    
    const player = window.plyrPlayer;
    
    // Only work if video is loaded (except for stop action)
    if (!player.duration && e.key.toLowerCase() !== 's') return;
    
    // Normalize the key
    let keyPressed = e.key;
    if (keyPressed === ' ') keyPressed = 'space';
    const normalizedKey = keyPressed.toLowerCase();
    
    // Check if this key has any shortcuts
    const shortcuts = keyMap.get(normalizedKey);
    if (!shortcuts || shortcuts.length === 0) return;
    
    // Execute all shortcuts for this key
    shortcuts.forEach(shortcut => {
        executeShortcut(shortcut, player, e);
    });
});

keyboardShortcutsInitialized = true; // ✅ Mark as initialized
console.log('Keyboard shortcuts initialized');
}

// ⚙️ Frame-step keyboard shortcuts: N = previous frame, O = next frame.
// Tap = single frame step. Hold = continuous frame-by-frame stepping,
// mirroring the mobile frame-step buttons' tap/hold behavior exactly
// (reuses the same FRAME_STEP_DURATION / FRAME_HOLD_DELAY_MS /
// FRAME_HOLD_INTERVAL_MS constants). Implemented as its own keydown/keyup
// pair rather than going through the generic shortcut table above, since
// that table has no concept of "held" - and browser key-repeat timing
// isn't reliable/tunable enough to use directly.
let frameStepKeyboardInitialized = false;

function setupFrameStepKeyboardShortcuts() {
    if (frameStepKeyboardInitialized) return;

    const keyState = {
        n: { active: false, timeout: null, interval: null },
        o: { active: false, timeout: null, interval: null }
    };

    function stepFrame(direction, multiplier = 1) {
        if (!window.plyrPlayer || !window.plyrPlayer.duration) return;

        if (!window.plyrPlayer.paused) {
            window.plyrPlayer.pause();
        }

        const newTime = Math.max(
            0,
            Math.min(window.plyrPlayer.duration, window.plyrPlayer.currentTime + (direction * FRAME_STEP_DURATION * multiplier))
        );
        window.plyrPlayer.currentTime = newTime;

        if (typeof showPlayerFeedback === 'function') {
            const speedSuffix = multiplier > 1 ? ` (${multiplier}x)` : '';
            const label = direction > 0 ? `+1 frame${speedSuffix}` : `-1 frame${speedSuffix}`;
            showPlayerFeedback(`${label} (${formatDuration(newTime * 1000)})`, direction > 0 ? 'top-right' : 'top-left');
        }
    }

    // Shared across both frame-step buttons: releasing a hold and starting
    // a new one within FRAME_HOLD_SPEEDUP_WINDOW_MS doubles the stepping
    // speed (capped at FRAME_HOLD_MAX_MULTIPLIER). Waiting longer resets
    // it back to 1x on the next hold.
    const holdSpeedState = { multiplier: 1, lastReleaseTime: 0 };

    function clearKeyTimers(state) {
        clearTimeout(state.timeout);
        state.timeout = null;
        if (state.interval) {
            clearInterval(state.interval);
            state.interval = null;
        }
    }

    document.addEventListener('keydown', (e) => {
        if (!window.plyrPlayer) return;

        const activeTag = document.activeElement.tagName.toLowerCase();
        const isEditable = document.activeElement.isContentEditable;
        if (activeTag === 'input' || activeTag === 'textarea' || isEditable) return;
        if ($('.select2-container--open').length) return;
        if (!window.plyrPlayer.duration) return;

        const key = e.key.toLowerCase();
        if (key !== 'n' && key !== 'o') return;

        e.preventDefault();

        const state = keyState[key];
        if (state.active) return; // ignore browser's own key-repeat

        state.active = true;
        const direction = key === 'n' ? -1 : 1;

        stepFrame(direction); // tap step
        state.timeout = setTimeout(() => {
            state.interval = setInterval(() => stepFrame(direction), FRAME_HOLD_INTERVAL_MS);
        }, FRAME_HOLD_DELAY_MS);
    });

    document.addEventListener('keyup', (e) => {
        const key = e.key.toLowerCase();
        if (key !== 'n' && key !== 'o') return;

        const state = keyState[key];
        clearKeyTimers(state);
        state.active = false;
    });

    frameStepKeyboardInitialized = true;
    console.log('Frame-step keyboard shortcuts initialized (N = prev frame, O = next frame)');
}

function executeShortcut(shortcut, player, event) {
let feedbackMsg = '';
let feedbackPosition = 'top-left';

switch(shortcut.action) {
    case 'playPause':
        event.preventDefault();
        // ✅ Read state BEFORE toggling
        const willBePaused = !player.paused;
        player.togglePlay();
        feedbackMsg = shortcut.feedback(willBePaused);
        break;
        
    case 'rewind':
        event.preventDefault();
        player.currentTime = Math.max(0, player.currentTime - shortcut.seconds);
        feedbackMsg = shortcut.feedback(player.currentTime);
        feedbackPosition = 'top-left';
        break;
        
    case 'forward':
        event.preventDefault();
        player.currentTime = Math.min(player.duration, player.currentTime + shortcut.seconds);
        feedbackMsg = shortcut.feedback(player.currentTime);
        feedbackPosition = 'top-right';
        break;
        
    case 'speedDecrease':
        event.preventDefault();
        player.speed = Math.max(0.25, player.speed - shortcut.step);
        feedbackMsg = shortcut.feedback(player.speed);
        break;
        
    case 'speedIncrease':
        event.preventDefault();
        player.speed = Math.min(2, player.speed + shortcut.step);
        feedbackMsg = shortcut.feedback(player.speed);
        feedbackPosition = 'top-right';
        break;
        
    case 'speedReset':
        event.preventDefault();
        player.speed = 1;
        feedbackMsg = shortcut.feedback();
        break;
        
    case 'volumeUp':
        event.preventDefault();
        player.volume = Math.min(1, player.volume + (shortcut.step / 100));
        feedbackMsg = shortcut.feedback(player.volume);
        feedbackPosition = 'top-right';
        break;
        
    case 'volumeDown':
        event.preventDefault();
        player.volume = Math.max(0, player.volume - (shortcut.step / 100));
        feedbackMsg = shortcut.feedback(player.volume);
        break;
        
    case 'mute':
        event.preventDefault();
        // ✅ Read state BEFORE toggling
        const willBeMuted = !player.muted;
        player.muted = willBeMuted;
        feedbackMsg = shortcut.feedback(willBeMuted);
        break;
        
    case 'jumpToPercent':
        event.preventDefault();
        player.currentTime = (player.duration * shortcut.percent) / 100;
        feedbackMsg = shortcut.feedback();
        break;
        
    case 'jumpToStart':
        event.preventDefault();
        player.currentTime = 0;
        feedbackMsg = shortcut.feedback();
        break;
        
    case 'jumpToEnd':
        event.preventDefault();
        player.currentTime = player.duration;
        feedbackMsg = shortcut.feedback();
        feedbackPosition = 'top-right';
        break;
        
    case 'fullscreen':
        event.preventDefault();
        player.fullscreen.toggle();
        // ✅ Use timeout to read state after toggle
        setTimeout(() => {
            const msg = shortcut.feedback(player.fullscreen.active);
            if (msg) showPlayerFeedback(msg, feedbackPosition);
        }, 100);
        return; // ✅ Don't show feedback immediately
        
    case 'exitFullscreen':
        if (player.fullscreen.active) {
            event.preventDefault();
            player.fullscreen.exit();
            feedbackMsg = shortcut.feedback();
        }
        break;
        
    case 'stop':
        event.preventDefault();
        if (window.inlineVideoPlayer) {
            window.inlineVideoPlayer.stop();
        }
        feedbackMsg = shortcut.feedback();
        break;
        
    default:
        console.warn(`Unknown shortcut action: ${shortcut.action}`);
        return;
}

// Show feedback if message exists
if (feedbackMsg) {
    showPlayerFeedback(feedbackMsg, feedbackPosition);
}
}

// Initialize shortcuts after Plyr is ready
window.plyrPlayer.on('ready', () => {
setupPlayerKeyboardShortcuts();
setupFrameStepKeyboardShortcuts(); // N/O frame-step keys (desktop)
enableAnywhereScrubbing();
attachStopButton();
attachPIPButton(); // Add PIP button
attachIOSFullscreenButton(); // Add iOS native fullscreen button
attachManualRotateButton(); // Add manual rotate-to-landscape button
attachScrollLockButton(); // Add scroll-lock button (manual rotation only)
attachRandomVideoButton(); //  Add random-video quick-action button
attachHistorySequenceButton(); //  Add play-through-history quick-action button
attachPlayNextButton(); //  Add play-next quick-action button
attachBasketQuickButton(); //  Add basket quick-view button
attachBookmarkQuickButton(); //  Add bookmark quick-add button
attachFrameStepButtons(); // Add frame-by-frame step buttons
attachColumnFrameStepZones(); // Add single-tap frame-step columns over the seek zones
updatePlayerStateClass();
});

// === Disable Plyr's double-click fullscreen toggle ===
const plyrElement = document.querySelector('.plyr');
try {
    plyrElement.removeEventListener('dblclick', window.plyrPlayer.toggleFullscreen);
} catch (err) {
    console.warn('Could not remove Plyr dblclick listener', err);
}
plyrElement.addEventListener('dblclick', e => e.stopPropagation(), true);

// === State detection helper ===
function detectPlayerState() {
    const isLandscape = window.matchMedia('(orientation: landscape)').matches;
    const isFullscreen = window.plyrPlayer?.fullscreen?.active || false;
    const isMini = container.classList.contains('mini-player');

    let stateClass = '';
    if (isLandscape) {
        if (isFullscreen) stateClass = 'landscape-fullscreen';
        else if (isMini) stateClass = 'landscape-mini';
        else stateClass = 'landscape-inline';
    } else {
        if (isFullscreen) stateClass = 'portrait-fullscreen';
        else if (isMini) stateClass = 'portrait-mini';
        else stateClass = 'portrait-inline';
    }
    return stateClass;
}

function updatePlayerStateClass() {
    const stateClass = detectPlayerState();
    document.body.classList.remove(
        'portrait-fullscreen', 'portrait-inline', 'portrait-mini',
        'landscape-fullscreen', 'landscape-inline', 'landscape-mini'
    );
    if (stateClass) document.body.classList.add(stateClass);
    window.currentPlayerState = stateClass;
    // console.log('Player state:', stateClass);
}

window.addEventListener('resize', updatePlayerStateClass);

window.addEventListener('orientationchange', () => {
  setTimeout(() => {
      if (container.classList.contains('mini-player')) {
          const isPortrait = window.matchMedia("(orientation: portrait)").matches;
          
          if (isPortrait) {
              container.style.top = "auto";
              container.style.left = "10px";
              container.style.right = "auto";
              container.style.bottom = "115px";
          } else {
              container.style.top = "auto";
              container.style.left = "10px";
              container.style.right = "auto";
              container.style.bottom = "80px";
          }
      }
      updatePlayerStateClass();
      computeBottomDock();
  }, 200);
});

window.plyrPlayer.on('enterfullscreen', () => {
document.body.classList.add('fullscreen-active');

// Check device and orientation
const isLandscape = window.matchMedia("(orientation: landscape)").matches;
const isMobile = window.innerWidth <= 1024;

console.log(`Entering fullscreen - Landscape: ${isLandscape}, Mobile: ${isMobile}, Video orientation: ${window.currentVideoOrientation}`);

// ✅ UNIFIED: Remove ALL squeeze constraints when entering fullscreen
document.body.style.width = '';
document.body.style.maxWidth = '';
document.body.style.overflow = '';
document.body.style.overflowX = '';
document.body.style.position = '';
document.body.style.minHeight = '';

// ✅ CRITICAL: Force touch-action on player container
const playerContainer = document.getElementById('inlineVideoContainer');
if (playerContainer) {
playerContainer.style.touchAction = 'manipulation';
playerContainer.style.pointerEvents = 'auto';
}

// ✅ Mobile landscape: specific fullscreen behavior
if (isMobile && isLandscape) {
 // Apply rotation for portrait videos
 if (window.currentVideoOrientation === 'P') {
     document.body.classList.add('rotate-portrait-video');
     
     const videoElement = document.querySelector('#inlineVideoPlayer');
     const videoWrapper = document.querySelector('.plyr__video-wrapper');
     
     if (videoElement) {
         videoElement.style.transform = 'rotate(-90deg)';
         videoElement.style.transformOrigin = 'center center';
         videoElement.style.width = '100vh';
         videoElement.style.height = '100vw';
         videoElement.style.maxWidth = '100vh';
         videoElement.style.maxHeight = '100vw';
         console.log('✅ Applied rotation to video element via JS');
     }
     
     if (videoWrapper) {
         videoWrapper.style.display = 'flex';
         videoWrapper.style.alignItems = 'center';
         videoWrapper.style.justifyContent = 'center';
         videoWrapper.style.overflow = 'hidden';
     }
 }
 
 // Allow scrolling (for seeking gestures)
 document.body.style.overflow = 'auto';
 document.body.style.overflowX = 'hidden';
 document.body.style.minHeight = '150vh';
 
} else if (isMobile && !isLandscape) {
 // Portrait: lock scrolling
 document.body.style.overflow = 'hidden';
 document.body.style.position = 'fixed';
 document.body.style.width = '100%';
}

updatePlayerStateClass();
computeBottomDock(); // Undock while fullscreen is active

// Force controls to be raised
setTimeout(() => {
 const controls = document.querySelector('.plyr__controls');
 if (controls) {
     controls.style.bottom = '7vh';
     controls.style.setProperty('bottom', '7vh', 'important');
 }
}, 100);
});

window.plyrPlayer.on('exitfullscreen', () => {
 document.body.classList.remove('fullscreen-active');
    // ADD THIS: Remove rotation class
document.body.classList.remove('rotate-portrait-video');
resetManualRotation(); // Reset manual landscape rotation on exit

 document.body.style.overflow = '';
 document.body.style.position = '';
 document.body.style.width = '';

 updatePlayerStateClass();
 computeBottomDock(); // Re-dock now that fullscreen has ended
 
 // Desktop: scroll video player to top with 5px buffer
 if (window.innerWidth >= 769) {
     const container = document.getElementById('inlineVideoContainer');
     if (container) {
         const yOffset = -5; // 5px buffer from top
         const y = container.getBoundingClientRect().top + window.pageYOffset + yOffset;
         window.scrollTo({ top: y, behavior: 'smooth' });
         console.log('Scrolled to video player after exiting fullscreen');
     }
 }
});

// Add flag to prevent rapid toggling
let miniPlayerTransitioning = false;
let miniPlayerManuallyDismissed = false;

function enterMiniPlayer() {
if (miniPlayerTransitioning) return;
miniPlayerTransitioning = true;

container.classList.add('mini-player');
document.body.classList.remove('no-scroll');
updatePlayerStateClass();
computeBottomDock(); // Undock while mini-player is active

if (!container.querySelector('.mini-close-btn')) {
    const closeBtn = document.createElement('button');
    closeBtn.className = 'mini-close-btn';
    closeBtn.textContent = '×';
    closeBtn.title = 'Close mini player';
    closeBtn.onclick = exitMiniPlayer;
    container.appendChild(closeBtn);
}

// Desktop: position at bottom of column 1
if (window.innerWidth >= 769) {
    // CSS handles positioning
    setTimeout(() => { miniPlayerTransitioning = false; }, 300);
    return;
}

// Mobile: existing positioning logic
const isPortrait = window.matchMedia("(orientation: portrait)").matches;
if (isPortrait) {
  container.style.top = "auto";
  container.style.left = "10px";
  container.style.right = "auto";
  container.style.bottom = "115px";
} else {
  container.style.top = "auto";
  container.style.left = "10px";
  container.style.right = "auto";
  container.style.bottom = "80px";
}

setTimeout(() => { miniPlayerTransitioning = false; }, 300);
}

function exitMiniPlayer() {
   if (miniPlayerTransitioning) return;
   miniPlayerTransitioning = true;

   container.classList.remove('mini-player');

   const closeBtn = container.querySelector('.mini-close-btn');
   if (closeBtn) closeBtn.remove();
   updatePlayerStateClass();
   computeBottomDock(); // Re-dock now that mini-player has closed
 
   // Mark as manually dismissed to prevent reactivation
   miniPlayerManuallyDismissed = true;

   setTimeout(() => { miniPlayerTransitioning = false; }, 300);
}

let checkMiniPlayerTimeout = null;

function isElementFullyOutOfView(el, tolerancePx = 0) {
   const rect = el.getBoundingClientRect();
   return rect.bottom <= tolerancePx;
}

function isElementFullyInView(el, tolerancePx = 100) {
   const rect = el.getBoundingClientRect();
   return rect.top >= 0 && rect.top <= tolerancePx;
}

function checkMiniPlayerToggle() {
   if (!window.plyrPlayer) return;
   if (miniPlayerTransitioning) return;
   if (window.plyrPlayer.paused) return;
   
   // Don't reactivate if user manually dismissed it
   if (miniPlayerManuallyDismissed) return;

   // Disable mini-player on desktop for index.html
   const isDesktop = window.innerWidth >= 769;
   const isIndexPage = window.location.pathname.includes('index.html') || 
                       window.location.pathname === '/' || 
                       window.location.pathname.endsWith('/');

   if (isDesktop && isIndexPage) {
       return; // Don't activate mini-player on desktop index.html
   }

   // Disable mini-player on mobile portrait - video is anchored to top instead (via checkStickyAnchorToggle)
   const isMobilePortrait = window.innerWidth <= 768 && window.matchMedia('(orientation: portrait)').matches;
   if (isMobilePortrait) {
       return; // JS-driven anchor positioning handles this instead of mini-player
   }

    if (checkMiniPlayerTimeout) {
        clearTimeout(checkMiniPlayerTimeout);
    }

    checkMiniPlayerTimeout = setTimeout(() => {
        const fullyOut = isElementFullyOutOfView(container, 100);
        
        if (!window.plyrPlayer.fullscreen.active && 
            !window.plyrPlayer.paused &&
            !container.classList.contains('mini-player')) {
            
            if (fullyOut) {
                enterMiniPlayer();
            }
        }
    }, 250);
}

document.addEventListener('scroll', () => {
   // Reset dismiss flag if user scrolls back to inline player
   if (miniPlayerManuallyDismissed && isElementFullyInView(container)) {
       miniPlayerManuallyDismissed = false;
       console.log('Player back in view - mini-player can activate again');
   }
   
   checkMiniPlayerToggle();
}, { passive: true });
document.addEventListener('scroll', checkMiniPlayerToggle, { passive: true });
window.addEventListener('resize', checkMiniPlayerToggle, { passive: true });
window.addEventListener('resize', computeBottomDock, { passive: true });

// Recompute bottom dock heights when in-app browser chrome / on-screen keyboard changes viewport
if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', computeBottomDock, { passive: true });
}

// Loading overlay
const loadingOverlay = document.createElement('div');
loadingOverlay.id = 'plyr-loading-overlay';
loadingOverlay.textContent = 'Loading...';
container.querySelector('.plyr').appendChild(loadingOverlay);

window.plyrPlayer.on('progress', (event) => {
const buffered = event.detail.plyr.media.buffered;
if (buffered && buffered.length) {
    const loadedSeconds = buffered.end(buffered.length - 1);
    const totalSeconds = window.plyrPlayer.duration || 0;
    const percent = totalSeconds ? Math.round((loadedSeconds / totalSeconds) * 100) : 0;
    const progressLabel = window.currentLoadingLabel
        ? `<div style="font-size: 0.65rem; opacity: 0.9; margin-bottom: 4px; color: #ff9800; font-weight: bold;">${window.currentLoadingLabel}</div>`
        : '';
    if (window.currentLoadingPath) {
        loadingOverlay.innerHTML = `
            ${progressLabel}
            <div style="font-size: 0.65rem; opacity: 0.8; margin-bottom: 4px;">Loading from: ${window.currentLoadingPath} &mdash; ${percent}%</div>
            <div style="font-size: 0.9rem; font-weight: bold;">${window.currentLoadingFilename || ''}</div>
        `;
    } else {
        loadingOverlay.innerHTML = `
            ${progressLabel}
            <div style="font-size: 0.9rem; font-weight: bold;">Loading: ${window.currentLoadingFilename || ''} &mdash; ${percent}% buffered</div>
        `;
    }
}
});

window.plyrPlayer.on('playing', () => { loadingOverlay.style.display = 'none'; });
window.plyrPlayer.on('error', () => { loadingOverlay.style.display = 'none'; });

// --- Mini-player + Gesture Logic ---
let touchStartY = null;
let touchEndY = null;
let lastTapTimeMini = 0;
let enteredFullscreenFromMini = false; // ✅ Track if we entered from mini-player

function onTouchStart(e) {
touchStartY = e.touches ? e.touches[0].clientY : e.clientY;
}

function onTouchEnd(e) {
touchEndY = e.changedTouches ? e.changedTouches[0].clientY : e.clientY;
const deltaY = touchEndY - touchStartY;

if (!window.plyrPlayer.fullscreen.active && container.classList.contains('mini-player')) {
    const now = Date.now();
    if (now - lastTapTimeMini < 300) {
        // Check if we're on mobile and in landscape
        const isLandscape = window.matchMedia('(orientation: landscape)').matches;
        const isMobile = window.innerWidth <= 768;
        
        if (isLandscape && isMobile) {
            // ✅ Mobile landscape: EXIT mini-player FIRST, then enter fullscreen
            exitMiniPlayer();
            
            setTimeout(() => {
                if (window.plyrPlayer?.fullscreen) {
                    try { 
                        window.plyrPlayer.fullscreen.enter();
                    } catch (err) {
                        console.warn('Could not enter fullscreen', err);
                    }
                }
            }, 100);
        } else {
            // Other modes: exit mini-player and scroll to inline
            exitMiniPlayer();
            setTimeout(() => {
                container.scrollIntoView({ behavior: "smooth", block: "center" });
            }, 100);
        }
        touchStartY = null;
        touchEndY = null;
        return;
    }
    lastTapTimeMini = now;
}

touchStartY = null;
touchEndY = null;
}

// === Portrait flick to move mini-player corners ===
let flickStartX = null, flickStartY = null;

container.addEventListener('touchstart', e => {
    if (!container.classList.contains('mini-player')) return;
    const t = e.touches[0];
    flickStartX = t.clientX;
    flickStartY = t.clientY;
}, { passive: true });

container.addEventListener('touchend', e => {
    if (!container.classList.contains('mini-player')) return;

    const t = e.changedTouches[0];
    const dx = t.clientX - flickStartX;
    const dy = t.clientY - flickStartY;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    const threshold = 50;
    const isPortrait = window.matchMedia("(orientation: portrait)").matches;

    if (!isPortrait) return;

    if (absDx > threshold || absDy > threshold) {
        if (absDx > absDy) {
            if (dx > 0) {
                container.style.left = "auto";
                container.style.right = "10px";
            } else {
                container.style.left = "10px";
                container.style.right = "auto";
            }
        } else {
            if (dy > 0) {
                container.style.top = "auto";
                container.style.bottom = "10px";
            } else {
                container.style.top = "10px";
                container.style.bottom = "auto";
            }
        }
    }
});

container.addEventListener('touchstart', onTouchStart, { passive: true });
container.addEventListener('touchend', onTouchEnd);


// Anywhere scrubbing & stop button
window.plyrPlayer.on('ready', () => {
enableAnywhereScrubbing();
attachStopButton();
updatePlayerStateClass();
});
window.plyrPlayer.on('loadedmetadata', () => {
attachStopButton();
attachPIPButton(); // Re-attach PIP button on new video
attachIOSFullscreenButton(); // Re-attach iOS fullscreen button on new video
attachManualRotateButton(); // Re-attach manual rotate button on new video
attachScrollLockButton(); // Re-attach scroll-lock button on new video
attachRandomVideoButton(); //  Re-attach random-video button on new video
attachHistorySequenceButton(); //  Re-attach play-through-history button on new video
attachPlayNextButton(); //  Re-attach play-next button on new video
attachBasketQuickButton(); //  Re-attach basket quick-view button on new video
attachBookmarkQuickButton(); //  Re-attach bookmark quick-add button on new video
attachFrameStepButtons(); // Re-attach frame-step buttons on new video
attachColumnFrameStepZones(); // Re-attach single-tap frame-step columns on new video
computeBottomDock(); // ✅ Player height may have changed for the new video
});

// Double-tap gesture handler - works in ALL modes (inline and fullscreen)
function setupDoubleTapHandler() {
 let lastTap = 0;
 
 // Handler function that can be attached to any element
 const handleDoubleTap = function(e) {
     const isMiniPlayer = document.getElementById('inlineVideoContainer')?.classList.contains('mini-player');
     
     // Skip if mini-player
     if (isMiniPlayer) return;
     
     const now = Date.now();
     const tapLength = now - lastTap;
     if (tapLength < 300 && tapLength > 0) {
         e.stopPropagation();
         e.preventDefault();
         
         // Get rect from the actual element being tapped (works in both inline and fullscreen)
         const targetElement = e.currentTarget;
         const rect = targetElement.getBoundingClientRect();
         const tapX = e.changedTouches[0].clientX - rect.left; // Relative to element
         const tapY = e.changedTouches[0].clientY - rect.top;  // Relative to element

         // If manually rotated, convert the raw screen tap into what it
         // would be in genuine landscape mode before doing any zone math
         const rotationRemap = manualRotationActive
             ? remapForManualRotation(e.changedTouches[0].clientX, e.changedTouches[0].clientY, rect)
             : null;
         const effTapX = rotationRemap ? rotationRemap.x : tapX;
         const effTapY = rotationRemap ? rotationRemap.y : tapY;
         const effRect = rotationRemap ? { width: rotationRemap.width, height: rotationRemap.height } : rect;
   
         // Check if we're in landscape mobile mode (real, or forced via manual rotation)
         const isLandscape = isForcedOrRealLandscapeMobile();
         const isMobile = window.innerWidth <= 1024;
         const isPortrait = !isLandscape;
   
         // LANDSCAPE MOBILE: Left half = fullscreen, bottom-right quarter = seeking
if (isLandscape && isMobile) {
    // Divide screen into halves
    const halfWidth = effRect.width / 2;
    const isLeftHalf = effTapX <= halfWidth;
    
    if (isLeftHalf) {
        // Left half double-tap toggles play/pause — applies to both forced
        // (FLS) rotation and genuine device landscape, matching behavior
        // across both landscape modes.
        const willBePaused = !window.plyrPlayer.paused;
        window.plyrPlayer.togglePlay();
        showPlayerFeedback(willBePaused ? '⏸ Paused' : '▶ Playing', 'top-left');
    } else {
        // RIGHT HALF: Only bottom-right quarter has seeking
        const halfHeight = effRect.height / 2;
        const isBottomHalf = effTapY > halfHeight;
        
        if (isBottomHalf) {
            // BOTTOM-RIGHT QUARTER: single row (no sub-split) - -3s (left) or +3s (right).
            // Previously split into a 2x2 sub-grid (-10s/+10s top, -3s/+3s bottom); the
            // bottom sub-row was removed since it conflicted with the frame-step/play-pause
            // circles and player controls, and the remaining tiers shifted down by one.
            const quarterX = (effTapX - halfWidth) / halfWidth;
            const isQuarterLeft = quarterX < 0.5;
            
            if (isQuarterLeft) {
                window.plyrPlayer.currentTime = Math.max(0, window.plyrPlayer.currentTime - 3);
                showPlayerFeedback(`-3s (${formatDuration(window.plyrPlayer.currentTime * 1000)})`, 'top-left');
            } else {
                window.plyrPlayer.currentTime = Math.min(window.plyrPlayer.duration, window.plyrPlayer.currentTime + 3);
                showPlayerFeedback(`+3s (${formatDuration(window.plyrPlayer.currentTime * 1000)})`, 'top-right');
            }
        } else {
           // TOP-RIGHT QUARTER: 2x2 sub-grid for longer seeking
           const quarterX = (effTapX - halfWidth) / halfWidth;
           const quarterY = effTapY / halfHeight; // Relative to top half
           
           const isQuarterLeft = quarterX < 0.5;
           const isQuarterTop = quarterY < 0.5;
           
           if (isQuarterTop) {
               // Top half of quarter: -30s (left) or +30s (right)
               if (isQuarterLeft) {
                   window.plyrPlayer.currentTime = Math.max(0, window.plyrPlayer.currentTime - 30);
                   showPlayerFeedback(`-30s (${formatDuration(window.plyrPlayer.currentTime * 1000)})`, 'top-left');
               } else {
                   window.plyrPlayer.currentTime = Math.min(window.plyrPlayer.duration, window.plyrPlayer.currentTime + 30);
                   showPlayerFeedback(`+30s (${formatDuration(window.plyrPlayer.currentTime * 1000)})`, 'top-right');
               }
           } else {
               // Bottom half of quarter: -10s (left) or +10s (right)
               if (isQuarterLeft) {
                   window.plyrPlayer.currentTime = Math.max(0, window.plyrPlayer.currentTime - 10);
                   showPlayerFeedback(`-10s (${formatDuration(window.plyrPlayer.currentTime * 1000)})`, 'top-left');
               } else {
                   window.plyrPlayer.currentTime = Math.min(window.plyrPlayer.duration, window.plyrPlayer.currentTime + 10);
                   showPlayerFeedback(`+10s (${formatDuration(window.plyrPlayer.currentTime * 1000)})`, 'top-right');
               }
           }
       }
    }
} else {
    // ✅ PORTRAIT MOBILE: Divide left/right into 3 vertical sections
    const leftThird = effRect.width / 3;
    const rightThird = (effRect.width / 3) * 2;
    const topThird = effRect.height / 3;
    const bottomThird = (effRect.height / 3) * 2;
    
    if (effTapX < leftThird) {
        // Left third: same behavior as tapping the rotate button -
        // enters forced landscape fullscreen (auto-entering real fullscreen
        // first if needed), instead of plain fullscreen toggle. If already
        // in forced rotation, this toggles it back off via the same path
        // the rotate button uses.
        if (typeof window.toggleManualRotation === 'function') {
            window.toggleManualRotation();
        } else if (window.plyrPlayer.fullscreen.active) {
            window.plyrPlayer.fullscreen.exit();
            showPlayerFeedback('Exit Fullscreen', 'top-left');
        } else {
            window.plyrPlayer.fullscreen.enter();
            showPlayerFeedback('Enter Fullscreen', 'top-left');
        }
    } else if (effTapX > rightThird) {
        // Right third: divide into 3 vertical sections (bottom to top: +3s, +10s, +30s)
        if (effTapY > bottomThird) {
            // Bottom section: +3s
            window.plyrPlayer.currentTime = Math.min(window.plyrPlayer.duration, window.plyrPlayer.currentTime + 3);
            showPlayerFeedback(`+3s (${formatDuration(window.plyrPlayer.currentTime * 1000)})`, 'top-right');
        } else if (effTapY > topThird) {
            // Middle section: +10s
            window.plyrPlayer.currentTime = Math.min(window.plyrPlayer.duration, window.plyrPlayer.currentTime + 10);
            showPlayerFeedback(`+10s (${formatDuration(window.plyrPlayer.currentTime * 1000)})`, 'top-right');
        } else {
            // Top section: +30s
            window.plyrPlayer.currentTime = Math.min(window.plyrPlayer.duration, window.plyrPlayer.currentTime + 30);
            showPlayerFeedback(`+30s (${formatDuration(window.plyrPlayer.currentTime * 1000)})`, 'top-right');
        }
    } else {
        // Middle third: divide into 3 vertical sections (bottom to top: -3s, -10s, -30s)
        if (effTapY > bottomThird) {
            // Bottom section: -3s
            window.plyrPlayer.currentTime = Math.max(0, window.plyrPlayer.currentTime - 3);
            showPlayerFeedback(`-3s (${formatDuration(window.plyrPlayer.currentTime * 1000)})`, 'top-left');
        } else if (effTapY > topThird) {
            // Middle section: -10s
            window.plyrPlayer.currentTime = Math.max(0, window.plyrPlayer.currentTime - 10);
            showPlayerFeedback(`-10s (${formatDuration(window.plyrPlayer.currentTime * 1000)})`, 'top-left');
        } else {
            // Top section: -30s
            window.plyrPlayer.currentTime = Math.max(0, window.plyrPlayer.currentTime - 30);
            showPlayerFeedback(`-30s (${formatDuration(window.plyrPlayer.currentTime * 1000)})`, 'top-left');
        }
    }
}
     }
     
     lastTap = now;
 };
  
  // ✅ Attach to inline player initially
  const plyrWrapper = document.querySelector('.plyr');
  if (plyrWrapper) {
      plyrWrapper.addEventListener('touchend', handleDoubleTap);
      console.log('✅ Double-tap handler attached to inline player');
  }
  
  // ✅ Re-attach when entering fullscreen
window.plyrPlayer.on('enterfullscreen', () => {
setTimeout(() => {
    // Attach to fullscreen element AND video wrapper for redundancy
    const fullscreenPlyr = document.querySelector('.plyr--fullscreen');
    const fullscreenWrapper = document.querySelector('.plyr--fullscreen .plyr__video-wrapper');
    
    if (fullscreenPlyr) {
        fullscreenPlyr.addEventListener('touchend', handleDoubleTap);
        console.log('✅ Double-tap handler attached to fullscreen player');
    }
    
    if (fullscreenWrapper) {
        fullscreenWrapper.addEventListener('touchend', handleDoubleTap);
        console.log('✅ Double-tap handler also attached to video wrapper');
    }
    
    // ✅ Log touch-action to verify it's not blocked
    if (fullscreenPlyr) {
        const computedStyle = window.getComputedStyle(fullscreenPlyr);
        console.log('Fullscreen touch-action:', computedStyle.touchAction);
    }
}, 500); // ✅ Increased from 200ms to 500ms - give fullscreen more time to stabilize
});
  
  // ✅ Re-attach when exiting fullscreen
  window.plyrPlayer.on('exitfullscreen', () => {
      setTimeout(() => {
          const inlinePlyr = document.querySelector('.plyr:not(.plyr--fullscreen)');
          if (inlinePlyr) {
              inlinePlyr.addEventListener('touchend', handleDoubleTap);
              console.log('✅ Double-tap handler re-attached to inline player');
          }
      }, 200);
  });
}

// ✅ Initialize double-tap handling
setupDoubleTapHandler();

// Prevent pinch-zoom
container.addEventListener('gesturestart', (e) => { e.preventDefault(); });
container.addEventListener('gesturechange', (e) => { e.preventDefault(); });
container.addEventListener('gestureend', (e) => { e.preventDefault(); });
container.addEventListener('touchmove', (e) => {
if (e.scale && e.scale !== 1) e.preventDefault();
}, { passive: false });
}  // ← This closes the `if (!container)` block

// ✅ ADD THIS SECTION HERE (outside the if block, but inside the function)
let videoInfo = document.getElementById("currentVideoInfo");
if (!videoInfo) {
videoInfo = document.createElement("div");
videoInfo.id = "currentVideoInfo";
videoInfo.className = "current-video-info";
container.insertAdjacentElement("afterend", videoInfo);
console.log("✅ Video info display created");
}

}  // ← This closes the `createPlayerElement()` function



// ========================
// Show error overlay - red box on dark transparent background
// ========================
function showVideoError(message, video = null) {
// ✅ On mobile, use fullscreen overlay for better visibility
const isMobile = window.innerWidth <= 768;

let overlay;
if (isMobile) {
    // Create or reuse fullscreen overlay
    overlay = document.getElementById('video-error-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'video-error-overlay';
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.8);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
            padding: 20px;
            box-sizing: border-box;
        `;
        document.body.appendChild(overlay);
    }
    overlay.innerHTML = '';
    overlay.style.display = 'flex';
    overlay.style.background = 'rgba(0, 0, 0, 0.8)';
} else {
    // Desktop: use the player's loading overlay
    overlay = document.getElementById('plyr-loading-overlay');
    if (!overlay) return;
    overlay.innerHTML = '';
    overlay.style.display = 'block';
    overlay.style.background = 'rgba(0,0,0,0.7)';
}

overlay.style.color = 'white';
overlay.style.padding = isMobile ? '0' : '20px';
overlay.style.textAlign = 'center';
overlay.style.cursor = 'default';
overlay.style.pointerEvents = 'auto';
if (!isMobile) {
    overlay.style.maxWidth = '90%';
}

// Create RED content box
const contentDiv = document.createElement('div');
contentDiv.style.cssText = `
    background: #c80000;
    color: white;
    padding: 30px;
    border-radius: 8px;
    max-width: 90%;
    text-align: center;
    box-shadow: 0 4px 20px rgba(0,0,0,0.5);
`;

// Create message text
const messageDiv = document.createElement('div');
messageDiv.textContent = `Error: ${message}`;
messageDiv.style.marginBottom = '15px';
messageDiv.style.fontSize = '1rem';
messageDiv.style.lineHeight = '1.4';
contentDiv.appendChild(messageDiv);

// ✅ Try to identify the account from the video object
let msalAccount = null;
if (video && video.accountKey) {
    const [accountIdStored] = video.accountKey.split("::");
    msalAccount = msalInstance.getAllAccounts().find(acc => 
        acc.homeAccountId === accountIdStored
    );
}

// If we have an account, offer re-authentication
if (msalAccount) {
    const buttonContainer = document.createElement('div');
    buttonContainer.style.display = 'flex';
    buttonContainer.style.gap = '10px';
    buttonContainer.style.justifyContent = 'center';
    buttonContainer.style.marginTop = '15px';
    
    const reAuthBtn = document.createElement('button');
    reAuthBtn.textContent = 'Sign In Again';
    reAuthBtn.style.cssText = `
        background: white;
        color: #c80000;
        border: none;
        padding: 10px 20px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 1rem;
        font-weight: bold;
        pointer-events: auto;
    `;
    
    reAuthBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        e.preventDefault();
        
        console.log('Re-auth button clicked for playback');
        reAuthBtn.disabled = true;
        reAuthBtn.textContent = 'Signing in...';
        reAuthBtn.style.opacity = '0.6';
        
        try {
            const result = await msalInstance.acquireTokenPopup({
                account: msalAccount,
                scopes: ["Files.Read.All", "Sites.Read.All"]
            });
            
            console.log('Re-auth successful:', result);
            
            // Update the account token in storage
            const accountInfo = accountsData.find(acc => acc.accountId === msalAccount.homeAccountId);
            if (accountInfo) {
                accountInfo.token = result.accessToken;
                saveAccountsToStorage();
            }
            
            overlay.style.display = 'none';           
                        
            // ✅ AUTO-RETRY: Automatically replay the video instead of showing alert
            if (video) {
            console.log('Auto-retrying video playback after successful re-auth');
            // Small delay to ensure overlay is fully dismissed
            setTimeout(async () => {
                const context = currentListContext || null;
                const index = currentVideoIndex !== null ? currentVideoIndex : null;
                await playVideoInline(video, context, index);
            }, 100);
            } else {
            alert('Sign-in successful!');
            }
        } catch (popupErr) {
            console.error('Re-auth popup failed:', popupErr);
            messageDiv.textContent = `Error: Sign-in failed - ${popupErr.message || 'Please try again'}`;
            reAuthBtn.disabled = false;
            reAuthBtn.textContent = 'Try Again';
            reAuthBtn.style.opacity = '1';
        }
    });
    
    const dismissBtn = document.createElement('button');
    dismissBtn.textContent = 'Dismiss';
    dismissBtn.style.cssText = `
        background: transparent;
        color: white;
        border: 2px solid white;
        padding: 10px 20px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 1rem;
        pointer-events: auto;
    `;
    
    dismissBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        
        console.log('Dismiss button clicked');
        overlay.style.display = 'none';
    });
    
    buttonContainer.appendChild(reAuthBtn);
    buttonContainer.appendChild(dismissBtn);
    contentDiv.appendChild(buttonContainer);
    
} else {
    // No account identified - just add dismiss button
    const dismissBtn = document.createElement('button');
    dismissBtn.textContent = 'Dismiss';
    dismissBtn.style.cssText = `
        background: white;
        color: #c80000;
        border: none;
        padding: 10px 20px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 1rem;
        font-weight: bold;
        margin-top: 15px;
        pointer-events: auto;
    `;
    
    dismissBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        
        console.log('Dismiss button clicked');
        overlay.style.display = 'none';
    });
    
    contentDiv.appendChild(dismissBtn);
    
    // Auto-hide after 8 seconds
    setTimeout(() => {
        if (overlay.style.display !== 'none') {
            overlay.style.display = 'none';
        }
    }, 8000);
}

overlay.appendChild(contentDiv);

// Click outside to dismiss
overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
        overlay.style.display = 'none';
    }
});
}


// ========================
// Show file not found overlay
// ========================
function showFileNotFoundError(video = null) {
   // ✅ On mobile, use fullscreen overlay for better visibility
   const isMobile = window.innerWidth <= 768;

   let overlay;
   if (isMobile) {
       // Create or reuse fullscreen overlay
       overlay = document.getElementById('video-error-overlay');
       if (!overlay) {
           overlay = document.createElement('div');
           overlay.id = 'video-error-overlay';
           overlay.style.cssText = `
               position: fixed;
               top: 0;
               left: 0;
               width: 100%;
               height: 100%;
               background: rgba(0, 0, 0, 0.8);
               display: flex;
               align-items: center;
               justify-content: center;
               z-index: 10000;
               padding: 20px;
               box-sizing: border-box;
           `;
           document.body.appendChild(overlay);
       }
       overlay.innerHTML = '';
       overlay.style.display = 'flex';
       overlay.style.background = 'rgba(0, 0, 0, 0.8)';
   } else {
       // Desktop: use the player's loading overlay
       overlay = document.getElementById('plyr-loading-overlay');
       if (!overlay) return;
       overlay.innerHTML = '';
       overlay.style.display = 'block';
       overlay.style.background = 'rgba(0,0,0,0.7)';
   }

   overlay.style.color = 'white';
   overlay.style.padding = isMobile ? '0' : '20px';
   overlay.style.textAlign = 'center';
   overlay.style.cursor = 'default';
   overlay.style.pointerEvents = 'auto';
   if (!isMobile) {
       overlay.style.maxWidth = '90%';
   }

   // Create ORANGE content box (less alarming than red)
   const contentDiv = document.createElement('div');
   contentDiv.style.cssText = `
       background: #ff9800;
       color: white;
       padding: 30px;
       border-radius: 8px;
       max-width: 90%;
       text-align: center;
       box-shadow: 0 4px 20px rgba(0,0,0,0.5);
   `;

   // Create message text
   const messageDiv = document.createElement('div');
   messageDiv.style.cssText = `
       margin-bottom: 20px;
       font-size: 1rem;
       line-height: 1.4;
   `;
   
   // Show filename if available
   if (video && video.filename) {
       const filenameDiv = document.createElement('div');
       filenameDiv.textContent = video.filename;
       filenameDiv.style.cssText = `
           font-weight: bold;
           margin-bottom: 12px;
           font-size: 1.1rem;
       `;
       messageDiv.appendChild(filenameDiv);
   }
   
   // ✅ Show account name if available
   if (video && video.accountName) {
       const accountDiv = document.createElement('div');
       accountDiv.textContent = `Account: ${video.accountName}`;
       accountDiv.style.cssText = `
           font-size: 0.9rem;
           margin-bottom: 12px;
           opacity: 0.9;
       `;
       messageDiv.appendChild(accountDiv);
   }
   
   const errorText = document.createElement('div');
   errorText.textContent = 'Video not found - possibly deleted';
   messageDiv.appendChild(errorText);
   
   const suggestionText = document.createElement('div');
   suggestionText.textContent = 'Check OneDrive recycle bin';
   suggestionText.style.marginTop = '8px';
   messageDiv.appendChild(suggestionText);
   
   contentDiv.appendChild(messageDiv);

   // Button container
   const buttonContainer = document.createElement('div');
   buttonContainer.style.cssText = `
       display: flex;
       gap: 10px;
       justify-content: center;
       margin-top: 20px;
   `;
   
   // ✅ Construct recycle bin URL with drive ID if available
   let recycleBinUrl = 'https://onedrive.live.com/?view=5';
   
   if (video && video.driveId) {
       // Try to target specific account using drive ID
       recycleBinUrl = `https://onedrive.live.com/?id=root&cid=${video.driveId}&view=5`;
   }
   
   // Link to OneDrive Recycle Bin
   const recycleBinBtn = document.createElement('a');
   recycleBinBtn.textContent = 'Open Recycle Bin';
   recycleBinBtn.href = recycleBinUrl;
   recycleBinBtn.target = '_blank';
   recycleBinBtn.style.cssText = `
       background: white;
       color: #ff9800;
       border: none;
       padding: 12px 24px;
       border-radius: 6px;
       cursor: pointer;
       font-size: 1rem;
       font-weight: bold;
       text-decoration: none;
       display: inline-block;
   `;
   
   recycleBinBtn.addEventListener('click', (e) => {
       e.stopPropagation();
       // ✅ Note: if multiple accounts, user may need to verify correct account
       if (video && video.accountName) {
           console.log(`Opening recycle bin for account: ${video.accountName}`);
       }
   });
   
   const dismissBtn = document.createElement('button');
   dismissBtn.textContent = 'Dismiss';
   dismissBtn.style.cssText = `
       background: transparent;
       color: white;
       border: 2px solid white;
       padding: 12px 24px;
       border-radius: 6px;
       cursor: pointer;
       font-size: 1rem;
       pointer-events: auto;
   `;
   
   dismissBtn.addEventListener('click', (e) => {
       e.stopPropagation();
       e.preventDefault();
       
       console.log('Dismiss button clicked');
       overlay.style.display = 'none';
   });
   
   buttonContainer.appendChild(recycleBinBtn);
   buttonContainer.appendChild(dismissBtn);
   contentDiv.appendChild(buttonContainer);

   overlay.appendChild(contentDiv);

   // Click outside to dismiss
   overlay.addEventListener('click', (e) => {
       if (e.target === overlay) {
           overlay.style.display = 'none';
       }
   });
}



// ========================
// Show download error overlay with smart auth detection
// ========================
function showDownloadError(message, video = null) {
// Create overlay if it doesn't exist
let overlay = document.getElementById('download-error-overlay');
if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'download-error-overlay';
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.8);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
        padding: 20px;
        box-sizing: border-box;
    `;
    document.body.appendChild(overlay);
}

// Clear any existing content
overlay.innerHTML = '';
overlay.style.display = 'flex';

// Create content container - RED BOX
const contentDiv = document.createElement('div');
contentDiv.style.cssText = `
    background: #c80000;
    color: white;
    padding: 30px;
    border-radius: 8px;
    max-width: 90%;
    text-align: center;
    box-shadow: 0 4px 20px rgba(0,0,0,0.5);
`;

// Create message text
const messageDiv = document.createElement('div');
messageDiv.textContent = `Download Error: ${message}`;
messageDiv.style.cssText = `
    margin-bottom: 20px;
    font-size: 1.1rem;
    line-height: 1.4;
`;
contentDiv.appendChild(messageDiv);

// ✅ Try to identify the account from the video object
let msalAccount = null;
if (video && video.accountKey) {
    const [accountIdStored] = video.accountKey.split("::");
    msalAccount = msalInstance.getAllAccounts().find(acc => 
        acc.homeAccountId === accountIdStored
    );
}

// If we have an account, offer re-authentication
if (msalAccount) {
    const buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = `
        display: flex;
        gap: 10px;
        justify-content: center;
        margin-top: 20px;
    `;
    
    const reAuthBtn = document.createElement('button');
    reAuthBtn.textContent = 'Sign In Again';
    reAuthBtn.style.cssText = `
        background: white;
        color: #c80000;
        border: none;
        padding: 12px 24px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 1rem;
        font-weight: bold;
    `;
    
    reAuthBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        
        console.log('Re-auth button clicked for download');
        reAuthBtn.disabled = true;
        reAuthBtn.textContent = 'Signing in...';
        reAuthBtn.style.opacity = '0.6';
        
        try {
            const result = await msalInstance.acquireTokenPopup({
                account: msalAccount,
                scopes: ["Files.Read.All", "Sites.Read.All"]
            });
            
            console.log('Re-auth successful:', result);
            
            // Update the account token in storage
            const accountInfo = accountsData.find(acc => acc.accountId === msalAccount.homeAccountId);
            if (accountInfo) {
                accountInfo.token = result.accessToken;
                saveAccountsToStorage();
            }
            
            overlay.style.display = 'none';
            
            alert('Sign-in successful! Please try downloading again.');
        } catch (popupErr) {
            console.error('Re-auth popup failed:', popupErr);
            messageDiv.textContent = `Download Error: Sign-in failed - ${popupErr.message || 'Please try again'}`;
            reAuthBtn.disabled = false;
            reAuthBtn.textContent = 'Try Again';
            reAuthBtn.style.opacity = '1';
        }
    });
    
    const dismissBtn = document.createElement('button');
    dismissBtn.textContent = 'Dismiss';
    dismissBtn.style.cssText = `
        background: transparent;
        color: white;
        border: 2px solid white;
        padding: 12px 24px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 1rem;
    `;
    
    dismissBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        console.log('Dismiss button clicked');
        overlay.style.display = 'none';
    });
    
    buttonContainer.appendChild(reAuthBtn);
    buttonContainer.appendChild(dismissBtn);
    contentDiv.appendChild(buttonContainer);
    
} else {
    // No account identified - just add dismiss button
    const dismissBtn = document.createElement('button');
    dismissBtn.textContent = 'Dismiss';
    dismissBtn.style.cssText = `
        background: white;
        color: #c80000;
        border: none;
        padding: 12px 24px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 1rem;
        font-weight: bold;
        margin-top: 20px;
    `;
    
    dismissBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        console.log('Dismiss button clicked');
        overlay.style.display = 'none';
    });
    
    contentDiv.appendChild(dismissBtn);
    
    // Auto-hide after 8 seconds
    setTimeout(() => {
        if (overlay.style.display === 'flex') {
            overlay.style.display = 'none';
        }
    }, 8000);
}

overlay.appendChild(contentDiv);

// Click outside to dismiss
overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
        overlay.style.display = 'none';
    }
});
}



// ========================
// Refresh before playback
// ========================
async function refreshVideoBeforeUse(video) {
   // Local videos need no refreshing — this function exists purely for
   // OneDrive's expiring download URLs, which don't apply here.
   if (video.driveId === "local" || (video.accountKey || "").startsWith("local::")) {
       return video;
   }
   try {
       const [accountIdStored] = (video.accountKey || "").split("::");
       let accountInfo = accountsData.find(acc => acc.accountId === accountIdStored);
       
       if (!accountInfo) {
           const errorMsg = `Account not found for video: ${video.filename}`;
           console.warn(errorMsg);
           throw new Error(errorMsg);
       }
       
        try {
        accountInfo.token = await refreshTokenForAccount(accountIdStored);
        saveAccountsToStorage();
        } catch (tokenErr) {
        // Pass through the auth error so the UI can offer re-auth button
        if (tokenErr.needsReauth) {
            throw tokenErr;
        }
        throw new Error(`Authentication failed: ${tokenErr.message || 'Token refresh failed'}`);
        }

       if (!video.oneDriveId || !video.driveId ||
           video.driveId === "unknownDrive" || video.driveId === "undefined") {
           console.log(`Healing IDs for ${video.filename}`);
           await healBasketItemIds(video, accountInfo);
       }
       
       if (!video.driveId || !video.oneDriveId) {
           throw new Error(`Missing OneDrive IDs — cannot refresh metadata for ${video.filename}`);
       }
       
       const url = `https://graph.microsoft.com/v1.0/drives/${video.driveId}/items/${video.oneDriveId}`;
       const updated = await fetchJSONWithRetry(url, accountInfo.token);

       video.downloadUrl = updated['@microsoft.graph.downloadUrl'];
       video.webUrl = updated.webUrl;
       video.sizeBytes = updated.size;
       video.filename = updated.name;
       video.durationMs = updated.video?.duration ?? video.durationMs;

       console.log(`Video refreshed successfully: ${video.filename}`);
       return video;
   } catch (err) {
       console.error("Error in refreshVideoBeforeUse:", err);
       throw err;
   }
}

window.refreshVideoBeforeUse = refreshVideoBeforeUse;

// ========================
// Play video inline
// ========================
async function playVideoInline(video, listContext = null, index = null) {
console.log("playVideoInline CALLED with video =", video);
currentListContext = listContext;
currentVideoIndex = index;
window.currentPlayingVideo = video; // Store for highlight updates

// Remember whether forced (manual-rotate) landscape mode was active
// before this video starts loading, so we can restore it below - some
// mobile browsers exit real fullscreen when the video source changes,
// and per-video DOM (like the progress bar) gets recreated on load.
const wasForcedLandscapeBeforeLoad = manualRotationActive;

// Reset mini-player dismiss flag when new video loads
miniPlayerManuallyDismissed = false;

// ✅ Reset history sequence if playing from non-history context
if (listContext !== 'history' && typeof window.resetHistoryPlayIndex === 'function') {
window.resetHistoryPlayIndex();
console.log('Reset H< button - playing from non-history context');
}

// ✅ Mobile: auto-scroll to player IMMEDIATELY upon play request
if (window.innerWidth <= 1024) {
const container = document.getElementById("inlineVideoContainer");
if (container) {
    container.scrollIntoView({ behavior: "smooth", block: "center" });
}
}

// Show loading overlay immediately
const loadingOverlay = document.getElementById('plyr-loading-overlay');
if (loadingOverlay) {
window.currentLoadingFilename = video.filename || '';
window.currentLoadingPath = video.path || '';

// ✅ If this play was triggered by one of the quick-action buttons (X,
// H<, >, Xn), show a small label above the path/filename identifying
// which one picked it. Stored on window.currentLoadingLabel (not just a
// local var) so the 'progress' event handler below - which rebuilds this
// overlay's innerHTML on every buffered-range update - can keep
// re-including it instead of wiping it out a moment after it appears.
window.currentLoadingLabel = window.lastPlayLabel || null;
window.lastPlayLabel = null; // consume the flag - only applies to this triggered play

const playSourceLabel = window.currentLoadingLabel
    ? `<div style="font-size: 0.65rem; opacity: 0.9; margin-bottom: 4px; color: #ff9800; font-weight: bold;">${window.currentLoadingLabel}</div>`
    : '';

if (video.path) {
    loadingOverlay.innerHTML = `
        ${playSourceLabel}
        <div style="font-size: 0.65rem; opacity: 0.8; margin-bottom: 4px;">Loading from: ${video.path}</div>
        <div style="font-size: 0.9rem; font-weight: bold;">${window.currentLoadingFilename}</div>
    `;
} else {
    loadingOverlay.innerHTML = `
        ${playSourceLabel}
        <div style="font-size: 0.9rem; font-weight: bold;">Loading: ${window.currentLoadingFilename}</div>
    `;
}

// Update PIP title if in PIP mode
if (typeof updatePIPTitle === 'function') {
   updatePIPTitle(window.currentLoadingFilename);
}
loadingOverlay.style.display = 'block';
loadingOverlay.style.background = 'rgba(0,0,0,0.7)';
loadingOverlay.style.padding = '8px 16px';
loadingOverlay.style.maxWidth = '90%';
loadingOverlay.style.cursor = 'default';
loadingOverlay.style.lineHeight = '1.3';
loadingOverlay.style.whiteSpace = 'normal';
loadingOverlay.style.wordBreak = 'break-word';
loadingOverlay.onclick = null;
}

// 📝 ADD TO HISTORY IMMEDIATELY (before attempting play)
if (typeof window.addToHistory === 'function') {
window.addToHistory(video);
}

// Track view in Excel Online if auto-tracking enabled
const autoTrackActive = typeof window.isAutoTrackEnabled === 'function' ? window.isAutoTrackEnabled() : true;
if (autoTrackActive && typeof window.updateVideoInExcel === 'function') {
  window.queueExcelUpdate(video, {
    increment_views: true,
    played_now: true
}).catch(err => {
    console.warn("Failed to track video view:", err);
});
}

// Extract video info building into reusable global function
window.rebuildVideoInfoDisplay = function(video) {
// ✅ CRITICAL FIX: Always ensure element exists before rebuilding
let videoInfoEl = document.getElementById("currentVideoInfo");
if (!videoInfoEl) {
console.warn('Video info element missing - recreating it');
const container = document.getElementById("inlineVideoContainer");
if (container) {
    videoInfoEl = document.createElement("div");
    videoInfoEl.id = "currentVideoInfo";
    videoInfoEl.className = "current-video-info";
    container.insertAdjacentElement("afterend", videoInfoEl);
    console.log('✅ Recreated video info display');
} else {
    console.error('Cannot recreate video info - player container not found');
    return;
}
}

videoInfoEl.innerHTML = ''; // Clear existing content

// Parse path into folders
if (video.path) {
const folders = video.path.split('/').filter(Boolean);

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
const tagName = folder.trim().replace(/\s+/g, "-").toLowerCase();
const displayName = folder;

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
 // Add to default exclude list in Excel
 if (typeof window.addTagToDefaultExcludeList === 'function') {
   try {
     const result = await window.addTagToDefaultExcludeList(tagName);
     if (result.alreadyExists) {
       showScoreConfirmation(`"${displayName}" already in default exclude list`, '#ffa500');
     } else if (result.success) {
       showScoreConfirmation(`✅ Added "${displayName}" to default exclude list`);
     }
   } catch (err) {
     console.error('Failed to add to default exclude list:', err);
     if (err.message === 'NOT_CONNECTED') {
       showScoreConfirmation('❌ Excel Online not connected', '#f44336');
       if (confirm('Excel Online not connected. Connect now?')) {
         window.signInToExcelOnline();
       }
     } else {
       showScoreConfirmation('❌ Failed to save', '#f44336');
       alert(`Failed to add to default exclude list: ${err.message}`);
     }
   }
 }
}
});
  
  videoInfoEl.appendChild(folderSpan);
  
  // Add separator
  if (index < folders.length - 1) {
    const separator = document.createElement('span');
    separator.textContent = ' / ';
    separator.style.color = '#666';
    videoInfoEl.appendChild(separator);
  }
});

// Add separator before filename
const separator = document.createElement('span');
separator.textContent = ' / ';
separator.style.color = '#666';
videoInfoEl.appendChild(separator);
}

// Add filename with clickable bracket tags
const filenameSpan = document.createElement('span');
filenameSpan.style.cursor = 'pointer';
filenameSpan.style.color = '#555';
filenameSpan.title = 'Click to rename file';

// ✅ Use createClickableFilename to make bracket tags clickable
if (typeof window.createClickableFilename === 'function') {
const filenameFragment = window.createClickableFilename(video.filename);
while (filenameFragment.firstChild) {
    filenameSpan.appendChild(filenameFragment.firstChild);
}
} else {
filenameSpan.textContent = video.filename || 'Unknown';
}

// Check if video is in basket and highlight
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

// Apply basket highlight if in basket
const updateNowPlayingHighlight = () => {
const isInBasket = window.basketVideos && window.basketVideos.some(v => v.oneDriveId === oneDriveId);
if (isInBasket) {
    filenameSpan.style.backgroundColor = 'rgb(249,215,221)';
    filenameSpan.style.padding = '2px 4px';
    filenameSpan.style.borderRadius = '2px';
} else {
    filenameSpan.style.backgroundColor = 'transparent';
    filenameSpan.style.padding = '0';
}
};

// Initial highlight check
updateNowPlayingHighlight();

// Open rename modal when clicking filename
filenameSpan.addEventListener('click', async (e) => {
e.stopPropagation();

// Only open rename modal (basket toggle now handled by B button)
if (typeof window.showRenameModal === 'function') {
await window.showRenameModal(video);
}
});

videoInfoEl.appendChild(filenameSpan);

// ✅ ADD SCORE DISPLAY (if available from Excel)
const scoreSpan = document.createElement('span');
if (video.userScore !== undefined && video.userScore !== null) {
scoreSpan.textContent = ` [${video.userScore}]`;
scoreSpan.style.marginLeft = '4px';
scoreSpan.style.fontSize = '0.65rem';
scoreSpan.style.color = '#ff9800';
scoreSpan.style.fontWeight = 'bold';
scoreSpan.style.display = 'inline';
videoInfoEl.appendChild(scoreSpan);
}

// ✅ ADD FILE SIZE (now inside the if block)
if (typeof video.sizeBytes === 'number') {
const sizeSpan = document.createElement('span');
sizeSpan.textContent = ` [${formatFileSize(video.sizeBytes)}]`;
sizeSpan.style.fontSize = '0.65rem';
sizeSpan.style.color = '#666';
sizeSpan.style.marginLeft = '4px';
videoInfoEl.appendChild(sizeSpan);
}

// ADD BUTTON GROUP (replacing download link)
const isYetToUpload = video.path === "yet-to-upload" || 
                  (Array.isArray(video.tags) && video.tags.includes("yet-to-upload"));

const buttons = [
{
label: "P",
title: "Play video",
color: "#28a745",
onClick: async (e) => {
    e.stopPropagation();
    // Replay current video
    await playVideoInline(video, currentListContext, currentVideoIndex);
}
},
{
label: "D",
title: "Download",
disabled: isYetToUpload,
onClick: async (e) => {
    e.stopPropagation();
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
  
  // Update currently playing video reference
  const existingIndex = basketVideos.findIndex(v => v.oneDriveId === oneDriveId);
  if (existingIndex >= 0) {
      basketVideos.splice(existingIndex, 1);
      saveBasket();
      renderBasket();
  } else {
      addToBasket({ ...video, oneDriveId, driveId });
  }
  
  // Update the now playing highlight
  if (typeof window.updateNowPlayingBasketHighlight === 'function') {
      window.updateNowPlayingBasketHighlight();
  }
  if (window.updateBasketHighlights) window.updateBasketHighlights();
}
},
{
   label: "BM",
   title: "Bookmarks",
   color: "#6f42c1",
   fontSize: "0.55rem",
   onClick: (e) => {
       e.stopPropagation();
       // Pause video when opening bookmarks
       if (window.plyrPlayer && !window.plyrPlayer.paused) {
           window.plyrPlayer.pause();
       }
       if (typeof window.showBookmarksModal === 'function') {
           window.showBookmarksModal(video, true);
       }
   }
 },
{
label: "Move",
title: "Move file to different folder",
color: "#9c27b0",
disabled: isYetToUpload,
onClick: async (e) => {
  e.stopPropagation();
  if (typeof window.showMoveFileModal === 'function') {
      await window.showMoveFileModal(video);
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
       const refreshedVideo = await refreshSingleVideoComprehensive(video);
       
       // Update current playing video
       window.currentPlayingVideo = refreshedVideo;
       
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
       
       // Refresh tag dropdowns
       if (typeof populateTagDropdowns === 'function') {
           await populateTagDropdowns();
       }
       
       // Rebuild video info display with updated data
       if (typeof window.rebuildVideoInfoDisplay === 'function') {
           window.rebuildVideoInfoDisplay(refreshedVideo);
       }
       
       // Refresh all lists
       if (typeof refreshAllLists === 'function') {
           refreshAllLists();
       }
       
       console.log(`Refreshed now playing video: ${refreshedVideo.filename}`);
   } catch (err) {
       console.error('Failed to refresh video:', err);
       alert(`Refresh failed: ${err.message}`);
   }
}
},
{
label: "Open Link",
title: "Open in OneDrive",
disabled: !video.webUrl || isYetToUpload,
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
    onClick: async (e) => {
        e.stopPropagation();
        if (typeof window.showDeleteModal === 'function') {
            await window.showDeleteModal(video);
        }
    }
}
];

const btnContainer = createCompactButtonGroup(buttons, 5);
btnContainer.style.marginLeft = '8px';
btnContainer.style.display = 'inline-flex';
videoInfoEl.appendChild(btnContainer);

// Add right-click context menu to video info (desktop only)
if (window.innerWidth >= 769) {
videoInfoEl.style.cursor = 'context-menu';

// Remove any existing context menu listener to prevent duplicates
const oldListener = videoInfoEl._contextMenuListener;
if (oldListener) {
    videoInfoEl.removeEventListener('contextmenu', oldListener);
}

// Create new listener
const contextMenuListener = (e) => {
    e.preventDefault();
    e.stopPropagation();
    showContextMenu(buttons.slice(5), e); // Show overflow menu (buttons after first 5)
};

videoInfoEl.addEventListener('contextmenu', contextMenuListener);

// Store reference for cleanup
videoInfoEl._contextMenuListener = contextMenuListener;

console.log('Right-click context menu enabled for video info');
}

computeBottomDock(); // Info bar height may have changed - recompute dock

}; // This closes the rebuildVideoInfoDisplay function

// ✅ CRITICAL FIX: Ensure video info element exists before rebuilding
let videoInfoCheck = document.getElementById("currentVideoInfo");
if (!videoInfoCheck) {
console.warn('Video info element missing before rebuild - recreating it');
const container = document.getElementById("inlineVideoContainer");
if (container) {
    videoInfoCheck = document.createElement("div");
    videoInfoCheck.id = "currentVideoInfo";
    videoInfoCheck.className = "current-video-info";
    container.insertAdjacentElement("afterend", videoInfoCheck);
    console.log('✅ Recreated video info display before initial build');
}
}

// ✅ Call the function to build initial video info
window.rebuildVideoInfoDisplay(video);

// ✅ LANDSCAPE FIX: Temporarily disable absolute positioning during load
const isLandscape = window.matchMedia('(orientation: landscape)').matches;
const isMobile = window.innerWidth <= 1024;
const playerContainer = document.getElementById('inlineVideoContainer');

if (isLandscape && isMobile && playerContainer) {
 console.log('📱 Landscape detected - temporarily disabling absolute positioning for load');
 
 // Add a temporary class to override absolute positioning
 document.body.classList.add('video-loading-landscape');
 
 // Remove it once video starts playing
 const removeLoadingClass = () => {
     document.body.classList.remove('video-loading-landscape');
     console.log('✅ Absolute positioning restored after video loaded');
 };
 
 window.plyrPlayer.once('playing', removeLoadingClass);
 window.plyrPlayer.once('error', removeLoadingClass);
}

try {
video = await refreshVideoBeforeUse(video);
} catch (err) {
 console.error("Failed to refresh video:", err);

// ✅ Check if it's a 404 error (file not found)
if (err.message?.includes('HTTP 404') || err.message?.includes('404')) {
    showFileNotFoundError(video);
    return;
}

 // ONLY show error overlay for authentication errors
 if (err.needsReauth || err.message?.includes('Authentication') || err.message?.includes('Account not found')) {
     showVideoError(err.message || 'Failed to load video', video);
 }
 return;
}

try {
window.plyrPlayer.source = {
    type: 'video',
    sources: [ { src: video.downloadUrl, type: 'video/mp4' } ],
    title: video.filename || ""
};

//  Setting .source rebuilds Plyr's internal video-wrapper/video
// elements, which wipes their inline rotation styles immediately -
// before playback even starts. Reapply right away so the loading
// screen (and the video once it starts buffering) stays the correct
// rotated size instead of briefly shrinking back to normal.
if (wasForcedLandscapeBeforeLoad && manualRotationActive) {
    applyManualRotationStyles();
}

// Store orientation for fullscreen rotation
window.currentVideoOrientation = video.orientation || 'L';

// Add orientation class to player container for CSS targeting
const playerContainer = document.getElementById('inlineVideoContainer');
if (playerContainer) {
 playerContainer.classList.remove('video-landscape', 'video-portrait');
 playerContainer.classList.add(video.orientation === 'P' ? 'video-portrait' : 'video-landscape');
}

console.log(`Video orientation set to: ${window.currentVideoOrientation} for ${video.filename}`);

// Apply stored volume/mute state
if (sessionVolume !== null) {
    window.plyrPlayer.volume = sessionVolume;
}
window.plyrPlayer.muted = sessionMuted;

await window.plyrPlayer.play();

//  Restore forced (manual-rotate) landscape mode if it was active
// before this video started loading (see note above).
if (wasForcedLandscapeBeforeLoad) {
    if (window.plyrPlayer.fullscreen?.active) {
        // Still in real fullscreen - just reapply the rotation styles,
        // since some elements (e.g. the progress bar) are recreated on
        // every video load and lose their inline styling.
        setTimeout(() => {
            if (manualRotationActive) applyManualRotationStyles();
        }, 50);
    } else {
        // Real fullscreen was exited (some mobile browsers do this when
        // the video source changes) - re-enter and reactivate rotation.
        window.plyrPlayer.once('enterfullscreen', () => {
            setTimeout(activateManualRotation, 100);
        });
        window.plyrPlayer.fullscreen.enter();
    }
}
} catch (playErr) {
 console.error("Playback failed:", playErr);
 
 // Check if this is a benign interruption error (user skipped video, etc)
 const errorMsg = playErr.message || '';
 const isBenignError = 
     errorMsg.includes('interrupted by a new load request') ||
     errorMsg.includes('interrupted by a call to pause') ||
     errorMsg.includes('operation was aborted') ||
     errorMsg.includes('The play() request was interrupted') ||
     errorMsg.includes('request was interrupted');
 
 // ✅ ONLY show error overlay if NOT a benign error
 if (!isBenignError) {
     showVideoError(`Playback failed: ${errorMsg || 'Unknown error'}`, video);
 } else {
     console.log(`Benign playback interruption (suppressed UI error): ${errorMsg}`);
 }
 return;
}

}

// ========================
// Download video
// ========================
async function downloadVideoInline(video) {
 console.log("downloadVideoInline CALLED with video =", video);
 
 try {
     video = await refreshVideoBeforeUse(video);
 } catch (err) {
     console.error("Failed to refresh video for download:", err);

         // Check if it's a 404 error (file not found)
    if (err.message?.includes('HTTP 404') || err.message?.includes('404')) {
        showFileNotFoundError(video);
        return;
    }
     
     // Check if it's an auth error
     if (err.needsReauth) {
         showDownloadError(err.message || 'Authentication expired', err, video);
     } else {
         showDownloadError(err.message || 'Token/metadata refresh failed');
     }
     return;
 }
 
 if (!video || !video.downloadUrl) {
     showDownloadError("Missing or expired download URL");
     return;
 }
 
 window.open(video.downloadUrl, "_blank");
}

// ========================
// Basket play buttons
// ========================
function attachBasketPlayButtons() {
const basketList = document.getElementById("basketList");
if (!basketList) return;
const items = basketList.querySelectorAll("li");
items.forEach((li, idx) => {
    if (li.querySelector(".basket-play-btn")) return;
    const playBtn = document.createElement("button");
    playBtn.textContent = "Play Inline";
    playBtn.className = "basket-play-btn";
    playBtn.style.background = "#28a745";
    playBtn.style.color = "#fff";
    playBtn.style.border = "none";
    playBtn.style.padding = "4px 8px";
    playBtn.style.cursor = "pointer";
    playBtn.style.borderRadius = "3px";
    playBtn.style.marginRight = "4px";
    playBtn.addEventListener("click", () => {
        const video = window.basketVideos[idx];
        playVideoInline(video, 'basket', idx);
    });
    const removeBtn = li.querySelector(".remove-btn");
    if (removeBtn) removeBtn.insertAdjacentElement("beforebegin", playBtn);
    else li.appendChild(playBtn);
});
}

// ========================
// Reset player to initial blank state
// ========================
function resetVideoInline() {
try {
    if (!window.plyrPlayer) return;
    
    // Pause and clear source
    window.plyrPlayer.pause();
    // ✅ Exit PIP mode if active
   if (pipMode && typeof exitPIPMode === 'function') {
       exitPIPMode();
   }
    if (window.plyrPlayer.stop) window.plyrPlayer.stop();
    window.plyrPlayer.source = { type: 'video', sources: [] };
    
// Keep currentPlayingVideo so video info stays visible after stop
  // window.currentPlayingVideo = null; // REMOVED - keep video info visible
  
  // Clear tracking variables
  currentListContext = null;
  currentVideoIndex = null;
  window.currentLoadingFilename = '';
  
  // Exit mini-player mode if active
    const container = document.getElementById('inlineVideoContainer');
    if (container && container.classList.contains('mini-player')) {
        const closeBtn = container.querySelector('.mini-close-btn');
        if (closeBtn) closeBtn.remove();
        container.classList.remove('mini-player');
    }
    
    // Recompute bottom dock (heights may shrink once loading overlay/info clear)
    if (typeof computeBottomDock === 'function') {
        computeBottomDock();
    }
    
    // Exit fullscreen if active - but NOT when in forced (manual-rotate)
    // landscape mode, where Stop should only stop playback and the
    // rotated fullscreen view should stay open
    const isForcedLandscapeActive = document.body.classList.contains('manual-rotate-landscape');
    if (window.plyrPlayer.fullscreen?.active && !isForcedLandscapeActive) {
        window.plyrPlayer.fullscreen.exit();
    }
    
 // Hide loading overlay
  const loadingOverlay = document.getElementById('plyr-loading-overlay');
  if (loadingOverlay) loadingOverlay.style.display = 'none';
  
  // Keep video info visible after stopping (don't clear or hide)
  // Video info stays visible so user can see what they just watched

  console.log('Player reset to initial state (video info kept visible)');
} catch (err) {
    console.warn("Error resetting player:", err);
}
}

// Public API
window.inlineVideoPlayer = {
play: playVideoInline,
stop: resetVideoInline,
reset: resetVideoInline,
attachBasketButtons: attachBasketPlayButtons
};
window.downloadVideo = downloadVideoInline;

// Export globally
window.showDownloadError = showDownloadError;
window.showVideoError = showVideoError;
window.showFileNotFoundError = showFileNotFoundError;
window.playNextInCurrentList = playNextInCurrentList;
window.playPreviousInCurrentList = playPreviousInCurrentList;

// Init
document.addEventListener("DOMContentLoaded", () => {
createPlayerElement();
attachBasketPlayButtons();

// Create the bottom-dock backdrop once, appended to body so it's
// always above the page but its z-index keeps it below pills/corner buttons
if (!document.getElementById('bottomDockBackdrop')) {
    const backdrop = document.createElement('div');
    backdrop.id = 'bottomDockBackdrop';
    document.body.appendChild(backdrop);
}

computeBottomDock();

// On mobile portrait, #topSpacer reserves blank space above the title so
// that scrollIntoView calls elsewhere (e.g. focusing the docked search
// box) don't push the console/buttons/account pills off-screen. But that
// same spacer means a fresh page load starts showing blank spacer space
// at the very top instead of the title/console. "Bookmark" the top of
// the page (the h1) - but since account restoration and video player
// setup keep resizing the spacer/layout during load, fixed-delay retries
// end up chasing a moving target and can overshoot. Instead, poll h1's
// position every frame and only lock in the scroll once it has stopped
// moving for a short stretch.
(function stabilizeAndScrollToPageBookmark() {
    const isMobilePortrait = window.innerWidth <= 768 && window.matchMedia('(orientation: portrait)').matches;
    if (!isMobilePortrait) return;

    const h1 = document.querySelector('h1');
    if (!h1) return;

    const STABLE_FRAMES_NEEDED = 12; // ~200ms of no movement at 60fps
    const MAX_WAIT_MS = 3000;
    const startTime = Date.now();
    let lastTop = null;
    let stableFrameCount = 0;

    const finalize = () => {
        const targetY = h1.getBoundingClientRect().top + window.pageYOffset;
        window.scrollTo(0, targetY);
    };

    const tick = () => {
        const currentTop = h1.getBoundingClientRect().top + window.pageYOffset;

        if (lastTop !== null && Math.abs(currentTop - lastTop) < 1) {
            stableFrameCount++;
        } else {
            stableFrameCount = 0;
        }
        lastTop = currentTop;

        // Keep re-anchoring scroll while we wait, so the page doesn't
        // sit at the blank spacer in the meantime
        window.scrollTo(0, currentTop);

        if (stableFrameCount >= STABLE_FRAMES_NEEDED || (Date.now() - startTime) > MAX_WAIT_MS) {
            finalize();
            return;
        }

        requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);
})();
});

// ========================
// Update now playing highlight when basket changes
// ========================
function updateNowPlayingBasketHighlight() {
const videoInfoEl = document.getElementById("currentVideoInfo");
if (!videoInfoEl) return;

// Find the filename span - it has title "Click to rename file"
const spans = videoInfoEl.querySelectorAll('span');
if (spans.length === 0) return;

// Get the filename span (has cursor pointer and "rename" in title)
let filenameSpan = null;
for (let i = spans.length - 1; i >= 0; i--) {
    if (spans[i].style.cursor === 'pointer' && 
        spans[i].title && 
        spans[i].title.toLowerCase().includes('rename')) {
        filenameSpan = spans[i];
        break;
    }
}

if (!filenameSpan) {
    console.warn('Could not find filename span for basket highlight');
    return;
}

// Check if currently playing video is in basket
const currentVideo = window.currentPlayingVideo;
if (!currentVideo) return;

let oneDriveId = currentVideo.oneDriveId ?? currentVideo.idFromAPI ?? null;
const isInBasket = window.basketVideos && window.basketVideos.some(v => v.oneDriveId === oneDriveId);

if (isInBasket) {
    filenameSpan.style.backgroundColor = 'rgb(249,215,221)';
    filenameSpan.style.padding = '2px 4px';
    filenameSpan.style.borderRadius = '2px';
} else {
    filenameSpan.style.backgroundColor = 'transparent';
    filenameSpan.style.padding = '0';
}
}

// Export for use in basket.js
window.updateNowPlayingBasketHighlight = updateNowPlayingBasketHighlight;

// ✅ CRITICAL FIX: Add safeguard observer to prevent video info from disappearing
function ensureVideoInfoExists() {
// Only run if a video is currently loaded
if (!window.currentPlayingVideo) return;

const videoInfo = document.getElementById('currentVideoInfo');
const container = document.getElementById('inlineVideoContainer');

// If video info is missing but should exist, recreate it
if (!videoInfo && container && window.currentPlayingVideo) {
    console.warn('Video info element disappeared - recreating it');
    const newVideoInfo = document.createElement("div");
    newVideoInfo.id = "currentVideoInfo";
    newVideoInfo.className = "current-video-info";
    container.insertAdjacentElement("afterend", newVideoInfo);
    
    // Rebuild the content
    if (typeof window.rebuildVideoInfoDisplay === 'function') {
        window.rebuildVideoInfoDisplay(window.currentPlayingVideo);
    }
    
    console.log('✅ Restored video info display');
}
}

// Check periodically (every 2 seconds) if video info needs restoration
setInterval(ensureVideoInfoExists, 2000);

// Also check on common events that might trigger DOM changes
document.addEventListener('DOMContentLoaded', () => {
// Watch for mutations that might remove the video info element
const observer = new MutationObserver((mutations) => {
    // Check if video info was removed
    const videoInfo = document.getElementById('currentVideoInfo');
    if (!videoInfo && window.currentPlayingVideo) {
        console.warn('Video info removed by mutation - restoring');
        ensureVideoInfoExists();
    }
});

// Observe the body for child removals
observer.observe(document.body, {
    childList: true,
    subtree: true
});
});

})();
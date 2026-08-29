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

// =========================================
// PLAYER MODES - CANONICAL NAMES
//
// Three distinct player surfaces. Use these abbreviations everywhere -
// in comments, identifiers, log messages and CSS class names.
//
//   MPB   Mobile Portrait Browser
//         The docked, in-page player. Phone held portrait, NOT fullscreen.
//         body: portrait-inline    container: #inlineVideoContainer.bottom-docked
//         Sized by fitDockedVideoToStack(); position by computeBottomDock().
//
//   MPFS  Mobile Portrait Full Screen
//         Plain (unrotated) fullscreen, phone still held portrait.
//         body: portrait-fullscreen:not(.manual-rotate-landscape)
//         NOTE: Plyr runs CSS-only FALLBACK fullscreen here and applies
//         .plyr--fullscreen-fallback, NOT .plyr--fullscreen - so CSS must
//         key off the body class, never .plyr--fullscreen.
//
//   FLS   Forced Landscape
//         Video rotated 90deg inside fullscreen on a portrait-locked phone.
//         body: manual-rotate-landscape (portrait-fullscreen is ALSO set -
//         that's why every MPFS rule needs :not(.manual-rotate-landscape)).
//         Positions itself inline via applyManualRotationStyles().
//
// Not player modes, listed to avoid confusion:
//   real device landscape  - phone physically rotated, no forced rotation
//   mini-player            - .mini-player, either orientation
//   desktop                - >=769px
// =========================================



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
    // Is a fullscreen-ish mode actually active?
    //
    // This used to be guaranteed by the caller, and the "last resort" branch
    // below logged on that assumption. It stopped holding when the title bar
    // became shared with the mini-player: ensureVideoTitleBar() now calls
    // this from inline and MPB/MPFS too, and updatePlayerStateClass() calls THAT
    // on every resize - which on mobile means every address-bar show/hide.
    // Hence the console filling with "falling back to generic .plyr
    // container". The fallback is correct and always was; only the logging
    // was wrong, so the logs are now gated on genuinely expecting a
    // fullscreen element and not finding one.
    const expectsFullscreen = manualRotationActive
        || !!(window.plyrPlayer && window.plyrPlayer.fullscreen && window.plyrPlayer.fullscreen.active)
        || document.body.classList.contains('manual-rotate-landscape')
        || document.body.classList.contains('portrait-fullscreen')
        || document.body.classList.contains('landscape-fullscreen');

    // Prefer the real Fullscreen API element when available
    const nativeEl = document.fullscreenElement || document.webkitFullscreenElement || null;
    if (nativeEl) {
        if (expectsFullscreen) {
            console.log('[rotate] using native fullscreen element:', nativeEl.className || nativeEl.tagName);
        }
        return nativeEl;
    }

    // Plyr's CSS-only fallback fullscreen mode uses the class
    // "plyr--fullscreen-fallback" (NOT "plyr--fullscreen" - that name is
    // used elsewhere in this codebase's CSS but doesn't match what Plyr
    // itself actually applies to the DOM)
    const fallbackEl = document.querySelector('.plyr--fullscreen-fallback')
        || document.querySelector('.plyr--fullscreen');
    if (fallbackEl) {
        if (expectsFullscreen) {
            console.log('[rotate] using fallback fullscreen element:', fallbackEl.className);
        }
        return fallbackEl;
    }

    // Last resort: the plain .plyr container. In fullscreen this is still the
    // right element (Plyr's stylesheet has already sized it, even when the
    // modifier class doesn't match). Outside fullscreen it's precisely what
    // the shared title bar wants. So this is the NORMAL path most of the
    // time, not a failure - worth a line only when we expected better.
    const plyrContainer = document.querySelector('#inlineVideoContainer .plyr') || document.querySelector('.plyr');
    if (plyrContainer) {
        if (expectsFullscreen) console.log('[rotate] falling back to generic .plyr container');
        return plyrContainer;
    }

    // No player in the DOM at all - genuinely worth knowing about whatever
    // mode we're in.
    console.warn('[rotate] no fullscreen element found at all');
    return null;
}

// The title bar, shared by FLS, MPFS and MPB. Created lazily inside whatever is
// currently acting as the player root, with the basket click handler always
// attached - CSS decides whether it's interactive (FLS) or inert (MPFS/MPB), so it
// doesn't matter which mode happens to create it first.
// ⚙️ Gap between the rotated title block's outer edge and the physical top of
// the screen. Lines the block's near edge up with where the progress bar
// starts - keep in step with PROGRESS_BAR_FLS_INSET_PX in
// applyManualRotationStyles.
const FLS_TITLE_EDGE_INSET_PX = 70;

/**
 * The rotated title block is centred on `left`, so half its own thickness has
 * to be added to the inset to keep that edge gap honest. offsetHeight is a
 * pre-transform layout value, so it is the thickness across the physical
 * screen's vertical axis. Fallback covers the not-yet-laid-out case.
 *
 * Called on every title sync rather than only on entering FLS: now that long
 * names wrap, stepping from a one-line to a two-line title changes the
 * thickness mid-session and the block would otherwise drift off its inset.
 */
function applyFlsTitleInset(title) {
    if (!title) return;
    const titleThickness = title.offsetHeight || 34;
    title.style.setProperty(
        'left',
        (FLS_TITLE_EDGE_INSET_PX + (titleThickness / 2)) + 'px',
        'important'
    );
}

function ensureVideoTitleBar() {
    const host = getManualRotationFullscreenElement()
        || document.querySelector('#inlineVideoContainer .plyr')
        || document.querySelector('.plyr');
    if (!host) return null;

    let title = host.querySelector('.fls-video-title');
    if (!title) {
        // It may already exist but be parented elsewhere after a player
        // rebuild - move that one rather than ending up with two.
        const orphan = document.querySelector('.fls-video-title');
        if (orphan) {
            title = orphan;
        } else {
            title = document.createElement('div');
            title.className = 'fls-video-title';
            title.title = 'Rename this file';
            // Tapping opens the rename modal, matching what the filename does
            // in every list. Only reachable in FLS - pointer-events is none by
            // default and CSS only re-enables it under
            // body.manual-rotate-landscape. The basket modal moved to the "B"
            // button in the controls row.
            title.addEventListener('click', (e) => {
                e.stopPropagation();
                const v = window.currentPlayingVideo;
                if (!v || typeof window.showRenameModal !== 'function') return;
                Promise.resolve(window.showRenameModal(v))
                    .catch(err => console.error('[fls] rename modal failed:', err));
            });
        }
        host.appendChild(title);
    }
    return title;
}

function syncVideoTitleBar(video) {
    const v = video || window.currentPlayingVideo;
    const bar = ensureVideoTitleBar();
    if (!bar) return;

    // The bar is a flex row now: filename text + the filter pill. Rebuild
    // only the text span, so the pill (and its listeners) survive a re-sync.
    let textEl = bar.querySelector('.fls-video-title-text');
    if (!textEl) {
        textEl = document.createElement('span');
        textEl.className = 'fls-video-title-text';
        // Strip the bare text node the old single-node version left behind.
        Array.from(bar.childNodes).forEach(n => { if (n.nodeType === 3) n.remove(); });
        bar.insertBefore(textEl, bar.firstChild);
    }
    if (v) {
        const scoreText = (v.user_score !== undefined && v.user_score !== null) ? ` [${v.user_score}]` : '';
        textEl.textContent = (v.filename || '') + scoreText;
    }
    syncFullscreenFilterPill();

    // Re-measure after the text changed - a wrapped two-line title is thicker
    // than a one-line one, and the rotated block is positioned off that.
    if (document.body.classList.contains('manual-rotate-landscape')) {
        applyFlsTitleInset(bar);
    }
}

// ---------------------------------------------------------------
// FLS / MPFS search-filter pill.
//
// Lives INSIDE .fls-video-title rather than being positioned against it, so
// it inherits that bar's placement in both modes and its fade-out with
// .plyr--hide-controls for free - no measuring, no rAF loop.
// ---------------------------------------------------------------
function getMainSearchTerm() {
    return (document.getElementById('filenameSearchBox')?.value || '').trim();
}

function applyFullscreenFilterTerm(term) {
    const mainBox = document.getElementById('filenameSearchBox');
    if (mainBox) mainBox.value = term;
    const clearX = document.getElementById('clearSearchX');
    if (clearX) clearX.style.display = term ? 'block' : 'none';

    const panelBox = document.getElementById('panelSearchBox');
    if (panelBox) panelBox.value = term;
    const panelClearX = document.getElementById('panelSearchClearX');
    if (panelClearX) panelClearX.style.display = term ? 'block' : 'none';

    // We're sitting in fullscreen - never scroll the page to the search box
    // or pop the landscape playlist panel open behind the player.
    window.skipSearchScroll = true;
    window.skipPanelAutoOpen = true;
    if (typeof filterDisplayedByFilename === 'function') filterDisplayedByFilename();

    syncFullscreenFilterPill();
}

function ensureFullscreenFilterPill() {
    const bar = ensureVideoTitleBar();
    if (!bar) return null;

    let pill = bar.querySelector('.fls-filter-pill');
    if (pill) return pill;

    pill = document.createElement('span');
    pill.className = 'fls-filter-pill';

    const label = document.createElement('span');
    label.className = 'fls-filter-pill-label';
    pill.appendChild(label);

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'fls-filter-pill-input';
    input.placeholder = 'Filter';
    input.setAttribute('autocapitalize', 'none');
    input.setAttribute('autocorrect', 'off');
    input.setAttribute('spellcheck', 'false');
    pill.appendChild(input);

    const bin = document.createElement('button');
    bin.type = 'button';
    bin.className = 'fls-filter-pill-bin';
    bin.textContent = '🗑️';
    bin.title = 'Clear filter';
    pill.appendChild(bin);

    // In FLS the title bar itself opens the basket on tap - none of the
    // pill's own gestures should ever reach it.
    ['click', 'mousedown', 'touchstart', 'touchend'].forEach(type => {
        pill.addEventListener(type, ev => ev.stopPropagation());
    });

    label.addEventListener('click', (ev) => {
        ev.stopPropagation();
        startFullscreenFilterEdit();
    });

    input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
        else if (ev.key === 'Escape') { ev.preventDefault(); input.value = getMainSearchTerm(); input.blur(); }
    });
    input.addEventListener('blur', () => endFullscreenFilterEdit(true));

    // preventDefault on the press stops the bin stealing focus mid-edit -
    // otherwise the input blurs, the keyboard closes, and the tap lands on
    // nothing. iOS then swallows the synthesized click, so act on touchend.
    bin.addEventListener('mousedown', ev => ev.preventDefault());
    bin.addEventListener('touchstart', ev => ev.preventDefault(), { passive: false });
    const clearFromBin = (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (bin.dataset.firing === '1') return;   // desktop click vs iOS touchend
        bin.dataset.firing = '1';
        setTimeout(() => { delete bin.dataset.firing; }, 400);
        input.value = '';
        if (pill.classList.contains('editing')) {
            input.blur();               // blur handler commits the empty term
        } else {
            applyFullscreenFilterTerm('');
        }
    };
    bin.addEventListener('touchend', clearFromBin, { passive: false });
    bin.addEventListener('click', clearFromBin);

    bar.appendChild(pill);
    return pill;
}

function syncFullscreenFilterPill() {
    const pill = ensureFullscreenFilterPill();
    if (!pill) return;
    const term = getMainSearchTerm();
    const label = pill.querySelector('.fls-filter-pill-label');
    const bin = pill.querySelector('.fls-filter-pill-bin');
    if (label) label.textContent = term ? ('🔍 ' + term) : '🔍';
    if (bin) bin.style.display = term ? 'inline-block' : 'none';
    pill.title = term ? 'Tap to edit the filter' : 'Tap to set a filter';
}

function startFullscreenFilterEdit() {
    const pill = ensureFullscreenFilterPill();
    if (!pill) return;
    const input = pill.querySelector('.fls-filter-pill-input');
    if (!input) return;
    input.value = getMainSearchTerm();
    // Flags the app as "editing from fullscreen" so the MPB keyboard rules
    // don't hide #inlineVideoContainer - in MPFS that IS the fullscreen
    // surface, and hiding it would drop us out of fullscreen mid-keystroke.
    document.body.classList.add('fls-filter-editing');
    pill.classList.add('editing');
    input.focus({ preventScroll: true });
    setTimeout(() => {
        const len = input.value.length;
        try { input.setSelectionRange(len, len); } catch (_) {}
    }, 50);
}

function endFullscreenFilterEdit(commit) {
    const pill = document.querySelector('.fls-filter-pill');
    document.body.classList.remove('fls-filter-editing');
    if (!pill) return;
    pill.classList.remove('editing');
    const input = pill.querySelector('.fls-filter-pill-input');
    if (commit && input) {
        applyFullscreenFilterTerm(input.value.trim());
    } else {
        syncFullscreenFilterPill();
    }
}

window.syncFullscreenFilterPill = syncFullscreenFilterPill;

window.ensureVideoTitleBar = ensureVideoTitleBar;
window.syncVideoTitleBar = syncVideoTitleBar;

function getManualRotationTargets() {
    const container = getManualRotationFullscreenElement();
    if (!container) return null;
    const wrapper = container.querySelector('.plyr__video-wrapper') || (container.classList.contains('plyr__video-wrapper') ? container : null);
    const video = container.querySelector('video, .plyr__video-embed') || (container.tagName === 'VIDEO' ? container : null);
    const controls = container.querySelector('.plyr__controls') || document.querySelector('.plyr__controls');
    const progressBar = document.getElementById('permanentProgressBar');
    // ✅ Small title bar at the very top of the player, showing the current
    // filename. Shared with MPFS/MPB now - see ensureVideoTitleBar above.
    const title = ensureVideoTitleBar();
    console.log('[rotate] targets found:', {
        container: !!container,
        wrapper: !!wrapper,
        video: !!video,
        controls: !!controls,
        progressBar: !!progressBar,
        title: !!title
    });
    return { container, wrapper, video, controls, progressBar, title };
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
    const { container, wrapper, video, controls, progressBar, title } = targets;

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

    // Video title + filter pill, laid out like a chart's y-axis label: pinned
    // to the rotated container's LEFT edge, centred along it, and counter-
    // rotated -90deg.
    //
    // The container is already rotate(90deg), so a child at rotate(-90deg)
    // composes to a net rotation of zero - the block renders upright in
    // PHYSICAL screen terms. And the container's local left edge maps to the
    // physical TOP edge under that same +90deg. Net effect: the block lands
    // in exactly the same absolute screen position as MPFS puts it, while
    // reading bottom-to-top on the far left of the FLS view.
    if (title) {
        // Through the shared sync so a plain re-apply shows the score suffix
        // too - previously only the video-change path added it.
        syncVideoTitleBar();
        setImportantStyles(title, {
            position: 'absolute',
            top: '50%',
            left: '0px',
            right: 'auto',
            bottom: 'auto',
            // After the counter-rotation the block's WIDTH runs along the
            // container's vertical axis, which is the physical screen's
            // width - so cap against screenW, not the container's own width.
            'max-width': Math.round(screenW * 0.8) + 'px',
            transform: 'translate(-50%, -50%) rotate(-90deg)',
            'transform-origin': 'center center',
            'z-index': '2147483647'
        });

        applyFlsTitleInset(title);
    }
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
    [targets.container, targets.wrapper, targets.video, targets.controls, targets.progressBar, targets.title].forEach(el => {
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

// FLS -> MPFS: leave forced landscape but STAY in fullscreen, landing in
// ordinary mobile-portrait fullscreen.
//
// resetManualRotation() on its own only strips the rotation inline styles.
// removeManualRotationStyles() also clears the MPFS control-stack offsets
// (controls `bottom`, progress bar `top`/`bottom`) as collateral, and
// nothing re-applies them - so the bar ends up wherever the stylesheet
// leaves it until the next resize fires. Re-running the MPFS positioning
// here closes that gap.
//
// applyFullscreenControlOffsets / releaseDockedVideoFit are Native-only;
// the typeof guards let the identical function ship in Picker unchanged.
function switchFlsToMpfs() {
    if (!manualRotationActive) {
        showPlayerFeedback('Not in landscape view', 'top-left');
        return;
    }

    resetManualRotation();

    // Order matters: the state class goes on first, because the MPFS rules are
    // keyed off body.portrait-fullscreen:not(.manual-rotate-landscape) - then
    // the inline offsets that need to beat them.
    if (typeof updatePlayerStateClass === 'function') updatePlayerStateClass();
    if (typeof releaseDockedVideoFit === 'function') releaseDockedVideoFit();
    if (typeof applyFullscreenControlOffsets === 'function') applyFullscreenControlOffsets();

    // Second pass once the layout settles - same 100ms the enterfullscreen
    // path already uses for this call.
    setTimeout(() => {
        if (manualRotationActive) return; // re-rotated in the meantime
        if (typeof applyFullscreenControlOffsets === 'function') applyFullscreenControlOffsets();
        if (typeof window.syncVideoTitleBar === 'function') window.syncVideoTitleBar();
    }, 100);

    updateScrollLockButtonDisplay();
    showPlayerFeedback('↺ Portrait fullscreen', 'top-left');
}

window.toggleManualRotation = toggleManualRotation;
window.switchFlsToMpfs = switchFlsToMpfs;
window.toggleScrollLock = toggleScrollLock;

// =========================================
// ⚙️ FULLSCREEN CONTROL STACK POSITION (ordinary fullscreen, incl. MPFS)
// Values are vh measured from the BOTTOM of the screen:
//   LOWER number  = sits FURTHER DOWN the screen
//   HIGHER number = sits FURTHER UP the screen
// Keep PROGRESS larger than CONTROLS (progress bar sits above the buttons).
// =========================================
const FULLSCREEN_CONTROLS_BOTTOM_VH = 6;   // was 7
const FULLSCREEN_PROGRESS_BOTTOM_VH = 4;  // was 13 (keeps the same ~6vh gap)

/**
 * Position the controls bar + permanent progress bar in ordinary (non-FLS)
 * fullscreen. Written inline with !important because inline !important is the
 * only thing that reliably beats the several stylesheet `bottom: Xvh !important`
 * rules for these elements, AND because Plyr's CSS-only fallback fullscreen
 * never applies `.plyr--fullscreen` (it uses `plyr--fullscreen-fallback`).
 */
function applyFullscreenControlOffsets() {
    // FLS positions its own controls/progress bar inline via
    // applyManualRotationStyles() - never fight it here.
    if (manualRotationActive) return;
    if (!window.plyrPlayer?.fullscreen?.active) return;

    const controls = document.querySelector('.plyr__controls');
    if (controls) {
        controls.style.setProperty('bottom', FULLSCREEN_CONTROLS_BOTTOM_VH + 'vh', 'important');
    }

    const progressBar = document.getElementById('permanentProgressBar');
    if (progressBar) {
        progressBar.style.setProperty('top', 'auto', 'important');
        progressBar.style.setProperty('bottom', FULLSCREEN_PROGRESS_BOTTOM_VH + 'vh', 'important');
    }

    console.log(`Fullscreen offsets applied - controls ${FULLSCREEN_CONTROLS_BOTTOM_VH}vh, progress ${FULLSCREEN_PROGRESS_BOTTOM_VH}vh`);
}

/** Strip the fullscreen-only inline offsets so the docked/inline CSS takes over again */
function clearFullscreenControlOffsets() {
    const controls = document.querySelector('.plyr__controls');
    if (controls) controls.style.removeProperty('bottom');

    const progressBar = document.getElementById('permanentProgressBar');
    if (progressBar) {
        progressBar.style.removeProperty('bottom');
        progressBar.style.removeProperty('top');
    }
}

// Mobile portrait: always-on bottom dock (no scroll-triggering needed)
// Stack order bottom -> up: corner buttons, info bar, video player, filter bar
// (Defined at top-level IIFE scope so it's accessible from playVideoInline,
// rebuildVideoInfoDisplay, resetVideoInline, etc. - not just inside createPlayerElement)
// ⚙️ MPB PLAYER - MAIN TUNING KNOB. Gap left above the video so its top
// edge never sits under the browser address bar. Raise for more clearance.
const MPB_VIDEO_TOP_BUFFER = 24;
// ⚙️ Never shrink the video below this height, however tall the stack gets.
const MPB_VIDEO_MIN_HEIGHT = 140;
// ⚙️ MPB PORTRAIT-VIDEO CAP. A portrait clip would otherwise eat the whole
// space the stack leaves, pushing the page off the top of the screen. Cap it
// at this fraction of the viewport height so there's always page visible
// above the player. Lower = more page showing, higher = bigger video.
// Only applied to clips that are actually taller than they are wide.
const MPB_PORTRAIT_MAX_VH = 0.52;

/**
* Fit the docked video inside the space the dock stack actually leaves.
*
* The MPB stylesheet forces `width: 100% !important; height: auto
* !important` on the video, so a portrait clip renders ~100vw x (h/w) tall -
* far more than the space between the dock's bottom offset and the top of the
* screen. The container overflows UPWARD, off the top of the viewport, which
* is what crops the video (and pushes the clock/feedback overlays off-screen
* with it, since they're positioned against .plyr).
*
* Rather than capping max-height (which loses to `max-height: 100vh
* !important` unless applied with important priority, and needs object-fit to
* avoid squashing), set explicit px width AND height from the video's real
* aspect ratio. Deterministic, and the flex-centered wrapper letterboxes the
* sides for us.
*/
function fitDockedVideoToStack(infoHeight, baseBottomOffset, gapBetweenStackItems) {
    // Plyr rebuilds its <video> on every source change and the rebuilt element
    // loses id="inlineVideoPlayer", so prefer Plyr's own live reference.
    const videoEl = window.plyrPlayer?.media || document.querySelector('#inlineVideoContainer video');
    const container = document.getElementById('inlineVideoContainer');
    if (!videoEl || !container) return;

    // The progress bar is in-flow inside .plyr, so it adds to the container's
    // height on top of the video. (Controls are absolutely positioned inline,
    // so they contribute nothing here.)
    const progressBar = document.getElementById('permanentProgressBar');
    const progressBarHeight = progressBar ? progressBar.offsetHeight : 0;

    const available = window.innerHeight
        - baseBottomOffset
        - infoHeight
        - gapBetweenStackItems
        - progressBarHeight
        - MPB_VIDEO_TOP_BUFFER;

    // Intrinsic dimensions. videoWidth/Height are 0 until metadata loads, so
    // fall back to the values stored on the video record - reliable now that
    // native scanning + the orientation backfill populate width/height.
    const intrinsicW = videoEl.videoWidth || window.currentPlayingVideo?.width || 0;
    const intrinsicH = videoEl.videoHeight || window.currentPlayingVideo?.height || 0;

    // Portrait clips get an extra ceiling so the page stays visible above the
    // player. Landscape clips are naturally short and keep the full space.
    const isPortraitClip = !!(intrinsicW && intrinsicH) && intrinsicH > intrinsicW;
    const cappedAvailable = isPortraitClip
        ? Math.min(available, window.innerHeight * MPB_PORTRAIT_MAX_VH)
        : available;

    const targetHeight = Math.max(MPB_VIDEO_MIN_HEIGHT, Math.round(cappedAvailable));

    videoEl.style.setProperty('object-fit', 'contain', 'important');
    videoEl.dataset.dockFitted = '1';

    if (!intrinsicW || !intrinsicH) {
        // Aspect unknown - cap height only and let contain letterbox
        videoEl.style.setProperty('max-height', targetHeight + 'px', 'important');
        return;
    }

    const aspect = intrinsicW / intrinsicH;
    const containerWidth = container.clientWidth || window.innerWidth;
    const finalWidth = Math.min(containerWidth, Math.round(targetHeight * aspect));
    const finalHeight = Math.round(finalWidth / aspect);

    videoEl.style.setProperty('width', finalWidth + 'px', 'important');
    videoEl.style.setProperty('height', finalHeight + 'px', 'important');
    videoEl.style.setProperty('max-width', '100%', 'important');
    videoEl.style.setProperty('max-height', targetHeight + 'px', 'important');
}

function releaseDockedVideoFit() {
    const videoEl = window.plyrPlayer?.media || document.querySelector('#inlineVideoContainer video');
    if (!videoEl) return;
    if (videoEl.dataset.dockFitted !== '1') return;
    // FLS sets its OWN inline sizing on this same element via
    // applyManualRotationStyles() - never strip that out from under it.
    // ✅ Plain (non-FLS) fullscreen is deliberately NOT excluded any more:
    // the docked px width/height were surviving into MPFS, which is
    // exactly what kept a narrow/tall clip squeezed to the dock's width
    // instead of stretching to the full screen width.
    if (manualRotationActive) return;
    ['width', 'height', 'max-width', 'max-height', 'object-fit'].forEach(p => {
        videoEl.style.removeProperty(p);
    });
    delete videoEl.dataset.dockFitted;
}

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

    const isMobilePortrait = window.innerWidth <= 768 && window.matchMedia('(orientation: portrait)').matches;

    const shouldDock = isMobilePortrait &&
        !window.plyrPlayer?.fullscreen?.active &&
        !container.classList.contains('mini-player') &&
        // ✅ Nothing loaded - the player is display:none, so its
        // offsetHeight is 0 and docking it would just reserve empty space.
        !document.body.classList.contains('player-idle');

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
        releaseDockedVideoFit(); // landscape / mini / fullscreen size themselves
        return;
    }

    container.classList.add('bottom-docked');
    if (videoInfo) videoInfo.classList.add('info-bottom-docked');
    if (backdrop) backdrop.classList.add('active');

    // ⚙️ TWEAK THIS NUMBER to raise/lower the video player + now-playing
    // info bar as a unit. This is now a fixed, independent offset - it no
    // longer reads the corner buttons' position, so it won't move when you
    // adjust the corner buttons separately. Increase to raise the stack
    // further off the bottom of the screen, decrease to lower it.
    const baseBottomOffset = 100; // px from the bottom of the screen (up to lift)
    let runningBottom = baseBottomOffset;

    const gapBetweenStackItems = 6; // small breathing room between info bar / player / filter bar

    const infoHeight = videoInfo ? videoInfo.offsetHeight : 0;
    // MUST run BEFORE reading container.offsetHeight - fitting the video
    // shrinks the container, and the dock offsets below are derived from
    // that height. Measuring first would use the pre-fit (overflowing) value.
    fitDockedVideoToStack(infoHeight, baseBottomOffset, gapBetweenStackItems);

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
// Swipe-up = play random video (shared trigger)
// ========================
// Single entry point for every swipe-up gesture (FLS, landscape, MPFS).
// Reuses the corner "X"/"Xn" quick-action button so the FLS-vs-portrait
// weighting logic stays in one place. The cooldown guards against the
// same physical swipe firing more than once - stale duplicate touchend
// listeners used to cause a rapid-fire "dice" run through several videos.
const SWIPE_RANDOM_COOLDOWN_MS = 1200; // ⚙️ adjust if it feels sticky
let lastSwipeRandomFireTime = 0;

// Swipe up now stops playback rather than loading a random video.
// The random path was replaced because .click() tore down and rebuilt the
// Plyr instance from inside a touch handler, which kept wedging WKWebView
// even after the trigger was deferred off the touch stack.
//
// "Stop" means the same thing the ■ button means: reset and hide the player.
function triggerSwipeStopVideo() {
    // Exactly what the ■ control does - inlineVideoPlayer.reset() tears the
    // player down and hides it. Anything less (pause) leaves the video on
    // screen, which isn't what "stop" means here.
    if (typeof window.inlineVideoPlayer?.reset !== 'function') return;

    // Deferred for the same reason the random trigger was: every caller is
    // inside a touchend handler, and reset() destroys the Plyr instance and
    // the wrapper those listeners are bound to. Letting the handler unwind
    // first gives it the clean stack a button click gets.
    showPlayerFeedback('⏹ Stopped', 'top-left');
    setTimeout(() => {
        try {
            window.inlineVideoPlayer.reset();
        } catch (err) {
            console.warn('stop-on-swipe failed:', err);
        }
    }, 0);
}

// ⚠️ No longer called from anywhere - all four swipe-up sites now call
// triggerSwipeStopVideo. Kept only so the random feature is easy to restore.
function triggerSwipeRandomVideo() {
    const now = Date.now();
    if (now - lastSwipeRandomFireTime < SWIPE_RANDOM_COOLDOWN_MS) {
        console.log('Swipe-random ignored (within cooldown)');
        return;
    }
    lastSwipeRandomFireTime = now;

    const randomBtn = document.querySelector('.plyr-random-video');
    if (!randomBtn) return;

    showPlayerFeedback('🎲 Random Video', 'top-left');

    // Deferred on purpose - this is the whole fix for the swipe-up freeze.
    //
    // Every caller is inside a touchend listener, and .click() is synchronous:
    // it tears down the Plyr instance, discards .plyr__video-wrapper, and
    // re-runs enableAnywhereScrubbing() - which removes and re-adds the
    // window 'touchend' listener WHILE that same touchend is still being
    // dispatched. The handler then resumes against a stale closure holding a
    // detached wrapper and a player that has been swapped out from under it.
    //
    // Tapping the "X" button never hits any of this because nothing is on the
    // stack behind it. setTimeout(0) gives the swipe the same clean stack.
    setTimeout(() => {
        // Re-query rather than reusing randomBtn: the controls may already
        // have been rebuilt between the swipe and this callback.
        const btn = document.querySelector('.plyr-random-video');
        if (btn) btn.click();
    }, 0);
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
let pendingScrubTime = null; // ✅ latest scrub target, applied once per rAF
let scrubRafScheduled = false;
// True once a drag has been confirmed and window.scrayScrubSeek.begin() has
// run, so stopScrub knows whether it owns a seek session to close.
let scrubSessionActive = false;


// ⚙️ FLS jog-scrub: a drag STARTING on the left-half frame-step zones seeks
// at frame-step granularity instead of doing a normal proportional scrub.
// Pixels per step - lower = more time travelled per finger movement.
const JOG_PX_PER_STEP = 8;
// ⚙️ Speed tiers, picked by which third of the video the drag starts in.
// ONE ladder for every mode - FLS, MPB and MPFS - so the gesture feels the
// same wherever you are. It used to be two ladders running opposite ways;
// they now match, and the per-mode work is purely about which physical axis
// counts as "bottom" (see the frac calculation in startScrub).
//
// ⚙️ Ladder, bottom to top: 128x / 64x / 32x. Coarsest at the bottom,
// finest at the top.
const JOG_MULT_BOTTOM = 128;
const JOG_MULT_MIDDLE = 64;
const JOG_MULT_TOP    = 32; 

let jogEligible = false;   // paused on mobile - jog rather than seek
let jogActive = false;     // jog has actually engaged
let jogStartTime = 0;
let jogMultiplier = JOG_MULT_BOTTOM;

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

// A drag beginning on the left-half frame-step zones jogs rather than
// scrubs. Only flagged here, not engaged: engaging now would swallow the
// swipe-up-for-random and swipe-to-exit gestures, which also start here.
// scrubMove commits to it once the drag is confirmed as on-axis.
// ⚙️ Drop the manualRotationActive check to enable this outside FLS too.
// One way in, in every mode: the video is PAUSED. A paused video is already
// a "find the exact frame" situation, so proportional scrubbing isn't what
// you want there. Playing behaves exactly as before.
// Covers portrait fullscreen and inline alike - neither is landscape.


// The rule is now purely about play state, not screen position:
//   paused  -> jog, from anywhere on the video
//   playing -> ordinary proportional seek, from anywhere
// The old check required a .frame-step-tap-zone, and those zones were
// removed with frame-by-frame - which killed FLS jog entirely.
const isMobilePlayer = window.innerWidth <= 1024;
jogEligible = !!(isMobilePlayer && window.plyrPlayer.paused);
jogActive = false;
jogStartTime = startTime;

// Speed is locked to where the drag STARTS, not where the finger is now.
// The mapping is position-based, so changing the multiplier mid-drag would
// re-scale the entire accumulated offset and lurch the video every time you
// crossed a strip boundary.
if (jogEligible) {
    const r = wrapper.getBoundingClientRect();
    // FLS rotates the video 90°, so its vertical axis is the screen's X.
    // Either way the distance is measured from the video's BOTTOM edge, so
    // frac 0 = bottom and frac 1 = top in both modes.
    // frac must mean the same thing in both modes: 0 = bottom of the video
    // as the USER sees it, 1 = top. rotate(90deg) maps the video's local -y
    // (up) onto screen +x, so the user's top is the screen's RIGHT edge -
    // measuring from r.width inverted it, which put the BOTTOM tier at the
    // top. Unrotated, screen-top is small Y, so that one does need the
    // subtraction.
    // The controls bar overlays the user's-bottom edge of the video, and the
    // guard at the top of startScrub hands any touch landing on it to Plyr -
    // so that strip can never begin a jog. Dividing the FULL rect into thirds
    // therefore spent most of the bottom band on dead space: in MPB only ~22px
    // of the 128x band was reachable against ~67px for each of the others.
    // Measure the bar and divide only the part you can actually start on.
    const plyrRoot = wrapper.closest('.plyr');
    let controlsThickness = 0;
    // Hidden controls have pointer-events:none, so the touch lands on the
    // video and the guard never fires - nothing to exclude in that case.
    if (plyrRoot && !plyrRoot.classList.contains('plyr--hide-controls')) {
        const controlsEl = plyrRoot.querySelector('.plyr__controls');
        if (controlsEl) {
            const cr = controlsEl.getBoundingClientRect();
            // Rotated, the bar's own height becomes its extent along screen X.
            controlsThickness = manualRotationActive ? cr.width : cr.height;
        }
    }

    const rawAxisSize = manualRotationActive ? r.width : r.height;
    const edgeAxisSize = Math.max(1, rawAxisSize - controlsThickness);
    const distanceFromEdge = manualRotationActive
        ? (startX - r.left) - controlsThickness
        : (r.height - controlsThickness) - (startY - r.top);
    // Clamped: a stray touch on the bar itself would otherwise go negative and
    // land in no band at all.
    const frac = Math.max(0, Math.min(1, distanceFromEdge / edgeAxisSize));

    // ⚙️ One ladder for all modes. frac is already normalised above so 0 is
    // the bottom of the video as the USER sees it in whichever mode is
    // active, which is what keeps this mode-agnostic - swap BOTTOM and TOP
    // here if the whole thing ever feels inverted.
    const ladder = [JOG_MULT_BOTTOM, JOG_MULT_MIDDLE, JOG_MULT_TOP];

    jogMultiplier = frac < (1 / 3) ? ladder[0]
                  : frac < (2 / 3) ? ladder[1]
                  : ladder[2];
}

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
// Swipe-to-exit fullscreen (down) / swipe-to-play-random (up): works in
// both FLS and genuine device landscape, but the "down"/"up" direction
// differs between the two since FLS rotates the video 90° relative to
// the physical screen. MPFS has its own swipe-up
// handler in setupMpfsSwipeExit().
if (isDetermined && !isHorizontalDrag && e && e.changedTouches && e.changedTouches[0]) {
    const SWIPE_EXIT_THRESHOLD_PX = 60; // ⚙️ adjust sensitivity here

    if (manualRotationActive) {
        // FLS: a physical leftward swipe is "down" from the rotated
        // video's own point of view; a physical rightward swipe is "up".
        const endX = e.changedTouches[0].clientX;
        const deltaXPhysical = endX - startX; // negative = swiped left (physical)
        if (deltaXPhysical < -SWIPE_EXIT_THRESHOLD_PX) {
            resetManualRotation();
            if (window.plyrPlayer.fullscreen.active) {
                window.plyrPlayer.fullscreen.exit();
            }
            showPlayerFeedback('⛶ Exit Fullscreen', 'top-left');
        } else if (deltaXPhysical > SWIPE_EXIT_THRESHOLD_PX) {
            // Swipe up (FLS) - stop playback.
            triggerSwipeStopVideo();
        }
    } else if (isForcedOrRealLandscapeMobile() && window.plyrPlayer.fullscreen.active) {
        // Genuine device landscape: no rotation involved, so a real
        // physical downward swipe exits fullscreen directly.
        const endY = e.changedTouches[0].clientY;
        const deltaYPhysical = endY - startY; // positive = swiped down (physical)
        if (deltaYPhysical > SWIPE_EXIT_THRESHOLD_PX) {
            window.plyrPlayer.fullscreen.exit();
            showPlayerFeedback('⛶ Exit Fullscreen', 'top-left');
        } else if (deltaYPhysical < -SWIPE_EXIT_THRESHOLD_PX) {
            // Swipe up (landscape) - stop playback. Changed alongside FLS
            // and MPFS: leaving the random path live here would keep the same
            // teardown-inside-a-touch-handler crash in one mode.
            triggerSwipeStopVideo();
        }
    } else if (window.plyrPlayer.fullscreen.active) {
        // MPFS: a physical upward swipe stops
        // playback, mirroring the FLS/landscape "swipe up" gesture.
        const endY = e.changedTouches[0].clientY;
        const deltaYPhysical = endY - startY; // negative = swiped up (physical)
        if (deltaYPhysical < -SWIPE_EXIT_THRESHOLD_PX) {
            triggerSwipeStopVideo();
        }
    }
}

scrubbing = false;
isHorizontalDrag = false;
isDetermined = false;

// Jog reset belongs HERE, on release - it was only ever being cleared at
// touch-down, so nothing knew a jog had just finished.
jogEligible = false;
jogActive = false;

// ✅ Land on the exact frame on release - fastSeek during the drag is
// intentionally imprecise for speed, so do one accurate seek now.
if (scrubSessionActive) {
    scrubSessionActive = false;
    window.scrayScrubSeek.end(pendingScrubTime);
    pendingScrubTime = null;
}
if (pendingScrubTime !== null) {
    // Null it FIRST so an early return or throw can't leave it armed for
    // the next gesture.
    const t = pendingScrubTime;
    pendingScrubTime = null;
    try {
        // readyState 0 means the element is mid-load with no media - writing
        // currentTime there is what stalls the iOS media pipeline.
        if (window.plyrPlayer?.media?.readyState > 0) {
            window.plyrPlayer.currentTime = t;
        }
    } catch (err) {
        console.warn('final seek skipped (player not ready):', err);
    }
}
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
// Open a seek session the moment the drag is confirmed - not at touchstart,
// or a plain tap would pause the video.
if (scrubbing && !scrubSessionActive) {
    scrubSessionActive = true;
    window.scrayScrubSeek.begin();
}
if (!scrubbing) {
return;
}

// ---- Jog-scrub (any mode, while paused) ----------
// Same feel as holding a frame-step button down, but the finger drives
// direction and distance instead of a timer, at whichever tier the drag
// started in. Position-based rather than
// incremental: the offset is computed from the TOTAL drag each time, so
// dragging back lands exactly where you started with no accumulated
// drift, which per-move stepping would give you.
if (jogEligible) {
    if (!jogActive) {
        jogActive = true;
        jogStartTime = window.plyrPlayer.currentTime;
        // Frame-accurate work needs a still frame - matches stepFrame().
        if (!window.plyrPlayer.paused) window.plyrPlayer.pause();
    }

    // Same axis convention scrubMove uses below: FLS rotates the video 90°,
    // so the video's own horizontal axis is the screen's Y.
    // ⚙️ If back/forward come out reversed, negate this.
    const jogDelta = manualRotationActive ? (currentY - startY) : (currentX - startX);

    const steps = jogDelta / JOG_PX_PER_STEP;
    let newTime = jogStartTime + (steps * FRAME_STEP_DURATION * jogMultiplier);
    newTime = Math.max(0, Math.min(newTime, window.plyrPlayer.duration));

    // Hand off to the existing rAF throttle rather than seeking here -
    // touchmove fires far faster than a seek completes, and stopScrub
    // already does one precise seek on release.
    pendingScrubTime = newTime;
    if (!scrubRafScheduled) {
        scrubRafScheduled = true;
        requestAnimationFrame(() => {
            scrubRafScheduled = false;
            if (pendingScrubTime === null) return;
            const videoEl = window.plyrPlayer.media;
            if (videoEl && typeof videoEl.fastSeek === 'function') {
                window.scrayScrubSeek.request(pendingScrubTime);
            } else {
                window.scrayScrubSeek.request(pendingScrubTime);
            }
        });
    }

    const offset = newTime - jogStartTime;
    showPlayerFeedback(
        `${offset >= 0 ? '+' : '−'}${Math.abs(offset).toFixed(2)}s (${jogMultiplier}x)  ${formatDuration(newTime * 1000)}`,
        'top-left'
    );
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
     
     // ✅ PERFORMANCE: touchmove can fire 60-120x/sec, far faster than a
     // precise seek can complete. Setting currentTime on every event queues
     // up a backlog of seeks - that's what causes the "catch up" lag.
     // Instead: store only the latest target time, and apply it once per
     // rendered frame via requestAnimationFrame, using fastSeek (keyframe-
     // snapped, near-instant) while actively dragging for a real-time feel.
     pendingScrubTime = newTime;
     if (!scrubRafScheduled) {
         scrubRafScheduled = true;
         requestAnimationFrame(() => {
             scrubRafScheduled = false;
             if (pendingScrubTime === null) return;
             const t = pendingScrubTime;
             const videoEl = window.plyrPlayer.media;
             if (videoEl && typeof videoEl.fastSeek === 'function') {
                 window.scrayScrubSeek.request(t);
             } else {
                 window.scrayScrubSeek.request(t);
             }
             showScrubFeedback(t);
         });
     }
     };

// Touch events - passive: false to allow conditional preventDefault
wrapper.addEventListener('touchstart', startScrub, { passive: false });
// ✅ The touchstart/touchmove listeners live on `wrapper`, which Plyr
// throws away and rebuilds on every source change - so they clean
// themselves up. This one is on `window`, which persists, and this
// function runs again for every new video: without removing the previous
// closure first, handlers accumulate and ONE swipe fires N times.
if (window.__anywhereScrubTouchEnd) {
    window.removeEventListener('touchend', window.__anywhereScrubTouchEnd);
}
window.__anywhereScrubTouchEnd = stopScrub;
window.addEventListener('touchend', stopScrub);
wrapper.addEventListener('touchmove', scrubMove, { passive: false });
// A cancelled touch never reaches stopScrub, which would leave the video
// paused mid-drag with the seek session still open. Close it here, without
// running any of stopScrub's swipe-gesture handling.
wrapper.addEventListener('touchcancel', () => {
    if (scrubSessionActive) {
        scrubSessionActive = false;
        window.scrayScrubSeek.end(pendingScrubTime);
    }
    pendingScrubTime = null;
    scrubbing = false;
    isHorizontalDrag = false;
    isDetermined = false;
    jogEligible = false;
    jogActive = false;
}, { passive: true });

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
// Portrait fullscreen: swipe down to exit
// ========================
// Standalone, document-level detector. Deliberately NOT folded into
// enableAnywhereScrubbing's stopScrub: this needs no shared closure state,
// and being on `document` means it can't be orphaned when Plyr rebuilds its
// internal video/wrapper elements on a source change.

// ⚙️ Minimum downward distance (px) to count as an exit swipe.
const PORTRAIT_FS_SWIPE_EXIT_THRESHOLD_PX = 70;
// ⚙️ Max sideways drift (px) allowed - stops it stealing a scrub gesture.
const PORTRAIT_FS_SWIPE_MAX_HORIZONTAL_PX = 80;

let portraitSwipeExitInitialized = false;

function setupMpfsSwipeExit() {
    if (portraitSwipeExitInitialized) return;
    portraitSwipeExitInitialized = true;

    let startX = 0;
    let startY = 0;
    let tracking = false;

    const isMpfs = () =>
        !!window.plyrPlayer?.fullscreen?.active &&
        !manualRotationActive &&
        window.matchMedia('(orientation: portrait)').matches;

    document.addEventListener('touchstart', (e) => {
        tracking = false;
        if (!isMpfs()) return;
        if (e.touches.length !== 1) return;

        const touch = e.touches[0];
        const target = touch.target;

        // Don't hijack the seek bar, controls, or frame-step circles
        if (target?.closest?.('.plyr__controls')) return;
        if (target?.closest?.('.plyr__progress')) return;
        if (target?.closest?.('#permanentProgressBar')) return;
        if (target?.closest?.('.plyr-frame-step-group')) return;

        startX = touch.clientX;
        startY = touch.clientY;
        tracking = true;
    }, { passive: true });

    document.addEventListener('touchend', (e) => {
        if (!tracking) return;
        tracking = false;

        // Re-check: something else may have exited fullscreen mid-gesture
        if (!window.plyrPlayer?.fullscreen?.active) return;

        const touch = e.changedTouches?.[0];
        if (!touch) return;

        const deltaY = touch.clientY - startY;          // positive = downward
        const deltaX = Math.abs(touch.clientX - startX);

        if (deltaY > PORTRAIT_FS_SWIPE_EXIT_THRESHOLD_PX &&
            deltaX < PORTRAIT_FS_SWIPE_MAX_HORIZONTAL_PX) {
            window.plyrPlayer.fullscreen.exit();
            showPlayerFeedback('⛶ Exit Fullscreen', 'top-left');
            console.log('Portrait fullscreen exited via swipe down');
        } else if (deltaY < -PORTRAIT_FS_SWIPE_EXIT_THRESHOLD_PX &&
            deltaX < PORTRAIT_FS_SWIPE_MAX_HORIZONTAL_PX) {
            // Swipe up (MPFS) - stop playback.
            //
            // Note this is a SECOND handler for the same gesture: stopScrub
            // has its own MPFS swipe-up branch, so both fire on one swipe. That
            // was harmless-ish for random (a cooldown swallowed the second
            // call) but it is very likely why the crash outlived the deferral
            // fix - two independent paths both tearing the player down.
            // Pausing twice is idempotent, so it's harmless now.
            triggerSwipeStopVideo();
            console.log('Portrait fullscreen: stopped via swipe up');
        }
    }, { passive: true });

    document.addEventListener('touchcancel', () => { tracking = false; }, { passive: true });

    console.log('Portrait fullscreen swipe-to-exit initialized');
}

// ========================
// Player feedback overlay
// ========================
function showPlayerFeedback(message, position = 'top-right') {
    // ⚙️ Everything now lands top-right, next to the clock. Callers still
    // pass 'top-left' in places; the override keeps them consistent rather
    // than requiring every call site to change.
    position = 'top-right';
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

// FLS-only companion to the ↻ button: rotates back out to MPFS.
// Hidden by CSS outside body.manual-rotate-landscape, and the ↻ button is
// hidden while it's showing - so the FLS controls row keeps the same button
// count either way.
function attachFlsToMpfsButton() {
const controls = document.querySelector('.plyr__controls');
if (!controls) return;
if (controls.querySelector('.plyr-fls-to-mpfs')) return; // prevent duplicates

// Same touch/desktop detection as the other custom control buttons.
const isTouchDevice = ('ontouchstart' in window) ||
                      (navigator.maxTouchPoints > 0) ||
                      (navigator.msMaxTouchPoints > 0);
const isDesktop = window.innerWidth >= 769 && window.innerHeight >= 600 && !isTouchDevice;
if (isDesktop) return;

const mpBtn = document.createElement("button");
mpBtn.className = "plyr__control plyr-fls-to-mpfs";
mpBtn.innerHTML = '↺';
mpBtn.title = 'Rotate back to portrait fullscreen';
mpBtn.onclick = (e) => {
    switchFlsToMpfs();
    e.currentTarget.blur();
};

// Sits immediately after the ↻ it replaces, so the row order is stable
// when the two swap visibility.
const rotateBtn = controls.querySelector('.plyr-manual-rotate');
const fullscreenBtn = controls.querySelector('[data-plyr="fullscreen"]');
if (rotateBtn) {
    rotateBtn.insertAdjacentElement('afterend', mpBtn);
} else if (fullscreenBtn) {
    controls.insertBefore(mpBtn, fullscreenBtn);
} else {
    controls.appendChild(mpBtn);
}

console.log('FLS-to-MPFS button attached');
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

// ==========================================================
// Unified scrub seek engine  (window.scrayScrubSeek)
// ==========================================================
// Every drag-to-seek path used to call fastSeek() from inside a
// requestAnimationFrame throttle. Two problems with that:
//   1. fastSeek() snaps to the nearest KEYFRAME. On a long-GOP encode those
//      sit 5-10s apart, so the picture only changes when the finger crosses
//      one - which is why some videos scrub smoothly and others barely move.
//   2. rAF fires every ~16ms whether or not the previous seek finished. A
//      seek on a large or remote file takes far longer than that, so each
//      new seek ABORTS the one in flight before it ever paints. Dragging
//      fast therefore shows FEWER frames, not more.
// This engine issues ACCURATE seeks (exact frame, no keyframe snap) and only
// issues the next one once the previous has completed, so the element runs
// flat out at whatever rate it can actually sustain.
//
// ⚙️ Pause playback for the duration of a drag, resume on release. Seeking
// a PLAYING element is far slower on iOS - the pipeline has to re-prime and
// resume every time - so this is the single biggest responsiveness win, and
// is why jog-scrub (paused by definition) already feels frame-by-frame.
const SCRUB_PAUSE_WHILE_DRAGGING = true;
// ⚙️ If 'seeked' never arrives (stalled segment) unblock after this many ms
// so a drag can never freeze. Lower = re-issues sooner on a slow source.
const SCRUB_SEEK_TIMEOUT_MS = 250;
// ⚙️ Ignore requests closer than this to the last issued position - stops a
// stationary finger burning seeks on sub-frame jitter.
const SCRUB_MIN_DELTA_S = 0.015;

window.scrayScrubSeek = (function () {
    let target = null;        // latest requested position, not yet issued
    let lastRequested = null; // latest requested position, ever
    let lastIssued = null;
    let inFlight = false;
    let watchdog = null;
    let resumeOnEnd = false;
    let boundEl = null;

    const media = () => (window.plyrPlayer && window.plyrPlayer.media) || null;

    const clearWatchdog = () => {
        if (watchdog) { clearTimeout(watchdog); watchdog = null; }
    };

    const onSettled = () => {
        clearWatchdog();
        inFlight = false;
        pump();
    };

    // Plyr rebuilds the media element on every source change, so rebind
    // rather than assuming the element we listened to is still the live one.
    const bind = (el) => {
        if (boundEl === el) return;
        if (boundEl) {
            boundEl.removeEventListener('seeked', onSettled);
            boundEl.removeEventListener('error', onSettled);
        }
        boundEl = el;
        if (boundEl) {
            boundEl.addEventListener('seeked', onSettled);
            boundEl.addEventListener('error', onSettled);
        }
    };

    function pump() {
        if (inFlight || target === null) return;
        const el = media();
        // readyState 0 = HAVE_NOTHING: writing currentTime there is what
        // stalls the iOS media pipeline.
        if (!el || el.readyState < 1) return;
        const next = target;
        target = null;
        if (lastIssued !== null && Math.abs(next - lastIssued) < SCRUB_MIN_DELTA_S) return;
        bind(el);
        inFlight = true;
        lastIssued = next;
        watchdog = setTimeout(onSettled, SCRUB_SEEK_TIMEOUT_MS);
        try {
            // Accurate seek, deliberately NOT fastSeek.
            el.currentTime = next;
        } catch (err) {
            onSettled();
        }
    }

    return {
        // Optional - request() works standalone. Call this when a drag is
        // CONFIRMED, not on touchstart, or a plain tap would pause the video.
        begin() {
            target = null;
            lastRequested = null;
            lastIssued = null;
            inFlight = false;
            clearWatchdog();
            resumeOnEnd = false;
            if (!SCRUB_PAUSE_WHILE_DRAGGING) return;
            try {
                if (window.plyrPlayer && !window.plyrPlayer.paused) {
                    resumeOnEnd = true;
                    window.plyrPlayer.pause();
                }
            } catch (e) {}
        },
        request(seconds) {
            if (typeof seconds !== 'number' || !isFinite(seconds)) return;
            target = seconds;
            lastRequested = seconds;
            pump();
        },
        // Safe to call twice, and safe to call without a matching begin().
        end(finalTime) {
            clearWatchdog();
            inFlight = false;
            const landOn = (typeof finalTime === 'number' && isFinite(finalTime))
                ? finalTime
                : (target !== null ? target : lastRequested);
            target = null;
            lastIssued = null;
            lastRequested = null;
            // One last accurate seek so release always lands on the frame the
            // finger was on, even if the pump skipped the final request.
            try {
                const el = media();
                if (el && el.readyState > 0 && typeof landOn === 'number' && isFinite(landOn)) {
                    window.plyrPlayer.currentTime = landOn;
                }
            } catch (e) {}
            if (resumeOnEnd) {
                resumeOnEnd = false;
                try {
                    const resumed = window.plyrPlayer && window.plyrPlayer.play();
                    if (resumed && typeof resumed.catch === 'function') resumed.catch(() => {});
                } catch (e) {}
            }
        }
    };
})();
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
    if (!window.plyrPlayer) return;
    let duration = window.plyrPlayer.duration;
    if ((!duration || isNaN(duration) || duration <= 0) && window.currentPlayingVideo?.durationMs) {
        duration = window.currentPlayingVideo.durationMs / 1000;
    }
    if (!duration) return;

    if (!window.plyrPlayer.paused) {
        window.plyrPlayer.pause();
    }

    const newTime = Math.max(
        0,
        Math.min(duration, window.plyrPlayer.currentTime + (direction * FRAME_STEP_DURATION * multiplier))
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

    const listContainer = document.createElement('div');
    listContainer.style.cssText = `flex: 1 1 auto; min-height: 0; overflow-y: auto; ${NO_AUTOSIZE}`;
    inner.appendChild(listContainer);

    // Buttons at the bottom. The list is flex:1 so it absorbs the slack, and
    // actionRow keeps flex-shrink:0 so a long list can't squeeze it away.
    actionRow.style.marginBottom = '0';
    actionRow.style.marginTop = '6px';
    inner.appendChild(actionRow);

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

/**
 * Keeps playback paused for as long as the bookmark modal is on screen.
 *
 * Pausing once on open wasn't enough - Plyr, the jog-scrub resume, and a tap
 * leaking through the overlay can all restart playback behind the modal.
 * This pauses every <video>/<audio> on the page (which covers PIP, the
 * mini-player and iOS native fullscreen, since they all share the same media
 * element) and re-pauses on any play event until the overlay is gone.
 */
function holdPausedWhileBookmarkModalOpen(overlay) {
    const pauseEverything = () => {
        try {
            if (window.plyrPlayer && !window.plyrPlayer.paused) window.plyrPlayer.pause();
        } catch (e) {}
        document.querySelectorAll('video, audio').forEach(m => {
            try { if (!m.paused) m.pause(); } catch (e) {}
        });
    };

    pauseEverything();

    // 'play' does not bubble, but non-bubbling events still travel through
    // the capture phase - hence the `true`. Listening on the media element
    // directly would miss Plyr rebuilding it mid-modal.
    // Was keyed off the old modal's id. The overlay is passed in anyway, so
    // ask it directly and the helper works for any modal.
    const onPlay = () => {
        if (overlay.isConnected) pauseEverything();
    };
    document.addEventListener('play', onPlay, true);

    const stop = () => {
        document.removeEventListener('play', onPlay, true);
        observer.disconnect();
    };
    // The modal is removed from three separate places (Save, Close, backdrop
    // click), so watch for its removal rather than patching all three.
    const observer = new MutationObserver(() => {
        if (!overlay.isConnected) stop();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // Belt and braces - a missed callback would otherwise leave the listener
    // attached, silently re-pausing for the rest of the session.
    setTimeout(() => { if (!overlay.isConnected) stop(); }, 60000);
}

window.holdPausedWhileBookmarkModalOpen = holdPausedWhileBookmarkModalOpen;

/**
 * There is one bookmark modal now, in file-operations.js. This is kept only
 * so the existing entry points - the BM player control and the FLS
 * triple-tap middle zone - don't each have to change. `true` focuses the
 * note field, the same thing the now-playing BM button asks for.
 */
function showPlayerBookmarkModal() {
    const video = window.currentPlayingVideo;
    if (!video || !window.plyrPlayer) return;
    if (typeof window.showBookmarksModal === 'function') {
        window.showBookmarksModal(video, true);
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

let pendingDesktopSeekTime = null;
let desktopSeekRafScheduled = false;

const applyDesktopVideoSeek = (seekTime, precise) => {
const videoEl = window.plyrPlayer.media;
if (!precise && videoEl && typeof videoEl.fastSeek === 'function') {
window.scrayScrubSeek.request(seekTime);
} else {
window.plyrPlayer.currentTime = seekTime;
}
};

const desktopSeek = (e, precise = false) => {
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

if (precise) {
// ✅ Used on mousedown/mouseup - a single click or a released drag should
// always land frame-accurate, not just keyframe-snapped.
pendingDesktopSeekTime = null;
applyDesktopVideoSeek(seekTime, true);
} else {
// ✅ PERFORMANCE: mousemove can fire faster than a precise seek
// completes, queueing up seeks and causing the "catch up" lag. Throttle
// the actual video seek to once per rendered frame, using fastSeek
// (keyframe-snapped, near-instant) while dragging.
pendingDesktopSeekTime = seekTime;
if (!desktopSeekRafScheduled) {
desktopSeekRafScheduled = true;
requestAnimationFrame(() => {
desktopSeekRafScheduled = false;
if (pendingDesktopSeekTime === null) return;
applyDesktopVideoSeek(pendingDesktopSeekTime, false);
pendingDesktopSeekTime = null;
});
}
}
showPlayerFeedback(`${formatDuration(seekTime * 1000)}`, 'top-left');
};

progressBar.addEventListener('mousedown', (e) => {
if (!window.plyrPlayer.duration) return;
armBookmarkMarkers(progressBar);
isDesktopSeeking = true;
desktopSeek(e, true);
e.preventDefault();
console.log('Started desktop seeking');
});

progressBar.addEventListener('mousemove', (e) => {
if (!isDesktopSeeking) return;
desktopSeek(e);
});

progressBar.addEventListener('mouseup', (e) => {
if (isDesktopSeeking) {
desktopSeek(e, true);
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

// In FLS the player - this bar included - is rotate(90deg), so the bar's
// long axis runs vertically on screen while getBoundingClientRect still
// reports an axis-aligned box. Measuring along clientX there reads across
// the bar's THICKNESS rather than its length, which is why a touch in FLS
// jumps to a position unrelated to where you touched.
// rotate(90deg) maps the bar's local +x onto screen +y, so progress runs
// top-to-bottom. ⚙️ If it comes out mirrored, use (rect.bottom - clientY).
const progressFractionFromPoint = (clientX, clientY) => {
    const rect = progressBar.getBoundingClientRect();
    const raw = manualRotationActive
        ? (clientY - rect.top) / rect.height
        : (clientX - rect.left) / rect.width;
    return Math.max(0, Math.min(1, raw));
};

// ⚙️ A tap always carries a few pixels of jitter, and without a threshold
// each of those fired another seek on top of the tap-to-jump one. Throttled
// or not, that's still a fresh range request per frame on a streamed source,
// which is what made the bar feel oversensitive. Ignore movement below this.
const PROGRESS_DRAG_THRESHOLD_PX = 8;
let progressDragStarted = false;
let progressTouchStartX = 0, progressTouchStartY = 0;

progressBar.addEventListener('touchstart', (e) => {
if (!window.plyrPlayer.duration) return;
armBookmarkMarkers(progressBar);
isSeeking = true;
e.stopPropagation();

// Bookmark markers keep their own tap-to-show / tap-to-jump behaviour -
// seeking out from under them would make them impossible to use.
if (e.target?.closest?.('.progress-bookmark-marker')) return;

// Tap-to-jump. Previously touchstart only armed markers, so a tap that
// produced no touchmove left pendingMobileSeekTime null and touchend did
// nothing at all. Seek precisely here: a tap is a deliberate destination,
// not a drag, so it should land on the frame rather than a keyframe.
const t = e.touches[0];
if (!t) return;
progressTouchStartX = t.clientX;
progressTouchStartY = t.clientY;
progressDragStarted = false;
const percent = progressFractionFromPoint(t.clientX, t.clientY);
const seekTime = percent * window.plyrPlayer.duration;

const filled = progressBar.querySelector('.permanent-progress-filled');
if (filled) filled.style.width = `${percent * 100}%`;

const timestamp = document.querySelector('.permanent-progress-timestamp');
if (timestamp) {
    const remaining = window.plyrPlayer.duration - seekTime;
    timestamp.textContent = `${formatDuration(seekTime * 1000)} / ${formatDuration(remaining * 1000)}`;
}

window.plyrPlayer.currentTime = seekTime;
showPlayerFeedback(`${formatDuration(seekTime * 1000)}`, 'top-left');
}, { passive: false });

let pendingMobileSeekTime = null;
let mobileSeekRafScheduled = false;

progressBar.addEventListener('touchmove', (e) => {
if (!isSeeking || !window.plyrPlayer.duration) return;

e.preventDefault();
e.stopPropagation();

const touch = e.touches[0];

// Below the threshold this is still a tap, not a drag. The touchstart
// handler already seeked to the tap point precisely - re-seeking on jitter
// only undoes that with a less accurate keyframe-snapped value.
if (!progressDragStarted) {
    const moved = manualRotationActive
        ? Math.abs(touch.clientY - progressTouchStartY)
        : Math.abs(touch.clientX - progressTouchStartX);
    if (moved < PROGRESS_DRAG_THRESHOLD_PX) return;
    progressDragStarted = true;
    window.scrayScrubSeek.begin();
}

// Axis-aware - see progressFractionFromPoint above. The old
// touchX / rect.width was measuring across the bar in FLS.
const percent = progressFractionFromPoint(touch.clientX, touch.clientY);
const seekTime = percent * window.plyrPlayer.duration;

// ✅ PERFORMANCE: touchmove can fire faster than a precise seek completes,
// queueing up seeks and causing the "catch up" lag. Throttle the actual
// video seek to once per rendered frame, using fastSeek (keyframe-snapped,
// near-instant) while dragging. touchend below does one final precise seek.
pendingMobileSeekTime = seekTime;
if (!mobileSeekRafScheduled) {
mobileSeekRafScheduled = true;
requestAnimationFrame(() => {
mobileSeekRafScheduled = false;
if (pendingMobileSeekTime === null) return;
const videoEl = window.plyrPlayer.media;
if (videoEl && typeof videoEl.fastSeek === 'function') {
window.scrayScrubSeek.request(pendingMobileSeekTime);
} else {
window.scrayScrubSeek.request(pendingMobileSeekTime);
}
pendingMobileSeekTime = null;
});
}
showPlayerFeedback(`${formatDuration(seekTime * 1000)}`, 'top-left');
}, { passive: false });

progressBar.addEventListener('touchend', (e) => {
if (isSeeking) {
    // ✅ Land on the exact frame on release
    if (progressDragStarted) {
        window.scrayScrubSeek.end(pendingMobileSeekTime);
        pendingMobileSeekTime = null;
    }
    console.log(`Seeked to ${formatDuration(window.plyrPlayer.currentTime * 1000)} via progress bar touch`);
}
isSeeking = false;
progressDragStarted = false;
});

progressBar.addEventListener('touchcancel', () => {
if (progressDragStarted) {
    window.scrayScrubSeek.end();
}
pendingMobileSeekTime = null;
progressDragStarted = false;
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
// ⚙️ Markers whose centres sit closer than this (px along the bar) are a
// cluster: one tap on any of them raises the whole group, because at this
// spacing a fingertip can't pick out a single dot.
const BOOKMARK_CLUSTER_PX = 26;
// ⚙️ Tooltip rail. Chips are equal width and share one row; the rail is
// centred on the play button and floats just above the control bar.
const CHIP_GAP_PX = 6;
const CHIP_PREFERRED_PX = 150;   // per chip, before the rail hits its cap
const RAIL_GAP_ABOVE_CONTROLS_PX = 10;
const RAIL_SIDE_MARGIN_PX = 8;
const RAIL_FADE_MS = 5000;
const RAIL_ID = 'bookmarkTooltipRail';

/**
 * Remove the tooltip rail, wherever it currently lives.
 *
 * On window because the rail outlives any single render: the bar's disarm
 * listener is bound once and must be able to close whatever is up.
 */
function hideBookmarkRail() {
    document.getElementById(RAIL_ID)?.remove();
}
window.hideBookmarkRail = hideBookmarkRail;

/**
 * Offset of `el` inside `ancestor`, in the ancestor's own layout coordinates.
 *
 * offsetLeft/offsetTop are pre-transform, which is exactly what's wanted: in
 * FLS the control bar is rotated as a unit, so anything measured in its local
 * frame comes out right with no rotation maths at all.
 */
function localOffsetWithin(el, ancestor) {
    let x = 0, y = 0, n = el;
    while (n && n !== ancestor) {
        x += n.offsetLeft;
        y += n.offsetTop;
        n = n.offsetParent;
    }
    return n === ancestor ? { x, y } : null;
}

/**
 * Raise the tooltip rail for a group of bookmarks.
 *
 * The rail is a child of .plyr__controls on purpose. The controls are the one
 * element the forced-landscape code already rotates and positions correctly,
 * so parenting to them means the rail needs no orientation handling of its
 * own, and both anchors below are expressible in their coordinate space.
 *
 * soloPercent: position along the bar (0-100) to sit above, or null to sit
 * above the play button. A single bookmark points at its own marker; a fanned
 * cluster doesn't, because it has no single marker to point at.
 */
function showBookmarkRail(group, onPick, soloPercent = null) {
    hideBookmarkRail();

    const controls = document.querySelector('.plyr__controls');
    if (!controls) return null;

    // Must be a containing block for the absolutely positioned rail. Plyr
    // already positions the controls in most modes; only promote it when it
    // genuinely isn't, so we never fight Plyr's own layout.
    if (getComputedStyle(controls).position === 'static') {
        controls.style.position = 'relative';
    }

    const rail = document.createElement('div');
    rail.id = RAIL_ID;
    rail.style.cssText = `
        position: absolute;
        bottom: 100%;
        margin-bottom: ${RAIL_GAP_ABOVE_CONTROLS_PX}px;
        display: flex;
        gap: ${CHIP_GAP_PX}px;
        z-index: 71;
        pointer-events: auto;
    `;

    group.forEach(entry => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'bookmark-tooltip-chip';
        chip.textContent = entry.bm.note
            ? `${formatDuration(entry.bm.time * 1000)} ${entry.bm.note}`
            : formatDuration(entry.bm.time * 1000);
        chip.title = chip.textContent;
        // Equal widths come from flex-grow/shrink/basis against the rail's
        // fixed width - longhands rather than the `flex` shorthand, which
        // some engines reserialise as `flex-basis: 0%` and others drop.
        // width:auto and the margin reset are for the global mobile
        // `button { width: 100% }` rule.
        chip.style.cssText = `
            flex-grow: 1;
            flex-shrink: 1;
            flex-basis: 0;
            width: auto;
            min-width: 0;
            margin: 0;
            padding: 6px 8px;
            border: none;
            border-radius: 4px;
            background: rgba(0, 0, 0, 0.85);
            color: #fff;
            font-size: 0.65rem;
            line-height: 1.25;
            text-align: center;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            cursor: pointer;
        `;
        chip.addEventListener('mousedown', (e) => e.stopPropagation());
        chip.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
        chip.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            hideBookmarkRail();
            onPick(entry);
        });
        rail.appendChild(chip);
    });

    controls.appendChild(rail);

    // ---- place it: centred on the play button, clamped inside the bar ----
    const maxWidth = Math.max(120, controls.clientWidth - RAIL_SIDE_MARGIN_PX * 2);
    const wanted = group.length * CHIP_PREFERRED_PX + (group.length - 1) * CHIP_GAP_PX;
    const railWidth = Math.min(wanted, maxWidth);
    rail.style.width = railWidth + 'px';

    let anchorX = null;

    if (soloPercent !== null) {
        // Marker-anchored. The bar and the controls are separate elements, so
        // the marker's position has to be re-expressed in the controls' frame.
        // Comparing the two bounding boxes works in FLS as well as anywhere
        // else: both elements carry the same 90deg rotation, so their length
        // axes both map onto screen Y there and onto screen X otherwise.
        const bar = document.querySelector('.permanent-progress-bar');
        if (bar) {
            const rotated = (typeof manualRotationActive !== 'undefined' && manualRotationActive);
            const b = bar.getBoundingClientRect();
            const c = controls.getBoundingClientRect();
            const barLen = rotated ? b.height : b.width;
            const delta = rotated ? (b.top - c.top) : (b.left - c.left);
            if (barLen) anchorX = delta + (soloPercent / 100) * barLen;
        }
    }

    if (anchorX === null) {
        const playBtn = controls.querySelector('.plyr__control[data-plyr="play"]');
        const off = playBtn ? localOffsetWithin(playBtn, controls) : null;
        anchorX = off
            ? off.x + playBtn.offsetWidth / 2
            : controls.clientWidth / 2;   // no play button found - centre the bar
    }

    const half = railWidth / 2;
    const clamped = Math.max(
        half + RAIL_SIDE_MARGIN_PX,
        Math.min(anchorX, controls.clientWidth - half - RAIL_SIDE_MARGIN_PX)
    );
    rail.style.left = clamped + 'px';
    rail.style.transform = 'translateX(-50%)';

    return rail;
}

function renderBookmarkMarkers() {
const progressBar = document.querySelector('.permanent-progress-bar');
if (!progressBar) return;

// A rail left over from the previous video would point at bookmarks that
// are no longer on this bar.
hideBookmarkRail();
progressBar.querySelectorAll('.progress-bookmark-marker').forEach(m => m.remove());

const video = window.currentPlayingVideo;
if (!video || !Array.isArray(video.bookmarks) || video.bookmarks.length === 0) {
    return;
}

const duration = window.plyrPlayer?.duration;
if (!duration || isNaN(duration) || duration <= 0) {
    return;
}

const canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
const isTouchDevice = !canHover;

const entries = [];

video.bookmarks.forEach(bm => {
    if (typeof bm.time !== 'number') return;

    const percent = Math.max(0, Math.min(100, (bm.time / duration) * 100));

    const marker = document.createElement('div');
    marker.className = 'progress-bookmark-marker';
    marker.style.left = `${percent}%`;

    progressBar.appendChild(marker);
    entries.push({ bm, marker, percent, cluster: null });
});

if (!entries.length) return;

// ---- cluster detection -------------------------------------------------
// Turning a % gap into a px gap needs the bar's length. In FLS the bar is
// rotate(90deg), so getBoundingClientRect().width reports its THICKNESS -
// the length runs down .height there, same as the seek maths.
const rect = progressBar.getBoundingClientRect();
const rotated = (typeof manualRotationActive !== 'undefined' && manualRotationActive);
const barLengthPx = (rotated ? rect.height : rect.width) || progressBar.offsetWidth || 0;

const sorted = entries.slice().sort((a, b) => a.percent - b.percent);
let group = [sorted[0]];
const groups = [group];
for (let i = 1; i < sorted.length; i++) {
    const gapPx = ((sorted[i].percent - sorted[i - 1].percent) / 100) * barLengthPx;
    if (gapPx < BOOKMARK_CLUSTER_PX) {
        group.push(sorted[i]);
    } else {
        group = [sorted[i]];
        groups.push(group);
    }
}
// Every entry gets a cluster, including singletons - a lone bookmark is just
// a group of one, so the rail is built by exactly the same code path.
groups.forEach(g => g.forEach(e => { e.cluster = g; }));

const jumpTo = (entry) => {
    hideBookmarkRail();
    if (window.plyrPlayer && !isNaN(entry.bm.time)) {
        window.plyrPlayer.currentTime = entry.bm.time;
        window.plyrPlayer.play();
        showPlayerFeedback(`→ ${formatDuration(entry.bm.time * 1000)}`, 'top-left');
    }
};

let fadeTimer = null;
const raise = (entry) => {
    if (fadeTimer) clearTimeout(fadeTimer);
    // A lone bookmark points at its own marker. A fanned cluster stays put
    // above the play button - it covers several markers, so there's no one
    // marker for it to sit over.
    const solo = entry.cluster.length === 1 ? entry.percent : null;
    showBookmarkRail(entry.cluster, jumpTo, solo);
    fadeTimer = setTimeout(hideBookmarkRail, RAIL_FADE_MS);
};

entries.forEach(entry => {
    const { marker } = entry;

    // CRITICAL: Block the underlying progress bar's seek handlers from ever
    // firing when interacting with a marker - stop propagation on EVERY
    // pointer event, not just click, since the bar listens on mousedown
    // (desktop seek) and touchstart (mobile seek).
    marker.addEventListener('mousedown', (e) => e.stopPropagation());
    marker.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });

    // The marker only ever RAISES the rail. It deliberately never jumps, on
    // any number of taps: two taps to reach a bookmark and the second is
    // always on a chip, so there's no armed state to remember and no way to
    // seek by accident while trying to read a note.
    marker.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        raise(entry);
    });

    if (!isTouchDevice) {
        marker.addEventListener('mouseenter', () => raise(entry));
    }
});

// Tapping the bar itself dismisses whatever is up.
if (isTouchDevice && !progressBar.dataset.bookmarkDisarmBound) {
    progressBar.dataset.bookmarkDisarmBound = 'true';
    progressBar.addEventListener('touchstart', (e) => {
        if (e.target.closest('.progress-bookmark-marker')) return;
        hideBookmarkRail();
    }, { passive: true });
}
}

// Export globally so bookmark modal can refresh markers after add/delete/save
window.renderBookmarkMarkers = renderBookmarkMarkers;

// Update permanent progress bar
let _lastLoggedDuration = null;
function updatePermanentProgressBar() {
const current = window.plyrPlayer.currentTime;
let duration = window.plyrPlayer.duration;
const rawDuration = duration;
if ((!duration || isNaN(duration) || duration <= 0) && window.currentPlayingVideo?.durationMs) {
    duration = window.currentPlayingVideo.durationMs / 1000;
}
if (duration !== _lastLoggedDuration) {
    _lastLoggedDuration = duration;
    console.log(`updatePermanentProgressBar: plyr.duration=${rawDuration}, currentPlayingVideo.durationMs=${window.currentPlayingVideo?.durationMs}, resolved duration=${duration}, current=${current}`);
}

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

// Position the control stack in fullscreen
// ⚙️ tweak FULLSCREEN_CONTROLS_BOTTOM_VH / FULLSCREEN_PROGRESS_BOTTOM_VH
applyFullscreenControlOffsets();
}

// Initialize permanent progress bar on ready — guarded so redundant
// 'ready'/'loadedmetadata' firings for the SAME video don't wipe an
// already-correct progress bar back to 0:00/0:00.
let _progressBarSetupForVideoId = null;
let _readyFireCount = 0;
window.plyrPlayer.on('ready', () => {
_readyFireCount++;
console.log(`'ready' event fired (count: ${_readyFireCount})`);
if (window.currentPlayingVideo?.oneDriveId !== _progressBarSetupForVideoId) {
    _progressBarSetupForVideoId = window.currentPlayingVideo?.oneDriveId;
    setupPermanentProgressBar();
} else {
    console.log('Skipping redundant progress bar rebuild (same video)');
}
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

// =========================================================
// TRANSITION HOLD - keep the loading overlay AND the control bar up for
// the whole of a video change, not just the first couple of seconds.
//
// Three separate things were taking them away mid-load:
//   1. Plyr auto-hides the controls ~2s after play() is called. `paused`
//      goes false the instant play() is invoked, long before a large file
//      has buffered, so the idle-hide timer runs during the load.
//   2. Setting .source makes Plyr soft-destroy and rebuild .plyr__controls.
//      Every button we add ourselves - X, H<, >, stop, rotate, bookmark and
//      the rest - was only re-attached on 'loadedmetadata', which doesn't
//      fire until the browser has enough of the file to know its duration.
//      So for the whole first stretch of the load the bar is there but has
//      none of the buttons you'd actually want to press.
//   3. The FLS title bar and frame-step group fade with
//      .plyr--hide-controls, so they went with the controls.
//
// While the hold is on, body carries .scray-video-loading and the CSS rules
// added to style.css pin all of it open. Plyr's own timer still runs
// underneath - we override the RESULT rather than fighting the timer, which
// would flicker the bar every couple of seconds.
// =========================================================

// ⚙️ Hard ceiling (ms). If 'playing' never arrives - stalled source, a
// format the decoder silently rejects - the hold releases anyway rather
// than pinning the controls open for the rest of the session.
const VIDEO_LOAD_HOLD_MAX_MS = 90000;
let videoLoadHoldTimer = null;

function scrayShowControlsNow() {
    document.querySelector('.plyr')?.classList.remove('plyr--hide-controls');
    try { window.plyrPlayer?.toggleControls?.(true); } catch (e) {}
}

function beginVideoLoadHold() {
    window.scrayVideoLoading = true;
    document.body.classList.add('scray-video-loading');
    clearTimeout(videoLoadHoldTimer);
    videoLoadHoldTimer = setTimeout(endVideoLoadHold, VIDEO_LOAD_HOLD_MAX_MS);
    scrayShowControlsNow();
}

function endVideoLoadHold() {
    clearTimeout(videoLoadHoldTimer);
    videoLoadHoldTimer = null;
    window.scrayVideoLoading = false;
    // Deferred while the hold was on - settle on the real state now.
    if (typeof updatePlayerStateClass === 'function') updatePlayerStateClass();
    document.body.classList.remove('scray-video-loading');
}

// Called from playVideoInline / resetVideoInline / showVideoError, which are
// outside createPlayerElement's scope - hence the window handles.
window.beginVideoLoadHold = beginVideoLoadHold;
window.endVideoLoadHold = endVideoLoadHold;

// Plyr has finished rebuilding the control bar by the time 'loadstart'
// fires, so put the custom buttons back NOW instead of waiting for
// 'loadedmetadata'. Every attach* function bails early if its button is
// already present, so the existing 'loadedmetadata' pass stays harmless.
window.plyrPlayer.on('loadstart', window.scrayRebuildPlayerControls = () => {
    // Order matters. cleanupPlyrControls strips Plyr's built-in progress bar
    // and time readouts, so doing it BEFORE the buttons go on means the bar
    // is laid out once instead of rendering wide and then reflowing as each
    // change lands - which is what the rapid rebuild flicker was.
    cleanupPlyrControls();
    attachStopButton();
    attachPIPButton();
    attachIOSFullscreenButton();
    attachManualRotateButton();
    attachFlsToMpfsButton();
    attachScrollLockButton();
    attachRandomVideoButton();
    attachHistorySequenceButton();
    attachPlayNextButton();
    attachBasketQuickButton();
    attachBookmarkQuickButton();
    attachFrameStepButtons();
    // The rebuilt bar comes back with none of FLS's inline rotation styles -
    // including the z-index that lifts it above the reload mask - so it can
    // look like it vanished. Re-style it the moment it exists.
    if (manualRotationActive) applyManualRotationStyles();
    scrayShowControlsNow();
});

// The new video is on screen - let everything behave normally again.
// 'error' covers the load that never gets there.
// ⚙️ How long the bar stays up AFTER playback actually starts. Releasing on
// 'playing' made it vanish at the exact moment the picture appeared, which
// read as a glitch; this lets it sit there and then fade on Plyr's own
// 0.4s transition instead.
const CONTROLS_LINGER_AFTER_PLAY_MS = 1000;

window.plyrPlayer.on('playing', () => {
    // Reusing the hold timer on purpose - beginVideoLoadHold clears it, so a
    // new request during the linger cancels this cleanly.
    clearTimeout(videoLoadHoldTimer);
    videoLoadHoldTimer = setTimeout(endVideoLoadHold, CONTROLS_LINGER_AFTER_PLAY_MS);
});
window.plyrPlayer.on('error', endVideoLoadHold);
window.plyrPlayer.on('canplay', () => window.scrayApplyPendingStartAt?.('canplay'));

// Recreate on source change (new video loaded)
let _loadedMetadataFireCount = 0;
window.plyrPlayer.on('loadedmetadata', () => {
_loadedMetadataFireCount++;
console.log(`'loadedmetadata' event fired (count: ${_loadedMetadataFireCount})`);
if (window.currentPlayingVideo?.oneDriveId !== _progressBarSetupForVideoId) {
    _progressBarSetupForVideoId = window.currentPlayingVideo?.oneDriveId;
    setupPermanentProgressBar(); //  Also calls renderBookmarkMarkers() internally
} else {
    // Full rebuild skipped (same video), but still re-render markers - this
    // is the fix for markers silently never appearing: 'ready' can fire
    // before duration is known for scray-video:// sources, so the earlier
    // setupPermanentProgressBar() call may have run renderBookmarkMarkers()
    // before duration was available and silently drawn nothing. Redrawing
    // here (cheap - just clears and rebuilds marker elements) catches the
    // case where duration is now finally ready.
    console.log('Skipping redundant progress bar rebuild (same video) - re-rendering bookmark markers only');
    renderBookmarkMarkers();
}
setTimeout(cleanupPlyrControls, 100); // Delay to ensure Plyr is ready

//  Reapply forced-landscape rotation styles here too - covers the
// window between source-set and playback where video-wrapper/video/
// progress bar can lose their inline styles.
if (manualRotationActive) {
    applyManualRotationStyles();
}
});

// Update controls + progress bar position when entering/exiting fullscreen
window.plyrPlayer.on('enterfullscreen', () => {
setTimeout(applyFullscreenControlOffsets, 100);
});

window.plyrPlayer.on('exitfullscreen', () => {
clearFullscreenControlOffsets();
console.log('✅ Reset controls + progress bar position on fullscreen exit');
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
setupMpfsSwipeExit(); // swipe down to exit MPFS
enableAnywhereScrubbing();
attachStopButton();
attachPIPButton(); // Add PIP button
attachIOSFullscreenButton(); // Add iOS native fullscreen button
attachManualRotateButton(); // Add manual rotate-to-landscape button
attachFlsToMpfsButton(); // Add FLS -> MPB-fullscreen button (FLS only)
attachScrollLockButton(); // Add scroll-lock button (manual rotation only)
attachRandomVideoButton(); //  Add random-video quick-action button
attachHistorySequenceButton(); //  Add play-through-history quick-action button
attachPlayNextButton(); //  Add play-next quick-action button
attachBasketQuickButton(); //  Add basket quick-view button
attachBookmarkQuickButton(); //  Add bookmark quick-add button
attachFrameStepButtons(); // Add frame-by-frame step buttons
// Frame-step columns removed - the left half is now jog-scrub and triple-tap
// territory. attachColumnFrameStepZones is left defined but uncalled.
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
    // While an FLS video is loading, the browser drops real fullscreen for a
    // stretch of the load - so detectPlayerState() reports 'portrait-inline'
    // and the body gets re-labelled mid-transition. That re-docks the player
    // to its small inline box while .fullscreen-active is still hiding
    // everything around it, which is the black screen. The exitfullscreen
    // teardown is already deferred for exactly this reason (see
    // handleExitFullscreenCleanup); this defers the body label that goes with
    // it. endVideoLoadHold recomputes the state as soon as the load is done.
    if (window.scrayVideoLoading && manualRotationActive) return;
    const stateClass = detectPlayerState();
    document.body.classList.remove(
        'portrait-fullscreen', 'portrait-inline', 'portrait-mini',
        'landscape-fullscreen', 'landscape-inline', 'landscape-mini'
    );
    if (stateClass) document.body.classList.add(stateClass);
    window.currentPlayerState = stateClass;
    // console.log('Player state:', stateClass);

    // Entering fullscreen mid-video doesn't re-run rebuildVideoInfoDisplay,
    // so the bar would sit empty until the next track. This covers every
    // fullscreen enter/exit and orientation change in one place.
    if (typeof window.syncVideoTitleBar === 'function') window.syncVideoTitleBar();
}

window.addEventListener('resize', updatePlayerStateClass);

// Backstop for the double-tap-to-seek selection. The CSS above covers the
// subtree, but WebKit ignores user-select on the <video> element itself in a
// few paths, so clear anything that still lands inside the player before the
// callout bar can attach to it. selectionchange only fires when a selection
// actually changes and this bails immediately on collapsed ones, so it costs
// nothing during normal playback.
document.addEventListener('selectionchange', () => {
    const sel = document.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    const node = sel.anchorNode;
    const el = node && (node.nodeType === 1 ? node : node.parentElement);
    if (!el) return;
    // Anchored on a page-level ancestor, not the player - checking for the
    // player subtree here was the reason the long-press case got through.
    if (el.closest('input, textarea, [contenteditable="true"], #inlineConsole, .allow-select')) return;
    sel.removeAllRanges();
});

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
// ✅ Guarantee the docked px width/height are gone even if
// computeBottomDock() early-returned (keyboard + search-pill state),
// otherwise a narrow video stays squeezed to the dock's width.
releaseDockedVideoFit();

// ⚙️ Position controls + progress bar (FULLSCREEN_*_BOTTOM_VH constants)
setTimeout(applyFullscreenControlOffsets, 100);
});

// The real exitfullscreen work, split out so it can be skipped during a
// reload and replayed later if the re-entry never happened.
//
// ⚠️ The mask helpers that pair with this (beginFullscreenReload /
// endFullscreenReload) deliberately live at TOP LEVEL, just above
// playVideoInline - NOT here. Everything in this block is scoped inside
// createPlayerElement(), so anything declared here is invisible to
// playVideoInline, which is exactly where those helpers get called from.
function handleExitFullscreenCleanup() {
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
}

// ✅ Exposed so the top-level mask helpers can replay this teardown if
// fullscreen never comes back after a reload.
window.handleExitFullscreenCleanup = handleExitFullscreenCleanup;

window.plyrPlayer.on('exitfullscreen', () => {
    if (window.fullscreenReloadActive) {
        // Transient exit caused by the source swap - we're going straight
        // back in, so leave the layout exactly as it is.
        window.fullscreenExitCleanupDeferred = true;
        console.log('Suppressed fullscreen teardown (source reload in progress)');
        return;
    }
    handleExitFullscreenCleanup();
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
window.plyrPlayer.on('error', () => {
    loadingOverlay.style.display = 'none';
    // Local files skip refreshVideoBeforeUse entirely, so a row whose file is
    // gone from disk failed SILENTLY — the scray-video:// request simply never
    // resolved. Route it to the same overlay OneDrive 404s use, which now
    // carries a "Remove from list" button for exactly this case.
    // MEDIA_ERR_DECODE (3) is excluded: that's a real file the decoder can't
    // handle (MKV, VC-1), and calling it "not found" would be a lie.
    try {
        const v = window.currentPlayingVideo;
        const isLocal = v && (v.driveId === "local" || (v.accountKey || "").startsWith("local::"));
        const code = window.plyrPlayer?.media?.error?.code;
        if (isLocal && code !== 3 && typeof window.showFileNotFoundError === 'function') {
            window.showFileNotFoundError(v);
        }
    } catch {}
});

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
attachFlsToMpfsButton(); // Re-attach FLS -> MPFS button on new video
attachScrollLockButton(); // Re-attach scroll-lock button on new video
attachRandomVideoButton(); //  Re-attach random-video button on new video
attachHistorySequenceButton(); //  Re-attach play-through-history button on new video
attachPlayNextButton(); //  Re-attach play-next button on new video
attachBasketQuickButton(); //  Re-attach basket quick-view button on new video
attachBookmarkQuickButton(); //  Re-attach bookmark quick-add button on new video
// Deferred start point (bookmark rows, and anything else that wants to open
// part-way in). loadedmetadata is the earliest the duration is known, so it is
// the first attempt - the helper handles the case where the media accepts the
// seek and then snaps back because it is not seekable yet.
window.scrayApplyPendingStartAt?.('loadedmetadata');
attachFrameStepButtons(); // Re-attach frame-step buttons on new video
// (frame-step columns removed)
computeBottomDock(); // ✅ Player height may have changed for the new video
});

// Double-tap gesture handler - works in ALL modes (inline and fullscreen)
function setupDoubleTapHandler() {
 let lastTap = 0;

 // ⚙️ Triple tap in the FLS left third opens the bookmark modal.
 // Zone-scoped on purpose: the count resets whenever a tap lands outside
 // that third, so a stray tap elsewhere can't accumulate into a phantom
 // triple. 400ms between taps rather than 300 - three taps is a slower,
 // more deliberate gesture than two.
 const TRIPLE_TAP_MS = 400;
 let tripleCount = 0;
 let tripleLast = 0;
 window.scraySuppressControlsToggle = false;

 // ⚙️ The left third is now split into three vertical zones, so the tracker
 // carries WHICH zone the taps landed in rather than a bare boolean. All
 // three taps must land in the SAME zone - drifting between zones resets
 // the count, so a sloppy gesture can never fire the wrong modal.
 // Returns the zone name on the third tap, otherwise null.
 let tripleZone = null;

 const trackTripleTap = (zone) => {
     const now = Date.now();
     if (!zone || zone !== tripleZone || now - tripleLast > TRIPLE_TAP_MS) {
         tripleCount = zone ? 1 : 0;
         tripleLast = zone ? now : 0;
         tripleZone = zone || null;
         window.scraySuppressControlsToggle = !!zone;
         return null;
     }
     tripleCount += 1;
     tripleLast = now;
     // Suppress Plyr's show/hide toggle mid-sequence, otherwise the controls
     // flash on and off between taps. If single taps ever stop revealing the
     // controls on the left, this flag is where to look.
     window.scraySuppressControlsToggle = true;
     if (tripleCount >= 3) {
         tripleCount = 0;
         tripleLast = 0;
         tripleZone = null;
         window.scraySuppressControlsToggle = false;
         return zone;
     }
     return null;
 };
 window.scrayTrackTripleTap = trackTripleTap;

 // The score picker (.score-context-menu) has no FLS awareness of its own -
 // it positions itself at raw event coordinates and never rotates, unlike
 // the basket and bookmark modals which both branch on
 // body.manual-rotate-landscape. A touchend also carries no clientX/clientY
 // (only changedTouches), so left alone the menu would land at 0,0 and read
 // sideways in forced landscape. Centre it and rotate it to match.
 const openScoreModalForCurrentVideo = () => {
     const v = window.currentPlayingVideo;
     if (!v || typeof window.showVideoScoringModal !== 'function') return;

     window.showVideoScoringModal(v, {
         clientX: window.innerWidth / 2,
         clientY: window.innerHeight / 2
     });

     const menu = document.querySelector('.score-context-menu');
     if (!menu) return;

     const place = () => {
         menu.style.top = '50%';
         menu.style.left = '50%';
         menu.style.transform = document.body.classList.contains('manual-rotate-landscape')
             ? 'translate(-50%, -50%) rotate(90deg)'
             : 'translate(-50%, -50%)';
     };
     place();
     // showVideoScoringModal nudges left/top in its own setTimeout(0) when
     // the menu overflows. Ours is queued after it, so ours wins.
     setTimeout(place, 0);
 };
 
 // Handler function that can be attached to any element
 const handleDoubleTap = function(e) {
     const isMiniPlayer = document.getElementById('inlineVideoContainer')?.classList.contains('mini-player');
     
     // Skip if mini-player
     if (isMiniPlayer) return;
     
     const now = Date.now();

     // Every tap feeds the triple counter, before the double-tap gate.
     {
         const tEl = e.currentTarget;
         const tRect = tEl.getBoundingClientRect();
         const remap = manualRotationActive
             ? remapForManualRotation(e.changedTouches[0].clientX, e.changedTouches[0].clientY, tRect)
             : null;
         const tX = remap ? remap.x : (e.changedTouches[0].clientX - tRect.left);
         const tW = remap ? remap.width : tRect.width;
         const tY = remap ? remap.y : (e.changedTouches[0].clientY - tRect.top);
         const tH = remap ? remap.height : tRect.height;
         const inFlsLeftThird = isForcedOrRealLandscapeMobile()
             && window.innerWidth <= 1024
             && tX < tW / 3;

         // ⚙️ Left third, split top-to-bottom AS SEEN IN LANDSCAPE (the
         // remap above has already converted forced-rotation coordinates,
         // so this is the same maths in both real and forced landscape):
         //   top third    -> basket modal (what triple tap always did)
         //   middle third -> bookmark modal
         //   bottom third -> score picker
         let flsZone = null;
         if (inFlsLeftThird) {
             const vFrac = tY / tH;
             flsZone = vFrac < (1 / 3) ? 'basket'
                     : vFrac < (2 / 3) ? 'bookmark'
                     : 'score';
         }

         const firedZone = window.scrayTrackTripleTap?.(flsZone);
         if (firedZone) {
             e.stopPropagation();
             e.preventDefault();
             lastTap = 0;
             if (firedZone === 'score') {
                 openScoreModalForCurrentVideo();
             } else if (firedZone === 'bookmark') {
                 if (typeof showPlayerBookmarkModal === 'function') showPlayerBookmarkModal();
             } else {
                 // Same modal the FLS title bar opens.
                 if (typeof showPlayerBasketModal === 'function') showPlayerBasketModal();
             }
             return;
         }
     }

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
   
         // LANDSCAPE MOBILE: vertical thirds.
         //   Left   (0-33%)   triple tap -> bookmark modal (no double-tap action)
         //   Middle (33-66%)  double tap -> play/pause
         //   Right  (66-100%) split into two sixths:
         //        left sixth  = minus seeks, right sixth = plus seeks
         //        vertical thirds, top to bottom: 30s / 10s / 3s
if (isLandscape && isMobile) {
    const thirdW = effRect.width / 3;
    const inLeftThird   = effTapX < thirdW;
    const inMiddleThird = effTapX >= thirdW && effTapX < thirdW * 2;

    if (inLeftThird) {
        // Nothing on double tap. This third is the triple-tap zone, handled
        // separately - see the triple-tap tracker. Because there's no
        // double-tap action here, the triple can fire on the third tap with
        // no waiting period, which a shared zone would have forced.
        return;
    }

    if (inMiddleThird) {
        const willBePaused = !window.plyrPlayer.paused;
        window.plyrPlayer.togglePlay();
        showPlayerFeedback(willBePaused ? '⏸ Paused' : '▶ Playing');
        return;
    }

    // RIGHT THIRD: two sixths side by side, three tiers tall.
    const intoRight = (effTapX - thirdW * 2) / thirdW;   // 0..1 across the third
    const isMinus = intoRight < 0.5;
    const vFrac = effTapY / effRect.height;
    const amount = vFrac < (1 / 3) ? 30 : vFrac < (2 / 3) ? 10 : 3;
    const delta = isMinus ? -amount : amount;

    window.plyrPlayer.currentTime = Math.max(
        0, Math.min(window.plyrPlayer.duration, window.plyrPlayer.currentTime + delta)
    );
    showPlayerFeedback(
        `${delta > 0 ? '+' : '−'}${amount}s (${formatDuration(window.plyrPlayer.currentTime * 1000)})`
    );
    return;
}

// eslint-disable-next-line no-constant-condition
if (false) {
} else {
    // ✅ MPB: four vertical quarters.
    //   Q1 (0-25%)   fullscreen toggle
    //   Q2 (25-50%)  play/pause  <- deliberate dead space in the middle,
    //                               so there's somewhere safe to double-tap
    //   Q3 (50-75%)  minus seeks (-3 / -10 / -30, bottom to top)
    //   Q4 (75-100%) plus seeks  (+3 / +10 / +30, bottom to top)
    // The seek pair used to occupy the middle and right THIRDS; squeezing
    // them into the right half is what frees Q2 up.
    const q1 = effRect.width / 4;
    const q2 = effRect.width / 2;
    const q3 = (effRect.width / 4) * 3;
    const topThird = effRect.height / 3;
    const bottomThird = (effRect.height / 3) * 2;
    
    if (effTapX < q1) {
        // Left third toggles fullscreen. Which KIND of fullscreen depends on
        // the video's own shape:
        //  - Portrait video: plain Plyr fullscreen. Rotating a portrait frame
        //    into a landscape box only letterboxes it, so FLS is pointless
        //    here. FLS is still reachable via the ↻ control button.
        //  - Landscape video: forced-landscape (FLS), as before - that's the
        //    whole reason the rotate path exists on a portrait-locked phone.
        const isPortraitVideo = window.currentVideoOrientation === 'P';

        if (!isPortraitVideo && typeof window.toggleManualRotation === 'function') {
            window.toggleManualRotation();
        } else if (window.plyrPlayer.fullscreen.active) {
            window.plyrPlayer.fullscreen.exit();
            showPlayerFeedback('⛶ Exit Fullscreen', 'top-left');
        } else {
            window.plyrPlayer.fullscreen.enter();
            showPlayerFeedback('⛶ Enter Fullscreen', 'top-left');
        }
    } else if (effTapX < q2) {
        // Q2: play/pause. No vertical sub-split - the whole point of this
        // strip is that it's a large, forgiving target you can hit without
        // aiming, so slicing it into thirds would defeat it.
        if (window.plyrPlayer.paused) {
            window.plyrPlayer.play();
            showPlayerFeedback('▶ Play', 'top-left');
        } else {
            window.plyrPlayer.pause();
            showPlayerFeedback('⏸ Pause', 'top-left');
        }
    } else if (effTapX > q3) {
        // Q4: plus seeks, 3 vertical sections (bottom to top: +3s, +10s, +30s)
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
        // Q3: minus seeks, 3 vertical sections (bottom to top: -3s, -10s, -30s)
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
// A load that ends in an error is over - release the hold, or the
// loading overlay stays pinned behind the error panel.
window.endVideoLoadHold?.();
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
   // A local file has no OneDrive to check, so the wording and the buttons
   // both change: no recycle bin, and "remove from list" is the real fix.
   const isLocalGhost = !!(video && (video.driveId === "local" ||
                          (video.accountKey || "").startsWith("local::")));
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
   errorText.textContent = isLocalGhost
       ? 'File not found on this device'
       : 'Video not found - possibly deleted';
   messageDiv.appendChild(errorText);
   
   const suggestionText = document.createElement('div');
   suggestionText.textContent = isLocalGhost
       ? 'It was moved or deleted outside the app. Refresh the folder, or remove this row.'
       : 'Check OneDrive recycle bin';
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
   
   // Ghost rows: the file is gone but the row survived — an interrupted
   // scan, a delete done in the Files app, a stale catalogue entry. Always
   // localOnly, so this can never queue a server tombstone (the exact bug
   // that put live OneDrive files behind deleted = 1 in the first place).
   const forgetBtn = document.createElement('button');
   forgetBtn.textContent = 'Remove from list';
   forgetBtn.style.cssText = `
       background: rgba(0,0,0,0.25);
       color: white;
       border: 2px solid white;
       padding: 12px 24px;
       border-radius: 6px;
       cursor: pointer;
       font-size: 1rem;
       pointer-events: auto;
   `;
   forgetBtn.addEventListener('click', async (e) => {
       e.stopPropagation();
       e.preventDefault();
       const id = video && video.oneDriveId;
       if (!id) { overlay.style.display = 'none'; return; }
       forgetBtn.disabled = true;
       forgetBtn.textContent = 'Removing...';
       try {
           await deleteVideoFromDB(id, { localOnly: true });
           if (typeof removeVideoFromMemory === 'function') removeVideoFromMemory(id);
           if (typeof window.removeRowFromLists === 'function') window.removeRowFromLists(id);
           if (typeof refreshAllLists === 'function') refreshAllLists();
           if (typeof renderFolderPills === 'function') renderFolderPills();
       } catch (err) {
           console.warn('Remove from list failed:', err);
       }
       overlay.style.display = 'none';
   });

   if (video && video.oneDriveId) buttonContainer.appendChild(forgetBtn);
   if (!isLocalGhost) buttonContainer.appendChild(recycleBinBtn);
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
// Fullscreen reload masking
// ========================
// Setting .source makes the browser drop out of real fullscreen, and we
// re-enter straight after - correct, but the round trip was VISIBLE: the
// exitfullscreen handler tore the whole fullscreen layout down (body
// classes, overflow, re-docking, scroll) and rebuilt it a moment later.
// During a known reload we (a) skip that teardown and (b) drop an opaque
// mask over the top, so the user just sees the old frame, then the new one.
//
// Declared at top level (and hung off window) on purpose: the exitfullscreen
// handler lives inside createPlayerElement(), but these are called from
// playVideoInline, which is out here. Scoping them next to the handler
// makes playVideoInline throw a ReferenceError the moment you swipe up.
window.fullscreenReloadActive = false;
window.fullscreenExitCleanupDeferred = false;
let fullscreenReloadSafetyTimer = null;

// ⚙️ Hard ceiling (ms). If a load stalls or errors, the mask lifts anyway
// rather than leaving a black screen forever.
const FULLSCREEN_RELOAD_MAX_MS = 5000;

// The loading overlay lives inside .plyr at z-index 99998, which only
// competes within .plyr's stacking context. That's fine for the FLS mask
// (also inside .plyr, at 99990, deliberately just underneath). The MPFS mask
// is at body level, so it covers the whole .plyr subtree no matter what the
// overlay's z-index is - the overlay has to come out with it.
let loadingOverlayHome = null;

function promoteLoadingOverlay() {
    const ov = document.getElementById('plyr-loading-overlay');
    if (!ov || loadingOverlayHome) return;          // already promoted
    loadingOverlayHome = ov.parentElement;
    // The stylesheet uses position:absolute, which resolves against .plyr.
    // On body that would resolve against the document, putting top:50%
    // halfway down the page instead of the viewport.
    ov.style.position = 'fixed';
    ov.style.zIndex = '2147483001';                  // one above the mask
    document.body.appendChild(ov);
}

function restoreLoadingOverlay() {
    const ov = document.getElementById('plyr-loading-overlay');
    if (!ov) { loadingOverlayHome = null; return; }
    if (!loadingOverlayHome) return;                 // wasn't promoted

    ov.style.removeProperty('position');
    ov.style.removeProperty('z-index');

    // Plyr rebuilds .plyr on a source change, so the saved parent may be
    // detached by now - appending to it would lose the overlay entirely.
    const home = loadingOverlayHome.isConnected
        ? loadingOverlayHome
        : (document.querySelector('#inlineVideoContainer .plyr') || document.querySelector('.plyr'));
    if (home) home.appendChild(ov);
    loadingOverlayHome = null;
}

function beginFullscreenReload() {
    window.fullscreenReloadActive = true;
    window.fullscreenExitCleanupDeferred = false;

    if (!document.getElementById('fullscreenReloadMask')) {
        const mask = document.createElement('div');
        mask.id = 'fullscreenReloadMask';
        // ⚙️ z-index sits just below the loading overlay (99998) so that
        // still shows through if the load takes a noticeable moment.
        mask.style.cssText = `
            position: fixed;
            inset: 0;
            background: #000;
            z-index: 99990;
            pointer-events: none;
        `;
        // Where this element lives decides whether it can cover anything.
        //
        // With a real Fullscreen API element, nothing outside that subtree
        // renders, so the mask has to go inside it. FLS keeps the old .plyr
        // host as well - there the rotated container IS the whole screen,
        // and that path already looks clean.
        //
        // MPFS is the one that was broken. iOS uses NATIVE video fullscreen,
        // which sets neither document.fullscreenElement nor the webkit one,
        // so the mask fell through to .plyr - trapped inside .plyr's
        // stacking context. Everything that flashes during the transient
        // exit (the list, corner buttons, currentVideoInfo) lives OUTSIDE
        // .plyr, so no z-index could paint over it. Body level fixes that.
        const realFsEl = document.fullscreenElement || document.webkitFullscreenElement;
        let host;
        if (realFsEl) {
            host = realFsEl;
        } else if (manualRotationActive) {
            host = document.querySelector('#inlineVideoContainer .plyr')
                || document.querySelector('.plyr')
                || document.body;
        } else {
            host = document.body;
            mask.style.zIndex = '2147483000';   // root stacking context, above the page
            // The overlay has to travel with it - see promoteLoadingOverlay.
            promoteLoadingOverlay();
        }
        host.appendChild(mask);
    }

    clearTimeout(fullscreenReloadSafetyTimer);
    fullscreenReloadSafetyTimer = setTimeout(endFullscreenReload, FULLSCREEN_RELOAD_MAX_MS);
}

function endFullscreenReload() {
    clearTimeout(fullscreenReloadSafetyTimer);
    fullscreenReloadSafetyTimer = null;
    window.fullscreenReloadActive = false;

    document.getElementById('fullscreenReloadMask')?.remove();
    restoreLoadingOverlay();

    // If fullscreen genuinely didn't come back (load failed, user bailed),
    // run the teardown we skipped - otherwise the page is stuck in a
    // fullscreen layout with no fullscreen.
    if (window.fullscreenExitCleanupDeferred &&
        !window.plyrPlayer?.fullscreen?.active &&
        typeof window.handleExitFullscreenCleanup === 'function') {
        console.log('Fullscreen not restored after reload - running deferred cleanup');
        window.handleExitFullscreenCleanup();
    }
    window.fullscreenExitCleanupDeferred = false;
}

window.beginFullscreenReload = beginFullscreenReload;
window.endFullscreenReload = endFullscreenReload;

// =========================================================
// PLAY PREVIEW DELAY
// Hold on the next video's title for a moment before actually loading it.
// The point is the window it buys: nothing has been touched yet, so the
// CURRENT control bar is still on screen, still carries X / H< / > and is
// still tappable. Tap one again and this request is abandoned in favour of
// the new one - no wasted fetch, no second teardown.
//
// This is deliberately BEFORE the source change rather than a longer hold
// after it: once .source is set, Plyr tears the control bar down and
// rebuilds it, and in FLS the rebuilt bar has to be re-styled before it
// looks right again. Waiting first sidesteps that entirely.
// =========================================================

// ⚙️ Per-mode delay in ms. 0 disables it for that mode.
const PLAY_PREVIEW_DELAY_FLS_MS  = 1000;  // forced landscape
const PLAY_PREVIEW_DELAY_MPFS_MS = 1000;  // mobile portrait fullscreen
const PLAY_PREVIEW_DELAY_MPB_MS  = 0;     // docked in-page - controls persist anyway

function scrayPlayPreviewDelayMs() {
    // Nothing playing yet means there's no bar to keep alive and nothing to
    // decide against - the very first play should never be held up.
    if (!window.plyrPlayer || !window.currentPlayingVideo) return 0;
    if (manualRotationActive) return PLAY_PREVIEW_DELAY_FLS_MS;
    if (window.plyrPlayer.fullscreen?.active) return PLAY_PREVIEW_DELAY_MPFS_MS;
    return PLAY_PREVIEW_DELAY_MPB_MS;
}

// Just the label and the filename. The full path/percentage version lands a
// moment later when playVideoInline's own overlay block runs; this only has
// to answer "what am I about to watch".
function scrayShowPreviewTitle(video) {
    const ov = document.getElementById('plyr-loading-overlay');
    if (!ov) return;
    // Same path treatment the real loading overlay uses, so the text doesn't
    // change shape a moment later when playVideoInline's own block runs.
    const pathParts = (typeof window.scrayResolvePathParts === 'function')
        ? window.scrayResolvePathParts(video)
        : { catalogue: (video.path || '').split('/').filter(Boolean), device: [] };
    const pathText = [
        ...pathParts.catalogue,
        ...(pathParts.device.length ? [`(${pathParts.device.join('/')}/)`] : [])
    ].join(' / ');
    const pathLine = (pathParts.catalogue.length || pathParts.device.length)
        ? `<div style="font-size: 0.65rem; opacity: 0.8; margin-bottom: 4px;">Loading from: ${pathText}</div>`
        : '';
    // The OUTGOING video is still playing and still firing 'progress', and
    // that handler rebuilds this overlay from these globals - point them at
    // the new video now or the preview flickers back to the old filename.
    // lastPlayLabel is read, not consumed; playVideoInline still clears it.
    window.currentLoadingFilename = video.filename || '';
    window.currentLoadingPath = pathText;
    window.currentLoadingLabel = window.lastPlayLabel || null;
    const label = window.lastPlayLabel
        ? `<div style="font-size: 0.65rem; opacity: 0.9; margin-bottom: 4px; color: #ff9800; font-weight: bold;">${window.lastPlayLabel}</div>`
        : '';
    ov.innerHTML = `
        ${label}
        ${pathLine}
        <div style="font-size: 0.9rem; font-weight: bold;">${video.filename || ''}</div>
    `;
    ov.style.display = 'block';
    ov.style.background = 'rgba(0,0,0,0.7)';
    ov.style.padding = '8px 16px';
    ov.style.maxWidth = '90%';
    ov.style.cursor = 'default';
    ov.style.lineHeight = '1.3';
    ov.style.whiteSpace = 'normal';
    ov.style.wordBreak = 'break-word';
    ov.onclick = null;
}

// ========================
// Play video inline
// ========================
/**
* Apply window.scrayPendingStartAt to the player, then confirm it actually
* took.
*
* Two things make this harder than one currentTime write:
*   1. Plyr fires loadedmetadata on the rebuilt media element BEFORE the new
*      source has loaded, so the first event reports duration 0 / readyState 0.
*   2. A streamed source will accept a seek before it is seekable and then
*      quietly snap back to 0.
*
* So: wait for a real duration AND readyState >= 1, then write, then confirm,
* re-writing until it sticks. The pending value survives the wait, which is
* what lets the second (real) loadedmetadata or canplay finish the job.
*/
window.scrayApplyPendingStartAt = function (reason) {
    const target = window.scrayPendingStartAt;
    const player = window.plyrPlayer;
    if (target == null || !player) return;
    if (window.scrayStartAtRunning) return; // one chain is enough
    window.scrayStartAtRunning = true;

    // ⚙️ How long to keep waiting for a seekable source, and how many times to
    // re-write the seek once we have one. The write cap is what stops this
    // fighting you if you scrub away while it is still trying.
    const DEADLINE_MS = 20000;
    const MAX_WRITES = 10;
    const GAP_MS = 120;
    const TOLERANCE_S = 1.5;

    const startedAt = Date.now();
    let writes = 0;
    let logged = false;

    const finish = (msg, level) => {
        window.scrayPendingStartAt = null;
        window.scrayStartAtRunning = false;
        (level === 'warn' ? console.warn : console.log)('[player] start point: ' + msg);
    };
    const superseded = () => {
        if (window.scrayPendingStartAt === target) return false;
        window.scrayStartAtRunning = false;
        return true;
    };

    const attempt = () => {
        if (superseded()) return;
        if (Date.now() - startedAt > DEADLINE_MS) {
            return finish('gave up waiting for a seekable source', 'warn');
        }

        const duration = player.duration;
        const ready = player.media ? player.media.readyState : 0;
        if (!duration || !isFinite(duration) || ready < 1) {
            return setTimeout(attempt, GAP_MS);
        }

        if (!logged) {
            logged = true;
            console.log(`[player] start point: source ready after ${Date.now() - startedAt}ms `
                + `(duration ${duration.toFixed(1)}s, readyState ${ready}, armed by ${reason})`);
        }

        const safe = Math.min(target, Math.max(0, duration - 0.5));
        player.currentTime = safe;
        writes++;

        setTimeout(() => {
            if (superseded()) return;
            const at = player.currentTime;
            if (Math.abs(at - safe) <= TOLERANCE_S) {
                return finish(`held at ${at.toFixed(2)}s after ${writes} write(s)`);
            }
            if (writes >= MAX_WRITES) {
                return finish(`did not hold - wanted ${safe.toFixed(2)}s, sitting at ${at.toFixed(2)}s`, 'warn');
            }
            setTimeout(attempt, GAP_MS);
        }, GAP_MS);
    };

    attempt();
};

async function playVideoInline(video, listContext = null, index = null, startAt = null) {
// ⚙️ Where to start this video, in seconds. Stashed here and applied once on
// 'loadedmetadata' below, then cleared - so it survives the load without
// leaking into whatever plays next. Replaces the old
// play().then(setTimeout(..., 800)) guess in the bookmark modal.
window.scrayPendingStartAt = (typeof startAt === 'number' && startAt > 0) ? startAt : null;
// ⚙️ PLAY PREVIEW DELAY - see scrayPlayPreviewDelayMs above.
// The token is what makes tapping X / > again during the wait work: every
// request takes the next number, and any request that wakes up to find a
// higher number has been superseded and quietly drops out.
const previewDelayMs = scrayPlayPreviewDelayMs();
window.scrayPlayRequestToken = (window.scrayPlayRequestToken || 0) + 1;
const playRequestToken = window.scrayPlayRequestToken;

if (previewDelayMs > 0) {
    scrayShowPreviewTitle(video);
    window.beginVideoLoadHold?.();
    await new Promise(resolve => setTimeout(resolve, previewDelayMs));
    if (playRequestToken !== window.scrayPlayRequestToken) {
        console.log('[player] preview superseded, abandoning:', video.filename);
        return;
    }
}
console.log("playVideoInline CALLED with video =", video);
currentListContext = listContext;
currentVideoIndex = index;
window.currentPlayingVideo = video; // Store for highlight updates

// TEMP DIAGNOSTIC - remove once bookmark marker issue is resolved
console.log('[BM DEBUG] in-memory bookmarks for', video.filename, ':', JSON.stringify(video.bookmarks));
getAllVideos().then(vs => {
  const dbVideo = vs.find(v => v.oneDriveId === video.oneDriveId);
  console.log('[BM DEBUG] in-DB bookmarks for', video.filename, ':', JSON.stringify(dbVideo?.bookmarks));
});

// Remember whether forced (manual-rotate) landscape mode was active
// before this video starts loading, so we can restore it below - some
// mobile browsers exit real fullscreen when the video source changes,
// and per-video DOM (like the progress bar) gets recreated on load.
const wasForcedLandscapeBeforeLoad = manualRotationActive;

// ✅ Same idea for plain (non-rotated) fullscreen - i.e. mobile portrait
// MPFS. The browser can drop out of real fullscreen when the
// source changes; previously only FLS was restored, so a swipe-up random
// in MPFS left the player half-out of fullscreen in an odd in-between state.
const wasPlainFullscreenBeforeLoad =
    !!window.plyrPlayer?.fullscreen?.active && !manualRotationActive;

// ✅ Mask the exit/re-enter round trip so it isn't visible as a series of
// steps - the screen holds still until the new video is up.
if (wasForcedLandscapeBeforeLoad || wasPlainFullscreenBeforeLoad) {
    window.beginFullscreenReload?.();
}

// ✅ Un-hide the player - do this first, before the scroll-into-view and
// loading overlay below, since both measure an element that's currently
// display:none and would otherwise get zeroes.
setPlayerIdle(false);

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
    // A smooth scroll is a ~400ms animation that carries on after the
    // reload mask lifts, so in MPFS you watch the page slide into place
    // behind the returning fullscreen. During a reload we're going back
    // into fullscreen anyway - jump there instantly instead.
    container.scrollIntoView({
        behavior: window.fullscreenReloadActive ? "auto" : "smooth",
        block: "center"
    });
}
}

// Pin the overlay and the control bar open until the new video is
// actually playing - see the TRANSITION HOLD block in createPlayerElement.
window.beginVideoLoadHold?.();

// Show loading overlay immediately
const loadingOverlay = document.getElementById('plyr-loading-overlay');
if (loadingOverlay) {
window.currentLoadingFilename = video.filename || '';
// `path` is the iOS folder; the OneDrive address the catalogue holds lives on
// `cataloguePath`. Catalogue first, iOS folder as a bracketed aside - and it
// goes on window so the 'progress' handler's overlay rebuild reuses it.
const pathParts = (typeof window.scrayResolvePathParts === 'function')
  ? window.scrayResolvePathParts(video)
  : { catalogue: (video.path || '').split('/').filter(Boolean), device: [] };
window.currentLoadingPath = [
  ...pathParts.catalogue,
  ...(pathParts.device.length ? [`(${pathParts.device.join('/')}/)`] : [])
].join(' / ');

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

if (pathParts.catalogue.length || pathParts.device.length) {
    loadingOverlay.innerHTML = `
        ${playSourceLabel}
        <div style="font-size: 0.65rem; opacity: 0.8; margin-bottom: 4px;">Loading from: ${window.currentLoadingPath}</div>
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
// Guard on the function actually being CALLED. This used to check
// updateVideoInExcel, which lives in excel-sheets.js and isn't loaded in
// Native - so the guard was permanently false and no play was ever recorded.
const autoTrackActive = typeof window.isAutoTrackEnabled === 'function' ? window.isAutoTrackEnabled() : true;
if (autoTrackActive && typeof window.queueExcelUpdate === 'function') {
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

// Parse path into folders. Same resolution as the loading overlay above: the
// OneDrive path leads, the iOS folder trails in grey brackets.
const pathParts = (typeof window.scrayResolvePathParts === 'function')
  ? window.scrayResolvePathParts(video)
  : { catalogue: (video.path || '').split('/').filter(Boolean), device: [] };
if (pathParts.catalogue.length || pathParts.device.length) {
const scrayPathSep = window.scrayPathSep || ((text) => {
  const s = document.createElement('span');
  s.textContent = text; s.style.color = '#666'; return s;
});
const folders = [
  ...pathParts.catalogue.map(name => ({ name, local: false })),
  ...pathParts.device.map(name => ({ name, local: true }))
];

folders.forEach((entry, index) => {
  const folder = entry.name;
  // Create clickable span for each folder
  const folderSpan = document.createElement('span');
  folderSpan.textContent = folder;
  folderSpan.style.cursor = 'pointer';
  folderSpan.style.color = '#007bff';
  folderSpan.style.textDecoration = 'underline';
  folderSpan.title = `Click to filter by "${folder}"`;

  // Grey italic for the iOS folder - context, not identity. Still clickable,
  // because those folder names are tags in their own right.
  if (entry.local) {
    folderSpan.style.color = '#999';
    folderSpan.style.fontStyle = 'italic';
    folderSpan.title = `On this device - click to filter by "${folder}"`;
  }
  
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
 // Shared exclude_tags table — see scray-exclude.js.
 if (typeof window.handleDefaultExcludeAction === 'function') {
   await window.handleDefaultExcludeAction(tagName, displayName);
 }
}
});
  
  // Opening bracket for the case where the iOS folder is the whole path.
  if (entry.local && index === 0) videoInfoEl.appendChild(scrayPathSep('('));

  videoInfoEl.appendChild(folderSpan);
  
  // Add separator
  // Bare slashes inside the bracket, and it closes on a trailing one:
  // 3MAC / USA / ecg / (folder/) name.mp4
  const nextIsLocal = !!folders[index + 1] && folders[index + 1].local === true;
  if (entry.local && !nextIsLocal) {
    videoInfoEl.appendChild(scrayPathSep('/) '));
  } else if (entry.local) {
    videoInfoEl.appendChild(scrayPathSep('/'));
  } else if (nextIsLocal) {
    videoInfoEl.appendChild(scrayPathSep(' / ('));
  } else if (index < folders.length - 1) {
    const separator = document.createElement('span');
    separator.textContent = ' / ';
    separator.style.color = '#666';
    videoInfoEl.appendChild(separator);
  }
});

// Add separator before filename - not when the bracket just closed with one,
// and not when there is no path in front of the name at all.
if (folders.length && !folders[folders.length - 1].local) {
const separator = document.createElement('span');
separator.textContent = ' / ';
separator.style.color = '#666';
videoInfoEl.appendChild(separator);
}

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

// ✅ ADD SCORE DISPLAY (from videoMeta - populated by Excel/CSV import)
const scoreSpan = document.createElement('span');
if (video.user_score !== undefined && video.user_score !== null) {
scoreSpan.textContent = ` [${video.user_score}]`;
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
   color: window.scrayHasBookmarks(video) ? "#6f42c1" : "#ece6f6",
   textColor: window.scrayHasBookmarks(video) ? "white" : "#6f42c1",
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

// Keep the title bar in sync when switching videos via next/random while
// still in fullscreen. Unconditional now rather than FLS-only: the element
// is display:none outside fullscreen anyway, and MPFS needs the same update.
if (typeof window.syncVideoTitleBar === 'function') {
    window.syncVideoTitleBar(video);
}

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

// AVFoundation is the only decoder available to a <video> element on iOS -
// Safari, WKWebView and native alike. It handles MP4/M4V/MOV (H.264, HEVC,
// AAC) and nothing else. MKV is refused at the CONTAINER level even when the
// video inside is plain H.264, and WMV's VC-1 isn't decodable at all.
//
// Declaring everything as video/mp4 meant an MKV got as far as the decoder
// and then died silently - a black screen with no error. An accurate type
// lets the element reject it up front so we can say something useful.
const SCRAY_MIME_BY_EXT = {
    mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime',
    mkv: 'video/x-matroska', webm: 'video/webm', avi: 'video/x-msvideo',
    wmv: 'video/x-ms-wmv', flv: 'video/x-flv', ts: 'video/mp2t',
    '3gp': 'video/3gpp', mpg: 'video/mpeg', mpeg: 'video/mpeg',
};

function scrayMimeForFile(filename) {
    const ext = String(filename || '').split('.').pop().toLowerCase();
    return SCRAY_MIME_BY_EXT[ext] || 'video/mp4';
}

// WebM is the genuinely uncertain one - Safari's support has been arriving
// piecemeal, so it's left out of the hard-fail list and allowed to try.
const SCRAY_UNPLAYABLE_EXT = new Set(['mkv', 'wmv', 'avi', 'flv', 'mpg', 'mpeg']);

function scrayUnplayableReason(filename) {
    const ext = String(filename || '').split('.').pop().toLowerCase();
    if (!SCRAY_UNPLAYABLE_EXT.has(ext)) return null;
    return ext === 'mkv'
        ? '.mkv can\'t play on iOS — the video inside is usually fine, it just needs remuxing to .mp4'
        : `.${ext} can't play on iOS — needs converting to .mp4`;
}

const unplayable = scrayUnplayableReason(video.filename);
if (unplayable) {
    console.warn(`[player] ${unplayable}`);
    window.endFullscreenReload?.();
    if (typeof showVideoError === 'function') showVideoError(unplayable, video);
    return;
}

try {
window.plyrPlayer.source = {
    type: 'video',
    sources: [ { src: video.downloadUrl, type: scrayMimeForFile(video.filename) } ],
    title: video.filename || ""
};

// AVFoundation doesn't always self-report duration for locally-streamed
// files via our custom scheme, so fetch it directly from the real file
// as a fallback for the UI to use.
if (video.driveId === "local" && typeof ScrayBridge !== 'undefined') {
    try {
        const url = new URL(video.downloadUrl);
        const relativePath = decodeURIComponent(url.pathname.replace(/^\//, ''));
        ScrayBridge.getVideoDuration(relativePath).then(result => {
            const seconds = result?.duration;
            if (seconds > 0) {
                video.durationMs = seconds * 1000;
                console.log(`Native duration for ${video.filename}: ${seconds}s`);
            }
        }).catch(err => console.error("getVideoDuration failed:", err.message));
    } catch (err) {
        console.error("Could not parse downloadUrl for duration lookup:", err.message);
    }
}

// Rebuild the control bar NOW, in the same turn Plyr tore it down and
// re-injected it. Doing it here rather than waiting for 'loadstart' (a tick
// later) or 'loadedmetadata' (much later) means the browser never paints an
// intermediate version - no bare bar, no progress widget appearing and then
// being stripped, no buttons popping in one reflow at a time.
window.scrayRebuildPlayerControls?.();

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

// Set by any branch below that takes responsibility for lifting the reload
// mask itself, so the fallback timer at the end doesn't lift it early.
let maskLiftChained = false;

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
} else if (wasPlainFullscreenBeforeLoad && !window.plyrPlayer.fullscreen?.active) {
    // ✅ MPFS was dropped by the browser on the source
    // change - go straight back in, no rotation involved. Small delay so
    // Plyr has finished swapping in the rebuilt <video> element first.
    setTimeout(() => {
        if (!window.plyrPlayer.fullscreen?.active) {
            window.plyrPlayer.fullscreen.enter();
        }
    }, 100);
}

// ✅ New video is playing and fullscreen has been restored - drop the mask.
// ⚙️ Bump this delay if a sliver of the transition still shows through.
if (window.fullscreenReloadActive) {
    setTimeout(() => window.endFullscreenReload?.(), 350);
}   
} catch (playErr) {
 console.error("Playback failed:", playErr);
 // ✅ Never leave the reload mask up after a failed load.
 if (window.fullscreenReloadActive) window.endFullscreenReload?.();
 
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
// Idle player visibility
// ========================
// The player only earns screen space when it actually has a video. This
// toggles body.player-idle (see the CSS rule) and, on the way in, tears
// down any docking state so nothing is left half-positioned behind the
// hidden element.
function setPlayerIdle(isIdle) {
    document.body.classList.toggle('player-idle', !!isIdle);

    if (isIdle) {
        const container = document.getElementById('inlineVideoContainer');
        if (container) {
            container.classList.remove('bottom-docked');
            container.style.bottom = '';
        }
        const videoInfo = document.getElementById('currentVideoInfo');
        if (videoInfo) {
            videoInfo.classList.remove('info-bottom-docked');
            videoInfo.style.bottom = '';
        }
        document.body.style.paddingBottom = '';
        document.getElementById('bottomDockBackdrop')?.classList.remove('active');
    }

    if (typeof computeBottomDock === 'function') computeBottomDock();
    if (typeof updatePlayerStateClass === 'function') updatePlayerStateClass();
    console.log(isIdle ? 'Player hidden (idle)' : 'Player shown (video loading)');
}
window.setPlayerIdle = setPlayerIdle;

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
    
    // ✅ Plyr rebuilds its internal <video> element from scratch every
    // time .source is set (see playVideoInline), and the rebuilt element
    // doesn't keep the id="inlineVideoPlayer" - so window.plyrPlayer.media
    // (Plyr's own live reference) is used instead of an id lookup, since
    // that stays correct across rebuilds.
    const videoEl = window.plyrPlayer.media || document.querySelector('#inlineVideoContainer video');
    if (videoEl) {
        while (videoEl.firstChild) {
            videoEl.removeChild(videoEl.firstChild);
        }
        videoEl.removeAttribute('src');
        videoEl.load();
    }
    
  // ✅ Fully clear currentPlayingVideo - Stop now returns the player all
  // the way back to its pre-play state, not just paused-at-start.
  window.currentPlayingVideo = null;
  
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
    
    // ✅ Exit fullscreen unconditionally, including forced (manual-rotate)
    // landscape mode - Stop now returns the player to exactly the state
    // it was in before any video was played, and nothing is fullscreen or
    // rotated at that point. The existing 'exitfullscreen' handler already
    // calls resetManualRotation() for us, so FLS cleans itself up here too.
    if (window.plyrPlayer.fullscreen?.active) {
        window.plyrPlayer.fullscreen.exit();
    }
    
 // Hide loading overlay
  // Bump the token so a preview window that's still counting down is
  // abandoned rather than starting a video you've just stopped.
  window.scrayPlayRequestToken = (window.scrayPlayRequestToken || 0) + 1;
  window.endVideoLoadHold?.();
  const loadingOverlay = document.getElementById('plyr-loading-overlay');
  if (loadingOverlay) loadingOverlay.style.display = 'none';
  
  // ✅ Clear the video info bar too - at page load, before anything has
  // played, this is empty. Stop now matches that state instead of
  // leaving the last-played video's info visible.
  const videoInfoEl = document.getElementById('currentVideoInfo');
  if (videoInfoEl) videoInfoEl.innerHTML = '';

  // ✅ Reset the permanent progress bar back to its pre-play state too -
  // otherwise it keeps showing the elapsed/remaining time from whatever
  // was last playing instead of 0:00 / 0:00.
  const progressFilled = document.querySelector('.permanent-progress-filled');
  const progressTimestamp = document.querySelector('.permanent-progress-timestamp');
  if (progressFilled) progressFilled.style.width = '0%';
  if (progressTimestamp) progressTimestamp.textContent = '0:00 / 0:00';

  // ✅ Strip bookmark markers off the bar. currentPlayingVideo is already
  // null above, so renderBookmarkMarkers() clears and then draws nothing;
  // the direct removal first covers the case where it isn't defined yet.
  document.querySelectorAll('.progress-bookmark-marker').forEach(m => m.remove());
  if (typeof window.renderBookmarkMarkers === 'function') {
      window.renderBookmarkMarkers();
  }

  // ✅ Drop the per-video orientation sizing so the empty player goes back
  // to its default landscape shape. At page load (pre-play) the container
  // carries neither class, so removing both - rather than forcing
  // .video-landscape - is what genuinely matches the pre-play state.
  window.currentVideoOrientation = 'L';
  document.body.classList.remove('video-loading-landscape');
  if (container) {
      container.classList.remove('video-portrait', 'video-landscape');
  }

  // ✅ Nothing is loaded any more - hide the player outright rather than
  // leaving an empty frame sitting there. Both the player Stop button and
  // the corner C button route through here, so both hide it.
  setPlayerIdle(true);

  console.log('Player fully reset to pre-play state');
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

// ✅ Nothing has played yet - start hidden. playVideoInline un-hides.
setPlayerIdle(true);

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
    // TESTING: disabled. The per-frame re-anchor below fights any scroll the
    // user makes during the first 3s after load. Remove this line to restore.
    return;

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
// ✅ PERFORMANCE: without debouncing, this callback re-ran synchronously
// on every single DOM mutation anywhere in the page (e.g. once per row
// while a large playlist re-renders). Coalesce bursts of mutations into
// a single check per animation frame instead.
let mutationCheckScheduled = false;
const observer = new MutationObserver((mutations) => {
    if (mutationCheckScheduled) return;
    mutationCheckScheduled = true;
    requestAnimationFrame(() => {
        mutationCheckScheduled = false;
        const videoInfo = document.getElementById('currentVideoInfo');
        if (!videoInfo && window.currentPlayingVideo) {
            console.warn('Video info removed by mutation - restoring');
            ensureVideoInfoExists();
        }
    });
});

// Observe the body for child removals
observer.observe(document.body, {
    childList: true,
    subtree: true
});
});

})();
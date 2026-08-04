# Changelog

## [5.2.6]
fixed prev next button

## [5.2.5]
fixed modal buttons in FLS and MP
smaller text in modal

## [5.2.4]
triple tap anywhere to unlock
fixed bookmarks and syncing
removed filter bar, improved F button
added History to FLS B modal
tap anywhere left side to step frame in FLS, fix conflict with drag scrub

## [5.2.3]
change the thirds in mobile portrait gestures
FLS player double tap now play/pause, swipe down to exit full screen
triple tap to unlock
excel pill moved to the right
narrower progress bar
step buttons up to 128x

## [5.2.2]
fixed mangled emojis
scroll issue fixed on launch
frame stepping buttons added
loading video labels to indicate button pressed 

## [5.2.1]
fixed the BM modals, added space and clear buttons
spacer to make excel visible when loading, excel pill, pre-load
less played random button
re-ordered corner buttons
most common notes as buttons

## [5.1.6]
fix re-sizing forced ls video
move BM modal
enhanced basket modal in FLS
fixed add folder being covered by sticky elements

## [5.1.5]
basket height fixed
fixed drag and drop basket in mobile
double tap in mobile portrait enters force landscape
player controls improved
added X and H< buttons to player controls
activate timestamp add immediately

## [5.1.4]
forced landscape mode in portrait (watch videos in landscape but keep portrait lock for easier browsing)
landscape position memorised
  
## [5.1.3]
markers on progress bar for bookmarks

## [5.1.2]
change time zone of clock

## [5.1.1]
sticky mobile portrait video at the bottom


## [5.1.0]
bookmarks and notes

## [5.0.6]
sticky player in mobile portrait so you can keep scrolling list
sticky filters and sort buttons

## [5.0.5]
faster scoring
faster basket push

## [5.0.4]
fix score syncing across devices
remove * from refresh folders
can move into existing folder now if name already exists
refresh list immediately after reload files
fixed select refresh issue (showing wrong path)
extend history to 500 items
fixed loading overlay

## [5.0.3]
improved prev and next buttons, re-arrange corner buttons
added -30 and +30 in portrait mode
added 30 and 1 min double seek in landscape mode
right click on now playing text
increase video spreadsheet limit to 100,000 rows


## [5.0.2]
move double tap to seek to bottom right corner
fixes for opera
smaller now playing text, more visible
fix locked scrolling in portrait
pop up confirm for basket sync
corner buttons moved to right in landscape

## [5.0.1]
squished video full screen fix
moved the buttons to the top of basket landscape mobile

## [5.0]
move file between accounts also refreshes folders 
fixed scores in basket
moved basket buttons to the bottom on mobile
push sync current basket also saves a copy in baskets

## [4.9.9]
selective folder refresh now working
selective folder refresh now down four levels
refresh folder button now directly in context menus
stop rename clearing exclude tags
esc key to close modals
fix filter auto scrolling
always show basket


## [4.9.8]
current basket function with push and pull sync
fixed basket issues
squeeze portrait video
fixed abbreviated account pill

## [4.9.7]
disable scrolling inside player area in landscape mobile
score confirm shows filename
filter terms now a floating pill
fixed random panels from opening when search term cleared or added

## [4.9.6]
move files between accounts
more compact main buttons on mobile
fix tag to exclude list and immediaate  refresh
full screen exit fix on desktop
re-added H< button
buffer added in mobile portrait so player is closer to bottom

## [4.9.5]
improved score filter
clear all in score filter dismisses immediately
basket ALL and REM buttons smaller text
score in now playing text


## [4.9.4]
floating pill exclude modal
excel connects quicker default to ngumac
fixed score in path name
added delete button to basket modal
stop random panel from showing when refresh

## [4.9.3]
added native fullscreen on mobile
show score, raise timestamp, re-authenticate only in refresh, sort score
added link to excel db
faster scoring modal
selecting tags can add to default exclude 

## [4.9.2]
fixed now playing disappeared
re-arrange item buttons

## [4.9.1]
shortened panels in landscape
B button in landscape now dismisses random panel
enter dismisses keyboard after search
landscape baket highlighting fixed
switched Excel doc to ngumac

## [4.9]
switched to Excel
fixed Excel integration bugs

## [4.8.4]
thicker seek bar


## [4.8.3]
Fixed loading overlay text
added -3 +3 and removed swipe down to exit full screen
more fields added to google sheets export
added < > keyboard shortcuts

## [4.8.2]
Streamline refresh button, re-order re-authenticate and load
Remove tap to add to basket in now playing
Re-add warning for videos missing and which accounts from database in basket
Fixed button sizes in load basket

## [4.8.1]
Remove duration calculation
Update Gsheets button to also allow re-auth
Streamline refresh button, fewer clicks

## [4.8]
fixed score filter
added next and prev buttons for main list items (including when they're filtered)
added tag to rename module
swapped add to basket and rename tapping function
added main list panel for landscape mode so no need to scroll

## [4.7]
Move function added
Export CSV to Google Sheets
Add create folder in move modal

## [4.6]
Scoring filter added
Video quality stats added to stats
Tag dropdown fixes
No tracking video data not affecting quality properties
Bitrate added to the db
Sort by filename
Duplicates checkbox

## [4.5]
added rename modal navigation buttons and optimised
rename modal changes:
- special characters can be selected
- gap between lowercase and uppercase letter (like HelloWorld) is a spot point for cursor
F' has a tooltip
Add refresh option to now playing
Default exclude tags in Google Sheets

## [4.4]
Tapping tag now prompts tag or search
Tap to search optimised (keyboard stays hidden, panels dismissed)
fix clear C, scale down corner buttons, X dismiss panels
Move rename to R outside right click menus

## [4.3]
landscape player tweaks, preserve white strip buffer
in rename modal, added tags and delete button for better renaming
renaming updates now playing in real time
X random button respects filter
panel and history dismisses when play initiated
left right (horizontal) scrubbing only, stops vertical accidental scrubs
items more clickable to basket
auto-scroll upon play, pills above history, basket items added to top

## [4.2]
PIP player added
versioning dropping third decimal
Rename modal can add brackets with a tap, and now refreshes upon rename so tags appear immediately
improvements to account pill removal action

## [4.1.1]
Update saved basket name to include timestamp

## [4.1.0]
bracket tags now added which pull from filename
- any filename with [...] will be brought through as a tag at level_5
context menus improved with right click
refresh button directly in context menu
change remaining tags to ALL tags
update g sheets confirmation to pill alert only (no pop up)
fix landscape play issue
optimise landscape layout
scoring modal now just buttons 1-10, F button requires confirmation

## [4.0.3]
Hide video player mode to replace the old browser mode
persisting mini player stopped
extend g sheet token to 90 days
update the context menus
file size added to google sheets to help differentiate

## [4.0.2]
change order of corner buttons
change style of onedrive and refresh buttons
unhide a few buttons in landscape mobile mode

## [4.0.1]
Context list (right-click list) added to allow for more buttons
Removed browser view
Tally button added
Google Sheets API longer token
Now playing text with context menu, copy items fixed
Added basket item number

## [4.0.0]
Google Sheets API added. Now we can:
- save/load baskets
- create attributes to specific videos

## [3.10.1]
Improvements to time stamp and position of progress bar for mobile friendly
Refresh accounts selectively

## [3.10.0]
Rename and delete function added
Autoplay after re-authentication
Paths to clickable tag selectors
bulk delete/rename function added
new login notifications
new folder refresh button
clock added
video keyboard shortcuts - space to play/pause, up/down volume
loops by default
remember mute state for the session

## [3.9.4]
Reduce size of the account pills
Improved progress bar
Disable mini player for index.html
Fixed double tap in portrait mobile to seek
Added download link to now playing text

## [3.9.3]
re-arrange corner buttons, T and F at the end
tag selector added to the basket and history panels
now playing text loads instantly
X random and T random buttons can't repeat
portrait dimensions fixed
double-tap middle of full screen landscape to exit full screen
now playing text flush with player in landscape mode
squeeze now playing text when basket open on mobile
X keyboard shortcut

## [3.9.2]
Random X button - plays random video (based on filters)
X button fixes - can play without filter selected and autoscroll
Removed player state and progress flex from console
Remove more console updates
    Keyboard shortcuts already initialized
    Anywhere scrubbing disabled on desktop
    Stop button attached with forced flex styles
    Anywhere scrubbing disabled on desktop


## [3.9.1]
Landscape minimal player now with random items generated in panel
Pills and corner buttons moved behind the inline video player in landscape mobile

## [3.9.0]
Introduce minimal landscape mode
Optimised minimal landscape mode (stripped out paths, extra buttons, better top video)

## [3.8.2]
Added sort buttons for created date and modified date
Added filters for orientation and mime type
History items more compact
Fixed left and right wobble

## [3.8.1]
Add clear button to JSON paste area
Fixed history panel item buttons to be more clickable
Added authentication re-sign in link to download errors as well on mobile
Added date created, date modified, width, length, orientation, mime type to db attributes
Fixed duration sort of - manually calculating it based on bitrate, it's closer but still not that accurate, but better than before

## [3.8.0]
Added import/export function by JSON files
Improved import/export function with the ability to use clipboard instead of file

## [3.7.9]
Fixed history panel wobble on mobile
Add errors to video overlay when video can't load because of authentication
Add sign in button to video for authentication failure

## [3.7.8]
Fixed clipboard issue not rendering the main and random lists
Re-factored css files to separate browser from index, more efficient
Re-factored basket files to separate common elements

## [3.7.7]
(SP-156) Restored scrubbing for portrait mode, fixed double tap mini player landscape full screen mode
Made L buttons blue for less clash
(SP-169) remove buttons replaced with copy name to clipboard, same for now playing
(SP-170) item added to history now upon click on play button, not a requiring a full successful play


## [3.7.6]
(SP-168) Double tap mini player  in landscape mobile enters full screen
(SP-162) Drag and drop in the basket introduced
(SP-127) Sorting by file size added

## [3.7.5]
(SP-166) Corner buttons now scroll horizontally
Fixed history panel highlighting issue

## [3.7.4]
(SP-99) History added, no consecutive duplicate items, selection to basket still glitchy
Added version to lock screen for ease of identifying refresh
History panel improvements, highlighting and selection conflict fixed

## [3.7.3]
(SP-158) Now playing text added

## [3.7.2] - BETA dead end
(SP-151) Unresolved: portrait mini player issue, full screen issue - USABLE BETA BRANCH sp-beta-3-7-2

## [3.7.1]
(SP-155) Move controls right

## [3.7.0]
(SP-147) Revamped desktop again to have video lists sit next to the video player
(SP-150) Re-added the old "browser" view as a link
(SP-144) Keyboard shortcuts enhanced for plyr
Shortcut F change to / to avoid full screen conflict
 
## [3.6.3]
Fix desktop progress bar seeker
(SP-138) Basket stays open when play initiated
(SP-136) Mute upon play
(SP-139) Disable scrubbing on mobile when not in full screen
(SP-137) Added stop function back to clear, and moved clear to be C in corner buttons

## [3.6.2]
(SP-143) Desktop layout overhaul, column view
Basket buttons shortened
(SP-135) L1 dropdowns not activating on selection

## [3.6.1]
(SP-124) Plyr control optimisations (large buttons, shifted for left hand ergonomic)
(SP-141) Basket path restored
(SP-125) Select folder alignment issue on mobile fixed
(SP-109) Re-arrange filters to be tidier
(SP-142) Advanced search added
    phrases: [],      // "exact phrases"
    required: [],     // +required
    excluded: [],     // -excluded
    optional: []      // plain terms (AND logic by default)

## [3.6.0]
(SP-131) Mini player/inline player transition major fixes (thanks Claude)

## [3.5.4]
(SP-123) landscape mini player, acceptable solution, scroll doesn't immmediately deactivate inline player
(SP-129) basket styling on mobile improvements

## [3.5.3]
non-mp4 greyed out
checkbox to show only mp4
acceptable landscape full screen solution (double tap to restore inline, full screen from in line) - still need to fix
(SP-125) acceptable folder selection when loading on mobile, text is back but still crooked, need to revisit again

## [3.5.2]
fixed landscape mobile full screen issues
tap mini player in landscape to return to full screen, minimal controls
landscape full screen fixes (except a few minor glitches, landscape full screen -> portrait needs manual dismissing, and browser tabs must be hiddden first before entering full screen)
video stats added
changelog added to UI (easier to see which version)

## [3.5.1]
fixed download link, no need for pop-up
corner buttons left

## [3.5.0]
upgraded to plyr player


## [3.4.5]
added total file size basket and random lists
fixed highlight issues with basket selection
dropdown heights extended
size filter introduced
corner button anchors above mobile keyboard
random R^ button to jump to random without refresh

## [3.4.4]
added filesize to basket items
password back to Michael1 for faster unlocking

## [3.4.3]
play and download refresh on click, no need to manually refresh
password lock page added, password: michael1

## [3.4.2]
### Added
floating pills pulled from under corner buttons
basket items can be selected
copy button removed, redundant
more basket buttons added (select all, clear selection)

## [3.4.1-rc]
### Added
tap main list to remove item from basket
basket scroll issues fixed
play button added to main list
basket buttons improved and fixed
desktop basket fixes (buttons and item width)
mobile basket fix, word-wrap breakd word to stabilise item
L button gaps and dropdown text
evenly spaced out basket buttons
clear basket only clears basket (not everything)

## [3.4.0-rc]
### Added
video player added (in testing), bugs fixed
improved cascading tags, removed large tag pills in favour of floating ones and unified tag set
restored exclude tags

## [3.3.0-rc]
### Added
tag hierarchy now in place
tag hierarchy buttons for better UX
subfolder selection now loads instantly
csv upload with pseudodata added
csv export includes matching files column for those already uploaded
csv export button for only the yet to upload matches

## [3.2.3-rc]
### Added
fixed tag selection jumping to search bar
fixed clear button snapping to search bar 

## [3.2.2-rc]
### Added
pagination style update
filter pins to the top, moved to the middle (instead of clearing random)

## [3.2.1-rc]
### Added
duplicate entries fixed, when refreshed, the refreshed item gets updated in the indexeddb with a *
added a subfolder to the folder select when loading
pagination improvement (load more) - fixed
L keyboard shortcut fix

## [3.2.0-rc]
### Added
added level_x folder fields for better filtering
added select folders to load from
refresh button improvements
restored logging messages for basket refresh
keyboard shortcuts restored
filter partially fixed, csv exporting only filters

## [3.1.0-rc]
### Added
inline console for reporting errors
attempted to fix refresh issue (still need to test with fresh data)
refresh issue appears fixed, basket can now refresh

## [3.0.6-rc]
### Added
full list fixed so filtered by tags
log out function added, UI improvements
token expiration handling added (forces refresh of token)
updated clear button to clear the lists
added corner buttons for list and tags
fix tiny pills to not be covered by corner buttons
fix jerking motion on page when basket dismissed

## [3.0.5-rc]
### Added
floating pills to indicate tags selected
basket refresh button now showing progressing instead of generic "refreshing..."
search button added, middle random button hidden
headings fixed

## [3.0.4-rc]
### Added
SP-50 Cache-busting restored
SP-44 auto-scrolls when needed
mobile improvements, search bug fixes
minutes now dropdown


## [3.0.3-rc]
### Added
Warning before clearing db
Bug fix: basket closes when removing video
Mobile version fix: include/exclude tag field width wider, click bug removed 
Improved UI for desktop and mobile, including better colouring and font sizing

## [3.0.2-rc]
### Added
Version number dynamically added to headings
Disable load button when it's been clicked to prevent double-clicking
Clear filters button added


## [3.0.1-rc]
### Added
Burger menu to allow selection of videos
Refresh videos selected in basket only (in case links go stale)


## [3.0.0-rc]
### Added
Added keyboard shortcuts
- Ctrl+Enter to generatethe files
- / to focus on search filter
- , to focus on include tags
Need to tab out to move the cursor

## [2.2.1] - 2025-12-25
### Added
IndexeDB database now refreshes/truncates the list of each account instead of appending/loading again. Keeps links fresh.
Added export csv button
Persistent “Load videos from X” buttons using localStorage across refreshes.
Restore previously logged‑in accounts on page load.
Auto token refresh with acquireTokenSilent() before loading videos —
falls back to a popup login if the silent refresh fails (token expired or missing).
Clean handling of MSAL cached accounts so restored buttons work without full re‑login where possible.
Generator buttons, tag selector and randomiser playlist added
Exclude tags

## [2.0.0] - 2025-12-25 09:21
### Added
- Initial changelog staging comments to uat


## [1.0.0] - 2025-12-25
### Added
- Initial changelog creation (covering features up to this release)



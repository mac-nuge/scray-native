// ========================================
// PLYR VIDEO PLAYER KEYBOARD SHORTCUTS
// ========================================
// 
// Edit the 'key' property to change shortcuts.
// Set 'key' to null to disable a shortcut.
// Multiple keys can trigger the same action by adding duplicate entries.
//
// Special key names: 'space', 'arrowleft', 'arrowright', 'arrowup', 'arrowdown',
//                    'home', 'end', 'pageup', 'pagedown', 'escape'
// For regular keys, just use the character: 'a', 'j', '1', etc.
// For shift combinations: 'J' (capital) or '<' or '>'
// ========================================

window.playerKeyboardShortcuts = [
// ========================================
// PLAYBACK CONTROL
// ========================================
{
    key: null,
    action: 'playPause',
    description: 'Play/Pause',
    feedback: (paused) => paused ? '⏸ Paused' : '▶ Playing'
},
{
    key: 'space',
    action: 'playPause',
    description: 'Play/Pause (Space)',
    feedback: (paused) => paused ? '⏸ Paused' : '▶ Playing'
},

// ========================================
// SEEK BACKWARDS
// ========================================
{
    key: null,
    action: 'rewind',
    seconds: 1,
    description: 'Rewind 1 second',
    feedback: (time) => `-1s (${formatDuration(time * 1000)})`
},
{
    key: ';',
    action: 'rewind',
    seconds: 3,
    description: 'Rewind 3 seconds',
    feedback: (time) => `-3s (${formatDuration(time * 1000)})`
},
{
    key: 'j',
    action: 'rewind',
    seconds: 5,
    description: 'Rewind 5 seconds',
    feedback: (time) => `-5s (${formatDuration(time * 1000)})`
},
{
    key: 'arrowleft',
    action: 'rewind',
    seconds: 10,
    description: 'Rewind 10 seconds',
    feedback: (time) => `-10s (${formatDuration(time * 1000)})`
},
{
    key: null, // Shift+H
    action: 'rewind',
    seconds: 30,
    description: 'Rewind 30 seconds',
    feedback: (time) => `-30s (${formatDuration(time * 1000)})`
},
{
    key: '[', // Shift+J
    action: 'rewind',
    seconds: 60,
    description: 'Rewind 1 minute',
    feedback: (time) => `-1m (${formatDuration(time * 1000)})`
},

// ========================================
// SEEK FORWARDS
// ========================================
{
    key: null,
    action: 'forward',
    seconds: 1,
    description: 'Forward 1 second',
    feedback: (time) => `+1s (${formatDuration(time * 1000)})`
},
{
    key: "'",
    action: 'forward',
    seconds: 3,
    description: 'Forward 3 seconds',
    feedback: (time) => `+3s (${formatDuration(time * 1000)})`
},
{
    key: "l",
    action: 'forward',
    seconds: 5,
    description: 'Forward 5 seconds',
    feedback: (time) => `+5s (${formatDuration(time * 1000)})`
},
{
    key: 'arrowright',
    action: 'forward',
    seconds: 10,
    description: 'Forward 10 seconds',
    feedback: (time) => `+10s (${formatDuration(time * 1000)})`
},
{
    key: null, // Shift+G
    action: 'forward',
    seconds: 30,
    description: 'Forward 30 seconds',
    feedback: (time) => `+30s (${formatDuration(time * 1000)})`
},
{
    key: ']', // Shift+L
    action: 'forward',
    seconds: 60,
    description: 'Forward 1 minute',
    feedback: (time) => `+1m (${formatDuration(time * 1000)})`
},

// ========================================
// PLAYBACK SPEED
// ========================================
{
    key: null,
    action: 'speedDecrease',
    step: 0.25,
    description: 'Decrease speed',
    feedback: (speed) => `Speed: ${speed.toFixed(2)}x`
},
{
    key: null,
    action: 'speedIncrease',
    step: 0.25,
    description: 'Increase speed',
    feedback: (speed) => `Speed: ${speed.toFixed(2)}x`
},
{
    key: null,
    action: 'speedReset',
    description: 'Reset speed to 1x',
    feedback: () => 'Speed: 1.00x'
},

// ========================================
// VOLUME CONTROL
// ========================================
{
  key: 'arrowup',
  action: 'volumeUp',
  step: 10,
  description: 'Volume up 10%',
  feedback: (volume) => `🔊 ${Math.round(volume * 100)}%`
},
{
  key: 'i',
  action: 'volumeUp',
  step: 10,
  description: 'Volume up 10% (I)',
  feedback: (volume) => `🔊 ${Math.round(volume * 100)}%`
},
{
  key: 'arrowdown',
  action: 'volumeDown',
  step: 10,
  description: 'Volume down 10%',
  feedback: (volume) => `🔉 ${Math.round(volume * 100)}%`
},
{
  key: 'k',
  action: 'volumeDown',
  step: 10,
  description: 'Volume down 10% (K)',
  feedback: (volume) => `🔉 ${Math.round(volume * 100)}%`
},
{
    key: 'm', // Shift+M
    action: 'mute',
    description: 'Toggle mute',
    feedback: (muted) => muted ? '🔇 Muted' : '🔊 Unmuted'
},

// ========================================
// JUMP TO POSITION
// ========================================
{
    key: '0',
    action: 'jumpToPercent',
    percent: 0,
    description: 'Jump to 0%',
    feedback: () => '0%'
},
{
    key: '1',
    action: 'jumpToPercent',
    percent: 10,
    description: 'Jump to 10%',
    feedback: () => '10%'
},
{
    key: '2',
    action: 'jumpToPercent',
    percent: 20,
    description: 'Jump to 20%',
    feedback: () => '20%'
},
{
    key: '3',
    action: 'jumpToPercent',
    percent: 30,
    description: 'Jump to 30%',
    feedback: () => '30%'
},
{
    key: '4',
    action: 'jumpToPercent',
    percent: 40,
    description: 'Jump to 40%',
    feedback: () => '40%'
},
{
    key: '5',
    action: 'jumpToPercent',
    percent: 50,
    description: 'Jump to 50%',
    feedback: () => '50%'
},
{
    key: '6',
    action: 'jumpToPercent',
    percent: 60,
    description: 'Jump to 60%',
    feedback: () => '60%'
},
{
    key: '7',
    action: 'jumpToPercent',
    percent: 70,
    description: 'Jump to 70%',
    feedback: () => '70%'
},
{
    key: '8',
    action: 'jumpToPercent',
    percent: 80,
    description: 'Jump to 80%',
    feedback: () => '80%'
},
{
    key: '9',
    action: 'jumpToPercent',
    percent: 90,
    description: 'Jump to 90%',
    feedback: () => '90%'
},
{
    key: 'home',
    action: 'jumpToStart',
    description: 'Jump to start',
    feedback: () => '⏮ Start'
},
{
    key: 'end',
    action: 'jumpToEnd',
    description: 'Jump to end',
    feedback: () => '⏭ End'
},

// ========================================
// FULLSCREEN & STOP
// ========================================
{
    key: 'F', // Shift+F
    action: 'fullscreen',
    description: 'Toggle fullscreen',
    feedback: (isFullscreen) => isFullscreen ? '⛶ Fullscreen' : '⛶ Exit Fullscreen'
},
{
    key: null,
    action: 'exitFullscreen',
    description: 'Exit fullscreen',
    feedback: () => '⛶ Exit Fullscreen'
},
{
    key: '<', // Shift+,
    action: 'stop',
    description: 'Stop playback',
    feedback: () => '■ Stopped'
}
];

// ========================================
// CONFLICT WARNINGS (optional)
// ========================================
// If you're using these keys elsewhere in your app,
// consider changing them above to avoid conflicts:
//
// 'l' = Your "List All" shortcut
// 'f' = Your "Focus Search" shortcut
// 's' = Your "Stop Player" shortcut (same action, so OK)
// 't' = Your "Cycle Tags" shortcut
// ========================================


// 🎯 How to Customize
// Example 1: Change "Forward 10s" from L to N
// javascript
// {
// key: 'n',  // ← Changed from 'l'
// action: 'forward',
// seconds: 10,
// description: 'Forward 10 seconds',
// feedback: (time) => `+10s (${formatDuration(time * 1000)})`
// },
// Example 2: Disable a shortcut
// javascript
// {
// key: null,  // ← Set to null to disable
// action: 'forward',
// seconds: 10,
// description: 'Forward 10 seconds (DISABLED)',
// feedback: (time) => `+10s (${formatDuration(time * 1000)})`
// },
// Example 3: Add multiple keys for same action
// javascript
// // Both 'k' and 'p' will play/pause
// {
// key: 'k',
// action: 'playPause',
// description: 'Play/Pause (K)',
// feedback: (paused) => paused ? '⏸ Paused' : '▶ Playing'
// },
// {
// key: 'p',
// action: 'playPause',
// description: 'Play/Pause (P)',
// feedback: (paused) => paused ? '⏸ Paused' : '▶ Playing'
// },
// Example 4: Change rewind/forward amounts
// javascript
// {
// key: 'j',
// action: 'rewind',
// seconds: 15,  // ← Changed from 10 to 15
// description: 'Rewind 15 seconds',
// feedback: (time) => `-15s (${formatDuration(time * 1000)})`
// },


// Action	Parameters	Example
// playPause	none	Toggle play/pause
// rewind	seconds: number	Seek backwards
// forward	seconds: number	Seek forwards
// speedDecrease	step: number	Reduce playback speed
// speedIncrease	step: number	Increase playback speed
// speedReset	none	Reset to 1x speed
// volumeUp	step: number (0-100)	Increase volume
// volumeDown	step: number (0-100)	Decrease volume
// mute	none	Toggle mute
// jumpToPercent	percent: number (0-100)	Jump to position
// jumpToStart	none	Jump to beginning
// jumpToEnd	none	Jump to end
// fullscreen	none	Toggle fullscreen
// exitFullscreen	none	Exit fullscreen only
// stop	none	Stop playback completely
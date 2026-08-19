// Single reader for version_ipa.txt, shared by app.config.js and the iOS
// workflows so the two can't disagree about what version is being built.
//
// Format: one "key=value" per line; "#" starts a comment; ":" also accepted.
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'version_ipa.txt');

function readAll() {
  let raw;
  try {
    raw = fs.readFileSync(FILE, 'utf8');
  } catch (err) {
    console.warn('[ipa-version] version_ipa.txt not found — falling back to 0.0.0');
    return {};
  }
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const m = trimmed.match(/^([A-Za-z_]+)\s*[=:]\s*(.+)$/);
    if (!m) continue;
    // First token only. CFBundleShortVersionString has to stay a plain
    // dotted number or iOS can refuse to install the build, so any trailing
    // note in the file is ignored rather than shipped into the plist.
    out[m[1].toLowerCase()] = m[2].trim().split(/\s+/)[0];
  }
  return out;
}

function read(key) {
  const value = readAll()[String(key).toLowerCase()];
  if (!value) {
    console.warn(`[ipa-version] no "${key}" entry in version_ipa.txt — using 0.0.0`);
    return '0.0.0';
  }
  return value;
}

module.exports = { read, readAll };
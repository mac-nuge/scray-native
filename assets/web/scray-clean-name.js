
// scray-clean-name.js  —  Scray (picker, native and browse hold identical copies)
//
// One rule for what a stash-named file SHOULD be called, so the rename modal,
// Native and manage-data's bulk rename can never disagree about it.
//
//   parent _ studio _ female performers _ title (5 words) _ dimension . ext
//   gamma_evil-angel_anna-lee-bea-ray_the-long-way-home_1080.mp4
//
// - Every field is hyphenated: spaces inside a field become '-', so each field
//   is one unbroken token and '_' only ever separates fields.
// - The parent is the studio's `parent` attribute, from manage-data. It is
//   dropped when it is blank, and when it is the studio's own name - a studio
//   that is its own parent would otherwise print twice.
// - The studio comes from scrayStashNames, which has already run it through
//   the studio dictionary. Re-map a studio (or re-parent it) in manage-data
//   and the suggestion changes with it - which is what makes a file eligible
//   to be renamed again.
// - A missing field is dropped with its separator rather than left blank, so a
//   cast-less scene reads studio_title_1080. Only a file with no stash data at
//   all (neither matched nor manual) has no suggestion.
// - The dimension is the SECOND one by convention: the height, as the
//   catalogue holds it. Rows that were never probed have none and lose that
//   field.
// - Words in the censor list print as their first letter (or as whatever that
//   list maps them to). Whole words only: 'anal' never touches 'analysis'.
// - Bracket tags in the old name are NOT carried over. The suggestion is the
//   stash name and nothing else; the rename modal is where anything worth
//   keeping gets put back by hand.
//
// TWO WAYS IN, because browse has neither the catalogue nor scray-config.js:
//   scrayCleanNameFrom(input)  the rule itself, over plain values
//   scrayCleanName(video)      the same, fed from a video row in the apps
//
// The name is built to be accepted by api.php's rename_file: no
// " * : < > ? / \ | , no leading or trailing dot, 250 bytes or less.
(function () {
  'use strict';

  // ⚙️ The knobs. Title words is the one Mac asked for by name.
  const MAX_TITLE_WORDS = 5;
  const MAX_BYTES       = 250;   // rename_file's cap, checked here so the
                                 // suggestion is never one the server refuses.

  // OneDrive's forbidden set. Stash titles carry ':' and '?' routinely.
  const ILLEGAL = /["*:<>?/\\|]/g;

  const bytes = (s) => (typeof TextEncoder === 'function')
    ? new TextEncoder().encode(s).length
    : unescape(encodeURIComponent(s)).length;

  // Must stay identical to scrayNameKey() in api.php and scrayNameMap.key(),
  // or a censored word is never found.
  const key = (s) => String(s == null ? '' : s).normalize('NFC').trim().toLowerCase();

  /** The censor dictionary: raw_key -> what to print. {} when there is none. */
  function censorMap(given) {
    if (given && typeof given === 'object') return given;
    try {
      const all = window.scrayNameMap && window.scrayNameMap.dump();
      return (all && all.censor) || {};
    } catch { return {}; }
  }

  /** One word, censored if the list has it. Blank mapping = its first letter. */
  function censorWord(word, map) {
    const hit = map[key(word)];
    if (hit === undefined) return word;
    return String(hit || '').trim() || word.slice(0, 1);
  }

  /** Text -> the words a field is built from. Punctuation is a separator. */
  function words(text) {
    return String(text || '')
      .replace(ILLEGAL, ' ')
      .replace(/[,;_]+/g, ' ')     // '_' too: it is the field separator here
      .replace(/[’']/g, '')        // don't -> dont, rather than dont-t
      .split(/\s+/)
      .filter(Boolean);
  }

  /** One hyphenated, censored field, at most `limit` words (0 = no limit). */
  function field(text, limit, map) {
    const w = words(text);
    return (limit ? w.slice(0, limit) : w)
      .map(bit => censorWord(bit, map))
      .join('-')
      .replace(/-{2,}/g, '-')
      .replace(/^[-.]+|[-.]+$/g, '');
  }

  /** '.mp4' from a filename, or '' when it has no extension. */
  function extensionOf(filename) {
    const name = String(filename || '');
    const dot  = name.lastIndexOf('.');
    // A dot in the last four characters and not at the very front: an
    // extension. Anything else is part of the name.
    if (dot <= 0 || name.length - dot > 5) return '';
    return name.slice(dot).toLowerCase();
  }

  /**
   * The rule, over plain values. Everything is optional.
   *
   * @param {object} input
   *   parent, studio, title   strings
   *   performers              a string ("anna lee, bea ray") or an array
   *   height                  the second dimension, a number
   *   filename                only for its extension
   *   censor                  raw_key -> replacement; the apps' own dictionary
   *                           is used when this is left out
   * @returns {{parent,studio,performers,title,dimension,extension,name}|null}
   */
  function cleanNameFrom(input) {
    const i = input || {};
    const map = censorMap(i.censor);

    const performersText = Array.isArray(i.performers)
      ? i.performers.join(' ') : (i.performers || '');

    const parts = {
      parent:     field(i.parent, 0, map),
      studio:     field(i.studio, 0, map),
      performers: field(performersText, 0, map),
      title:      field(i.title, MAX_TITLE_WORDS, map),
      dimension:  (Number(i.height) > 0) ? String(Math.round(Number(i.height))) : '',
      extension:  extensionOf(i.filename)
    };
    // A studio that is its own parent says nothing twice.
    if (parts.parent && parts.parent === parts.studio) parts.parent = '';

    // The dimension is held back from the trimming below: it is four
    // characters that carry real information, and a name ending '_10' because
    // the trim ran through it would be worse than a shorter title.
    const tail  = parts.dimension ? '_' + parts.dimension : '';
    const limit = MAX_BYTES - bytes(tail + parts.extension);

    let titleWords = parts.title ? parts.title.split('-') : [];
    const head = () => [parts.parent, parts.studio, parts.performers, titleWords.join('-')]
      .filter(Boolean).join('_');

    // A dimension on its own is not a name: '1080.mp4' says nothing about
    // which file this is. Something with words in it has to survive.
    if (!head()) return null;

    // Over the cap: drop title words one at a time, then hard-trim what is
    // left. A name the server would refuse is worse than a short one.
    while (titleWords.length > 1 && bytes(head()) > limit) titleWords.pop();
    let base = head();
    while (base.length > 1 && bytes(base) > limit) base = base.slice(0, -1);
    base = base.replace(/[-._]+$/, '');

    const name = (base + tail).replace(/^_+/, '');
    if (!name) return null;

    parts.title = titleWords.join('-');
    parts.name  = name + parts.extension;
    return parts;
  }

  /**
   * The same, fed from a video row. Null when this video has no stash data.
   * Apps only: it reads the catalogue-wide dictionaries in scray-config.js.
   */
  function cleanNameParts(video) {
    if (!video) return null;
    const p = (window.scrayStashNames && window.scrayStashNames.parts)
      ? window.scrayStashNames.parts(video)
      : null;
    if (!p) return null;

    // attrsFor answers by either spelling, so the mapped studio finds the row
    // the parent was filed against.
    const attrs = (window.scrayNameMap && window.scrayNameMap.attrsFor)
      ? window.scrayNameMap.attrsFor('studio', p.studio) : {};

    return cleanNameFrom({
      parent:     attrs.parent || '',
      studio:     p.studio,
      performers: p.performerList || [],
      title:      p.title,
      height:     video.height,
      filename:   video.filename
    });
  }

  /** The suggested filename for a video, extension and all, or null. */
  function cleanName(video) {
    const parts = cleanNameParts(video);
    return parts ? parts.name : null;
  }

  /**
   * The suggestion, but only when it would actually change something. This is
   * the "eligible for a clean rename" test the bulk list and the modal both
   * use: a re-mapped studio changes the suggestion, so the file comes back
   * into scope on its own.
   */
  function cleanNameSuggestion(video) {
    return differs(cleanName(video), video && video.filename);
  }

  /**
   * `suggested`, unless it is the name the file already has. NFC: the same
   * name typed on a Mac and in the catalogue can differ by composition alone,
   * and that is not a rename worth offering.
   */
  function differs(suggested, filename) {
    if (!suggested) return null;
    const norm = (s) => (s && s.normalize) ? s.normalize('NFC') : String(s || '');
    return norm(suggested) === norm(filename) ? null : suggested;
  }

  window.scrayCleanNameFrom       = cleanNameFrom;
  window.scrayCleanNameParts      = cleanNameParts;
  window.scrayCleanName           = cleanName;
  window.scrayCleanNameSuggestion = cleanNameSuggestion;
  window.scrayCleanNameDiffers    = differs;
})();

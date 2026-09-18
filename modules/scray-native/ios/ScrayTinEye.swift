import Foundation

// ============================================================================
// TinEye results, Scray's way (native 14.9).
//
// The TinEye overflow action (picker 13.186 / native 13.179) opens
// tineye.com/search?url=<frame> in this browser. TinEye's own page is hard to
// read on a phone, so this script - injected into tineye.com pages only -
// reads the results TinEye has drawn and lays a page of our own over the top:
//
//   domain · date
//   the page's URL, still a link (opens in a new tab)
//   the URL's path split into words, tap to pick
//   [Search]  -> scraynative://stashsearch?q=<words>: the browser hands the
//                words to the Stash modal of the app that asked, which opens
//                its navigator on that search
//   [Copy]    -> the picked words to the clipboard
//
// "TinEye page" in the header hides the overlay; a pill brings it back.
//
// It READS the page rather than asking TinEye for data: TinEye's JSON is not a
// public API, and scraping what is on screen needs nothing but the links. A
// result is any link off tineye.com whose visible text is a piece of its own
// address containing a "/" - that is the "videos/541147/mmf-vienna-black/"
// line under each match. Image links (.jpg etc.) are skipped. If TinEye ever
// changes its layout so that stops matching, the overlay says it found
// nothing and the TinEye page is one tap away.
//
// Inside a shadow root, so TinEye's CSS can't reach it and ours can't leak.
//
// native 14.15: the frame that was searched sits at the top, each result
// shows TinEye's thumbnail of the matching image (tap for the full image),
// and "‹ Picker" goes back to the Picker tab that asked. The frame's address
// and "from Picker" arrive in the URL's #fragment (player.js adds them) -
// TinEye's redirect from /search?url= to /search/<id> drops the query but
// keeps the fragment - and are kept in sessionStorage for the tab.
// ============================================================================

enum ScrayTinEye {
    static let overlayJS = #"""
(function () {
  if (window.__scrayTinEye) return;
  window.__scrayTinEye = true;
  if (!/(^|\.)tineye\.com$/i.test(location.hostname)) return;

  function ssGet(k) { try { return window.sessionStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function ssSet(k, v) { try { window.sessionStorage.setItem(k, v); } catch (e) {} }
  (function readHash() {
    var h = location.hash || '';
    var fm = h.match(/scray-frame=([^&]+)/);
    if (fm) ssSet('scrayTE.frame', safeDecode(fm[1]));
    if (/scray-from=picker/.test(h)) ssSet('scrayTE.from', 'picker');
  })();

  var WAIT_HINT_MS = 15000;   // how long before "found nothing" is said
  var host = null, root = null, list = null, countEl = null, pill = null;
  var shown = true;
  var picked = {};            // href -> { indexes: {i: true} }
  var lastKeys = '';
  var started = Date.now();

  function onResultsPage() { return /^\/search/.test(location.pathname); }

  function safeDecode(s) { try { return decodeURIComponent(s); } catch (e) { return s; } }

  // Same splitting as the rename modal's word selector: a new word whenever
  // the character type changes (letter / number / other), at a camelCase
  // step, and every other character on its own as a separator.
  function words(text) {
    var out = [], cur = '', type = null;
    function kind(c) { return /[a-z]/i.test(c) ? 'l' : (/[0-9]/.test(c) ? 'n' : 's'); }
    for (var i = 0; i < text.length; i++) {
      var c = text[i], k = kind(c), p = i ? text[i - 1] : '';
      var camel = type === 'l' && k === 'l' && /[a-z]/.test(p) && /[A-Z]/.test(c);
      if (type === null) { type = k; cur = c; continue; }
      if (k === 's' || type === 's' || k !== type || camel) {
        out.push({ w: cur, sep: type === 's' });
        cur = c; type = k;
      } else cur += c;
    }
    if (cur) out.push({ w: cur, sep: type === 's' });
    return out;
  }

  function scan() {
    var out = [], seen = {};
    var links = document.querySelectorAll('a[href]');
    for (var i = 0; i < links.length; i++) {
      var a = links[i], u;
      try { u = new URL(a.href, location.href); } catch (e) { continue; }
      if (!/^https?:$/.test(u.protocol)) continue;
      if (/(^|\.)tineye\.com$/i.test(u.hostname)) continue;
      if (/\.(jpe?g|png|gif|webp|bmp)$/i.test(u.pathname)) continue;
      var text = (a.textContent || '').replace(/\s+/g, ' ').trim()
        .replace(/(…|\.\.\.)$/, '').replace(/^https?:\/\//i, '');
      if (!text || text.indexOf('/') < 0) continue;
      var whole = safeDecode(u.hostname + u.pathname + u.search);
      if (whole.indexOf(safeDecode(text)) < 0 && u.href.indexOf(text) < 0) continue;
      if (seen[u.href]) continue;
      seen[u.href] = true;

      // The result's own block: the nearest ancestor holding an image - that
      // image is TinEye's thumbnail of the match. The date is read from the
      // same block (or two levels up when there's no image), which keeps the
      // text it searches small - reading textContent all the way up to the
      // page on every link, every scan, was the slow part before (14.15).
      var block = null, img = null;
      for (var el = a.parentElement, lv = 0; el && lv < 6; el = el.parentElement, lv++) {
        var im = el.querySelector('img');
        if (im) { block = el; img = im; break; }
      }
      var scope = block || (a.parentElement && a.parentElement.parentElement) || a.parentElement;
      var dm = scope ? (scope.textContent || '').match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2}, \d{4}\b/) : null;
      var date = dm ? dm[0] : '';
      var thumb = img ? (img.currentSrc || img.src || img.getAttribute('data-src') || '') : '';
      var full = '';
      if (block) {
        var bl = block.querySelectorAll('a[href]');
        for (var k = 0; k < bl.length; k++) {
          if (/view\s*image/i.test(bl[k].textContent || '')) { full = bl[k].href; break; }
        }
      }
      var path = safeDecode(u.pathname + u.search).replace(/^\/+|\/+$/g, '');
      out.push({ href: u.href, site: u.hostname.replace(/^www\./i, ''), path: path, date: date,
                 thumb: thumb, full: full || thumb });
    }
    return out;
  }

  var CSS =
    ':host{all:initial}' +
    '.wrap{position:fixed;inset:0;z-index:2147483646;background:#f2f2f5;color:#222;overflow-y:auto;' +
      '-webkit-overflow-scrolling:touch;font:15px -apple-system,system-ui,sans-serif}' +
    '.head{position:sticky;top:0;display:flex;align-items:center;gap:8px;padding:12px 14px;' +
      'padding-top:calc(12px + env(safe-area-inset-top,0px));background:#fff;border-bottom:1px solid #ddd;z-index:1}' +
    '.head h1{flex:1;margin:0;font-size:17px;font-weight:700}' +
    '.head .back{background:#6c5ce7;color:#fff}' +
    '.frame{padding:12px 12px 0}' +
    '.frame .lbl{font-size:12px;color:#777;margin:0 0 6px}' +
    '.frame img{display:block;width:100%;max-height:40vh;object-fit:contain;background:#000;border-radius:10px}' +
    '.row{display:flex;gap:10px;align-items:flex-start}' +
    '.thumb{flex:0 0 96px;width:96px;height:72px;border-radius:6px;background:#222;overflow:hidden;display:block}' +
    '.thumb img{width:100%;height:100%;object-fit:cover;display:block}' +
    '.main{flex:1;min-width:0}' +
    '.head button{border:none;border-radius:8px;padding:7px 11px;font-size:13px;background:#e4e4ea;color:#222}' +
    '.list{padding:10px 12px 40px}' +
    '.card{background:#fff;border-radius:12px;padding:12px;margin-bottom:10px;box-shadow:0 1px 3px rgba(0,0,0,.08)}' +
    '.top{display:flex;justify-content:space-between;gap:8px;align-items:baseline}' +
    '.site{font-weight:700;font-size:15px}' +
    '.date{color:#888;font-size:12px;white-space:nowrap}' +
    '.url{display:block;margin:4px 0 8px;color:#2a62c9;font-size:13px;word-break:break-all;text-decoration:underline}' +
    '.words{display:flex;flex-wrap:wrap;align-items:center;padding:8px 10px;background:#f5f5f5;' +
      'border:2px solid #ddd;border-radius:4px;min-height:36px;-webkit-user-select:none;user-select:none}' +
    '.w{padding:3px 5px;border-radius:3px;font-size:14px;cursor:pointer}' +
    '.w.sep{color:#666;white-space:pre}' +
    '.w.on{background:#007bff;color:#fff;font-weight:700}' +
    '.picked{margin:8px 0 0;font-size:13px;color:#555;min-height:1.2em}' +
    '.btns{display:flex;gap:8px;margin-top:8px}' +
    '.btns button{flex:1;border:none;border-radius:8px;padding:10px;font-size:15px;font-weight:600;color:#fff}' +
    '.go{background:#6c5ce7}.copy{background:#555}' +
    '.btns button:disabled{opacity:.4}' +
    '.empty{padding:40px 16px;text-align:center;color:#777}' +
    '.toast{position:fixed;left:50%;bottom:calc(24px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);' +
      'background:rgba(0,0,0,.8);color:#fff;padding:8px 14px;border-radius:18px;font-size:14px;opacity:0;' +
      'transition:opacity .2s;pointer-events:none}' +
    '.toast.on{opacity:1}' +
    '.pill{position:fixed;right:14px;bottom:calc(20px + env(safe-area-inset-bottom,0px));z-index:2147483646;' +
      'border:none;border-radius:20px;padding:10px 14px;background:#6c5ce7;color:#fff;font:600 14px -apple-system,sans-serif;' +
      'box-shadow:0 2px 8px rgba(0,0,0,.3)}';

  function build() {
    if (host) return;
    host = document.createElement('div');
    host.id = 'scrayTinEye';
    document.documentElement.appendChild(host);
    root = host.attachShadow({ mode: 'open' });
    root.innerHTML =
      '<style>' + CSS + '</style>' +
      '<div class="wrap">' +
        '<div class="head">' +
          (ssGet('scrayTE.from') === 'picker' ? '<button type="button" class="back">\u2039 Picker</button>' : '') +
          '<h1>TinEye <span class="count"></span></h1>' +
          '<button type="button" class="raw">TinEye page</button></div>' +
        (ssGet('scrayTE.frame')
          ? '<div class="frame"><div class="lbl">Your frame</div><img alt=""></div>' : '') +
        '<div class="list"></div>' +
      '</div>' +
      '<button type="button" class="pill" hidden>Scray view</button>' +
      '<div class="toast"></div>';
    list = root.querySelector('.list');
    countEl = root.querySelector('.count');
    pill = root.querySelector('.pill');
    root.querySelector('.raw').addEventListener('click', function () { show(false); });
    var back = root.querySelector('.back');
    // ScrayBrowser switches to the tab that opened this one (native 14.15).
    if (back) back.addEventListener('click', function () { location.href = 'scraynative://back'; });
    var fimg = root.querySelector('.frame img');
    if (fimg) {
      // The frame lives on api.php for an hour; after that, or if the page's
      // rules refuse it, the block just goes.
      fimg.addEventListener('error', function () { var f = root.querySelector('.frame'); if (f) f.remove(); });
      fimg.src = ssGet('scrayTE.frame');
    }
    pill.addEventListener('click', function () { show(true); });
  }

  function show(on) {
    shown = on;
    root.querySelector('.wrap').style.display = on ? '' : 'none';
    pill.hidden = on;
  }

  var toastTimer = 0;
  function toast(msg) {
    var t = root.querySelector('.toast');
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('on'); }, 1600);
  }

  function termsFor(r, ws) {
    var sel = picked[r.href] || {};
    var out = [];
    ws.forEach(function (w, i) { if (sel[i] && !w.sep) out.push(w.w); });
    return out.join(' ').trim();
  }

  function copy(text) {
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); toast('Copied: ' + text); }
      catch (e) { toast('Could not copy'); }
      ta.remove();
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast('Copied: ' + text); }, fallback);
    } else fallback();
  }

  function card(r) {
    var ws = words(r.path);
    var el = document.createElement('div');
    el.className = 'card';

    var top = document.createElement('div');
    top.className = 'top';
    var site = document.createElement('span'); site.className = 'site'; site.textContent = r.site;
    var date = document.createElement('span'); date.className = 'date'; date.textContent = r.date;
    top.appendChild(site); top.appendChild(date);

    var a = document.createElement('a');
    a.className = 'url'; a.href = r.href; a.target = '_blank'; a.rel = 'noopener';
    a.textContent = r.site + '/' + r.path;

    var box = document.createElement('div');
    box.className = 'words';
    var pickedLine = document.createElement('div');
    pickedLine.className = 'picked';
    var btns = document.createElement('div');
    btns.className = 'btns';
    var go = document.createElement('button'); go.type = 'button'; go.className = 'go'; go.textContent = 'Search';
    var cp = document.createElement('button'); cp.type = 'button'; cp.className = 'copy'; cp.textContent = 'Copy';
    btns.appendChild(go); btns.appendChild(cp);

    function paint() {
      var t = termsFor(r, ws);
      pickedLine.textContent = t ? '→ ' + t : 'Tap words to pick them';
      go.disabled = cp.disabled = !t;
    }

    var sel = picked[r.href] || (picked[r.href] = {});
    ws.forEach(function (w, i) {
      var s = document.createElement('span');
      s.className = 'w' + (w.sep ? ' sep' : '') + (sel[i] ? ' on' : '');
      s.textContent = w.w;
      s.addEventListener('click', function () {
        if (sel[i]) delete sel[i]; else sel[i] = true;
        s.classList.toggle('on', !!sel[i]);
        paint();
      });
      box.appendChild(s);
    });

    go.addEventListener('click', function () {
      var t = termsFor(r, ws);
      if (!t) return;
      location.href = 'scraynative://stashsearch?q=' + encodeURIComponent(t);
    });
    cp.addEventListener('click', function () {
      var t = termsFor(r, ws);
      if (t) copy(t);
    });

    var main = document.createElement('div');
    main.className = 'main';
    main.appendChild(top); main.appendChild(a);
    var row = document.createElement('div');
    row.className = 'row';
    if (r.thumb) {
      // TinEye's thumbnail of the matching image; tap for the full one.
      var th = document.createElement('a');
      th.className = 'thumb'; th.href = r.full || r.thumb; th.target = '_blank'; th.rel = 'noopener';
      var ti = document.createElement('img');
      ti.src = r.thumb; ti.alt = ''; ti.loading = 'lazy';
      th.appendChild(ti);
      row.appendChild(th);
    }
    row.appendChild(main);
    el.appendChild(row); el.appendChild(box);
    el.appendChild(pickedLine); el.appendChild(btns);
    paint();
    return el;
  }

  function render() {
    if (!onResultsPage()) {
      if (host) host.style.display = 'none';
      return;
    }
    build();
    host.style.display = '';
    var results = scan();
    var waitedOut = Date.now() - started > WAIT_HINT_MS;
    // Redrawn only when what it would draw changes - picks survive in
    // `picked` either way, but a redraw on every mutation would fight taps.
    var state = results.length
      ? results.map(function (r) { return r.href + '|' + r.thumb; }).join('\n')
      : (waitedOut ? '#none' : '#wait');
    if (state === lastKeys) return;
    lastKeys = state;
    countEl.textContent = results.length ? '· ' + results.length : '';
    list.replaceChildren();
    if (!results.length) {
      var e = document.createElement('div');
      e.className = 'empty';
      e.textContent = waitedOut
        ? 'Nothing picked up from TinEye’s results. Tap “TinEye page” to see what it says.'
        : 'Waiting for TinEye’s results…';
      list.appendChild(e);
      return;
    }
    results.forEach(function (r) { list.appendChild(card(r)); });
  }

  var pending = 0;
  function soon() {
    if (pending) return;
    pending = setTimeout(function () { pending = 0; render(); }, 500);
  }

  function start() {
    render();
    new MutationObserver(function (records) {
      // Our own shadow tree doesn't reach the document's observer, but the
      // host element going in does - ignore changes that are only that.
      for (var i = 0; i < records.length; i++) {
        if (records[i].target !== document.documentElement) { soon(); return; }
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
    // The "found nothing" hint needs a tick of its own if the page goes quiet.
    setTimeout(render, WAIT_HINT_MS + 200);
    // TinEye is a single-page app in places: a new search can change the
    // address without a load.
    var lastPath = location.pathname;
    setInterval(function () {
      if (location.pathname !== lastPath) {
        lastPath = location.pathname;
        started = Date.now(); lastKeys = ''; picked = {};
        render();
      }
    }, 700);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
"""#
}

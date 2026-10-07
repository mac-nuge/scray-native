/**
 * Scray :: this phone's own key (native 15.136 / browse 15.188).
 *
 * The app used to carry one shared device key, built into every IPA and the
 * web-staging folder, so anyone could have it. Now each phone signs in once
 * with the password and an authenticator code (api.php `device_pair`) and
 * keeps a key of its own here, in the web layer's storage. Each key can be
 * signed out on its own from browse's twofactor.php.
 *
 * Loaded straight after scray-key.js and before scray-config.js, so the key it
 * finds becomes window.SCRAY_API_KEY and from there SCRAY_SYNC.API_KEY - the
 * one every call already sends, and the one scray-bridge.js hands the Swift
 * browser sync on openBrowser. Nothing else needed changing.
 *
 * Not signed in (or signed out on the server): a sign-in sheet offers itself
 * shortly after start-up. "Later" puts it off until the app next opens; the
 * library, downloads and offline files keep working meanwhile, and only calls
 * to the server fail. Settings has a "This phone" row to sign in or out.
 *
 * Builds nothing at load: this runs from <head>, before <body> exists.
 */
(function () {
  'use strict';

  var LS_KEY   = 'scray.deviceKey';
  var LS_NAME  = 'scray.deviceName';
  var SS_LATER = 'scray.deviceSignInLater';
  var KEY_RE   = /^sd_[0-9a-f]{64}$/;
  var OFFER_AFTER_MS = 1500;   // ⚙️ how long after start-up the sheet may appear

  function lsGet(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function lsSet(k, v) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) {} }
  function ssGet(k) { try { return sessionStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function ssSet(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} }

  var own = lsGet(LS_KEY);
  if (KEY_RE.test(own)) window.SCRAY_API_KEY = own;   // over any key scray-key.js set
  else own = '';

  var variant = (window.SCRAY_NATIVE && window.SCRAY_NATIVE.variant) || '';
  var APP = { dev: 'Scray Dev', remote: 'Scray Remote', prd: 'BBW iPlayer' }[variant] || 'Browser';

  // What the server said at start-up: { device: {...} | null, shared: bool } or null.
  var who = null;
  var sheet = null;

  function apiBase() {
    return (window.SCRAY_SYNC && window.SCRAY_SYNC.API_BASE) || 'https://macnguyen.com/scray/api.php';
  }
  function currentKey() {
    return (window.SCRAY_SYNC && window.SCRAY_SYNC.API_KEY) || window.SCRAY_API_KEY || '';
  }
  function call(action, body, key) {
    var headers = { 'Content-Type': 'application/json' };
    if (key) headers['X-Scray-Key'] = key;
    return fetch(apiBase() + '?action=' + action, {
      method: body ? 'POST' : 'GET', headers: headers, cache: 'no-store',
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { j._status = r.status; return j; });
    });
  }

  // ---- the sheet -------------------------------------------------------------
  var CSS =
    '.sdk-veil{position:fixed;inset:0;z-index:2147483100;background:rgba(0,0,0,.62);display:flex;justify-content:center;' +
    'align-items:flex-start;padding:max(env(safe-area-inset-top),7vh) 16px 0;box-sizing:border-box;overflow-y:auto}' +
    '.sdk-card{width:min(100%,360px);background:#151a20;border:1px solid #252c35;border-radius:12px;padding:20px;color:#dfe6ee;' +
    'font:14px/1.45 -apple-system,system-ui,sans-serif;box-shadow:0 12px 40px rgba(0,0,0,.5);margin-bottom:40vh}' +
    '.sdk-card h3{margin:0 0 6px;font-size:16px;font-weight:700}' +
    '.sdk-card p{margin:0 0 12px;color:#9aa6b2;font-size:13px}' +
    '.sdk-card input{display:block;width:100%;box-sizing:border-box;margin:0 0 10px;padding:11px 12px;background:#0d0f12;' +
    'border:1px solid #2c343e;border-radius:8px;color:#dfe6ee;font:inherit;font-size:16px}' +
    '.sdk-card input:focus{outline:none;border-color:#4fd6d6}' +
    '.sdk-card input.sdk-code{letter-spacing:.3em;text-align:center}' +
    '.sdk-card label{display:block;font-size:12px;color:#9aa6b2;margin:0 0 4px}' +
    '.sdk-row{display:flex;gap:10px;margin-top:6px}' +
    '.sdk-row button{flex:1;padding:11px;border-radius:8px;font:inherit;font-weight:700;cursor:pointer}' +
    '.sdk-go{background:#4fd6d6;border:0;color:#06282a}' +
    '.sdk-later{background:transparent;border:1px solid #3a434e;color:#dfe6ee}' +
    '.sdk-alt{background:none;border:0;padding:0;margin:-4px 0 10px;color:#4fd6d6;font:inherit;font-size:12px;cursor:pointer}' +
    '.sdk-err{color:#ff6b6b;font-size:13px;min-height:1.2em;margin:4px 0 0}' +
    '.sdk-ok{color:#4cc38a}';

  function el(tag, attrs, text) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (text) e.textContent = text;
    return e;
  }

  function close() {
    if (sheet) sheet.remove();
    sheet = null;
  }

  /** Show the sign-in sheet. why: a line saying why it's asking. */
  function open(why) {
    if (sheet || !document.body) return;
    if (!document.getElementById('sdk-css')) {
      var st = el('style', { id: 'sdk-css' });
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    sheet = el('div', { 'class': 'sdk-veil', role: 'dialog', 'aria-modal': 'true' });
    var card = el('form', { 'class': 'sdk-card', autocomplete: 'on' });
    card.appendChild(el('h3', null, 'Sign in this phone'));
    card.appendChild(el('p', null, why || 'Scray needs this phone signed in to reach the server. Your password, then the code from your authenticator app.'));
    var pw = el('input', { type: 'password', name: 'password', placeholder: 'Password', autocomplete: 'current-password' });
    var codeWrap = el('div');
    codeWrap.style.display = 'none';
    codeWrap.appendChild(el('label', null, 'Code from your authenticator app'));
    var code = el('input', { type: 'text', name: 'code', 'class': 'sdk-code', placeholder: '123456', inputmode: 'numeric',
                             autocomplete: 'one-time-code', maxlength: '16', autocapitalize: 'characters', spellcheck: 'false' });
    codeWrap.appendChild(code);
    var alt = el('button', { type: 'button', 'class': 'sdk-alt' }, 'Use a recovery code instead');
    codeWrap.appendChild(alt);
    var nameLabel = el('label', null, 'Name for this phone');
    var name = el('input', { type: 'text', name: 'name', maxlength: '60', autocomplete: 'off' });
    name.value = lsGet(LS_NAME) || 'iPhone';
    var err = el('div', { 'class': 'sdk-err', 'aria-live': 'polite' });
    var row = el('div', { 'class': 'sdk-row' });
    var later = el('button', { type: 'button', 'class': 'sdk-later' }, 'Later');
    var go = el('button', { type: 'submit', 'class': 'sdk-go' }, 'Sign in');
    row.appendChild(later);
    row.appendChild(go);
    [pw, codeWrap, nameLabel, name, err, row].forEach(function (n) { card.appendChild(n); });
    sheet.appendChild(card);
    document.body.appendChild(sheet);
    setTimeout(function () { pw.focus(); }, 50);

    var busy = false;
    function submit() {
      if (busy) return;
      if (!pw.value) { err.textContent = 'Type the password.'; pw.focus(); return; }
      busy = true;
      go.disabled = true;
      err.textContent = '';
      err.className = 'sdk-err';
      call('device_pair', { password: pw.value, code: code.value.trim(), name: name.value.trim(), app: APP })
        .then(function (j) {
          busy = false;
          go.disabled = false;
          if (j._status === 429 && j.retry_ms) { setTimeout(submit, j.retry_ms); return; }
          if (j.ok && KEY_RE.test(j.key || '')) {
            lsSet(LS_KEY, j.key);
            lsSet(LS_NAME, (j.device && j.device.name) || name.value.trim());
            err.className = 'sdk-err sdk-ok';
            err.textContent = 'Signed in. Reloading…';
            setTimeout(function () { location.reload(); }, 600);
            return;
          }
          if (j.need_code) {
            if (codeWrap.style.display === 'none') {
              codeWrap.style.display = '';
              code.value = '';
              code.focus();
            } else {
              code.select();
            }
            err.textContent = j.error || '';
            return;
          }
          err.textContent = j.error || ('Could not sign in (HTTP ' + j._status + ').');
          if (/password/i.test(j.error || '')) pw.select();
        })
        .catch(function () {
          busy = false;
          go.disabled = false;
          err.textContent = 'Could not reach the server. Check the connection and try again.';
        });
    }

    card.addEventListener('submit', function (e) { e.preventDefault(); submit(); });
    pw.addEventListener('input', function () {
      // A changed password goes back to step one.
      if (codeWrap.style.display !== 'none') { codeWrap.style.display = 'none'; code.value = ''; }
      err.textContent = '';
    });
    code.addEventListener('input', function () {
      err.textContent = '';
      if (/^\d{6}$/.test(code.value.replace(/\s+/g, ''))) submit();
    });
    alt.addEventListener('click', function () {
      code.setAttribute('inputmode', 'text');
      code.placeholder = 'XXXXX-XXXXX';
      code.value = '';
      alt.style.display = 'none';
      code.focus();
    });
    later.addEventListener('click', function () { ssSet(SS_LATER, '1'); close(); });
  }

  function offer(why) {
    if (ssGet(SS_LATER)) return;
    open(why);
  }

  /** Forget this phone's key - on the server too when it can be reached. */
  function signOut() {
    var k = lsGet(LS_KEY);
    var done = function () { lsSet(LS_KEY, ''); location.reload(); };
    if (!k) { done(); return; }
    call('device_signout', {}, k).then(done, done);
  }

  // ---- start-up check ----------------------------------------------------------
  function check() {
    if (navigator.onLine === false) return;
    var k = currentKey();
    if (!k) { offer(); return; }
    call('device_whoami', null, k).then(function (j) {
      if (j.ok) {
        who = j;
        if (j.device) { if (j.device.name) lsSet(LS_NAME, j.device.name); return; }
        if (j.shared) offer('This app still uses the old shared key, which is being retired. Sign this phone in to give it a key of its own.');
        return;
      }
      if (j._status === 401) {
        if (own) lsSet(LS_KEY, '');
        offer(own ? 'This phone was signed out on the server. Sign in again to reach the server.'
                  : 'The shared key no longer works. Sign this phone in to reach the server.');
      }
    }).catch(function () { /* offline or the server is down: say nothing */ });
  }

  // ---- Settings row --------------------------------------------------------------
  function registerSetting() {
    if (!window.scraySettings || typeof window.scraySettings.register !== 'function') return;
    window.scraySettings.register({
      id: 'deviceSignIn',
      label: 'This phone',
      type: 'custom',
      hint: 'Each phone signs in with its own key. Sign phones out from browse’s twofactor.php.',
      build: function () {
        var box = document.createElement('div');
        box.style.cssText = 'display:flex;flex-direction:column;gap:8px;';
        var line = document.createElement('div');
        line.style.cssText = 'font-size:0.8rem;color:#ccc;';
        var signed = !!lsGet(LS_KEY);
        line.textContent = signed
          ? 'Signed in as “' + (lsGet(LS_NAME) || 'this phone') + '” (' + APP + ').'
          : (who && who.shared ? 'Not signed in - using the old shared key.' : 'Not signed in.');
        box.appendChild(line);
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = signed ? 'Sign out' : 'Sign in';
        btn.style.cssText = 'align-self:flex-start;width:auto;margin:0;padding:8px 14px;background:#2a2a2a;'
          + 'color:#fff;border:1px solid #555;border-radius:4px;font-size:0.9rem;';
        btn.addEventListener('click', function () {
          if (signed) {
            if (confirm('Sign this phone out? It will need the password and a code to reach the server again.')) signOut();
          } else {
            // Settings sits at the very top of the stack: close it first.
            var ov = document.getElementById('scraySettingsOverlay');
            if (ov) ov.remove();
            open();
          }
        });
        box.appendChild(btn);
        return { el: box, value: function () { return null; }, focus: function () { btn.focus(); } };
      },
      get: function () { return ''; },
      set: function () {}
    });
  }

  window.scrayDeviceKey = {
    open: open,
    signOut: signOut,
    signedIn: function () { return !!lsGet(LS_KEY); },
    app: APP
  };

  function boot() {
    registerSetting();
    setTimeout(check, OFFER_AFTER_MS);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

// =========================================
// STASH JOBS PANEL (picker 15.76 / native 15.96, browse 15.152)
// scray-hunt-jobs.js - Picker and Native hold identical copies.
//
// Stash hunt's bulk "Match ticked" (and the renames that follow it) now run on
// the server as a job - api.php's hunt_job_* actions - so they carry on with
// the app closed. This is their progress: a small panel bottom-left that
// minimises to a "🎯 12/40" pill, the way the upload panel does, so you can
// get on with something else while it runs.
//
//   window.scrayHuntJobs.start(items)  queue a job; opens the panel. Throws
//                                      with .unsupported on a server without it.
//   window.scrayHuntJobs.show()        open the panel
//   window.scrayHuntJobs.poll()        ask the server now
// Every answer is also sent as a 'scray-hunt-jobs' event ({ jobs }), which the
// bulk sheet listens to so its rows follow the job while it's open.
//
// Follow-ups: the server renames OneDrive, the box and the catalogue; this
// app's own rows - and on Native the phone's copy of the file - are put right
// here, by window.scrayHuntJobFollow(item) (Native's is in scray-rename.js;
// Picker's is the default below), whenever the app is open, then acknowledged
// (hunt_job_ack). So a job that finished with the app closed is caught up the
// next time it opens.
// =========================================
(function () {
  'use strict';

  // ⚙️ How often the panel asks while a job is queued or running, and how long
  // after a load it first looks (so a job from last time - or another device
  // signed in as this one - comes back, minimised).
  const POLL_LIVE_MS = 3000;
  const BOOT_DELAY_MS = 4000;
  // ⚙️ Gap above the bottom-of-screen dock row on phones (the upload panel's 88px).
  const PHONE_LIFT_PX = 88;
  const LS_DISMISSED = 'scray_hunt_jobs_dismissed_v1';
  const LS_MIN = 'scray_hunt_jobs_min_v1';

  const api = (action, body) => window.scrayApiCall(action, { method: 'POST', body: body || {} });
  const device = () => (window.SCRAY_SYNC && window.SCRAY_SYNC.DEVICE_ID) || 'unknown';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const readJson = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch (e) { return d; } };
  const writeJson = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } };

  const live = j => j && (j.state === 'queued' || j.state === 'running');
  const H = {
    jobs: [],                                   // newest first, as the server sends them
    dismissed: new Set(readJson(LS_DISMISSED, [])),
    min: readJson(LS_MIN, false),
    open: {},                                   // job_id -> its file list is showing
    timer: null,
    polling: false,
    following: false,
    wasLive: new Set(),                         // job ids live at the last answer
  };

  // ---- numbers -------------------------------------------------------------
  /** Per job: files finished, steps done of steps, and what went wrong. */
  function tally(j) {
    const items = j.items || [];
    let steps = 0, stepsDone = 0, filesDone = 0, failed = 0;
    for (const it of items) {
      const m = it.match_st, r = it.rename_st;
      steps += 1 + (r !== 'none' ? 1 : 0);
      stepsDone += (m !== 'pending' ? 1 : 0) + (r !== 'none' && r !== 'pending' ? 1 : 0);
      if (m !== 'pending' && r !== 'pending') filesDone++;
      if (m === 'failed' || r === 'failed') failed++;
    }
    return { total: items.length || j.total || 0, filesDone, failed, pct: steps ? Math.round(100 * stepsDone / steps) : 0 };
  }
  const shown = () => H.jobs.filter(j => live(j) || !H.dismissed.has(j.job_id));

  // ---- the panel -----------------------------------------------------------
  function ensureCss() {
    if (document.getElementById('scrayHuntJobsCss')) return;
    const css = document.createElement('style');
    css.id = 'scrayHuntJobsCss';
    css.textContent = `
#scrayHuntJobs { position: fixed; left: 10px; right: 10px; bottom: calc(10px + env(safe-area-inset-bottom, 0px));
  max-width: 460px; margin-right: auto; z-index: 2147482000; background: #fff; color: #222; border-radius: 10px;
  box-shadow: 0 8px 28px rgba(0,0,0,.35); padding: 10px 12px; font-size: 0.82rem; max-height: 50vh; overflow-y: auto;
  box-sizing: border-box; text-align: left; }
#scrayHuntJobs.is-min { right: auto; padding: 0; background: none; box-shadow: none; overflow: visible; }
@media (max-width: 1024px) {
  #scrayHuntJobs { bottom: calc(env(safe-area-inset-bottom, 0px) + var(--hj-lift, ${PHONE_LIFT_PX}px));
    max-height: min(50vh, calc(100vh - var(--hj-lift, ${PHONE_LIFT_PX}px) - 40px)); }
}
#scrayHuntJobs .hj-pill { background: #6f42c1; color: #fff; border: 0; border-radius: 999px; padding: 9px 14px; margin: 0;
  font-size: 0.85rem; font-weight: 600; box-shadow: 0 4px 14px rgba(0,0,0,.35); cursor: pointer; width: auto; font-variant-numeric: tabular-nums; }
#scrayHuntJobs .hj-pill.done { background: #2e7d32; }
#scrayHuntJobs .hj-pill.bad { background: #b8860b; }
#scrayHuntJobs .hj-head { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
#scrayHuntJobs .hj-head b { font-size: 0.72rem; letter-spacing: .1em; color: #6f42c1; }
#scrayHuntJobs .hj-grow { flex: 1; }
#scrayHuntJobs button.hj-btn { margin: 0; width: auto; min-width: 0; padding: 4px 9px; font-size: 0.75rem; border-radius: 6px;
  border: 1px solid #ccc; background: #f6f6f6; color: #333; cursor: pointer; }
#scrayHuntJobs .hj-job { padding: 6px 0 8px; border-top: 1px solid #eee; }
#scrayHuntJobs .hj-job:first-of-type { border-top: 0; }
#scrayHuntJobs .hj-title { display: flex; align-items: center; gap: 6px; font-weight: 600; }
#scrayHuntJobs .hj-state { font-weight: 400; font-size: 0.72rem; color: #777; }
#scrayHuntJobs .hj-bar { height: 8px; background: #ece6f6; border-radius: 4px; overflow: hidden; margin: 6px 0 4px; }
#scrayHuntJobs .hj-bar i { display: block; height: 100%; background: #6f42c1; transition: width .4s ease; }
#scrayHuntJobs .hj-stat { color: #555; font-variant-numeric: tabular-nums; }
#scrayHuntJobs .hj-stat .bad, #scrayHuntJobs .hj-li .bad { color: #c62828; }
#scrayHuntJobs .hj-acts { display: flex; gap: 6px; margin-top: 6px; }
#scrayHuntJobs .hj-list { list-style: none; margin: 6px 0 0; padding: 0; }
#scrayHuntJobs .hj-list li { display: flex; gap: 8px; padding: 5px 0; border-bottom: 1px solid #f4f4f4; }
#scrayHuntJobs .hj-ico { width: 16px; flex: none; text-align: center; }
#scrayHuntJobs .hj-li { flex: 1; min-width: 0; word-break: break-word; }
#scrayHuntJobs .hj-li small { display: block; color: #777; }
`;
    document.head.appendChild(css);
  }

  function panel() {
    let el = document.getElementById('scrayHuntJobs');
    if (el) return el;
    ensureCss();
    el = document.createElement('div');
    el.id = 'scrayHuntJobs';
    el.addEventListener('click', onClick);
    document.body.appendChild(el);
    return el;
  }

  /** Above the upload / offline panels when they're up, so nothing hides anything. */
  function place(el) {
    let lift = window.matchMedia && window.matchMedia('(max-width: 1024px)').matches ? PHONE_LIFT_PX : 10;
    for (const id of ['scrayUploadPanel', 'scrayOfflinePanel', 'scrayHzMigratePanel']) {
      const o = document.getElementById(id);
      if (!o || o.hidden || getComputedStyle(o).display === 'none') continue;
      const r = o.getBoundingClientRect();
      if (r.height) lift = Math.max(lift, Math.round(window.innerHeight - r.top + 8));
    }
    el.style.setProperty('--hj-lift', lift + 'px');
    if (!(window.matchMedia && window.matchMedia('(max-width: 1024px)').matches)) {
      el.style.bottom = 'calc(' + lift + 'px + env(safe-area-inset-bottom, 0px))';
    }
  }

  function itemLine(it) {
    const m = it.match_st, r = it.rename_st;
    let ico = '⏳', sub = '';
    if (m === 'failed') { ico = '⚠️'; sub = '<span class="bad">Couldn’t match: ' + esc(it.note || '') + '</span>'; }
    else if (m === 'cancelled') { ico = '–'; sub = 'Called off'; }
    else if (m === 'pending') { ico = '⏳'; sub = 'Waiting to match'; }
    else {
      ico = '✅';
      const bits = ['Matched' + (it.note ? ' (' + esc(it.note) + ')' : '')];
      if (r === 'pending') { ico = '✎'; bits.push('renaming next → ' + esc(it.new_name || '')); }
      else if (r === 'done') bits.push('renamed → ' + esc(it.new_filename || it.new_name || '') +
        (it.phone ? (it.follow_st === 'pending' ? ' · this phone’s copy next time the app is open' : ' · on this phone too') : ''));
      else if (r === 'failed') { ico = '⚠️'; bits.push('<span class="bad">rename failed: ' + esc(it.rnote || '') + '</span>'); }
      else if (r === 'cancelled') bits.push('rename called off');
      sub = bits.join(' · ');
    }
    return '<li><span class="hj-ico">' + ico + '</span><div class="hj-li">' + esc(it.filename || it.video_key) + '<small>' + sub + '</small></div></li>';
  }

  function jobHtml(j) {
    const t = tally(j);
    const renames = (j.items || []).filter(it => it.rename_st !== 'none').length;
    const state = { queued: 'queued', running: 'running', done: 'done', cancelled: 'cancelled' }[j.state] || j.state;
    const open = !!H.open[j.job_id];
    return '<div class="hj-job" data-job="' + j.job_id + '">' +
      '<div class="hj-title">🎯 Match ' + t.total + (renames ? ' · rename ' + renames : '') + '<span class="hj-state">' + esc(state) + '</span></div>' +
      '<div class="hj-bar"><i style="width:' + (j.state === 'done' ? 100 : t.pct) + '%"></i></div>' +
      '<div class="hj-stat">' + t.filesDone + ' of ' + t.total + ' done · matched ' + (j.matched || 0) +
        (renames ? ' · renamed ' + (j.renamed || 0) + ' of ' + renames : '') +
        (t.failed ? ' · <span class="bad">' + t.failed + ' failed</span>' : '') + '</div>' +
      '<div class="hj-acts">' +
        '<button type="button" class="hj-btn" data-act="files" data-job="' + j.job_id + '">' + (open ? 'Hide files' : 'Show files') + '</button>' +
        (live(j) ? '<button type="button" class="hj-btn" data-act="cancel" data-job="' + j.job_id + '">Cancel</button>' : '') +
      '</div>' +
      (open ? '<ul class="hj-list">' + (j.items || []).map(itemLine).join('') + '</ul>' : '') +
    '</div>';
  }

  function render() {
    const list = shown();
    let el = document.getElementById('scrayHuntJobs');
    if (!list.length) { if (el) el.remove(); return; }
    el = panel();
    el.classList.toggle('is-min', !!H.min);
    if (H.min) {
      // The pill counts the live job; with none, the newest one's outcome.
      const j = list.find(live) || list[0];
      const t = tally(j);
      const label = live(j)
        ? '🎯 ' + t.filesDone + '/' + t.total + (list.filter(live).length > 1 ? ' +' + (list.filter(live).length - 1) : '')
        : (t.failed ? '🎯 ⚠️ ' + t.failed + ' failed' : '🎯 ✓ ' + t.total + ' done');
      el.innerHTML = '<button type="button" class="hj-pill' + (live(j) ? '' : t.failed ? ' bad' : ' done') +
        '" data-act="expand" title="Stash jobs - tap to open">' + esc(label) + '</button>';
    } else {
      el.innerHTML = '<div class="hj-head"><b>STASH JOBS</b><span class="hj-grow"></span>' +
        (list.some(j => !live(j)) ? '<button type="button" class="hj-btn" data-act="clear" title="Hide the finished ones">Clear</button>' : '') +
        '<button type="button" class="hj-btn" data-act="min" title="Minimise">▾</button></div>' +
        list.map(jobHtml).join('');
    }
    place(el);
  }

  async function onClick(e) {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    e.stopPropagation();
    const act = b.dataset.act, jid = +b.dataset.job || 0;
    if (act === 'expand') { H.min = false; writeJson(LS_MIN, false); render(); poll(); }
    else if (act === 'min') { H.min = true; writeJson(LS_MIN, true); render(); }
    else if (act === 'files') { H.open[jid] = !H.open[jid]; render(); }
    else if (act === 'clear') {
      H.jobs.filter(j => !live(j)).forEach(j => H.dismissed.add(j.job_id));
      writeJson(LS_DISMISSED, [...H.dismissed].slice(-200));
      render();
    } else if (act === 'cancel') {
      b.disabled = true;
      try { await api('hunt_job_cancel', { job_id: jid }); } catch (err) { toast('⚠️ Couldn’t cancel: ' + ((err && err.message) || err)); }
      poll();
    }
  }

  function toast(msg, colour) {
    if (typeof window.showScoreConfirmation === 'function') { try { window.showScoreConfirmation(msg, colour); return; } catch (e) { /* below */ } }
    console.log('[hunt-jobs]', msg);
  }

  // ---- follow-ups ----------------------------------------------------------
  /**
   * Picker's half of a rename done on the server: its rows for the file. The
   * server renamed every OneDrive copy, so every row under the old key moves.
   * Native replaces this with its own (scray-rename.js), which also renames
   * the phone's copy.
   */
  async function defaultFollow(f) {
    let rows = [];
    try { rows = (typeof allVideos !== 'undefined' && Array.isArray(allVideos)) ? allVideos : (window.allVideos || []); } catch (e) { rows = window.allVideos || []; }
    const keyOf = v => v.videoKey || (window.scrayVideoKey ? window.scrayVideoKey(v.filename || '') : '');
    const moves = [];
    const want = new Set([f.video_key]);
    rows.forEach(v => { if (v && want.has(keyOf(v))) moves.push([v.oneDriveId, f.new_filename, f.new_key]); });
    if (!moves.length && f.local_id) moves.push([f.local_id, f.new_filename, f.new_key]);
    (f.also_done || []).forEach(a => { if (a.ok && a.local_id) moves.push([a.local_id, a.filename, a.new_key]); });
    for (const [id, filename, videoKey] of moves) {
      if (!id || !filename) continue;
      const fields = { filename, videoKey: videoKey || (window.scrayVideoKey ? window.scrayVideoKey(filename) : undefined) };
      try { if (typeof updateVideoInDB === 'function') await updateVideoInDB(id, fields); } catch (e) { console.warn('[hunt-jobs] row update:', e); }
      try { if (typeof updateVideoInMemory === 'function') updateVideoInMemory(id, fields); } catch (e) { /* lists catch up on the next load */ }
    }
    return true;
  }

  async function follow(items) {
    if (!items || !items.length || H.following) return;
    H.following = true;
    const acks = [];
    try {
      const fn = typeof window.scrayHuntJobFollow === 'function' ? window.scrayHuntJobFollow : defaultFollow;
      for (const f of items) {
        let ok = false;
        try { ok = await fn(f); } catch (err) { console.warn('[hunt-jobs] follow-up for', f.filename, err); ok = true; }
        // Acknowledged either way once tried: a phone copy that can't be
        // renamed shows in Native's ✎ names list, where it can be retried.
        if (ok !== false) acks.push({ job_id: f.job_id, idx: f.idx });
      }
      if (acks.length) {
        try { await api('hunt_job_ack', { items: acks }); } catch (err) { console.warn('[hunt-jobs] ack:', err); }
        if (typeof window.refreshAllLists === 'function') { try { window.refreshAllLists(); } catch (e) { /* not every page */ } }
      }
    } finally {
      H.following = false;
    }
  }

  // ---- asking the server ---------------------------------------------------
  async function poll() {
    clearTimeout(H.timer);
    if (H.polling || typeof window.scrayApiCall !== 'function') return;
    H.polling = true;
    let res = null;
    try {
      res = await api('hunt_job_status', { device: device() });
    } catch (err) {
      // An older server has no such action: nothing to show, nothing to poll.
      if (/Unknown action/i.test((err && err.message) || '')) { H.polling = false; return; }
      console.warn('[hunt-jobs] status:', (err && err.message) || err);
    }
    H.polling = false;
    if (res && Array.isArray(res.jobs)) {
      H.jobs = res.jobs;
      // A job that finished since the last answer: names and the S button
      // catch up once, and it says so.
      const nowLive = new Set(H.jobs.filter(live).map(j => j.job_id));
      const finished = H.jobs.filter(j => H.wasLive.has(j.job_id) && !live(j));
      H.wasLive = nowLive;
      if (finished.length) {
        try { if (window.scrayStashNames) await window.scrayStashNames.refresh(true); } catch (e) { /* lists catch up */ }
        try { if (typeof window.scrayLoadStashState === 'function') await window.scrayLoadStashState(true); } catch (e) { /* S catches up */ }
        finished.forEach(j => {
          const t = tally(j);
          toast((t.failed ? '⚠️ ' : '✅ ') + 'Stash job: ' + (j.matched || 0) + ' matched' +
                ((j.to_rename || 0) ? ' · ' + (j.renamed || 0) + ' renamed' : '') + (t.failed ? ' · ' + t.failed + ' failed' : ''),
                t.failed ? '#b8860b' : undefined);
        });
      }
      try { window.dispatchEvent(new CustomEvent('scray-hunt-jobs', { detail: { jobs: H.jobs } })); } catch (e) { /* old webview */ }
      render();
      if (res.follow && res.follow.length) follow(res.follow);
    }
    if (H.jobs.some(live)) H.timer = setTimeout(poll, POLL_LIVE_MS);
  }

  /** Queue a job. items: [{ video_key, filename, stash_id, new_name?, local_id?, phone?, also? }] */
  async function start(items) {
    let res;
    try {
      res = await api('hunt_job_start', { device: device(), items });
    } catch (err) {
      if (/Unknown action/i.test((err && err.message) || '')) err.unsupported = true;
      throw err;
    }
    const job = res && res.job;
    if (job) {
      H.jobs = [job].concat(H.jobs.filter(j => j.job_id !== job.job_id));
      H.wasLive.add(job.job_id);
      H.min = false;
      writeJson(LS_MIN, false);
      render();
      clearTimeout(H.timer);
      H.timer = setTimeout(poll, POLL_LIVE_MS);
    }
    return job;
  }

  function show() { H.min = false; writeJson(LS_MIN, false); render(); poll(); }

  window.scrayHuntJobs = { start, show, poll, jobs: () => H.jobs.slice() };

  // A job from before this load (or still running with the app closed) comes
  // back minimised; follow-ups left from it are done.
  function boot() {
    setTimeout(() => {
      H.min = true;   // back as the pill; tap it for the panel
      poll();
    }, BOOT_DELAY_MS);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
    window.addEventListener('resize', () => { const el = document.getElementById('scrayHuntJobs'); if (el) place(el); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();

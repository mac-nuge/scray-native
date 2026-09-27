console.log("scray-twoway.js loaded");

// =========================================
// TWO-WAY BUFFER (native 15.24; chunking the original from 15.27)
//
// A plain <video src> only ever loads forward from the playhead, so jogging
// backwards waits on the network. This plays a Hetzner video through Media
// Source Extensions instead (ManagedMediaSource on the iPhone), in ~2 s
// pieces: after every seek it loads the piece under the playhead, then works
// outwards, two ahead for every one behind, until the window around the
// playhead is full.
//
// The pieces come from the original file: scray-mp4-chunks.js (15.27) reads
// any mp4/m4v/mov's index and re-wraps its own frames into pieces as they're
// needed. Nothing on the gateway or the box. (15.24-15.26 also had a
// "packaged" path through copies made on the gateway - removed in 15.28.)
// Not an mp4/mov, a file that can't be chunked, no MediaSource in this
// WebView, or an unsupported codec: prepare() returns null and the player
// takes its usual path, untouched.
//
// Settings > Two-way buffer: on/off and seconds behind and ahead.
// "buffer i" in the player's ... menu (native 15.26) shows a box of what is
// loaded and how long seeks take - on either path, for any video.
//
// Everything is logged with [twoway], so it rides along in a Jira report.
// =========================================

(function () {
  const CFG_KEY = "scray.twoway";
  // On by default (15.25). From 15.27 that means every Hetzner mp4/m4v/mov.
  const DEFAULTS = { enabled: true, behind: 30, ahead: 60 };
  // The stats box is "buffer i" in the player's ... menu (native 15.26), off
  // until tapped. Its own key, so an older saved "stats" setting doesn't count.
  const INFO_KEY = "scray.bufferInfo";
  function infoOn() { try { return localStorage.getItem(INFO_KEY) === "1"; } catch { return false; } }
  function setInfoOn(on) { try { on ? localStorage.setItem(INFO_KEY, "1") : localStorage.removeItem(INFO_KEY); } catch {} }

  // ⚙️ ADJUSTABLE
  const PARALLEL      = 2;      // fragments fetched at once
  const SETTLE_MS     = 150;    // a scrub drag must pause this long before the window loads
  const MAX_RETRIES   = 3;      // per fragment, then it is left for the next pass
  // How much the player can hold. The window is the seconds behind/ahead from
  // Settings, but never more bytes than this: a 4K file at 12 Mbps is 1.5 MB a
  // second, so 90 s would be ~135 MB - more than the player keeps, and it
  // throws the oldest away as fast as they're loaded (native 15.30). Starts
  // here and comes down whenever the browser or iOS drops pieces or refuses
  // one, and stays down for the rest of this page load.
  const MB = 1048576;
  const BUDGET_START  = (window.ManagedMediaSource ? 60 : 120) * MB;
  const BUDGET_MIN    = 12 * MB;
  const OPEN_TIMEOUT  = 6000;   // ms for the MediaSource to open before falling back
  const STATS_EVERY   = 500;    // ms between overlay repaints

  const MSClass = window.ManagedMediaSource || window.MediaSource || null;
  const MANAGED = !!window.ManagedMediaSource;

  // Native's IPA loads the page from file:// (native 15.33 / picker 15.24). WebKit
  // won't play a blob: URL made on that page ("blob:null/…" - the load just
  // fails, and the element falls through to the plain copy), so there the
  // MediaSource goes straight onto the <video> as srcObject instead. Checked
  // once per page load on a spare element; if that doesn't open either, the
  // file:// page plays the plain way at once rather than after OPEN_TIMEOUT.
  // The dev server (http://) and Picker keep the blob URL.
  const OPAQUE = (() => {
    try { return location.origin === "null" || location.protocol === "file:"; } catch { return false; }
  })();
  let objProbe = null;
  function srcObjectWorks() {
    if (!OPAQUE || !MSClass) return Promise.resolve(false);
    if (objProbe) return objProbe;
    objProbe = new Promise((resolve) => {
      let v = null, done = false;
      const finish = (ok) => {
        if (done) return;
        done = true;
        try { if (v) v.srcObject = null; } catch {}
        resolve(ok);
      };
      try {
        if (!("srcObject" in HTMLMediaElement.prototype)) { finish(false); return; }
        v = document.createElement("video");
        v.muted = true;
        try { v.disableRemotePlayback = true; } catch {}
        const probe = new MSClass();
        probe.addEventListener("sourceopen", () => finish(true), { once: true });
        v.srcObject = probe;              // throws where srcObject only takes a MediaStream
        setTimeout(() => finish(false), 2000);
      } catch (e) { finish(false); }
    });
    objProbe.then(ok => log(`file:// page - MediaSource as srcObject ${ok ? "works" : "doesn't open"}`));
    return objProbe;
  }

  function cfg() {
    try {
      const raw = JSON.parse(localStorage.getItem(CFG_KEY) || "{}") || {};
      return { ...DEFAULTS, ...raw };
    } catch { return { ...DEFAULTS }; }
  }
  function saveCfg(c) {
    try { localStorage.setItem(CFG_KEY, JSON.stringify(c)); } catch {}
  }

  function log(...a) { console.log("[twoway]", ...a); }

  // ------------------------------------------------------------------ codecs
  function findBox(u8, fourcc) {
    const a = fourcc.charCodeAt(0), b = fourcc.charCodeAt(1), c = fourcc.charCodeAt(2), d = fourcc.charCodeAt(3);
    for (let i = 4; i < u8.length - 4; i++) {
      if (u8[i] === a && u8[i + 1] === b && u8[i + 2] === c && u8[i + 3] === d) return i + 4; // payload start
    }
    return -1;
  }
  const hex2 = n => n.toString(16).padStart(2, "0");

  /** Codec string read from the header piece. */
  function codecsFromInit(buf) {
    const u8 = new Uint8Array(buf);
    const out = [];
    let p = findBox(u8, "avcC");
    if (p > 0) out.push("avc1." + hex2(u8[p + 1]) + hex2(u8[p + 2]) + hex2(u8[p + 3]));
    else if ((p = findBox(u8, "hvcC")) > 0) {
      const b1 = u8[p + 1];
      const space = ["", "A", "B", "C"][b1 >> 6], tier = (b1 >> 5) & 1 ? "H" : "L", idc = b1 & 31;
      let flags = ((u8[p + 2] << 24) | (u8[p + 3] << 16) | (u8[p + 4] << 8) | u8[p + 5]) >>> 0, rev = 0;
      for (let k = 0; k < 32; k++) { rev = (rev << 1) | (flags & 1); flags >>>= 1; }
      const cons = [];
      for (let k = 0; k < 6; k++) cons.push(u8[p + 6 + k]);
      while (cons.length && cons[cons.length - 1] === 0) cons.pop();
      const tag = findBox(u8, "hev1") > 0 && findBox(u8, "hvc1") < 0 ? "hev1" : "hvc1";
      out.push(`${tag}.${space}${idc}.${(rev >>> 0).toString(16)}.${tier}${u8[p + 12]}` +
               cons.map(x => "." + x.toString(16).toUpperCase()).join(""));
    }
    else if ((p = findBox(u8, "vpcC")) > 0) {
      const d2 = n => String(n).padStart(2, "0");
      out.push(`vp09.${d2(u8[p + 4])}.${d2(u8[p + 5])}.${d2(u8[p + 6] >> 4)}`);
    }
    if (findBox(u8, "mp4a") > 0) out.push(aacCodec(u8) || "mp4a.40.2");
    else if (findBox(u8, "dOps") > 0) out.push("opus");
    else if (findBox(u8, "ec-3") > 0) out.push("ec-3");
    else if (findBox(u8, "ac-3") > 0) out.push("ac-3");
    return out.join(",");
  }

  /** mp4a.40.<profile> from the esds box (HE-AAC is .5, plain AAC .2), or mp4a.6B for MP3. */
  function aacCodec(u8) {
    const p = findBox(u8, "esds");
    if (p < 0) return null;
    let q = p + 4;
    const len = () => { let n = 0; for (let k = 0; k < 4; k++) { const b = u8[q++]; n = (n << 7) | (b & 0x7f); if (!(b & 0x80)) break; } return n; };
    try {
      if (u8[q++] !== 0x03) return null;
      len(); q += 2;
      const fl = u8[q++];
      if (fl & 0x80) q += 2;
      if (fl & 0x40) q += 1 + u8[q];
      if (fl & 0x20) q += 2;
      if (u8[q++] !== 0x04) return null;
      len();
      const oti = u8[q];
      q += 13;
      if (oti !== 0x40) return "mp4a." + oti.toString(16).toUpperCase();
      if (u8[q++] !== 0x05) return "mp4a.40.2";
      len();
      let aot = u8[q] >> 3;
      if (aot === 31) aot = 32 + (((u8[q] & 7) << 3) | (u8[q + 1] >> 5));
      return "mp4a.40." + aot;
    } catch { return null; }
  }

  function pickMime(initBuf) {
    const cands = [];
    const fromInit = codecsFromInit(initBuf);
    if (fromInit) cands.push(`video/mp4; codecs="${fromInit}"`);
    const video = (fromInit || "").split(",")[0] || "";
    if (/^(hvc1|hev1)/.test(video)) cands.push('video/mp4; codecs="hvc1.1.6.L120.90,mp4a.40.2"');
    cands.push("video/mp4");
    for (const c of cands) {
      try { if (MSClass.isTypeSupported(c)) return c; } catch {}
    }
    log("no supported type among", cands);
    return null;
  }

  // ----------------------------------------------------------------- session
  let session = null;       // the one loader, while a video plays two-way
  let budgetCap = BUDGET_START;   // learned down this page load (see BUDGET_START)
  let prepSeq = 0;          // a newer prepare() makes an older one give up
  let lastNote = "";        // why the last play did or didn't go two-way

  class Session {
    constructor(o) {
      Object.assign(this, o);        // video, base, kind, pl, initBuf, load, mime, mms, url, cfg
      this.mediaUrl = this.base;
      this.inflight = new Map();     // seg index -> AbortController
      this.queued = new Set();       // fetched, waiting to append
      this.ops = [];                 // { append: ArrayBuffer, seg } | { remove: [s, e] }
      this.current = null;
      this.sb = null;
      this.media = null;
      this.dead = false;
      this.timers = new Set();
      this.lastSeekAt = 0;
      this.lastOwnRemoveAt = 0;
      this.lastSchedule = 0;
      this.refreshing = null;
      this.n = { fetched: 0, bytes: 0, retries: 0, uaEvicted: 0, evicted: 0, refreshes: 0, aborted: 0, shrinks: 0 };
      this.budget = budgetCap;       // bytes the window may hold
      this.held = new Set();         // pieces appended and not removed by us - to notice ones the player drops
      this.lastShrink = 0;
      this.streaming = null;
      this.onOpen = this.onOpen.bind(this);
      this.mms.addEventListener("sourceopen", this.onOpen, { once: true });
      // Detached - the player moved on to another video, or was reset. (Not
      // 'emptied' on the element: Plyr's own double load fires that at start.)
      this.mms.addEventListener("sourceclose", () => {
        if (session === this) { log("MediaSource closed - stopping"); stop(); }
      });
      if (MANAGED) {
        this.mms.addEventListener("startstreaming", () => { this.streaming = true; log("startstreaming"); this.schedule(); });
        this.mms.addEventListener("endstreaming", () => { this.streaming = false; log("endstreaming"); });
      }
    }

    attach(media) {
      this.media = media;
      try { media.disableRemotePlayback = true; } catch {}
      // file:// page: onto the element directly, in the same turn as the
      // source swap, so resource selection takes it over the <source>s.
      if (this.useObj) {
        try { media.srcObject = this.mms; }
        catch (e) { this.later(() => this.fail("srcObject: " + e.message), 0); }
      }
      this.h = {
        seeking: () => this.onSeeking(),
        timeupdate: () => { if (performance.now() - this.lastSchedule > 1000) this.schedule(); },
        // A fragment the decoder rejects: carry on from the plain URL.
        error: () => {
          if (this.useObj ? media.srcObject !== this.mms : media.currentSrc !== this.url) return;
          const e = media.error;
          this.fail(`media error ${e ? e.code : "?"} ${(e && e.message) || ""}`.trim());
        },
      };
      for (const [ev, fn] of Object.entries(this.h)) media.addEventListener(ev, fn);
      this.later(() => {
        if (this.sb || this.dead) return;
        // The element may already have moved on to the plain <source> after
        // this one - then it is playing fine and just needs leaving alone.
        if (!this.useObj && media.currentSrc && media.currentSrc !== this.url) {
          lastNote = "MediaSource refused - playing the plain copy";
          log(lastNote);
          stop();
        } else {
          this.fail("MediaSource never opened");
        }
      }, OPEN_TIMEOUT);
    }

    later(fn, ms) {
      const id = setTimeout(() => { this.timers.delete(id); if (!this.dead) fn(); }, ms);
      this.timers.add(id);
      return id;
    }

    onOpen() {
      if (this.dead) return;
      try {
        this.mms.duration = this.pl.total;
        this.sb = this.mms.addSourceBuffer(this.mime);
      } catch (e) { this.fail("addSourceBuffer: " + e.message); return; }
      this.sb.addEventListener("updateend", () => this.onUpdateEnd());
      // The decoder rejected a fragment. The SourceBuffer is finished after
      // this, so carry on from the plain URL rather than refetch it forever.
      this.sb.addEventListener("error", () => {
        const seg = this.current && this.current.seg;
        this.fail(seg == null ? "init segment rejected" : `fragment ${seg} rejected`);
      });
      if (MANAGED) {
        this.sb.addEventListener("bufferedchange", (e) => {
          const rr = e && e.removedRanges;
          if (rr && rr.length) {
            const spans = [];
            for (let k = 0; k < rr.length; k++) spans.push(`${rr.start(k).toFixed(1)}-${rr.end(k).toFixed(1)}`);
            log("buffered ranges removed", spans.join(" "));
            this.schedule();          // checkDrops tells ours from iOS's
          }
        });
      }
      log(`open · ${MANAGED ? "ManagedMediaSource" : "MediaSource"} · ${this.mime} · ${this.pl.segs.length} fragments`);
      this.ops.push({ append: this.initBuf, seg: null });
      this.pump();
      this.schedule();
    }

    // --- buffer bookkeeping
    segAt(t) {
      const s = this.pl.segs;
      let lo = 0, hi = s.length - 1;
      if (t <= 0) return 0;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (s[mid].start <= t) lo = mid; else hi = mid - 1;
      }
      return lo;
    }
    isBuffered(i) {
      if (!this.sb) return false;
      const s = this.pl.segs[i];
      const mid = s.start + s.dur / 2;
      let b;
      try { b = this.sb.buffered; } catch { return false; }
      for (let k = 0; k < b.length; k++) if (b.start(k) <= mid && mid <= b.end(k)) return true;
      return false;
    }
    have(i) { return this.inflight.has(i) || this.queued.has(i) || this.isBuffered(i); }
    /**
     * The pieces to hold around time t, in the order to fetch them: the one
     * under the playhead, then outwards, two ahead for each one behind. Stops
     * at the seconds behind/ahead from Settings or when the bytes reach the
     * budget, whichever comes first - so a 4K file gets a shorter window than
     * a 720p one instead of overflowing the player.
     */
    windowFor(t) {
      const c = this.cfg, s = this.pl.segs, n = s.length;
      const i0 = this.segAt(t);
      const tLo = t - c.behind, tHi = t + c.ahead;
      const order = [i0];
      let bytes = s[i0].len, f = i0 + 1, b = i0 - 1, fOk = true, bOk = true;
      const take = i => { if (bytes + s[i].len > this.budget) return false; bytes += s[i].len; order.push(i); return true; };
      while (fOk || bOk) {
        for (let k = 0; k < 2 && fOk; k++) { if (f < n && s[f].start < tHi && take(f)) f++; else fOk = false; }
        if (bOk) { if (b >= 0 && s[b].start + s[b].dur > tLo && take(b)) b--; else bOk = false; }
      }
      return { lo: b + 1, hi: f - 1, order, bytes };
    }

    bufferedBytes() {
      let bytes = 0;
      for (const s of this.pl.segs) if (this.isBuffered(s.i)) bytes += s.len;
      return bytes;
    }

    /** The player ran out of room: hold less from now on (this page load). */
    shrink(why) {
      const now = performance.now();
      if (now - this.lastShrink < 1500) return;          // one wave of drops, one shrink
      this.lastShrink = now;
      const held = this.bufferedBytes();
      const next = Math.max(BUDGET_MIN, Math.min(this.budget * 0.8, held > 0 ? held * 0.9 : this.budget * 0.8));
      if (next >= this.budget) return;
      this.budget = next;
      budgetCap = Math.min(budgetCap, next);
      this.n.shrinks++;
      log(`${why} - window now ${(next / MB).toFixed(0)} MB`);
    }

    /** Pieces we appended and never removed that aren't there any more: the player (Chrome's cleanup, iOS memory pressure) dropped them. */
    checkDrops() {
      const gone = [];
      for (const i of this.held) if (!this.isBuffered(i) && !this.queued.has(i)) gone.push(i);
      if (!gone.length) return;
      for (const i of gone) this.held.delete(i);
      this.n.uaEvicted += gone.length;
      this.shrink(`the player dropped ${gone.length} piece${gone.length > 1 ? "s" : ""}`);
    }

    // --- SourceBuffer op queue: one append/remove at a time
    pump() {
      if (this.dead || !this.sb || this.sb.updating || this.current) return;
      const op = this.ops.shift();
      if (!op) { this.maybeEnd(); return; }
      this.current = op;
      try {
        if (op.remove) {
          this.lastOwnRemoveAt = performance.now();
          this.sb.remove(op.remove[0], op.remove[1]);
        } else {
          if (this.mms.readyState === "closed") { this.current = null; return; }
          this.sb.appendBuffer(op.append);
        }
      } catch (e) {
        this.current = null;
        if (e.name === "QuotaExceededError" && op.append) {
          this.shrink("the player is full");
          const { lo, hi } = this.windowFor(this.media ? this.media.currentTime : 0);
          if (op.seg != null && (op.seg < lo || op.seg > hi)) this.queued.delete(op.seg);   // outside the smaller window now
          else this.ops.unshift(op);
          this.evict(true);                            // removals go in FRONT of the retry
          this.later(() => this.pump(), 0);            // not straight away: no recursion
        } else {
          this.fail(`${op.remove ? "remove" : "append"}: ${e.name} ${e.message}`);
        }
      }
    }
    onUpdateEnd() {
      const op = this.current;
      this.current = null;
      // The green on the progress bar follows each piece in or out - including
      // while paused, when there's no timeupdate to redraw it (native 15.28).
      if (typeof window.updateBufferedProgress === "function") {
        try { window.updateBufferedProgress(); } catch {}
      }
      if (op && op.seg != null) {
        this.queued.delete(op.seg);
        if (!this.isBuffered(op.seg)) {
          this.misses = (this.misses || 0) + 1;
          // Nothing sticking at all means the pieces are bad; pieces vanishing
          // while others stay means the player is out of room.
          if (this.misses >= 3 && this.bufferedBytes() < 2 * op.append.byteLength) {
            this.fail(`fragment ${op.seg} appended but never showed up`); return;
          }
          this.shrink("a piece was dropped as it went in");
        } else { this.misses = 0; this.held.add(op.seg); }
      }
      this.pump();
      if (op && op.seg != null) this.schedule();
    }
    maybeEnd() {
      if (this.mms.readyState !== "open" || this.inflight.size || this.queued.size) return;
      const last = this.pl.segs.length - 1;
      const { hi } = this.windowFor(this.media ? this.media.currentTime : 0);
      if (hi === last && this.isBuffered(last)) {
        try { this.mms.endOfStream(); } catch {}
      }
    }

    /** Queue removal of everything outside the window. front: ahead of anything already queued. Doesn't pump. */
    evict(front = false) {
      if (!this.sb || !this.media) return;
      const s = this.pl.segs;
      const { lo, hi } = this.windowFor(this.media.currentTime);
      const keepLo = s[lo].start;
      const keepHi = hi + 1 < s.length ? s[hi + 1].start : Infinity;
      let b;
      try { b = this.sb.buffered; } catch { return; }
      const ops = [];
      for (let k = 0; k < b.length; k++) {
        const bs = b.start(k), be = b.end(k);
        if (bs < keepLo - 0.05) ops.push({ remove: [bs, Math.min(be, keepLo)] });
        if (be > keepHi + 0.05) ops.push({ remove: [Math.max(bs, keepHi), be] });
      }
      if (!ops.length) return;
      for (const i of [...this.held]) if (i < lo || i > hi) this.held.delete(i);
      this.n.evicted += ops.length;
      if (front) this.ops.unshift(...ops); else this.ops.push(...ops);
    }

    // --- what to load next
    schedule() {
      if (this.dead || !this.sb || !this.media) return;
      this.lastSchedule = performance.now();
      const t = this.media.currentTime;
      this.checkDrops();
      if (!this.ops.some(o => o.remove)) { this.evict(); this.pump(); }
      const { order } = this.windowFor(t);      // 2 ahead : 1 behind, outwards from the playhead
      for (const i of order) {
        if (this.inflight.size >= PARALLEL) break;
        if (!this.have(i)) this.fetchSeg(i);
      }
    }

    onSeeking() {
      if (this.dead || !this.media) return;
      const now = performance.now();
      const burst = now - this.lastSeekAt < SETTLE_MS;
      this.lastSeekAt = now;
      const t = this.media.currentTime;
      const { lo, hi } = this.windowFor(t);
      // Drop fetches the seek has left behind.
      for (const [i, ac] of this.inflight) {
        if (i < lo || i > hi) { ac.abort(); this.inflight.delete(i); this.n.aborted++; }
      }
      // A tap or jog loads its fragment at once; a drag waits until it pauses.
      if (!burst) {
        const i = this.segAt(t);
        if (!this.have(i)) {
          if (this.inflight.size >= PARALLEL) {
            const [far, ac] = [...this.inflight].sort((a, z) => Math.abs(z[0] - i) - Math.abs(a[0] - i))[0];
            ac.abort(); this.inflight.delete(far); this.n.aborted++;
          }
          this.fetchSeg(i);
        }
      }
      clearTimeout(this.settleTimer);
      this.settleTimer = this.later(() => this.schedule(), SETTLE_MS);
    }

    /** One range of the file. Re-signs an expired link (and says to retry at once). */
    async read(off, len, signal) {
      const r = await fetch(this.mediaUrl, { headers: { Range: `bytes=${off}-${off + len - 1}` }, signal });
      if (r.status === 403 || r.status === 410) {
        await this.refreshUrl();
        const e = new Error(`HTTP ${r.status}`); e.retryNow = true; throw e;
      }
      if (r.status !== 206 && r.status !== 200) throw new Error(`HTTP ${r.status}`);
      const buf = await r.arrayBuffer();
      if (buf.byteLength !== len) {
        // A 200 with the whole file means Range was ignored - fatal, not retryable.
        if (r.status === 200) { const e = new Error("the gateway ignored Range"); e.fatal = true; throw e; }
        throw new Error(`short read ${buf.byteLength}/${len}`);
      }
      return { buf, total: null };
    }

    async refreshUrl() {
      if (!this.refreshing) {
        this.refreshing = (async () => {
          log("signed URL expired - asking for a new one");
          this.n.refreshes++;
          if (typeof window.scrayHetznerRefresh !== "function") throw new Error("no refresh available");
          const v = await window.scrayHetznerRefresh(this.video);
          if (!v || !v.downloadUrl) throw new Error("refresh gave no URL");
          this.base = v.downloadUrl;
          this.mediaUrl = this.base;
        })().finally(() => { this.refreshing = null; });
      }
      return this.refreshing;
    }

    fetchSeg(i, attempt = 0) {
      const s = this.pl.segs[i];
      const ac = new AbortController();
      this.inflight.set(i, ac);
      const t0 = performance.now();
      this.load(i, (off, len) => this.read(off, len, ac.signal))
        .then((buf) => {
          if (this.dead || this.inflight.get(i) !== ac) return;
          this.inflight.delete(i);
          this.n.fetched++; this.n.bytes += buf.byteLength;
          this.lastFetchMs = performance.now() - t0;
          this.queued.add(i);
          this.ops.push({ append: buf, seg: i });
          this.pump();
        })
        .catch((e) => {
          if (this.inflight.get(i) === ac) this.inflight.delete(i);
          if (this.dead || (e && e.name === "AbortError")) return;
          if (e && e.fatal) { this.fail(e.message); return; }
          if (attempt < MAX_RETRIES) {
            this.n.retries++;
            log(`fragment ${i} failed (${e && e.message}) - retry ${attempt + 1}`);
            this.later(() => { if (!this.have(i)) this.fetchSeg(i, attempt + 1); }, e && e.retryNow ? 0 : 400 * (attempt + 1));
          } else {
            log(`fragment ${i} failed ${MAX_RETRIES + 1} times - leaving it for the next pass`);
            this.schedule();
          }
        });
    }

    /** Something broke mid-play: go back to the plain URL at the same spot. */
    fail(reason) {
      if (this.dead) return;
      log("falling back to the usual path:", reason);
      lastNote = "fell back: " + reason;
      const media = this.media, at = media ? media.currentTime : 0, base = this.base;
      const wasPaused = media ? media.paused : true;
      stop();
      if (!media || !media.isConnected) return;
      try {
        media.addEventListener("loadedmetadata", () => {
          try { if (at > 0) media.currentTime = at; } catch {}
          if (!wasPaused) media.play().catch(() => {});
        }, { once: true });
        while (media.firstChild) media.removeChild(media.firstChild);
        if (media.srcObject) media.srcObject = null;
        media.src = base;
        media.load();
      } catch (e) { log("fallback failed:", e.message); }
    }

    close() {
      this.dead = true;
      for (const [, ac] of this.inflight) { try { ac.abort(); } catch {} }
      this.inflight.clear();
      for (const id of this.timers) clearTimeout(id);
      this.timers.clear();
      if (this.media && this.h) for (const [ev, fn] of Object.entries(this.h)) this.media.removeEventListener(ev, fn);
      if (this.url) { try { URL.revokeObjectURL(this.url); } catch {} }
      // file:// page: let go of the MediaSource. The <source>s go first, or
      // clearing srcObject would start the plain copy loading behind the reset.
      // (fail() sets the plain URL itself straight after.)
      const m = this.media;
      if (this.useObj && m && m.srcObject === this.mms) {
        try {
          while (m.firstChild) m.removeChild(m.firstChild);
          m.removeAttribute("src");
          m.srcObject = null;
        } catch {}
      }
    }

    /** Numbers for the overlay. */
    snapshot() {
      const t = this.media ? this.media.currentTime : 0;
      const bytes = this.bufferedBytes();
      const w = this.windowFor(t), sg = this.pl.segs;
      const behind = Math.max(0, t - sg[w.lo].start), ahead = Math.max(0, sg[w.hi].start + sg[w.hi].dur - t);
      return {
        budget: this.budget / MB,
        mode: `2-way · ${MANAGED ? "MMS" : "MSE"} · ${this.kind}${this.useObj ? " · obj" : ""}${this.rescued ? " · rescue" : ""}`,
        frag: `${(this.pl.total / this.pl.segs.length).toFixed(1)}s × ${this.pl.segs.length}`,
        mb: bytes / 1048576,
        loading: this.inflight.size,
        queued: this.queued.size,
        n: this.n,
        streaming: this.streaming,
        window: `◂ ${behind.toFixed(0)}s ▸ ${ahead.toFixed(0)}s of ${this.cfg.behind}/${this.cfg.ahead}`,
        t,
      };
    }
  }

  // --------------------------------------------------------------- public API
  /**
   * Called by playVideoInline just before it hands Plyr the source. Returns
   * { src, type } for a MediaSource the loader will fill, or null to play the
   * usual way. Never throws.
   */
  async function prepare(video, opts = {}) {
    stop();
    lastNote = "";
    const my = ++prepSeq;
    const stale = () => my !== prepSeq;
    const c = cfg();
    try {
      if (!c.enabled && !opts.force) { lastNote = "off in Settings"; return null; }
      if (!MSClass) { lastNote = "no MediaSource in this WebView"; log(lastNote); return null; }
      const base = video && video.downloadUrl;
      if (!base || !/^https?:/.test(base)) { lastNote = "not a streamed file"; return null; }
      const t0 = performance.now();
      // Cut the original into pieces as it plays (native 15.27) - any mp4/m4v/mov.
      let src = null;
      if (!window.scrayMp4Chunks || !/\.(mp4|m4v|mov)$/i.test(video.filename || "")) {
        lastNote = "not an mp4/mov"; return null;
      }
      try {
        src = await openChunked(video, base);
        describeOnce(video, src.ix);
      }
      catch (e) { lastNote = "can't chunk: " + (e && e.message); log(lastNote, "-", video.filename); return null; }
      const mime = pickMime(src.initBuf);
      if (!mime) { lastNote = "codec not supported here"; return null; }
      const useObj = await srcObjectWorks();
      if (OPAQUE && !useObj) { lastNote = "MediaSource can't attach on a file:// page"; log(lastNote); return null; }
      if (stale()) return null;
      const mms = new MSClass();
      const url = useObj ? "" : URL.createObjectURL(mms);
      session = new Session({ video, base, kind: src.kind, pl: src.pl, initBuf: src.initBuf, load: src.load,
                              mime, mms, url, useObj, cfg: c });
      log(`ready in ${Math.round(performance.now() - t0)} ms · ${src.kind}${useObj ? " · srcObject" : ""} · ${video.filename}`);
      lastNote = "";
      // A Plyr source entry. With srcObject the entry is the plain URL - the
      // element takes the MediaSource over it, and it's the fallback anyway.
      return useObj ? { src: base, type: "video/mp4" } : { src: url, type: "video/mp4" };
    } catch (e) {
      lastNote = "prepare failed: " + (e && e.message);
      log(lastNote);
      stop();
      return null;
    }
  }

  // What each video's pieces are, kept for the last few videos so replaying or
  // coming back to one doesn't read its index again. (An hour's index is a few MB.)
  const INDEX_KEEP = 3;
  const indexCache = new Map();

  async function openChunked(video, base) {
    const C = window.scrayMp4Chunks;
    const key = video.videoKey || video.filename || base;
    let ix = indexCache.get(key);
    if (ix) indexCache.delete(key);
    else {
      const read = async (off, len) => {
        const r = await fetch(base, { headers: { Range: `bytes=${off}-${off + len - 1}` } });
        if (r.status !== 206) throw new Error(`HTTP ${r.status} reading the index`);
        const total = Number(((r.headers.get("Content-Range") || "").split("/")[1]) || NaN);
        if (!(total > 0)) throw new Error("no file size (Content-Range not exposed?)");
        return { buf: await r.arrayBuffer(), total };
      };
      ix = await C.open(read);
    }
    indexCache.set(key, ix);
    while (indexCache.size > INDEX_KEEP) indexCache.delete(indexCache.keys().next().value);
    return {
      kind: "chunked",
      ix,
      pl: { segs: ix.segs, total: ix.total },
      initBuf: C.initSegment(ix),
      load: async (i, read) => {
        const rs = C.rangesFor(ix, i);
        const parts = await Promise.all(rs.map(r => read(r.off, r.len)));
        return C.buildSegment(ix, i, rs.map((r, j) => ({ off: r.off, u8: new Uint8Array(parts[j].buf) })));
      },
    };
  }

  /** Called straight after the Plyr source swap, with the new <video>. */
  function attach(media) {
    if (session && media) session.attach(media);
  }

  function stop() {
    if (!session) return;
    const s = session;
    session = null;
    s.close();
  }

  // How each file is put together, logged once per file per page load (native
  // 15.34 / picker 15.25) - a report then says why the plain player might
  // refuse it: where the index sits, every track, edit lists, how far apart
  // video and audio are stored.
  const described = new Set();
  function describeOnce(video, ix) {
    try {
      const k = (video && (video.videoKey || video.filename)) || "";
      if (!ix || described.has(k) || !window.scrayMp4Chunks.describe) return;
      described.add(k);
      log(`file ${video.filename}: ${window.scrayMp4Chunks.describe(ix)}`);
    } catch (e) { /* diagnostics only */ }
  }

  // ------------------------------------------------------------------ rescue
  // native 15.34 / picker 15.25. Two-way off, and the phone's own player
  // refuses a Hetzner mp4/m4v/mov (TAP_Zazie_Skymm.mp4): the file still plays,
  // through the chunked loader, which hands the player only clean pieces of
  // the first video and audio track. Only on that refusal - every file the
  // plain player takes plays exactly as before. Not when two-way already ran
  // for this play: it has tried chunking, and fell back for a reason.
  //
  // The refusal shows up as an 'error' on the <source> (it doesn't bubble,
  // hence the capture listener) - or on the element itself when the plain
  // URL was set as src, as fail() does.
  let rescue = null;   // { media, video, h, done }
  function rescueWatch(media, video) {
    rescueUnwatch();
    if (!media || !video || video.source !== "hetzner") return;
    const base = video.downloadUrl;
    if (!base || !/^https?:/.test(base) || !/\.(mp4|m4v|mov)$/i.test(video.filename || "")) return;
    if (session && session.media === media) return;        // two-way is on it
    const noQ = (u) => String(u || "").split("?")[0];
    const r = { media, video, done: false };
    r.h = (e) => {
      if (r.done || rescue !== r) return;
      if (session) return;
      const t = e && e.target;
      const isSource = !!(t && t.tagName === "SOURCE");
      const failed = isSource ? t.src : media.currentSrc || media.getAttribute("src");
      if (noQ(failed) !== noQ(base)) return;
      if (isSource && t.nextElementSibling) return;        // another <source> still to try
      r.done = true;
      doRescue(r).catch(err => log("rescue failed:", err && err.message));
    };
    media.addEventListener("error", r.h, true);
    rescue = r;
  }
  function rescueUnwatch() {
    if (rescue && rescue.media) rescue.media.removeEventListener("error", rescue.h, true);
    rescue = null;
  }
  async function doRescue(r) {
    const { media, video } = r;
    const e = media.error;
    log(`the plain player refused ${video.filename}${e ? ` (media error ${e.code})` : ""} - playing it chunked`);
    const src = await prepare(video, { force: true });
    if (!src || !session || rescue !== r || !media.isConnected) {
      if (rescue === r) log("can't play it chunked either" + (lastNote ? ": " + lastNote : ""));
      return;
    }
    const s = session;
    s.rescued = true;
    while (media.firstChild) media.removeChild(media.firstChild);
    if (s.useObj) media.removeAttribute("src");
    else media.src = s.url;
    s.attach(media);                // srcObject on a file:// page, in this same turn
    // The play() the player was waiting on ends with the reload; start again.
    media.play().catch(() => {});
  }

  // ------------------------------------------------------------------ overlay
  // Works on either path, so the same file can be compared with the setting
  // on and off: seek-to-ready times, what is loaded behind and ahead.
  const stats = { el: null, bar: null, media: null, timer: null, seekT0: 0, last: null, times: [], waits: 0 };

  function statsWatch(media, video) {
    statsUnwatch();
    if (!infoOn() || !media) return;
    stats.media = media;
    stats.times = []; stats.last = null; stats.waits = 0; stats.seekT0 = 0;
    stats.video = video;
    stats.h = {
      seeking: () => { stats.seekT0 = performance.now(); },
      seeked: () => {
        if (!stats.seekT0) return;
        stats.last = Math.round(performance.now() - stats.seekT0);
        stats.times.push(stats.last);
        if (stats.times.length > 20) stats.times.shift();
        stats.seekT0 = 0;
      },
      waiting: () => { stats.waits++; },
    };
    for (const [ev, fn] of Object.entries(stats.h)) media.addEventListener(ev, fn);
    stats.timer = setInterval(paint, STATS_EVERY);
    paint();
  }

  function statsUnwatch() {
    if (stats.timer) clearInterval(stats.timer);
    stats.timer = null;
    if (stats.media && stats.h) for (const [ev, fn] of Object.entries(stats.h)) stats.media.removeEventListener(ev, fn);
    stats.media = null;
    if (stats.el) stats.el.style.display = "none";
  }

  function ensureEl() {
    const host = (window.plyrPlayer && window.plyrPlayer.elements && window.plyrPlayer.elements.container)
      || document.getElementById("inlineVideoContainer");
    if (!host) return null;
    if (!stats.el) {
      stats.el = document.createElement("div");
      stats.el.id = "scrayTwoWayStats";
      stats.el.style.cssText = "position:absolute;top:6px;left:6px;z-index:40;pointer-events:none;"
        + "font:10px/1.35 ui-monospace,Menlo,monospace;color:#e8e8e8;background:rgba(0,0,0,.6);"
        + "padding:5px 7px;border-radius:5px;width:190px;white-space:pre;";
      stats.txt = document.createElement("div");
      stats.bar = document.createElement("div");
      stats.bar.style.cssText = "position:relative;height:6px;margin-top:4px;background:#333;border-radius:2px;overflow:hidden;";
      stats.el.append(stats.txt, stats.bar);
    }
    if (stats.el.parentNode !== host) host.appendChild(stats.el);
    if (getComputedStyle(host).position === "static") host.style.position = "relative";
    stats.el.style.display = "";
    return stats.el;
  }

  function paint() {
    const m = stats.media;
    if (!m || !m.isConnected) { statsUnwatch(); return; }
    if (!ensureEl()) return;
    const t = m.currentTime || 0, d = m.duration;
    const dur = isFinite(d) && d > 0 ? d : (session ? session.pl.total : 0);
    let behind = 0, ahead = 0;
    const b = m.buffered;
    for (let k = 0; k < b.length; k++) {
      if (b.start(k) <= t + 0.25 && t <= b.end(k) + 0.25) { behind = t - b.start(k); ahead = b.end(k) - t; }
    }
    const avg = stats.times.length ? Math.round(stats.times.reduce((a, x) => a + x, 0) / stats.times.length) : null;
    const lines = [];
    const snap = session && session.media === m ? session.snapshot() : null;
    if (snap) {
      lines.push(`${snap.mode} · ${snap.frag}`);
      lines.push(`window ${snap.window} · ${snap.mb.toFixed(0)}/${snap.budget.toFixed(0)} MB`);
      lines.push(`loading ${snap.loading} · queued ${snap.queued} · done ${snap.n.fetched}`);
      lines.push(`retry ${snap.n.retries} · cut ${snap.n.aborted} · evict ${snap.n.evicted} · dropped ${snap.n.uaEvicted}` +
                 (snap.streaming === null ? "" : snap.streaming ? " · ▶" : " · ⏸"));
    } else {
      lines.push(`progressive${lastNote ? " · " + lastNote : ""}`);
    }
    lines.push(`here: ◂ ${behind.toFixed(0)}s  ${ahead.toFixed(0)}s ▸ · stalls ${stats.waits}`);
    lines.push(`seek→ready ${stats.last == null ? "–" : stats.last + " ms"}${avg == null ? "" : ` · avg ${avg} ms (${stats.times.length})`}`);
    stats.txt.textContent = lines.join("\n");

    // Loaded ranges across the whole video, with the playhead.
    const bar = stats.bar;
    while (bar.firstChild) bar.removeChild(bar.firstChild);
    if (dur > 0) {
      for (let k = 0; k < b.length; k++) {
        const r = document.createElement("div");
        const l = Math.max(0, b.start(k) / dur), w = Math.max(0.002, (b.end(k) - b.start(k)) / dur);
        r.style.cssText = `position:absolute;top:0;bottom:0;left:${(l * 100).toFixed(2)}%;width:${(w * 100).toFixed(2)}%;background:#4caf50;`;
        bar.appendChild(r);
      }
      const ph = document.createElement("div");
      ph.style.cssText = `position:absolute;top:-1px;bottom:-1px;width:2px;left:${(t / dur * 100).toFixed(2)}%;background:#fff;`;
      bar.appendChild(ph);
    }
  }

  // ----------------------------------------------------------------- settings
  document.addEventListener("DOMContentLoaded", () => {
    if (!window.scraySettings || typeof window.scraySettings.register !== "function") return;
    window.scraySettings.register({
      id: "twoWayBuffer",
      label: "Two-way buffer",
      type: "custom",
      hint: "Hetzner mp4/m4v/mov videos load behind the playhead as well as ahead, "
          + "so jogging back doesn't wait. Other videos play as usual. \u24d8 buffer i in the player's ... menu shows what "
          + "is loaded and how long each seek takes.",
      get: () => cfg(),
      build: () => {
        const c = cfg();
        const wrap = document.createElement("div");
        wrap.style.cssText = "display:flex;flex-direction:column;gap:8px;margin-top:6px;padding:10px;border:1px solid #3a3a3a;border-radius:6px;";
        const rowCss = "display:flex;align-items:center;gap:8px;margin:0;font-size:0.85rem;font-weight:normal;";
        const inputCss = "width:5rem;margin:0;padding:6px;background:#2a2a2a;color:#fff;border:1px solid #555;border-radius:4px;font-size:0.85rem;";
        const check = (text, on) => {
          const l = document.createElement("label"); l.style.cssText = rowCss;
          const i = document.createElement("input"); i.type = "checkbox"; i.checked = !!on;
          i.style.cssText = "width:auto;margin:0;";
          l.append(i, document.createTextNode(text)); wrap.appendChild(l); return i;
        };
        const num = (text, val) => {
          const l = document.createElement("label"); l.style.cssText = rowCss;
          const i = document.createElement("input"); i.type = "number"; i.min = "5"; i.max = "600"; i.step = "5";
          i.inputMode = "numeric"; i.value = String(val); i.style.cssText = inputCss;
          l.append(i, document.createTextNode(text)); wrap.appendChild(l); return i;
        };
        const en = check("Use it for Hetzner videos", c.enabled);
        const be = num("seconds kept behind the playhead", c.behind);
        const ah = num("seconds loaded ahead", c.ahead);
        const clamp = (v, d) => { const n = Math.round(Number(v)); return isFinite(n) && n >= 5 ? Math.min(600, n) : d; };
        return {
          el: wrap,
          value: () => ({ enabled: en.checked, behind: clamp(be.value, DEFAULTS.behind),
                          ahead: clamp(ah.value, DEFAULTS.ahead) }),
          focus: () => {},
        };
      },
      set: (value) => {
        saveCfg({ ...cfg(), ...(value || {}) });
        if (session) session.cfg = cfg();
      },
    });
  });

  /** "buffer i" in the ... menu: show or hide the box on whatever is playing. */
  function toggleInfo() {
    setInfoOn(!infoOn());
    const media = window.plyrPlayer && window.plyrPlayer.media;
    if (infoOn() && media) statsWatch(media, window.currentPlayingVideo || null);
    else statsUnwatch();
    log(`buffer i ${infoOn() ? "on" : "off"}`);
  }

  window.scrayTwoWay = {
    prepare, attach, stop, cfg,
    watch: (media, video) => { rescueWatch(media, video); statsWatch(media, video); },
    unwatch: () => { rescueUnwatch(); statsUnwatch(); },
    toggleInfo,
    get infoOn() { return infoOn(); },
    get originalUrl() { return session ? session.base : null; },
    get active() { return !!session; },
    get note() { return lastNote; },
    _test: { codecsFromInit },
  };
})();

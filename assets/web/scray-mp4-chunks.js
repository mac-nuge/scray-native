console.log("scray-mp4-chunks.js loaded");

// =========================================
// MP4 CHUNKS - two-way buffer without packaging (native 15.27)
//
// Cuts an ordinary MP4/MOV into ~2 s fragmented-MP4 pieces in the page, as it
// plays, so the two-way loader (scray-twoway.js) can feed Media Source
// Extensions straight from the original file on the box. Nothing is
// re-encoded and nothing is stored: each piece is the file's own compressed
// frames, re-wrapped.
//
//   open(read)          finds the index ('moov') with a few range reads, reads
//                       the sample tables, and plans pieces that each start on
//                       a keyframe. read(off, len) -> { buf, total }.
//   initSegment(ix)     the header MSE needs first: ftyp + a moov whose tables
//                       are empty (the original track headers, codec setup and
//                       rotation matrix copied verbatim) + mvex/trex.
//   rangesFor(ix, k)    the byte ranges of the file piece k's frames live in -
//                       usually one, since video and audio are interleaved.
//   buildSegment(ix, k, parts)  moof + mdat for piece k from those bytes.
//
// First video track and first audio track only (what ffmpeg -map 0:v:0
// -map 0:a:0 would take). The video track's edit list (the usual B-frame
// delay) is applied through signed composition offsets, so pictures start at
// 0 as they do in the plain player. Refuses, so the plain path plays instead:
// no video track, compressed or already-fragmented files, stz2 tables.
// =========================================

(function (root) {
  const TARGET = 2.0;            // seconds per piece; pieces start on keyframes, so often a little longer
  let GAP = 64 * 1024;           // byte ranges closer than this are fetched as one

  // ------------------------------------------------------------ reading boxes
  const u64 = (dv, o) => dv.getUint32(o) * 4294967296 + dv.getUint32(o + 4);
  const fourcc = (dv, o) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));

  function kids(dv, start, end) {
    const out = [];
    let p = start;
    while (p + 8 <= end) {
      let size = dv.getUint32(p), hdr = 8;
      const type = fourcc(dv, p + 4);
      if (size === 1) { size = u64(dv, p + 8); hdr = 16; }
      else if (size === 0) size = end - p;
      if (size < hdr || p + size > end) break;
      out.push({ type, start: p, end: p + size, body: p + hdr });
      p += size;
    }
    return out;
  }
  const one = (list, type) => list.find(b => b.type === type) || null;
  const inside = (dv, box, skip = 0) => kids(dv, box.body + skip, box.end);

  // -------------------------------------------------------- finding the index
  async function locateMoov(read) {
    const first = await read(0, 65536);
    const total = first.total;
    if (!(total > 0)) throw new Error("file size unknown");
    const head = new Uint8Array(first.buf);
    let pos = 0;
    for (let n = 0; n < 64 && pos + 8 <= total; n++) {
      let hb;
      if (pos + 16 <= head.byteLength) hb = head.subarray(pos, pos + 16);
      else hb = new Uint8Array((await read(pos, 16)).buf);
      if (hb.byteLength < 8) break;
      const dv = new DataView(hb.buffer, hb.byteOffset, hb.byteLength);
      let size = dv.getUint32(0);
      const type = fourcc(dv, 4);
      if (size === 1) {
        if (hb.byteLength < 16) break;
        size = u64(dv, 8);
      } else if (size === 0) size = total - pos;
      if (size < 8) throw new Error(`bad box at ${pos}`);
      if (type === "moov") {
        if (size > 64 * 1024 * 1024) throw new Error("index too large");
        const bytes = pos + size <= head.byteLength
          ? head.slice(pos, pos + size)
          : new Uint8Array((await read(pos, size)).buf);
        if (bytes.byteLength !== size) throw new Error("index cut short");
        return { moov: bytes, total };
      }
      if (type === "moof") throw new Error("already fragmented");
      pos += size;
    }
    throw new Error("no index (moov) found");
  }

  // ------------------------------------------------------------- the tables
  function readTrack(dv, trak) {
    const t = {};
    const tk = inside(dv, trak);
    const tkhd = one(tk, "tkhd"), mdia = one(tk, "mdia");
    if (!tkhd || !mdia) return null;
    t.tkhd = tkhd;
    t.id = dv.getUint8(tkhd.body) === 1 ? dv.getUint32(tkhd.body + 20) : dv.getUint32(tkhd.body + 12);
    const md = inside(dv, mdia);
    const mdhd = one(md, "mdhd"), hdlr = one(md, "hdlr"), minf = one(md, "minf");
    if (!mdhd || !hdlr || !minf) return null;
    t.mdhd = mdhd; t.hdlr = hdlr; t.minf = minf;
    t.timescale = dv.getUint8(mdhd.body) === 1 ? dv.getUint32(mdhd.body + 20) : dv.getUint32(mdhd.body + 12);
    t.handler = fourcc(dv, hdlr.body + 8);
    const mi = inside(dv, minf);
    t.mhd = mi.find(b => /^(vmhd|smhd|nmhd|sthd)$/.test(b.type)) || null;
    t.dinf = one(mi, "dinf");
    const stbl = one(mi, "stbl");
    if (!stbl) return null;
    const st = inside(dv, stbl);
    t.stsd = one(st, "stsd");
    if (!t.stsd) return null;
    t.entry = fourcc(dv, t.stsd.body + 12);          // avc1, hvc1, mp4a, ...
    if (/^(encv|enca)$/.test(t.entry)) throw new Error("encrypted");
    if (one(st, "stz2")) throw new Error("compact sample sizes (stz2)");

    // sizes
    const stsz = one(st, "stsz");
    if (!stsz) return null;
    const fixed = dv.getUint32(stsz.body + 4), n = dv.getUint32(stsz.body + 8);
    const size = new Uint32Array(n);
    for (let i = 0; i < n; i++) size[i] = fixed || dv.getUint32(stsz.body + 12 + 4 * i);
    t.n = n; t.size = size;

    // decode times
    const dts = new Float64Array(n), dur = new Uint32Array(n);
    const stts = one(st, "stts");
    let s = 0, clock = 0;
    if (stts) {
      const ec = dv.getUint32(stts.body + 4);
      for (let e = 0; e < ec && s < n; e++) {
        const count = dv.getUint32(stts.body + 8 + 8 * e), delta = dv.getUint32(stts.body + 12 + 8 * e);
        for (let k = 0; k < count && s < n; k++, s++) { dts[s] = clock; dur[s] = delta; clock += delta; }
      }
    }
    for (; s < n; s++) { dts[s] = clock; dur[s] = s ? dur[s - 1] : 0; clock += dur[s]; }
    t.dts = dts; t.dur = dur; t.end = clock;

    // composition offsets
    const cts = new Int32Array(n);
    const ctts = one(st, "ctts");
    if (ctts) {
      const signed = dv.getUint8(ctts.body) === 1;
      const ec = dv.getUint32(ctts.body + 4);
      s = 0;
      for (let e = 0; e < ec && s < n; e++) {
        const count = dv.getUint32(ctts.body + 8 + 8 * e);
        const off = signed ? dv.getInt32(ctts.body + 12 + 8 * e) : dv.getUint32(ctts.body + 12 + 8 * e);
        for (let k = 0; k < count && s < n; k++, s++) cts[s] = off;
      }
    }
    t.cts = cts;

    // file offsets
    const stco = one(st, "stco"), co64 = one(st, "co64"), stsc = one(st, "stsc");
    if ((!stco && !co64) || !stsc) return null;
    const cbox = stco || co64, nch = dv.getUint32(cbox.body + 4);
    const chunk = new Float64Array(nch);
    for (let c = 0; c < nch; c++) chunk[c] = co64 ? u64(dv, cbox.body + 8 + 8 * c) : dv.getUint32(cbox.body + 8 + 4 * c);
    const sc = [];
    const scn = dv.getUint32(stsc.body + 4);
    for (let e = 0; e < scn; e++) sc.push([dv.getUint32(stsc.body + 8 + 12 * e), dv.getUint32(stsc.body + 12 + 12 * e)]);
    const off = new Float64Array(n);
    s = 0;
    for (let e = 0; e < sc.length && s < n; e++) {
      const firstChunk = sc[e][0], per = sc[e][1];
      const lastChunk = e + 1 < sc.length ? sc[e + 1][0] - 1 : nch;
      for (let c = firstChunk; c <= lastChunk && s < n; c++) {
        let o = chunk[c - 1];
        for (let k = 0; k < per && s < n; k++, s++) { off[s] = o; o += size[s]; }
      }
    }
    if (s < n) throw new Error("sample table ran out of chunks");
    t.off = off;

    // keyframes
    const sync = new Uint8Array(n);
    const stss = one(st, "stss");
    if (stss) {
      const ec = dv.getUint32(stss.body + 4);
      for (let e = 0; e < ec; e++) { const k = dv.getUint32(stss.body + 8 + 4 * e) - 1; if (k >= 0 && k < n) sync[k] = 1; }
    } else sync.fill(1);
    t.sync = sync;

    // edit list: where the picture starts (the usual B-frame delay)
    t.shift = 0;
    const edts = one(tk, "edts");
    const elst = edts && one(inside(dv, edts), "elst");
    if (elst) {
      const v1 = dv.getUint8(elst.body) === 1, ec = dv.getUint32(elst.body + 4);
      let p = elst.body + 8;
      for (let e = 0; e < ec; e++) {
        const mt = v1 ? dv.getInt32(p + 8) * 4294967296 + dv.getUint32(p + 12) : dv.getInt32(p + 4);
        p += v1 ? 20 : 12;
        if (mt >= 0) { t.shift = mt; break; }           // -1 = an empty edit before the picture
      }
    }
    return t;
  }

  function lowerBound(arr, v, n) {                     // first index with arr[i] >= v
    let lo = 0, hi = n;
    while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < v) lo = m + 1; else hi = m; }
    return lo;
  }

  function plan(v, a) {
    const starts = [0];
    const minGap = TARGET * v.timescale;
    for (let i = 1; i < v.n; i++) {
      if (v.sync[i] && v.dts[i] - v.dts[starts[starts.length - 1]] >= minGap) starts.push(i);
    }
    const aSec = a ? Float64Array.from(a.dts, x => x / a.timescale) : null;
    const segs = [];
    for (let k = 0; k < starts.length; k++) {
      const vFrom = starts[k], vTo = k + 1 < starts.length ? starts[k + 1] : v.n;
      const start = v.dts[vFrom] / v.timescale;
      const endTicks = vTo < v.n ? v.dts[vTo] : v.end;
      const end = endTicks / v.timescale;
      let aFrom = 0, aTo = 0;
      if (a) {
        aFrom = k === 0 ? 0 : lowerBound(aSec, start, a.n);
        aTo = k + 1 < starts.length ? lowerBound(aSec, end, a.n) : a.n;
      }
      let len = 0;
      for (let i = vFrom; i < vTo; i++) len += v.size[i];
      for (let i = aFrom; i < aTo; i++) len += a.size[i];
      segs.push({ i: k, start, dur: end - start, vFrom, vTo, aFrom, aTo, len });
    }
    return segs;
  }

  async function open(read) {
    const { moov, total } = await locateMoov(read);
    const dv = new DataView(moov.buffer, moov.byteOffset, moov.byteLength);
    const top = kids(dv, 0, moov.byteLength)[0];
    const mk = inside(dv, top);
    if (one(mk, "cmov")) throw new Error("compressed index");
    if (one(mk, "mvex")) throw new Error("already fragmented");
    const mvhd = one(mk, "mvhd");
    let v = null, a = null;
    for (const trak of mk.filter(b => b.type === "trak")) {
      const t = readTrack(dv, trak);
      if (!t || !t.n) continue;
      if (t.handler === "vide" && !v) v = t;
      else if (t.handler === "soun" && !a) a = t;
    }
    if (!v) throw new Error("no video track");
    // AAC's edit list trims its priming samples (~21 ms). A piece can't start
    // audio before 0, so the video moves later by the same amount instead:
    // the two stay exactly as far apart as in the plain player.
    v.lead = a && a.shift > 0 ? Math.round(a.shift / a.timescale * v.timescale) : 0;
    const segs = plan(v, a);
    const last = segs[segs.length - 1];
    const totalSec = Math.max(last.start + last.dur, a ? a.end / a.timescale : 0);
    return { moov, dv, mvhd, v, a, segs, total: totalSec, fileSize: total };
  }

  // ------------------------------------------------------------ writing boxes
  function cat(parts) {
    let n = 0;
    for (const p of parts) n += p.byteLength;
    const out = new Uint8Array(n);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.byteLength; }
    return out;
  }
  const str = s => new Uint8Array([...s].map(c => c.charCodeAt(0)));
  const u32b = x => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, x >>> 0); return b; };
  function box(type, ...parts) {
    const body = cat(parts);
    const out = new Uint8Array(8 + body.byteLength);
    new DataView(out.buffer).setUint32(0, out.byteLength);
    out.set(str(type), 4);
    out.set(body, 8);
    return out;
  }
  const full = (type, version, flags, ...parts) => box(type, u32b(((version & 255) << 24) | (flags & 0xffffff)), ...parts);
  const verbatim = (ix, b) => ix.moov.subarray(b.start, b.end);

  function trakInit(ix, t) {
    const stbl = box("stbl",
      verbatim(ix, t.stsd),
      full("stts", 0, 0, u32b(0)),
      full("stsc", 0, 0, u32b(0)),
      full("stsz", 0, 0, u32b(0), u32b(0)),
      full("stco", 0, 0, u32b(0)));
    const dinf = t.dinf ? verbatim(ix, t.dinf) : box("dinf", full("dref", 0, 0, u32b(1), full("url ", 0, 1)));
    const mhd = t.mhd ? verbatim(ix, t.mhd)
      : (t.handler === "vide" ? full("vmhd", 0, 1, new Uint8Array(8)) : full("smhd", 0, 0, new Uint8Array(4)));
    return box("trak",
      verbatim(ix, t.tkhd),
      box("mdia", verbatim(ix, t.mdhd), verbatim(ix, t.hdlr), box("minf", mhd, dinf, stbl)));
  }

  function initSegment(ix) {
    const tracks = [ix.v, ix.a].filter(Boolean);
    const ftyp = box("ftyp", str("isom"), u32b(0x200), str("isom"), str("iso6"), str("mp41"));
    const mvex = box("mvex", ...tracks.map(t => full("trex", 0, 0, u32b(t.id), u32b(1), u32b(0), u32b(0), u32b(0))));
    const moov = box("moov", verbatim(ix, ix.mvhd), ...tracks.map(t => trakInit(ix, t)), mvex);
    return cat([ftyp, moov]).buffer;
  }

  // --------------------------------------------------------------- the pieces
  function rangesFor(ix, k) {
    const s = ix.segs[k];
    const runs = [];
    const add = (t, from, to) => {
      let cur = null;
      for (let i = from; i < to; i++) {
        const o = t.off[i], e = o + t.size[i];
        if (cur && o >= cur[0] && o <= cur[1] + GAP) { if (e > cur[1]) cur[1] = e; }
        else { cur = [o, e]; runs.push(cur); }
      }
    };
    add(ix.v, s.vFrom, s.vTo);
    if (ix.a) add(ix.a, s.aFrom, s.aTo);
    runs.sort((x, y) => x[0] - y[0]);
    const out = [];
    for (const r of runs) {
      const last = out[out.length - 1];
      if (last && r[0] <= last[1] + GAP) { if (r[1] > last[1]) last[1] = r[1]; }
      else out.push([r[0], r[1]]);
    }
    return out.map(([o, e]) => ({ off: o, len: e - o }));
  }

  const SYNC = 0x02000000, NON_SYNC = 0x01010000;

  /** parts: [{ off, u8 }] for the ranges rangesFor gave. Returns an ArrayBuffer (moof + mdat). */
  function buildSegment(ix, k, parts) {
    const s = ix.segs[k];
    const tracks = [{ t: ix.v, from: s.vFrom, to: s.vTo, video: true }];
    if (ix.a && s.aTo > s.aFrom) tracks.push({ t: ix.a, from: s.aFrom, to: s.aTo, video: false });

    const trafSize = tr => 8 + 16 + 20 + 20 + (tr.to - tr.from) * (tr.video ? 16 : 8);
    const moofSize = 8 + 16 + tracks.reduce((n, tr) => n + trafSize(tr), 0);
    let payload = 0;
    for (const tr of tracks) { tr.before = payload; for (let i = tr.from; i < tr.to; i++) payload += tr.t.size[i]; }

    const out = new Uint8Array(moofSize + 8 + payload);
    const dv = new DataView(out.buffer);
    let p = 0;
    const w32 = x => { dv.setUint32(p, x >>> 0); p += 4; };
    const wi32 = x => { dv.setInt32(p, x | 0); p += 4; };
    const wstr = x => { out.set(str(x), p); p += 4; };

    w32(moofSize); wstr("moof");
    w32(16); wstr("mfhd"); w32(0); w32(k + 1);
    for (const tr of tracks) {
      const t = tr.t, count = tr.to - tr.from;
      w32(trafSize(tr)); wstr("traf");
      w32(16); wstr("tfhd"); w32(0x020000); w32(t.id);                     // default-base-is-moof
      const base = t.dts[tr.from];
      w32(20); wstr("tfdt"); w32(0x01000000); w32(Math.floor(base / 4294967296)); w32(base % 4294967296);
      w32(20 + count * (tr.video ? 16 : 8)); wstr("trun");
      w32(tr.video ? 0x01000F01 : 0x00000301);                              // v1 for signed cts
      w32(count);
      w32(moofSize + 8 + tr.before);                                        // data offset from moof
      for (let i = tr.from; i < tr.to; i++) {
        w32(t.dur[i]); w32(t.size[i]);
        if (tr.video) { w32(t.sync[i] ? SYNC : NON_SYNC); wi32(t.cts[i] - t.shift + t.lead); }
      }
    }
    w32(8 + payload); wstr("mdat");

    // Frames, straight from the file's bytes.
    const sorted = parts.slice().sort((x, y) => x.off - y.off);
    const find = (o, len) => {
      let lo = 0, hi = sorted.length - 1, hit = -1;
      while (lo <= hi) { const m = (lo + hi) >> 1; if (sorted[m].off <= o) { hit = m; lo = m + 1; } else hi = m - 1; }
      const r = hit >= 0 ? sorted[hit] : null;
      if (!r || o + len > r.off + r.u8.byteLength) throw new Error(`frame bytes missing at ${o}`);
      return r;
    };
    for (const tr of tracks) {
      const t = tr.t;
      for (let i = tr.from; i < tr.to; i++) {
        const o = t.off[i], len = t.size[i], r = find(o, len);
        out.set(r.u8.subarray(o - r.off, o - r.off + len), p);
        p += len;
      }
    }
    return out.buffer;
  }

  root.scrayMp4Chunks = { open, initSegment, rangesFor, buildSegment, TARGET, _setGap: g => { GAP = g; } };
})(typeof window !== "undefined" ? window : globalThis);

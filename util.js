// ===========================================================================
// TwoFrame: utilities, storage and zip reading
// ===========================================================================
'use strict';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, t) => a + (b - a) * t;
const uid = (p = 'id') => p + '_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const deepCopy = (o) => JSON.parse(JSON.stringify(o));

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'html') e.innerHTML = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) {
    if (k == null || k === false) continue;
    e.appendChild(typeof k === 'string' || typeof k === 'number' ? document.createTextNode(String(k)) : k);
  }
  return e;
}

function fmtTime(t, fps) {
  t = Math.max(0, t);
  const m = Math.floor(t / 60), s = Math.floor(t % 60), f = Math.floor((t - Math.floor(t)) * fps + 1e-6);
  return `${m}:${String(s).padStart(2, '0')}.${String(f).padStart(2, '0')}`;
}

// "#AARRGGBB" or "#RRGGBB" -> [r,g,b,a] in 0..1
function parseColor(hex) {
  if (Array.isArray(hex)) return hex.slice();
  let h = String(hex || '#ffffff').replace('#', '');
  if (h.length === 6) h = 'FF' + h;
  const n = parseInt(h, 16);
  if (Number.isNaN(n)) return [1, 1, 1, 1];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, ((n >>> 24) & 255) / 255];
}
function colorToHex(c) {
  const t = (v) => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, '0');
  return '#' + t(c[0]) + t(c[1]) + t(c[2]);
}
function cssColor(c) {
  return `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${c[3] == null ? 1 : c[3]})`;
}

function toast(msg, ms = 2600) {
  const t = el('div', { class: 'toast' }, msg);
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, ms);
}

// ---------------------------------------------------------------------------
// IndexedDB storage. Projects (JSON), media (Blobs) and imported effects (XML).
// Every call is wrapped so the app still runs, without saving, if storage
// is blocked (private browsing, some embedded viewers).
// ---------------------------------------------------------------------------
const Store = {
  db: null,
  ok: false,
  async open() {
    try {
      this.db = await Promise.race([new Promise((_, rej) => setTimeout(() => rej(new Error('storage timeout')), 3000)), new Promise((res, rej) => {
        const r = indexedDB.open('twoframe', 1);
        r.onupgradeneeded = () => {
          const db = r.result;
          for (const s of ['projects', 'media', 'effects']) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
        };
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      })]);
      this.ok = true;
    } catch (e) {
      console.warn('Storage unavailable', e);
      this.ok = false;
    }
  },
  _tx(store, mode, fn) {
    if (!this.ok) return Promise.resolve(null);
    return new Promise((res) => {
      try {
        const tx = this.db.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        tx.oncomplete = () => res(req ? req.result : null);
        tx.onerror = () => res(null);
        tx.onabort = () => res(null);
      } catch (e) { console.warn(e); res(null); }
    });
  },
  put(store, key, val) { return this._tx(store, 'readwrite', s => s.put(val, key)); },
  get(store, key) { return this._tx(store, 'readonly', s => s.get(key)); },
  del(store, key) { return this._tx(store, 'readwrite', s => s.delete(key)); },
  async all(store) {
    if (!this.ok) return [];
    return new Promise((res) => {
      const out = [];
      try {
        const tx = this.db.transaction(store, 'readonly');
        const c = tx.objectStore(store).openCursor();
        c.onsuccess = () => { const cur = c.result; if (cur) { out.push({ key: cur.key, value: cur.value }); cur.continue(); } };
        tx.oncomplete = () => res(out);
        tx.onerror = () => res(out);
      } catch (e) { res(out); }
    });
  }
};

// ---------------------------------------------------------------------------
// Minimal zip reader, enough for effect packs. Uses the central directory
// and the browser's built-in deflate decoder.
// ---------------------------------------------------------------------------
async function readZip(blob) {
  // Only the end of the file and the small headers are read into memory;
  // file contents stay as slices of the original Blob until asked for.
  const tailLen = Math.min(blob.size, 65557 + 22);
  const tail = new Uint8Array(await blob.slice(blob.size - tailLen).arrayBuffer());
  const tdv = new DataView(tail.buffer);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) if (tdv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Not a zip file');
  const count = tdv.getUint16(eocd + 10, true), cdSize = tdv.getUint32(eocd + 12, true), cdOff = tdv.getUint32(eocd + 16, true);
  const cd = new Uint8Array(await blob.slice(cdOff, cdOff + cdSize).arrayBuffer());
  const dv = new DataView(cd.buffer);
  const files = [], dec = new TextDecoder();
  let p = 0;
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const loff = dv.getUint32(p + 42, true);
    const name = dec.decode(cd.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + xlen + clen;
    if (name.endsWith('/')) continue;
    const entry = {
      name,
      async _data() {
        const lh = new DataView(await blob.slice(loff, loff + 30).arrayBuffer());
        const start = loff + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
        return blob.slice(start, start + csize);
      },
      async blob() {
        const d = await this._data();
        if (method === 0) return d;
        if (method !== 8) throw new Error('Unsupported zip compression in ' + name);
        return await new Response(d.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob();
      },
      async text() { return await (await this.blob()).text(); }
    };
    files.push(entry);
  }
  return files;
}

// Deterministic hash used by Random Holds (same seed, same result everywhere).
function hash01(seed, i) {
  // 32-bit integer mix (Murmur3 finalizer style)
  let h = (seed * 0x9E3779B1) ^ (i * 0x85EBCA77);
  h = Math.imul(h ^ (h >>> 16), 0x85EBCA6B);
  h = Math.imul(h ^ (h >>> 13), 0xC2B2AE35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// Resolves with the promise's value, or with fallback after ms milliseconds.
const withTimeout = (p, ms, fallback) => Promise.race([p, new Promise(r => setTimeout(() => r(fallback), ms))]);

// ---- CRC32 and a simple zip writer (no compression) for project files ------
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32Update(crc, bytes) { crc = ~crc >>> 0; for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 255] ^ (crc >>> 8); return ~crc >>> 0; }
// files: [{ name, blob }]. Reads each file in 8 MB pieces so big videos fit in memory.
async function writeZip(files, onProgress) {
  const parts = [], central = []; let offset = 0; const enc = new TextEncoder();
  let done = 0; const total = files.reduce((a, f) => a + f.blob.size, 0) || 1;
  for (const f of files) {
    let crc = 0;
    for (let p = 0; p < f.blob.size; p += 8 << 20) { crc = crc32Update(crc, new Uint8Array(await f.blob.slice(p, p + (8 << 20)).arrayBuffer())); done += Math.min(8 << 20, f.blob.size - p); onProgress && onProgress(done / total); }
    const name = enc.encode(f.name), size = f.blob.size;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(8, 0, true); lh.setUint32(14, crc, true);
    lh.setUint32(18, size, true); lh.setUint32(22, size, true); lh.setUint16(26, name.length, true);
    parts.push(lh.buffer, name, f.blob);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint32(16, crc, true);
    ch.setUint32(20, size, true); ch.setUint32(24, size, true); ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
    central.push(ch.buffer, name);
    offset += 30 + name.length + size;
  }
  const cdSize = central.reduce((a, b) => a + (b.byteLength ?? b.length), 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
}

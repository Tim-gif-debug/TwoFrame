// ===========================================================================
// Media import and per-layer runtime state (video elements, frame caches)
// ===========================================================================

// ---- Media library -------------------------------------------------------
// One record per imported file. Blobs live in IndexedDB so projects reopen.
const VIDEO_EXT = ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi', '3gp', 'qt', 'mts', 'm2ts', 'hevc', 'ogv'];
const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'avif', 'bmp', 'svg'];
const AUDIO_EXT = ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'flac', 'opus', 'caf', 'aif', 'aiff', 'wma'];
const AUDIO_DECODE_LIMIT = 350 * 1024 * 1024;   // bigger files skip audio extraction

function mediaKind(file) {
  const t = (file.type || '').toLowerCase();
  if (t.startsWith('video')) return 'video';
  if (t.startsWith('image')) return 'image';
  if (t.startsWith('audio')) return 'audio';
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (VIDEO_EXT.includes(ext)) return 'video';
  if (IMAGE_EXT.includes(ext)) return 'image';
  if (AUDIO_EXT.includes(ext)) return 'audio';
  return null;
}
async function probeVideo(url) {
  const v = document.createElement('video');
  v.muted = true; v.defaultMuted = true; v.playsInline = true; v.setAttribute('playsinline', ''); v.setAttribute('muted', '');
  v.preload = 'auto'; v.src = url;
  $('#videoPool').appendChild(v);
  const res = await withTimeout(new Promise((resolve) => {
    v.addEventListener('loadedmetadata', () => resolve({ ok: true }), { once: true });
    v.addEventListener('error', () => resolve({ ok: false, code: v.error ? v.error.code : 0 }), { once: true });
    v.load();
    const p = v.play(); if (p && p.catch) p.catch(() => {});
  }), 15000, { ok: false, code: 'timeout' });
  if (res.ok) {
    // Duration can be Infinity until more data arrives on some phones.
    if (!isFinite(v.duration)) { await withTimeout(new Promise(r => v.addEventListener('durationchange', r, { once: true })), 4000); }
    res.w = v.videoWidth; res.h = v.videoHeight; res.duration = v.duration;
    if (!res.w || !res.h || !isFinite(res.duration)) { res.ok = false; res.code = 4; }
  }
  v.pause(); v.removeAttribute('src'); v.load(); v.remove();
  return res;
}

const Media = {
  items: new Map(),
  audioCtx: null,
  getAudioCtx() {
    if (!this.audioCtx) { try { this.audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { this.audioCtx = null; } }
    return this.audioCtx;
  },
  async importFile(file) {
    const type = mediaKind(file);
    if (!type) throw new Error(`${file.name}: this file type isn’t supported. Use a video, photo or audio file.`);
    const id = uid('m');
    const m = await this.load({ id, type, name: file.name, blob: file });
    // Saving the file for next time happens in the background; a failure
    // (storage full, private mode) doesn't stop the import.
    Store.put('media', id, { id, type, name: file.name, blob: file }).catch(() => {});
    return m;
  },
  async load(rec) {
    if (this.items.has(rec.id)) return this.items.get(rec.id);
    const m = { id: rec.id, type: rec.type, name: rec.name, blob: rec.blob, url: URL.createObjectURL(rec.blob), w: 0, h: 0, duration: 0, audio: null, thumbs: [] };
    if (m.type === 'video') {
      // iPhones don't load video data until asked to play, so the probe
      // starts muted inline playback to kick off loading. If the blob URL
      // still fails (some in-app browsers), retry with a data URL.
      let res = await probeVideo(m.url);
      if (!res.ok && rec.blob.size < 200 * 1024 * 1024) {
        const dataUrl = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.onerror = () => r(null); fr.readAsDataURL(rec.blob); });
        if (dataUrl) { const r2 = await probeVideo(dataUrl); if (r2.ok) { URL.revokeObjectURL(m.url); m.url = dataUrl; res = r2; } }
      }
      if (!res.ok) {
        const why = { 1: 'loading was stopped', 2: 'a network or file read error', 3: 'the video data couldn’t be decoded', 4: 'this browser doesn’t support the video’s format', timeout: 'the browser never started loading it' }[res.code] || 'unknown';
        throw new Error(`${m.name} couldn’t be opened (${why}). If you’re using TwoFrame inside the Claude app, open it in Safari instead, from the GitHub Pages copy. If it still fails there, convert the clip to MP4 (H.264).`);
      }
      m.w = res.w; m.h = res.h; m.duration = res.duration;
    } else if (m.type === 'image') {
      const img = new Image(); img.src = m.url;
      try { await img.decode(); } catch (e) {
        throw new Error(`${m.name} couldn’t be opened. ${/\.(heic|heif)$/i.test(m.name) ? 'HEIC photos only open in Safari. In other browsers, export the photo as JPEG.' : 'Try a JPEG or PNG.'}`);
      }
      let src = img, w = img.naturalWidth, h = img.naturalHeight;
      const maxDim = 4096;
      if (Math.max(w, h) > maxDim) {
        const k = maxDim / Math.max(w, h); const c = document.createElement('canvas');
        c.width = Math.round(w * k); c.height = Math.round(h * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); src = c;
      }
      m.w = w; m.h = h; m.image = src;
    }
    if (m.type === 'audio') {
      await this.decodeAudio(m);
      if (!m.audio) throw new Error(`${m.name}: this audio format can’t be read by the browser. Try MP3, M4A or WAV.`);
      m.duration = m.audio.duration;
    } else if (m.type === 'video') {
      // Audio from a video loads in the background so the clip shows up right away.
      m.audioReady = this.decodeAudio(m);
    }
    this.items.set(m.id, m);
    return m;
  },
  async decodeAudio(m) {
    if (m.blob.size > AUDIO_DECODE_LIMIT) { m.audioSkipped = true; return; }
    try {
      const ctx = this.getAudioCtx(); if (!ctx) return;
      const buf = await m.blob.arrayBuffer();
      m.audio = await withTimeout(new Promise((res, rej) => ctx.decodeAudioData(buf, res, rej)), 60000, null);
    } catch (e) { m.audio = null; }
  },
  // Small frames for the timeline filmstrip.
  async makeThumbs(m, onUpdate) {
    if (m.type === 'image') { const c = document.createElement('canvas'); const h = 72; c.height = h; c.width = Math.max(8, Math.round(h * m.w / m.h)); c.getContext('2d').drawImage(m.image, 0, 0, c.width, c.height); m.thumbs = [{ t: 0, url: c.toDataURL('image/jpeg', 0.7) }]; onUpdate && onUpdate(); return; }
    if (m.type !== 'video' || m.thumbing) return;
    m.thumbing = true;
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.setAttribute('playsinline', ''); v.setAttribute('muted', ''); v.preload = 'auto'; v.src = m.url;
    $('#videoPool').appendChild(v);
    v.load(); { const k = v.play(); if (k && k.then) k.then(() => v.pause(), () => {}); }
    const ok = await withTimeout(new Promise(r => { v.addEventListener('loadeddata', () => r(true), { once: true }); v.addEventListener('error', () => r(false), { once: true }); }), 15000, false);
    if (ok) {
      const h = 72, w = Math.max(8, Math.round(h * m.w / m.h)), c = document.createElement('canvas'); c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      const n = clamp(Math.ceil(m.duration / 1.0), 2, 40);
      for (let i = 0; i < n; i++) {
        const t = Math.min(m.duration - 0.05, (i + 0.5) * m.duration / n);
        await withTimeout(new Promise(r => { v.addEventListener('seeked', r, { once: true }); v.currentTime = t; }), 3000);
        try { ctx.drawImage(v, 0, 0, w, h); m.thumbs.push({ t, url: c.toDataURL('image/jpeg', 0.6) }); } catch (e) { break; }
        if (i % 4 === 3 || i === n - 1) onUpdate && onUpdate();
      }
    }
    v.removeAttribute('src'); v.load(); v.remove();
  }
};

// ---- Per-layer runtime state (video elements, caches, textures) ---------
const Runtime = {
  map: new Map(),
  get(layer) {
    let r = this.map.get(layer.id);
    if (!r) { r = { cache: new Map(), live: null, video: null, tex: null, texKey: '' }; this.map.set(layer.id, r); }
    if (layer.type === 'video' && !r.video) {
      const m = Media.items.get(layer.mediaId);
      if (m) {
        const v = document.createElement('video');
        v.muted = true; v.defaultMuted = true; v.playsInline = true; v.preload = 'auto'; v.setAttribute('playsinline', ''); v.setAttribute('muted', ''); v.src = typeof Proxies !== 'undefined' ? Proxies.src(m) : m.url;
        $('#videoPool').appendChild(v);
        v.load(); const kick = v.play(); if (kick && kick.then) kick.then(() => { if (!Player.playing) v.pause(); }, () => {});
        // Redraw the preview once real frames arrive.
        v.addEventListener('loadeddata', () => { if (typeof App !== 'undefined') App.requestRender(); });
        r.video = v;
      }
    }
    return r;
  },
  clearCaches() {
    for (const r of this.map.values()) { for (const rt of r.cache.values()) engine.freeRT(rt); r.cache.clear(); }
  },
  drop(layerId) {
    const r = this.map.get(layerId); if (!r) return;
    for (const rt of r.cache.values()) engine.freeRT(rt);
    if (r.video) { r.video.pause(); r.video.remove(); }
    this.map.delete(layerId);
  }
};

async function seekVideo(v, t) {
  if (!v) return;
  if (v.readyState < 2 && v.paused) { const k = v.play(); if (k && k.then) await withTimeout(k.then(() => v.pause(), () => {}), 3000); }
  // A freshly created element may not know its duration yet.
  if (v.readyState < 1 || !isFinite(v.duration)) {
    await new Promise((res) => { v.addEventListener('loadedmetadata', res, { once: true }); setTimeout(res, 4000); });
  }
  t = clamp(t, 0, Math.max(0, (isFinite(v.duration) ? v.duration : 0) - 0.001));
  if (v.readyState >= 2 && !v.seeking && Math.abs(v.currentTime - t) < 0.0005) return;
  await new Promise((res) => {
    let done = false;
    const fin = () => { if (done) return; done = true; v.removeEventListener('seeked', onSeek); res(); };
    const onSeek = () => {
      if (v.readyState >= 2) fin();
      else v.addEventListener('loadeddata', fin, { once: true });
    };
    v.addEventListener('seeked', onSeek);
    v.currentTime = t;
    setTimeout(fin, 4000);
  });
}


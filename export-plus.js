// ===========================================================================
// More ways to export: GIF, PNG sequence (zip), a single frame, sound only
// (WAV), one-tap presets for TikTok / Reels / Shorts / YouTube, a size
// estimate, and backing up the whole library (effects, LUTs, presets,
// curves, fonts) as one file.
// ===========================================================================
Object.assign(Exporter, {
  // Renders every frame at W x H and hands each one to onFrame(i, canvas).
  async frames(p, W, H, fps, onFrame, onProgress, t0 = 0, t1 = p.duration) {
    await Fonts.ready(p); await Renderer._lock;
    this.busy = true; this.cancel = false;
    const prev = [engine.width, engine.height], even = (n) => Math.max(2, Math.round(n / 2) * 2); W = even(W); H = even(H);
    engine.setSize(W, H, p.width, p.height); Runtime.clearCaches();
    const N = Math.max(1, Math.round((t1 - t0) * fps));
    try {
      for (let i = 0; i < N; i++) { if (this.cancel) throw new Error('Export cancelled'); let job = null; await Renderer.frame(p, t0 + i / fps, 'exact', () => { job = onFrame(i, engine.canvas); }); if (job) await job; onProgress && onProgress((i + 1) / N); if (i % 4 === 0) await sleep(0); }
    } finally { this.busy = false; engine.setSize(prev[0], prev[1], p.width, p.height); Runtime.clearCaches(); }
    return { W, H, N };
  },
  async gif(p, opts, onProgress) {
    const k = Math.min(1, (opts.maxSide || 480) / Math.max(p.width, p.height)), fps = Math.min(opts.fps || 12, 25), dur = Math.min(p.duration, opts.maxDur || 15);
    const cv = document.createElement('canvas'), frames = []; let ctx = null, W = 0, H = 0;
    const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
    await this.frames(p, p.width * k, p.height * k, fps, (i, src) => {
      if (!ctx) { W = cv.width = src.width; H = cv.height = src.height; ctx = cv.getContext('2d', { willReadFrequently: true }); }
      ctx.drawImage(src, 0, 0); const d = ctx.getImageData(0, 0, W, H).data, idx = new Uint8Array(W * H);
      for (let y = 0, j = 0; y < H; y++) for (let x = 0; x < W; x++, j++) { const t = (bayer[(y & 3) * 4 + (x & 3)] / 16 - 0.5); const r = clamp(Math.round(d[j * 4] / 255 * 5 + t), 0, 5), g = clamp(Math.round(d[j * 4 + 1] / 255 * 6 + t), 0, 6), b = clamp(Math.round(d[j * 4 + 2] / 255 * 5 + t), 0, 5); idx[j] = r * 42 + g * 6 + b; }
      frames.push(idx);
    }, (f) => onProgress(f * 0.7), 0, dur);
    // Palette: 6 x 7 x 6 colour cube.
    const pal = new Uint8Array(768); for (let r = 0; r < 6; r++) for (let g = 0; g < 7; g++) for (let b = 0; b < 6; b++) { const i = (r * 42 + g * 6 + b) * 3; pal[i] = r * 51; pal[i + 1] = Math.round(g * 42.5); pal[i + 2] = b * 51; }
    const parts = [], push = (...b) => parts.push(new Uint8Array(b)), w16 = (v) => [v & 255, (v >> 8) & 255];
    push(...'GIF89a'.split('').map(c => c.charCodeAt(0)), ...w16(W), ...w16(H), 0xF7, 0, 0); parts.push(pal);
    push(0x21, 0xFF, 0x0B, ...'NETSCAPE2.0'.split('').map(c => c.charCodeAt(0)), 3, 1, 0, 0, 0);
    const delay = Math.round(100 / fps);
    for (let f = 0; f < frames.length; f++) {
      push(0x21, 0xF9, 4, 0x04, ...w16(delay), 0, 0, 0x2C, 0, 0, 0, 0, ...w16(W), ...w16(H), 0, 8);
      const data = gifLZW(frames[f]);
      for (let o = 0; o < data.length; o += 255) { const n = Math.min(255, data.length - o); push(n); parts.push(data.subarray(o, o + n)); }
      push(0); onProgress(0.7 + 0.3 * (f + 1) / frames.length); if (f % 5 === 0) await sleep(0);
    }
    push(0x3B);
    return { blob: new Blob(parts, { type: 'image/gif' }), W, H, frames: frames.length };
  },
  async pngSequence(p, opts, onProgress) {
    const k = (opts.short || Math.min(p.width, p.height)) / Math.min(p.width, p.height), fps = opts.fps || p.fps, files = [];
    const cv = document.createElement('canvas'); let ctx = null;
    const r = await this.frames(p, p.width * k, p.height * k, fps, (i, src) => { if (!ctx) { cv.width = src.width; cv.height = src.height; ctx = cv.getContext('2d'); } ctx.clearRect(0, 0, cv.width, cv.height); ctx.drawImage(src, 0, 0);
      return new Promise(res => cv.toBlob(b => { files.push({ name: `frame_${String(i + 1).padStart(5, '0')}.png`, blob: b }); res(); }, 'image/png')); }, (f) => onProgress(f * 0.9));
    const zip = await writeZip(files, (f) => onProgress(0.9 + f * 0.1));
    return { blob: zip, ...r };
  },
  async still(p, t) {
    const cv = document.createElement('canvas'); let out = null;
    await this.frames(p, p.width, p.height, p.fps, (i, src) => { cv.width = src.width; cv.height = src.height; cv.getContext('2d').drawImage(src, 0, 0); return new Promise(res => cv.toBlob(b => { out = b; res(); }, 'image/png')); }, null, t, t + 1 / p.fps);
    return out;
  },
  async wav(p) {
    const buf = await Sound.mix(p); if (!buf) throw new Error('This project has no sound.');
    const n = buf.length, ch = Math.min(2, buf.numberOfChannels), out = new DataView(new ArrayBuffer(44 + n * ch * 2)), ws = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
    ws(0, 'RIFF'); out.setUint32(4, 36 + n * ch * 2, true); ws(8, 'WAVEfmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, ch, true); out.setUint32(24, buf.sampleRate, true); out.setUint32(28, buf.sampleRate * ch * 2, true); out.setUint16(32, ch * 2, true); out.setUint16(34, 16, true); ws(36, 'data'); out.setUint32(40, n * ch * 2, true);
    const cd = []; for (let c = 0; c < ch; c++) cd.push(buf.getChannelData(c));
    for (let i = 0, o = 44; i < n; i++) for (let c = 0; c < ch; c++, o += 2) out.setInt16(o, clamp(cd[c][i], -1, 1) * 32767, true);
    return new Blob([out.buffer], { type: 'audio/wav' });
  }
});
// GIF's LZW compression (8-bit colour indices in, packed codes out).
function gifLZW(px) {
  const out = new Uint8Array(px.length + 1024 + (px.length >> 1)); let op = 0, cur = 0, bits = 0, size = 9, next = 258, dict = new Map();
  const emit = (c) => { cur |= c << bits; bits += size; while (bits >= 8) { out[op++] = cur & 255; cur >>>= 8; bits -= 8; } };
  emit(256); let prefix = px[0];
  for (let i = 1; i < px.length; i++) {
    const k = px[i], key = prefix * 256 + k, code = dict.get(key);
    if (code !== undefined) { prefix = code; continue; }
    emit(prefix);
    if (next === 4096) { emit(256); dict = new Map(); size = 9; next = 258; } else { if (next >= (1 << size)) size++; dict.set(key, next++); }
    prefix = k;
  }
  emit(prefix); emit(257); if (bits > 0) out[op++] = cur & 255;
  return out.subarray(0, op);
}

const Library = {
  // Everything saved outside projects, as one zip.
  async backup() {
    const eff = await Store.all('effects'), files = [], fonts = [];
    for (const r of await Store.all('media')) if (r.value && r.value.type === 'font') { const name = `fonts/${fonts.length}.font`; files.push({ name, blob: r.value.blob }); fonts.push({ name: r.value.name, file: name }); }
    const extra = {}; for (const k of ['tf.vocab', 'tf.caprules', 'tf.keys', 'tf.guides', 'tf.retouchPresets']) { try { const v = localStorage.getItem(k); if (v != null) extra[k] = v; } catch (e) { } }
    files.unshift({ name: 'library.json', blob: new Blob([JSON.stringify({ app: 'TwoFrame library', saved: new Date().toISOString(), effects: eff, fonts, settings: extra })], { type: 'application/json' }) });
    const how = await saveBlob(await writeZip(files), 'TwoFrame-library.zip'); if (how === 'saved' || how === 'downloaded' || how === 'shared') toast(`Library backed up: ${eff.length} saved items, ${fonts.length} fonts.`);
  },
  async restore(file) {
    const entries = await readZip(file), lib = entries.find(e => e.name === 'library.json'); if (!lib) throw new Error('This isn’t a TwoFrame library backup.');
    const data = JSON.parse(await lib.text());
    for (const r of data.effects || []) await Store.put('effects', r.key, r.value);
    for (const f of data.fonts || []) { const e = entries.find(x => x.name === f.file); if (e) await Store.put('media', 'font:' + f.name, { id: 'font:' + f.name, type: 'font', name: f.name, blob: await e.blob() }); }
    for (const [k, v] of Object.entries(data.settings || {})) { try { localStorage.setItem(k, v); } catch (e) { } }
    return (data.effects || []).length;
  }
};

Object.assign(UI, {
  async exportOther(kind) {
    const p = App.project, safe = (p.name || 'TwoFrame').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_');
    const bar = el('div', { class: 'bar' }, el('i')), label = el('p', { class: 'hint' }, 'Starting…');
    this.modal('Exporting', el('div', {}, bar, label), [['Cancel', () => { Exporter.cancel = true; }]]);
    const prog = (f) => { bar.firstChild.style.width = (f * 100).toFixed(1) + '%'; label.textContent = Math.round(f * 100) + '%'; };
    try {
      Proxies.useOriginals(true); let blob, name, note = '';
      if (kind === 'gif') { const r = await Exporter.gif(p, { maxSide: 480, fps: 12, maxDur: 15 }, prog); blob = r.blob; name = safe + '.gif'; note = `${r.W}×${r.H}, ${r.frames} frames${p.duration > 15 ? ' (first 15 seconds)' : ''}`; }
      else if (kind === 'png') { if (p.duration * p.fps > 900) throw new Error('A PNG sequence is limited to 900 frames here. Shorten the project or lower the frame rate.'); const r = await Exporter.pngSequence(p, { short: Math.min(1080, Math.min(p.width, p.height)) }, prog); blob = r.blob; name = safe + '_frames.zip'; note = `${r.N} PNG files at ${r.W}×${r.H}`; }
      else if (kind === 'frame') { blob = await Exporter.still(p, App.time); name = safe + '_frame.png'; note = `${p.width}×${p.height}`; }
      else { label.textContent = 'Mixing sound…'; blob = await Exporter.wav(p); name = safe + '.wav'; note = 'WAV, 48 kHz'; }
      this.modal('Export finished', el('div', {}, kind === 'gif' || kind === 'frame' ? el('img', { src: URL.createObjectURL(blob), class: 'result', style: { maxWidth: '100%', maxHeight: '45vh' } }) : null, el('p', { class: 'hint' }, `${note}. ${(blob.size / 1048576).toFixed(2)} MB.`)),
        [['Close', () => this.closeModal()], ['Save', async () => { const r = await saveBlob(blob, name); if (r === 'downloaded') toast('Saved to your downloads.'); }, 'primary']]);
    } catch (e) { this.modal('Export stopped', el('p', {}, e.message || String(e)), [['OK', () => this.closeModal()]]); }
    finally { Proxies.useOriginals(false); App.requestRender(); }
  }
});
(() => {
  const dlg = UI.exportDialog, canvasPanel = UI.panel_canvas;
  UI.exportDialog = function () {
    dlg.call(this);
    const body = $('#modal .mbody'), p = App.project; if (!body) return;
    const mb = (short, fps, q) => { const k = short / Math.min(p.width, p.height); return (p.width * k * p.height * k * fps * (q === 'high' ? 0.2 : 0.1) + 192000) * p.duration / 8 / 1048576; };
    const preset = (name, o, want) => el('button', { class: 'btn sm', title: `${o.short}p, ${o.fps} fps`, onclick: () => { const r = p.width / p.height; if (want && Math.abs(r - want) > 0.05) toast(`${name} expects a ${want < 1 ? '9:16' : '16:9'} canvas. Yours is different, so it will have bars or get cropped there.`, 4500); this.runExport({ ...o, quality: 'high', audio: true }); } }, `${name} · ~${mb(o.short, o.fps, 'high').toFixed(0)} MB`);
    const max = Math.min(p.width, p.height);
    body.append(el('div', { class: 'sect' }, 'One-tap presets'), el('div', { class: 'btnrow' }, preset('TikTok', { short: 1080, fps: 30 }, 9 / 16), preset('Reels', { short: 1080, fps: 30 }, 9 / 16), preset('Shorts', { short: 1080, fps: 30 }, 9 / 16), preset('YouTube 1080p', { short: 1080, fps: p.fps }, 16 / 9), preset('YouTube 4K', { short: 2160, fps: p.fps }, 16 / 9)),
      el('p', { class: 'hint' }, `Size guide for this ${p.duration.toFixed(1)} s project at High quality: 720p about ${mb(720, p.fps, 'high').toFixed(0)} MB, 1080p about ${mb(1080, p.fps, 'high').toFixed(0)} MB, 4K about ${mb(2160, p.fps, 'high').toFixed(0)} MB.${max < 1080 ? '' : ''}`),
      el('div', { class: 'sect' }, 'Other formats'), el('div', { class: 'btnrow' }, el('button', { class: 'btn sm', onclick: () => this.exportOther('gif') }, 'GIF'), el('button', { class: 'btn sm', onclick: () => this.exportOther('png') }, 'PNG sequence'), el('button', { class: 'btn sm', onclick: () => this.exportOther('frame') }, 'This frame (PNG)'), el('button', { class: 'btn sm', onclick: () => this.exportOther('wav') }, 'Sound only (WAV)')));
  };
  UI.panel_canvas = function (body) {
    canvasPanel.call(this, body);
    body.appendChild(el('div', { class: 'sect' }, 'Library backup'));
    body.appendChild(el('div', { class: 'btnrow' }, el('button', { class: 'btn sm', onclick: () => Library.backup() }, 'Back up library'),
      el('button', { class: 'btn sm', onclick: () => this.pickFiles('.zip,application/zip', async ([f]) => { try { const n = await Library.restore(f); toast(`Restored ${n} saved items. Reloading…`); setTimeout(() => location.reload(), 1200); } catch (e) { toast(e.message, 4000); } }) }, 'Restore library')));
    body.appendChild(el('p', { class: 'hint' }, 'The library holds imported effects, LUTs, effect presets, saved curves, fonts, your caption vocabulary and shortcuts.'));
  };
})();

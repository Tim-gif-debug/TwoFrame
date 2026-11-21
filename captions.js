// ===========================================================================
// Auto captions with Whisper, running in the browser through transformers.js.
// Nothing is uploaded: the model downloads once from Hugging Face and then
// runs on this device (WebGPU when available, otherwise WebAssembly).
//
// The audio is cut into 30-second pieces here instead of using the
// pipeline's own chunking, which has produced broken word times with the
// timestamped models.
// ===========================================================================
const CAPTION_MODELS = [
  ['onnx-community/whisper-tiny_timestamped', 'Tiny (fast, good for phone)'],
  ['onnx-community/whisper-base_timestamped', 'Base (better accuracy)'],
  ['onnx-community/whisper-small_timestamped', 'Small (best, computer only)']
];
const CAPTION_LANGS = [['', 'Auto-detect'], ['english', 'English'], ['spanish', 'Spanish'], ['french', 'French'], ['german', 'German'], ['italian', 'Italian'], ['portuguese', 'Portuguese'], ['persian', 'Persian'], ['arabic', 'Arabic'], ['hindi', 'Hindi'], ['japanese', 'Japanese'], ['korean', 'Korean'], ['chinese', 'Chinese'], ['russian', 'Russian'], ['turkish', 'Turkish'], ['dutch', 'Dutch']];

const CAPTION_STYLES = {
  'Karaoke Yellow': { style: 'karaoke', hl: [1, 0.86, 0.1, 1], text: { font: 'Montserrat', weight: 900, color: [1, 1, 1, 1], strokeOn: true, stroke: [0, 0, 0, 1], strokeWidth: 8 } },
  'Bold Outline': { style: 'word', hl: [0.2, 1, 0.6, 1], upper: true, text: { font: 'Anton', weight: 400, color: [1, 1, 1, 1], strokeOn: true, stroke: [0, 0, 0, 1], strokeWidth: 10, shadowOn: true } },
  'Pop Words': { style: 'pop', hl: [1, 0.35, 0.5, 1], text: { font: 'Poppins', weight: 900, color: [1, 1, 1, 1], strokeOn: true, stroke: [0, 0, 0, 1], strokeWidth: 7 } },
  'Box Classic': { style: 'plain', text: { font: 'Inter', weight: 700, color: [1, 1, 1, 1], boxOn: true, boxColor: [0, 0, 0, 0.7], boxPad: 18, boxRadius: 12 } },
  'Neon Glow': { style: 'karaoke', hl: [0.2, 1, 1, 1], text: { font: 'Audiowide', weight: 400, color: [0.85, 0.95, 1, 1], glowOn: true, glowColor: [0.1, 0.9, 1, 1], glowSize: 22 } },
  'Comic': { style: 'word', hl: [1, 0.25, 0.2, 1], upper: true, text: { font: 'Bangers', weight: 400, color: [1, 0.92, 0.2, 1], strokeOn: true, stroke: [0, 0, 0, 1], strokeWidth: 9 } },
  'Minimal': { style: 'plain', text: { font: 'Sans', weight: 600, color: [1, 1, 1, 1], shadowOn: true, shadowBlur: 10, shadowX: 0, shadowY: 3 } }
};

const WHISPER_WORKER_SRC = `
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';
env.allowLocalModels = false;
let pipe = null, loaded = '';
self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.cmd === 'load') {
      if (loaded !== m.model + m.device) {
        const opts = { device: m.device, progress_callback: (p) => { if (p.status === 'progress') self.postMessage({ type: 'dl', file: p.file, progress: p.progress }); } };
        opts.dtype = m.device === 'webgpu' ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : 'q8';
        pipe = await pipeline('automatic-speech-recognition', m.model, opts);
        loaded = m.model + m.device;
      }
      self.postMessage({ type: 'loaded' });
    } else if (m.cmd === 'run') {
      let out;
      try { out = await pipe(m.audio, { return_timestamps: 'word', language: m.language || null, task: 'transcribe' }); out.word = true; }
      catch (err) { out = await pipe(m.audio, { return_timestamps: true, language: m.language || null, task: 'transcribe' }); out.word = false; }
      self.postMessage({ type: 'result', text: out.text, chunks: out.chunks || [], word: out.word });
    }
  } catch (err) { self.postMessage({ type: 'error', message: String(err && err.message || err) }); }
};`;

const Captions = {
  worker: null, cancel: false,
  ask(msg) {
    return new Promise((res, rej) => {
      const w = this.worker;
      const on = (e) => { if (e.data.type === 'dl') { this.onDl && this.onDl(e.data); return; } w.removeEventListener('message', on); e.data.type === 'error' ? rej(new Error(e.data.message)) : res(e.data); };
      w.addEventListener('message', on);
      w.postMessage(msg, msg.audio ? [msg.audio.buffer] : []);
    });
  },
  // Mixed project audio as 16 kHz mono, which Whisper expects.
  async audio16k(project) {
    const buf = await Sound.mix(project);
    if (!buf) throw new Error('There’s no sound on the timeline to transcribe.');
    const ctx = new OfflineAudioContext(1, Math.ceil(buf.duration * 16000), 16000);
    const src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination); src.start();
    return (await ctx.startRendering()).getChannelData(0);
  },
  // Runs the whole job. onProgress(fraction, message).
  async run(project, opts, onProgress) {
    this.cancel = false;
    if (location.protocol === 'file:') throw new Error('Auto captions need TwoFrame to be opened from a web address (GitHub Pages), not a file on this device.');
    if (!this.worker) this.worker = new Worker(URL.createObjectURL(new Blob([WHISPER_WORKER_SRC], { type: 'text/javascript' })), { type: 'module' });
    let device = (opts.device === 'wasm' || !navigator.gpu) ? 'wasm' : 'webgpu';
    const files = new Map();
    this.onDl = (d) => { files.set(d.file, d.progress || 0); const vals = Array.from(files.values()); onProgress(0.4 * vals.reduce((a, b) => a + b, 0) / (vals.length * 100), `Downloading the speech model (first time only)… ${Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)}%`); };
    onProgress(0, 'Loading the speech model…');
    try { await this.ask({ cmd: 'load', model: opts.model, device }); }
    catch (e) { if (device !== 'webgpu') throw e; device = 'wasm'; await this.ask({ cmd: 'load', model: opts.model, device }); }
    onProgress(0.4, 'Preparing audio…');
    const pcm = await this.audio16k(project);
    const step = 30 * 16000, n = Math.ceil(pcm.length / step), words = [];
    for (let i = 0; i < n; i++) {
      if (this.cancel) throw new Error('Cancelled');
      onProgress(0.4 + 0.6 * i / n, `Transcribing ${i * 30}–${Math.min((i + 1) * 30, Math.round(pcm.length / 16000))} s (${device === 'webgpu' ? 'GPU' : 'CPU'})…`);
      const piece = pcm.slice(i * step, Math.min(pcm.length, (i + 1) * step));
      // Skip silent pieces quickly.
      let e = 0; for (let k = 0; k < piece.length; k += 16) e += piece[k] * piece[k];
      if (e / (piece.length / 16) < 1e-6) continue;
      const out = await this.ask({ cmd: 'run', audio: piece, language: opts.language });
      const off = i * 30;
      for (const ch of out.chunks) {
        const [s, eT] = ch.timestamp || [0, 0];
        if (out.word) { const w = (ch.text || '').trim(); if (w) words.push({ w, s: off + (s ?? 0), e: off + (eT ?? (s ?? 0) + 0.3) }); }
        else {
          // Segment times only: spread the words evenly across the segment.
          const ws = (ch.text || '').trim().split(/\s+/).filter(Boolean), a = off + (s ?? 0), b = off + (eT ?? a + ws.length * 0.35);
          ws.forEach((w, k) => words.push({ w, s: a + (b - a) * k / ws.length, e: a + (b - a) * (k + 1) / ws.length }));
        }
      }
    }
    onProgress(1, 'Done');
    return words;
  },
  // Groups words into short lines.
  toLines(words, maxWords = 4) {
    const lines = []; let cur = [];
    const flush = () => { if (cur.length) { lines.push({ s: cur[0].s, e: cur[cur.length - 1].e, words: cur }); cur = []; } };
    words.forEach((w, i) => {
      const prev = cur[cur.length - 1];
      if (prev && (w.s - prev.e > 0.7 || cur.length >= maxWords)) flush();
      cur.push({ ...w });
      if (/[.!?]$/.test(w.w)) flush();
    });
    flush();
    // Each line stays up until the next one starts (short gaps only).
    for (let i = 0; i < lines.length - 1; i++) if (lines[i + 1].s - lines[i].e < 0.6) lines[i].e = lines[i + 1].s;
    return lines;
  },
  makeLayer(lines, styleName = 'Karaoke Yellow') {
    const p = App.project, st = CAPTION_STYLES[styleName] || CAPTION_STYLES['Karaoke Yellow'];
    const l = App.baseLayer('caption', 'Captions');
    l.start = 0; l.dur = p.duration;
    l.text = { ...TEXT_DEFAULTS, size: Math.round(Math.min(p.width, p.height) * 0.075), ...st.text };
    l.caption = { lines, style: st.style, hl: st.hl || null, upper: !!st.upper, emoji: false, preset: styleName };
    l.transform.y = Math.round(p.height * 0.72);
    App.addLayer(l, { kind: 'text' });
    return l;
  },
  applyStyle(l, styleName) {
    const st = CAPTION_STYLES[styleName]; if (!st) return;
    App.change(() => { l.text = { ...l.text, ...TEXT_DEFAULTS, size: l.text.size, ...st.text }; Object.assign(l.caption, { style: st.style, hl: st.hl || null, upper: !!st.upper, preset: styleName }); });
  },
  // Re-times a line's words evenly after its text is edited.
  setLineText(l, li, text) {
    App.change(() => {
      const L = l.caption.lines[li], ws = text.trim().split(/\s+/).filter(Boolean);
      L.words = ws.map((w, k) => ({ w, s: L.s + (L.e - L.s) * k / ws.length, e: L.s + (L.e - L.s) * (k + 1) / ws.length }));
    }, 'cap' + l.id + li);
  },
  setLineTime(l, li, s, e) {
    App.change(() => {
      const L = l.caption.lines[li], os = L.s, oe = L.e; L.s = Math.min(s, e - 0.05); L.e = Math.max(e, L.s + 0.05);
      for (const w of L.words) { w.s = L.s + (w.s - os) / (oe - os || 1) * (L.e - L.s); w.e = L.s + (w.e - os) / (oe - os || 1) * (L.e - L.s); }
    }, 'capt' + l.id + li);
  },
  split(l, li) {
    App.change(() => {
      const L = l.caption.lines[li]; if (L.words.length < 2) return;
      const h = Math.ceil(L.words.length / 2), a = L.words.slice(0, h), b = L.words.slice(h);
      l.caption.lines.splice(li, 1, { s: L.s, e: a[a.length - 1].e, words: a }, { s: b[0].s, e: L.e, words: b });
    });
  },
  merge(l, li) {
    App.change(() => {
      const A = l.caption.lines[li], B = l.caption.lines[li + 1]; if (!B) return;
      l.caption.lines.splice(li, 2, { s: A.s, e: B.e, words: [...A.words, ...B.words] });
    });
  },
  toSRT(l) {
    const f = (t) => { t = Math.max(0, t + l.start); const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = Math.floor(t % 60), ms = Math.round((t % 1) * 1000); return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`; };
    return l.caption.lines.map((L, i) => `${i + 1}\n${f(L.s)} --> ${f(L.e)}\n${L.words.map(w => w.w).join(' ')}\n`).join('\n');
  }
};

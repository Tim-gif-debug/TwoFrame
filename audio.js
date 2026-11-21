// ===========================================================================
// Sound: playback, export mixing, volume keyframes, fades, ducking, voice
// effects, noise reduction, waveforms and beat detection.
//
// Heavy number crunching (waveforms, beats) runs in a Web Worker so the
// interface never freezes. Voice effects and noise reduction are worked out
// once per clip setting and cached.
// ===========================================================================

const VOICE_FX = [['none', 'None'], ['chipmunk', 'Chipmunk'], ['deep', 'Deep voice'], ['robot', 'Robot'], ['echo', 'Echo'], ['telephone', 'Telephone'], ['radio', 'Old radio'], ['hall', 'Big hall']];

// Worker code: waveform peaks and beat (onset) detection.
const SOUND_WORKER_SRC = `
self.onmessage = (e) => {
  const { id, data, rate, buckets } = e.data;
  // Waveform: max absolute value in each bucket.
  const n = data.length, peaks = new Float32Array(buckets);
  const per = Math.max(1, Math.floor(n / buckets));
  for (let b = 0; b < buckets; b++) { let m = 0; const s = b * per, end = Math.min(n, s + per); for (let i = s; i < end; i += 4) { const v = Math.abs(data[i]); if (v > m) m = v; } peaks[b] = m; }
  // Beats: energy jumps compared with the recent average.
  const hop = 1024, frames = Math.floor(n / hop), en = new Float32Array(frames);
  for (let f = 0; f < frames; f++) { let s = 0; for (let i = 0; i < hop; i++) { const v = data[f * hop + i]; s += v * v; } en[f] = s / hop; }
  const beats = []; const win = Math.round(rate / hop * 1.0); let last = -1e9;
  for (let f = 1; f < frames; f++) {
    let avg = 0, c = 0; for (let k = Math.max(0, f - win); k < f; k++) { avg += en[k]; c++; } avg /= Math.max(1, c);
    const t = f * hop / rate;
    if (en[f] > avg * 1.6 && en[f] > en[f - 1] && en[f] > 1e-4 && t - last > 0.28) { beats.push(t); last = t; }
  }
  self.postMessage({ id, peaks, beats });
};`;

const Sound = {
  worker: null, jobs: new Map(), cache: new Map(), sources: [],
  getWorker() {
    if (!this.worker) {
      this.worker = new Worker(URL.createObjectURL(new Blob([SOUND_WORKER_SRC], { type: 'text/javascript' })));
      this.worker.onmessage = (e) => { const j = this.jobs.get(e.data.id); if (j) { this.jobs.delete(e.data.id); j(e.data); } };
    }
    return this.worker;
  },
  // Waveform peaks and beats for a media item (computed once, in the worker).
  analyze(m) {
    if (!m || !m.audio) return Promise.resolve(null);
    if (m._analysis) return m._analysis;
    m._analysis = new Promise((res) => {
      const id = uid('job'), data = new Float32Array(m.audio.getChannelData(0));
      this.jobs.set(id, (r) => { m.peaks = r.peaks; m.beats = r.beats; res(r); });
      this.getWorker().postMessage({ id, data, rate: m.audio.sampleRate, buckets: Math.min(8000, Math.max(200, Math.round(m.audio.duration * 50))) }, [data.buffer]);
    });
    return m._analysis;
  },
  peaks(m) { return this.analyze(m); },

  // Places markers on each detected beat inside a clip.
  async detectBeats(layer) {
    const m = Media.items.get(layer.mediaId); if (!m || !m.audio) { toast('This clip has no readable sound.'); return; }
    await this.analyze(m);
    const speed = (layer.video ? layer.video.speed : layer.audioOpts?.speed) || 1;
    const times = (m.beats || []).map(b => layer.start + (b - (layer.in || 0)) / speed).filter(t => t >= layer.start && t < layer.start + layer.dur);
    App.change(p => { for (const t of times) p.markers.push({ id: uid('mk'), t, label: '', beat: true }); p.markers.sort((a, b) => a.t - b.t); });
    toast(`Added ${times.length} beat markers. Clips snap to them while dragging.`);
    UI.renderTimeline();
  },

  // ---- voice effects and noise reduction (processed copies of the sound) ----
  async processed(m, layer) {
    const voice = layer.voice || 'none', nr = !!layer.denoise;
    if (!m.audio || (voice === 'none' && !nr)) return m.audio;
    const key = m.id + '|' + voice + '|' + nr;
    if (this.cache.has(key)) return this.cache.get(key);
    const job = (async () => {
      let buf = m.audio;
      if (voice === 'chipmunk' || voice === 'deep') buf = pitchShift(buf, voice === 'chipmunk' ? 1.5 : 0.72);
      const sr = buf.sampleRate, ctx = new OfflineAudioContext(buf.numberOfChannels, buf.length, sr);
      const src = ctx.createBufferSource(); src.buffer = buf;
      let node = src;
      const chain = (n) => { node.connect(n); node = n; };
      if (nr) { const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 90; chain(hp); const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 9000; chain(lp); }
      if (voice === 'telephone' || voice === 'radio') {
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = voice === 'telephone' ? 1500 : 1100; bp.Q.value = voice === 'telephone' ? 1.2 : 0.8; chain(bp);
        if (voice === 'radio') { const sh = ctx.createWaveShaper(); const c = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; c[i] = Math.tanh(x * 2.5); } sh.curve = c; chain(sh); }
      }
      if (voice === 'robot') {
        const g = ctx.createGain(); g.gain.value = 0; const osc = ctx.createOscillator(); osc.frequency.value = 55; osc.connect(g.gain); osc.start(); chain(g);
      }
      node.connect(ctx.destination);
      if (voice === 'echo' || voice === 'hall') {
        const d = ctx.createDelay(2); d.delayTime.value = voice === 'echo' ? 0.28 : 0.09; const fb = ctx.createGain(); fb.gain.value = voice === 'echo' ? 0.42 : 0.6;
        const wet = ctx.createGain(); wet.gain.value = voice === 'echo' ? 0.6 : 0.45;
        node.connect(d); d.connect(fb); fb.connect(d); d.connect(wet); wet.connect(ctx.destination);
      }
      src.start();
      let out = await ctx.startRendering();
      if (nr) out = noiseGate(out);
      return out;
    })();
    this.cache.set(key, job);
    return job;
  },

  // ---- gain over time: volume keyframes, fades and ducking ------------------
  // Returns the gain at layer time lt.
  gainAt(layer, lt, project) {
    let g = clamp(evalProp(layer, 'volume', lt) ?? 100, 0, 400) / 100;
    const fi = layer.fadeIn || 0, fo = layer.fadeOut || 0;
    if (fi > 0 && lt < fi) g *= lt / fi;
    if (fo > 0 && lt > layer.dur - fo) g *= Math.max(0, (layer.dur - lt) / fo);
    if (!layer.duck && project.layers.some(v => v.duck)) {
      const T = layer.start + lt, amt = Math.pow(10, -(project.duckDb ?? 12) / 20);
      let duck = 1;
      for (const v of project.layers) {
        if (!v.duck || v.muted) continue;
        const a = v.start, b = v.start + v.dur, ramp = 0.25;
        if (T > a - ramp && T < b + ramp) { const k = T < a ? (a - T) / ramp : T > b ? (T - b) / ramp : 0; duck = Math.min(duck, lerp(amt, 1, clamp(k, 0, 1))); }
      }
      g *= duck;
    }
    return g;
  },
  // Gain values sampled every 20 ms from layer time t0 to t1.
  gainCurve(layer, t0, t1, project) {
    const n = Math.max(2, Math.ceil((t1 - t0) * 50));
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = this.gainAt(layer, t0 + (t1 - t0) * i / (n - 1), project);
    return out;
  },
  audible(layer, project) {
    if (layer.hidden || layer.muted) return false;
    if (layer.type !== 'video' && layer.type !== 'audio') return false;
    const t = (project.tracks || []).find(t => t.id === layer.track);
    const solo = (project.tracks || []).some(x => x.solo);
    return !(t && (t.muted || t.hidden || (solo && !t.solo)));
  },

  // ---- playback ---------------------------------------------------------------
  start(p, T) {
    const ctx = Media.getAudioCtx(); if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();
    const now = ctx.currentTime + 0.05;
    for (const layer of p.layers) {
      const m = Media.items.get(layer.mediaId);
      if (!m || !m.audio || !this.audible(layer, p)) continue;
      const end = layer.start + layer.dur; if (end <= T) continue;
      const speed = (layer.type === 'video' ? layer.video.speed : layer.audioOpts?.speed) || 1;
      if (layer.video && layer.video.freeze != null) continue;
      const startAt = Math.max(T, layer.start);
      const lt0 = startAt - layer.start;
      const offset = (layer.in || 0) + lt0 * speed;
      const key = m.id + '|' + (layer.voice || 'none') + '|' + !!layer.denoise;
      const cached = this.cache.get(key);
      const buf = (layer.voice && layer.voice !== 'none') || layer.denoise ? (cached && cached._done ? cached._val : null) : m.audio;
      if (!buf) { const pr = this.processed(m, layer); pr.then(v => { pr._done = true; pr._val = v; }); }
      const src = ctx.createBufferSource(); src.buffer = buf || m.audio; src.playbackRate.value = speed;
      const g = ctx.createGain();
      const curve = this.gainCurve(layer, lt0, layer.dur, p);
      try { g.gain.setValueCurveAtTime(curve, now + (startAt - T), Math.max(0.01, layer.dur - lt0)); } catch (e) { g.gain.value = curve[0]; }
      src.connect(g).connect(ctx.destination);
      try { src.start(now + (startAt - T), offset, (end - startAt) * speed); this.sources.push(src); } catch (e) { }
    }
  },
  stop() { for (const s of this.sources) { try { s.stop(); } catch (e) { } } this.sources = []; },

  // ---- export: everything mixed down to one stereo buffer ---------------------
  async mix(p) {
    const layers = p.layers.filter(l => this.audible(l, p) && Media.items.get(l.mediaId)?.audio && !(l.video && l.video.freeze != null));
    if (!layers.length) return null;
    const sr = 48000, len = Math.ceil(p.duration * sr);
    const ctx = new OfflineAudioContext(2, len, sr);
    for (const layer of layers) {
      const m = Media.items.get(layer.mediaId);
      const speed = (layer.type === 'video' ? layer.video.speed : layer.audioOpts?.speed) || 1;
      const src = ctx.createBufferSource(); src.buffer = await this.processed(m, layer); src.playbackRate.value = speed;
      const g = ctx.createGain();
      try { g.gain.setValueCurveAtTime(this.gainCurve(layer, 0, layer.dur, p), layer.start, Math.max(0.01, layer.dur)); } catch (e) { g.gain.value = (layer.volume ?? 100) / 100; }
      src.connect(g).connect(ctx.destination);
      src.start(layer.start, layer.in || 0, layer.dur * speed);
    }
    return await ctx.startRendering();
  }
};

// Simple pitch shift that keeps the length: resample short overlapping
// grains (50 ms) and cross-fade them. Good enough for voice effects.
function pitchShift(buf, ratio) {
  const sr = buf.sampleRate, n = buf.length, ch = buf.numberOfChannels;
  const out = new AudioBuffer({ length: n, numberOfChannels: ch, sampleRate: sr });
  const G = Math.round(sr * 0.05), H = G >> 1;
  const win = new Float32Array(G); for (let i = 0; i < G; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (G - 1));
  for (let c = 0; c < ch; c++) {
    const x = buf.getChannelData(c), y = out.getChannelData(c);
    for (let s = 0; s + G < n; s += H) {
      for (let i = 0; i < G; i++) {
        const pos = s + i * ratio, i0 = Math.floor(pos);
        // Read from a grain centred on s so long sounds don't drift.
        const j = s + ((pos - s) % G); const k = Math.floor(j);
        const v = k + 1 < n ? x[k] + (x[k + 1] - x[k]) * (j - k) : 0;
        y[s + i] += v * win[i];
      }
    }
  }
  return out;
}
// Lowers quiet background hiss: anything under the noise floor is turned down.
function noiseGate(buf) {
  const sr = buf.sampleRate, n = buf.length, ch = buf.numberOfChannels, W = Math.round(sr * 0.02);
  const frames = Math.ceil(n / W), rms = new Float32Array(frames);
  const d0 = buf.getChannelData(0);
  for (let f = 0; f < frames; f++) { let s = 0; for (let i = f * W; i < Math.min(n, (f + 1) * W); i++) s += d0[i] * d0[i]; rms[f] = Math.sqrt(s / W); }
  const sorted = Array.from(rms).sort((a, b) => a - b), floor = sorted[Math.floor(sorted.length * 0.15)] || 0;
  const thr = floor * 2.5 + 1e-4;
  const gains = new Float32Array(frames); let g = 1;
  for (let f = 0; f < frames; f++) { const tgt = rms[f] > thr ? 1 : 0.15; g += (tgt - g) * (tgt > g ? 0.6 : 0.15); gains[f] = g; }
  const out = new AudioBuffer({ length: n, numberOfChannels: ch, sampleRate: sr });
  for (let c = 0; c < ch; c++) { const x = buf.getChannelData(c), y = out.getChannelData(c); for (let i = 0; i < n; i++) y[i] = x[i] * gains[Math.floor(i / W)]; }
  return out;
}

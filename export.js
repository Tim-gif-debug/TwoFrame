// ===========================================================================
// Playback and export
// ===========================================================================

const Player = {
  playing: false,
  startWall: 0, startT: 0,
  sources: [],
  raf: 0,

  async play() {
    const p = App.project; if (!p || this.playing) return;
    if (App.time >= p.duration - 1 / p.fps) App.time = 0;
    this.playing = true; App.setPreviewQuality();
    this.startT = App.time; this.startWall = performance.now();
    this.startAudio(p, App.time);
    this.syncVideos(p, App.time, true);
    const tick = async () => {
      if (!this.playing) return;
      let T = this.startT + (performance.now() - this.startWall) / 1000;
      if (T >= p.duration) {
        if (App.loop) { this.stopAudio(); this.startT = 0; this.startWall = performance.now(); T = 0; this.startAudio(p, 0); this.syncVideos(p, 0, true); }
        else { this.pause(); App.setTime(p.duration - 1 / p.fps); return; }
      }
      App.time = T;
      this.syncVideos(p, T, false);
      try { await Renderer.frame(p, T, 'play'); } catch (e) { console.warn(e); }
      UI.updatePlayhead();
      this.raf = requestAnimationFrame(tick);
    };
    UI.updateTransport();
    this.raf = requestAnimationFrame(tick);
  },

  pause() {
    if (!this.playing) return;
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.stopAudio();
    for (const r of Runtime.map.values()) if (r.video) r.video.pause();
    const p = App.project;
    if (p) App.time = Math.round(App.time * p.fps) / p.fps;
    UI.updateTransport();
    App.requestRender();
  },

  toggle() { this.playing ? this.pause() : this.play(); },

  // J / K / L shuttle like a pro editor: L plays forward (press again for
  // 2x, 4x, 8x), J plays backward the same way, K stops. Normal 1x forward
  // uses regular playback with sound; other speeds step frames silently.
  shuttle: 0, _shRaf: 0,
  shuttleBy(dir) {
    const s = this.shuttle;
    this.shuttle = dir > 0 ? (s <= 0 ? 1 : Math.min(8, s * 2)) : (s >= 0 ? -1 : Math.max(-8, s * 2));
    cancelAnimationFrame(this._shRaf);
    if (this.shuttle === 1) { this.play(); return; }
    this.pause();
    let last = performance.now();
    const step = (now) => {
      if (!this.shuttle || this.playing) return;
      const p = App.project; if (!p) return;
      const T = App.time + (now - last) / 1000 * this.shuttle; last = now;
      if (T <= 0 || T >= p.duration - 1 / p.fps) { App.setTime(clamp(T, 0, p.duration)); this.shuttle = 0; return; }
      App.setTime(T);
      this._shRaf = requestAnimationFrame(step);
    };
    this._shRaf = requestAnimationFrame(step);
  },
  stopShuttle() { this.shuttle = 0; cancelAnimationFrame(this._shRaf); this.pause(); },

  // Keep each video element running near the time the timeline needs.
  syncVideos(p, T, force) {
    for (const layer of p.layers) {
      if (layer.type !== 'video') continue;
      const r = Runtime.get(layer); const v = r.video; if (!v) continue;
      const active = !layer.hidden && T >= layer.start && T < layer.start + layer.dur && layer.video.freeze == null;
      if (!active) { if (!v.paused) v.pause(); continue; }
      const speed = (layer.video.speed || 1) * (layer.video.curve ? curveIntegral(layer.video.curve, 1) : 1);
      const src = srcTimeFor(layer, T - layer.start);
      if (layer.video.reverse) { if (!v.paused) v.pause(); if (Math.abs(v.currentTime - src) > 0.04) v.currentTime = src; continue; }
      const rate = clamp(speed, 0.0625, 16);
      if (Math.abs(v.playbackRate - rate) > 1e-3) v.playbackRate = rate;
      if (v.paused || force || Math.abs(v.currentTime - src) > 0.25) {
        v.currentTime = src;
        if (v.paused) v.play().catch(() => {});
      }
    }
  },

  startAudio(p, T) { Sound.start(p, T); },
  stopAudio() { Sound.stop(); }
};

// ---- Export --------------------------------------------------------------
async function pickVideoCodec(W, H, fps, bitrate) {
  const list = ['avc1.640034', 'avc1.640033', 'avc1.640028', 'avc1.4d0028', 'avc1.42e01f'];
  for (const codec of list) {
    try {
      const s = await VideoEncoder.isConfigSupported({ codec, width: W, height: H, bitrate, framerate: fps });
      if (s.supported) return codec;
    } catch (e) { }
  }
  return null;
}

const Exporter = {
  busy: false, cancel: false,
  async run(p, opts, onProgress) {
    await Fonts.ready(p);
    const fps = opts.fps || p.fps;
    const even = (n) => Math.max(2, Math.round(n / 2) * 2);
    // Resolution: the short side becomes 720, 1080, 1440 (2K) or 2160 (4K).
    const k = opts.short ? opts.short / Math.min(p.width, p.height) : (opts.scale || 1);
    const W = even(p.width * k), H = even(p.height * k);
    if (!('VideoEncoder' in window) || opts.forceRecorder) return await this.runRecorder(p, { ...opts, fps, W, H }, onProgress);
    this.busy = true; this.cancel = false;
    const bitrate = Math.round(W * H * fps * (opts.quality === 'high' ? 0.2 : 0.1));
    const codec = await pickVideoCodec(W, H, fps, bitrate);
    if (!codec) { this.busy = false; throw new Error(`H.264 at ${W}×${H} isn’t supported on this device. Try a lower resolution.`); }

    // Audio: AAC first (plays everywhere, including iPhone Photos), Opus as a fallback.
    let audioBuf = null, audioOk = false, aCodec = null;
    if (opts.audio !== false) {
      try { audioBuf = await Sound.mix(p); } catch (e) { console.warn('audio mix failed', e); }
      if (audioBuf && 'AudioEncoder' in window) {
        for (const [enc, mux] of [['mp4a.40.2', 'aac'], ['opus', 'opus']]) {
          try { if ((await AudioEncoder.isConfigSupported({ codec: enc, sampleRate: 48000, numberOfChannels: 2, bitrate: 192000 })).supported) { aCodec = [enc, mux]; break; } } catch (e) { }
        }
        audioOk = !!aCodec;
      }
    }

    const target = new Mp4Muxer.ArrayBufferTarget();
    const muxer = new Mp4Muxer.Muxer({
      target,
      video: { codec: 'avc', width: W, height: H, frameRate: fps },
      audio: audioOk ? { codec: aCodec[1], numberOfChannels: 2, sampleRate: 48000 } : undefined,
      fastStart: 'in-memory',
      firstTimestampBehavior: 'offset'
    });
    let encErr = null;
    const venc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: (e) => { encErr = e; } });
    venc.configure({ codec, width: W, height: H, bitrate, framerate: fps, avc: { format: 'avc' } });

    await Renderer._lock;
    const prevSize = [engine.width, engine.height];
    engine.setSize(W, H, p.width, p.height);
    Runtime.clearCaches();
    const N = Math.max(1, Math.round(p.duration * fps));
    try {
      for (let i = 0; i < N; i++) {
        if (this.cancel) throw new Error('Export cancelled');
        if (encErr) throw encErr;
        await Renderer.frame(p, i / fps, 'exact', () => {
          const vf = new VideoFrame(engine.canvas, { timestamp: Math.round(i * 1e6 / fps), duration: Math.round(1e6 / fps) });
          venc.encode(vf, { keyFrame: i % Math.round(fps * 2) === 0 });
          vf.close();
        });
        while (venc.encodeQueueSize > 4) await sleep(4);
        onProgress((i + 1) / N * (audioOk ? 0.95 : 1));
      }
      await venc.flush();
      if (encErr) throw encErr;

      if (audioOk && audioBuf) {
        const aenc = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: (e) => { encErr = e; } });
        aenc.configure({ codec: aCodec[0], sampleRate: 48000, numberOfChannels: 2, bitrate: 192000 });
        const ch0 = audioBuf.getChannelData(0), ch1 = audioBuf.numberOfChannels > 1 ? audioBuf.getChannelData(1) : ch0;
        const step = 4800;
        for (let off = 0; off < audioBuf.length; off += step) {
          const n = Math.min(step, audioBuf.length - off);
          const data = new Float32Array(n * 2);
          data.set(ch0.subarray(off, off + n), 0); data.set(ch1.subarray(off, off + n), n);
          const ad = new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round(off / 48000 * 1e6), data });
          aenc.encode(ad); ad.close();
          if (aenc.encodeQueueSize > 16) await sleep(2);
        }
        await aenc.flush();
        if (encErr) throw encErr;
      }
      muxer.finalize();
      onProgress(1);
      return { blob: new Blob([target.buffer], { type: 'video/mp4' }), W, H, codec, audio: audioOk, audioCodec: aCodec ? aCodec[1] : null, hadAudio: !!audioBuf, method: 'WebCodecs (H.264' + (audioOk ? (aCodec[1] === 'aac' ? ' + AAC' : ' + Opus') : '') + ')' };
    } finally {
      try { venc.close(); } catch (e) { }
      this.busy = false;
      engine.setSize(prevSize[0], prevSize[1], p.width, p.height);
      Runtime.clearCaches();
    }
  }
};

// Saving order: the Claude artifact host's download capability (when the
// page runs as a claude.ai artifact), then the share sheet, then a plain
// browser download (GitHub Pages and other normal hosting).
let _claudeDownloads;
async function claudeDownloads() {
  if (_claudeDownloads !== undefined) return _claudeDownloads;
  _claudeDownloads = null;
  try { if (window.claude && typeof window.claude.use === 'function') _claudeDownloads = await window.claude.use('downloads'); } catch (e) { _claudeDownloads = null; }
  return _claudeDownloads;
}
// Fallback when WebCodecs is missing: record the canvas in real time with
// MediaRecorder. Frames are rendered one by one and held on screen for one
// frame's duration, so slow renders make the export take longer (not choppier).
Exporter.runRecorder = async function (p, o, onProgress) {
  if (!('MediaRecorder' in window) || !engine.canvas.captureStream) throw new Error('This browser can’t export video (no WebCodecs and no MediaRecorder).');
  const types = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
  const mime = types.find(t => MediaRecorder.isTypeSupported(t)) || '';
  this.busy = true; this.cancel = false;
  const prevSize = [engine.width, engine.height];
  engine.setSize(o.W, o.H, p.width, p.height); Runtime.clearCaches();
  const stream = engine.canvas.captureStream(0), track = stream.getVideoTracks()[0];
  let audioSrc = null;
  if (o.audio !== false) {
    const buf = await Sound.mix(p).catch(() => null);
    if (buf) { const ctx = Media.getAudioCtx(); const dest = ctx.createMediaStreamDestination(); audioSrc = ctx.createBufferSource(); audioSrc.buffer = buf; audioSrc.connect(dest); dest.stream.getAudioTracks().forEach(t => stream.addTrack(t)); }
  }
  const rec = new MediaRecorder(stream, { mimeType: mime || undefined, videoBitsPerSecond: Math.round(o.W * o.H * o.fps * (o.quality === 'high' ? 0.2 : 0.1)) });
  const chunks = []; rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise(r => { rec.onstop = r; });
  const N = Math.max(1, Math.round(p.duration * o.fps));
  try {
    rec.start(1000); if (audioSrc) audioSrc.start();
    const t0 = performance.now();
    for (let i = 0; i < N; i++) {
      if (this.cancel) throw new Error('Export cancelled');
      await Renderer.frame(p, i / o.fps, 'exact', () => { if (track.requestFrame) track.requestFrame(); });
      const due = t0 + (i + 1) * 1000 / o.fps, wait = due - performance.now();
      if (wait > 0) await sleep(wait);
      onProgress((i + 1) / N);
    }
  } finally {
    try { rec.stop(); } catch (e) { } try { audioSrc && audioSrc.stop(); } catch (e) { }
    await done; this.busy = false;
    engine.setSize(prevSize[0], prevSize[1], p.width, p.height); Runtime.clearCaches();
  }
  const type = mime.split(';')[0] || 'video/webm';
  return { blob: new Blob(chunks, { type }), W: o.W, H: o.H, codec: mime, audio: !!audioSrc, hadAudio: !!audioSrc, method: 'MediaRecorder (real-time recording, ' + (type.includes('mp4') ? 'MP4' : 'WebM') + ')', ext: type.includes('mp4') ? 'mp4' : 'webm' };
};

async function saveBlob(blob, name) {
  const dl = await claudeDownloads();
  if (dl) {
    try { await dl.save({ filename: name, data: blob }); return 'saved'; }
    catch (e) {
      if (e && e.code === 'declined') return 'cancelled';
      if (e && e.code === 'rate_limited') { toast('A save prompt is already open.'); return 'cancelled'; }
      if (e && e.code === 'too_large') { toast('That file is too big to save here. Try a smaller export.'); return 'cancelled'; }
      if (e && (e.code === 'rejected_extension' || e.code === 'extension_not_enabled')) return 'failed';
    }
  }
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return 'shared'; }
    catch (e) { if (e.name === 'AbortError') return 'cancelled'; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 8000);
  return 'downloaded';
}

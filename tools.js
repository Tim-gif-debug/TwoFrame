// ===========================================================================
// Editing tools:
//   motion tracking (pin a layer to a moving point), stabilise, follow /
//   reframe, per-layer motion blur, Ken Burns, split-screen and picture-in-
//   picture layouts, extract audio, replace media, scene detection, beat
//   sync, auto enhance, copy and paste a colour grade, effect Mix sliders,
//   30 more transitions, and the panels for charts, shapes and text boxes.
// ===========================================================================
TRANSITIONS.push(...[
  ['pushDiag', 'Push Diagonal', 34, 'Slide'], ['slideOverL', 'Slide Over Left', 61, 'Slide'], ['slideOverU', 'Slide Over Up', 62, 'Slide'], ['stripes', 'Sliding Stripes', 55, 'Slide'], ['splitH', 'Split Up and Down', 41, 'Slide'], ['splitV', 'Split Left and Right', 42, 'Slide'], ['fall', 'Fall Away', 46, 'Slide'],
  ['wipeDiag', 'Diagonal Wipe', 35, 'Wipe'], ['clockCCW', 'Clock Wipe Reverse', 36, 'Wipe'], ['venetianH', 'Venetian Blinds', 37, 'Wipe'], ['checker', 'Checker Wipe', 38, 'Wipe'], ['barnV', 'Barn Doors', 40, 'Wipe'], ['scanWipe', 'Scan Line Wipe', 59, 'Wipe'],
  ['heart', 'Heart', 39, 'Shape'], ['tiles', 'Shrinking Tiles', 54, 'Shape'], ['shrink', 'Shrink Away', 63, 'Shape'],
  ['cube', 'Cube Turn', 43, 'Camera'], ['flipV', 'Flip', 44, 'Camera'], ['roll', 'Page Roll', 45, 'Camera'], ['dolly', 'Zoom Through', 47, 'Camera'], ['swirl', 'Swirl', 48, 'Camera'], ['spinBlur', 'Spin Blur', 60, 'Camera'], ['shakeCut', 'Shake Cut', 56, 'Camera'],
  ['wave', 'Wave', 49, 'Effects'], ['burn', 'Film Burn', 50, 'Effects'], ['leak', 'Light Leak', 51, 'Effects'], ['dreamy', 'Dreamy Glow', 52, 'Effects'], ['tvoff', 'TV Off and On', 53, 'Effects'], ['pinkFlash', 'Colour Flash', 57, 'Effects'], ['invertFlash', 'Invert Flash', 58, 'Effects']
].map(([id, name, mode, cat]) => ({ id, name, mode, cat })));

// ---- motion tracking ------------------------------------------------------------
const Tracker = {
  cancel: false,
  // Follows a small patch of the video through the whole clip. P is the
  // tapped point in project pixels. Saves one [x, y] per frame on the layer.
  async run(l, P, onProgress) {
    const m = Media.items.get(l.mediaId), r = Runtime.get(l), v = r.video, p = App.project;
    if (!m || !v) throw new Error('Tracking needs a video clip.');
    const tr = worldTransform(l, App.time - l.start, p.layers), [u0, v0] = UI.toContent(tr, m.w, m.h, P[0], P[1]);
    if (u0 < 0 || v0 < 0 || u0 > m.w || v0 > m.h) throw new Error('Tap a spot inside the video.');
    const S = 320 / Math.max(m.w, m.h), cw = Math.round(m.w * S), ch = Math.round(m.h * S), half = 10, search = 16;
    const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch; const ctx = cv.getContext('2d', { willReadFrequently: true });
    const fps = p.fps, N = Math.max(1, Math.floor(l.dur * fps)), f0 = clamp(Math.round((App.time - l.start) * fps), 0, N - 1);
    const gray = async (f) => { await seekVideo(v, srcTimeFor(l, (f + 0.5) / fps)); ctx.drawImage(v, 0, 0, cw, ch); const d = ctx.getImageData(0, 0, cw, ch).data, g = new Float32Array(cw * ch); for (let i = 0; i < g.length; i++) g[i] = d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11; return g; };
    const patch = (g, x, y) => { const o = new Float32Array((half * 2 + 1) ** 2); let k = 0; for (let j = -half; j <= half; j++) for (let i = -half; i <= half; i++) o[k++] = g[clamp(Math.round(y) + j, 0, ch - 1) * cw + clamp(Math.round(x) + i, 0, cw - 1)]; return o; };
    const find = (g, tpl, x, y) => { let best = 1e18, bx = x, by = y; for (let dy = -search; dy <= search; dy++) for (let dx = -search; dx <= search; dx++) { const cx = Math.round(x) + dx, cy = Math.round(y) + dy; if (cx < 0 || cy < 0 || cx >= cw || cy >= ch) continue; let s = 0, k = 0;
      for (let j = -half; j <= half && s < best; j++) { const row = clamp(cy + j, 0, ch - 1) * cw; for (let i = -half; i <= half; i++) s += Math.abs(g[row + clamp(cx + i, 0, cw - 1)] - tpl[k++]); } s += (dx * dx + dy * dy) * 0.5; if (s < best) { best = s; bx = cx; by = cy; } } return [bx, by, best / tpl.length]; };
    const prevBusy = Exporter.busy; await Renderer._lock; Exporter.busy = true; this.cancel = false;
    const pts = new Array(N).fill(null); let lost = 0;
    try {
      const g0 = await gray(f0); const tpl0 = patch(g0, u0 * S, v0 * S);
      pts[f0] = [u0, v0];
      for (const dir of [1, -1]) {
        let x = u0 * S, y = v0 * S, vx = 0, vy = 0, tpl = tpl0.slice();
        for (let f = f0 + dir; f >= 0 && f < N; f += dir) {
          if (this.cancel) throw new Error('Tracking cancelled.');
          // Look where the point should be if it keeps moving the same way.
          const g = await gray(f), px = clamp(x + vx, 0, cw - 1), py = clamp(y + vy, 0, ch - 1), [bx, by, score] = find(g, tpl, px, py);
          if (score < 34) { vx = (bx - x) * 0.7 + vx * 0.3; vy = (by - y) * 0.7 + vy * 0.3; x = bx; y = by; const np = patch(g, x, y); for (let i = 0; i < tpl.length; i++) tpl[i] = tpl[i] * 0.92 + np[i] * 0.08; } else { lost++; vx *= 0.5; vy *= 0.5; }
          pts[f] = [Math.round(x / S * 10) / 10, Math.round(y / S * 10) / 10];
          onProgress && onProgress((dir > 0 ? f - f0 : N - f0 + f0 - f) / N);
          if (f % 8 === 0) await sleep(0);
        }
      }
    } finally { Exporter.busy = prevBusy; }
    App._label = 'Track motion';
    App.change(() => { l.trackData = { fps, pts }; });
    App.requestRender();
    return { frames: N, lost };
  },
  // Where the tracked point is on screen at layer frame f.
  world(l, f) { const m = Media.items.get(l.mediaId), d = l.trackData, q = d.pts[clamp(f, 0, d.pts.length - 1)]; return UI.toWorld(worldTransform(l, f / d.fps, App.project.layers), m.w, m.h, q[0], q[1]); },
  smooth(pts, win) { return pts.map((_, i) => { let x = 0, y = 0, n = 0; for (let k = -win; k <= win; k++) { const q = pts[clamp(i + k, 0, pts.length - 1)]; x += q[0]; y += q[1]; n++; } return [x / n, y / n]; }); },
  // Pins another layer to the tracked point by writing position keyframes.
  pin(l, target, offset = [0, 0]) {
    const d = l.trackData, p = App.project, step = Math.max(1, Math.round(d.fps / 15)); if (!d) return;
    App._label = 'Pin to track';
    App.change(() => {
      const kx = [], ky = [];
      for (let f = 0; f < d.pts.length; f += step) { const t = l.start + f / d.fps - target.start; if (t < -1e-6 || t > target.dur + 1e-6) continue; const w = this.world(l, f); kx.push({ t: Math.max(0, t), v: Math.round((w[0] + offset[0]) * 10) / 10, e: 'linear' }); ky.push({ t: Math.max(0, t), v: Math.round((w[1] + offset[1]) * 10) / 10, e: 'linear' }); }
      if (!kx.length) return; target.keys = target.keys || {}; target.keys['transform.x'] = kx; target.keys['transform.y'] = ky; delete target.parent;
    });
    UI.refresh();
  },
  // Light stabiliser: cancels the shake of the tracked point and zooms in a little to hide the edges.
  stabilize(l, win = 12) {
    const d = l.trackData, m = Media.items.get(l.mediaId); if (!d) return;
    const sm = this.smooth(d.pts, win), tr = evalTransform(l, 0), base = { x: getPath(l, 'transform.x'), y: getPath(l, 'transform.y'), s: getPath(l, 'transform.scale') };
    let maxd = 0; const del = d.pts.map((q, i) => { const dx = q[0] - sm[i][0], dy = q[1] - sm[i][1]; maxd = Math.max(maxd, Math.abs(dx) / m.w, Math.abs(dy) / m.h); return [dx, dy]; });
    const zoom = 1 + maxd * 2.2, s = base.s * zoom / 100;
    App._label = 'Stabilise';
    App.change(() => { l.keys = l.keys || {}; l.transform.scale = Math.round(base.s * zoom * 10) / 10; delete l.keys['transform.scale'];
      l.keys['transform.x'] = del.map((q, i) => ({ t: i / d.fps, v: Math.round((base.x - q[0] * s) * 10) / 10, e: 'linear' })); l.keys['transform.y'] = del.map((q, i) => ({ t: i / d.fps, v: Math.round((base.y - q[1] * s) * 10) / 10, e: 'linear' })); });
    UI.refresh(); return zoom;
  },
  // Keeps the tracked subject in the middle of the frame (auto reframe).
  follow(l, win = 10) {
    const d = l.trackData, m = Media.items.get(l.mediaId), p = App.project; if (!d) return;
    const sm = this.smooth(d.pts, win), s = Math.max(getPath(l, 'transform.scale') / 100, p.width / m.w, p.height / m.h);
    const lim = (v, size, full) => { const room = Math.max(0, (size * s - full) / 2); return clamp(v, full / 2 - room, full / 2 + room); };
    App._label = 'Follow subject';
    App.change(() => { l.keys = l.keys || {}; l.transform.scale = Math.round(s * 1000) / 10; l.transform.rotation = 0;
      l.keys['transform.x'] = sm.map((q, i) => ({ t: i / d.fps, v: Math.round(lim(p.width / 2 - (q[0] - m.w / 2) * s, m.w, p.width) * 10) / 10, e: 'linear' })).filter((_, i) => i % 2 === 0);
      l.keys['transform.y'] = sm.map((q, i) => ({ t: i / d.fps, v: Math.round(lim(p.height / 2 - (q[1] - m.h / 2) * s, m.h, p.height) * 10) / 10, e: 'linear' })).filter((_, i) => i % 2 === 0); });
    UI.refresh();
  }
};

// ---- per-layer motion blur ----------------------------------------------------------
// Draws the layer several times across the shutter time and averages them.
// Shown when paused and in the export; skipped during playback to stay smooth.
(() => {
  const once = Renderer.renderLayer;
  Renderer.renderLayer = async function (layer, contentT, transformT, mode, target, list) {
    const mb = layer.mblur;
    if (!mb || !mb.on || this._mb || mode === 'play') return once.call(this, layer, contentT, transformT, mode, target, list);
    const fps = this.project.fps, span = clamp(mb.shutter ?? 180, 1, 720) / 360 / fps, n = clamp(Math.round(mb.samples || 8), 2, 24), ls = list || this.project.layers;
    const a = worldTransform(layer, transformT, ls), b = worldTransform(layer, transformT - span, ls);
    if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) < 0.5 && Math.abs(a.scale - b.scale) < 0.05 && Math.abs(a.rotation - b.rotation) < 0.05) return once.call(this, layer, contentT, transformT, mode, target, list);
    this._mb = true;
    try {
      let acc = this.R('mb_a'), tmp = this.R('mb_b'); const s = this.R('mb_s');
      for (let i = 0; i < n; i++) { await once.call(this, layer, contentT, transformT - span * i / (n - 1), mode, s, list); if (!i) engine.copy(s, acc); else { engine.mix(acc, s, 1 / (i + 1), tmp); [acc, tmp] = [tmp, acc]; } }
      engine.copy(acc, target);
    } finally { this._mb = false; }
    return target;
  };
})();

// ---- one-tap edits ---------------------------------------------------------------------
Object.assign(App, {
  kenBurns(kind) {
    const l = this.layer(), m = l && Media.items.get(l.mediaId), p = this.project; if (!m || (l.type !== 'image' && l.type !== 'video')) { toast('Select a photo or video clip.'); return; }
    const s0 = Math.max(p.width / m.w, p.height / m.h) * 100, K = (a, b) => [{ t: 0, v: a, e: 'ease' }, { t: l.dur, v: b, e: 'ease' }];
    this._label = 'Ken Burns';
    this.change(() => {
      l.keys = l.keys || {}; l.transform.x = p.width / 2; l.transform.y = p.height / 2; delete l.keys['transform.x']; delete l.keys['transform.y'];
      if (kind === 'in') l.keys['transform.scale'] = K(s0, s0 * 1.25); else if (kind === 'out') l.keys['transform.scale'] = K(s0 * 1.25, s0);
      else { const s = s0 * 1.2; delete l.keys['transform.scale']; l.transform.scale = s; const dx = (m.w * s / 100 - p.width) / 2 * 0.95, dy = (m.h * s / 100 - p.height) / 2 * 0.95;
        if (kind === 'left') l.keys['transform.x'] = K(p.width / 2 + dx, p.width / 2 - dx); if (kind === 'right') l.keys['transform.x'] = K(p.width / 2 - dx, p.width / 2 + dx);
        if (kind === 'up') l.keys['transform.y'] = K(p.height / 2 + dy, p.height / 2 - dy); if (kind === 'down') l.keys['transform.y'] = K(p.height / 2 - dy, p.height / 2 + dy); }
    });
    UI.refresh();
  },
  // Arranges 2 to 4 selected clips into a split-screen layout.
  splitScreen(layout) {
    const p = this.project, ls = Array.from(this.selIds).map(id => this.layer(id)).filter(l => l && (l.type === 'video' || l.type === 'image'));
    const cells = { '2h': [[0, 0, .5, 1], [.5, 0, .5, 1]], '2v': [[0, 0, 1, .5], [0, .5, 1, .5]], '3h': [[0, 0, 1 / 3, 1], [1 / 3, 0, 1 / 3, 1], [2 / 3, 0, 1 / 3, 1]], '3v': [[0, 0, 1, 1 / 3], [0, 1 / 3, 1, 1 / 3], [0, 2 / 3, 1, 1 / 3]], '4': [[0, 0, .5, .5], [.5, 0, .5, .5], [0, .5, .5, .5], [.5, .5, .5, .5]], '1+2': [[0, 0, 1, .6], [0, .6, .5, .4], [.5, .6, .5, .4]] }[layout];
    if (ls.length < 2) { toast('Select 2 to 4 video or photo clips first (Shift-click, or Multi-select on phone).'); return; }
    this._label = 'Split screen';
    this.change(() => {
      const start = Math.min(...ls.map(l => l.start)), dur = Math.min(...ls.map(l => l.dur));
      ls.slice(0, cells.length).forEach((l, i) => {
        const m = Media.items.get(l.mediaId), [cx, cy, cw, ch] = cells[i], W = cw * p.width, H = ch * p.height, s = Math.max(W / m.w, H / m.h);
        l.start = start; l.dur = dur; delete l.transIn; delete l.transOut;
        if (i > 0 || this.track(l.track)?.kind === 'main' && p.magnetic) { const t = { id: uid('t'), name: '', kind: 'overlay', locked: false, muted: false, hidden: false }; p.tracks.push(t); l.track = t.id; }
        l.keys = l.keys || {}; for (const k of ['transform.x', 'transform.y', 'transform.scale', 'crop.l', 'crop.r', 'crop.t', 'crop.b']) delete l.keys[k];
        l.transform.scale = Math.round(s * 1000) / 10; l.transform.rotation = 0; l.transform.x = (cx + cw / 2) * p.width; l.transform.y = (cy + ch / 2) * p.height;
        const fx = Math.max(0, (1 - W / (m.w * s)) / 2), fy = Math.max(0, (1 - H / (m.h * s)) / 2); l.crop = { l: fx, r: fx, t: fy, b: fy };
      });
      this.compactMain(p); this.removeEmptyTracks(p); this.fitDuration(p, true);
    });
    UI.refresh();
  },
  pip(corner, size = 0.32) {
    const l = this.layer(), p = this.project, m = l && Media.items.get(l.mediaId); if (!m) { toast('Select an overlay clip.'); return; }
    const s = Math.min(p.width, p.height) * size / Math.min(m.w, m.h), w = m.w * s, h = m.h * s, mg = Math.min(p.width, p.height) * 0.04;
    const pos = { tl: [mg + w / 2, mg + h / 2], tr: [p.width - mg - w / 2, mg + h / 2], bl: [mg + w / 2, p.height - mg - h / 2], br: [p.width - mg - w / 2, p.height - mg - h / 2], c: [p.width / 2, p.height / 2] }[corner];
    this._label = 'Picture in picture';
    this.change(() => { l.transform.scale = Math.round(s * 1000) / 10; l.transform.x = pos[0]; l.transform.y = pos[1]; for (const k of ['transform.x', 'transform.y', 'transform.scale']) if (l.keys) delete l.keys[k]; });
    UI.refresh();
  },
  extractAudio() {
    const l = this.layer(), m = l && Media.items.get(l.mediaId); if (!l || l.type !== 'video' || !m) { toast('Select a video clip.'); return; }
    if (!m.audio) { toast('This clip has no sound (or it is still loading).'); return; }
    const a = this.baseLayer('audio', l.name + ' (audio)'); a.mediaId = m.id; a.start = l.start; a.dur = l.dur; a.in = l.in || 0; a.audioOpts = { speed: (l.video && l.video.speed) || 1 }; a.volume = l.volume;
    this._label = 'Extract audio';
    this.addLayer(a, { kind: 'audio' }); this.change(() => { const v = this.layer(l.id); a.start = l.start; if (v) v.muted = true; }, ''); this.sel = l.id; UI.refresh(); toast('Sound moved to its own audio clip. The video clip is muted.');
  },
  replaceMedia() {
    const l = this.layer(); if (!l || !l.mediaId) { toast('Select a video, photo or audio clip.'); return; }
    UI.pickFiles(l.type === 'audio' ? 'audio/*' : 'video/*,image/*', async ([f]) => {
      UI.busy('Loading ' + f.name + '…');
      try {
        const m = await Media.importFile(f); if ((m.type === 'audio') !== (l.type === 'audio')) throw new Error('Pick the same kind of file as the clip.');
        Runtime.drop(l.id);
        this._label = 'Replace media';
        this.change(p => { p.library = p.library || []; if (!p.library.includes(m.id)) p.library.push(m.id); const old = Media.items.get(l.mediaId); l.mediaId = m.id; l.type = m.type; l.in = 0; delete l.trackData;
          if (m.type === 'video') { l.video = { speed: 1, interp: 'none', srcFps: m.fps || 30, ...(l.video || {}), freeze: undefined }; delete l.video.freeze; l.dur = Math.min(l.dur, m.duration / (l.video.speed || 1)); } else delete l.video;
          if (old && m.w && old.w) l.transform.scale = Math.round(l.transform.scale * Math.max(old.w / m.w, old.h / m.h) * 10) / 10; this.compactMain(p); });
        Media.makeThumbs(m, () => UI.renderTimeline()); if (m.audioReady) m.audioReady.then(() => Sound.peaks(m).then(() => UI.renderTimeline()));
      } catch (e) { toast(e.message || 'Couldn’t replace the clip.', 4000); }
      UI.busy(null); UI.refresh();
    });
  },
  // Finds hard cuts inside one long clip and splits it there.
  async sceneDetect(sens = 0.5) {
    const l = this.layer(), p = this.project; if (!l || l.type !== 'video') { toast('Select a video clip.'); return; }
    const v = Runtime.get(l).video, cv = document.createElement('canvas'); cv.width = 48; cv.height = 27; const ctx = cv.getContext('2d', { willReadFrequently: true });
    const prevBusy = Exporter.busy; await Renderer._lock; Exporter.busy = true; let stop = false; const cuts = []; let prev = null, last = -9;
    try {
      const step = 1 / 8, n = Math.floor(l.dur / step);
      for (let i = 0; i <= n && !stop; i++) {
        await seekVideo(v, srcTimeFor(l, i * step + 0.5 / p.fps)); ctx.drawImage(v, 0, 0, 48, 27); const d = ctx.getImageData(0, 0, 48, 27).data;
        if (prev) { let s = 0; for (let k = 0; k < d.length; k += 4) s += Math.abs(d[k] - prev[k]) + Math.abs(d[k + 1] - prev[k + 1]) + Math.abs(d[k + 2] - prev[k + 2]); s /= d.length / 4 * 765; if (s > 0.32 - sens * 0.22 && i * step - last > 0.6) { cuts.push(i * step - step / 2); last = i * step; } }
        prev = d; if (i % 6 === 0) { UI.busy(`Looking for cuts… ${Math.round(i / n * 100)}%`, () => { stop = true; }); await sleep(0); }
      }
    } finally { Exporter.busy = prevBusy; UI.busy(null); }
    if (stop) return;
    if (!cuts.length) { toast('No cuts found in this clip.'); return; }
    for (const c of cuts.sort((a, b) => b - a)) { this.sel = l.id; this.time = Math.round((l.start + c) * p.fps) / p.fps; this._label = 'Split at cut'; this.split(); }
    this.sel = l.id; this.selIds = new Set([l.id]); UI.refresh(); toast(`Split at ${cuts.length} cut${cuts.length === 1 ? '' : 's'}.`);
  },
  // Nudges the cuts on the main track onto the nearest beat markers.
  beatSync() {
    const p = this.project, beats = (p.markers || []).filter(m => m.beat).map(m => m.t);
    if (beats.length < 2) { toast('Find the beats first: Audio › select the music › Detect beats.'); return; }
    const main = this.mainTrack(p), clips = p.layers.filter(l => l.track === main.id).sort((a, b) => a.start - b.start); let moved = 0;
    this._label = 'Beat sync';
    this.change(() => { let t = clips.length ? clips[0].start : 0; for (const l of clips) { const end = t + l.dur, nb = beats.reduce((a, b) => Math.abs(b - end) < Math.abs(a - end) ? b : a, beats[0]); let nd = l.dur;
      if (Math.abs(nb - end) < 0.45 && nb - t > 0.3) nd = nb - t; const m = Media.items.get(l.mediaId); if (l.type === 'video' && m && !l.video.curve && l.video.freeze == null) nd = Math.min(nd, (m.duration - (l.in || 0)) / (l.video.speed || 1));
      if (Math.abs(nd - l.dur) > 1e-3) moved++; l.dur = nd; l.start = t; t += l.dur; } this.fitDuration(p); });
    UI.refresh(); toast(moved ? `${moved} cut${moved === 1 ? '' : 's'} moved onto the beat.` : 'The cuts were already on the beat.');
  },
  // Measures the frame under the playhead and sets Auto Enhance to fit it.
  async autoEnhance() {
    const l = this.layer(); if (!l || (l.type !== 'video' && l.type !== 'image')) { toast('Select a video or photo clip.'); return; }
    this.change(() => { l.effects = l.effects.filter(f => f.defId !== 'tf.autoenhance'); }, '');
    await Renderer.frame(this.project, this.time, 'exact'); await Renderer._lock;
    const gl = engine.gl, W = engine.width, H = engine.height, px = new Uint8Array(W * H * 4); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const hist = new Uint32Array(256); let n = 0, sum = 0; const step = Math.max(4, Math.floor(W * H / 40000) * 4);
    for (let i = 0; i < px.length; i += step) { const y = Math.round(px[i] * 0.3 + px[i + 1] * 0.59 + px[i + 2] * 0.11); hist[y]++; n++; sum += y; }
    const pct = (f) => { let a = 0; for (let i = 0; i < 256; i++) { a += hist[i]; if (a >= n * f) return i / 255; } return 1; };
    const black = Math.min(0.35, pct(0.01)), white = Math.max(0.6, pct(0.99)), mean = clamp((sum / n / 255 - black) / Math.max(0.05, white - black), 0.05, 0.95), gam = clamp(Math.log(mean) / Math.log(0.46), 0.7, 1.5);
    this._label = 'Auto enhance';
    this.addEffect('tf.autoenhance'); const f = l.effects.find(x => x.defId === 'tf.autoenhance');
    this.change(() => { Object.assign(f.params, { black: Math.round(black * 1000) / 1000, white: Math.round(white * 1000) / 1000, gam: Math.round(gam * 100) / 100, satur: 1.12 }); }, '');
    UI.refresh(); toast('Auto Enhance added. Fine-tune it under Effects.');
  },
  copyGrade() { const l = this.layer(); if (!l) return; this.gradeClip = deepCopy(l.effects.filter(f => f.filter || EffectLib.get(f.defId)?.category === 'Color')); toast(this.gradeClip.length ? `Copied ${this.gradeClip.length} colour effect${this.gradeClip.length === 1 ? '' : 's'}.` : 'This clip has no colour effects yet.'); },
  pasteGrade() {
    if (!this.gradeClip || !this.gradeClip.length) { toast('Copy a grade first.'); return; }
    const ids = (this.selIds.size ? Array.from(this.selIds) : [this.sel]).filter(Boolean);
    this._label = 'Paste grade';
    this.change(p => { for (const id of ids) { const l = p.layers.find(x => x.id === id); if (!l || l.type === 'audio') continue; l.effects = l.effects.filter(f => !(f.filter || EffectLib.get(f.defId)?.category === 'Color')).concat(deepCopy(this.gradeClip).map(f => ({ ...f, uid: uid('fx') }))); } });
    UI.refresh();
  }
});

// ---- panels ----------------------------------------------------------------------------
Object.assign(UI, {
  panel_track(body, l) {
    if (!l || l.type !== 'video') { body.appendChild(el('p', { class: 'hint' }, 'Select a video clip to track something in it.')); return; }
    const d = l.trackData;
    body.append(el('p', { class: 'hint' }, 'Tracking follows one spot through the clip. Pick something with clear detail, like an eye, a logo or a corner.'),
      el('div', { class: 'btnrow' }, el('button', { class: 'btn primary', onclick: () => {
        if (Layout.mode === 'mobile') this.closeSheet();
        toast('Tap the thing to track on the preview.', 4000);
        this._pick = async (P) => {
          this._pick = null;
          try { const r = await Tracker.run(l, P, (f) => this.busy(`Tracking… ${Math.round(f * 100)}%`, () => { Tracker.cancel = true; })); this.busy(null); toast(`Tracked ${r.frames} frames${r.lost ? `, unsure on ${r.lost}` : ''}.`); }
          catch (e) { this.busy(null); toast(e.message, 4000); }
          this.openTool('track'); this.drawOverlay();
        };
      } }, d ? 'Track a new point' : 'Pick a point to track'), d ? el('button', { class: 'btn', onclick: () => { App.change(() => { delete l.trackData; }); this.refreshPanel(); this.drawOverlay(); } }, 'Clear track') : null));
    if (!d) return;
    const others = App.project.layers.filter(o => o.id !== l.id && VISUAL_TYPES.has(o.type) && o.start < l.start + l.dur && o.start + o.dur > l.start);
    body.appendChild(el('div', { class: 'sect' }, 'Pin a layer to the point'));
    if (!others.length) body.appendChild(el('p', { class: 'hint' }, 'Add text, a sticker or another clip over this video, then pin it here.'));
    else body.appendChild(el('div', { class: 'btnrow' }, others.map(o => el('button', { class: 'btn sm', onclick: () => { Tracker.pin(l, o); toast(`${o.name} now follows the tracked point.`); } }, o.name))));
    body.appendChild(el('div', { class: 'sect' }, 'Use the track on this clip'));
    body.appendChild(el('div', { class: 'btnrow' },
      el('button', { class: 'btn sm', onclick: () => { const z = Tracker.stabilize(l); toast(`Stabilised. Zoomed in ${Math.round((z - 1) * 100)}% to hide the edges.`); } }, 'Stabilise (lite)'),
      el('button', { class: 'btn sm', onclick: () => { Tracker.follow(l); toast('The frame now follows the tracked subject.'); } }, 'Auto reframe (follow)'),
      el('button', { class: 'btn sm', onclick: () => { App.change(() => { for (const k of ['transform.x', 'transform.y']) delete l.keys[k]; l.transform.x = App.project.width / 2; l.transform.y = App.project.height / 2; }); this.refresh(); } }, 'Undo movement')));
    body.appendChild(el('p', { class: 'hint' }, 'Stabilise works from one tracked point, so it steadies shake up, down and sideways but not rotation.'));
  },
  panel_charts(body) {
    body.appendChild(el('p', { class: 'hint' }, 'Animated charts built from your own numbers. Add one, then type or paste “label, value” lines in its Chart tab.'));
    body.appendChild(el('div', { class: 'tools' }, CHART_KINDS.map(([k, n]) => this.toolBtn('keyframe', n, () => App.addChart(k)))));
    body.appendChild(el('div', { class: 'sect' }, 'Keyframe graphs'));
    body.appendChild(el('p', { class: 'hint' }, 'Select a clip and open Keyframe for the value graph, speed graph, ease presets and your saved curves.'));
  },
  chartPanel(body, l) {
    const c = l.chart, set = (k, v) => { App.change(() => { c[k] = v; }, 'chart' + l.id + k); App.requestRender(); };
    for (const k of Object.keys(CHART_DEFAULTS)) if (c[k] === undefined) c[k] = CHART_DEFAULTS[k];
    const txt = (k, label, ph) => this.row(label, el('input', { type: 'text', value: c[k], placeholder: ph || '', onchange: (e) => set(k, e.target.value) }));
    const tog = (k, label) => this.row(label, el('input', { type: 'checkbox', class: 'tog', checked: !!c[k], onchange: (e) => { set(k, e.target.checked); this.refreshPanel(); } }));
    const simple = ['counter', 'progress', 'gauge'].includes(c.kind);
    body.append(this.row('Chart type', el('select', { onchange: (e) => { set('kind', e.target.value); this.refreshPanel(); } }, CHART_KINDS.map(([k, n]) => el('option', { value: k, selected: c.kind === k }, n)))));
    if (simple) body.append(this.propRow(l, 'chart.value', 'Value', { min: -1e9, max: 1e9, smin: 0, smax: Math.max(100, c.max), step: 0.1 }), c.kind !== 'counter' ? this.propRow(l, 'chart.max', 'Full at', { min: 0.001, max: 1e9, smin: 1, smax: 1000, step: 1 }) : '');
    else { const ta = el('textarea', { rows: 6, spellcheck: 'false', style: { width: '100%' }, onchange: (e) => set('data', e.target.value) }); ta.value = c.data; ta.addEventListener('keydown', (e) => e.stopPropagation());
      body.append(el('div', { class: 'sect' }, 'Data'), ta, el('p', { class: 'hint' }, 'One line per item: a label, a comma, then a number. You can paste rows copied from a spreadsheet or a CSV file.')); }
    body.append(txt('title', 'Title'), el('div', { class: 'sect' }, 'Build-in animation'), tog('autoBuild', 'Animate in by itself'));
    if (c.autoBuild) body.append(this.propRow(l, 'chart.buildDur', 'Build time (s)', { min: 0.05, max: 20, smax: 5, step: 0.05 })); else body.append(this.propRow(l, 'chart.progress', 'Progress %', { min: 0, max: 100, step: 0.5 }));
    if (!simple) body.append(this.propRow(l, 'chart.stagger', 'Stagger', { min: 0, max: 3, step: 0.01 }));
    body.append(el('div', { class: 'sect' }, 'Look'), txt('colors', 'Colours', '#14e0c8,#ff4f8b'), el('p', { class: 'hint' }, 'Colours are hex codes separated by commas, one per bar or slice.'),
      this.row('Text colour', el('input', { type: 'color', value: arr2hex(c.text), oninput: (e) => set('text', hex2arr(e.target.value)) })),
      this.row('Font', el('select', { onchange: (e) => { set('font', e.target.value); Fonts.ensure(e.target.value); } }, Fonts.all().map(f => el('option', { value: f, selected: c.font === f }, f)))),
      this.propRow(l, 'chart.fontSize', 'Text size', { min: 6, max: 300, smax: 90, step: 1 }), this.propRow(l, 'chart.w', 'Width', { min: 40, max: 4000, smax: 1920, step: 1 }), this.propRow(l, 'chart.h', 'Height', { min: 40, max: 4000, smax: 1920, step: 1 }));
    if (!simple) body.append(tog('labelsOn', 'Labels'), tog('valuesOn', 'Value tags'), ['pie', 'donut'].includes(c.kind) ? '' : tog('gridOn', 'Gridlines'), this.propRow(l, 'chart.thickness', c.kind === 'donut' ? 'Hole size' : 'Bar thickness', { min: 0.1, max: 1, step: 0.01 }),
      ['line', 'area'].includes(c.kind) ? this.propRow(l, 'chart.lineWidth', 'Line width', { min: 1, max: 40, step: 0.5 }) : '');
    body.append(txt('prefix', 'Before number', '$'), txt('suffix', 'After number', '%'), this.propRow(l, 'chart.decimals', 'Decimals', { min: 0, max: 4, step: 1 }));
  },
  shapeExtras(body, l) {
    const s = l.shape; for (const k of Object.keys(SHAPE_DEFAULTS)) if (s[k] === undefined && SHAPE_DEFAULTS[k] !== null) s[k] = SHAPE_DEFAULTS[k];
    const set = (k, v) => { App.change(() => { s[k] = v; }); this.refreshPanel(); };
    body.append(el('div', { class: 'sect' }, 'More shapes'), el('div', { class: 'btnrow' }, [['arrow', 'Arrow'], ['heart', 'Heart'], ['bubble', 'Speech bubble']].map(([k, n]) => el('button', { class: 'btn sm' + (s.kind === k ? ' on' : ''), onclick: () => set('kind', k) }, n)), el('button', { class: 'btn sm', onclick: () => this.startPen() }, '✎ Pen tool')),
      el('div', { class: 'sect' }, 'Fill and stroke'), this.row('Fill type', el('select', { onchange: (e) => set('fillType', e.target.value) }, [['solid', 'Solid'], ['linear', 'Linear gradient'], ['radial', 'Radial gradient']].map(([v, n]) => el('option', { value: v, selected: s.fillType === v }, n)))));
    if (s.fillType !== 'solid') body.append(this.row('Second colour', el('input', { type: 'color', value: arr2hex(s.fill2), oninput: (e) => { App.change(() => { s.fill2 = hex2arr(e.target.value); }, 'f2' + l.id); } })), s.fillType === 'linear' ? this.propRow(l, 'shape.gradAngle', 'Gradient angle°', { min: -360, max: 360, step: 1 }) : '');
    body.append(this.propRow(l, 'shape.dash', 'Dash length', { min: 0, max: 400, smax: 120, step: 1 }), this.propRow(l, 'shape.gap', 'Dash gap', { min: 0, max: 400, smax: 120, step: 1 }),
      this.row('Line ends', el('select', { onchange: (e) => set('cap', e.target.value) }, [['round', 'Round'], ['butt', 'Flat'], ['square', 'Square']].map(([v, n]) => el('option', { value: v, selected: s.cap === v }, n)))),
      el('div', { class: 'sect' }, 'Modifiers'), this.propRow(l, 'shape.roundCorners', 'Round corners', { min: 0, max: 100, step: 1 }), this.propRow(l, 'shape.zigzag', 'Zig zag size', { min: -200, max: 200, smin: -60, smax: 60, step: 0.5 }), this.propRow(l, 'shape.zigRidges', 'Zig zag ridges', { min: 1, max: 20, step: 1 }),
      this.propRow(l, 'shape.pucker', 'Pucker / bloat', { min: -100, max: 100, step: 0.5 }), this.propRow(l, 'shape.twist', 'Twist°', { min: -720, max: 720, smin: -180, smax: 180, step: 1 }), this.propRow(l, 'shape.wiggle', 'Wiggle paths', { min: 0, max: 200, smax: 60, step: 0.5 }), this.propRow(l, 'shape.wiggleSeed', 'Wiggle seed', { min: 0, max: 999, step: 1 }),
      el('div', { class: 'sect' }, 'Repeater'), this.propRow(l, 'shape.repeat', 'Copies', { min: 1, max: 40, step: 1 }), this.propRow(l, 'shape.repX', 'Offset X', { min: -2000, max: 2000, smin: -300, smax: 300, step: 1 }), this.propRow(l, 'shape.repY', 'Offset Y', { min: -2000, max: 2000, smin: -300, smax: 300, step: 1 }),
      this.propRow(l, 'shape.repRot', 'Rotation per copy°', { min: -360, max: 360, smin: -90, smax: 90, step: 0.5 }), this.propRow(l, 'shape.repScale', 'Scale per copy %', { min: 10, max: 200, smin: 50, smax: 150, step: 0.5 }), this.propRow(l, 'shape.repFade', 'Fade per copy %', { min: 0, max: 100, step: 1 }));
  },
  textBoxExtras(body, l) {
    for (const k of ['boxPct', 'boxHPct', 'autoFit']) if (l.text[k] === undefined) l.text[k] = TEXT_DEFAULTS[k];
    body.append(el('div', { class: 'sect' }, 'Text box (wrapping)'), this.propRow(l, 'text.boxPct', 'Box width % of frame', { min: 0, max: 100, step: 1 }), this.propRow(l, 'text.boxHPct', 'Box height % (0 = any)', { min: 0, max: 100, step: 1 }),
      this.row('Shrink to fit', el('input', { type: 'checkbox', class: 'tog', checked: !!l.text.autoFit, onchange: (e) => { App.change(() => { l.text.autoFit = e.target.checked; }); } })),
      el('p', { class: 'hint' }, 'With a box width set, long text wraps by itself and re-flows when the canvas shape changes. 0 turns the box off.'));
  },
  // Adds a Mix slider to every effect card (also used as filter intensity).
  mixSliders(body, l) {
    const cards = $$('.fxcard', body), fxs = l.effects; if (cards.length !== fxs.length) return;
    cards.forEach((card, i) => { const f = fxs[i], def = EffectLib.get(f.defId); if (!def || def.kind !== 'shader') return;
      const out = el('span', { class: 'hint' }, Math.round((f.mix ?? 1) * 100) + '%');
      card.appendChild(el('div', { class: 'prop mixrow' }, el('span', { class: 'kbtn', style: { visibility: 'hidden' } }), el('span', { class: 'plabel' }, 'Mix'), el('input', { type: 'range', min: 0, max: 100, step: 1, value: Math.round((f.mix ?? 1) * 100), oninput: (e) => { App.change(() => { f.mix = +e.target.value / 100; }, 'mix' + f.uid); out.textContent = e.target.value + '%'; } }), out)); });
  }
});
(() => {
  const clipTools = UI.clipTools, stylePanel = UI.panel_style, fxPanel = UI.panel_fx, stickers = UI.panel_stickers, filters = UI.panel_filters, transformPanel = UI.panel_transform, layerPanel = UI.panel_layer, speedPanel = UI.panel_speed, audioPanel = UI.panel_audio;
  UI.clipTools = function (l) {
    const t = clipTools.call(this, l); if (!l) return t;
    const at = (id, entry) => { const i = t.findIndex(x => x[0] === id); t.splice(i < 0 ? t.length : i + 1, 0, entry); };
    if (l.type === 'chart') at('fx', ['style', 'Chart', 'keyframe']);
    if (l.type === 'video' || l.type === 'image') at('fx', ['retouch', 'Retouch', 'filter']);
    if (l.type === 'video') at('speed', ['track', 'Track', 'marker']);
    if (l.type === 'video' || l.type === 'audio') at('volume', ['sound', 'Sound FX', 'audio']);
    return t;
  };
  UI.panel_style = function (body, l) { if (l.type === 'chart') return this.chartPanel(body, l); stylePanel.call(this, body, l); if (l.type === 'shape') this.shapeExtras(body, l); if (l.type === 'text') this.textBoxExtras(body, l); };
  UI.panel_fx = function (body, l) {
    fxPanel.call(this, body, l); this.mixSliders(body, l);
    body.appendChild(el('div', { class: 'btnrow' }, el('button', { class: 'btn sm', onclick: () => App.autoEnhance() }, '✦ Auto enhance'), el('button', { class: 'btn sm', onclick: () => App.copyGrade() }, 'Copy grade'), el('button', { class: 'btn sm', onclick: () => App.pasteGrade() }, 'Paste grade')));
  };
  UI.panel_filters = function (body) {
    filters.call(this, body);
    const l = App.layer(), fs = l ? l.effects.filter(f => f.filter) : [];
    if (fs.length) body.insertBefore(this.row('Intensity', el('input', { type: 'range', min: 0, max: 100, value: Math.round((fs[0].mix ?? 1) * 100), oninput: (e) => App.change(() => { for (const f of fs) f.mix = +e.target.value / 100; }, 'fint' + l.id) })), body.children[1] || null);
  };
  UI.panel_stickers = function (body) {
    stickers.call(this, body);
    body.appendChild(el('div', { class: 'sect' }, 'More shapes and drawing'));
    body.appendChild(el('div', { class: 'tools' }, [['arrow', 'Arrow'], ['heart', 'Heart'], ['bubble', 'Speech bubble']].map(([k, n]) => this.toolBtn('shape', n, () => { App.addShape('rect'); const l = App.layer(); App.change(() => { l.shape.kind = k; l.name = n; if (k === 'arrow') l.shape.h = 220; }, ''); this.refresh(); })), this.toolBtn('edit', 'Pen tool', () => this.startPen())));
    body.appendChild(el('div', { class: 'sect' }, 'Charts'));
    body.appendChild(el('div', { class: 'tools' }, CHART_KINDS.slice(0, 6).map(([k, n]) => this.toolBtn('keyframe', n, () => App.addChart(k)))));
  };
  UI.panel_transform = function (body, l) {
    transformPanel.call(this, body, l);
    if (l.type === 'adjust' || l.type === 'audio') return;
    body.appendChild(el('div', { class: 'sect' }, 'Motion blur'));
    body.appendChild(this.row('Blur when moving', el('input', { type: 'checkbox', class: 'tog', checked: !!(l.mblur && l.mblur.on), onchange: (e) => { App.change(() => { l.mblur = { shutter: 180, samples: 8, ...(l.mblur || {}), on: e.target.checked }; }); this.refreshPanel(); } })));
    if (l.mblur && l.mblur.on) body.append(this.propRow(l, 'mblur.shutter', 'Shutter angle°', { min: 1, max: 720, step: 1 }), this.propRow(l, 'mblur.samples', 'Samples', { min: 2, max: 24, step: 1 }), el('p', { class: 'hint' }, 'Shows when paused and in the export. Playback skips it to stay smooth.'));
    if (l.type === 'image' || l.type === 'video') { body.appendChild(el('div', { class: 'sect' }, 'Ken Burns pan and zoom')); body.appendChild(el('div', { class: 'btnrow' }, [['in', 'Zoom in'], ['out', 'Zoom out'], ['left', 'Pan left'], ['right', 'Pan right'], ['up', 'Pan up'], ['down', 'Pan down']].map(([k, n]) => el('button', { class: 'btn sm', onclick: () => App.kenBurns(k) }, n))));
      body.appendChild(el('div', { class: 'sect' }, 'Picture in picture')); body.appendChild(el('div', { class: 'btnrow' }, [['tl', '↖'], ['tr', '↗'], ['bl', '↙'], ['br', '↘'], ['c', 'Centre']].map(([k, n]) => el('button', { class: 'btn sm', onclick: () => App.pip(k) }, n))));
      body.appendChild(el('div', { class: 'sect' }, 'Split screen (select 2 to 4 clips)')); body.appendChild(el('div', { class: 'btnrow' }, [['2h', '◧ 2 across'], ['2v', '⬒ 2 stacked'], ['3h', '3 across'], ['3v', '3 stacked'], ['4', '▦ Grid of 4'], ['1+2', '1 big + 2']].map(([k, n]) => el('button', { class: 'btn sm', onclick: () => App.splitScreen(k) }, n)))); }
  };
  UI.panel_layer = function (body, l) {
    layerPanel.call(this, body, l);
    if (!l.mediaId) return;
    body.appendChild(el('div', { class: 'sect' }, 'Media'));
    body.appendChild(el('div', { class: 'btnrow' }, el('button', { class: 'btn sm', onclick: () => App.replaceMedia() }, 'Replace media'), l.type === 'video' ? el('button', { class: 'btn sm', onclick: () => App.extractAudio() }, 'Extract audio') : null,
      l.type === 'video' ? el('button', { class: 'btn sm', onclick: () => App.sceneDetect() }, 'Split at scene cuts') : null));
  };
  if (audioPanel) UI.panel_audio = function (body, l) { audioPanel.call(this, body, l); body.appendChild(el('div', { class: 'sect' }, 'Cut to the music')); body.appendChild(el('div', { class: 'btnrow' }, el('button', { class: 'btn sm', onclick: () => App.beatSync() }, 'Beat sync the main track'))); };
})();

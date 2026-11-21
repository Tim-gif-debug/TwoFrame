// ===========================================================================
// App state: projects, tracks, undo history, layers and editing actions.
//
// Project structure (version 2):
//   project.tracks  bottom-to-top list of { id, name, kind, locked, muted, hidden }
//   project.layers  every clip; each has .track (a track id), .start, .dur
//   project.markers [{ t, label }]
//   project.magnetic  main track closes gaps automatically
//   project.canvasBg  { type: 'color' | 'blur' | 'image', blur, mediaId }
// Older projects (one clip per row) are upgraded when they open.
// ===========================================================================
let engine = null;

const PRESETS = [
  { name: 'Vertical 9:16', w: 1080, h: 1920 },
  { name: 'Wide 16:9', w: 1920, h: 1080 },
  { name: 'Square 1:1', w: 1080, h: 1080 },
  { name: 'Portrait 4:5', w: 1080, h: 1350 },
  { name: 'Cinema 21:9', w: 1920, h: 822 },
];
const HISTORY_LIMIT = 1000;

const App = {
  project: null, time: 0, sel: null, selIds: new Set(), loop: true, snapping: true,
  quality: 'half',          // preview quality: full | half | quarter
  undoStack: [], redoStack: [], _lastSnap: 0, _lastSnapKey: '',
  _want: false, _busy: false, _saveTimer: 0,

  async init() {
    await Store.open();
    engine = new Engine($('#gl'));
    for (const r of await Store.all('effects')) {
      if (r.value && r.value.xml) { try { EffectLib.add(parseEffectXML(r.value.xml, r.value.name)); } catch (e) { console.warn(e); } }
    }
    await Promise.all([Luts.loadAll(), Presets.loadAll(), Fonts.loadSaved()]);
    try { this.quality = localStorage.getItem('tf.quality') || 'half'; this.snapping = localStorage.getItem('tf.snap') !== '0'; } catch (e) { }
    Layout.init();
    UI.init();
    UI.showHome();
  },

  // ---- projects ---------------------------------------------------------
  newProject(preset, fps = 30) {
    const main = { id: uid('t'), name: 'Main', kind: 'main', locked: false, muted: false, hidden: false };
    return {
      id: uid('p'), name: 'Untitled ' + new Date().toLocaleDateString(), version: 2,
      width: preset.w, height: preset.h, fps, duration: 10, bg: [0.06, 0.06, 0.08, 1],
      tracks: [main], layers: [], markers: [], magnetic: true, canvasBg: { type: 'color', blur: 40 },
      created: Date.now(), modified: Date.now()
    };
  },
  // Brings an older project up to the current structure. Nothing is lost:
  // every old layer gets its own track in the same stacking order.
  migrate(p) {
    if (!p.tracks) {
      p.tracks = [];
      let mainSet = false;
      for (const l of p.layers) {
        const isMain = !mainSet && (l.type === 'video' || l.type === 'image');
        const t = { id: uid('t'), name: isMain ? 'Main' : '', kind: isMain ? 'main' : (l.type === 'audio' ? 'audio' : 'overlay'), locked: false, muted: false, hidden: false };
        if (isMain) mainSet = true;
        p.tracks.push(t); l.track = t.id;
      }
      if (!mainSet) p.tracks.unshift({ id: uid('t'), name: 'Main', kind: 'main', locked: false, muted: false, hidden: false });
      p.magnetic = false;     // old projects keep their exact clip positions
    }
    p.markers = p.markers || [];
    p.canvasBg = p.canvasBg || { type: 'color', blur: 40 };
    if (p.magnetic == null) p.magnetic = true;
    for (const l of p.layers) { if (!p.tracks.some(t => t.id === l.track)) l.track = this.mainTrack(p).id; l.effects = l.effects || []; l.keys = l.keys || {}; }
    p.version = 2;
    return p;
  },
  async open(p) {
    Player.pause();
    for (const id of Array.from(Runtime.map.keys())) Runtime.drop(id);
    this.project = this.migrate(p); this.time = 0; this.sel = null; this.selIds.clear(); this.undoStack = []; this.redoStack = [];
    const missing = [];
    const ids = new Set();
    const walk = (ls) => { for (const l of ls) { if (l.mediaId) ids.add(l.mediaId); if (l.children) walk(l.children); } };
    walk(p.layers); if (p.canvasBg && p.canvasBg.mediaId) ids.add(p.canvasBg.mediaId);
    for (const id of p.library || []) ids.add(id);
    for (const id of ids) {
      if (Media.items.has(id)) continue;
      const rec = await Store.get('media', id);
      if (rec) { try { const m = await Media.load(rec); await Proxies.restore(m); Media.makeThumbs(m, () => UI.renderTimeline()); } catch (e) { missing.push(rec.name); } } else missing.push(id);
    }
    if (missing.length) toast('Some media could not be loaded: ' + missing.join(', '), 5000);
    Fonts.ready(p);
    this.setPreviewQuality();
    UI.showEditor();
    this.requestRender();
  },
  // Autosave: half a second after each change, plus every 5 seconds while open.
  save(now) {
    clearTimeout(this._saveTimer);
    const p = this.project; if (!p) return;
    const doSave = () => {
      p.modified = Date.now();
      try {
        const c = document.createElement('canvas'), k = 240 / Math.max(engine.canvas.width, engine.canvas.height);
        c.width = Math.max(1, Math.round(engine.canvas.width * k)); c.height = Math.max(1, Math.round(engine.canvas.height * k));
        c.getContext('2d').drawImage(engine.canvas, 0, 0, c.width, c.height); p.thumb = c.toDataURL('image/jpeg', 0.7);
      } catch (e) { }
      Store.put('projects', p.id, deepCopy(p));
      this._dirty = false;
    };
    this._dirty = true;
    if (now) doSave(); else this._saveTimer = setTimeout(doSave, 500);
  },

  // ---- editing ------------------------------------------------------------
  // Every change goes through here so undo, saving and redraws stay in step.
  // Quick repeated edits with the same key (a slider drag) share one undo step.
  change(fn, key = '') {
    const now = performance.now();
    if (!(key && key === this._lastSnapKey && now - this._lastSnap < 800)) {
      this.undoStack.push(JSON.stringify(this.project));
      if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
      this.redoStack = [];
    }
    this._lastSnap = now; this._lastSnapKey = key;
    fn(this.project);
    this.save();
    this.requestRender();
    UI.updateHistoryButtons && UI.updateHistoryButtons();
  },
  undo() { if (!this.undoStack.length) return; this.redoStack.push(JSON.stringify(this.project)); this.restore(JSON.parse(this.undoStack.pop())); },
  redo() { if (!this.redoStack.length) return; this.undoStack.push(JSON.stringify(this.project)); this.restore(JSON.parse(this.redoStack.pop())); },
  restore(p) {
    const keep = new Set(p.layers.map(l => l.id));
    for (const id of Array.from(Runtime.map.keys())) if (!keep.has(id)) Runtime.drop(id);
    for (const r of Runtime.map.values()) r.texKey = '';
    this.project = p; this._lastSnapKey = '';
    if (this.sel && !p.layers.some(l => l.id === this.sel)) this.sel = null;
    this.save(); UI.refresh(); this.requestRender();
  },

  layer(id = this.sel) { return this.project && this.project.layers.find(l => l.id === id); },
  setTime(t, fromScroll) {
    const p = this.project; if (!p) return;
    this.time = clamp(Math.round(t * p.fps) / p.fps, 0, Math.max(0, p.duration - 1 / p.fps));
    if (Player.playing) { Player.startT = this.time; Player.startWall = performance.now(); Player.stopAudio(); Player.startAudio(p, this.time); Player.syncVideos(p, this.time, true); }
    UI.updatePlayhead(fromScroll); UI.refreshPanelValues();
    this.requestRender();
  },
  // Preview resolution: Full = project size (capped at 1920), Half, Quarter.
  setPreviewQuality() {
    const p = this.project; if (!p) return;
    const f = { full: 1, half: 0.5, quarter: 0.25 }[this.quality] || 0.5;
    const maxDim = Math.min(1920, Math.max(p.width, p.height) * f) * (Player.playing && this.quality === 'full' ? 0.75 : 1);
    const k = Math.min(1, maxDim / Math.max(p.width, p.height));
    const w = Math.round(p.width * k), h = Math.round(p.height * k);
    if (w !== engine.width || h !== engine.height || engine.compW !== p.width || engine.compH !== p.height) {
      engine.setSize(w, h, p.width, p.height);
      Runtime.clearCaches();
      for (const r of Runtime.map.values()) r.texKey = '';
    }
    UI.fitStage();
  },
  setQuality(q) { this.quality = q; try { localStorage.setItem('tf.quality', q); } catch (e) { } this.requestRender(); UI.updateTransport(); },
  // Renders the latest requested time; skips stale requests while busy.
  requestRender() {
    if (!this.project || Player.playing || Exporter.busy) return;
    this._want = true;
    if (this._busy) return;
    this._busy = true;
    (async () => {
      while (this._want && !Exporter.busy) {
        this._want = false;
        if (!Player.playing) this.setPreviewQuality();
        try { await Renderer.frame(this.project, this.time, 'exact'); } catch (e) { console.warn(e); }
        UI.drawOverlay && UI.drawOverlay();
      }
      this._busy = false;
    })();
  },

  // ---- tracks -------------------------------------------------------------
  mainTrack(p = this.project) {
    let t = p.tracks.find(t => t.kind === 'main');
    if (!t) { t = { id: uid('t'), name: 'Main', kind: 'main', locked: false, muted: false, hidden: false }; p.tracks.unshift(t); }
    return t;
  },
  track(id) { return this.project.tracks.find(t => t.id === id); },
  clipsOn(trackId) { return this.project.layers.filter(l => l.track === trackId).sort((a, b) => a.start - b.start); },
  // Is the span [s, e) free on a track (ignoring one layer)?
  trackFree(trackId, s, e, ignore) {
    return !this.project.layers.some(l => l !== ignore && l.track === trackId && s < l.start + l.dur - 1e-6 && e > l.start + 1e-6);
  },
  // Finds a track of the right kind with room at [s, e), or makes a new one on top.
  trackFor(kind, s, e, ignore) {
    const p = this.project;
    for (let i = p.tracks.length - 1; i >= 0; i--) {
      const t = p.tracks[i];
      if (t.kind === kind && !t.locked && this.trackFree(t.id, s, e, ignore)) return t;
    }
    const t = { id: uid('t'), name: '', kind, locked: false, muted: false, hidden: false };
    if (kind === 'audio') p.tracks.unshift(t); else p.tracks.push(t);
    return t;
  },
  // Magnetic main track: clips sit end to end with no gaps.
  compactMain(p = this.project) {
    if (!p.magnetic) return;
    const main = this.mainTrack(p);
    let t = 0;
    for (const l of p.layers.filter(l => l.track === main.id).sort((a, b) => a.start - b.start)) { l.start = Math.round(t * p.fps) / p.fps; t += l.dur; }
    this.fitDuration(p, true);
  },
  fitDuration(p = this.project, grow) {
    const end = Math.max(0.5, ...p.layers.map(l => l.start + l.dur));
    p.duration = grow ? Math.max(p.duration, end) : Math.round(end * p.fps) / p.fps;
  },
  removeEmptyTracks(p = this.project) {
    p.tracks = p.tracks.filter(t => t.kind === 'main' || p.layers.some(l => l.track === t.id));
  },
  toggleTrack(id, prop) { this.change(p => { const t = p.tracks.find(t => t.id === id); if (t) t[prop] = !t[prop]; }); UI.renderTimeline(); },

  // ---- markers ------------------------------------------------------------
  addMarker(label) {
    this.change(p => { p.markers.push({ id: uid('mk'), t: this.time, label: label || '' }); p.markers.sort((a, b) => a.t - b.t); });
    UI.renderTimeline();
  },
  removeMarker(id) { this.change(p => { p.markers = p.markers.filter(m => m.id !== id); }); UI.renderTimeline(); },

  // ---- layers -----------------------------------------------------------
  baseLayer(type, name) {
    const p = this.project;
    return {
      id: uid('l'), type, name, start: this.time, dur: Math.min(5, Math.max(1, p.duration - this.time)), in: 0,
      hidden: false, locked: false, blend: 'Normal', volume: 100, muted: false,
      transform: { x: p.width / 2, y: p.height / 2, scale: 100, rotation: 0, opacity: 100, anchorX: 0, anchorY: 0, flipX: false, flipY: false },
      keys: {}, effects: []
    };
  },
  // Adds a layer. Videos and photos go on the main track (or an overlay
  // track when asked); everything else gets a free track above.
  addLayer(l, opts = {}) {
    this.change(p => {
      const kind = opts.kind || ((l.type === 'video' || l.type === 'image') ? 'main' : l.type === 'audio' ? 'audio' : l.type === 'text' || l.type === 'caption' ? 'text' : 'overlay');
      if (kind === 'main') {
        const main = this.mainTrack(p); l.track = main.id;
        if (p.magnetic) { const clips = p.layers.filter(x => x.track === main.id); l.start = clips.length ? Math.max(...clips.map(x => x.start + x.dur)) : 0; }
        else if (!this.trackFree(main.id, l.start, l.start + l.dur)) l.track = this.trackFor('overlay', l.start, l.start + l.dur).id;
      } else l.track = this.trackFor(kind, l.start, l.start + l.dur).id;
      p.layers.push(l);
      p.duration = Math.max(p.duration, l.start + l.dur);
    });
    this.sel = l.id; this.selIds = new Set([l.id]);
    UI.afterAdd ? UI.afterAdd(l) : UI.refresh();
    return l;
  },
  addText(opts = {}) {
    const l = this.baseLayer('text', 'Text');
    l.text = { ...TEXT_DEFAULTS, content: opts.content || 'Title', size: Math.round(this.project.height * 0.07), ...(opts.text || {}) };
    if (opts.y != null) l.transform.y = opts.y;
    return this.addLayer(l);
  },
  addShape(kind = 'rect') {
    const l = this.baseLayer('shape', { rect: 'Rectangle', ellipse: 'Ellipse', star: 'Star', polygon: 'Polygon', line: 'Line' }[kind] || 'Shape');
    const s = Math.round(Math.min(this.project.width, this.project.height) * 0.35);
    l.shape = { ...SHAPE_DEFAULTS, kind, w: s, h: kind === 'line' ? 20 : s, strokeOn: kind === 'line' };
    return this.addLayer(l);
  },
  addSticker(emoji) {
    return this.addText({ content: emoji, text: { size: Math.round(this.project.height * 0.12), weight: 400 } });
  },
  addSolid() {
    const l = this.baseLayer('solid', 'Solid');
    l.solid = { color: [0.15, 0.4, 1, 1], w: this.project.width, h: this.project.height };
    return this.addLayer(l, { kind: 'overlay' });
  },
  addAdjust(name = 'Adjustment') { return this.addLayer(this.baseLayer('adjust', name), { kind: 'overlay' }); },
  addNull() { const l = this.baseLayer('null', 'Null'); return this.addLayer(l, { kind: 'overlay' }); },
  // Imported files are added to the project's media library and placed on
  // the timeline (main track, or an overlay track for picture-in-picture).
  async addMediaFiles(files, opts = {}) {
    let added = 0;
    for (const f of files) {
      UI.busy(`Loading ${f.name}…`);
      try {
        const m = await Media.importFile(f);
        const p = this.project;
        p.library = p.library || []; if (!p.library.includes(m.id)) p.library.push(m.id);
        if (opts.libraryOnly) { added++; Media.makeThumbs(m, () => UI.renderLibrary && UI.renderLibrary()); continue; }
        this.placeMedia(m, opts);
        added++;
        Media.makeThumbs(m, () => { UI.renderTimeline(); UI.renderLibrary && UI.renderLibrary(); });
        if (m.audioReady) m.audioReady.then(() => { if (m.audioSkipped) toast(`${m.name} is very large, so its sound wasn’t loaded. Trim it shorter to keep the sound.`, 5000); Sound.peaks(m).then(() => UI.renderTimeline()); });
        else if (m.type === 'audio') Sound.peaks(m).then(() => UI.renderTimeline());
      } catch (e) { UI.busy(null); UI.modal('Couldn’t add that file', el('p', {}, e.message || String(e)), [['OK', () => UI.closeModal()]]); }
    }
    UI.busy(null);
    if (added) { UI.refresh(); UI.renderLibrary && UI.renderLibrary(); UI.updatePlayhead(); }
    this.requestRender();
  },
  placeMedia(m, opts = {}) {
    const p = this.project;
    const l = this.baseLayer(m.type, m.name.replace(/\.[^.]+$/, ''));
    l.mediaId = m.id;
    if (m.type === 'video' || m.type === 'image') l.transform.scale = Math.round(Math.min(p.width / m.w, p.height / m.h) * 1000) / 10;
    if (m.type === 'video') { l.dur = m.duration; l.video = { speed: 1, interp: 'none', srcFps: m.fps || 30 }; }
    if (m.type === 'image') l.dur = 3;
    if (m.type === 'audio') { l.dur = m.duration; l.audioOpts = { speed: 1 }; }
    if (opts.overlay && (m.type === 'video' || m.type === 'image')) { l.transform.scale = Math.round(l.transform.scale * 0.5 * 10) / 10; l.name += ' (overlay)'; }
    this.addLayer(l, { kind: opts.overlay ? 'overlay' : undefined });
    const r = Runtime.get(l);
    if (r.video) r.video.play().then(() => r.video.pause()).catch(() => {});
    if (m.type === 'video' && !m.fps) detectFps(m).then(fps => { if (fps) { m.fps = fps; if (l.video.srcFps === 30 && fps !== 30) { l.video.srcFps = fps; this.save(); } } });
    return l;
  },
  // Copies a layer with fresh ids (effect ids appear in keyframe paths too).
  cloneLayer(l) {
    const c = deepCopy(l); c.id = uid('l');
    const remap = (layer) => {
      const map = {};
      for (const f of layer.effects || []) { const n = uid('fx'); map[f.uid] = n; f.uid = n; }
      const keys = {};
      for (const [path, ks] of Object.entries(layer.keys || {})) { const parts = path.split('.'); if (parts[0] === 'fx' && map[parts[1]]) parts[1] = map[parts[1]]; keys[parts.join('.')] = ks; }
      layer.keys = keys;
    };
    remap(c);
    if (c.children) for (const ch of c.children) { ch.id = uid('l'); remap(ch); }
    return c;
  },
  duplicate() {
    const l = this.layer(); if (!l) return;
    const c = this.cloneLayer(l); c.name = l.name + ' copy';
    this.change(p => {
      if (this.track(l.track)?.kind === 'main' && p.magnetic) { c.start = l.start + l.dur; for (const o of p.layers) if (o.track === l.track && o.start >= l.start + l.dur - 1e-6) o.start += l.dur; }
      else { c.track = this.trackFor(this.track(l.track)?.kind === 'main' ? 'overlay' : (this.track(l.track)?.kind || 'overlay'), c.start, c.start + c.dur).id; }
      p.layers.push(c); this.fitDuration(p, true);
    });
    this.sel = c.id; UI.refresh();
  },
  split() {
    const l = this.layer(); if (!l) return;
    if (this.track(l.track)?.locked) { toast('This track is locked.'); return; }
    const T = this.time, cut = T - l.start;
    if (cut <= 0.01 || cut >= l.dur - 0.01) { toast('Move the playhead inside the clip to split it.'); return; }
    const b = this.cloneLayer(l);
    const srcAtCut = srcTimeFor(l, cut);
    b.start = T; b.dur = l.dur - cut;
    if (l.video && !l.video.curve && !l.video.reverse && l.video.freeze == null) b.in = srcAtCut;
    else if (l.audioOpts) b.in = (l.in || 0) + cut * (l.audioOpts.speed || 1);
    else b.in = srcAtCut;
    for (const ks of Object.values(b.keys)) for (const k of ks) k.t -= cut;
    delete b.transIn;
    this.change(p => { const a = p.layers.find(x => x.id === l.id); a.dur = cut; delete a.transOut; p.layers.push(b); });
    this.sel = b.id; UI.refresh();
  },
  remove(ids) {
    ids = ids || (this.selIds.size ? Array.from(this.selIds) : [this.sel]).filter(Boolean);
    if (!ids.length) return;
    this.change(p => {
      p.layers = p.layers.filter(x => !ids.includes(x.id));
      for (const l of p.layers) { if (ids.includes(l.parent)) delete l.parent; if (l.matte && ids.includes(l.matte.src)) delete l.matte; }
      this.compactMain(p); this.removeEmptyTracks(p);
    });
    for (const id of ids) Runtime.drop(id);
    this.sel = null; this.selIds.clear(); UI.closeSheet(true); UI.refresh();
  },
  // Moves the selected clip to the track above (+1) or below (-1).
  move(dir) {
    const l = this.layer(); if (!l) return;
    this.change(p => {
      const vis = p.tracks.filter(t => t.kind !== 'audio');
      const i = vis.findIndex(t => t.id === l.track);
      let j = i + dir;
      if (j >= vis.length) { const t = { id: uid('t'), name: '', kind: 'overlay', locked: false, muted: false, hidden: false }; p.tracks.push(t); vis.push(t); }
      if (j < 0) return;
      const target = vis[j];
      if (!this.trackFree(target.id, l.start, l.start + l.dur, l)) {
        // Make room: a new track right above or below.
        const t = { id: uid('t'), name: '', kind: 'overlay', locked: false, muted: false, hidden: false };
        p.tracks.splice(p.tracks.indexOf(target) + (dir > 0 ? 1 : 0), 0, t); l.track = t.id;
      } else l.track = target.id;
      this.compactMain(p); this.removeEmptyTracks(p);
    });
    UI.refresh();
  },

  // ---- clip actions ---------------------------------------------------------
  freezeFrame() {
    const l = this.layer(); if (!l || l.type !== 'video') { toast('Select a video clip to freeze a frame.'); return; }
    const T = this.time, cut = T - l.start;
    if (cut < 0 || cut > l.dur) return;
    const srcT = srcTimeFor(l, cut), hold = 2;
    this.change(p => {
      const fr = this.cloneLayer(l); fr.name = l.name + ' freeze'; fr.start = T; fr.dur = hold; fr.video = { ...fr.video, freeze: srcT, curve: null }; fr.keys = {}; delete fr.transIn; delete fr.transOut;
      if (cut > 0.01 && cut < l.dur - 0.01) {
        const b = this.cloneLayer(l); b.start = T + hold; b.dur = l.dur - cut; b.in = srcT; delete b.transIn;
        for (const ks of Object.values(b.keys)) for (const k of ks) k.t -= cut;
        for (const o of p.layers) if (o !== l && o.track === l.track && o.start >= T - 1e-6) o.start += hold;
        l.dur = cut; p.layers.push(fr, b);
      } else { for (const o of p.layers) if (o !== l && o.track === l.track && o.start >= T - 1e-6) o.start += hold; p.layers.push(fr); }
      this.compactMain(p); this.fitDuration(p, true);
    });
    UI.refresh();
  },
  toggleReverse() { const l = this.layer(); if (!l || !l.video) return; this.change(() => { l.video.reverse = !l.video.reverse; }); Runtime.clearCaches(); UI.refresh(); },
  // Parenting keeps the child where it is on screen right now.
  setParent(l, parentId) {
    const list = this.project.layers, lt = this.time - l.start;
    this.change(() => {
      const world = worldTransform(l, lt, list);
      if (!parentId) { delete l.parent; l.transform.x = world.x; l.transform.y = world.y; l.transform.rotation = world.rotation; l.transform.scale = world.scale; }
      else {
        const P = list.find(x => x.id === parentId); if (!P || P === l) return;
        let q = P; for (let i = 0; i < 10 && q; i++) { if (q.parent === l.id) { toast('That would make a loop of parents.'); return; } q = list.find(x => x.id === q.parent); }
        const pt = worldTransform(P, this.time - P.start, list), s = (pt.scale ?? 100) / 100, th = -(pt.rotation || 0) * Math.PI / 180;
        const dx = world.x - pt.x, dy = world.y - pt.y;
        l.parent = parentId;
        l.transform.x = (dx * Math.cos(th) - dy * Math.sin(th)) / s; l.transform.y = (dx * Math.sin(th) + dy * Math.cos(th)) / s;
        l.transform.rotation = (world.rotation || 0) - (pt.rotation || 0); l.transform.scale = (world.scale ?? 100) / s;
      }
      for (const p of ['x', 'y', 'rotation', 'scale']) delete l.keys['transform.' + p];
    });
    UI.refresh();
  },
  // Groups selected clips into one clip. Ungroup puts them back.
  group() {
    const ids = Array.from(this.selIds).filter(id => this.layer(id));
    if (ids.length < 2) { toast('Select two or more clips first (Shift-click, or Multi-select on phone).'); return; }
    this.change(p => {
      const ls = ids.map(id => p.layers.find(l => l.id === id));
      const start = Math.min(...ls.map(l => l.start)), end = Math.max(...ls.map(l => l.start + l.dur));
      const ordered = Renderer.ordered(ls, p);
      const g = this.baseLayer('group', 'Group'); g.start = start; g.dur = end - start;
      g.children = ordered.map(l => { const c = deepCopy(l); c.start -= start; delete c.track; return c; });
      g.track = this.trackFor('overlay', start, end).id;
      p.layers = p.layers.filter(l => !ids.includes(l.id)); p.layers.push(g);
      this.compactMain(p); this.removeEmptyTracks(p);
      this.sel = g.id; this.selIds = new Set([g.id]);
    });
    UI.refresh();
  },
  ungroup() {
    const g = this.layer(); if (!g || g.type !== 'group') return;
    this.change(p => {
      p.layers = p.layers.filter(l => l !== g);
      for (const c of g.children) { c.start += g.start; c.track = this.trackFor(c.type === 'audio' ? 'audio' : 'overlay', c.start, c.start + c.dur).id; p.layers.push(c); }
      this.sel = null; this.selIds.clear();
    });
    UI.refresh();
  },

  // ---- properties and keyframes ---------------------------------------------
  keysOf(l, path) { return (l.keys && l.keys[path]) || []; },
  keyAt(l, path, t = this.time - l.start) {
    const half = 0.5 / this.project.fps;
    return this.keysOf(l, path).find(k => Math.abs(k.t - t) < half) || null;
  },
  setProp(l, path, v, key) {
    this.change(() => {
      const ks = this.keysOf(l, path);
      if (ks.length) {
        const t = Math.round((this.time - l.start) * this.project.fps) / this.project.fps;
        const k = this.keyAt(l, path, t);
        if (k) k.v = v; else { ks.push({ t, v, e: 'ease' }); ks.sort((a, b) => a.t - b.t); }
      } else setPath(l, path, v);
    }, key || ('p:' + l.id + path));
  },
  toggleKey(l, path) {
    this.change(() => {
      l.keys = l.keys || {};
      const t = Math.round((this.time - l.start) * this.project.fps) / this.project.fps;
      const ks = l.keys[path] || (l.keys[path] = []);
      const k = this.keyAt(l, path, t);
      if (k) { ks.splice(ks.indexOf(k), 1); if (!ks.length) delete l.keys[path]; }
      else { const v = deepCopy(evalProp(l, path, t)); if (!ks.length) setPath(l, path, deepCopy(v)); ks.push({ t, v, e: 'ease' }); ks.sort((a, b) => a.t - b.t); }
    });
    UI.refreshPanel(); UI.renderTimeline();
  },
  clearKeys(l, path) {
    this.change(() => { const v = evalProp(l, path, this.time - l.start); delete l.keys[path]; setPath(l, path, deepCopy(v)); });
    UI.refreshPanel(); UI.renderTimeline();
  },

  addEffect(defId, target) {
    let l = target || this.layer(); const def = EffectLib.get(defId);
    if (!def) return;
    if (!l) { l = this.addAdjust(def.name); }
    if (def.kind === 'hold' || def.kind === 'echo') {
      if (l.type === 'adjust' || l.type === 'audio') { toast(`${def.name} works on visual layers, not adjustment or audio layers.`); return; }
      if (l.effects.some(f => EffectLib.get(f.defId)?.kind === def.kind)) { toast(`This layer already has ${def.name}.`); return; }
    }
    const fxi = { uid: uid('fx'), defId, enabled: true, params: defaultParams(def), open: true };
    this.change(() => { l.effects.push(fxi); });
    UI.openTool('effects');
  },
  // Filters: a one-tap look applied to the selected clip (or the whole video
  // through an adjustment layer when nothing is selected).
  applyFilter(name) {
    const look = FILTER_LOOKS.find(f => f[0] === name); if (!look) return;
    let l = this.layer();
    if (!l || l.type === 'audio') { l = this.addAdjust('Filter: ' + name); l.start = 0; l.dur = this.project.duration; }
    this.change(() => {
      l.effects = l.effects.filter(f => !f.filter);
      for (const [defId, vals] of look[1]) { const def = EffectLib.get(defId); if (!def) continue; l.effects.push({ uid: uid('fx'), defId, enabled: true, params: { ...defaultParams(def), ...deepCopy(vals) }, open: false, filter: name }); }
    });
    UI.refresh();
  }
};

// Best guess at a video's frame rate from frame callbacks, else null.
async function detectFps(m) {
  try {
    const v = document.createElement('video');
    if (!v.requestVideoFrameCallback) return null;
    v.muted = true; v.playsInline = true; v.src = m.url;
    $('#videoPool').appendChild(v);
    const played = await withTimeout(v.play().then(() => true, () => false), 2000, false);
    if (!played) { v.remove(); return null; }
    const times = [];
    await new Promise((res) => {
      const cb = (now, meta) => { times.push(meta.mediaTime); if (times.length < 12) v.requestVideoFrameCallback(cb); else res(); };
      v.requestVideoFrameCallback(cb); setTimeout(res, 1500);
    });
    v.pause(); v.remove();
    const d = [];
    for (let i = 1; i < times.length; i++) { const x = times[i] - times[i - 1]; if (x > 0.001 && x < 0.2) d.push(x); }
    if (d.length < 3) return null;
    d.sort((a, b) => a - b);
    const fps = 1 / d[0];
    const common = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 120, 240];
    let best = 30, err = 1e9;
    for (const c of common) { const e = Math.abs(c - fps); if (e < err) { err = e; best = c; } }
    return best;
  } catch (e) { return null; }
}

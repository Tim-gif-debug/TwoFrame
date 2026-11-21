// ===========================================================================
// Transitions, LUT files and saved effect presets
// ===========================================================================

// Each transition is one mode of the transition shader in engine.js.
// A transition sits at the start of a clip ("in"). When the clip directly
// follows another clip on the same track, it blends from that clip; when
// it doesn't, it blends from nothing (empty). A clip can also have an
// "out" transition at its end.
const TRANSITIONS = [
  ['dissolve', 'Cross Dissolve', 0, 'Basic'], ['black', 'Dip to Black', 1, 'Basic'], ['flash', 'Flash (Dip to White)', 2, 'Basic'],
  ['pushL', 'Push Left', 3, 'Slide'], ['pushR', 'Push Right', 4, 'Slide'], ['pushU', 'Push Up', 5, 'Slide'], ['pushD', 'Push Down', 6, 'Slide'],
  ['wipeL', 'Wipe Left', 7, 'Wipe'], ['wipeR', 'Wipe Right', 8, 'Wipe'], ['wipeU', 'Wipe Up', 9, 'Wipe'], ['wipeD', 'Wipe Down', 10, 'Wipe'],
  ['circleOpen', 'Circle Open', 11, 'Shape'], ['circleClose', 'Circle Close', 12, 'Shape'], ['diamond', 'Diamond', 13, 'Shape'],
  ['clock', 'Clock Wipe', 14, 'Shape'], ['star', 'Star Wipe', 28, 'Shape'], ['doors', 'Doors Open', 30, 'Shape'],
  ['zoomIn', 'Zoom In', 15, 'Camera'], ['zoomOut', 'Zoom Out', 16, 'Camera'], ['spin', 'Spin', 17, 'Camera'],
  ['whipL', 'Whip Pan Left', 19, 'Camera'], ['whipR', 'Whip Pan Right', 20, 'Camera'], ['zoomBlur', 'Zoom Blur', 29, 'Camera'], ['slideUp', 'Slide Up', 33, 'Camera'],
  ['blur', 'Blur Dissolve', 18, 'Effects'], ['glitch', 'Glitch', 21, 'Effects'], ['pixel', 'Pixelate', 22, 'Effects'], ['ripple', 'Ripple', 23, 'Effects'],
  ['luma', 'Luma Fade', 24, 'Effects'], ['squeeze', 'Squeeze', 25, 'Effects'], ['blinds', 'Blinds', 26, 'Effects'], ['squares', 'Random Squares', 27, 'Effects'],
  ['rgb', 'RGB Split', 31, 'Effects'], ['drip', 'Drip Wipe', 32, 'Effects']
].map(([id, name, mode, cat]) => ({ id, name, mode, cat }));
const transitionById = (id) => TRANSITIONS.find(t => t.id === id);

// ---- .cube LUT files ---------------------------------------------------------
const Luts = {
  map: new Map(),      // id -> { name, size, data, tex }
  parse(text) {
    let size = 0; const data = [];
    let dmin = [0, 0, 0], dmax = [1, 1, 1];
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim(); if (!line || line[0] === '#') continue;
      const parts = line.split(/\s+/);
      if (parts[0] === 'LUT_3D_SIZE') size = parseInt(parts[1], 10);
      else if (parts[0] === 'DOMAIN_MIN') dmin = parts.slice(1, 4).map(Number);
      else if (parts[0] === 'DOMAIN_MAX') dmax = parts.slice(1, 4).map(Number);
      else if (/^[-\d.]/.test(parts[0]) && parts.length >= 3) for (let i = 0; i < 3; i++) data.push((+parts[i] - dmin[i]) / ((dmax[i] - dmin[i]) || 1));
    }
    if (!size || size > 128) throw new Error('This file is not a 3D .cube LUT (LUT_3D_SIZE missing).');
    if (data.length < size * size * size * 3) throw new Error('This .cube file looks incomplete.');
    return { size, data: new Float32Array(data) };
  },
  async add(name, text, id = uid('lut')) {
    const { size, data } = this.parse(text);
    this.map.set(id, { name, size, data, tex: null });
    await Store.put('effects', 'lut:' + id, { name, text });
    return id;
  },
  async loadAll() {
    for (const r of await Store.all('effects')) {
      if (String(r.key).startsWith('lut:')) { try { const { size, data } = this.parse(r.value.text); this.map.set(String(r.key).slice(4), { name: r.value.name, size, data, tex: null }); } catch (e) { } }
    }
  },
  texture(id) {
    const l = this.map.get(id); if (!l) return null;
    if (!l.tex) l.tex = engine.makeLutTexture(l.size, l.data);
    return l.tex;
  }
};

// ---- Saved effect presets (a stack of effects plus their keyframes) ----------
const Presets = {
  list: [],
  async loadAll() {
    this.list = (await Store.all('effects')).filter(r => String(r.key).startsWith('preset:')).map(r => r.value);
  },
  async save(name, layer) {
    const p = {
      id: uid('preset'), name,
      effects: deepCopy(layer.effects.map(f => ({ defId: f.defId, enabled: f.enabled, params: f.params, uid: f.uid }))),
      keys: Object.fromEntries(Object.entries(layer.keys || {}).filter(([k]) => k.startsWith('fx.')).map(([k, v]) => [k, deepCopy(v)]))
    };
    await Store.put('effects', 'preset:' + p.id, p);
    this.list.push(p);
    return p;
  },
  // Adds the preset's effects to a layer with fresh ids; keyframes keep their timing.
  apply(p, layer) {
    App.change(() => {
      const map = {};
      for (const f of p.effects) {
        const n = uid('fx'); map[f.uid] = n;
        layer.effects.push({ uid: n, defId: f.defId, enabled: f.enabled, params: deepCopy(f.params), open: false });
      }
      layer.keys = layer.keys || {};
      for (const [k, v] of Object.entries(p.keys)) {
        const parts = k.split('.'); if (!map[parts[1]]) continue;
        parts[1] = map[parts[1]]; layer.keys[parts.join('.')] = deepCopy(v);
      }
    });
  },
  async remove(id) { await Store.del('effects', 'preset:' + id); this.list = this.list.filter(p => p.id !== id); }
};

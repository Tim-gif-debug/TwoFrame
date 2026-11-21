// ===========================================================================
// The frame renderer: turns the project at time T into a picture.
//
// Order of work for each frame:
//   1. Canvas background (colour, blurred main clip, or an image)
//   2. Layers from the bottom track to the top track. Each layer is drawn
//      with its transform (including parent layers), then its effects,
//      Hold Motion / Echo, its track matte, and any transition.
//   3. The result is shown on screen (or captured for export).
// ===========================================================================
const BLEND_MODES = ['Normal', 'Add', 'Screen', 'Multiply', 'Overlay', 'Lighten', 'Darken', 'Difference', 'Soft Light', 'Color Dodge', 'Color Burn', 'Hard Light', 'Exclusion', 'Linear Burn', 'Linear Light'];
const GHOST_TO_MODE = [0, 1, 2, 5];
BLEND_MODES.push('Vivid Light', 'Hue', 'Saturation', 'Color', 'Luminosity', 'Pin Light', 'Subtract', 'Divide');
const FX_HOOKS = {};      // effect id -> async (layer, fxi, values, t, renderer, layers) => extra uniforms
const CANVAS_LAYERS = {}; // layer type -> (layer, t, scale, frame) => { key, draw() }
const VISUAL_TYPES = new Set(['video', 'image', 'text', 'shape', 'solid', 'caption', 'group', 'null']);

// ---- Speed curves -----------------------------------------------------------
// A curve is a list of points { x: 0..1 across the clip, y: speed multiplier }.
const SPEED_CURVES = {
  Montage: [[0, 0.5], [0.25, 2], [0.5, 0.5], [0.75, 2], [1, 0.5]],
  Hero: [[0, 2.5], [0.35, 2.5], [0.45, 0.3], [0.65, 0.3], [0.75, 2.5], [1, 2.5]],
  Bullet: [[0, 1.5], [0.4, 0.2], [0.6, 0.2], [1, 1.5]],
  'Jump Cut': [[0, 1], [0.45, 1], [0.5, 5], [0.55, 1], [1, 1]],
  'Flash In': [[0, 4], [0.5, 1], [1, 1]],
  'Flash Out': [[0, 1], [0.5, 1], [1, 4]]
};
// Area under the curve from 0 to u (both in 0..1 of the clip).
function curveIntegral(pts, u) {
  if (!pts || pts.length < 2) return u;
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
    if (u <= x0) break;
    const xe = Math.min(u, x1), ye = y0 + (y1 - y0) * ((xe - x0) / Math.max(1e-6, x1 - x0));
    acc += (xe - x0) * (y0 + ye) / 2;
  }
  return acc;
}
// Source-media time shown at layer time lt (speed, curve, reverse, freeze).
function srcTimeFor(layer, lt) {
  const v = layer.video || layer.audioOpts || {};
  if (v.freeze != null) return v.freeze;
  const s = v.speed || 1, d = Math.max(1e-3, layer.dur);
  const used = (u) => s * curveIntegral(v.curve, u) * d;
  const c = used(clamp(lt / d, 0, 1)) + Math.max(0, lt - d) * s;
  return (layer.in || 0) + (v.reverse ? Math.max(0, used(1) - c) : c);
}

// ---- Parenting --------------------------------------------------------------
// A child's x / y are stored relative to its parent's position, rotation and
// scale, like After Effects. This returns the final on-screen transform.
function worldTransform(layer, lt, list, depth = 0) {
  const tr = evalTransform(layer, lt);
  if (!layer.parent || depth > 8) return tr;
  const P = list.find(l => l.id === layer.parent);
  if (!P) return tr;
  const pt = worldTransform(P, lt + layer.start - P.start, list, depth + 1);
  const s = (pt.scale ?? 100) / 100, th = (pt.rotation || 0) * Math.PI / 180, c = Math.cos(th), n = Math.sin(th);
  return { ...tr, x: pt.x + (tr.x * c - tr.y * n) * s, y: pt.y + (tr.x * n + tr.y * c) * s, rotation: (tr.rotation || 0) + (pt.rotation || 0), scale: (tr.scale ?? 100) * s };
}

// ---- Captions -------------------------------------------------------------
const CAPTION_EMOJI = { love: '❤️', heart: '❤️', fire: '🔥', hot: '🔥', laugh: '😂', funny: '😂', happy: '😊', sad: '😢', money: '💰', cash: '💰', cool: '😎', wow: '😮', crazy: '🤯', music: '🎵', party: '🎉', win: '🏆', idea: '💡', time: '⏰', eat: '🍔', food: '🍔', car: '🚗', dog: '🐶', cat: '🐱', star: '⭐', rocket: '🚀', fast: '⚡', yes: '✅', no: '❌', look: '👀', strong: '💪', think: '🤔', world: '🌍', sun: '☀️', night: '🌙', game: '🎮', phone: '📱' };
function captionLineAt(cap, t) { return cap.lines ? cap.lines.findIndex(L => t >= L.s && t < L.e) : -1; }

const Renderer = {
  project: null, depth: 0,
  renderScale() { return engine.width / engine.compW; },
  R(name) { return engine.rt(name + '@' + this.depth); },

  // ---- video frames ----------------------------------------------------------
  async videoFrameIdx(layer, i, mode, wantCache) {
    const r = Runtime.get(layer), m = Media.items.get(layer.mediaId);
    if (!r.video || !m) return null;
    const vfps = layer.video.srcFps || 30;
    i = clamp(i, 0, Math.max(0, Math.floor(m.duration * vfps) - 1));
    if (r.cache.has(i)) { const rt = r.cache.get(i); r.cache.delete(i); r.cache.set(i, rt); return rt; }
    if (mode === 'exact') await seekVideo(r.video, (i + 0.5) / vfps);
    if (r.video.readyState < 2) return null;
    const maxDim = Math.max(engine.width, engine.height);
    const k = Math.min(1, maxDim / Math.max(m.w, m.h));
    const w = Math.max(2, Math.round(m.w * k)), h = Math.max(2, Math.round(m.h * k));
    engine.upload(engine.uploadTex, r.video);
    if (mode === 'exact' || wantCache) {
      const rt = engine.makeRT(w, h);
      engine.copy(engine.uploadTex, rt);
      r.cache.set(i, rt);
      const limit = mode === 'exact' ? 12 : 24;
      while (r.cache.size > limit) { const [k0, v0] = r.cache.entries().next().value; engine.freeRT(v0); r.cache.delete(k0); }
      return rt;
    }
    if (!r.live || r.live.w !== w || r.live.h !== h) { engine.freeRT(r.live); r.live = engine.makeRT(w, h); }
    engine.copy(engine.uploadTex, r.live);
    return r.live;
  },
  async videoFrame(layer, srcT, mode, wantCache) {
    const vfps = layer.video.srcFps || 30;
    const f = srcT * vfps, i0 = Math.floor(f + 1e-4), a = f - i0;
    const interp = layer.video.interp || 'none';
    if (interp === 'none' || mode === 'play' || a < 0.02 || layer.video.freeze != null) return this.videoFrameIdx(layer, i0, mode, wantCache);
    if (a > 0.98) return this.videoFrameIdx(layer, i0 + 1, mode, wantCache);
    const A = await this.videoFrameIdx(layer, i0, mode, true);
    const B = await this.videoFrameIdx(layer, i0 + 1, mode, true);
    if (!A || !B) return A || B;
    const out = engine.rt('vi_' + layer.id, A.w, A.h);
    if (interp === 'flow') engine.flowInterpolate(A, B, a, out); else engine.mix(A, B, a, out);
    return out;
  },

  hasKind(layer, kind) { return layer.effects.some(f => f.enabled && EffectLib.get(f.defId)?.kind === kind); },

  // ---- one layer ------------------------------------------------------------
  // Draws the layer's content with its transform, then runs its effects.
  async renderLayer(layer, contentT, transformT, mode, target, list) {
    const E = engine;
    E.clear(target);
    const tr = worldTransform(layer, transformT, list || this.project.layers);
    const scale = this.renderScale();
    const r = Runtime.get(layer);
    const frame = Math.round((contentT + layer.start) * this.project.fps);
    const crop = layer.crop ? evalGroup(layer, 'crop', contentT) : null;
    if (layer.type === 'video') {
      const m = Media.items.get(layer.mediaId);
      const fr = await this.videoFrame(layer, srcTimeFor(layer, contentT), mode, this.hasKind(layer, 'hold') || this.hasKind(layer, 'echo'));
      if (fr && m) E.drawLayerTex(fr, m.w, m.h, tr, target, crop);
    } else if (layer.type === 'image') {
      const m = Media.items.get(layer.mediaId);
      if (m && m.image) {
        if (!r.tex) { r.tex = E.newTex(); E.upload(r.tex, m.image); }
        E.drawLayerTex(r.tex, m.w, m.h, tr, target, crop);
      }
    } else if (layer.type === 'text') {
      const props = evalGroup(layer, 'text', contentT);
      Fonts.ensure(props.font);
      const anim = textIsAnimatingAt(props, contentT, layer.dur);
      const key = JSON.stringify(props) + '@' + scale.toFixed(3) + (anim ? '#' + frame : '');
      if (key !== r.texKey) {
        const d = drawTextCanvas(props, scale, contentT, layer.dur, frame);
        if (!r.tex) r.tex = E.newTex();
        E.upload(r.tex, d.canvas); r.texW = d.w; r.texH = d.h; r.texKey = key;
      }
      E.drawLayerTex(r.tex, r.texW, r.texH, tr, target, crop);
    } else if (layer.type === 'caption') {
      const d = this.captionCanvas(layer, contentT, scale, frame, r);
      if (d) E.drawLayerTex(r.tex, r.texW, r.texH, tr, target);
    } else if (layer.type === 'shape') {
      const props = evalGroup(layer, 'shape', contentT);
      const key = JSON.stringify(props) + '@' + scale.toFixed(3);
      if (key !== r.texKey) {
        const d = drawShapeCanvas(props, scale);
        if (!r.tex) r.tex = E.newTex();
        E.upload(r.tex, d.canvas); r.texW = d.w; r.texH = d.h; r.texKey = key;
      }
      E.drawLayerTex(r.tex, r.texW, r.texH, tr, target, crop);
    } else if (CANVAS_LAYERS[layer.type]) {
      // Layer kinds drawn with Canvas 2D by add-on files (charts and others).
      const d = CANVAS_LAYERS[layer.type](layer, contentT, scale, frame);
      if (d.key !== r.texKey) { const cv = d.draw(); if (!r.tex) r.tex = E.newTex(); E.upload(r.tex, cv.canvas); r.texW = cv.w; r.texH = cv.h; r.texKey = d.key; }
      E.drawLayerTex(r.tex, r.texW, r.texH, tr, target, crop);
    } else if (layer.type === 'solid') {
      const s = evalGroup(layer, 'solid', contentT);
      E.drawSolid(s.color, s.w || E.compW, s.h || E.compH, tr, target);
    } else if (layer.type === 'group') {
      // A group renders its own layers into a full-frame picture first.
      this.depth++;
      try {
        const inner = await this.composite(layer.children || [], contentT, mode, false);
        const tmp = E.rt('grp_' + layer.id);
        E.copy(inner, tmp);
        this.depth--;
        E.clear(target);
        E.drawLayerTex(tmp, E.compW, E.compH, tr, target, crop);
        this.depth++;
      } finally { this.depth--; }
    }
    await this.runEffects(layer, contentT, target, list);
    return target;
  },

  // Caption layer: the current line, with word highlight or pop-in.
  captionCanvas(layer, t, scale, frame, r) {
    const cap = layer.caption || {}; const li = captionLineAt(cap, t);
    if (li < 0) { r.texKey = ''; if (!r.tex) r.tex = engine.newTex(); engine.upload(r.tex, document.createElement('canvas')); r.texW = 1; r.texH = 1; return null; }
    const L = cap.lines[li];
    const words = L.words.map(w => cap.emoji ? w.w + (CAPTION_EMOJI[w.w.toLowerCase().replace(/[^a-z]/g, '')] ? ' ' + CAPTION_EMOJI[w.w.toLowerCase().replace(/[^a-z]/g, '')] : '') : w.w);
    const content = cap.upper ? words.join(' ').toUpperCase() : words.join(' ');
    let cur = -1; L.words.forEach((w, i) => { if (t >= w.s) cur = i; });
    // Glyph index ranges for each word, so we know which word a letter belongs to.
    const ranges = []; let pos = 0; words.forEach(w => { const n = Array.from(w).length; ranges.push([pos, pos + n]); pos += n + 1; });
    const wordOf = (gi) => ranges.findIndex(([a, b]) => gi >= a && gi < b);
    const style = cap.style || 'karaoke';
    const popP = cur >= 0 ? clamp((t - L.words[cur].s) / 0.18, 0, 1) : 1;
    const key = JSON.stringify(layer.text) + content + '@' + scale.toFixed(3) + '|' + cur + '|' + (style === 'pop' ? popP.toFixed(2) : '') + JSON.stringify(cap.hl || '');
    if (key === r.texKey) return true;
    const hl = (lineIdx, gi) => {
      const wi = wordOf(gi);
      if (style === 'karaoke') return wi >= 0 && wi <= cur ? { c: cap.hl || [1, 0.85, 0.1, 1] } : null;
      if (style === 'word') return wi === cur ? { c: cap.hl || [1, 0.85, 0.1, 1], s: 1.12 } : null;
      if (style === 'pop') return wi > cur ? { a: 0 } : wi === cur ? { s: 0.6 + 0.4 * EASES.overshoot(popP), c: cap.hl || null } : null;
      return null;
    };
    const tx = { ...layer.text, content, animIn: 'none', animOut: 'none', animLoop: 'none' };
    Fonts.ensure(tx.font);
    const d = drawTextCanvas(tx, scale, t, layer.dur, frame, hl);
    if (!r.tex) r.tex = engine.newTex();
    engine.upload(r.tex, d.canvas); r.texW = d.w; r.texH = d.h; r.texKey = key;
    return true;
  },

  // Apply the layer's shader effects in order, in place on target.
  async runEffects(layer, t, target, list) {
    const fxs = layer.effects.filter(f => f.enabled && EffectLib.get(f.defId)?.kind === 'shader');
    if (!fxs.length) return;
    // How far the layer moved since the previous frame (for Motion Blur).
    const fps = this.project.fps, k = this.renderScale();
    let vel = [0, 0];
    if (layer.type !== 'adjust') {
      const a = worldTransform(layer, t, list || this.project.layers), b = worldTransform(layer, t - 1 / fps, list || this.project.layers);
      vel = [(a.x - b.x) * k, (a.y - b.y) * k];
    }
    let src = target, dst = this.R('fx_scratch');
    for (const fxi of fxs) {
      const def = EffectLib.get(fxi.defId), vals = evalEffect(layer, fxi, t);
      const extra = { local: t, dur: layer.dur, vel };
      if (def.id === 'tf.lut') extra.lut = Luts.texture(vals.lutId);
      // Effects that need more than their sliders (face data, a cutout mask)
      // register a hook that returns extra shader values.
      const hook = FX_HOOKS[def.id];
      if (hook) { let r = null; try { r = await hook(layer, fxi, vals, t, this, list || this.project.layers); } catch (e) { console.warn(e); } if (r === false) continue; if (r) extra.uniforms = r; }
      engine.runEffect(def, vals, src, dst, t + layer.start, extra);
      // Mix: blend the effect's result with the picture before it.
      if (fxi.mix != null && fxi.mix < 0.999) { const m = this.R('fx_mix'); engine.mix(src, dst, clamp(fxi.mix, 0, 1), m); engine.copy(m, dst); }
      [src, dst] = [dst, src];
    }
    if (src !== target) engine.copy(src, target);
  },

  // Renders a layer with Hold Motion or Echo applied. Returns { rt, opT }.
  async renderHeld(layer, lt, mode, list) {
    const E = engine, fps = this.project.fps;
    const out = this.R('L_out');
    const fxi = layer.effects.find(f => f.enabled && EffectLib.get(f.defId)?.kind === 'hold');
    const echo = layer.effects.find(f => f.enabled && EffectLib.get(f.defId)?.kind === 'echo');
    if (!fxi && !echo) { await this.renderLayer(layer, lt, lt, mode, out, list); return { rt: out, opT: lt }; }

    if (!fxi && echo) {
      // Echo: earlier moments drawn behind, each one fainter.
      const v = evalEffect(layer, echo, lt);
      let accA = this.R('h_accA'), accB = this.R('h_accB'); E.clear(accA);
      const tint = parseColor(v.tint);
      for (let k = Math.round(v.count); k >= 1; k--) {
        const et = lt - k * Math.round(v.delay) / fps; if (et < 0) continue;
        const tmp = await this.renderLayer(layer, et, et, mode, this.R('h_tmp'), list);
        E.composite(accA, tmp, GHOST_TO_MODE[v.blend] ?? 0, Math.pow(v.decay, k), accB, [tint[0], tint[1], tint[2]]);
        [accA, accB] = [accB, accA];
      }
      const main = await this.renderLayer(layer, lt, lt, mode, this.R('h_main'), list);
      E.composite(accA, main, 0, 1, out);
      return { rt: out, opT: lt };
    }

    const v = evalEffect(layer, fxi, lt);
    const n = Math.floor(lt * fps + 1e-6), phase = lt - n / fps;
    const toT = (f) => f / fps + phase;
    let ghostN = 0; const ghostOp = [];
    if (v.ghosts) for (let k = 1; k <= Math.round(v.ghostCount); k++) { const o = Math.pow(1 - v.ghostFalloff, k); if (o < 1 / 512) break; ghostOp.push(o); ghostN = k; }
    const wantBlur = v.snapBlur && v.snapAmount > 0;
    const starts = holdStarts(v, n, Math.max(ghostN, wantBlur ? 1 : 0));
    if (n >= 0 && starts[0] < 0) starts[0] = 0;
    const heldT = toT(starts[0]);
    const tT = (t) => (v.includeTransform ? t : lt);

    let accA = this.R('h_accA'), accB = this.R('h_accB');
    E.clear(accA);
    for (let k = ghostN; k >= 1; k--) {
      if (starts[k] < 0 && n >= 0) continue;
      const g = toT(starts[k]);
      const tmp = await this.renderLayer(layer, g, tT(g), mode, this.R('h_tmp'), list);
      const tint = parseColor(v.ghostTint);
      E.composite(accA, tmp, GHOST_TO_MODE[v.ghostBlend] ?? 0, ghostOp[k - 1], accB, [tint[0], tint[1], tint[2]]);
      [accA, accB] = [accB, accA];
    }
    let main = await this.renderLayer(layer, heldT, tT(heldT), mode, this.R('h_main'), list);
    if (wantBlur && starts[0] === n && n > 0 && !(starts[1] < 0)) {
      const pt = toT(starts[1]);
      const prev = await this.renderLayer(layer, pt, tT(pt), mode, this.R('h_prev'), list);
      const c1 = E.centroid(main), c0 = E.centroid(prev);
      let dx = 0, dy = 0;
      const useAlpha = c1.cover < 0.97 && c0.cover < 0.97 && c1.a > 0 && c0.a > 0;
      if (useAlpha) { dx = c1.ax - c0.ax; dy = c1.ay - c0.ay; }
      if (Math.hypot(dx * E.width, dy * E.height) < 0.5 && c1.l > 0 && c0.l > 0) { dx = c1.lx - c0.lx; dy = c1.ly - c0.ly; }
      const lenPx = Math.hypot(dx * E.width, dy * E.height) * v.snapAmount;
      if (lenPx >= 1) {
        const taps = clamp(Math.ceil(lenPx / 1.5) + 1, 2, 48);
        // Sample toward the new position so the streak trails behind the motion.
        E.dirBlur(main, [-dx * v.snapAmount, -dy * v.snapAmount], taps, this.R('h_blur'));
        main = this.R('h_blur');
      }
    }
    E.composite(accA, main, 0, 1, accB);
    [accA, accB] = [accB, accA];
    if (v.mix < 1) {
      const orig = await this.renderLayer(layer, lt, lt, mode, this.R('h_orig'), list);
      E.mix(orig, accA, v.mix, out);
    } else E.copy(accA, out);
    return { rt: out, opT: tT(heldT) };
  },

  // ---- canvas background --------------------------------------------------------
  async background(project, T, mode, cur) {
    const E = engine, bg = project.canvasBg || { type: 'color' };
    E.clear(cur, parseColor(project.bg));
    if (bg.type === 'image' && bg.mediaId) {
      const m = Media.items.get(bg.mediaId);
      if (m && m.image) {
        const r = Runtime.get({ id: 'bgimg_' + m.id, type: 'bg' });
        if (!r.tex) { r.tex = E.newTex(); E.upload(r.tex, m.image); }
        const s = Math.max(E.compW / m.w, E.compH / m.h) * 100;
        E.drawLayerTex(r.tex, m.w, m.h, { x: E.compW / 2, y: E.compH / 2, scale: s, rotation: 0 }, cur);
      }
    } else if (bg.type === 'blur') {
      // Blurred, zoomed copy of whichever video or photo is on the bottom track now.
      const order = this.ordered(project.layers, project);
      const L = order.find(l => (l.type === 'video' || l.type === 'image') && T >= l.start && T < l.start + l.dur && !this.trackOf(project, l)?.hidden);
      if (L) {
        const m = Media.items.get(L.mediaId);
        const s = Math.max(E.compW / m.w, E.compH / m.h) * 100 * 1.05;
        const tmp = this.R('bg_tmp');
        E.clear(tmp);
        if (L.type === 'video') { const fr = await this.videoFrame(L, srcTimeFor(L, T - L.start), mode, false); if (fr) E.drawLayerTex(fr, m.w, m.h, { x: E.compW / 2, y: E.compH / 2, scale: s, rotation: 0 }, tmp); }
        else { const r = Runtime.get(L); if (!r.tex) { r.tex = E.newTex(); E.upload(r.tex, m.image); } E.drawLayerTex(r.tex, m.w, m.h, { x: E.compW / 2, y: E.compH / 2, scale: s, rotation: 0 }, tmp); }
        const blur = EffectLib.get('tf.blur'), out = this.R('bg_blur');
        E.runEffect(blur, { radius: bg.blur ?? 40 }, tmp, out, T);
        E.composite(cur, out, 0, 1, this.R('bg_comp')); E.copy(this.R('bg_comp'), cur);
      }
    }
  },

  // ---- ordering -------------------------------------------------------------
  trackOf(project, l) { return (project.tracks || []).find(t => t.id === l.track); },
  // Layers in drawing order: bottom track first.
  ordered(layers, project) {
    const tracks = project.tracks || [];
    const idx = (l) => { const i = tracks.findIndex(t => t.id === l.track); return i < 0 ? 1e6 + layers.indexOf(l) : i; };
    return layers.slice().sort((a, b) => idx(a) - idx(b) || layers.indexOf(a) - layers.indexOf(b));
  },

  // ---- compositing a list of layers --------------------------------------------
  async composite(layers, T, mode, top) {
    const E = engine, project = this.project;
    let cur = this.R('accA'), other = this.R('accB');
    if (top) await this.background(project, T, mode, cur); else E.clear(cur);
    const order = top ? this.ordered(layers, project) : layers;
    const fps = project.fps;
    const active = (l) => !l.hidden && T >= l.start - 1e-6 && T < l.start + l.dur - 1e-6;
    const soloOn = top && (project.tracks || []).some(t => t.solo && t.kind !== 'audio');
    const trackHidden = (l) => { if (!top) return false; const t = this.trackOf(project, l); return !!(t && (t.hidden || (soloOn && !t.solo))); };
    // Layers used as a track matte by a visible layer are not drawn themselves.
    const matteSources = new Set(order.filter(l => l.matte && l.matte.src && active(l)).map(l => l.matte.src));

    for (const layer of order) {
      if (layer.type === 'audio' || layer.type === 'null' || !active(layer) || trackHidden(layer) || matteSources.has(layer.id)) continue;
      const lt = T - layer.start;
      if (layer.type === 'adjust') {
        const tmp = this.R('adj');
        E.copy(cur, tmp);
        await this.runEffects(layer, lt, tmp, layers);
        E.mix(cur, tmp, clamp(evalProp(layer, 'transform.opacity', lt) / 100, 0, 1), other);
        [cur, other] = [other, cur];
        continue;
      }
      // Transition in from the clip that ends where this one starts.
      let trA = null, trP = -1, trMode = 0;
      if (layer.transIn && layer.transIn.dur > 0 && lt < layer.transIn.dur) {
        const prev = layers.find(o => o !== layer && o.track === layer.track && Math.abs(o.start + o.dur - layer.start) < 1.5 / fps && VISUAL_TYPES.has(o.type));
        trA = this.R('trA'); E.clear(trA);
        if (prev && !prev.hidden) { const r = await this.renderHeld(prev, T - prev.start, mode, layers); const op = clamp(evalProp(prev, 'transform.opacity', r.opT) / 100, 0, 1); E.copy(r.rt, trA, op); }
        trP = lt / layer.transIn.dur; trMode = (transitionById(layer.transIn.id) || TRANSITIONS[0]).mode;
      }
      const { rt, opT } = await this.renderHeld(layer, lt, mode, layers);
      let src = rt;
      // Track matte: keep this layer only where the matte layer shows.
      if (layer.matte && layer.matte.src) {
        const ml = layers.find(l => l.id === layer.matte.src);
        const mt = this.R('matte_src');
        if (ml && active(ml)) { const keep = this.R('matte_keep'); E.copy(rt, keep); const r2 = await this.renderHeld(ml, T - ml.start, mode, layers); E.copy(r2.rt, mt); src = this.R('matte_out'); E.matte(keep, mt, layer.matte.mode | 0, src); }
        else if (!(layer.matte.mode === 1 || layer.matte.mode === 3)) { src = null; }
      }
      if (!src) continue;
      const op = clamp(evalProp(layer, 'transform.opacity', opT) / 100, 0, 1);
      if (trA) {
        const b = this.R('trB'); E.copy(src, b, op);
        const tout = this.R('trOut'); E.transition(trA, b, trP, trMode, tout);
        E.composite(cur, tout, Math.max(0, BLEND_MODES.indexOf(layer.blend || 'Normal')), 1, other);
      } else if (layer.transOut && layer.transOut.dur > 0 && lt > layer.dur - layer.transOut.dur) {
        const a = this.R('trB'); E.copy(src, a, op);
        const empty = this.R('trA'); E.clear(empty);
        const tout = this.R('trOut'); E.transition(a, empty, (lt - (layer.dur - layer.transOut.dur)) / layer.transOut.dur, (transitionById(layer.transOut.id) || TRANSITIONS[0]).mode, tout);
        E.composite(cur, tout, Math.max(0, BLEND_MODES.indexOf(layer.blend || 'Normal')), 1, other);
      } else {
        E.composite(cur, src, Math.max(0, BLEND_MODES.indexOf(layer.blend || 'Normal')), op, other);
      }
      [cur, other] = [other, cur];
    }
    return cur;
  },

  // Render the whole comp at time T. mode: 'exact' (seek every video frame,
  // used for export and when paused) or 'play' (use live video, no waiting).
  // Only one frame renders at a time, because frames share GPU buffers.
  // Playback frames are dropped instead of queued if a render is running.
  _lock: Promise.resolve(), _locked: false,
  // onDone runs while the lock is still held, so the caller can read the
  // canvas (export, tests) before any other frame draws over it.
  async frame(project, T, mode, onDone) {
    if (mode === 'play' && this._locked) return null;
    const prev = this._lock; let release;
    this._lock = new Promise(r => { release = r; });
    await prev;
    this._locked = true;
    try { const r = await this._frame(project, T, mode); if (onDone) await onDone(r); return r; }
    finally { this._locked = false; release(); }
  },
  async _frame(project, T, mode) {
    this.project = project; this.depth = 0;
    const cur = await this.composite(project.layers, T, mode, true);
    engine.present(cur);
    return cur;
  }
};

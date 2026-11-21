// ===========================================================================
// Keyframe evaluation: property paths, easing curves and interpolation
// ===========================================================================
// ---- Property paths and keyframes ----------------------------------------
// A property is addressed by a path: 'transform.x', 'text.size',
// 'shape.fill', or 'fx.<effectUid>.<paramId>'.
function getPath(layer, path) {
  const parts = path.split('.');
  if (parts[0] === 'fx') { const fxi = layer.effects.find(f => f.uid === parts[1]); return fxi ? fxi.params[parts[2]] : undefined; }
  let o = layer; for (const p of parts) { if (o == null) return undefined; o = o[p]; } return o;
}
function setPath(layer, path, v) {
  const parts = path.split('.');
  if (parts[0] === 'fx') { const fxi = layer.effects.find(f => f.uid === parts[1]); if (fxi) fxi.params[parts[2]] = v; return; }
  let o = layer; for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]]; o[parts[parts.length - 1]] = v;
}
// Cubic bezier timing curve (like CSS cubic-bezier and After Effects
// speed graphs). Solves x(t) = p for t with Newton steps, returns y(t).
function bezierEase(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const X = (t) => ((ax * t + bx) * t + cx) * t, Y = (t) => ((ay * t + by) * t + cy) * t, dX = (t) => (3 * ax * t + 2 * bx) * t + cx;
  return (p) => {
    if (p <= 0) return 0; if (p >= 1) return 1;
    let t = p;
    for (let i = 0; i < 8; i++) { const e = X(t) - p, d = dX(t); if (Math.abs(e) < 1e-5 || Math.abs(d) < 1e-6) break; t -= e / d; }
    t = clamp(t, 0, 1);
    return Y(t);
  };
}
const EASES = {
  linear: t => t,
  ease: t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
  easeIn: t => t * t * t,
  easeOut: t => 1 - Math.pow(1 - t, 3),
  hold: () => 0,
  overshoot: t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
  bounce: t => {
    const n1 = 7.5625, d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },
  elastic: t => t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI) / 3) + 1
};
// Names shown in menus, in order. 'bezier' uses the key's own bz handles.
const EASE_NAMES = [['linear', 'Linear'], ['hold', 'Hold'], ['easeIn', 'Ease In'], ['easeOut', 'Ease Out'], ['ease', 'Ease In-Out'], ['bounce', 'Bounce'], ['elastic', 'Elastic'], ['overshoot', 'Overshoot'], ['bezier', 'Custom curve']];
// Shape of the diamond on the timeline, like After Effects:
// linear = diamond, hold = square, anything eased = hourglass.
function easeShape(e) { return e === 'linear' ? 'kf-linear' : e === 'hold' ? 'kf-hold' : 'kf-ease'; }
function easeFn(k) {
  if (k.e === 'bezier' && Array.isArray(k.bz)) return bezierEase(...k.bz);
  return EASES[k.e] || EASES.ease;
}

function interpValue(a, b, t) {
  if (typeof a === 'number' && typeof b === 'number') return lerp(a, b, t);
  if (Array.isArray(a) && Array.isArray(b)) return a.map((x, i) => lerp(x, b[i] ?? x, t));
  return t < 1 ? a : b;
}
// Value of a property at layer time t (seconds from layer start).
function evalProp(layer, path, t) {
  const keys = layer.keys && layer.keys[path];
  if (!keys || keys.length === 0) return getPath(layer, path);
  if (t <= keys[0].t) return keys[0].v;
  const last = keys[keys.length - 1];
  if (t >= last.t) return last.v;
  for (let i = 0; i < keys.length - 1; i++) {
    const k0 = keys[i], k1 = keys[i + 1];
    if (t >= k0.t && t < k1.t) {
      const f = easeFn(k0)((t - k0.t) / Math.max(1e-6, k1.t - k0.t));
      return interpValue(k0.v, k1.v, f);
    }
  }
  return last.v;
}
function evalTransform(layer, t) {
  const o = {};
  for (const k of Object.keys(layer.transform)) o[k] = evalProp(layer, 'transform.' + k, t);
  return o;
}
function evalGroup(layer, group, t) {
  const o = {};
  for (const k of Object.keys(layer[group] || {})) o[k] = evalProp(layer, group + '.' + k, t);
  return o;
}
function evalEffect(layer, fxi, t) {
  const o = {};
  for (const k of Object.keys(fxi.params)) o[k] = evalProp(layer, `fx.${fxi.uid}.${k}`, t);
  return o;
}


// ---- Keyframe editing helpers used by the timeline and the lane view ------
// A keyframe reference is { path, t } on a layer. Times are seconds from
// the layer's start.
const KF = {
  clipboard: null,
  // Every animated property path on a layer.
  paths(l) { return Object.keys(l.keys || {}).filter(p => (l.keys[p] || []).length); },
  // All distinct key times on a layer (for the diamonds drawn on clips).
  times(l) {
    const m = new Map();
    for (const p of this.paths(l)) for (const k of l.keys[p]) { const id = k.t.toFixed(4); if (!m.has(id)) m.set(id, { t: k.t, e: k.e }); }
    return Array.from(m.values()).sort((a, b) => a.t - b.t);
  },
  sort(l, path) { (l.keys[path] || []).sort((a, b) => a.t - b.t); },
  // Snap a time to frames, the playhead and other keyframes (within 6 px).
  snap(l, t, pps, exclude) {
    const p = App.project, fps = p.fps;
    let best = Math.round(t * fps) / fps;
    if (!App.snapping) return best;
    const lim = 6 / pps;
    const cands = [App.time - l.start, 0, l.dur];
    for (const pt of this.paths(l)) for (const k of l.keys[pt]) if (!exclude || !exclude.has(k)) cands.push(k.t);
    for (const m of p.markers || []) cands.push(m.t - l.start);
    for (const c of cands) if (Math.abs(c - t) < lim && Math.abs(c - t) < Math.abs(best - t) + 1e-9) best = c;
    return best;
  },
  copy(l, refs) {
    if (!refs.length) return;
    const t0 = Math.min(...refs.map(r => r.k.t));
    this.clipboard = refs.map(r => ({ path: r.path, dt: r.k.t - t0, v: deepCopy(r.k.v), e: r.k.e, bz: r.k.bz && r.k.bz.slice() }));
    toast(`Copied ${refs.length} keyframe${refs.length > 1 ? 's' : ''}`);
  },
  // Paste at the playhead. Paths missing on this layer are skipped.
  paste(l) {
    if (!this.clipboard) return 0;
    const at = App.time - l.start; let n = 0;
    App.change(() => {
      for (const c of this.clipboard) {
        if (getPath(l, c.path) === undefined) continue;
        const ks = l.keys[c.path] || (l.keys[c.path] = []);
        const t = Math.round((at + c.dt) * App.project.fps) / App.project.fps;
        const ex = ks.find(k => Math.abs(k.t - t) < 1e-4);
        if (ex) { ex.v = deepCopy(c.v); ex.e = c.e; ex.bz = c.bz; } else ks.push({ t, v: deepCopy(c.v), e: c.e, bz: c.bz });
        this.sort(l, c.path); n++;
      }
    });
    return n;
  },
  remove(l, refs) {
    App.change(() => {
      for (const r of refs) {
        const ks = l.keys[r.path]; if (!ks) continue;
        const i = ks.indexOf(r.k); if (i >= 0) ks.splice(i, 1);
        if (!ks.length) { setPath(l, r.path, deepCopy(r.k.v)); delete l.keys[r.path]; }
      }
    });
  },
  setEase(l, refs, e) { App.change(() => { for (const r of refs) { r.k.e = e; if (e === 'bezier' && !r.k.bz) r.k.bz = [0.42, 0, 0.58, 1]; } }); },
  // Toggle keys for the main transform properties at the playhead (the
  // diamond button next to the playhead, and the K shortcut).
  toggleTransform(l) {
    const paths = l.type === 'adjust' || l.type === 'audio' ? ['transform.opacity'] : ['transform.x', 'transform.y', 'transform.scale', 'transform.rotation', 'transform.opacity'];
    const t = Math.round((App.time - l.start) * App.project.fps) / App.project.fps;
    const any = paths.some(p => App.keyAt(l, p, t));
    App.change(() => {
      l.keys = l.keys || {};
      for (const p of paths) {
        const ks = l.keys[p] || (l.keys[p] = []);
        const k = ks.find(x => Math.abs(x.t - t) < 0.5 / App.project.fps);
        if (any) { if (k) ks.splice(ks.indexOf(k), 1); if (!ks.length) delete l.keys[p]; }
        else if (!k) { ks.push({ t, v: deepCopy(evalProp(l, p, t)), e: 'ease' }); ks.sort((a, b) => a.t - b.t); }
      }
    });
  },
  // Times of keys on the selected layer, for previous / next jumps.
  jump(l, dir) {
    const now = App.time - l.start, ts = this.times(l).map(x => x.t);
    const eps = 0.5 / App.project.fps;
    const t = dir > 0 ? ts.find(x => x > now + eps) : ts.reverse().find(x => x < now - eps);
    if (t != null) App.setTime(l.start + t);
  }
};

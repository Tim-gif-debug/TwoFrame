// ===========================================================================
// Expressions and the full graph editor.
//
// EXPRESSIONS: a short formula on any property, in the style of After
// Effects. The formula gets the keyframed value as "value" and returns the
// value to use. Available inside a formula:
//   value, time (seconds into the clip), T (project time), index
//   wiggle(perSecond, amount)        random smooth wobble
//   loopOut('cycle' | 'pingpong' | 'offset'), loopIn(...)   repeat keyframes
//   linear(x, a, b, v1, v2), ease(x, a, b, v1, v2)          remap a range
//   random(seed), noise(x)
//   layer('Name').prop('transform.x'), also .x .y .scale .rotation .opacity
//   layer('Name').slider / .slider2 / .angle / .checkbox / .color  (controller values)
//   audio(gain)                      loudness of the project's sound right now
//   sin cos abs min max floor round clamp PI
//
// GRAPH EDITOR: value graph and speed graph for one property, draggable
// keys and bezier handles, influence numbers, ease presets and saved curves.
// ===========================================================================
const _evalPropRaw = evalProp;
const Expr = {
  cache: new Map(), depth: 0, errors: new Map(),
  seed(s) { let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h) % 9973; },
  n1(x, seed) { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return lerp(hash01(i, seed), hash01(i + 1, seed), u) * 2 - 1; },
  compile(src) {
    if (this.cache.has(src)) return this.cache.get(src);
    let fn = null;
    try { fn = new Function('H', 'with (H) { return (' + src + '\n); }'); } catch (e) { fn = e; }
    this.cache.set(src, fn);
    return fn;
  },
  // Loudness (0..1) of everything audible at project time T.
  audioLevel(T) {
    const p = App.project; if (!p) return 0;
    let a = 0;
    for (const l of p.layers) {
      if ((l.type !== 'video' && l.type !== 'audio') || T < l.start || T >= l.start + l.dur || l.muted) continue;
      const m = Media.items.get(l.mediaId); if (!m || !m.peaks || !m.audio) continue;
      const st = srcTimeFor(l, T - l.start), n = m.peaks.length, i = Math.floor(st / m.audio.duration * n);
      let v = 0; for (let k = -1; k <= 1; k++) v = Math.max(v, m.peaks[clamp(i + k, 0, n - 1)] || 0);
      a = Math.max(a, v * clamp((l.volume ?? 100) / 100, 0, 2));
    }
    return clamp(a, 0, 1);
  },
  layerApi(l, T) {
    const get = (path) => evalProp(l, path, T - l.start);
    return { prop: get, get x() { return get('transform.x'); }, get y() { return get('transform.y'); }, get scale() { return get('transform.scale'); }, get rotation() { return get('transform.rotation'); }, get opacity() { return get('transform.opacity'); },
      get slider() { return get('controls.slider') || 0; }, get slider2() { return get('controls.slider2') || 0; }, get angle() { return get('controls.angle') || 0; }, get checkbox() { return !!getPath(l, 'controls.checkbox'); }, get color() { return get('controls.color') || [1, 1, 1, 1]; } };
  },
  run(layer, path, t, value, src) {
    const fn = this.compile(src), id = layer.id + path;
    if (typeof fn !== 'function') { this.errors.set(id, fn.message); return value; }
    const p = App.project, T = t + layer.start, sd = this.seed(id), keys = (layer.keys && layer.keys[path]) || [];
    const raw = (tt) => _evalPropRaw(layer, path, tt);
    const loop = (type, out) => {
      if (keys.length < 2) return value;
      const t0 = keys[0].t, t1 = keys[keys.length - 1].t, d = t1 - t0;
      if (d <= 0 || (out ? t <= t1 : t >= t0)) return value;
      const over = out ? t - t1 : t0 - t, n = Math.floor(over / d), local = over % d;
      const fwd = out ? t0 + local : t1 - local, back = out ? t1 - local : t0 + local;
      if (type === 'pingpong') return raw(n % 2 === 0 ? back : fwd);
      const v = raw(fwd);
      if (type === 'offset' && typeof v === 'number') return v + (keys[keys.length - 1].v - keys[0].v) * (n + 1) * (out ? 1 : -1);
      return v;
    };
    const H = {
      value, time: t, T, index: p ? p.layers.indexOf(layer) + 1 : 1, PI: Math.PI,
      sin: Math.sin, cos: Math.cos, abs: Math.abs, min: Math.min, max: Math.max, floor: Math.floor, round: Math.round, sqrt: Math.sqrt, pow: Math.pow, clamp,
      wiggle: (freq = 2, amp = 20) => typeof value === 'number' ? value + this.n1(t * freq, sd) * amp : value,
      loopOut: (type = 'cycle') => loop(type, true), loopIn: (type = 'cycle') => loop(type, false),
      linear: (x, a, b, v1, v2) => lerp(v1, v2, clamp((x - a) / ((b - a) || 1e-9), 0, 1)),
      ease: (x, a, b, v1, v2) => { const f = clamp((x - a) / ((b - a) || 1e-9), 0, 1); return lerp(v1, v2, f * f * (3 - 2 * f)); },
      random: (s) => s == null ? hash01(Math.round(T * (p ? p.fps : 30)), sd) : hash01(Math.round(s * 1000), 17),
      noise: (x) => this.n1(x, sd),
      audio: (gain = 1) => this.audioLevel(T) * gain,
      thisLayer: this.layerApi(layer, T),
      layer: (name) => { const o = p.layers.find(x => x.name === name || x.id === name); return o ? this.layerApi(o, T) : this.layerApi(layer, T); }
    };
    this.depth++;
    try {
      const r = fn(H);
      this.errors.delete(id);
      if (typeof value === 'number') return Number.isFinite(+r) ? +r : value;
      return r == null ? value : r;
    } catch (e) { this.errors.set(id, e.message); return value; }
    finally { this.depth--; }
  }
};
// Every place that reads a property goes through evalProp, so replacing it
// here makes expressions work for transforms, effects, text, shapes and volume.
evalProp = function (layer, path, t) {
  const v = _evalPropRaw(layer, path, t);
  const src = layer.expr && layer.expr[path];
  if (!src || Expr.depth > 6) return v;
  return Expr.run(layer, path, t, v, src);
};

// ---- saved curves (ease curves and speed ramps) ---------------------------------------
const Curves = {
  list: [], ramps: [],
  async load() { const all = await Store.all('effects'); this.list = all.filter(r => String(r.key).startsWith('curve:')).map(r => r.value); this.ramps = all.filter(r => String(r.key).startsWith('ramp:')).map(r => r.value); },
  async save(name, bz) { const c = { id: uid('cv'), name, bz: bz.slice() }; this.list.push(c); await Store.put('effects', 'curve:' + c.id, c); },
  async remove(id) { this.list = this.list.filter(c => c.id !== id); await Store.del('effects', 'curve:' + id); },
  async saveRamp(name, pts) { const c = { id: uid('rp'), name, pts: deepCopy(pts) }; this.ramps.push(c); await Store.put('effects', 'ramp:' + c.id, c); },
  async removeRamp(id) { this.ramps = this.ramps.filter(c => c.id !== id); await Store.del('effects', 'ramp:' + id); }
};
const EASE_PRESETS = [['linear', 'Linear'], ['easeIn', 'Ease In'], ['easeOut', 'Ease Out'], ['ease', 'Easy Ease'], ['bounce', 'Bounce'], ['elastic', 'Elastic'], ['overshoot', 'Overshoot'], ['back', 'Back', [0.68, -0.55, 0.27, 1.55]], ['hold', 'Hold']];
const BZ_OF = { linear: [0.25, 0.25, 0.75, 0.75], ease: [0.65, 0, 0.35, 1], easeIn: [0.55, 0, 1, 0.45], easeOut: [0, 0.55, 0.45, 1], overshoot: [0.34, 1.56, 0.64, 1] };

Object.assign(UI, {
  graphMode: 'value',
  // A small dialog that asks for one line of text.
  ask(title, value, cb, hint) {
    const inp = el('input', { type: 'text', value: value || '', style: { width: '100%' } });
    const ok = () => { const v = inp.value.trim(); this.closeModal(); if (v) cb(v); };
    inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') ok(); });
    this.modal(title, el('div', {}, hint ? el('p', { class: 'hint' }, hint) : null, inp), [['Cancel', () => this.closeModal()], ['OK', ok, 'primary']]);
    setTimeout(() => inp.focus(), 50);
  },

  // ---- expression box (added under the keyframe lanes) -------------------------------
  exprSection(body, l) {
    body.appendChild(el('div', { class: 'sect' }, 'Expressions'));
    const props = this.keyableProps(l);
    const sel = el('select', {}, props.map(([p, n]) => el('option', { value: p }, n + (l.expr && l.expr[p] ? ' ƒ' : ''))));
    if (this._exprPath && props.some(p => p[0] === this._exprPath)) sel.value = this._exprPath;
    const box = el('textarea', { rows: 2, class: 'exprbox', spellcheck: 'false', placeholder: 'wiggle(2, 30)' });
    const err = el('p', { class: 'warn hidden' });
    const load = () => { this._exprPath = sel.value; box.value = (l.expr && l.expr[sel.value]) || ''; const m = Expr.errors.get(l.id + sel.value); err.textContent = m ? 'Problem: ' + m : ''; err.classList.toggle('hidden', !m); };
    const apply = () => {
      const src = box.value.trim(), path = sel.value;
      App.change(() => { l.expr = l.expr || {}; if (src) l.expr[path] = src; else delete l.expr[path]; });
      Expr.errors.delete(l.id + path); const r = Runtime.map.get(l.id); if (r) r.texKey = '';
      evalProp(l, path, App.time - l.start);
      setTimeout(() => { load(); this.renderTimeline(); }, 60);
    };
    sel.onchange = load; box.onchange = apply; box.addEventListener('keydown', (e) => e.stopPropagation());
    const ins = (t) => { box.value = t; apply(); };
    const others = App.project.layers.filter(o => o.id !== l.id);
    const link = el('select', { onchange: (e) => { if (e.target.value) ins(e.target.value); e.target.value = ''; } }, el('option', { value: '' }, 'Link to…'),
      others.flatMap(o => [['transform.x', 'X'], ['transform.y', 'Y'], ['transform.scale', 'Scale'], ['transform.rotation', 'Rotation'], ['transform.opacity', 'Opacity'], ...(o.controls ? [['controls.slider', 'Slider'], ['controls.angle', 'Angle']] : [])]
        .map(([pp, n]) => el('option', { value: `layer(${JSON.stringify(o.name)}).prop('${pp}')` }, `${o.name} › ${n}`))));
    body.append(el('div', { class: 'row' }, el('span', {}, 'Property'), sel), box, err,
      el('div', { class: 'btnrow' },
        el('button', { class: 'btn sm', onclick: () => ins('wiggle(2, 30)') }, 'Wiggle'),
        el('button', { class: 'btn sm', onclick: () => ins("loopOut('cycle')") }, 'Loop'),
        el('button', { class: 'btn sm', onclick: () => ins("loopOut('pingpong')") }, 'Ping-pong'),
        el('button', { class: 'btn sm', onclick: () => ins('value + audio() * 40') }, 'Pulse to sound'),
        el('button', { class: 'btn sm', onclick: () => ins('value + time * 90') }, 'Keep turning'),
        link, el('button', { class: 'btn sm', onclick: () => ins('') }, 'Clear')),
      el('p', { class: 'hint' }, '“value” is the keyframed value. Try wiggle(times per second, amount), loopOut(), or audio() to follow the music.'));
    const used = Object.keys(l.expr || {});
    if (used.length) body.appendChild(el('p', { class: 'hint' }, 'On this clip: ' + used.map(p => this.propLabel(l, p)).join(', ')));
    load();
  },

  // ---- graph editor -----------------------------------------------------------------
  graphGeom(l, path) {
    const ks = l.keys[path] || [], numeric = ks.length && typeof ks[0].v === 'number';
    const V = (k, i) => numeric ? k.v : i;
    const at = (t) => {
      if (!ks.length) return 0;
      if (t <= ks[0].t) return V(ks[0], 0);
      for (let i = 0; i < ks.length - 1; i++) if (t < ks[i + 1].t) { const f = easeFn(ks[i])((t - ks[i].t) / Math.max(1e-6, ks[i + 1].t - ks[i].t)); return lerp(V(ks[i], i), V(ks[i + 1], i + 1), f); }
      return V(ks[ks.length - 1], ks.length - 1);
    };
    const N = 180, vals = [], dur = Math.max(0.01, l.dur);
    for (let i = 0; i <= N; i++) vals.push(at(i / N * dur));
    const sp = vals.map((v, i) => i ? Math.abs(v - vals[i - 1]) / (dur / N) : 0); sp[0] = sp[1] || 0;
    let lo = Math.min(...vals), hi = Math.max(...vals); if (hi - lo < 1e-6) { lo -= 1; hi += 1; } const padv = (hi - lo) * 0.12; lo -= padv; hi += padv;
    return { ks, numeric, V, at, vals, sp, lo, hi, smax: Math.max(1e-6, ...sp) * 1.1, dur, N };
  },
  drawGraph() {
    const st = this._lanes; if (!st) return;
    if (st.dragging) { this.paintGraph(); return; }
    const g = st.graph, l = st.l; g.innerHTML = ''; st.gsvg = null;
    const refs = this.kfSel;
    if (refs.length) {
      // Ease presets and saved curves for the selected keyframes.
      g.appendChild(el('div', { class: 'chips' }, EASE_PRESETS.map(([id, name, bz]) => el('button', { class: 'chip' + (refs.every(r => r.k.e === id) ? ' on' : ''), onclick: () => {
        if (bz) App.change(() => { for (const r of refs) { r.k.e = 'bezier'; r.k.bz = bz.slice(); } }); else KF.setEase(l, refs, id);
        this.drawLanes(); this.renderTimeline(); } }, name)),
        Curves.list.map(c => el('button', { class: 'chip mine', title: 'Your saved curve. Right-click or hold to delete.', onclick: () => { App.change(() => { for (const r of refs) { r.k.e = 'bezier'; r.k.bz = c.bz.slice(); } }); this.drawLanes(); this.renderTimeline(); },
          oncontextmenu: (e) => { e.preventDefault(); this.confirm(`Delete the saved curve “${c.name}”?`, async () => { await Curves.remove(c.id); this.drawLanes(); }); } }, '★ ' + c.name))));
    }
    const path = refs.length ? refs[0].path : (this.graphPath && l.keys[this.graphPath] ? this.graphPath : KF.paths(l)[0]);
    if (!path) { g.appendChild(el('p', { class: 'hint' }, 'Add keyframes to a property and its graph shows here.')); return; }
    st.gpath = path;
    const paths = KF.paths(l);
    g.appendChild(el('div', { class: 'btnrow graphbar' },
      el('select', { onchange: (e) => { this.graphPath = e.target.value; this.kfSel = []; this.drawLanes(); } }, paths.map(p => el('option', { value: p, selected: p === path }, this.propLabel(l, p)))),
      el('button', { class: 'btn sm' + (this.graphMode === 'value' ? ' on' : ''), onclick: () => { this.graphMode = 'value'; this.drawGraph(); } }, 'Value graph'),
      el('button', { class: 'btn sm' + (this.graphMode === 'speed' ? ' on' : ''), onclick: () => { this.graphMode = 'speed'; this.drawGraph(); } }, 'Speed graph')));
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 340 210'); svg.setAttribute('class', 'graph wide');
    g.appendChild(svg); st.gsvg = svg; st.range = null;
    this.paintGraph();
    // Influence numbers for one selected keyframe.
    const one = refs.length === 1 && refs[0].path === path ? refs[0].k : null, ks = l.keys[path], i = one ? ks.indexOf(one) : -1;
    if (one && i >= 0 && i < ks.length - 1 && one.e !== 'hold') {
      const nx = ks[i + 1], bz = one.e === 'bezier' && one.bz ? one.bz : (BZ_OF[one.e] || [0.42, 0, 0.58, 1]);
      const dv = typeof one.v === 'number' ? nx.v - one.v : 1, dt = Math.max(1e-6, nx.t - one.t);
      const setBz = (j, v) => { App.change(() => { one.e = 'bezier'; one.bz = (one.bz || bz).slice(); one.bz[j] = v; }); this.drawLanes(); this.renderTimeline(); };
      const num = (label, val, fn) => el('label', { class: 'gnum' }, label, el('input', { type: 'number', min: 0, max: 100, step: 1, value: Math.round(val), onchange: (e) => fn(clamp(+e.target.value, 0, 100)) }));
      g.appendChild(el('div', { class: 'btnrow' },
        num('Out influence %', bz[0] * 100, (v) => setBz(0, v / 100)), num('In influence %', (1 - bz[2]) * 100, (v) => setBz(2, 1 - v / 100)),
        el('span', { class: 'hint' }, `Speed out ${(bz[1] / Math.max(0.01, bz[0]) * dv / dt).toFixed(1)}/s · in ${((1 - bz[3]) / Math.max(0.01, 1 - bz[2]) * dv / dt).toFixed(1)}/s`),
        one.e === 'bezier' ? el('button', { class: 'btn sm', onclick: () => this.ask('Name this curve', 'My curve', async (n) => { await Curves.save(n, one.bz); this.drawLanes(); toast('Curve saved. It shows with a ★ in the ease list.'); }) }, '★ Save curve') : null));
    }
    g.appendChild(el('p', { class: 'hint' }, this.graphMode === 'value' ? 'Drag a dot to change when and how much. Drag the round handles of a selected keyframe to shape the curve.' : 'Height shows how fast the value changes. Shape it with the handles in the value graph or the influence numbers.'));
    this.bindGraph(svg, l, path);
  },
  paintGraph() {
    const st = this._lanes; if (!st || !st.gsvg) return;
    const l = st.l, path = st.gpath, G = this.graphGeom(l, path);
    if (st.range) { G.lo = st.range.lo; G.hi = st.range.hi; }
    const W = 340, H = 210, pl = 34, pr = 10, pt = 12, pb = 20, speed = this.graphMode === 'speed';
    const X = (t) => pl + t / G.dur * (W - pl - pr), Y = (v) => speed ? H - pb - v / G.smax * (H - pt - pb) : H - pb - (v - G.lo) / (G.hi - G.lo) * (H - pt - pb);
    st.geo = { G, X, Y, W, H, pl, pr, pt, pb };
    const src = speed ? G.sp : G.vals, pts = src.map((v, i) => `${X(i / G.N * G.dur).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
    const out = [`<rect x="${pl}" y="${pt}" width="${W - pl - pr}" height="${H - pt - pb}" class="gbg"/>`];
    const fmt = (v) => Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(Math.abs(v) < 10 ? 2 : 1);
    out.push(`<text x="${pl - 4}" y="${pt + 8}" class="gtxt" text-anchor="end">${speed ? fmt(G.smax) : G.numeric ? fmt(G.hi) : ''}</text><text x="${pl - 4}" y="${H - pb}" class="gtxt" text-anchor="end">${speed ? '0' : G.numeric ? fmt(G.lo) : ''}</text>`);
    out.push(`<text x="${pl}" y="${H - 5}" class="gtxt">0s</text><text x="${W - pr}" y="${H - 5}" class="gtxt" text-anchor="end">${G.dur.toFixed(2)}s</text>`);
    const now = clamp(App.time - l.start, 0, G.dur);
    out.push(`<line x1="${X(now)}" y1="${pt}" x2="${X(now)}" y2="${H - pb}" class="gnow"/>`, `<polyline points="${pts}" class="gcurve"/>`);
    const selK = this.kfSel.filter(r => r.path === path).map(r => r.k);
    G.ks.forEach((k, i) => {
      const y = speed ? H - pb : Y(G.V(k, i));
      if (!speed && selK.length === 1 && selK[0] === k && i < G.ks.length - 1 && k.e !== 'hold') {
        const nx = G.ks[i + 1], v0 = G.V(k, i), v1 = G.V(nx, i + 1), bz = k.e === 'bezier' && k.bz ? k.bz : (BZ_OF[k.e] || [0.42, 0, 0.58, 1]);
        if (Math.abs(v1 - v0) > 1e-9) {
          const h0 = [X(k.t + bz[0] * (nx.t - k.t)), Y(v0 + bz[1] * (v1 - v0))], h1 = [X(k.t + bz[2] * (nx.t - k.t)), Y(v0 + bz[3] * (v1 - v0))];
          out.push(`<line x1="${X(k.t)}" y1="${y}" x2="${h0[0]}" y2="${h0[1]}" class="gh"/><line x1="${X(nx.t)}" y1="${Y(v1)}" x2="${h1[0]}" y2="${h1[1]}" class="gh"/>`,
            `<circle cx="${h0[0]}" cy="${h0[1]}" r="8" class="gdot" data-h="0" data-i="${i}"/><circle cx="${h1[0]}" cy="${h1[1]}" r="8" class="gdot" data-h="1" data-i="${i}"/>`);
        }
      }
      out.push(`<rect x="${X(k.t) - 6}" y="${y - 6}" width="12" height="12" class="gkey ${easeShape(k.e)}${selK.includes(k) ? ' sel' : ''}" data-k="${i}" transform="rotate(45 ${X(k.t)} ${y})"/>`);
    });
    st.gsvg.innerHTML = out.join('');
  },
  bindGraph(svg, l, path) {
    const st = this._lanes;
    svg.addEventListener('pointerdown', (e) => {
      const ki = e.target.getAttribute('data-k'), h = e.target.getAttribute('data-h'); if (ki == null && h == null) return;
      e.preventDefault(); svg.setPointerCapture(e.pointerId);
      const { G, W, H, pl, pr, pt, pb } = st.geo, ks = l.keys[path];
      st.range = { lo: G.lo, hi: G.hi }; st.dragging = true;
      const k = ks[+(ki != null ? ki : e.target.getAttribute('data-i'))];
      if (ki != null && !this.kfSel.some(r => r.k === k)) { this.kfSel = e.shiftKey || this.multi ? [...this.kfSel, { path, k }] : [{ path, k }]; }
      const toT = (ev) => { const r = svg.getBoundingClientRect(); return ((ev.clientX - r.left) / r.width * W - pl) / (W - pl - pr) * G.dur; };
      const toV = (ev) => { const r = svg.getBoundingClientRect(); return G.lo + (H - pb - (ev.clientY - r.top) / r.height * H) / (H - pt - pb) * (G.hi - G.lo); };
      const pps = svg.getBoundingClientRect().width / W * (W - pl - pr) / G.dur;
      const move = (ev) => {
        App.change(() => {
          if (ki != null) {
            k.t = clamp(KF.snap(l, toT(ev), pps, new Set([k])), 0, l.dur);
            if (G.numeric && this.graphMode === 'value' && !ev.shiftKey) k.v = Math.round(toV(ev) * 100) / 100;
          } else {
            const i = ks.indexOf(k), nx = ks[i + 1]; if (!nx) return;
            const bx = clamp((toT(ev) - k.t) / Math.max(1e-6, nx.t - k.t), 0, 1), by = clamp((toV(ev) - G.V(k, i)) / ((G.V(nx, i + 1) - G.V(k, i)) || 1e-9), -1.5, 2.5);
            if (k.e !== 'bezier' || !k.bz) { k.bz = (BZ_OF[k.e] || [0.42, 0, 0.58, 1]).slice(); k.e = 'bezier'; }
            if (h === '0') { k.bz[0] = bx; k.bz[1] = by; } else { k.bz[2] = bx; k.bz[3] = by; }
          }
        }, 'graph' + l.id);
        this.paintGraph(); this.refreshPanelValues && this.refreshPanelValues();
      };
      const up = () => {
        svg.removeEventListener('pointermove', move); svg.removeEventListener('pointerup', up); svg.removeEventListener('pointercancel', up);
        st.dragging = false; st.range = null; KF.sort(l, path); this.drawLanes(); this.renderTimeline();
      };
      svg.addEventListener('pointermove', move); svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', up);
    });
  }
});

// Controller values on a layer (for expressions to read), plus the
// expression box under the keyframe lanes and saved speed ramps.
(() => {
  const keyable = UI.keyableProps;
  UI.keyableProps = function (l) {
    const out = keyable.call(this, l);
    if (l.controls) out.push(['controls.slider', 'Control: Slider'], ['controls.slider2', 'Control: Slider 2'], ['controls.angle', 'Control: Angle'], ['controls.color', 'Control: Colour']);
    return out;
  };
  const kfPanel = UI.panel_keyframes;
  UI.panel_keyframes = function (body, l) { kfPanel.call(this, body, l); this.exprSection(body, l); };
  const speedPanel = UI.panel_speed;
  UI.panel_speed = function (body, l) {
    speedPanel.call(this, body, l);
    const v = l.video; if (!v) return;
    body.appendChild(el('div', { class: 'sect' }, 'My speed curves'));
    body.appendChild(el('div', { class: 'btnrow' },
      v.curve ? el('button', { class: 'btn sm', onclick: () => this.ask('Name this speed curve', v.curveName && v.curveName !== 'Custom' ? v.curveName : 'My ramp', async (n) => { await Curves.saveRamp(n, v.curve); this.refreshPanel(); }) }, '★ Save this curve') : el('span', { class: 'hint' }, 'Pick or draw a speed curve above, then save it here to reuse.'),
      Curves.ramps.map(c => el('button', { class: 'chip mine', onclick: () => { App.change(() => { v.curve = deepCopy(c.pts); v.curveName = c.name; }); const r = Runtime.map.get(l.id); if (r) { for (const q of r.cache.values()) engine.freeRT(q); r.cache.clear(); } this.refresh(); },
        oncontextmenu: (e) => { e.preventDefault(); this.confirm(`Delete “${c.name}”?`, async () => { await Curves.removeRamp(c.id); this.refreshPanel(); }); } }, '★ ' + c.name))));
  };
  const layerPanel = UI.panel_layer;
  UI.panel_layer = function (body, l) {
    layerPanel.call(this, body, l);
    body.appendChild(el('div', { class: 'sect' }, 'Controller values'));
    if (!l.controls) { body.appendChild(el('div', { class: 'btnrow' }, el('button', { class: 'btn sm', onclick: () => { App.change(() => { l.controls = { slider: 0, slider2: 0, angle: 0, checkbox: false, color: [1, 1, 1, 1] }; }); this.refreshPanel(); } }, 'Add sliders for expressions'))); return; }
    body.append(this.propRow(l, 'controls.slider', 'Slider', { min: -1000, max: 1000, smin: 0, smax: 100, step: 0.1 }), this.propRow(l, 'controls.slider2', 'Slider 2', { min: -1000, max: 1000, smin: 0, smax: 100, step: 0.1 }), this.propRow(l, 'controls.angle', 'Angle°', { min: -3600, max: 3600, smin: -180, smax: 180, step: 1 }),
      this.row('Checkbox', el('input', { type: 'checkbox', class: 'tog', checked: l.controls.checkbox, onchange: (e) => App.change(() => { l.controls.checkbox = e.target.checked; }) })),
      el('p', { class: 'hint' }, `Other layers can read these with layer("${l.name}").slider, .slider2, .angle or .checkbox.`));
  };
})();

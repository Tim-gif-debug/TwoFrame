// ===========================================================================
// On-canvas editing: tap a picture to select it, drag to move it, pinch and
// twist with two fingers to scale and rotate, or use the corner, rotate and
// anchor handles on the selection box. Animated clips show their motion
// path with a dot per keyframe that can be dragged. Double-tap (or
// double-click) a text layer to type straight onto the video.
// All positions here are in project pixels (the export size).
// ===========================================================================
const SVGNS = 'http://www.w3.org/2000/svg';

Object.assign(UI, {
  // ---- geometry helpers ----------------------------------------------------------
  // Content size of a layer before scaling, in project pixels.
  layerSize(l) {
    const p = App.project, r = Runtime.get(l);
    if (l.type === 'video' || l.type === 'image') { const m = Media.items.get(l.mediaId); return m ? [m.w, m.h] : null; }
    if (l.type === 'text' || l.type === 'shape' || l.type === 'caption' || CANVAS_LAYERS[l.type]) return r.texW ? [r.texW, r.texH] : null;
    if (l.type === 'solid') { const s = l.solid || {}; return [s.w || p.width, s.h || p.height]; }
    if (l.type === 'group') return [p.width, p.height];
    if (l.type === 'null') return [0, 0];
    return null;
  },
  // Turns a point inside the picture (content pixels) into a project point.
  toWorld(tr, cw, ch, px, py) {
    const s = (tr.scale ?? 100) / 100, sx = s * (tr.flipX ? -1 : 1), sy = s * (tr.flipY ? -1 : 1);
    const th = (tr.rotation || 0) * Math.PI / 180, c = Math.cos(th), n = Math.sin(th);
    const dx = (px - cw / 2 - (tr.anchorX || 0)) * sx, dy = (py - ch / 2 - (tr.anchorY || 0)) * sy;
    return [tr.x + c * dx - n * dy, tr.y + n * dx + c * dy];
  },
  toContent(tr, cw, ch, X, Y) {
    const s = (tr.scale ?? 100) / 100 || 1e-6, sx = s * (tr.flipX ? -1 : 1), sy = s * (tr.flipY ? -1 : 1);
    const th = (tr.rotation || 0) * Math.PI / 180, c = Math.cos(th), n = Math.sin(th);
    const ux = X - tr.x, uy = Y - tr.y;
    return [(c * ux + n * uy) / sx + cw / 2 + (tr.anchorX || 0), (-n * ux + c * uy) / sy + ch / 2 + (tr.anchorY || 0)];
  },
  // A move on screen, turned into a change of the layer's own x / y
  // (children are stored relative to their parent).
  localDelta(l, dx, dy) {
    if (!l.parent) return [dx, dy];
    const P = App.layer(l.parent); if (!P) return [dx, dy];
    const pt = worldTransform(P, App.time - P.start, App.project.layers);
    const s = (pt.scale ?? 100) / 100 || 1e-6, th = -(pt.rotation || 0) * Math.PI / 180, c = Math.cos(th), n = Math.sin(th);
    return [(c * dx - n * dy) / s, (n * dx + c * dy) / s];
  },
  activeAt(l, T = App.time) { return T >= l.start && T < l.start + l.dur; },
  // Corner points and the transform of a layer at the playhead.
  layerBox(l) {
    if (!VISUAL_TYPES.has(l.type)) return null;
    const size = this.layerSize(l); if (!size) return null;
    const lt = App.time - l.start, tr = worldTransform(l, lt, App.project.layers);
    let [cw, ch] = size;
    const crop = l.crop ? evalGroup(l, 'crop', lt) : { l: 0, r: 0, t: 0, b: 0 };
    const x0 = cw * (crop.l || 0), x1 = cw * (1 - (crop.r || 0)), y0 = ch * (crop.t || 0), y1 = ch * (1 - (crop.b || 0));
    const pts = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([a, b]) => this.toWorld(tr, cw, ch, a, b));
    return { tr, cw, ch, pts, x0, x1, y0, y1 };
  },
  hitLayer(X, Y) {
    const p = App.project;
    const list = Renderer.ordered(p.layers, p).filter(l => this.activeAt(l) && !l.hidden && !App.track(l.track)?.hidden && !App.track(l.track)?.locked);
    for (let i = list.length - 1; i >= 0; i--) {
      const l = list[i], b = this.layerBox(l); if (!b) continue;
      if (l.type === 'null') { if (Math.hypot(X - b.tr.x, Y - b.tr.y) < 40) return l; continue; }
      const [u, v] = this.toContent(b.tr, b.cw, b.ch, X, Y);
      if (u >= b.x0 && u <= b.x1 && v >= b.y0 && v <= b.y1) return l;
    }
    return null;
  },
  // Pointer position in project pixels.
  stagePoint(e) {
    const c = $('#gl'), r = c.getBoundingClientRect(), p = App.project;
    return [(e.clientX - r.left) * p.width / r.width, (e.clientY - r.top) * p.height / r.height];
  },
  pxPerProject() { const c = $('#gl'), r = c.getBoundingClientRect(); return r.width / App.project.width || 1; },

  // ---- pointer handling on the preview -------------------------------------------------
  initStageGestures() {
    const stage = $('#stage'); if (!stage) return;
    const pts = new Map();
    let g = null, lastTap = { t: 0, id: null };
    const editable = (l) => l && !App.track(l.track)?.locked;
    const startPinch = () => {
      const l = App.layer(); if (!editable(l) || pts.size < 2) return;
      const [a, b] = [...pts.values()];
      const tr = evalTransform(l, App.time - l.start);
      g = { kind: 'pinch', l, d0: Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, a0: Math.atan2(b[1] - a[1], b[0] - a[0]), m0: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], tr };
    };
    stage.addEventListener('pointerdown', (e) => {
      if (!App.project || e.target.closest('.inlineText') || e.button === 2) return;
      if (Player.playing) Player.pause();
      const P = this.stagePoint(e);
      // Another tool asked for a tap on the preview (tracker, pen, colour picker).
      if (this._pick) { const cb = this._pick; if (cb(P, e) !== true) this._pick = null; return; }
      pts.set(e.pointerId, P);
      stage.setPointerCapture(e.pointerId);
      if (pts.size === 2) { startPinch(); return; }
      if (pts.size > 2) return;
      const h = e.target.getAttribute && e.target.getAttribute('data-h');
      const sel = App.layer();
      if (h && sel) {
        e.preventDefault();
        const tr = evalTransform(sel, App.time - sel.start), b = this.layerBox(sel);
        if (h === 'rot') g = { kind: 'rot', l: sel, tr, a0: Math.atan2(P[1] - b.tr.y, P[0] - b.tr.x) };
        else if (h === 'anchor') g = { kind: 'anchor', l: sel, tr, P0: P, b };
        else if (h.startsWith('mp')) g = { kind: 'path', l: sel, t: +h.slice(2), P0: P, tr: evalTransform(sel, +h.slice(2)) };
        else g = { kind: 'scale', l: sel, tr, d0: Math.hypot(P[0] - b.tr.x, P[1] - b.tr.y) || 1 };
        return;
      }
      const hit = this.hitLayer(P[0], P[1]);
      // Double tap / double click on text opens the inline editor.
      const now = performance.now();
      if (hit && hit.type === 'text' && lastTap.id === hit.id && now - lastTap.t < 350) { lastTap = { t: 0, id: null }; g = null; this.editTextInline(hit); return; }
      lastTap = { t: now, id: hit ? hit.id : null };
      if (hit && hit.id !== App.sel) { App.sel = hit.id; App.selIds = new Set([hit.id]); this.kfSel = []; this.refresh(); }
      const target = hit || (sel && this.layerBox(sel) && this.hitLayer(P[0], P[1]) === sel ? sel : null);
      g = target && editable(target) ? { kind: 'move', l: target, P0: P, tr: evalTransform(target, App.time - target.start), moved: false } : { kind: 'tap', P0: P, hit };
    });
    stage.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId) || !g) return;
      const P = this.stagePoint(e); pts.set(e.pointerId, P);
      const l = g.l, key = 'stage' + (l && l.id);
      if (g.kind === 'pinch' && pts.size >= 2) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(b[0] - a[0], b[1] - a[1]), ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
        const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], [dx, dy] = this.localDelta(l, m[0] - g.m0[0], m[1] - g.m0[1]);
        App.setProp(l, 'transform.scale', clamp(g.tr.scale * d / g.d0, 1, 5000), key);
        App.setProp(l, 'transform.rotation', g.tr.rotation + (ang - g.a0) * 180 / Math.PI, key);
        App.setProp(l, 'transform.x', g.tr.x + dx, key); App.setProp(l, 'transform.y', g.tr.y + dy, key);
      } else if (g.kind === 'move') {
        let dx = P[0] - g.P0[0], dy = P[1] - g.P0[1];
        if (!g.moved && Math.hypot(dx, dy) * this.pxPerProject() < 4) return;
        g.moved = true;
        [dx, dy] = this.localDelta(l, dx, dy);
        let x = g.tr.x + dx, y = g.tr.y + dy;
        // Snap to the centre lines of the frame when close.
        if (App.snapping && !l.parent) { const p = App.project, tol = 8 / this.pxPerProject(); if (Math.abs(x - p.width / 2) < tol) x = p.width / 2; if (Math.abs(y - p.height / 2) < tol) y = p.height / 2; g.snapX = x === p.width / 2; g.snapY = y === p.height / 2; }
        App.setProp(l, 'transform.x', x, key); App.setProp(l, 'transform.y', y, key);
      } else if (g.kind === 'scale') {
        const b = this.layerBox(l), d = Math.hypot(P[0] - b.tr.x, P[1] - b.tr.y);
        App.setProp(l, 'transform.scale', clamp(g.tr.scale * d / g.d0, 1, 5000), key);
      } else if (g.kind === 'rot') {
        const b = this.layerBox(l); let a = g.tr.rotation + (Math.atan2(P[1] - b.tr.y, P[0] - b.tr.x) - g.a0) * 180 / Math.PI;
        if (e.shiftKey) a = Math.round(a / 15) * 15;
        App.setProp(l, 'transform.rotation', a, key);
      } else if (g.kind === 'anchor') {
        // Move the anchor point but keep the picture where it is.
        const { b } = g, D = [P[0] - g.P0[0], P[1] - g.P0[1]];
        const [u0, v0] = this.toContent(b.tr, b.cw, b.ch, b.tr.x, b.tr.y), [u1, v1] = this.toContent(b.tr, b.cw, b.ch, b.tr.x + D[0], b.tr.y + D[1]);
        const [lx, ly] = this.localDelta(l, D[0], D[1]);
        App.setProp(l, 'transform.anchorX', g.tr.anchorX + (u1 - u0), key); App.setProp(l, 'transform.anchorY', g.tr.anchorY + (v1 - v0), key);
        App.setProp(l, 'transform.x', g.tr.x + lx, key); App.setProp(l, 'transform.y', g.tr.y + ly, key);
      } else if (g.kind === 'path') {
        const [dx, dy] = this.localDelta(l, P[0] - g.P0[0], P[1] - g.P0[1]);
        App.change(() => {
          for (const [path, v] of [['transform.x', g.tr.x + dx], ['transform.y', g.tr.y + dy]]) { const k = App.keyAt(l, path, g.t); if (k) k.v = v; }
        }, key);
      }
      this.refreshPanelValues();
    });
    const end = (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (g && g.kind === 'pinch') { g = pts.size === 1 ? null : g; if (!pts.size) g = null; this.renderTimeline(); return; }
      if (g && g.kind === 'tap' && !g.hit && e.type === 'pointerup') {
        // Tap on empty preview: clear the selection.
        if (App.sel) { App.sel = null; App.selIds.clear(); this.kfSel = []; if (Layout.mode === 'mobile') this.closeSheet(true); this.refresh(); }
      }
      if (g && g.kind !== 'tap') this.renderTimeline();
      g = null; this.drawOverlay();
    };
    stage.addEventListener('pointerup', end); stage.addEventListener('pointercancel', end);
    stage.addEventListener('dblclick', (e) => { const l = this.hitLayer(...this.stagePoint(e)); if (l && l.type === 'text') this.editTextInline(l); });
    // Ctrl / pinch-zoom on a trackpad scales the selected layer.
    stage.addEventListener('wheel', (e) => {
      const l = App.layer(); if (!l || !e.ctrlKey || App.track(l.track)?.locked) return;
      e.preventDefault();
      const tr = evalTransform(l, App.time - l.start);
      App.setProp(l, 'transform.scale', clamp(tr.scale * Math.exp(-e.deltaY / 300), 1, 5000), 'wheel' + l.id);
      this.refreshPanelValues();
    }, { passive: false });
  },

  initOverlay() {
    const o = $('#overlay'); if (!o) return;
    o.setAttribute('preserveAspectRatio', 'none');
  },

  // Redraws the selection box, handles and motion path.
  drawOverlay() {
    const o = $('#overlay'), p = App.project; if (!o || !p) return;
    if (this._lanes && this._lanes.lanes && this._lanes.lanes.isConnected) this.drawLanes();
    o.setAttribute('viewBox', `0 0 ${p.width} ${p.height}`);
    const l = App.layer();
    if (Player.playing || !l || !this.activeAt(l) || !VISUAL_TYPES.has(l.type)) { o.innerHTML = ''; return; }
    const b = this.layerBox(l); if (!b) { o.innerHTML = ''; return; }
    const k = 1 / this.pxPerProject(), hs = 9 * k, out = [];
    const touch = Layout.mode === 'mobile', hr = (touch ? 10 : 6) * k;
    // Motion path: where the clip travels, with a dot per position key.
    const kx = App.keysOf(l, 'transform.x'), ky = App.keysOf(l, 'transform.y');
    if (kx.length > 1 || ky.length > 1) {
      const ts = [...new Set([...kx, ...ky].map(q => q.t))].sort((a, b) => a - b);
      const t0 = ts[0], t1 = ts[ts.length - 1], N = 80, line = [];
      for (let i = 0; i <= N; i++) { const t = t0 + (t1 - t0) * i / N, w = worldTransform(l, t, p.layers); line.push(`${w.x.toFixed(1)},${w.y.toFixed(1)}`); }
      out.push(`<polyline points="${line.join(' ')}" class="mpath" vector-effect="non-scaling-stroke"/>`);
      for (const t of ts) { const w = worldTransform(l, t, p.layers); const isNow = Math.abs(t - (App.time - l.start)) < 0.5 / p.fps; out.push(`<circle cx="${w.x}" cy="${w.y}" r="${hr * 0.8}" class="mdot${isNow ? ' now' : ''}" data-h="mp${t}" vector-effect="non-scaling-stroke"/>`); }
    }
    if (l.type === 'null') {
      out.push(`<path d="M${b.tr.x - 40 * k},${b.tr.y}H${b.tr.x + 40 * k}M${b.tr.x},${b.tr.y - 40 * k}V${b.tr.y + 40 * k}" class="selbox" vector-effect="non-scaling-stroke"/>`);
    } else {
      out.push(`<polygon points="${b.pts.map(q => q.join(',')).join(' ')}" class="selbox" vector-effect="non-scaling-stroke"/>`);
      if (!App.track(l.track)?.locked) {
        const top = [(b.pts[0][0] + b.pts[1][0]) / 2, (b.pts[0][1] + b.pts[1][1]) / 2];
        const th = (b.tr.rotation || 0) * Math.PI / 180, off = 36 * k, rp = [top[0] + Math.sin(th) * off, top[1] - Math.cos(th) * off];
        out.push(`<line x1="${top[0]}" y1="${top[1]}" x2="${rp[0]}" y2="${rp[1]}" class="selbox" vector-effect="non-scaling-stroke"/>`);
        out.push(`<circle cx="${rp[0]}" cy="${rp[1]}" r="${hr}" class="hrot" data-h="rot" vector-effect="non-scaling-stroke"/>`);
        b.pts.forEach((q, i) => out.push(`<rect x="${q[0] - hr}" y="${q[1] - hr}" width="${hr * 2}" height="${hr * 2}" rx="${hr * 0.4}" class="hcorner" data-h="c${i}" vector-effect="non-scaling-stroke"/>`));
      }
    }
    // Anchor point (the spot it scales and spins around).
    out.push(`<g class="hanchor" data-h="anchor"><circle cx="${b.tr.x}" cy="${b.tr.y}" r="${hr}" data-h="anchor" vector-effect="non-scaling-stroke"/><path d="M${b.tr.x - hs},${b.tr.y}H${b.tr.x + hs}M${b.tr.x},${b.tr.y - hs}V${b.tr.y + hs}" data-h="anchor" vector-effect="non-scaling-stroke"/></g>`);
    // Centre guides while snapping.
    if (App.snapping && Math.abs(b.tr.x - p.width / 2) < 0.5) out.push(`<line x1="${p.width / 2}" y1="0" x2="${p.width / 2}" y2="${p.height}" class="guide" vector-effect="non-scaling-stroke"/>`);
    if (App.snapping && Math.abs(b.tr.y - p.height / 2) < 0.5) out.push(`<line x1="0" y1="${p.height / 2}" x2="${p.width}" y2="${p.height / 2}" class="guide" vector-effect="non-scaling-stroke"/>`);
    o.innerHTML = out.join('');
  },

  // ---- type straight onto the video ------------------------------------------------------
  editTextInline(l) {
    if (App.track(l.track)?.locked) return;
    $('.inlineText')?.remove();
    const stage = $('#stage'), c = $('#gl'), sr = stage.getBoundingClientRect(), cr = c.getBoundingClientRect();
    const b = this.layerBox(l), k = this.pxPerProject();
    const xs = b ? b.pts.map(q => q[0]) : [App.project.width / 4], ys = b ? b.pts.map(q => q[1]) : [App.project.height / 3];
    const tx = evalGroup(l, 'text', App.time - l.start);
    const ta = el('textarea', { class: 'inlineText', spellcheck: 'false' });
    ta.value = l.text.content;
    const minW = 160;
    Object.assign(ta.style, {
      left: Math.max(0, cr.left - sr.left + Math.min(...xs) * k) + 'px', top: Math.max(0, cr.top - sr.top + Math.min(...ys) * k) + 'px',
      width: Math.max(minW, (Math.max(...xs) - Math.min(...xs)) * k) + 'px', minHeight: Math.max(44, (Math.max(...ys) - Math.min(...ys)) * k) + 'px',
      fontFamily: Fonts.css(tx.font), fontWeight: tx.weight, fontSize: clamp(tx.size * k * ((b ? b.tr.scale : 100) / 100), 14, 90) + 'px', textAlign: tx.align
    });
    stage.appendChild(ta);
    const before = l.text.content;
    let done = false;
    const commit = (keep) => {
      if (done) return; done = true;
      const v = ta.value; ta.remove();
      if (keep && v !== before) { App.change(() => { l.text.content = v || ' '; }); this.refreshPanel(); this.renderTimeline(); }
    };
    ta.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') commit(false); if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) commit(true); });
    ta.addEventListener('blur', () => commit(true));
    ta.addEventListener('pointerdown', (e) => e.stopPropagation());
    setTimeout(() => { ta.focus(); ta.select(); }, 30);
  }
});

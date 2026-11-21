// ===========================================================================
// Keyframe lanes (Alight Motion style) and the graph editor.
// Each animated property gets its own row of diamonds across the clip.
// Tap a diamond to select it (Shift/Ctrl or the Multi button adds more),
// drag to move every selected key, drag on empty space with a mouse to
// box-select, long-press or right-click for Copy / Paste / Duplicate /
// Delete / Easing. Select one key to edit its speed curve below.
// ===========================================================================
Object.assign(UI, {
  kfSel: [],
  // Properties that can be keyframed on a layer, for the "Animate…" picker.
  keyableProps(l) {
    const out = [];
    const add = (path, label) => { if (getPath(l, path) !== undefined && typeof getPath(l, path) !== 'string' && typeof getPath(l, path) !== 'boolean') out.push([path, label]); };
    if (l.type !== 'audio') { if (l.type !== 'adjust') [['x', 'Position X'], ['y', 'Position Y'], ['scale', 'Scale'], ['rotation', 'Rotation'], ['anchorX', 'Anchor X'], ['anchorY', 'Anchor Y']].forEach(([k, n]) => add('transform.' + k, n)); add('transform.opacity', 'Opacity'); }
    if (l.type === 'video' || l.type === 'audio') add('volume', 'Volume');
    if (l.text && l.type === 'text') for (const [k, n] of [['size', 'Text size'], ['letterSpacing', 'Letter spacing'], ['color', 'Text colour'], ['curve', 'Curve'], ['strokeWidth', 'Stroke width'], ['glowSize', 'Glow size']]) add('text.' + k, n);
    if (l.shape) for (const [k, n] of [['w', 'Width'], ['h', 'Height'], ['radius', 'Corner radius'], ['fill', 'Fill colour'], ['strokeWidth', 'Stroke width'], ['trimStart', 'Trim start'], ['trimEnd', 'Trim end'], ['trimOffset', 'Trim offset']]) add('shape.' + k, n);
    if (l.crop) for (const k of ['l', 'r', 't', 'b']) add('crop.' + k, 'Crop ' + { l: 'left', r: 'right', t: 'top', b: 'bottom' }[k]);
    for (const f of l.effects) { const d = EffectLib.get(f.defId); if (!d) continue; for (const p of d.params) if (p.id && (p.kind === 'spinner' || p.kind === 'color')) out.push([`fx.${f.uid}.${p.id}`, `${d.name}: ${p.label}`]); }
    return out;
  },
  propLabel(l, path) { const f = this.keyableProps(l).find(([p]) => p === path); return f ? f[1] : path; },

  panel_keyframes(body, l) {
    const top = el('div', { class: 'btnrow kfbar' },
      btn('kfPrev', 'Previous keyframe', () => KF.jump(l, -1)),
      el('button', { class: 'btn' + (KF.paths(l).some(p => App.keyAt(l, p)) ? ' on' : ''), onclick: () => { KF.toggleTransform(l); this.refresh(); } }, '◆ Key at playhead'),
      btn('kfNext', 'Next keyframe', () => KF.jump(l, 1)),
      el('button', { class: 'btn' + (this.multi ? ' on' : ''), onclick: () => { this.multi = !this.multi; this.refreshPanel(); this.updateTransport(); } }, 'Multi-select'),
      el('button', { class: 'btn' + (App.snapping ? ' on' : ''), onclick: () => { App.snapping = !App.snapping; this.refreshPanel(); this.updateTransport(); } }, 'Snap'));
    const add = el('select', { onchange: (e) => { const path = e.target.value; if (!path) return; App.toggleKey(l, path); this.refreshPanel(); } },
      el('option', { value: '' }, 'Animate a property…'), this.keyableProps(l).filter(([p]) => !App.keysOf(l, p).length).map(([p, n]) => el('option', { value: p }, n)));
    body.append(top, el('div', { class: 'row' }, add));
    const paths = KF.paths(l);
    const lanes = el('div', { class: 'lanes' });
    if (!paths.length) lanes.appendChild(el('p', { class: 'hint' }, 'Nothing is animated yet. Move the playhead, then tap “◆ Key at playhead”, a diamond next to any setting, or pick a property above.'));
    else {
      lanes.appendChild(el('div', { class: 'lrow lruler' }, el('span', { class: 'llabel' }, ''), el('div', { class: 'ltrack', id: 'laneRuler' })));
      for (const path of paths) {
        const track = el('div', { class: 'ltrack', 'data-path': path });
        lanes.appendChild(el('div', { class: 'lrow' }, el('span', { class: 'llabel', title: path }, this.propLabel(l, path),
          el('button', { class: 'lclear', title: 'Stop animating this property', onclick: () => { App.clearKeys(l, path); this.kfSel = []; this.refreshPanel(); } }, '×')), track));
      }
    }
    body.appendChild(lanes);
    const sel = el('div', { class: 'btnrow kfsel' });
    body.appendChild(sel);
    const graph = el('div', { class: 'graphbox' });
    body.appendChild(graph);
    this._lanes = { l, lanes, sel, graph };
    requestAnimationFrame(() => this.drawLanes());
    this.bindLaneEvents(lanes, l);
  },
  // Draw diamonds, the playhead line and the selection buttons.
  drawLanes() {
    const st = this._lanes; if (!st || !st.lanes.isConnected) return;
    const l = App.layer(); if (!l || l !== st.l && l.id !== st.l.id) return;
    this.kfSel = this.kfSel.filter(r => l.keys[r.path] && l.keys[r.path].includes(r.k));
    const tracks = $$('.ltrack', st.lanes); if (!tracks.length) return;
    const W = tracks[0].clientWidth || 200, pps = W / Math.max(0.01, l.dur);
    st.pps = pps;
    const now = App.time - l.start;
    for (const tr of tracks) {
      tr.innerHTML = '';
      tr.appendChild(el('i', { class: 'lph', style: { left: clamp(now, 0, l.dur) * pps + 'px' } }));
      if (tr.id === 'laneRuler') {
        const step = [0.1, 0.25, 0.5, 1, 2, 5, 10, 30].find(s => s * pps >= 40) || 30;
        for (let t = 0; t <= l.dur + 1e-6; t += step) tr.appendChild(el('span', { class: 'ltick', style: { left: t * pps + 'px' } }, (+t.toFixed(2)) + 's'));
        continue;
      }
      const path = tr.dataset.path;
      for (const k of l.keys[path] || []) {
        const on = this.kfSel.some(r => r.k === k);
        const d = el('i', { class: `ld ${easeShape(k.e)}${on ? ' sel' : ''}${Math.abs(k.t - now) < 0.5 / App.project.fps ? ' now' : ''}`, style: { left: k.t * pps + 'px' } });
        d._ref = { path, k };
        tr.appendChild(d);
      }
    }
    // Selection actions.
    st.sel.innerHTML = '';
    if (this.kfSel.length) {
      const refs = this.kfSel;
      st.sel.append(el('span', { class: 'hint' }, `${refs.length} selected`),
        el('select', { onchange: (e) => { KF.setEase(l, refs, e.target.value); this.drawLanes(); this.renderTimeline(); } }, el('option', { value: '' }, 'Easing…'), EASE_NAMES.map(([v, n]) => el('option', { value: v, selected: refs.every(r => r.k.e === v) }, n))),
        el('button', { class: 'btn sm', onclick: () => KF.copy(l, refs) }, 'Copy'),
        el('button', { class: 'btn sm', onclick: () => { this.duplicateKeys(l, refs); } }, 'Duplicate'),
        el('button', { class: 'btn sm', onclick: () => { KF.remove(l, refs); this.kfSel = []; this.refreshPanel(); this.renderTimeline(); } }, 'Delete'));
    }
    if (KF.clipboard) st.sel.append(el('button', { class: 'btn sm', onclick: () => { KF.paste(l); this.refreshPanel(); this.renderTimeline(); } }, 'Paste at playhead'));
    this.drawGraph();
  },
  duplicateKeys(l, refs) {
    const off = 5 / App.project.fps, created = [];
    App.change(() => { for (const r of refs) { const k = { ...deepCopy(r.k), t: Math.min(l.dur, r.k.t + off) }; l.keys[r.path].push(k); KF.sort(l, r.path); created.push({ path: r.path, k }); } });
    this.kfSel = created; this.drawLanes(); this.renderTimeline();
  },
  bindLaneEvents(lanes, l) {
    let press = null;
    lanes.addEventListener('contextmenu', (e) => { const d = e.target.closest('.ld'); if (!d) return; e.preventDefault(); if (!this.kfSel.some(r => r.k === d._ref.k)) this.kfSel = [d._ref]; this.drawLanes(); this.keyMenu(l, e.clientX, e.clientY); });
    lanes.addEventListener('pointerdown', (e) => {
      const st = this._lanes; if (!st) return;
      const d = e.target.closest('.ld'), tr = e.target.closest('.ltrack');
      if (!tr) return;
      const add = e.shiftKey || e.ctrlKey || e.metaKey || this.multi;
      if (d) {
        e.preventDefault();
        const ref = d._ref, isSel = this.kfSel.some(r => r.k === ref.k);
        if (add) { this.kfSel = isSel ? this.kfSel.filter(r => r.k !== ref.k) : [...this.kfSel, ref]; }
        else if (!isSel) this.kfSel = [ref];
        this.drawLanes();
        const x0 = e.clientX, starts = this.kfSel.map(r => ({ r, t: r.k.t })), ex = new Set(this.kfSel.map(r => r.k));
        let moved = false;
        const lp = setTimeout(() => { if (!moved) this.keyMenu(l, e.clientX, e.clientY); }, 550);
        const move = (ev) => {
          if (Math.abs(ev.clientX - x0) > 3) { moved = true; clearTimeout(lp); }
          if (!moved) return;
          const dt = (ev.clientX - x0) / st.pps;
          const lead = starts.find(s => s.r.k === ref.k) || starts[0];
          const snapped = KF.snap(l, lead.t + dt, st.pps, ex), shift = snapped - lead.t;
          App.change(() => { for (const s of starts) s.r.k.t = clamp(s.t + shift, 0, l.dur); }, 'lanes' + l.id);
          this.drawLanes();
        };
        const up = () => {
          clearTimeout(lp); document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up);
          if (moved) { App.change(() => { for (const p of KF.paths(l)) KF.sort(l, p); }, 'lanes' + l.id); this.renderTimeline(); }
          else if (!add) App.setTime(l.start + ref.k.t);
        };
        document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
        return;
      }
      // Empty lane: mouse drag box-selects; a tap moves the playhead and clears the selection.
      const r0 = lanes.getBoundingClientRect(), x0 = e.clientX, y0 = e.clientY;
      const box = el('div', { class: 'lbox' }); lanes.appendChild(box);
      let moved = false;
      const move = (ev) => {
        if (e.pointerType !== 'mouse') return;
        if (Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) > 4) moved = true;
        Object.assign(box.style, { display: 'block', left: Math.min(x0, ev.clientX) - r0.left + 'px', top: Math.min(y0, ev.clientY) - r0.top + lanes.scrollTop + 'px', width: Math.abs(ev.clientX - x0) + 'px', height: Math.abs(ev.clientY - y0) + 'px' });
      };
      const up = (ev) => {
        document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up);
        const br = box.getBoundingClientRect(); box.remove();
        if (moved) {
          const picked = $$('.ld', lanes).filter(n => { const r = n.getBoundingClientRect(); return r.right > br.left && r.left < br.right && r.bottom > br.top && r.top < br.bottom; }).map(n => n._ref);
          this.kfSel = add ? [...this.kfSel, ...picked] : picked;
        } else {
          const trr = tr.getBoundingClientRect(); if (!add) this.kfSel = [];
          App.setTime(l.start + clamp((ev.clientX - trr.left) / (this._lanes.pps || 1), 0, l.dur));
        }
        this.drawLanes();
      };
      document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
    });
  },
  keyMenu(l, x, y) {
    const refs = this.kfSel;
    this.menu(x, y, [
      ['Copy', () => KF.copy(l, refs)], KF.clipboard ? ['Paste at playhead', () => { KF.paste(l); this.refreshPanel(); this.renderTimeline(); }] : null,
      ['Duplicate', () => this.duplicateKeys(l, refs)], ['-'],
      ...EASE_NAMES.map(([v, n]) => ['Easing: ' + n, () => { KF.setEase(l, refs, v); this.drawLanes(); this.renderTimeline(); }]),
      ['-'], ['Delete', () => { KF.remove(l, refs); this.kfSel = []; this.refreshPanel(); this.renderTimeline(); }, 'danger']]);
  },

  // ---- graph editor: speed curve between one key and the next ----------------------
  // The svg is kept and only its contents change while a handle is dragged,
  // so the drag is not lost when the playhead or panel redraws.
  drawGraph() {
    const st = this._lanes; if (!st) return;
    const g = st.graph, l = st.l;
    const one = this.kfSel.length === 1 ? this.kfSel[0] : null;
    if (one && st.gk === one.k && st.gsvg && st.gsvg.isConnected && one.k.e === 'bezier') { st.gsvg.innerHTML = this.graphSVG(one.k); return; }
    g.innerHTML = ''; st.gk = null; st.gsvg = null;
    if (!one) { g.appendChild(el('p', { class: 'hint' }, 'Select one keyframe to edit its speed curve here.')); return; }
    const { path, k } = one, ks = l.keys[path], i = ks.indexOf(k);
    if (i < 0 || i === ks.length - 1) { g.appendChild(el('p', { class: 'hint' }, 'This is the last keyframe, so there is no curve after it. Select an earlier one.')); return; }
    if (k.e === 'hold') { g.appendChild(el('p', { class: 'hint' }, 'Hold keeps the value until the next keyframe. Choose another easing to shape a curve.')); return; }
    if (k.e !== 'bezier') {
      const pre = { linear: [0.25, 0.25, 0.75, 0.75], ease: [0.65, 0, 0.35, 1], easeIn: [0.55, 0, 1, 0.45], easeOut: [0, 0.55, 0.45, 1], overshoot: [0.34, 1.56, 0.64, 1] }[k.e] || [0.42, 0, 0.58, 1];
      g.appendChild(el('div', { class: 'btnrow' }, el('span', { class: 'hint' }, `Easing: ${(EASE_NAMES.find(e => e[0] === k.e) || [0, k.e])[1]}`),
        el('button', { class: 'btn sm', onclick: () => { App.change(() => { k.e = 'bezier'; k.bz = pre.slice(); }); this.drawLanes(); this.renderTimeline(); } }, 'Edit as custom curve')));
    }
    g.appendChild(el('div', { class: 'hint' }, 'Value over time from this keyframe to the next. Steeper means faster.'));
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 260 260'); svg.setAttribute('class', 'graph');
    svg.innerHTML = this.graphSVG(k);
    g.appendChild(svg);
    if (k.e !== 'bezier') return;
    st.gk = k; st.gsvg = svg;
    svg.addEventListener('pointerdown', (e) => {
      const h = e.target.getAttribute && e.target.getAttribute('data-h'); if (h == null) return;
      e.preventDefault(); svg.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const r = svg.getBoundingClientRect(), sx = 260 / r.width;
        const x = clamp(((ev.clientX - r.left) * sx - 20) / 220, 0, 1), y = clamp(1 - ((ev.clientY - r.top) * sx - 20) / 220, -0.6, 1.6);
        App.change(() => { if (h === '0') { k.bz[0] = x; k.bz[1] = y; } else { k.bz[2] = x; k.bz[3] = y; } }, 'bz' + l.id);
        svg.innerHTML = this.graphSVG(k);
        App.requestRender();
      };
      const up = () => { svg.removeEventListener('pointermove', move); svg.removeEventListener('pointerup', up); this.renderTimeline(); };
      svg.addEventListener('pointermove', move); svg.addEventListener('pointerup', up);
    });
  },
  graphSVG(k) {
    const S = 220, pad = 20, X = (x) => pad + x * S, Y = (y) => pad + (1 - y) * S;
    const fn = easeFn(k), pts = [];
    for (let j = 0; j <= 60; j++) { const x = j / 60; pts.push(`${X(x).toFixed(1)},${Y(fn(x)).toFixed(1)}`); }
    const bz = k.e === 'bezier' ? k.bz : null;
    return `<rect x="${pad}" y="${pad}" width="${S}" height="${S}" class="gbg"/>` +
      `<line x1="${X(0)}" y1="${Y(0)}" x2="${X(1)}" y2="${Y(1)}" class="gdiag"/>` +
      (bz ? `<line x1="${X(0)}" y1="${Y(0)}" x2="${X(bz[0])}" y2="${Y(bz[1])}" class="gh"/><line x1="${X(1)}" y1="${Y(1)}" x2="${X(bz[2])}" y2="${Y(bz[3])}" class="gh"/>` : '') +
      `<polyline points="${pts.join(' ')}" class="gcurve"/>` +
      (bz ? `<circle cx="${X(bz[0])}" cy="${Y(bz[1])}" r="10" class="gdot" data-h="0"/><circle cx="${X(bz[2])}" cy="${Y(bz[3])}" r="10" class="gdot" data-h="1"/>` : '');
  }
});

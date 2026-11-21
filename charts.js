// ===========================================================================
// Motion graphics add-ons:
//   1. Chart layers (bar, column, line, area, pie, donut, counter, progress
//      bar, gauge) built from typed or pasted "label, value" lines.
//   2. More shapes (arrow, heart, speech bubble, pen paths) and shape
//      modifiers (repeater, zig zag, pucker and bloat, twist, wiggle, round
//      corners), gradient fills and dashed strokes.
//   3. Text boxes that wrap and auto-fit, 45 more text animation presets,
//      and a larger template library.
// ===========================================================================
const hex2arr = (h) => { h = String(h).replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255, 1]; };
const arr2hex = (c) => '#' + [0, 1, 2].map(i => Math.round(clamp(c[i], 0, 1) * 255).toString(16).padStart(2, '0')).join('');

// ---- 1. charts -------------------------------------------------------------------
const CHART_KINDS = [['column', 'Columns'], ['bar', 'Bars'], ['line', 'Line'], ['area', 'Area'], ['pie', 'Pie'], ['donut', 'Donut'], ['counter', 'Counter'], ['progress', 'Progress bar'], ['gauge', 'Gauge']];
const CHART_DEFAULTS = {
  kind: 'column', data: 'Mon, 12\nTue, 19\nWed, 7\nThu, 15\nFri, 22', title: '', w: 820, h: 620, value: 75, max: 100,
  progress: 100, autoBuild: true, buildDur: 1.2, stagger: 0.6, colors: '#14e0c8,#ff4f8b,#ffcf3a,#7b5cff,#3d8bff,#ff8a3d',
  text: [1, 1, 1, 1], gridOn: true, labelsOn: true, valuesOn: true, font: 'Inter', fontSize: 30, prefix: '', suffix: '', decimals: 0, thickness: 0.62, lineWidth: 6
};
function chartRows(text) {
  return String(text || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean).map((line, i) => {
    const parts = line.split(/[,;\t]/).map(s => s.trim());
    if (parts.length === 1) { const n = parseFloat(parts[0]); return Number.isFinite(n) ? { label: String(i + 1), value: n } : null; }
    const n = parseFloat(parts[parts.length - 1].replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) ? { label: parts.slice(0, -1).join(', '), value: n } : null;
  }).filter(Boolean);
}
function drawChart(c0, scale, p) {
  const c = { ...CHART_DEFAULTS, ...c0 }, W = Math.max(40, c.w), H = Math.max(40, c.h);
  const cv = document.createElement('canvas'); cv.width = Math.min(4096, Math.ceil(W * scale)); cv.height = Math.min(4096, Math.ceil(H * scale));
  const g = cv.getContext('2d'); g.scale(scale, scale);
  const rows = chartRows(c.data), n = rows.length, cols = String(c.colors).split(',').map(s => s.trim()).filter(Boolean), col = (i) => cols[i % cols.length] || '#14e0c8';
  const fs = c.fontSize, fam = Fonts.css(c.font), txt = cssColor(c.text), fmt = (v) => c.prefix + (+v).toFixed(Math.max(0, Math.round(c.decimals))) + c.suffix;
  const item = (i) => n <= 1 ? clamp(p, 0, 1) : clamp(p * (1 + c.stagger) - c.stagger * i / (n - 1), 0, 1);
  const eo = (x) => 1 - Math.pow(1 - x, 3);
  g.textBaseline = 'middle'; g.fillStyle = txt;
  let top = 8;
  if (c.title) { g.font = `800 ${fs * 1.25}px ${fam}`; g.textAlign = 'center'; g.fillText(c.title, W / 2, fs * 0.9); top = fs * 1.9; }
  g.font = `600 ${fs}px ${fam}`;
  const k = c.kind;
  if (k === 'counter') {
    g.font = `900 ${Math.min(H * 0.55, W / Math.max(2, fmt(c.value).length) * 1.5)}px ${fam}`; g.textAlign = 'center';
    g.fillStyle = col(0); g.fillText(fmt(c.value * eo(clamp(p, 0, 1))), W / 2, top + (H - top) / 2);
  } else if (k === 'progress') {
    const bh = Math.min(H * 0.3, 90), y = top + (H - top - bh) / 2, f = clamp(c.value / (c.max || 100), 0, 1) * eo(clamp(p, 0, 1)), r = bh / 2;
    g.fillStyle = 'rgba(255,255,255,.14)'; roundRect(g, 0, y, W, bh, r); g.fill();
    if (f > 0.001) { g.fillStyle = col(0); roundRect(g, 0, y, Math.max(bh, W * f), bh, r); g.fill(); }
    if (c.valuesOn) { g.fillStyle = txt; g.textAlign = 'center'; g.fillText(fmt(c.value * eo(clamp(p, 0, 1))), W / 2, y + bh + fs); }
  } else if (k === 'gauge') {
    const R = Math.min(W, H - top) * 0.42, cx = W / 2, cy = top + (H - top) / 2 + R * 0.12, a0 = Math.PI * 0.75, a1 = Math.PI * 2.25, f = clamp(c.value / (c.max || 100), 0, 1) * eo(clamp(p, 0, 1));
    g.lineCap = 'round'; g.lineWidth = R * 0.22; g.strokeStyle = 'rgba(255,255,255,.14)'; g.beginPath(); g.arc(cx, cy, R, a0, a1); g.stroke();
    if (f > 0.001) { g.strokeStyle = col(0); g.beginPath(); g.arc(cx, cy, R, a0, a0 + (a1 - a0) * f); g.stroke(); }
    g.fillStyle = txt; g.textAlign = 'center'; g.font = `900 ${R * 0.5}px ${fam}`; g.fillText(fmt(c.value * eo(clamp(p, 0, 1))), cx, cy);
  } else if (k === 'pie' || k === 'donut') {
    const total = rows.reduce((a, r) => a + Math.max(0, r.value), 0) || 1, R = Math.min(W * (c.labelsOn ? 0.3 : 0.46), (H - top) * 0.46), cx = c.labelsOn ? R + 14 : W / 2, cy = top + (H - top) / 2;
    let a = -Math.PI / 2; const sweep = Math.PI * 2 * eo(clamp(p, 0, 1));
    rows.forEach((r, i) => { const da = Math.max(0, r.value) / total * sweep; g.fillStyle = col(i); g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, R, a, a + da); g.closePath(); g.fill(); a += da; });
    if (k === 'donut') { g.globalCompositeOperation = 'destination-out'; g.beginPath(); g.arc(cx, cy, R * clamp(c.thickness, 0.1, 0.9), 0, Math.PI * 2); g.fill(); g.globalCompositeOperation = 'source-over'; }
    if (c.labelsOn) { g.textAlign = 'left'; const lh = Math.min(fs * 1.5, (H - top) / Math.max(1, n)); rows.forEach((r, i) => { const y = cy - lh * (n - 1) / 2 + i * lh, x = cx + R + 24; g.globalAlpha = item(i); g.fillStyle = col(i); roundRect(g, x, y - fs * 0.35, fs * 0.7, fs * 0.7, 4); g.fill(); g.fillStyle = txt; g.fillText(r.label + (c.valuesOn ? '  ' + fmt(r.value) : ''), x + fs, y); }); g.globalAlpha = 1; }
  } else if (n) {
    const max = (c.max > 0 && k !== 'line' && k !== 'area' ? c.max : 0) || Math.max(1e-9, ...rows.map(r => r.value)) * 1.08, horiz = k === 'bar';
    const padL = horiz ? Math.min(W * 0.3, Math.max(...rows.map(r => g.measureText(r.label).width)) + 16) : 10, padB = horiz ? 6 : (c.labelsOn ? fs * 1.5 : 6), padT = top + (c.valuesOn && !horiz ? fs * 1.2 : 4), padR = horiz && c.valuesOn ? fs * 3 : 10;
    const pw = W - padL - padR, ph = H - padT - padB;
    if (c.gridOn) { g.strokeStyle = 'rgba(255,255,255,.16)'; g.lineWidth = 1.5; for (let i = 0; i <= 4; i++) { g.beginPath(); if (horiz) { const x = padL + pw * i / 4; g.moveTo(x, padT); g.lineTo(x, padT + ph); } else { const y = padT + ph * i / 4; g.moveTo(padL, y); g.lineTo(padL + pw, y); } g.stroke(); } }
    if (k === 'column' || k === 'bar') {
      rows.forEach((r, i) => {
        const f = clamp(r.value / max, 0, 1) * eo(item(i)), slot = (horiz ? ph : pw) / n, th = slot * clamp(c.thickness, 0.1, 1);
        g.fillStyle = col(i);
        if (horiz) { const y = padT + slot * i + (slot - th) / 2; roundRect(g, padL, y, Math.max(2, pw * f), th, Math.min(10, th / 2)); g.fill(); g.fillStyle = txt; if (c.labelsOn) { g.textAlign = 'right'; g.fillText(r.label, padL - 10, y + th / 2); } if (c.valuesOn) { g.textAlign = 'left'; g.globalAlpha = item(i); g.fillText(fmt(r.value * eo(item(i))), padL + pw * f + 10, y + th / 2); g.globalAlpha = 1; } }
        else { const x = padL + slot * i + (slot - th) / 2, hh = Math.max(2, ph * f); roundRect(g, x, padT + ph - hh, th, hh, Math.min(10, th / 2)); g.fill(); g.fillStyle = txt; g.textAlign = 'center'; if (c.labelsOn) g.fillText(r.label, x + th / 2, padT + ph + fs * 0.85); if (c.valuesOn) { g.globalAlpha = item(i); g.fillText(fmt(r.value * eo(item(i))), x + th / 2, padT + ph - hh - fs * 0.6); g.globalAlpha = 1; } }
      });
    } else {
      const min = Math.min(0, ...rows.map(r => r.value)), X = (i) => padL + (n === 1 ? pw / 2 : pw * i / (n - 1)), Y = (v) => padT + ph - (v - min) / (max - min) * ph, reveal = eo(clamp(p, 0, 1));
      g.save(); g.beginPath(); g.rect(0, 0, padL + pw * reveal + 2, H); g.clip();
      if (k === 'area') { g.fillStyle = col(0); g.globalAlpha = 0.35; g.beginPath(); g.moveTo(X(0), padT + ph); rows.forEach((r, i) => g.lineTo(X(i), Y(r.value))); g.lineTo(X(n - 1), padT + ph); g.closePath(); g.fill(); g.globalAlpha = 1; }
      g.strokeStyle = col(0); g.lineWidth = c.lineWidth; g.lineJoin = 'round'; g.lineCap = 'round'; g.beginPath(); rows.forEach((r, i) => i ? g.lineTo(X(i), Y(r.value)) : g.moveTo(X(i), Y(r.value))); g.stroke();
      rows.forEach((r, i) => { g.fillStyle = col(1); g.beginPath(); g.arc(X(i), Y(r.value), c.lineWidth * 1.3, 0, Math.PI * 2); g.fill(); if (c.valuesOn) { g.fillStyle = txt; g.textAlign = 'center'; g.fillText(fmt(r.value), X(i), Y(r.value) - fs * 0.9); } });
      g.restore();
      if (c.labelsOn) { g.fillStyle = txt; g.textAlign = 'center'; rows.forEach((r, i) => g.fillText(r.label, clamp(X(i), padL + 20, padL + pw - 20), padT + ph + fs * 0.85)); }
    }
  }
  return { canvas: cv, w: W, h: H };
}
VISUAL_TYPES.add('chart');
CANVAS_LAYERS.chart = (layer, t, scale) => {
  const c = evalGroup(layer, 'chart', t); Fonts.ensure(c.font);
  const p = c.autoBuild ? clamp(t / Math.max(0.05, c.buildDur), 0, 1) : clamp(c.progress / 100, 0, 1);
  return { key: JSON.stringify(c) + '@' + scale.toFixed(3) + '#' + p.toFixed(3), draw: () => drawChart(c, scale, p) };
};
App.addChart = function (kind) {
  const l = this.baseLayer('chart', 'Chart: ' + (CHART_KINDS.find(k => k[0] === kind) || [0, kind])[1]);
  l.chart = { ...CHART_DEFAULTS, kind };
  if (kind === 'counter' || kind === 'progress' || kind === 'gauge') { l.chart.w = 700; l.chart.h = kind === 'progress' ? 240 : 420; }
  this.addLayer(l, { kind: 'overlay' }); UI.afterAdd(l); return l;
};

// ---- 2. shapes -------------------------------------------------------------------
Object.assign(SHAPE_DEFAULTS, { fillType: 'solid', fill2: [0.2, 0.4, 1, 1], gradAngle: 90, dash: 0, gap: 0, cap: 'round', zigzag: 0, zigRidges: 4, pucker: 0, twist: 0, wiggle: 0, wiggleSeed: 1, roundCorners: 0, repeat: 1, repX: 60, repY: 0, repRot: 0, repScale: 100, repFade: 0, smooth: false, closed: true, pts: null });
const _shapePoints = shapePoints;
shapePoints = function (sh) {
  const w = Math.max(1, sh.w), h = Math.max(1, sh.h);
  let out;
  if (sh.kind === 'arrow') { const t = h * 0.28, hd = Math.min(w * 0.45, h * 0.9); out = { pts: [[0, h / 2 - t / 2], [w - hd, h / 2 - t / 2], [w - hd, 0], [w, h / 2], [w - hd, h], [w - hd, h / 2 + t / 2], [0, h / 2 + t / 2]], closed: true }; }
  else if (sh.kind === 'heart') { const pts = []; for (let i = 0; i < 80; i++) { const a = i / 80 * Math.PI * 2, x = 16 * Math.pow(Math.sin(a), 3), y = 13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a); pts.push([w / 2 + x / 34 * w, h * 0.46 - y / 32 * h]); } out = { pts, closed: true }; }
  else if (sh.kind === 'bubble') { const r = Math.min(sh.radius || 30, w / 2, h * 0.4), bh = h * 0.8, pts = [], seg = 6; const corner = (cx, cy, a0) => { for (let i = 0; i <= seg; i++) { const a = a0 + i / seg * Math.PI / 2; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } };
    corner(w - r, r, -Math.PI / 2); corner(w - r, bh - r, 0); pts.push([w * 0.42, bh], [w * 0.2, h], [w * 0.26, bh]); corner(r, bh - r, Math.PI / 2); corner(r, r, Math.PI); out = { pts, closed: true }; }
  else if (sh.kind === 'path' && Array.isArray(sh.pts) && sh.pts.length > 1) {
    let pts = sh.pts.map(([x, y]) => [x * w, y * h]);
    if (sh.smooth && pts.length > 2) { const P = pts, n = P.length, cl = sh.closed !== false, o = []; const at = (i) => cl ? P[(i + n) % n] : P[clamp(i, 0, n - 1)];
      for (let i = 0; i < (cl ? n : n - 1); i++) for (let s = 0; s < 10; s++) { const t = s / 10, p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2); o.push([0, 1].map(d => 0.5 * ((2 * p1[d]) + (-p0[d] + p2[d]) * t + (2 * p0[d] - 5 * p1[d] + 4 * p2[d] - p3[d]) * t * t + (-p0[d] + 3 * p1[d] - 3 * p2[d] + p3[d]) * t * t * t))); }
      if (!cl) o.push(P[n - 1]); pts = o; }
    out = { pts, closed: sh.closed !== false };
  } else out = _shapePoints(sh);
  let { pts, closed } = out;
  const cx = w / 2, cy = h / 2, sub = (P, k) => { const o = []; const n = P.length; for (let i = 0; i < (closed ? n : n - 1); i++) { const a = P[i], b = P[(i + 1) % n]; for (let s = 0; s < k; s++) o.push([lerp(a[0], b[0], s / k), lerp(a[1], b[1], s / k)]); } if (!closed) o.push(P[n - 1]); return o; };
  if (sh.roundCorners > 0 && pts.length > 2) for (let it = 0; it < Math.min(4, Math.ceil(sh.roundCorners / 25)); it++) { const o = [], n = pts.length; for (let i = 0; i < (closed ? n : n - 1); i++) { const a = pts[i], b = pts[(i + 1) % n]; o.push([lerp(a[0], b[0], 0.25), lerp(a[1], b[1], 0.25)], [lerp(a[0], b[0], 0.75), lerp(a[1], b[1], 0.75)]); } pts = o; }
  if (sh.zigzag) { const k = Math.max(1, Math.round(sh.zigRidges)) * 2, P = pts, n = P.length, o = []; for (let i = 0; i < (closed ? n : n - 1); i++) { const a = P[i], b = P[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L; for (let s = 0; s < k; s++) { const off = s % 2 ? sh.zigzag : 0; o.push([lerp(a[0], b[0], s / k) + nx * off, lerp(a[1], b[1], s / k) + ny * off]); } } if (!closed) o.push(P[n - 1]); pts = o; }
  if (sh.pucker) { const P = sub(pts, 2); pts = P.map((q, i) => { const f = 1 + (i % 2 ? -1 : 1) * sh.pucker / 100; return [cx + (q[0] - cx) * f, cy + (q[1] - cy) * f]; }); }
  if (sh.wiggle) { const P = sub(pts, 3); pts = P.map((q, i) => [q[0] + (hash01(i, Math.round(sh.wiggleSeed * 7)) - 0.5) * sh.wiggle * 2, q[1] + (hash01(i + 999, Math.round(sh.wiggleSeed * 7)) - 0.5) * sh.wiggle * 2]); }
  if (sh.twist) { const P = sub(pts, 4), R = Math.hypot(w, h) / 2; pts = P.map(q => { const dx = q[0] - cx, dy = q[1] - cy, a = (1 - Math.hypot(dx, dy) / R) * sh.twist * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); return [cx + dx * c - dy * s, cy + dx * s + dy * c]; }); }
  return { pts, closed };
};
// Same job as the original, plus gradients, dashes and the repeater.
drawShapeCanvas = function (sh0, scale) {
  const sh = { ...SHAPE_DEFAULTS, ...sh0 }, sw = sh.strokeOn || sh.kind === 'line' ? Math.max(1, sh.strokeWidth || 6) : 0;
  const w = Math.max(1, sh.w), h = Math.max(1, sh.h), n = clamp(Math.round(sh.repeat || 1), 1, 40);
  const ext = Math.abs(sh.zigzag) + Math.abs(sh.wiggle) + Math.max(0, sh.pucker) / 100 * Math.max(w, h) / 2, pad = sw + 2 + ext;
  // Room for the repeater's copies.
  let minX = 0, minY = 0, maxX = w, maxY = h;
  for (let i = 1; i < n; i++) { const s = Math.pow(sh.repScale / 100, i), R = Math.hypot(w, h) / 2 * s, ox = w / 2 + sh.repX * i, oy = h / 2 + sh.repY * i; minX = Math.min(minX, ox - R); maxX = Math.max(maxX, ox + R); minY = Math.min(minY, oy - R); maxY = Math.max(maxY, oy + R); }
  const W = maxX - minX + pad * 2, H = maxY - minY + pad * 2;
  const c = document.createElement('canvas'); c.width = Math.min(8192, Math.ceil(W * scale)); c.height = Math.min(8192, Math.ceil(H * scale));
  const ctx = c.getContext('2d'); ctx.scale(scale, scale); ctx.translate(pad - minX, pad - minY);
  const { pts, closed } = shapePoints(sh);
  const ts = clamp(Math.min(sh.trimStart, sh.trimEnd) / 100, 0, 1), te = clamp(Math.max(sh.trimStart, sh.trimEnd) / 100, 0, 1);
  let path = pts, isClosed = closed;
  if (ts > 0.0001 || te < 0.9999) {
    const off = ((sh.trimOffset || 0) / 360 % 1 + 1) % 1; let a = ts + off, b = te + off;
    if (a >= 1) { a -= 1; b -= 1; }
    path = b > 1 && closed ? [...trimPolyline(pts, closed, a, 1), ...trimPolyline(pts, closed, 0, b - 1)] : trimPolyline(pts, closed, a, Math.min(b, 1));
    isClosed = false;
  }
  if (te - ts > 0.0001) for (let i = n - 1; i >= 0; i--) {
    ctx.save();
    if (i) { ctx.translate(w / 2 + sh.repX * i, h / 2 + sh.repY * i); ctx.rotate(sh.repRot * i * Math.PI / 180); const s = Math.pow(sh.repScale / 100, i); ctx.scale(s, s); ctx.translate(-w / 2, -h / 2); ctx.globalAlpha = Math.max(0, 1 - sh.repFade / 100 * i); }
    ctx.beginPath(); path.forEach(([x, y], j) => j ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); if (isClosed) ctx.closePath();
    if (sh.fillOn !== false && sh.kind !== 'line' && isClosed) {
      if (sh.fillType === 'linear') { const a = sh.gradAngle * Math.PI / 180, dx = Math.cos(a) * w / 2, dy = Math.sin(a) * h / 2, gr = ctx.createLinearGradient(w / 2 - dx, h / 2 - dy, w / 2 + dx, h / 2 + dy); gr.addColorStop(0, cssColor(sh.fill)); gr.addColorStop(1, cssColor(sh.fill2)); ctx.fillStyle = gr; }
      else if (sh.fillType === 'radial') { const gr = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) / 2); gr.addColorStop(0, cssColor(sh.fill)); gr.addColorStop(1, cssColor(sh.fill2)); ctx.fillStyle = gr; }
      else ctx.fillStyle = cssColor(sh.fill);
      ctx.fill();
    }
    if (sw > 0) { ctx.strokeStyle = cssColor(sh.stroke); ctx.lineWidth = sw; ctx.lineJoin = 'round'; ctx.lineCap = sh.cap || 'round'; if (sh.dash > 0) ctx.setLineDash([sh.dash, sh.gap > 0 ? sh.gap : sh.dash]); ctx.stroke(); }
    ctx.restore();
  }
  return { canvas: c, w: W, h: H };
};

// Pen tool: tap points on the preview, then Done.
Object.assign(UI, {
  startPen() {
    if (!App.project) return;
    if (Layout.mode === 'mobile') this.closeSheet();
    const pts = [], o = $('#overlay');
    const bar = el('div', { id: 'penbar' }, el('span', {}, 'Tap points on the preview'),
      el('button', { class: 'btn sm', onclick: () => finish(false, false) }, 'Done (open line)'), el('button', { class: 'btn sm primary', onclick: () => finish(true, false) }, 'Close shape'),
      el('button', { class: 'btn sm', onclick: () => finish(true, true) }, 'Close, smooth'), el('button', { class: 'btn sm', onclick: () => finish(null) }, 'Cancel'));
    document.body.appendChild(bar);
    const paint = () => { const k = 1 / this.pxPerProject(); o.innerHTML = `<polyline points="${pts.map(p => p.join(',')).join(' ')}" class="mpath" vector-effect="non-scaling-stroke"/>` + pts.map(p => `<circle cx="${p[0]}" cy="${p[1]}" r="${6 * k}" class="mdot now"/>`).join(''); };
    this._pick = (P) => { pts.push([Math.round(P[0]), Math.round(P[1])]); paint(); return true; };
    const finish = (closed, smooth) => {
      this._pick = null; bar.remove(); o.innerHTML = '';
      if (closed === null || pts.length < 2) { this.drawOverlay(); return; }
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]), x0 = Math.min(...xs), y0 = Math.min(...ys), w = Math.max(4, Math.max(...xs) - x0), h = Math.max(4, Math.max(...ys) - y0);
      const l = App.baseLayer('shape', 'Pen shape');
      l.shape = { ...SHAPE_DEFAULTS, kind: 'path', w, h, pts: pts.map(p => [(p[0] - x0) / w, (p[1] - y0) / h]), closed: !!closed && pts.length > 2, smooth: !!smooth, fillOn: !!closed, strokeOn: true, strokeWidth: 8 };
      l.transform.x = x0 + w / 2; l.transform.y = y0 + h / 2;
      App.addLayer(l, { kind: 'overlay' }); this.refresh(); this.openTool('style');
    };
  }
});

// ---- 3. text boxes, more text presets, more templates ---------------------------
Object.assign(TEXT_DEFAULTS, { boxPct: 0, boxHPct: 0, autoFit: false });
const _measure = document.createElement('canvas').getContext('2d');
function wrapTextBox(tx) {
  const p = App.project; if (!p) return tx;
  const boxW = tx.boxPct / 100 * p.width, boxH = tx.boxHPct > 0 ? tx.boxHPct / 100 * p.height : 0;
  let size = Math.max(4, tx.size), out = tx.content;
  for (let tries = 0; tries < 24; tries++) {
    _measure.font = `${tx.italic ? 'italic ' : ''}${tx.weight || 700} ${size}px ${Fonts.css(tx.font)}`;
    const mw = (s) => _measure.measureText(s).width + (tx.letterSpacing || 0) * s.length;
    const lines = [];
    for (const para of String(tx.content).split('\n')) {
      let cur = '';
      for (const word of para.split(/\s+/)) { const next = cur ? cur + ' ' + word : word; if (cur && mw(next) > boxW) { lines.push(cur); cur = word; } else cur = next; }
      lines.push(cur);
    }
    // No single short word left alone on the last line when it can be avoided.
    if (lines.length > 1) { const a = lines[lines.length - 2].split(' '), b = lines[lines.length - 1]; if (b && !b.includes(' ') && a.length > 2 && mw(a[a.length - 1] + ' ' + b) <= boxW) { lines[lines.length - 1] = a.pop() + ' ' + b; lines[lines.length - 2] = a.join(' '); } }
    out = lines.join('\n');
    const tooTall = boxH > 0 && lines.length * size * (tx.lineHeight || 1.15) > boxH, tooWide = lines.some(s => mw(s) > boxW * 1.02);
    if (!tx.autoFit || (!tooTall && !tooWide) || size <= tx.size * 0.25) break;
    size *= 0.93;
  }
  return { ...tx, content: out, size };
}
const _drawTextCanvas = drawTextCanvas;
drawTextCanvas = function (tx0, scale, t, dur, frame, highlight) { return _drawTextCanvas(tx0 && tx0.boxPct > 0 ? wrapTextBox({ ...TEXT_DEFAULTS, ...tx0 }) : tx0, scale, t, dur, frame, highlight); };

// More text motions: 15 new moves, each by line, word and letter.
Object.assign(MOTIONS, {
  flipX: (e) => ({ sx: EASES.easeOut(e), a: Math.min(1, e * 3) }), flipY: (e) => ({ sy: EASES.easeOut(e), a: Math.min(1, e * 3) }),
  slam: (e) => ({ s: 1 + (1 - EASES.easeOut(Math.min(1, e * 1.4))) * 3, a: Math.min(1, e * 4) }), whip: (e) => ({ dx: (1 - EASES.easeOut(e)) * 4, b: (1 - e) * 0.5, a: Math.min(1, e * 2) }),
  fall: (e) => ({ dy: -(1 - EASES.easeOut(e)) * 2.5, r: (1 - e) * -25, a: Math.min(1, e * 3) }), twist: (e) => ({ r: (1 - EASES.overshoot(e)) * -180, s: EASES.easeOut(e), a: e }),
  squash: (e) => ({ sy: 0.2 + 0.8 * Math.max(0, EASES.elastic(e)), sx: 1.6 - 0.6 * EASES.easeOut(e), a: Math.min(1, e * 4) }), tracking: (e, i) => ({ dx: (1 - EASES.easeOut(e)) * (i % 9 - 4) * 0.35, a: e }),
  roll: (e) => ({ dx: -(1 - EASES.easeOut(e)) * 2, r: (1 - EASES.easeOut(e)) * -200, a: Math.min(1, e * 3) }), rubber: (e) => ({ sx: 1 + (1 - Math.max(0, EASES.elastic(e))) * 0.6, sy: Math.max(0.05, EASES.elastic(e)) }),
  peel: (e) => ({ dy: (1 - EASES.easeOut(e)) * 0.4, r: (1 - EASES.easeOut(e)) * 14, a: e }), punch: (e) => ({ s: 0.3 + 0.7 * Math.max(0, EASES.overshoot(Math.min(1, e * 1.3))), a: Math.min(1, e * 5) }),
  zoomBlur: (e) => ({ s: 1 + (1 - EASES.easeOut(e)) * 1.2, b: (1 - e) * 0.5, a: e }), sink: (e) => ({ dy: -(1 - EASES.easeOut(e)) * 0.5, s: 1.2 - 0.2 * EASES.easeOut(e), a: e }),
  jitter: (e, i, f) => ({ dx: (hash01(i * 3 + 1, f) - 0.5) * 0.4 * (1 - e), dy: (hash01(i * 5 + 2, f) - 0.5) * 0.4 * (1 - e), a: Math.min(1, e * 3) })
});
(() => {
  const names = { flipX: 'Flip Open', flipY: 'Unfold', slam: 'Slam', whip: 'Whip In', fall: 'Tumble Down', twist: 'Twist In', squash: 'Squash', tracking: 'Tracking In', roll: 'Roll In', rubber: 'Rubber', peel: 'Peel Up', punch: 'Punch', zoomBlur: 'Zoom Blur', sink: 'Settle', jitter: 'Jitter In' };
  for (const [m, name] of Object.entries(names)) for (const [suf, unit, label] of [['', 'line', ''], ['Word', 'word', ' by Word'], ['Letter', 'char', ' by Letter']]) TEXT_ANIMS.push({ id: m + suf, name: name + label, unit, motion: m, kind: 'in' });
  for (const [id, name, motion, unit] of [['slamOut', 'Slam Out', 'slam', 'line'], ['fallOut', 'Tumble Away', 'fall', 'word'], ['twistOut', 'Twist Out', 'twist', 'word'], ['flipOut', 'Fold Shut', 'flipY', 'line'], ['whipOut', 'Whip Out', 'whip', 'line'], ['jitterOut', 'Jitter Out', 'jitter', 'char']]) TEXT_ANIMS.push({ id, name, motion, unit, kind: 'out' });
})();

// More templates: callouts, buttons, bubbles, comic sound words, counters.
TEXT_TEMPLATES.push(
  { name: 'Callout', preview: { font: 'Inter', color: '#fff', bg: '#111' }, make: (P) => [
    shp(P, { kind: 'line', w: P.s * 0.3, h: 8, strokeOn: true, strokeWidth: 6, stroke: [1, 1, 1, 1] }, { x: P.w * 0.42, y: P.h * 0.5 }),
    shp(P, { kind: 'ellipse', w: P.s * 0.05, h: P.s * 0.05, fill: [0.08, 0.88, 0.78, 1] }, { x: P.w * 0.27, y: P.h * 0.5 }),
    txt(P, 'Point it out', { font: 'Inter', weight: 800, size: P.s * 0.05, boxOn: true, boxColor: [0.07, 0.07, 0.07, 0.9], boxPad: 18, boxRadius: 12, animIn: 'left' }, { x: P.w * 0.72, y: P.h * 0.5 })] },
  { name: 'Arrow Pointer', preview: { font: 'Anton', color: '#ffcf3a' }, make: (P) => [shp(P, { kind: 'arrow', w: P.s * 0.34, h: P.s * 0.16, fill: [1, 0.81, 0.23, 1] }, {}, 'bouncein'), txt(P, 'LOOK', { font: 'Anton', weight: 400, size: P.s * 0.07, color: [1, 0.81, 0.23, 1], animIn: 'punch' }, { y: P.h * 0.5 - P.s * 0.16 })] },
  { name: 'Follow Button', preview: { font: 'Poppins', color: '#fff', bg: '#7b5cff' }, make: (P) => [shp(P, { kind: 'rect', w: P.s * 0.42, h: P.s * 0.12, radius: P.s * 0.06, fillType: 'linear', gradAngle: 0, fill: [0.48, 0.36, 1, 1], fill2: [1, 0.31, 0.55, 1] }, { y: P.h * 0.8 }, 'bouncein'), txt(P, '+ Follow', { font: 'Poppins', weight: 800, size: P.s * 0.05, animIn: 'pop', animLoop: 'pulse' }, { y: P.h * 0.8 })] },
  { name: 'Speech Bubble', preview: { font: 'Comic Neue', color: '#111', bg: '#fff' }, make: (P) => [shp(P, { kind: 'bubble', w: P.s * 0.6, h: P.s * 0.34, radius: P.s * 0.05, fill: [1, 1, 1, 1], strokeOn: true, stroke: [0, 0, 0, 1], strokeWidth: 8 }, {}, 'bouncein'), txt(P, 'Hey there!', { font: 'Comic Neue', weight: 700, size: P.s * 0.065, color: [0.07, 0.07, 0.07, 1], animIn: 'popWord' }, { y: P.h * 0.5 - P.s * 0.035 })] },
  { name: 'Comic BAM', preview: { font: 'Bangers', color: '#fff', stroke: '#000', bg: '#ff4f8b' }, make: (P) => [shp(P, { kind: 'star', w: P.s * 0.7, h: P.s * 0.55, points: 14, inner: 0.7, fill: [1, 0.85, 0.1, 1], strokeOn: true, stroke: [0, 0, 0, 1], strokeWidth: 10, pucker: 6 }, {}, 'bouncein'), txt(P, 'BAM!', { font: 'Bangers', weight: 400, size: P.s * 0.17, color: [0.95, 0.15, 0.2, 1], strokeOn: true, stroke: [0, 0, 0, 1], strokeWidth: 12, animIn: 'slam', animLoop: 'shake' })] },
  { name: 'Comic WHOOSH', preview: { font: 'Bangers', color: '#3d8bff', stroke: '#000' }, make: (P) => [txt(P, 'WHOOSH', { font: 'Bangers', weight: 400, italic: true, size: P.s * 0.15, color: [0.25, 0.6, 1, 1], strokeOn: true, stroke: [0, 0, 0, 1], strokeWidth: 10, letterSpacing: 6, animIn: 'whipLetter', animStagger: 0.7 })] },
  { name: 'Comic Caption Box', preview: { font: 'Comic Neue', color: '#111', bg: '#ffe98a' }, make: (P) => [txt(P, 'Meanwhile, across town…', { font: 'Comic Neue', weight: 700, italic: true, size: P.s * 0.045, color: [0.07, 0.07, 0.07, 1], boxOn: true, boxColor: [1, 0.91, 0.54, 1], boxPad: 20, boxRadius: 0, strokeOn: false, animIn: 'typewriter', boxPct: 70 }, { y: P.h * 0.14 })] },
  { name: 'Map Pin', preview: { font: 'Inter', color: '#fff', bg: '#e11d2e' }, make: (P) => [shp(P, { kind: 'path', w: P.s * 0.12, h: P.s * 0.17, closed: true, smooth: true, pts: [[0.5, 1], [0.08, 0.45], [0.12, 0.15], [0.5, 0], [0.88, 0.15], [0.92, 0.45]], fill: [0.9, 0.12, 0.2, 1] }, {}, 'bouncein'), shp(P, { kind: 'ellipse', w: P.s * 0.04, h: P.s * 0.04, fill: [1, 1, 1, 1] }, { y: P.h * 0.5 - P.s * 0.025 }), txt(P, 'Place name', { font: 'Inter', weight: 800, size: P.s * 0.045, boxOn: true, boxColor: [0, 0, 0, 0.75], boxPad: 14, boxRadius: 10, animIn: 'up' }, { y: P.h * 0.5 + P.s * 0.14 })] },
  { name: 'Progress Bar', preview: { font: 'Inter', color: '#14e0c8' }, make: (P) => { const l = App.baseLayer('chart', 'Progress bar'); l.chart = { ...CHART_DEFAULTS, kind: 'progress', w: Math.round(P.w * 0.7), h: 220, value: 80, suffix: '%', buildDur: 2 }; l.transform.y = P.h * 0.8; return [l]; } },
  { name: 'Countdown', preview: { font: 'Anton', color: '#fff' }, make: (P) => { const l = App.baseLayer('chart', 'Countdown'); l.chart = { ...CHART_DEFAULTS, kind: 'counter', w: 600, h: 500, value: 10, autoBuild: false, progress: 100, font: 'Anton', colors: '#ffffff' }; l.keys = { 'chart.value': [{ t: 0, v: 10, e: 'linear' }, { t: 4, v: 0, e: 'linear' }] }; return [l]; } },
  { name: 'Number Counter', preview: { font: 'Montserrat', color: '#ffcf3a' }, make: (P) => { const l = App.baseLayer('chart', 'Counter'); l.chart = { ...CHART_DEFAULTS, kind: 'counter', w: 800, h: 420, value: 2500, font: 'Montserrat', colors: '#ffcf3a', buildDur: 2 }; return [l]; } },
  { name: 'Lower Third Bar', preview: { font: 'Oswald', color: '#fff', bg: '#111' }, make: (P) => [shp(P, { kind: 'rect', w: P.s * 0.012, h: P.s * 0.13, radius: 0, fill: [0.08, 0.88, 0.78, 1] }, { x: P.w * 0.08, y: P.h * 0.83 }, 'slidein'), txt(P, 'NAME HERE', { font: 'Oswald', weight: 700, size: P.s * 0.06, align: 'left', animIn: 'leftWord' }, { x: P.w * 0.3, y: P.h * 0.81 }), txt(P, 'What they do', { font: 'Oswald', weight: 400, size: P.s * 0.035, align: 'left', color: [0.8, 0.8, 0.8, 1], animIn: 'fade' }, { x: P.w * 0.25, y: P.h * 0.86 })] },
  { name: 'Big Stat', preview: { font: 'Montserrat', color: '#14e0c8' }, make: (P) => [txt(P, '87%', { font: 'Montserrat', weight: 900, size: P.s * 0.26, color: [0.08, 0.88, 0.78, 1], animIn: 'punch' }, { y: P.h * 0.45 }), txt(P, 'of viewers watch to the end', { font: 'Montserrat', weight: 600, size: P.s * 0.045, animIn: 'upWord', boxPct: 80 }, { y: P.h * 0.45 + P.s * 0.2 })] },
  { name: 'Title Card Split', preview: { font: 'Playfair Display', color: '#fff' }, make: (P) => [shp(P, { kind: 'line', w: P.s * 0.5, h: 6, strokeOn: true, strokeWidth: 4, stroke: [1, 1, 1, 1], trimEnd: 100 }, { y: P.h * 0.5 }), txt(P, 'CHAPTER ONE', { font: 'Inter', weight: 600, size: P.s * 0.035, letterSpacing: 10, animIn: 'trackingLetter' }, { y: P.h * 0.5 - P.s * 0.06 }), txt(P, 'The Beginning', { font: 'Playfair Display', weight: 700, italic: true, size: P.s * 0.09, animIn: 'rise' }, { y: P.h * 0.5 + P.s * 0.09 })] }
);

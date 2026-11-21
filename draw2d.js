// ===========================================================================
// Shapes (rectangle, ellipse, polygon, star, line) drawn with Canvas 2D.
// Trim Start / Trim End draw only part of the outline, like After Effects
// trim paths, so a shape can "draw itself on" with two keyframes.
// ===========================================================================

const SHAPE_DEFAULTS = { kind: 'rect', w: 400, h: 400, radius: 24, points: 5, inner: 0.45, fillOn: true, fill: [1, 0.36, 0.3, 1], strokeOn: false, stroke: [1, 1, 1, 1], strokeWidth: 8, trimStart: 0, trimEnd: 100, trimOffset: 0 };

// Outline of a shape as a list of points (closed unless it is a line).
function shapePoints(sh) {
  const w = Math.max(1, sh.w), h = Math.max(1, sh.h), pts = [];
  if (sh.kind === 'line') return { pts: [[0, h / 2], [w, h / 2]], closed: false };
  if (sh.kind === 'ellipse') { for (let i = 0; i < 96; i++) { const a = -Math.PI / 2 + i / 96 * Math.PI * 2; pts.push([w / 2 + Math.cos(a) * w / 2, h / 2 + Math.sin(a) * h / 2]); } return { pts, closed: true }; }
  if (sh.kind === 'star' || sh.kind === 'polygon') {
    const n = Math.max(3, Math.round(sh.points || 5)), star = sh.kind === 'star', steps = star ? n * 2 : n;
    for (let i = 0; i < steps; i++) { const a = -Math.PI / 2 + i * Math.PI * 2 / steps, r = star && i % 2 ? (sh.inner ?? 0.45) : 1; pts.push([w / 2 + Math.cos(a) * r * w / 2, h / 2 + Math.sin(a) * r * h / 2]); }
    return { pts, closed: true };
  }
  // Rounded rectangle, starting at the top middle so trims grow clockwise.
  const r = clamp(sh.radius || 0, 0, Math.min(w, h) / 2), seg = 8;
  const corner = (cx, cy, a0) => { for (let i = 0; i <= seg; i++) { const a = a0 + i / seg * Math.PI / 2; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } };
  pts.push([w / 2, 0]);
  corner(w - r, r, -Math.PI / 2); corner(w - r, h - r, 0); corner(r, h - r, Math.PI / 2); corner(r, r, Math.PI);
  return { pts, closed: true };
}

// The part of an outline between fractions a and b of its length.
function trimPolyline(pts, closed, a, b) {
  const P = closed ? [...pts, pts[0]] : pts;
  const lens = [0];
  for (let i = 1; i < P.length; i++) lens.push(lens[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
  const total = lens[lens.length - 1] || 1;
  const at = (d) => { for (let i = 1; i < P.length; i++) if (lens[i] >= d) { const f = (d - lens[i - 1]) / Math.max(1e-6, lens[i] - lens[i - 1]); return [lerp(P[i - 1][0], P[i][0], f), lerp(P[i - 1][1], P[i][1], f)]; } return P[P.length - 1]; };
  const d0 = a * total, d1 = b * total, out = [at(d0)];
  for (let i = 1; i < P.length; i++) if (lens[i] > d0 && lens[i] < d1) out.push(P[i]);
  out.push(at(d1));
  return out;
}

function drawShapeCanvas(sh0, scale) {
  const sh = { ...SHAPE_DEFAULTS, ...sh0 };
  const sw = sh.strokeOn ? sh.strokeWidth : 0;
  const pad = sw + 2;
  const w = Math.max(1, sh.w), h = Math.max(1, sh.h);
  const c = document.createElement('canvas');
  c.width = Math.min(8192, Math.ceil((w + pad * 2) * scale)); c.height = Math.min(8192, Math.ceil((h + pad * 2) * scale));
  const ctx = c.getContext('2d'); ctx.scale(scale, scale); ctx.translate(pad, pad);
  const { pts, closed } = shapePoints(sh);
  const ts = clamp(Math.min(sh.trimStart, sh.trimEnd) / 100, 0, 1), te = clamp(Math.max(sh.trimStart, sh.trimEnd) / 100, 0, 1);
  const trimmed = ts > 0.0001 || te < 0.9999;
  let path = pts, isClosed = closed;
  if (trimmed) {
    // Offset rotates where the trimmed segment sits along the outline.
    const off = ((sh.trimOffset || 0) / 360 % 1 + 1) % 1;
    let a = ts + off, b = te + off;
    if (a >= 1) { a -= 1; b -= 1; }
    if (b > 1 && closed) path = [...trimPolyline(pts, closed, a, 1), ...trimPolyline(pts, closed, 0, b - 1)];
    else path = trimPolyline(pts, closed, a, Math.min(b, 1));
    isClosed = false;
  }
  if (te - ts <= 0.0001) return { canvas: c, w: w + pad * 2, h: h + pad * 2 };
  ctx.beginPath(); path.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); if (isClosed) ctx.closePath();
  if (sh.fillOn !== false && sh.kind !== 'line') { ctx.fillStyle = cssColor(sh.fill); ctx.fill(); }
  if (sw > 0 || sh.kind === 'line') { ctx.strokeStyle = cssColor(sh.stroke); ctx.lineWidth = Math.max(1, sw || 6); ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke(); }
  return { canvas: c, w: w + pad * 2, h: h + pad * 2 };
}

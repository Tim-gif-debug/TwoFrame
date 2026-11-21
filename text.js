// ===========================================================================
// Text rendering with styles and per-letter / word / line animators.
//
// A text layer's settings live in layer.text. Everything here draws with
// Canvas 2D into a canvas that the engine uploads as a texture. When an
// animation is running, the canvas is redrawn every frame.
// ===========================================================================

// Defaults for every text setting. Older projects lack some of these, so
// text drawing merges them in first.
const TEXT_DEFAULTS = {
  content: 'Title', font: 'Sans', size: 120, weight: 800, italic: false, align: 'center', lineHeight: 1.15, letterSpacing: 0,
  color: [1, 1, 1, 1], fillType: 'solid', color2: [1, 0.35, 0.6, 1], gradAngle: 90,
  strokeOn: false, stroke: [0, 0, 0, 1], strokeWidth: 6, stroke2On: false, stroke2: [1, 0.85, 0.2, 1], stroke2Width: 14,
  shadowOn: false, shadowColor: [0, 0, 0, 0.6], shadowBlur: 12, shadowX: 6, shadowY: 8,
  glowOn: false, glowColor: [0.2, 0.9, 1, 1], glowSize: 24,
  boxOn: false, boxColor: [0, 0, 0, 0.75], boxPad: 24, boxRadius: 18,
  curve: 0,
  animIn: 'none', animOut: 'none', animLoop: 'none', animInDur: 0.8, animOutDur: 0.6, animUnit: 'auto', animStagger: 0.5
};

// ---- Animation presets ---------------------------------------------------
// Each motion maps progress e (0 = hidden, 1 = settled) to a pose:
// dx, dy (in units of the font size), s / sx / sy scale, r degrees, a alpha, b blur.
const MOTIONS = {
  fade: (e) => ({ a: e }),
  up: (e) => ({ dy: (1 - EASES.easeOut(e)) * 0.8, a: e }),
  down: (e) => ({ dy: -(1 - EASES.easeOut(e)) * 0.8, a: e }),
  left: (e) => ({ dx: (1 - EASES.easeOut(e)) * 1.2, a: e }),
  right: (e) => ({ dx: -(1 - EASES.easeOut(e)) * 1.2, a: e }),
  pop: (e) => ({ s: Math.max(0, EASES.overshoot(e)), a: Math.min(1, e * 3) }),
  bounce: (e) => ({ dy: -(1 - EASES.bounce(e)) * 1.6, a: Math.min(1, e * 4) }),
  zoomIn: (e) => ({ s: 1 + (1 - EASES.easeOut(e)) * 2.5, a: e }),
  zoomOut: (e) => ({ s: EASES.easeOut(e), a: e }),
  blur: (e) => ({ b: (1 - e) * 0.35, a: e }),
  rotate: (e) => ({ r: (1 - EASES.easeOut(e)) * -90, a: e }),
  spin: (e) => ({ r: (1 - EASES.easeOut(e)) * 360, s: EASES.easeOut(e), a: e }),
  drop: (e) => ({ dy: -(1 - EASES.bounce(e)) * 3, a: Math.min(1, e * 5) }),
  elastic: (e) => ({ s: Math.max(0, EASES.elastic(e)) }),
  stretch: (e) => ({ sx: 1 + (1 - EASES.overshoot(e)) * 0.5, sy: Math.max(0, EASES.overshoot(e)), a: Math.min(1, e * 3) }),
  typewriter: (e) => ({ a: e > 0 ? 1 : 0 }),
  flicker: (e, i, f) => ({ a: e >= 1 ? 1 : (hash01(i * 7 + 3, f) > 0.5 ? e : 0) }),
  glitch: (e, i, f) => ({ dx: e >= 1 ? 0 : (hash01(i * 13, f) - 0.5) * 0.6 * (1 - e), a: e > 0.05 ? 1 : 0 }),
  scramble: (e) => ({ a: e > 0 ? 1 : 0, scramble: e < 1 }),
  swing: (e) => ({ r: Math.sin(e * 12) * 30 * (1 - e), a: Math.min(1, e * 3) }),
  rise: (e) => ({ dy: (1 - EASES.easeOut(e)) * 0.5, b: (1 - e) * 0.2, a: e })
};
// Loops take the time in seconds instead of a progress value.
const LOOPS = {
  wave: (t, i) => ({ dy: Math.sin(t * 4 - i * 0.6) * 0.15 }),
  float: (t) => ({ dy: Math.sin(t * 2) * 0.1 }),
  pulse: (t) => ({ s: 1 + Math.sin(t * 6) * 0.06 }),
  heartbeat: (t) => { const p = (t * 1.2) % 1; return { s: 1 + (p < 0.12 ? Math.sin(p / 0.12 * Math.PI) * 0.12 : p < 0.3 ? Math.sin((p - 0.12) / 0.18 * Math.PI) * 0.07 : 0) }; },
  shake: (t, i, f) => ({ dx: (hash01(i + 1, f) - 0.5) * 0.06, dy: (hash01(i + 9, f) - 0.5) * 0.06 }),
  jelly: (t, i) => ({ sx: 1 + Math.sin(t * 8 + i * 0.4) * 0.08, sy: 1 - Math.sin(t * 8 + i * 0.4) * 0.08 }),
  swingLoop: (t) => ({ r: Math.sin(t * 3) * 8 }),
  glitchLoop: (t, i, f) => (hash01(f, 77) > 0.85 ? { dx: (hash01(i, f) - 0.5) * 0.3 } : {}),
  flickerLoop: (t, i, f) => ({ a: hash01(i + 5, f) > 0.12 ? 1 : 0.2 }),
  bounceLoop: (t, i) => ({ dy: -Math.abs(Math.sin(t * 5 - i * 0.5)) * 0.2 })
};

// The preset list shown to the user: [id, name, motion, unit].
const TEXT_ANIMS = (() => {
  const ins = [
    ['fade', 'Fade', 'line'], ['fadeWord', 'Fade by Word', 'word'], ['fadeLetter', 'Fade by Letter', 'char'],
    ['up', 'Fade Up', 'line'], ['upWord', 'Fade Up by Word', 'word'], ['upLetter', 'Fade Up by Letter', 'char'],
    ['down', 'Drop Down', 'line'], ['downWord', 'Drop Down by Word', 'word'],
    ['left', 'Slide from Right', 'line'], ['leftWord', 'Slide by Word', 'word'], ['right', 'Slide from Left', 'line'],
    ['pop', 'Pop', 'line'], ['popWord', 'Pop by Word', 'word'], ['popLetter', 'Pop by Letter', 'char'],
    ['bounce', 'Bounce', 'line'], ['bounceLetter', 'Bounce by Letter', 'char'], ['drop', 'Drop In', 'word'],
    ['zoomIn', 'Zoom In', 'line'], ['zoomInWord', 'Zoom by Word', 'word'], ['zoomOut', 'Grow', 'line'], ['zoomOutLetter', 'Grow by Letter', 'char'],
    ['blur', 'Blur Reveal', 'line'], ['blurWord', 'Blur by Word', 'word'], ['blurLetter', 'Blur by Letter', 'char'],
    ['rotate', 'Rotate In', 'word'], ['spin', 'Spin In', 'char'], ['elastic', 'Elastic', 'word'], ['stretch', 'Stretch', 'char'],
    ['typewriter', 'Typewriter', 'char'], ['typeWord', 'Type by Word', 'word'], ['flicker', 'Flicker On', 'char'],
    ['glitch', 'Glitch In', 'char'], ['scramble', 'Scramble', 'char'], ['swing', 'Swing In', 'word'], ['rise', 'Kinetic Rise', 'word']
  ].map(([id, name, unit]) => ({ id, name, unit, motion: id.replace(/(Word|Letter)$/, '').replace('typeWord', 'typewriter').replace(/^type$/, 'typewriter'), kind: 'in' }));
  for (const a of ins) if (!MOTIONS[a.motion]) a.motion = a.id === 'typeWord' ? 'typewriter' : 'fade';
  const outs = [['fadeOut', 'Fade Out', 'fade', 'line'], ['upOut', 'Fade Up Out', 'up', 'word'], ['downOut', 'Drop Out', 'down', 'line'],
    ['popOut', 'Pop Out', 'pop', 'word'], ['zoomOutOut', 'Shrink Out', 'zoomOut', 'line'], ['blurOut', 'Blur Out', 'blur', 'line'],
    ['letterOut', 'Letters Away', 'up', 'char'], ['glitchOut', 'Glitch Out', 'glitch', 'char'], ['slideOut', 'Slide Out', 'left', 'line'], ['typeOut', 'Untype', 'typewriter', 'char']]
    .map(([id, name, motion, unit]) => ({ id, name, motion, unit, kind: 'out' }));
  const loops = [['wave', 'Wave'], ['float', 'Float'], ['pulse', 'Pulse'], ['heartbeat', 'Heartbeat'], ['shake', 'Shake'], ['jelly', 'Jelly'],
    ['swingLoop', 'Swing'], ['glitchLoop', 'Glitch'], ['flickerLoop', 'Flicker'], ['bounceLoop', 'Bounce Letters']]
    .map(([id, name]) => ({ id, name, motion: id, unit: id === 'wave' || id === 'jelly' || id === 'bounceLoop' || id === 'shake' || id === 'flickerLoop' ? 'char' : 'line', kind: 'loop' }));
  return [...ins, ...outs, ...loops];
})();
const textAnim = (id) => TEXT_ANIMS.find(a => a.id === id);

const CAN_FILTER = typeof CanvasRenderingContext2D !== 'undefined' && 'filter' in CanvasRenderingContext2D.prototype;
const SCRAMBLE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&*';

// Splits text into lines and animation units (letters, words or whole lines).
function layoutText(ctx, tx, scale) {
  const lines = String(tx.content ?? '').split('\n');
  const ls = (tx.letterSpacing || 0) * scale;
  const out = [];
  lines.forEach((line, li) => {
    const chars = Array.from(line);
    const xs = []; let prefix = '';
    for (let i = 0; i < chars.length; i++) { xs.push(ctx.measureText(prefix).width + i * ls); prefix += chars[i]; }
    const width = Math.max(1, ctx.measureText(line).width + Math.max(0, chars.length - 1) * ls);
    const glyphs = chars.map((ch, i) => ({ ch, x: xs[i], w: ctx.measureText(ch).width }));
    out.push({ text: line, width, glyphs, li });
  });
  return out;
}

// Draws a text layer at layer time t (seconds) for a clip of length dur.
// Returns { canvas, w, h } with w/h in comp pixels.
function drawTextCanvas(tx0, scale, t = 0, dur = 5, frame = 0, highlight = null) {
  const tx = { ...TEXT_DEFAULTS, ...tx0 };
  const size = Math.max(1, tx.size) * scale;
  const c = document.createElement('canvas'), ctx = c.getContext('2d');
  const font = `${tx.italic ? 'italic ' : ''}${tx.weight || 700} ${size}px ${Fonts.css(tx.font)}`;
  ctx.font = font;
  const lines = layoutText(ctx, tx, scale);
  const lineH = size * (tx.lineHeight || 1.15);
  const strokeMax = Math.max(tx.strokeOn ? tx.strokeWidth : 0, tx.stroke2On ? tx.stroke2Width : 0) * scale;
  const fx = Math.max(tx.glowOn ? tx.glowSize : 0, tx.shadowOn ? tx.shadowBlur + Math.max(Math.abs(tx.shadowX), Math.abs(tx.shadowY)) : 0) * scale;
  const animated = tx.animIn !== 'none' || tx.animOut !== 'none' || tx.animLoop !== 'none';
  const boxPad = tx.boxOn ? tx.boxPad * scale : 0;
  const pad = Math.ceil(strokeMax + fx + boxPad + size * (animated ? 1.2 : 0.3) + Math.abs(tx.curve || 0) / 360 * size * 2);
  const maxW = Math.max(...lines.map(l => l.width), 1);
  const W = Math.min(8192, Math.ceil(maxW + pad * 2)), H = Math.min(8192, Math.ceil(lineH * lines.length + pad * 2));
  c.width = W; c.height = H;
  ctx.font = font; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';

  // Animation units across the whole text, for stagger timing.
  const pick = (a) => (tx.animUnit && tx.animUnit !== 'auto') ? tx.animUnit : (a ? a.unit : 'line');
  const inA = textAnim(tx.animIn), outA = textAnim(tx.animOut), loopA = textAnim(tx.animLoop);
  const unitOf = (unit) => {
    const units = [];
    for (const L of lines) {
      if (unit === 'line') { units.push({ L, from: 0, to: L.glyphs.length }); continue; }
      if (unit === 'char') { L.glyphs.forEach((g, i) => { if (g.ch.trim()) units.push({ L, from: i, to: i + 1 }); }); continue; }
      let s = -1;
      L.glyphs.forEach((g, i) => { const sp = !g.ch.trim(); if (!sp && s < 0) s = i; if (sp && s >= 0) { units.push({ L, from: s, to: i }); s = -1; } });
      if (s >= 0) units.push({ L, from: s, to: L.glyphs.length });
    }
    return units;
  };
  // Pose for glyph index gi on line L, combining in, out and loop animations.
  const poseFor = (L, gi) => {
    const pose = { dx: 0, dy: 0, s: 1, sx: 1, sy: 1, r: 0, a: 1, b: 0, scramble: false };
    const apply = (p) => { if (!p) return; pose.dx += p.dx || 0; pose.dy += p.dy || 0; pose.s *= p.s ?? 1; pose.sx *= p.sx ?? 1; pose.sy *= p.sy ?? 1; pose.r += p.r || 0; pose.a *= p.a ?? 1; pose.b += p.b || 0; if (p.scramble) pose.scramble = true; };
    const stage = (anim, local, total, isOut) => {
      const units = unitOf(pick(anim)); const n = units.length || 1;
      const ui = Math.max(0, units.findIndex(u => u.L === L && gi >= u.from && gi < u.to));
      const typing = anim.motion === 'typewriter';
      const st = typing ? 1 : clamp(tx.animStagger, 0, 0.95);
      const ud = typing ? total / n : total * (1 - st);
      const start = typing ? ui * ud : (n > 1 ? ui / (n - 1) * total * st : 0);
      let p = clamp((local - start) / Math.max(ud, 1e-3), 0, 1);
      if (isOut) p = 1 - clamp((local - (n - 1 - ui) * 0 - start) / Math.max(ud, 1e-3), 0, 1);
      const m = MOTIONS[anim.motion] || MOTIONS.fade;
      apply(m(p, ui, frame));
    };
    if (inA && t < tx.animInDur) stage(inA, t, tx.animInDur, false);
    if (outA && t > dur - tx.animOutDur) stage(outA, t - (dur - tx.animOutDur), tx.animOutDur, true);
    if (loopA) { const units = unitOf(pick(loopA)); const ui = Math.max(0, units.findIndex(u => u.L === L && gi >= u.from && gi < u.to)); apply((LOOPS[loopA.motion] || (() => ({})))(t, ui, frame)); }
    return pose;
  };

  // Fill style: solid or a gradient spanning the whole text block.
  const fillStyle = () => {
    if (tx.fillType !== 'gradient') return cssColor(tx.color);
    const a = (tx.gradAngle || 0) * Math.PI / 180, cx = W / 2, cy = H / 2, r = Math.max(maxW, lineH * lines.length) / 2;
    const g = ctx.createLinearGradient(cx - Math.cos(a) * r, cy - Math.sin(a) * r, cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    g.addColorStop(0, cssColor(tx.color)); g.addColorStop(1, cssColor(tx.color2)); return g;
  };
  const fs = fillStyle();

  // Background box behind each line.
  if (tx.boxOn) {
    ctx.fillStyle = cssColor(tx.boxColor);
    lines.forEach((L, li) => {
      const y = pad + lineH * li, x = lineX(L);
      roundRect(ctx, x - boxPad, y + (lineH - size) / 2 - boxPad * 0.6, L.width + boxPad * 2, size + boxPad * 1.2, tx.boxRadius * scale); ctx.fill();
    });
  }
  function lineX(L) { return tx.align === 'center' ? (W - L.width) / 2 : tx.align === 'right' ? W - pad - L.width : pad; }

  const curveRad = (tx.curve || 0) * Math.PI / 180;
  lines.forEach((L, li) => {
    const baseY = pad + lineH * (li + 0.5), x0 = lineX(L);
    const R = Math.abs(curveRad) > 1e-3 ? L.width / curveRad : 0;
    L.glyphs.forEach((g, gi) => {
      if (!g.ch.trim()) return;
      const pose = animated ? poseFor(L, gi) : { dx: 0, dy: 0, s: 1, sx: 1, sy: 1, r: 0, a: 1, b: 0 };
      // Captions pass a highlight function: colour, visibility and pop per letter.
      const hl = highlight ? highlight(L.li, gi) : null;
      if (hl) { if (hl.a != null) pose.a *= hl.a; if (hl.s != null) pose.s *= hl.s; }
      if (pose.a <= 0.001) return;
      let cx = x0 + g.x + g.w / 2, cy = baseY, rot = 0;
      if (R) { const ang = (g.x + g.w / 2 - L.width / 2) / R; cx = W / 2 + Math.sin(ang) * R; cy = baseY + R - Math.cos(ang) * R - 0; rot = ang; cy -= 0; }
      ctx.save();
      ctx.translate(cx + pose.dx * size, cy + pose.dy * size);
      ctx.rotate(rot + pose.r * Math.PI / 180);
      ctx.scale(pose.s * pose.sx, pose.s * pose.sy);
      ctx.globalAlpha = clamp(pose.a, 0, 1);
      if (pose.b > 0 && CAN_FILTER) ctx.filter = `blur(${(pose.b * size).toFixed(1)}px)`;
      let ch = g.ch;
      if (pose.scramble) ch = SCRAMBLE_CHARS[Math.floor(hash01(gi + 31, frame) * SCRAMBLE_CHARS.length)];
      const x = -g.w / 2;
      if (tx.glowOn) { ctx.shadowColor = cssColor(tx.glowColor); ctx.shadowBlur = tx.glowSize * scale; ctx.fillStyle = cssColor(tx.glowColor); ctx.fillText(ch, x, 0); ctx.fillText(ch, x, 0); ctx.shadowBlur = 0; }
      if (tx.stroke2On && tx.stroke2Width > 0) { ctx.strokeStyle = cssColor(tx.stroke2); ctx.lineWidth = tx.stroke2Width * 2 * scale; ctx.strokeText(ch, x, 0); }
      if (tx.shadowOn) { ctx.shadowColor = cssColor(tx.shadowColor); ctx.shadowBlur = tx.shadowBlur * scale; ctx.shadowOffsetX = tx.shadowX * scale; ctx.shadowOffsetY = tx.shadowY * scale; }
      if (tx.strokeOn && tx.strokeWidth > 0) { ctx.strokeStyle = cssColor(tx.stroke); ctx.lineWidth = tx.strokeWidth * 2 * scale; ctx.strokeText(ch, x, 0); ctx.shadowColor = 'transparent'; }
      ctx.fillStyle = hl && hl.c ? cssColor(hl.c) : fs; ctx.fillText(ch, x, 0);
      ctx.restore();
    });
  });
  return { canvas: c, w: W / scale, h: H / scale, animated };
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

// Is a text layer's look changing at this moment? (Decides whether the
// cached texture can be reused.)
function textIsAnimatingAt(tx, t, dur) {
  if (!tx) return false;
  if (tx.animLoop && tx.animLoop !== 'none') return true;
  if (tx.animIn && tx.animIn !== 'none' && t < (tx.animInDur ?? 0.8) + 0.05) return true;
  if (tx.animOut && tx.animOut !== 'none' && t > dur - (tx.animOutDur ?? 0.6) - 0.05) return true;
  return false;
}

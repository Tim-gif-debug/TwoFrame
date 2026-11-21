// ===========================================================================
// Text templates: styled title cards, lower thirds, buttons and captions.
// Each template adds ordinary, fully editable layers at the playhead.
// ===========================================================================
const TEXT_TEMPLATES = [
  { name: 'Title Card', preview: { font: 'Montserrat', color: '#fff' }, make: (P) => [txt(P, 'BIG TITLE', { font: 'Montserrat', weight: 900, size: P.s * 0.12, animIn: 'popWord', animOut: 'fadeOut', letterSpacing: 4 })] },
  { name: 'Lower Third', preview: { font: 'Inter', color: '#fff', bg: '#14b8a6' }, make: (P) => [
    shp(P, { kind: 'rect', w: P.w * 0.62, h: P.s * 0.15, radius: 10, fill: [0.08, 0.72, 0.65, 1] }, { x: P.w * 0.36, y: P.h * 0.82 }, 'slidein'),
    txt(P, 'Your Name', { font: 'Inter', weight: 800, size: P.s * 0.055, align: 'left', animIn: 'left' }, { x: P.w * 0.38, y: P.h * 0.805 }),
    txt(P, 'Title or role', { font: 'Inter', weight: 400, size: P.s * 0.032, align: 'left', color: [0.9, 1, 0.98, 1], animIn: 'left' }, { x: P.w * 0.34, y: P.h * 0.85 })] },
  { name: 'Subscribe Button', preview: { font: 'Roboto', color: '#fff', bg: '#e11d2e' }, make: (P) => [
    shp(P, { kind: 'rect', w: P.s * 0.5, h: P.s * 0.13, radius: P.s * 0.03, fill: [0.88, 0.11, 0.18, 1] }, { y: P.h * 0.8 }),
    txt(P, 'SUBSCRIBE', { font: 'Roboto', weight: 900, size: P.s * 0.055, animIn: 'pop', animLoop: 'pulse' }, { y: P.h * 0.8 })] },
  { name: 'Social Caption', preview: { font: 'Poppins', color: '#fff', bg: '#000' }, make: (P) => [txt(P, 'This is how it starts', { font: 'Poppins', weight: 800, size: P.s * 0.06, boxOn: true, boxColor: [0, 0, 0, 0.8], boxPad: 22, boxRadius: 16, animIn: 'popWord' }, { y: P.h * 0.7 })] },
  { name: 'Neon Sign', preview: { font: 'Monoton', color: '#5ff', glow: true }, make: (P) => [txt(P, 'NEON', { font: 'Monoton', weight: 400, size: P.s * 0.14, color: [0.75, 1, 1, 1], glowOn: true, glowColor: [0.1, 0.95, 1, 1], glowSize: 30, animIn: 'flicker', animLoop: 'flickerLoop' })] },
  { name: 'Comic Burst', preview: { font: 'Bangers', color: '#ffe23a', stroke: '#000' }, make: (P) => [
    shp(P, { kind: 'star', w: P.s * 0.62, h: P.s * 0.5, points: 12, inner: 0.72, fill: [0.95, 0.18, 0.15, 1] }, {}, 'bouncein'),
    txt(P, 'POW!', { font: 'Bangers', weight: 400, size: P.s * 0.15, color: [1, 0.9, 0.2, 1], strokeOn: true, stroke: [0, 0, 0, 1], strokeWidth: 10, animIn: 'pop', animLoop: 'shake' })] },
  { name: 'Quote', preview: { font: 'Playfair Display', color: '#fff', italic: true }, make: (P) => [txt(P, '“A line worth\nremembering.”', { font: 'Playfair Display', weight: 700, italic: true, size: P.s * 0.07, animIn: 'up', animUnit: 'line', animStagger: 0.6 })] },
  { name: 'Kinetic Words', preview: { font: 'Anton', color: '#fff' }, make: (P) => [txt(P, 'MAKE IT\nMOVE', { font: 'Anton', weight: 400, size: P.s * 0.16, lineHeight: 1, animIn: 'zoomInWord', animOut: 'blurOut', animStagger: 0.7 })] },
  { name: 'Breaking News', preview: { font: 'Oswald', color: '#fff', bg: '#b91c1c' }, make: (P) => [
    shp(P, { kind: 'rect', w: P.w * 0.9, h: P.s * 0.12, radius: 0, fill: [0.72, 0.1, 0.1, 1] }, { y: P.h * 0.86 }, 'slidein'),
    txt(P, 'BREAKING NEWS', { font: 'Oswald', weight: 700, size: P.s * 0.06, letterSpacing: 6, animIn: 'typewriter' }, { y: P.h * 0.86 })] },
  { name: 'Chapter', preview: { font: 'Bebas Neue', color: '#fff' }, make: (P) => [txt(P, 'CHAPTER ONE', { font: 'Bebas Neue', weight: 400, size: P.s * 0.1, letterSpacing: 18, animIn: 'blurLetter', animStagger: 0.8 })] },
  { name: 'Retro Gradient', preview: { font: 'Bungee', color: '#ff8a3d' }, make: (P) => [txt(P, 'RETRO', { font: 'Bungee', weight: 400, size: P.s * 0.15, fillType: 'gradient', color: [1, 0.55, 0.15, 1], color2: [1, 0.2, 0.6, 1], shadowOn: true, shadowColor: [0.2, 0, 0.3, 1], shadowBlur: 0, shadowX: 10, shadowY: 10, animIn: 'bounceLetter' })] },
  { name: 'Handwritten', preview: { font: 'Caveat', color: '#fff' }, make: (P) => [txt(P, 'a little note', { font: 'Caveat', weight: 700, size: P.s * 0.1, animIn: 'typewriter', animInDur: 1.5 })] },
  { name: 'Curved Badge', preview: { font: 'Fredoka', color: '#fff' }, make: (P) => [txt(P, 'BEST DAY EVER', { font: 'Fredoka', weight: 700, size: P.s * 0.07, curve: 120, letterSpacing: 4, animIn: 'popLetter', animLoop: 'float' })] },
  { name: 'Countdown Number', preview: { font: 'Russo One', color: '#fff' }, make: (P) => [txt(P, '3', { font: 'Russo One', weight: 400, size: P.s * 0.35, strokeOn: true, stroke: [0.08, 0.72, 0.65, 1], strokeWidth: 12, animIn: 'zoomIn', animOut: 'zoomOutOut' })] }
];

// Template helpers: P holds the project size.
function txt(P, content, t, pos = {}) {
  const l = App.baseLayer('text', content.split('\n')[0].slice(0, 24));
  l.text = { ...TEXT_DEFAULTS, content, ...t, size: Math.round(t.size || P.s * 0.08) };
  if (pos.x != null) l.transform.x = pos.x; if (pos.y != null) l.transform.y = pos.y;
  return l;
}
function shp(P, s, pos = {}, motion) {
  const l = App.baseLayer('shape', 'Shape');
  l.shape = { ...SHAPE_DEFAULTS, ...s, w: Math.round(s.w), h: Math.round(s.h) };
  if (pos.x != null) l.transform.x = pos.x; if (pos.y != null) l.transform.y = pos.y;
  if (motion === 'slidein') l.effects.push({ uid: uid('fx'), defId: 'tf.slidein', enabled: true, params: { ...defaultParams(EffectLib.get('tf.slidein')), dir: 0, inLen: 0.45 } });
  if (motion === 'bouncein') l.effects.push({ uid: uid('fx'), defId: 'tf.bouncein', enabled: true, params: defaultParams(EffectLib.get('tf.bouncein')) });
  return l;
}
function addTemplate(tpl) {
  const p = App.project, P = { w: p.width, h: p.height, s: Math.min(p.width, p.height) };
  const layers = tpl.make(P);
  for (const l of layers) { l.dur = Math.min(4, Math.max(1, p.duration - App.time)); App.addLayer(l, { kind: l.type === 'text' ? 'text' : 'overlay' }); }
  for (const l of layers) if (l.text) Fonts.ensure(l.text.font);
}

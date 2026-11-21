// ===========================================================================
// Effects: definitions, XML import, built-in library
//
// Every effect is a definition object:
//   { id, name, desc, category, tags, kind: 'shader'|'hold', builtin,
//     params: [{kind, id, label, default, min, max, step, choices}], shader }
//
// The XML format matches Gold Motion / Alight Motion custom effects:
//   <effect id name desc category tags> <params> spinner|color|switch|
//   selector|section|texture </params> <shader> GLSL </shader> </effect>
// so packs written for those apps import directly.
// ===========================================================================

const EffectLib = {
  defs: new Map(),          // id -> def
  order: [],                // display order of ids
  add(def) {
    if (!this.defs.has(def.id)) this.order.push(def.id);
    this.defs.set(def.id, def);
  },
  get(id) { return this.defs.get(id); },
  list() { return this.order.map(id => this.defs.get(id)).filter(Boolean); },
  categories() {
    const cats = [];
    for (const d of this.list()) if (!cats.includes(d.category)) cats.push(d.category);
    return cats;
  }
};

// Category guess for imported effects, from their tags.
const CATEGORY_TAGS = [
  ['Color', ['color', 'grade', 'colour', 'tone', 'lut']],
  ['Blur', ['blur', 'focus', 'sharpen', 'unsharp']],
  ['Distort', ['distort', 'warp', 'ripple', 'twirl', 'mirror', 'kaleido', 'bulge', 'fisheye']],
  ['Glitch', ['glitch', 'digital', 'vhs', 'crt', 'rgb', 'pixel', 'dither', 'scan']],
  ['Light', ['light', 'glow', 'bloom', 'flare', 'ray', 'vignette']],
  ['Stylize', ['stylize', 'art', 'ink', 'comic', 'halftone', 'sketch', 'poster', 'emboss']],
  ['Generate', ['procedural', 'noise', 'plasma', 'fire', 'aurora', 'starfield']],
  ['Retro', ['retro', 'film', 'analog', 'sepia', 'grain', 'super8']],
];

function guessCategory(tags, fallback) {
  const t = (tags || '').toLowerCase();
  for (const [cat, keys] of CATEGORY_TAGS) if (keys.some(k => t.includes(k))) return cat;
  return fallback || 'Custom';
}

// Parse one effect XML file into a definition. Throws with a readable
// message if the file is not a valid effect.
function parseEffectXML(text, sourceName = '') {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error(`${sourceName || 'File'} is not valid XML`);
  const root = doc.documentElement;
  if (!root || root.nodeName !== 'effect') throw new Error(`${sourceName || 'File'} is not an effect (no <effect> root)`);
  const shaderEl = root.querySelector('shader');
  if (!shaderEl) throw new Error(`${sourceName || 'File'} has no <shader>`);

  const params = [];
  const pEl = root.querySelector('params');
  if (pEl) {
    for (const p of Array.from(pEl.children)) {
      const kind = p.nodeName;
      const a = (n, d) => (p.hasAttribute(n) ? p.getAttribute(n) : d);
      if (kind === 'section') params.push({ kind, label: a('text', '') });
      else if (kind === 'texture') params.push({ kind, id: a('id') });
      else if (kind === 'spinner') params.push({
        kind, id: a('id'), label: a('label', a('id')),
        default: parseFloat(a('default', '0')), min: parseFloat(a('min', '0')),
        max: parseFloat(a('max', '1')), step: parseFloat(a('step', '0.01'))
      });
      else if (kind === 'color') params.push({ kind, id: a('id'), label: a('label', a('id')), default: parseColor(a('default', '#FFFFFFFF')) });
      else if (kind === 'switch') params.push({ kind, id: a('id'), label: a('label', a('id')), default: a('default', 'false') === 'true' });
      else if (kind === 'selector') params.push({
        kind, id: a('id'), label: a('label', a('id')), default: parseInt(a('default', '0'), 10) || 0,
        choices: Array.from(p.querySelectorAll('choice')).map(c => ({ value: parseInt(c.getAttribute('value'), 10) || 0, label: c.getAttribute('label') || '' }))
      });
    }
  }
  const tags = root.getAttribute('tags') || '';
  const rawCat = root.getAttribute('category') || '';
  const def = {
    id: root.getAttribute('id') || ('custom.' + uid()),
    name: root.getAttribute('name') || sourceName || 'Custom Effect',
    desc: root.getAttribute('desc') || '',
    category: rawCat && rawCat !== 'custom' ? rawCat : guessCategory(tags, 'Custom'),
    tags,
    kind: 'shader',
    builtin: false,
    precision: shaderEl.getAttribute('precision') || 'high',
    params,
    shader: shaderEl.textContent || '',
    xml: text
  };
  if (!params.some(p => p.kind === 'texture')) params.unshift({ kind: 'texture', id: 'inputImg' });
  return def;
}

// Default parameter values for a new effect instance.
function defaultParams(def) {
  const out = {};
  for (const p of def.params) if (p.id && p.kind !== 'texture' && p.kind !== 'section') out[p.id] = deepCopy(p.default);
  return out;
}

// ---------------------------------------------------------------------------
// Built-in library. Written in the same structure as imported effects.
// ---------------------------------------------------------------------------
const S = (id, label, d, min, max, step = 0.01) => ({ kind: 'spinner', id, label, default: d, min, max, step });
const C = (id, label, hex) => ({ kind: 'color', id, label, default: parseColor(hex) });
const B = (id, label, d = false) => ({ kind: 'switch', id, label, default: d });
const L = (id, label, d, labels) => ({ kind: 'selector', id, label, default: d, choices: labels.map((l, i) => ({ value: i, label: l })) });
const H = (label) => ({ kind: 'section', label });

// Helpers available to every built-in shader.
const TF_PRELUDE = `
float tfLum(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float tfHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float tfNoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(tfHash(i), tfHash(i+vec2(1.0,0.0)), u.x), mix(tfHash(i+vec2(0.0,1.0)), tfHash(i+vec2(1.0,1.0)), u.x), u.y); }
vec4 tfGet(vec2 uv){ return texture2DCv(inputImg.texture, uv); }
vec4 tfGetT(vec2 uv){ if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return vec4(0.0); return texture2DCv(inputImg.texture, uv); }
vec3 tfUn(vec4 c){ return c.rgb / max(c.a, 1e-4); }
float tfK(){ return acScreenSize.y / 1080.0; }
`;

function fx(id, name, category, desc, params, body) {
  EffectLib.add({
    id: 'tf.' + id, name, category, desc, tags: category.toLowerCase(), kind: 'shader', builtin: true,
    precision: 'high', params: [{ kind: 'texture', id: 'inputImg' }, ...params], shader: TF_PRELUDE + body
  });
}

// ---- Time --------------------------------------------------------------
EffectLib.add({
  id: 'tf.hold', name: 'Hold Motion', category: 'Time', kind: 'hold', builtin: true, tags: 'time,hold,twos,animation',
  desc: 'Holds each frame for a set number of frames, like animation on twos or threes. Optional ghost trails and a blur on the jump.',
  params: [
    H('Timing'),
    S('holdLength', 'Hold Length (frames)', 2, 1, 24, 1),
    S('offset', 'Offset (frames)', 0, -24, 24, 1),
    B('includeTransform', 'Hold Movement Too', true),
    B('random', 'Random Holds', false),
    S('randomness', 'Randomness', 0.5, 0, 1, 0.01),
    S('seed', 'Seed', 1, 0, 9999, 1),
    H('Ghost Trails'),
    B('ghosts', 'Ghost Trails', false),
    S('ghostCount', 'Ghost Count', 3, 1, 8, 1),
    S('ghostFalloff', 'Ghost Falloff', 0.4, 0, 1, 0.01),
    L('ghostBlend', 'Ghost Blend Mode', 0, ['Normal', 'Add', 'Screen', 'Lighten']),
    C('ghostTint', 'Ghost Tint', '#FFFFFFFF'),
    H('Snap Blur'),
    B('snapBlur', 'Snap Blur', false),
    S('snapAmount', 'Amount', 0.5, 0, 2, 0.01),
    H('Output'),
    S('mix', 'Mix', 1, 0, 1, 0.01)
  ]
});

// ---- Color -------------------------------------------------------------
fx('brightcon', 'Brightness & Contrast', 'Color', 'Basic brightness and contrast.',
  [S('brightness', 'Brightness', 0, -1, 1), S('contrast', 'Contrast', 1, 0, 3)], `
void main(){ vec4 s = tfGet(acScreenNorm); vec3 c = tfUn(s);
  c = (c - 0.5) * contrast + 0.5 + brightness;
  gl_FragColor = vec4(clamp(c,0.0,1.0) * s.a, s.a); }`);

fx('huesat', 'Hue / Saturation', 'Color', 'Rotate hue, change saturation and lightness.',
  [S('hue', 'Hue', 0, -180, 180, 1), S('saturation', 'Saturation', 1, 0, 3), S('lightness', 'Lightness', 0, -1, 1)], `
void main(){ vec4 s = tfGet(acScreenNorm); vec3 c = tfUn(s);
  float a = radians(hue); float cs = cos(a), sn = sin(a);
  mat3 m = mat3(0.299,0.587,0.114, 0.299,0.587,0.114, 0.299,0.587,0.114)
    + mat3(0.701,-0.587,-0.114, -0.299,0.413,-0.114, -0.300,-0.588,0.886) * cs
    + mat3(0.168,0.330,-0.497, -0.328,0.035,0.292, 1.250,-1.050,-0.203) * sn;
  c = c * m;
  float l = tfLum(c); c = mix(vec3(l), c, saturation);
  c = lightness >= 0.0 ? mix(c, vec3(1.0), lightness) : c * (1.0 + lightness);
  gl_FragColor = vec4(clamp(c,0.0,1.0) * s.a, s.a); }`);

fx('exposure', 'Exposure', 'Color', 'Exposure in stops, gamma and offset.',
  [S('exposure', 'Exposure (stops)', 0, -4, 4), S('gamma', 'Gamma', 1, 0.2, 3), S('offsetV', 'Offset', 0, -0.5, 0.5)], `
void main(){ vec4 s = tfGet(acScreenNorm); vec3 c = tfUn(s);
  c = c * exp2(exposure) + offsetV; c = pow(max(c, 0.0), vec3(1.0 / gamma));
  gl_FragColor = vec4(clamp(c,0.0,1.0) * s.a, s.a); }`);

fx('vibrance', 'Vibrance', 'Color', 'Boosts muted colors more than strong ones.',
  [S('vibrance', 'Vibrance', 0.5, -1, 1)], `
void main(){ vec4 s = tfGet(acScreenNorm); vec3 c = tfUn(s);
  float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b)); float sat = mx - mn;
  float l = tfLum(c); c = mix(vec3(l), c, 1.0 + vibrance * (1.0 - sat));
  gl_FragColor = vec4(clamp(c,0.0,1.0) * s.a, s.a); }`);

fx('bw', 'Black & White', 'Color', 'Converts to grayscale with adjustable channel mix.',
  [S('amount', 'Amount', 1, 0, 1), S('rw', 'Reds', 0.3, -1, 2), S('gw', 'Greens', 0.59, -1, 2), S('bw', 'Blues', 0.11, -1, 2)], `
void main(){ vec4 s = tfGet(acScreenNorm); vec3 c = tfUn(s);
  float g = dot(c, vec3(rw, gw, bw)) / max(rw + gw + bw, 0.01);
  c = mix(c, vec3(g), amount); gl_FragColor = vec4(clamp(c,0.0,1.0) * s.a, s.a); }`);

fx('tint', 'Tint', 'Color', 'Maps shadows and highlights to two colors.',
  [C('dark', 'Map Black To', '#FF101830'), C('light', 'Map White To', '#FFFFD27A'), S('amount', 'Amount', 1, 0, 1)], `
void main(){ vec4 s = tfGet(acScreenNorm); vec3 c = tfUn(s);
  vec3 t = mix(dark.rgb, light.rgb, tfLum(c)); c = mix(c, t, amount);
  gl_FragColor = vec4(c * s.a, s.a); }`);

fx('colorbal', 'Color Balance', 'Color', 'Pushes shadows, midtones and highlights toward colors.',
  [C('shadows', 'Shadows', '#FF0A2040'), C('mids', 'Midtones', '#FF808080'), C('highs', 'Highlights', '#FFFFE0B0'), S('amount', 'Amount', 0.5, 0, 1)], `
void main(){ vec4 s = tfGet(acScreenNorm); vec3 c = tfUn(s); float l = tfLum(c);
  vec3 sh = (shadows.rgb - 0.5) * (1.0 - smoothstep(0.0, 0.5, l));
  vec3 md = (mids.rgb - 0.5) * (1.0 - abs(l - 0.5) * 2.0);
  vec3 hi = (highs.rgb - 0.5) * smoothstep(0.5, 1.0, l);
  c += (sh + md + hi) * amount; gl_FragColor = vec4(clamp(c,0.0,1.0) * s.a, s.a); }`);

fx('invert', 'Invert', 'Color', 'Inverts the colors.',
  [S('amount', 'Amount', 1, 0, 1)], `
void main(){ vec4 s = tfGet(acScreenNorm); vec3 c = tfUn(s); c = mix(c, 1.0 - c, amount);
  gl_FragColor = vec4(c * s.a, s.a); }`);

fx('threshold', 'Threshold', 'Color', 'Turns the image into pure black and white.',
  [S('level', 'Level', 0.5, 0, 1), S('soft', 'Softness', 0.02, 0, 0.5)], `
void main(){ vec4 s = tfGet(acScreenNorm); float l = tfLum(tfUn(s));
  float v = smoothstep(level - soft - 1e-4, level + soft + 1e-4, l); gl_FragColor = vec4(vec3(v) * s.a, s.a); }`);

fx('posterize', 'Posterize', 'Color', 'Reduces the number of color levels.',
  [S('levels', 'Levels', 5, 2, 32, 1)], `
void main(){ vec4 s = tfGet(acScreenNorm); vec3 c = tfUn(s); float n = max(levels - 1.0, 1.0);
  c = floor(c * n + 0.5) / n; gl_FragColor = vec4(c * s.a, s.a); }`);

fx('fill', 'Fill', 'Color', 'Fills the layer with a color, keeping its shape.',
  [C('color', 'Color', '#FFFF3B5C'), S('amount', 'Amount', 1, 0, 1)], `
void main(){ vec4 s = tfGet(acScreenNorm); gl_FragColor = mix(s, vec4(color.rgb * s.a, s.a), amount); }`);

fx('gradient', 'Gradient Overlay', 'Color', 'Lays a two-color gradient over the layer.',
  [C('colA', 'Start Color', '#FFFF2E7E'), C('colB', 'End Color', '#FF3A7BFF'), S('angle', 'Angle', 90, -180, 180, 1), S('amount', 'Amount', 0.6, 0, 1), B('keepShape', 'Only On Layer', true)], `
void main(){ vec2 uv = acScreenNorm; vec4 s = tfGet(uv); float a = radians(angle);
  vec2 d = vec2(cos(a), sin(a)); float t = clamp(dot(uv - 0.5, d) + 0.5, 0.0, 1.0);
  vec3 g = mix(colA.rgb, colB.rgb, t);
  if (keepShape) gl_FragColor = vec4(mix(tfUn(s), g, amount) * s.a, s.a);
  else gl_FragColor = mix(s, vec4(g, 1.0), amount); }`);

// ---- Blur --------------------------------------------------------------
fx('blur', 'Gaussian Blur', 'Blur', 'Soft blur in all directions.',
  [S('radius', 'Radius', 12, 0, 120, 0.5)], `
void main(){ vec2 uv = acScreenNorm; vec2 px = 1.0 / acScreenSize; float r = radius * tfK();
  if (r < 0.5) { gl_FragColor = tfGet(uv); return; }
  vec4 acc = vec4(0.0); float wsum = 0.0;
  for (int i = 0; i < 64; i++) { float fi = float(i); float rr = sqrt((fi + 0.5) / 64.0);
    float th = fi * 2.39996; vec2 o = vec2(cos(th), sin(th)) * rr * r;
    float w = exp(-rr * rr * 2.0); acc += tfGet(uv + o * px) * w; wsum += w; }
  gl_FragColor = acc / wsum; }`);

fx('dirblur', 'Directional Blur', 'Blur', 'Motion blur along one direction.',
  [S('angle', 'Angle', 0, -180, 180, 1), S('len', 'Length', 30, 0, 300, 1)], `
void main(){ vec2 uv = acScreenNorm; vec2 d = vec2(cos(radians(angle)), sin(radians(angle))) * len * tfK() / acScreenSize;
  vec4 acc = vec4(0.0); for (int i = 0; i < 40; i++) { float t = float(i) / 39.0 - 0.5; acc += tfGet(uv + d * t); }
  gl_FragColor = acc / 40.0; }`);

fx('zoomblur', 'Zoom Blur', 'Blur', 'Blurs outward from a center point.',
  [S('cx', 'Center X', 0.5, 0, 1), S('cy', 'Center Y', 0.5, 0, 1), S('amount', 'Amount', 0.15, 0, 1)], `
void main(){ vec2 uv = acScreenNorm; vec2 c = vec2(cx, cy); vec4 acc = vec4(0.0);
  for (int i = 0; i < 40; i++) { float t = float(i) / 39.0; acc += tfGet(c + (uv - c) * (1.0 - amount * t)); }
  gl_FragColor = acc / 40.0; }`);

fx('spinblur', 'Spin Blur', 'Blur', 'Blurs in a circle around a center point.',
  [S('cx', 'Center X', 0.5, 0, 1), S('cy', 'Center Y', 0.5, 0, 1), S('angle', 'Angle', 10, 0, 90, 0.5)], `
void main(){ vec2 uv = acScreenNorm; vec2 asp = vec2(acScreenSize.x / acScreenSize.y, 1.0);
  vec2 p = (uv - vec2(cx, cy)) * asp; vec4 acc = vec4(0.0);
  for (int i = 0; i < 40; i++) { float a = radians(angle) * (float(i) / 39.0 - 0.5); float cs = cos(a), sn = sin(a);
    vec2 q = vec2(p.x * cs - p.y * sn, p.x * sn + p.y * cs); acc += tfGet(q / asp + vec2(cx, cy)); }
  gl_FragColor = acc / 40.0; }`);

fx('sharpen', 'Sharpen', 'Blur', 'Crisps up edges.',
  [S('amount', 'Amount', 0.6, 0, 3), S('radius', 'Radius', 1.5, 0.5, 6, 0.1)], `
void main(){ vec2 uv = acScreenNorm; vec2 px = radius * tfK() / acScreenSize; vec4 s = tfGet(uv);
  vec4 b = (tfGet(uv + vec2(px.x,0.0)) + tfGet(uv - vec2(px.x,0.0)) + tfGet(uv + vec2(0.0,px.y)) + tfGet(uv - vec2(0.0,px.y))) * 0.25;
  vec4 o = s + (s - b) * amount; o.a = s.a; o.rgb = clamp(o.rgb, 0.0, o.a); gl_FragColor = o; }`);

// ---- Light -------------------------------------------------------------
fx('glow', 'Glow', 'Light', 'Makes bright areas glow.',
  [S('threshold', 'Threshold', 0.6, 0, 1), S('radius', 'Radius', 24, 1, 150, 0.5), S('intensity', 'Intensity', 1.2, 0, 5), C('tintC', 'Glow Color', '#FFFFFFFF')], `
void main(){ vec2 uv = acScreenNorm; vec2 px = 1.0 / acScreenSize; float r = radius * tfK();
  vec4 s = tfGet(uv); vec3 acc = vec3(0.0); float asum = 0.0; float wsum = 0.0;
  for (int i = 0; i < 48; i++) { float fi = float(i); float rr = sqrt((fi + 0.5) / 48.0); float th = fi * 2.39996;
    vec4 c = tfGet(uv + vec2(cos(th), sin(th)) * rr * r * px); float w = exp(-rr * rr * 3.0);
    float k = smoothstep(threshold, threshold + 0.15, tfLum(tfUn(c))) * c.a;
    acc += tfUn(c) * k * w; asum += k * w; wsum += w; }
  vec3 g = acc / wsum * intensity * tintC.rgb; float ga = clamp(asum / wsum * intensity, 0.0, 1.0);
  gl_FragColor = vec4(s.rgb + g * (1.0 - s.a * 0.0), max(s.a, ga)); gl_FragColor.rgb = min(gl_FragColor.rgb, vec3(gl_FragColor.a) * 4.0); }`);

fx('vignette', 'Vignette', 'Light', 'Darkens the edges of the frame.',
  [S('amount', 'Amount', 0.6, 0, 1), S('size', 'Size', 0.55, 0, 1.5), S('soft', 'Softness', 0.45, 0.01, 1), C('vcolor', 'Color', '#FF000000')], `
void main(){ vec2 uv = acScreenNorm; vec4 s = tfGet(uv); vec2 d = (uv - 0.5) * vec2(acScreenSize.x / acScreenSize.y, 1.0);
  float v = smoothstep(size, size + soft, length(d) * 1.2) * amount;
  gl_FragColor = vec4(mix(s.rgb, vcolor.rgb * s.a, v), s.a); }`);

fx('lightleak', 'Light Leak', 'Light', 'Warm drifting light washes, like old film.',
  [S('amount', 'Amount', 0.6, 0, 1), S('speed', 'Speed', 0.3, 0, 3), C('c1', 'Color 1', '#FFFF7A2E'), C('c2', 'Color 2', '#FFFF2E8A'), S('seed', 'Seed', 1, 0, 100, 1)], `
void main(){ vec2 uv = acScreenNorm; vec4 s = tfGet(uv); float t = acTime * speed + seed * 7.13;
  vec2 p1 = vec2(0.15 + 0.3 * sin(t * 0.7), 0.3 + 0.25 * cos(t * 0.5)); vec2 p2 = vec2(0.85 + 0.2 * cos(t * 0.6), 0.7 + 0.3 * sin(t * 0.4));
  float a = exp(-dot(uv - p1, uv - p1) * 6.0), b = exp(-dot(uv - p2, uv - p2) * 5.0);
  vec3 l = (c1.rgb * a + c2.rgb * b) * amount * (0.75 + 0.25 * tfNoise(vec2(t * 3.0, 0.0)));
  gl_FragColor = vec4(s.rgb + l * (1.0 - s.rgb / max(s.a, 1e-4)) * s.a + l * (1.0 - s.a) * 0.0, s.a); }`);

fx('rays', 'Light Rays', 'Light', 'Streaks of light from bright areas toward the viewer.',
  [S('cx', 'Center X', 0.5, 0, 1), S('cy', 'Center Y', 0.3, 0, 1), S('len', 'Length', 0.4, 0, 1), S('intensity', 'Intensity', 0.8, 0, 3), S('threshold', 'Threshold', 0.5, 0, 1)], `
void main(){ vec2 uv = acScreenNorm; vec4 s = tfGet(uv); vec2 c = vec2(cx, cy); vec3 acc = vec3(0.0);
  for (int i = 0; i < 48; i++) { float t = float(i) / 47.0; vec4 q = tfGet(uv + (c - uv) * t * len);
    acc += tfUn(q) * q.a * smoothstep(threshold, threshold + 0.2, tfLum(tfUn(q))) * (1.0 - t); }
  vec3 r = acc / 24.0 * intensity; gl_FragColor = vec4(s.rgb + r, max(s.a, clamp(tfLum(r), 0.0, 1.0))); }`);

// ---- Stylize -----------------------------------------------------------
fx('pixelate', 'Pixelate', 'Stylize', 'Big square pixels.',
  [S('size', 'Block Size', 16, 1, 200, 1)], `
void main(){ vec2 b = vec2(size * tfK()) / acScreenSize; vec2 uv = (floor(acScreenNorm / b) + 0.5) * b; gl_FragColor = tfGet(uv); }`);

fx('halftone', 'Halftone', 'Stylize', 'Comic-print dots.',
  [S('dotSize', 'Dot Size', 10, 3, 60, 0.5), S('angle', 'Angle', 45, 0, 90, 1), B('colorDots', 'Keep Color', true), C('ink', 'Ink Color', '#FF101010'), C('paper', 'Paper Color', '#FFF5EEDC')], `
void main(){ vec2 uv = acScreenNorm; vec2 p = uv * acScreenSize; float a = radians(angle); mat2 r = mat2(cos(a), -sin(a), sin(a), cos(a));
  float d = dotSize * tfK(); vec2 q = r * p; vec2 cell = (floor(q / d) + 0.5) * d; vec2 cp = (cell * r) / acScreenSize;
  vec4 s = tfGet(cp); float l = tfLum(tfUn(s)); float rad = sqrt(1.0 - l) * d * 0.72; float m = 1.0 - smoothstep(rad - 1.0, rad + 1.0, length(q - cell));
  vec4 base = tfGet(uv); vec3 col = colorDots ? mix(paper.rgb, tfUn(s), m) : mix(paper.rgb, ink.rgb, m);
  gl_FragColor = vec4(col * base.a, base.a); }`);

fx('inklines', 'Ink Lines', 'Stylize', 'Finds edges and draws them like ink.',
  [S('strength', 'Strength', 2, 0, 8), C('inkC', 'Ink Color', '#FF0A0A0A'), S('keep', 'Keep Original', 1, 0, 1)], `
void main(){ vec2 uv = acScreenNorm; vec2 px = 1.0 / acScreenSize * tfK();
  float tl = tfLum(tfGet(uv + px * vec2(-1.0,-1.0)).rgb), t = tfLum(tfGet(uv + px * vec2(0.0,-1.0)).rgb), tr = tfLum(tfGet(uv + px * vec2(1.0,-1.0)).rgb);
  float l = tfLum(tfGet(uv + px * vec2(-1.0,0.0)).rgb), r = tfLum(tfGet(uv + px * vec2(1.0,0.0)).rgb);
  float bl = tfLum(tfGet(uv + px * vec2(-1.0,1.0)).rgb), b = tfLum(tfGet(uv + px * vec2(0.0,1.0)).rgb), br = tfLum(tfGet(uv + px * vec2(1.0,1.0)).rgb);
  float gx = -tl - 2.0*l - bl + tr + 2.0*r + br, gy = -tl - 2.0*t - tr + bl + 2.0*b + br;
  float e = clamp(length(vec2(gx, gy)) * strength, 0.0, 1.0); vec4 s = tfGet(uv);
  vec3 base = mix(vec3(1.0), tfUn(s), keep); gl_FragColor = vec4(mix(base, inkC.rgb, e) * s.a, s.a); }`);

fx('outline', 'Outline', 'Stylize', 'Draws a stroke around the layer shape. Great on text.',
  [S('width', 'Width', 6, 0, 60, 0.5), C('lineC', 'Color', '#FF000000'), B('only', 'Outline Only', false)], `
void main(){ vec2 uv = acScreenNorm; vec4 s = tfGet(uv); float w = width * tfK(); float m = 0.0;
  for (int i = 0; i < 24; i++) { float a = float(i) * 0.2618; for (int j = 1; j <= 3; j++) {
    m = max(m, tfGetT(uv + vec2(cos(a), sin(a)) * w * float(j) / 3.0 / acScreenSize).a); } }
  vec4 line = vec4(lineC.rgb, 1.0) * m; gl_FragColor = only ? line * (1.0 - s.a) : s + line * (1.0 - s.a); }`);

fx('shadow', 'Drop Shadow', 'Stylize', 'A soft shadow behind the layer.',
  [S('angle', 'Angle', 135, -180, 180, 1), S('dist', 'Distance', 14, 0, 200, 0.5), S('soft', 'Softness', 12, 0, 80, 0.5), S('opac', 'Opacity', 0.6, 0, 1), C('shC', 'Color', '#FF000000')], `
void main(){ vec2 uv = acScreenNorm; vec4 s = tfGet(uv); vec2 off = vec2(cos(radians(angle)), sin(radians(angle))) * dist * tfK() / acScreenSize;
  float a = 0.0; float r = soft * tfK();
  for (int i = 0; i < 32; i++) { float fi = float(i); float rr = sqrt((fi + 0.5) / 32.0); float th = fi * 2.39996;
    a += tfGetT(uv - off + vec2(cos(th), sin(th)) * rr * r / acScreenSize).a; }
  a = a / 32.0 * opac; gl_FragColor = s + vec4(shC.rgb, 1.0) * a * (1.0 - s.a); }`);

fx('emboss', 'Emboss', 'Stylize', 'Raised, stamped look.',
  [S('amount', 'Amount', 1.5, 0, 5), S('angle', 'Light Angle', 135, -180, 180, 1), S('keep', 'Keep Color', 0.5, 0, 1)], `
void main(){ vec2 uv = acScreenNorm; vec2 d = vec2(cos(radians(angle)), sin(radians(angle))) * 1.5 * tfK() / acScreenSize;
  vec4 s = tfGet(uv); float e = tfLum(tfGet(uv - d).rgb) - tfLum(tfGet(uv + d).rgb);
  vec3 g = vec3(0.5 + e * amount); vec3 c = mix(g, g * tfUn(s) * 2.0, keep); gl_FragColor = vec4(clamp(c,0.0,1.0) * s.a, s.a); }`);

fx('grain', 'Film Grain', 'Retro', 'Animated film grain.',
  [S('amount', 'Amount', 0.15, 0, 1), S('size', 'Grain Size', 1.5, 0.5, 6, 0.1), B('colorGrain', 'Color Grain', false)], `
void main(){ vec2 uv = acScreenNorm; vec4 s = tfGet(uv); vec2 p = floor(uv * acScreenSize / (size * tfK())); float t = floor(acTime * 24.0);
  vec3 n = colorGrain ? vec3(tfHash(p + t), tfHash(p + t + 17.0), tfHash(p + t + 41.0)) : vec3(tfHash(p + t));
  vec3 c = tfUn(s) + (n - 0.5) * amount; gl_FragColor = vec4(clamp(c,0.0,1.0) * s.a, s.a); }`);

fx('oldfilm', 'Old Film', 'Retro', 'Sepia, flicker, dust and scratches.',
  [S('amount', 'Amount', 1, 0, 1), S('flicker', 'Flicker', 0.15, 0, 1), S('dust', 'Dust', 0.5, 0, 1)], `
void main(){ vec2 uv = acScreenNorm; float t = floor(acTime * 18.0); uv.y += (tfHash(vec2(t, 3.0)) - 0.5) * 0.004 * amount;
  vec4 s = tfGet(uv); vec3 c = tfUn(s); float l = tfLum(c); vec3 sep = vec3(l * 1.07, l * 0.92, l * 0.72);
  c = mix(c, sep, amount); c *= 1.0 - flicker * tfHash(vec2(t, 9.0)) * amount;
  float sx = tfHash(vec2(t, 1.0)); float scratch = (1.0 - smoothstep(0.0, 0.0015, abs(uv.x - sx))) * step(0.6, tfHash(vec2(t, 5.0)));
  float sp = step(1.0 - 0.0015 * dust, tfHash(floor(uv * acScreenSize / 3.0) + t)); c = mix(c, vec3(0.1), (scratch * 0.5 + sp) * amount);
  vec2 d = uv - 0.5; c *= 1.0 - dot(d, d) * 0.9 * amount; gl_FragColor = vec4(clamp(c,0.0,1.0) * s.a, s.a); }`);

fx('rgbsplit', 'RGB Split', 'Glitch', 'Pulls the red, green and blue channels apart.',
  [S('amount', 'Amount', 8, 0, 80, 0.5), S('angle', 'Angle', 0, -180, 180, 1)], `
void main(){ vec2 uv = acScreenNorm; vec2 d = vec2(cos(radians(angle)), sin(radians(angle))) * amount * tfK() / acScreenSize;
  vec4 r = tfGet(uv + d), g = tfGet(uv), b = tfGet(uv - d);
  float a = max(g.a, max(r.a, b.a)); gl_FragColor = vec4(r.r, g.g, b.b, a); }`);

fx('vhs', 'VHS', 'Glitch', 'Tape wobble, color bleed and noise.',
  [S('amount', 'Amount', 0.7, 0, 1), S('noiseA', 'Noise', 0.25, 0, 1), S('speed', 'Speed', 1, 0, 4)], `
void main(){ vec2 uv = acScreenNorm; float t = acTime * speed;
  uv.x += (tfNoise(vec2(uv.y * 40.0, t * 6.0)) - 0.5) * 0.006 * amount + step(0.985, tfHash(vec2(floor(uv.y * 90.0), floor(t * 10.0)))) * 0.02 * amount;
  float bleed = 3.0 * amount / acScreenSize.x * tfK() * 2.0;
  vec4 c = vec4(tfGet(uv + vec2(bleed, 0.0)).r, tfGet(uv).g, tfGet(uv - vec2(bleed, 0.0)).b, tfGet(uv).a);
  float n = (tfHash(uv * acScreenSize + floor(t * 30.0)) - 0.5) * noiseA; float scan = 0.92 + 0.08 * sin(uv.y * acScreenSize.y * 1.5);
  c.rgb = clamp((c.rgb + n * c.a) * mix(1.0, scan, amount), 0.0, 1.0) ; c.rgb = min(c.rgb, vec3(c.a)); gl_FragColor = c; }`);

fx('glitch', 'Glitch Blocks', 'Glitch', 'Random displaced blocks and color shifts.',
  [S('amount', 'Amount', 0.5, 0, 1), S('blocks', 'Block Count', 14, 2, 60, 1), S('speed', 'Speed', 8, 0, 30, 0.5), S('seed', 'Seed', 1, 0, 100, 1)], `
void main(){ vec2 uv = acScreenNorm; float t = floor(acTime * speed) + seed * 13.0;
  vec2 cell = floor(uv * vec2(blocks * 0.5, blocks)); float r = tfHash(cell + t);
  vec2 o = vec2(0.0); if (r < amount * 0.35) o.x = (tfHash(cell + t + 7.0) - 0.5) * 0.15 * amount;
  vec4 c = tfGet(uv + o); if (r < amount * 0.12) { c.r = tfGet(uv + o + vec2(0.01, 0.0)).r; c.b = tfGet(uv + o - vec2(0.01, 0.0)).b; }
  gl_FragColor = c; }`);

fx('scanlines', 'Scanlines', 'Glitch', 'Horizontal TV lines.',
  [S('amount', 'Amount', 0.35, 0, 1), S('density', 'Line Spacing', 4, 2, 20, 0.5), S('scroll', 'Scroll Speed', 0, -5, 5, 0.1)], `
void main(){ vec2 uv = acScreenNorm; vec4 s = tfGet(uv); float y = uv.y * acScreenSize.y / (density * tfK()) + acTime * scroll * 10.0;
  float m = 1.0 - amount * (0.5 + 0.5 * sin(y * 6.28318)); gl_FragColor = vec4(s.rgb * m, s.a); }`);

// ---- Distort -----------------------------------------------------------
fx('shake', 'Camera Shake', 'Distort', 'Hand-held style shake.',
  [S('amount', 'Amount', 20, 0, 200, 0.5), S('speed', 'Speed', 6, 0, 30, 0.1), S('rot', 'Rotation', 1.5, 0, 15, 0.1), S('zoom', 'Zoom To Hide Edges', 1.08, 1, 1.5), S('seed', 'Seed', 1, 0, 100, 1)], `
void main(){ vec2 uv = acScreenNorm; float t = acTime * speed + seed * 31.0;
  vec2 o = (vec2(tfNoise(vec2(t, 1.3)), tfNoise(vec2(t, 7.9))) - 0.5) * 2.0 * amount * tfK() / acScreenSize;
  float a = radians((tfNoise(vec2(t, 4.4)) - 0.5) * 2.0 * rot); vec2 asp = vec2(acScreenSize.x / acScreenSize.y, 1.0);
  vec2 p = (uv - 0.5) * asp / zoom; p = vec2(p.x * cos(a) - p.y * sin(a), p.x * sin(a) + p.y * cos(a)); gl_FragColor = tfGet(p / asp + 0.5 + o); }`);

fx('wave', 'Wave Warp', 'Distort', 'Wavy distortion.',
  [S('amp', 'Amplitude', 12, 0, 150, 0.5), S('freq', 'Frequency', 6, 0.5, 60, 0.1), S('speed', 'Speed', 1, -10, 10, 0.1), L('dir', 'Direction', 0, ['Horizontal', 'Vertical', 'Both'])], `
void main(){ vec2 uv = acScreenNorm; float a = amp * tfK() / acScreenSize.y; float t = acTime * speed * 6.28318;
  vec2 o = vec2(0.0); if (dir == 0 || dir == 2) o.x = sin(uv.y * freq * 6.28318 + t) * a; if (dir == 1 || dir == 2) o.y = sin(uv.x * freq * 6.28318 + t) * a;
  gl_FragColor = tfGetT(uv + o); }`);

fx('ripple', 'Ripple', 'Distort', 'Rings spreading out from a point.',
  [S('cx', 'Center X', 0.5, 0, 1), S('cy', 'Center Y', 0.5, 0, 1), S('amp', 'Amplitude', 10, 0, 100, 0.5), S('freq', 'Rings', 20, 1, 100, 0.5), S('speed', 'Speed', 1, -5, 5, 0.1)], `
void main(){ vec2 uv = acScreenNorm; vec2 asp = vec2(acScreenSize.x / acScreenSize.y, 1.0); vec2 d = (uv - vec2(cx, cy)) * asp; float r = length(d);
  float w = sin(r * freq * 6.28318 - acTime * speed * 6.28318) * amp * tfK() / acScreenSize.y; gl_FragColor = tfGetT(uv + (r > 0.0 ? d / r : vec2(0.0)) * w / asp); }`);

fx('swirl', 'Swirl', 'Distort', 'Twists the image around a center.',
  [S('cx', 'Center X', 0.5, 0, 1), S('cy', 'Center Y', 0.5, 0, 1), S('angle', 'Angle', 180, -1080, 1080, 1), S('radius', 'Radius', 0.4, 0.01, 1.5)], `
void main(){ vec2 uv = acScreenNorm; vec2 asp = vec2(acScreenSize.x / acScreenSize.y, 1.0); vec2 d = (uv - vec2(cx, cy)) * asp; float r = length(d);
  float k = max(0.0, 1.0 - r / radius); float a = radians(angle) * k * k; float cs = cos(a), sn = sin(a);
  d = vec2(d.x * cs - d.y * sn, d.x * sn + d.y * cs); gl_FragColor = tfGetT(d / asp + vec2(cx, cy)); }`);

fx('bulge', 'Bulge', 'Distort', 'Swells or pinches around a point.',
  [S('cx', 'Center X', 0.5, 0, 1), S('cy', 'Center Y', 0.5, 0, 1), S('amount', 'Amount', 0.5, -1, 1), S('radius', 'Radius', 0.35, 0.01, 1.5)], `
void main(){ vec2 uv = acScreenNorm; vec2 asp = vec2(acScreenSize.x / acScreenSize.y, 1.0); vec2 d = (uv - vec2(cx, cy)) * asp; float r = length(d);
  if (r < radius) { float k = r / radius; d *= mix(1.0, smoothstep(0.0, 1.0, k), amount); } gl_FragColor = tfGetT(d / asp + vec2(cx, cy)); }`);

fx('fisheye', 'Lens Distortion', 'Distort', 'Fisheye or pincushion lens.',
  [S('amount', 'Amount', 0.4, -1, 1), S('zoomV', 'Zoom', 1, 0.5, 2)], `
void main(){ vec2 uv = acScreenNorm; vec2 asp = vec2(acScreenSize.x / acScreenSize.y, 1.0); vec2 d = (uv - 0.5) * asp; float r2 = dot(d, d);
  d *= (1.0 + amount * r2) / zoomV; gl_FragColor = tfGetT(d / asp + 0.5); }`);

fx('mirror', 'Mirror', 'Distort', 'Mirrors one half of the frame onto the other.',
  [L('mode', 'Mode', 0, ['Left onto Right', 'Right onto Left', 'Top onto Bottom', 'Bottom onto Top', 'Four-way'])], `
void main(){ vec2 uv = acScreenNorm;
  if (mode == 0) uv.x = uv.x > 0.5 ? 1.0 - uv.x : uv.x;
  else if (mode == 1) uv.x = uv.x < 0.5 ? 1.0 - uv.x : uv.x;
  else if (mode == 2) uv.y = uv.y > 0.5 ? 1.0 - uv.y : uv.y;
  else if (mode == 3) uv.y = uv.y < 0.5 ? 1.0 - uv.y : uv.y;
  else { uv = 0.5 - abs(uv - 0.5); }
  gl_FragColor = tfGet(uv); }`);

fx('kaleido', 'Kaleidoscope', 'Distort', 'Repeats a slice of the image around the center.',
  [S('segments', 'Segments', 6, 2, 24, 1), S('rotation', 'Rotation', 0, -180, 180, 1), S('zoomV', 'Zoom', 1, 0.2, 4)], `
void main(){ vec2 uv = acScreenNorm; vec2 asp = vec2(acScreenSize.x / acScreenSize.y, 1.0); vec2 d = (uv - 0.5) * asp / zoomV;
  float a = atan(d.y, d.x) + radians(rotation); float seg = 6.28318 / segments; a = mod(a, seg); a = abs(a - seg * 0.5);
  float r = length(d); gl_FragColor = tfGet(vec2(cos(a), sin(a)) * r / asp + 0.5); }`);

fx('tile', 'Tile', 'Distort', 'Repeats the image in a grid.',
  [S('countX', 'Columns', 2, 1, 20, 1), S('countY', 'Rows', 2, 1, 20, 1), B('mirrorT', 'Mirror Edges', false)], `
void main(){ vec2 g = acScreenNorm * vec2(countX, countY); vec2 f = fract(g);
  if (mirrorT) { vec2 m = mod(floor(g), 2.0); f = mix(f, 1.0 - f, m); } gl_FragColor = tfGet(f); }`);

// ---- Generate ----------------------------------------------------------
fx('noisebg', 'Fractal Noise', 'Generate', 'Moving cloudy noise behind or over the layer.',
  [S('scale', 'Scale', 4, 0.5, 40, 0.1), S('speed', 'Speed', 0.3, 0, 5, 0.01), C('nc1', 'Color 1', '#FF0B1030'), C('nc2', 'Color 2', '#FF7A5CFF'), L('place', 'Place', 0, ['Behind Layer', 'Over Layer', 'Replace'])], `
void main(){ vec2 uv = acScreenNorm; vec4 s = tfGet(uv); vec2 p = uv * scale * vec2(acScreenSize.x / acScreenSize.y, 1.0); float t = acTime * speed;
  float n = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { n += a * tfNoise(p + t); p = p * 2.03 + 11.7; a *= 0.5; }
  vec4 nc = vec4(mix(nc1.rgb, nc2.rgb, n), 1.0);
  if (place == 0) gl_FragColor = s + nc * (1.0 - s.a); else if (place == 1) gl_FragColor = vec4(mix(s.rgb, nc.rgb * s.a, 0.5), s.a); else gl_FragColor = nc; }`);

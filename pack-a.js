// ===========================================================================
// Effects pack A: blur and sharpen, distort, stylize, colour.
// Same rules as the other packs: every slider can be keyframed, effects
// stack in any order, and each one is a GPU shader.
// Shared helpers used by packs A and B live in FXH below.
// ===========================================================================
const FXH = `
float xAsp(){ return acScreenSize.x / acScreenSize.y; }
vec2 xRot(vec2 v, float a){ float c = cos(a), s = sin(a); return vec2(v.x * c - v.y * s, v.x * s + v.y * c); }
vec3 xHsv(vec3 c){ vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0); vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g)); vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y); return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x); }
vec3 xRgb(vec3 c){ vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0); return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y); }
float xFbm(vec2 p){ float a = 0.5; float s = 0.0; for (int i = 0; i < 5; i++) { s += a * tfNoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
vec2 xH2(vec2 p){ return vec2(tfHash(p), tfHash(p + 37.7)); }
vec3 xVor(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); float md = 9.0; vec2 mc = vec2(0.0);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) { vec2 g = vec2(float(x), float(y)); vec2 o = xH2(i + g); float d = length(g + o - f); if (d < md) { md = d; mc = i + g; } } return vec3(md, mc); }
vec4 xOut(vec3 c, float a){ return vec4(clamp(c, 0.0, 1.0) * a, a); }
vec4 xOver(vec4 t, vec4 b){ return t + b * (1.0 - t.a); }
vec4 xAdd(vec4 s, vec3 c){ c = max(c, 0.0); return vec4(s.rgb + c, clamp(s.a + max(max(c.r, c.g), c.b), 0.0, 1.0)); }
vec4 xBlur(vec2 uv, float r){ if (r < 0.3) return tfGet(uv); vec2 px = r / acScreenSize; vec4 a = vec4(0.0);
  for (int i = 0; i < 24; i++) { float f = float(i); float rr = sqrt((f + 0.5) / 24.0); float th = f * 2.39996; a += tfGet(uv + vec2(cos(th), sin(th)) * rr * px); } return a / 24.0; }
float xSobel(vec2 uv, float w){ vec2 px = w / acScreenSize;
  float tl = tfLum(tfGet(uv + vec2(-px.x, -px.y)).rgb); float tc = tfLum(tfGet(uv + vec2(0.0, -px.y)).rgb); float tr = tfLum(tfGet(uv + vec2(px.x, -px.y)).rgb);
  float ml = tfLum(tfGet(uv + vec2(-px.x, 0.0)).rgb); float mr = tfLum(tfGet(uv + vec2(px.x, 0.0)).rgb);
  float bl = tfLum(tfGet(uv + vec2(-px.x, px.y)).rgb); float bc = tfLum(tfGet(uv + vec2(0.0, px.y)).rgb); float br = tfLum(tfGet(uv + vec2(px.x, px.y)).rgb);
  return length(vec2(-tl - 2.0 * ml - bl + tr + 2.0 * mr + br, -tl - 2.0 * tc - tr + bl + 2.0 * bc + br)); }
vec4 xGen(vec4 s, vec3 g, float ga, int bm){ g = clamp(g, 0.0, 1.0); ga = clamp(ga, 0.0, 1.0); if (bm == 0) return xOver(vec4(g * ga, ga), s);
  if (bm == 1) return xAdd(s, g * ga); vec3 c = tfUn(s); vec3 r;
  if (bm == 2) r = c * g; else if (bm == 3) r = 1.0 - (1.0 - c) * (1.0 - g); else r = mix(2.0 * c * g, 1.0 - 2.0 * (1.0 - c) * (1.0 - g), step(0.5, c));
  return vec4(mix(c, r, ga) * s.a, s.a); }
`;
const GM = ['Normal', 'Add', 'Multiply', 'Screen', 'Overlay'];
function fx3(id, name, category, desc, params, body) { fx(id, name, category, desc, params, FXH + body); }

// ---- Blur and sharpen -------------------------------------------------------
fx3('boxblur', 'Box Blur', 'Blur', 'A fast, even blur.', [S('radius', 'Radius', 12, 0, 120, 0.5)], `
void main(){ vec2 uv = acScreenNorm; vec2 px = radius * tfK() / acScreenSize / 3.0; vec4 a = vec4(0.0);
  for (int y = -3; y <= 3; y++) for (int x = -3; x <= 3; x++) a += tfGet(uv + vec2(float(x), float(y)) * px); gl_FragColor = a / 49.0; }`);
fx3('bilateral', 'Bilateral Blur', 'Blur', 'Smooths flat areas but keeps edges sharp.', [S('radius', 'Radius', 10, 0, 60, 0.5), S('edge', 'Edge Keep', 0.12, 0.01, 1)], `
void main(){ vec2 uv = acScreenNorm; vec2 px = radius * tfK() / acScreenSize / 3.0; vec4 c0 = tfGet(uv); vec4 a = vec4(0.0); float ws = 0.0;
  for (int y = -3; y <= 3; y++) for (int x = -3; x <= 3; x++) { vec4 c = tfGet(uv + vec2(float(x), float(y)) * px); vec3 d = c.rgb - c0.rgb; float w = exp(-dot(d, d) / (2.0 * edge * edge)); a += c * w; ws += w; }
  gl_FragColor = a / ws; }`);
fx3('channelblur', 'Channel Blur', 'Blur', 'Blurs red, green and blue by different amounts.', [S('rr', 'Red', 12, 0, 80, 0.5), S('gg', 'Green', 0, 0, 80, 0.5), S('bb', 'Blue', 0, 0, 80, 0.5)], `
void main(){ vec2 uv = acScreenNorm; vec4 s = tfGet(uv); float k = tfK(); gl_FragColor = vec4(xBlur(uv, rr * k).r, xBlur(uv, gg * k).g, xBlur(uv, bb * k).b, s.a); }`);
fx3('tiltshift', 'Tilt-Shift', 'Blur', 'Keeps a band sharp and blurs the rest, for a miniature look.',
  [S('radius', 'Blur', 18, 0, 80, 0.5), S('center', 'Band Position', 0.5, 0, 1), S('band', 'Band Size', 0.2, 0, 1), S('falloff', 'Falloff', 0.25, 0.01, 1), S('angle', 'Angle°', 0, -90, 90, 1)], `
void main(){ vec2 uv = acScreenNorm; float d = abs(xRot(uv - vec2(0.5, center), radians(angle)).y); float b = smoothstep(band * 0.5, band * 0.5 + falloff, d); gl_FragColor = xBlur(uv, b * radius * tfK()); }`);
fx3('irisblur', 'Iris Blur', 'Blur', 'Sharp inside a circle, blurry outside it.',
  [S('radius', 'Blur', 18, 0, 80, 0.5), S('cx', 'Center X', 0.5, 0, 1), S('cy', 'Center Y', 0.5, 0, 1), S('size', 'Size', 0.25, 0, 1), S('falloff', 'Falloff', 0.25, 0.01, 1), S('dark', 'Darken Outside', 0, 0, 1)], `
void main(){ vec2 uv = acScreenNorm; vec2 p = uv - vec2(cx, cy); p.x *= xAsp(); float b = smoothstep(size, size + falloff, length(p)); vec4 c = xBlur(uv, b * radius * tfK()); gl_FragColor = vec4(c.rgb * (1.0 - b * dark), c.a); }`);
fx3('unsharp', 'Unsharp Mask', 'Blur', 'Sharpens by adding back the difference from a blurred copy.', [S('amount', 'Amount', 1, 0, 5), S('radius', 'Radius', 4, 0.5, 40, 0.5), S('threshold', 'Threshold', 0, 0, 0.5, 0.005)], `
void main(){ vec2 uv = acScreenNorm; vec4 s = tfGet(uv); vec4 b = xBlur(uv, radius * tfK()); vec3 d = s.rgb - b.rgb; gl_FragColor = vec4(clamp(s.rgb + d * amount * step(threshold, length(d)), 0.0, 1.0), s.a); }`);
fx3('lumablur', 'Compound Blur', 'Blur', 'Blurs more where the picture is bright (or dark).', [S('radius', 'Max Blur', 24, 0, 100, 0.5), B('invert', 'Blur the Darks Instead', false)], `
void main(){ vec2 uv = acScreenNorm; float l = tfLum(tfUn(tfGet(uv))); if (invert) l = 1.0 - l; gl_FragColor = xBlur(uv, l * radius * tfK()); }`);
fx3('streak', 'Anamorphic Streak', 'Blur', 'Stretches bright spots into horizontal light streaks.', [S('len', 'Length', 160, 0, 600, 1), S('threshold', 'Threshold', 0.6, 0, 1), S('amount', 'Amount', 1, 0, 4), C('tint', 'Tint', '#FF66AAFF')], `
void main(){ vec2 uv = acScreenNorm; vec4 s = tfGet(uv); vec3 a = vec3(0.0); float px = len * tfK() / acScreenSize.x / 16.0;
  for (int i = -16; i <= 16; i++) { vec4 c = tfGet(uv + vec2(float(i) * px, 0.0)); a += max(c.rgb - threshold, 0.0) * (1.0 - abs(float(i)) / 17.0); }
  gl_FragColor = xAdd(s, a / 6.0 * amount * tint.rgb); }`);
fx3('bokehshape', 'Camera Lens Blur', 'Blur', 'Lens blur with a shaped iris (triangle to octagon) and bright bokeh.',
  [S('radius', 'Radius', 16, 0, 80, 0.5), S('blades', 'Iris Blades', 6, 3, 8, 1), S('turn', 'Iris Rotation°', 0, 0, 360, 1), S('bloom', 'Highlight Boost', 2.5, 0, 8, 0.1), S('threshold', 'Highlight Threshold', 0.7, 0, 1)], `
void main(){ vec2 uv = acScreenNorm; vec2 px = radius * tfK() / acScreenSize; vec4 acc = vec4(0.0); float ws = 0.0; float seg = 6.28318 / blades;
  for (int i = 0; i < 64; i++) { float f = float(i); float rr = sqrt((f + 0.5) / 64.0); float th = f * 2.39996; float k = cos(seg * 0.5) / cos(mod(th + radians(turn), seg) - seg * 0.5);
    vec4 c = tfGet(uv + vec2(cos(th), sin(th)) * rr * k * px); float w = 1.0 + bloom * smoothstep(threshold, 1.0, tfLum(tfUn(c))); acc += c * w; ws += w; }
  gl_FragColor = acc / ws; }`);
fx3('clarity', 'Clarity', 'Blur', 'Punches up mid-tone detail without harsh edges.', [S('amount', 'Amount', 0.6, -1, 3), S('radius', 'Radius', 30, 4, 120, 1)], `
void main(){ vec2 uv = acScreenNorm; vec4 s = tfGet(uv); vec3 c = tfUn(s); vec3 b = tfUn(xBlur(uv, radius * tfK())); float l = tfLum(c); float m = 1.0 - abs(l - 0.5) * 1.6; gl_FragColor = xOut(c + (c - b) * amount * max(m, 0.0), s.a); }`);

// ---- Distort ------------------------------------------------------------------
fx3('wavewarp', 'Wave Warp', 'Distort', 'Bends the picture along moving waves.',
  [L('shape', 'Wave Type', 0, ['Sine', 'Square', 'Triangle']), S('height', 'Wave Height', 2, 0, 20, 0.1), S('waves', 'Waves', 3, 0.2, 40, 0.1), S('angle', 'Direction°', 0, -180, 180, 1), S('speed', 'Speed', 2, -20, 20, 0.1)], `
float wv(float x){ if (shape == 1) return sign(sin(x)); if (shape == 2) return abs(fract(x / 6.28318) - 0.5) * 4.0 - 1.0; return sin(x); }
void main(){ vec2 uv = acScreenNorm; float a = radians(angle); vec2 d = vec2(cos(a), sin(a)); uv += vec2(-d.y, d.x) * wv(dot(uv, d) * 6.28318 * waves + acTime * speed) * height * 0.01; gl_FragColor = tfGetT(uv); }`);
fx3('spherize', 'Spherize', 'Distort', 'Wraps part of the picture over a ball.', [S('amount', 'Amount', 0.7, -1, 1), S('size', 'Size', 0.4, 0.02, 1.5), S('cx', 'Center X', 0.5, 0, 1), S('cy', 'Center Y', 0.5, 0, 1)], `
void main(){ vec2 uv = acScreenNorm; vec2 p = uv - vec2(cx, cy); p.x *= xAsp(); float r = length(p) / size;
  if (r < 1.0 && r > 1e-4) { float nr = amount >= 0.0 ? mix(r, asin(r) / 1.5708, amount) : mix(r, sin(r * 1.5708), -amount); p *= nr / r; } p.x /= xAsp(); gl_FragColor = tfGetT(p + vec2(cx, cy)); }`);
fx3('pinch', 'Pinch / Punch', 'Distort', 'Pulls the picture toward a point, or pushes it out.', [S('amount', 'Amount', 0.5, -0.9, 2), S('size', 'Size', 0.4, 0.02, 1.5), S('cx', 'Center X', 0.5, 0, 1), S('cy', 'Center Y', 0.5, 0, 1)], `
void main(){ vec2 uv = acScreenNorm; vec2 p = uv - vec2(cx, cy); p.x *= xAsp(); float r = length(p) / size; if (r < 1.0) p *= pow(max(r, 1e-4), amount * (1.0 - r)); p.x /= xAsp(); gl_FragColor = tfGetT(p + vec2(cx, cy)); }`);
fx3('lensdist', 'Lens Distortion', 'Distort', 'Barrel or pincushion distortion with optional colour fringing.', [S('amount', 'Distortion', 0.3, -1, 1), S('fringe', 'Colour Fringe', 0.1, 0, 1), S('zoom', 'Zoom', 1, 0.5, 2)], `
vec2 ld(vec2 uv, float k){ vec2 p = uv - 0.5; p.x *= xAsp(); p *= (1.0 + k * dot(p, p)) / zoom; p.x /= xAsp(); return p + 0.5; }
void main(){ vec2 uv = acScreenNorm; vec4 g = tfGetT(ld(uv, amount)); float f = fringe * 0.15; gl_FragColor = vec4(tfGetT(ld(uv, amount + f)).r, g.g, tfGetT(ld(uv, amount - f)).b, g.a); }`);
fx3('offsetfx', 'Offset', 'Distort', 'Shifts the picture and wraps it around the edges.', [S('shiftx', 'Shift X', 0.25, -2, 2), S('shifty', 'Shift Y', 0, -2, 2)], `
void main(){ gl_FragColor = tfGet(fract(acScreenNorm - vec2(shiftx, shifty))); }`);
fx3('cornerpin', 'Corner Pin', 'Distort', 'Moves each corner separately, to fit a screen or a sign.',
  [S('x1', 'Top Left X', 0.1, -0.5, 1.5), S('y1', 'Top Left Y', 0.1, -0.5, 1.5), S('x2', 'Top Right X', 0.9, -0.5, 1.5), S('y2', 'Top Right Y', 0.15, -0.5, 1.5),
   S('x3', 'Bottom Right X', 0.9, -0.5, 1.5), S('y3', 'Bottom Right Y', 0.85, -0.5, 1.5), S('x4', 'Bottom Left X', 0.1, -0.5, 1.5), S('y4', 'Bottom Left Y', 0.9, -0.5, 1.5)], `
float cr(vec2 a, vec2 b){ return a.x * b.y - a.y * b.x; }
void main(){ vec2 p = acScreenNorm; vec2 a = vec2(x1, y1); vec2 b = vec2(x2, y2); vec2 c = vec2(x3, y3); vec2 d = vec2(x4, y4);
  vec2 e = b - a; vec2 f = d - a; vec2 g = a - b + c - d; vec2 hh = p - a; float k2 = cr(g, f); float k1 = cr(e, f) + cr(hh, g); float k0 = cr(hh, e); float u; float v;
  if (abs(k2) < 0.0005) { v = -k0 / k1; u = (hh.x * k1 + f.x * k0) / (e.x * k1 - g.x * k0); }
  else { float w = k1 * k1 - 4.0 * k0 * k2; if (w < 0.0) { gl_FragColor = vec4(0.0); return; } w = sqrt(w); float ik2 = 0.5 / k2; v = (-k1 - w) * ik2; u = (hh.x - f.x * v) / (e.x + g.x * v);
    if (u < 0.0 || u > 1.0 || v < 0.0 || v > 1.0) { v = (-k1 + w) * ik2; u = (hh.x - f.x * v) / (e.x + g.x * v); } }
  gl_FragColor = tfGetT(vec2(u, v)); }`);
fx3('warp', 'Warp', 'Distort', 'Preset bends: arc, flag, wave, fisheye, squeeze and inflate.', [L('style', 'Style', 0, ['Arc', 'Flag', 'Wave', 'Fisheye', 'Squeeze', 'Inflate']), S('amount', 'Bend', 0.5, -1, 1), S('speed', 'Speed', 2, 0, 20, 0.1)], `
void main(){ vec2 uv = acScreenNorm; vec2 p = uv - 0.5; float t = acTime * speed;
  if (style == 0) uv.y += amount * 0.25 * (p.x * p.x * 4.0 - 0.5);
  else if (style == 1) uv.y += sin(uv.x * 6.28318 + t) * amount * 0.08 * uv.x;
  else if (style == 2) { uv.y += sin(uv.x * 9.0 + t) * amount * 0.05; uv.x += sin(uv.y * 7.0 + t * 0.8) * amount * 0.03; }
  else if (style == 3) { float r = length(p) * 2.0; uv = 0.5 + p * mix(1.0, r, amount * 0.6); }
  else if (style == 4) uv.x = 0.5 + p.x * (1.0 + amount * cos(p.y * 3.14159));
  else uv = 0.5 + p * (1.0 - amount * 0.5 * cos(p.x * 3.14159) * cos(p.y * 3.14159));
  gl_FragColor = tfGetT(uv); }`);
fx3('zigzag', 'Zig Zag', 'Distort', 'Pond ripples spreading from a point.', [S('amount', 'Amount', 1, 0, 6), S('ridges', 'Ridges', 6, 1, 40, 0.5), S('size', 'Size', 0.6, 0.05, 2), S('speed', 'Speed', 4, -30, 30, 0.1), S('cx', 'Center X', 0.5, 0, 1), S('cy', 'Center Y', 0.5, 0, 1)], `
void main(){ vec2 uv = acScreenNorm; vec2 p = uv - vec2(cx, cy); p.x *= xAsp(); float r = length(p); float w = sin(r * ridges * 6.28318 - acTime * speed) * amount * 0.02 * smoothstep(size, 0.0, r);
  p += normalize(p + 1e-5) * w; p.x /= xAsp(); gl_FragColor = tfGetT(p + vec2(cx, cy)); }`);
fx3('skew', 'Skew', 'Distort', 'Slants the picture sideways or up and down.', [S('skx', 'Horizontal°', 15, -70, 70, 0.5), S('sky', 'Vertical°', 0, -70, 70, 0.5)], `
void main(){ vec2 uv = acScreenNorm; vec2 p = uv - 0.5; p.x += p.y * tan(radians(skx)); p.y += p.x * tan(radians(sky)); gl_FragColor = tfGetT(p + 0.5); }`);
fx3('tunnel', 'Tunnel', 'Distort', 'Wraps the picture into an endless tunnel.', [S('speed', 'Speed', 0.5, -5, 5), S('repeat', 'Wrap Count', 2, 1, 8, 1), S('depth', 'Depth', 1, 0.2, 4), S('fog', 'Center Fog', 0.6, 0, 1)], `
void main(){ vec2 p = acScreenNorm - 0.5; p.x *= xAsp(); float r = length(p); float a = atan(p.y, p.x); vec2 q = vec2(fract(a / 6.28318 * repeat + 0.5), fract(depth * 0.2 / max(r, 1e-3) + acTime * speed));
  vec4 c = tfGet(q); gl_FragColor = c * mix(1.0, smoothstep(0.0, 0.35, r), fog); }`);
fx3('glassblocks', 'Glass Blocks', 'Distort', 'Looks through a wall of glass bricks.', [S('count', 'Blocks', 10, 2, 60, 1), S('amount', 'Refraction', 0.5, 0, 1)], `
void main(){ vec2 uv = acScreenNorm; vec2 n = vec2(count * xAsp(), count); vec2 g = floor(uv * n); vec2 f = fract(uv * n) - 0.5; gl_FragColor = tfGet((g + 0.5 + f * (1.0 - amount * 1.6)) / n); }`);
fx3('heat', 'Heat Haze', 'Distort', 'Wobbly air, like heat rising off a road.', [S('amount', 'Amount', 1, 0, 6), S('size', 'Size', 14, 1, 80, 0.5), S('speed', 'Speed', 1.5, 0, 10, 0.1)], `
void main(){ vec2 uv = acScreenNorm; vec2 q = uv * size * vec2(xAsp(), 1.0) + vec2(0.0, acTime * speed); gl_FragColor = tfGet(uv + (vec2(tfNoise(q), tfNoise(q + 5.2)) - 0.5) * amount * 0.02); }`);
fx3('frosted', 'Frosted Glass', 'Distort', 'Scatters the picture like frosted glass.', [S('amount', 'Amount', 1, 0, 6), S('grainsize', 'Grain Size', 1, 1, 12, 0.5)], `
void main(){ vec2 uv = acScreenNorm; gl_FragColor = tfGet(uv + (xH2(floor(uv * acScreenSize / (grainsize * tfK()))) - 0.5) * amount * 0.02); }`);
fx3('liquid', 'Liquid Flow', 'Distort', 'Slow, swirling liquid movement.', [S('amount', 'Amount', 1, 0, 6), S('size', 'Size', 3, 0.5, 20, 0.1), S('speed', 'Speed', 0.4, 0, 5)], `
void main(){ vec2 uv = acScreenNorm; vec2 q = uv * size * vec2(xAsp(), 1.0); float t = acTime * speed; vec2 w = vec2(xFbm(q + vec2(t, 0.0)), xFbm(q + vec2(3.1, t))); w = vec2(xFbm(q + w * 2.0 + 1.7), xFbm(q + w * 2.0 + 9.2));
  gl_FragColor = tfGet(uv + (w - 0.5) * amount * 0.06); }`);
fx3('mirrorgrid', 'Mirror Grid', 'Distort', 'Repeats the picture in a mirrored grid.', [S('cols', 'Columns', 2, 1, 8, 1), S('rows', 'Rows', 2, 1, 8, 1)], `
void main(){ vec2 q = acScreenNorm * vec2(cols, rows); vec2 f = fract(q); vec2 i = floor(q); if (mod(i.x, 2.0) > 0.5) f.x = 1.0 - f.x; if (mod(i.y, 2.0) > 0.5) f.y = 1.0 - f.y; gl_FragColor = tfGet(f); }`);
fx3('jello', 'Jello Wobble', 'Distort', 'Rolling-shutter style wobble.', [S('amount', 'Amount', 1, 0, 6), S('freq', 'Tightness', 8, 1, 40, 0.5), S('speed', 'Speed', 6, 0, 30, 0.1)], `
void main(){ vec2 uv = acScreenNorm; uv.x += sin(uv.y * freq + acTime * speed) * amount * 0.01; uv.y += sin(uv.x * freq * 0.7 + acTime * speed * 1.3) * amount * 0.006; gl_FragColor = tfGetT(uv); }`);
fx3('pixelstretch', 'Pixel Stretch', 'Distort', 'Smears one row or column of pixels across the frame.', [L('dir', 'Direction', 0, ['Right', 'Left', 'Down', 'Up']), S('pos', 'Start', 0.5, 0, 1)], `
void main(){ vec2 uv = acScreenNorm; if (dir == 0 && uv.x > pos) uv.x = pos; if (dir == 1 && uv.x < pos) uv.x = pos; if (dir == 2 && uv.y > pos) uv.y = pos; if (dir == 3 && uv.y < pos) uv.y = pos; gl_FragColor = tfGet(uv); }`);

// ---- Stylize ----------------------------------------------------------------
fx3('findedges', 'Find Edges', 'Stylize', 'Draws only the outlines in the picture.', [S('amount', 'Strength', 2, 0, 10, 0.1), S('width', 'Line Width', 1.5, 0.5, 8, 0.1), B('invert', 'White on Black', false), S('blend', 'Blend with Original', 0, 0, 1)], `
void main(){ vec2 uv = acScreenNorm; vec4 s = tfGet(uv); float e = clamp(xSobel(uv, width * tfK()) * amount, 0.0, 1.0); vec3 c = invert ? vec3(e) * s.a : vec3(1.0 - e) * s.a; gl_FragColor = vec4(mix(c, s.rgb, blend), s.a); }`);
fx3('roughen', 'Roughen Edges', 'Stylize', 'Makes the edges of a cutout or text ragged.', [S('amount', 'Amount', 1, 0, 8), S('size', 'Size', 30, 2, 200, 1), S('evolve', 'Evolution', 0, 0, 50, 0.1)], `
void main(){ vec2 uv = acScreenNorm; vec2 q = uv * size * vec2(xAsp(), 1.0) + evolve; gl_FragColor = tfGet(uv + (vec2(xFbm(q), xFbm(q + 9.0)) - 0.5) * amount * 0.03); }`);
fx3('scatter', 'Scatter', 'Stylize', 'Shuffles nearby pixels around.', [S('amount', 'Amount', 12, 0, 100, 1), B('animate', 'Animate', true)], `
void main(){ vec2 uv = acScreenNorm; float t = animate ? floor(acTime * 30.0) : 0.0; gl_FragColor = tfGet(uv + (xH2(floor(uv * acScreenSize) + t * 3.7) - 0.5) * amount * tfK() / acScreenSize); }`);
fx3('brush', 'Brush Strokes', 'Stylize', 'Turns the picture into soft painted strokes.', [S('size', 'Brush Size', 6, 1, 20, 0.5)], `
void main(){ vec2 uv = acScreenNorm; vec2 px = size * tfK() / acScreenSize / 3.0; vec3 m0 = vec3(0.0); vec3 m1 = vec3(0.0); vec3 m2 = vec3(0.0); vec3 m3 = vec3(0.0); vec3 s0 = vec3(0.0); vec3 s1 = vec3(0.0); vec3 s2 = vec3(0.0); vec3 s3 = vec3(0.0);
  for (int j = 0; j <= 3; j++) for (int i = 0; i <= 3; i++) { vec2 o = vec2(float(i), float(j)) * px; vec3 c;
    c = tfGet(uv + vec2(-o.x, -o.y)).rgb; m0 += c; s0 += c * c; c = tfGet(uv + vec2(o.x, -o.y)).rgb; m1 += c; s1 += c * c;
    c = tfGet(uv + vec2(-o.x, o.y)).rgb; m2 += c; s2 += c * c; c = tfGet(uv + o).rgb; m3 += c; s3 += c * c; }
  m0 /= 16.0; m1 /= 16.0; m2 /= 16.0; m3 /= 16.0; float v0 = dot(abs(s0 / 16.0 - m0 * m0), vec3(1.0)); float v1 = dot(abs(s1 / 16.0 - m1 * m1), vec3(1.0)); float v2 = dot(abs(s2 / 16.0 - m2 * m2), vec3(1.0)); float v3 = dot(abs(s3 / 16.0 - m3 * m3), vec3(1.0));
  vec3 r = m0; float mv = v0; if (v1 < mv) { mv = v1; r = m1; } if (v2 < mv) { mv = v2; r = m2; } if (v3 < mv) { r = m3; } gl_FragColor = vec4(r, tfGet(uv).a); }`);
fx3('dither', 'Dither', 'Stylize', 'Old-computer look with a limited palette and a dot pattern.', [S('levels', 'Colour Steps', 3, 1, 16, 1), S('pixel', 'Pixel Size', 3, 1, 24, 1), B('mono', 'Black and White', false)], `
float b2(vec2 a){ a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
float b4(vec2 a){ return b2(0.5 * a) * 0.25 + b2(a); }
void main(){ float px = pixel * tfK(); vec2 g = floor(acScreenNorm * acScreenSize / px); vec4 s = tfGet((g + 0.5) * px / acScreenSize); vec3 c = tfUn(s); if (mono) c = vec3(tfLum(c));
  c = floor(c * levels + b4(g)) / levels; gl_FragColor = xOut(c, s.a); }`);
fx3('ascii', 'ASCII', 'Stylize', 'Rebuilds the picture out of text characters.', [S('size', 'Character Size', 10, 4, 48, 1), B('colored', 'Keep Colours', true), C('ink', 'Ink Colour', '#FF39FF14')], `
float chr(float n, vec2 p){ p = floor(p * vec2(4.0, 4.0) + 2.5); if (clamp(p.x, 0.0, 4.0) == p.x && clamp(p.y, 0.0, 4.0) == p.y) { float k = p.x + 5.0 * p.y; if (mod(floor(n / exp2(k)), 2.0) >= 1.0) return 1.0; } return 0.0; }
void main(){ float px = size * tfK(); vec2 pix = acScreenNorm * acScreenSize; vec2 g = floor(pix / px); vec4 s = tfGet((g + 0.5) * px / acScreenSize); vec3 c = tfUn(s); float l = tfLum(c);
  float n = 4096.0; if (l > 0.2) n = 65600.0; if (l > 0.3) n = 332772.0; if (l > 0.4) n = 15255086.0; if (l > 0.5) n = 15252014.0; if (l > 0.65) n = 13199452.0; if (l > 0.8) n = 11512810.0;
  vec2 p = fract(pix / px) - 0.5; p.y = -p.y; float k = chr(n, p); vec3 col = colored ? c : ink.rgb; gl_FragColor = vec4(col * k * s.a, s.a); }`);
fx3('neonedges', 'Neon Edges', 'Stylize', 'Glowing coloured outlines on black.', [S('amount', 'Glow', 3, 0, 12, 0.1), S('width', 'Line Width', 1.5, 0.5, 8, 0.1), S('hue', 'Hue', 0.5, 0, 1), B('rainbow', 'Rainbow', true), S('keep', 'Keep Original', 0.15, 0, 1)], `
void main(){ vec2 uv = acScreenNorm; vec4 s = tfGet(uv); float e = xSobel(uv, width * tfK()) * amount; vec3 col = xRgb(vec3(fract(hue + (rainbow ? uv.x + uv.y * 0.5 + acTime * 0.15 : 0.0)), 0.9, 1.0));
  gl_FragColor = vec4(clamp(s.rgb * keep + col * e * s.a, 0.0, 1.0), s.a); }`);
fx3('sketch', 'Pencil Sketch', 'Stylize', 'Looks drawn in pencil on paper.', [S('strength', 'Line Strength', 3, 0, 10, 0.1), S('shade', 'Shading', 0.5, 0, 1), C('paper', 'Paper', '#FFF6F0E4')], `
void main(){ vec2 uv = acScreenNorm; vec4 s = tfGet(uv); float e = xSobel(uv, 1.2 * tfK()) * strength; float l = tfLum(tfUn(s)); float hatch = step(l, 0.45 + 0.3 * sin((uv.x + uv.y) * acScreenSize.y * 0.6 / tfK())) * shade * 0.35;
  float v = clamp(1.0 - e - hatch + (tfNoise(uv * acScreenSize * 0.4) - 0.5) * 0.08, 0.0, 1.0); gl_FragColor = xOut(paper.rgb * v, s.a); }`);
fx3('comic', 'Comic Halftone', 'Stylize', 'Flat colours, ink lines and printed dots, like a comic page.', [S('levels', 'Colour Steps', 4, 2, 10, 1), S('dots', 'Dot Size', 7, 3, 30, 0.5), S('ink', 'Ink Lines', 2.5, 0, 8, 0.1)], `
void main(){ vec2 uv = acScreenNorm; vec4 s = tfGet(uv); vec3 c = tfUn(s); float l = tfLum(c); c = floor(c * levels + 0.5) / levels; vec2 p = xRot(uv * acScreenSize / (dots * tfK()), 0.6);
  float d = length(fract(p) - 0.5); c *= mix(1.0, 0.72, step(d, (1.0 - l) * 0.55) * step(l, 0.6)); c *= 1.0 - clamp(xSobel(uv, 1.5 * tfK()) * ink - 0.3, 0.0, 1.0); gl_FragColor = xOut(c, s.a); }`);
fx3('crosshatch', 'Crosshatch', 'Stylize', 'Shades with crossed pen lines.', [S('spacing', 'Line Spacing', 8, 3, 40, 0.5), S('thick', 'Line Width', 1.5, 0.5, 8, 0.1), C('ink', 'Ink', '#FF111111'), C('paper', 'Paper', '#FFFFFFFF')], `
void main(){ vec2 uv = acScreenNorm; vec4 s = tfGet(uv); float l = tfLum(tfUn(s)); vec2 p = uv * acScreenSize / tfK(); float v = 1.0;
  if (l < 0.8 && mod(p.x + p.y, spacing) < thick) v = 0.0; if (l < 0.6 && mod(p.x - p.y, spacing) < thick) v = 0.0; if (l < 0.4 && mod(p.x + p.y - spacing * 0.5, spacing) < thick) v = 0.0; if (l < 0.22 && mod(p.x - p.y - spacing * 0.5, spacing) < thick) v = 0.0;
  gl_FragColor = xOut(mix(ink.rgb, paper.rgb, v), s.a); }`);
fx3('thermal', 'Thermal Camera', 'Stylize', 'Heat-camera colours from dark blue to white.', [S('amount', 'Amount', 1, 0, 1)], `
void main(){ vec4 s = tfGet(acScreenNorm); vec3 c = tfUn(s); float l = tfLum(c); vec3 t = l < 0.25 ? mix(vec3(0.0, 0.0, 0.2), vec3(0.2, 0.0, 0.9), l * 4.0) : l < 0.5 ? mix(vec3(0.2, 0.0, 0.9), vec3(0.95, 0.1, 0.4), (l - 0.25) * 4.0) : l < 0.75 ? mix(vec3(0.95, 0.1, 0.4), vec3(1.0, 0.8, 0.1), (l - 0.5) * 4.0) : mix(vec3(1.0, 0.8, 0.1), vec3(1.0), (l - 0.75) * 4.0);
  gl_FragColor = xOut(mix(c, t, amount), s.a); }`);
fx3('nightvision', 'Night Vision', 'Stylize', 'Green night-vision goggles with grain.', [S('gain', 'Brightness', 1.6, 0.5, 4), S('grainy', 'Grain', 0.25, 0, 1)], `
void main(){ vec2 uv = acScreenNorm; vec4 s = tfGet(uv); float l = tfLum(tfUn(s)) * gain + (tfHash(uv * acScreenSize + floor(acTime * 24.0) * 3.1) - 0.5) * grainy; vec2 p = uv - 0.5;
  l *= smoothstep(0.75, 0.25, length(p)) * (0.9 + 0.1 * sin(uv.y * acScreenSize.y * 1.5)); gl_FragColor = xOut(vec3(0.1, 1.0, 0.25) * l, s.a); }`);
fx3('stained', 'Stained Glass', 'Stylize', 'Breaks the picture into glass cells.', [S('cells', 'Cells', 14, 3, 80, 1), S('lead', 'Lead Lines', 0.5, 0, 1)], `
void main(){ vec2 uv = acScreenNorm; vec2 n = vec2(cells * xAsp(), cells); vec3 v = xVor(uv * n); vec2 cuv = (v.yz + 0.5) / n; vec4 s = tfGet(clamp(cuv, 0.0, 1.0)); gl_FragColor = vec4(s.rgb * (1.0 - smoothstep(0.42, 0.62, v.x) * lead), s.a); }`);
fx3('hexpixel', 'Hex Mosaic', 'Stylize', 'Mosaic made of hexagons.', [S('size', 'Tile Size', 24, 4, 200, 1)], `
vec2 hexc(vec2 p){ vec2 r = vec2(1.0, 1.732); vec2 hf = r * 0.5; vec2 a = mod(p, r) - hf; vec2 b = mod(p - hf, r) - hf; return dot(a, a) < dot(b, b) ? p - a : p - b; }
void main(){ float n = acScreenSize.y / (size * tfK()); vec2 sc = vec2(xAsp(), 1.0) * n; gl_FragColor = tfGet(hexc(acScreenNorm * sc) / sc); }`);
fx3('leddots', 'LED Dots', 'Stylize', 'A wall of round lights.', [S('size', 'Dot Spacing', 14, 4, 80, 1), S('fillamt', 'Dot Fill', 0.8, 0.2, 1), S('glowamt', 'Brightness', 1.3, 0.5, 3)], `
void main(){ float n = acScreenSize.y / (size * tfK()); vec2 n2 = vec2(n * xAsp(), n); vec2 uv = acScreenNorm; vec4 c = tfGet((floor(uv * n2) + 0.5) / n2); float d = length(fract(uv * n2) - 0.5) * 2.0;
  float k = smoothstep(fillamt, fillamt - 0.15, d); gl_FragColor = vec4(clamp(c.rgb * glowamt, 0.0, 1.0) * k, c.a); }`);
fx3('crt', 'CRT Screen', 'Stylize', 'Curved tube TV with scan lines and colour stripes.', [S('curve', 'Curve', 0.15, 0, 0.6), S('lines', 'Scan Lines', 0.35, 0, 1), S('maskamt', 'Colour Stripes', 0.25, 0, 1), S('vig', 'Edge Darkening', 0.4, 0, 1)], `
void main(){ vec2 uv = acScreenNorm; vec2 p = uv * 2.0 - 1.0; p *= 1.0 + curve * dot(p.yx, p.yx) * vec2(0.35, 0.5); uv = p * 0.5 + 0.5; if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  vec4 s = tfGet(uv); vec3 c = s.rgb; c *= 1.0 - lines * (0.5 + 0.5 * sin(uv.y * acScreenSize.y * 3.14159 / tfK() / 1.5)); float m = mod(floor(uv.x * acScreenSize.x / tfK()), 3.0);
  c *= mix(vec3(1.0), m < 0.5 ? vec3(1.2, 0.8, 0.8) : m < 1.5 ? vec3(0.8, 1.2, 0.8) : vec3(0.8, 0.8, 1.2), maskamt); c *= 1.0 - vig * pow(length(p) * 0.75, 3.0); gl_FragColor = vec4(c, s.a); }`);
fx3('blueprint', 'Blueprint', 'Stylize', 'White technical lines on blue paper with a grid.', [S('amount', 'Line Strength', 3, 0, 10, 0.1), S('grid', 'Grid Size', 60, 10, 300, 1)], `
void main(){ vec2 uv = acScreenNorm; vec4 s = tfGet(uv); float e = clamp(xSobel(uv, 1.5 * tfK()) * amount, 0.0, 1.0); vec2 g = abs(fract(uv * acScreenSize / (grid * tfK())) - 0.5);
  float gl = smoothstep(0.49, 0.5, max(g.x, g.y)) * 0.25; gl_FragColor = xOut(vec3(0.05, 0.25, 0.6) + vec3(e + gl), s.a); }`);
fx3('popart', 'Pop Art', 'Stylize', 'Four bold colour panels of the same picture.', [S('levels', 'Colour Steps', 3, 2, 8, 1)], `
void main(){ vec2 q = acScreenNorm * 2.0; vec2 i = floor(q); vec4 s = tfGet(fract(q)); float l = floor(tfLum(tfUn(s)) * levels + 0.5) / levels; float id = i.x + i.y * 2.0;
  vec3 a = id < 0.5 ? vec3(1.0, 0.1, 0.45) : id < 1.5 ? vec3(0.1, 0.75, 1.0) : id < 2.5 ? vec3(1.0, 0.85, 0.1) : vec3(0.3, 0.95, 0.4); vec3 b = id < 0.5 ? vec3(0.1, 0.1, 0.5) : id < 1.5 ? vec3(0.45, 0.0, 0.4) : id < 2.5 ? vec3(0.8, 0.1, 0.1) : vec3(0.05, 0.15, 0.4);
  gl_FragColor = xOut(mix(b, a, l), s.a); }`);
fx3('solarize', 'Solarize', 'Stylize', 'Flips the bright tones, like a darkroom accident.', [S('threshold', 'Threshold', 0.5, 0, 1), S('amount', 'Amount', 1, 0, 1)], `
void main(){ vec4 s = tfGet(acScreenNorm); vec3 c = tfUn(s); vec3 r = mix(c, 1.0 - c, step(vec3(threshold), c)); gl_FragColor = xOut(mix(c, r, amount), s.a); }`);
fx3('engrave', 'Engraving', 'Stylize', 'Banknote-style lines that thicken in the shadows.', [S('density', 'Line Count', 120, 20, 400, 1), S('angle', 'Angle°', 35, -90, 90, 1), C('ink', 'Ink', '#FF1B2A1F'), C('paper', 'Paper', '#FFEFE9D6')], `
void main(){ vec2 uv = acScreenNorm; vec4 s = tfGet(uv); float l = tfLum(tfUn(s)); vec2 p = xRot((uv - 0.5) * vec2(xAsp(), 1.0), radians(angle)); float w = 0.5 + 0.5 * sin(p.y * density * 3.14159 + sin(p.x * 20.0) * 0.6);
  gl_FragColor = xOut(mix(paper.rgb, ink.rgb, smoothstep(l - 0.08, l + 0.08, w)), s.a); }`);

// ---- Colour -----------------------------------------------------------------
fx3('colorama', 'Colorama', 'Color', 'Maps brightness onto a cycling rainbow.', [S('cycles', 'Cycles', 1, 0.1, 10, 0.1), S('phase', 'Phase', 0, 0, 1), S('speed', 'Cycle Speed', 0, -5, 5), S('satur', 'Saturation', 0.9, 0, 1), S('amount', 'Amount', 1, 0, 1)], `
void main(){ vec4 s = tfGet(acScreenNorm); vec3 c = tfUn(s); gl_FragColor = xOut(mix(c, xRgb(vec3(fract(tfLum(c) * cycles + phase + acTime * speed), satur, 1.0)), amount), s.a); }`);
fx3('changecolor', 'Change to Color', 'Color', 'Swaps one colour for another and leaves the rest alone.', [C('fromc', 'Colour to Change', '#FFFF0000'), C('toc', 'New Colour', '#FF0066FF'), S('tol', 'Tolerance', 0.08, 0, 0.5, 0.005), S('soft', 'Softness', 0.06, 0, 0.5, 0.005)], `
void main(){ vec4 s = tfGet(acScreenNorm); vec3 c = tfUn(s); vec3 hc = xHsv(c); float d = abs(fract(hc.x - xHsv(fromc.rgb).x + 0.5) - 0.5); float k = smoothstep(tol + soft, tol, d) * smoothstep(0.05, 0.25, hc.y);
  vec3 ht = xHsv(toc.rgb); gl_FragColor = xOut(mix(c, xRgb(vec3(ht.x, hc.y * mix(1.0, ht.y / max(xHsv(fromc.rgb).y, 0.05), 0.5), hc.z)), k), s.a); }`);
fx3('leavecolor', 'Leave Color', 'Color', 'Keeps one colour and turns everything else grey.', [C('keep', 'Colour to Keep', '#FFFF0000'), S('tol', 'Tolerance', 0.06, 0, 0.5, 0.005), S('soft', 'Softness', 0.05, 0, 0.5, 0.005), S('amount', 'Amount', 1, 0, 1)], `
void main(){ vec4 s = tfGet(acScreenNorm); vec3 c = tfUn(s); vec3 hc = xHsv(c); float d = abs(fract(hc.x - xHsv(keep.rgb).x + 0.5) - 0.5); float k = smoothstep(tol + soft, tol, d) * smoothstep(0.08, 0.3, hc.y);
  gl_FragColor = xOut(mix(c, vec3(tfLum(c)), amount * (1.0 - k)), s.a); }`);
fx3('photofilter', 'Photo Filter', 'Color', 'A coloured lens filter over the shot.', [C('tintc', 'Filter Colour', '#FFEC8A00'), S('density', 'Density', 0.25, 0, 1), B('keepl', 'Keep Brightness', true)], `
void main(){ vec4 s = tfGet(acScreenNorm); vec3 c = tfUn(s); vec3 r = c * mix(vec3(1.0), tintc.rgb, density); if (keepl) r *= tfLum(c) / max(tfLum(r), 1e-4); gl_FragColor = xOut(r, s.a); }`);
fx3('channelmixer', 'Channel Mixer', 'Color', 'Builds each colour channel from a mix of all three.',
  [S('rr', 'Red from Red', 1, -2, 2), S('rg', 'Red from Green', 0, -2, 2), S('rb', 'Red from Blue', 0, -2, 2), S('gr', 'Green from Red', 0, -2, 2), S('gg', 'Green from Green', 1, -2, 2), S('gb', 'Green from Blue', 0, -2, 2),
   S('br', 'Blue from Red', 0, -2, 2), S('bg', 'Blue from Green', 0, -2, 2), S('bb', 'Blue from Blue', 1, -2, 2)], `
void main(){ vec4 s = tfGet(acScreenNorm); vec3 c = tfUn(s); gl_FragColor = xOut(vec3(dot(c, vec3(rr, rg, rb)), dot(c, vec3(gr, gg, gb)), dot(c, vec3(br, bg, bb))), s.a); }`);
fx3('colorwheels', 'Color Wheels', 'Color', 'Separate tints for shadows, mid-tones and highlights.', [C('sh', 'Shadows', '#FF808080'), C('md', 'Mid-tones', '#FF808080'), C('hi', 'Highlights', '#FF808080'), S('amount', 'Strength', 1, 0, 3)], `
void main(){ vec4 s = tfGet(acScreenNorm); vec3 c = tfUn(s); float l = tfLum(c); float ws = 1.0 - smoothstep(0.0, 0.5, l); float wh = smoothstep(0.5, 1.0, l); float wm = 1.0 - ws - wh;
  c += ((sh.rgb - 0.5) * ws + (md.rgb - 0.5) * wm + (hi.rgb - 0.5) * wh) * amount; gl_FragColor = xOut(c, s.a); }`);
fx3('grade', 'Grade Panel', 'Color', 'The main colour controls in one place.',
  [S('expo', 'Exposure', 0, -3, 3), S('contr', 'Contrast', 0, -1, 1), S('highs', 'Highlights', 0, -1, 1), S('shads', 'Shadows', 0, -1, 1), S('whites', 'Whites', 0, -1, 1), S('blacks', 'Blacks', 0, -1, 1),
   S('temp', 'Temperature', 0, -1, 1), S('tintgm', 'Tint', 0, -1, 1), S('vib', 'Vibrance', 0, -1, 1), S('satur', 'Saturation', 0, -1, 1)], `
void main(){ vec4 s = tfGet(acScreenNorm); vec3 c = tfUn(s) * exp2(expo); c.r *= 1.0 + temp * 0.2; c.b *= 1.0 - temp * 0.2; c.g *= 1.0 - tintgm * 0.15; float l = tfLum(c);
  float lc = clamp(l, 0.0, 1.0); c += shads * 0.35 * pow(1.0 - lc, 3.0) + highs * 0.35 * pow(lc, 3.0); c += blacks * 0.15 * (1.0 - c); c *= 1.0 + whites * 0.3;
  c = (c - 0.5) * (1.0 + contr) + 0.5; l = tfLum(c); float sat = max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b); c = mix(vec3(l), c, (1.0 + satur) * (1.0 + vib * (1.0 - clamp(sat, 0.0, 1.0)))); gl_FragColor = xOut(c, s.a); }`);
fx3('bwmix', 'Black & White Mixer', 'Color', 'Black and white where each colour gets its own brightness.', [S('wr', 'Reds', 0.4, -1, 2), S('wg', 'Greens', 0.4, -1, 2), S('wb', 'Blues', 0.2, -1, 2), C('tintc', 'Tint', '#FFFFFFFF')], `
void main(){ vec4 s = tfGet(acScreenNorm); gl_FragColor = xOut(vec3(dot(tfUn(s), vec3(wr, wg, wb))) * tintc.rgb, s.a); }`);
fx3('splittone', 'Split Toning', 'Color', 'One colour in the shadows and another in the highlights.', [C('sh', 'Shadow Colour', '#FF1D4E89'), C('hi', 'Highlight Colour', '#FFFFB347'), S('balance', 'Balance', 0, -1, 1), S('amount', 'Amount', 0.4, 0, 1)], `
void main(){ vec4 s = tfGet(acScreenNorm); vec3 c = tfUn(s); float l = clamp(tfLum(c) + balance * 0.5, 0.0, 1.0); vec3 t = mix(sh.rgb, hi.rgb, l); vec3 r = mix(2.0 * c * t, 1.0 - 2.0 * (1.0 - c) * (1.0 - t), step(0.5, c)); gl_FragColor = xOut(mix(c, r, amount), s.a); }`);
fx3('fadedfilm', 'Faded Film', 'Color', 'Lifted blacks and soft colour, like an old print.', [S('amount', 'Fade', 0.5, 0, 1), S('desat', 'Wash Out Colour', 0.25, 0, 1)], `
void main(){ vec4 s = tfGet(acScreenNorm); vec3 c = tfUn(s); c = c * (1.0 - amount * 0.25) + amount * 0.13; c = mix(c, vec3(tfLum(c)), desat); gl_FragColor = xOut(c, s.a); }`);
fx3('bleach', 'Bleach Bypass', 'Color', 'Hard contrast with thin colour, like a war film.', [S('amount', 'Amount', 0.8, 0, 1)], `
void main(){ vec4 s = tfGet(acScreenNorm); vec3 c = tfUn(s); vec3 l = vec3(tfLum(c)); vec3 o = mix(2.0 * c * l, 1.0 - 2.0 * (1.0 - c) * (1.0 - l), step(0.5, l)); gl_FragColor = xOut(mix(c, o, amount), s.a); }`);
fx3('crossprocess', 'Cross Process', 'Color', 'Shifted greens and yellows from film developed the wrong way.', [S('amount', 'Amount', 0.8, 0, 1)], `
void main(){ vec4 s = tfGet(acScreenNorm); vec3 c = tfUn(s); vec3 r = vec3(pow(c.r, 0.8) * 1.05, smoothstep(0.0, 1.0, c.g), c.b * 0.7 + 0.15); gl_FragColor = xOut(mix(c, r, amount), s.a); }`);
fx3('shadhigh', 'Shadows / Highlights', 'Color', 'Opens up dark areas and pulls back bright ones.', [S('shads', 'Lift Shadows', 0.4, -1, 1), S('highs', 'Recover Highlights', 0.3, -1, 1)], `
void main(){ vec4 s = tfGet(acScreenNorm); vec3 c = tfUn(s); float l = tfLum(c); c += shads * 0.5 * pow(1.0 - l, 3.0) * (1.0 - c); c -= highs * 0.5 * pow(l, 3.0) * c; gl_FragColor = xOut(c, s.a); }`);
fx3('huecycle', 'Hue Cycle', 'Color', 'Spins every colour around the wheel over time.', [S('speed', 'Speed', 0.3, -5, 5), S('shift', 'Start Shift', 0, 0, 1)], `
void main(){ vec4 s = tfGet(acScreenNorm); vec3 hc = xHsv(tfUn(s)); hc.x = fract(hc.x + acTime * speed + shift); gl_FragColor = xOut(xRgb(hc), s.a); }`);
fx3('autoenhance', 'Auto Enhance', 'Color', 'Stretches the picture between its darkest and brightest points. The Auto Enhance button sets these for you.', [S('black', 'Black Point', 0, 0, 0.9, 0.005), S('white', 'White Point', 1, 0.1, 1, 0.005), S('gam', 'Mid-tone Brightness', 1, 0.3, 3), S('satur', 'Colour', 1, 0, 2)], `
void main(){ vec4 s = tfGet(acScreenNorm); vec3 c = clamp((tfUn(s) - black) / max(white - black, 0.01), 0.0, 1.0); c = pow(c, vec3(1.0 / gam)); c = mix(vec3(tfLum(c)), c, satur); gl_FragColor = xOut(c, s.a); }`);
fx3('whitebalance', 'White Balance', 'Color', 'Pick something that should be white or grey, and the cast is removed.', [C('neutral', 'Should Be Neutral', '#FFD8D0C0'), S('amount', 'Amount', 1, 0, 1)], `
void main(){ vec4 s = tfGet(acScreenNorm); vec3 c = tfUn(s); float g = (neutral.r + neutral.g + neutral.b) / 3.0; gl_FragColor = xOut(mix(c, c * g / max(neutral.rgb, vec3(0.02)), amount), s.a); }`);
fx3('gammagain', 'Gamma / Pedestal / Gain', 'Color', 'Three classic brightness controls.', [S('gam', 'Gamma', 1, 0.2, 4), S('pedestal', 'Pedestal', 0, -0.5, 0.5, 0.005), S('gain', 'Gain', 1, 0, 4)], `
void main(){ vec4 s = tfGet(acScreenNorm); gl_FragColor = xOut(pow(clamp(tfUn(s) * gain + pedestal, 0.0, 1.0), vec3(1.0 / gam)), s.a); }`);
fx3('sepia', 'Sepia', 'Color', 'Warm brown antique tone.', [S('amount', 'Amount', 1, 0, 1)], `
void main(){ vec4 s = tfGet(acScreenNorm); vec3 c = tfUn(s); vec3 r = vec3(dot(c, vec3(0.393, 0.769, 0.189)), dot(c, vec3(0.349, 0.686, 0.168)), dot(c, vec3(0.272, 0.534, 0.131))); gl_FragColor = xOut(mix(c, r, amount), s.a); }`);
fx3('technicolor', 'Two-Strip Colour', 'Color', 'Red and teal only, like very early colour film.', [S('amount', 'Amount', 1, 0, 1)], `
void main(){ vec4 s = tfGet(acScreenNorm); vec3 c = tfUn(s); float gb = (c.g + c.b) * 0.5; gl_FragColor = xOut(mix(c, vec3(c.r, gb, gb), amount), s.a); }`);
fx3('dehaze', 'Dehaze', 'Color', 'Cuts through fog or flat, milky footage.', [S('amount', 'Amount', 0.3, 0, 0.9), C('haze', 'Haze Colour', '#FFC8D2DC')], `
void main(){ vec4 s = tfGet(acScreenNorm); gl_FragColor = xOut((tfUn(s) - haze.rgb * amount) / (1.0 - amount), s.a); }`);

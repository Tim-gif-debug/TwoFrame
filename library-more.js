// ===========================================================================
// More built-in effects (After Effects style library).
// Every parameter is keyframeable because effect params are ordinary
// properties under the path fx.<effect id>.<param>.
// Extra values available to these shaders:
//   acLocalTime  seconds since the clip started
//   acDuration   clip length in seconds
//   acVelocity   how far the layer moved since the last frame, in pixels
//   acLut/acLutSize  the loaded .cube LUT (LUT effect only)
// ===========================================================================

// ---- Blur ---------------------------------------------------------------
fx('motionblur', 'Motion Blur', 'Blur', 'Blurs along the direction the layer is moving, frame to frame.',
  [S('shutter', 'Shutter Amount', 1, 0, 4, 0.05), S('extra', 'Extra Length', 0, 0, 200, 1), S('angle', 'Extra Angle', 0, -180, 180, 1)], `
void main(){ vec2 uv = acScreenNorm; vec2 v = acVelocity * shutter + vec2(cos(radians(angle)), sin(radians(angle))) * extra * tfK();
  vec2 d = v / acScreenSize; vec4 acc = vec4(0.0);
  for (int i = 0; i < 32; i++) { float t = float(i) / 31.0 - 0.5; acc += tfGet(uv - d * t); }
  gl_FragColor = acc / 32.0; }`);

fx('lensblur', 'Lens Blur (Bokeh)', 'Blur', 'Camera-style blur where bright spots become round bokeh discs.',
  [S('radius', 'Radius', 14, 0, 80, 0.5), S('bloom', 'Highlight Boost', 2, 0, 8, 0.1), S('threshold', 'Highlight Threshold', 0.7, 0, 1)], `
void main(){ vec2 uv = acScreenNorm; vec2 px = 1.0 / acScreenSize; float r = radius * tfK();
  if (r < 0.5) { gl_FragColor = tfGet(uv); return; }
  vec4 acc = vec4(0.0); float ws = 0.0;
  for (int i = 0; i < 80; i++) { float fi = float(i); float rr = sqrt((fi + 0.5) / 80.0); float th = fi * 2.39996;
    vec4 c = tfGet(uv + vec2(cos(th), sin(th)) * rr * r * px);
    float w = 1.0 + bloom * smoothstep(threshold, 1.0, tfLum(tfUn(c))); acc += c * w; ws += w; }
  gl_FragColor = acc / ws; }`);

// ---- Distort --------------------------------------------------------------
fx('turbulent', 'Turbulent Displace', 'Distort', 'Wobbly, smoky displacement driven by noise.',
  [S('amount', 'Amount', 20, 0, 200, 0.5), S('size', 'Size', 6, 0.5, 40, 0.1), S('evolution', 'Evolution Speed', 0.5, 0, 5, 0.01), S('seed', 'Seed', 1, 0, 100, 1)], `
void main(){ vec2 uv = acScreenNorm; vec2 p = uv * size * vec2(acScreenSize.x / acScreenSize.y, 1.0); float t = acTime * evolution + seed * 3.1;
  vec2 n = vec2(tfNoise(p + t) + 0.5 * tfNoise(p * 2.0 - t), tfNoise(p + 17.3 - t) + 0.5 * tfNoise(p * 2.0 + 9.1 + t)) / 1.5 - 0.5;
  gl_FragColor = tfGetT(uv + n * 2.0 * amount * tfK() / acScreenSize); }`);

fx('polar', 'Polar Coordinates', 'Distort', 'Wraps the image into a circle, or unwraps a circle.',
  [L('mode', 'Type', 0, ['Rectangular to Polar', 'Polar to Rectangular']), S('amount', 'Amount', 1, 0, 1)], `
void main(){ vec2 uv = acScreenNorm; vec2 q;
  if (mode == 0) { vec2 c = uv - 0.5; float a = atan(c.y, c.x) / 6.28318 + 0.5; float r = length(c) * 2.0; q = vec2(a, r); }
  else { float a = (uv.x - 0.5) * 6.28318; float r = uv.y * 0.5; q = 0.5 + vec2(cos(a), sin(a)) * r; }
  gl_FragColor = tfGetT(mix(uv, q, amount)); }`);

fx('displace', 'Displacement Map', 'Distort', 'Pushes pixels using the layer’s own brightness, or a noise map.',
  [L('source', 'Map', 0, ['Layer brightness', 'Noise']), S('amountX', 'Horizontal', 20, -200, 200, 0.5), S('amountY', 'Vertical', 20, -200, 200, 0.5), S('scale', 'Noise Size', 4, 0.5, 40, 0.1)], `
void main(){ vec2 uv = acScreenNorm; float m;
  if (source == 0) m = tfLum(tfGet(uv).rgb) - 0.5; else m = tfNoise(uv * scale * vec2(acScreenSize.x / acScreenSize.y, 1.0)) - 0.5;
  gl_FragColor = tfGetT(uv + vec2(amountX, amountY) * m * 2.0 * tfK() / acScreenSize); }`);

fx('bend', 'Warp / Bend', 'Distort', 'Bends the image into an arc.',
  [S('bendV', 'Bend', 0.3, -1, 1), L('axis', 'Direction', 0, ['Horizontal', 'Vertical'])], `
void main(){ vec2 uv = acScreenNorm; vec2 q = uv;
  if (axis == 0) q.y += bendV * (pow((uv.x - 0.5) * 2.0, 2.0) - 0.33) * 0.25; else q.x += bendV * (pow((uv.y - 0.5) * 2.0, 2.0) - 0.33) * 0.25;
  gl_FragColor = tfGetT(q); }`);

fx('perspective', '3D Tilt', 'Distort', 'Tilts the image back or sideways like a card in 3D space.',
  [S('tiltX', 'Tilt X°', 20, -80, 80, 0.5), S('tiltY', 'Tilt Y°', 0, -80, 80, 0.5), S('zoomV', 'Zoom', 1, 0.3, 3)], `
void main(){ vec2 uv = acScreenNorm; float asp = acScreenSize.x / acScreenSize.y; vec2 p = (uv - 0.5) * 2.0; p.x *= asp;
  float ax = radians(tiltX), ay = radians(tiltY); float f = 2.0;
  vec3 o = vec3(0.0, 0.0, -f); vec3 d = normalize(vec3(p / zoomV, f));
  mat3 rx = mat3(1.0, 0.0, 0.0, 0.0, cos(ax), sin(ax), 0.0, -sin(ax), cos(ax));
  mat3 ry = mat3(cos(ay), 0.0, -sin(ay), 0.0, 1.0, 0.0, sin(ay), 0.0, cos(ay));
  mat3 R = rx * ry; vec3 n = R * vec3(0.0, 0.0, 1.0); float dn = dot(d, n);
  if (abs(dn) < 1e-4) { gl_FragColor = vec4(0.0); return; }
  float t = -dot(o, n) / dn; if (t <= 0.0) { gl_FragColor = vec4(0.0); return; }
  vec3 hit = o + d * t;
  mat3 Rt = mat3(R[0][0], R[1][0], R[2][0], R[0][1], R[1][1], R[2][1], R[0][2], R[1][2], R[2][2]);
  vec2 q = (Rt * hit).xy; q.x /= asp; gl_FragColor = tfGetT(q * 0.5 + 0.5); }`);

// ---- Stylize --------------------------------------------------------------
fx('deepglow', 'Deep Glow', 'Light', 'Layered glow with a long, soft falloff, for neon and light trails.',
  [S('threshold', 'Threshold', 0.4, 0, 1), S('radius', 'Radius', 60, 4, 300, 1), S('intensity', 'Intensity', 1.5, 0, 6), C('tintC', 'Color', '#FFFFFFFF'), S('saturation', 'Glow Saturation', 1, 0, 2)], `
void main(){ vec2 uv = acScreenNorm; vec2 px = 1.0 / acScreenSize; vec4 s = tfGet(uv); vec3 acc = vec3(0.0); float aa = 0.0;
  for (int L = 0; L < 4; L++) { float rl = radius * tfK() * pow(0.45, float(3 - L)); vec3 a = vec3(0.0); float ws = 0.0; float al = 0.0;
    for (int i = 0; i < 24; i++) { float fi = float(i); float rr = sqrt((fi + 0.5) / 24.0); float th = fi * 2.39996 + float(L);
      vec4 c = tfGet(uv + vec2(cos(th), sin(th)) * rr * rl * px); float k = smoothstep(threshold, threshold + 0.2, tfLum(tfUn(c))) * c.a;
      a += tfUn(c) * k; al += k; ws += 1.0; }
    acc += a / ws; aa += al / ws; }
  vec3 g = acc * 0.35 * intensity * tintC.rgb; float l = tfLum(g); g = mix(vec3(l), g, saturation);
  gl_FragColor = vec4(s.rgb + g, max(s.a, clamp(aa * 0.35 * intensity, 0.0, 1.0))); }`);

fx('chroma', 'Chromatic Aberration', 'Stylize', 'Colour fringes that grow toward the edges, like a cheap lens.',
  [S('amount', 'Amount', 6, 0, 60, 0.1), S('cx', 'Center X', 0.5, 0, 1), S('cy', 'Center Y', 0.5, 0, 1)], `
void main(){ vec2 uv = acScreenNorm; vec2 d = (uv - vec2(cx, cy)) * amount * tfK() / acScreenSize.y;
  vec4 r = tfGet(uv + d), g = tfGet(uv), b = tfGet(uv - d); gl_FragColor = vec4(r.r, g.g, b.b, max(g.a, max(r.a, b.a))); }`);

fx('cartoon', 'Cartoon', 'Stylize', 'Flat colours with dark outlines, like a cel-shaded cartoon.',
  [S('levels', 'Colour Levels', 6, 2, 16, 1), S('edge', 'Edge Strength', 2, 0, 8, 0.1), S('smoothing', 'Smoothing', 2, 0, 6, 0.1)], `
void main(){ vec2 uv = acScreenNorm; vec2 px = smoothing * tfK() / acScreenSize; vec4 s = tfGet(uv);
  vec4 b = (s * 4.0 + tfGet(uv + vec2(px.x, 0.0)) + tfGet(uv - vec2(px.x, 0.0)) + tfGet(uv + vec2(0.0, px.y)) + tfGet(uv - vec2(0.0, px.y))) / 8.0;
  vec3 c = tfUn(b); float n = levels - 1.0; c = floor(c * n + 0.5) / n;
  vec2 q = tfK() / acScreenSize; float gx = tfLum(tfGet(uv + vec2(q.x, 0.0)).rgb) - tfLum(tfGet(uv - vec2(q.x, 0.0)).rgb);
  float gy = tfLum(tfGet(uv + vec2(0.0, q.y)).rgb) - tfLum(tfGet(uv - vec2(0.0, q.y)).rgb);
  float e = clamp(length(vec2(gx, gy)) * edge * 2.0, 0.0, 1.0); c = mix(c, vec3(0.03), e); gl_FragColor = vec4(c * s.a, s.a); }`);

fx('datamosh', 'Datamosh', 'Glitch', 'Smeared, broken-compression look with blocks that drag across the frame.',
  [S('amount', 'Amount', 0.5, 0, 1), S('blockSize', 'Block Size', 24, 4, 120, 1), S('speed', 'Speed', 6, 0, 30, 0.5), S('seed', 'Seed', 1, 0, 100, 1)], `
void main(){ vec2 uv = acScreenNorm; vec2 bs = vec2(blockSize * tfK()) / acScreenSize; vec2 cell = floor(uv / bs); float t = floor(acTime * speed) + seed * 9.0;
  float r = tfHash(cell + t); vec2 drag = vec2(tfHash(cell + t + 3.0) - 0.5, tfHash(cell + t + 7.0) - 0.5) * bs * 6.0 * amount;
  vec2 q = r < amount ? (cell + 0.5) * bs + drag : uv; vec4 c = tfGet(q);
  if (r < amount * 0.3) c.rgb = c.gbr; gl_FragColor = c; }`);

fx('strobe', 'Strobe', 'Time', 'Flashes the layer on and off, or flashes a colour.',
  [S('rate', 'Flashes per Second', 6, 0.5, 30, 0.1), S('duty', 'On Fraction', 0.5, 0.05, 0.95), L('mode', 'Mode', 0, ['Hide layer', 'Flash colour']), C('flashC', 'Flash Colour', '#FFFFFFFF')], `
void main(){ vec4 s = tfGet(acScreenNorm); float on = step(fract(acLocalTime * rate), duty);
  if (mode == 0) gl_FragColor = s * on; else gl_FragColor = mix(s, vec4(flashC.rgb, 1.0), 1.0 - on); }`);

// ---- Light ----------------------------------------------------------------
fx('flare', 'Lens Flare', 'Light', 'A bright light source with a halo, streak and ghosts across the frame.',
  [S('lx', 'Light X', 0.25, -0.5, 1.5), S('ly', 'Light Y', 0.25, -0.5, 1.5), S('intensity', 'Intensity', 1, 0, 4), C('flareC', 'Colour', '#FFFFD9A0'), S('streak', 'Streak', 0.6, 0, 2)], `
void main(){ vec2 uv = acScreenNorm; vec4 s = tfGet(uv); vec2 asp = vec2(acScreenSize.x / acScreenSize.y, 1.0);
  vec2 L = vec2(lx, ly); vec2 d = (uv - L) * asp; float r = length(d);
  float core = exp(-r * 18.0) * 2.0 + exp(-r * 4.0) * 0.4; float halo = exp(-pow((r - 0.18) * 30.0, 2.0)) * 0.25;
  float st = exp(-abs(d.y) * 120.0) * exp(-abs(d.x) * 2.5) * streak;
  vec3 col = flareC.rgb * (core + halo + st);
  for (int i = 1; i <= 4; i++) { float k = float(i) * 0.35; vec2 g = mix(L, vec2(0.5), 1.0 + k); float gr = length((uv - g) * asp);
    col += flareC.rgb * vec3(0.6, 0.8, 1.0) * exp(-pow(gr * (10.0 + float(i) * 6.0), 2.0)) * 0.25; }
  col *= intensity; gl_FragColor = vec4(s.rgb + col * (s.a + (1.0 - s.a)), max(s.a, clamp(tfLum(col), 0.0, 1.0))); }`);

fx('flicker', 'Flicker', 'Light', 'Random brightness flicker, like an old bulb or film.',
  [S('amount', 'Amount', 0.3, 0, 1), S('speed', 'Speed', 12, 1, 60, 0.5), S('seed', 'Seed', 1, 0, 100, 1)], `
void main(){ vec4 s = tfGet(acScreenNorm); float f = tfNoise(vec2(acTime * speed, seed)); gl_FragColor = vec4(s.rgb * (1.0 - amount + amount * 2.0 * f), s.a); }`);

// ---- Motion (all timed from the clip start) ----------------------------------
fx('autoshake', 'Auto Shake', 'Motion', 'Camera shake presets. Pick a style and strength.',
  [L('style', 'Style', 1, ['Gentle', 'Handheld', 'Earthquake', 'Impact hit', 'Drunk']), S('strength', 'Strength', 1, 0, 3, 0.01), S('seed', 'Seed', 1, 0, 100, 1)], `
void main(){ vec2 uv = acScreenNorm; float t = acLocalTime; float amp = 0.004, rot = 0.3, sp = 2.0;
  if (style == 1) { amp = 0.012; rot = 1.0; sp = 5.0; } else if (style == 2) { amp = 0.03; rot = 2.5; sp = 18.0; }
  else if (style == 3) { float k = exp(-t * 6.0); amp = 0.05 * k; rot = 3.0 * k; sp = 25.0; } else if (style == 4) { amp = 0.02; rot = 4.0; sp = 0.8; }
  amp *= strength; rot *= strength; float s2 = t * sp + seed * 13.0;
  vec2 o = (vec2(tfNoise(vec2(s2, 1.3)), tfNoise(vec2(s2, 7.7))) - 0.5) * 2.0 * amp; float a = radians((tfNoise(vec2(s2, 4.4)) - 0.5) * 2.0 * rot);
  vec2 asp = vec2(acScreenSize.x / acScreenSize.y, 1.0); vec2 p = (uv - 0.5) * asp / (1.0 + amp * 3.0);
  p = vec2(p.x * cos(a) - p.y * sin(a), p.x * sin(a) + p.y * cos(a)); gl_FragColor = tfGet(p / asp + 0.5 + o); }`);

fx('zoompunch', 'Zoom Punch', 'Motion', 'A quick zoom hit, at the clip start or repeating on a beat.',
  [S('amount', 'Zoom Amount', 0.25, 0, 1.5), S('plen', 'Length (s)', 0.35, 0.05, 2, 0.01), S('every', 'Repeat Every (s, 0 = once)', 0, 0, 10, 0.05)], `
void main(){ vec2 uv = acScreenNorm; float t = every > 0.0 ? mod(acLocalTime, every) : acLocalTime;
  float k = t < plen ? 1.0 - t / plen : 0.0; k = k * k; float z = 1.0 + amount * k; gl_FragColor = tfGet((uv - 0.5) / z + 0.5); }`);

fx('swing', 'Swing', 'Motion', 'Rocks the frame back and forth like a pendulum.',
  [S('angle', 'Angle°', 6, 0, 45, 0.1), S('speed', 'Swings per Second', 1, 0.05, 6, 0.01), S('pivotY', 'Pivot Height', 0, -1, 1, 0.01)], `
void main(){ vec2 uv = acScreenNorm; vec2 asp = vec2(acScreenSize.x / acScreenSize.y, 1.0); vec2 pv = vec2(0.5, 0.5 + pivotY * 0.5);
  float a = radians(angle) * sin(acLocalTime * speed * 6.28318); vec2 p = (uv - pv) * asp;
  p = vec2(p.x * cos(a) - p.y * sin(a), p.x * sin(a) + p.y * cos(a)); gl_FragColor = tfGetT(p / asp + pv); }`);

fx('spin', 'Spin', 'Motion', 'Rotates the frame continuously.',
  [S('rps', 'Turns per Second', 0.25, -5, 5, 0.01), S('zoomV', 'Zoom', 1.4, 1, 3, 0.01)], `
void main(){ vec2 uv = acScreenNorm; vec2 asp = vec2(acScreenSize.x / acScreenSize.y, 1.0); float a = acLocalTime * rps * 6.28318;
  vec2 p = (uv - 0.5) * asp / zoomV; p = vec2(p.x * cos(a) - p.y * sin(a), p.x * sin(a) + p.y * cos(a)); gl_FragColor = tfGetT(p / asp + 0.5); }`);

fx('slidein', 'Slide In / Out', 'Motion', 'Slides the frame in at the clip start and out at the end.',
  [L('dir', 'From', 0, ['Left', 'Right', 'Top', 'Bottom']), S('inLen', 'In Length (s)', 0.5, 0, 5, 0.01), S('outLen', 'Out Length (s)', 0, 0, 5, 0.01)], `
void main(){ vec2 uv = acScreenNorm; vec2 d = dir == 0 ? vec2(-1.0, 0.0) : dir == 1 ? vec2(1.0, 0.0) : dir == 2 ? vec2(0.0, -1.0) : vec2(0.0, 1.0);
  float k = 0.0; if (inLen > 0.0 && acLocalTime < inLen) { float p = acLocalTime / inLen; k = pow(1.0 - p, 3.0); }
  if (outLen > 0.0 && acLocalTime > acDuration - outLen) { float p = (acLocalTime - (acDuration - outLen)) / outLen; k = -p * p * p; }
  gl_FragColor = tfGetT(uv - d * k); }`);

fx('bouncein', 'Bounce In', 'Motion', 'Pops the frame in with a springy bounce at the clip start.',
  [S('len', 'Length (s)', 0.6, 0.1, 3, 0.01), S('start', 'Start Scale', 0.3, 0, 1, 0.01)], `
void main(){ vec2 uv = acScreenNorm; float p = clamp(acLocalTime / len, 0.0, 1.0);
  float e = p == 1.0 ? 1.0 : pow(2.0, -10.0 * p) * sin((p * 10.0 - 0.75) * 2.0944) + 1.0; float z = mix(start, 1.0, e);
  gl_FragColor = tfGetT((uv - 0.5) / max(z, 0.001) + 0.5); }`);

fx('flash', 'Flash', 'Motion', 'A white (or coloured) flash at the start, end or both.',
  [L('when', 'When', 0, ['Start', 'End', 'Both']), S('len', 'Length (s)', 0.3, 0.02, 2, 0.01), C('flashC', 'Colour', '#FFFFFFFF')], `
void main(){ vec4 s = tfGet(acScreenNorm); float k = 0.0;
  if (when != 1) k = max(k, 1.0 - acLocalTime / len); if (when != 0) k = max(k, 1.0 - (acDuration - acLocalTime) / len);
  k = clamp(k, 0.0, 1.0); gl_FragColor = mix(s, vec4(flashC.rgb, 1.0), k * k); }`);

fx('smoothzoom', 'Smooth Zoom', 'Motion', 'Slowly zooms in (or out) across the whole clip, Ken Burns style.',
  [S('zFrom', 'Start Zoom', 1, 0.5, 3, 0.01), S('zTo', 'End Zoom', 1.25, 0.5, 3, 0.01), S('cx', 'Focus X', 0.5, 0, 1), S('cy', 'Focus Y', 0.5, 0, 1)], `
void main(){ float p = clamp(acLocalTime / max(acDuration, 0.001), 0.0, 1.0); p = p * p * (3.0 - 2.0 * p); float z = mix(zFrom, zTo, p);
  vec2 c = vec2(cx, cy); gl_FragColor = tfGetT((acScreenNorm - c) / z + c); }`);

// ---- Color --------------------------------------------------------------
fx('temp', 'Temperature & Tint', 'Color', 'Warmer or cooler, greener or more magenta.',
  [S('temperature', 'Temperature', 0, -1, 1), S('tintV', 'Tint', 0, -1, 1)], `
void main(){ vec4 s = tfGet(acScreenNorm); vec3 c = tfUn(s);
  c *= vec3(1.0 + temperature * 0.25, 1.0 - tintV * 0.15, 1.0 - temperature * 0.25); c.rb *= 1.0 + tintV * 0.1;
  gl_FragColor = vec4(clamp(c, 0.0, 1.0) * s.a, s.a); }`);

fx('levels', 'Levels', 'Color', 'Input black and white points, gamma and output range.',
  [S('inBlack', 'Input Black', 0, 0, 1), S('inWhite', 'Input White', 1, 0, 1), S('gamma', 'Gamma', 1, 0.1, 5), S('outBlack', 'Output Black', 0, 0, 1), S('outWhite', 'Output White', 1, 0, 1)], `
void main(){ vec4 s = tfGet(acScreenNorm); vec3 c = tfUn(s);
  c = clamp((c - inBlack) / max(inWhite - inBlack, 1e-3), 0.0, 1.0); c = pow(c, vec3(1.0 / gamma)); c = mix(vec3(outBlack), vec3(outWhite), c);
  gl_FragColor = vec4(c * s.a, s.a); }`);

fx('curves', 'RGB Curves', 'Color', 'Curves with shadow, midtone and highlight points for master, red, green and blue.',
  [H('Master'), S('mS', 'Shadows', 0, -0.5, 0.5), S('mM', 'Midtones', 0, -0.5, 0.5), S('mH', 'Highlights', 0, -0.5, 0.5),
   H('Red'), S('rS', 'Shadows', 0, -0.5, 0.5), S('rM', 'Midtones', 0, -0.5, 0.5), S('rH', 'Highlights', 0, -0.5, 0.5),
   H('Green'), S('gS', 'Shadows', 0, -0.5, 0.5), S('gM', 'Midtones', 0, -0.5, 0.5), S('gH', 'Highlights', 0, -0.5, 0.5),
   H('Blue'), S('bS', 'Shadows', 0, -0.5, 0.5), S('bM', 'Midtones', 0, -0.5, 0.5), S('bH', 'Highlights', 0, -0.5, 0.5)], `
float cv(float x, float s, float m, float h){ float ws = 1.0 - smoothstep(0.0, 0.5, x), wm = 1.0 - abs(x - 0.5) * 2.0, wh = smoothstep(0.5, 1.0, x);
  return clamp(x + s * ws + m * wm + h * wh, 0.0, 1.0); }
void main(){ vec4 s = tfGet(acScreenNorm); vec3 c = tfUn(s);
  c = vec3(cv(c.r, mS, mM, mH), cv(c.g, mS, mM, mH), cv(c.b, mS, mM, mH)); c = vec3(cv(c.r, rS, rM, rH), cv(c.g, gS, gM, gH), cv(c.b, bS, bM, bH));
  gl_FragColor = vec4(c * s.a, s.a); }`);

fx('lgg', 'Color Wheels (Lift / Gamma / Gain)', 'Color', 'Colour grading wheels: lift for shadows, gamma for midtones, gain for highlights.',
  [C('lift', 'Lift Colour', '#FF808080'), S('liftA', 'Lift Amount', 0, -0.5, 0.5), C('gammaC', 'Gamma Colour', '#FF808080'), S('gammaA', 'Gamma Amount', 0, -0.5, 0.5), C('gain', 'Gain Colour', '#FF808080'), S('gainA', 'Gain Amount', 0, -0.5, 0.5)], `
void main(){ vec4 s = tfGet(acScreenNorm); vec3 c = tfUn(s);
  vec3 L = (lift.rgb - 0.5) * 2.0 * 0.25 + liftA; vec3 G = 1.0 + (gain.rgb - 0.5) * 2.0 * 0.25 + gainA; vec3 M = 1.0 - ((gammaC.rgb - 0.5) * 2.0 * 0.25 + gammaA);
  c = c * G + L * (1.0 - c); c = pow(clamp(c, 0.0, 1.0), max(M, vec3(0.05))); gl_FragColor = vec4(c * s.a, s.a); }`);

fx('hslrange', 'Hue/Saturation by Colour', 'Color', 'Changes only one range of colours, for example only the blues.',
  [S('target', 'Target Hue°', 210, 0, 360, 1), S('range', 'Range°', 40, 1, 180, 1), S('hueShift', 'Hue Shift°', 0, -180, 180, 1), S('sat', 'Saturation', 1, 0, 3), S('light', 'Lightness', 0, -1, 1)], `
vec3 rgb2hsv(vec3 c){ vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0); vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r)); float d = q.x - min(q.w, q.y); float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x); }
vec3 hsv2rgb(vec3 c){ vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0); return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y); }
void main(){ vec4 s = tfGet(acScreenNorm); vec3 h = rgb2hsv(tfUn(s)); float dh = abs(fract(h.x - target / 360.0 + 0.5) - 0.5) * 360.0;
  float w = (1.0 - smoothstep(range * 0.5, range, dh)) * smoothstep(0.05, 0.2, h.y);
  vec3 h2 = vec3(fract(h.x + hueShift / 360.0 * w), clamp(h.y * mix(1.0, sat, w), 0.0, 1.0), clamp(h.z + light * w * 0.5, 0.0, 1.0));
  gl_FragColor = vec4(hsv2rgb(h2) * s.a, s.a); }`);

fx('tritone', 'Tritone', 'Color', 'Maps shadows, midtones and highlights to three colours.',
  [C('sh', 'Shadows', '#FF1A1033'), C('md', 'Midtones', '#FFB0504A'), C('hi', 'Highlights', '#FFFFE9C2'), S('amount', 'Amount', 1, 0, 1)], `
void main(){ vec4 s = tfGet(acScreenNorm); float l = tfLum(tfUn(s));
  vec3 t = l < 0.5 ? mix(sh.rgb, md.rgb, l * 2.0) : mix(md.rgb, hi.rgb, l * 2.0 - 1.0); gl_FragColor = vec4(mix(tfUn(s), t, amount) * s.a, s.a); }`);

fx('gradmap', 'Gradient Map', 'Color', 'Replaces brightness with a gradient of four colours.',
  [C('g1', 'Colour 1', '#FF0B0A2A'), C('g2', 'Colour 2', '#FF7A1FA2'), C('g3', 'Colour 3', '#FFFF6A3D'), C('g4', 'Colour 4', '#FFFFF3B0'), S('amount', 'Amount', 1, 0, 1)], `
void main(){ vec4 s = tfGet(acScreenNorm); float l = tfLum(tfUn(s)) * 3.0; vec3 t = l < 1.0 ? mix(g1.rgb, g2.rgb, l) : l < 2.0 ? mix(g2.rgb, g3.rgb, l - 1.0) : mix(g3.rgb, g4.rgb, l - 2.0);
  gl_FragColor = vec4(mix(tfUn(s), t, amount) * s.a, s.a); }`);

fx('saturation', 'Saturation', 'Color', 'More or less colour.',
  [S('sat', 'Saturation', 1.3, 0, 3)], `
void main(){ vec4 s = tfGet(acScreenNorm); vec3 c = tfUn(s); float l = tfLum(c); gl_FragColor = vec4(clamp(mix(vec3(l), c, sat), 0.0, 1.0) * s.a, s.a); }`);

// LUT: the .cube file is chosen in the effect's panel and uploaded as a texture.
EffectLib.add({
  id: 'tf.lut', name: 'LUT (.cube)', category: 'Color', kind: 'shader', builtin: true, tags: 'color,lut,cube,grade',
  desc: 'Applies a colour lookup table from a .cube file.', precision: 'high',
  params: [{ kind: 'texture', id: 'inputImg' }, { kind: 'lut', id: 'lutId', label: 'LUT file', default: '' }, S('intensity', 'Intensity', 1, 0, 1)],
  shader: TF_PRELUDE + `
vec3 lut3(vec3 c){ float N = acLutSize; float b = c.b * (N - 1.0); float b0 = floor(b); float b1 = min(b0 + 1.0, N - 1.0); float f = b - b0;
  vec2 u0 = vec2((b0 * N + c.r * (N - 1.0) + 0.5) / (N * N), (c.g * (N - 1.0) + 0.5) / N); vec2 u1 = vec2((b1 * N + c.r * (N - 1.0) + 0.5) / (N * N), u0.y);
  return mix(texture2D(acLut, u0).rgb, texture2D(acLut, u1).rgb, f); }
void main(){ vec4 s = tfGet(acScreenNorm); if (acLutSize < 2.0) { gl_FragColor = s; return; } vec3 c = clamp(tfUn(s), 0.0, 1.0);
  gl_FragColor = vec4(mix(c, lut3(c), intensity) * s.a, s.a); }`
});

// ---- Keying and masks -------------------------------------------------------
fx('chromakey', 'Chroma Key', 'Keying', 'Removes a green or blue screen, with spill suppression.',
  [C('key', 'Key Colour', '#FF00FF00'), S('similarity', 'Similarity', 0.35, 0, 1), S('softness', 'Smoothness', 0.08, 0, 0.5), S('spill', 'Spill Suppression', 0.6, 0, 1)], `
vec2 uvc(vec3 c){ return vec2(-0.169 * c.r - 0.331 * c.g + 0.5 * c.b, 0.5 * c.r - 0.419 * c.g - 0.081 * c.b); }
void main(){ vec4 s = tfGet(acScreenNorm); vec3 c = tfUn(s); float d = distance(uvc(c), uvc(key.rgb));
  float a = smoothstep(similarity * 0.5, similarity * 0.5 + softness, d);
  float l = tfLum(c); vec3 k = normalize(key.rgb + 1e-4); float sp = max(0.0, dot(c, k) - l) * spill; c = clamp(c - k * sp + vec3(sp * 0.5), 0.0, 1.0);
  float na = s.a * a; gl_FragColor = vec4(c * na, na); }`);

fx('lumakey', 'Luma Key', 'Keying', 'Makes dark (or bright) areas transparent.',
  [S('threshold', 'Threshold', 0.15, 0, 1), S('soft', 'Softness', 0.1, 0, 0.5), B('invert', 'Key Out Brights', false)], `
void main(){ vec4 s = tfGet(acScreenNorm); float l = tfLum(tfUn(s)); float a = smoothstep(threshold, threshold + soft + 1e-4, l);
  if (invert) a = 1.0 - smoothstep(1.0 - threshold - soft - 1e-4, 1.0 - threshold, l); gl_FragColor = s * a; }`);

fx('mask', 'Shape Mask', 'Keying', 'Shows the layer only inside a rectangle, ellipse, star or polygon, with feather and expansion.',
  [L('shape', 'Shape', 1, ['Rectangle', 'Ellipse', 'Star', 'Polygon', 'Diamond']), S('cx', 'Center X', 0.5, -0.5, 1.5), S('cy', 'Center Y', 0.5, -0.5, 1.5),
   S('w', 'Width', 0.6, 0, 2), S('h', 'Height', 0.6, 0, 2), S('rot', 'Rotation°', 0, -360, 360, 0.5), S('roundness', 'Roundness', 0, 0, 0.5, 0.01),
   S('points', 'Points / Sides', 5, 3, 16, 1), S('feather', 'Feather', 0.02, 0, 0.5, 0.001), S('expand', 'Expansion', 0, -0.3, 0.3, 0.001), B('invert', 'Invert', false)], `
void main(){ vec2 uv = acScreenNorm; float asp = acScreenSize.x / acScreenSize.y; vec2 p = uv - vec2(cx, cy); p.x *= asp;
  float a = radians(rot); p = vec2(p.x * cos(a) + p.y * sin(a), -p.x * sin(a) + p.y * cos(a)); vec2 hs = vec2(w * asp, h) * 0.5; float d;
  if (shape == 0) { vec2 q = abs(p) - hs + roundness; d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - roundness; }
  else if (shape == 1) { vec2 q = p / max(hs, 1e-4); d = (length(q) - 1.0) * min(hs.x, hs.y); }
  else if (shape == 4) { vec2 q = abs(p) / max(hs, 1e-4); d = (q.x + q.y - 1.0) * min(hs.x, hs.y) * 0.7; }
  else { vec2 q = p / max(hs, 1e-4); float ang = atan(q.x, -q.y); float n = points; float seg = 6.28318 / n; float r = length(q);
    float k = cos(seg * 0.5) / cos(mod(ang, seg) - seg * 0.5);
    if (shape == 2) { float f = abs(fract(ang / seg) - 0.5) * 2.0; k = mix(0.45, 1.0, f); }
    d = (r - k) * min(hs.x, hs.y); }
  d -= expand; float m = 1.0 - smoothstep(-feather, feather + 1e-4, d); if (invert) m = 1.0 - m;
  gl_FragColor = tfGet(uv) * m; }`);

// ---- Generate ---------------------------------------------------------------
fx('ramp', 'Gradient Ramp', 'Generate', 'Fills with a linear or radial gradient.',
  [L('type', 'Type', 0, ['Linear', 'Radial']), C('c1', 'Start Colour', '#FF101020'), C('c2', 'End Colour', '#FF30C0FF'), S('angle', 'Angle°', 90, -180, 180, 1), L('place', 'Place', 0, ['Behind layer', 'Replace'])], `
void main(){ vec2 uv = acScreenNorm; vec4 s = tfGet(uv); float t;
  if (type == 0) { vec2 d = vec2(cos(radians(angle)), sin(radians(angle))); t = clamp(dot(uv - 0.5, d) + 0.5, 0.0, 1.0); }
  else { vec2 c = (uv - 0.5) * vec2(acScreenSize.x / acScreenSize.y, 1.0); t = clamp(length(c) * 1.4, 0.0, 1.0); }
  vec4 g = vec4(mix(c1.rgb, c2.rgb, t), 1.0); gl_FragColor = place == 0 ? s + g * (1.0 - s.a) : g; }`);

fx('grid', 'Grid', 'Generate', 'Draws grid lines over or behind the layer.',
  [S('cells', 'Cells Across', 10, 1, 100, 1), S('lineW', 'Line Width', 2, 0.5, 20, 0.5), C('gc', 'Colour', '#FFFFFFFF'), S('opac', 'Opacity', 0.5, 0, 1), L('place', 'Place', 0, ['Over', 'Behind'])], `
void main(){ vec2 uv = acScreenNorm; vec4 s = tfGet(uv); vec2 px = uv * acScreenSize; float cs = acScreenSize.x / cells;
  vec2 g = abs(fract(px / cs + 0.5) - 0.5) * cs; float m = 1.0 - smoothstep(lineW * 0.5 * tfK(), lineW * 0.5 * tfK() + 1.0, min(g.x, g.y));
  vec4 l = vec4(gc.rgb, 1.0) * m * opac; gl_FragColor = place == 0 ? l + s * (1.0 - l.a) : s + l * (1.0 - s.a); }`);

fx('checker', 'Checkerboard', 'Generate', 'A checkerboard pattern.',
  [S('cells', 'Squares Across', 8, 1, 100, 1), C('a', 'Colour A', '#FFFFFFFF'), C('b', 'Colour B', '#FF202020'), L('place', 'Place', 0, ['Behind layer', 'Replace'])], `
void main(){ vec2 uv = acScreenNorm; vec4 s = tfGet(uv); vec2 q = floor(uv * vec2(cells, cells * acScreenSize.y / acScreenSize.x));
  vec4 g = vec4(mod(q.x + q.y, 2.0) < 1.0 ? a.rgb : b.rgb, 1.0); gl_FragColor = place == 0 ? s + g * (1.0 - s.a) : g; }`);

fx('particles', 'Particles', 'Generate', 'Falling snow, rising sparks or floating dust over the layer.',
  [L('type', 'Type', 0, ['Snow', 'Sparks', 'Dust']), S('density', 'Density', 0.5, 0, 1), S('size', 'Size', 1, 0.2, 4, 0.05), S('speed', 'Speed', 1, 0, 4, 0.05), C('pc', 'Colour', '#FFFFFFFF')], `
void main(){ vec2 uv = acScreenNorm; vec4 s = tfGet(uv); float asp = acScreenSize.x / acScreenSize.y; vec3 col = vec3(0.0); float al = 0.0;
  for (int L = 0; L < 3; L++) { float fl = float(L); float sc = 12.0 + fl * 10.0; float t = acTime * speed * (0.6 + fl * 0.3);
    vec2 p = uv * vec2(asp, 1.0) * sc; float dir = type == 1 ? -1.0 : 1.0; p.y -= t * sc * 0.15 * dir * (type == 2 ? 0.2 : 1.0);
    p.x += sin(t * 0.7 + p.y * 0.3 + fl) * (type == 2 ? 1.0 : 0.3); vec2 cell = floor(p); vec2 f = fract(p) - 0.5;
    float r = tfHash(cell + fl * 31.0); if (r > density) continue;
    vec2 o = vec2(tfHash(cell + 3.1), tfHash(cell + 7.7)) - 0.5; float d = length(f - o * 0.6);
    float rad = 0.06 * size * (0.5 + r) * (type == 2 ? 0.6 : 1.0); float m = 1.0 - smoothstep(rad * 0.4, rad, d);
    if (type == 1) m *= 0.5 + 0.5 * sin(acTime * 20.0 + r * 50.0); col += pc.rgb * m; al = max(al, m); }
  if (type == 1) col *= vec3(1.0, 0.7, 0.3) * 1.5; gl_FragColor = vec4(s.rgb * (1.0 - al) + col, max(s.a, al)); }`);

fx('solidfill', 'Solid Colour', 'Generate', 'Fills the whole frame with one colour, behind or over the layer.',
  [C('fillC', 'Colour', '#FF1E90FF'), L('place', 'Place', 0, ['Behind layer', 'Replace'])], `
void main(){ vec4 s = tfGet(acScreenNorm); vec4 g = vec4(fillC.rgb, 1.0); gl_FragColor = place == 0 ? s + g * (1.0 - s.a) : g; }`);

// ---- Time effects handled by the renderer -----------------------------------
EffectLib.add({
  id: 'tf.echo', name: 'Echo / Trails', category: 'Time', kind: 'echo', builtin: true, tags: 'time,echo,trail,ghost',
  desc: 'Draws earlier moments of the layer behind it, fading out, for motion trails.',
  params: [S('count', 'Echoes', 4, 1, 12, 1), S('delay', 'Delay (frames)', 2, 1, 30, 1), S('decay', 'Decay', 0.6, 0.05, 1, 0.01), L('blend', 'Blend', 0, ['Normal', 'Add', 'Screen', 'Lighten']), C('tint', 'Tint', '#FFFFFFFF')]
});

// Filters: one-tap colour looks made from the colour effects above.
const FILTER_LOOKS = [
  ['Natural', []],
  ['Vivid', [['tf.saturation', { sat: 1.45 }], ['tf.brightcon', { brightness: 0.02, contrast: 1.12 }]]],
  ['Warm', [['tf.temp', { temperature: 0.45, tintV: 0.05 }]]],
  ['Cool', [['tf.temp', { temperature: -0.45, tintV: -0.05 }]]],
  ['Teal & Orange', [['tf.lgg', { lift: [0.35, 0.55, 0.6, 1], liftA: 0, gammaC: [0.5, 0.5, 0.5, 1], gammaA: 0, gain: [0.7, 0.5, 0.35, 1], gainA: 0 }], ['tf.saturation', { sat: 1.2 }]]],
  ['Noir', [['tf.bw', { amount: 1 }], ['tf.brightcon', { brightness: -0.03, contrast: 1.4 }], ['tf.vignette', { amount: 0.7 }]]],
  ['Faded', [['tf.levels', { outBlack: 0.12, outWhite: 0.92 }], ['tf.saturation', { sat: 0.75 }]]],
  ['Vintage', [['tf.tritone', { amount: 0.45 }], ['tf.grain', { amount: 0.08 }], ['tf.vignette', { amount: 0.5 }]]],
  ['Moody', [['tf.levels', { gamma: 0.85 }], ['tf.temp', { temperature: -0.2 }], ['tf.saturation', { sat: 0.8 }]]],
  ['Golden Hour', [['tf.temp', { temperature: 0.6 }], ['tf.glow', { threshold: 0.75, radius: 30, intensity: 0.6 }]]],
  ['Cyberpunk', [['tf.gradmap', { amount: 0.5 }], ['tf.saturation', { sat: 1.5 }], ['tf.rgbsplit', { amount: 3 }]]],
  ['Comic', [['tf.cartoon', {}], ['tf.halftone', { dotSize: 6 }]]]
];

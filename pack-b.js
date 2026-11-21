// ===========================================================================
// Effects pack B: generate, noise and grain, perspective, simulation,
// wipes you can keyframe, and social-video looks.
// ===========================================================================

// ---- Generate ---------------------------------------------------------------
fx3('fractal', 'Fractal Noise', 'Generate', 'Soft cloudy noise that can evolve over time. Good for smoke, fog and textures.',
  [S('size', 'Scale', 4, 0.5, 40, 0.1), S('contr', 'Contrast', 1.5, 0.2, 6), S('bright', 'Brightness', 0, -1, 1), S('evolve', 'Evolution', 0, 0, 100, 0.05), S('flow', 'Auto Evolve Speed', 0.2, 0, 5), C('ca', 'Dark Colour', '#FF000000'), C('cb', 'Light Colour', '#FFFFFFFF'), L('bm', 'Blend', 0, GM), S('opac', 'Opacity', 1, 0, 1)], `
void main(){ vec2 uv = acScreenNorm; vec2 q = uv * vec2(xAsp(), 1.0) * size; float t = evolve + acTime * flow; float n = xFbm(q + vec2(xFbm(q + t), xFbm(q - t + 4.0)) * 1.5); n = clamp((n - 0.5) * contr + 0.5 + bright, 0.0, 1.0);
  gl_FragColor = xGen(tfGet(uv), mix(ca.rgb, cb.rgb, n), opac, bm); }`);
fx3('cells', 'Cell Pattern', 'Generate', 'Organic cells, like skin under a microscope or cracked mud.', [S('size', 'Cells', 10, 2, 80, 0.5), S('speed', 'Drift', 0.3, 0, 5), B('invert', 'Invert', false), C('ca', 'Colour A', '#FF000000'), C('cb', 'Colour B', '#FFFFFFFF'), L('bm', 'Blend', 0, GM), S('opac', 'Opacity', 1, 0, 1)], `
void main(){ vec2 uv = acScreenNorm; float d = xVor(uv * vec2(xAsp(), 1.0) * size + acTime * speed).x; if (invert) d = 1.0 - d; gl_FragColor = xGen(tfGet(uv), mix(ca.rgb, cb.rgb, clamp(d, 0.0, 1.0)), opac, bm); }`);
fx3('fourgrad', '4-Color Gradient', 'Generate', 'A smooth blend of four colours, one from each corner.', [C('c1', 'Top Left', '#FFFF2D75'), C('c2', 'Top Right', '#FFFFC400'), C('c3', 'Bottom Left', '#FF2D6BFF'), C('c4', 'Bottom Right', '#FF14E0C8'), S('soft', 'Blend Softness', 1, 0.2, 4), L('bm', 'Blend', 0, GM), S('opac', 'Opacity', 1, 0, 1)], `
void main(){ vec2 uv = acScreenNorm; vec2 f = pow(uv, vec2(soft)) / (pow(uv, vec2(soft)) + pow(1.0 - uv, vec2(soft))); gl_FragColor = xGen(tfGet(uv), mix(mix(c1.rgb, c2.rgb, f.x), mix(c3.rgb, c4.rgb, f.x), f.y), opac, bm); }`);
fx3('lightsweep', 'Light Sweep', 'Generate', 'A band of light that glides across the layer.', [S('pos', 'Position', 0.5, -0.5, 1.5), S('autosp', 'Auto Sweep Speed', 0.5, 0, 5), S('angle', 'Angle°', 25, -90, 90, 1), S('width', 'Width', 0.12, 0.005, 1), S('amount', 'Brightness', 0.8, 0, 4), C('tint', 'Colour', '#FFFFFFFF')], `
void main(){ vec2 uv = acScreenNorm; vec4 s = tfGet(uv); float a = radians(angle); float p = autosp > 0.0 ? fract(acTime * autosp * 0.5) * 2.0 - 0.5 : pos; float d = abs(dot(uv - 0.5, vec2(cos(a), sin(a))) - (p - 0.5));
  float k = smoothstep(width, 0.0, d); gl_FragColor = vec4(s.rgb + tint.rgb * k * k * amount * s.a, s.a); }`);
fx3('lightburst', 'Light Burst', 'Generate', 'Rays of light bursting out of the bright areas.', [S('amount', 'Ray Length', 0.4, 0, 1), S('bright', 'Brightness', 1.2, 0, 5), S('threshold', 'Threshold', 0.5, 0, 1), S('cx', 'Center X', 0.5, 0, 1), S('cy', 'Center Y', 0.5, 0, 1), C('tint', 'Colour', '#FFFFE9B0')], `
void main(){ vec2 uv = acScreenNorm; vec4 s = tfGet(uv); vec2 c = vec2(cx, cy); vec3 a = vec3(0.0); for (int i = 0; i < 32; i++) { float t = float(i) / 31.0; vec4 q = tfGet(c + (uv - c) * (1.0 - amount * t)); a += max(q.rgb - threshold, 0.0) * (1.0 - t); }
  gl_FragColor = xAdd(s, a / 12.0 * bright * tint.rgb); }`);
fx3('beam', 'Beam', 'Generate', 'A laser line between two points.', [S('x1', 'Start X', 0.1, -0.5, 1.5), S('y1', 'Start Y', 0.5, -0.5, 1.5), S('x2', 'End X', 0.9, -0.5, 1.5), S('y2', 'End Y', 0.5, -0.5, 1.5), S('grow', 'Length', 1, 0, 1), S('thick', 'Thickness', 6, 0.5, 80, 0.5), S('soft', 'Glow', 3, 0, 20, 0.1), C('tint', 'Colour', '#FF14E0C8')], `
void main(){ vec2 uv = acScreenNorm; vec2 sc = vec2(xAsp(), 1.0); vec2 a = vec2(x1, y1) * sc; vec2 b = mix(a, vec2(x2, y2) * sc, grow); vec2 p = uv * sc; vec2 ab = b - a; float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
  float d = length(p - a - ab * t) * 1080.0; float core = smoothstep(thick * 0.5, thick * 0.5 - 1.0, d); float g = soft > 0.0 ? exp(-d / (thick * soft * 0.5 + 1e-3)) : 0.0; gl_FragColor = xAdd(tfGet(uv), tint.rgb * g + vec3(core)); }`);
fx3('lightning', 'Lightning', 'Generate', 'A crackling bolt between two points.', [S('x1', 'Start X', 0.5, -0.5, 1.5), S('y1', 'Start Y', 0, -0.5, 1.5), S('x2', 'End X', 0.5, -0.5, 1.5), S('y2', 'End Y', 1, -0.5, 1.5), S('amp', 'Wildness', 0.25, 0, 1), S('rate', 'Flicker Speed', 14, 0, 60, 1), S('core', 'Thickness', 1, 0.1, 6), S('seed', 'Seed', 1, 0, 99, 1), C('tint', 'Colour', '#FFB9A6FF')], `
void main(){ vec2 uv = acScreenNorm; vec2 a = vec2(x1, y1); vec2 d = vec2(x2, y2) - a; float L = max(length(d), 1e-4); vec2 n = d / L; vec2 q = uv - a; float t = dot(q, n) / L; float off = dot(q, vec2(-n.y, n.x)); float g = 0.0;
  for (int i = 0; i < 3; i++) { float fi = float(i); float disp = (xFbm(vec2(t * (5.0 + fi * 3.0), floor(acTime * rate) * 1.7 + seed + fi * 9.0)) - 0.5) * amp * sin(clamp(t, 0.0, 1.0) * 3.14159) * (1.0 - fi * 0.25);
    g += core * 0.0025 / (abs(off - disp) + 0.0008) * (1.0 - fi * 0.3); }
  g *= step(0.0, t) * step(t, 1.0); gl_FragColor = xAdd(tfGet(uv), tint.rgb * g + vec3(max(g - 1.2, 0.0))); }`);
fx3('spectrum', 'Audio Spectrum', 'Generate', 'Bouncing bars. Link Level to a sound with the expression audio() and they move to the music.', [S('level', 'Level', 0.6, 0, 2), S('bars', 'Bars', 32, 4, 128, 1), S('pos', 'Base Line', 0.8, 0, 1), S('tall', 'Max Height', 0.4, 0, 1), B('mirror', 'Mirror Below', false), C('ca', 'Low Colour', '#FF14E0C8'), C('cb', 'High Colour', '#FFFF4F8B')], `
void main(){ vec2 uv = acScreenNorm; float i = floor(uv.x * bars); float fx0 = fract(uv.x * bars); float hgt = (0.25 + 0.75 * tfHash(vec2(i, floor(acTime * 14.0)))) * (0.55 + 0.45 * sin(i * 0.9 + acTime * 3.0)) * level * tall;
  float y = pos - uv.y; float inb = step(0.0, y) * step(y, hgt); if (mirror) inb = max(inb, step(0.0, -y) * step(-y, hgt * 0.5) * 0.5); inb *= step(0.15, fx0) * step(fx0, 0.85);
  gl_FragColor = xOver(vec4(mix(ca.rgb, cb.rgb, clamp(abs(y) / max(tall, 1e-3), 0.0, 1.0)), 1.0) * inb, tfGet(uv)); }`);
fx3('waveline', 'Audio Waveform', 'Generate', 'A wiggling sound-wave line. Link Level to a sound with audio().', [S('level', 'Level', 0.6, 0, 2), S('pos', 'Position', 0.5, 0, 1), S('freq', 'Detail', 18, 2, 80, 1), S('thick', 'Thickness', 1, 0.2, 6), C('tint', 'Colour', '#FF14E0C8')], `
void main(){ vec2 uv = acScreenNorm; float y = pos + (tfNoise(vec2(uv.x * freq, acTime * 9.0)) - 0.5) * (tfNoise(vec2(uv.x * 3.0 + 7.0, acTime * 4.0)) + 0.3) * level * 0.35; float g = thick * 0.002 / (abs(uv.y - y) + 0.0006);
  gl_FragColor = xAdd(tfGet(uv), tint.rgb * min(g, 4.0) + vec3(max(g - 1.5, 0.0))); }`);
fx3('radiowaves', 'Radio Waves', 'Generate', 'Rings pulsing out from a point.', [S('cx', 'Center X', 0.5, 0, 1), S('cy', 'Center Y', 0.5, 0, 1), S('freq', 'Ring Count', 6, 1, 40, 0.5), S('speed', 'Speed', 1, -8, 8), S('thick', 'Thickness', 0.12, 0.01, 0.5), S('size', 'Reach', 0.7, 0.05, 2), C('tint', 'Colour', '#FFFFFFFF')], `
void main(){ vec2 uv = acScreenNorm; vec2 p = uv - vec2(cx, cy); p.x *= xAsp(); float r = length(p); float w = fract(r * freq - acTime * speed); float k = smoothstep(thick, 0.0, abs(w - 0.5)) * clamp(1.0 - r / size, 0.0, 1.0);
  gl_FragColor = xOver(vec4(tint.rgb, 1.0) * k, tfGet(uv)); }`);
fx3('vegas', 'Edge Tracer Lights', 'Generate', 'Running lights that chase around the outlines in the picture.', [S('segments', 'Segments', 8, 1, 40, 1), S('len', 'Light Length', 0.5, 0.05, 1), S('speed', 'Speed', 0.6, -5, 5), S('amount', 'Brightness', 4, 0, 15, 0.1), C('tint', 'Colour', '#FFFFD400'), S('keep', 'Keep Original', 1, 0, 1)], `
void main(){ vec2 uv = acScreenNorm; vec4 s = tfGet(uv); float e = xSobel(uv, 1.5 * tfK()); vec2 p = uv - 0.5; float a = atan(p.y, p.x) / 6.28318 + 0.5; float k = smoothstep(1.0 - len, 1.0, fract(a * segments - acTime * speed));
  gl_FragColor = vec4(clamp(s.rgb * keep + tint.rgb * e * k * amount * s.a, 0.0, 1.0), s.a); }`);
fx3('stripes', 'Stripes', 'Generate', 'Moving stripes in two colours.', [S('count', 'Stripes', 12, 1, 100, 1), S('angle', 'Angle°', 45, -180, 180, 1), S('duty', 'Stripe Width', 0.5, 0.02, 0.98), S('speed', 'Speed', 0.3, -5, 5), C('ca', 'Colour A', '#FF14E0C8'), C('cb', 'Colour B', '#FF0F0F10'), L('bm', 'Blend', 0, GM), S('opac', 'Opacity', 1, 0, 1)], `
void main(){ vec2 uv = acScreenNorm; float a = radians(angle); float v = fract(dot((uv - 0.5) * vec2(xAsp(), 1.0), vec2(cos(a), sin(a))) * count + acTime * speed); gl_FragColor = xGen(tfGet(uv), mix(cb.rgb, ca.rgb, step(v, duty)), opac, bm); }`);
fx3('polka', 'Polka Dots', 'Generate', 'A grid of dots.', [S('count', 'Rows', 12, 2, 80, 1), S('size', 'Dot Size', 0.5, 0.05, 1), B('stagger', 'Offset Rows', true), C('ca', 'Dot Colour', '#FFFF4F8B'), C('cb', 'Background', '#FFFFFFFF'), L('bm', 'Blend', 0, GM), S('opac', 'Opacity', 1, 0, 1)], `
void main(){ vec2 uv = acScreenNorm; vec2 q = uv * vec2(xAsp(), 1.0) * count; if (stagger) q.x += mod(floor(q.y), 2.0) * 0.5; float d = length(fract(q) - 0.5) * 2.0; gl_FragColor = xGen(tfGet(uv), mix(cb.rgb, ca.rgb, smoothstep(size, size - 0.06, d)), opac, bm); }`);
fx3('starfield', 'Starfield', 'Generate', 'Twinkling stars drifting through space.', [S('density', 'Stars', 0.5, 0.05, 1), S('speed', 'Drift Speed', 0.05, -1, 1), S('twinkle', 'Twinkle', 0.6, 0, 1), L('bm', 'Blend', 1, GM)], `
void main(){ vec2 uv = acScreenNorm; vec3 a = vec3(0.0); for (int i = 0; i < 3; i++) { float fi = float(i); float sc = 30.0 + fi * 35.0; vec2 q = uv * vec2(xAsp(), 1.0) * sc + vec2(acTime * speed * (fi + 1.0) * 3.0, fi * 17.0); vec2 g = floor(q); vec2 o = xH2(g) - 0.5;
    float d = length(fract(q) - 0.5 - o * 0.7); float on = step(1.0 - density * 0.35, tfHash(g + 3.3)); float tw = 1.0 - twinkle * (0.5 + 0.5 * sin(acTime * (2.0 + tfHash(g) * 6.0) + tfHash(g + 1.0) * 6.28));
    a += vec3(smoothstep(0.09 - fi * 0.02, 0.0, d)) * on * tw * (1.0 - fi * 0.25); }
  gl_FragColor = xGen(tfGet(uv), a, 1.0, bm); }`);
fx3('clouds', 'Clouds', 'Generate', 'A sky with drifting clouds.', [S('cover', 'Cloud Cover', 0.5, 0, 1), S('size', 'Scale', 3, 0.5, 12, 0.1), S('speed', 'Wind', 0.1, -2, 2), C('sky', 'Sky', '#FF4A90E2'), C('cl', 'Clouds', '#FFFFFFFF'), L('bm', 'Blend', 0, GM), S('opac', 'Opacity', 1, 0, 1)], `
void main(){ vec2 uv = acScreenNorm; float n = xFbm(uv * vec2(xAsp(), 1.6) * size + vec2(acTime * speed, 0.0)); float k = smoothstep(1.0 - cover - 0.15, 1.0 - cover + 0.25, n + 0.2); gl_FragColor = xGen(tfGet(uv), mix(sky.rgb * (1.0 - uv.y * 0.3), cl.rgb, k), opac, bm); }`);
fx3('plasma', 'Plasma', 'Generate', 'Flowing rainbow plasma.', [S('size', 'Scale', 6, 1, 40, 0.5), S('speed', 'Speed', 1, 0, 8), S('satur', 'Saturation', 0.8, 0, 1), L('bm', 'Blend', 0, GM), S('opac', 'Opacity', 1, 0, 1)], `
void main(){ vec2 uv = acScreenNorm; vec2 p = uv * vec2(xAsp(), 1.0) * size; float t = acTime * speed; float v = sin(p.x + t) + sin(p.y * 1.3 - t * 0.7) + sin((p.x + p.y) * 0.7 + t * 1.3) + sin(length(p - size * 0.5) * 1.5 - t);
  gl_FragColor = xGen(tfGet(uv), xRgb(vec3(fract(v * 0.125 + t * 0.05), satur, 1.0)), opac, bm); }`);
fx3('ring', 'Circle / Ring', 'Generate', 'A filled circle or a ring.', [S('cx', 'Center X', 0.5, -0.5, 1.5), S('cy', 'Center Y', 0.5, -0.5, 1.5), S('radius', 'Radius', 0.25, 0, 2), S('thick', 'Ring Thickness (0 = filled)', 0.02, 0, 1), S('feather', 'Feather', 0.004, 0, 0.5, 0.001), C('tint', 'Colour', '#FFFFFFFF'), L('bm', 'Blend', 0, GM), S('opac', 'Opacity', 1, 0, 1)], `
void main(){ vec2 uv = acScreenNorm; vec2 p = uv - vec2(cx, cy); p.x *= xAsp(); float r = length(p); float k = 1.0 - smoothstep(radius - feather, radius + feather + 1e-4, r); if (thick > 0.0) k *= smoothstep(radius - thick - feather, radius - thick + feather + 1e-4, r);
  gl_FragColor = xGen(tfGet(uv), tint.rgb, k * opac, bm); }`);
fx3('scanbeam', 'Scan Beam', 'Generate', 'A bright scanning line with a fading trail.', [S('speed', 'Speed', 0.4, -4, 4), S('pos', 'Position (when speed is 0)', 0.5, 0, 1), S('trail', 'Trail', 0.2, 0.005, 1), B('vertical', 'Sweep Sideways', false), S('amount', 'Brightness', 1, 0, 4), C('tint', 'Colour', '#FF14E0C8')], `
void main(){ vec2 uv = acScreenNorm; vec4 s = tfGet(uv); float x = vertical ? uv.x : uv.y; float p = speed != 0.0 ? fract(acTime * speed) : pos; float d = p - x; if (speed < 0.0) d = -d; d = fract(d + 1.0);
  float k = exp(-d / trail * 4.0) * step(d, 0.98) + smoothstep(0.004, 0.0, min(d, 1.0 - d)); gl_FragColor = vec4(s.rgb + tint.rgb * k * amount * s.a, s.a); }`);
fx3('bokehgen', 'Floating Bokeh', 'Generate', 'Soft out-of-focus lights drifting upward.', [S('amount', 'Brightness', 0.6, 0, 2), S('size', 'Size', 0.08, 0.01, 0.4), S('speed', 'Speed', 0.15, -2, 2), C('tint', 'Colour', '#FFFFD9A0')], `
void main(){ vec2 uv = acScreenNorm; vec3 a = vec3(0.0); for (int i = 0; i < 16; i++) { float fi = float(i); vec2 c = vec2(tfHash(vec2(fi, 1.0)), fract(tfHash(vec2(fi, 2.0)) - acTime * speed * (0.4 + tfHash(vec2(fi, 3.0))))); c.x += sin(acTime * 0.5 + fi) * 0.03;
    vec2 p = uv - c; p.x *= xAsp(); float r = size * (0.4 + tfHash(vec2(fi, 4.0))); float d = length(p) / r; a += tint.rgb * (smoothstep(1.0, 0.85, d) * 0.5 + smoothstep(1.0, 0.9, d) * smoothstep(0.75, 1.0, d) * 0.4) * (0.4 + 0.6 * tfHash(vec2(fi, 5.0))); }
  gl_FragColor = xAdd(tfGet(uv), a * amount); }`);
fx3('spotlight', 'Spotlight', 'Generate', 'Lights one area and dims everything else.', [S('cx', 'Center X', 0.5, 0, 1), S('cy', 'Center Y', 0.5, 0, 1), S('size', 'Size', 0.3, 0.01, 1.5), S('soft', 'Softness', 0.25, 0.005, 1), S('dark', 'Darkness Outside', 0.8, 0, 1), C('tint', 'Light Colour', '#FFFFFFFF')], `
void main(){ vec2 uv = acScreenNorm; vec4 s = tfGet(uv); vec2 p = uv - vec2(cx, cy); p.x *= xAsp(); float k = smoothstep(size + soft, size, length(p)); gl_FragColor = vec4(s.rgb * mix(vec3(1.0 - dark), tint.rgb, k), s.a); }`);
fx3('sunburst', 'Sunburst', 'Generate', 'Rotating rays, like a retro poster background.', [S('rays', 'Rays', 12, 2, 60, 1), S('speed', 'Spin Speed', 0.2, -5, 5), S('cx', 'Center X', 0.5, -0.5, 1.5), S('cy', 'Center Y', 0.5, -0.5, 1.5), C('ca', 'Colour A', '#FFFFC400'), C('cb', 'Colour B', '#FFFF7A00'), L('bm', 'Blend', 0, GM), S('opac', 'Opacity', 1, 0, 1)], `
void main(){ vec2 uv = acScreenNorm; vec2 p = uv - vec2(cx, cy); p.x *= xAsp(); float v = step(0.5, fract((atan(p.y, p.x) + acTime * speed) / 6.28318 * rays)); gl_FragColor = xGen(tfGet(uv), mix(ca.rgb, cb.rgb, v), opac, bm); }`);

// ---- Noise and grain ---------------------------------------------------------
fx3('filmgrain', 'Film Grain', 'Noise', 'Moving grain modelled on different film stocks.', [L('stock', 'Film Stock', 0, ['35mm fine', '16mm', 'Super 8', 'High ISO digital']), S('amount', 'Amount', 0.2, 0, 1), B('colour', 'Colour Grain', false)], `
void main(){ vec2 uv = acScreenNorm; vec4 s = tfGet(uv); vec3 c = tfUn(s); float sz = stock == 0 ? 1.0 : stock == 1 ? 1.8 : stock == 2 ? 3.0 : 1.3; float am = amount * (stock == 2 ? 1.5 : stock == 1 ? 1.2 : 1.0);
  vec2 g = floor(uv * acScreenSize / (sz * tfK())) + floor(acTime * 24.0) * 7.3; vec3 n = colour ? vec3(tfHash(g), tfHash(g + 11.0), tfHash(g + 23.0)) : vec3(tfHash(g)); gl_FragColor = xOut(c + (n - 0.5) * am * (1.0 - tfLum(c) * 0.6), s.a); }`);
fx3('noisefx', 'Noise', 'Noise', 'Plain random noise, in colour or grey.', [S('amount', 'Amount', 0.2, 0, 1), B('colour', 'Colour Noise', true), B('animate', 'Animate', true)], `
void main(){ vec2 uv = acScreenNorm; vec4 s = tfGet(uv); vec2 g = floor(uv * acScreenSize) + (animate ? floor(acTime * 30.0) * 5.1 : 0.0); vec3 n = colour ? vec3(tfHash(g), tfHash(g + 11.0), tfHash(g + 23.0)) : vec3(tfHash(g)); gl_FragColor = xOut(tfUn(s) + (n - 0.5) * amount, s.a); }`);
fx3('median', 'Median', 'Noise', 'Removes specks by taking the middle value of each pixel’s neighbours.', [S('radius', 'Radius', 1.5, 0.5, 6, 0.1)], `
#define s2(a, b) t = a; a = min(t, b); b = max(t, b);
#define mn3(a, b, c) s2(a, b); s2(a, c);
#define mx3(a, b, c) s2(b, c); s2(a, c);
#define mnmx3(a, b, c) mx3(a, b, c); s2(a, b);
#define mnmx4(a, b, c, d) s2(a, b); s2(c, d); s2(a, c); s2(b, d);
#define mnmx5(a, b, c, d, e) s2(a, b); s2(c, d); mn3(a, c, e); mx3(b, d, e);
#define mnmx6(a, b, c, d, e, f) s2(a, d); s2(b, e); s2(c, f); mn3(a, b, c); mx3(d, e, f);
void main(){ vec2 uv = acScreenNorm; vec2 px = radius * tfK() / acScreenSize; vec4 v0 = tfGet(uv + vec2(-px.x, -px.y)); vec4 v1 = tfGet(uv + vec2(0.0, -px.y)); vec4 v2 = tfGet(uv + vec2(px.x, -px.y)); vec4 v3 = tfGet(uv + vec2(-px.x, 0.0)); vec4 v4 = tfGet(uv);
  vec4 v5 = tfGet(uv + vec2(px.x, 0.0)); vec4 v6 = tfGet(uv + vec2(-px.x, px.y)); vec4 v7 = tfGet(uv + vec2(0.0, px.y)); vec4 v8 = tfGet(uv + px); vec4 t;
  mnmx6(v0, v1, v2, v3, v4, v5); mnmx5(v1, v2, v3, v4, v6); mnmx4(v2, v3, v4, v7); mnmx3(v3, v4, v8); gl_FragColor = v4; }`);
fx3('denoise', 'Remove Grain', 'Noise', 'Smooths out noise in flat areas and leaves edges alone.', [S('amount', 'Strength', 0.08, 0.01, 0.5, 0.005), S('radius', 'Radius', 3, 1, 12, 0.5)], `
void main(){ vec2 uv = acScreenNorm; vec2 px = radius * tfK() / acScreenSize / 2.0; vec4 c0 = tfGet(uv); vec4 a = vec4(0.0); float ws = 0.0;
  for (int y = -2; y <= 2; y++) for (int x = -2; x <= 2; x++) { vec4 c = tfGet(uv + vec2(float(x), float(y)) * px); float d = tfLum(c.rgb) - tfLum(c0.rgb); float w = exp(-d * d / (2.0 * amount * amount)); a += c * w; ws += w; } gl_FragColor = a / ws; }`);
fx3('dust', 'Dust & Scratches', 'Noise', 'Specks and running scratches, like a worn film print.', [S('specks', 'Dust', 0.5, 0, 1), S('scratch', 'Scratches', 0.5, 0, 1)], `
void main(){ vec2 uv = acScreenNorm; vec4 s = tfGet(uv); float f = floor(acTime * 18.0); float d = 0.0; for (int i = 0; i < 6; i++) { float fi = float(i); vec2 c = xH2(vec2(fi * 3.1, f)); vec2 p = uv - c; p.x *= xAsp(); d += smoothstep(0.006 * (0.5 + tfHash(vec2(fi, f))), 0.0, length(p)) * step(1.0 - specks, tfHash(vec2(fi + 9.0, f))); }
  float sx = tfHash(vec2(floor(acTime * 3.0), 5.0)); float sc = smoothstep(0.0012, 0.0, abs(uv.x - sx - sin(uv.y * 8.0 + acTime) * 0.002)) * step(1.0 - scratch, tfHash(vec2(f, 77.0)) + 0.4) * 0.6;
  gl_FragColor = vec4(mix(s.rgb, vec3(0.05) * s.a, clamp(d, 0.0, 1.0)) + vec3(sc) * s.a, s.a); }`);

// ---- Perspective ------------------------------------------------------------
fx3('longshadow', 'Long Shadow', 'Perspective', 'A long flat shadow trailing away at an angle.', [S('angle', 'Angle°', 45, -180, 180, 1), S('len', 'Length', 0.25, 0, 1.5), S('opac', 'Opacity', 0.5, 0, 1), C('tint', 'Shadow Colour', '#FF000000'), B('fade', 'Fade Out', true)], `
void main(){ vec2 uv = acScreenNorm; vec4 s = tfGet(uv); float a = radians(angle); vec2 d = vec2(cos(a) / xAsp(), sin(a)) * len; float m = 0.0;
  for (int i = 1; i <= 48; i++) { float t = float(i) / 48.0; m = max(m, tfGetT(uv - d * t).a * (fade ? 1.0 - t : 1.0)); } gl_FragColor = xOver(s, vec4(tint.rgb, 1.0) * m * opac); }`);
fx3('radialshadow', 'Radial Shadow', 'Perspective', 'A shadow thrown away from a light you can place.', [S('lx', 'Light X', 0.5, -1, 2), S('ly', 'Light Y', 0, -1, 2), S('amount', 'Distance', 0.15, 0, 1), S('opac', 'Opacity', 0.5, 0, 1), C('tint', 'Shadow Colour', '#FF000000')], `
void main(){ vec2 uv = acScreenNorm; vec4 s = tfGet(uv); vec2 d = (uv - vec2(lx, ly)) * amount; float m = 0.0; for (int i = 1; i <= 32; i++) m = max(m, tfGetT(uv - d * float(i) / 32.0).a); gl_FragColor = xOver(s, vec4(tint.rgb, 1.0) * m * opac); }`);
fx3('bevel', 'Bevel Alpha', 'Perspective', 'Gives the edges of a cutout or text a raised, lit look.', [S('thick', 'Edge Thickness', 4, 0.5, 30, 0.5), S('angle', 'Light Angle°', -60, -180, 180, 1), S('amount', 'Light Strength', 0.6, 0, 2)], `
void main(){ vec2 uv = acScreenNorm; vec4 s = tfGet(uv); vec2 px = thick * tfK() / acScreenSize; float ax = tfGetT(uv + vec2(px.x, 0.0)).a - tfGetT(uv - vec2(px.x, 0.0)).a; float ay = tfGetT(uv + vec2(0.0, px.y)).a - tfGetT(uv - vec2(0.0, px.y)).a;
  float a = radians(angle); float lit = dot(vec2(ax, ay), vec2(cos(a), sin(a))); gl_FragColor = vec4(clamp(s.rgb - lit * amount * s.a, 0.0, 1.0), s.a); }`);
fx3('cylinder', 'Cylinder', 'Perspective', 'Wraps the picture around a turning cylinder.', [S('turn', 'Rotation', 0, -2, 2), S('speed', 'Spin Speed', 0, -3, 3), S('wrap', 'Wrap Amount', 1, 0.2, 3), S('shade', 'Shading', 0.6, 0, 1)], `
void main(){ vec2 uv = acScreenNorm; float x = (uv.x - 0.5) * 2.0; if (abs(x) >= 1.0) { gl_FragColor = vec4(0.0); return; } float a = asin(x); vec4 c = tfGet(vec2(fract(a / 3.14159 * wrap * 0.5 + 0.5 + turn + acTime * speed), uv.y)); gl_FragColor = vec4(c.rgb * mix(1.0, cos(a), shade), c.a); }`);
fx3('sphere', 'Sphere', 'Perspective', 'Wraps the picture around a spinning ball.', [S('size', 'Size', 0.45, 0.05, 1), S('turn', 'Rotation', 0, -2, 2), S('speed', 'Spin Speed', 0.1, -3, 3), S('shade', 'Shading', 0.7, 0, 1)], `
void main(){ vec2 p = acScreenNorm - 0.5; p.x *= xAsp(); p /= size; float r = length(p); if (r >= 1.0) { gl_FragColor = vec4(0.0); return; } float z = sqrt(1.0 - r * r); float lon = atan(p.x, z); float lat = asin(clamp(p.y, -1.0, 1.0));
  vec4 c = tfGet(vec2(fract(lon / 6.28318 + 0.5 + turn + acTime * speed), lat / 3.14159 + 0.5)); float lit = mix(1.0, clamp(z * 0.8 + 0.2 + p.x * -0.2 - p.y * 0.3, 0.0, 1.2), shade); gl_FragColor = vec4(c.rgb * lit, c.a) * smoothstep(1.0, 0.98, r); }`);
fx3('basic3d', 'Basic 3D', 'Perspective', 'Swivels and tilts the layer in 3D space with real perspective.', [S('swivel', 'Swivel°', 30, -89, 89, 0.5), S('tilt', 'Tilt°', 0, -89, 89, 0.5), S('dist', 'Camera Distance', 1.5, 0.4, 6), S('spec', 'Shine', 0.15, 0, 1)], `
void main(){ vec2 sp = acScreenNorm - 0.5; float asp = xAsp(); sp.x *= asp; float sw = radians(swivel); float ti = radians(tilt); vec3 r1 = vec3(cos(sw), sin(sw) * sin(ti), -sin(sw) * cos(ti)); vec3 r2 = vec3(0.0, cos(ti), sin(ti));
  vec2 A = dist * r1.xy - sp * r1.z; vec2 Bv = dist * r2.xy - sp * r2.z; vec2 Cc = sp * dist; float det = A.x * Bv.y - A.y * Bv.x; if (abs(det) < 1e-6) { gl_FragColor = vec4(0.0); return; }
  float x = (Cc.x * Bv.y - Cc.y * Bv.x) / det; float y = (A.x * Cc.y - A.y * Cc.x) / det; if (dist + x * r1.z + y * r2.z <= 0.0) { gl_FragColor = vec4(0.0); return; }
  vec4 c = tfGetT(vec2(x / asp, y) + 0.5); float hl = pow(max(0.0, 1.0 - abs(x / asp - sin(sw) * 0.6)), 6.0) * spec * abs(sin(sw)); gl_FragColor = vec4(c.rgb * (1.0 - abs(sin(sw)) * 0.25) + hl * c.a, c.a); }`);
fx3('innershadow', 'Inner Shadow', 'Perspective', 'A shadow inside the edges, so the layer looks cut into the page.', [S('angle', 'Angle°', 135, -180, 180, 1), S('dist', 'Distance', 8, 0, 80, 0.5), S('soft', 'Softness', 8, 0, 60, 0.5), S('opac', 'Opacity', 0.6, 0, 1), C('tint', 'Shadow Colour', '#FF000000')], `
void main(){ vec2 uv = acScreenNorm; vec4 s = tfGet(uv); float a = radians(angle); vec2 o = vec2(cos(a), sin(a)) * dist * tfK() / acScreenSize; float m = 1.0 - xBlur(uv - o, soft * tfK()).a; if (uv.x - o.x < 0.0 || uv.x - o.x > 1.0 || uv.y - o.y < 0.0 || uv.y - o.y > 1.0) m = 1.0;
  gl_FragColor = vec4(mix(tfUn(s), tint.rgb, clamp(m * opac, 0.0, 1.0)) * s.a, s.a); }`);
fx3('reflection', 'Floor Reflection', 'Perspective', 'Mirrors the layer below a floor line and fades it out.', [S('floorY', 'Floor Line', 0.75, 0, 1), S('opac', 'Opacity', 0.4, 0, 1), S('falloff', 'Fade Length', 0.25, 0.01, 1)], `
void main(){ vec2 uv = acScreenNorm; vec4 s = tfGet(uv); if (uv.y <= floorY) { gl_FragColor = s; return; } vec4 r = tfGetT(vec2(uv.x, 2.0 * floorY - uv.y)) * opac * clamp(1.0 - (uv.y - floorY) / falloff, 0.0, 1.0); gl_FragColor = xOver(s, r); }`);

// ---- Simulation ---------------------------------------------------------------
fx3('rain', 'Rainfall', 'Simulation', 'Falling rain in several layers of depth.', [S('density', 'Amount', 0.5, 0, 1), S('speed', 'Speed', 2, 0.2, 8), S('slant', 'Wind', 0.15, -1, 1), S('opac', 'Opacity', 0.5, 0, 1)], `
void main(){ vec2 uv = acScreenNorm; float a = 0.0; for (int i = 0; i < 3; i++) { float L = 1.0 + float(i) * 0.7; vec2 q = vec2((uv.x + uv.y * slant) * xAsp() * 45.0 * L, uv.y * 3.0 * L + acTime * speed * L * -1.0); q.y = -q.y; vec2 g = floor(q); vec2 f = fract(q);
    f.y = fract(f.y + tfHash(g.xx + float(i))); a += smoothstep(0.12, 0.0, abs(f.x - 0.5)) * smoothstep(0.0, 0.3, f.y) * smoothstep(0.75, 0.3, f.y) * step(1.0 - density, tfHash(g + float(i) * 7.0)) / L; }
  gl_FragColor = xAdd(tfGet(uv), vec3(0.8, 0.88, 1.0) * a * opac); }`);
fx3('snow', 'Snowfall', 'Simulation', 'Drifting snowflakes in several layers.', [S('density', 'Amount', 0.6, 0, 1), S('speed', 'Fall Speed', 0.25, 0, 3), S('wind', 'Wind', 0.1, -1, 1), S('size', 'Flake Size', 1, 0.3, 4)], `
void main(){ vec2 uv = acScreenNorm; float a = 0.0; for (int i = 0; i < 4; i++) { float fi = float(i); float sc = 8.0 + fi * 7.0; vec2 q = uv * vec2(xAsp(), 1.0) * sc; q.y -= acTime * speed * (1.0 + fi * 0.5) * sc * 0.3; q.x += acTime * wind * sc * 0.3 + sin(acTime * 0.6 + fi) * 0.4;
    vec2 g = floor(q); vec2 o = xH2(g + fi * 3.0) - 0.5; float d = length(fract(q) - 0.5 - o * 0.6); a += smoothstep(0.06 * size, 0.0, d) * step(1.0 - density, tfHash(g + fi * 13.0)) * (1.0 - fi * 0.18); }
  gl_FragColor = xAdd(tfGet(uv), vec3(a)); }`);
fx3('bubbles', 'Bubbles', 'Simulation', 'Shiny bubbles floating upward.', [S('amount', 'Opacity', 0.7, 0, 1), S('size', 'Size', 0.06, 0.01, 0.3), S('speed', 'Speed', 0.2, 0, 2)], `
void main(){ vec2 uv = acScreenNorm; vec3 a = vec3(0.0); for (int i = 0; i < 18; i++) { float fi = float(i); vec2 c = vec2(tfHash(vec2(fi, 1.0)) + sin(acTime + fi) * 0.02, fract(tfHash(vec2(fi, 2.0)) - acTime * speed * (0.5 + tfHash(vec2(fi, 3.0)))));
    c.y = c.y * 1.3 - 0.15; vec2 p = uv - c; p.x *= xAsp(); float r = size * (0.4 + tfHash(vec2(fi, 4.0))); float d = length(p) / r; float rim = smoothstep(1.0, 0.92, d) * smoothstep(0.7, 1.0, d);
    float hl = smoothstep(0.25, 0.0, length(p / r - vec2(-0.35, -0.35))); a += vec3(0.7, 0.9, 1.0) * rim * 0.7 + vec3(hl) * step(d, 1.0) * 0.8 + vec3(0.2, 0.3, 0.4) * smoothstep(1.0, 0.9, d) * 0.15; }
  gl_FragColor = xAdd(tfGet(uv), a * amount); }`);
fx3('pixelexplode', 'Pixel Explode', 'Simulation', 'Blows the layer apart into flying squares. Keyframe Progress from 0 to 1.', [S('prog', 'Progress', 0.3, 0, 1), S('blocks', 'Blocks', 24, 4, 120, 1), S('force', 'Force', 1, 0, 4), S('grav', 'Gravity', 0.5, -2, 2)], `
vec2 dsp(vec2 g, vec2 n){ vec2 c = (g + 0.5) / n - 0.5; vec2 d = normalize(c + 1e-4) * (0.3 + tfHash(g)) + (xH2(g + 5.0) - 0.5) * 0.6; return d * prog * force * 0.8 + vec2(0.0, grav * prog * prog); }
void main(){ vec2 uv = acScreenNorm; vec2 n = vec2(blocks * xAsp(), blocks); vec2 q = uv; vec2 g = floor(q * n); for (int i = 0; i < 4; i++) { g = floor(q * n); q = uv - dsp(g, n); }
  if (floor(q * n) != g) { gl_FragColor = vec4(0.0); return; } gl_FragColor = tfGetT(q) * (1.0 - smoothstep(0.6, 1.0, prog)); }`);
fx3('shatter', 'Shatter', 'Simulation', 'Breaks the layer into glass shards that fall away. Keyframe Progress from 0 to 1.', [S('prog', 'Progress', 0.3, 0, 1), S('pieces', 'Pieces', 10, 3, 60, 1), S('force', 'Force', 1, 0, 4), S('grav', 'Gravity', 1, -2, 3)], `
vec2 dsp(vec2 id){ vec2 d = (xH2(id) - 0.5) * 1.2 + normalize(id / pieces - 0.5 + 1e-4) * 0.4; return d * prog * force * 0.6 + vec2(0.0, grav * prog * prog * (0.6 + tfHash(id + 2.0))); }
void main(){ vec2 uv = acScreenNorm; vec2 n = vec2(pieces * xAsp(), pieces); vec2 q = uv; vec2 id = vec2(0.0); for (int i = 0; i < 4; i++) { id = xVor(q * n).yz; q = uv - dsp(id); }
  if (xVor(q * n).yz != id) { gl_FragColor = vec4(0.0); return; } vec4 c = tfGetT(q); gl_FragColor = vec4(c.rgb * (1.0 + (tfHash(id) - 0.5) * 0.5 * min(prog * 4.0, 1.0)), c.a) * (1.0 - smoothstep(0.7, 1.0, prog)); }`);
fx3('carddance', 'Card Dance', 'Simulation', 'Cuts the layer into cards that pulse and flip to a rhythm.', [S('cols', 'Columns', 8, 1, 40, 1), S('rows', 'Rows', 6, 1, 40, 1), S('amount', 'Amount', 0.5, 0, 1), S('speed', 'Speed', 2, 0, 12, 0.1)], `
void main(){ vec2 uv = acScreenNorm; vec2 n = vec2(cols, rows); vec2 g = floor(uv * n); vec2 f = fract(uv * n) - 0.5; float w = sin(acTime * speed + tfHash(g) * 6.28318); float sc = 1.0 - amount * (0.5 + 0.5 * w) * 0.9; f.x /= max(sc, 1e-3);
  if (abs(f.x) > 0.5) { gl_FragColor = vec4(0.0); return; } vec4 c = tfGet((g + f + 0.5) / n); gl_FragColor = vec4(c.rgb * (0.6 + 0.4 * sc), c.a); }`);
fx3('caustics', 'Caustics', 'Simulation', 'Rippling light, like the bottom of a swimming pool.', [S('amount', 'Brightness', 0.6, 0, 3), S('size', 'Scale', 5, 1, 30, 0.1), S('speed', 'Speed', 0.6, 0, 5), C('tint', 'Colour', '#FFBDF4FF')], `
void main(){ vec2 uv = acScreenNorm; vec4 s = tfGet(uv); vec2 q = uv * vec2(xAsp(), 1.0) * size; float t = acTime * speed; float a = abs(xFbm(q + vec2(t * 0.6, t * 0.3)) - 0.5) * 2.0; float b = abs(xFbm(q * 1.3 - vec2(t * 0.4, -t * 0.5) + 7.0) - 0.5) * 2.0;
  gl_FragColor = vec4(s.rgb + tint.rgb * pow(1.0 - min(a, b), 7.0) * amount * s.a, s.a); }`);
fx3('confetti', 'Confetti', 'Simulation', 'Colourful paper pieces tumbling down.', [S('amount', 'Amount', 0.7, 0, 1), S('size', 'Piece Size', 0.012, 0.003, 0.06, 0.001), S('speed', 'Fall Speed', 0.35, 0, 3)], `
void main(){ vec2 uv = acScreenNorm; vec4 acc = vec4(0.0); for (int i = 0; i < 40; i++) { float fi = float(i); if (tfHash(vec2(fi, 9.0)) > amount) continue; vec2 c = vec2(tfHash(vec2(fi, 1.0)) + sin(acTime * 1.3 + fi) * 0.03, fract(tfHash(vec2(fi, 2.0)) + acTime * speed * (0.5 + tfHash(vec2(fi, 3.0)))) * 1.2 - 0.1);
    vec2 p = uv - c; p.x *= xAsp(); p = xRot(p, acTime * (2.0 + tfHash(vec2(fi, 4.0)) * 4.0) + fi); p.y /= max(abs(cos(acTime * 3.0 + fi)), 0.15); float k = step(abs(p.x), size) * step(abs(p.y), size * 0.6);
    acc = xOver(acc, vec4(xRgb(vec3(tfHash(vec2(fi, 5.0)), 0.85, 1.0)), 1.0) * k); }
  gl_FragColor = xOver(acc, tfGet(uv)); }`);
fx3('sparks', 'Sparks / Embers', 'Simulation', 'Glowing embers rising and flickering.', [S('amount', 'Brightness', 1, 0, 3), S('speed', 'Rise Speed', 0.3, 0, 3), S('size', 'Size', 1, 0.3, 4), C('tint', 'Colour', '#FFFF8A2B')], `
void main(){ vec2 uv = acScreenNorm; vec3 a = vec3(0.0); for (int i = 0; i < 28; i++) { float fi = float(i); float life = fract(tfHash(vec2(fi, 2.0)) + acTime * speed * (0.4 + tfHash(vec2(fi, 3.0)))); vec2 c = vec2(tfHash(vec2(fi, 1.0)) + sin(life * 9.0 + fi) * 0.04, 1.05 - life * 1.15);
    vec2 p = uv - c; p.x *= xAsp(); float g = 0.0006 * size / (dot(p, p) + 0.00005) * (1.0 - life) * (0.6 + 0.4 * sin(acTime * 20.0 + fi * 3.0)); a += tint.rgb * min(g, 3.0); }
  gl_FragColor = xAdd(tfGet(uv), a * amount * 0.25); }`);

// ---- Wipes (keyframe Completion from 0 to 1) --------------------------------------
fx3('linearwipe', 'Linear Wipe', 'Transition', 'Wipes the layer away along a straight line.', [S('done', 'Completion', 0.5, 0, 1), S('angle', 'Angle°', 0, -180, 180, 1), S('feather', 'Feather', 0.05, 0, 1)], `
void main(){ vec2 uv = acScreenNorm; float a = radians(angle); vec2 d = vec2(cos(a), sin(a)); float v = dot(uv - 0.5, d) / (abs(d.x) + abs(d.y)) + 0.5; gl_FragColor = tfGet(uv) * smoothstep(done * (1.0 + feather) - feather - 1e-4, done * (1.0 + feather), v); }`);
fx3('radialwipe', 'Radial Wipe', 'Transition', 'Wipes around the centre like a clock hand.', [S('done', 'Completion', 0.5, 0, 1), S('startang', 'Start Angle°', 0, -180, 180, 1), B('ccw', 'Counter-clockwise', false), S('feather', 'Feather', 0.01, 0, 0.3)], `
void main(){ vec2 uv = acScreenNorm; vec2 p = uv - 0.5; p.x *= xAsp(); float a = fract((atan(p.x, -p.y) - radians(startang)) / 6.28318); if (ccw) a = 1.0 - a; gl_FragColor = tfGet(uv) * smoothstep(done * (1.0 + feather) - feather - 1e-4, done * (1.0 + feather), a); }`);
fx3('venetian', 'Venetian Blinds', 'Transition', 'Wipes with a set of closing blinds.', [S('done', 'Completion', 0.5, 0, 1), S('blinds', 'Blinds', 12, 2, 80, 1), S('angle', 'Angle°', 90, -180, 180, 1)], `
void main(){ vec2 uv = acScreenNorm; float a = radians(angle); gl_FragColor = tfGet(uv) * step(done, fract(dot((uv - 0.5) * vec2(xAsp(), 1.0), vec2(cos(a), sin(a))) * blinds) + 0.0001); }`);
fx3('blockdissolve', 'Block Dissolve', 'Transition', 'The layer vanishes in random blocks.', [S('done', 'Completion', 0.5, 0, 1), S('size', 'Block Size', 30, 1, 300, 1), S('feather', 'Feather', 0, 0, 0.5)], `
void main(){ vec2 uv = acScreenNorm; float hv = tfHash(floor(uv * acScreenSize / (size * tfK()))); gl_FragColor = tfGet(uv) * smoothstep(done - feather - 1e-4, done + feather, hv * 0.998 + 0.001) * step(done, 0.9999); }`);
fx3('gradientwipe', 'Gradient Wipe', 'Transition', 'Dark parts of the layer disappear first (or bright parts).', [S('done', 'Completion', 0.5, 0, 1), S('feather', 'Softness', 0.1, 0, 1), B('invert', 'Bright First', false)], `
void main(){ vec4 s = tfGet(acScreenNorm); float l = tfLum(tfUn(s)); if (invert) l = 1.0 - l; gl_FragColor = s * smoothstep(done * (1.0 + feather) - feather - 1e-4, done * (1.0 + feather), l * 0.998 + 0.001) * step(done, 0.9999); }`);
fx3('iriswipe', 'Iris Wipe', 'Transition', 'Closes in on a point through a shaped iris.', [S('done', 'Completion', 0.5, 0, 1), S('pts', 'Iris Points (0 = round)', 0, 0, 12, 1), S('cx', 'Center X', 0.5, 0, 1), S('cy', 'Center Y', 0.5, 0, 1), S('feather', 'Feather', 0.01, 0, 0.3)], `
void main(){ vec2 uv = acScreenNorm; vec2 p = uv - vec2(cx, cy); p.x *= xAsp(); float r = length(p); if (pts >= 3.0) { float seg = 6.28318 / pts; r *= cos(mod(atan(p.x, -p.y), seg) - seg * 0.5) / cos(seg * 0.5); }
  float R = (1.0 - done) * 1.25; gl_FragColor = tfGet(uv) * smoothstep(R + feather, R - 1e-4, r); }`);
fx3('cardwipe', 'Card Wipe', 'Transition', 'Flips the layer away in a row of cards.', [S('done', 'Completion', 0.5, 0, 1), S('cards', 'Cards', 8, 1, 40, 1), B('vertical', 'Rows Instead', false)], `
void main(){ vec2 uv = acScreenNorm; float x = vertical ? uv.y : uv.x; float i = floor(x * cards); float t = clamp(done * 1.5 - i / cards * 0.5, 0.0, 1.0); float f = (fract(x * cards) - 0.5) / max(cos(t * 1.5708), 1e-3);
  if (abs(f) > 0.5) { gl_FragColor = vec4(0.0); return; } float nx = (i + f + 0.5) / cards; vec4 c = tfGet(vertical ? vec2(uv.x, nx) : vec2(nx, uv.y)); gl_FragColor = vec4(c.rgb * (1.0 - t * 0.5), c.a); }`);
fx3('glasswipe', 'Glass Wipe', 'Transition', 'A wipe with a wobbly glass edge.', [S('done', 'Completion', 0.5, 0, 1), S('size', 'Glass Scale', 6, 1, 40, 0.5), S('amount', 'Bend', 0.5, 0, 2)], `
void main(){ vec2 uv = acScreenNorm; float n = xFbm(uv * vec2(xAsp(), 1.0) * size); float edge = uv.x * 0.7 + n * 0.3; float d = edge - done * 1.05; float near = smoothstep(0.15, 0.0, abs(d));
  gl_FragColor = tfGet(uv + vec2(n - 0.5) * near * amount * 0.15) * step(0.0, d) + vec4(1.0) * near * near * 0.15 * step(0.0, d); }`);

// ---- Social looks -------------------------------------------------------------
fx3('prism', 'Prism', 'Stylize', 'Three ghosted colour copies, like looking through a prism.', [S('amount', 'Spread', 0.04, 0, 0.3, 0.001), S('angle', 'Angle°', 0, -180, 180, 1), S('speed', 'Rotate Speed', 0.3, -5, 5), S('strength', 'Ghost Strength', 0.6, 0, 1)], `
void main(){ vec2 uv = acScreenNorm; vec4 s = tfGet(uv); float a = radians(angle) + acTime * speed; vec3 g = vec3(0.0); for (int i = 0; i < 3; i++) { float t = a + float(i) * 2.0944; vec2 o = vec2(cos(t) / xAsp(), sin(t)) * amount;
    g += tfGet(uv + o).rgb * (i == 0 ? vec3(1.0, 0.2, 0.3) : i == 1 ? vec3(0.2, 1.0, 0.4) : vec3(0.3, 0.3, 1.0)); }
  gl_FragColor = vec4(clamp(mix(s.rgb, max(s.rgb, g), strength), 0.0, 1.0), max(s.a, 0.0)); }`);
fx3('filmburn', 'Film Burn', 'Light', 'Orange light burning in from the edge of the frame.', [S('amount', 'Amount', 0.6, 0, 1), S('pos', 'Position', 0, 0, 1), S('speed', 'Flicker Speed', 0.8, 0, 6), C('tint', 'Colour', '#FFFF6A1A')], `
void main(){ vec2 uv = acScreenNorm; vec4 s = tfGet(uv); float n = xFbm(vec2(uv.x * 2.0 + acTime * speed, uv.y * 2.0 - acTime * speed * 0.6)); float m = smoothstep(1.0 - amount, 1.3 - amount * 0.5, n * 0.7 + (1.0 - abs(uv.x - pos)) * 0.55);
  gl_FragColor = xAdd(s, tint.rgb * m + vec3(1.0, 0.9, 0.6) * m * m * 0.7); }`);
fx3('neonoutline', 'Neon Outline', 'Stylize', 'A glowing line that follows the edge of a cutout, sticker or text.', [S('width', 'Line Width', 6, 1, 40, 0.5), S('glowamt', 'Glow', 1.5, 0, 5), C('tint', 'Colour', '#FF14E0C8'), S('flick', 'Flicker', 0, 0, 1), B('hide', 'Hide the Layer', false)], `
void main(){ vec2 uv = acScreenNorm; vec4 s = tfGet(uv); vec2 px = tfK() / acScreenSize; float m1 = 0.0; float m2 = 0.0; for (int i = 0; i < 16; i++) { float a = float(i) * 0.3927; vec2 d = vec2(cos(a), sin(a)); m1 = max(m1, tfGetT(uv + d * px * width).a); m2 += tfGetT(uv + d * px * width * 3.0).a; }
  float line = clamp(m1 - s.a, 0.0, 1.0); float gl = clamp(m2 / 16.0 - s.a, 0.0, 1.0) * glowamt * 0.6; float f = 1.0 - flick * step(0.6, tfHash(vec2(floor(acTime * 18.0), 3.0))) * 0.6;
  vec4 o = vec4(tint.rgb * (line + gl) * f + vec3(line * 0.5 * f), clamp(line + gl, 0.0, 1.0) * f); gl_FragColor = hide ? o : xOver(s, o); }`);
fx3('shadowclone', 'Shadow Clone', 'Stylize', 'A fan of fading copies behind the layer.', [S('count', 'Copies', 4, 1, 8, 1), S('dx', 'Offset X', 0.04, -0.5, 0.5, 0.001), S('dy', 'Offset Y', 0, -0.5, 0.5, 0.001), S('fade', 'Fade', 0.6, 0.1, 1), C('tint', 'Tint', '#FF14E0C8'), S('tintamt', 'Tint Amount', 0.6, 0, 1)], `
void main(){ vec2 uv = acScreenNorm; vec4 o = tfGet(uv); float op = 1.0; for (int i = 1; i <= 8; i++) { if (float(i) > count) break; op *= fade; vec4 c = tfGetT(uv - vec2(dx, dy) * float(i)); c.rgb = mix(c.rgb, tint.rgb * c.a, tintamt); o = xOver(o, c * op); } gl_FragColor = o; }`);
fx3('trails', 'Motion Trails', 'Stylize', 'Streaks of copies behind the layer while it moves.', [S('spacing', 'Spacing', 1.5, 0.2, 8, 0.1), S('fade', 'Fade', 0.75, 0.1, 1), S('mindist', 'Extra Trail (still layers)', 0, 0, 60, 1), S('angle', 'Extra Trail Angle°', 180, -180, 180, 1)], `
void main(){ vec2 uv = acScreenNorm; vec4 o = tfGet(uv); float a = radians(angle); vec2 v = (acVelocity * -1.0 + vec2(cos(a), sin(a)) * mindist * tfK()) * spacing / acScreenSize; float op = 1.0; for (int i = 1; i <= 10; i++) { op *= fade; o = xOver(o, tfGetT(uv - v * float(i)) * op); } gl_FragColor = o; }`);
fx3('freezeoutline', 'Sticker Outline', 'Stylize', 'A thick white border and soft shadow, like a freeze-frame cutout.', [S('width', 'Border Width', 10, 1, 60, 0.5), C('tint', 'Border Colour', '#FFFFFFFF'), S('shadowamt', 'Shadow', 0.5, 0, 1)], `
void main(){ vec2 uv = acScreenNorm; vec4 s = tfGet(uv); vec2 px = tfK() / acScreenSize; float m = 0.0; float sh = 0.0; for (int i = 0; i < 24; i++) { float a = float(i) * 0.2618; vec2 d = vec2(cos(a), sin(a)); m = max(m, tfGetT(uv + d * px * width).a); m = max(m, tfGetT(uv + d * px * width * 0.5).a);
    sh += tfGetT(uv + d * px * width * 1.8 - vec2(0.0, px.y * width * 0.8)).a; }
  vec4 o = xOver(s, vec4(tint.rgb, 1.0) * m); gl_FragColor = xOver(o, vec4(0.0, 0.0, 0.0, 1.0) * clamp(sh / 24.0, 0.0, 1.0) * shadowamt); }`);
fx3('basspulse', 'Bass Pulse', 'Motion', 'Thumps the picture in time with a beat. Set the BPM, or link Punch to a sound with audio().', [S('bpm', 'Beats per Minute', 120, 30, 240, 1), S('amount', 'Punch', 0.5, 0, 2), S('decay', 'Decay', 6, 1, 20, 0.5), S('flashamt', 'Flash', 0.15, 0, 1)], `
void main(){ vec2 uv = acScreenNorm; float k = exp(-fract(acTime * bpm / 60.0) * decay) * amount; vec4 c = tfGet(0.5 + (uv - 0.5) / (1.0 + k * 0.2)); gl_FragColor = vec4(c.rgb * (1.0 + k * flashamt * 2.0), c.a); }`);
fx3('rgbghost', 'RGB Ghost Trails', 'Stylize', 'Red and blue ghosts that lag behind movement.', [S('amount', 'Trail Length', 3, 0, 12, 0.1), S('mindist', 'Minimum Split', 6, 0, 80, 0.5), S('angle', 'Split Angle°', 0, -180, 180, 1)], `
void main(){ vec2 uv = acScreenNorm; float a = radians(angle); vec2 v = (acVelocity * amount + vec2(cos(a), sin(a)) * mindist * tfK()) / acScreenSize; vec4 s = tfGet(uv); vec4 r = tfGetT(uv - v); vec4 b = tfGetT(uv + v); gl_FragColor = vec4(r.r, s.g, b.b, max(s.a, max(r.a, b.a))); }`);
fx3('dreamglow', 'Dreamy Glow', 'Light', 'A soft, hazy bloom over the whole shot.', [S('amount', 'Glow', 0.6, 0, 2), S('radius', 'Softness', 30, 4, 120, 1), S('warm', 'Warmth', 0.2, -1, 1)], `
void main(){ vec2 uv = acScreenNorm; vec4 s = tfGet(uv); vec3 b = xBlur(uv, radius * tfK()).rgb; b *= vec3(1.0 + warm * 0.2, 1.0, 1.0 - warm * 0.2); gl_FragColor = vec4(1.0 - (1.0 - clamp(s.rgb, 0.0, 1.0)) * (1.0 - clamp(b * amount, 0.0, 1.0)), s.a); }`);
fx3('camcorder', 'Camcorder Overlay', 'Stylize', 'A blinking REC dot and viewfinder corners.', [S('margin', 'Margin', 0.06, 0.01, 0.3), B('rec', 'REC Dot', true), C('tint', 'Line Colour', '#FFFFFFFF')], `
void main(){ vec2 uv = acScreenNorm; vec4 s = tfGet(uv); float asp = xAsp(); vec2 m = vec2(margin / asp, margin); vec2 d = min(uv - m, 1.0 - m - uv); float th = 0.004; float L = 0.07;
  float k = 0.0; vec2 q = vec2(min(uv.x - m.x, 1.0 - m.x - uv.x) * asp, min(uv.y - m.y, 1.0 - m.y - uv.y)); if (q.x > -th && q.y > -th) { if (abs(q.x) < th && q.y < L) k = 1.0; if (abs(q.y) < th && q.x < L) k = 1.0; }
  vec4 o = xOver(vec4(tint.rgb, 1.0) * k, s); if (rec) { vec2 c = vec2(m.x + 0.035 / asp, m.y + 0.035); vec2 p = uv - c; p.x *= asp; float dot0 = smoothstep(0.014, 0.012, length(p)) * step(0.5, fract(acTime)); o = xOver(vec4(1.0, 0.1, 0.1, 1.0) * dot0, o); }
  gl_FragColor = o; }`);
fx3('letterbox', 'Letterbox Bars', 'Stylize', 'Cinema bars at the top and bottom (or the sides).', [S('size', 'Bar Size', 0.12, 0, 0.5, 0.001), B('sides', 'Bars on the Sides', false), C('tint', 'Bar Colour', '#FF000000')], `
void main(){ vec2 uv = acScreenNorm; float x = sides ? uv.x : uv.y; float k = step(x, size) + step(1.0 - size, x); gl_FragColor = xOver(vec4(tint.rgb, 1.0) * clamp(k, 0.0, 1.0), tfGet(uv)); }`);
fx3('splitrepeat', 'Split Repeat', 'Stylize', 'Repeats the middle strip of the picture side by side.', [S('count', 'Copies', 3, 1, 8, 1), B('vertical', 'Stack Top to Bottom', false)], `
void main(){ vec2 uv = acScreenNorm; if (vertical) uv.y = 0.5 + (fract(uv.y * count) - 0.5) / count; else uv.x = 0.5 + (fract(uv.x * count) - 0.5) / count; gl_FragColor = tfGet(uv); }`);
fx3('tvstatic', 'TV Static', 'Noise', 'Snowy analogue static over the picture.', [S('amount', 'Amount', 0.4, 0, 1), S('size', 'Speck Size', 2, 1, 12, 0.5)], `
void main(){ vec2 uv = acScreenNorm; vec4 s = tfGet(uv); float n = tfHash(floor(uv * acScreenSize / (size * tfK())) + floor(acTime * 30.0) * 9.7); float band = smoothstep(0.0, 0.04, abs(fract(uv.y - acTime * 0.4) - 0.5) - 0.44) * 0.3;
  gl_FragColor = vec4(mix(s.rgb, vec3(n) * s.a, clamp(amount + band * amount, 0.0, 1.0)), s.a); }`);
fx3('hologram', 'Hologram', 'Stylize', 'A flickering blue projection with scan lines.', [S('amount', 'Amount', 1, 0, 1), C('tint', 'Colour', '#FF39C8FF'), S('lines', 'Line Count', 220, 40, 800, 1), S('jitter', 'Jitter', 0.4, 0, 1)], `
void main(){ vec2 uv = acScreenNorm; float j = (tfHash(vec2(floor(uv.y * 60.0), floor(acTime * 24.0))) - 0.5) * 0.02 * jitter * step(0.8, tfHash(vec2(floor(acTime * 12.0), 4.0))); vec4 s = tfGet(uv + vec2(j, 0.0)); float l = tfLum(tfUn(s));
  float sl = 0.65 + 0.35 * sin(uv.y * lines * 3.14159 + acTime * 6.0); float fl = 0.85 + 0.15 * sin(acTime * 40.0); float edge = clamp(xSobel(uv, 1.5 * tfK()) * 2.0, 0.0, 1.0);
  vec3 h = tint.rgb * (l * 1.2 + edge * 0.8) * sl * fl; float a = s.a * mix(1.0, sl * 0.85, amount); gl_FragColor = vec4(mix(s.rgb, h * s.a, amount) * mix(1.0, sl * 0.85 + 0.15, amount), a); }`);
fx3('colorflash', 'Beat Colour Flash', 'Light', 'Flashes a new colour on every beat.', [S('bpm', 'Beats per Minute', 120, 30, 240, 1), S('amount', 'Amount', 0.6, 0, 1), S('decay', 'Decay', 8, 1, 30, 0.5)], `
void main(){ vec4 s = tfGet(acScreenNorm); float b = acTime * bpm / 60.0; vec3 col = xRgb(vec3(tfHash(vec2(floor(b), 1.0)), 0.8, 1.0)); float k = exp(-fract(b) * decay) * amount; gl_FragColor = vec4(1.0 - (1.0 - clamp(s.rgb, 0.0, 1.0)) * (1.0 - col * k * s.a), s.a); }`);
fx3('photoframe', 'Photo Frame', 'Stylize', 'Shrinks the layer into an instant-photo style border.', [S('border', 'Border', 0.05, 0, 0.3, 0.001), S('bottom', 'Extra at the Bottom', 0.1, 0, 0.4, 0.001), C('tint', 'Frame Colour', '#FFFAFAF5')], `
void main(){ vec2 uv = acScreenNorm; float bx = border / xAsp(); vec2 lo = vec2(bx, border); vec2 hi = vec2(1.0 - bx, 1.0 - border - bottom); vec2 q = (uv - lo) / (hi - lo); vec4 f = vec4(tint.rgb, 1.0) * tfGet(uv).a;
  gl_FragColor = (q.x >= 0.0 && q.x <= 1.0 && q.y >= 0.0 && q.y <= 1.0) ? tfGet(q) : f; }`);
fx3('sliceglitch', 'Slice Glitch', 'Stylize', 'Random strips of the picture jump sideways.', [S('amount', 'Shift', 0.1, 0, 0.5), S('slices', 'Slices', 14, 2, 80, 1), S('rate', 'Glitch Speed', 10, 1, 60, 1), S('chance', 'How Often', 0.4, 0, 1)], `
void main(){ vec2 uv = acScreenNorm; float f = floor(acTime * rate); float i = floor(uv.y * slices + tfHash(vec2(f, 2.0)) * 3.0); float on = step(1.0 - chance, tfHash(vec2(i, f))); float o = (tfHash(vec2(i + 7.0, f)) - 0.5) * amount * on;
  vec4 c = tfGetT(uv + vec2(o, 0.0)); c.r = tfGetT(uv + vec2(o * 1.4, 0.0)).r; gl_FragColor = c; }`);

// "Posterize Time" is Hold Motion under its After Effects name: same controls,
// same engine, so the two always behave alike.
(() => { const h = EffectLib.get('tf.hold'); if (h) EffectLib.add({ ...h, id: 'tf.posterizetime', name: 'Posterize Time', desc: 'Lowers the frame rate of one layer (animate on twos or threes). This is Hold Motion under its After Effects name.', tags: 'time,posterize,hold,twos,threes' }); })();

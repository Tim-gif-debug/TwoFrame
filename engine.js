// ===========================================================================
// Engine: WebGL2 rendering
//
// Conventions used everywhere inside the engine:
//   * Colors are premultiplied by alpha.
//   * Texture coordinate v = 0 is the TOP row of an image. Comp pixel
//     coordinates run x right, y down, with (0,0) at the top left.
//   * Only the final present() flips the image for the screen.
// Effect shaders use GLSL ES 1.0 (gl_FragColor, texture2D), which is what
// Gold Motion / Alight Motion XML effects are written in.
// ===========================================================================

const VS_FULL = `
attribute vec2 aPos; varying vec2 vUv;
void main(){ vUv = aPos; gl_Position = vec4(aPos * 2.0 - 1.0, 0.0, 1.0); }`;

const VS_LAYER = `
attribute vec2 aPos; uniform mat3 uM; varying vec2 vUv;
void main(){ vUv = aPos; vec3 p = uM * vec3(aPos, 1.0); gl_Position = vec4(p.xy, 0.0, 1.0); }`;

const FS_HEAD = 'precision highp float;\nprecision highp int;\nvarying vec2 vUv;\n';

const FS_COPY = FS_HEAD + `uniform sampler2D uTex; uniform float uOp;
void main(){ gl_FragColor = texture2D(uTex, vUv) * uOp; }`;

// Layer draw: samples a sub-rectangle of the texture (crop).
const FS_LAYER = FS_HEAD + `uniform sampler2D uTex; uniform float uOp; uniform vec4 uUV;
void main(){ gl_FragColor = texture2D(uTex, mix(uUV.xy, uUV.zw, vUv)) * uOp; }`;

const FS_SOLID = FS_HEAD + `uniform vec4 uColor;
void main(){ gl_FragColor = vec4(uColor.rgb * uColor.a, uColor.a); }`;

const FS_PRESENT = FS_HEAD + `uniform sampler2D uTex;
void main(){ vec4 c = texture2D(uTex, vec2(vUv.x, 1.0 - vUv.y)); gl_FragColor = vec4(c.rgb, 1.0); }`;

const FS_MIX = FS_HEAD + `uniform sampler2D uA; uniform sampler2D uB; uniform float uT;
void main(){ gl_FragColor = mix(texture2D(uA, vUv), texture2D(uB, vUv), uT); }`;

// Layer blending. Modes: 0 Normal 1 Add 2 Screen 3 Multiply 4 Overlay
// 5 Lighten 6 Darken 7 Difference. uTint multiplies the source color
// (used for ghost tint), uOp fades it.
const FS_COMPOSITE = FS_HEAD + `uniform sampler2D uDst; uniform sampler2D uSrc; uniform float uOp; uniform int uMode; uniform vec3 uTint;
float bl(vec3 c){ return dot(c, vec3(0.3, 0.59, 0.11)); }
vec3 clipc(vec3 c){ float l = bl(c); float n = min(min(c.r, c.g), c.b); float x = max(max(c.r, c.g), c.b);
  if (n < 0.0) c = l + (c - l) * l / (l - n + 1e-5); if (x > 1.0) c = l + (c - l) * (1.0 - l) / (x - l + 1e-5); return c; }
vec3 setl(vec3 c, float l){ return clipc(c + (l - bl(c))); }
float satv(vec3 c){ return max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b); }
vec3 sets(vec3 c, float sv){ float n = min(min(c.r, c.g), c.b); float x = max(max(c.r, c.g), c.b); return x > n ? (c - n) * sv / (x - n) : vec3(0.0); }
void main(){
  vec4 d = texture2D(uDst, vUv); vec4 s = texture2D(uSrc, vUv); s.rgb *= uTint; s *= uOp;
  if (uMode == 0) { gl_FragColor = s + d * (1.0 - s.a); return; }
  float a = s.a + d.a - s.a * d.a;
  if (uMode == 1) { gl_FragColor = vec4(min(s.rgb + d.rgb, vec3(a)), a); return; }
  vec3 cs = clamp(s.rgb / max(s.a, 1e-4), 0.0, 1.0); vec3 cd = clamp(d.rgb / max(d.a, 1e-4), 0.0, 1.0); vec3 b;
  if (uMode == 2) b = cs + cd - cs * cd;
  else if (uMode == 3) b = cs * cd;
  else if (uMode == 4) b = mix(2.0 * cs * cd, 1.0 - 2.0 * (1.0 - cs) * (1.0 - cd), step(0.5, cd));
  else if (uMode == 5) b = max(cs, cd);
  else if (uMode == 6) b = min(cs, cd);
  else if (uMode == 7) b = abs(cs - cd);
  else if (uMode == 8) b = mix(cd - (1.0 - 2.0 * cs) * cd * (1.0 - cd), cd + (2.0 * cs - 1.0) * (sqrt(cd) - cd), step(0.5, cs));
  else if (uMode == 9) b = min(vec3(1.0), cd / max(1.0 - cs, 1e-3));
  else if (uMode == 10) b = 1.0 - min(vec3(1.0), (1.0 - cd) / max(cs, 1e-3));
  else if (uMode == 11) b = mix(2.0 * cs * cd, 1.0 - 2.0 * (1.0 - cs) * (1.0 - cd), step(0.5, cs));
  else if (uMode == 12) b = cs + cd - 2.0 * cs * cd;
  else if (uMode == 13) b = max(cs + cd - 1.0, 0.0);
  else if (uMode == 14) b = clamp(cd + 2.0 * cs - 1.0, 0.0, 1.0);
  else if (uMode == 15) b = mix(1.0 - min(vec3(1.0), (1.0 - cd) / max(2.0 * cs, 1e-3)), min(vec3(1.0), cd / max(2.0 * (1.0 - cs), 1e-3)), step(0.5, cs));
  else if (uMode == 16) b = setl(sets(cs, satv(cd)), bl(cd));
  else if (uMode == 17) b = setl(sets(cd, satv(cs)), bl(cd));
  else if (uMode == 18) b = setl(cs, bl(cd));
  else if (uMode == 19) b = setl(cd, bl(cs));
  else if (uMode == 20) b = mix(min(cd, 2.0 * cs), max(cd, 2.0 * cs - 1.0), step(0.5, cs));
  else if (uMode == 21) b = max(cd - cs, 0.0);
  else b = min(vec3(1.0), cd / max(cs, 1e-3));
  gl_FragColor = vec4(s.rgb * (1.0 - d.a) + d.rgb * (1.0 - s.a) + s.a * d.a * b, a);
}`;

// Transitions between two images A (outgoing) and B (incoming), p = 0..1.
// One shader with many modes keeps the program count low.
const FS_TRANSITION = FS_HEAD + `uniform sampler2D uA; uniform sampler2D uB; uniform float uP; uniform int uMode; uniform float uAsp;
float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
vec4 A(vec2 uv){ if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return vec4(0.0); return texture2D(uA, uv); }
vec4 B(vec2 uv){ if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return vec4(0.0); return texture2D(uB, uv); }
vec4 over(vec4 t, vec4 b){ return t + b * (1.0 - t.a); }
vec2 rt(vec2 v, float a){ return vec2(v.x * cos(a) - v.y * sin(a), v.x * sin(a) + v.y * cos(a)); }
float vn(vec2 q){ vec2 i = floor(q), f = fract(q); vec2 u = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1.0, 0.0)), u.x), mix(h(i + vec2(0.0, 1.0)), h(i + vec2(1.0, 1.0)), u.x), u.y); }
void main(){
  vec2 uv = vUv; float p = clamp(uP, 0.0, 1.0); float e = p * p * (3.0 - 2.0 * p);
  vec2 c = uv - 0.5; c.x *= uAsp;
  int m = uMode;
  if (m == 0) { gl_FragColor = mix(A(uv), B(uv), e); return; }
  if (m == 1) { vec4 k = vec4(0.0, 0.0, 0.0, 1.0); gl_FragColor = p < 0.5 ? mix(A(uv), k, p * 2.0) : mix(k, B(uv), p * 2.0 - 1.0); return; }
  if (m == 2) { vec4 w = vec4(1.0); gl_FragColor = p < 0.5 ? mix(A(uv), w, p * 2.0) : mix(w, B(uv), p * 2.0 - 1.0); return; }
  if (m >= 3 && m <= 6) { vec2 d = m == 3 ? vec2(-1.0, 0.0) : m == 4 ? vec2(1.0, 0.0) : m == 5 ? vec2(0.0, -1.0) : vec2(0.0, 1.0);
    gl_FragColor = over(B(uv + d * (1.0 - e)), A(uv - d * e)); return; }
  if (m >= 7 && m <= 10) { float x = m == 7 ? 1.0 - uv.x : m == 8 ? uv.x : m == 9 ? 1.0 - uv.y : uv.y;
    float k = smoothstep(e - 0.02, e + 0.02, x); gl_FragColor = mix(B(uv), A(uv), k); return; }
  if (m == 11) { float r = length(c); float k = smoothstep(e * 1.2 - 0.02, e * 1.2 + 0.02, r); gl_FragColor = mix(B(uv), A(uv), k); return; }
  if (m == 12) { float r = length(c); float k = smoothstep((1.0 - e) * 1.2 - 0.02, (1.0 - e) * 1.2 + 0.02, r); gl_FragColor = mix(A(uv), B(uv), k); return; }
  if (m == 13) { float r = abs(c.x) + abs(c.y); float k = smoothstep(e * 1.6 - 0.02, e * 1.6 + 0.02, r); gl_FragColor = mix(B(uv), A(uv), k); return; }
  if (m == 14) { float a = atan(c.x, -c.y) / 6.28318 + 0.5; float k = step(e, a); gl_FragColor = mix(B(uv), A(uv), k); return; }
  if (m == 15) { gl_FragColor = mix(A((uv - 0.5) / (1.0 + e) + 0.5), B((uv - 0.5) / (2.0 - e) + 0.5), e); return; }
  if (m == 16) { vec4 a = A((uv - 0.5) * (1.0 + e) + 0.5); vec4 b = B((uv - 0.5) * (2.0 - e) + 0.5); gl_FragColor = mix(a, b, e); return; }
  if (m == 17) { float ang = (1.0 - e) * 6.28318 * (p < 0.5 ? 0.0 : 1.0) + e * 0.0; vec2 q = c; float a2 = p < 0.5 ? e * 3.14159 : (1.0 - e) * -3.14159;
    q = vec2(q.x * cos(a2) - q.y * sin(a2), q.x * sin(a2) + q.y * cos(a2)); float z = 1.0 + sin(p * 3.14159) * 0.6; q *= z; q.x /= uAsp; gl_FragColor = p < 0.5 ? A(q + 0.5) : B(q + 0.5); return; }
  if (m == 18) { vec4 acc = vec4(0.0); float r = sin(p * 3.14159) * 0.03; for (int i = 0; i < 12; i++) { float a = float(i) * 0.5236; vec2 o = vec2(cos(a), sin(a)) * r;
    acc += mix(A(uv + o), B(uv + o), e); } gl_FragColor = acc / 12.0; return; }
  if (m == 19 || m == 20) { float dir = m == 19 ? -1.0 : 1.0; vec4 acc = vec4(0.0); float bl = sin(p * 3.14159) * 0.15;
    for (int i = 0; i < 16; i++) { float t = float(i) / 15.0 - 0.5; vec2 q = uv + vec2(dir * (e + t * bl), 0.0);
      vec2 qa = q, qb = q - vec2(dir, 0.0); acc += over(B(qb), A(qa)); } gl_FragColor = acc / 16.0; return; }
  if (m == 21) { float s = sin(p * 3.14159); float bk = floor(uv.y * 18.0); float o = (h(vec2(bk, floor(p * 20.0))) - 0.5) * 0.25 * s;
    vec2 q = uv + vec2(o, 0.0); vec4 a = p < 0.5 ? A(q) : B(q); a.r = (p < 0.5 ? A(q + vec2(0.02 * s, 0.0)) : B(q + vec2(0.02 * s, 0.0))).r; gl_FragColor = a; return; }
  if (m == 22) { float s = sin(p * 3.14159); float n = max(1.0, s * 60.0); vec2 q = (floor(uv * vec2(n * uAsp, n)) + 0.5) / vec2(n * uAsp, n); if (n < 1.5) q = uv;
    gl_FragColor = mix(A(q), B(q), step(0.5, p)); return; }
  if (m == 23) { float r = length(c); float w = sin(r * 40.0 - p * 30.0) * 0.02 * sin(p * 3.14159); vec2 q = uv + normalize(c + 1e-5) * w;
    gl_FragColor = mix(A(q), B(q), e); return; }
  if (m == 24) { vec4 a = A(uv); float l = dot(a.rgb, vec3(0.299, 0.587, 0.114)); float k = smoothstep(l - 0.1, l + 0.1, e * 1.2 - 0.1); gl_FragColor = mix(a, B(uv), k); return; }
  if (m == 25) { float sx = 1.0 - e; vec2 qa = vec2((uv.x - 0.5) / max(sx, 1e-3) + 0.5, uv.y); vec2 qb = vec2((uv.x - 0.5) / max(e, 1e-3) + 0.5, uv.y);
    gl_FragColor = p < 0.5 ? A(qa) : B(qb); return; }
  if (m == 26) { float k = step(fract(uv.x * 10.0), e); gl_FragColor = mix(A(uv), B(uv), k); return; }
  if (m == 27) { vec2 g = floor(uv * vec2(8.0 * uAsp, 8.0)); float k = step(h(g) * 0.8, e - 0.1); gl_FragColor = mix(A(uv), B(uv), k); return; }
  if (m == 28) { float a = atan(c.y, c.x); float r = length(c) / (0.55 + 0.25 * cos(a * 5.0)); float k = smoothstep(e * 2.2 - 0.03, e * 2.2 + 0.03, r); gl_FragColor = mix(B(uv), A(uv), k); return; }
  if (m == 29) { vec4 acc = vec4(0.0); float st = sin(p * 3.14159) * 0.25; for (int i = 0; i < 16; i++) { float t = float(i) / 15.0; vec2 q = 0.5 + (uv - 0.5) * (1.0 - st * t);
    acc += mix(A(q), B(q), e); } gl_FragColor = acc / 16.0; return; }
  if (m == 30) { float k = step(abs(uv.x - 0.5), e * 0.5); gl_FragColor = mix(A(uv), B(uv), k); return; }
  if (m == 31) { float s = sin(p * 3.14159) * 0.03; vec4 a = mix(A(uv), B(uv), e); a.r = mix(A(uv + vec2(s, 0.0)), B(uv + vec2(s, 0.0)), e).r; a.b = mix(A(uv - vec2(s, 0.0)), B(uv - vec2(s, 0.0)), e).b; gl_FragColor = a; return; }
  if (m == 32) { float y = uv.y + (h(vec2(floor(uv.x * 40.0), 1.0)) * 0.5 + 0.5) * 0.0; float k = step(uv.y, e * 1.3 - h(vec2(floor(uv.x * 30.0), 3.0)) * 0.3); gl_FragColor = mix(A(uv), B(uv), k); return; }
  if (m == 33) { vec2 q = uv; q.y = uv.y + e; vec4 a = A(uv + vec2(0.0, e)); vec4 b = B(uv - vec2(0.0, 1.0 - e)); gl_FragColor = over(b, a); return; }
  float s = sin(p * 3.14159);
  if (m == 34) { vec2 d = vec2(-1.0, -1.0); gl_FragColor = over(B(uv + d * (1.0 - e)), A(uv - d * e)); return; }
  if (m == 35) { float k = smoothstep(e * 1.04 - 0.02, e * 1.04 + 0.02, (uv.x + uv.y) * 0.5); gl_FragColor = mix(B(uv), A(uv), k); return; }
  if (m == 36) { float a = 0.5 - atan(c.x, -c.y) / 6.28318; gl_FragColor = mix(B(uv), A(uv), step(e, a)); return; }
  if (m == 37) { gl_FragColor = mix(A(uv), B(uv), step(fract(uv.y * 10.0), e)); return; }
  if (m == 38) { vec2 g = floor(uv * vec2(8.0 * uAsp, 8.0)); float f = fract(uv.x * 8.0 * uAsp); gl_FragColor = mix(A(uv), B(uv), step(f, e * 2.0 - mod(g.x + g.y, 2.0))); return; }
  if (m == 39) { vec2 q = c / (e * 1.7 + 1e-3); q.y = -q.y + 0.25; float v = q.x * q.x + q.y * q.y - 1.0; gl_FragColor = (v * v * v - q.x * q.x * q.y * q.y * q.y < 0.0) ? B(uv) : A(uv); return; }
  if (m == 40) { gl_FragColor = mix(A(uv), B(uv), step(abs(uv.y - 0.5), e * 0.5)); return; }
  if (m == 41) { if (uv.y < 0.5) { vec2 q = uv + vec2(0.0, e * 0.5); gl_FragColor = q.y < 0.5 ? A(q) : B(uv); } else { vec2 q = uv - vec2(0.0, e * 0.5); gl_FragColor = q.y >= 0.5 ? A(q) : B(uv); } return; }
  if (m == 42) { if (uv.x < 0.5) { vec2 q = uv + vec2(e * 0.5, 0.0); gl_FragColor = q.x < 0.5 ? A(q) : B(uv); } else { vec2 q = uv - vec2(e * 0.5, 0.0); gl_FragColor = q.x >= 0.5 ? A(q) : B(uv); } return; }
  if (m == 43) { float sp = 1.0 - e; vec4 a = A(vec2(uv.x / max(sp, 1e-3), uv.y)); vec4 b = B(vec2((uv.x - sp) / max(1.0 - sp, 1e-3), uv.y));
    a.rgb *= 1.0 - e * 0.5; b.rgb *= 0.5 + e * 0.5; gl_FragColor = uv.x < sp ? a : b; return; }
  if (m == 44) { float sy = 1.0 - e; vec2 qa = vec2(uv.x, (uv.y - 0.5) / max(sy, 1e-3) + 0.5); vec2 qb = vec2(uv.x, (uv.y - 0.5) / max(e, 1e-3) + 0.5); gl_FragColor = p < 0.5 ? A(qa) : B(qb); return; }
  if (m == 45) { vec2 o = vec2(0.0, 1.0); vec2 d = uv - o; d.x *= uAsp; d = rt(d, e * 1.5708); d.x /= uAsp; gl_FragColor = over(A(d + o), B(uv)); return; }
  if (m == 46) { gl_FragColor = over(A(uv - vec2(0.0, e * e * 1.1)), B(uv)); return; }
  if (m == 47) { gl_FragColor = mix(A((uv - 0.5) / (1.0 + e * 3.0) + 0.5), B((uv - 0.5) * (1.0 + (1.0 - e) * 0.3) + 0.5), smoothstep(0.3, 0.8, p)); return; }
  if (m == 48) { float r = length(c); vec2 q = rt(c, s * 5.0 * max(0.0, 0.8 - r)); q.x /= uAsp; gl_FragColor = mix(A(q + 0.5), B(q + 0.5), e); return; }
  if (m == 49) { vec2 q = uv + vec2(sin(uv.y * 20.0 + p * 10.0) * 0.05 * s, 0.0); gl_FragColor = mix(A(q), B(q), e); return; }
  if (m == 50) { float n = vn(uv * vec2(4.0 * uAsp, 4.0)) * 0.6 + vn(uv * vec2(11.0 * uAsp, 11.0)) * 0.25 + uv.x * 0.15; float edge = e * 1.25 - 0.12;
    float k = smoothstep(edge - 0.02, edge + 0.02, n); float g = smoothstep(0.12, 0.0, abs(n - edge)) * s; gl_FragColor = mix(B(uv), A(uv), k) + vec4(1.0, 0.5, 0.1, 0.0) * g; return; }
  if (m == 51) { gl_FragColor = mix(A(uv), B(uv), e) + vec4(1.0, 0.6, 0.2, 0.0) * s * smoothstep(1.0, 0.0, abs(uv.x - p) * 2.0); return; }
  if (m == 52) { vec4 acc = vec4(0.0); float r = s * 0.04; for (int i = 0; i < 12; i++) { float a = float(i) * 0.5236; vec2 o = vec2(cos(a), sin(a)) * r; acc += mix(A(uv + o), B(uv + o), e); }
    gl_FragColor = acc / 12.0 * (1.0 + s * 0.6); return; }
  if (m == 53) { float sy = p < 0.5 ? 1.0 - p * 2.0 : p * 2.0 - 1.0; vec2 q = vec2(uv.x, (uv.y - 0.5) / max(sy, 0.004) + 0.5); vec4 col = p < 0.5 ? A(q) : B(q);
    gl_FragColor = col + vec4(1.0) * smoothstep(0.012, 0.0, abs(uv.y - 0.5)) * (1.0 - sy) * col.a + vec4(0.0, 0.0, 0.0, 1.0) * (1.0 - col.a); return; }
  if (m == 54) { vec2 n2 = vec2(10.0 * uAsp, 10.0); vec2 g = floor(uv * n2); float t = clamp(p * 1.6 - h(g) * 0.6, 0.0, 1.0); vec2 f = fract(uv * n2) - 0.5;
    gl_FragColor = max(abs(f.x), abs(f.y)) < 0.5 * (1.0 - t) ? A(uv) : B(uv); return; }
  if (m == 55) { float dir = mod(floor(uv.y * 8.0), 2.0) * 2.0 - 1.0; gl_FragColor = over(B(uv + vec2(dir * (1.0 - e), 0.0)), A(uv - vec2(dir * e, 0.0))); return; }
  if (m == 56) { vec2 q = uv + (vec2(h(vec2(floor(p * 30.0), 1.0)), h(vec2(floor(p * 30.0), 7.0))) - 0.5) * 0.09 * s; gl_FragColor = p < 0.5 ? A(q) : B(q); return; }
  if (m == 57) { vec4 k = vec4(1.0, 0.2, 0.5, 1.0); gl_FragColor = p < 0.5 ? mix(A(uv), k, p * 2.0) : mix(k, B(uv), p * 2.0 - 1.0); return; }
  if (m == 58) { vec4 col = p < 0.5 ? A(uv) : B(uv); gl_FragColor = mix(col, vec4(col.a - col.rgb, col.a), s); return; }
  if (m == 59) { float y = uv.y + sin(uv.x * 60.0) * 0.01; float k = step(y, e * 1.05); gl_FragColor = mix(A(uv), B(uv), k) + vec4(0.6, 1.0, 0.95, 0.0) * smoothstep(0.02, 0.0, abs(y - e * 1.05)) * s; return; }
  if (m == 60) { vec4 acc = vec4(0.0); for (int i = 0; i < 12; i++) { vec2 q = rt(c, (float(i) / 11.0 - 0.5) * s * 1.5); q.x /= uAsp; acc += mix(A(q + 0.5), B(q + 0.5), e); } gl_FragColor = acc / 12.0; return; }
  if (m == 61) { gl_FragColor = over(B(uv - vec2(1.0 - e, 0.0)), A(uv)); return; }
  if (m == 62) { gl_FragColor = over(B(uv - vec2(0.0, 1.0 - e)), A(uv)); return; }
  if (m == 63) { gl_FragColor = over(A((uv - 0.5) / max(1.0 - e, 1e-3) + 0.5), B(uv)); return; }
  gl_FragColor = mix(A(uv), B(uv), e);
}`;

// Track matte: keeps uSrc where the matte is opaque (alpha) or bright (luma).
const FS_MATTE = FS_HEAD + `uniform sampler2D uSrc; uniform sampler2D uMatte; uniform int uMode;
void main(){ vec4 s = texture2D(uSrc, vUv), m = texture2D(uMatte, vUv);
  float k = uMode < 2 ? m.a : dot(m.rgb, vec3(0.299, 0.587, 0.114));
  if (uMode == 1 || uMode == 3) k = 1.0 - k; gl_FragColor = s * k; }`;

// Snap Blur: averages samples trailing back along uDir (in uv units).
const FS_DIRBLUR = FS_HEAD + `uniform sampler2D uTex; uniform vec2 uDir; uniform float uTaps;
void main(){ vec4 acc = vec4(0.0); for (int i = 0; i < 48; i++) { if (float(i) >= uTaps) break;
  float t = float(i) / max(uTaps - 1.0, 1.0); acc += texture2D(uTex, vUv - uDir * t); }
  gl_FragColor = acc / uTaps; }`;

// ---- Optical flow (pyramidal Lucas-Kanade) -------------------------------
// Gray + gradient: r = dI/dx, g = dI/dy, b = I.
const FS_FLOW_GRAY = FS_HEAD + `uniform sampler2D uTex; uniform vec2 uPx;
float L(vec2 p){ vec4 c = texture2D(uTex, p); return dot(c.rgb, vec3(0.299, 0.587, 0.114)); }
void main(){ float l = (L(vUv + uPx * vec2(-0.25,-0.25)) + L(vUv + uPx * vec2(0.25,-0.25)) + L(vUv + uPx * vec2(-0.25,0.25)) + L(vUv + uPx * vec2(0.25,0.25))) * 0.25;
  gl_FragColor = vec4(l, l, l, 1.0); }`;
const FS_FLOW_GRAD = FS_HEAD + `uniform sampler2D uTex; uniform vec2 uPx;
void main(){ float c = texture2D(uTex, vUv).b;
  float gx = (texture2D(uTex, vUv + vec2(uPx.x, 0.0)).b - texture2D(uTex, vUv - vec2(uPx.x, 0.0)).b) * 0.5;
  float gy = (texture2D(uTex, vUv + vec2(0.0, uPx.y)).b - texture2D(uTex, vUv - vec2(0.0, uPx.y)).b) * 0.5;
  gl_FragColor = vec4(gx, gy, c, 1.0); }`;
// One LK refinement. uFlow holds flow in texels of this level (rg).
const FS_FLOW_LK = FS_HEAD + `uniform sampler2D uGradA; uniform sampler2D uB; uniform sampler2D uFlow; uniform vec2 uPx;
void main(){ vec2 f = texture2D(uFlow, vUv).rg; float g00 = 1e-4, g01 = 0.0, g11 = 1e-4, b0 = 0.0, b1 = 0.0;
  for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {
    vec2 o = vec2(float(i), float(j)) * uPx; vec3 ga = texture2D(uGradA, vUv + o).rgb;
    float ib = texture2D(uB, vUv + o + f * uPx).b; float it = ib - ga.b; float w = 1.0 / (1.0 + float(i*i + j*j) * 0.25);
    g00 += ga.r * ga.r * w; g01 += ga.r * ga.g * w; g11 += ga.g * ga.g * w; b0 += ga.r * it * w; b1 += ga.g * it * w; }
  float det = g00 * g11 - g01 * g01; vec2 d = vec2(0.0);
  if (abs(det) > 1e-9) d = -vec2(g11 * b0 - g01 * b1, -g01 * b0 + g00 * b1) / det;
  d = clamp(d, vec2(-2.0), vec2(2.0)); gl_FragColor = vec4(f + d, 0.0, 1.0); }`;
const FS_FLOW_SMOOTH = FS_HEAD + `uniform sampler2D uFlow; uniform vec2 uPx;
void main(){ vec2 c = texture2D(uFlow, vUv).rg * 4.0 + texture2D(uFlow, vUv + vec2(uPx.x,0.0)).rg + texture2D(uFlow, vUv - vec2(uPx.x,0.0)).rg
  + texture2D(uFlow, vUv + vec2(0.0,uPx.y)).rg + texture2D(uFlow, vUv - vec2(0.0,uPx.y)).rg; gl_FragColor = vec4(c / 8.0, 0.0, 1.0); }`;
const FS_FLOW_UP = FS_HEAD + `uniform sampler2D uFlow; void main(){ gl_FragColor = vec4(texture2D(uFlow, vUv).rg * 2.0, 0.0, 1.0); }`;
// Final in-between frame. uFlowPx converts flow texels to uv.
const FS_FLOW_WARP = FS_HEAD + `uniform sampler2D uA; uniform sampler2D uB; uniform sampler2D uFlow; uniform vec2 uFlowPx; uniform float uT;
void main(){ vec2 f = texture2D(uFlow, vUv).rg * uFlowPx;
  vec4 a = texture2D(uA, vUv - f * uT); vec4 b = texture2D(uB, vUv + f * (1.0 - uT));
  gl_FragColor = mix(a, b, uT); }`;

// Repairs for shaders written against lenient mobile drivers:
//  * words reserved in GLSL ES used as variable names (flat, sample...)
//  * float(INT * 4.0) style mixed int/float arithmetic inside float()
function repairShader(src) {
  const reserved = ['flat', 'smooth', 'sample', 'input', 'output', 'filter', 'active', 'common', 'partition', 'superp', 'noperspective', 'centroid', 'patch', 'resource', 'buffer', 'shared', 'coherent', 'packed'];
  let out = src;
  for (const w of reserved) out = out.replace(new RegExp('\\b' + w + '\\b', 'g'), w + '_v');
  out = out.replace(/float\(\s*([A-Za-z_]\w*)\s*\*\s*(\d+\.\d*)\s*\)/g, '(float($1) * $2)');
  out = out.replace(/float\(\s*(\d+\.\d*)\s*\*\s*([A-Za-z_]\w*)\s*\)/g, '($1 * float($2))');
  return out;
}

class Engine {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, alpha: false, preserveDrawingBuffer: true, antialias: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('This browser does not support WebGL2.');
    this.gl = gl;
    this.floatRT = !!gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('OES_texture_float_linear');
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);

    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]), gl.STATIC_DRAW);

    this.programs = new Map();
    this.effectErrors = new Map();
    this.rts = new Map();
    this.pool = [];
    this.uploadTex = this.newTex();
    this.width = canvas.width; this.height = canvas.height;
    this.compW = canvas.width; this.compH = canvas.height;

    this.pCopy = this.program('copy', VS_FULL, FS_COPY);
    this.pLayer = this.program('layer', VS_LAYER, FS_LAYER);
    this.pTrans = this.program('trans', VS_FULL, FS_TRANSITION);
    this.pMatte = this.program('matte', VS_FULL, FS_MATTE);
    this.pSolid = this.program('solid', VS_LAYER, FS_SOLID);
    this.pPresent = this.program('present', VS_FULL, FS_PRESENT);
    this.pMix = this.program('mix', VS_FULL, FS_MIX);
    this.pComp = this.program('comp', VS_FULL, FS_COMPOSITE);
    this.pDirBlur = this.program('dirblur', VS_FULL, FS_DIRBLUR);
    this.pGray = this.program('fgray', VS_FULL, FS_FLOW_GRAY);
    this.pGrad = this.program('fgrad', VS_FULL, FS_FLOW_GRAD);
    this.pLK = this.program('flk', VS_FULL, FS_FLOW_LK);
    this.pSmooth = this.program('fsmooth', VS_FULL, FS_FLOW_SMOOTH);
    this.pUp = this.program('fup', VS_FULL, FS_FLOW_UP);
    this.pWarp = this.program('fwarp', VS_FULL, FS_FLOW_WARP);
  }

  // ---- size --------------------------------------------------------------
  setSize(renderW, renderH, compW, compH) {
    renderW = Math.max(2, Math.round(renderW)); renderH = Math.max(2, Math.round(renderH));
    if (this.canvas.width !== renderW || this.canvas.height !== renderH) {
      this.canvas.width = renderW; this.canvas.height = renderH;
    }
    if (renderW !== this.width || renderH !== this.height) {
      for (const [k, rt] of this.rts) if (rt.compSized) { this.freeRT(rt); this.rts.delete(k); }
    }
    this.width = renderW; this.height = renderH; this.compW = compW; this.compH = compH;
  }

  // ---- programs ----------------------------------------------------------
  compile(type, src) {
    const gl = this.gl, sh = gl.createShader(type);
    gl.shaderSource(sh, src); gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh); gl.deleteShader(sh); throw new Error(log || 'Shader failed to compile');
    }
    return sh;
  }
  program(key, vs, fs) {
    if (this.programs.has(key)) return this.programs.get(key);
    const gl = this.gl;
    const p = gl.createProgram();
    gl.attachShader(p, this.compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, this.compile(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'Link failed');
    const uniforms = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      uniforms[info.name] = { loc: gl.getUniformLocation(p, info.name), type: info.type };
    }
    const prog = { p, uniforms };
    this.programs.set(key, prog);
    return prog;
  }

  // Builds a full fragment shader from an effect definition.
  effectSource(def) {
    const prec = def.precision === 'medium' || def.precision === 'mediump' ? 'mediump' : 'highp';
    let src = def.shader.replace(/#version[^\n]*\n/g, '').replace(/^\s*precision\s+\w+\s+(float|int)\s*;/gm, '');
    let decl = `precision ${prec} float;\nprecision highp int;\nvarying vec2 vUv;\nuniform vec2 acScreenSize;\nuniform float acTime;\nuniform float acLocalTime;\nuniform float acDuration;\nuniform vec2 acVelocity;\nuniform sampler2D acLut;\nuniform float acLutSize;\n#define acScreenNorm vUv\n#define texture2DCv texture2D\n`;
    const declared = (id) => new RegExp('uniform\\s+\\w+\\s+' + id + '\\s*;').test(src);
    for (const p of def.params) {
      if (!p.id) continue;
      if (p.kind === 'texture') {
        src = src.replace(new RegExp('\\b' + p.id + '\\.texture\\b', 'g'), p.id + '_t');
        decl += `uniform sampler2D ${p.id}_t;\n`;
      } else if (!declared(p.id)) {
        if (p.kind === 'spinner') decl += `uniform float ${p.id};\n`;
        else if (p.kind === 'color') decl += `uniform vec4 ${p.id};\n`;
        else if (p.kind === 'switch') decl += `uniform bool ${p.id};\n`;
        else if (p.kind === 'selector') decl += `uniform int ${p.id};\n`;
      }
    }
    return decl + src;
  }

  effectProgram(def) {
    const key = 'fx:' + def.id + ':' + def.shader.length;
    if (this.programs.has(key)) return this.programs.get(key);
    if (this.effectErrors.has(key)) return null;
    try {
      return this.program(key, VS_FULL, this.effectSource(def));
    } catch (e) {
      // Some phone GPU drivers accept loose GLSL that browsers reject.
      // Retry once with common repairs before giving up.
      const fixed = repairShader(def.shader);
      if (fixed !== def.shader) {
        try {
          const prog = this.program(key, VS_FULL, this.effectSource({ ...def, shader: fixed }));
          def.repaired = true;
          return prog;
        } catch (e2) { /* fall through */ }
      }
      console.warn('Effect failed to compile:', def.name, e.message);
      this.effectErrors.set(key, e.message);
      return null;
    }
  }
  effectError(def) { return this.effectErrors.get('fx:' + def.id + ':' + def.shader.length) || null; }

  // ---- textures and render targets ----------------------------------------
  newTex(filter) {
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter || gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter || gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  makeRT(w, h, float) {
    const gl = this.gl;
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    const useFloat = float && this.floatRT;
    const i = this.pool.findIndex(r => r.w === w && r.h === h && r.float === useFloat);
    if (i >= 0) return this.pool.splice(i, 1)[0];
    const tex = this.newTex();
    if (useFloat) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex, fb, w, h, float: useFloat };
  }
  freeRT(rt) {
    if (!rt) return;
    this.pool.push(rt);
    while (this.pool.length > 24) {
      const r = this.pool.shift();
      this.gl.deleteTexture(r.tex); this.gl.deleteFramebuffer(r.fb);
    }
  }
  // Named render target, created on first use. compSized ones follow the render size.
  rt(name, w, h, float) {
    const cs = w == null;
    if (cs) { w = this.width; h = this.height; }
    let r = this.rts.get(name);
    if (r && (r.w !== Math.round(w) || r.h !== Math.round(h) || (!!float && this.floatRT) !== r.float)) { this.freeRT(r); r = null; }
    if (!r) { r = this.makeRT(w, h, float); r.compSized = cs; this.rts.set(name, r); }
    return r;
  }
  upload(tex, source) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  }

  // ---- drawing -----------------------------------------------------------
  setUniforms(prog, uniforms) {
    const gl = this.gl;
    let unit = 0;
    for (const [name, v] of Object.entries(uniforms)) {
      const u = prog.uniforms[name];
      if (!u) continue;
      switch (u.type) {
        case gl.SAMPLER_2D:
          if (!v) continue;
          gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, v && v.tex ? v.tex : v);
          gl.uniform1i(u.loc, unit); unit++; break;
        case gl.FLOAT: gl.uniform1f(u.loc, +v || 0); break;
        case gl.FLOAT_VEC2: gl.uniform2fv(u.loc, v); break;
        case gl.FLOAT_VEC3: gl.uniform3fv(u.loc, v); break;
        case gl.FLOAT_VEC4: gl.uniform4fv(u.loc, v); break;
        case gl.INT: gl.uniform1i(u.loc, Math.round(+v || 0)); break;
        case gl.BOOL: gl.uniform1i(u.loc, v ? 1 : 0); break;
        case gl.FLOAT_MAT3: gl.uniformMatrix3fv(u.loc, false, v); break;
      }
    }
  }
  bindTarget(target) {
    const gl = this.gl;
    if (target) { gl.bindFramebuffer(gl.FRAMEBUFFER, target.fb); gl.viewport(0, 0, target.w, target.h); }
    else { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, this.canvas.width, this.canvas.height); }
  }
  clear(target, rgba = [0, 0, 0, 0]) {
    const gl = this.gl;
    this.bindTarget(target);
    gl.clearColor(rgba[0] * rgba[3], rgba[1] * rgba[3], rgba[2] * rgba[3], rgba[3]);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
  draw(prog, target, uniforms, blendOver = false) {
    const gl = this.gl;
    this.bindTarget(target);
    gl.useProgram(prog.p);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.setUniforms(prog, uniforms);
    if (blendOver) { gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); }
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    if (blendOver) gl.disable(gl.BLEND);
  }

  // Matrix that places content of size cw x ch (comp px) with a transform.
  layerMatrix(cw, ch, tr) {
    const W = this.compW, H = this.compH;
    const s = (tr.scale ?? 100) / 100, sx = s * (tr.flipX ? -1 : 1), sy = s * (tr.flipY ? -1 : 1);
    const th = (tr.rotation || 0) * Math.PI / 180, c = Math.cos(th), n = Math.sin(th);
    const ax = cw / 2 + (tr.anchorX || 0), ay = ch / 2 + (tr.anchorY || 0);
    const a00 = c * sx * cw, a01 = -n * sy * ch, a10 = n * sx * cw, a11 = c * sy * ch;
    const tx = (tr.x ?? W / 2) - c * sx * ax + n * sy * ay;
    const ty = (tr.y ?? H / 2) - n * sx * ax - c * sy * ay;
    return new Float32Array([2 / W * a00, 2 / H * a10, 0, 2 / W * a01, 2 / H * a11, 0, 2 / W * tx - 1, 2 / H * ty - 1, 1]);
  }
  // crop = { l, r, t, b } as fractions of the picture to cut from each side.
  // The quad shrinks to the kept part and samples only that part of the texture.
  drawLayerTex(tex, cw, ch, tr, target, crop) {
    let M = this.layerMatrix(cw, ch, tr), uv = [0, 0, 1, 1];
    if (crop && (crop.l || crop.r || crop.t || crop.b)) {
      const x0 = clamp(crop.l || 0, 0, 0.99), x1 = clamp(1 - (crop.r || 0), x0 + 0.005, 1);
      const y0 = clamp(crop.t || 0, 0, 0.99), y1 = clamp(1 - (crop.b || 0), y0 + 0.005, 1);
      uv = [x0, y0, x1, y1];
      const sx = x1 - x0, sy = y1 - y0, m = M;
      M = new Float32Array([m[0] * sx, m[1] * sx, 0, m[3] * sy, m[4] * sy, 0, m[0] * x0 + m[3] * y0 + m[6], m[1] * x0 + m[4] * y0 + m[7], 1]);
    }
    this.draw(this.pLayer, target, { uM: M, uTex: tex, uOp: 1, uUV: uv }, true);
  }
  drawSolid(color, cw, ch, tr, target) {
    this.draw(this.pSolid, target, { uM: this.layerMatrix(cw, ch, tr), uColor: color }, true);
  }
  copy(src, target, op = 1) { this.draw(this.pCopy, target, { uTex: src, uOp: op }); }
  mix(a, b, t, target) { this.draw(this.pMix, target, { uA: a, uB: b, uT: t }); }
  composite(dst, src, mode, opacity, target, tint = [1, 1, 1]) {
    this.draw(this.pComp, target, { uDst: dst, uSrc: src, uOp: opacity, uMode: mode, uTint: tint });
  }
  transition(a, b, p, mode, target) { this.draw(this.pTrans, target, { uA: a, uB: b, uP: p, uMode: mode, uAsp: target ? target.w / target.h : this.width / this.height }); }
  matte(src, matteTex, mode, target) { this.draw(this.pMatte, target, { uSrc: src, uMatte: matteTex, uMode: mode }); }
  dirBlur(src, dirUV, taps, target) { this.draw(this.pDirBlur, target, { uTex: src, uDir: dirUV, uTaps: taps }); }
  present(src) { this.draw(this.pPresent, null, { uTex: src }); }

  // Run one effect: input texture -> target.
  // extra: { local, dur, vel: [x,y] px per frame, lut: {tex,size} }
  runEffect(def, values, input, target, time, extra = {}) {
    const prog = this.effectProgram(def);
    if (!prog) { this.copy(input, target); return false; }
    const u = { acScreenSize: [target.w, target.h], acTime: time, acLocalTime: extra.local ?? time, acDuration: extra.dur ?? 1, acVelocity: extra.vel || [0, 0], acLutSize: extra.lut ? extra.lut.size : 1 };
    if (extra.lut) u.acLut = extra.lut.tex;
    if (extra.uniforms) Object.assign(u, extra.uniforms);
    for (const p of def.params) {
      if (!p.id) continue;
      if (p.kind === 'texture') u[p.id + '_t'] = input;
      else if (p.kind === 'lut') continue;
      else if (p.kind === 'section') continue;
      else u[p.id] = values[p.id] ?? p.default;
    }
    this.draw(prog, target, u);
    return true;
  }

  // Upload a 3D LUT (N*N*N rgb floats) as an N*N by N strip of slices.
  makeLutTexture(size, data) {
    const gl = this.gl, N = size, w = N * N, px = new Uint8Array(w * N * 4);
    for (let b = 0; b < N; b++) for (let g = 0; g < N; g++) for (let r = 0; r < N; r++) {
      const i = (r + g * N + b * N * N) * 3, o = ((g * w) + b * N + r) * 4;
      px[o] = clamp(Math.round(data[i] * 255), 0, 255); px[o + 1] = clamp(Math.round(data[i + 1] * 255), 0, 255); px[o + 2] = clamp(Math.round(data[i + 2] * 255), 0, 255); px[o + 3] = 255;
    }
    const t = this.newTex();
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, N, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    return { tex: t, size: N };
  }

  // Render an effect on a small image into a data URL (effect browser thumbnails).
  thumbnail(def, srcTex, w, h, times) {
    const gl = this.gl, rt = this.rt('thumb', w, h), out = document.createElement('canvas');
    out.width = w * times.length; out.height = h;
    const ctx = out.getContext('2d'), px = new Uint8Array(w * h * 4), img = ctx.createImageData(w, h);
    times.forEach((t, i) => {
      this.runEffect(def, defaultParams(def), srcTex, rt, t, { local: t, dur: 2 });
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      for (let y = 0; y < h; y++) { const a = px.subarray(y * w * 4, (y + 1) * w * 4); img.data.set(a, y * w * 4); }
      for (let j = 0; j < img.data.length; j += 4) { const al = img.data[j + 3] / 255; if (al > 0 && al < 1) { img.data[j] /= al; img.data[j + 1] /= al; img.data[j + 2] /= al; } img.data[j + 3] = 255; }
      ctx.putImageData(img, i * w, 0);
    });
    return out.toDataURL('image/jpeg', 0.75);
  }

  // Small readback for Snap Blur: returns centroid info of a texture.
  centroid(src) {
    const gl = this.gl, w = 64, h = 36;
    const small = this.rt('centroid', w, h);
    this.copy(src, small);
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let sa = 0, sax = 0, say = 0, sl = 0, slx = 0, sly = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, a = px[i + 3] / 255, l = (px[i] * 0.2126 + px[i + 1] * 0.7152 + px[i + 2] * 0.0722) / 255;
      const u = (x + 0.5) / w, v = (y + 0.5) / h;
      sa += a; sax += a * u; say += a * v; sl += l; slx += l * u; sly += l * v;
    }
    return { a: sa, ax: sa ? sax / sa : 0.5, ay: sa ? say / sa : 0.5, l: sl, lx: sl ? slx / sl : 0.5, ly: sl ? sly / sl : 0.5, cover: sa / (w * h) };
  }

  // ---- optical flow -----------------------------------------------------
  // Builds an in-between frame at fraction t between frames A and B.
  // Returns false if float render targets are missing (caller blends).
  flowInterpolate(A, B, t, target) {
    if (!this.floatRT) { this.mix(A, B, t, target); return false; }
    const aspect = A.w / A.h;
    let fw = Math.min(512, A.w), fh = Math.round(fw / aspect);
    const levels = [];
    for (let i = 0; i < 5 && Math.min(fw, fh) >= 24; i++) { levels.push([fw, fh]); fw = Math.round(fw / 2); fh = Math.round(fh / 2); }
    const L = levels.length;
    // Gray + gradient pyramids for both frames.
    const pyr = (src, tag) => {
      const out = [];
      let prev = src;
      for (let i = 0; i < L; i++) {
        const [w, h] = levels[i];
        const g = this.rt(`fl_${tag}_g${i}`, w, h, true);
        this.draw(this.pGray, g, { uTex: prev, uPx: [1 / w, 1 / h] });
        const d = this.rt(`fl_${tag}_d${i}`, w, h, true);
        this.draw(this.pGrad, d, { uTex: g, uPx: [1 / w, 1 / h] });
        out.push(d); prev = g;
      }
      return out;
    };
    const pa = pyr(A, 'a'), pb = pyr(B, 'b');
    let flow = null;
    for (let i = L - 1; i >= 0; i--) {
      const [w, h] = levels[i];
      let f0 = this.rt(`fl_f0_${i}`, w, h, true), f1 = this.rt(`fl_f1_${i}`, w, h, true);
      if (flow) this.draw(this.pUp, f0, { uFlow: flow }); else this.clear(f0);
      for (let it = 0; it < 3; it++) {
        this.draw(this.pLK, f1, { uGradA: pa[i], uB: pb[i], uFlow: f0, uPx: [1 / w, 1 / h] });
        [f0, f1] = [f1, f0];
      }
      this.draw(this.pSmooth, f1, { uFlow: f0, uPx: [1 / w, 1 / h] });
      flow = f1;
    }
    const [w0, h0] = levels[0];
    this.draw(this.pWarp, target, { uA: A, uB: B, uFlow: flow, uFlowPx: [1 / w0, 1 / h0], uT: t });
    return true;
  }
}

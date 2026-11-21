// ===========================================================================
// On-device AI tools (nothing is uploaded; models load from a CDN the first
// time a tool is opened, so they need the GitHub Pages copy of TwoFrame):
//   Face Retouch  - MediaPipe Face Landmarker finds up to 3 faces per frame;
//                   the results are saved with the clip so playback never
//                   re-runs it. One shader then smooths skin, brightens eyes,
//                   whitens teeth, reshapes and adds lipstick and blush.
//   Person Cutout - MediaPipe selfie segmentation removes the background.
// ===========================================================================
// window.TF_MP can point these at other copies (used for testing).
const MP_VER = '0.10.14', MP_CFG = window.TF_MP || {}, MP_BASE = MP_CFG.base || `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VER}`;
const MP_FACE_MODEL = MP_CFG.face || 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const MP_SEG_MODEL = MP_CFG.seg || 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite';
const FACE_PTS = [10, 152, 234, 454, 33, 133, 362, 263, 61, 291, 0, 17, 1, 172, 397];   // landmark numbers kept per face
const FaceAI = {
  vision: null, lm: null, lmImage: null, seg: null, data: new Map(), cancel: false, ts: 0,
  async lib() {
    if (location.protocol === 'file:') throw new Error('Face tools need TwoFrame opened from a web address (GitHub Pages), not a file on this device.');
    if (!this.vision) {
      let last = null;
      for (const base of [MP_BASE, `https://unpkg.com/@mediapipe/tasks-vision@${MP_VER}`]) {
        try { this.mod = await import(`${base}/vision_bundle.mjs`); this.vision = await this.mod.FilesetResolver.forVisionTasks(`${base}/wasm`); last = null; break; } catch (e) { last = e; }
      }
      if (last) throw new Error('The face tools couldn’t be downloaded (' + (last.message || last) + '). They need the GitHub Pages copy opened in Safari or Chrome with an internet connection. They can’t load inside the Claude app.');
    }
    return this.mod;
  },
  async landmarker(mode) {
    const mod = await this.lib(), key = mode === 'IMAGE' ? 'lmImage' : 'lm';
    if (!this[key]) {
      const make = (delegate) => mod.FaceLandmarker.createFromOptions(this.vision, { baseOptions: { modelAssetPath: MP_FACE_MODEL, delegate }, runningMode: mode, numFaces: 3 });
      try { this[key] = await make(this.forceCPU ? 'CPU' : 'GPU'); } catch (e) { try { this[key] = await make('CPU'); } catch (e2) { throw new Error('The face model couldn’t start: ' + (e2.message || e2)); } }
    }
    return this[key];
  },
  pack(res) { return (res.faceLandmarks || []).map(f => FACE_PTS.flatMap(i => [Math.round(f[i].x * 1e4) / 1e4, Math.round(f[i].y * 1e4) / 1e4])); },
  // Keeps each person in the same slot from frame to frame.
  order(prev, faces) {
    if (!prev || !prev.length) return faces;
    const out = [], left = faces.slice(), ctr = (f) => [(f[0] + f[2]) / 2, (f[1] + f[3]) / 2];
    for (const p of prev) { if (!left.length) break; const c = ctr(p); let bi = 0, bd = 9; left.forEach((f, i) => { const q = ctr(f), d = Math.hypot(q[0] - c[0], q[1] - c[1]); if (d < bd) { bd = d; bi = i; } }); out.push(bd < 0.25 ? left.splice(bi, 1)[0] : null); }
    return [...out.filter(Boolean), ...left].slice(0, 3);
  },
  async load(m) { if (this.data.has(m.id)) return this.data.get(m.id); const r = await Store.get('media', 'faces:' + m.id); if (r && r.frames) { this.data.set(m.id, r); return r; } return null; },
  // Finds faces through the part of the video this clip uses.
  async analyze(l, every, onProgress) {
    const m = Media.items.get(l.mediaId); if (!m) throw new Error('Select a video or photo clip.');
    const rec = { id: 'faces:' + m.id, type: 'faces', fps: 0, frames: {}, every };
    if (l.type === 'image') { const lm = await this.landmarker('IMAGE'); rec.frames[0] = this.pack(lm.detect(m.image)); rec.fps = 1; }
    else {
      const lm = await this.landmarker('VIDEO'), v = Runtime.get(l).video, fps = (l.video && l.video.srcFps) || 30; rec.fps = fps;
      const s0 = Math.max(0, srcTimeFor(l, 0)), s1 = Math.min(m.duration, Math.max(s0, srcTimeFor(l, l.dur)) + 0.001), a = Math.floor(Math.min(s0, s1) * fps), b = Math.ceil(Math.max(s0, s1) * fps);
      const old = await this.load(m); if (old && old.fps === fps) Object.assign(rec.frames, old.frames);
      const prevBusy = Exporter.busy; await Renderer._lock; Exporter.busy = true; this.cancel = false; let prev = null;
      try {
        for (let f = a; f <= b; f += every) {
          if (this.cancel) throw new Error('Face analysis cancelled. What was found so far is kept.');
          if (!rec.frames[f]) { await seekVideo(v, (f + 0.5) / fps); this.ts += 40; let res;
            try { res = lm.detectForVideo(v, this.ts); } catch (e) { if (this.forceCPU) throw new Error('Face finding failed on this device: ' + (e.message || e)); this.forceCPU = true; this.lm = null; return await this.analyze(l, every, onProgress); }
            rec.frames[f] = this.order(prev, this.pack(res)); }
          prev = rec.frames[f]; onProgress && onProgress((f - a) / Math.max(1, b - a)); if ((f - a) % (every * 6) === 0) await sleep(0);
        }
      } finally { Exporter.busy = prevBusy; this.data.set(m.id, rec); Store.put('media', rec.id, rec).catch(() => { }); }
    }
    this.data.set(m.id, rec); await Store.put('media', rec.id, rec);
    App.requestRender();
    return { frames: Object.keys(rec.frames).length, faces: Math.max(0, ...Object.values(rec.frames).map(f => f.length)) };
  },
  // Faces at a source time, blended between the two nearest analysed frames.
  at(m, srcT) {
    const rec = this.data.get(m.id); if (!rec) return null;
    if (rec.fps === 1 && rec.frames[0]) return rec.frames[0];
    const x = srcT * rec.fps, f0 = Math.floor(x); let a = null, b = null, ia = 0, ib = 0;
    for (let k = 0; k <= 6 && !a; k++) if (rec.frames[f0 - k]) { a = rec.frames[f0 - k]; ia = f0 - k; }
    for (let k = 1; k <= 6 && !b; k++) if (rec.frames[f0 + k]) { b = rec.frames[f0 + k]; ib = f0 + k; }
    if (!a) return b; if (!b || a.length !== b.length) return a;
    const t = clamp((x - ia) / (ib - ia), 0, 1); return a.map((fa, i) => fa.map((v, j) => lerp(v, b[i][j], t)));
  },
  // Turns stored face points into the numbers the shader needs (in frame coordinates).
  uniforms(layer, t, list) {
    const m = Media.items.get(layer.mediaId), p = App.project; if (!m) return { uFaces: 0 };
    const faces = this.at(m, layer.type === 'image' ? 0 : srcTimeFor(layer, t)); if (!faces || !faces.length) return { uFaces: 0 };
    const tr = worldTransform(layer, t, list), W = p.width, H = p.height, A = (n) => new Float32Array(n * 4), U = { uFaces: Math.min(3, faces.length), 'uFace[0]': A(3), 'uEyes[0]': A(3), 'uMouth[0]': A(3), 'uMisc[0]': A(3), 'uJaw[0]': A(3), 'uChin[0]': A(3), 'uSide[0]': A(3) };
    faces.slice(0, 3).forEach((f, i) => {
      const P = (k) => UI.toWorld(tr, m.w, m.h, f[k * 2] * m.w, f[k * 2 + 1] * m.h), d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) / H, mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], uv = (q) => [q[0] / W, q[1] / H];
      const top = P(0), chin = P(1), sl = P(2), sr = P(3), eA = mid(P(4), P(5)), eB = mid(P(6), P(7)), mc = mid(P(8), P(9)), nose = P(12), j1 = P(13), j2 = P(14), c = mid(top, chin);
      U['uFace[0]'].set([...uv(c), d(sl, sr) / 2 * 1.04, d(top, chin) / 2 * 1.1], i * 4); U['uEyes[0]'].set([...uv(eA), ...uv(eB)], i * 4);
      const lipc = mid(P(10), P(11)), mw = d(P(8), P(9)) / 2 * 1.05; U['uMouth[0]'].set([...uv([mc[0] * 0.5 + lipc[0] * 0.5, lipc[1]]), mw, Math.max(d(P(10), P(11)) / 2, mw * 0.3)], i * 4);
      U['uMisc[0]'].set([Math.atan2(chin[1] - top[1], chin[0] - top[0]) - Math.PI / 2, d(P(4), P(5)) * 0.75, ...uv(nose)], i * 4);
      U['uJaw[0]'].set([...uv(j1), ...uv(j2)], i * 4); U['uChin[0]'].set([...uv(chin), 0, 0], i * 4); U['uSide[0]'].set([...uv(sl), ...uv(sr)], i * 4);
    });
    return U;
  },
  // ---- person cutout ----
  async segmenter() {
    const mod = await this.lib();
    if (!this.seg) { const make = (delegate) => mod.ImageSegmenter.createFromOptions(this.vision, { baseOptions: { modelAssetPath: MP_SEG_MODEL, delegate }, runningMode: 'VIDEO', outputCategoryMask: false, outputConfidenceMasks: true });
      try { this.seg = await make('GPU'); } catch (e) { this.seg = await make('CPU'); } }
    return this.seg;
  },
  maskCanvas(src) {
    let out = null; this.ts += 40;
    this.seg.segmentForVideo(src, this.ts, (res) => {
      const ms = res.confidenceMasks, mk = ms[ms.length > 1 ? 1 : 0], w = mk.width, h = mk.height, a = mk.getAsFloat32Array();
      const cv = this._mc || (this._mc = document.createElement('canvas')); cv.width = w; cv.height = h; const ctx = cv.getContext('2d'), id = ctx.createImageData(w, h);
      for (let i = 0; i < a.length; i++) { const v = Math.round(a[i] * 255); id.data[i * 4] = v; id.data[i * 4 + 1] = v; id.data[i * 4 + 2] = v; id.data[i * 4 + 3] = 255; }
      ctx.putImageData(id, 0, 0); out = cv;
    });
    return out;
  }
};

fx3('retouch', 'Face Retouch', 'Retouch', 'Skin, eyes, teeth, face shape and light makeup. Open the Retouch tab to find the faces first.', [
  L('who', 'Apply to', 0, ['Everyone', 'Face 1', 'Face 2', 'Face 3']), H('Skin'),
  S('smoothamt', 'Smooth Skin', 0.35, 0, 1), S('detail', 'Keep Texture (pores)', 0.45, 0, 1), S('bright', 'Brighten Skin', 0.1, -0.5, 1), S('warm', 'Warmth', 0, -1, 1), S('shine', 'Reduce Shine', 0.2, 0, 1), S('circles', 'Dark Circles', 0.25, 0, 1),
  H('Eyes and teeth'), S('eyebright', 'Brighten Eyes', 0.25, 0, 1), S('teeth', 'Whiten Teeth', 0.3, 0, 1),
  H('Reshape'), S('slim', 'Slim Jawline', 0, -1, 1), S('fwidth', 'Narrow Face', 0, -1, 1), S('chin', 'Shorten Chin', 0, -1, 1), S('nose', 'Slim Nose', 0, -1, 1), S('eyes', 'Bigger Eyes', 0, -1, 1), S('lips', 'Fuller Lips', 0, -1, 1), S('smile', 'Lift Smile', 0, -1, 1),
  H('Makeup'), S('lipstick', 'Lipstick', 0, 0, 1), C('lipcol', 'Lipstick Colour', '#FFC2274B'), S('blush', 'Blush', 0, 0, 1), C('blushcol', 'Blush Colour', '#FFFF7C8A'),
  H('Compare'), S('compare', 'Before / After Split', 0, 0, 1)], `
uniform vec4 uFace[3]; uniform vec4 uEyes[3]; uniform vec4 uMouth[3]; uniform vec4 uMisc[3]; uniform vec4 uJaw[3]; uniform vec4 uChin[3]; uniform vec4 uSide[3]; uniform float uFaces;
vec2 pullv(vec2 uv, vec2 p, vec2 c, float rad, float amt){ float asp = xAsp(); vec2 q = (uv - p) * vec2(asp, 1.0); float f = exp(-dot(q, q) / (rad * rad)); vec2 dir = (c - p) * vec2(asp, 1.0); dir /= (length(dir) + 1e-5); return -vec2(dir.x / asp, dir.y) * amt * f; }
vec2 magv(vec2 uv, vec2 e, float rad, float amt){ vec2 q = (uv - e) * vec2(xAsp(), 1.0); float r = length(q) / rad; if (r >= 1.0) return vec2(0.0); return -(uv - e) * amt * (1.0 - r) * (1.0 - r); }
float gs(vec2 uv, vec2 p, float rad){ vec2 q = (uv - p) * vec2(xAsp(), 1.0); return exp(-dot(q, q) / (rad * rad)); }
void main(){ vec2 uv = acScreenNorm; float asp = xAsp(); vec4 orig = tfGet(uv); vec2 d = vec2(0.0);
  for (int i = 0; i < 3; i++) { if (float(i) >= uFaces) break; if (!(who == 0 || who == i + 1)) continue;
    vec2 c = uFace[i].xy; float R = uFace[i].w;
    d += pullv(uv, uJaw[i].xy, c, R * 0.5, slim * R * 0.16) + pullv(uv, uJaw[i].zw, c, R * 0.5, slim * R * 0.16);
    d += pullv(uv, uSide[i].xy, c, R * 0.55, fwidth * R * 0.12) + pullv(uv, uSide[i].zw, c, R * 0.55, fwidth * R * 0.12);
    d += pullv(uv, uChin[i].xy, c, R * 0.45, chin * R * 0.14);
    d += magv(uv, uEyes[i].xy, uMisc[i].y * 2.4, eyes * 0.35) + magv(uv, uEyes[i].zw, uMisc[i].y * 2.4, eyes * 0.35);
    vec2 n = uMisc[i].zw; d.x += (uv.x - n.x) * nose * 0.5 * gs(uv, n, R * 0.3);
    vec2 m = uMouth[i].xy; vec2 qm = (uv - m) * vec2(asp, 1.0) / vec2(uMouth[i].z * 1.3, uMouth[i].w * 1.9); d -= (uv - m) * lips * 0.3 * exp(-dot(qm, qm));
    float mw = uMouth[i].z; d.y += smile * R * 0.07 * (gs(uv, m - vec2(mw / asp, 0.0), mw * 0.6) + gs(uv, m + vec2(mw / asp, 0.0), mw * 0.6)); }
  vec2 w = uv + d; vec4 s = tfGet(w); vec3 c3 = tfUn(s);
  float face = 0.0; float eyeM = 0.0; float mouthM = 0.0; float teethM = 0.0; float under = 0.0; float cheek = 0.0; float Rm = 0.1;
  for (int i = 0; i < 3; i++) { if (float(i) >= uFaces) break; if (!(who == 0 || who == i + 1)) continue;
    vec2 q = xRot((w - uFace[i].xy) * vec2(asp, 1.0), -uMisc[i].x) / uFace[i].zw; float fe = 1.0 - smoothstep(0.82, 1.08, length(q)); face = max(face, fe); Rm = max(Rm, uFace[i].w);
    float er = uMisc[i].y; vec2 ea = uEyes[i].xy; vec2 eb = uEyes[i].zw;
    eyeM = max(eyeM, max(1.0 - smoothstep(0.7, 1.35, length((w - ea) * vec2(asp, 1.0)) / er), 1.0 - smoothstep(0.7, 1.35, length((w - eb) * vec2(asp, 1.0)) / er)));
    vec2 dn = xRot(vec2(0.0, er * 1.5), uMisc[i].x); dn.x /= asp; under = max(under, max(gs(w, ea + dn, er * 1.3), gs(w, eb + dn, er * 1.3)) * fe);
    vec2 qm = (w - uMouth[i].xy) * vec2(asp, 1.0) / uMouth[i].zw; mouthM = max(mouthM, 1.0 - smoothstep(0.7, 1.0, length(qm))); teethM = max(teethM, 1.0 - smoothstep(0.55, 0.8, length(qm * vec2(1.15, 1.7))));
    cheek = max(cheek, max(gs(w, mix(ea, uJaw[i].xy, 0.5), uFace[i].w * 0.24), gs(w, mix(eb, uJaw[i].zw, 0.5), uFace[i].w * 0.24)) * fe); }
  float cb = -0.169 * c3.r - 0.331 * c3.g + 0.5 * c3.b; float cr = 0.5 * c3.r - 0.419 * c3.g - 0.081 * c3.b;
  float sk = smoothstep(0.005, 0.045, cr) * smoothstep(0.24, 0.18, cr) * smoothstep(0.03, -0.02, cb) * smoothstep(-0.26, -0.2, cb);
  float sm = face * sk * (1.0 - eyeM) * (1.0 - mouthM);
  if (smoothamt > 0.0 && sm > 0.01) { vec3 b = vec3(0.0); float ws = 0.0; float rad = acScreenSize.y * Rm * 0.06 * (0.5 + smoothamt);
    for (int k = 0; k < 16; k++) { float f = float(k); float rr = sqrt((f + 0.5) / 16.0); float th = f * 2.39996; vec3 t = tfUn(tfGet(w + vec2(cos(th), sin(th)) * rr * rad / acScreenSize)); vec3 df = t - c3; float wt = exp(-dot(df, df) / 0.02); b += t * wt; ws += wt; }
    b /= max(ws, 1e-4); c3 = mix(c3, b + (c3 - b) * detail, smoothamt * sm); }
  c3 += sm * bright * 0.15; c3.r += sm * warm * 0.05; c3.b -= sm * warm * 0.05;
  float l = tfLum(c3); c3 = mix(c3, c3 * (0.78 + 0.22 * (1.0 - smoothstep(0.6, 0.95, l))), shine * sm);
  c3 += under * circles * 0.1 * sk;
  c3 = mix(c3, pow(max(c3, 0.0), vec3(0.8)) * 1.06, eyebright * eyeM * face);
  float sat = max(max(c3.r, c3.g), c3.b) - min(min(c3.r, c3.g), c3.b); l = tfLum(c3); float tooth = teethM * smoothstep(0.42, 0.6, l) * smoothstep(0.3, 0.14, sat);
  c3 = mix(c3, vec3(l) * 1.1 + 0.03, teeth * tooth * 0.85);
  float lipM = mouthM * (1.0 - tooth) * smoothstep(0.03, 0.09, cr - 0.25 * max(cb + 0.08, 0.0)) * smoothstep(0.0, 0.05, c3.r - c3.g * 1.25) * face; c3 = mix(c3, mix(c3 * lipcol.rgb * 1.7, lipcol.rgb, 0.3), lipstick * lipM);
  c3 = mix(c3, c3 * 0.6 + blushcol.rgb * 0.5, blush * cheek * sk * 0.6);
  vec4 o = xOut(c3, s.a); if (compare > 0.001) { if (uv.x < compare) o = orig; if (abs(uv.x - compare) < 0.0015) o = vec4(1.0); }
  gl_FragColor = o; }`);
fx3('cutout', 'Person Cutout', 'Keying', 'Removes the background behind people (no green screen needed). Loads a small model the first time.', [S('edge', 'Edge Position', 0.5, 0.05, 0.95), S('soft', 'Edge Softness', 0.12, 0, 0.5), B('invert', 'Keep the Background Instead', false), B('showmask', 'Show the Mask', false)], `
uniform sampler2D uCut; uniform float uCutOn;
void main(){ vec4 s = tfGet(acScreenNorm); if (uCutOn < 0.5) { gl_FragColor = s; return; } vec4 mk = texture2D(uCut, acScreenNorm); float a = smoothstep(edge - soft - 1e-4, edge + soft, mk.r) * mk.a; if (invert) a = 1.0 - a;
  gl_FragColor = showmask ? vec4(vec3(a) * s.a, s.a) : s * a; }`);

FX_HOOKS['tf.retouch'] = async (layer, fxi, vals, t, R, list) => FaceAI.uniforms(layer, t, list);
FX_HOOKS['tf.cutout'] = async (layer, fxi, vals, t, R, list) => {
  const m = Media.items.get(layer.mediaId), r = Runtime.get(layer); if (!m || !FaceAI.seg || (layer.type !== 'video' && layer.type !== 'image')) return { uCutOn: 0 };
  const src = layer.type === 'video' ? r.video : m.image; if (!src || (layer.type === 'video' && src.readyState < 2)) return { uCutOn: 0 };
  const cv = FaceAI.maskCanvas(src); if (!cv) return { uCutOn: 0 };
  if (!r.cutTex) r.cutTex = engine.newTex(); engine.upload(r.cutTex, cv);
  const rt = R.R('cut_mask'); engine.clear(rt); engine.drawLayerTex(r.cutTex, m.w, m.h, worldTransform(layer, t, list), rt, layer.crop ? evalGroup(layer, 'crop', t) : null);
  return { uCut: rt, uCutOn: 1 };
};

const RETOUCH_PRESETS = {
  Natural: { smoothamt: 0.3, detail: 0.55, bright: 0.08, shine: 0.2, circles: 0.25, eyebright: 0.2, teeth: 0.25, slim: 0, fwidth: 0, eyes: 0, lipstick: 0, blush: 0 },
  Soft: { smoothamt: 0.55, detail: 0.35, bright: 0.15, shine: 0.35, circles: 0.4, eyebright: 0.3, teeth: 0.35, slim: 0.1, fwidth: 0.05, eyes: 0.08, lipstick: 0, blush: 0.15 },
  Glam: { smoothamt: 0.65, detail: 0.3, bright: 0.18, shine: 0.4, circles: 0.5, eyebright: 0.45, teeth: 0.5, slim: 0.25, fwidth: 0.1, eyes: 0.18, lips: 0.15, lipstick: 0.5, blush: 0.35 }
};
Object.assign(UI, {
  myRetouch() { try { return JSON.parse(localStorage.getItem('tf.retouchPresets')) || {}; } catch (e) { return {}; } },
  panel_retouch(body, l) {
    if (!l || (l.type !== 'video' && l.type !== 'image')) { body.appendChild(el('p', { class: 'hint' }, 'Select a video or photo clip with a face in it.')); return; }
    const m = Media.items.get(l.mediaId), fx = l.effects.find(f => f.defId === 'tf.retouch'), rec = m && FaceAI.data.get(m.id);
    if (m && !rec && !this._faceLoad) { this._faceLoad = true; FaceAI.load(m).then((r) => { this._faceLoad = false; if (r) { this.refreshPanel(); App.requestRender(); } }); }
    const phone = Layout.device === 'phone';
    const run = async (every) => {
      try { this.busy('Loading the face model (first time only)…'); const r = await FaceAI.analyze(l, every, (f) => this.busy(`Analyzing faces… ${Math.round(f * 100)}%`, () => { FaceAI.cancel = true; }));
        this.busy(null); if (!l.effects.some(f => f.defId === 'tf.retouch')) { App.addEffect('tf.retouch'); const f = l.effects.find(x => x.defId === 'tf.retouch'); App.change(() => Object.assign(f.params, RETOUCH_PRESETS.Natural), ''); }
        toast(r.faces ? `Found ${r.faces} face${r.faces === 1 ? '' : 's'}.` : 'No faces found in this clip.'); }
      catch (e) { this.busy(null); this.modal('Face retouch', el('p', {}, e.message || String(e)), [['OK', () => this.closeModal()]]); }
      this.refresh();
    };
    body.append(el('p', { class: 'hint' }, rec ? `Faces are saved for ${Object.keys(rec.frames).length} frame${Object.keys(rec.frames).length === 1 ? '' : 's'} of this clip (up to ${Math.max(0, ...Object.values(rec.frames).map(f => f.length))} people).` : 'Step 1: find the faces. This runs on your device and is saved with the clip, so it only happens once.'),
      el('div', { class: 'btnrow' }, el('button', { class: 'btn' + (rec ? '' : ' primary'), onclick: () => run(phone ? 2 : 1) }, rec ? 'Analyze again' : 'Analyze faces'),
        l.type === 'video' ? el('button', { class: 'btn sm', onclick: () => run(phone ? 1 : 2) }, phone ? 'Every frame (slower, more exact)' : 'Every 2nd frame (faster)') : null,
        el('button', { class: 'btn sm', onclick: async () => { try { this.busy('Loading the cutout model…'); await FaceAI.segmenter(); this.busy(null); if (!l.effects.some(f => f.defId === 'tf.cutout')) App.addEffect('tf.cutout'); this.refresh(); toast('Background removed. Adjust the edge under Effects.'); } catch (e) { this.busy(null); this.modal('Person cutout', el('p', {}, e.message || String(e)), [['OK', () => this.closeModal()]]); } } }, 'Remove background')));
    if (!fx) { if (rec) body.appendChild(el('div', { class: 'btnrow' }, el('button', { class: 'btn primary', onclick: () => { App.addEffect('tf.retouch'); this.refresh(); } }, 'Add retouch'))); return; }
    const def = EffectLib.get('tf.retouch'), mine = this.myRetouch(), apply = (vals) => { App._label = 'Retouch preset'; App.change(() => { for (const p of def.params) if (p.id && p.kind === 'spinner' && p.id !== 'compare') fx.params[p.id] = vals[p.id] ?? (['smoothamt', 'detail', 'bright', 'shine', 'circles', 'eyebright', 'teeth'].includes(p.id) ? fx.params[p.id] : 0); }); this.refreshPanel(); };
    const hold = el('button', { class: 'btn sm' }, 'Hold to see before');
    const show = (on) => { fx.enabled = on; App.requestRender(); };
    hold.addEventListener('pointerdown', () => show(false)); for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) hold.addEventListener(ev, () => show(true));
    body.append(el('div', { class: 'sect' }, 'Presets'), el('div', { class: 'chips' }, Object.entries(RETOUCH_PRESETS).map(([n, v]) => el('button', { class: 'chip', onclick: () => apply(v) }, n)),
      Object.entries(mine).map(([n, v]) => el('button', { class: 'chip mine', onclick: () => apply(v), oncontextmenu: (e) => { e.preventDefault(); this.confirm(`Delete the preset “${n}”?`, () => { const o = this.myRetouch(); delete o[n]; localStorage.setItem('tf.retouchPresets', JSON.stringify(o)); this.refreshPanel(); }); } }, '★ ' + n)),
      el('button', { class: 'chip', onclick: () => this.ask('Name this retouch preset', 'My look', (n) => { const o = this.myRetouch(); o[n] = { ...fx.params }; delete o[n].compare; delete o[n].who; try { localStorage.setItem('tf.retouchPresets', JSON.stringify(o)); } catch (e) { } this.refreshPanel(); }) }, '+ Save mine')),
      el('div', { class: 'btnrow' }, hold, el('span', { class: 'hint' }, 'or drag Before / After Split at the bottom.')));
    for (const p of def.params) {
      if (p.kind === 'section') { body.appendChild(el('div', { class: 'sect' }, p.label)); continue; }
      const path = `fx.${fx.uid}.${p.id}`;
      if (p.kind === 'spinner') body.appendChild(this.propRow(l, path, p.label, { min: p.min, max: p.max, step: p.step }));
      else if (p.kind === 'selector') body.appendChild(this.row(p.label, el('select', { onchange: (e) => { App.change(() => { fx.params[p.id] = +e.target.value; }); } }, p.choices.map(c => el('option', { value: c.value, selected: fx.params[p.id] === c.value }, c.label)))));
      else if (p.kind === 'color') body.appendChild(this.row(p.label, el('input', { type: 'color', value: arr2hex(fx.params[p.id]), oninput: (e) => App.change(() => { fx.params[p.id] = hex2arr(e.target.value); }, 'rc' + p.id) })));
    }
    body.appendChild(el('p', { class: 'hint' }, 'Every slider here can be keyframed with its diamond. Body reshaping is not built yet.'));
  }
});

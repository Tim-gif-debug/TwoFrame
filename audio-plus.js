// ===========================================================================
// Sound add-ons: 3-band EQ, compressor and reverb per clip, voiceover
// recording, and recording from the camera with a teleprompter.
// ===========================================================================
(() => {
  const proc = Sound.processed;
  const active = (a) => a && (a.low || a.mid || a.high || a.comp || a.reverb > 0);
  Sound.processed = async function (m, layer) {
    const base = await proc.call(this, m, layer), a = layer.afx;
    if (!base || !active(a)) return base;
    const key = m.id + '|afx|' + (layer.voice || '') + (layer.denoise ? 1 : 0) + JSON.stringify(a);
    if (this.cache.has(key)) return this.cache.get(key);
    const job = (async () => {
      const sr = base.sampleRate, ctx = new OfflineAudioContext(base.numberOfChannels, base.length, sr), src = ctx.createBufferSource(); src.buffer = base;
      let node = src; const chain = (n) => { node.connect(n); node = n; };
      const eq = (type, f, g) => { if (!g) return; const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.gain.value = g; if (type === 'peaking') b.Q.value = 0.9; chain(b); };
      eq('lowshelf', 140, a.low); eq('peaking', 1400, a.mid); eq('highshelf', 6500, a.high);
      if (a.comp) { const c = ctx.createDynamicsCompressor(); c.threshold.value = -26; c.knee.value = 18; c.ratio.value = 4; c.attack.value = 0.004; c.release.value = 0.2; chain(c); const g = ctx.createGain(); g.gain.value = 1.5; chain(g); }
      node.connect(ctx.destination);
      if (a.reverb > 0) {
        // A simple room made from decaying noise.
        const len = Math.floor(sr * 1.8), ir = ctx.createBuffer(2, len, sr); for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (hash01(i, 31 + c) * 2 - 1) * Math.pow(1 - i / len, 3.2); }
        const cv = ctx.createConvolver(); cv.buffer = ir; const wet = ctx.createGain(); wet.gain.value = clamp(a.reverb, 0, 1) * 0.55; node.connect(cv); cv.connect(wet); wet.connect(ctx.destination);
      }
      src.start(); return await ctx.startRendering();
    })();
    this.cache.set(key, job); return job;
  };
})();

Object.assign(UI, {
  panel_sound(body, l) {
    const m = Media.items.get(l.mediaId);
    if (!m || !m.audio) { body.append(el('p', { class: 'hint' }, 'This clip has no sound the browser can read.')); return; }
    const a = l.afx || {}, set = (k, v) => { App.change(() => { l.afx = { low: 0, mid: 0, high: 0, comp: false, reverb: 0, ...(l.afx || {}), [k]: v }; }, 'afx' + l.id + k); if (Player.playing) { Player.pause(); } };
    const sl = (k, label, min, max, step, unit) => { const out = el('span', { class: 'hint' }, (a[k] || 0) + unit); return el('div', { class: 'prop' }, el('span', { class: 'kbtn', style: { visibility: 'hidden' } }), el('span', { class: 'plabel' }, label), el('input', { type: 'range', min, max, step, value: a[k] || 0, onchange: (e) => set(k, +e.target.value), oninput: (e) => { out.textContent = e.target.value + unit; } }), out); };
    body.append(el('div', { class: 'sect' }, 'Equaliser'), sl('low', 'Bass', -12, 12, 1, ' dB'), sl('mid', 'Mids', -12, 12, 1, ' dB'), sl('high', 'Treble', -12, 12, 1, ' dB'),
      el('div', { class: 'sect' }, 'Dynamics and space'), this.row('Compressor (evens out loud and quiet)', el('input', { type: 'checkbox', class: 'tog', checked: !!a.comp, onchange: (e) => set('comp', e.target.checked) })), sl('reverb', 'Reverb', 0, 1, 0.05, ''),
      el('p', { class: 'hint' }, 'Changes are heard the next time you press play, and in the export. Voice effects, pitch and noise reduction are under Volume.'));
  },
  // Records the microphone while the project plays, then drops the take at the playhead.
  async recordVoice() {
    if (!navigator.mediaDevices || typeof MediaRecorder === 'undefined') { toast('This browser can’t record sound.'); return; }
    let stream; try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); } catch (e) { toast('Microphone access was not allowed.', 4000); return; }
    const type = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find(t => MediaRecorder.isTypeSupported(t)) || '', rec = new MediaRecorder(stream, type ? { mimeType: type } : {}), chunks = [], t0 = App.time, started = performance.now();
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const clock = el('b', { class: 'recclock' }, '0.0 s'), tick = setInterval(() => { clock.textContent = ((performance.now() - started) / 1000).toFixed(1) + ' s'; }, 100);
    const stop = (keep) => { clearInterval(tick); Player.pause(); rec.onstop = async () => { stream.getTracks().forEach(t => t.stop()); this.closeModal(); if (!keep) return; const ext = (rec.mimeType || type).includes('mp4') ? 'm4a' : 'webm'; App.time = t0; await App.addMediaFiles([new File(chunks, `Voiceover ${new Date().toLocaleTimeString().replace(/[^\d]+/g, '-')}.${ext}`, { type: rec.mimeType || type })]); }; rec.stop(); };
    this.modal('Recording voiceover', el('div', { class: 'recbox' }, el('i', { class: 'recdot' }), clock, el('p', { class: 'hint' }, 'The project is playing so you can talk along. Use headphones so the microphone doesn’t pick up the playback.')), [['Discard', () => stop(false)], ['Stop and add', () => stop(true), 'primary']]);
    rec.start(250); Player.play();
  },
  // Camera recorder with scrolling script.
  async recordCamera() {
    if (!navigator.mediaDevices || typeof MediaRecorder === 'undefined') { toast('This browser can’t record from the camera.'); return; }
    let stream, facing = 'user'; const open = async () => { if (stream) stream.getTracks().forEach(t => t.stop()); stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: true }); vid.srcObject = stream; };
    const vid = el('video', { autoplay: true, playsinline: true, muted: true, class: 'camview' }); vid.muted = true;
    const script = el('div', { class: 'prompter hidden' }), inner = el('div', {}); script.appendChild(inner);
    const ta = el('textarea', { rows: 3, style: { width: '100%' }, placeholder: 'Paste your script here for the teleprompter (optional)' }); ta.addEventListener('keydown', (e) => e.stopPropagation());
    let speed = 40, rec = null, chunks = [], raf = 0, y = 0, last = 0;
    const scroll = (now) => { if (!rec) return; y += (now - last) / 1000 * speed; last = now; inner.style.transform = `translateY(${-y}px)`; raf = requestAnimationFrame(scroll); };
    const btnRec = el('button', { class: 'btn primary', onclick: () => {
      if (rec) { rec.stop(); return; }
      const type = ['video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'].find(t => MediaRecorder.isTypeSupported(t)) || ''; chunks = []; rec = new MediaRecorder(stream, type ? { mimeType: type, videoBitsPerSecond: 8e6 } : {});
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = async () => { cancelAnimationFrame(raf); const mt = rec.mimeType || type; rec = null; stream.getTracks().forEach(t => t.stop()); this.closeModal(); await App.addMediaFiles([new File(chunks, `Camera ${new Date().toLocaleTimeString().replace(/[^\d]+/g, '-')}.${mt.includes('mp4') ? 'mp4' : 'webm'}`, { type: mt })]); };
      inner.textContent = ta.value; script.classList.toggle('hidden', !ta.value.trim()); y = -60; last = performance.now(); rec.start(500); raf = requestAnimationFrame(scroll); btnRec.textContent = '■ Stop and add to project';
    } }, '● Record');
    this.modal('Record from camera', el('div', {}, el('div', { class: 'cambox' }, vid, script), ta,
      this.row('Script speed', el('input', { type: 'range', min: 10, max: 140, value: speed, oninput: (e) => { speed = +e.target.value; } })),
      el('div', { class: 'btnrow' }, btnRec, el('button', { class: 'btn', onclick: async () => { facing = facing === 'user' ? 'environment' : 'user'; try { await open(); } catch (e) { toast('Couldn’t switch cameras.'); } } }, 'Flip camera'))),
      [['Close', () => { if (rec) { rec.onstop = null; rec.stop(); } if (stream) stream.getTracks().forEach(t => t.stop()); cancelAnimationFrame(raf); this.closeModal(); }]]);
    try { await open(); } catch (e) { this.closeModal(); toast('Camera access was not allowed.', 4000); }
  }
});
(() => {
  const audioPanel = UI.panel_audio, mediaPanel = UI.panel_media;
  UI.panel_audio = function (body, l) { audioPanel.call(this, body, l); body.appendChild(el('div', { class: 'sect' }, 'Record')); body.appendChild(el('div', { class: 'btnrow' }, el('button', { class: 'btn sm', onclick: () => this.recordVoice() }, '● Record voiceover'))); };
  UI.panel_media = function (body, l) {
    mediaPanel.call(this, body, l);
    const q = el('input', { type: 'search', placeholder: 'Search media', oninput: (e) => { const v = e.target.value.toLowerCase(); for (const it of $$('.mitem', body)) it.style.display = !v || (it.title || '').toLowerCase().includes(v) ? '' : 'none'; } });
    body.insertBefore(q, body.children[1] || null);
    body.appendChild(el('div', { class: 'btnrow' }, el('button', { class: 'btn sm', onclick: () => this.recordCamera() }, '● Record from camera')));
  };
})();

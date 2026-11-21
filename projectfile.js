// ===========================================================================
// Project files and preview copies.
//
// ProjectFile.save packs a project into one .twoframe.zip: the project
// itself (project.json), every video, photo and sound it uses, plus any
// imported effects, LUTs and fonts. ProjectFile.open reads one back on any
// device. The zip is stored without compression because video is already
// compressed, which keeps saving fast on a phone.
//
// Proxies makes a smaller preview copy (720p) of a very large video so
// editing stays smooth. Export always switches back to the original file.
// ===========================================================================
const ProjectFile = {
  mediaIds(p) {
    const ids = new Set();
    const walk = (ls) => { for (const l of ls) { if (l.mediaId) ids.add(l.mediaId); if (l.children) walk(l.children); } };
    walk(p.layers || []);
    if (p.canvasBg && p.canvasBg.mediaId) ids.add(p.canvasBg.mediaId);
    for (const id of p.library || []) ids.add(id);
    return ids;
  },
  ext(name, fallback) { const m = /\.([a-z0-9]{1,5})$/i.exec(name || ''); return m ? m[1].toLowerCase() : fallback; },

  async save(p) {
    const json = JSON.stringify(p);
    const files = [], index = [];
    for (const id of this.mediaIds(p)) {
      const m = Media.items.get(id), rec = m ? { id, type: m.type, name: m.name, blob: m.blob } : await Store.get('media', id);
      if (!rec || !rec.blob) continue;
      const file = `media/${id}.${this.ext(rec.name, rec.type === 'image' ? 'png' : rec.type === 'audio' ? 'm4a' : 'mp4')}`;
      files.push({ name: file, blob: rec.blob }); index.push({ id, type: rec.type, name: rec.name, file });
    }
    // Effects, LUTs and fonts the project mentions by id or name.
    const extras = [];
    for (const r of await Store.all('effects')) {
      const key = String(r.key);
      if (key.startsWith('preset:')) continue;
      const id = key.startsWith('lut:') ? key.slice(4) : key;
      if (json.includes(JSON.stringify(id))) extras.push({ key, value: r.value });
    }
    const fonts = [];
    for (const r of await Store.all('media')) {
      if (!r.value || r.value.type !== 'font' || !json.includes(JSON.stringify(r.value.name))) continue;
      const file = `fonts/${fonts.length}.${this.ext(r.value.blob.name, 'ttf')}`;
      files.push({ name: file, blob: r.value.blob }); fonts.push({ name: r.value.name, file });
    }
    const meta = { app: 'TwoFrame', version: 2, saved: new Date().toISOString(), media: index, effects: extras, fonts };
    files.unshift({ name: 'project.json', blob: new Blob([json], { type: 'application/json' }) }, { name: 'contents.json', blob: new Blob([JSON.stringify(meta)], { type: 'application/json' }) });
    let zip;
    try { zip = await writeZip(files, (f) => UI.busy(`Packing project… ${Math.round(f * 100)}%`)); }
    finally { UI.busy(null); }
    const safe = (p.name || 'project').replace(/[^\w\- ]+/g, '').trim() || 'project';
    const how = await saveBlob(zip, safe + '.twoframe.zip');
    if (how === 'saved' || how === 'downloaded') toast('Project file saved.');
    else if (how === 'shared') toast('Project file ready. Pick where to keep it.');
    return how;
  },

  async open(file) {
    let entries;
    try { entries = await readZip(file); } catch (e) { throw new Error('This isn’t a TwoFrame project file. Pick a file that ends in .twoframe.zip.'); }
    const get = (n) => entries.find(e => e.name === n);
    if (!get('project.json')) throw new Error('This zip has no project.json inside, so it isn’t a TwoFrame project file.');
    const p = JSON.parse(await get('project.json').text());
    const meta = get('contents.json') ? JSON.parse(await get('contents.json').text()) : { media: [], effects: [], fonts: [] };
    for (const m of meta.media || []) {
      const e = get(m.file); if (!e) continue;
      if (Media.items.has(m.id) || await Store.get('media', m.id)) continue;
      const blob = await e.blob();
      const f = new File([blob], m.name, { type: blob.type || '' });
      await Store.put('media', m.id, { id: m.id, type: m.type, name: m.name, blob: f });
    }
    for (const x of meta.effects || []) {
      await Store.put('effects', x.key, x.value);
      if (x.key.startsWith('lut:')) { try { const { size, data } = Luts.parse(x.value.text); Luts.map.set(x.key.slice(4), { name: x.value.name, size, data, tex: null }); } catch (e) { } }
      else if (x.value && x.value.xml && !EffectLib.get(x.key)) { try { EffectLib.add(parseEffectXML(x.value.xml, x.value.name)); } catch (e) { } }
    }
    for (const f of meta.fonts || []) {
      if (Fonts.custom.has(f.name)) continue;
      const e = get(f.file); if (!e) continue;
      try { const blob = await e.blob(); const face = new FontFace(f.name, await blob.arrayBuffer()); await face.load(); document.fonts.add(face); Fonts.custom.add(f.name); await Store.put('media', 'font:' + f.name, { id: 'font:' + f.name, type: 'font', name: f.name, blob }); } catch (e) { }
    }
    // Opening a file never overwrites a project already on this device.
    if (await Store.get('projects', p.id)) { p.id = uid('p'); p.name = (p.name || 'Project') + ' (opened)'; }
    p.modified = Date.now();
    await Store.put('projects', p.id, p);
    return p;
  }
};

const Proxies = {
  originals: false,
  // Which address a video element should load for this media item.
  src(m) { return !this.originals && m.proxyUrl ? m.proxyUrl : m.url; },
  // Plays the clip once into a 720p recording. This runs in real time
  // (a 60 second clip takes about 60 seconds) because browsers can only
  // re-record video while it plays.
  async make(m) {
    if (!m || m.type !== 'video') return;
    if (m.proxyUrl) { toast('This clip already has a preview copy.'); return; }
    if (typeof MediaRecorder === 'undefined' || !HTMLCanvasElement.prototype.captureStream) { toast('This browser can’t make preview copies.'); return; }
    const k = Math.min(1, 1280 / Math.max(m.w, m.h)), W = Math.round(m.w * k / 2) * 2, H = Math.round(m.h * k / 2) * 2;
    const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.src = m.url; $('#videoPool').appendChild(v);
    const c = document.createElement('canvas'); c.width = W; c.height = H; const ctx = c.getContext('2d');
    const stream = c.captureStream(30);
    const type = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm'].find(t => MediaRecorder.isTypeSupported(t)) || '';
    const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 4e6 }), chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    let stop = false;
    UI.busy(`Making a preview copy of ${m.name}…`, () => { stop = true; });
    try {
      await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error('The video couldn’t be read.')); });
      rec.start(500); await v.play();
      await new Promise((res) => {
        const draw = () => {
          if (stop || v.ended) return res();
          ctx.drawImage(v, 0, 0, W, H);
          UI.busy(`Making a preview copy… ${Math.round(v.currentTime / (m.duration || 1) * 100)}%`, () => { stop = true; });
          requestAnimationFrame(draw);
        };
        draw();
      });
      await new Promise((res) => { rec.onstop = res; rec.stop(); });
      if (stop) { toast('Preview copy cancelled.'); return; }
      const blob = new Blob(chunks, { type: rec.mimeType || 'video/webm' });
      m.proxyUrl = URL.createObjectURL(blob);
      Store.put('media', 'proxy:' + m.id, { id: 'proxy:' + m.id, type: 'proxy', name: m.name, blob }).catch(() => {});
      this.reload();
      toast('Preview copy ready. Export still uses the full-quality original.');
    } catch (e) { toast(e.message || 'Couldn’t make the preview copy.'); }
    finally { v.pause(); v.remove(); UI.busy(null); }
  },
  async restore(m) {
    if (!m || m.type !== 'video' || m.proxyUrl) return;
    const r = await Store.get('media', 'proxy:' + m.id);
    if (r && r.blob) m.proxyUrl = URL.createObjectURL(r.blob);
  },
  // Switches every video element between preview copies and originals.
  useOriginals(on) {
    if (this.originals === !!on) return;
    this.originals = !!on; this.reload();
  },
  find(ls, id) { for (const l of ls) { if (l.id === id) return l; if (l.children) { const c = this.find(l.children, id); if (c) return c; } } return null; },
  reload() {
    for (const [id, r] of Runtime.map) {
      if (!r.video) continue;
      const l = App.project && this.find(App.project.layers, id); const m = l && Media.items.get(l.mediaId); if (!m) continue;
      const want = this.src(m);
      if (r.video.src !== want) { r.video.src = want; r.video.load(); for (const rt of r.cache.values()) engine.freeRT(rt); r.cache.clear(); }
    }
    App.requestRender();
  }
};

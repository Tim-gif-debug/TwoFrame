// ===========================================================================
// UI: home screen, panels, inspector, bottom sheets, tools and dialogs.
// The timeline lives in timeline.js, keyframe lanes in lanes.js and the
// on-canvas handles in canvas-tools.js; they all add to this UI object.
// ===========================================================================
const UI = {
  pps: 80, tool: null, sheetOpen: false, leftTool: 'media', multi: false,

  init() {
    $('#fileMedia').addEventListener('change', (e) => { const f = Array.from(e.target.files || []); e.target.value = ''; if (f.length) App.addMediaFiles(f, this._mediaOpts || {}); this._mediaOpts = null; });
    $('#fileFx').addEventListener('change', (e) => { const f = Array.from(e.target.files || []); e.target.value = ''; if (f.length) this.importEffects(f); });
    $('#fileAny').addEventListener('change', (e) => { const f = Array.from(e.target.files || []); e.target.value = ''; if (f.length && this._anyCb) this._anyCb(f); });
    this.initKeys();
    this.initStageGestures();
    this.initTimeline();
    this.initOverlay();
    Layout.initResizers();
  },
  pickFiles(accept, cb, multiple = false) { const i = $('#fileAny'); i.accept = accept; i.multiple = multiple; this._anyCb = cb; i.click(); },
  pickMedia(opts) { this._mediaOpts = opts; $('#fileMedia').click(); },

  // A small message with a spinner while something slow runs. Pass onCancel
  // to show a Cancel button.
  busy(msg, onCancel) {
    let b = $('#busy');
    if (!msg) { if (b) b.remove(); return; }
    if (!b) { b = el('div', { id: 'busy' }, el('i', { class: 'spin' }), el('span', { class: 'msg' }), el('button', { class: 'btn sm hidden' }, 'Cancel')); document.body.appendChild(b); }
    $('.msg', b).textContent = msg;
    const c = $('button', b); c.classList.toggle('hidden', !onCancel); c.onclick = onCancel || null;
  },

  // ---- keyboard shortcuts (computer) ------------------------------------------
  initKeys() {
    document.addEventListener('keydown', (e) => {
      if (!App.project || $('#editor').classList.contains('hidden')) return;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) || $('#modal:not(.hidden)')) return;
      const p = App.project, f = 1 / p.fps, k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
      if (e.code === 'Space') { e.preventDefault(); Player.shuttle = 0; Player.toggle(); }
      else if (k === 'l' && !mod) { Player.shuttleBy(1); }
      else if (k === 'j' && !mod) { Player.shuttleBy(-1); }
      else if (k === 'k' && !mod) {
        // K pauses while shuttling; when stopped it adds a keyframe.
        if (Player.playing || Player.shuttle) Player.stopShuttle(); else { const l = App.layer(); if (l) { KF.toggleTransform(l); this.refresh(); } else toast('Select a clip to add a keyframe.'); }
      }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); App.setTime(App.time - (e.shiftKey ? 10 : 1) * f); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); App.setTime(App.time + (e.shiftKey ? 10 : 1) * f); }
      else if (k === 's' && !mod) App.split();
      else if (k === 'm' && !mod) App.addMarker();
      else if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? App.redo() : App.undo(); }
      else if (mod && k === 'y') { e.preventDefault(); App.redo(); }
      else if (mod && k === 'c' && this.kfSel && this.kfSel.length) { e.preventDefault(); KF.copy(App.layer(), this.kfSel); }
      else if (mod && k === 'v' && KF.clipboard && App.layer()) { e.preventDefault(); KF.paste(App.layer()); this.refresh(); }
      else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (this.kfSel && this.kfSel.length) { KF.remove(App.layer(), this.kfSel); this.kfSel = []; this.refresh(); }
        else if (App.sel) App.remove();
      }
    });
  },

  // ---- home ---------------------------------------------------------------
  async showHome() {
    Player.pause();
    if (App.project) App.save(true);
    App.project = null;
    $('#editor').classList.add('hidden'); $('#home').classList.remove('hidden');
    const list = $('#projectList'); list.innerHTML = '';
    const rows = (await Store.all('projects')).map(r => r.value).sort((a, b) => (b.modified || 0) - (a.modified || 0));
    if (!Store.ok) list.appendChild(el('p', { class: 'note' }, 'Storage is blocked in this browser view, so projects won’t be saved between visits.'));
    if (!rows.length) list.appendChild(el('p', { class: 'empty' }, 'No projects yet. Start one above.'));
    for (const p of rows) {
      list.appendChild(el('div', { class: 'pcard', onclick: () => App.open(p) },
        el('div', { class: 'pthumb', style: p.thumb ? { backgroundImage: `url(${p.thumb})` } : {} }),
        el('div', { class: 'pinfo' }, el('b', {}, p.name), el('span', {}, `${p.width}×${p.height} · ${p.fps} fps · ${p.duration.toFixed(1)} s`)),
        btn('more', 'Project options', (e) => { e.stopPropagation(); this.menu(e.clientX, e.clientY, [
          ['Save project file', async () => { this.busy('Packing project…'); try { await ProjectFile.save(App.migrate(deepCopy(p))); } finally { this.busy(null); } }],
          ['Duplicate', async () => { const c = deepCopy(p); c.id = uid('p'); c.name += ' copy'; c.modified = Date.now(); await Store.put('projects', c.id, c); this.showHome(); }],
          ['Delete', () => this.confirm(`Delete “${p.name}”? This can’t be undone.`, async () => { await Store.del('projects', p.id); this.showHome(); }), 'danger']
        ]); }, 'ghost')));
    }
    $('#fxCount').textContent = `${EffectLib.list().length} effects · ${TRANSITIONS.length} transitions · ${TEXT_ANIMS.length} text animations`;
  },
  newProjectDialog() {
    let preset = PRESETS[0], fps = 30;
    const sel = el('div', { class: 'presets' }, PRESETS.map((p, i) => el('button', {
      class: 'preset' + (i === 0 ? ' on' : ''), onclick: (e) => { preset = p; $$('.preset', sel).forEach(b => b.classList.remove('on')); e.currentTarget.classList.add('on'); }
    }, el('i', { style: { aspectRatio: `${p.w}/${p.h}` } }), el('span', {}, p.name), el('small', {}, `${p.w}×${p.h}`))));
    const fpsSel = el('select', { onchange: (e) => fps = +e.target.value }, [24, 25, 30, 50, 60].map(f => el('option', { value: f, selected: f === 30 }, f + ' fps')));
    this.modal('New project', el('div', {}, sel, el('label', { class: 'row' }, el('span', {}, 'Frame rate'), fpsSel)), [
      ['Cancel', () => this.closeModal()],
      ['Create', async () => { this.closeModal(); const p = App.newProject(preset, fps); await Store.put('projects', p.id, p); App.open(p); }, 'primary']
    ]);
  },
  openProjectFile() {
    this.pickFiles('.zip,.twoframe,application/zip', async ([f]) => {
      this.busy('Opening project…');
      try { const p = await ProjectFile.open(f); this.busy(null); App.open(p); } catch (e) { this.busy(null); this.modal('Couldn’t open that file', el('p', {}, e.message), [['OK', () => this.closeModal()]]); }
    });
  },

  // ---- editor shell -------------------------------------------------------------
  showEditor() {
    $('#home').classList.add('hidden'); $('#editor').classList.remove('hidden');
    $('#projName').textContent = App.project.name;
    this.tool = null; this.closeSheet(true);
    this.leftTool = this.leftTool || 'media';
    this.refresh();
    requestAnimationFrame(() => { this.fitStage(); this.renderTimeline(); this.updatePlayhead(); });
  },
  refresh() {
    if (!App.project) return;
    this.renderTimeline(); this.renderToolbar(); this.renderLeft(); this.refreshPanel(); this.updateTransport(); this.updateHistoryButtons(); this.drawOverlay();
  },
  updateHistoryButtons() { const u = $('#undoBtn'), r = $('#redoBtn'); if (u) u.disabled = !App.undoStack.length; if (r) r.disabled = !App.redoStack.length; },
  onLayoutChange() {
    if (!App.project) return;
    if (Layout.mode === 'desktop') { $('#sheet').classList.remove('hidden'); document.body.classList.remove('sheet-open'); }
    else if (!this.sheetOpen) $('#sheet').classList.add('hidden');
    this.refresh(); this.onResize();
  },
  // The keyboard and Safari's bars change the height often; only a width change needs the timeline rebuilt.
  onResize() { this.fitStage(); if (this._lastW !== innerWidth || Layout.mode === 'desktop') { this._lastW = innerWidth; this.renderTimeline(); } this.updatePlayhead(); this.drawOverlay(); },
  fitStage() {
    const p = App.project, stage = $('#stage'), c = $('#gl'); if (!p || !stage) return;
    const r = stage.getBoundingClientRect(); const pad = 12;
    const k = Math.max(0.01, Math.min((r.width - pad * 2) / p.width, (r.height - pad * 2) / p.height));
    c.style.width = Math.max(10, p.width * k) + 'px'; c.style.height = Math.max(10, p.height * k) + 'px';
    const o = $('#overlay'); if (o) { o.style.width = c.style.width; o.style.height = c.style.height; }
    const spec = $('#specChip'); if (spec) spec.textContent = `${p.width}×${p.height} · ${p.fps}fps`;
  },
  updateTransport() {
    const b = $('#playBtn'); if (b) b.innerHTML = Player.playing ? ICON.pause : ICON.play;
    $('#loopBtn')?.classList.toggle('on', App.loop);
    const q = $('#qualityBtn'); if (q) q.textContent = { full: 'Full', half: 'Half', quarter: '¼' }[App.quality];
    $('#snapBtn')?.classList.toggle('on', App.snapping);
    $('#magBtn')?.classList.toggle('on', !!(App.project && App.project.magnetic));
    $('#multiBtn')?.classList.toggle('on', this.multi);
    const l = App.layer(), kb = $('#kfAddBtn');
    if (kb) { const on = l && KF.paths(l).some(p => App.keyAt(l, p)); kb.classList.toggle('on', !!on); kb.classList.toggle('haskeys', !!(l && KF.paths(l).length)); kb.disabled = !l; kb.title = on ? 'Remove this keyframe' : 'Add a keyframe here'; }
    // Light up the diamond under the playhead.
    if (l) { const now = App.time - l.start, half = 0.5 / App.project.fps; for (const d of $$('.clip.sel .kmark')) d.classList.toggle('now', Math.abs(+d.dataset.t - now) < half); }
    this.updatePlayhead();
  },

  // ---- tools: which panels exist and where they open --------------------------
  // Asset tools work without a selection (left panel on computer, top-level
  // toolbar on phone). Clip tools need a selected clip (inspector / sheet).
  assetTools() {
    return [
      ['media', 'Media', 'media'], ['audio', 'Audio', 'audio'], ['text', 'Text', 'text'], ['stickers', 'Stickers', 'sticker'],
      ['effectsLib', 'Effects', 'fx'], ['transitions', 'Transitions', 'transition'], ['filters', 'Filters', 'filter'], ['captions', 'Captions', 'captions']
    ];
  },
  clipTools(l) {
    if (!l) return [];
    const t = [];
    if (l.type !== 'audio') t.push(['transform', l.type === 'adjust' ? 'Opacity' : 'Edit', 'edit']);
    if (l.type !== 'audio') t.push(['fx', 'Effects', 'fx']);
    t.push(['keyframes', 'Keyframe', 'keyframe']);
    if (l.type === 'text') t.push(['style', 'Style', 'text'], ['animate', 'Animate', 'animate']);
    if (l.type === 'caption') t.push(['style', 'Style', 'text'], ['captionEdit', 'Lines', 'captions']);
    if (l.type === 'shape') t.push(['style', 'Shape', 'shape']);
    if (l.type === 'solid') t.push(['style', 'Color', 'canvas']);
    if (l.type === 'video') t.push(['speed', 'Speed', 'speed']);
    if (l.type === 'video' || l.type === 'audio') t.push(['volume', 'Volume', 'volume']);
    if (VISUAL_TYPES.has(l.type)) t.push(['trans', 'Transition', 'transition'], ['blend', 'Blend', 'blend'], ['mask', 'Mask', 'mask']);
    t.push(['layer', 'Layer', 'layers']);
    return t;
  },
  // Phone toolbar: the requested ten tools when nothing is selected.
  renderToolbar() {
    const bar = $('#toolbar'); if (!bar) return;
    bar.innerHTML = '';
    const l = App.layer();
    const add = (id, label, icon, fn, cls = '') => bar.appendChild(el('button', { class: 'tbtn ' + cls + (id === this.tool && this.sheetOpen ? ' on' : ''), onclick: fn, html: (ICON[icon] || '') + (label ? `<span>${label}</span>` : '') }));
    if (!l) {
      const selUnder = (types) => { const T = App.time; const c = App.project.layers.filter(x => types.includes(x.type) && T >= x.start && T < x.start + x.dur).sort((a, b) => (App.track(b.track)?.kind === 'main') - (App.track(a.track)?.kind === 'main'))[0]; if (c) { App.sel = c.id; App.selIds = new Set([c.id]); } return c; };
      add('edit', 'Edit', 'edit', () => { if (selUnder(['video', 'image', 'text', 'shape', 'solid', 'caption', 'group'])) this.openTool('transform'); else toast('Move the playhead over a clip, or add media first.'); });
      add('audio', 'Audio', 'audio', () => this.openTool('audio'));
      add('text', 'Text', 'text', () => this.openTool('text'));
      add('effectsLib', 'Effects', 'fx', () => this.openTool('effectsLib'));
      add('filters', 'Filters', 'filter', () => this.openTool('filters'));
      add('keyframes', 'Keyframe', 'keyframe', () => { if (selUnder(['video', 'image', 'text', 'shape', 'solid', 'caption', 'group', 'adjust'])) this.openTool('keyframes'); else toast('Move the playhead over a clip first.'); });
      add('speed', 'Speed', 'speed', () => { if (selUnder(['video'])) this.openTool('speed'); else toast('Move the playhead over a video clip first.'); });
      add('captions', 'Captions', 'captions', () => this.openTool('captions'));
      add('overlay', 'Overlay', 'overlay', () => this.openTool('overlay'));
      add('canvas', 'Canvas', 'canvas', () => this.openTool('canvas'));
      add('stickers', 'Stickers', 'sticker', () => this.openTool('stickers'));
      add('transitions', 'Transitions', 'transition', () => this.openTool('transitions'));
      return;
    }
    add('back', '', 'back', () => { App.sel = null; App.selIds.clear(); this.closeSheet(true); this.refresh(); }, 'back');
    for (const [id, label, icon] of this.clipTools(l)) add(id, label, icon, () => this.openTool(id));
    add('split', 'Split', 'split', () => App.split());
    add('dup', 'Duplicate', 'copy', () => App.duplicate());
    if (l.type === 'video') { add('freeze', 'Freeze', 'freeze', () => App.freezeFrame()); add('reverse', 'Reverse', 'reverse', () => App.toggleReverse()); }
    add('del', 'Delete', 'trash', () => App.remove(), 'danger');
  },
  // Opens a tool: bottom sheet on phone, inspector or left panel on computer.
  openTool(id) {
    const isAsset = this.assetTools().some(t => t[0] === id) || ['overlay', 'canvas'].includes(id);
    if (Layout.mode === 'desktop' && isAsset && id !== 'canvas') { this.leftTool = id; this.renderLeft(); return; }
    this.tool = id; this.sheetOpen = true;
    if (Layout.mode === 'mobile') {
      $('#sheet').classList.remove('hidden'); document.body.classList.add('sheet-open');
      requestAnimationFrame(() => { this.fitStage(); this.drawOverlay(); });
    }
    this.renderToolbar(); this.refreshPanel();
  },
  showTab(id) { this.openTool(id); },
  closeSheet(silent) {
    this.sheetOpen = false;
    if (Layout.mode === 'mobile') { $('#sheet')?.classList.add('hidden'); document.body.classList.remove('sheet-open'); requestAnimationFrame(() => { this.fitStage(); this.renderTimeline(); this.updatePlayhead(); this.drawOverlay(); }); }
    if (!silent) this.renderToolbar();
  },
  afterAdd(l) {
    this.refresh();
    if (l.type === 'text') this.openTool('style');
  },
  toolTitle(id, l) {
    const all = [...this.assetTools(), ...this.clipTools(l), ['overlay', 'Overlay'], ['canvas', 'Canvas & Settings']];
    return (all.find(t => t[0] === id) || [0, ''])[1];
  },
  // Inspector (computer) or sheet (phone) contents.
  refreshPanel() {
    const body = $('#panelBody'); if (!body || !App.project) return;
    const l = App.layer();
    let id = this.tool;
    if (Layout.mode === 'desktop') {
      // Inspector shows clip tools as tabs; with nothing selected, canvas settings.
      const tools = this.clipTools(l);
      if (!l) id = 'canvas';
      else if (!tools.some(t => t[0] === id)) id = tools[0][0];
      this.tool = id;
      const tabs = $('#inspTabs'); tabs.innerHTML = '';
      if (l) for (const [tid, label] of tools) tabs.appendChild(el('button', { class: 'chip' + (tid === id ? ' on' : ''), onclick: () => { this.tool = tid; this.refreshPanel(); } }, label));
      else tabs.appendChild(el('span', { class: 'insp-title' }, 'Canvas & Settings'));
    } else {
      if (!this.sheetOpen) { body.innerHTML = ''; return; }
      const needsLayer = !this.assetTools().some(t => t[0] === id) && !['overlay', 'canvas'].includes(id);
      if (needsLayer && !l) { this.closeSheet(); return; }
      $('#sheetTitle').textContent = this.toolTitle(id, l);
      $('#inspTabs').innerHTML = '';
    }
    const st = body.scrollTop;
    body.innerHTML = '';
    const f = this['panel_' + id]; if (f) f.call(this, body, l);
    body.scrollTop = st;
  },
  // Left panel on computer: asset tools as a vertical tab strip.
  renderLeft() {
    const tabs = $('#leftTabs'), body = $('#leftBody'); if (!tabs || Layout.mode !== 'desktop' || !App.project) return;
    tabs.innerHTML = '';
    for (const [id, label, icon] of [...this.assetTools(), ['overlay', 'Overlay', 'overlay']]) tabs.appendChild(el('button', { class: 'ltab' + (id === this.leftTool ? ' on' : ''), title: label, onclick: () => { this.leftTool = id; this.renderLeft(); }, html: ICON[icon] + `<span>${label}</span>` }));
    const st = body.scrollTop; body.innerHTML = '';
    const f = this['panel_' + this.leftTool]; if (f) f.call(this, body, App.layer());
    body.scrollTop = st;
  },
  renderLibrary() { if (Layout.mode === 'desktop' && this.leftTool === 'media') this.renderLeft(); else if (this.tool === 'media' && this.sheetOpen) this.refreshPanel(); },

  // Light refresh while scrubbing: updates values and key states in place.
  refreshPanelValues() {
    const l = App.layer(); if (!l) return;
    for (const row of $$('#panelBody [data-path]')) {
      const path = row.dataset.path, v = evalProp(l, path, App.time - l.start);
      row._set && row._set(v);
      const kb = $('.kbtn', row); if (kb) { const k = App.keyAt(l, path); kb.classList.toggle('has', App.keysOf(l, path).length > 0); kb.classList.toggle('on', !!k); kb.className = kb.className.replace(/kf-\w+/g, '') + ' ' + (k ? easeShape(k.e) : 'kf-linear'); }
    }
    if (this.tool === 'keyframes') this.drawLanes && this.drawLanes();
    this.updateTransport();
  },

  // ---- property row -----------------------------------------------------------
  // Keyframe diamond, label, slider and number box. The diamond fills in when
  // the playhead sits on a keyframe; its shape shows the easing.
  propRow(l, path, label, o = {}) {
    const t = App.time - l.start;
    const row = el('div', { class: 'prop', 'data-path': path });
    const k0 = App.keyAt(l, path);
    const kb = el('button', { class: 'kbtn ' + (k0 ? easeShape(k0.e) : 'kf-linear'), title: 'Add or remove keyframe', html: '<i></i>', onclick: () => App.toggleKey(l, path) });
    kb.classList.toggle('has', App.keysOf(l, path).length > 0); kb.classList.toggle('on', !!k0);
    if (o.noKey) kb.style.visibility = 'hidden';
    const lab = el('span', { class: 'plabel' }, label);
    const v0 = evalProp(l, path, t);
    let ctrl, set;
    if (o.type === 'color') {
      ctrl = el('input', { type: 'color', value: colorToHex(v0 || [1, 1, 1, 1]), oninput: (e) => App.setProp(l, path, [...parseColor(e.target.value).slice(0, 3), (evalProp(l, path, App.time - l.start) || [1, 1, 1, 1])[3] ?? 1]) });
      set = (v) => { ctrl.value = colorToHex(v || [1, 1, 1, 1]); };
      row.append(kb, lab, ctrl);
    } else if (o.type === 'bool') {
      ctrl = el('input', { type: 'checkbox', class: 'tog', checked: !!v0, onchange: (e) => { App.setProp(l, path, e.target.checked); if (o.rerender) this.refreshPanel(); } });
      set = (v) => { ctrl.checked = !!v; };
      row.append(kb, lab, el('span', { class: 'grow' }), ctrl);
    } else if (o.type === 'select') {
      ctrl = el('select', { onchange: (e) => { App.setProp(l, path, isNaN(+e.target.value) || e.target.value === '' ? e.target.value : +e.target.value); if (o.rerender) this.refreshPanel(); } }, o.choices.map(c => el('option', { value: c.value, selected: c.value == v0 }, c.label)));
      set = (v) => { ctrl.value = v; };
      row.append(kb, lab, ctrl);
    } else if (o.type === 'textarea') {
      ctrl = el('textarea', { rows: 2, oninput: (e) => App.setProp(l, path, e.target.value) }, v0);
      set = () => {};
      row.classList.add('tall'); row.append(kb, lab, ctrl);
    } else {
      const min = o.min ?? 0, max = o.max ?? 100, step = o.step ?? 1;
      const range = el('input', { type: 'range', min: o.smin ?? min, max: o.smax ?? max, step, value: v0 });
      const box = el('input', { type: 'number', min, max, step, value: +(+v0).toFixed(3), inputmode: 'decimal' });
      const apply = (v) => { v = clamp(+v, o.hardMin ?? -1e9, o.hardMax ?? 1e9); if (Number.isNaN(v)) return; App.setProp(l, path, v); box.value = +v.toFixed(3); range.value = v; this.drawOverlay(); };
      range.addEventListener('input', () => apply(+range.value));
      box.addEventListener('change', () => apply(+box.value));
      set = (v) => { if (document.activeElement !== box) box.value = +(+v).toFixed(3); range.value = v; };
      row.append(kb, lab, range, box);
    }
    row._set = set;
    if (k0) {
      const es = el('select', { class: 'ease', title: 'Easing from this keyframe', onchange: (e) => { KF.setEase(l, [{ path, k: k0 }], e.target.value); this.refreshPanel(); this.renderTimeline(); } },
        EASE_NAMES.map(([v, n]) => el('option', { value: v, selected: k0.e === v }, n)));
      row.appendChild(es);
    }
    return row;
  },
  section(body, title) { body.appendChild(el('div', { class: 'sect' }, title)); },
  row(label, ctrl) { return el('label', { class: 'row' }, el('span', {}, label), ctrl); },

  // ---- clip panels ---------------------------------------------------------------
  panel_transform(body, l) {
    const p = App.project;
    if (l.type !== 'adjust') {
      body.append(
        this.propRow(l, 'transform.x', 'Position X', { min: -p.width * 3, max: p.width * 4, smin: l.parent ? -p.width : 0, smax: p.width }),
        this.propRow(l, 'transform.y', 'Position Y', { min: -p.height * 3, max: p.height * 4, smin: l.parent ? -p.height : 0, smax: p.height }),
        this.propRow(l, 'transform.scale', 'Scale %', { min: 0, max: 4000, smax: 400, step: 0.1 }),
        this.propRow(l, 'transform.rotation', 'Rotation°', { min: -7200, max: 7200, smin: -360, smax: 360, step: 0.1 }));
    }
    body.append(this.propRow(l, 'transform.opacity', 'Opacity %', { min: 0, max: 100, hardMin: 0, hardMax: 100 }));
    if (l.type === 'adjust') return;
    body.append(this.propRow(l, 'transform.anchorX', 'Anchor X', { min: -4000, max: 4000, smin: -500, smax: 500 }),
      this.propRow(l, 'transform.anchorY', 'Anchor Y', { min: -4000, max: 4000, smin: -500, smax: 500 }),
      this.propRow(l, 'transform.flipX', 'Flip horizontal', { type: 'bool', noKey: true }),
      this.propRow(l, 'transform.flipY', 'Flip vertical', { type: 'bool', noKey: true }));
    const m = l.mediaId ? Media.items.get(l.mediaId) : null;
    body.appendChild(el('div', { class: 'btnrow' },
      el('button', { class: 'btn', onclick: () => { App.setProp(l, 'transform.x', l.parent ? 0 : p.width / 2); App.setProp(l, 'transform.y', l.parent ? 0 : p.height / 2); this.refreshPanel(); } }, 'Center'),
      m ? el('button', { class: 'btn', onclick: () => { App.setProp(l, 'transform.scale', Math.round(Math.max(p.width / m.w, p.height / m.h) * 1000) / 10); this.refreshPanel(); } }, 'Fill frame') : null,
      m ? el('button', { class: 'btn', onclick: () => { App.setProp(l, 'transform.scale', Math.round(Math.min(p.width / m.w, p.height / m.h) * 1000) / 10); this.refreshPanel(); } }, 'Fit frame') : null,
      el('button', { class: 'btn', onclick: () => { App.change(() => { l.transform.rotation = ((l.transform.rotation || 0) + 90) % 360; }); this.refreshPanel(); } }, 'Rotate 90°')));
    if (['video', 'image', 'text', 'shape', 'group'].includes(l.type)) {
      this.section(body, 'Crop');
      l.crop = l.crop || { l: 0, t: 0, r: 0, b: 0 };
      for (const [k, n] of [['l', 'Left'], ['r', 'Right'], ['t', 'Top'], ['b', 'Bottom']]) body.appendChild(this.propRow(l, 'crop.' + k, 'Crop ' + n, { min: 0, max: 0.95, step: 0.005 }));
    }
    this.section(body, 'Parent');
    const others = App.project.layers.filter(o => o !== l && VISUAL_TYPES.has(o.type));
    body.appendChild(this.row('Follow layer', el('select', { onchange: (e) => App.setParent(l, e.target.value || null) },
      el('option', { value: '' }, 'None'), others.map(o => el('option', { value: o.id, selected: l.parent === o.id }, o.name + (o.type === 'null' ? ' (null)' : ''))))));
    body.appendChild(el('p', { class: 'hint' }, 'A layer that follows another moves, turns and scales with it. Add a Null layer under Layer to use as an invisible controller. Drag on the preview to move, pinch or use the corner handles to scale and rotate.'));
  },

  panel_style(body, l) {
    if (l.type === 'text' || l.type === 'caption') {
      const T = (k, label, o) => this.propRow(l, 'text.' + k, label, o);
      if (l.type === 'text') body.append(T('content', 'Text', { type: 'textarea', noKey: true }));
      const fontSel = el('select', { onchange: (e) => { Fonts.ensure(e.target.value); App.setProp(l, 'text.font', e.target.value); } },
        el('optgroup', { label: 'System' }, Object.keys(FONT_STACKS).map(f => el('option', { value: f, selected: l.text.font === f }, f))),
        Fonts.custom.size ? el('optgroup', { label: 'Your fonts' }, Array.from(Fonts.custom).map(f => el('option', { value: f, selected: l.text.font === f }, f))) : null,
        el('optgroup', { label: 'Google Fonts' }, Object.keys(GOOGLE_FONTS).map(f => el('option', { value: f, selected: l.text.font === f }, f))));
      body.append(el('div', { class: 'prop' }, el('span', { class: 'kbtn', style: { visibility: 'hidden' } }), el('span', { class: 'plabel' }, 'Font'), fontSel,
        el('button', { class: 'btn sm', onclick: () => this.pickFiles('.ttf,.otf,.woff,.woff2', async ([f]) => { try { const n = await Fonts.addFile(f); App.setProp(l, 'text.font', n); this.refreshPanel(); toast(`Added the font ${n}`); } catch (e) { toast('That font file couldn’t be read.'); } }) }, 'Upload')));
      body.append(T('size', 'Size', { min: 4, max: 2000, smin: 8, smax: 500 }),
        T('weight', 'Weight', { type: 'select', noKey: true, choices: [300, 400, 500, 600, 700, 800, 900].map(w => ({ value: w, label: String(w) })) }),
        T('italic', 'Italic', { type: 'bool', noKey: true }),
        T('align', 'Align', { type: 'select', noKey: true, choices: ['left', 'center', 'right'].map(a => ({ value: a, label: a[0].toUpperCase() + a.slice(1) })) }),
        T('letterSpacing', 'Letter spacing', { min: -50, max: 200, smin: -20, smax: 80 }),
        T('lineHeight', 'Line height', { min: 0.5, max: 3, step: 0.01 }),
        T('curve', 'Curve°', { min: -360, max: 360, smin: -270, smax: 270 }));
      this.section(body, 'Fill');
      body.append(T('fillType', 'Fill type', { type: 'select', noKey: true, rerender: true, choices: [{ value: 'solid', label: 'Solid' }, { value: 'gradient', label: 'Gradient' }] }), T('color', 'Colour', { type: 'color' }));
      if (l.text.fillType === 'gradient') body.append(T('color2', 'Colour 2', { type: 'color' }), T('gradAngle', 'Gradient angle', { min: -180, max: 180 }));
      this.section(body, 'Strokes');
      body.append(T('strokeOn', 'Stroke', { type: 'bool', noKey: true }), T('stroke', 'Stroke colour', { type: 'color' }), T('strokeWidth', 'Stroke width', { min: 0, max: 100 }),
        T('stroke2On', 'Outer stroke', { type: 'bool', noKey: true }), T('stroke2', 'Outer colour', { type: 'color' }), T('stroke2Width', 'Outer width', { min: 0, max: 150 }));
      this.section(body, 'Shadow and glow');
      body.append(T('shadowOn', 'Drop shadow', { type: 'bool', noKey: true }), T('shadowColor', 'Shadow colour', { type: 'color' }), T('shadowBlur', 'Shadow blur', { min: 0, max: 100 }), T('shadowX', 'Shadow X', { min: -100, max: 100 }), T('shadowY', 'Shadow Y', { min: -100, max: 100 }),
        T('glowOn', 'Outer glow', { type: 'bool', noKey: true }), T('glowColor', 'Glow colour', { type: 'color' }), T('glowSize', 'Glow size', { min: 0, max: 150 }));
      this.section(body, 'Background box');
      body.append(T('boxOn', 'Box', { type: 'bool', noKey: true }), T('boxColor', 'Box colour', { type: 'color' }), T('boxPad', 'Padding', { min: 0, max: 200 }), T('boxRadius', 'Corner radius', { min: 0, max: 200 }));
      if (l.type === 'text') { this.section(body, 'Templates'); body.appendChild(this.templateGrid()); }
      for (const k of Object.keys(TEXT_DEFAULTS)) if (l.text[k] === undefined) l.text[k] = deepCopy(TEXT_DEFAULTS[k]);
    } else if (l.type === 'shape') {
      for (const k of Object.keys(SHAPE_DEFAULTS)) if (l.shape[k] === undefined) l.shape[k] = deepCopy(SHAPE_DEFAULTS[k]);
      const S = (k, label, o) => this.propRow(l, 'shape.' + k, label, o);
      body.append(
        S('kind', 'Shape', { type: 'select', noKey: true, choices: [['rect', 'Rectangle'], ['ellipse', 'Ellipse'], ['polygon', 'Polygon'], ['star', 'Star'], ['line', 'Line']].map(([v, n]) => ({ value: v, label: n })) }),
        S('w', 'Width', { min: 1, max: 8000, smax: 2000 }), S('h', 'Height', { min: 1, max: 8000, smax: 2000 }),
        S('radius', 'Corner radius', { min: 0, max: 2000, smax: 400 }), S('points', 'Points / sides', { min: 3, max: 40 }), S('inner', 'Star inner', { min: 0.05, max: 1, step: 0.01 }),
        S('fillOn', 'Fill', { type: 'bool', noKey: true }), S('fill', 'Fill colour', { type: 'color' }),
        S('strokeOn', 'Stroke', { type: 'bool', noKey: true }), S('stroke', 'Stroke colour', { type: 'color' }), S('strokeWidth', 'Stroke width', { min: 0, max: 300 }));
      this.section(body, 'Trim paths');
      body.append(S('trimStart', 'Start %', { min: 0, max: 100 }), S('trimEnd', 'End %', { min: 0, max: 100 }), S('trimOffset', 'Offset°', { min: -720, max: 720, smin: -360, smax: 360 }),
        el('p', { class: 'hint' }, 'Keyframe End from 0 to 100 % to make the outline draw itself on.'));
    } else if (l.type === 'solid') {
      body.append(this.propRow(l, 'solid.color', 'Colour', { type: 'color' }), this.propRow(l, 'solid.w', 'Width', { min: 1, max: 8000, smax: 4000 }), this.propRow(l, 'solid.h', 'Height', { min: 1, max: 8000, smax: 4000 }));
    }
    if (l.type === 'caption') this.captionStylePicker(body, l);
  },
  panel_animate(body, l) {
    const T = (k, label, o) => this.propRow(l, 'text.' + k, label, o);
    const pick = (kind) => [{ value: 'none', label: 'None' }, ...TEXT_ANIMS.filter(a => a.kind === kind).map(a => ({ value: a.id, label: a.name }))];
    body.append(T('animIn', 'In', { type: 'select', noKey: true, choices: pick('in') }), T('animInDur', 'In length (s)', { min: 0.05, max: 10, smax: 3, step: 0.05, noKey: true }),
      T('animOut', 'Out', { type: 'select', noKey: true, choices: pick('out') }), T('animOutDur', 'Out length (s)', { min: 0.05, max: 10, smax: 3, step: 0.05, noKey: true }),
      T('animLoop', 'Loop', { type: 'select', noKey: true, choices: pick('loop') }),
      T('animUnit', 'Animate by', { type: 'select', noKey: true, choices: [['auto', 'Preset default'], ['char', 'Letter'], ['word', 'Word'], ['line', 'Line']].map(([v, n]) => ({ value: v, label: n })) }),
      T('animStagger', 'Stagger', { min: 0, max: 0.95, step: 0.01, noKey: true }),
      el('p', { class: 'hint' }, `${TEXT_ANIMS.length} presets. Stagger spreads the animation across letters or words; 0 moves them all together.`));
  },
  panel_speed(body, l) {
    const m = Media.items.get(l.mediaId), v = l.video;
    const setSpeed = (ns) => {
      ns = clamp(+ns || 1, 0.05, 16);
      App.change(() => {
        const old = (v.speed || 1) * (v.curve ? curveIntegral(v.curve, 1) : 1); v.speed = ns;
        const now = ns * (v.curve ? curveIntegral(v.curve, 1) : 1);
        l.dur = Math.max(1 / App.project.fps, l.dur * old / now);
        if (m) l.dur = Math.min(l.dur, (m.duration - (l.in || 0)) / now);
        App.compactMain(); App.fitDuration(App.project, true);
      });
      this.refresh();
    };
    this.section(body, 'Constant speed');
    body.append(this.row('Speed', el('input', { type: 'number', min: 0.05, max: 16, step: 0.05, value: v.speed, onchange: (e) => setSpeed(e.target.value) })),
      el('div', { class: 'btnrow' }, [0.1, 0.25, 0.5, 1, 2, 4, 8].map(s => el('button', { class: 'btn' + (Math.abs(v.speed - s) < 1e-6 && !v.curve ? ' on' : ''), onclick: () => { if (v.curve) App.change(() => { v.curve = null; }); setSpeed(s); } }, s + '×'))));
    this.section(body, 'Curve speed');
    const curves = el('div', { class: 'btnrow' }, el('button', { class: 'btn' + (!v.curve ? ' on' : ''), onclick: () => { App.change(() => { v.curve = null; }); setSpeed(v.speed); } }, 'None'),
      Object.keys(SPEED_CURVES).map(n => el('button', { class: 'btn' + (v.curveName === n ? ' on' : ''), onclick: () => { App.change(() => { v.curve = SPEED_CURVES[n].map(p => p.slice()); v.curveName = n; }); setSpeed(v.speed); } }, n)));
    body.append(curves);
    if (v.curve) body.appendChild(this.curveEditor(l));
    this.section(body, 'Slow motion');
    body.append(this.row('In-between frames', el('select', { onchange: (e) => App.change(() => { v.interp = e.target.value; }) },
      [['none', 'Off (repeat frames)'], ['blend', 'Frame blend'], ['flow', 'Optical flow (smooth)']].map(([val, n]) => el('option', { value: val, selected: v.interp === val }, n)))),
      this.row('Source frame rate', el('input', { type: 'number', min: 1, max: 960, step: 0.001, value: v.srcFps, onchange: (e) => { App.change(() => { v.srcFps = clamp(+e.target.value || 30, 1, 960); }); Runtime.clearCaches(); } })),
      this.row('Reverse', el('input', { type: 'checkbox', class: 'tog', checked: !!v.reverse, onchange: () => App.toggleReverse() })),
      el('div', { class: 'btnrow' }, el('button', { class: 'btn', onclick: () => App.freezeFrame() }, 'Freeze frame at playhead')),
      el('p', { class: 'hint' }, 'Optical flow builds new in-between frames from the motion between real frames. It shows in the paused preview and in the export; playback repeats frames to stay real time. Speed curves change the picture timing; the sound keeps the constant speed.'),
      engine.floatRT ? '' : el('p', { class: 'warn' }, 'This device’s GPU lacks float render targets, so Optical flow falls back to Frame blend.'));
  },
  // Draggable speed curve points (x across the clip, y = speed 0.1×–10×).
  curveEditor(l) {
    const v = l.video, W = 300, H = 120, cv = el('canvas', { width: W * 2, height: H * 2, class: 'curve' });
    const yOf = (s) => H - (Math.log10(clamp(s, 0.1, 10)) + 1) / 2 * H, sOf = (y) => Math.pow(10, (1 - y / H) * 2 - 1);
    const draw = () => {
      const c = cv.getContext('2d'); c.setTransform(2, 0, 0, 2, 0, 0); c.clearRect(0, 0, W, H);
      c.strokeStyle = '#333'; for (const s of [0.1, 1, 10]) { c.beginPath(); c.moveTo(0, yOf(s)); c.lineTo(W, yOf(s)); c.stroke(); }
      c.fillStyle = '#777'; c.font = '10px system-ui'; c.fillText('10×', 2, 10); c.fillText('1×', 2, yOf(1) - 2); c.fillText('0.1×', 2, H - 2);
      c.strokeStyle = '#14e0c8'; c.lineWidth = 2; c.beginPath(); v.curve.forEach(([x, s], i) => i ? c.lineTo(x * W, yOf(s)) : c.moveTo(x * W, yOf(s))); c.stroke();
      c.fillStyle = '#fff'; for (const [x, s] of v.curve) { c.beginPath(); c.arc(x * W, yOf(s), 5, 0, 7); c.fill(); }
    };
    let drag = -1;
    cv.addEventListener('pointerdown', (e) => {
      const r = cv.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * W, y = (e.clientY - r.top) / r.height * H;
      drag = v.curve.findIndex(([px, s]) => Math.hypot(px * W - x, yOf(s) - y) < 14);
      if (drag < 0) { App.change(() => { v.curve.push([clamp(x / W, 0, 1), sOf(y)]); v.curve.sort((a, b) => a[0] - b[0]); v.curveName = 'Custom'; }); drag = v.curve.findIndex(p => Math.abs(p[0] - x / W) < 1e-6); }
      cv.setPointerCapture(e.pointerId); draw();
    });
    cv.addEventListener('pointermove', (e) => {
      if (drag < 0) return; const r = cv.getBoundingClientRect();
      const x = clamp((e.clientX - r.left) / r.width, 0, 1), y = clamp((e.clientY - r.top) / r.height * H, 0, H);
      App.change(() => { const pt = v.curve[drag]; const first = drag === 0, last = drag === v.curve.length - 1; pt[0] = first ? 0 : last ? 1 : clamp(x, v.curve[drag - 1][0] + 0.01, v.curve[drag + 1][0] - 0.01); pt[1] = Math.round(sOf(y) * 100) / 100; v.curveName = 'Custom'; }, 'curve' + l.id);
      draw();
    });
    cv.addEventListener('pointerup', () => { drag = -1; });
    draw();
    return el('div', { class: 'curvebox' }, cv, el('p', { class: 'hint' }, 'Drag points to change speed over the clip. Tap empty space to add a point.'));
  },
  panel_volume(body, l) {
    const m = Media.items.get(l.mediaId);
    if (!m || !m.audio) { body.append(el('p', { class: 'hint' }, m && m.audioSkipped ? 'This file was too large for its sound to be loaded.' : 'This clip has no sound the browser can read.')); return; }
    body.append(this.propRow(l, 'volume', 'Volume %', { min: 0, max: 400, smax: 200 }),
      this.row('Fade in (s)', el('input', { type: 'number', min: 0, max: 30, step: 0.1, value: l.fadeIn || 0, onchange: (e) => App.change(() => { l.fadeIn = clamp(+e.target.value || 0, 0, l.dur); }) })),
      this.row('Fade out (s)', el('input', { type: 'number', min: 0, max: 30, step: 0.1, value: l.fadeOut || 0, onchange: (e) => App.change(() => { l.fadeOut = clamp(+e.target.value || 0, 0, l.dur); }) })),
      this.row('Mute', el('input', { type: 'checkbox', class: 'tog', checked: !!l.muted, onchange: (e) => App.change(() => { l.muted = e.target.checked; }) })));
    this.section(body, 'Voice');
    body.append(this.row('Voice effect', el('select', { onchange: (e) => { App.change(() => { l.voice = e.target.value; }); if (e.target.value !== 'none') { toast('Processing voice effect…'); Sound.processed(m, l).then(() => toast('Voice effect ready')); } } }, VOICE_FX.map(([v, n]) => el('option', { value: v, selected: (l.voice || 'none') === v }, n)))),
      this.row('Noise reduction', el('input', { type: 'checkbox', class: 'tog', checked: !!l.denoise, onchange: (e) => { App.change(() => { l.denoise = e.target.checked; }); if (e.target.checked) Sound.processed(m, l); } })),
      this.row('This is a voice (duck others)', el('input', { type: 'checkbox', class: 'tog', checked: !!l.duck, onchange: (e) => App.change(() => { l.duck = e.target.checked; }) })),
      this.row('Ducking amount (dB)', el('input', { type: 'number', min: 0, max: 40, step: 1, value: App.project.duckDb ?? 12, onchange: (e) => App.change(p => { p.duckDb = clamp(+e.target.value || 12, 0, 40); }) })));
    this.section(body, 'Beats');
    body.append(el('div', { class: 'btnrow' }, el('button', { class: 'btn', onclick: () => Sound.detectBeats(l) }, 'Detect beats → markers'),
      el('button', { class: 'btn', onclick: () => { App.change(p => { p.markers = p.markers.filter(m => !m.beat); }); this.renderTimeline(); } }, 'Clear beat markers')),
      el('p', { class: 'hint' }, 'Keyframe Volume with the diamond for volume changes over time. Ducking lowers every other clip while a clip marked as a voice plays.'));
  },
  panel_blend(body, l) {
    body.append(this.propRow(l, 'transform.opacity', 'Opacity %', { min: 0, max: 100, hardMin: 0, hardMax: 100 }),
      this.row('Blend mode', el('select', { onchange: (e) => App.change(() => { l.blend = e.target.value; }) }, BLEND_MODES.map(b => el('option', { value: b, selected: (l.blend || 'Normal') === b }, b)))));
    this.section(body, 'Track matte');
    const others = App.project.layers.filter(o => o !== l && VISUAL_TYPES.has(o.type) && o.type !== 'null');
    const mt = l.matte || {};
    body.append(this.row('Matte layer', el('select', { onchange: (e) => { App.change(() => { if (e.target.value) l.matte = { src: e.target.value, mode: mt.mode || 0 }; else delete l.matte; }); this.refreshPanel(); } },
      el('option', { value: '' }, 'None'), others.map(o => el('option', { value: o.id, selected: mt.src === o.id }, o.name)))));
    if (l.matte) body.append(this.row('Matte type', el('select', { onchange: (e) => App.change(() => { l.matte.mode = +e.target.value; }) }, [['0', 'Alpha'], ['1', 'Alpha inverted'], ['2', 'Luma'], ['3', 'Luma inverted']].map(([v, n]) => el('option', { value: v, selected: String(l.matte.mode | 0) === v }, n)))));
    body.append(el('p', { class: 'hint' }, 'A track matte shows this layer only where the matte layer is visible (alpha) or bright (luma). The matte layer itself is hidden.'));
  },
  panel_mask(body, l) {
    const has = l.effects.find(f => f.defId === 'tf.mask');
    if (!has) body.append(el('div', { class: 'tools' }, ['Rectangle', 'Ellipse', 'Star', 'Polygon', 'Diamond'].map((n, i) => el('button', { class: 'tool', onclick: () => { App.addEffect('tf.mask'); const f = l.effects[l.effects.length - 1]; App.change(() => { f.params.shape = i; }); this.tool = 'fx'; this.refreshPanel(); } }, el('span', {}, n)))));
    else body.append(el('p', { class: 'hint' }, 'This clip has a Shape Mask. Edit it under Effects.'), el('button', { class: 'btn', onclick: () => this.openTool('fx') }, 'Open Effects'));
    body.append(this.sectionEl('Keying'), el('div', { class: 'btnrow' }, el('button', { class: 'btn', onclick: () => App.addEffect('tf.chromakey') }, 'Chroma key (green screen)'), el('button', { class: 'btn', onclick: () => App.addEffect('tf.lumakey') }, 'Luma key')));
  },
  sectionEl(t) { return el('div', { class: 'sect' }, t); },
  panel_trans(body, l) {
    const pick = (which) => {
      const cur = l[which];
      const grid = el('div', { class: 'tgrid' }, el('button', { class: 'titem' + (!cur ? ' on' : ''), onclick: () => { App.change(() => { delete l[which]; }); this.refresh(); } }, el('span', {}, 'None')),
        TRANSITIONS.map(t => el('button', { class: 'titem' + (cur && cur.id === t.id ? ' on' : ''), onclick: () => { App.change(() => { l[which] = { id: t.id, dur: cur ? cur.dur : 0.5 }; }); this.refresh(); } }, el('i', { class: 'tthumb t-' + t.cat.toLowerCase() }), el('span', {}, t.name))));
      return grid;
    };
    this.section(body, 'In (at the start of this clip)');
    body.appendChild(pick('transIn'));
    if (l.transIn) body.appendChild(this.row('Length (s)', el('input', { type: 'number', min: 0.05, max: 5, step: 0.05, value: l.transIn.dur, onchange: (e) => { App.change(() => { l.transIn.dur = clamp(+e.target.value || 0.5, 0.05, l.dur); }); this.renderTimeline(); } })));
    this.section(body, 'Out (at the end of this clip)');
    body.appendChild(pick('transOut'));
    if (l.transOut) body.appendChild(this.row('Length (s)', el('input', { type: 'number', min: 0.05, max: 5, step: 0.05, value: l.transOut.dur, onchange: (e) => { App.change(() => { l.transOut.dur = clamp(+e.target.value || 0.5, 0.05, l.dur); }); this.renderTimeline(); } })));
    body.appendChild(el('p', { class: 'hint' }, 'An In transition blends from the clip just before it on the same track. You can also tap the small square between two clips on the timeline.'));
  },
  panel_layer(body, l) {
    body.append(this.row('Name', el('input', { type: 'text', value: l.name, onchange: (e) => { App.change(() => { l.name = e.target.value || l.name; }); this.refresh(); } })),
      el('div', { class: 'tools' },
        this.toolBtn('split', 'Split', () => App.split()), this.toolBtn('copy', 'Duplicate', () => App.duplicate()),
        this.toolBtn('up', 'Track up', () => App.move(1)), this.toolBtn('down', 'Track down', () => App.move(-1)),
        l.type === 'video' ? this.toolBtn('freeze', 'Freeze frame', () => App.freezeFrame()) : null,
        l.type === 'video' ? this.toolBtn('reverse', l.video.reverse ? 'Un-reverse' : 'Reverse', () => App.toggleReverse()) : null,
        this.toolBtn('group', 'Group selected', () => App.group()), l.type === 'group' ? this.toolBtn('layers', 'Ungroup', () => App.ungroup()) : null,
        this.toolBtn('parent', 'Add null', () => App.addNull()),
        this.toolBtn(l.hidden ? 'eye' : 'eyeOff', l.hidden ? 'Show' : 'Hide', () => { App.change(() => { l.hidden = !l.hidden; }); this.refresh(); }),
        l.type === 'video' && Media.items.get(l.mediaId) && Math.max(Media.items.get(l.mediaId).w, Media.items.get(l.mediaId).h) > 1920 ? this.toolBtn('media', 'Make preview copy', () => Proxies.make(Media.items.get(l.mediaId))) : null,
        this.toolBtn('trash', 'Delete', () => App.remove(), 'danger')),
      el('p', { class: 'hint' }, `Starts at ${fmtTime(l.start, App.project.fps)}, lasts ${l.dur.toFixed(2)} s.${l.type === 'group' ? ' Groups play their layers as one clip; Ungroup to edit them separately.' : ''}`));
  },
  toolBtn(icon, label, fn, cls = '') { return el('button', { class: 'tool ' + cls, onclick: fn, html: (ICON[icon] || '') + `<span>${label}</span>` }); },

  panel_fx(body, l) {
    body.appendChild(el('div', { class: 'btnrow' }, el('button', { class: 'btn primary', onclick: () => this.effectBrowser() }, '+ Add effect'),
      el('button', { class: 'btn', onclick: () => this.presetsDialog(l) }, 'Presets')));
    if (!l.effects.length) body.appendChild(el('p', { class: 'hint' }, l.type === 'adjust' ? 'Effects on an adjustment layer change every layer below it.' : 'Effects run top to bottom. Every setting can be keyframed with its diamond.'));
    l.effects.forEach((fxi, idx) => {
      const def = EffectLib.get(fxi.defId);
      const card = el('div', { class: 'fxcard' + (fxi.enabled ? '' : ' off') });
      card.appendChild(el('div', { class: 'fxhead' },
        el('input', { type: 'checkbox', class: 'tog sm', checked: fxi.enabled, title: 'On/off', onchange: (e) => { App.change(() => { fxi.enabled = e.target.checked; }); card.classList.toggle('off', !fxi.enabled); this.renderTimeline(); } }),
        el('b', { onclick: () => { fxi.open = !fxi.open; App.save(); this.refreshPanel(); } }, (def ? def.name : 'Missing effect') + (fxi.filter ? ` (${fxi.filter})` : '')),
        btn('up', 'Move up', () => { if (idx > 0) { App.change(() => { l.effects.splice(idx - 1, 0, l.effects.splice(idx, 1)[0]); }); this.refreshPanel(); } }, 'ghost'),
        btn('down', 'Move down', () => { if (idx < l.effects.length - 1) { App.change(() => { l.effects.splice(idx + 1, 0, l.effects.splice(idx, 1)[0]); }); this.refreshPanel(); } }, 'ghost'),
        btn('trash', 'Remove effect', () => { App.change(() => { l.effects.splice(idx, 1); for (const k of Object.keys(l.keys)) if (k.startsWith('fx.' + fxi.uid + '.')) delete l.keys[k]; }); this.refreshPanel(); this.renderTimeline(); }, 'ghost')));
      if (!def) { card.appendChild(el('p', { class: 'warn' }, `The effect “${fxi.defId}” isn’t installed. Import its XML file to restore it.`)); body.appendChild(card); return; }
      const err = def.kind === 'shader' ? (engine.effectProgram(def), engine.effectError(def)) : null;
      if (err) card.appendChild(el('p', { class: 'warn' }, 'This effect’s shader failed to compile: ' + err.split('\n')[0]));
      if (fxi.open) {
        for (const p of def.params) {
          if (p.kind === 'texture') continue;
          if (p.kind === 'section') { if (p.label && !/GOLD MOTION/i.test(p.label)) card.appendChild(el('div', { class: 'sect' }, p.label)); continue; }
          const path = `fx.${fxi.uid}.${p.id}`;
          if (fxi.params[p.id] === undefined) fxi.params[p.id] = deepCopy(p.default);
          if (p.kind === 'spinner') { const span = p.max - p.min; card.appendChild(this.propRow(l, path, p.label, { min: p.min - span * 10, max: p.max + span * 10, smin: p.min, smax: p.max, step: p.step || 0.01 })); }
          else if (p.kind === 'color') card.appendChild(this.propRow(l, path, p.label, { type: 'color' }));
          else if (p.kind === 'switch') card.appendChild(this.propRow(l, path, p.label, { type: 'bool' }));
          else if (p.kind === 'selector') card.appendChild(this.propRow(l, path, p.label, { type: 'select', choices: p.choices }));
          else if (p.kind === 'lut') {
            card.appendChild(el('div', { class: 'prop' }, el('span', { class: 'kbtn', style: { visibility: 'hidden' } }), el('span', { class: 'plabel' }, p.label),
              el('select', { onchange: (e) => App.setProp(l, path, e.target.value) }, el('option', { value: '' }, 'None'), Array.from(Luts.map.entries()).map(([id, x]) => el('option', { value: id, selected: fxi.params[p.id] === id }, x.name))),
              el('button', { class: 'btn sm', onclick: () => this.pickFiles('.cube', async ([f]) => { try { const id = await Luts.add(f.name.replace(/\.cube$/i, ''), await f.text()); App.setProp(l, path, id); this.refreshPanel(); } catch (e) { toast(e.message); } }) }, 'Import .cube')));
          }
        }
        if (def.desc) card.appendChild(el('p', { class: 'hint' }, def.desc));
      }
      body.appendChild(card);
    });
  },
  presetsDialog(l) {
    const list = el('div', { class: 'liblist' });
    const draw = () => {
      list.innerHTML = '';
      if (!Presets.list.length) list.appendChild(el('p', { class: 'hint' }, 'No presets yet. Save this clip’s effects and their keyframes to reuse them on any clip.'));
      for (const p of Presets.list) list.appendChild(el('div', { class: 'librow' }, el('span', {}, p.name, el('small', {}, ` ${p.effects.length} effect${p.effects.length === 1 ? '' : 's'}`)),
        el('span', {}, el('button', { class: 'btn sm', onclick: () => { Presets.apply(p, l); this.closeModal(); this.refreshPanel(); } }, 'Apply'), btn('trash', 'Delete preset', async () => { await Presets.remove(p.id); draw(); }, 'ghost'))));
    };
    draw();
    const name = el('input', { type: 'text', placeholder: 'Preset name' });
    this.modal('Effect presets', el('div', {}, el('div', { class: 'row' }, name, el('button', { class: 'btn primary', onclick: async () => { if (!l.effects.length) { toast('This clip has no effects to save.'); return; } await Presets.save(name.value.trim() || 'My preset', l); name.value = ''; draw(); toast('Preset saved'); } }, 'Save current')), list), [['Done', () => this.closeModal()]]);
  },

  // ---- asset panels (left panel / sheets) --------------------------------------------
  panel_media(body) {
    const p = App.project;
    body.append(el('div', { class: 'btnrow' }, el('button', { class: 'btn primary', onclick: () => this.pickMedia({}) }, '+ Import'), el('button', { class: 'btn', onclick: () => this.pickMedia({ overlay: true }) }, '+ As overlay')));
    const grid = el('div', { class: 'mgrid' });
    const ids = Array.from(new Set([...(p.library || []), ...p.layers.filter(l => l.mediaId).map(l => l.mediaId)]));
    for (const id of ids) {
      const m = Media.items.get(id); if (!m) continue;
      const th = m.thumbs && m.thumbs[0] ? m.thumbs[0].url : null;
      grid.appendChild(el('div', { class: 'mitem', title: m.name },
        el('div', { class: 'mthumb', style: th ? { backgroundImage: `url(${th})` } : {} }, m.type === 'audio' ? el('i', { html: ICON.audio }) : null, m.duration ? el('em', {}, m.duration.toFixed(1) + 's') : null),
        el('span', {}, m.name),
        el('div', { class: 'mact' }, el('button', { class: 'btn sm', onclick: () => App.placeMedia(m) }, '+ Add'), m.type !== 'audio' ? el('button', { class: 'btn sm', onclick: () => App.placeMedia(m, { overlay: true }) }, 'Overlay') : null)));
    }
    if (!ids.length) grid.appendChild(el('p', { class: 'hint' }, 'Import videos, photos or music. Videos and photos line up on the main track; overlays go on their own track above it.'));
    body.appendChild(grid);
  },
  panel_overlay(body) {
    body.append(el('p', { class: 'hint' }, 'Overlays sit on their own track above the main video, at half size, for picture-in-picture. Change their blend mode under Blend.'),
      el('div', { class: 'btnrow' }, el('button', { class: 'btn primary', onclick: () => this.pickMedia({ overlay: true }) }, '+ Add overlay video or photo')));
    this.panel_stickers(body);
  },
  panel_audio(body) {
    body.append(el('div', { class: 'btnrow' }, el('button', { class: 'btn primary', onclick: () => { const i = $('#fileMedia'); const old = i.accept; i.accept = 'audio/*,.mp3,.m4a,.wav,.aac'; this.pickMedia({}); setTimeout(() => i.accept = old, 1000); } }, '+ Add music or sound')));
    const audioClips = App.project.layers.filter(l => l.type === 'audio' || (l.type === 'video' && Media.items.get(l.mediaId)?.audio));
    if (audioClips.length) {
      this.section(body, 'Clips with sound');
      for (const l of audioClips) body.appendChild(el('div', { class: 'librow' }, el('span', {}, l.name), el('button', { class: 'btn sm', onclick: () => { App.sel = l.id; App.selIds = new Set([l.id]); this.refresh(); this.openTool('volume'); } }, 'Volume & voice')));
    }
    body.append(el('p', { class: 'hint' }, 'Select a clip with sound for volume keyframes, fades, voice effects, noise reduction, ducking and beat markers.'));
  },
  panel_text(body) {
    body.append(el('div', { class: 'btnrow' }, el('button', { class: 'btn primary', onclick: () => App.addText() }, '+ Add text'),
      el('button', { class: 'btn', onclick: () => this.pickFiles('.ttf,.otf,.woff,.woff2', async ([f]) => { try { const n = await Fonts.addFile(f); toast(`Added the font ${n}`); } catch (e) { toast('That font file couldn’t be read.'); } }) }, 'Upload font')));
    this.section(body, 'Templates');
    body.appendChild(this.templateGrid());
  },
  templateGrid() {
    return el('div', { class: 'tplgrid' }, TEXT_TEMPLATES.map(t => {
      Fonts.ensure(t.preview.font);
      return el('button', { class: 'tpl', onclick: () => { addTemplate(t); this.refresh(); } },
        el('b', { style: { fontFamily: Fonts.css(t.preview.font), color: t.preview.color, background: t.preview.bg || 'transparent', fontStyle: t.preview.italic ? 'italic' : 'normal', textShadow: t.preview.glow ? '0 0 10px #2ff' : t.preview.stroke ? '2px 2px 0 #000' : 'none' } }, t.name.split(' ')[0]),
        el('span', {}, t.name));
    }));
  },
  panel_stickers(body) {
    this.section(body, 'Shapes');
    body.appendChild(el('div', { class: 'tools' }, [['rect', 'Rectangle'], ['ellipse', 'Ellipse'], ['polygon', 'Polygon'], ['star', 'Star'], ['line', 'Line']].map(([k, n]) => this.toolBtn('shape', n, () => App.addShape(k)))));
    this.section(body, 'Stickers');
    const em = '😀 😂 😍 😎 🤯 😭 🥳 🤔 👀 🔥 ✨ ⭐ 💥 💯 ❤️ 💔 👍 👏 🙌 💪 🎉 🎵 📣 ⚡ 🌈 ☀️ 🌙 ☁️ 🍕 🍔 🚀 🎮 📱 💰 🏆 ✅ ❌ ⚠️ ➡️ ⬅️ ⬆️ ⬇️ 💬 💭 🗯️ 💤 👑 💎'.split(' ');
    body.appendChild(el('div', { class: 'emgrid' }, em.map(e => el('button', { class: 'em', onclick: () => App.addSticker(e) }, e))));
    this.section(body, 'Layers');
    body.appendChild(el('div', { class: 'tools' }, this.toolBtn('canvas', 'Solid colour', () => App.addSolid()), this.toolBtn('filter', 'Adjustment', () => App.addAdjust()), this.toolBtn('parent', 'Null (controller)', () => App.addNull())));
  },
  panel_effectsLib(body) { body.appendChild(this.effectGrid((id) => App.addEffect(id))); body.appendChild(el('div', { class: 'btnrow' }, el('button', { class: 'btn', onclick: () => $('#fileFx').click() }, 'Import XML or ZIP pack'), el('button', { class: 'btn', onclick: () => this.effectLibrary() }, 'Manage imported'))); },
  panel_transitions(body) {
    const l = App.layer();
    if (!l || !VISUAL_TYPES.has(l.type)) { body.append(el('p', { class: 'hint' }, 'Select a clip, then pick a transition for its start. Or tap the small square between two clips on the timeline.')); }
    body.appendChild(el('div', { class: 'tgrid' }, TRANSITIONS.map(t => el('button', { class: 'titem', onclick: () => { const L = App.layer(); if (!L) { toast('Select a clip first.'); return; } App.change(() => { L.transIn = { id: t.id, dur: L.transIn ? L.transIn.dur : 0.5 }; }); this.refresh(); toast(`${t.name} added to the start of ${L.name}`); } }, el('i', { class: 'tthumb t-' + t.cat.toLowerCase() }), el('span', {}, t.name)))));
  },
  panel_filters(body) {
    const l = App.layer();
    body.append(el('p', { class: 'hint' }, l && l.type !== 'audio' ? `Applies to ${l.name}.` : 'With no clip selected, the filter covers the whole video through an adjustment layer.'));
    body.appendChild(el('div', { class: 'tgrid' }, FILTER_LOOKS.map(([n]) => el('button', { class: 'titem', onclick: () => { if (n === 'Natural') { if (l) App.change(() => { l.effects = l.effects.filter(f => !f.filter); }); this.refresh(); return; } App.applyFilter(n); } }, el('i', { class: 'fthumb f-' + n.toLowerCase().replace(/[^a-z]+/g, '') }), el('span', {}, n)))));
  },
  panel_captions(body) {
    let model = CAPTION_MODELS[/iPhone|iPad|Android/.test(navigator.userAgent) || Layout.device === 'phone' ? 0 : 1][0], lang = '', maxWords = 4, styleName = 'Karaoke Yellow';
    const existing = App.project.layers.filter(l => l.type === 'caption');
    body.append(this.row('Model', el('select', { onchange: (e) => model = e.target.value }, CAPTION_MODELS.map(([v, n]) => el('option', { value: v, selected: v === model }, n)))),
      this.row('Language', el('select', { onchange: (e) => lang = e.target.value }, CAPTION_LANGS.map(([v, n]) => el('option', { value: v }, n)))),
      this.row('Max words per line', el('input', { type: 'number', min: 1, max: 12, value: 4, onchange: (e) => maxWords = clamp(+e.target.value || 4, 1, 12) })),
      this.row('Style', el('select', { onchange: (e) => styleName = e.target.value }, Object.keys(CAPTION_STYLES).map(n => el('option', { value: n }, n)))));
    const bar = el('div', { class: 'bar' }, el('i')), msg = el('p', { class: 'hint' }, 'Runs on this device. The first run downloads the speech model (about 40 MB for Tiny, 80 MB for Base, 250 MB for Small).');
    const go = el('button', { class: 'btn primary', onclick: async () => {
      go.disabled = true;
      try {
        const words = await Captions.run(App.project, { model, language: lang }, (f, m) => { bar.firstChild.style.width = (f * 100) + '%'; msg.textContent = m; });
        if (!words.length) { msg.textContent = 'No speech was found.'; return; }
        Captions.makeLayer(Captions.toLines(words, maxWords), styleName);
        msg.textContent = `Done: ${words.length} words.`; this.openTool('captionEdit');
      } catch (e) { msg.textContent = 'Captions failed: ' + (e.message || e); }
      finally { go.disabled = false; }
    } }, 'Generate captions');
    body.append(el('div', { class: 'btnrow' }, go, el('button', { class: 'btn', onclick: () => { Captions.cancel = true; } }, 'Cancel')), bar, msg);
    if (existing.length) { this.section(body, 'Caption tracks'); for (const l of existing) body.appendChild(el('div', { class: 'librow' }, el('span', {}, l.name), el('button', { class: 'btn sm', onclick: () => { App.sel = l.id; App.selIds = new Set([l.id]); this.refresh(); this.openTool('captionEdit'); } }, 'Edit'))); }
  },
  captionStylePicker(body, l) {
    this.section(body, 'Caption look');
    body.append(el('div', { class: 'btnrow' }, Object.keys(CAPTION_STYLES).map(n => el('button', { class: 'btn' + (l.caption.preset === n ? ' on' : ''), onclick: () => { Captions.applyStyle(l, n); Fonts.ensure(CAPTION_STYLES[n].text.font); this.refreshPanel(); } }, n))),
      this.row('Highlight', el('select', { onchange: (e) => App.change(() => { l.caption.style = e.target.value; }) }, [['karaoke', 'Karaoke (fill as spoken)'], ['word', 'Current word'], ['pop', 'Pop in per word'], ['plain', 'None']].map(([v, n]) => el('option', { value: v, selected: l.caption.style === v }, n)))),
      this.row('Highlight colour', el('input', { type: 'color', value: colorToHex(l.caption.hl || [1, 0.85, 0.1, 1]), oninput: (e) => App.change(() => { l.caption.hl = [...parseColor(e.target.value).slice(0, 3), 1]; }, 'caphl') })),
      this.row('Capitals', el('input', { type: 'checkbox', class: 'tog', checked: !!l.caption.upper, onchange: (e) => App.change(() => { l.caption.upper = e.target.checked; }) })),
      this.row('Auto emoji', el('input', { type: 'checkbox', class: 'tog', checked: !!l.caption.emoji, onchange: (e) => App.change(() => { l.caption.emoji = e.target.checked; }) })));
  },
  panel_captionEdit(body, l) {
    if (l.type !== 'caption') return;
    body.append(el('div', { class: 'btnrow' },
      el('button', { class: 'btn', onclick: () => { const s = Captions.toSRT(l); saveBlob(new Blob([s], { type: 'text/plain' }), (App.project.name || 'captions').replace(/[^\w\- ]+/g, '') + '.srt').then(r => { if (r === 'failed') saveBlob(new Blob([s], { type: 'text/plain' }), 'captions.txt'); }); } }, 'Export .srt'),
      el('span', { class: 'hint' }, 'Captions export inside the video automatically.')));
    l.caption.lines.forEach((L, i) => {
      const active = App.time - l.start >= L.s && App.time - l.start < L.e;
      body.appendChild(el('div', { class: 'capline' + (active ? ' on' : '') },
        el('div', { class: 'captimes' },
          el('input', { type: 'number', step: 0.05, value: +L.s.toFixed(2), onchange: (e) => Captions.setLineTime(l, i, +e.target.value, L.e) }),
          el('input', { type: 'number', step: 0.05, value: +L.e.toFixed(2), onchange: (e) => Captions.setLineTime(l, i, L.s, +e.target.value) }),
          btn('play', 'Go to line', () => App.setTime(l.start + L.s + 0.01), 'ghost')),
        el('input', { type: 'text', value: L.words.map(w => w.w).join(' '), onchange: (e) => Captions.setLineText(l, i, e.target.value) }),
        el('div', { class: 'capbtns' }, el('button', { class: 'btn sm', onclick: () => { Captions.split(l, i); this.refreshPanel(); } }, 'Split'),
          i < l.caption.lines.length - 1 ? el('button', { class: 'btn sm', onclick: () => { Captions.merge(l, i); this.refreshPanel(); } }, 'Merge ↓') : null,
          el('button', { class: 'btn sm', onclick: () => { App.change(() => { l.caption.lines.splice(i, 1); }); this.refreshPanel(); } }, 'Delete'))));
    });
  },
  panel_canvas(body) {
    const p = App.project;
    this.section(body, 'Aspect ratio');
    body.appendChild(el('div', { class: 'btnrow' }, [['9:16', 1080, 1920], ['16:9', 1920, 1080], ['1:1', 1080, 1080], ['4:5', 1080, 1350], ['21:9', 1920, 822]].map(([n, w, h]) => el('button', { class: 'btn' + (p.width === w && p.height === h ? ' on' : ''), onclick: () => { App.change(pp => { const sx = w / pp.width, sy = h / pp.height; for (const l of pp.layers) if (!l.parent) { l.transform.x *= sx; l.transform.y *= sy; } pp.width = w; pp.height = h; }); App.setPreviewQuality(); this.refresh(); } }, n))));
    this.section(body, 'Background');
    const bg = p.canvasBg;
    body.append(el('div', { class: 'btnrow' }, [['color', 'Colour'], ['blur', 'Blur'], ['image', 'Image']].map(([v, n]) => el('button', { class: 'btn' + (bg.type === v ? ' on' : ''), onclick: () => {
      if (v === 'image') this.pickFiles('image/*', async ([f]) => { const m = await Media.importFile(f); App.change(pp => { pp.canvasBg = { ...pp.canvasBg, type: 'image', mediaId: m.id }; }); this.refreshPanel(); });
      else { App.change(pp => { pp.canvasBg.type = v; }); this.refreshPanel(); }
    } }, n))));
    if (bg.type === 'color') body.append(this.row('Colour', el('input', { type: 'color', value: colorToHex(p.bg), oninput: (e) => App.change(pp => { pp.bg = [...parseColor(e.target.value).slice(0, 3), 1]; }, 'bg') })));
    if (bg.type === 'blur') body.append(this.row('Blur amount', el('input', { type: 'range', min: 5, max: 120, value: bg.blur ?? 40, oninput: (e) => App.change(pp => { pp.canvasBg.blur = +e.target.value; }, 'bgblur') })));
    this.section(body, 'Project');
    const num = (label, key, min, max, step, after) => this.row(label, el('input', { type: 'number', value: p[key], min, max, step, onchange: (e) => { const v = clamp(+e.target.value || min, min, max); App.change(pp => { pp[key] = v; }); after && after(); this.refresh(); } }));
    body.append(this.row('Name', el('input', { type: 'text', value: p.name, onchange: (e) => { App.change(pp => { pp.name = e.target.value || 'Untitled'; }); $('#projName').textContent = App.project.name; } })),
      num('Width', 'width', 16, 4096, 2, () => App.setPreviewQuality()), num('Height', 'height', 16, 4096, 2, () => App.setPreviewQuality()),
      this.row('Frame rate', el('select', { onchange: (e) => { App.change(pp => { pp.fps = +e.target.value; }); this.refresh(); } }, [24, 25, 30, 50, 60].map(f => el('option', { value: f, selected: p.fps === f }, f + ' fps')))),
      num('Duration (s)', 'duration', 0.5, 3600, 0.1),
      el('div', { class: 'btnrow' }, el('button', { class: 'btn', onclick: () => { App.change(pp => App.fitDuration(pp)); this.refresh(); } }, 'Fit duration to clips'),
        el('button', { class: 'btn', onclick: async () => { this.busy('Packing project…'); try { await ProjectFile.save(p); } finally { this.busy(null); } } }, 'Save project file')));
    this.section(body, 'Settings');
    body.append(
      this.row('Layout', el('select', { onchange: (e) => { Layout.override = e.target.value; } }, [['auto', 'Automatic'], ['desktop', 'Force desktop layout'], ['mobile', 'Force mobile layout']].map(([v, n]) => el('option', { value: v, selected: Layout.override === v }, n)))),
      this.row('Preview quality', el('select', { onchange: (e) => App.setQuality(e.target.value) }, [['full', 'Full'], ['half', 'Half'], ['quarter', 'Quarter']].map(([v, n]) => el('option', { value: v, selected: App.quality === v }, n)))),
      this.row('Snapping', el('input', { type: 'checkbox', class: 'tog', checked: App.snapping, onchange: (e) => { App.snapping = e.target.checked; try { localStorage.setItem('tf.snap', App.snapping ? '1' : '0'); } catch (er) { } this.updateTransport(); } })),
      this.row('Magnetic main track', el('input', { type: 'checkbox', class: 'tog', checked: !!p.magnetic, onchange: (e) => { App.change(pp => { pp.magnetic = e.target.checked; App.compactMain(pp); }); this.refresh(); } })),
      el('p', { class: 'hint' }, `Detected: ${Layout.device}, ${Layout.mode} layout. WebGL2 ${engine.floatRT ? 'with' : 'without'} float targets. Export: ${'VideoEncoder' in window ? 'WebCodecs' : 'MediaRecorder'}.`));
  },

  // ---- effects browser ----------------------------------------------------------
  effectGrid(onPick) {
    let cat = 'All', q = '';
    const grid = el('div', { class: 'fxgrid' }), cats = el('div', { class: 'chips' });
    const search = el('input', { type: 'search', placeholder: 'Search effects', oninput: (e) => { q = e.target.value.toLowerCase(); draw(); } });
    const draw = () => {
      cats.innerHTML = '';
      for (const c of ['All', ...EffectLib.categories()]) cats.appendChild(el('button', { class: 'chip' + (c === cat ? ' on' : ''), onclick: () => { cat = c; draw(); } }, c));
      grid.innerHTML = '';
      const list = EffectLib.list().filter(d => (cat === 'All' || d.category === cat) && (!q || (d.name + ' ' + d.tags + ' ' + d.desc + ' ' + d.category).toLowerCase().includes(q)));
      for (const d of list) {
        const th = el('i', { class: 'fxthumb' });
        if (d.kind === 'shader') this.queueThumb(d, th); else th.classList.add('icon'), th.innerHTML = ICON.animate;
        grid.appendChild(el('button', { class: 'fxitem', title: d.desc || d.name, onclick: () => onPick(d.id) }, th, el('b', {}, d.name), el('small', {}, d.category + (d.builtin ? '' : ' · imported'))));
      }
      if (!list.length) grid.appendChild(el('p', { class: 'empty' }, 'Nothing matches.'));
    };
    draw();
    return el('div', { class: 'fxbrowser' }, search, cats, grid);
  },
  // Animated thumbnails: 6 frames rendered on a sample picture, played as a sprite.
  _thumbCache: new Map(), _thumbQueue: [], _thumbBusy: false,
  queueThumb(def, node) {
    const c = this._thumbCache.get(def.id);
    if (c) { node.style.backgroundImage = `url(${c})`; node.classList.add('anim'); return; }
    this._thumbQueue.push([def, node]);
    if (!this._thumbBusy) { this._thumbBusy = true; setTimeout(() => this.runThumbs(), 30); }
  },
  sampleTexture() {
    if (this._sample) return this._sample;
    const c = el('canvas', { width: 128, height: 72 }), g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 0, 72); gr.addColorStop(0, '#1d3b72'); gr.addColorStop(0.6, '#e07a4a'); gr.addColorStop(1, '#2a1a2e'); g.fillStyle = gr; g.fillRect(0, 0, 128, 72);
    g.fillStyle = '#ffd56b'; g.beginPath(); g.arc(92, 30, 12, 0, 7); g.fill(); g.fillStyle = '#14e0c8'; g.fillRect(14, 40, 30, 30);
    g.fillStyle = '#fff'; g.font = 'bold 22px system-ui'; g.fillText('Aa', 52, 60);
    const tex = engine.newTex(); engine.upload(tex, c);
    return (this._sample = { tex, w: 128, h: 72 });
  },
  runThumbs() {
    const t0 = performance.now();
    while (this._thumbQueue.length && performance.now() - t0 < 30) {
      const [def, node] = this._thumbQueue.shift();
      if (!node.isConnected) continue;
      try { const url = engine.thumbnail(def, this.sampleTexture(), 96, 54, [0, 0.33, 0.66, 1, 1.33, 1.66]); this._thumbCache.set(def.id, url); node.style.backgroundImage = `url(${url})`; node.classList.add('anim'); }
      catch (e) { node.classList.add('icon'); }
    }
    if (this._thumbQueue.length) setTimeout(() => this.runThumbs(), 16); else { this._thumbBusy = false; App.requestRender(); }
  },
  effectBrowser() {
    this.modal('Add effect', this.effectGrid((id) => { this.closeModal(); App.addEffect(id); }), [['Import XML or ZIP', () => $('#fileFx').click()], ['Close', () => this.closeModal()]], 'big');
  },
  async importEffects(files) {
    let ok = 0; const errs = [];
    const take = async (name, text) => {
      try { const d = parseEffectXML(text, name); EffectLib.add(d); await Store.put('effects', d.id, { name, xml: text }); if (!engine.effectProgram(d)) errs.push(`${d.name}: shader error`); ok++; }
      catch (e) { errs.push(e.message); }
    };
    this.busy('Importing effects…');
    for (const f of files) {
      if (/\.zip$/i.test(f.name) || f.type === 'application/zip') {
        try { for (const z of await readZip(f)) if (/\.xml$/i.test(z.name) && !z.name.includes('__MACOSX')) await take(z.name.split('/').pop(), await z.text()); }
        catch (e) { errs.push(`${f.name}: ${e.message}`); }
      } else await take(f.name, await f.text());
    }
    this.busy(null);
    toast(`Imported ${ok} effect${ok === 1 ? '' : 's'}${errs.length ? `, ${errs.length} with problems` : ''}.`, 4000);
    if (errs.length) console.warn(errs);
    if ($('#modal .fxbrowser')) this.effectBrowser();
    if (!$('#home').classList.contains('hidden')) $('#fxCount').textContent = `${EffectLib.list().length} effects installed`;
    if (App.project) { this.refreshPanel(); this.renderLeft(); }
    return { ok, errs };
  },
  effectLibrary() {
    const list = el('div', { class: 'liblist' });
    const draw = () => {
      list.innerHTML = '';
      const custom = EffectLib.list().filter(d => !d.builtin);
      list.appendChild(el('p', { class: 'hint' }, `${EffectLib.list().length - custom.length} built-in effects, ${custom.length} imported. Import single .xml effect files or a .zip of them, in the Gold Motion / Alight Motion custom effect format.`));
      for (const d of custom) list.appendChild(el('div', { class: 'librow' }, el('span', {}, d.name, el('small', {}, ' ' + d.category + (d.repaired ? ' · auto-fixed' : ''))),
        btn('trash', 'Remove', async () => { await Store.del('effects', d.id); EffectLib.defs.delete(d.id); EffectLib.order = EffectLib.order.filter(x => x !== d.id); draw(); }, 'ghost')));
    };
    draw();
    this.modal('Effect library', list, [['Import XML or ZIP', () => $('#fileFx').click()], ['Done', () => this.closeModal()]]);
  },

  // ---- export ---------------------------------------------------------------------
  exportDialog() {
    const p = App.project; Player.pause();
    let short = Math.min(1080, Math.min(p.width, p.height)), fps = p.fps, quality = 'high', audio = true;
    const opts = [[720, '720p'], [1080, '1080p'], [1440, '2K'], [2160, '4K']];
    const resRow = el('div', { class: 'btnrow' }, opts.map(([s, n]) => el('button', { class: 'btn' + (s === short ? ' on' : ''), onclick: (e) => { short = s; $$('.btn', resRow).forEach(b => b.classList.remove('on')); e.currentTarget.classList.add('on'); info(); } }, n)));
    const infoEl = el('p', { class: 'hint' });
    const method = 'VideoEncoder' in window ? 'WebCodecs: H.264 MP4 with AAC audio where supported, rendered frame by frame.' : 'MediaRecorder fallback: this browser lacks WebCodecs, so the video is recorded in real time.';
    const info = () => { const k = short / Math.min(p.width, p.height); infoEl.textContent = `${Math.round(p.width * k / 2) * 2}×${Math.round(p.height * k / 2) * 2}, ${fps} fps, ${p.duration.toFixed(2)} s. ${method}`; };
    info();
    this.modal('Export video', el('div', {},
      el('div', { class: 'sect' }, 'Resolution'), resRow,
      this.row('Frame rate', el('select', { onchange: (e) => { fps = +e.target.value; info(); } }, [24, 25, 30, 50, 60].map(f => el('option', { value: f, selected: f === p.fps }, f + ' fps')))),
      this.row('Quality', el('select', { onchange: (e) => quality = e.target.value }, el('option', { value: 'high' }, 'High'), el('option', { value: 'standard' }, 'Standard (smaller file)'))),
      this.row('Include audio', el('input', { type: 'checkbox', class: 'tog', checked: true, onchange: (e) => audio = e.target.checked })),
      infoEl), [['Cancel', () => this.closeModal()], ['Export', () => this.runExport({ short, fps, quality, audio }), 'primary']]);
  },
  async runExport(opts) {
    const p = App.project;
    const bar = el('div', { class: 'bar' }, el('i')), label = el('p', { class: 'hint' }, 'Starting…');
    const t0 = performance.now();
    this.modal('Exporting', el('div', {}, bar, label), [['Cancel', () => { Exporter.cancel = true; }]]);
    try {
      Proxies.useOriginals(true);
      const res = await Exporter.run(p, opts, (f) => {
        bar.firstChild.style.width = (f * 100).toFixed(1) + '%';
        const e2 = (performance.now() - t0) / 1000, left = f > 0.02 ? e2 / f - e2 : 0;
        label.textContent = `${Math.round(f * 100)}%${left ? ` · about ${Math.ceil(left)} s left` : ''}`;
      });
      const name = (p.name || 'TwoFrame').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') + '.' + (res.ext || 'mp4');
      const url = URL.createObjectURL(res.blob);
      this.modal('Export finished', el('div', {},
        el('video', { src: url, controls: true, playsinline: true, class: 'result' }),
        el('p', { class: 'hint' }, `${res.W}×${res.H}, ${(res.blob.size / 1048576).toFixed(1)} MB. Made with ${res.method}.${res.hadAudio && !res.audio ? ' Audio was skipped because this browser can’t encode audio.' : ''}`),
        el('p', { class: 'hint' }, 'On iPhone, Save opens the share sheet: choose Save Video to put it in Photos.')),
        [['Close', () => { URL.revokeObjectURL(url); this.closeModal(); }], ['Save video', async () => { const r = await saveBlob(res.blob, name); if (r === 'downloaded') toast('Saved to your downloads.'); else if (r === 'saved' || r === 'shared') toast('Saved.'); }, 'primary']]);
    } catch (e) {
      this.modal('Export stopped', el('p', {}, e.message || String(e)), [['OK', () => this.closeModal()]]);
    } finally { Proxies.useOriginals(false); }
    App.requestRender();
  },

  // ---- modal, confirm, menus -------------------------------------------------------
  modal(title, body, actions = [], cls = '') {
    const m = $('#modal'); m.innerHTML = ''; m.className = cls;
    const box = el('div', { class: 'mbox' }, el('h3', {}, title), el('div', { class: 'mbody' }, body),
      el('div', { class: 'mact' }, actions.map(([n, fn, c]) => el('button', { class: 'btn ' + (c || ''), onclick: fn }, n))));
    m.appendChild(box);
    m.onclick = (e) => { if (e.target === m && !Exporter.busy) this.closeModal(); };
  },
  closeModal() { const m = $('#modal'); m.className = 'hidden'; m.innerHTML = ''; },
  confirm(msg, yes) { this.modal('Are you sure?', el('p', {}, msg), [['Cancel', () => this.closeModal()], ['Yes', () => { this.closeModal(); yes(); }, 'primary']]); },
  // Right-click (computer) or long-press (phone) menu.
  menu(x, y, items) {
    this.closeMenu();
    const m = el('div', { class: 'ctxmenu', id: 'ctxmenu' }, items.filter(Boolean).map(([label, fn, cls]) => label === '-' ? el('hr') : el('button', { class: cls || '', onclick: (e) => { e.stopPropagation(); this.closeMenu(); fn(); } }, label)));
    document.body.appendChild(m);
    const r = m.getBoundingClientRect();
    m.style.left = clamp(x, 6, innerWidth - r.width - 6) + 'px'; m.style.top = clamp(y, 6, innerHeight - r.height - 6) + 'px';
    setTimeout(() => document.addEventListener('pointerdown', this._menuAway = (e) => { if (!m.contains(e.target)) this.closeMenu(); }, { once: false }), 0);
  },
  closeMenu() { $('#ctxmenu')?.remove(); if (this._menuAway) document.removeEventListener('pointerdown', this._menuAway); this._menuAway = null; }
};

// ===========================================================================
// Timeline and interface add-ons:
//   track solo / rename / colour / height / reorder, ripple delete, slip
//   edit, same-track overlap that becomes a transition, copy and paste
//   attributes, frame-number ruler, drawing only the clips on screen,
//   history panel, layers panel, preview guides and safe zones, align
//   buttons, and keyboard shortcuts you can change (press ? for the list).
// ===========================================================================
const TRACK_COLORS = ['', '#14e0c8', '#ff4f8b', '#ffcf3a', '#7b5cff', '#3d8bff', '#ff8a3d', '#8bd450'];
const SAFE_ZONES = { none: null, tiktok: { name: 'TikTok', t: 0.13, b: 0.22, l: 0.03, r: 0.15 }, reels: { name: 'Reels', t: 0.14, b: 0.30, l: 0.04, r: 0.14 }, shorts: { name: 'Shorts', t: 0.12, b: 0.25, l: 0.04, r: 0.15 } };

Object.assign(App, {
  undoLabels: [], redoLabels: [],
  // Dropping a clip so it overlaps the end of the clip before it (same
  // track) makes a transition of that length; nothing is cut off.
  overlapToTransition(l) {
    const p = this.project, t = this.track(l.track);
    if (!t || (t.kind === 'main' && p.magnetic) || !VISUAL_TYPES.has(l.type)) return false;
    const prev = p.layers.filter(o => o !== l && o.track === l.track && o.start < l.start && o.start + o.dur > l.start && o.start + o.dur < l.start + l.dur).sort((a, b) => b.start - a.start)[0];
    if (!prev || !VISUAL_TYPES.has(prev.type)) return false;
    const d = Math.min(prev.start + prev.dur - l.start, prev.dur * 0.9, l.dur * 0.9);
    if (d < 1.5 / p.fps) return false;
    if (p.layers.some(o => o !== l && o !== prev && o.track === l.track && o.start < prev.start + prev.dur + l.dur && o.start + o.dur > prev.start + prev.dur)) return false;
    l.start = prev.start + prev.dur; l.transIn = { id: (l.transIn && l.transIn.id) || 'dissolve', dur: Math.round(d * 100) / 100 };
    toast(`Overlap turned into a ${l.transIn.dur.toFixed(2)} s transition.`);
    return true;
  },
  // Delete and close the gap on that track.
  rippleDelete() {
    const ids = (this.selIds.size ? Array.from(this.selIds) : [this.sel]).filter(Boolean); if (!ids.length) return;
    this.change(p => {
      for (const id of ids) { const l = p.layers.find(x => x.id === id); if (!l) continue; for (const o of p.layers) if (o.track === l.track && o.start >= l.start + l.dur - 1e-6) o.start = Math.max(0, o.start - l.dur); }
      p.layers = p.layers.filter(x => !ids.includes(x.id));
      for (const l of p.layers) { if (ids.includes(l.parent)) delete l.parent; if (l.matte && ids.includes(l.matte.src)) delete l.matte; }
      this.removeEmptyTracks(p);
    }, '');
    this.sel = null; this.selIds.clear(); UI.refresh();
  },
  // Cuts a time range out of every track and closes the gap (used by
  // text-based editing and silence removal).
  rippleCut(s, e, keep) {
    const d = e - s; if (d <= 0) return;
    this.change(p => {
      const add = [];
      for (const l of p.layers) {
        if (keep && keep(l)) continue;
        const ls = l.start, le = l.start + l.dur;
        if (le <= s + 1e-6) continue;
        if (ls >= e - 1e-6) { l.start -= d; continue; }
        const shiftKeys = (x, by) => { for (const ks of Object.values(x.keys || {})) for (const k of ks) k.t -= by; };
        const speed = (l.video && l.video.speed) || (l.audioOpts && l.audioOpts.speed) || 1;
        if (ls >= s && le <= e) { l._cut = true; continue; }
        if (ls < s && le > e) { const b = this.cloneLayer(l); b.start = s; b.dur = le - e; b.in = (l.in || 0) + (e - ls) * speed; shiftKeys(b, e - ls); delete b.transIn; l.dur = s - ls; delete l.transOut; add.push(b); continue; }
        if (ls < s) { l.dur = s - ls; delete l.transOut; continue; }
        l.in = (l.in || 0) + (e - ls) * speed; shiftKeys(l, e - ls); l.dur = le - e; l.start = s; delete l.transIn;
      }
      p.layers = p.layers.filter(l => !l._cut).concat(add);
      for (const m of p.markers || []) if (m.t >= e) m.t -= d;
      this.fitDuration(p); this.removeEmptyTracks(p);
    }, '');
  },
  copyAttrs() { const l = this.layer(); if (!l) return; this.attrClip = deepCopy(l); toast('Look and motion copied. Select another clip and paste.'); },
  pasteAttrs(what = { transform: true, effects: true, blend: true }) {
    if (!this.attrClip) { toast('Copy a clip’s attributes first.'); return; }
    const ids = (this.selIds.size ? Array.from(this.selIds) : [this.sel]).filter(Boolean);
    this.change(p => {
      for (const id of ids) {
        const l = p.layers.find(x => x.id === id); if (!l) continue;
        const c = this.cloneLayer(this.attrClip);
        const move = (pre) => { for (const k of Object.keys(l.keys || {})) if (k.startsWith(pre)) delete l.keys[k]; for (const [k, v] of Object.entries(c.keys || {})) if (k.startsWith(pre)) { l.keys = l.keys || {}; l.keys[k] = v.filter(q => q.t <= l.dur); } for (const [k, v] of Object.entries(c.expr || {})) if (k.startsWith(pre)) { l.expr = l.expr || {}; l.expr[k] = v; } };
        if (what.transform && l.type !== 'audio') { l.transform = { ...l.transform, ...c.transform }; move('transform.'); if (c.crop) { l.crop = c.crop; move('crop.'); } if (c.mblur) l.mblur = c.mblur; }
        if (what.effects && l.type !== 'audio') { l.effects = c.effects; move('fx.'); }
        if (what.blend) { l.blend = c.blend; }
      }
    }, '');
    for (const r of Runtime.map.values()) r.texKey = '';
    UI.refresh(); toast('Pasted.');
  },
  moveTrack(id, dir) {
    this.change(p => {
      const t = p.tracks.find(x => x.id === id); if (!t || t.kind === 'main') return;
      const same = p.tracks.filter(x => (x.kind === 'audio') === (t.kind === 'audio') && x.kind !== 'main'), i = same.indexOf(t), o = same[i + (t.kind === 'audio' ? -dir : dir)];
      if (!o) return; const a = p.tracks.indexOf(t), b = p.tracks.indexOf(o); p.tracks[a] = o; p.tracks[b] = t;
    }, ''); UI.renderTimeline();
  }
});
// Labels for the history panel, kept next to the undo steps.
(() => {
  const nice = (key) => !key ? 'Edit' : key.startsWith('p:') ? 'Change ' + (key.split('.').pop() || 'setting') : key.startsWith('clipdrop') ? 'Move clip' : key.startsWith('clip') ? (key.endsWith('move') ? 'Move clip' : 'Trim clip') : key.startsWith('stage') ? 'Move on preview' : key.startsWith('lanes') ? 'Move keyframes' : /^(graph|bz)/.test(key) ? 'Shape curve' : key.startsWith('cap') ? 'Edit captions' : key.startsWith('wheel') ? 'Scale' : 'Edit';
  const change = App.change, undo = App.undo, redo = App.redo, open = App.open;
  App.change = function (fn, key = '') {
    const before = this.undoStack[this.undoStack.length - 1], n = this.undoStack.length;
    change.call(this, fn, key);
    if (this.undoStack[this.undoStack.length - 1] !== before || this.undoStack.length !== n) { this.undoLabels.push(this._label || nice(key)); while (this.undoLabels.length > this.undoStack.length) this.undoLabels.shift(); this.redoLabels = []; }
    this._label = null;
  };
  App.undo = function () { if (this.undoStack.length) this.redoLabels.push(this.undoLabels.pop() || 'Edit'); undo.call(this); };
  App.redo = function () { if (this.redoStack.length) this.undoLabels.push(this.redoLabels.pop() || 'Edit'); redo.call(this); };
  App.open = async function (p) { this.undoLabels = []; this.redoLabels = []; return open.call(this, p); };
})();

Object.assign(UI, {
  rulerFrames: false, slipMode: false,
  guides: (() => { try { return JSON.parse(localStorage.getItem('tf.guides')) || {}; } catch (e) { return {}; } })(),
  saveGuides() { try { localStorage.setItem('tf.guides', JSON.stringify(this.guides)); } catch (e) { } this.drawOverlay(); },
  pickUnder(types) {
    const T = App.time, c = App.project.layers.filter(x => types.includes(x.type) && T >= x.start && T < x.start + x.dur).sort((a, b) => (App.track(b.track)?.kind === 'main') - (App.track(a.track)?.kind === 'main'))[0];
    if (c) { App.sel = c.id; App.selIds = new Set([c.id]); this.refresh(); } else toast('Move the playhead over a clip first.');
    return c;
  },
  trackMenu(t, x, y) {
    const p = App.project, set = (fn) => { App.change(() => fn(p.tracks.find(q => q.id === t.id))); this.renderTimeline(); };
    this.menu(x, y, [
      [t.locked ? 'Unlock track' : 'Lock track', () => App.toggleTrack(t.id, 'locked')], [t.hidden ? 'Show track' : 'Hide track', () => App.toggleTrack(t.id, 'hidden')], [t.muted ? 'Unmute track' : 'Mute track', () => App.toggleTrack(t.id, 'muted')],
      [t.solo ? 'Stop solo' : 'Solo (only this track)', () => { set(q => { q.solo = !q.solo; }); App.requestRender(); }], ['-'],
      ['Rename…', () => this.ask('Track name', t.name || '', (n) => set(q => { q.name = n; }))],
      ['Colour label', () => set(q => { q.color = TRACK_COLORS[(TRACK_COLORS.indexOf(q.color || '') + 1) % TRACK_COLORS.length]; })],
      ['Taller', () => set(q => { q.h = Math.min(140, (q.h || this.rowH(q)) + 18); })], ['Shorter', () => set(q => { q.h = Math.max(28, (q.h || this.rowH(q)) - 18); })],
      t.kind !== 'main' ? ['Move track up', () => App.moveTrack(t.id, 1)] : null, t.kind !== 'main' ? ['Move track down', () => App.moveTrack(t.id, -1)] : null]);
  },
  historyPanel() {
    const list = el('div', { class: 'liblist' });
    const rows = [el('div', { class: 'librow on' }, el('b', {}, 'Now'))];
    const n = App.undoLabels.length;
    for (let i = n - 1; i >= 0; i--) rows.push(el('button', { class: 'librow hist', onclick: () => { for (let k = 0; k < n - i; k++) App.undo(); this.closeModal(); toast(`Went back ${n - i} step${n - i === 1 ? '' : 's'}. Redo brings them back.`); } }, el('span', {}, App.undoLabels[i] || 'Edit'), el('small', {}, `${n - i} back`)));
    list.append(...rows);
    this.modal('History', el('div', {}, el('p', { class: 'hint' }, `${n} step${n === 1 ? '' : 's'} saved (up to 1,000). Tap one to go back to before it.`), list, App.redoLabels.length ? el('p', { class: 'hint' }, `${App.redoLabels.length} step(s) can be redone.`) : null), [['Close', () => this.closeModal()]]);
  },
  panel_layers(body) {
    const p = App.project, list = Renderer.ordered(p.layers, p).slice().reverse();
    if (!list.length) { body.appendChild(el('p', { class: 'hint' }, 'Nothing on the timeline yet.')); return; }
    body.appendChild(el('p', { class: 'hint' }, 'Top of the list draws on top. Tap a row to select it.'));
    for (const l of list) body.appendChild(el('div', { class: 'librow layerrow' + (l.id === App.sel ? ' on' : ''), onclick: () => { App.sel = l.id; App.selIds = new Set([l.id]); App.setTime(clamp(App.time, l.start, l.start + l.dur - 1 / p.fps)); this.refresh(); } },
      el('span', {}, el('i', { class: 'ldot t-' + l.type }), l.name || l.type, l.parent ? el('small', {}, ' ⛓') : null),
      el('span', { class: 'mact' },
        btn(l.hidden ? 'eyeOff' : 'eye', 'Show or hide', (e) => { e.stopPropagation(); App.change(() => { l.hidden = !l.hidden; }); this.refresh(); }, 'ghost' + (l.hidden ? ' on' : '')),
        l.type !== 'audio' ? btn('up', 'Up a track', (e) => { e.stopPropagation(); App.sel = l.id; App.move(1); this.refresh(); }, 'ghost') : null,
        l.type !== 'audio' ? btn('down', 'Down a track', (e) => { e.stopPropagation(); App.sel = l.id; App.move(-1); this.refresh(); }, 'ghost') : null)));
  },
  alignRow(l) {
    const go = (h, v) => {
      const b = this.layerBox(l); if (!b) return; const p = App.project, xs = b.pts.map(q => q[0]), ys = b.pts.map(q => q[1]);
      const dx = h == null ? 0 : (h === 0 ? -Math.min(...xs) : h === 1 ? p.width / 2 - (Math.min(...xs) + Math.max(...xs)) / 2 : p.width - Math.max(...xs));
      const dy = v == null ? 0 : (v === 0 ? -Math.min(...ys) : v === 1 ? p.height / 2 - (Math.min(...ys) + Math.max(...ys)) / 2 : p.height - Math.max(...ys));
      const [lx, ly] = this.localDelta(l, dx, dy), tr = evalTransform(l, App.time - l.start);
      App.setProp(l, 'transform.x', tr.x + lx); App.setProp(l, 'transform.y', tr.y + ly); this.refreshPanelValues(); this.drawOverlay();
    };
    return el('div', { class: 'btnrow alignrow' }, el('span', { class: 'hint' }, 'Align'), [['⇤', 0, null, 'Left'], ['↔', 1, null, 'Centre'], ['⇥', 2, null, 'Right'], ['⤒', null, 0, 'Top'], ['↕', null, 1, 'Middle'], ['⤓', null, 2, 'Bottom']].map(([s, h, v, t]) => el('button', { class: 'btn sm', title: 'Align ' + t, onclick: () => go(h, v) }, s)));
  },

  // ---- keyboard shortcuts you can change ---------------------------------------------
  keyActions() {
    const f = () => 1 / App.project.fps, L = () => App.layer();
    return [
      ['play', 'Play / pause', 'Space', () => { Player.shuttle = 0; Player.toggle(); }], ['fwd', 'Shuttle forward (press again for faster)', 'L', () => Player.shuttleBy(1)], ['back', 'Shuttle backward', 'J', () => Player.shuttleBy(-1)],
      ['stopkey', 'Stop shuttle, or add a keyframe when stopped', 'K', () => { if (Player.playing || Player.shuttle) Player.stopShuttle(); else if (L()) { KF.toggleTransform(L()); this.refresh(); } else toast('Select a clip to add a keyframe.'); }],
      ['left', 'Back one frame', 'ArrowLeft', () => App.setTime(App.time - f())], ['right', 'Forward one frame', 'ArrowRight', () => App.setTime(App.time + f())],
      ['left10', 'Back ten frames', 'Shift+ArrowLeft', () => App.setTime(App.time - 10 * f())], ['right10', 'Forward ten frames', 'Shift+ArrowRight', () => App.setTime(App.time + 10 * f())],
      ['home', 'Go to the start', 'Home', () => App.setTime(0)], ['end', 'Go to the end', 'End', () => App.setTime(App.project.duration)],
      ['prevkey', 'Previous keyframe', ',', () => this.kfJump(-1)], ['nextkey', 'Next keyframe', '.', () => this.kfJump(1)],
      ['split', 'Split at playhead', 'S', () => App.split()], ['marker', 'Add marker', 'M', () => App.addMarker()],
      ['delete', 'Delete', 'Delete', () => { if (this.kfSel && this.kfSel.length) { KF.remove(L(), this.kfSel); this.kfSel = []; this.refresh(); } else if (App.sel) App.remove(); }],
      ['delete2', 'Delete (second key)', 'Backspace', () => { if (this.kfSel && this.kfSel.length) { KF.remove(L(), this.kfSel); this.kfSel = []; this.refresh(); } else if (App.sel) App.remove(); }],
      ['ripple', 'Ripple delete (close the gap)', 'Shift+Delete', () => App.rippleDelete()], ['dup', 'Duplicate', 'Ctrl+D', () => App.duplicate()], ['group', 'Group selected clips', 'Ctrl+G', () => App.group()],
      ['undo', 'Undo', 'Ctrl+Z', () => App.undo()], ['redo', 'Redo', 'Ctrl+Shift+Z', () => App.redo()], ['redo2', 'Redo (second key)', 'Ctrl+Y', () => App.redo()],
      ['copykf', 'Copy keyframes', 'Ctrl+C', () => { if (this.kfSel && this.kfSel.length) KF.copy(L(), this.kfSel); else App.copyAttrs(); }], ['pastekf', 'Paste keyframes', 'Ctrl+V', () => { if (KF.clipboard && L()) { KF.paste(L()); this.refresh(); } }],
      ['copyattr', 'Copy look and motion', 'Ctrl+Alt+C', () => App.copyAttrs()], ['pasteattr', 'Paste look and motion', 'Ctrl+Alt+V', () => App.pasteAttrs()],
      ['selall', 'Select every clip', 'Ctrl+A', () => { App.selIds = new Set(App.project.layers.map(l => l.id)); App.sel = App.project.layers[0]?.id || null; this.refresh(); }],
      ['desel', 'Deselect', 'Escape', () => { App.sel = null; App.selIds.clear(); this.kfSel = []; this._pick = null; this.refresh(); }],
      ['zoomin', 'Zoom timeline in', '=', () => this.zoom(1.4)], ['zoomout', 'Zoom timeline out', '-', () => this.zoom(1 / 1.4)], ['fit', 'Fit timeline', 'Shift+Z', () => this.zoomFit()],
      ['history', 'History panel', 'H', () => this.historyPanel()], ['export', 'Export', 'Ctrl+E', () => this.exportDialog()], ['savefile', 'Save project file', 'Ctrl+S', () => ProjectFile.save(App.project)],
      ['guides', 'Show or hide the grid', 'G', () => { this.guides.grid = !this.guides.grid; this.saveGuides(); }], ['cheat', 'Shortcut list', '?', () => this.cheatSheet()]
    ];
  },
  keyMap() { let custom = {}; try { custom = JSON.parse(localStorage.getItem('tf.keys')) || {}; } catch (e) { } const m = {}; for (const [id, , def] of this.keyActions()) m[id] = custom[id] || def; return m; },
  comboOf(e) {
    if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return null;
    const k = e.code === 'Space' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key, plain = e.key.length === 1 && !/[a-z]/i.test(e.key);
    return (e.ctrlKey || e.metaKey ? 'Ctrl+' : '') + (e.altKey ? 'Alt+' : '') + (e.shiftKey && !plain ? 'Shift+' : '') + k;
  },
  initKeys() {
    document.addEventListener('keydown', (e) => {
      if (this._capture) { const c = this.comboOf(e); if (c) { e.preventDefault(); e.stopPropagation(); const cb = this._capture; this._capture = null; cb(c); } return; }
      if (!App.project || $('#editor').classList.contains('hidden')) return;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) || $('#modal:not(.hidden)')) return;
      const combo = this.comboOf(e); if (!combo) return;
      const map = this.keyMap(), act = this.keyActions().find(([id]) => map[id] === combo);
      if (act) { e.preventDefault(); act[3](); }
    });
  },
  cheatSheet() {
    const map = this.keyMap(), list = el('div', { class: 'liblist' });
    for (const [id, label, def] of this.keyActions()) list.appendChild(el('div', { class: 'librow' }, el('span', {}, label),
      el('button', { class: 'btn sm keycap' + (map[id] !== def ? ' on' : ''), title: 'Click, then press the new key', onclick: (e) => { e.target.textContent = 'Press a key…'; this._capture = (c) => { let custom = {}; try { custom = JSON.parse(localStorage.getItem('tf.keys')) || {}; } catch (er) { } custom[id] = c; try { localStorage.setItem('tf.keys', JSON.stringify(custom)); } catch (er) { } this.cheatSheet(); }; } }, map[id])));
    this.modal('Keyboard shortcuts', el('div', {}, el('p', { class: 'hint' }, 'Click a key to change it. Alt-drag a clip to slip the footage inside it.'), list), [['Reset all', () => { try { localStorage.removeItem('tf.keys'); } catch (e) { } this.cheatSheet(); }], ['Close', () => { this._capture = null; this.closeModal(); }, 'primary']]);
  }
});

// ---- wrap the existing timeline, toolbar and panels ------------------------------------
(() => {
  const headW = UI.headW, rowH = UI.rowH, trackRow = UI.trackRow, clipEl = UI.clipEl, renderTimeline = UI.renderTimeline, updatePlayhead = UI.updatePlayhead;
  UI.headW = function () { return Layout.mode === 'desktop' ? 156 : headW.call(this); };
  UI.rowH = function (t) { return t.h || rowH.call(this, t); };
  UI.trackRow = function (t) {
    const row = trackRow.call(this, t), head = $('.thead', row);
    head.innerHTML = ''; if (t.color) head.style.boxShadow = `inset 3px 0 0 ${t.color}`;
    const def = t.kind === 'main' ? 'Main' : t.kind === 'audio' ? 'Audio' : t.kind === 'text' ? 'Text' : 'Overlay';
    if (Layout.mode === 'desktop') {
      head.append(el('span', { class: 'tname' + (t.solo ? ' solo' : ''), title: 'Double-click to rename', ondblclick: () => this.ask('Track name', t.name || def, (n) => { App.change(() => { t.name = n; }); this.renderTimeline(); }) }, (t.solo ? 'S · ' : '') + (t.name || def)),
        btn(t.locked ? 'lock' : 'unlock', t.locked ? 'Unlock track' : 'Lock track', () => App.toggleTrack(t.id, 'locked'), 'ghost' + (t.locked ? ' on' : '')),
        btn(t.hidden ? 'eyeOff' : 'eye', t.hidden ? 'Show track' : 'Hide track', () => App.toggleTrack(t.id, 'hidden'), 'ghost' + (t.hidden ? ' on' : '')),
        btn(t.muted ? 'mute' : 'sound', t.muted ? 'Unmute track' : 'Mute track', () => App.toggleTrack(t.id, 'muted'), 'ghost' + (t.muted ? ' on' : '')),
        btn('more', 'Solo, rename, colour, height, order', (e) => this.trackMenu(t, e.clientX, e.clientY), 'ghost' + (t.solo ? ' on' : '')));
    } else head.append(btn(t.solo ? 'sound' : t.locked ? 'lock' : t.hidden ? 'eyeOff' : t.muted ? 'mute' : 'more', 'Track options', (e) => this.trackMenu(t, e.clientX, e.clientY), 'ghost' + (t.solo ? ' on' : '')));
    head.addEventListener('contextmenu', (e) => { e.preventDefault(); this.trackMenu(t, e.clientX, e.clientY); });
    return row;
  };
  // Only clips near the visible part of the timeline get thumbnails,
  // waveforms and handles; the rest are plain coloured boxes.
  UI.clipEl = function (l, t) {
    const p = App.project, sc = $('#tlScroll');
    if (p.layers.length > 30 && sc && !(App.selIds.has(l.id) || l.id === App.sel)) {
      const x0 = this.headW() + this.pad() + l.start * this.pps, x1 = x0 + l.dur * this.pps, m = sc.clientWidth;
      if (x1 < sc.scrollLeft - m || x0 > sc.scrollLeft + sc.clientWidth + m) return el('div', { class: `clip t-${l.type} far`, 'data-id': l.id, style: { left: this.pad() + l.start * this.pps + 'px', width: Math.max(6, l.dur * this.pps) + 'px' } });
    }
    return clipEl.call(this, l, t);
  };
  UI.renderTimeline = function () {
    renderTimeline.call(this);
    const p = App.project, sc = $('#tlScroll'); if (!p || !sc) return;
    this._virtX = sc.scrollLeft;
    if (this.rulerFrames) for (const tk of $$('#ruler .tick')) { const t = (parseFloat(tk.style.left) - this.headW() - this.pad()) / this.pps; tk.textContent = String(Math.round(t * p.fps)); }
    $('#rulerBtn')?.classList.toggle('on', this.rulerFrames); $('#slipBtn')?.classList.toggle('on', this.slipMode);
  };
  UI.updatePlayhead = function (fromScroll) {
    updatePlayhead.call(this, fromScroll);
    const p = App.project, tc = $('#timecode');
    if (p && tc && this.rulerFrames) tc.innerHTML = `<b>${Math.round(App.time * p.fps)}</b> / ${Math.round(p.duration * p.fps)} f`;
  };

  const drawOverlay = UI.drawOverlay;
  UI.drawOverlay = function () {
    drawOverlay.call(this);
    const o = $('#overlay'), p = App.project; if (!o || !p || Player.playing) return;
    const g = this.guides, W = p.width, H = p.height, out = [], ln = (x1, y1, x2, y2, c = 'gd') => out.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="${c}" vector-effect="non-scaling-stroke"/>`);
    if (g.grid) { const n = 8, s = Math.max(W, H) / n; for (let x = s; x < W; x += s) ln(x, 0, x, H); for (let y = s; y < H; y += s) ln(0, y, W, y); }
    if (g.thirds) { for (const f of [1 / 3, 2 / 3]) { ln(W * f, 0, W * f, H, 'gd3'); ln(0, H * f, W, H * f, 'gd3'); } }
    if (g.center) { ln(W / 2, 0, W / 2, H, 'gd3'); ln(0, H / 2, W, H / 2, 'gd3'); }
    if (g.safe) out.push(`<rect x="${W * 0.05}" y="${H * 0.05}" width="${W * 0.9}" height="${H * 0.9}" class="gsafe" vector-effect="non-scaling-stroke"/><rect x="${W * 0.1}" y="${H * 0.1}" width="${W * 0.8}" height="${H * 0.8}" class="gsafe" vector-effect="non-scaling-stroke"/>`);
    const z = SAFE_ZONES[g.zone];
    if (z) out.push(`<path class="gzone" fill-rule="evenodd" d="M0,0H${W}V${H}H0Z M${W * z.l},${H * z.t}H${W * (1 - z.r)}V${H * (1 - z.b)}H${W * z.l}Z"/><text x="${W * z.l + 10}" y="${H * z.t + 34}" class="gztxt" font-size="${Math.max(W, H) * 0.022}">${z.name} safe area (approximate)</text>`);
    if (out.length) o.insertAdjacentHTML('afterbegin', `<g pointer-events="none">${out.join('')}</g>`);
  };

  const transformPanel = UI.panel_transform, canvasPanel = UI.panel_canvas, layerPanel = UI.panel_layer, assetTools = UI.assetTools, renderToolbar = UI.renderToolbar, init = UI.init;
  UI.panel_transform = function (body, l) { if (l.type !== 'adjust' && l.type !== 'audio') body.appendChild(this.alignRow(l)); transformPanel.call(this, body, l); };
  UI.panel_layer = function (body, l) {
    layerPanel.call(this, body, l);
    body.appendChild(el('div', { class: 'sect' }, 'Copy between clips'));
    body.appendChild(el('div', { class: 'btnrow' }, el('button', { class: 'btn sm', onclick: () => App.copyAttrs() }, 'Copy look & motion'),
      el('button', { class: 'btn sm', onclick: () => App.pasteAttrs() }, 'Paste all'), el('button', { class: 'btn sm', onclick: () => App.pasteAttrs({ effects: true }) }, 'Paste effects only'), el('button', { class: 'btn sm', onclick: () => App.pasteAttrs({ transform: true }) }, 'Paste motion only'),
      el('button', { class: 'btn sm danger', onclick: () => App.rippleDelete() }, 'Ripple delete')));
  };
  UI.panel_canvas = function (body) {
    canvasPanel.call(this, body);
    const g = this.guides, tog = (k, n) => el('button', { class: 'btn sm' + (g[k] ? ' on' : ''), onclick: () => { g[k] = !g[k]; this.saveGuides(); this.refreshPanel(); } }, n);
    body.appendChild(el('div', { class: 'sect' }, 'Preview guides'));
    body.appendChild(el('div', { class: 'btnrow' }, tog('grid', 'Grid'), tog('thirds', 'Thirds'), tog('center', 'Centre lines'), tog('safe', 'Title safe')));
    body.appendChild(this.row('App safe zone', el('select', { onchange: (e) => { g.zone = e.target.value; this.saveGuides(); } }, Object.entries(SAFE_ZONES).map(([k, z]) => el('option', { value: k, selected: (g.zone || 'none') === k }, z ? z.name : 'Off')))));
    body.appendChild(el('div', { class: 'sect' }, 'More'));
    body.appendChild(el('div', { class: 'btnrow' }, el('button', { class: 'btn sm', onclick: () => this.historyPanel() }, 'History'), el('button', { class: 'btn sm', onclick: () => this.cheatSheet() }, 'Keyboard shortcuts'),
      el('button', { class: 'btn sm', onclick: () => this.openTool('layers') }, 'Layers list')));
  };
  UI.assetTools = function () { return [...assetTools.call(this), ['charts', 'Charts', 'keyframe'], ['layers', 'Layers', 'layers']]; };
  UI.renderToolbar = function () {
    renderToolbar.call(this);
    const bar = $('#toolbar'); if (!bar || App.layer()) return;
    const add = (label, icon, fn) => bar.appendChild(el('button', { class: 'tbtn', onclick: fn, html: (ICON[icon] || '') + `<span>${label}</span>` }));
    const vis = ['video', 'image', 'text', 'shape', 'solid', 'caption', 'group', 'chart'];
    add('Retouch', 'filter', () => { if (this.pickUnder(['video', 'image'])) this.openTool('retouch'); });
    add('Layers', 'layers', () => this.openTool('layers'));
    add('Mask', 'mask', () => { if (this.pickUnder(vis)) this.openTool('mask'); });
    add('Chroma', 'blend', () => { const l = this.pickUnder(['video', 'image']); if (l) { if (!l.effects.some(f => f.defId === 'tf.chromakey')) App.addEffect('tf.chromakey'); this.openTool('fx'); } });
    add('Track', 'marker', () => { if (this.pickUnder(['video'])) this.openTool('track'); });
    add('Adjust', 'edit', () => { const l = this.pickUnder(['video', 'image']); if (l) { if (!l.effects.some(f => f.defId === 'tf.grade')) App.addEffect('tf.grade'); this.openTool('fx'); } });
    add('Shapes', 'shape', () => this.openTool('stickers'));
    add('Graphs', 'keyframe', () => this.openTool('charts'));
  };
  UI.init = function () {
    init.call(this);
    Curves.load();
    const bar = $('#tlbar'), anchor = bar && bar.querySelector('.grow');
    if (bar && anchor) {
      const mk = (id, text, title, fn) => { const b = el('button', { class: 'ib xs txtbtn', id, title, onclick: fn }, text); bar.insertBefore(b, anchor); };
      mk('rulerBtn', '#', 'Ruler: timecode or frame numbers', () => { this.rulerFrames = !this.rulerFrames; this.renderTimeline(); this.updatePlayhead(); });
      mk('slipBtn', '⇆', 'Slip mode: dragging a clip slides the footage inside it (or hold Alt)', () => { this.slipMode = !this.slipMode; this.renderTimeline(); toast(this.slipMode ? 'Slip mode on: drag a clip to slide its footage.' : 'Slip mode off.'); });
      mk('histBtn', '↺', 'History', () => this.historyPanel());
      mk('helpBtn', '?', 'Keyboard shortcuts', () => this.cheatSheet());
    }
    // Redraw the clip list when the view scrolls far enough (big projects).
    const sc = $('#tlScroll'); let raf = 0;
    sc.addEventListener('scroll', () => { if (!App.project || App.project.layers.length <= 30 || raf) return; if (Math.abs(sc.scrollLeft - (this._virtX || 0)) < sc.clientWidth * 0.6) return; raf = requestAnimationFrame(() => { raf = 0; this.renderTimeline(); }); }, { passive: true });
  };
})();

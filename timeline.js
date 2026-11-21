// ===========================================================================
// Timeline: tracks, clips, keyframe diamonds, transitions, markers, zoom.
//
// Phone layout: the playhead stays in the middle and the timeline scrolls
// under it (swipe to scrub, pinch to zoom).
// Computer layout: the playhead moves; click or drag the ruler to scrub,
// Ctrl + wheel to zoom, Shift + wheel to scroll sideways, drag on empty
// space to box-select clips.
// ===========================================================================
Object.assign(UI, {
  headW() { return Layout.mode === 'desktop' ? 132 : 40; },
  pad() { const sc = $('#tlScroll'); return Layout.mode === 'mobile' ? Math.round((sc.clientWidth - this.headW()) / 2) : 18; },
  rowH(t) { return t.kind === 'audio' ? 44 : (t.kind === 'main' || this.project?.layers?.some?.(l => l.track === t.id && (l.type === 'video' || l.type === 'image'))) ? 56 : 40; },

  initTimeline() {
    const sc = $('#tlScroll');
    sc.addEventListener('scroll', () => {
      if (Layout.mode !== 'mobile') return;
      if (this._progTarget != null && Math.abs(sc.scrollLeft - this._progTarget) < 1) return;
      this._progTarget = null;
      if (Player.playing) Player.pause();
      App.setTime(sc.scrollLeft / this.pps, true);
    }, { passive: true });
    // Pinch to zoom on phone; two-finger pan is the normal scroll.
    let pinch = null;
    sc.addEventListener('touchstart', (e) => { if (e.touches.length === 2) pinch = { d: Math.abs(e.touches[0].clientX - e.touches[1].clientX) || 1, pps: this.pps }; }, { passive: true });
    sc.addEventListener('touchmove', (e) => { if (!pinch || e.touches.length !== 2) return; e.preventDefault(); this.setZoom(pinch.pps * (Math.abs(e.touches[0].clientX - e.touches[1].clientX) || 1) / pinch.d); }, { passive: false });
    sc.addEventListener('touchend', () => { pinch = null; });
    sc.addEventListener('wheel', (e) => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); this.setZoom(this.pps * (e.deltaY < 0 ? 1.15 : 1 / 1.15)); } }, { passive: false });
    // Ruler: click or drag to scrub (both layouts).
    const ruler = $('#ruler'); let scrub = false;
    const seek = (e) => { const r = $('#tlInner').getBoundingClientRect(); App.setTime((e.clientX - r.left - this.headW() - this.pad()) / this.pps); };
    ruler.addEventListener('pointerdown', (e) => { if (e.target.closest('.mflag')) return; scrub = true; ruler.setPointerCapture(e.pointerId); if (Player.playing) Player.pause(); seek(e); });
    ruler.addEventListener('pointermove', (e) => { if (scrub) seek(e); });
    ruler.addEventListener('pointerup', () => { scrub = false; });
    // Desktop playhead handle.
    const ph = $('#tlPlayhead');
    ph.addEventListener('pointerdown', (e) => { e.stopPropagation(); ph.setPointerCapture(e.pointerId); scrub = true; if (Player.playing) Player.pause(); });
    ph.addEventListener('pointermove', (e) => { if (scrub) seek(e); });
    ph.addEventListener('pointerup', () => { scrub = false; });
    // Empty space: tap to deselect; mouse drag to box-select.
    const tracks = $('#tracks');
    tracks.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.clip,.thead,.tjoin')) return;
      if (e.pointerType !== 'mouse') return;
      const inner = $('#tlInner').getBoundingClientRect();
      const box = $('#boxSel'), x0 = e.clientX - inner.left, y0 = e.clientY - inner.top;
      let moved = false;
      const move = (ev) => {
        const x1 = ev.clientX - inner.left, y1 = ev.clientY - inner.top;
        if (Math.abs(x1 - x0) + Math.abs(y1 - y0) > 4) moved = true;
        Object.assign(box.style, { display: 'block', left: Math.min(x0, x1) + 'px', top: Math.min(y0, y1) + 'px', width: Math.abs(x1 - x0) + 'px', height: Math.abs(y1 - y0) + 'px' });
      };
      const up = (ev) => {
        document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up);
        box.style.display = 'none';
        if (!moved) { App.sel = null; App.selIds.clear(); this.closeSheet(true); this.refresh(); return; }
        const br = box.getBoundingClientRect ? { l: Math.min(x0, ev.clientX - inner.left), r: Math.max(x0, ev.clientX - inner.left), t: Math.min(y0, ev.clientY - inner.top), b: Math.max(y0, ev.clientY - inner.top) } : null;
        const ids = [];
        for (const c of $$('.clip', tracks)) { const cr = c.getBoundingClientRect(); const L = cr.left - inner.left, R = cr.right - inner.left, T = cr.top - inner.top, B = cr.bottom - inner.top; if (L < br.r && R > br.l && T < br.b && B > br.t) ids.push(c.dataset.id); }
        App.selIds = new Set(ids); App.sel = ids[0] || null; this.refresh();
      };
      document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
    });
    tracks.addEventListener('click', (e) => {
      if (e.target.closest('.clip,.thead,.tjoin') || Layout.mode === 'desktop') return;
      if (App.sel) { App.sel = null; App.selIds.clear(); this.closeSheet(true); this.refresh(); }
    });
  },
  setZoom(pps, keepTime = true) {
    this.pps = clamp(pps, 4, 1200);
    const z = $('#zoomSlider'); if (z) z.value = Math.log(this.pps);
    this.renderTimeline(); if (keepTime) this.updatePlayhead();
  },
  zoom(f) { this.setZoom(this.pps * f); },
  zoomFit() {
    const sc = $('#tlScroll'), w = sc.clientWidth - this.headW() - (Layout.mode === 'mobile' ? 40 : 2 * this.pad());
    this.setZoom(Math.max(4, w / Math.max(0.5, App.project.duration)));
    if (Layout.mode === 'desktop') sc.scrollLeft = 0;
  },

  // The playhead: centred line on phone, moving line on computer.
  updatePlayhead(fromScroll) {
    const p = App.project; if (!p) return;
    const f = (t) => { const m = Math.floor(t / 60), s = Math.floor(t % 60), fr = Math.floor((t % 1) * p.fps + 1e-6); return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${Layout.mode === 'desktop' ? ':' + String(fr).padStart(2, '0') : ''}`; };
    const tc = $('#timecode'); if (tc) tc.innerHTML = `<b>${f(App.time)}</b> / ${f(p.duration)}`;
    const sc = $('#tlScroll'); if (!sc) return;
    if (Layout.mode === 'mobile') {
      if (!fromScroll) { const target = App.time * this.pps; if (Math.abs(sc.scrollLeft - target) > 0.5) { this._progTarget = target; sc.scrollLeft = target; } }
    } else {
      const x = this.headW() + this.pad() + App.time * this.pps;
      const ph = $('#tlPlayhead'); if (ph) ph.style.transform = `translateX(${x}px)`;
      if (Player.playing) { const vis0 = sc.scrollLeft + this.headW(), vis1 = sc.scrollLeft + sc.clientWidth - 30; if (x < vis0 || x > vis1) sc.scrollLeft = x - this.headW() - 40; }
    }
  },

  // ---- drawing the timeline -----------------------------------------------------
  renderTimeline() {
    const p = App.project; if (!p || !$('#tlScroll')) return;
    this.project = p;
    const sc = $('#tlScroll'), inner = $('#tlInner'), tracks = $('#tracks'), ruler = $('#ruler');
    const hw = this.headW(), pad = this.pad();
    const W = hw + pad * 2 + p.duration * this.pps + (Layout.mode === 'desktop' ? 200 : 0);
    inner.style.width = Math.max(W, sc.clientWidth) + 'px';
    // Ruler with time labels and marker flags.
    ruler.innerHTML = '';
    ruler.appendChild(el('div', { class: 'rhead', style: { width: hw + 'px' } }));
    const steps = [1 / p.fps, 2 / p.fps, 5 / p.fps, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
    const step = steps.find(s => s * this.pps >= 70) || 300;
    for (let t = 0; t <= p.duration + 1e-6; t += step) {
      const whole = Math.abs(t - Math.round(t)) < 1e-6;
      const lab = whole || step >= 1 ? `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.round(t % 60)).padStart(2, '0')}` : `${Math.round((t % 1) * p.fps)}f`;
      ruler.appendChild(el('div', { class: 'tick', style: { left: hw + pad + t * this.pps + 'px' } }, lab));
      ruler.appendChild(el('div', { class: 'dot', style: { left: hw + pad + (t + step / 2) * this.pps + 'px' } }));
    }
    for (const m of p.markers || []) {
      ruler.appendChild(el('div', { class: 'mflag' + (m.beat ? ' beat' : ''), title: m.label || 'Marker', style: { left: hw + pad + m.t * this.pps + 'px' },
        onclick: (e) => { e.stopPropagation(); App.setTime(m.t); },
        oncontextmenu: (e) => { e.preventDefault(); this.markerMenu(m, e.clientX, e.clientY); },
        ondblclick: () => this.markerMenu(m, 100, 100) }, m.label ? el('span', {}, m.label) : null));
    }
    // Track rows: visual tracks top to bottom, then audio tracks.
    tracks.innerHTML = '';
    const vis = p.tracks.filter(t => t.kind !== 'audio').slice().reverse(), aud = p.tracks.filter(t => t.kind === 'audio');
    for (const t of [...vis, ...aud]) tracks.appendChild(this.trackRow(t));
    if (!p.layers.length) tracks.appendChild(el('div', { class: 'tlempty', style: { marginLeft: hw + pad + 'px' } }, 'Tap + to add videos or photos'));
    const z = $('#zoomSlider'); if (z) z.value = Math.log(this.pps);
    this.updateTransport();
  },
  trackRow(t) {
    const p = App.project, hw = this.headW(), pad = this.pad();
    const row = el('div', { class: `track k-${t.kind}${t.hidden ? ' thidden' : ''}${t.locked ? ' tlocked' : ''}`, 'data-track': t.id, style: { height: this.rowH(t) + 'px' } });
    const head = el('div', { class: 'thead', style: { width: hw + 'px' } });
    if (Layout.mode === 'desktop') {
      head.append(el('span', { class: 'tname' }, t.kind === 'main' ? 'Main' : t.kind === 'audio' ? 'Audio' : t.kind === 'text' ? 'Text' : 'Overlay'),
        btn(t.locked ? 'lock' : 'unlock', t.locked ? 'Unlock track' : 'Lock track', () => App.toggleTrack(t.id, 'locked'), 'ghost' + (t.locked ? ' on' : '')),
        btn(t.hidden ? 'eyeOff' : 'eye', t.hidden ? 'Show track' : 'Hide track', () => App.toggleTrack(t.id, 'hidden'), 'ghost' + (t.hidden ? ' on' : '')),
        btn(t.muted ? 'mute' : 'sound', t.muted ? 'Unmute track' : 'Mute track', () => App.toggleTrack(t.id, 'muted'), 'ghost' + (t.muted ? ' on' : '')));
    } else {
      head.append(btn(t.locked ? 'lock' : t.hidden ? 'eyeOff' : t.muted ? 'mute' : 'more', 'Track options', (e) => this.menu(e.clientX, e.clientY, [
        [t.locked ? 'Unlock track' : 'Lock track', () => App.toggleTrack(t.id, 'locked')],
        [t.hidden ? 'Show track' : 'Hide track', () => App.toggleTrack(t.id, 'hidden')],
        [t.muted ? 'Unmute track' : 'Mute track', () => App.toggleTrack(t.id, 'muted')]]), 'ghost'));
    }
    row.appendChild(head);
    const lane = el('div', { class: 'tlane' });
    const clips = p.layers.filter(l => l.track === t.id).sort((a, b) => a.start - b.start);
    for (const l of clips) lane.appendChild(this.clipEl(l, t));
    // Junction buttons between touching clips (tap to pick a transition).
    for (let i = 1; i < clips.length; i++) {
      const a = clips[i - 1], b = clips[i];
      if (Math.abs(a.start + a.dur - b.start) < 1.5 / p.fps && VISUAL_TYPES.has(b.type)) {
        lane.appendChild(el('button', { class: 'tjoin' + (b.transIn ? ' on' : ''), title: b.transIn ? (transitionById(b.transIn.id)?.name || 'Transition') : 'Add transition', style: { left: pad + b.start * this.pps + 'px' },
          onclick: (e) => { e.stopPropagation(); App.sel = b.id; App.selIds = new Set([b.id]); this.refresh(); this.openTool('trans'); }, html: ICON.transition }));
      }
    }
    row.appendChild(lane);
    return row;
  },
  clipEl(l, t) {
    const p = App.project, pad = this.pad(), sel = App.selIds.has(l.id) || l.id === App.sel;
    const big = l.type === 'video' || l.type === 'image';
    const m = l.mediaId ? Media.items.get(l.mediaId) : null;
    const w = Math.max(6, l.dur * this.pps);
    const clip = el('div', { class: `clip t-${l.type}${sel ? ' sel' : ''}${l.hidden ? ' off' : ''}`, 'data-id': l.id, style: { left: pad + l.start * this.pps + 'px', width: w + 'px' } });
    if (big && m && m.thumbs && m.thumbs.length) {
      const h = this.rowH(t) - 4, tw = Math.max(20, Math.round(h * m.w / m.h));
      const n = Math.min(80, Math.ceil(w / tw)), strip = el('div', { class: 'strip' });
      for (let i = 0; i < n; i++) {
        const st = l.type === 'video' ? srcTimeFor(l, (i + 0.5) * tw / this.pps) : 0;
        let best = m.thumbs[0]; for (const th of m.thumbs) if (Math.abs(th.t - st) < Math.abs(best.t - st)) best = th;
        strip.appendChild(el('img', { src: best.url, style: { width: tw + 'px' }, draggable: 'false' }));
      }
      clip.appendChild(strip);
    }
    // Waveform for anything with sound.
    if (m && m.peaks && (l.type === 'audio' || l.type === 'video')) clip.appendChild(this.waveform(l, m, w, l.type === 'audio' ? this.rowH(t) - 4 : 14));
    const icon = { text: 'T', shape: '◆', solid: '■', adjust: '◐', audio: '♪', caption: 'CC', group: '▣', null: '✛' }[l.type] || '';
    const label = l.type === 'text' ? (l.text?.content || '').split('\n')[0] : l.name;
    clip.appendChild(el('span', { class: 'cname' }, icon ? el('i', {}, icon) : null, big ? null : label));
    const hasHold = l.effects.some(f => f.enabled && EffectLib.get(f.defId)?.kind === 'hold');
    const nFx = l.effects.filter(f => f.enabled && EffectLib.get(f.defId)?.kind !== 'hold').length;
    clip.appendChild(el('span', { class: 'badges' },
      big ? el('em', {}, l.dur < 60 ? l.dur.toFixed(1) + 's' : Math.floor(l.dur / 60) + 'm' + Math.round(l.dur % 60) + 's') : null,
      hasHold ? el('em', { class: 'hold' }, 'HOLD') : null, nFx ? el('em', {}, 'FX ' + nFx) : null,
      l.video && (l.video.speed !== 1 || l.video.curve) ? el('em', {}, l.video.curve ? (l.video.curveName || 'Curve') : l.video.speed + '×') : null,
      l.video && l.video.reverse ? el('em', {}, '⟲') : null, l.video && l.video.freeze != null ? el('em', {}, 'FREEZE') : null,
      l.parent ? el('em', {}, '⛓') : null, l.matte ? el('em', {}, 'MATTE') : null));
    if (l.transIn) clip.appendChild(el('i', { class: 'trband in', style: { width: Math.min(w, l.transIn.dur * this.pps) + 'px' } }));
    if (l.transOut) clip.appendChild(el('i', { class: 'trband out', style: { width: Math.min(w, l.transOut.dur * this.pps) + 'px' } }));
    // Keyframe diamonds on the clip (draggable when selected).
    for (const kt of KF.times(l)) {
      const d = el('i', { class: 'kmark ' + easeShape(kt.e), style: { left: kt.t * this.pps + 'px' } });
      if (sel) this.dragKeyMark(d, l, kt.t);
      clip.appendChild(d);
    }
    if (sel && !App.track(l.track)?.locked) clip.append(el('div', { class: 'handle left' }), el('div', { class: 'handle right' }));
    this.clipInteractions(clip, l, t);
    return clip;
  },
  waveform(l, m, w, h) {
    const cw = Math.min(4000, Math.ceil(w)), c = el('canvas', { class: 'wave', width: cw, height: h * 2, style: { width: cw + 'px', height: h + 'px' } });
    const g = c.getContext('2d'), pk = m.peaks, dur = m.audio.duration, speed = (l.video ? l.video.speed : l.audioOpts?.speed) || 1;
    g.fillStyle = l.type === 'audio' ? 'rgba(255,255,255,.75)' : 'rgba(20,224,200,.8)';
    for (let x = 0; x < cw; x++) {
      const st = (l.in || 0) + (x / this.pps) * speed, i = Math.floor(st / dur * pk.length);
      const v = i >= 0 && i < pk.length ? pk[i] : 0, bh = Math.max(1, v * h * 2);
      g.fillRect(x, h - bh / 2, 1, bh);
    }
    return c;
  },

  // Drag a clip (move, change track) or its ends (trim). Snaps to the
  // playhead, markers and other clip edges when snapping is on.
  clipInteractions(clip, l, t) {
    const p = App.project;
    let drag = null, longT = 0;
    const snapT = (tt, self) => {
      if (!App.snapping) return Math.round(tt * p.fps) / p.fps;
      const lim = 8 / this.pps, c = [App.time, 0, ...(p.markers || []).map(m => m.t)];
      for (const o of p.layers) if (o !== self) c.push(o.start, o.start + o.dur); for (const o of p.layers) if (o !== self) for (const kt of KF.times(o)) c.push(o.start + kt.t);
      let best = Math.round(tt * p.fps) / p.fps;
      for (const x of c) if (Math.abs(x - tt) < lim && Math.abs(x - tt) < Math.abs(best - tt) + 1e-9) best = x;
      return best;
    };
    clip.addEventListener('contextmenu', (e) => { e.preventDefault(); this.selectClip(l, e); this.clipMenu(l, e.clientX, e.clientY); });
    clip.addEventListener('pointerdown', (e) => {
      if (e.button === 2) return;
      const selected = App.selIds.has(l.id) || l.id === App.sel;
      if (!selected && e.pointerType === 'mouse') this.selectClip(l, e, true);
      const canDrag = (selected || e.pointerType === 'mouse') && !App.track(l.track)?.locked && !e.target.classList.contains('kmark');
      if (e.pointerType !== 'mouse') longT = setTimeout(() => { if (!drag || !drag.moved) { drag = null; this.selectClip(l, e); this.clipMenu(l, e.clientX, e.clientY); } }, 550);
      if (!canDrag) return;
      e.stopPropagation(); clip.setPointerCapture(e.pointerId);
      const mode = e.target.classList.contains('left') ? 'left' : e.target.classList.contains('right') ? 'right' : 'move';
      drag = { mode, x: e.clientX, y: e.clientY, start: l.start, dur: l.dur, in: l.in || 0, moved: false, track: l.track };
    });
    clip.addEventListener('pointermove', (e) => {
      if (!drag) return;
      if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 5) { drag.moved = true; clearTimeout(longT); }
      if (!drag.moved) return;
      const dt = (e.clientX - drag.x) / this.pps;
      const m = Media.items.get(l.mediaId), speed = (l.video && l.video.speed) || (l.audioOpts && l.audioOpts.speed) || 1;
      const srcLen = m && (l.type === 'video' || l.type === 'audio') && !(l.video && (l.video.freeze != null || l.video.curve)) ? m.duration : Infinity;
      // Which track is under the finger?
      const under = document.elementFromPoint(e.clientX, e.clientY)?.closest('.track');
      const tgt = under ? App.track(under.dataset.track) : null;
      drag.toTrack = tgt && (tgt.kind === 'audio') === (l.type === 'audio') ? tgt.id : drag.track;
      $$('.track.droptarget').forEach(x => x.classList.remove('droptarget')); if (drag.toTrack !== drag.track && under) under.classList.add('droptarget');
      App.change(() => {
        if (drag.mode === 'move') {
          if ((e.altKey || UI.slipMode) && (l.type === 'video' || l.type === 'audio') && srcLen < Infinity) { l.in = clamp(drag.in - dt * speed, 0, Math.max(0, srcLen - l.dur * speed)); const rr = Runtime.map.get(l.id); if (rr) { for (const q of rr.cache.values()) engine.freeRT(q); rr.cache.clear(); } return; }
          let s = Math.max(0, drag.start + dt); const s2 = snapT(s, l), e2 = snapT(s + l.dur, l);
          s = Math.abs(s2 - s) <= Math.abs(e2 - (s + l.dur)) ? s2 : e2 - l.dur; l.start = Math.max(0, s);
        } else if (drag.mode === 'right') {
          l.dur = Math.max(1 / p.fps, snapT(drag.start + drag.dur + dt, l) - drag.start);
          if (srcLen < Infinity) l.dur = Math.min(l.dur, (srcLen - (l.in || 0)) / speed);
        } else {
          let d = snapT(drag.start + dt, l) - drag.start; d = Math.max(d, -drag.start); d = Math.min(d, drag.dur - 1 / p.fps);
          if (srcLen < Infinity) d = Math.max(d, -drag.in / speed);
          l.start = drag.start + d; l.dur = drag.dur - d; l.in = drag.in + d * speed;
          for (const ks of Object.values(l.keys || {})) for (const k of ks) { if (k._t0 == null) k._t0 = k.t; k.t = k._t0 - d; }
        }
        p.duration = Math.max(p.duration, l.start + l.dur);
      }, 'clip' + l.id + drag.mode);
      clip.style.left = this.pad() + l.start * this.pps + 'px'; clip.style.width = Math.max(6, l.dur * this.pps) + 'px';
    });
    const up = () => {
      clearTimeout(longT);
      $$('.track.droptarget').forEach(x => x.classList.remove('droptarget'));
      if (drag && drag.moved) {
        App.change(() => {
          for (const ks of Object.values(l.keys || {})) for (const k of ks) delete k._t0;
          if (drag.toTrack && drag.toTrack !== l.track && App.trackFree(drag.toTrack, l.start, l.start + l.dur, l)) l.track = drag.toTrack;
          else if (drag.mode === 'move' && App.overlapToTransition && App.overlapToTransition(l)) { /* turned into a transition */ }
          else if (drag.mode === 'move' && !App.trackFree(l.track, l.start, l.start + l.dur, l) && App.track(l.track)?.kind !== 'main') l.track = App.trackFor(App.track(l.track)?.kind || 'overlay', l.start, l.start + l.dur, l).id;
          // Magnetic main track: the drop position sets the order, then gaps close.
          if (p.magnetic && App.track(l.track)?.kind === 'main') { const main = App.mainTrack(p); const mid = l.start + l.dur / 2; const others = p.layers.filter(o => o.track === main.id && o !== l).sort((a, b) => a.start - b.start); let pos = 0; for (const o of others) { if (o.start + o.dur / 2 < mid) pos = o.start + o.dur; } l.start = pos - 0.0001; }
          App.compactMain(p); App.removeEmptyTracks(p);
        }, 'clipdrop' + l.id);
        this.renderTimeline(); this.refreshPanel();
      } else if (drag === null || (drag && !drag.moved)) { /* tap handled by click */ }
      drag = null;
    };
    clip.addEventListener('pointerup', up); clip.addEventListener('pointercancel', up);
    clip.addEventListener('click', (e) => { e.stopPropagation(); this.selectClip(l, e); });
  },
  selectClip(l, e, keepTool) {
    const multi = e && (e.shiftKey || e.ctrlKey || e.metaKey) || this.multi;
    if (multi) { if (App.selIds.has(l.id)) App.selIds.delete(l.id); else App.selIds.add(l.id); App.sel = App.selIds.has(l.id) ? l.id : (Array.from(App.selIds)[0] || null); }
    else { if (App.sel === l.id && App.selIds.size <= 1) return; App.sel = l.id; App.selIds = new Set([l.id]); }
    this.kfSel = [];
    if (!keepTool && Layout.mode === 'mobile') { this.closeSheet(true); }
    this.refresh();
  },
  clipMenu(l, x, y) {
    const multi = App.selIds.size > 1;
    this.menu(x, y, [
      ['Split at playhead', () => App.split()], ['Duplicate', () => App.duplicate()],
      l.type === 'video' ? ['Freeze frame', () => App.freezeFrame()] : null, l.type === 'video' ? [l.video.reverse ? 'Un-reverse' : 'Reverse', () => App.toggleReverse()] : null,
      ['Add transition…', () => this.openTool('trans')], ['Effects…', () => this.openTool('fx')], ['Keyframes…', () => this.openTool('keyframes')],
      KF.clipboard ? ['Paste keyframes at playhead', () => { KF.paste(l); this.refresh(); }] : null,
      multi ? ['Group selected', () => App.group()] : null, l.type === 'group' ? ['Ungroup', () => App.ungroup()] : null,
      ['Move to track above', () => App.move(1)], ['Move to track below', () => App.move(-1)],
      ['-'], [multi ? `Delete ${App.selIds.size} clips` : 'Delete', () => App.remove(), 'danger']]);
  },
  markerMenu(m, x, y) {
    this.menu(x, y, [['Rename…', () => {
      const inp = el('input', { type: 'text', value: m.label || '' });
      this.modal('Marker label', inp, [['Cancel', () => this.closeModal()], ['Save', () => { App.change(() => { m.label = inp.value; }); this.closeModal(); this.renderTimeline(); }, 'primary']]);
      setTimeout(() => inp.focus(), 50);
    }], ['Go to marker', () => App.setTime(m.t)], ['Delete marker', () => App.removeMarker(m.id), 'danger']]);
  },
  // Dragging a diamond on the clip moves every keyframe at that time.
  dragKeyMark(d, l, t0) {
    d.addEventListener('pointerdown', (e) => {
      e.stopPropagation(); d.setPointerCapture(e.pointerId);
      const refs = []; for (const path of KF.paths(l)) for (const k of l.keys[path]) if (Math.abs(k.t - t0) < 1e-4) refs.push({ path, k });
      const ex = new Set(refs.map(r => r.k)), x0 = e.clientX; let moved = false;
      const move = (ev) => {
        if (Math.abs(ev.clientX - x0) > 3) moved = true; if (!moved) return;
        const nt = clamp(KF.snap(l, t0 + (ev.clientX - x0) / this.pps, this.pps, ex), 0, l.dur);
        App.change(() => { for (const r of refs) r.k.t = nt; }, 'kmark' + l.id);
        d.style.left = nt * this.pps + 'px';
      };
      const up = () => {
        d.removeEventListener('pointermove', move); d.removeEventListener('pointerup', up);
        if (moved) { App.change(() => { for (const path of KF.paths(l)) KF.sort(l, path); }, 'kmark' + l.id); this.renderTimeline(); this.refreshPanel(); }
        else App.setTime(l.start + t0);
      };
      d.addEventListener('pointermove', move); d.addEventListener('pointerup', up);
    });
  }
});

// ===========================================================================
// "Leap style" look for the phone layout, modelled on how Videoleap is laid
// out: black screen, preview on top, one row of big labelled tools along
// the bottom that starts with a round + button and Mixer / Text / Audio /
// Filters / Adjust / Format. The CapCut-style look is still there: Home ›
// Layout switches between the two. "Bigger buttons and text" enlarges
// everything for easier reading.
// ===========================================================================
// Defined with getters and setters so that changing either one re-styles the app at once.
Object.defineProperties(UI, {
  skin: { get() { try { return localStorage.getItem('tf.skin') || 'leap'; } catch (e) { return 'leap'; } }, set(v) { try { localStorage.setItem('tf.skin', v); } catch (e) { } this.applySkin(); } },
  bigUI: { get() { try { return localStorage.getItem('tf.big') === '1'; } catch (e) { return false; } }, set(v) { try { localStorage.setItem('tf.big', v ? '1' : '0'); } catch (e) { } this.applySkin(); } }
});
UI.applySkin = function () { document.body.classList.toggle('skin-leap', this.skin === 'leap'); document.body.classList.toggle('big-ui', this.bigUI); if (App.project) { this.refresh(); this.onResize(); } };
(() => {
  const renderToolbar = UI.renderToolbar, init = UI.init, title = UI.toolTitle;
  UI.init = function () { init.call(this); wrapDialog(); this.applySkin(); };
  UI.renderToolbar = function () {
    renderToolbar.call(this);
    const bar = $('#toolbar'); if (!bar || this.skin !== 'leap' || Layout.mode !== 'mobile' || App.layer()) return;
    bar.innerHTML = '';
    const add = (id, label, icon, fn, cls = '') => bar.appendChild(el('button', { class: 'tbtn ' + cls + (id === this.tool && this.sheetOpen ? ' on' : ''), onclick: fn, html: (ICON[icon] || '') + `<span>${label}</span>` }));
    const vis = ['video', 'image', 'text', 'shape', 'solid', 'caption', 'group', 'chart'];
    add('addmedia', 'Add', 'plus', () => this.pickMedia({}), 'addbig');
    add('overlay', 'Mixer', 'overlay', () => this.pickMedia({ overlay: true }));
    add('text', 'Text', 'text', () => this.openTool('text'));
    add('audio', 'Audio', 'audio', () => this.openTool('audio'));
    add('voice', 'Voiceover', 'sound', () => this.recordVoice());
    add('filters', 'Filters', 'filter', () => this.openTool('filters'));
    add('adjust', 'Adjust', 'edit', () => { const l = this.pickUnder(['video', 'image']); if (l) { if (!l.effects.some(f => f.defId === 'tf.grade')) App.addEffect('tf.grade'); this.openTool('fx'); } });
    add('effectsLib', 'Effects', 'fx', () => this.openTool('effectsLib'));
    add('canvas', 'Format', 'canvas', () => this.openTool('canvas'));
    add('stickers', 'Stickers', 'sticker', () => this.openTool('stickers'));
    add('captions', 'Captions', 'captions', () => this.openTool('captions'));
    add('transitions', 'Transitions', 'transition', () => this.openTool('transitions'));
    add('transform', 'Edit clip', 'crop', () => { if (this.pickUnder(vis)) this.openTool('transform'); });
    add('speed', 'Speed', 'speed', () => { if (this.pickUnder(['video'])) this.openTool('speed'); });
    add('keyframes', 'Keyframe', 'keyframe', () => { if (this.pickUnder(vis)) this.openTool('keyframes'); });
    add('retouch', 'Retouch', 'filter', () => { if (this.pickUnder(['video', 'image'])) this.openTool('retouch'); });
    add('mask', 'Mask', 'mask', () => { if (this.pickUnder(vis)) this.openTool('mask'); });
    add('chroma', 'Chroma', 'blend', () => { const l = this.pickUnder(['video', 'image']); if (l) { if (!l.effects.some(f => f.defId === 'tf.chromakey')) App.addEffect('tf.chromakey'); this.openTool('fx'); } });
    add('track', 'Track', 'marker', () => { if (this.pickUnder(['video'])) this.openTool('track'); });
    add('charts', 'Graphs', 'keyframe', () => this.openTool('charts'));
    add('layers', 'Layers', 'layers', () => this.openTool('layers'));
  };
  UI.toolTitle = function (id, l) { return this.skin === 'leap' && id === 'canvas' ? 'Format' : title.call(this, id, l); };
  // The layout dialog is defined in main.js, which loads last, so it is wrapped at start-up.
  const wrapDialog = () => { const layoutDialog = UI.layoutDialog; UI.layoutDialog = function () {
    layoutDialog.call(this);
    const body = $('#modal .mbody'); if (!body) return;
    const pick = (v) => { this.skin = v; this.closeModal(); toast(v === 'leap' ? 'Leap style is on.' : 'Classic style is on.'); };
    body.append(el('div', { class: 'sect' }, 'Style'), el('div', { class: 'choice' },
      el('button', { class: 'choicebtn' + (this.skin === 'leap' ? ' on' : ''), onclick: () => pick('leap') }, el('b', {}, 'Leap style'), el('small', {}, 'Videoleap-like: big + button, Mixer, Text, Audio, Filters, Adjust, Format')),
      el('button', { class: 'choicebtn' + (this.skin !== 'leap' ? ' on' : ''), onclick: () => pick('classic') }, el('b', {}, 'Classic style'), el('small', {}, 'The CapCut-like look from before'))),
      this.row('Bigger buttons and text', el('input', { type: 'checkbox', class: 'tog', checked: this.bigUI, onchange: (e) => { this.bigUI = e.target.checked; } })));
  }; };
})();

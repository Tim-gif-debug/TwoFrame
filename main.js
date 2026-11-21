// ===========================================================================
// Start-up. Fills the icon placeholders, adds a few small toolbar actions,
// then starts the app. If something breaks while starting, a plain error
// screen explains what happened instead of a blank page.
// ===========================================================================
Object.assign(UI, {
  cycleQuality() { const order = ['full', 'half', 'quarter']; App.setQuality(order[(order.indexOf(App.quality) + 1) % 3]); toast({ full: 'Preview: Full quality', half: 'Preview: Half (smoother)', quarter: 'Preview: Quarter (fastest)' }[App.quality]); },
  kfJump(dir) { const l = App.layer(); if (l) KF.jump(l, dir); else toast('Select a clip first.'); },
  kfToggle() { const l = App.layer(); if (!l) { toast('Select a clip to add a keyframe.'); return; } KF.toggleTransform(l); this.refresh(); },
  stepFrames(n) { if (Player.playing) Player.pause(); App.setTime(App.time + n / App.project.fps); },
  // Phone: hide the timeline and toolbar to see the preview bigger.
  togglePreviewOnly() { document.body.classList.toggle('preview-only'); requestAnimationFrame(() => this.onResize()); },
  layoutDialog() {
    const cur = Layout.override || 'auto';
    const pick = (v) => { Layout.override = v; this.closeModal(); toast(v === 'auto' ? 'Layout follows your device.' : `Using the ${v === 'desktop' ? 'computer' : 'phone'} layout.`); };
    this.modal('Layout', el('div', {},
      el('p', { class: 'hint' }, `This device looks like a ${Layout.device}. TwoFrame picks a layout to match, or you can choose one.`),
      el('div', { class: 'choice' }, [['auto', 'Automatic', 'Match this device'], ['desktop', 'Computer', 'Panels and a big timeline'], ['mobile', 'Phone', 'Tool bar along the bottom']].map(([v, n, d]) =>
        el('button', { class: 'choicebtn' + (cur === v ? ' on' : ''), onclick: () => pick(v) }, el('b', {}, n), el('small', {}, d))))
    ), [['Close', () => this.closeModal()]]);
  }
});

function fillIcons(root = document) {
  for (const n of $$('[data-icon]', root)) { const svg = ICON[n.dataset.icon]; if (svg && !n.querySelector('svg')) n.insertAdjacentHTML('afterbegin', svg); }
}

function showFatal(title, detail) {
  let s = $('#fatal');
  if (!s) { s = el('div', { id: 'fatal' }); document.body.appendChild(s); }
  s.innerHTML = '';
  s.append(el('div', { class: 'fatalbox' },
    el('h2', {}, title), el('p', {}, detail),
    el('p', { class: 'hint' }, 'Try reloading the page. On iPhone, open TwoFrame in Safari (not inside another app). If it keeps happening, take a screenshot of this message.'),
    el('button', { class: 'btn primary', onclick: () => location.reload() }, 'Reload')));
}

let booted = false;
window.addEventListener('error', (e) => {
  if (!booted) showFatal('TwoFrame couldn’t start', (e.error && e.error.message) || e.message || 'Unknown error');
  else console.warn(e.error || e.message);
});
window.addEventListener('unhandledrejection', (e) => {
  const msg = (e.reason && e.reason.message) || String(e.reason || '');
  if (!booted) showFatal('TwoFrame couldn’t start', msg);
  else { console.warn(e.reason); if (msg && !/abort/i.test(msg)) toast('Something went wrong: ' + msg, 5000); }
});

(async () => {
  fillIcons();
  const test = document.createElement('canvas');
  if (!test.getContext('webgl2')) { showFatal('This browser can’t run TwoFrame', 'TwoFrame needs WebGL 2 for its effects. Use a recent Safari, Chrome, Edge or Firefox.'); return; }
  try { await App.init(); booted = true; }
  catch (e) { console.error(e); showFatal('TwoFrame couldn’t start', e.message || String(e)); }
})();

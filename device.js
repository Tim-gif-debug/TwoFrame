// ===========================================================================
// Device detection and the two layouts.
//
// Phone, tablet or computer is decided from the pointer type
// (pointer: coarse = finger), touch points, the screen's short side and
// the window width, never from the browser name alone. The layout switches
// live on resize and rotation without touching the project.
//   desktop layout: media panel | preview | inspector, timeline below
//   mobile layout:  preview, timeline, icon toolbar, slide-up sheets
// Settings › Layout can force either one.
// ===========================================================================
const Layout = {
  mode: null, device: null,
  get override() { try { return localStorage.getItem('tf.layout') || 'auto'; } catch (e) { return 'auto'; } },
  set override(v) { try { localStorage.setItem('tf.layout', v); } catch (e) { } this.apply(); },
  detect() {
    const coarse = matchMedia('(pointer: coarse)').matches;
    const touch = (navigator.maxTouchPoints || 0) > 0;
    const short = Math.min(screen.width, screen.height), vw = innerWidth;
    let device = 'computer';
    if (coarse || (touch && short < 900)) device = short < 600 ? 'phone' : 'tablet';
    let mode = device === 'phone' ? 'mobile' : device === 'tablet' ? (vw >= 1000 ? 'desktop' : 'mobile') : (vw >= 860 ? 'desktop' : 'mobile');
    if (this.override === 'desktop') mode = 'desktop';
    if (this.override === 'mobile') mode = 'mobile';
    return { device, mode, landscape: matchMedia('(orientation: landscape)').matches };
  },
  apply() {
    const d = this.detect(), changed = d.mode !== this.mode;
    this.mode = d.mode; this.device = d.device;
    document.body.classList.toggle('lay-desktop', d.mode === 'desktop');
    document.body.classList.toggle('lay-mobile', d.mode === 'mobile');
    document.body.dataset.device = d.device;
    document.body.classList.toggle('landscape', d.landscape);
    if (changed && typeof UI !== 'undefined' && UI.onLayoutChange) UI.onLayoutChange();
  },
  init() {
    // Saved panel sizes for the desktop layout.
    try { for (const k of ['left', 'right', 'tl']) { const v = localStorage.getItem('tf.size.' + k); if (v) document.documentElement.style.setProperty('--' + k + '-size', v + 'px'); } } catch (e) { }
    let t = 0;
    const later = () => { clearTimeout(t); t = setTimeout(() => { this.apply(); if (typeof UI !== 'undefined' && UI.onResize) UI.onResize(); }, 120); };
    addEventListener('resize', later);
    addEventListener('orientationchange', later);
    matchMedia('(pointer: coarse)').addEventListener?.('change', later);
    // Stop Safari's double-tap zoom and pinch-zoom of the whole page inside the editor.
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    let lastTouch = 0;
    document.addEventListener('touchend', (e) => { const now = Date.now(); if (now - lastTouch < 300 && !e.target.closest('input,textarea,select')) e.preventDefault(); lastTouch = now; }, { passive: false });
    this.apply();
  },
  // Drag handles between desktop panels.
  initResizers() {
    for (const h of $$('[data-res]')) {
      h.addEventListener('pointerdown', (e) => {
        e.preventDefault(); h.setPointerCapture(e.pointerId);
        const k = h.dataset.res, root = document.documentElement;
        const start = { x: e.clientX, y: e.clientY, v: parseFloat(getComputedStyle(root).getPropertyValue('--' + k + '-size')) || 300 };
        const move = (ev) => {
          let v = k === 'tl' ? start.v - (ev.clientY - start.y) : k === 'left' ? start.v + (ev.clientX - start.x) : start.v - (ev.clientX - start.x);
          v = clamp(v, k === 'tl' ? 140 : 220, k === 'tl' ? innerHeight * 0.65 : innerWidth * 0.4);
          root.style.setProperty('--' + k + '-size', v + 'px');
          UI.onResize && UI.onResize();
        };
        const up = () => { h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); try { localStorage.setItem('tf.size.' + k, parseFloat(getComputedStyle(root).getPropertyValue('--' + k + '-size'))); } catch (e) { } };
        h.addEventListener('pointermove', move); h.addEventListener('pointerup', up);
      });
    }
  }
};

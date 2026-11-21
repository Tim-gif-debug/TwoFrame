// ===========================================================================
// Fonts: built-in system stacks, Google Fonts loaded on demand, and fonts the
// user uploads (.ttf / .otf), which are saved in the browser for next time.
// ===========================================================================
const FONT_STACKS = {
  'Sans': 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  'Serif': 'Georgia, "Times New Roman", serif',
  'Mono': 'ui-monospace, Menlo, Consolas, monospace',
  'Rounded': 'ui-rounded, "SF Pro Rounded", "Arial Rounded MT Bold", system-ui, sans-serif',
  'Impact': 'Impact, "Arial Black", "Helvetica Neue", sans-serif',
  'Comic': '"Comic Sans MS", "Chalkboard SE", "Comic Neue", cursive',
  'Condensed': '"Arial Narrow", "Helvetica Neue Condensed", "Roboto Condensed", sans-serif',
  'Script': '"Snell Roundhand", "Brush Script MT", "Segoe Script", cursive'
};

// Google Fonts. Families with several weights list them so bold looks right.
const GOOGLE_FONTS = {
  'Inter': '400;700;900', 'Roboto': '400;700;900', 'Montserrat': '400;700;900', 'Poppins': '400;700;900', 'Oswald': '400;700',
  'Raleway': '400;700;900', 'Lato': '400;700;900', 'Nunito': '400;700;900', 'Rubik': '400;700;900', 'Kanit': '400;700;900',
  'Playfair Display': '400;700;900', 'Merriweather': '400;700;900', 'Space Grotesk': '400;700', 'Barlow Condensed': '400;700;900',
  'Teko': '400;700', 'Rajdhani': '400;700', 'Cinzel': '400;700;900', 'Fredoka': '400;700', 'Comfortaa': '400;700',
  'Bebas Neue': '', 'Anton': '', 'Archivo Black': '', 'Abril Fatface': '', 'Alfa Slab One': '', 'Bangers': '', 'Black Ops One': '',
  'Bowlby One': '', 'Bungee': '', 'Caveat': '', 'Creepster': '', 'Dancing Script': '', 'DM Serif Display': '', 'Great Vibes': '',
  'Lobster': '', 'Luckiest Guy': '', 'Monoton': '', 'Orbitron': '', 'Pacifico': '', 'Permanent Marker': '', 'Press Start 2P': '',
  'Righteous': '', 'Rubik Mono One': '', 'Russo One': '', 'Satisfy': '', 'Shadows Into Light': '', 'Special Elite': '',
  'Staatliches': '', 'Titan One': '', 'VT323': '', 'Audiowide': '', 'Bungee Shade': '', 'Fascinate': '', 'Faster One': '', 'Rampart One': ''
};

const Fonts = {
  custom: new Set(),
  loading: new Map(),
  // CSS font-family string for a font name.
  css(name) { return FONT_STACKS[name] || `"${name}", system-ui, sans-serif`; },
  all() { return [...Object.keys(FONT_STACKS), ...Array.from(this.custom), ...Object.keys(GOOGLE_FONTS)]; },
  isReady(name) { return !!FONT_STACKS[name] || (this.loading.get(name) === true); },
  // Starts loading a font if needed. Returns a promise that resolves when
  // it can be drawn (or after a timeout, so a blocked network can't hang).
  ensure(name) {
    if (!name || FONT_STACKS[name]) return Promise.resolve();
    const st = this.loading.get(name);
    if (st === true) return Promise.resolve();
    if (st) return st;
    const p = (async () => {
      if (!this.custom.has(name) && name in GOOGLE_FONTS) {
        const w = GOOGLE_FONTS[name];
        const href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(name).replace(/%20/g, '+')}${w ? ':wght@' + w : ''}&display=swap`;
        if (!document.querySelector(`link[data-font="${name}"]`)) document.head.appendChild(el('link', { rel: 'stylesheet', href, 'data-font': name }));
      }
      try {
        await withTimeout(Promise.all([document.fonts.load(`400 48px "${name}"`), document.fonts.load(`700 48px "${name}"`)]), 6000);
      } catch (e) { }
      this.loading.set(name, true);
      // Text drawn with a fallback font gets redrawn now that the real one is here.
      for (const r of Runtime.map.values()) r.texKey = '';
      if (typeof App !== 'undefined') App.requestRender();
    })();
    this.loading.set(name, p);
    return p;
  },
  // Waits for every font a project uses (called before export).
  async ready(project) {
    const names = new Set();
    const walk = (layers) => { for (const l of layers) { if (l.text && l.text.font) names.add(l.text.font); if (l.caption && l.caption.font) names.add(l.caption.font); if (l.children) walk(l.children); } };
    walk(project.layers);
    await Promise.all(Array.from(names).map(n => this.ensure(n)));
  },
  async addFile(file) {
    const name = file.name.replace(/\.(ttf|otf|woff2?)$/i, '').replace(/[^\w\- ]+/g, ' ').trim() || 'Custom Font';
    const face = new FontFace(name, await file.arrayBuffer());
    await face.load();
    document.fonts.add(face);
    this.custom.add(name); this.loading.set(name, true);
    await Store.put('media', 'font:' + name, { id: 'font:' + name, type: 'font', name, blob: file });
    return name;
  },
  async loadSaved() {
    for (const r of await Store.all('media')) {
      if (r.value && r.value.type === 'font') {
        try { const face = new FontFace(r.value.name, await r.value.blob.arrayBuffer()); await face.load(); document.fonts.add(face); this.custom.add(r.value.name); this.loading.set(r.value.name, true); } catch (e) { }
      }
    }
  }
};

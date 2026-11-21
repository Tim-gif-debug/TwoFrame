// ===========================================================================
// Caption add-ons:
//   line-breaking rules, a custom vocabulary that fixes near-miss spellings,
//   text-based editing (delete words to cut the video), one-tap removal of
//   filler words and long silences, SRT / VTT import and export, and moving
//   captions into an app's safe zone.
// Caption times are stored relative to the caption layer's start.
// ===========================================================================
const FILLERS = ['um', 'umm', 'uhm', 'uh', 'uhh', 'er', 'erm', 'ah', 'hmm', 'mm', 'mhm'];
Object.assign(Captions, {
  rules() { let r = {}; try { r = JSON.parse(localStorage.getItem('tf.caprules')) || {}; } catch (e) { } return { maxChars: 22, maxWords: 5, minDur: 0.6, breakPunct: true, noOrphan: true, ...r }; },
  saveRules(r) { try { localStorage.setItem('tf.caprules', JSON.stringify(r)); } catch (e) { } },
  vocab() { try { return (localStorage.getItem('tf.vocab') || '').split('\n').map(s => s.trim()).filter(Boolean); } catch (e) { return []; } },
  norm(s) { return s.toLowerCase().replace(/[^a-z0-9' ]+/g, ''); },
  lev(a, b) { const m = a.length, n = b.length; if (!m) return n; if (!n) return m; let prev = Array.from({ length: n + 1 }, (_, i) => i); for (let i = 1; i <= m; i++) { const cur = [i]; for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; } return prev[n]; },
  allWords(lines) { return lines.flatMap(L => L.words.map(w => ({ ...w }))); },
  // Replaces words that are close to a vocabulary term with the term's exact spelling.
  fixVocab(lines, terms = this.vocab()) {
    if (!terms.length) return lines;
    const ws = this.allWords(lines); let fixed = 0;
    for (const term of terms.slice().sort((a, b) => b.length - a.length)) {
      const tw = term.split(/\s+/), tn = this.norm(term).replace(/ /g, ''); if (tn.length < 3) continue;
      const tol = tn.length < 5 ? 1 : Math.max(1, Math.floor(tn.length * 0.28));
      for (const n of [tw.length, tw.length + 1, Math.max(1, tw.length - 1)]) for (let i = 0; i + n <= ws.length; i++) {
        const win = ws.slice(i, i + n); if (win.some(w => w._v)) continue;
        const cn = this.norm(win.map(w => w.w).join('')).replace(/ /g, ''); if (Math.abs(cn.length - tn.length) > tol) continue;
        const d = cn === tn ? 0 : this.lev(cn, tn); if (d > tol || (d > 0 && cn[0] !== tn[0])) continue;
        const tail = (/[.,!?;:]+$/.exec(win[n - 1].w) || [''])[0], s = win[0].s, e = win[n - 1].e, joined = win.map(w => w.w).join(' ');
        const rep = tw.map((w, k) => ({ w: w + (k === tw.length - 1 ? tail : ''), s: s + (e - s) * k / tw.length, e: s + (e - s) * (k + 1) / tw.length, _v: true }));
        if (joined.replace(/[.,!?;:]+$/, '') !== term) fixed++;
        ws.splice(i, n, ...rep); i += rep.length - 1;
      }
    }
    this.lastFixed = fixed;
    for (const w of ws) delete w._v;
    return this.relayoutWords(ws, this.rules());
  },
  // Builds captions from words using the line-breaking rules.
  relayoutWords(ws, r) {
    const lines = []; let cur = [];
    const chars = (a) => a.reduce((n, w) => n + w.w.length + 1, -1), flush = () => { if (cur.length) { lines.push({ s: cur[0].s, e: cur[cur.length - 1].e, words: cur }); cur = []; } };
    for (const w of ws) {
      const prev = cur[cur.length - 1];
      if (prev && (w.s - prev.e > 0.7 || cur.length >= r.maxWords || chars(cur) + 1 + w.w.length > r.maxChars)) flush();
      cur.push({ w: w.w, s: w.s, e: w.e });
      if (r.breakPunct && (/[.!?]$/.test(w.w) || (/[,;:]$/.test(w.w) && chars(cur) >= r.maxChars * 0.6))) flush();
    }
    flush();
    if (r.noOrphan) for (let i = lines.length - 1; i >= 0; i--) {
      const L = lines[i]; if (L.words.length !== 1) continue; const P = lines[i - 1], Nx = lines[i + 1];
      if (P && L.s - P.e < 0.5 && chars(P.words) + 1 + L.words[0].w.length <= r.maxChars * 1.3 && !/[.!?]$/.test(P.words[P.words.length - 1].w)) { P.words.push(L.words[0]); P.e = L.e; lines.splice(i, 1); }
      else if (Nx && Nx.s - L.e < 0.5 && chars(Nx.words) + 1 + L.words[0].w.length <= r.maxChars * 1.3 && !/[.!?]$/.test(L.words[0].w)) { Nx.words.unshift(L.words[0]); Nx.s = L.s; lines.splice(i, 1); }
    }
    lines.forEach((L, i) => { const nx = lines[i + 1]; if (L.e - L.s < r.minDur) L.e = Math.min(L.s + r.minDur, nx ? nx.s : L.s + r.minDur); });
    return lines;
  },
  relayout(l) { const r = this.rules(); App._label = 'Re-break captions'; App.change(() => { l.caption.lines = this.relayoutWords(this.allWords(l.caption.lines), r); }); },
  // Cuts time ranges (in caption time) out of the video and the captions, as one undo step.
  cutRanges(l, ranges, label = 'Cut by text') {
    ranges = ranges.filter(r => r.e - r.s > 0.02).sort((a, b) => b.s - a.s); if (!ranges.length) return 0;
    const n0 = App.undoStack.length; let cut = 0;
    for (const r of ranges) {
      App.rippleCut(l.start + r.s, l.start + r.e, (x) => x.id === l.id);
      const d = r.e - r.s; cut += d;
      for (const L of l.caption.lines) { L.words = L.words.filter(w => !(w.s >= r.s - 1e-3 && w.e <= r.e + 1e-3)); for (const w of L.words) if (w.s >= r.e - 1e-3) { w.s -= d; w.e -= d; } if (L.words.length) { L.s = L.words[0].s; L.e = L.words[L.words.length - 1].e; } }
      l.caption.lines = l.caption.lines.filter(L => L.words.length);
    }
    App.change(p => { App.fitDuration(p); l.dur = Math.max(0.5, p.duration - l.start); }, '');
    if (App.undoStack.length > n0 + 1) { App.undoStack.splice(n0 + 1); App.undoLabels.splice(n0 + 1); } App.undoLabels[n0] = label;
    App.setTime(Math.min(App.time, App.project.duration)); UI.refresh();
    return cut;
  },
  removeWords(l, refs, cutVideo) {
    if (!refs.length) return;
    if (cutVideo) { const sorted = refs.slice().sort((a, b) => a.s - b.s), ranges = []; for (const w of sorted) { const last = ranges[ranges.length - 1]; if (last && w.s - last.e < 0.25) last.e = w.e; else ranges.push({ s: w.s, e: w.e }); } return this.cutRanges(l, ranges); }
    App._label = 'Remove words'; const set = new Set(refs);
    App.change(() => { for (const L of l.caption.lines) L.words = L.words.filter(w => !set.has(w)); l.caption.lines = l.caption.lines.filter(L => L.words.length); for (const L of l.caption.lines) { L.s = L.words[0].s; L.e = Math.max(L.e, L.words[L.words.length - 1].e); } });
    UI.refresh();
  },
  fillerWords(l) { return l.caption.lines.flatMap(L => L.words).filter(w => FILLERS.includes(this.norm(w.w))); },
  silences(l, minGap = 0.8, pad = 0.15) { const ws = l.caption.lines.flatMap(L => L.words), out = []; for (let i = 1; i < ws.length; i++) if (ws[i].s - ws[i - 1].e > minGap) out.push({ s: ws[i - 1].e + pad, e: ws[i].s - pad }); return out; },
  // ---- subtitle files ----
  parseSubs(text) {
    const tm = (s) => { const m = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/.exec(s); return m ? (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4].padEnd(3, '0')) / 1000 : null; };
    const lines = [];
    for (const block of text.replace(/\r/g, '').split(/\n\s*\n/)) {
      const rows = block.split('\n'), ti = rows.findIndex(r => r.includes('-->')); if (ti < 0) continue;
      const [a, b] = rows[ti].split('-->'), s = tm(a), e = tm(b), words = rows.slice(ti + 1).join(' ').replace(/<[^>]+>/g, '').trim().split(/\s+/).filter(Boolean);
      if (s == null || e == null || !words.length) continue;
      lines.push({ s, e, words: words.map((w, k) => ({ w, s: s + (e - s) * k / words.length, e: s + (e - s) * (k + 1) / words.length })) });
    }
    return lines;
  },
  toVTT(l) { const f = (t) => { t = Math.max(0, t + l.start); const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = Math.floor(t % 60), ms = Math.round((t % 1) * 1000); return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(Math.min(999, ms)).padStart(3, '0')}`; };
    return 'WEBVTT\n\n' + l.caption.lines.map(L => `${f(L.s)} --> ${f(L.e)}\n${L.words.map(w => w.w).join(' ')}\n`).join('\n'); },
  importSubs() { UI.pickFiles('.srt,.vtt,text/plain,text/vtt', async ([f]) => { const lines = this.parseSubs(await f.text()); if (!lines.length) { toast('No captions found in that file.'); return; } const l = this.makeLayer(lines); UI.refresh(); toast(`${lines.length} captions imported.`); if (l) { App.sel = l.id; UI.refresh(); } }); },
  toSafeZone(l) {
    const p = App.project, z = SAFE_ZONES[UI.guides.zone] || SAFE_ZONES.tiktok, h = (l.text.size || 60) * 1.5;
    App._label = 'Move captions to safe zone';
    App.change(() => { l.transform.y = Math.round(p.height * (1 - z.b) - h / 2 - p.height * 0.01); l.transform.x = Math.round(p.width * (z.l + (1 - z.l - z.r) / 2)); if (l.keys) { delete l.keys['transform.x']; delete l.keys['transform.y']; } l.text.boxPct = 0; });
    UI.refresh(); toast(`Captions moved clear of the ${z.name} buttons.`);
  }
});
// New caption tracks get the vocabulary fixes and line rules applied.
(() => {
  const make = Captions.makeLayer;
  Captions.makeLayer = function (lines, styleName) { try { lines = this.vocab().length ? this.fixVocab(lines) : this.relayoutWords(this.allWords(lines), this.rules()); } catch (e) { console.warn(e); } return make.call(this, lines, styleName); };
  const gen = UI.panel_captions, edit = UI.panel_captionEdit;
  UI.panel_captions = function (body) {
    gen.call(this, body);
    const r = Captions.rules(), num = (k, label, min, max, step) => this.row(label, el('input', { type: 'number', min, max, step, value: r[k], onchange: (e) => { r[k] = clamp(+e.target.value, min, max); Captions.saveRules(r); } })),
      tog = (k, label) => this.row(label, el('input', { type: 'checkbox', class: 'tog', checked: r[k], onchange: (e) => { r[k] = e.target.checked; Captions.saveRules(r); } }));
    const voc = el('textarea', { rows: 4, spellcheck: 'false', style: { width: '100%' }, placeholder: 'One name or term per line', onchange: (e) => { try { localStorage.setItem('tf.vocab', e.target.value); } catch (er) { } } }); voc.value = Captions.vocab().join('\n'); voc.addEventListener('keydown', (e) => e.stopPropagation());
    body.append(el('div', { class: 'sect' }, 'Line breaking'), num('maxChars', 'Max characters', 6, 80, 1), num('maxWords', 'Max words', 1, 20, 1), num('minDur', 'Shortest time on screen (s)', 0.1, 5, 0.1), tog('breakPunct', 'Break at punctuation'), tog('noOrphan', 'No single word alone'),
      el('div', { class: 'sect' }, 'Custom vocabulary'), voc, el('p', { class: 'hint' }, 'Names and terms to spell exactly this way. After transcribing, words that sound close are corrected to match.'),
      el('div', { class: 'sect' }, 'Subtitle files'), el('div', { class: 'btnrow' }, el('button', { class: 'btn sm', onclick: () => Captions.importSubs() }, 'Import .srt or .vtt')));
  };
  UI.panel_captionEdit = function (body, l) {
    const sel = this._capSel = (this._capSel || []).filter(w => l.caption.lines.some(L => L.words.includes(w)));
    const words = l.caption.lines.flatMap(L => L.words), now = App.time - l.start;
    const doc = el('div', { class: 'transcript' });
    words.forEach((w, i) => doc.appendChild(el('span', { class: 'tw' + (sel.includes(w) ? ' sel' : '') + (now >= w.s && now < w.e ? ' now' : '') + (FILLERS.includes(Captions.norm(w.w)) ? ' filler' : ''), onclick: (e) => {
      if ((e.shiftKey || this._capRange) && sel.length && !sel.includes(w)) { const a = words.indexOf(sel[0]); this._capSel = words.slice(Math.min(a, i), Math.max(a, i) + 1); }
      else if (sel.includes(w)) this._capSel = sel.filter(x => x !== w);
      else if (this.multi) this._capSel = [...sel, w];
      else this._capSel = [w];
      App.setTime(l.start + w.s + 0.001); this.refreshPanel(); } }, w.w + ' ')));
    const fill = Captions.fillerWords(l), sil = Captions.silences(l);
    body.append(el('div', { class: 'sect' }, 'Transcript (edit the video by its words)'), doc,
      el('div', { class: 'btnrow' },
        el('button', { class: 'btn sm' + (this._capRange ? ' on' : ''), onclick: () => { this._capRange = !this._capRange; this.refreshPanel(); } }, 'Range select'),
        sel.length ? el('button', { class: 'btn sm danger', onclick: () => { const d = Captions.removeWords(l, sel, true); this._capSel = []; toast(`Cut ${(d || 0).toFixed(1)} s from the video.`); } }, `Delete ${sel.length} word${sel.length === 1 ? '' : 's'} and cut video`) : null,
        sel.length ? el('button', { class: 'btn sm', onclick: () => { Captions.removeWords(l, sel, false); this._capSel = []; } }, 'Hide from captions only') : null,
        sel.length === 1 ? el('button', { class: 'btn sm', onclick: () => this.ask('Fix this word', sel[0].w, (v) => { App._label = 'Fix caption word'; App.change(() => { sel[0].w = v; }); this.refresh(); }) }, 'Fix spelling') : null),
      el('div', { class: 'btnrow' },
        el('button', { class: 'btn sm', onclick: () => { if (!fill.length) { toast('No filler words found.'); return; } const d = Captions.removeWords(l, fill, true); toast(`Removed ${fill.length} filler word${fill.length === 1 ? '' : 's'} (${(d || 0).toFixed(1)} s).`); } }, `Remove ums and uhs (${fill.length})`),
        el('button', { class: 'btn sm', onclick: () => { if (!sil.length) { toast('No long silences found.'); return; } const d = Captions.cutRanges(l, sil, 'Remove silences'); toast(`Removed ${sil.length} silence${sil.length === 1 ? '' : 's'} (${d.toFixed(1)} s).`); } }, `Remove silences (${sil.length})`),
        el('button', { class: 'btn sm', onclick: () => { Captions.relayout(l); this.refresh(); } }, 'Re-break lines'),
        el('button', { class: 'btn sm', onclick: () => { const fixed = Captions.fixVocab(l.caption.lines); App._label = 'Apply vocabulary'; App.change(() => { l.caption.lines = fixed; }); this.refresh(); toast(`${Captions.lastFixed || 0} word(s) corrected from your vocabulary.`); } }, 'Apply vocabulary'),
        el('button', { class: 'btn sm', onclick: () => Captions.toSafeZone(l) }, 'Move into safe zone'),
        el('button', { class: 'btn sm', onclick: () => saveBlob(new Blob([Captions.toVTT(l)], { type: 'text/vtt' }), (App.project.name || 'captions').replace(/[^\w\- ]+/g, '') + '.vtt') }, 'Save .vtt')),
      el('p', { class: 'hint' }, 'Tap a word to jump there. Turn on Range select and tap a second word to select everything between. Deleting words removes that part of every track and closes the gap.'),
      el('div', { class: 'sect' }, 'Lines'));
    edit.call(this, body, l);
  };
})();

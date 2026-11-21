// ---- Hold schedule (same math as the After Effects plugin) ---------------
function holdStarts(v, n, extra) {
  const L = Math.max(1, Math.round(v.holdLength)), off = Math.round(v.offset || 0);
  const starts = [];
  if (!v.random || v.randomness <= 0) {
    const i = Math.floor((n - off) / L);
    for (let k = 0; k <= extra; k++) starts.push(off + (i - k) * L);
    return starts;
  }
  const seed = Math.round(v.seed) | 0;
  const len = (i) => clamp(Math.floor(L + v.randomness * L * (2 * hash01(seed, i) - 1) + 0.5), 1, 48);
  let i = 0, B = off;
  if (n >= B) { let guard = 0; for (;;) { const l = len(i); if (n < B + l || ++guard > 2e6) break; B += l; i++; } }
  else { while (n < B) { i--; B -= len(i); } }
  starts.push(B);
  for (let k = 1; k <= extra; k++) starts.push(starts[k - 1] - len(i - k));
  return starts;
}


// Small histogram of the selected property, with the two subsets shaded.

import { G_BLUE, G_RED } from './selection.js';

const NBINS = 60;

// values: transformed values (display units, log10 if requested) for galaxies in `order`
// order:  ranked indices of valid galaxies (ascending)
export function drawHistogram(canvas, { values, order, groups, colors, lowCut, highCut, xLabel }) {
  const parent = canvas.parentElement;
  const w = parent.clientWidth, h = canvas.clientHeight || 110;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  canvas.style.width = w + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const m = order.length;
  if (!m) return;

  // Histogram range: 0.5th to 99.5th percentile, outliers piled into the edge bins
  let lo = values[order[Math.floor(0.005 * (m - 1))]];
  let hi = values[order[Math.ceil(0.995 * (m - 1))]];
  if (!(hi > lo)) { lo = values[order[0]]; hi = values[order[m - 1]]; }
  if (!(hi > lo)) { lo -= 0.5; hi += 0.5; }

  const tot = new Float64Array(NBINS), nb = new Float64Array(NBINS), nr = new Float64Array(NBINS);
  for (let k = 0; k < m; k++) {
    const i = order[k];
    let b = Math.floor(((values[i] - lo) / (hi - lo)) * NBINS);
    b = b < 0 ? 0 : b >= NBINS ? NBINS - 1 : b;
    tot[b]++;
    if (groups[i] === G_BLUE) nb[b]++;
    else if (groups[i] === G_RED) nr[b]++;
  }
  let maxc = 0;
  for (let b = 0; b < NBINS; b++) maxc = Math.max(maxc, tot[b]);

  const pad = { l: 4, r: 4, t: 4, b: 18 };
  const pw = w - pad.l - pad.r, ph = h - pad.t - pad.b;
  const bw = pw / NBINS;
  const yOf = (c) => pad.t + ph - (c / maxc) * ph;
  for (let b = 0; b < NBINS; b++) {
    const x = pad.l + b * bw;
    ctx.fillStyle = '#d4d4d4';
    ctx.fillRect(x, yOf(tot[b]), Math.max(1, bw - 1), (tot[b] / maxc) * ph);
    if (nb[b]) { ctx.fillStyle = colors.low; ctx.fillRect(x, yOf(nb[b]), Math.max(1, bw - 1), (nb[b] / maxc) * ph); }
    if (nr[b]) { ctx.fillStyle = colors.high; ctx.fillRect(x, yOf(nr[b]), Math.max(1, bw - 1), (nr[b] / maxc) * ph); }
  }
  const xOf = (v) => pad.l + ((v - lo) / (hi - lo)) * pw;
  ctx.strokeStyle = '#222'; ctx.lineWidth = 1; ctx.setLineDash([3, 2]);
  for (const c of [lowCut, highCut]) {
    if (c === null || !Number.isFinite(c)) continue;
    const x = Math.min(Math.max(xOf(c), pad.l), pad.l + pw);
    ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, pad.t + ph); ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.strokeStyle = '#888';
  ctx.beginPath(); ctx.moveTo(pad.l, pad.t + ph + 0.5); ctx.lineTo(pad.l + pw, pad.t + ph + 0.5); ctx.stroke();
  ctx.fillStyle = '#555';
  ctx.font = '11px system-ui, sans-serif';
  ctx.textBaseline = 'bottom';
  ctx.textAlign = 'left'; ctx.fillText(fmt(lo), pad.l, h - 2);
  ctx.textAlign = 'right'; ctx.fillText(fmt(hi), pad.l + pw, h - 2);
  ctx.textAlign = 'center'; ctx.fillText(xLabel, pad.l + pw / 2, h - 2);
}

function fmt(v) {
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-2 || a >= 1e5)) return v.toExponential(2);
  return v.toPrecision(3);
}

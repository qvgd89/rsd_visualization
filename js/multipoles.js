// Power spectrum multipole panel.
//
// Reads pre-computed multipoles on a grid of (alpha_h, alpha_s) from a JSON file
// (format documented in tools/make_mock_multipoles.py), interpolates them to the
// current slider values with tensor-product natural cubic splines, and plots
// k * P_l(k): measurements as points, the first model as a solid line and the
// second model as a dashed line.

import { niceTicks } from './plot.js';

const MARGIN = { left: 62, right: 12, top: 10, bottom: 42 };
const GAP = 34;  // vertical space between stacked subplots (holds the upper x tick labels)

// ---------------------------------------------------------------------------
// Interpolation
// ---------------------------------------------------------------------------

// Weights w_j such that the natural cubic spline through (xs_j, y_j), evaluated at
// x, equals sum_j w_j y_j. x is clamped to the grid range.
export function splineWeights(xs, x) {
  const n = xs.length;
  const w = new Float64Array(n);
  if (n === 1) { w[0] = 1; return w; }
  x = Math.min(Math.max(x, xs[0]), xs[n - 1]);
  let i = 0;
  while (i < n - 2 && x > xs[i + 1]) i++;
  const h = new Float64Array(n - 1);
  for (let j = 0; j < n - 1; j++) h[j] = xs[j + 1] - xs[j];
  if (n === 2) {
    const t = (x - xs[0]) / h[0];
    w[0] = 1 - t; w[1] = t;
    return w;
  }
  const a = xs[i + 1] - x, b = x - xs[i], hi = h[i];
  for (let m = 0; m < n; m++) {
    // second derivatives M of the spline through the unit vector e_m (Thomas algorithm)
    const M = new Float64Array(n);
    const nInt = n - 2;
    const sub = new Float64Array(nInt), diag = new Float64Array(nInt), sup = new Float64Array(nInt), rhs = new Float64Array(nInt);
    const y = (j) => (j === m ? 1 : 0);
    for (let r = 0; r < nInt; r++) {
      const j = r + 1;
      sub[r] = h[j - 1]; diag[r] = 2 * (h[j - 1] + h[j]); sup[r] = h[j];
      rhs[r] = 6 * ((y(j + 1) - y(j)) / h[j] - (y(j) - y(j - 1)) / h[j - 1]);
    }
    for (let r = 1; r < nInt; r++) {
      const f = sub[r] / diag[r - 1];
      diag[r] -= f * sup[r - 1];
      rhs[r] -= f * rhs[r - 1];
    }
    for (let r = nInt - 1; r >= 0; r--) {
      M[r + 1] = (rhs[r] - (r < nInt - 1 ? sup[r] * M[r + 2] : 0)) / diag[r];
    }
    w[m] = (M[i] * a * a * a + M[i + 1] * b * b * b) / (6 * hi)
      + (y(i) / hi - (M[i] * hi) / 6) * a
      + (y(i + 1) / hi - (M[i + 1] * hi) / 6) * b;
  }
  return w;
}

// JSON.parse that also accepts the non-standard tokens Infinity, -Infinity and NaN
// written by Python's json.dump (they become strings, converted to numbers later).
export function parseJsonLenient(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    const fixed = text.replace(/([\[,:]\s*)(-?Infinity|NaN)(?=\s*[,\]}])/g, '$1"$2"');
    return JSON.parse(fixed);
  }
}

const toNum = (v) => (v === null || v === undefined ? NaN : Number(v));

// Interpolate ys(xs) at x with a natural cubic spline, coping with non-finite values:
// exactly at a node the node value is returned (which may be +-Infinity); between two
// finite nodes the spline runs over the contiguous stretch of finite nodes around x;
// between two nodes with the same infinity that infinity is returned; otherwise next
// to a non-finite node the value is unknown and NaN is returned.
export function interpMasked(xs, ys, x) {
  const n = xs.length;
  x = Math.min(Math.max(x, xs[0]), xs[n - 1]);
  const tol = 1e-9 * ((xs[n - 1] - xs[0]) || 1);
  for (let j = 0; j < n; j++) if (Math.abs(x - xs[j]) <= tol) return ys[j];
  let i = 0;
  while (i < n - 2 && x > xs[i + 1]) i++;
  if (!Number.isFinite(ys[i]) || !Number.isFinite(ys[i + 1])) {
    // both neighbours the same infinity (e.g. a whole row of -Infinity): keep it
    return ys[i] === ys[i + 1] && !Number.isNaN(ys[i]) ? ys[i] : NaN;
  }
  let a = i, b = i + 1;
  while (a > 0 && Number.isFinite(ys[a - 1])) a--;
  while (b < n - 1 && Number.isFinite(ys[b + 1])) b++;
  const w = splineWeights(xs.slice(a, b + 1), x);
  let v = 0;
  for (let j = 0; j < w.length; j++) v += w[j] * ys[a + j];
  return v;
}

// 2D version on the (alpha_h, alpha_s) grid; grid[i_h * ns + i_s]
function interp2Masked(gh, gs, grid, ah, as) {
  const ns = gs.length;
  const rows = gh.map((_, i) => interpMasked(gs, Array.from(grid.subarray(i * ns, (i + 1) * ns)), as));
  return interpMasked(gh, rows, ah);
}

// Read a parameter grid given nested [i_h][i_s] or flat (alpha_s fastest)
function paramGrid(v, nh, ns, what) {
  const flat = Array.isArray(v[0]) ? v.flat() : v;
  if (flat.length !== nh * ns) throw new Error(`${what}: expected ${nh}×${ns} values, got ${flat.length}`);
  return Float64Array.from(flat, toNum);
}

// Flatten A[i_h][i_s][i_k] into a Float64Array, checking its shape
function flatten(A, nh, ns, nk, what) {
  if (!Array.isArray(A) || A.length !== nh) throw new Error(`${what}: expected ${nh} rows (alpha_h)`);
  const out = new Float64Array(nh * ns * nk);
  for (let i = 0; i < nh; i++) {
    if (A[i].length !== ns) throw new Error(`${what}[${i}]: expected ${ns} entries (alpha_s)`);
    for (let j = 0; j < ns; j++) {
      const row = A[i][j];
      if (row.length !== nk) throw new Error(`${what}[${i}][${j}]: expected ${nk} k values, got ${row.length}`);
      const off = (i * ns + j) * nk;
      for (let q = 0; q < nk; q++) out[off + q] = toNum(row[q]);
    }
  }
  return out;
}

function interpolate(flat, wh, ws, nk) {
  const nh = wh.length, ns = ws.length;
  const out = new Float64Array(nk);
  for (let i = 0; i < nh; i++) {
    if (wh[i] === 0) continue;
    for (let j = 0; j < ns; j++) {
      const w = wh[i] * ws[j];
      if (w === 0) continue;
      const off = (i * ns + j) * nk;
      for (let q = 0; q < nk; q++) out[q] += w * flat[off + q];
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------
export class MultipolePanel {
  // spectra: [{ key: 'P0', label: 'Monopole', short: 'ℓ = 0', ylabel }, ...], one subplot each
  // opts: { kRange: [k0, k1], shadeAbove, shadeLabel, params: [{ key, label, note }], styles }
  constructor(els, spectra, opts = {}) {
    this.els = els;               // { canvas, tip, legend, caption, badge, autoscale, params }
    this.spectra = spectra;
    this.opts = opts;
    this.ah = 1; this.as = 1;
    this.hoverK = -1;
    this._dirty = false;
    new ResizeObserver(() => this.request()).observe(els.canvas.parentElement);
    els.autoscale.addEventListener('change', () => this.request());
    this._bindHover();
  }

  load(json) {
    const ah = json.alpha_h, as = json.alpha_s, k = json.k;
    if (!ah || !as || !k) throw new Error('missing alpha_h, alpha_s or k');
    const nh = ah.length, ns = as.length;
    this.gridH = ah; this.gridS = as;
    this.json = json;
    // series: data first, then the models
    const mk = (src, kk, kind, idx) => {
      const nk = kk.length;
      const s = { label: src.label || (kind === 'data' ? 'Measurement' : `Model ${idx + 1}`), kind, idx, k: Float64Array.from(kk), nk, flat: {} };
      for (const sp of this.spectra) {
        if (src[sp.key]) s.flat[sp.key] = flatten(src[sp.key], nh, ns, nk, `${kind}.${sp.key}`);
      }
      return s;
    };
    this.series = [];
    if (json.data) this.series.push(mk(json.data, k, 'data', 0));
    // "models" may be a list of {label, ...} or an object keyed by model name
    // (the key is then the label); the first model is drawn solid, the second dashed.
    let models = json.models || [];
    if (!Array.isArray(models)) {
      if (typeof models !== 'object') throw new Error('"models" must be a list or an object');
      models = Object.entries(models).map(([name, m]) => ({ label: name, ...m, name }));
    }
    models.slice(0, 2).forEach((m, i) => {
      const s = mk(m, m.k || k, 'model', i);
      s.name = m.name;
      this.series.push(s);
    });
    const st = this.opts.styles || {};
    for (const s of this.series) {
      s.style = s.kind === 'data'
        ? { color: '#111', ...(st.data || {}) }
        : { color: '#555', dash: [], ...((st.models || {})[s.name] || (st.fallback || [])[s.idx] || {}) };
    }
    this.present = this.spectra.filter((sp) => this.series.some((s) => s.flat[sp.key]));

    // k range of the plot, and a fixed y range covering every grid point within it
    let kmax = 0;
    for (const s of this.series) kmax = Math.max(kmax, s.k[s.nk - 1]);
    this.kRange = this.opts.kRange || [0, kmax * 1.02];
    this.fixedY = {};
    for (const sp of this.present) {
      let ymin = 0, ymax = 0;
      for (const s of this.series) {
        const f = s.flat[sp.key];
        if (!f) continue;
        for (let t = 0; t < f.length; t++) {
          const kk = s.k[t % s.nk];
          if (kk < this.kRange[0] || kk > this.kRange[1]) continue;
          const v = kk * f[t];
          if (!Number.isFinite(v)) continue;
          if (v < ymin) ymin = v;
          if (v > ymax) ymax = v;
        }
      }
      this.fixedY[sp.key] = [ymin, ymax];
    }

    // fitted parameters on the grid
    this.params = [];
    for (const p of this.opts.params || []) {
      let v = json[p.key];
      if (v === undefined) for (const m of models) if (m[p.key] !== undefined) { v = m[p.key]; break; }
      if (v === undefined) continue;
      this.params.push({ ...p, grid: paramGrid(v, nh, ns, p.key) });
    }

    this._legend();
    this.els.badge.hidden = !json.mock;
    this.update(this.ah, this.as);
  }

  update(ah, as) {
    this.ah = ah; this.as = as;
    if (!this.series) return;
    const wh = splineWeights(this.gridH, ah);
    const ws = splineWeights(this.gridS, as);
    this.curves = this.series.map((s) => {
      const c = {};
      for (const sp of this.present) if (s.flat[sp.key]) c[sp.key] = interpolate(s.flat[sp.key], wh, ws, s.nk);
      return c;
    });
    this._showParams(ah, as);
    const outside = ah < this.gridH[0] || ah > this.gridH[this.gridH.length - 1] || as < this.gridS[0] || as > this.gridS[this.gridS.length - 1];
    const fmt = (v) => (Math.round(v * 100) / 100).toString();
    let cap = `α<sub>h</sub> = ${fmt(ah)}, α<sub>s</sub> = ${fmt(as)}. `;
    if (outside) cap += '<b>Outside the pre-computed grid: showing the nearest edge.</b> ';
    if (this.json.description) cap += escapeHtml(this.json.description);
    this.els.caption.innerHTML = cap;
    this.request();
  }

  _showParams(ah, as) {
    const el = this.els.params;
    if (!el) return;
    if (!this.params.length) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = this.params.map((p) => {
      const v = interp2Masked(this.gridH, this.gridS, p.grid, ah, as);
      let txt, title = '';
      if (Number.isFinite(v)) txt = v.toFixed(3);
      else if (v === Infinity) txt = '+∞';
      else if (v === -Infinity) txt = '−∞';
      else { txt = '—'; title = 'Not defined here: a neighbouring grid point is infinite or missing'; }
      return `<div class="param" title="${title}"><span class="param-label">${escapeHtml(p.label)}</span>` +
        `<span class="param-value">${txt}</span>` +
        (p.note ? `<span class="param-note">${escapeHtml(p.note)}${title ? ' · ' + title.toLowerCase() : ''}</span>` : '') + '</div>';
    }).join('');
  }

  _legend() {
    const items = this.series.map((s) => {
      const mark = s.kind === 'data'
        ? `<span class="lg-dot" style="background:${s.style.color}"></span>`
        : `<span class="lg-line ${s.style.dash && s.style.dash.length ? 'dashed' : ''}" style="border-color:${s.style.color}"></span>`;
      return `<span class="lg-item">${mark}${escapeHtml(s.label)}</span>`;
    });
    this.els.legend.innerHTML = `<div>${items.join('')}</div>`;
  }

  request() {
    if (this._dirty) return;
    this._dirty = true;
    requestAnimationFrame(() => { this._dirty = false; this.draw(); });
  }

  // Layout of the stacked subplots (one per spectrum), sharing the k axis
  _geometry() {
    const cv = this.els.canvas, parent = cv.parentElement;
    const w = parent.clientWidth, h = parent.clientHeight;
    const n = Math.max(1, this.present ? this.present.length : 1);
    const pw = Math.max(10, w - MARGIN.left - MARGIN.right);
    const ph = Math.max(10, (h - MARGIN.top - MARGIN.bottom - GAP * (n - 1)) / n);
    const [x0, x1] = this.kRange || [0, 1];
    const sx = (k) => MARGIN.left + ((k - x0) / (x1 - x0)) * pw;
    const subs = (this.present || []).map((sp, i) => {
      let [y0, y1] = this.fixedY[sp.key];
      if (this.els.autoscale.checked && this.curves) {
        y0 = 0; y1 = 0;
        this.series.forEach((s, si) => {
          const c = this.curves[si][sp.key];
          if (!c) return;
          for (let q = 0; q < s.nk; q++) {
            if (s.k[q] < x0 || s.k[q] > x1) continue;
            const v = s.k[q] * c[q];
            if (!Number.isFinite(v)) continue;
            if (v < y0) y0 = v; if (v > y1) y1 = v;
          }
        });
      }
      const pad = 0.06 * (y1 - y0 || 1);
      y0 -= pad; y1 += pad;
      const top = MARGIN.top + i * (ph + GAP);
      return { sp, top, y0, y1, sy: (v) => top + ph - ((v - y0) / (y1 - y0)) * ph };
    });
    return { w, h, pw, ph, x0, x1, sx, subs };
  }

  draw() {
    const cv = this.els.canvas, ctx = cv.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const g = this._geometry();
    cv.width = Math.round(g.w * dpr); cv.height = Math.round(g.h * dpr);
    cv.style.width = g.w + 'px'; cv.style.height = g.h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, g.w, g.h);
    if (!this.curves) return;
    const xt = niceTicks(g.x0, g.x1, Math.max(3, Math.floor(g.pw / 70)));
    g.subs.forEach((sub, i) => this._drawSub(ctx, g, sub, xt, i === 0, i === g.subs.length - 1));
  }

  _drawSub(ctx, g, sub, xt, isTop, isBottom) {
    const { sp, top } = sub, ph = g.ph, L = MARGIN.left, pw = g.pw;
    const font = (px) => `${px}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
    ctx.fillStyle = '#fff';
    ctx.fillRect(L, top, pw, ph);

    // grid lines and zero line
    const yt = niceTicks(sub.y0, sub.y1, Math.max(3, Math.floor(ph / 45)));
    ctx.strokeStyle = '#eee'; ctx.lineWidth = 1;
    for (const t of yt.ticks) { const y = Math.round(sub.sy(t)) + 0.5; ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + pw, y); ctx.stroke(); }
    if (sub.y0 < 0 && sub.y1 > 0) {
      ctx.strokeStyle = '#999';
      const y = Math.round(sub.sy(0)) + 0.5;
      ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + pw, y); ctx.stroke();
    }

    ctx.save();
    ctx.beginPath(); ctx.rect(L, top, pw, ph); ctx.clip();
    // models (lines) first, then data points on top; the later (dashed) model is
    // drawn over the earlier (solid) one so both stay visible where they coincide
    this.series.forEach((s, si) => {
      if (s.kind !== 'model') return;
      const c = this.curves[si][sp.key];
      if (!c) return;
      ctx.strokeStyle = s.style.color; ctx.lineWidth = 2; ctx.setLineDash(s.style.dash || []);
      ctx.beginPath();
      let pen = false;
      for (let q = 0; q < s.nk; q++) {
        const v = s.k[q] * c[q];
        if (!Number.isFinite(v)) { pen = false; continue; }
        const x = g.sx(s.k[q]), y = sub.sy(v);
        if (pen) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        pen = true;
      }
      ctx.stroke();
    });
    ctx.setLineDash([]);
    this.series.forEach((s, si) => {
      if (s.kind !== 'data') return;
      const c = this.curves[si][sp.key];
      if (!c) return;
      ctx.fillStyle = s.style.color; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
      for (let q = 0; q < s.nk; q++) {
        const v = s.k[q] * c[q];
        if (!Number.isFinite(v)) continue;
        ctx.beginPath();
        ctx.arc(g.sx(s.k[q]), sub.sy(v), 2.6, 0, 2 * Math.PI);
        ctx.fill(); ctx.stroke();
      }
    });
    // grey out the k range not used in the model fits
    const ks = this.opts.shadeAbove;
    if (ks !== undefined && ks < g.x1) {
      const xs = Math.max(L, g.sx(ks));
      ctx.fillStyle = 'rgba(232, 232, 232, 0.72)';
      ctx.fillRect(xs, top, L + pw - xs, ph);
      ctx.strokeStyle = '#aaa'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(Math.round(xs) + 0.5, top); ctx.lineTo(Math.round(xs) + 0.5, top + ph); ctx.stroke();
      ctx.setLineDash([]);
      if (this.opts.shadeLabel && isTop) {
        ctx.fillStyle = '#666'; ctx.font = font(11.5);
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillText(this.opts.shadeLabel, (xs + L + pw) / 2, top + 6);
      }
    }
    // hover crosshair
    if (this.hoverK >= 0) {
      const x = Math.round(g.sx(this.hoverK)) + 0.5;
      ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, top + ph); ctx.stroke();
    }
    // subplot title
    ctx.fillStyle = '#333'; ctx.font = font(12);
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(sp.label, L + 7, top + 6);
    ctx.restore();

    // frame, ticks and labels
    ctx.strokeStyle = '#555'; ctx.lineWidth = 1;
    ctx.strokeRect(L + 0.5, top + 0.5, pw - 1, ph - 1);
    ctx.fillStyle = '#333'; ctx.font = font(11.5);
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (const t of xt.ticks) {
      const x = g.sx(t);
      ctx.beginPath(); ctx.moveTo(x, top + ph); ctx.lineTo(x, top + ph + 4); ctx.stroke();
      ctx.fillText(fmtTick(t, xt.step), x, top + ph + 6);
    }
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (const t of yt.ticks) {
      const y = sub.sy(t);
      ctx.beginPath(); ctx.moveTo(L - 4, y); ctx.lineTo(L, y); ctx.stroke();
      ctx.fillText(fmtTick(t, yt.step), L - 6, y);
    }
    ctx.font = font(12.5);
    if (isBottom) {
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText('k  [h/Mpc]', L + pw / 2, g.h - 3);
    }
    ctx.save();
    ctx.translate(13, top + ph / 2); ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(sp.ylabel || sp.label, 0, 0);
    ctx.restore();
  }

  _bindHover() {
    const cv = this.els.canvas, tip = this.els.tip;
    cv.addEventListener('pointermove', (e) => {
      if (!this.curves) return;
      const r = cv.getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      const g = this._geometry();
      const inSub = g.subs.some((sub) => py >= sub.top && py <= sub.top + g.ph);
      if (px < MARGIN.left || px > MARGIN.left + g.pw || !inSub) { this._hideTip(); return; }
      const kx = g.x0 + ((px - MARGIN.left) / g.pw) * (g.x1 - g.x0);
      // snap to the nearest measured k (or the first series if there is no data)
      const ref = this.series[0];
      let q = 0;
      for (let t = 1; t < ref.nk; t++) {
        if (ref.k[t] > this.kRange[1]) break;
        if (Math.abs(ref.k[t] - kx) < Math.abs(ref.k[q] - kx)) q = t;
      }
      const k = ref.k[q];
      this.hoverK = k;
      const rows = [`<tr><th>k = ${k.toFixed(3)}</th>${this.present.map((sp) => `<th>${sp.short || sp.label}</th>`).join('')}</tr>`];
      this.series.forEach((s, si) => {
        const mark = s.kind === 'data'
          ? `<span class="lg-dot" style="background:${s.style.color}"></span>`
          : `<span class="lg-line ${s.style.dash && s.style.dash.length ? 'dashed' : ''}" style="border-color:${s.style.color}; width:16px"></span>`;
        const cells = this.present.map((sp) => {
          const c = this.curves[si][sp.key];
          if (!c) return '<td>–</td>';
          const v = k * valueAt(s, c, k);
          return `<td class="num">${Number.isFinite(v) ? v.toFixed(1) : '–'}</td>`;
        });
        rows.push(`<tr><td>${mark} ${escapeHtml(s.label)}</td>${cells.join('')}</tr>`);
      });
      tip.innerHTML = `<table>${rows.join('')}</table><div class="tip-note">k in h/Mpc, k Pₗ in (Mpc/h)²</div>`;
      tip.hidden = false;
      const wrap = cv.parentElement;
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      let x = px + 12, y = py + 12;
      if (x + tw > wrap.clientWidth - 2) x = px - tw - 12;
      if (y + th > wrap.clientHeight - 2) y = py - th - 12;
      x = Math.min(Math.max(2, x), wrap.clientWidth - tw - 2);
      y = Math.min(Math.max(2, y), wrap.clientHeight - th - 2);
      tip.style.left = x + 'px'; tip.style.top = y + 'px';
      this.request();
    });
    cv.addEventListener('pointerleave', () => this._hideTip());
  }

  _hideTip() {
    this.els.tip.hidden = true;
    if (this.hoverK >= 0) { this.hoverK = -1; this.request(); }
  }
}

// Value of an interpolated curve at k (linear in k between the series' k values)
function valueAt(s, c, k) {
  const kk = s.k;
  if (k <= kk[0]) return c[0];
  if (k >= kk[s.nk - 1]) return c[s.nk - 1];
  let i = 0;
  while (i < s.nk - 2 && kk[i + 1] < k) i++;
  const t = (k - kk[i]) / (kk[i + 1] - kk[i]);
  return c[i] * (1 - t) + c[i + 1] * t;
}

function fmtTick(t, step) {
  const dec = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  return (Math.abs(t) < step * 1e-6 ? 0 : t).toFixed(dec);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

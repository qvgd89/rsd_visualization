// Canvas scatter plot with equal-aspect axes, zoom and pan.
//
// Data coordinates: horizontal = Y, vertical = line-of-sight coordinate (Z or Z_s),
// both in Mpc/h. The view is described by the data coordinate at the centre of the
// plotting area (cx, cy) and a scale k in CSS pixels per Mpc/h, identical on both axes.

import { rng } from './selection.js';

const MARGIN = { left: 64, right: 16, top: 14, bottom: 48 };
const N_CHUNKS = 256; // subsets are drawn interleaved in chunks so neither colour sits on top

export class ScatterPlot {
  constructor(canvas, { boxSize, xLabel, yLabel }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.L = boxSize;
    this.xLabel = xLabel;
    this.yLabel = yLabel;

    this.style = { radius: 2, opacity: 0.8, showBox: true, showLines: false };
    // Each layer: { x, y, yReal, idx, color, visible,
    //               radius?, opacity?   (override the global style)
    //               interleave?        (galaxy subsets: drawn interleaved in chunks, on top)
    //               lines?, hover?     (draw displacement lines / take part in hover search) }
    // Non-interleaved layers are drawn first, in order (e.g. dark matter underneath).
    this.layers = [];
    this.highlight = -1;
    this._hl = null; // [x, y] arrays of the highlighted point's layer

    this.view = { cx: this.L / 2, cy: this.L / 2, k: 1 };
    this.onViewChange = null;
    this.onHover = null;

    this._dirty = false;
    this._resize();
    new ResizeObserver(() => { this._resize(); this.request(); }).observe(canvas.parentElement);
    this._bindEvents();
    this.resetView();
  }

  // ---------- data ----------
  setLayers(layers) {
    this.layers = layers;
    this.request();
  }

  setStyle(s) {
    Object.assign(this.style, s);
    this.request();
  }

  // Random permutation used to order points within each layer; shared so that the
  // interleaving is stable as subsets change.
  static permutation(n, seed = 987) {
    const r = rng(seed);
    const p = new Int32Array(n);
    for (let i = 0; i < n; i++) p[i] = i;
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      const t = p[i]; p[i] = p[j]; p[j] = t;
    }
    return p;
  }

  // ---------- geometry ----------
  _resize() {
    const parent = this.canvas.parentElement;
    const w = parent.clientWidth, h = parent.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    const oldW = this.w, oldH = this.h;
    this.w = w; this.h = h; this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.pw = Math.max(10, w - MARGIN.left - MARGIN.right);
    this.ph = Math.max(10, h - MARGIN.top - MARGIN.bottom);
    if (oldW && oldH && this.view) {
      // keep the same data range visible along the tighter dimension
      const oldPw = Math.max(10, oldW - MARGIN.left - MARGIN.right);
      const oldPh = Math.max(10, oldH - MARGIN.top - MARGIN.bottom);
      this.view.k *= Math.min(this.pw, this.ph) / Math.min(oldPw, oldPh);
    }
  }

  fitScale() {
    return Math.min(this.pw, this.ph) / this.L;
  }

  resetView() {
    this.view = { cx: this.L / 2, cy: this.L / 2, k: this.fitScale() };
    this._viewChanged();
  }

  // Centre the view on (cx, cy) with the given visible width (Mpc/h) along the shorter side
  setView(cx, cy, width) {
    this.view = { cx, cy, k: Math.min(this.pw, this.ph) / width };
    this._viewChanged();
  }

  zoomBy(f, sx, sy) {
    const v = this.view;
    if (sx === undefined) { sx = MARGIN.left + this.pw / 2; sy = MARGIN.top + this.ph / 2; }
    const [dx, dy] = this.toData(sx, sy);
    const kFit = this.fitScale();
    const k = Math.min(Math.max(v.k * f, kFit * 0.5), kFit * 2000);
    v.k = k;
    // keep (dx, dy) under the cursor
    v.cx = dx - (sx - MARGIN.left - this.pw / 2) / k;
    v.cy = dy + (sy - MARGIN.top - this.ph / 2) / k;
    this._viewChanged();
  }

  zoomToRect(x0, y0, x1, y1) {
    const v = this.view;
    v.cx = (x0 + x1) / 2; v.cy = (y0 + y1) / 2;
    const span = Math.max(Math.abs(x1 - x0) * this.ph / this.pw, Math.abs(y1 - y0), 1e-3);
    const kFit = this.fitScale();
    v.k = Math.min(Math.max(Math.min(this.pw / Math.max(Math.abs(x1 - x0), 1e-3), this.ph / span), kFit * 0.5), kFit * 2000);
    this._viewChanged();
  }

  toScreen(dx, dy) {
    const v = this.view;
    return [MARGIN.left + this.pw / 2 + (dx - v.cx) * v.k, MARGIN.top + this.ph / 2 - (dy - v.cy) * v.k];
  }

  toData(sx, sy) {
    const v = this.view;
    return [v.cx + (sx - MARGIN.left - this.pw / 2) / v.k, v.cy - (sy - MARGIN.top - this.ph / 2) / v.k];
  }

  visibleRange() {
    const [x0, y1] = this.toData(MARGIN.left, MARGIN.top);
    const [x1, y0] = this.toData(MARGIN.left + this.pw, MARGIN.top + this.ph);
    return { x0, x1, y0, y1 };
  }

  _viewChanged() {
    if (this.onViewChange) this.onViewChange(this.view);
    this.request();
  }

  // ---------- drawing ----------
  request() {
    if (this._dirty) return;
    this._dirty = true;
    requestAnimationFrame(() => { this._dirty = false; this.draw(); });
  }

  draw() {
    const ctx = this.ctx, dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);

    this._drawPoints();
    ctx.save();
    ctx.beginPath();
    ctx.rect(MARGIN.left, MARGIN.top, this.pw, this.ph);
    ctx.clip();
    if (this.style.showBox) this._drawBox();
    if (this.style.showLines) this._drawLines();
    this._drawHighlight();
    if (this._rubber) {
      const r = this._rubber;
      ctx.strokeStyle = '#333'; ctx.setLineDash([4, 3]); ctx.lineWidth = 1;
      ctx.strokeRect(Math.min(r.x0, r.x1), Math.min(r.y0, r.y1), Math.abs(r.x1 - r.x0), Math.abs(r.y1 - r.y0));
      ctx.setLineDash([]);
    }
    ctx.restore();
    this._drawAxes();
  }

  _drawBox() {
    const ctx = this.ctx;
    const [x0, y0] = this.toScreen(0, 0);
    const [x1, y1] = this.toScreen(this.L, this.L);
    ctx.strokeStyle = '#c9c9c9';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(x0, y1, x1 - x0, y0 - y1);
    ctx.setLineDash([]);
  }

  // Points are rasterised directly into an ImageData buffer (alpha blending done in
  // JavaScript), which is far faster than issuing a canvas call per point when
  // drawing a few hundred thousand points.
  _drawPoints() {
    const dpr = this.dpr;
    const W = Math.max(1, Math.round(this.pw * dpr)), H = Math.max(1, Math.round(this.ph * dpr));
    if (!this._img || this._img.width !== W || this._img.height !== H) this._img = this.ctx.createImageData(W, H);
    const buf = this._img.data;
    buf.fill(255); // white background

    const visible = this.layers.filter((l) => l.visible && l.idx.length);
    for (const layer of visible) {
      if (!layer.interleave) this._stampRange(layer, 0, layer.idx.length, buf, W, H);
    }
    const inter = visible.filter((l) => l.interleave);
    for (let c = 0; c < N_CHUNKS; c++) {
      for (const layer of inter) {
        const n = layer.idx.length;
        const a = Math.floor((c * n) / N_CHUNKS);
        const b = Math.floor(((c + 1) * n) / N_CHUNKS);
        if (b > a) this._stampRange(layer, a, b, buf, W, H);
      }
    }
    this.ctx.putImageData(this._img, Math.round(MARGIN.left * dpr), Math.round(MARGIN.top * dpr));
  }

  _stampRange(layer, a, b, buf, W, H) {
    const { x, y, idx } = layer;
    const v = this.view, dpr = this.dpr;
    const rd = (layer.radius ?? this.style.radius) * dpr;  // radius in device pixels
    const alpha = layer.opacity ?? this.style.opacity;
    const st = stamp(rd);
    const n = st.dx.length, R = st.R;
    const sdx = st.dx, sdy = st.dy, scov = st.cov;
    const [cr, cg, cb] = hexToRgb(layer.color);
    const kd = v.k * dpr;
    const ax = (this.pw / 2 - v.cx * v.k) * dpr;
    const ay = (this.ph / 2 + v.cy * v.k) * dpr;
    const wa = new Float32Array(n);
    for (let j = 0; j < n; j++) wa[j] = scov[j] * alpha;
    for (let t = a; t < b; t++) {
      const i = idx[t];
      const px = Math.floor(ax + x[i] * kd);
      const py = Math.floor(ay - y[i] * kd);
      if (px < -R || px >= W + R || py < -R || py >= H + R) continue;
      const inside = px >= R && px < W - R && py >= R && py < H - R;
      for (let j = 0; j < n; j++) {
        const qx = px + sdx[j], qy = py + sdy[j];
        if (!inside && (qx < 0 || qx >= W || qy < 0 || qy >= H)) continue;
        const o = (qy * W + qx) << 2;
        const w = wa[j];
        buf[o] += (cr - buf[o]) * w;
        buf[o + 1] += (cg - buf[o + 1]) * w;
        buf[o + 2] += (cb - buf[o + 2]) * w;
      }
    }
  }

  // Lines from each galaxy's real-space position to its redshift-space position
  _drawLines() {
    const ctx = this.ctx;
    const L = this.L;
    const { x0, x1, y0, y1 } = this.visibleRange();
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.45;
    for (const layer of this.layers) {
      if (!layer.visible || !layer.lines || !layer.yReal) continue;
      const { x, y, yReal } = layer;
      ctx.strokeStyle = layer.color;
      ctx.beginPath();
      for (const i of layer.idx) {
        const xi = x[i];
        if (xi < x0 || xi > x1) continue;
        const ys = y[i], yr = yReal[i];
        if (Math.max(ys, yr) < y0 || Math.min(ys, yr) > y1) continue;
        if (Math.abs(ys - yr) > L / 2) continue; // displacement wrapped through the box edge
        const [sx, sr] = this.toScreen(xi, yr);
        const [, ss] = this.toScreen(xi, ys);
        ctx.moveTo(sx, sr);
        ctx.lineTo(sx, ss);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  _drawHighlight() {
    const i = this.highlight;
    if (i < 0 || !this._hl) return;
    const ctx = this.ctx;
    const [sx, sy] = this.toScreen(this._hl[0][i], this._hl[1][i]);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(sx, sy, Math.max(5, this.style.radius + 4), 0, 2 * Math.PI);
    ctx.stroke();
  }

  _drawAxes() {
    const ctx = this.ctx;
    const { x0, x1, y0, y1 } = this.visibleRange();
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 1;
    ctx.strokeRect(MARGIN.left + 0.5, MARGIN.top + 0.5, this.pw - 1, this.ph - 1);
    ctx.fillStyle = '#333';
    ctx.font = '12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';

    const xt = niceTicks(x0, x1, Math.max(3, Math.floor(this.pw / 90)));
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (const t of xt.ticks) {
      const [sx] = this.toScreen(t, 0);
      ctx.beginPath(); ctx.moveTo(sx, MARGIN.top + this.ph); ctx.lineTo(sx, MARGIN.top + this.ph + 5); ctx.stroke();
      ctx.fillText(fmtTick(t, xt.step), sx, MARGIN.top + this.ph + 7);
    }
    const yt = niceTicks(y0, y1, Math.max(3, Math.floor(this.ph / 60)));
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (const t of yt.ticks) {
      const [, sy] = this.toScreen(0, t);
      ctx.beginPath(); ctx.moveTo(MARGIN.left - 5, sy); ctx.lineTo(MARGIN.left, sy); ctx.stroke();
      ctx.fillText(fmtTick(t, yt.step), MARGIN.left - 7, sy);
    }

    ctx.font = '13px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(this.xLabel, MARGIN.left + this.pw / 2, this.h - 4);
    ctx.save();
    ctx.translate(14, MARGIN.top + this.ph / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textBaseline = 'middle';
    ctx.fillText(this.yLabel, 0, 0);
    ctx.restore();
  }

  // ---------- hover ----------
  nearest(sx, sy, maxDist = 8) {
    const [dx, dy] = this.toData(sx, sy);
    const rad = maxDist / this.view.k;
    let best = -1, bestD = rad * rad;
    for (const layer of this.layers) {
      if (!layer.visible || !layer.hover) continue;
      const { x, y } = layer;
      for (const i of layer.idx) {
        const ex = x[i] - dx;
        if (ex > rad || ex < -rad) continue;
        const ey = y[i] - dy;
        const d2 = ex * ex + ey * ey;
        if (d2 < bestD) { bestD = d2; best = i; this._hl = [x, y]; }
      }
    }
    return best;
  }

  setHighlight(i) {
    if (i !== this.highlight) { this.highlight = i; this.request(); }
  }

  // ---------- events ----------
  _bindEvents() {
    const cv = this.canvas;
    const pointers = new Map();
    let drag = null;
    let pinch = null;
    let hoverPending = false, lastHover = null;

    const pos = (e) => {
      const r = cv.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };

    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const [sx, sy] = pos(e);
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      this.zoomBy(Math.exp(-dy * 0.0015), sx, sy);
    }, { passive: false });

    cv.addEventListener('dblclick', (e) => {
      const [sx, sy] = pos(e);
      this.zoomBy(e.shiftKey ? 0.5 : 2, sx, sy);
    });

    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      const p = pos(e);
      pointers.set(e.pointerId, p);
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]) };
        drag = null; this._rubber = null;
      } else if (pointers.size === 1) {
        if (e.shiftKey) {
          this._rubber = { x0: p[0], y0: p[1], x1: p[0], y1: p[1] };
        } else {
          drag = { sx: p[0], sy: p[1], cx: this.view.cx, cy: this.view.cy };
          cv.style.cursor = 'grabbing';
        }
      }
    });

    cv.addEventListener('pointermove', (e) => {
      const p = pos(e);
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);
      if (pinch && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (pinch.d > 0) this.zoomBy(d / pinch.d, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
        pinch.d = d;
        return;
      }
      if (this._rubber) {
        this._rubber.x1 = p[0]; this._rubber.y1 = p[1];
        this.request();
        return;
      }
      if (drag) {
        this.view.cx = drag.cx - (p[0] - drag.sx) / this.view.k;
        this.view.cy = drag.cy + (p[1] - drag.sy) / this.view.k;
        this._viewChanged();
        if (this.onHover) this.onHover(-1, p);
        return;
      }
      // hover (throttled to one search per frame)
      lastHover = p;
      if (!hoverPending && this.onHover) {
        hoverPending = true;
        requestAnimationFrame(() => {
          hoverPending = false;
          if (!lastHover) return;
          this.onHover(this.nearest(lastHover[0], lastHover[1]), lastHover);
        });
      }
    });

    const end = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (this._rubber) {
        const r = this._rubber;
        this._rubber = null;
        if (Math.abs(r.x1 - r.x0) > 5 && Math.abs(r.y1 - r.y0) > 5) {
          const [ax, ay] = this.toData(r.x0, r.y0);
          const [bx, by] = this.toData(r.x1, r.y1);
          this.zoomToRect(ax, ay, bx, by);
        } else this.request();
      }
      drag = null;
      cv.style.cursor = '';
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('pointerleave', () => {
      lastHover = null;
      if (this.onHover) this.onHover(-1, null);
    });
  }
}

// Pixel footprint of a point of radius rd (device pixels) centred in a pixel:
// offsets and fractional coverage (4x4 supersampling). Cached by radius.
const stampCache = new Map();
function stamp(rd) {
  const key = Math.round(rd * 100);
  if (stampCache.has(key)) return stampCache.get(key);
  const dx = [], dy = [], cov = [];
  if (rd < 0.5) {
    // smaller than a pixel: one pixel, coverage = area of a square of side 2r
    dx.push(0); dy.push(0); cov.push(Math.max(4 * rd * rd, 0.05));
  } else {
    const R = Math.ceil(rd + 0.5);
    const S = 4;
    for (let j = -R; j <= R; j++) {
      for (let i = -R; i <= R; i++) {
        let c = 0;
        for (let sj = 0; sj < S; sj++) {
          for (let si = 0; si < S; si++) {
            const u = i + (si + 0.5) / S - 0.5, w = j + (sj + 0.5) / S - 0.5;
            if (u * u + w * w <= rd * rd) c++;
          }
        }
        if (c) { dx.push(i); dy.push(j); cov.push(c / (S * S)); }
      }
    }
  }
  let R = 0;
  for (let j = 0; j < dx.length; j++) R = Math.max(R, Math.abs(dx[j]), Math.abs(dy[j]));
  const st = { dx: Int32Array.from(dx), dy: Int32Array.from(dy), cov: Float32Array.from(cov), R };
  stampCache.set(key, st);
  return st;
}

const rgbCache = new Map();
function hexToRgb(hex) {
  if (rgbCache.has(hex)) return rgbCache.get(hex);
  const h = hex.replace('#', '');
  const f = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const rgb = [parseInt(f.slice(0, 2), 16), parseInt(f.slice(2, 4), 16), parseInt(f.slice(4, 6), 16)];
  rgbCache.set(hex, rgb);
  return rgb;
}

export function niceTicks(a, b, target) {
  const span = b - a;
  if (!(span > 0)) return { step: 1, ticks: [] };
  const raw = span / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / mag;
  const step = (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * mag;
  const ticks = [];
  for (let t = Math.ceil(a / step) * step; t <= b + 1e-9 * span; t += step) ticks.push(t);
  return { step, ticks };
}

function fmtTick(t, step) {
  const dec = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  return (Math.abs(t) < step * 1e-6 ? 0 : t).toFixed(dec);
}

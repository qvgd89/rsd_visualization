import { MultipolePanel } from './multipoles.js';
import { DATA_URL, DM_URL, MULTIPOLES_URL, SPECTRA, COSMO, RSD_FACTOR, BOX_SIZE, COLS, OPT_COLS, COLORS, propMeta } from './config.js';
import { loadTable } from './data.js';
import { Selector, G_BLUE, G_RED, G_NONE } from './selection.js';
import { ScatterPlot } from './plot.js';
import { drawHistogram } from './hist.js';

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------
// Application state
// ---------------------------------------------------------------------------
const state = {
  // RSD strength. The two free parameters are the weights of the host halo velocity
  // (aHalo = α_h) and of the satellite velocity relative to the host (aSat = α_s).
  // The global α slider sets both to the same value.
  aHalo: 1,
  aSat: 1,
  mode: 'all',           // 'all' | 'property' | 'random' | 'central'
  prop: 'M_s',
  pLow: 50, pHigh: 50,   // percent, property split
  fA: 50, fB: 50,        // percent, random split
  seed: 1,
  swap: false,
  showLow: true, showHigh: true, showRest: false,
  showGal: true,         // draw galaxies
  showDM: false,         // draw dark matter particles
  dmRadius: 1, dmOpacity: 0.6,
};

let table, selector, plot, perm;
let xCol, zReal, vLos, zRsd;   // Float64Arrays
let vHost = null;              // host halo line-of-sight velocity (optional column)
let isCentral = null;          // 1 = central, 0 = satellite (optional column)
let split = null;              // result of the current subset selection
let galaxyLayers = [];         // plot layers for the galaxies (subsets)
// Dark matter particles, loaded on first use: { n, x, zReal, vLos, zRsd, idx }
let dm = null, dmLoading = null;

// ---------------------------------------------------------------------------
// Hooks for additional summary statistics / plots.
// Register with window.rsdApp.subscribe(fn); fn(event, snapshot) is called with
// event = 'rsd' whenever the redshift-space positions change and 'groups'
// whenever the subsets change (and once with 'init' after loading).
// ---------------------------------------------------------------------------
const listeners = [];
function emit(event) {
  const snap = snapshot();
  for (const fn of listeners) {
    try { fn(event, snap); } catch (e) { console.error(e); }
  }
}
function snapshot() {
  return {
    aHalo: state.aHalo,   // α_h, weight of host halo velocity
    aSat: state.aSat,     // α_s, weight of satellite velocity relative to host
    alpha: state.aHalo === state.aSat ? state.aHalo : null, // global α (null when α_h ≠ α_s)
    mode: state.mode,
    n: table.n,
    boxSize: BOX_SIZE,
    rsdFactor: RSD_FACTOR,
    x: xCol,           // Y coordinate (Mpc/h)
    zReal,             // real-space Z (Mpc/h)
    zRsd,              // redshift-space Z (Mpc/h), wrapped into [0, L)
    vLos,              // V_Z (km/s)
    vHost,             // V_Z,host (km/s) or null
    groups: split ? split.groups : null, // Uint8Array, 1 = blue, 2 = red (see selection.js)
    columns: table.columns,
    // dark matter particles (null until first shown): { n, x, zReal, zRsd }
    dm: dm ? { n: dm.n, x: dm.x, zReal: dm.zReal, zRsd: dm.zRsd } : null,
    state: { ...state },
  };
}
window.rsdApp = {
  subscribe(fn) { listeners.push(fn); if (table) fn('init', snapshot()); return () => listeners.splice(listeners.indexOf(fn), 1); },
  snapshot: () => snapshot(),
  state,
  // e.g. rsdApp.setView(1080, 1180, 40): centre on (Y, Z_s) showing 40 Mpc/h
  setView: (cx, cy, width) => plot.setView(cx, cy, width),
};

// ---------------------------------------------------------------------------
// Core computations
// ---------------------------------------------------------------------------
// Velocities without a host decomposition (dark matter, or galaxies when the table
// has no host velocity column) are weighted by α_h.
function applyRSD(zr, v, out) {
  const s = state.aHalo * RSD_FACTOR;
  const L = BOX_SIZE;
  for (let i = 0; i < out.length; i++) {
    let z = zr[i] + s * v[i];
    z -= L * Math.floor(z / L);
    out[i] = z;
  }
}

// Galaxies: Z_s = Z + (1+z)/H [α_h V_host + α_s (V - V_host)]
function applyGalaxyRSD() {
  if (!vHost) { applyRSD(zReal, vLos, zRsd); return; }
  const s = RSD_FACTOR;
  const ah = state.aHalo, as = state.aSat;
  const L = BOX_SIZE;
  for (let i = 0; i < zRsd.length; i++) {
    const vh = vHost[i];
    let z = zReal[i] + s * (ah * vh + as * (vLos[i] - vh));
    z -= L * Math.floor(z / L);
    zRsd[i] = z;
  }
}

function updateRSD() {
  applyGalaxyRSD();
  $('dm-comp-note').hidden = !(state.showDM && state.aHalo !== state.aSat);
  if (dm) applyRSD(dm.zReal, dm.vLos, dm.zRsd);
  plot.request();
  if (tooltipIdx >= 0) showTooltip(tooltipIdx, tooltipPos);
  emit('rsd');
}

function colors() {
  return state.swap ? { low: COLORS.red, high: COLORS.blue } : { low: COLORS.blue, high: COLORS.red };
}

function updateGroups() {
  const n = table.n;
  if (state.mode === 'all') {
    split = null;
  } else if (state.mode === 'property') {
    const meta = propMeta(state.prop);
    split = selector.propertySplit(state.prop, meta, state.pLow / 100, state.pHigh / 100);
  } else if (state.mode === 'central') {
    split = selector.centralSplit();
  } else {
    split = selector.randomSplit(state.fA / 100, state.fB / 100, state.seed);
  }

  const c = colors();
  const base = { x: xCol, y: zRsd, yReal: zReal, interleave: true, lines: true, hover: true };
  if (!split) {
    galaxyLayers = [{ ...base, idx: perm, color: COLORS.all, visible: true }];
  } else {
    const g = split.groups;
    const low = [], high = [], rest = [];
    for (let t = 0; t < n; t++) {
      const i = perm[t];
      const gi = g[i];
      if (gi === G_BLUE) low.push(i);
      else if (gi === G_RED) high.push(i);
      else if (gi === G_NONE) rest.push(i);
    }
    galaxyLayers = [
      { ...base, idx: Int32Array.from(rest), color: COLORS.rest, visible: state.showRest },
      { ...base, idx: Int32Array.from(low), color: c.low, visible: state.showLow },
      { ...base, idx: Int32Array.from(high), color: c.high, visible: state.showHigh },
    ];
  }
  refreshLayers();
  emit('groups');
}

// Combine dark matter (drawn underneath) and galaxy layers and hand them to the plot
function refreshLayers() {
  const layers = [];
  if (dm) {
    layers.push({
      x: dm.x, y: dm.zRsd, yReal: dm.zReal, idx: dm.idx, color: COLORS.dm,
      visible: state.showDM, radius: state.dmRadius, opacity: state.dmOpacity,
    });
  }
  for (const l of galaxyLayers) layers.push({ ...l, visible: l.visible && state.showGal });
  plot.setLayers(layers);
  updatePanels();
}

async function ensureDM() {
  if (dm) return dm;
  if (!dmLoading) {
    const status = $('dm-status');
    dmLoading = loadTable(DM_URL, (got, total) => {
      status.textContent = total ? `loading… ${Math.round((100 * got) / total)}%` : `loading… ${(got / 1e6).toFixed(1)} MB`;
    }).then((t) => {
      for (const c of Object.values(COLS)) if (!t.columns[c]) throw new Error(`column ${c} missing`);
      const d = {
        n: t.n, x: t.columns[COLS.x], zReal: t.columns[COLS.los], vLos: t.columns[COLS.vlos],
        zRsd: new Float64Array(t.n), idx: ScatterPlot.permutation(t.n, 4321),
      };
      applyRSD(d.zReal, d.vLos, d.zRsd);
      dm = d;
      status.textContent = `(${fmtInt(d.n)})`;
      emit('dm');
      return d;
    }).catch((e) => {
      status.textContent = `failed to load ${DM_URL}: ${e.message}`;
      dmLoading = null;
      throw e;
    });
  }
  return dmLoading;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------
function fmtNum(v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '–';
  const a = Math.abs(v);
  if (a === 0) return '0';
  if (a >= 1e5 || a < 1e-3) return v.toExponential(3);
  if (a >= 100) return v.toFixed(1);
  return v.toPrecision(4);
}
const fmtInt = (n) => n.toLocaleString('en-US');

function displayValue(name, raw) {
  const m = propMeta(name);
  return raw * (m.scale ?? 1);
}
function fmtProp(name, raw, withUnit = true) {
  const m = propMeta(name);
  if (m.format) return m.format(raw);
  let s = fmtNum(displayValue(name, raw));
  if (withUnit && m.unit) s += ' ' + m.unit;
  if (m.extra && Number.isFinite(raw) && raw > 0) s += ` (${m.extra(raw)})`;
  return s;
}

// Transformed values for the histogram (display units, log10 if requested)
const histCache = new Map();
function histValues(name) {
  if (histCache.has(name)) return histCache.get(name);
  const m = propMeta(name);
  const raw = table.columns[name];
  const out = new Float64Array(table.n);
  for (let i = 0; i < table.n; i++) {
    const v = raw[i] * (m.scale ?? 1);
    out[i] = m.log ? (v > 0 ? Math.log10(v) : NaN) : v;
  }
  histCache.set(name, out);
  return out;
}

// ---------------------------------------------------------------------------
// UI updates
// ---------------------------------------------------------------------------
function updatePanels() {
  const mode = state.mode;
  $('panel-property').hidden = mode !== 'property';
  $('panel-random').hidden = mode !== 'random';
  $('panel-visibility').hidden = mode === 'all';
  $('show-rest-label').hidden = mode === 'central';
  const c = colors();
  document.querySelectorAll('.swatch[data-group=low]').forEach((el) => (el.style.background = c.low));
  document.querySelectorAll('.swatch[data-group=high]').forEach((el) => (el.style.background = c.high));

  const legend = $('legend');
  const counts = $('counts');
  $('subsets-section').classList.toggle('dimmed', !state.showGal);
  const lg = [];
  if (state.showDM && dm) {
    lg.push(`<div><span class="swatch" style="background:${COLORS.dm}"></span> Dark matter particles (${fmtInt(dm.n)})</div>`);
  }
  if (mode === 'all') {
    if (state.showGal) lg.push(`<div><span class="swatch" style="background:${COLORS.all}"></span> All galaxies (${fmtInt(table.n)})</div>`);
    legend.innerHTML = lg.join('');
    counts.innerHTML = `<b>${fmtInt(table.n)}</b> galaxies.`;
    return;
  }

  const s = split;
  const rest = s.nValid - s.nBlue - s.nRed;
  let lowName, highName;
  if (mode === 'property') {
    const m = propMeta(state.prop);
    lowName = `Lowest ${state.pLow}% ${m.full}`;
    highName = `Highest ${state.pHigh}% ${m.full}`;
    const cut = $('cut-info');
    const parts = [];
    if (s.nBlue > 0) parts.push(`<span class="swatch" style="background:${c.low}"></span> ${m.sym} ≤ <b>${fmtProp(state.prop, s.lowCut)}</b>`);
    if (s.nRed > 0) parts.push(`<span class="swatch" style="background:${c.high}"></span> ${m.sym} ≥ <b>${fmtProp(state.prop, s.highCut)}</b>`);
    parts.push(`Range: ${fmtProp(state.prop, s.min, false)} – ${fmtProp(state.prop, s.max)}`);
    if (s.nExcluded) {
      parts.push(m.centralsOnly
        ? `${fmtInt(s.nExcluded)} satellites left out (${m.sym} is defined for centrals only).`
        : `${fmtInt(s.nExcluded)} galaxies with ${m.sym} = 0 left out (undefined).`);
    }
    parts.push('Ties broken randomly so fractions are exact.');
    cut.innerHTML = parts.join('<br>');
    drawHistogram($('hist'), {
      values: histValues(state.prop),
      order: selector.rankedOrder(state.prop, m),
      groups: s.groups,
      colors: c,
      lowCut: s.nBlue ? histValues(state.prop)[orderAt(s, 'low')] : null,
      highCut: s.nRed ? histValues(state.prop)[orderAt(s, 'high')] : null,
      xLabel: (m.log ? 'log₁₀ ' : '') + m.sym + (m.unit ? ` [${m.unit}]` : ''),
    });
  } else if (mode === 'central') {
    lowName = 'Centrals';
    highName = 'Satellites';
  } else {
    lowName = `Random subset A (${state.fA}%)`;
    highName = `Random subset B (${state.fB}%)`;
    $('seed').textContent = state.seed;
  }
  if (!state.showGal) { legend.innerHTML = lg.join(''); }
  else {
  if (state.showLow) lg.push(`<div><span class="swatch" style="background:${c.low}"></span> ${lowName} (${fmtInt(s.nBlue)})</div>`);
  if (state.showHigh) lg.push(`<div><span class="swatch" style="background:${c.high}"></span> ${highName} (${fmtInt(s.nRed)})</div>`);
  if (state.showRest) lg.push(`<div><span class="swatch" style="background:${COLORS.rest}"></span> Others (${fmtInt(rest)})</div>`);
  legend.innerHTML = lg.join('');
  }
  counts.innerHTML = `<b>${fmtInt(s.nBlue)}</b> + <b>${fmtInt(s.nRed)}</b> galaxies in subsets, ${fmtInt(rest)} others` +
    (s.nExcluded ? `, ${fmtInt(s.nExcluded)} undefined` : '') + '.';
}

function orderAt(s, which) {
  const order = selector.rankedOrder(state.prop, propMeta(state.prop));
  return which === 'low' ? order[s.nBlue - 1] : order[order.length - s.nRed];
}

function updateViewInfo() {
  const r = plot.visibleRange();
  const w = r.x1 - r.x0, h = r.y1 - r.y0;
  const zoom = plot.view.k / plot.fitScale();
  $('view-info').textContent = `View ${fmtNum(w)} × ${fmtNum(h)} Mpc/h · zoom ×${zoom < 10 ? zoom.toFixed(2) : zoom.toFixed(0)}`;
}

// Tooltip
let tooltipIdx = -1, tooltipPos = null;
function showTooltip(i, p) {
  const tip = $('tooltip');
  tooltipIdx = i; tooltipPos = p;
  plot.setHighlight(i);
  if (i < 0 || !p) { tip.hidden = true; return; }
  const rows = [`<tr><td>Z<sub>s</sub></td><td class="num">${fmtNum(zRsd[i])} Mpc/h</td></tr>`];
  for (const name of table.names) {
    const m = propMeta(name);
    const undef = !selector.isDefined(name, m, i);
    rows.push(`<tr><td>${m.symbol ? m.sym : m.label}</td><td class="num">${undef ? 'undefined' : fmtProp(name, table.columns[name][i])}</td></tr>`);
  }
  if (vHost && isCentral && isCentral[i] !== 1) {
    rows.push(`<tr><td>V_Z − V_Z,host</td><td class="num">${fmtNum(vLos[i] - vHost[i])} km/s</td></tr>`);
  }
  tip.innerHTML = `<div><b>Galaxy #${i}</b></div><table>${rows.join('')}</table>`;
  tip.hidden = false;
  const wrap = $('plot-wrap');
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  let x = p[0] + 14, y = p[1] + 14;
  if (x + tw > wrap.clientWidth - 4) x = p[0] - tw - 14;
  if (y + th > wrap.clientHeight - 4) y = Math.max(4, wrap.clientHeight - th - 4);
  tip.style.left = Math.max(4, x) + 'px';
  tip.style.top = y + 'px';
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------
function linkSlider(rangeId, numId, onChange) {
  const r = $(rangeId), nIn = $(numId);
  r.addEventListener('input', () => { nIn.value = r.value; onChange(parseFloat(r.value)); });
  nIn.addEventListener('change', () => {
    let v = parseFloat(nIn.value);
    if (!Number.isFinite(v)) v = parseFloat(r.value);
    v = Math.min(Math.max(v, parseFloat(r.min)), parseFloat(r.max));
    nIn.value = v; r.value = v;
    onChange(v);
  });
  return (v) => { r.value = v; nIn.value = v; };
}

let animating = null;
function stopAnimation() {
  if (animating) { cancelAnimationFrame(animating.raf); animating = null; $('animate').classList.remove('active'); $('animate').textContent = '▶ Animate 0↔1'; }
}

function setupControls() {
  // --- RSD strength: global α moves α_h and α_s in lockstep ---
  const setAlphaUI = linkSlider('alpha', 'alpha-num', (v) => { stopAnimation(); setStrength(v, v); });
  let setH = () => {}, setS = () => {};
  // Set α_h and α_s and bring all three sliders in line
  const setStrength = (h, sv) => {
    state.aHalo = h; state.aSat = sv;
    setH(h); setS(sv);
    syncGlobal();
    updateRSD();
  };
  const syncGlobal = () => {
    const mixed = state.aHalo !== state.aSat;
    $('alpha-row').classList.toggle('mixed', mixed);
    if (mixed) {
      $('alpha').value = (state.aHalo + state.aSat) / 2;
      $('alpha-num').value = '';
      $('alpha-num').placeholder = '—';
    } else {
      setAlphaUI(state.aHalo);
    }
  };
  $('alpha-0').onclick = () => { stopAnimation(); setStrength(0, 0); };
  $('alpha-1').onclick = () => { stopAnimation(); setStrength(1, 1); };
  $('animate').onclick = () => {
    if (animating) { stopAnimation(); return; }
    const period = 4000;
    // start the cycle at the current α (clamped to [0,1]); mixed values start from 0
    const cur = state.aHalo === state.aSat ? state.aHalo : 0;
    const a0 = Math.min(Math.max(cur, 0), 1);
    const t0 = performance.now() - (Math.acos(1 - 2 * a0) / (2 * Math.PI)) * period;
    animating = {};
    $('animate').classList.add('active');
    $('animate').textContent = '■ Stop';
    const step = (now) => {
      if (!animating) return;
      const a = Math.round((0.5 - 0.5 * Math.cos((2 * Math.PI * (now - t0)) / period)) * 100) / 100;
      setStrength(a, a);
      animating.raf = requestAnimationFrame(step);
    };
    animating.raf = requestAnimationFrame(step);
  };

  // velocity components (host halo motion / satellite motion within the host)
  if (vHost) {
    $('components').hidden = false;
    $('formula-simple').hidden = true;
    $('alpha-note').hidden = false;
    setH = linkSlider('a-halo', 'a-halo-num', (v) => { stopAnimation(); setStrength(v, state.aSat); });
    setS = linkSlider('a-sat', 'a-sat-num', (v) => { stopAnimation(); setStrength(state.aHalo, v); });
    const preset = (h, sv) => () => { stopAnimation(); setStrength(h, sv); };
    $('comp-full').onclick = preset(1, 1);
    $('comp-kaiser').onclick = preset(1, 0);
    $('comp-fog').onclick = preset(0, 1);
    let nSat = 0;
    if (isCentral) for (let i = 0; i < table.n; i++) if (isCentral[i] !== 1) nSat++;
    $('n-sat').textContent = isCentral ? `${fmtInt(nSat)} (${((100 * nSat) / table.n).toFixed(0)}%)` : '';
  }
  if (isCentral) $('mode-central-label').hidden = false;

  document.querySelectorAll('input[name=mode]').forEach((el) =>
    el.addEventListener('change', () => { state.mode = el.value; updateGroups(); }));

  // property dropdown: every column of the table
  const sel = $('prop');
  for (const name of table.names) {
    if (propMeta(name).menu === false) continue;
    const o = document.createElement('option');
    o.value = name;
    o.textContent = propMeta(name).full;
    sel.appendChild(o);
  }
  if (!table.names.includes(state.prop)) state.prop = table.names[0];
  sel.value = state.prop;
  sel.addEventListener('change', () => { state.prop = sel.value; updateGroups(); });

  // percentage pairs whose sum must not exceed 100
  const pair = (aKey, bKey, aIds, bIds) => {
    let setA, setB;
    setA = linkSlider(aIds[0], aIds[1], (v) => {
      state[aKey] = v;
      if (state[aKey] + state[bKey] > 100) { state[bKey] = 100 - v; setB(state[bKey]); }
      updateGroups();
    });
    setB = linkSlider(bIds[0], bIds[1], (v) => {
      state[bKey] = v;
      if (state[aKey] + state[bKey] > 100) { state[aKey] = 100 - v; setA(state[aKey]); }
      updateGroups();
    });
    return [setA, setB];
  };
  const [setPLow, setPHigh] = pair('pLow', 'pHigh', ['p-low', 'p-low-num'], ['p-high', 'p-high-num']);
  $('split-half').onclick = () => {
    state.pLow = 50; state.pHigh = 50;
    setPLow(50); setPHigh(50);
    updateGroups();
  };
  pair('fA', 'fB', ['f-a', 'f-a-num'], ['f-b', 'f-b-num']);

  $('swap').onclick = () => { state.swap = !state.swap; updateGroups(); };
  $('reseed').onclick = () => { state.seed = Math.floor(Math.random() * 1e6) + 1; updateGroups(); };

  const vis = (id, key) => $(id).addEventListener('change', (e) => { state[key] = e.target.checked; updateGroups(); });
  vis('show-low', 'showLow'); vis('show-high', 'showHigh'); vis('show-rest', 'showRest');

  $('show-gal').addEventListener('change', (e) => { state.showGal = e.target.checked; refreshLayers(); });
  $('show-dm').addEventListener('change', async (e) => {
    state.showDM = e.target.checked;
    $('dm-controls').hidden = !state.showDM;
    $('dm-comp-note').hidden = !(state.showDM && state.aHalo !== state.aSat);
    if (state.showDM && !dm) {
      try { await ensureDM(); } catch (err) { console.error(err); return; }
    }
    refreshLayers();
  });
  $('dm-radius').addEventListener('input', (e) => { state.dmRadius = parseFloat(e.target.value); refreshLayers(); });
  $('dm-opacity').addEventListener('input', (e) => { state.dmOpacity = parseFloat(e.target.value); refreshLayers(); });

  $('radius').addEventListener('input', (e) => plot.setStyle({ radius: parseFloat(e.target.value) }));
  $('opacity').addEventListener('input', (e) => plot.setStyle({ opacity: parseFloat(e.target.value) }));
  $('show-lines').addEventListener('change', (e) => plot.setStyle({ showLines: e.target.checked }));
  $('show-box').addEventListener('change', (e) => plot.setStyle({ showBox: e.target.checked }));
  $('zoom-in').onclick = () => plot.zoomBy(1.6);
  $('zoom-out').onclick = () => plot.zoomBy(1 / 1.6);
  $('reset-view').onclick = () => plot.resetView();

  window.addEventListener('resize', () => { if (state.mode === 'property') updatePanels(); });
}

// ---------------------------------------------------------------------------
// Power spectrum multipole panel (hidden if multipoles.json is not available)
// ---------------------------------------------------------------------------
async function setupMultipoles() {
  let json;
  try {
    const resp = await fetch(MULTIPOLES_URL);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    json = await resp.json();
  } catch (e) {
    console.info(`No multipole panel: could not load ${MULTIPOLES_URL} (${e.message})`);
    return;
  }
  $('stats').hidden = false;
  $('show-pk-label').hidden = false;
  const panel = new MultipolePanel({
    canvas: $('pk-canvas'), tip: $('pk-tip'), legend: $('pk-legend'),
    caption: $('pk-caption'), badge: $('pk-badge'), autoscale: $('pk-autoscale'),
  }, SPECTRA);
  try {
    panel.update(state.aHalo, state.aSat);
    panel.load(json);
  } catch (e) {
    $('pk-caption').textContent = `Could not read ${MULTIPOLES_URL}: ${e.message}`;
    console.error(e);
    return;
  }
  window.rsdApp.subscribe((event, snap) => {
    if (event === 'rsd' || event === 'init') panel.update(snap.aHalo, snap.aSat);
  });
  $('show-pk').addEventListener('change', (e) => { $('stats').hidden = !e.target.checked; });
  window.rsdApp.multipoles = panel;
}

// ---------------------------------------------------------------------------
// Start-up
// ---------------------------------------------------------------------------
async function main() {
  $('z-val').textContent = COSMO.z;
  $('rsd-factor').textContent = RSD_FACTOR.toPrecision(5);
  $('box-size').textContent = BOX_SIZE.toFixed(1);

  const loading = $('loading');
  try {
    table = await loadTable(DATA_URL, (got, total) => {
      loading.textContent = total
        ? `Loading galaxies… ${Math.round((100 * got) / total)}%`
        : `Loading galaxies… ${(got / 1e6).toFixed(1)} MB`;
    });
  } catch (e) {
    loading.textContent = `Failed to load ${DATA_URL}: ${e.message}. ` +
      'If you opened index.html directly from disk, serve the folder over HTTP instead (e.g. python3 -m http.server).';
    throw e;
  }
  for (const c of Object.values(COLS)) {
    if (!table.columns[c]) { loading.textContent = `Column ${c} missing from ${DATA_URL}`; return; }
  }

  xCol = table.columns[COLS.x];
  zReal = table.columns[COLS.los];
  vLos = table.columns[COLS.vlos];
  zRsd = new Float64Array(table.n);
  vHost = table.columns[OPT_COLS.vhost] || null;
  isCentral = table.columns[OPT_COLS.central] || null;
  selector = new Selector(table, OPT_COLS.central);
  perm = ScatterPlot.permutation(table.n);

  plot = new ScatterPlot($('plot'), {
    boxSize: BOX_SIZE,
    xLabel: `${COLS.x}  [Mpc/h]`,
    yLabel: `${COLS.los}  (redshift space, line of sight ↑)  [Mpc/h]`,
  });
  plot.onViewChange = updateViewInfo;
  plot.onHover = showTooltip;

  setupControls();
  setupMultipoles();
  updateRSD();
  updateGroups();
  updateViewInfo();
  loading.hidden = true;
  emit('init');
}

main();

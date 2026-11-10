// Assigning galaxies to the two coloured subsets.
//
// Group codes stored in a Uint8Array (one entry per galaxy):
//   0  not in either subset (e.g. the middle of a property split)
//   1  "blue" subset (lowest values of the property / random subset A)
//   2  "red"  subset (highest values of the property / random subset B)
//   3  excluded: property undefined for this galaxy (see excludeZero)

export const G_NONE = 0, G_BLUE = 1, G_RED = 2, G_EXCLUDED = 3;

// Small, fast, seedable PRNG (mulberry32)
export function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffledIndices(n, seed) {
  const r = rng(seed);
  const idx = new Int32Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    const t = idx[i]; idx[i] = idx[j]; idx[j] = t;
  }
  return idx;
}

export class Selector {
  // centralCol: name of the central (1) / satellite (0) flag column, if any
  constructor(table, centralCol = null, tieSeed = 12345) {
    this.table = table;
    this.central = centralCol && table.columns[centralCol] ? table.columns[centralCol] : null;
    this.n = table.n;
    // Random keys used to break ties between galaxies with identical values.
    // They are fixed for the session so that subsets are nested as thresholds move.
    const r = rng(tieSeed);
    this.tieKey = new Float64Array(this.n);
    for (let i = 0; i < this.n; i++) this.tieKey[i] = r();
    this.orderCache = new Map();
  }

  // Is the property defined for galaxy i? (meta: see PROPERTIES in config.js)
  isDefined(name, meta, i) {
    const x = this.table.columns[name][i];
    if (!Number.isFinite(x)) return false;
    if (meta.excludeZero && x === 0) return false;
    if (meta.centralsOnly && this.central && this.central[i] !== 1) return false;
    return true;
  }

  // Indices of galaxies with a defined value of `name`, sorted ascending by value
  // (ties broken randomly).
  rankedOrder(name, meta) {
    const key = `${name}|${!!meta.excludeZero}|${!!meta.centralsOnly}`;
    if (this.orderCache.has(key)) return this.orderCache.get(key);
    const v = this.table.columns[name];
    const tk = this.tieKey;
    const valid = [];
    for (let i = 0; i < this.n; i++) {
      if (this.isDefined(name, meta, i)) valid.push(i);
    }
    valid.sort((a, b) => (v[a] - v[b]) || (tk[a] - tk[b]));
    const order = Int32Array.from(valid);
    this.orderCache.set(key, order);
    return order;
  }

  // Lowest fLow and highest fHigh fractions (0..1, fLow + fHigh <= 1) of the
  // galaxies with a defined value of the property.
  propertySplit(name, meta, fLow, fHigh) {
    const order = this.rankedOrder(name, meta);
    const v = this.table.columns[name];
    const m = order.length;
    const nLow = Math.round(fLow * m);
    const nHigh = Math.min(Math.round(fHigh * m), m - nLow);
    const groups = new Uint8Array(this.n).fill(G_EXCLUDED);
    for (let k = 0; k < m; k++) groups[order[k]] = G_NONE;
    for (let k = 0; k < nLow; k++) groups[order[k]] = G_BLUE;
    for (let k = m - nHigh; k < m; k++) groups[order[k]] = G_RED;
    return {
      groups,
      nValid: m,
      nExcluded: this.n - m,
      nBlue: nLow,
      nRed: nHigh,
      // value of the last galaxy in the low subset / first galaxy in the high subset
      lowCut: nLow > 0 ? v[order[nLow - 1]] : null,
      highCut: nHigh > 0 ? v[order[m - nHigh]] : null,
      min: m ? v[order[0]] : null,
      max: m ? v[order[m - 1]] : null,
    };
  }

  // Centrals (blue) and satellites (red)
  centralSplit() {
    const groups = new Uint8Array(this.n);
    let nC = 0, nS = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.central[i] === 1) { groups[i] = G_BLUE; nC++; } else { groups[i] = G_RED; nS++; }
    }
    return { groups, nValid: this.n, nExcluded: 0, nBlue: nC, nRed: nS };
  }

  // Two disjoint random subsets with fractions fA (blue) and fB (red) of all galaxies.
  randomSplit(fA, fB, seed) {
    const idx = shuffledIndices(this.n, seed);
    const nA = Math.round(fA * this.n);
    const nB = Math.min(Math.round(fB * this.n), this.n - nA);
    const groups = new Uint8Array(this.n); // all G_NONE
    for (let k = 0; k < nA; k++) groups[idx[k]] = G_BLUE;
    for (let k = nA; k < nA + nB; k++) groups[idx[k]] = G_RED;
    return { groups, nValid: this.n, nExcluded: 0, nBlue: nA, nRed: nB };
  }
}

// Global configuration: cosmology, box geometry and how each galaxy property is
// labelled and displayed. Columns present in the data file but not listed in
// PROPERTIES are still usable; they simply get their raw column name as label.

export const DATA_URL = 'galaxies.csv';
export const DM_URL = 'particles.csv';   // dark matter particles: Y, Z, V_Z
export const MULTIPOLES_URL = 'multipoles.json'; // pre-computed P_l on an (alpha_h, alpha_s) grid

// Separate files with the multipoles of 50/50 subsets, keyed by the property's column
// name in galaxies.csv. Each file holds {"low": ..., "high": ...} (and optionally the
// same alpha_h, alpha_s, k grid as multipoles.json); it is loaded when first needed.
// Paths are relative to MULTIPOLES_URL. Splits given inside multipoles.json take precedence.
// `button` is the name of the split on the panel's view buttons.
export const PK_SPLIT_FILES = {
  'r-z': { file: 'multipoles_r-z.json', button: 'Colour split' },
  sigma_V: { file: 'multipoles_sigma_V.json', button: 'σ_V split' },
};

// Spectra shown in the multipole panel: key in multipoles.json, legend label, colour.
// A galaxy-matter cross spectrum could be added here later (e.g. key 'P0_gm').
// Multipole panel plot settings (k in h/Mpc)
export const PK_PLOT = {
  kRange: [0, 0.2],     // x-axis range
  shadeAbove: 0.08,     // grey out k above this (models fitted on 0.02 < k < 0.08 only)
  shadeLabel: 'not used in fit',
};

// Fitted parameters shown under the multipole panel. `key` is looked up at the top
// level of multipoles.json and then inside each model entry. Values are given on
// the (alpha_h, alpha_s) grid, nested [i_h][i_s] or flat with alpha_s varying
// fastest; +-Infinity, NaN and null are allowed.
// Statistical errors: a "<key>_err" entry next to the values (a number, or a grid
// like the values) is shown as ± error; for the halves of a split without one,
// `splitErr` is used.
export const PK_PARAMS = [
  // {model} in the note is replaced by the label of `model` in multipoles.json
  { key: 'A_over_f', label: 'A/f', model: 'mu_bias',
    desc: 'A/f: zero point set by the dark matter distribution',
    splitErr: 0.0143,  // statistical error on A/f for each half of a 50/50 split
    note: '{model} model, fitted on 0.02 < k < 0.08 h/Mpc' },
];

// Styles in the multipole panel. Models are matched by their key in multipoles.json
// ("models": {"mu_bias": ...}); models with other names use `fallback` in order.
export const PK_STYLES = {
  data: { color: '#111111' },
  models: {
    mu_bias: { color: '#7b3294', dash: [] },
    bias: { color: '#8c8c8c', dash: [7, 5] },
  },
  fallback: [{ color: '#7b3294', dash: [] }, { color: '#8c8c8c', dash: [7, 5] }],
  // Subset view: colours follow the galaxy subsets (low = blue, high = red, unless
  // swapped); the line style tells the models apart.
  splitDash: {
    models: { mu_bias: [], bias: [7, 5] },
    fallback: [[], [7, 5]],
  },
};

export const SPECTRA = [
  { key: 'P0', label: 'Monopole', short: 'ℓ = 0', ylabel: 'k P₀(k)  [(Mpc/h)²]' },
  { key: 'P2', label: 'Quadrupole', short: 'ℓ = 2', ylabel: 'k P₂(k)  [(Mpc/h)²]' },
];

export const COSMO = {
  z: 0.8,
  Hz: 157.45898,          // H(z) in (km/s)/(Mpc/h)
};

// RSD displacement per unit velocity: (1+z)/H(z), in (Mpc/h)/(km/s)
export const RSD_FACTOR = (1 + COSMO.z) / COSMO.Hz;

// Side length of the periodic simulation box in Mpc/h (FLAMINGO L2p8: 2.8 Gpc, h = 0.681)
export const BOX_SIZE = 2800 * 0.681;

// Names of the columns used for the plot itself
export const COLS = {
  x: 'Y',     // horizontal axis (real space, no RSD)
  los: 'Z',   // line-of-sight axis (RSD applied along this one)
  vlos: 'V_Z' // velocity along the line of sight, km/s
};

// Optional galaxy columns. If present they enable the split of the velocity into
// host halo motion and satellite motion within the host, and the
// centrals/satellites subset mode.
export const OPT_COLS = {
  vhost: 'V_Z_host',    // line-of-sight velocity of the host halo, km/s (= V_Z for centrals)
  central: 'is_central' // 1 = central, 0 = satellite
};

// One unit of the `age` column is 3.08567758e19 s = 977.79 Gyr
const AGE_UNIT_GYR = 3.08567758e19 / (3.15576e7 * 1e9);

const absMag = (L) => -2.5 * Math.log10(L);

// Per-property metadata.
//   label       description shown in the property menu
//   symbol      mathematical symbol, appended to the label and used in readouts
//   unit        unit string shown next to values
//   scale       multiply the raw column by this before display (does not affect ranking)
//   log         show the histogram on a log10 axis
//   excludeZero galaxies with exactly 0 are treated as undefined and left out of rankings
//   centralsOnly property only defined for centrals; satellites are left out of rankings
//   menu        false: do not offer the property in the split-by-property menu
//   format      optional function turning a raw value into the displayed string
//   extra       optional function giving a secondary string for a raw value
export const PROPERTIES = {
  Y:          { label: 'Real-space position', symbol: 'Y', unit: 'Mpc/h' },
  Z:          { label: 'Real-space position', symbol: 'Z', unit: 'Mpc/h' },
  V_Z:        { label: 'Line-of-sight velocity', symbol: 'V_Z', unit: 'km/s' },
  M_s:        { label: 'Stellar mass', symbol: 'M_s', unit: '10¹⁰ M☉', log: true },
  sigma_V:    { label: 'Stellar velocity dispersion', symbol: 'σ_V', unit: 'km/s' },
  sigma_V_DM: { label: 'Dark matter velocity dispersion', symbol: 'σ_V,DM', unit: 'km/s', excludeZero: true },
  'r-z':      { label: 'Colour', symbol: 'r − z', unit: 'mag' },
  L_u:        { label: 'u-band luminosity', symbol: 'L_u', unit: '', log: true, extra: (L) => `M_u = ${absMag(L).toFixed(2)}` },
  L_r:        { label: 'r-band luminosity', symbol: 'L_r', unit: '', log: true, extra: (L) => `M_r = ${absMag(L).toFixed(2)}` },
  L_z:        { label: 'z-band luminosity', symbol: 'L_z', unit: '', log: true, extra: (L) => `M_z = ${absMag(L).toFixed(2)}` },
  age:        { label: 'Mass-weighted stellar age', unit: 'Gyr', scale: AGE_UNIT_GYR },
  delta:      { label: 'Local matter overdensity', symbol: 'δ', unit: '' },
  c_v:        { label: 'Velocity-based halo concentration', symbol: 'c_v', unit: '', excludeZero: true },
  I_z:        { label: 'Projected total mass inertia tensor', symbol: 'I_z', unit: 'km/s' },
  is_central: { label: 'Central or satellite', unit: '', menu: false, format: (v) => (v === 1 ? 'central' : 'satellite') },
  sat_frac:   { label: 'Mass fraction in satellites', symbol: 'f_sat', unit: '', centralsOnly: true },
  V_Z_host:   { label: 'Host halo line-of-sight velocity', symbol: 'V_Z,host', unit: 'km/s' },
};

export function propMeta(name) {
  const m = { label: name, unit: '', scale: 1, log: false, excludeZero: false, ...(PROPERTIES[name] || {}) };
  m.sym = m.symbol || name;                                   // short name for readouts
  m.full = m.symbol ? `${m.label} ${m.symbol}` : m.label;     // menu / legend text
  return m;
}

// Colours for the two subsets and the "all galaxies" mode
export const COLORS = {
  all: '#111111',
  blue: '#1f5fbf',
  red: '#d1342b',
  rest: '#c2c2c2',   // galaxies outside both subsets
  dm: '#808080',     // dark matter particles
};

// Global configuration: cosmology, box geometry and how each galaxy property is
// labelled and displayed. Columns present in the data file but not listed in
// PROPERTIES are still usable; they simply get their raw column name as label.

export const DATA_URL = 'galaxies.csv';
export const DM_URL = 'particles.csv';   // dark matter particles: Y, Z, V_Z

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

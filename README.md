# Redshift-space distortion explorer

Interactive browser visualisation of redshift-space distortions (RSD) for a thin
slice of galaxies and dark matter particles from the FLAMINGO hydrodynamical
simulation (z = 0.8).

Galaxies are shown in the Y–Z plane. RSD are applied along Z in the
plane-parallel approximation:

    Z_s = Z + α (1+z)/H(z) V_Z ,   H(z) = 157.45898 (km/s)/(Mpc/h)

and Z_s is wrapped periodically in the box (L = 1906.8 Mpc/h). α = 1 is the
physical RSD and α = 0 is real space.

The galaxy sample is selected by stellar mass down to a number density of
5×10⁻⁴ h³ Mpc⁻³, matching the DESI DR2 LRG sample.

If the galaxy table has a `V_Z_host` column, the velocity is split into the motion
of the host halo and the motion of satellites relative to their host, each with
its own weight:

    Z_s = Z + (1+z)/H(z) [α_h V_Z,host + α_s (V_Z − V_Z,host)]

The global α slider sets α_h = α_s = α (and shows "—" when they differ), so there
are only two free parameters. Centrals move with their host (V_Z = V_Z,host), so
α_s only affects satellites. This is related to, but not the same as, the
Kaiser / fingers-of-god split: host motion also includes non-linear infall.
Dark matter particles have no host decomposition; their full velocity is weighted
by α_h.

## Running

The page is static HTML/JavaScript with no dependencies or build step. Because it
loads `galaxies.csv` with `fetch`, it has to be served over HTTP rather than opened
directly from disk:

```bash
python3 -m http.server 8000
```

then open <http://localhost:8000>. To publish it, enable GitHub Pages for the
repository (Settings → Pages → deploy from branch, root folder).

## Hosting

Everything runs in the browser; no server-side code is needed. Any static web host
works (GitHub Pages, university web space, Netlify, ...). Upload, keeping the
folder structure:

    index.html  css/  js/  galaxies.csv  particles.csv  multipoles.json

(`tools/`, `mock/` and `README.md` are not needed; `.nojekyll` only matters for
GitHub Pages.) All paths are relative, so the site can live in a subfolder.
Requirements on the host:

- serve the files over http(s): opening `index.html` from disk (`file://`) does not
  work, because browsers block `fetch` and JavaScript modules there;
- serve `.js` files with a JavaScript MIME type (e.g. `text/javascript`), which
  module scripts require; standard servers do this already;
- ideally compress responses (gzip/brotli): the CSV files shrink from ~24 MB and
  ~15 MB to ~6 MB and ~4 MB. GitHub Pages does this automatically.

There are no external scripts, fonts or other third-party requests.

## Features

- **RSD strength slider** α ∈ [0, 3], with α = 0 / α = 1 buttons and a 0↔1 animation.
- **Velocity components**: sliders α_h (host halo motion) and α_s (satellite motion
  relative to the host), with *Both*, *Host halo only* and *Satellites only* presets.
  The global α slider moves both together.
- **Galaxies and/or dark matter**: dark matter particles (`particles.csv`) can be shown
  in grey underneath the galaxies, or on their own. They are loaded the first time
  they are switched on and get the same RSD. Separate point size/opacity controls.
- **Subsets**
  - *All galaxies*: black dots.
  - *Split by property*: lowest p₁ % (blue) and highest p₂ % (red) of any column,
    with a histogram showing the cuts and a one-click 50/50 split. Ties in the property are broken randomly
    (with a fixed seed), so the fractions are exact. Galaxies with `c_v = 0` or
    `sigma_V_DM = 0` are treated as undefined for those properties and left out
    (the `c_v = 0` galaxies are exactly the satellites). `sat_frac` is a host
    property defined for centrals only, so satellites are left out of its ranking.
  - *Random subsets*: two disjoint random subsets with chosen fractions; *New random draw* reseeds.
  - *Centrals vs satellites* (uses the `is_central` column).
  - Each subset, and the remaining galaxies (grey), can be toggled on and off; colours can be swapped.
  - The satellite fraction of each subset (from `is_central`, for the galaxies in the
    slice) is shown under the subset controls in the sidebar, and updates
    with any threshold, property or random draw.
- **Zoom/pan**: scroll or pinch to zoom, drag to pan, double-click to zoom in
  (shift+double-click out), shift+drag to zoom to a rectangle, *Reset view*.
- **Display**: point size, opacity, optional lines from each galaxy's real-space
  to its redshift-space position.
- Hover over a galaxy to see all of its properties.

## Data

`galaxies.csv` and `particles.csv` are whitespace (or comma) separated with a header
line, optionally starting with `#`. Required columns: `Y`, `Z` (Mpc/h) and `V_Z` (km/s).
Optional galaxy columns: `V_Z_host` (km/s) and `is_central` (1/0). Every
column automatically appears in the property dropdown, so **new properties can be
added just by adding columns to the file**. To give a new column a readable label,
units, a log-scale histogram or an "undefined if zero" rule, add an entry to
`PROPERTIES` in `js/config.js` (the menu shows `label` followed by `symbol`).

Units used for display: `M_s` in 10¹⁰ M☉; `age` converted from units of
3.08567758e19 s to Gyr; luminosities are in units of 3631 Jy (shown together with
the absolute AB magnitude −2.5 log₁₀ L); `I_z` in km/s.
`SFR` is in units of 10¹⁰ M☉ per 977.79 Gyr (the time unit of `age`) and is shown in
M☉/yr on a log histogram; galaxies with SFR = 0 are ranked lowest but are not drawn
in that histogram.

`mu_a`, `mu_b` and `mu_c` are the cosines of the angles between the major,
intermediate and minor axes and the line of sight. As a safeguard they are rescaled
on load so that μ_a² + μ_b² + μ_c² = 1 for each galaxy (a no-op for unit vectors), and the
squared cosines `mu_a^2`, `mu_b^2`, `mu_c^2` are added as extra properties (see
`DERIVED` in `js/config.js`).

## Code layout

| File | Purpose |
|---|---|
| `index.html`, `css/style.css` | Page layout and controls |
| `js/config.js` | Cosmology, box size, column names, property labels/units, colours |
| `js/data.js` | Loading and parsing the galaxy table |
| `js/selection.js` | Property-threshold and random subset selection |
| `js/plot.js` | Scatter plot (points rasterised directly into an image buffer for speed), axes, zoom and pan |
| `js/hist.js` | Histogram of the selected property |
| `js/multipoles.js` | Power spectrum multipole panel and (α_h, α_s) interpolation |
| `tools/make_mock_multipoles.py` | Writes a mock `multipoles.json` (documents the format) |
| `tools/make_mock_splits.py` | Adds mock 50/50 r − z subsets to the real file, for testing |
| `js/main.js` | Application state and wiring of controls |

## Adding summary statistics

`js/main.js` exposes a small hook for extra statistics/plots that should update
with the slider or the subsets:

```js
window.rsdApp.subscribe((event, snap) => {
  // event: 'init' | 'rsd' (α_h or α_s changed) | 'groups' (subsets changed)
  // snap.aHalo (α_h), snap.aSat (α_s), snap.alpha (= α_h = α_s, or null if they differ),
  // snap.x (Y), snap.zReal, snap.zRsd, snap.groups (1 = blue, 2 = red),
  // snap.columns, snap.boxSize, snap.rsdFactor,
  // snap.dm = { n, x, zReal, zRsd } once the dark matter has been loaded (else null)
  // event 'dm' fires when the dark matter finishes loading
  // snap.vLos, snap.vHost for the velocity components
});
```

`rsdApp.setView(cy, cz, width)` centres the plot on (Y, Z_s) with the given width
in Mpc/h, e.g. `rsdApp.setView(1080, 1180, 40)` for a rich cluster.

## Power spectrum multipole panel

The right-hand panel shows k P₀(k) and k P₂(k) of the **full 3D galaxy sample**
(averaged over the three lines of sight), pre-computed on a grid of (α_h, α_s)
and interpolated to the slider values with tensor-product natural cubic splines.
The monopole and quadrupole are shown in separate panels sharing the k axis.
Measurements are drawn as black points; the `mu_bias` model as a solid purple line
and the `bias` model as a grey dashed line (styles in `PK_STYLES` in
`js/config.js`; models with other names use the fallback styles in file order). Hovering shows the values at the nearest measured k.
The y-axis is fixed to the range over the whole grid unless *Rescale y-axis* is
ticked. The panel is hidden if `multipoles.json` is missing.

`multipoles.json` format (k in h/Mpc, P in (Mpc/h)³, shot noise subtracted from P₀):

```json
{
  "description": "caption shown under the panel",
  "alpha_h": [0, 0.5, 1, 1.5, 2, 2.5, 3],
  "alpha_s": [0, 0.5, 1, 1.5, 2, 2.5, 3],
  "k": [ ...80 values... ],
  "data":   { "label": "FLAMINGO", "P0": A, "P2": A },
  "models": [ { "label": "Model 1", "k": [...optional...], "P0": A, "P2": A },
              { "label": "Model 2", "k": [...optional...], "P0": A, "P2": A } ]
}
```

The plot shows 0 ≤ k ≤ 0.2 h/Mpc and greys out k > 0.08 h/Mpc, which is not used
in the model fits (fits use 0.02 < k < 0.08 h/Mpc); see `PK_PLOT` in `js/config.js`.

Fitted parameters listed in `PK_PARAMS` (currently `A_over_f`, the A/f parameter
of the `mu_bias` model) are shown above the plot, interpolated to (α_h, α_s). They
are given on the same grid, either nested `[i_h][i_s]` or flat with α_s varying
fastest, and may contain `Infinity`, `-Infinity`, `NaN` or `null` (Python's
`json.dump` writes the first three, which the page accepts even though they are
not strictly valid JSON). The cubic spline is used only over runs of finite grid
values; infinite values are never displayed: on or next to an infinite or missing grid
point the value is shown as "—", since nothing can be said there (e.g. 0 < α_h < 0.5, where A/f = −∞ at α_h = 0).

### Galaxy subsets (50/50 property splits)

Multipoles of the two halves of a 50/50 split can be added under `splits`, keyed by
the property's column name in `galaxies.csv`. Each half has the same structure as
the full sample and uses the same `alpha_h`, `alpha_s` and `k` grid:

```json
"splits": {
  "r-z": {
    "low":  { "label": "Bluest 50%",
              "data":   { "P0": A, "P2": A },
              "models": { "mu_bias": { "label": "bias + μ^2", "P0": A, "P2": A },
                          "bias":    { "label": "bias only",  "P0": A, "P2": A } },
              "A_over_f": [ ...49 values... ] },
    "high": { "label": "Reddest 50%", ... }
  }
}
```

`low` / `high` are the galaxies below / above the median.

Statistical errors on fitted parameters are shown as ± error. They are read from a
`"<key>_err"` entry next to the values (e.g. `"A_over_f_err": 0.0143`, or a grid
like `A_over_f`); for split halves without one, `splitErr` in `PK_PARAMS`
(currently 0.0143 for A/f) is used. No error is shown for ΔA/f.

Subsets can also live in separate files (as for colour: `multipoles_r-z.json`),
registered in `PK_SPLIT_FILES` in `js/config.js` with the name used on the panel's
view buttons, e.g. `'M_s': { file: 'multipoles_M_s.json', button: 'Stellar mass split' }`. Each file holds
`{"low": ..., "high": ...}` and may repeat `alpha_h`, `alpha_s` and `k`, which must
then match `multipoles.json`. A file is downloaded only when its split is selected.
(A split can also be given inside `multipoles.json` as `"splits": {"r-z": {...}}` or
`"splits": {"r-z": "multipoles_r-z.json"}`.)

Buttons at the top of the panel switch between *All galaxies* and each available
split (they also switch the main view). The panel follows the main view: when the galaxies are split by a property with
subset measurements at exactly 50/50, it shows the two halves (low in blue, high in
red, following *Swap colours*; solid = `mu_bias`, dashed = `bias`), A/f for both
halves and ΔA/f = A/f(high) − A/f(low). Otherwise it shows the full sample, with a
button to switch the main view to an available 50/50 split.

`mock/multipoles_splits_mock.json` (made by `tools/make_mock_splits.py` from the
real full-sample file) contains mock r − z subsets; preview it with
`index.html?multipoles=mock/multipoles_splits_mock.json`. The `?multipoles=` URL
parameter loads any other multipole file in the same way.

`models` may also be an object keyed by model name, e.g.
`"models": {"mu_bias": {...}, "bias": {...}}`; the key is then used as the label
(unless the entry has its own `"label"`) and the order in the file sets the line
style (first solid, second dashed).

`A[i_h][i_s][i_k]` is the multipole at `alpha_h[i_h]`, `alpha_s[i_s]`, `k[i_k]`
(numpy: `P0.tolist()` for an array of shape `(n_h, n_s, n_k)`). The grids must be
sorted but need not be uniform. A model without its own `k` uses the top-level `k`.
To add another spectrum later (e.g. the galaxy–matter cross power spectrum), add
its arrays under a new key and list that key in `SPECTRA` in `js/config.js`.

The current `multipoles.json` is a **mock** made by `tools/make_mock_multipoles.py`
(toy Kaiser + fingers-of-god model; `"mock": true` shows a warning badge). On that
mock, cubic interpolation on the 7×7 grid reproduces the exact model at off-grid
(α_h, α_s) to ≲0.5% of the peak k P₀ (bilinear: ≲1%).

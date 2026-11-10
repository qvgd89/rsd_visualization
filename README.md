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

## Code layout

| File | Purpose |
|---|---|
| `index.html`, `css/style.css` | Page layout and controls |
| `js/config.js` | Cosmology, box size, column names, property labels/units, colours |
| `js/data.js` | Loading and parsing the galaxy table |
| `js/selection.js` | Property-threshold and random subset selection |
| `js/plot.js` | Scatter plot (points rasterised directly into an image buffer for speed), axes, zoom and pan |
| `js/hist.js` | Histogram of the selected property |
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

The empty `<section id="stats-panels">` in `index.html` is reserved for such panels.

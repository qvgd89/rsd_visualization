#!/usr/bin/env python3
"""Write mock/multipoles_splits_mock.json: the real full-sample multipoles.json plus
MOCK 50/50 subset measurements for galaxy colour (r-z), in the format read by the
power spectrum panel. Only for developing/testing the subset view; preview it with
index.html?multipoles=mock/multipoles_splits_mock.json

Subset format (same structure as the full sample, on the same alpha_h, alpha_s, k grid):

"splits": {
  "<column name in galaxies.csv>": {
    "low":  {"label": "...", "data": {"P0": A, "P2": A},
             "models": {"mu_bias": {"label": ..., "P0": A, "P2": A}, "bias": {...}},
             "A_over_f": [49 values, flat or 7x7]},
    "high": {...}
  }
}

"low" / "high" are the galaxies below / above the median of the property
(drawn blue / red, like the lowest / highest subsets in the main view).
"""
import json, sys
import numpy as np

src = sys.argv[1] if len(sys.argv) > 1 else 'multipoles.json'
d = json.load(open(src))
rng = np.random.default_rng(2)
k = np.array(d['k'])

def scaled(block, amp0, amp2, noise):
    out = {}
    for key, amp in (('P0', amp0), ('P2', amp2)):
        A = np.array(block[key], dtype=float) * amp
        if noise:
            A = A * (1 + noise * rng.standard_normal(A.shape[-1]))  # same noise at every grid point
        out[key] = np.round(A, 3).tolist()
    return out

def subset(label, b2, quad, noise, dA):
    models = {}
    for name, m in d['models'].items():
        models[name] = {'label': m.get('label', name), **scaled(m, b2, quad, 0)}
    Af = np.array(d['A_over_f'], dtype=float) + dA
    return {
        'label': label,
        'data': {'label': label, **scaled(d['data'], b2, quad, noise)},
        'models': models,
        'A_over_f': [x if np.isfinite(x) else ('-Infinity' if x < 0 else 'Infinity') for x in Af.tolist()],
    }

d['mock'] = True
d['description'] = 'MOCK subset measurements (scaled full sample) for testing the panel only.'
d['splits'] = {
    'r-z': {
        'low': subset('Bluest 50%', 0.75, 0.85, 0.03, -0.02),
        'high': subset('Reddest 50%', 1.3, 1.2, 0.03, 0.03),
    }
}
txt = json.dumps(d, separators=(',', ':')).replace('"-Infinity"', '-Infinity').replace('"Infinity"', 'Infinity')
open('mock/multipoles_splits_mock.json', 'w').write(txt)
print('wrote mock/multipoles_splits_mock.json')

#!/usr/bin/env python3
"""Write a MOCK multipoles.json in the format read by the power spectrum panel.

This only exists so the panel can be developed before the real measurements are
available. It uses a toy Kaiser model with a fingers-of-god damping term; none of
the numbers mean anything. Replace multipoles.json with the real measurements.

File format (all P in (Mpc/h)^3, k in h/Mpc; the panel plots k * P_l):

{
  "description": "...",               # caption shown under the panel
  "mock": true,                       # optional; shows a 'mock data' warning
  "alpha_h": [7 values],              # grid of host halo velocity weights (sorted)
  "alpha_s": [7 values],              # grid of satellite velocity weights (sorted)
  "k": [nk values],                   # k of the measurements
  "data":   {"label": "...", "P0": A, "P2": A},
  "models": [{"label": "...", "k": [...optional...], "P0": A, "P2": A},   # solid line
             {"label": "...", "k": [...optional...], "P0": A, "P2": A}]   # dashed line
}

where A[i_h][i_s][i_k] is the multipole at alpha_h[i_h], alpha_s[i_s], k[i_k].
A model without its own "k" uses the top-level "k". Extra spectra (e.g. a
galaxy-matter cross power spectrum) can be added later as further keys
alongside P0 and P2.
"""
import json
import numpy as np

rng = np.random.default_rng(1)
L = 1906.8
nbar = 5e-4
kf = 2 * np.pi / L

# ---- toy linear power spectrum (BBKS), normalised to sigma_8(z=0.8) = 0.55 ----
def p_lin_unnorm(k, gamma=0.208, ns=0.965):
    q = k / gamma
    T = np.log(1 + 2.34 * q) / (2.34 * q) * (1 + 3.89 * q + (16.1 * q) ** 2 + (5.46 * q) ** 3 + (6.71 * q) ** 4) ** -0.25
    return k ** ns * T ** 2

kk = np.logspace(-4, 2, 4000)
x = kk * 8.0
W = 3 * (np.sin(x) - x * np.cos(x)) / x ** 3
s8 = np.sqrt(np.trapezoid(kk ** 2 * p_lin_unnorm(kk) * W ** 2, kk) / (2 * np.pi ** 2))
A = (0.55 / s8) ** 2
p_lin = lambda k: A * p_lin_unnorm(k)

b, f, sigma_v = 2.2, 0.83, 3.0   # bias, growth rate, FoG dispersion in Mpc/h
mu, wmu = np.polynomial.legendre.leggauss(48)
L2 = 0.5 * (3 * mu ** 2 - 1)

def multipoles(k, ah, as_, fog):
    kmu = k[:, None] * mu[None, :]
    if fog == 'lorentz':
        D = 1 / (1 + 0.5 * (kmu * as_ * sigma_v) ** 2)
    else:
        D = np.exp(-(kmu * as_ * sigma_v) ** 2)
    P = (b + ah * f * mu[None, :] ** 2) ** 2 * p_lin(k)[:, None] * D
    P0 = 0.5 * (P * wmu).sum(1)
    P2 = 2.5 * (P * wmu * L2).sum(1)
    return P0, P2

alpha_h = np.linspace(0, 3, 7)
alpha_s = np.linspace(0, 3, 7)
edges = np.linspace(0, 0.4, 81)
k = 0.5 * (edges[1:] + edges[:-1])
nmodes = 2 * np.pi * k ** 2 * (edges[1] - edges[0]) / kf ** 3
k_model = np.linspace(0.002, 0.4, 200)

# one fixed noise realisation (the same simulation is used at every grid point)
g0, g2 = rng.standard_normal(len(k)), rng.standard_normal(len(k))
boost = 1 + 0.4 * (k / 0.3) ** 2   # fake non-linear boost so data and models differ

shape = (len(alpha_h), len(alpha_s))
D0 = np.zeros(shape + (len(k),)); D2 = np.zeros_like(D0)
M = {m: (np.zeros(shape + (len(k_model),)), np.zeros(shape + (len(k_model),))) for m in ('lorentz', 'gauss')}
for i, ah in enumerate(alpha_h):
    for j, as_ in enumerate(alpha_s):
        P0, P2 = multipoles(k, ah, as_, 'lorentz')
        err = (P0 * boost + 1 / nbar) * np.sqrt(2 / nmodes)
        D0[i, j] = P0 * boost + err * g0
        D2[i, j] = P2 * boost + np.sqrt(5) * err * g2
        for m in M:
            M[m][0][i, j], M[m][1][i, j] = multipoles(k_model, ah, as_, m)

r = lambda a: np.round(a, 3).tolist()
out = {
    'description': 'MOCK DATA: toy Kaiser model with fingers-of-god damping, for testing the panel only.',
    'mock': True,
    'alpha_h': alpha_h.tolist(),
    'alpha_s': alpha_s.tolist(),
    'k': np.round(k, 6).tolist(),
    'data': {'label': 'Mock measurement', 'P0': r(D0), 'P2': r(D2)},
    'models': [
        {'label': 'Mock model 1 (Lorentzian FoG)', 'k': np.round(k_model, 6).tolist(), 'P0': r(M['lorentz'][0]), 'P2': r(M['lorentz'][1])},
        {'label': 'Mock model 2 (Gaussian FoG)', 'k': np.round(k_model, 6).tolist(), 'P0': r(M['gauss'][0]), 'P2': r(M['gauss'][1])},
    ],
}
with open('multipoles.json', 'w') as fh:
    json.dump(out, fh, separators=(',', ':'))
print('wrote multipoles.json')

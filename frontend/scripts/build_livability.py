#!/usr/bin/env python3
"""
Shared pieces of the livability pipeline: features, the frozen scaler, the
three trained networks, and a numpy forward pass that reproduces them.

The networks are Keras models, but the studio has to rescore a neighbourhood
in the browser every time a planner tries a different zone. So the weights are
exported and the forward pass is written out by hand here, in numpy, against
the same maths the TypeScript runtime uses. Keeping both implementations in
this one file's shape is what lets `verify` prove they agree.

Reference: FORMULA_SUMMARY.md. L_s = mean over seeds of sigmoid(g(x_s, H_s)).
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
GRID = ROOT / "urban_city_dataset" / "data" / "processed" / "city_grids"
WEIGHTS = ROOT / "notebooks" / "prayas_neural_livability_outputs"

SEEDS = (11, 26, 41)
RADIUS = 5.0
KEY_DIM = 16
HEADS = 3

# The network's one-hot order. Fixed by training; not the studio's wire order.
TYPE_CLASSES = (
    "Residential", "Commercial", "Civic", "Green", "Office",
    "Utility", "Industrial", "Agricultural", "Unbuilt",
)
TYPE_INDEX = {n: i for i, n in enumerate(TYPE_CLASSES)}

# The studio's wire order for a cell's `t` field. Append only.
ZONES = [
    "residential", "commercial", "office", "civic", "industrial",
    "utility", "green", "agricultural", "unbuilt",
]
# Wire zone index -> network one-hot column.
ZONE_TO_TYPE = [TYPE_INDEX[z.capitalize()] for z in ZONES]

TARGETS = {"ghsl_7599": "Mumbai", "ghsl_9558": "Bengaluru"}
COUNTRY = {"Mumbai": "India", "Bengaluru": "India"}


def city_id(path: Path) -> str:
    return "ghsl_" + path.stem.rsplit("_ghsl_", 1)[1]


def load_cells() -> tuple[pd.DataFrame, set[str]]:
    """Every city the scaler needs, plus the two the studio ships."""
    model_ids = {c["city_id"] for c in json.loads((ROOT / "urban_city_dataset" / "config.json").read_text())["cities"]}
    frames = []
    for path in sorted(GRID.glob("*_ghsl_*.csv")):
        cid = city_id(path)
        if cid not in model_ids and cid not in TARGETS:
            continue
        df = pd.read_csv(path)
        df["city_id"] = cid
        frames.append(df)
    return pd.concat(frames, ignore_index=True), model_ids


def fit_scaler(cells: pd.DataFrame, model_ids: set[str]) -> tuple[np.ndarray, np.ndarray]:
    """
    Mean and standard deviation of the two numeric inputs.

    Fitted on the ten model cities alone. Mumbai and Bengaluru are inference
    targets, so letting their statistics into the scaler would re-rank them
    against themselves and break comparability with the published scores.
    """
    raw = np.column_stack([
        np.log1p(cells.population.to_numpy(np.float32)),
        cells.green_cover_pct.to_numpy(np.float32),
    ])
    fit = raw[cells.city_id.isin(model_ids).to_numpy()]
    return fit.mean(axis=0), fit.std(axis=0)


def focal_features(pop: np.ndarray, green: np.ndarray, type_idx: np.ndarray,
                   mean: np.ndarray, std: np.ndarray) -> np.ndarray:
    """x_s: standardised log population, standardised green cover, one-hot type."""
    n = len(pop)
    out = np.zeros((n, 2 + len(TYPE_CLASSES)), np.float32)
    out[:, 0] = (np.log1p(pop) - mean[0]) / std[0]
    out[:, 1] = (green - mean[1]) / std[1]
    out[np.arange(n), 2 + type_idx] = 1.0
    return out


def neighbourhood(x: np.ndarray, y: np.ndarray, max_neighbors: int):
    """
    For each cell, the cells within Euclidean grid distance 5, nearest first.

    Returns the neighbour index table and, for each cell, where it sits inside
    every other cell's list. That reverse map is what makes a what-if cheap:
    changing one cell touches a known handful of slots, not the whole grid.
    """
    n = len(x)
    xy = np.column_stack([x, y]).astype(np.float32)
    idx = np.full((n, max_neighbors), -1, np.int32)
    off = np.zeros((n, max_neighbors, 3), np.float32)
    count = np.zeros(n, np.int32)

    for i in range(n):
        d2 = ((xy - xy[i]) ** 2).sum(1)
        keep = np.nonzero(d2 <= RADIUS * RADIUS + 1e-6)[0]
        d = np.sqrt(d2[keep])
        order = keep[np.argsort(d, kind="stable")]
        k = len(order)
        idx[i, :k] = order
        delta = xy[order] - xy[i]
        off[i, :k, :2] = delta / RADIUS
        off[i, :k, 2] = np.sqrt((delta ** 2).sum(1)) / RADIUS
        count[i] = k
    return idx, off, count


def assemble(focal: np.ndarray, idx: np.ndarray, off: np.ndarray, count: np.ndarray):
    """H_s: each neighbour's own features followed by its relative position."""
    n, m = idx.shape
    neigh = np.zeros((n, m, focal.shape[1] + 3), np.float32)
    mask = np.zeros((n, m), bool)
    safe = np.maximum(idx, 0)
    neigh[:, :, : focal.shape[1]] = focal[safe]
    neigh[:, :, focal.shape[1]:] = off
    valid = np.arange(m)[None, :] < count[:, None]
    neigh[~valid] = 0.0
    mask[valid] = True
    return neigh, mask


# --- the networks ---------------------------------------------------------

def gelu(v: np.ndarray) -> np.ndarray:
    """Keras' default gelu is the exact erf form, not the tanh approximation."""
    from scipy.special import erf
    return 0.5 * v * (1.0 + erf(v / np.sqrt(2.0)))


def load_weights() -> list[dict]:
    """Pull the tensors out of the three .keras files in graph order."""
    import keras

    out = []
    for seed in SEEDS:
        model = keras.models.load_model(WEIGHTS / f"livability_attention_seed_{seed}.keras")
        dense = [l for l in model.layers if l.__class__.__name__ == "Dense"]
        mha = next(l for l in model.layers if l.__class__.__name__ == "MultiHeadAttention")
        q, kv, fp, d1, d2, head = (l.get_weights() for l in dense)
        a = mha.get_weights()
        out.append({
            "q_w": q[0], "q_b": q[1], "kv_w": kv[0], "kv_b": kv[1],
            "aq_w": a[0], "aq_b": a[1], "ak_w": a[2], "ak_b": a[3],
            "av_w": a[4], "av_b": a[5], "ao_w": a[6], "ao_b": a[7],
            "fp_w": fp[0], "fp_b": fp[1], "d1_w": d1[0], "d1_b": d1[1],
            "d2_w": d2[0], "d2_b": d2[1], "out_w": head[0], "out_b": head[1],
        })
    return out


def forward(w: dict, focal: np.ndarray, neigh: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """One network's p_s for a batch of cells."""
    q = gelu(focal @ w["q_w"] + w["q_b"])
    kv = gelu(neigh @ w["kv_w"] + w["kv_b"])

    Q = np.einsum("bf,fhd->bhd", q, w["aq_w"]) + w["aq_b"]
    K = np.einsum("bnf,fhd->bnhd", kv, w["ak_w"]) + w["ak_b"]
    V = np.einsum("bnf,fhd->bnhd", kv, w["av_w"]) + w["av_b"]

    scores = np.einsum("bhd,bnhd->bhn", Q, K) / np.sqrt(KEY_DIM)
    scores = np.where(mask[:, None, :], scores, -1e9)
    scores -= scores.max(-1, keepdims=True)
    attn = np.exp(scores)
    attn /= attn.sum(-1, keepdims=True)

    ctx = np.einsum("bhn,bnhd->bhd", attn, V)
    ctx = np.einsum("bhd,hdf->bf", ctx, w["ao_w"]) + w["ao_b"]

    fp = gelu(focal @ w["fp_w"] + w["fp_b"])
    h = np.concatenate([fp, ctx, np.abs(fp - ctx), fp * ctx], axis=1)
    h = gelu(h @ w["d1_w"] + w["d1_b"])
    h = gelu(h @ w["d2_w"] + w["d2_b"])
    return 1.0 / (1.0 + np.exp(-(h @ w["out_w"] + w["out_b"])[:, 0]))


def livability(nets: list[dict], focal: np.ndarray, neigh: np.ndarray,
               mask: np.ndarray, chunk: int = 4096) -> np.ndarray:
    """L_s, averaged over the three seeds."""
    out = np.zeros(len(focal), np.float64)
    for lo in range(0, len(focal), chunk):
        hi = min(lo + chunk, len(focal))
        acc = np.zeros(hi - lo, np.float64)
        for w in nets:
            acc += forward(w, focal[lo:hi], neigh[lo:hi], mask[lo:hi])
        out[lo:hi] = acc / len(nets)
    return out

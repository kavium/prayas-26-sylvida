#!/usr/bin/env python3
"""
Builds everything the studio loads at runtime.

Output:
  public/model/livability.bin    the three networks' weights, float32
  public/model/livability.json   shapes, the frozen scaler, the wire mapping
  public/cities/<slug>.json      one target city: cells, L_s, proposals
  public/cities/index.json       the city picker's list

Only Mumbai and Bengaluru ship. The ten model cities are read for one reason:
the scaler is fitted on them and must stay frozen, exactly as FORMULA_SUMMARY
requires. Their grids are never written out.

A proposal is one cell's zone changed to one other zone. Its worth is the
population-weighted impact from FORMULA_SUMMARY:

    I = sum over j within radius 5 of  P_j * (L_j_after - L_j_before)

which is why the search is expensive: every candidate rescores a whole
neighbourhood through the real networks. Nothing here is a heuristic stand-in
for the model.
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_livability as B  # noqa: E402

OUT_CITIES = B.ROOT / "frontend" / "public" / "cities"
OUT_MODEL = B.ROOT / "frontend" / "public" / "model"

# Zones a proposal may assign. Unbuilt land is never a target, and neither is
# agricultural: inside an urban centre it reads as abandonment, not planning.
ASSIGNABLE = ["residential", "commercial", "office", "civic", "industrial", "utility", "green"]

# Residents a rezoning cannot displace. Turning an occupied cell into a park or
# a works depot means moving the people on it, so the search will not suggest
# it above these thresholds.
DISPLACEMENT_LIMIT = {"green": 2500, "industrial": 1500, "utility": 1000}

# A change worth less than this many population-weighted points is noise.
MIN_IMPACT = 250.0
# Cells whose L actually moves, above this, count as "people affected".
MOVED = 1e-4
# Keeps the list from collapsing into twenty copies of one idea.
MAX_PER_TRANSITION = 6
MIN_SEPARATION = 2
LIMIT = 40
# Of those, the fewest that keep the rim-only filter worth pressing.
RIM_QUOTA = 14


def outer_flags(x: np.ndarray, y: np.ndarray, dist: np.ndarray) -> tuple[np.ndarray, float]:
    """
    The city's rim, by two independent signals.

    Percentile alone misreads a city's shape: Mumbai is a narrow peninsula
    where most cells sit near a boundary, Bengaluru is broad. Grid perimeter
    alone misses the real GHSL boundary. A cell is outer if either says so.
    """
    cut = float(np.percentile(dist, 33))
    near = dist <= cut

    present = {(int(a), int(b)) for a, b in zip(x, y)}
    perimeter = np.array(
        [sum(((int(a) + dx, int(b) + dy) in present) for dx in (-1, 0, 1) for dy in (-1, 0, 1)) < 9
         for a, b in zip(x, y)],
        bool,
    )
    return near | perimeter, cut


def reverse_slots(idx: np.ndarray, count: np.ndarray) -> list[np.ndarray]:
    """
    For each cell, every (neighbour, slot) place its features are read from.

    The neighbour relation is symmetric, so changing cell i touches exactly the
    cells i can see. This table says where inside each of their context rows
    cell i's features live, which is what makes a what-if a patch rather than a
    rebuild.
    """
    n = len(count)
    pairs: list[list[tuple[int, int]]] = [[] for _ in range(n)]
    for j in range(n):
        for s in range(count[j]):
            pairs[idx[j, s]].append((j, s))
    return [np.array(p, np.int32).reshape(-1, 2) for p in pairs]


def build_city(cid: str, name: str, nets: list[dict], mean, std, published) -> dict:
    src = next(p for p in B.GRID.glob("*_ghsl_*.csv") if B.city_id(p) == cid)
    import pandas as pd

    df = pd.read_csv(src).reset_index(drop=True)
    n = len(df)
    x = df.x.to_numpy(np.int32)
    y = df.y.to_numpy(np.int32)
    pop = df.population.to_numpy(np.float32)
    green = df.green_cover_pct.to_numpy(np.float32)
    type_idx = df.type.map(B.TYPE_INDEX).to_numpy(np.int32)
    zone_idx = np.array([B.ZONE_TO_TYPE.index(t) for t in type_idx], np.int32)

    max_n = 81
    idx, off, count = B.neighbourhood(x, y, max_n)
    focal = B.focal_features(pop, green, type_idx, mean, std)
    neigh, mask = B.assemble(focal, idx, off, count)
    base = B.livability(nets, focal, neigh, mask)

    err = np.abs(base - published.loc[df.cell_id, "L_s"].to_numpy())
    print(f"  L_s vs published notebook: max err {err.max():.2e}, mean {err.mean():.2e}")
    assert err.max() < 1e-4, "forward pass disagrees with the published scores"

    outer, cut = outer_flags(x, y, df.dist_to_boundary_m.to_numpy(np.float32))
    print(f"  outer rim: {outer.sum()}/{n} cells (boundary cut {cut:.0f} m)")

    slots = reverse_slots(idx, count)
    fdim = focal.shape[1]

    # --- candidate search -------------------------------------------------
    cands = []
    for i in range(n):
        for z, zname in enumerate(ASSIGNABLE):
            if z == zone_idx[i]:
                continue
            limit = DISPLACEMENT_LIMIT.get(zname)
            if limit is not None and pop[i] > limit:
                continue
            cands.append((i, z))
    print(f"  {len(cands)} candidate changes", flush=True)

    results = []
    t0 = time.time()
    CHUNK = 48
    for lo in range(0, len(cands), CHUNK):
        batch = cands[lo:lo + CHUNK]
        fb, nb, mb, spans = [], [], [], []
        cursor = 0
        for i, z in batch:
            aff = idx[i, :count[i]]
            new_row = focal[i].copy()
            new_row[2:] = 0.0
            new_row[2 + B.ZONE_TO_TYPE[z]] = 1.0

            f = focal[aff].copy()
            g = neigh[aff].copy()
            f[aff == i] = new_row
            # Patch cell i's features wherever the affected cells read them.
            for j, s in slots[i]:
                hit = np.nonzero(aff == j)[0]
                if len(hit):
                    g[hit[0], s, :fdim] = new_row
            fb.append(f)
            nb.append(g)
            mb.append(mask[aff])
            spans.append((cursor, cursor + len(aff), aff))
            cursor += len(aff)

        after = B.livability(nets, np.concatenate(fb), np.concatenate(nb), np.concatenate(mb))
        for (i, z), (a, b, aff) in zip(batch, spans):
            delta = after[a:b] - base[aff]
            impact = float((pop[aff] * delta).sum())
            moved = np.abs(delta) > MOVED
            results.append({
                "cell": i, "to": z, "impact": impact,
                "selfDelta": float(after[a:b][aff == i][0] - base[i]),
                "people": int(pop[aff][moved].sum()),
                "cells": int(moved.sum()),
            })
        if lo % (CHUNK * 20) == 0:
            done = lo + len(batch)
            rate = done / max(time.time() - t0, 1e-9)
            print(f"    {done}/{len(cands)}  {rate:.0f}/s", flush=True)

    # --- rank, keeping the list varied and spread out ---------------------
    # Impact is population weighted, so a purely global ranking lands almost
    # everywhere the people are: Bengaluru's forty best changes were all
    # interior. That leaves the rim filter with nothing to show in the one city
    # whose sprawl makes the rim the interesting part. Reserving a share of the
    # list for rim cells keeps both views honest — each group is still ordered
    # by its own impact, nothing is promoted above a change that beats it
    # within the same view.
    results.sort(key=lambda r: -r["impact"])
    chosen, per_transition, placed = [], {}, []

    def take(pool, quota: int) -> None:
        for r in pool:
            if len(chosen) >= quota:
                return
            if r["impact"] < MIN_IMPACT:
                return
            i = r["cell"]
            if any(c["cell"] == i for c in chosen):
                continue
            key = (int(zone_idx[i]), r["to"])
            if per_transition.get(key, 0) >= MAX_PER_TRANSITION:
                continue
            if any(max(abs(x[i] - x[p]), abs(y[i] - y[p])) < MIN_SEPARATION for p in placed):
                continue
            chosen.append(r)
            per_transition[key] = per_transition.get(key, 0) + 1
            placed.append(i)

    take([r for r in results if outer[r["cell"]]], RIM_QUOTA)
    take(results, LIMIT)
    chosen.sort(key=lambda r: -r["impact"])

    print(f"  {len(chosen)} proposals, {sum(1 for c in chosen if outer[c['cell']])} on the rim")

    lats = df.centroid_lat.to_numpy()
    lons = df.centroid_lon.to_numpy()

    # The source grid is regular in Mollweide, not in degrees, so a cell's
    # longitude drifts slightly from row to row. Taking the step from the
    # sorted unique values therefore measures that drift, not the cell — it
    # read 0.0003 deg for Mumbai, thirty times too narrow, and the map drew
    # the grid as a field of vertical threads. Stepping along one axis at a
    # time, and dividing by the grid distance actually covered, measures the
    # cell itself.
    def axis_step(along: np.ndarray, across: np.ndarray, deg: np.ndarray) -> float:
        steps = []
        for key in np.unique(across):
            sel = np.nonzero(across == key)[0]
            sel = sel[np.argsort(along[sel])]
            da, dd = np.diff(along[sel]), np.diff(deg[sel])
            steps.extend((dd[da > 0] / da[da > 0]).tolist())
        return float(np.median(steps))

    d_lon = axis_step(x, y, lons)
    d_lat = axis_step(y, x, lats)

    return {
        "id": name.lower().replace(" ", "-"),
        "name": name,
        "country": B.COUNTRY[name],
        "ghslId": cid,
        "zones": B.ZONES,
        "cellKm": 1,
        "radius": int(B.RADIUS),
        "cellSize": [round(abs(d_lat), 7), round(abs(d_lon), 7)],
        "gridSize": [int(x.max() - x.min() + 1), int(y.max() - y.min() + 1)],
        "origin": [int(x.min()), int(y.min())],
        "center": [round(float(lats.mean()), 5), round(float(lons.mean()), 5)],
        "bounds": [
            [round(float(lats.min()) - abs(d_lat) / 2, 5), round(float(lons.min()) - abs(d_lon) / 2, 5)],
            [round(float(lats.max()) + abs(d_lat) / 2, 5), round(float(lons.max()) + abs(d_lon) / 2, 5)],
        ],
        "population": int(pop.sum()),
        "outerCut": round(cut),
        "meanL": round(float(base.mean()), 4),
        "medianL": round(float(np.median(base)), 4),
        # One flat tuple per cell, in the order the decoder expects.
        # Population keeps four decimals because it is a model input, not a
        # label: the browser re-derives L_s from log(1+P), and rounding it to
        # whole people moved the score by as much as 0.014 on sparse cells.
        "cells": [
            [int(x[i]), int(y[i]), round(float(lats[i]), 5), round(float(lons[i]), 5),
             round(float(pop[i]), 4), int(zone_idx[i]), round(float(green[i]), 1),
             round(float(df.elevation_m[i]), 1), round(float(df.dist_to_boundary_m[i])),
             round(float(base[i]), 5), int(outer[i])]
            for i in range(n)
        ],
        "proposals": [
            {"cell": f"{x[c['cell']]}:{y[c['cell']]}", "from": int(zone_idx[c["cell"]]),
             "to": c["to"], "impact": round(c["impact"]), "dL": round(c["selfDelta"], 5),
             "people": c["people"], "cells": c["cells"], "outer": int(outer[c["cell"]])}
            for c in chosen
        ],
    }


def export_model(nets: list[dict], mean, std, max_n: int) -> None:
    """Weights as one float32 blob, plus the shapes needed to read it back."""
    OUT_MODEL.mkdir(parents=True, exist_ok=True)
    order = ["q_w", "q_b", "kv_w", "kv_b", "aq_w", "aq_b", "ak_w", "ak_b",
             "av_w", "av_b", "ao_w", "ao_b", "fp_w", "fp_b", "d1_w", "d1_b",
             "d2_w", "d2_b", "out_w", "out_b"]
    blob, layout = [], []
    offset = 0
    for w in nets:
        for key in order:
            t = np.ascontiguousarray(w[key], np.float32)
            blob.append(t.ravel())
            if len(layout) < len(order):
                layout.append({"name": key, "shape": list(t.shape)})
            offset += t.size
    data = np.concatenate(blob).astype(np.float32)
    (OUT_MODEL / "livability.bin").write_bytes(data.tobytes())
    (OUT_MODEL / "livability.json").write_text(json.dumps({
        "formula": "L_s = mean_m sigmoid(g_theta_m(x_s, H_s))",
        "source": "FORMULA_SUMMARY.md",
        "seeds": list(B.SEEDS),
        "radius": B.RADIUS,
        "heads": B.HEADS,
        "keyDim": B.KEY_DIM,
        "maxNeighbors": max_n,
        "focalDim": 2 + len(B.TYPE_CLASSES),
        "typeClasses": list(B.TYPE_CLASSES),
        "zones": B.ZONES,
        "zoneToType": B.ZONE_TO_TYPE,
        "scaler": {"mean": [float(m) for m in mean], "std": [float(s) for s in std]},
        "layout": layout,
        "perSeedFloats": int(data.size // len(nets)),
    }, indent=2))
    print(f"model: {data.size:,} floats, {data.nbytes/1024:.0f} KB")


def main() -> None:
    import pandas as pd

    cells, model_ids = B.load_cells()
    mean, std = B.fit_scaler(cells, model_ids)
    nets = B.load_weights()
    published = pd.read_csv(B.WEIGHTS / "target_livability_scores.csv").set_index("cell_id")

    export_model(nets, mean, std, 81)

    OUT_CITIES.mkdir(parents=True, exist_ok=True)
    for stale in OUT_CITIES.glob("*.json"):
        stale.unlink()

    index = []
    for cid, name in B.TARGETS.items():
        print(f"\n{name}")
        city = build_city(cid, name, nets, mean, std, published)
        (OUT_CITIES / f"{city['id']}.json").write_text(json.dumps(city, separators=(",", ":")))
        size = (OUT_CITIES / f"{city['id']}.json").stat().st_size / 1024
        print(f"  wrote {city['id']}.json  {size:.0f} KB")
        index.append({
            "id": city["id"], "name": city["name"], "country": city["country"],
            "center": city["center"], "bounds": city["bounds"],
            "cells": len(city["cells"]), "population": city["population"],
            "proposals": len(city["proposals"]), "meanL": city["meanL"],
        })

    (OUT_CITIES / "index.json").write_text(json.dumps({"cities": index}, indent=2))
    print(f"\nindex.json -> {[c['id'] for c in index]}")


if __name__ == "__main__":
    main()

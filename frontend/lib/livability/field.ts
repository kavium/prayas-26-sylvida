/**
 * A city's livability field, and what a rezoning does to it.
 *
 * Every cell within five of a change gets a new score, because the networks
 * read a cell together with its five-cell neighbourhood. The relation is
 * symmetric — the cells that can see cell i are exactly the cells i can see —
 * so a what-if touches a known window of at most 81 cells rather than the
 * whole grid.
 *
 * Two algebraic shortcuts make that window cheap enough to recompute while a
 * planner is still holding the mouse down. Both are exact, not approximations:
 *
 *   1. The neighbour projection's input is [x_j, dx/5, dy/5, d/5]. The first
 *      part depends only on which cell j is, the second only on where it sits
 *      relative to the focal cell — and there are only 81 such offsets in the
 *      whole city. So both halves are projected once and added per slot.
 *
 *   2. Attention never needs K or V materialised. With Q_h fixed for the cell,
 *      Q_h . (kv_j W_K) = (W_K Q_h) . kv_j, so one 48-vector replaces 81 matrix
 *      products; and because the attention weights sum to one, the context is
 *      (sum_j a_j kv_j) W_V + b_V rather than a weighted sum of 81 projections.
 *
 * Together they take a window rescore from roughly 100M multiply-adds to 12M.
 */

import type { City, Zone } from "@/lib/zoning/types";
import { ZONES } from "@/lib/zoning/types";

import { gelu, type LivabilityModel, type Net } from "./model";

const HID = 48;
/** A cell's score has to move by this much to count as affected. */
export const MOVED = 1e-4;

export interface Field {
  model: LivabilityModel;
  n: number;
  population: Float32Array;
  /** Current zone per cell, in wire order. Mutated by `commit`. */
  zone: Uint8Array;
  /** x_s per cell, n x focalDim. */
  focal: Float32Array;
  /** Neighbour cell indices, n x maxNeighbors, padded with -1. */
  nbrIdx: Int32Array;
  /** Which of the 81 relative offsets each slot uses. */
  nbrRel: Int32Array;
  nbrCount: Int32Array;
  /** L_s as published, never mutated. */
  base: Float64Array;
  /** L_s under the working plan. */
  live: Float64Array;
  /** Per seed: the neighbour projection's contribution from x_j alone. */
  xproj: Float32Array[];
  /** Per seed: its contribution from the relative offset, bias included. */
  relproj: Float32Array[];
  scratch: Scratch;
}

interface Scratch {
  q: Float32Array;
  fp: Float32Array;
  kv: Float32Array;
  qh: Float32Array;
  u: Float32Array;
  attn: Float32Array;
  kbar: Float32Array;
  ctxHead: Float32Array;
  ctx: Float32Array;
  h1: Float32Array;
  h2: Float32Array;
  h3: Float32Array;
}

/** What a single rezoning does to the neighbourhood around it. */
export interface Impact {
  cell: number;
  from: Zone;
  to: Zone;
  /** Cells whose score moved, the changed cell first. */
  affected: Int32Array;
  before: Float64Array;
  after: Float64Array;
  /** I_j = P_j (L_j after - L_j before), parallel to `affected`. */
  perCell: Float64Array;
  /** Sum of I_j across the window. The headline number. */
  impact: number;
  /** Residents living on the cells that moved. */
  people: number;
  /** The changed cell's own score change. */
  dL: number;
}

/* --- construction --------------------------------------------------------- */

export function buildField(
  city: City,
  model: LivabilityModel,
  base: Float64Array,
): Field {
  const { meta, nets } = model;
  const n = city.cells.length;
  const F = meta.focalDim;
  const M = meta.maxNeighbors;
  const R = meta.radius;

  const population = new Float32Array(n);
  const zone = new Uint8Array(n);
  const focal = new Float32Array(n * F);
  const [mp, mg] = meta.scaler.mean;
  const [sp, sg] = meta.scaler.std;

  for (let i = 0; i < n; i += 1) {
    const c = city.cells[i];
    population[i] = c.population;
    const z = ZONES.indexOf(c.baseZone);
    zone[i] = z < 0 ? ZONES.length - 1 : z;
    focal[i * F] = (Math.log1p(c.population) - mp) / sp;
    focal[i * F + 1] = (c.greenCover - mg) / sg;
    focal[i * F + 2 + meta.zoneToType[zone[i]]] = 1;
  }

  // The 81 integer offsets inside Euclidean radius 5, keyed so a slot can name
  // one in constant time.
  const relTable: number[][] = [];
  const relKey = new Map<number, number>();
  for (let dy = -R; dy <= R; dy += 1) {
    for (let dx = -R; dx <= R; dx += 1) {
      if (dx * dx + dy * dy > R * R + 1e-6) continue;
      relKey.set((dx + R) * 32 + (dy + R), relTable.length);
      relTable.push([dx / R, dy / R, Math.hypot(dx, dy) / R]);
    }
  }

  // Cells are hashed by grid coordinate so each neighbourhood is an 11x11
  // probe rather than a scan of the whole city.
  const at = new Map<number, number>();
  for (let i = 0; i < n; i += 1) at.set(city.cells[i].x * 100000 + city.cells[i].y, i);

  const nbrIdx = new Int32Array(n * M).fill(-1);
  const nbrRel = new Int32Array(n * M);
  const nbrCount = new Int32Array(n);
  const found: { i: number; d: number; rel: number }[] = [];

  for (let i = 0; i < n; i += 1) {
    const { x, y } = city.cells[i];
    found.length = 0;
    for (let dy = -R; dy <= R; dy += 1) {
      for (let dx = -R; dx <= R; dx += 1) {
        const d2 = dx * dx + dy * dy;
        if (d2 > R * R + 1e-6) continue;
        const j = at.get((x + dx) * 100000 + (y + dy));
        if (j === undefined) continue;
        found.push({ i: j, d: Math.sqrt(d2), rel: relKey.get((dx + R) * 32 + (dy + R))! });
      }
    }
    // Nearest first, ties by cell index — the ordering the build script's
    // stable argsort produces. Masking is positional, so this has to match.
    found.sort((a, b) => a.d - b.d || a.i - b.i);
    for (let k = 0; k < found.length; k += 1) {
      nbrIdx[i * M + k] = found[k].i;
      nbrRel[i * M + k] = found[k].rel;
    }
    nbrCount[i] = found.length;
  }

  const xproj = nets.map(() => new Float32Array(n * HID));
  const relproj = nets.map(() => new Float32Array(relTable.length * HID));
  for (let s = 0; s < nets.length; s += 1) {
    const net = nets[s];
    for (let r = 0; r < relTable.length; r += 1) {
      const out = relproj[s].subarray(r * HID, r * HID + HID);
      out.set(net.kv_b);
      for (let k = 0; k < 3; k += 1) {
        const v = relTable[r][k];
        const row = (F + k) * HID;
        for (let o = 0; o < HID; o += 1) out[o] += v * net.kv_w[row + o];
      }
    }
  }

  const field: Field = {
    model,
    n,
    population,
    zone,
    focal,
    nbrIdx,
    nbrRel,
    nbrCount,
    base,
    live: Float64Array.from(base),
    xproj,
    relproj,
    scratch: {
      q: new Float32Array(HID),
      fp: new Float32Array(HID),
      kv: new Float32Array(M * HID),
      qh: new Float32Array(meta.keyDim),
      u: new Float32Array(HID),
      attn: new Float32Array(M),
      kbar: new Float32Array(HID),
      ctxHead: new Float32Array(meta.heads * meta.keyDim),
      ctx: new Float32Array(HID),
      h1: new Float32Array(4 * HID),
      h2: new Float32Array(64),
      h3: new Float32Array(32),
    },
  };

  for (let i = 0; i < n; i += 1) refreshProjection(field, i);
  return field;
}

/** Recomputes the cached x_j projection for one cell, after its zone changed. */
function refreshProjection(field: Field, i: number): void {
  const F = field.model.meta.focalDim;
  for (let s = 0; s < field.model.nets.length; s += 1) {
    const w = field.model.nets[s].kv_w;
    const out = field.xproj[s];
    const at = i * HID;
    out.fill(0, at, at + HID);
    for (let f = 0; f < F; f += 1) {
      const v = field.focal[i * F + f];
      if (v === 0) continue;
      const row = f * HID;
      for (let o = 0; o < HID; o += 1) out[at + o] += v * w[row + o];
    }
  }
}

/* --- the forward pass ----------------------------------------------------- */

function dense(
  input: Float32Array,
  inDim: number,
  weight: Float32Array,
  bias: Float32Array,
  outDim: number,
  out: Float32Array,
): void {
  out.set(bias);
  for (let i = 0; i < inDim; i += 1) {
    const v = input[i];
    if (v === 0) continue;
    const row = i * outDim;
    for (let o = 0; o < outDim; o += 1) out[o] += v * weight[row + o];
  }
}

function seedScore(field: Field, net: Net, s: number, i: number): number {
  const { meta } = field.model;
  const { heads: H, keyDim: D, focalDim: F, maxNeighbors: M } = meta;
  const sc = field.scratch;
  const count = field.nbrCount[i];
  const focalRow = field.focal.subarray(i * F, i * F + F);

  dense(focalRow, F, net.q_w, net.q_b, HID, sc.q);
  for (let o = 0; o < HID; o += 1) sc.q[o] = gelu(sc.q[o]);
  dense(focalRow, F, net.fp_w, net.fp_b, HID, sc.fp);
  for (let o = 0; o < HID; o += 1) sc.fp[o] = gelu(sc.fp[o]);

  const xp = field.xproj[s];
  const rp = field.relproj[s];
  for (let k = 0; k < count; k += 1) {
    const a = field.nbrIdx[i * M + k] * HID;
    const b = field.nbrRel[i * M + k] * HID;
    const out = k * HID;
    for (let o = 0; o < HID; o += 1) sc.kv[out + o] = gelu(xp[a + o] + rp[b + o]);
  }

  const HD = H * D;
  const scale = 1 / Math.sqrt(D);

  for (let h = 0; h < H; h += 1) {
    // Q_h for this cell.
    for (let d = 0; d < D; d += 1) sc.qh[d] = net.aq_b[h * D + d];
    for (let f = 0; f < HID; f += 1) {
      const v = sc.q[f];
      if (v === 0) continue;
      const row = f * HD + h * D;
      for (let d = 0; d < D; d += 1) sc.qh[d] += v * net.aq_w[row + d];
    }

    // W_K Q_h, so each neighbour's score is one 48-dot instead of a projection.
    let bias = 0;
    for (let d = 0; d < D; d += 1) bias += sc.qh[d] * net.ak_b[h * D + d];
    for (let f = 0; f < HID; f += 1) {
      let acc = 0;
      const row = f * HD + h * D;
      for (let d = 0; d < D; d += 1) acc += net.ak_w[row + d] * sc.qh[d];
      sc.u[f] = acc;
    }

    let max = -Infinity;
    for (let k = 0; k < count; k += 1) {
      let dot = bias;
      const at = k * HID;
      for (let f = 0; f < HID; f += 1) dot += sc.kv[at + f] * sc.u[f];
      const v = dot * scale;
      sc.attn[k] = v;
      if (v > max) max = v;
    }
    let sum = 0;
    for (let k = 0; k < count; k += 1) {
      const e = Math.exp(sc.attn[k] - max);
      sc.attn[k] = e;
      sum += e;
    }

    // Attention weights sum to one, so the value projection can be applied
    // once to their weighted mean instead of 81 times.
    sc.kbar.fill(0);
    for (let k = 0; k < count; k += 1) {
      const a = sc.attn[k] / sum;
      const at = k * HID;
      for (let f = 0; f < HID; f += 1) sc.kbar[f] += a * sc.kv[at + f];
    }
    for (let d = 0; d < D; d += 1) sc.ctxHead[h * D + d] = net.av_b[h * D + d];
    for (let f = 0; f < HID; f += 1) {
      const v = sc.kbar[f];
      if (v === 0) continue;
      const row = f * HD + h * D;
      for (let d = 0; d < D; d += 1) sc.ctxHead[h * D + d] += v * net.av_w[row + d];
    }
  }

  sc.ctx.set(net.ao_b);
  for (let k = 0; k < HD; k += 1) {
    const v = sc.ctxHead[k];
    if (v === 0) continue;
    const row = k * HID;
    for (let o = 0; o < HID; o += 1) sc.ctx[o] += v * net.ao_w[row + o];
  }

  // u_s = [W_F x_s, c_s, |W_F x_s - c_s|, (W_F x_s) (*) c_s]
  for (let f = 0; f < HID; f += 1) {
    const a = sc.fp[f];
    const b = sc.ctx[f];
    sc.h1[f] = a;
    sc.h1[HID + f] = b;
    sc.h1[2 * HID + f] = Math.abs(a - b);
    sc.h1[3 * HID + f] = a * b;
  }

  dense(sc.h1, 4 * HID, net.d1_w, net.d1_b, 64, sc.h2);
  for (let o = 0; o < 64; o += 1) sc.h2[o] = gelu(sc.h2[o]);
  dense(sc.h2, 64, net.d2_w, net.d2_b, 32, sc.h3);
  for (let o = 0; o < 32; o += 1) sc.h3[o] = gelu(sc.h3[o]);

  let z = net.out_b[0];
  for (let o = 0; o < 32; o += 1) z += sc.h3[o] * net.out_w[o];
  return 1 / (1 + Math.exp(-z));
}

/** L_s for one cell: the three networks averaged. */
export function score(field: Field, i: number): number {
  const nets = field.model.nets;
  let sum = 0;
  for (let s = 0; s < nets.length; s += 1) sum += seedScore(field, nets[s], s, i);
  return sum / nets.length;
}

/* --- what-ifs ------------------------------------------------------------- */

function setZone(field: Field, i: number, zoneIdx: number): void {
  const F = field.model.meta.focalDim;
  field.zone[i] = zoneIdx;
  field.focal.fill(0, i * F + 2, i * F + F);
  field.focal[i * F + 2 + field.model.meta.zoneToType[zoneIdx]] = 1;
  refreshProjection(field, i);
}

function measure(field: Field, i: number, from: Zone, to: Zone): Impact {
  const M = field.model.meta.maxNeighbors;
  const count = field.nbrCount[i];
  const idx: number[] = [];
  const before: number[] = [];
  const after: number[] = [];
  const perCell: number[] = [];
  let impact = 0;
  let people = 0;
  let dL = 0;

  for (let k = 0; k < count; k += 1) {
    const j = field.nbrIdx[i * M + k];
    const was = field.live[j];
    const now = score(field, j);
    if (j === i) dL = now - was;
    if (Math.abs(now - was) <= MOVED) continue;
    const contribution = field.population[j] * (now - was);
    idx.push(j);
    before.push(was);
    after.push(now);
    perCell.push(contribution);
    impact += contribution;
    people += field.population[j];
  }

  return {
    cell: i,
    from,
    to,
    affected: Int32Array.from(idx),
    before: Float64Array.from(before),
    after: Float64Array.from(after),
    perCell: Float64Array.from(perCell),
    impact,
    people: Math.round(people),
    dL,
  };
}

/** Scores a rezoning without keeping it. */
export function preview(field: Field, i: number, zone: Zone): Impact {
  const from = ZONES[field.zone[i]];
  const was = field.zone[i];
  setZone(field, i, ZONES.indexOf(zone));
  const result = measure(field, i, from, zone);
  setZone(field, i, was);
  return result;
}

/** Scores a rezoning and keeps it, so later what-ifs build on this one. */
export function commit(field: Field, i: number, zone: Zone): Impact {
  const from = ZONES[field.zone[i]];
  setZone(field, i, ZONES.indexOf(zone));
  const result = measure(field, i, from, zone);
  for (let k = 0; k < result.affected.length; k += 1) {
    field.live[result.affected[k]] = result.after[k];
  }
  return result;
}

/** Throws away every change and returns the field to the city as observed. */
export function resetField(field: Field, city: City): void {
  for (let i = 0; i < field.n; i += 1) {
    const z = ZONES.indexOf(city.cells[i].baseZone);
    if (field.zone[i] !== z) setZone(field, i, z < 0 ? ZONES.length - 1 : z);
  }
  field.live.set(field.base);
}

/**
 * Largest disagreement between this forward pass and the published scores,
 * over an evenly spaced sample.
 *
 * Cheap insurance: if the weights blob and the city file ever drift apart, the
 * scores on screen would be quietly wrong rather than obviously broken.
 */
export function drift(field: Field, samples = 48): number {
  let worst = 0;
  const step = Math.max(1, Math.floor(field.n / samples));
  for (let i = 0; i < field.n; i += step) {
    worst = Math.max(worst, Math.abs(score(field, i) - field.base[i]));
  }
  return worst;
}

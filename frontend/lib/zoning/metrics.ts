/**
 * City and neighbourhood readouts.
 *
 * The judgement of whether a cell is a good place to live is the networks',
 * not this file's — `lib/livability` holds that. What is left here is the
 * bookkeeping around it: which cells sit inside a given cell's neighbourhood,
 * what that neighbourhood is made of, and how the per-cell scores roll up into
 * the handful of city-level numbers the shell displays.
 *
 * The window is Euclidean radius 5, the same neighbourhood the networks read,
 * so the composition shown in the dossier is the composition the score
 * actually responded to.
 */

import type { City, CityScore, Zone } from "./types";

/**
 * A city plus its precomputed neighbourhood lists.
 *
 * Building the windows once turns every later readout into a flat loop.
 */
export interface Grid {
  city: City;
  /** Indices within Euclidean radius 5 of each cell, self first. */
  window: Int32Array[];
}

export function buildGrid(city: City): Grid {
  const r = city.radius;
  const window: Int32Array[] = new Array(city.cells.length);

  for (let i = 0; i < city.cells.length; i += 1) {
    const cell = city.cells[i];
    const ids: number[] = [i];
    for (let dy = -r; dy <= r; dy += 1) {
      for (let dx = -r; dx <= r; dx += 1) {
        if (dx === 0 && dy === 0) continue;
        if (dx * dx + dy * dy > r * r + 1e-6) continue;
        const j = city.index.get(`${cell.x + dx}:${cell.y + dy}`);
        if (j !== undefined) ids.push(j);
      }
    }
    window[i] = Int32Array.from(ids);
  }

  return { city, window };
}

/** Current zone of every cell, indexed like `city.cells`. */
export type Assignment = Zone[];

export function baseAssignment(city: City): Assignment {
  return city.cells.map((c) => c.baseZone);
}

/**
 * Population weight used everywhere a city-level average is taken.
 *
 * Empty cells are not weightless: a badly zoned empty cell at the fringe is
 * exactly the kind of thing this product exists to find. The floor keeps them
 * in the average without letting them dominate it.
 */
export function cellWeight(population: number): number {
  return Math.max(population, 120);
}

/** Score below which a cell's residents count as underserved. */
export const UNDERSERVED_BELOW = 0.45;

/**
 * Rolls per-cell L_s up into the city's headline figures.
 *
 * `live` is the working plan's scores and `base` the city as observed; the
 * impact total is the boxed I_s from FORMULA_SUMMARY.md summed over every
 * cell, so it reads as people multiplied by the score they gained.
 */
export function scoreCity(
  city: City,
  live: Float64Array,
  base: Float64Array,
): CityScore {
  let weighted = 0;
  let weight = 0;
  let outerWeighted = 0;
  let outerWeight = 0;
  let underserved = 0;
  let impact = 0;
  let changed = 0;

  for (let i = 0; i < city.cells.length; i += 1) {
    const cell = city.cells[i];
    const w = cellWeight(cell.population);
    weighted += live[i] * w;
    weight += w;
    if (cell.outer) {
      outerWeighted += live[i] * w;
      outerWeight += w;
    }
    if (live[i] < UNDERSERVED_BELOW) underserved += cell.population;
    const delta = live[i] - base[i];
    if (delta !== 0) {
      impact += cell.population * delta;
      changed += 1;
    }
  }

  return {
    livability: weighted / weight,
    outerLivability: outerWeight > 0 ? outerWeighted / outerWeight : 0,
    underserved: Math.round(underserved),
    impact,
    changed,
  };
}

/** Composition of a cell's radius-5 window, for the dossier. */
export function windowMix(
  grid: Grid,
  zones: Assignment,
  i: number,
): { zone: Zone; cells: number; share: number }[] {
  const counts = new Map<Zone, number>();
  const ids = grid.window[i];
  for (let k = 0; k < ids.length; k += 1) {
    const z = zones[ids[k]];
    counts.set(z, (counts.get(z) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([zone, cells]) => ({ zone, cells, share: cells / ids.length }))
    .sort((a, b) => b.cells - a.cells);
}

/** Residents inside a cell's radius-5 window, the cell included. */
export function windowPopulation(grid: Grid, i: number): number {
  let sum = 0;
  const ids = grid.window[i];
  for (let k = 0; k < ids.length; k += 1) sum += grid.city.cells[ids[k]].population;
  return sum;
}

/** Mean L_s across a cell's radius-5 window. */
export function windowLivability(
  grid: Grid,
  scores: Float64Array,
  i: number,
): number {
  let sum = 0;
  const ids = grid.window[i];
  for (let k = 0; k < ids.length; k += 1) sum += scores[ids[k]];
  return sum / ids.length;
}

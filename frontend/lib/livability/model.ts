/**
 * Loading the livability networks.
 *
 * `L_s` is the mean of three trained networks over a cell and every cell
 * within five of it (FORMULA_SUMMARY.md). The studio needs it live, not only
 * precomputed: the moment a planner tries a different zone, the honest answer
 * is what the real networks say about the whole neighbourhood, not an
 * interpolation between two cached numbers.
 *
 * So the weights ship as a flat float32 blob — 77,235 floats, 302 KB — and the
 * forward pass is written out in field.ts. scripts/build_livability.py runs the
 * same arithmetic in numpy and refuses to write a city file unless it
 * reproduces the published notebook scores.
 */

export interface ModelMeta {
  formula: string;
  source: string;
  seeds: number[];
  radius: number;
  heads: number;
  keyDim: number;
  maxNeighbors: number;
  focalDim: number;
  typeClasses: string[];
  zones: string[];
  /** Wire zone index -> the network's one-hot column. The two orders differ. */
  zoneToType: number[];
  scaler: { mean: number[]; std: number[] };
  layout: { name: string; shape: number[] }[];
  perSeedFloats: number;
}

/** One network's tensors, as views into the shared blob. */
export type Net = Record<string, Float32Array>;

export interface LivabilityModel {
  meta: ModelMeta;
  nets: Net[];
}

let pending: Promise<LivabilityModel> | null = null;

export function loadModel(): Promise<LivabilityModel> {
  if (pending) return pending;

  pending = Promise.all([
    fetch("/model/livability.json").then((r) => {
      if (!r.ok) throw new Error(`Livability model metadata unavailable (${r.status})`);
      return r.json() as Promise<ModelMeta>;
    }),
    fetch("/model/livability.bin").then((r) => {
      if (!r.ok) throw new Error(`Livability model weights unavailable (${r.status})`);
      return r.arrayBuffer();
    }),
  ])
    .then(([meta, buffer]) => {
      const all = new Float32Array(buffer);
      const expected = meta.seeds.length * meta.perSeedFloats;
      if (all.length !== expected) {
        throw new Error(
          `Livability weights are ${all.length} floats, expected ${expected}.`,
        );
      }
      const nets: Net[] = meta.seeds.map((_, seed) => {
        const net: Net = {};
        let at = seed * meta.perSeedFloats;
        for (const { name, shape } of meta.layout) {
          const size = shape.reduce((a, b) => a * b, 1);
          net[name] = all.subarray(at, at + size);
          at += size;
        }
        return net;
      });
      return { meta, nets };
    })
    .catch((error) => {
      pending = null;
      throw error;
    });

  return pending;
}

/**
 * Abramowitz & Stegun 7.1.26, absolute error below 1.5e-7.
 *
 * Keras' default gelu is the exact erf form, not the tanh approximation, and
 * the two differ by more than the tolerance the build script checks against.
 */
export function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-a * a);
  return sign * y;
}

export function gelu(x: number): number {
  return 0.5 * x * (1 + erf(x * Math.SQRT1_2));
}

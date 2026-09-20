/**
 * Domain model for zonal optimisation.
 *
 * One city is a 1 km grid of cells, each carrying a dominant land-use zone.
 * The product's job is to find the handful of cells whose zone is wrong for
 * where they sit, and to say what changing each one would do.
 *
 * Every field here traces back to a column in the pipeline's city-grid CSVs.
 * Nothing is invented at runtime.
 */

/** Wire order matches `ZONES` in scripts/build-city-data.py. Append only. */
export const ZONES = [
  "residential",
  "commercial",
  "office",
  "civic",
  "industrial",
  "utility",
  "green",
  "agricultural",
  "unbuilt",
] as const;

export type Zone = (typeof ZONES)[number];

/** Zones a proposal is allowed to assign. Unbuilt land is never a target. */
export const ASSIGNABLE_ZONES: Zone[] = [
  "residential",
  "commercial",
  "office",
  "civic",
  "industrial",
  "utility",
  "green",
];

export interface Cell {
  /** `${x}:${y}` — stable within a city, used as a React key and lookup key. */
  id: string;
  /** Column index in the source grid, increasing eastward. */
  x: number;
  /** Row index, increasing southward. */
  y: number;
  lat: number;
  lon: number;
  /** Modelled residents (GHS-POP 2025, 1 km cell). */
  population: number;
  /** Zone as observed by the pipeline. Never mutated. */
  baseZone: Zone;
  /** Percent of the cell under tree/vegetation cover. */
  greenCover: number;
  /** Metres above sea level at the cell centroid. */
  elevation: number;
  /** Metres from the cell centroid to the urban-centre boundary. */
  edgeDistance: number;
  /** 0-1. 1 = on the city's outer rim, 0 = deepest interior. */
  edgeness: number;
  /** L_s as published: the three networks' mean for this cell, 0-1. */
  livability: number;
  /**
   * On the city's outer rim — either on the grid perimeter or inside the
   * lowest third of boundary distances for this city. Percentile alone
   * misreads shape (Mumbai is a peninsula, Bengaluru is broad) and the grid
   * perimeter alone misses the real GHSL boundary, so a cell counts if either
   * test says so.
   */
  outer: boolean;
}

export interface City {
  id: string;
  name: string;
  country: string;
  ghslId: string;
  population: number;
  center: [number, number];
  bounds: [[number, number], [number, number]];
  /** Degrees of latitude and longitude spanned by one cell. */
  cellSize: [number, number];
  gridSize: [number, number];
  /** Grid cells the networks read around a focal cell. Always 5. */
  radius: number;
  /** Boundary distance, in metres, below which a cell counts as outer. */
  outerCut: number;
  /** Mean and median L_s across the city as observed. */
  meanLivability: number;
  medianLivability: number;
  cells: Cell[];
  /** Cell id -> index into `cells`. */
  index: Map<string, number>;
}

export interface CityListing {
  id: string;
  name: string;
  country: string;
  center: [number, number];
  bounds: [[number, number], [number, number]];
  cells: number;
  population: number;
  /** Changes the build found worth making. */
  proposals: number;
  meanLivability: number;
}

/* --- Scoring -------------------------------------------------------------- */

/**
 * City-level livability, all of it derived from L_s.
 *
 * There are no hand-written weights here. The networks learned what a
 * coherent neighbourhood looks like from ten model cities, and every figure
 * below is a different cut of their output.
 */
export interface CityScore {
  /** Population-weighted mean L_s, 0-1. The headline figure. */
  livability: number;
  /** The same average taken over outer-rim cells only. */
  outerLivability: number;
  /** Residents on cells scoring below 0.45. */
  underserved: number;
  /** Sum of I_s against the city as observed: people times score gained. */
  impact: number;
  /** Cells whose score has moved away from the observed plan. */
  changed: number;
}

/* --- Proposals ------------------------------------------------------------ */

/**
 * One rezoning the build found worth making.
 *
 * `impact` is the boxed quantity from FORMULA_SUMMARY.md summed over the
 * window a change reaches: I_s = P_s (L_s after - L_s before). It counts
 * people affected by the change, never the population's current livability.
 */
export interface Proposal {
  id: string;
  cellId: string;
  from: Zone;
  to: Zone;
  /** Sum of I_j over every cell within five whose score moves. */
  impact: number;
  /** The cell's own change in L_s, -1 to 1. */
  dL: number;
  /** Residents living on the cells that move. */
  people: number;
  /** How many cells move, out of at most 81. */
  cells: number;
  /** True when the cell sits on the city's outer rim. */
  outer: boolean;
  /** Rank by impact at build time, 1-based. */
  rank: number;
}

export type ProposalState = "open" | "applied" | "dismissed";

/* --- Map output modes ----------------------------------------------------- */

export type MapMode =
  | "zoning"
  | "proposed"
  | "livability"
  | "impact"
  | "density"
  | "green"
  | "edge";

/* --- Filters -------------------------------------------------------------- */

/**
 * Which flagged cells the map and worklist show.
 *
 * "all" is every cell the build says should change. "outer" narrows to the
 * rim, which is where a growing city still has room to decide what it becomes.
 */
export type ProposalFilter = "all" | "outer";

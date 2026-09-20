/**
 * Colour and motion tokens in JavaScript.
 *
 * The map draws to a raw canvas and cannot read Tailwind utilities, so these
 * values mirror the custom properties in app/globals.css. Change one, change
 * the other.
 *
 * The zone ramp is deliberately gouache rather than neon: the basemap is white
 * paper, and a printed zoning plan is the reference, not a heat map.
 */

import type { MapMode, Zone } from "./types";

export const zoneColor: Record<Zone, string> = {
  residential: "#d9a48e",
  commercial: "#e0b269",
  office: "#93a7cc",
  civic: "#a996c9",
  industrial: "#9a9188",
  utility: "#8b939d",
  green: "#8fb88c",
  agricultural: "#c7be86",
  unbuilt: "#c3c6ca",
};

export const zoneLabel: Record<Zone, string> = {
  residential: "Residential",
  commercial: "Commercial",
  office: "Office",
  civic: "Civic",
  industrial: "Industrial",
  utility: "Utility",
  green: "Green",
  agricultural: "Agricultural",
  unbuilt: "Unbuilt",
};

/** One line each, shown in the dossier and the proposal list. */
export const zoneBlurb: Record<Zone, string> = {
  residential: "Homes. Carries population and needs amenities within walking range.",
  commercial: "Shops and services. The thing a residential ring is usually missing.",
  office: "Workplaces. Dense daytime population, empty at night.",
  civic: "Schools, clinics, administration, culture. Public-facing floor space.",
  industrial: "Production and logistics. Heavy, and unpleasant to live beside.",
  utility: "Power, water, waste, depots. Necessary, hostile as a neighbour.",
  green: "Parks and open land. Raises green access for every cell around it.",
  agricultural: "Farmed land at the urban fringe.",
  unbuilt: "No dominant built land use observed.",
};

/** A darker edge for each wash, so cells stay separable on white paper. */
export function zoneStroke(zone: Zone): string {
  return shade(zoneColor[zone], -0.26);
}

export const chrome = {
  ground: "#14161a",
  shell: "#1a1d23",
  raised: "#212630",
  line: "#2c313b",
  hairline: "#23272f",
  ink: "#eef0f3",
  ink2: "#bcc3ce",
  ink3: "#9ba3b0",
  ink4: "#868e9b",
} as const;

export const signal = {
  flag: "#e4746c",
  gain: "#7fb98a",
  loss: "#d4796f",
  hold: "#d9b26a",
} as const;

export type AccentId = "periwinkle" | "clay" | "sage";

export const accents: Record<AccentId, { hex: string; label: string }> = {
  periwinkle: { hex: "#93b7dd", label: "Periwinkle" },
  clay: { hex: "#d59b6e", label: "Clay" },
  sage: { hex: "#9dbf95", label: "Sage" },
};

/**
 * Ramps for the analytical map modes. Five stops, sampled with linear
 * interpolation so a choropleth reads as a gradient, not as bands.
 *
 * All are sequential except `impact`, which is diverging: people can be worse
 * off after a change as easily as better, and a ramp that only climbs would
 * hide that. Its midpoint is zero, so the neutral stop means "nobody moved".
 */
const ramps: Record<Exclude<MapMode, "zoning" | "proposed">, string[]> = {
  livability: ["#c96f63", "#d99a63", "#d8c173", "#a8bf85", "#6fa98a"],
  impact: ["#b8574f", "#dda096", "#e9e7e2", "#a3c8a7", "#4f8f66"],
  density: ["#eef0ee", "#cfd8dd", "#9fb2c4", "#6d8bab", "#3c5f86"],
  green: ["#e6e2d6", "#cfd9bd", "#aec89f", "#87b383", "#5c9468"],
  edge: ["#f0ece4", "#dcc9a8", "#c8a077", "#b57457", "#9c4a3f"],
};

export function sampleRamp(mode: keyof typeof ramps, t: number): string {
  const stops = ramps[mode];
  const clamped = Math.min(1, Math.max(0, t));
  const scaled = clamped * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(scaled));
  return mix(stops[i], stops[i + 1], scaled - i);
}

export function rampStops(mode: keyof typeof ramps): string[] {
  return ramps[mode];
}

/* --- Colour maths --------------------------------------------------------- */

export function hexToRgb(hex: string): [number, number, number] {
  const v = hex.replace("#", "");
  return [
    parseInt(v.slice(0, 2), 16),
    parseInt(v.slice(2, 4), 16),
    parseInt(v.slice(4, 6), 16),
  ];
}

/**
 * Every colour this module hands out stays `#rrggbb`.
 *
 * `rgba()` below parses hex by character offset, so a helper that returned
 * `rgb(...)` fed it garbage: `rgba(NaN, 11, 32, 0.5)` is not a colour, and a
 * canvas given an unparseable `fillStyle` silently keeps the previous one
 * rather than throwing. Every analytical map mode painted one flat colour for
 * the whole grid because of it. Composing in hex keeps the helpers chainable.
 */
function toHex(r: number, g: number, b: number): string {
  const c = (x: number) => Math.min(255, Math.max(0, x)).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  const c = (x: number, y: number) => Math.round(x + (y - x) * t);
  return toHex(c(r1, r2), c(g1, g2), c(b1, b2));
}

/** Lightens on a positive amount, darkens on a negative one. */
export function shade(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  const to = amount < 0 ? 0 : 255;
  const t = Math.abs(amount);
  const c = (x: number) => Math.round(x + (to - x) * t);
  return toHex(c(r), c(g), c(b));
}

/* --- Motion --------------------------------------------------------------- */

/** Milliseconds. Bigger changes get more time to be read. */
export const duration = {
  micro: 140,
  control: 190,
  panel: 280,
  /** One pulse of the flagged cell. Four of these fill the two-second hold. */
  flagPulse: 500,
  /** The pause between flagging a cell from the city view and the dive. */
  flagHold: 2000,
  /** The dive onto a single cell. */
  dive: 1130,

  /* The switch: already down on one cell, sent to another. The camera rips
     back out, the screen blinks, and it dives again — so the hold between is
     one pulse, not four. */

  /** The rip back out to where both cells are visible. */
  ascend: 470,
  /** The cut at the top of the arc. */
  blink: 190,
  /** The pause on the new cell between the blink and the second dive. */
  switchHold: 620,
} as const;

export const ease = {
  out: "cubic-bezier(0.16, 1, 0.3, 1)",
  inOut: "cubic-bezier(0.65, 0, 0.35, 1)",
} as const;

/** Nothing invents its own z-index; it picks a layer from this list. */
export const z = {
  map: 0,
  mapOverlay: 10,
  panel: 20,
  chrome: 30,
  popover: 40,
  toast: 50,
  // Leaflet's own panes start at 200. Map-local controls sit above them.
  mapControl: 500,
} as const;

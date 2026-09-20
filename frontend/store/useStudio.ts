"use client";

/**
 * Studio state.
 *
 * One store for the whole shell: which city is loaded, what the plan currently
 * says, which proposals the planner has accepted, and where the camera is
 * being sent. Panels read from here and never talk to each other.
 *
 * Scores come from the livability networks, not from this file. A city ships
 * with every cell's published L_s and the changes the build's search found
 * worth making, so the studio opens on real numbers. From there the field
 * rescores live: accepting a change re-runs the networks over the 81 cells
 * within five of it, which takes about 40 ms.
 *
 * Accepting one change is replayed as the whole accepted set rather than
 * patched in, because two changes five cells apart share neighbours and their
 * effects do not add. Replaying from the observed city is the only answer that
 * stays honest as the plan grows.
 */

import { useMemo } from "react";
import { create } from "zustand";

import {
  type Field,
  type Impact,
  buildField,
  commit,
  drift,
  preview as previewChange,
  resetField,
} from "@/lib/livability/field";
import { loadModel } from "@/lib/livability/model";
import { cityProposals, loadCity, loadCityIndex } from "@/lib/zoning/city";
import {
  type Assignment,
  type Grid,
  baseAssignment,
  buildGrid,
  scoreCity,
} from "@/lib/zoning/metrics";
import { type AccentId, accents, duration } from "@/lib/zoning/palette";
import type {
  City,
  CityListing,
  CityScore,
  MapMode,
  Proposal,
  ProposalFilter,
  ProposalState,
  Zone,
} from "@/lib/zoning/types";

export type Phase = "idle" | "loading" | "ready" | "error";

/**
 * What the camera is doing with a flagged cell.
 *
 * Cold: flagging -> diving -> held. Switching from a cell the camera is
 * already down on: ascending -> flagging -> diving -> held, where the ascent
 * ends in a blink, so one cell hands off to the next in a single arc.
 */
export type FocusPhase = "ascending" | "flagging" | "diving" | "held";

export interface Focus {
  cellId: string;
  phase: FocusPhase;
  /** The cell being left behind, set only when this reveal is a switch. */
  from: string | null;
  /** Bumped on every reveal so a repeat click replays the sequence. */
  token: number;
}

export interface Settings {
  accent: AccentId;
  /** 0.25-1. Opacity of the zone wash over the basemap. */
  wash: number;
  /** Cell id labels on the map once zoomed in far enough. */
  labels: boolean;
  density: "comfortable" | "compact";
  /** "calm" disables the flag pulse and the dive, jumping instead. */
  motion: "full" | "calm";
}

export const DEFAULT_SETTINGS: Settings = {
  accent: "periwinkle",
  wash: 0.62,
  labels: true,
  density: "comfortable",
  motion: "full",
};

interface StudioState {
  phase: Phase;
  error: string | null;

  listings: CityListing[];
  city: City | null;
  grid: Grid | null;
  /** The networks, plus the neighbourhood tables that make a what-if cheap. */
  field: Field | null;

  /** The city as observed. Never mutated. */
  base: Assignment;
  /** The plan as edited. Base plus every applied proposal. */
  working: Assignment;

  baseScore: CityScore | null;
  score: CityScore | null;
  /** Published L_s per cell, indexed like `city.cells`. */
  baseLivability: Float64Array | null;
  /** L_s per cell under the working plan. */
  livability: Float64Array | null;

  proposals: Proposal[];
  proposalState: Record<string, ProposalState>;
  /** Whether the worklist and map show every flagged cell or only the rim. */
  filter: ProposalFilter;
  /** A rescore is in flight. Applying forty changes takes a moment. */
  busy: boolean;

  mode: MapMode;
  selected: string | null;
  hovered: string | null;
  /** A hypothetical zone for the selected cell, shown in the dossier. */
  preview: Zone | null;
  /** What the networks say that hypothetical would do. */
  previewImpact: Impact | null;
  focus: Focus | null;

  settings: Settings;

  init: () => Promise<void>;
  selectCity: (id: string) => Promise<void>;
  setFilter: (filter: ProposalFilter) => void;
  applyProposal: (id: string) => void;
  dismissProposal: (id: string) => void;
  restoreProposal: (id: string) => void;
  applyAll: () => void;
  resetPlan: () => void;
  /** Flags a cell, waits, then dives. The proposals list and Sylvy both use this. */
  reveal: (cellId: string) => void;
  advanceFocus: (phase: FocusPhase) => void;
  select: (cellId: string | null) => void;
  hover: (cellId: string | null) => void;
  setPreview: (zone: Zone | null) => void;
  setMode: (mode: MapMode) => void;
  setSettings: (patch: Partial<Settings>) => void;
}

let flagTimer: ReturnType<typeof setTimeout> | null = null;

const SETTINGS_KEY = "sylvida.settings";

function readSettings(): Settings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  // The camera flights are Leaflet's, not CSS, so the reduced-motion media
  // query cannot flatten them on its own — it has to land in the setting that
  // the flight code actually reads. A stored choice still wins.
  const base: Settings = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ? { ...DEFAULT_SETTINGS, motion: "calm" }
    : DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return base;
    return { ...base, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return base;
  }
}

/** Settings drive CSS custom properties, so the shell restyles without a rerender. */
function applySettings(s: Settings): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.style.setProperty("--accent", accents[s.accent].hex);
  root.style.setProperty("--wash", String(s.wash));
  root.dataset.density = s.density;
  root.dataset.motion = s.motion;
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // Private browsing. Settings stay for the session only.
  }
}

export const useStudio = create<StudioState>((set, get) => ({
  phase: "idle",
  error: null,

  listings: [],
  city: null,
  grid: null,
  field: null,
  base: [],
  working: [],
  baseScore: null,
  score: null,
  baseLivability: null,
  livability: null,

  proposals: [],
  proposalState: {},
  filter: "all",
  busy: false,

  mode: "zoning",
  selected: null,
  hovered: null,
  preview: null,
  previewImpact: null,
  focus: null,

  settings: DEFAULT_SETTINGS,

  async init() {
    if (get().phase !== "idle") return;
    const settings = readSettings();
    applySettings(settings);
    set({ phase: "loading", settings });
    try {
      const listings = await loadCityIndex();
      set({ listings });
      await get().selectCity(listings[0].id);
    } catch (err) {
      set({ phase: "error", error: describe(err) });
    }
  },

  async selectCity(id) {
    if (flagTimer) clearTimeout(flagTimer);
    set({
      phase: "loading",
      error: null,
      selected: null,
      hovered: null,
      preview: null,
      previewImpact: null,
      focus: null,
      proposals: [],
      proposalState: {},
    });
    try {
      const [city, model] = await Promise.all([loadCity(id), loadModel()]);
      const grid = buildGrid(city);
      const base = baseAssignment(city);
      const published = Float64Array.from(city.cells, (c) => c.livability);
      const field = buildField(city, model, published);

      // If the weights blob and the city file ever drift apart the scores
      // would be quietly wrong rather than obviously broken, so check a sample
      // against what the notebook published before trusting either.
      const worst = drift(field);
      if (worst > 1e-3) {
        console.warn(
          `Livability weights disagree with ${city.name}'s published scores by ${worst.toExponential(2)}. Rebuild public/model.`,
        );
      }

      const proposals = cityProposals(id);
      const proposalState: Record<string, ProposalState> = {};
      for (const p of proposals) proposalState[p.id] = "open";
      const baseScore = scoreCity(city, published, published);

      set({
        phase: "ready",
        city,
        grid,
        field,
        base,
        working: base,
        baseScore,
        score: baseScore,
        baseLivability: published,
        livability: Float64Array.from(published),
        proposals,
        proposalState,
      });
    } catch (err) {
      set({ phase: "error", error: describe(err) });
    }
  },

  setFilter(filter) {
    set({ filter });
  },

  applyProposal(id) {
    const { proposalState } = get();
    if (proposalState[id] === "applied") return;
    recompute(set, get, { ...proposalState, [id]: "applied" });
  },

  dismissProposal(id) {
    const { proposalState } = get();
    recompute(set, get, { ...proposalState, [id]: "dismissed" });
  },

  restoreProposal(id) {
    const { proposalState } = get();
    recompute(set, get, { ...proposalState, [id]: "open" });
  },

  applyAll() {
    const next = { ...get().proposalState };
    for (const p of get().proposals) {
      if (next[p.id] !== "dismissed") next[p.id] = "applied";
    }
    recompute(set, get, next);
  },

  resetPlan() {
    const next: Record<string, ProposalState> = {};
    for (const p of get().proposals) next[p.id] = "open";
    recompute(set, get, next);
  },

  reveal(cellId) {
    if (flagTimer) clearTimeout(flagTimer);
    const previous = get().focus;
    const token = (previous?.token ?? 0) + 1;
    const calm = get().settings.motion === "calm";

    if (calm) {
      set({
        selected: cellId,
        preview: null,
        previewImpact: null,
        focus: { cellId, from: null, phase: "diving", token },
      });
      return;
    }

    // Only a camera that has already left the city view has anywhere to climb
    // back from. A click during a flag hold has not moved yet, so it re-aims.
    const switching =
      !!previous &&
      previous.cellId !== cellId &&
      previous.phase !== "flagging";

    // Mid-ascent the focus already names where the camera is *going*, so the
    // cell it is climbing away from is the one recorded on that focus.
    const origin =
      previous?.phase === "ascending" ? previous.from ?? previous.cellId : previous?.cellId;

    set({
      selected: cellId,
      preview: null,
      previewImpact: null,
      focus: {
        cellId,
        from: switching ? origin ?? null : null,
        phase: switching ? "ascending" : "flagging",
        token,
      },
    });

    // The ascent ends on a moveend the map reports, so only the cold path
    // starts its own clock here.
    if (!switching) scheduleDive(set, get, token, duration.flagHold);
  },

  advanceFocus(phase) {
    const focus = get().focus;
    if (!focus) return;
    if (flagTimer) clearTimeout(flagTimer);
    set({ focus: { ...focus, phase } });
    // Landing on "flagging" out of an ascent: blink once, then go again.
    if (phase === "flagging") {
      scheduleDive(set, get, focus.token, duration.switchHold);
    }
  },

  select(cellId) {
    if (flagTimer) clearTimeout(flagTimer);
    set({ selected: cellId, preview: null, previewImpact: null, focus: null });
  },

  hover(cellId) {
    if (get().hovered !== cellId) set({ hovered: cellId });
  },

  setPreview(zone) {
    set({ preview: zone });
    set({ previewImpact: refreshPreview(get()) });
  },

  setMode(mode) {
    set({ mode });
  },

  setSettings(patch) {
    const settings = { ...get().settings, ...patch };
    applySettings(settings);
    set({ settings });
  },
}));

/**
 * Holds the flagged cell on screen, then sends the camera down.
 *
 * Guarded by the focus token so a click that lands mid-sequence cancels the
 * one before it instead of both firing.
 */
function scheduleDive(
  set: (partial: Partial<StudioState>) => void,
  get: () => StudioState,
  token: number,
  hold: number,
): void {
  if (flagTimer) clearTimeout(flagTimer);
  flagTimer = setTimeout(() => {
    const current = get().focus;
    if (!current || current.token !== token) return;
    set({ focus: { ...current, phase: "diving" } });
  }, hold);
}

/**
 * Rebuilds the working plan from the accepted proposals and rescores it.
 *
 * The replay is synchronous and can take a second when every change is
 * accepted, so the caller gets a frame to paint the working state first.
 */
function recompute(
  set: (partial: Partial<StudioState>) => void,
  get: () => StudioState,
  proposalState: Record<string, ProposalState>,
): void {
  const { city, field } = get();
  if (!city || !field) return;
  set({ proposalState, busy: true });

  setTimeout(() => {
    const state = get();
    if (!state.city || !state.field || state.proposalState !== proposalState) return;
    const accepted = state.proposals.filter((p) => proposalState[p.id] === "applied");

    resetField(state.field, state.city);
    const working = [...state.base];
    for (const proposal of accepted) {
      const i = state.city.index.get(proposal.cellId);
      if (i === undefined) continue;
      commit(state.field, i, proposal.to);
      working[i] = proposal.to;
    }

    const live = Float64Array.from(state.field.live);
    set({
      working,
      livability: live,
      score: scoreCity(state.city, live, state.field.base),
      busy: false,
      previewImpact: refreshPreview(get()),
    });
  }, 16);
}

/** The live what-if for whatever zone the dossier is currently trying on. */
function refreshPreview(state: StudioState): Impact | null {
  const { city, field, selected, preview } = state;
  if (!city || !field || !selected || !preview) return null;
  const i = city.index.get(selected);
  if (i === undefined) return null;
  return previewChange(field, i, preview);
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : "City data could not be loaded.";
}

/* --- Selectors ------------------------------------------------------------ */

export function useSelectedIndex(): number | null {
  return useStudio((s) => {
    if (!s.city || !s.selected) return null;
    return s.city.index.get(s.selected) ?? null;
  });
}

export function useAppliedCount(): number {
  return useStudio(
    (s) => s.proposals.filter((p) => s.proposalState[p.id] === "applied").length,
  );
}

/**
 * The proposals the worklist and the map should show.
 *
 * Derived rather than stored: the filter narrows what is visible, never what
 * the plan contains. A rim cell accepted while the filter is off stays in the
 * plan when the planner switches to rim-only, and the score keeps counting it.
 *
 * Memoised on the two inputs because zustand hands the selector's result to
 * `useSyncExternalStore`, which compares by identity — a fresh array on every
 * render would never settle.
 */
export function useVisibleProposals(): Proposal[] {
  const proposals = useStudio((s) => s.proposals);
  const filter = useStudio((s) => s.filter);
  return useMemo(
    () => (filter === "outer" ? proposals.filter((p) => p.outer) : proposals),
    [proposals, filter],
  );
}

"use client";

/**
 * The shell.
 *
 * Four regions, fixed: the bar names the city and the view, the left rail is
 * the worklist, the right rail is Sylvy, and the map with its dossier sits
 * between them. Nothing scrolls except the three lists, so the plan's headline
 * numbers never leave the screen.
 *
 * Below 1024px there is not enough width for three columns, so the rails and
 * the map become one switched view rather than being cut down.
 */

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { AlertTriangle, Columns3, Map as MapIcon, MessageSquare } from "lucide-react";

import { MapOverlays } from "@/components/map/MapOverlays";
import { useStudio } from "@/store/useStudio";

import { CellDossier } from "./CellDossier";
import { ProposalsPanel } from "./ProposalsPanel";
import { SylvyPanel } from "./Sylvy";
import { TopBar } from "./TopBar";

// Leaflet reads window at import time, so the map is client-only.
const PlanMap = dynamic(() => import("@/components/map/PlanMap").then((m) => m.PlanMap), {
  ssr: false,
  loading: () => <div className="absolute inset-0 paper" aria-hidden="true" />,
});

type Pane = "worklist" | "map" | "sylvy";

const PANES: { id: Pane; label: string; icon: typeof MapIcon }[] = [
  { id: "worklist", label: "Worklist", icon: Columns3 },
  { id: "map", label: "Map", icon: MapIcon },
  { id: "sylvy", label: "Sylvy", icon: MessageSquare },
];

export function StudioShell() {
  const init = useStudio((s) => s.init);
  const phase = useStudio((s) => s.phase);
  const error = useStudio((s) => s.error);
  const [pane, setPane] = useState<Pane>("map");

  useEffect(() => {
    void init();
  }, [init]);

  if (phase === "error") {
    return (
      <main className="grid h-screen place-items-center px-6">
        <div className="max-w-sm text-center">
          <AlertTriangle
            size={20}
            strokeWidth={1.8}
            className="mx-auto mb-3"
            style={{ color: "var(--color-flag)" }}
            aria-hidden="true"
          />
          <h1 className="display text-[19px] text-ink">The city grid did not load</h1>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-3">{error}</p>
          <p className="mt-3 text-[11.5px] leading-relaxed text-ink-4">
            The grids live in <span className="num">public/cities</span>. Rebuild them with{" "}
            <span className="num">python scripts/build-city-data.py</span>.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex h-screen flex-col overflow-hidden">
      <TopBar />

      <nav
        className="flex h-9 shrink-0 items-center gap-0.5 border-b border-hairline bg-shell px-2 lg:hidden"
        aria-label="Panel"
      >
        {PANES.map((p) => {
          const Icon = p.icon;
          const on = pane === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => setPane(p.id)}
              aria-pressed={on}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-[5px] py-1.5 text-[11.5px] transition-colors duration-150 ${
                on ? "bg-raised text-ink" : "text-ink-3"
              }`}
            >
              <Icon size={13} strokeWidth={2} aria-hidden="true" />
              {p.label}
            </button>
          );
        })}
      </nav>

      <div className="flex min-h-0 flex-1">
        <div
          className={`${pane === "worklist" ? "flex" : "hidden"} w-full min-w-0 lg:flex lg:w-[var(--rail-left)] lg:shrink-0`}
        >
          <div className="w-full min-w-0">
            <ProposalsPanel />
          </div>
        </div>

        <div
          className={`${pane === "map" ? "flex" : "hidden"} min-w-0 flex-1 flex-col lg:flex`}
        >
          <div className="relative min-h-0 flex-1">
            <PlanMap />
            <MapOverlays />
            <FlagToast />
            {phase === "loading" && <LoadingVeil />}
          </div>
          <CellDossier />
        </div>

        <div
          className={`${pane === "sylvy" ? "flex" : "hidden"} w-full min-w-0 lg:flex lg:w-[var(--rail-right)] lg:shrink-0`}
        >
          <div className="w-full min-w-0">
            <SylvyPanel />
          </div>
        </div>
      </div>
    </main>
  );
}

/** Names the cell being flagged during the two-second hold before the dive. */
function FlagToast() {
  const focus = useStudio((s) => s.focus);
  if (!focus || focus.phase !== "flagging") return null;
  return (
    <div
      className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-md border px-2.5 py-1.5 text-[11.5px] backdrop-blur-sm"
      style={{
        zIndex: 500,
        borderColor: "color-mix(in srgb, var(--color-flag) 45%, transparent)",
        background: "color-mix(in srgb, var(--color-flag) 16%, var(--color-shell))",
        color: "var(--color-ink)",
      }}
      role="status"
    >
      Holding on <span className="num">{focus.cellId}</span> — diving in
    </div>
  );
}

function LoadingVeil() {
  return (
    <div
      className="absolute inset-0 grid place-items-center bg-ground/45 backdrop-blur-[1px]"
      style={{ zIndex: 500 }}
      role="status"
    >
      <p className="rounded-md border border-hairline bg-shell px-3 py-2 text-[12px] text-ink-2">
        Reading the grid…
      </p>
    </div>
  );
}

"use client";

/**
 * Chrome that floats over the map: the key, the camera controls, and the
 * caption that names what is currently being flown to.
 *
 * These live outside the Leaflet element so they inherit the shell's type and
 * colour rather than Leaflet's defaults, and so they can be read by a screen
 * reader — the canvas itself is decorative.
 */

import { Crosshair, Minus, Plus } from "lucide-react";

import { people } from "@/lib/format";
import { rampStops, zoneColor, zoneLabel } from "@/lib/zoning/palette";
import { ZONES } from "@/lib/zoning/types";
import { useStudio } from "@/store/useStudio";

import { getMap } from "./handle";

const RAMP_CAPTION: Record<string, [string, string]> = {
  livability: ["0.0", "1.0"],
  impact: ["Worse off", "Better off"],
  density: ["Empty", "Dense"],
  green: ["Bare", "Wooded"],
  edge: ["City centre", "Outer rim"],
};

export function MapOverlays() {
  const mode = useStudio((s) => s.mode);
  const city = useStudio((s) => s.city);
  const proposals = useStudio((s) => s.proposals);
  const filter = useStudio((s) => s.filter);
  const shown = filter === "outer" ? proposals.filter((p) => p.outer).length : proposals.length;

  return (
    <>
      <div
        className="pointer-events-none absolute bottom-3 left-3 max-w-[260px] rounded-lg border border-hairline bg-shell/92 p-2.5 backdrop-blur-sm"
        style={{ zIndex: 500 }}
      >
        <p className="eyebrow mb-1.5">
          {mode === "zoning" && "Land use today"}
          {mode === "proposed" && "Proposed changes"}
          {mode === "livability" && "Livability, 0 to 1"}
          {mode === "impact" && "People impacted by the plan"}
          {mode === "density" && "Residents per km²"}
          {mode === "green" && "Tree cover"}
          {mode === "edge" && "Distance from the rim"}
        </p>

        {mode === "zoning" || mode === "proposed" ? (
          <ul className="grid grid-cols-2 gap-x-3 gap-y-0.5">
            {ZONES.map((zone) => (
              <li key={zone} className="flex items-center gap-1.5 text-[10.5px] text-ink-3">
                <span
                  className="h-2 w-2 shrink-0 rounded-[2px]"
                  style={{ background: zoneColor[zone] }}
                  aria-hidden="true"
                />
                {zoneLabel[zone]}
              </li>
            ))}
          </ul>
        ) : (
          <>
            <span
              className="block h-2 w-full rounded-[2px]"
              style={{
                background: `linear-gradient(90deg, ${rampStops(
                  mode as "livability" | "impact" | "density" | "green" | "edge",
                ).join(", ")})`,
              }}
              aria-hidden="true"
            />
            <p className="mt-1 flex justify-between text-[10.5px] text-ink-4">
              <span>{RAMP_CAPTION[mode]?.[0]}</span>
              <span>{RAMP_CAPTION[mode]?.[1]}</span>
            </p>
          </>
        )}

        {mode === "proposed" && (
          <p className="mt-1.5 border-t border-hairline pt-1.5 text-[10.5px] leading-tight text-ink-4">
            Outlined cells are the {shown} the search wants to change
            {filter === "outer" ? " on the rim" : ""}. Everything else is dimmed.
          </p>
        )}
        {mode === "impact" && (
          <p className="mt-1.5 border-t border-hairline pt-1.5 text-[10.5px] leading-tight text-ink-4">
            I<sub>s</sub> = residents &times; the livability the plan moved on their
            cell. Grey cells are ones no accepted change reached.
          </p>
        )}
      </div>

      {city && (
        <p
          className="pointer-events-none absolute bottom-3 right-3 text-[10.5px] text-ink-4"
          style={{ zIndex: 500 }}
        >
          <span className="num">{city.cells.length.toLocaleString("en-US")}</span> cells
          {" · "}
          {people(city.population)} residents
        </p>
      )}

      <div className="absolute right-3 top-3 flex flex-col gap-1" style={{ zIndex: 500 }}>
        <Control label="Zoom in" onClick={() => getMap()?.zoomIn()}>
          <Plus size={14} strokeWidth={2.2} aria-hidden="true" />
        </Control>
        <Control label="Zoom out" onClick={() => getMap()?.zoomOut()}>
          <Minus size={14} strokeWidth={2.2} aria-hidden="true" />
        </Control>
        <Control
          label="Frame the whole city"
          onClick={() => {
            const map = getMap();
            const current = useStudio.getState().city;
            if (!map || !current) return;
            useStudio.getState().select(null);
            // Array bounds rather than L.latLngBounds: importing Leaflet here
            // would pull it into the server bundle, where window does not exist.
            map.flyToBounds(current.bounds, { padding: [56, 56], duration: 0.9 });
          }}
        >
          <Crosshair size={14} strokeWidth={2.2} aria-hidden="true" />
        </Control>
      </div>
    </>
  );
}

function Control({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="grid h-8 w-8 place-items-center rounded-md border border-hairline bg-shell/92 text-ink-2 backdrop-blur-sm transition-colors duration-150 hover:border-line hover:text-ink"
    >
      {children}
    </button>
  );
}

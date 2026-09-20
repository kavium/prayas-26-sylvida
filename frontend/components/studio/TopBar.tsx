"use client";

/**
 * The top bar.
 *
 * Three fixed regions: what you are looking at (city), how you are looking at
 * it (map mode), and how the plan is doing (score). Settings sits hard right,
 * outside the reading order of the three, because it changes the room rather
 * than the work.
 */

import { useEffect, useRef, useState } from "react";
import {
  Building2,
  ChevronDown,
  Compass,
  Layers,
  Leaf,
  ScatterChart,
  TrendingUp,
  Sparkles,
  Users,
} from "lucide-react";

import { delta, impact, people, score } from "@/lib/format";
import type { MapMode } from "@/lib/zoning/types";
import { useAppliedCount, useStudio } from "@/store/useStudio";

import { SettingsMenu } from "./SettingsMenu";

const MODES: { id: MapMode; label: string; icon: typeof Layers; hint: string }[] = [
  { id: "zoning", label: "Zoning", icon: Layers, hint: "Land use as the city stands today" },
  { id: "proposed", label: "Proposed", icon: Sparkles, hint: "Only the cells the search wants to change" },
  { id: "livability", label: "Livability", icon: ScatterChart, hint: "Neural livability score, 0 to 1, per cell" },
  { id: "impact", label: "Impact", icon: TrendingUp, hint: "People helped or hurt by the accepted plan" },
  { id: "density", label: "Density", icon: Users, hint: "Residents per square kilometre" },
  { id: "green", label: "Green", icon: Leaf, hint: "Share of the cell under tree cover" },
  { id: "edge", label: "Edge", icon: Compass, hint: "Proximity to the city's outer boundary" },
];

export function TopBar() {
  const mode = useStudio((s) => s.mode);
  const setMode = useStudio((s) => s.setMode);
  const cityScore = useStudio((s) => s.score);
  const baseScore = useStudio((s) => s.baseScore);
  const applied = useAppliedCount();

  const change = cityScore && baseScore ? cityScore.livability - baseScore.livability : 0;

  return (
    <header
      className="relative flex h-[var(--top-h)] shrink-0 items-center gap-3 border-b border-hairline bg-shell px-3"
      style={{ zIndex: 30 }}
    >
      <Wordmark />
      <CityPicker />

      <nav
        className="mx-auto flex items-center gap-0.5 rounded-md border border-hairline bg-ground p-0.5"
        aria-label="Map output"
      >
        {MODES.map((m) => {
          const Icon = m.icon;
          const on = mode === m.id;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              title={m.hint}
              aria-pressed={on}
              className={`flex items-center gap-1.5 rounded-[5px] px-2.5 py-1.5 text-[11.5px] font-medium transition-colors duration-150 ${
                on
                  ? "bg-raised text-ink shadow-[inset_0_0_0_1px_var(--color-line)]"
                  : "text-ink-3 hover:bg-raised/60 hover:text-ink-2"
              }`}
            >
              <Icon
                size={13}
                strokeWidth={2}
                style={on ? { color: "var(--accent)" } : undefined}
                aria-hidden="true"
              />
              <span className="hidden 2xl:inline">{m.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="flex items-center gap-3">
        <dl className="hidden items-center gap-3 lg:flex">
          <div className="text-right">
            <dt className="eyebrow">Livability</dt>
            <dd className="num text-[15px] font-medium leading-none text-ink">
              {cityScore ? score(cityScore.livability) : "—"}
              {applied > 0 && (
                <span
                  className="ml-1.5 text-[11px]"
                  style={{ color: change >= 0 ? "var(--color-gain)" : "var(--color-loss)" }}
                >
                  {delta(change, 3)}
                </span>
              )}
            </dd>
          </div>
          <div className="h-7 w-px bg-hairline" aria-hidden="true" />
          <div className="text-right">
            <dt className="eyebrow">Impact</dt>
            <dd
              className="num text-[15px] font-medium leading-none"
              style={{
                color:
                  !cityScore || cityScore.impact === 0
                    ? "var(--color-ink-2)"
                    : cityScore.impact > 0
                      ? "var(--color-gain)"
                      : "var(--color-loss)",
              }}
            >
              {cityScore ? impact(cityScore.impact) : "—"}
            </dd>
          </div>
          <div className="h-7 w-px bg-hairline" aria-hidden="true" />
          <div className="text-right">
            <dt className="eyebrow">Underserved</dt>
            <dd className="num text-[15px] font-medium leading-none text-ink-2">
              {cityScore ? people(cityScore.underserved) : "—"}
            </dd>
          </div>
        </dl>
        <SettingsMenu />
      </div>
    </header>
  );
}

function Wordmark() {
  return (
    <div className="flex items-center gap-2 pr-1">
      <span
        className="grid h-6 w-6 place-items-center rounded-[5px] text-[13px] font-semibold"
        style={{ background: "var(--accent)", color: "var(--accent-ink)" }}
        aria-hidden="true"
      >
        S
      </span>
      <span className="display text-[17px] font-medium tracking-tight text-ink">
        Sylvida
      </span>
    </div>
  );
}

function CityPicker() {
  const listings = useStudio((s) => s.listings);
  const city = useStudio((s) => s.city);
  const selectCity = useStudio((s) => s.selectCity);
  const phase = useStudio((s) => s.phase);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={box} className="relative">
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={phase === "loading" && !city}
        className="flex items-center gap-1.5 rounded-md border border-hairline bg-ground px-2.5 py-1.5 text-[12px] text-ink transition-colors duration-150 hover:border-line disabled:opacity-50"
      >
        <Building2 size={13} strokeWidth={2} className="text-ink-3" aria-hidden="true" />
        <span className="max-w-[140px] truncate font-medium">
          {city?.name ?? "Loading"}
        </span>
        <ChevronDown size={13} strokeWidth={2} className="text-ink-4" aria-hidden="true" />
      </button>

      {open && (
        <ul
          aria-label="Cities"
          className="scroll absolute left-0 top-[calc(100%+6px)] max-h-[60vh] w-[248px] overflow-y-auto rounded-lg border border-line bg-raised p-1 shadow-[0_18px_44px_-12px_rgba(0,0,0,0.75)]"
          style={{ zIndex: 40 }}
        >
          {listings.map((l) => {
            const on = l.id === city?.id;
            return (
              <li key={l.id}>
                <button
                  type="button"
                  aria-current={on ? "true" : undefined}
                  onClick={() => {
                    setOpen(false);
                    if (!on) void selectCity(l.id);
                  }}
                  className={`flex w-full items-baseline justify-between gap-3 rounded-[5px] px-2.5 py-2 text-left transition-colors duration-150 ${
                    on ? "bg-shell" : "hover:bg-shell"
                  }`}
                >
                  <span>
                    <span
                      className="block text-[12.5px] font-medium"
                      style={{ color: on ? "var(--accent)" : "var(--color-ink)" }}
                    >
                      {l.name}
                    </span>
                    <span className="block text-[10.5px] text-ink-4">{l.country}</span>
                  </span>
                  <span className="num shrink-0 text-[10.5px] text-ink-3">
                    {people(l.population)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

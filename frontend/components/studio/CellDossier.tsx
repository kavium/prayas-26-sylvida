"use client";

/**
 * Bottom bar — the dossier for one cell.
 *
 * Reads left to right as an argument: this is the cell, this is what you would
 * change it to, this is what that does to the people inside five cells of it,
 * and this is the neighbourhood absorbing the change. The middle two columns
 * are live — they re-run the three networks over the window for whatever zone
 * you try in the chip row, not only the one the search proposed.
 *
 * The per-cell column is the honest part. A headline impact is a sum, and a
 * sum hides the cells a change makes worse; listing the movers by how many
 * residents each one carries puts the losers on screen next to the winners.
 */

import { useMemo } from "react";
import { ArrowRight, MousePointerClick } from "lucide-react";

import { count, impact as fmtImpact, people, score } from "@/lib/format";
import { preview as previewChange } from "@/lib/livability/field";
import { windowLivability, windowMix, windowPopulation } from "@/lib/zoning/metrics";
import { zoneColor, zoneLabel } from "@/lib/zoning/palette";
import { ASSIGNABLE_ZONES } from "@/lib/zoning/types";
import { useSelectedIndex, useStudio } from "@/store/useStudio";

export function CellDossier() {
  const index = useSelectedIndex();
  const grid = useStudio((s) => s.grid);
  const field = useStudio((s) => s.field);
  const working = useStudio((s) => s.working);
  const live = useStudio((s) => s.livability);
  const preview = useStudio((s) => s.preview);
  const setPreview = useStudio((s) => s.setPreview);
  const proposals = useStudio((s) => s.proposals);

  const report = useMemo(() => {
    if (!grid || !field || !live || index === null) return null;
    const cell = grid.city.cells[index];
    const current = working[index];
    const suggested = proposals.find((p) => p.cellId === cell.id);
    const target = preview ?? suggested?.to ?? current;

    // `previewChange` leaves the field untouched, so trying a zone here costs
    // one window rescore and nothing else in the shell moves.
    const trial = target === current ? null : previewChange(field, index, target);

    return {
      cell,
      current,
      target,
      trial,
      suggested,
      before: live[index],
      after: trial ? live[index] + trial.dL : live[index],
      mix: windowMix(grid, working, index),
      windowPeople: windowPopulation(grid, index),
      windowLive: windowLivability(grid, live, index),
      movers: trial ? topMovers(grid, trial) : [],
    };
  }, [grid, field, live, index, working, preview, proposals]);

  return (
    <section
      className="scroll flex h-[var(--dock-h)] shrink-0 overflow-x-auto border-t border-hairline bg-shell"
      aria-label="Selected cell"
    >
      {!report ? (
        <Empty />
      ) : (
        <>
          <Column title="Cell" className="w-[210px] shrink-0">
            <div className="flex items-baseline gap-2">
              <p className="num text-[19px] font-medium leading-none text-ink">
                {report.cell.id}
              </p>
              {report.cell.outer && (
                <span
                  className="rounded-[3px] px-1 py-px text-[10px] font-semibold uppercase tracking-wider"
                  style={{
                    background: "color-mix(in srgb, var(--color-hold) 18%, transparent)",
                    color: "var(--color-hold)",
                  }}
                >
                  Rim
                </span>
              )}
            </div>
            <p className="mt-1 flex items-center gap-1.5 text-[12px] text-ink-2">
              <span
                className="h-2.5 w-2.5 rounded-[2px]"
                style={{ background: zoneColor[report.current] }}
                aria-hidden="true"
              />
              {zoneLabel[report.current]} today
            </p>
            <dl className="mt-2.5 space-y-1">
              <Fact label="Residents" value={count(report.cell.population)} />
              <Fact label="Tree cover" value={`${report.cell.greenCover.toFixed(0)}%`} />
              <Fact label="Elevation" value={`${report.cell.elevation.toFixed(0)} m`} />
              <Fact
                label="From rim"
                value={`${(report.cell.edgeDistance / 1000).toFixed(1)} km`}
              />
            </dl>
          </Column>

          <Column title="Change it to" className="w-[190px] shrink-0">
            <div className="flex flex-wrap gap-1">
              {ASSIGNABLE_ZONES.map((zone) => {
                const on = zone === report.target;
                const isNow = zone === report.current;
                return (
                  <button
                    key={zone}
                    type="button"
                    onClick={() => setPreview(zone === report.target ? null : zone)}
                    aria-pressed={on}
                    className={`flex items-center gap-1 rounded-[4px] border px-1.5 py-1 text-[10.5px] transition-colors duration-150 ${
                      on
                        ? "border-line bg-raised text-ink"
                        : "border-transparent text-ink-3 hover:bg-raised"
                    }`}
                  >
                    <span
                      className="h-2 w-2 rounded-[2px]"
                      style={{ background: zoneColor[zone] }}
                      aria-hidden="true"
                    />
                    {zoneLabel[zone]}
                    {isNow && <span className="text-ink-4">·now</span>}
                  </button>
                );
              })}
            </div>
            {report.suggested && (
              <p className="mt-2 text-[10.5px] leading-tight text-ink-4">
                Sylvida ranks this{" "}
                <span className="num">#{report.suggested.rank}</span> and proposes{" "}
                <span style={{ color: "var(--accent)" }}>
                  {zoneLabel[report.suggested.to]}
                </span>
                , reaching{" "}
                <span className="num">{people(report.suggested.people)}</span> people.
              </p>
            )}
          </Column>

          <Column title="What that does" className="w-[250px] shrink-0">
            <div className="flex items-baseline gap-2">
              <span className="num text-[19px] font-medium leading-none text-ink">
                {score(report.before)}
              </span>
              <ArrowRight size={12} className="text-ink-4" aria-hidden="true" />
              <span
                className="num text-[19px] font-medium leading-none"
                style={{ color: tone(report.after - report.before) }}
              >
                {score(report.after)}
              </span>
              <span className="text-[10.5px] text-ink-4">livability here</span>
            </div>
            {report.trial ? (
              <dl className="mt-2.5 space-y-1">
                <Fact
                  label="People impacted"
                  value={people(report.trial.people)}
                />
                <Fact
                  label="Cells that move"
                  value={`${report.trial.affected.length} of 81`}
                />
                <Fact
                  label="Impact"
                  value={fmtImpact(report.trial.impact)}
                  tint={tone(report.trial.impact)}
                />
                <Fact
                  label="Window mean"
                  value={score(report.windowLive)}
                />
              </dl>
            ) : (
              <p className="mt-2.5 text-[10.5px] leading-relaxed text-ink-4">
                Nothing is being changed here. Pick a different zone above and the
                networks rescore the 81 cells within five of this one.
              </p>
            )}
          </Column>

          <Column title="Impact per cell" className="min-w-[300px] flex-1">
            {report.trial ? (
              <ul className="space-y-1">
                {report.movers.map((m) => (
                  <li key={m.id} className="flex items-center gap-2">
                    <span className="num w-[52px] shrink-0 text-[10.5px] text-ink-3">
                      {m.id}
                    </span>
                    <span className="num w-[54px] shrink-0 text-right text-[10.5px] text-ink-4">
                      {count(m.population)}
                    </span>
                    <ImpactBar value={m.impact} scale={report.movers[0]?.scale ?? 1} />
                    <span
                      className="num w-12 shrink-0 text-right text-[10.5px]"
                      style={{ color: tone(m.impact) }}
                    >
                      {fmtImpact(m.impact)}
                    </span>
                  </li>
                ))}
                {report.trial.affected.length > report.movers.length && (
                  <li className="pt-0.5 text-[10px] text-ink-4">
                    and {report.trial.affected.length - report.movers.length} more cells moving
                    less
                  </li>
                )}
              </ul>
            ) : (
              <>
                <p className="num text-[19px] font-medium leading-none text-ink">
                  {people(report.windowPeople)}
                </p>
                <p className="mt-1 text-[10.5px] text-ink-4">
                  residents within five cells, across{" "}
                  {report.mix.reduce((n, m) => n + m.cells, 0)} of them
                </p>
                <div
                  className="mt-2.5 flex h-2 overflow-hidden rounded-[2px]"
                  role="img"
                  aria-label={`Surrounding land use: ${report.mix
                    .map((m) => `${zoneLabel[m.zone]} ${Math.round(m.share * 100)}%`)
                    .join(", ")}`}
                >
                  {report.mix.map((m) => (
                    <span
                      key={m.zone}
                      style={{ background: zoneColor[m.zone], width: `${m.share * 100}%` }}
                    />
                  ))}
                </div>
                <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-0.5">
                  {report.mix.slice(0, 4).map((m) => (
                    <li key={m.zone} className="flex items-center gap-1.5 text-[10.5px]">
                      <span
                        className="h-2 w-2 shrink-0 rounded-[2px]"
                        style={{ background: zoneColor[m.zone] }}
                        aria-hidden="true"
                      />
                      <span className="truncate text-ink-3">{zoneLabel[m.zone]}</span>
                      <span className="num ml-auto text-ink-4">
                        {Math.round(m.share * 100)}%
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Column>
        </>
      )}
    </section>
  );
}

/**
 * The cells carrying the most of a change's impact, either direction.
 *
 * Ranked by magnitude so a cell the change hurts cannot be sorted off the
 * bottom of the list by a larger gain somewhere else.
 */
function topMovers(
  grid: { city: { cells: { id: string; population: number }[] } },
  trial: { affected: Int32Array; perCell: Float64Array },
  limit = 7,
): { id: string; population: number; impact: number; scale: number }[] {
  const rows = [];
  for (let k = 0; k < trial.affected.length; k += 1) {
    const cell = grid.city.cells[trial.affected[k]];
    rows.push({ id: cell.id, population: cell.population, impact: trial.perCell[k], scale: 1 });
  }
  rows.sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));
  const top = rows.slice(0, limit);
  const scale = Math.max(1, ...top.map((r) => Math.abs(r.impact)));
  for (const r of top) r.scale = scale;
  return top;
}

function Column({
  title,
  className = "",
  children,
}: {
  title: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`flex flex-col overflow-hidden border-r border-hairline px-3 py-2.5 last:border-r-0 ${className}`}
    >
      <p className="eyebrow mb-2">{title}</p>
      <div className="scroll min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}

function Fact({ label, value, tint }: { label: string; value: string; tint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="whitespace-nowrap text-[10.5px] text-ink-4">{label}</dt>
      <dd
        className="num shrink-0 text-[11px]"
        style={{ color: tint ?? "var(--color-ink-2)" }}
      >
        {value}
      </dd>
    </div>
  );
}

/** Zero-centred track: gains run right of the middle, losses left. */
function ImpactBar({ value, scale }: { value: number; scale: number }) {
  const width = (Math.min(Math.abs(value), scale) / scale) * 50;
  const gain = value >= 0;
  return (
    <span className="relative h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-ground">
      <span className="absolute inset-y-0 left-1/2 w-px bg-line" aria-hidden="true" />
      <span
        className="absolute inset-y-0 transition-[left,width] duration-200"
        style={{
          left: gain ? "50%" : `${50 - width}%`,
          width: `${width}%`,
          background: gain ? "var(--color-gain)" : "var(--color-loss)",
        }}
        aria-hidden="true"
      />
    </span>
  );
}

function tone(change: number): string {
  if (Math.abs(change) < 1e-6) return "var(--color-ink-2)";
  return change > 0 ? "var(--color-gain)" : "var(--color-loss)";
}

function Empty() {
  return (
    <div className="flex flex-1 items-center justify-center gap-2.5 px-4 text-center">
      <MousePointerClick size={15} strokeWidth={1.8} className="text-ink-4" aria-hidden="true" />
      <p className="text-[12px] text-ink-3">
        Pick a cell on the map, or a change from the worklist, to see what rezoning
        it would do to the people living there.
      </p>
    </div>
  );
}

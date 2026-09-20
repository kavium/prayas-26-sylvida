"use client";

/**
 * Left rail — the worklist.
 *
 * Every row is one cell the build's search wants to rezone, ordered by how
 * many people the change reaches. Clicking a row flags the cell on the map
 * and, two seconds later, dives onto it; accepting a row re-runs the networks
 * over the 81 cells within five of it and every score in the shell moves.
 *
 * The rim filter is the panel's main control. A city's interior is already
 * built and its changes are mostly repairs; the rim is where the next decade
 * of building will happen, and narrowing to it is the difference between a
 * maintenance list and a growth plan.
 */

import { ArrowRight, RotateCcw, Undo2, Users } from "lucide-react";

import { count, delta, impact as fmtImpact, people } from "@/lib/format";
import { zoneColor, zoneLabel } from "@/lib/zoning/palette";
import type { Proposal, ProposalFilter } from "@/lib/zoning/types";
import { useAppliedCount, useStudio, useVisibleProposals } from "@/store/useStudio";

const FILTERS: { id: ProposalFilter; label: string; hint: string }[] = [
  { id: "all", label: "All flagged", hint: "Every cell the search wants to rezone" },
  { id: "outer", label: "Outer rim", hint: "Only cells on the city's growing edge" },
];

export function ProposalsPanel() {
  const proposals = useVisibleProposals();
  const total = useStudio((s) => s.proposals.length);
  const states = useStudio((s) => s.proposalState);
  const busy = useStudio((s) => s.busy);
  const phase = useStudio((s) => s.phase);
  const filter = useStudio((s) => s.filter);
  const setFilter = useStudio((s) => s.setFilter);
  const applyAll = useStudio((s) => s.applyAll);
  const resetPlan = useStudio((s) => s.resetPlan);
  const achieved = useStudio((s) => s.score?.impact ?? 0);
  const applied = useAppliedCount();

  const open = proposals.filter((p) => states[p.id] === "open");
  // Windows overlap, so the open changes' impacts do not simply add. This is
  // the ceiling, and the figure beside it is what the plan has actually banked.
  const headroom = open.reduce((sum, p) => sum + p.impact, 0);

  return (
    <aside
      className="flex h-full min-h-0 flex-col border-r border-hairline bg-shell"
      aria-label="Proposed zone changes"
    >
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-hairline px-3">
        <h2 className="eyebrow">Worklist</h2>
        <span className="num text-[10.5px] text-ink-4">
          {applied} of {total} accepted
        </span>
      </div>

      <div className="shrink-0 border-b border-hairline px-3 py-3">
        <p className="display text-[15px] leading-snug text-ink">
          {total
            ? `${count(open.length)} ${filter === "outer" ? "rim cells" : "cells"} still worth rezoning`
            : "Reading the grid"}
        </p>
        <p className="mt-1 text-[11.5px] leading-relaxed text-ink-3">
          The plan has banked{" "}
          <span
            className="num"
            style={{ color: achieved >= 0 ? "var(--color-gain)" : "var(--color-loss)" }}
          >
            {fmtImpact(achieved)}
          </span>{" "}
          person-points. Accepting what is still open is worth up to{" "}
          <span className="num text-ink-2">{fmtImpact(headroom)}</span> more.
        </p>

        <div
          className="mt-3 flex gap-1 rounded-[5px] border border-hairline p-0.5"
          role="group"
          aria-label="Which flagged cells to show"
        >
          {FILTERS.map((f) => {
            const active = filter === f.id;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                aria-pressed={active}
                title={f.hint}
                className={`flex-1 rounded-[3px] px-2 py-1 text-[11px] font-medium transition-colors duration-150 ${
                  active ? "text-ink" : "text-ink-4 hover:text-ink-2"
                }`}
                style={active ? { background: "var(--color-raised)" } : undefined}
              >
                {f.label}
              </button>
            );
          })}
        </div>

        <div className="mt-2 flex gap-1.5">
          <button
            type="button"
            onClick={applyAll}
            disabled={!open.length || busy}
            className="flex-1 rounded-[5px] px-2 py-1.5 text-[11.5px] font-medium transition-opacity duration-150 disabled:opacity-35"
            style={{ background: "var(--accent)", color: "var(--accent-ink)" }}
          >
            {busy ? "Rescoring\u2026" : "Accept all open"}
          </button>
          <button
            type="button"
            onClick={resetPlan}
            disabled={busy || (!applied && open.length === proposals.length)}
            className="flex items-center gap-1.5 rounded-[5px] border border-hairline px-2 py-1.5 text-[11.5px] text-ink-3 transition-colors duration-150 hover:border-line hover:text-ink-2 disabled:opacity-35"
          >
            <RotateCcw size={12} strokeWidth={2} aria-hidden="true" />
            Reset
          </button>
        </div>
      </div>

      <div className="scroll min-h-0 flex-1 overflow-y-auto">
        {phase === "loading" && <Skeleton />}
        {phase === "ready" && !proposals.length && (
          <p className="px-3 py-6 text-[12px] leading-relaxed text-ink-3">
            {filter === "outer"
              ? "No rim cell clears the reporting threshold here. Switch to all flagged cells to see what the search found inland."
              : "Nothing here scores above the reporting threshold. This city\u2019s land use already suits the people living on it."}
          </p>
        )}
        {phase === "ready" && (
          <ul>
            {proposals.map((p, i) => (
              <Row key={p.id} proposal={p} index={i} />
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

function Row({ proposal, index }: { proposal: Proposal; index: number }) {
  const state = useStudio((s) => s.proposalState[proposal.id] ?? "open");
  const selected = useStudio((s) => s.selected === proposal.cellId);
  const reveal = useStudio((s) => s.reveal);
  const apply = useStudio((s) => s.applyProposal);
  const dismiss = useStudio((s) => s.dismissProposal);
  const restore = useStudio((s) => s.restoreProposal);
  const hover = useStudio((s) => s.hover);

  const dismissed = state === "dismissed";
  const isApplied = state === "applied";

  return (
    <li
      className="border-b border-hairline"
      style={{ animation: `draw-in 320ms var(--ease-out-soft) ${Math.min(index, 12) * 22}ms both` }}
    >
      <div
        className={`group relative transition-colors duration-150 ${
          selected ? "bg-raised" : "hover:bg-raised/55"
        } ${dismissed ? "opacity-45" : ""}`}
        onMouseEnter={() => hover(proposal.cellId)}
        onMouseLeave={() => hover(null)}
      >
        {selected && (
          <span
            className="absolute inset-y-0 left-0 w-[2px]"
            style={{ background: "var(--accent)" }}
            aria-hidden="true"
          />
        )}

        <button
          type="button"
          onClick={() => reveal(proposal.cellId)}
          className="block w-full px-3 py-2.5 text-left"
        >
          <span className="flex items-center gap-2">
            <span className="num text-[10.5px] text-ink-4">
              {String(proposal.rank).padStart(2, "0")}
            </span>
            <span className="num text-[11.5px] font-medium text-ink-2">
              {proposal.cellId}
            </span>
            {proposal.outer && (
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
            <span
              className="num ml-auto text-[11.5px] font-medium"
              style={{ color: isApplied ? "var(--color-gain)" : "var(--color-ink)" }}
            >
              {fmtImpact(proposal.impact)}
            </span>
          </span>

          <span className="mt-1.5 flex items-center gap-1.5 text-[12px]">
            <Swatch zone={proposal.from} />
            <span className={dismissed || isApplied ? "text-ink-4 line-through" : "text-ink-3"}>
              {zoneLabel[proposal.from]}
            </span>
            <ArrowRight size={11} strokeWidth={2.2} className="text-ink-4" aria-hidden="true" />
            <Swatch zone={proposal.to} />
            <span className="font-medium text-ink">{zoneLabel[proposal.to]}</span>
          </span>

          <span className="mt-1 flex items-center gap-1 text-[10.5px] text-ink-4">
            <Users size={10} strokeWidth={2} aria-hidden="true" />
            <span className="num">{people(proposal.people)}</span> people affected
            <span aria-hidden="true">·</span>
            <span className="num">{proposal.cells}</span> cells
            <span aria-hidden="true">·</span>
            <span className="num">{delta(proposal.dL, 3)}</span> here
          </span>
        </button>

        <div className="flex gap-1.5 px-3 pb-2.5">
          {dismissed ? (
            <button
              type="button"
              onClick={() => restore(proposal.id)}
              className="flex items-center gap-1 rounded-[4px] border border-hairline px-2 py-1 text-[10.5px] text-ink-3 transition-colors duration-150 hover:border-line hover:text-ink-2"
            >
              <Undo2 size={10} strokeWidth={2} aria-hidden="true" />
              Restore
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => apply(proposal.id)}
                disabled={isApplied}
                className="rounded-[4px] border px-2 py-1 text-[10.5px] font-medium transition-colors duration-150 disabled:cursor-default"
                style={
                  isApplied
                    ? {
                        borderColor: "transparent",
                        background: "color-mix(in srgb, var(--color-gain) 15%, transparent)",
                        color: "var(--color-gain)",
                      }
                    : { borderColor: "var(--color-line)", color: "var(--color-ink-2)" }
                }
              >
                {isApplied ? "In the plan" : "Accept"}
              </button>
              {!isApplied && (
                <button
                  type="button"
                  onClick={() => dismiss(proposal.id)}
                  className="rounded-[4px] px-2 py-1 text-[10.5px] text-ink-4 transition-colors duration-150 hover:text-ink-2"
                >
                  Dismiss
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </li>
  );
}

function Swatch({ zone }: { zone: Proposal["from"] }) {
  return (
    <span
      className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
      style={{ background: zoneColor[zone] }}
      aria-hidden="true"
    />
  );
}

function Skeleton() {
  return (
    <ul aria-hidden="true">
      {Array.from({ length: 7 }, (_, i) => (
        <li key={i} className="border-b border-hairline px-3 py-3.5">
          <div className="shimmer h-2.5 w-2/5 rounded-full bg-raised" />
          <div className="shimmer mt-2 h-2.5 w-4/5 rounded-full bg-raised" />
        </li>
      ))}
    </ul>
  );
}

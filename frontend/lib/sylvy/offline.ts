/**
 * Sylvy without a key.
 *
 * Not a chatbot imitation — a router over the same briefing the model gets,
 * so every sentence it produces is a fact the interface can also show. It
 * answers the handful of questions the panel's own prompt chips ask, and says
 * plainly when a question is outside what it can answer offline.
 */

import type { SylvyContext, SylvyProposal } from "./context";

const LOCALE = "en-US";

export function offlineAnswer(question: string, c: SylvyContext): string {
  const q = question.toLowerCase();
  const open = c.proposals.filter((p) => p.state === "open");
  const ref = question.match(/\b(\d{1,3}:\d{1,3})\b/);

  if (ref) {
    const hit = c.proposals.find((p) => p.cellId === ref[1]);
    if (hit) return describe(hit);
    if (c.selected?.id === ref[1]) {
      const s = c.selected;
      return `${s.id} is zoned ${s.zone} today, carries ${num(s.population)} residents and scores ${s.livability.toFixed(3)} for livability. It sits ${s.edgeKm.toFixed(1)} km from the boundary with ${s.greenCover.toFixed(0)}% tree cover, ${s.outer ? "on the rim" : "well inside the built area"}. Nothing in the current worklist touches it, so the search found no change there worth reporting.`;
    }
    return `${ref[1]} is not in the current worklist. Click it on the map and the dossier below will rescore it, or ask me about one of the ${open.length} cells that are.`;
  }

  if (/\b(edge|boundary|rim|extremit|outskirt|periphe|outer|filter)/.test(q)) {
    const rim = c.proposals.filter((p) => p.outer);
    if (!rim.length) return noProposals(c);
    const best = [...rim].sort((a, b) => b.impact - a.impact)[0];
    return `Rim cells average ${c.outerLivability.toFixed(3)} livability against ${c.livability.toFixed(3)} for ${c.city} as a whole, and ${rim.length} of the ${c.proposals.length} flagged cells sit out there. The strongest is ${best.cellId}, ${best.from} to ${best.to}, worth ${signed(best.impact)} person-points across ${num(best.people)} people. Outer rim in the left rail narrows the worklist and the map to those cells only; All flagged brings the interior back.`;
  }

  if (/\b(green|tree|park|canopy)/.test(q)) {
    const greens = c.proposals.filter((p) => p.to === "green");
    if (!greens.length) {
      return `No cell in the current worklist is worth converting to open space — the networks are finding more value in other moves right now. Switch the map to Green to see where ${c.city}'s existing canopy actually sits.`;
    }
    return `${greens.length === 1 ? "One change" : `${greens.length} changes`} in the worklist would add open space, led by ${greens[0].cellId}, which moves ${num(greens[0].people)} people's cells for ${signed(greens[0].impact)} person-points. Tree cover is a direct input to the score, so a green cell lifts its neighbours as well as itself.`;
  }

  if (/\b(industr|noise|nuisance|quiet|pollut)/.test(q)) {
    const moves = c.proposals.filter((p) => p.from === "industrial" || p.from === "utility");
    if (!moves.length) {
      return `No industrial or utility cell in ${c.city}'s worklist is worth converting at the moment. The Zoning map shows where that land actually sits.`;
    }
    return `${moves.length === 1 ? "One cell" : `${moves.length} cells`} in the worklist move off industrial or utility land, starting with ${moves[0].cellId} to ${moves[0].to}. That one is worth ${signed(moves[0].impact)} person-points and ${signed(moves[0].dL, 3)} on the cell itself, across ${num(moves[0].people)} residents.`;
  }

  if (/\b(first|start|top|best|priorit|begin|which)/.test(q)) {
    if (!open.length) return noProposals(c);
    return `Start with ${open[0].cellId}. ${describe(open[0])}`;
  }

  if (/\b(all|everything|total|how much|headroom|impact|people|affect)/.test(q)) {
    const ceiling = open.reduce((s, p) => s + p.impact, 0);
    return `Your plan has banked ${signed(c.impact)} person-points across ${c.moved} cells so far. The ${open.length} changes still open are worth up to ${signed(ceiling)} more — a ceiling, not a total, because windows five cells wide overlap and two nearby changes do not add. ${num(c.underserved)} residents still live on cells scoring below 0.45.`;
  }

  if (/\b(selected|this cell|here)/.test(q) && c.selected) {
    const s = c.selected;
    return `You have ${s.id} selected: ${s.zone}, ${num(s.population)} residents, ${s.greenCover.toFixed(0)}% tree cover, ${s.edgeKm.toFixed(1)} km from the boundary, livability ${s.livability.toFixed(3)}. Try a different zone in the dossier below and the networks rescore all 81 cells within five of it immediately.`;
  }

  return `${c.city} scores ${c.livability.toFixed(3)} for livability, with ${num(c.underserved)} residents on cells below 0.45 and rim cells at ${c.outerLivability.toFixed(3)}. There ${open.length === 1 ? "is one change" : `are ${open.length} changes`} open in the worklist${open.length ? `, led by ${open[0].cellId} moving ${open[0].from} to ${open[0].to}` : ""}. I am answering from the briefing alone right now — set NVIDIA_API_KEY to have me reason over it properly.`;
}

function describe(p: SylvyProposal): string {
  const status =
    p.state === "applied"
      ? "It is already in your plan."
      : p.state === "dismissed"
        ? "You dismissed it; restore it from the worklist to put it back."
        : "It is still open in the worklist.";
  return `${p.cellId} goes from ${p.from} to ${p.to}, and it sits ${p.outer ? "on the rim" : "in the interior"}. That move is worth ${signed(p.impact)} person-points: ${signed(p.dL, 3)} on the cell itself, and ${p.cells} cells within five of it move, covering ${num(p.people)} residents. ${status}`;
}

function noProposals(c: SylvyContext): string {
  return `Nothing in ${c.city} clears the reporting threshold at the moment — the land use already resembles the reference cities closely enough. Pick any cell on the map and test a zone change yourself in the dossier; the networks will score it live.`;
}

function num(value: number): string {
  return Math.round(value).toLocaleString(LOCALE);
}

/** Impacts are signed, and the sign is the whole point. */
function signed(value: number, decimals = 0): string {
  const body = decimals ? Math.abs(value).toFixed(decimals) : num(Math.abs(value));
  return `${value >= 0 ? "+" : "-"}${body}`;
}

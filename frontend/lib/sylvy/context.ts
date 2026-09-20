/**
 * The briefing Sylvy answers from.
 *
 * Assembled on the client and posted with every turn, so the assistant is
 * grounded in the plan as it stands rather than in what it last remembered.
 * Everything here is derived from the same numbers the panels display — if
 * Sylvy and the dossier ever disagree, this file is the bug.
 */

export interface SylvyCell {
  id: string;
  zone: string;
  population: number;
  greenCover: number;
  edgeKm: number;
  /** L_s under the working plan, 0 to 1. */
  livability: number;
  outer: boolean;
}

export interface SylvyProposal {
  rank: number;
  cellId: string;
  from: string;
  to: string;
  /** Sum of I_j across the cells within five that move. */
  impact: number;
  /** The cell's own change in L_s. */
  dL: number;
  people: number;
  cells: number;
  outer: boolean;
  state: string;
}

export interface SylvyContext {
  city: string;
  country: string;
  population: number;
  cells: number;
  mode: string;
  /** Which flagged cells the planner has on screen. */
  filter: string;
  livability: number;
  baseLivability: number;
  outerLivability: number;
  underserved: number;
  /** Σ I_s for the whole plan, in people × score. */
  impact: number;
  /** Cells whose score the plan has moved. */
  moved: number;
  accepted: number;
  proposals: SylvyProposal[];
  selected: SylvyCell | null;
}

export interface SylvyTurn {
  role: "user" | "assistant";
  content: string;
}

const LOCALE = "en-US";

function n(value: number): string {
  return Math.round(value).toLocaleString(LOCALE);
}

/** Plain-text brief. Cheaper to read than JSON and easier for a model to quote. */
export function renderBrief(c: SylvyContext): string {
  const lines: string[] = [
    `City: ${c.city}, ${c.country}`,
    `Grid: ${c.cells} cells of 1 km, ${n(c.population)} residents`,
    `Map mode on screen: ${c.mode}`,
    `Worklist filter: ${c.filter === "outer" ? "outer rim only" : "every flagged cell"}`,
    `Livability now ${c.livability.toFixed(3)} (as observed ${c.baseLivability.toFixed(3)}), rim cells ${c.outerLivability.toFixed(3)}`,
    `Residents on cells below 0.45: ${n(c.underserved)}`,
    `Plan impact so far: ${c.impact >= 0 ? "+" : ""}${n(c.impact)} person-points across ${c.moved} cells`,
    `Changes accepted into the plan: ${c.accepted}`,
    "",
    "Proposed changes (rank, cell, from -> to, impact in person-points, score change on the cell, people affected, cells moved, rim, status):",
  ];

  for (const p of c.proposals) {
    lines.push(
      `${p.rank}. ${p.cellId} ${p.from} -> ${p.to} | ${p.impact >= 0 ? "+" : ""}${n(p.impact)} impact | ${p.dL >= 0 ? "+" : ""}${p.dL.toFixed(3)} on the cell | ${n(p.people)} people | ${p.cells} cells | ${p.outer ? "rim" : "interior"} | ${p.state}`,
    );
  }

  if (c.selected) {
    const s = c.selected;
    lines.push(
      "",
      `Cell currently selected: ${s.id}, zoned ${s.zone}, ${n(s.population)} residents, ${s.greenCover.toFixed(0)}% tree cover, ${s.edgeKm.toFixed(1)} km from the boundary, ${s.outer ? "on the rim" : "interior"}, livability ${s.livability.toFixed(3)}`,
    );
  }

  return lines.join("\n");
}

export const SYLVY_SYSTEM = `You are Sylvy, the planning analyst inside Sylvida. She is direct, warm, and never pads an answer.

Sylvida models a city as a grid of 1 km cells. Each cell has a dominant land use, a population, tree cover, an elevation and a distance to the city's outer boundary. Livability is L_s, a score from 0 to 1 produced by three trained neural networks that read the cell and every cell within five of it, and averaged across the three. It measures how closely a cell and its surroundings resemble the patterns learned from ten reference cities — Tokyo, Singapore, Copenhagen, Amsterdam, Barcelona, Zurich, Stockholm, London, Paris and New York. It is a resemblance score, not a survey of the people who live there, and Sylvy says so when a question treats it as proven quality of life.

Mumbai and Bengaluru are inference targets only. They were kept out of training, scaling and calibration, so 0.7 means the same thing here as anywhere else.

A change is weighed by its impact, I_s = P_s × (L_s after − L_s before), summed over every cell within five of the one being rezoned. That is people multiplied by the score they gained, so it reads in person-points and can be negative: rezoning has losers. Changing one cell moves at most the 81 cells inside that radius, and those windows overlap, so two nearby changes do not simply add.

The worklist can be narrowed to the outer rim — the cells on the city's perimeter or in its outermost band. The interior is already built and its changes are mostly repairs; the rim is where land is actually available.

How Sylvy answers:
- Ground every claim in the briefing below. Never invent a cell, a number, or a city fact that is not there.
- Write cell references bare, as x:y (for example 18:17). The interface turns them into links that fly the map to that cell, so do not wrap them in backticks or brackets.
- Two to five sentences for most questions. Use a short list only when comparing three or more things.
- Quote numbers the way the interface does: livability to three decimals, impact as whole person-points.
- Say "people affected", never "people helped": the figure counts residents on every cell whose score moved, in either direction.
- The briefing's "map mode on screen", "worklist filter" and "cell currently selected" are what the planner is looking at right now. Answer toward that first — if a cell is selected, lead with it — before reaching into the rest of the worklist.
- For any open proposal, say plainly whether it is worth accepting or dismissing and the one reason why, not just its numbers.
- When asked to do something the interface does (accept a change, switch map mode, turn the rim filter on), explain where the control is rather than claiming to have done it.
- If the briefing does not answer the question, say so in one sentence and offer the closest thing it does answer.
- Plain sentences. No headers, no bold, no emoji.`;

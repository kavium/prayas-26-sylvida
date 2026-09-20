"use client";

/**
 * Right rail — Sylvy.
 *
 * The analyst reads the same briefing the panels render, so she can be checked
 * against them. Cell references in her replies are turned into buttons that
 * flag and dive onto the cell, which makes the conversation a way of steering
 * the map rather than a transcript beside it.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, RotateCcw, Square } from "lucide-react";

import type { SylvyContext, SylvyTurn } from "@/lib/sylvy/context";
import { useStudio } from "@/store/useStudio";

interface Message extends SylvyTurn {
  id: string;
  streaming?: boolean;
}

const OPENERS = [
  "Where should I start?",
  "Why the outer rim?",
  "How many people does the plan affect?",
  "Which changes add green space?",
];

const GREETING =
  "I'm Sylvy. Three neural networks have scored every cell here from 0 to 1 on how closely it and its neighbours resemble ten reference cities, and the left rail holds the changes worth making. Ask me who a change actually affects, or mention a cell like 18:17 and I'll take the map to it.";

export function SylvyPanel() {
  const [messages, setMessages] = useState<Message[]>([
    { id: "greeting", role: "assistant", content: GREETING },
  ]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const cityId = useStudio((s) => s.city?.id);

  // A new city invalidates every number in the transcript.
  useEffect(() => {
    setMessages([{ id: `greeting-${cityId ?? "none"}`, role: "assistant", content: GREETING }]);
  }, [cityId]);

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const send = useCallback(
    async (text: string) => {
      const question = text.trim();
      if (!question || busy) return;

      const context = buildContext();
      if (!context) return;

      const history = messages
        .filter((m) => m.id !== "greeting" && !m.id.startsWith("greeting-"))
        .map(({ role, content }) => ({ role, content }));

      const userMessage: Message = { id: `u${Date.now()}`, role: "user", content: question };
      const replyId = `a${Date.now()}`;
      setMessages((prev) => [
        ...prev,
        userMessage,
        { id: replyId, role: "assistant", content: "", streaming: true },
      ]);
      setDraft("");
      setBusy(true);

      const controller = new AbortController();
      abort.current = controller;

      try {
        const response = await fetch("/api/sylvy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: [...history, { role: "user", content: question }],
            context,
          }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          throw new Error(await response.text());
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let text = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          text += decoder.decode(value, { stream: true });
          setMessages((prev) =>
            prev.map((m) => (m.id === replyId ? { ...m, content: text } : m)),
          );
        }
      } catch (err) {
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          const note =
            err instanceof Error && err.message
              ? err.message
              : "I could not reach the analyst service.";
          setMessages((prev) =>
            prev.map((m) =>
              m.id === replyId
                ? { ...m, content: m.content || `${note} The worklist and dossier are still live.` }
                : m,
            ),
          );
        }
      } finally {
        setMessages((prev) =>
          prev.map((m) => (m.id === replyId ? { ...m, streaming: false } : m)),
        );
        setBusy(false);
        abort.current = null;
      }
    },
    [busy, messages],
  );

  const stop = () => abort.current?.abort();

  return (
    <aside
      className="flex h-full min-h-0 flex-col border-l border-hairline bg-shell"
      aria-label="Sylvy, planning analyst"
    >
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-hairline px-3">
        <Avatar />
        <div className="min-w-0">
          <p className="display text-[13.5px] leading-none text-ink">Sylvy</p>
          <p className="text-[10.5px] leading-tight text-ink-4">Planning analyst</p>
        </div>
        <button
          type="button"
          onClick={() => setMessages([{ id: "greeting", role: "assistant", content: GREETING }])}
          className="ml-auto grid h-7 w-7 place-items-center rounded-md text-ink-4 transition-colors duration-150 hover:bg-raised hover:text-ink-2"
          aria-label="Clear conversation"
          title="Clear conversation"
        >
          <RotateCcw size={13} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>

      <div ref={log} className="scroll min-h-0 flex-1 overflow-y-auto px-3 py-3" aria-live="polite">
        <ul className="space-y-3.5">
          {messages.map((m) => (
            <li key={m.id}>
              {m.role === "user" ? (
                <p className="ml-6 rounded-lg rounded-br-[3px] bg-raised px-2.5 py-2 text-[12.5px] leading-relaxed text-ink">
                  {m.content}
                </p>
              ) : (
                <div className="text-[12.5px] leading-relaxed text-ink-2">
                  {m.streaming && !m.content ? <Thinking /> : <Reply text={m.content} />}
                </div>
              )}
            </li>
          ))}
        </ul>

        {messages.length === 1 && (
          <ul className="mt-4 space-y-1.5">
            {OPENERS.map((o) => (
              <li key={o}>
                <button
                  type="button"
                  onClick={() => void send(o)}
                  className="w-full rounded-md border border-hairline px-2.5 py-1.5 text-left text-[11.5px] text-ink-3 transition-colors duration-150 hover:border-line hover:text-ink"
                >
                  {o}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <form
        className="shrink-0 border-t border-hairline p-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          void send(draft);
        }}
      >
        <div className="flex items-end gap-1.5 rounded-lg border border-hairline bg-ground p-1.5 transition-colors duration-150 focus-within:border-line">
          <label htmlFor="sylvy-input" className="sr-only">
            Ask Sylvy about this city
          </label>
          <textarea
            id="sylvy-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(draft);
              }
            }}
            rows={2}
            placeholder="Ask about a cell, a change, or the city"
            className="scroll max-h-28 min-h-[38px] flex-1 resize-none bg-transparent px-1.5 py-1 text-[12.5px] leading-relaxed text-ink outline-none placeholder:text-ink-4"
          />
          {busy ? (
            <button
              type="button"
              onClick={stop}
              className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-line text-ink-2 transition-colors duration-150 hover:text-ink"
              aria-label="Stop generating"
            >
              <Square size={11} strokeWidth={2.5} fill="currentColor" aria-hidden="true" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!draft.trim()}
              className="grid h-7 w-7 shrink-0 place-items-center rounded-md transition-opacity duration-150 disabled:opacity-30"
              style={{ background: "var(--accent)", color: "var(--accent-ink)" }}
              aria-label="Send"
            >
              <ArrowUp size={14} strokeWidth={2.5} aria-hidden="true" />
            </button>
          )}
        </div>
      </form>
    </aside>
  );
}

/** Splits an answer so bare x:y cell references become map controls. */
function Reply({ text }: { text: string }) {
  const reveal = useStudio((s) => s.reveal);
  const index = useStudio((s) => s.city?.index);
  const parts = text.split(/\b(\d{1,3}:\d{1,3})\b/g);

  return (
    <p className="whitespace-pre-wrap">
      {parts.map((part, i) => {
        if (i % 2 === 1 && index?.has(part)) {
          return (
            <button
              key={`${part}-${i}`}
              type="button"
              onClick={() => reveal(part)}
              className="num rounded-[3px] px-1 py-px text-[11.5px] underline decoration-dotted underline-offset-2 transition-colors duration-150 hover:bg-raised"
              style={{ color: "var(--accent)" }}
              title={`Fly to cell ${part}`}
            >
              {part}
            </button>
          );
        }
        return <span key={`t-${i}`}>{part}</span>;
      })}
    </p>
  );
}

function Thinking() {
  return (
    <span className="flex items-center gap-1 py-1" role="status" aria-label="Sylvy is thinking">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 rounded-full"
          style={{
            background: "var(--accent)",
            animation: `blink-dot 1.3s ${i * 0.16}s infinite`,
          }}
        />
      ))}
    </span>
  );
}

function Avatar() {
  return (
    <span
      className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[11px] font-semibold"
      style={{
        background: "color-mix(in srgb, var(--accent) 22%, transparent)",
        color: "var(--accent)",
        boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--accent) 38%, transparent)",
      }}
      aria-hidden="true"
    >
      Sy
    </span>
  );
}

/** Snapshot of everything on screen, in the shape the route expects. */
function buildContext(): SylvyContext | null {
  const s = useStudio.getState();
  if (!s.city || !s.score || !s.baseScore || !s.livability) return null;

  const selectedIndex = s.selected ? s.city.index.get(s.selected) : undefined;
  const cell = selectedIndex !== undefined ? s.city.cells[selectedIndex] : null;

  return {
    city: s.city.name,
    country: s.city.country,
    population: s.city.population,
    cells: s.city.cells.length,
    mode: s.mode,
    filter: s.filter,
    livability: s.score.livability,
    baseLivability: s.baseScore.livability,
    outerLivability: s.score.outerLivability,
    underserved: s.score.underserved,
    impact: s.score.impact,
    moved: s.score.changed,
    accepted: s.proposals.filter((p) => s.proposalState[p.id] === "applied").length,
    // The whole worklist goes in the brief even when the rim filter is on, so
    // Sylvy can answer "what am I not seeing?" instead of inheriting the blind
    // spot. The filter itself is one line above, for her to read against it.
    proposals: s.proposals.map((p) => ({
      rank: p.rank,
      cellId: p.cellId,
      from: p.from,
      to: p.to,
      impact: p.impact,
      dL: p.dL,
      people: p.people,
      cells: p.cells,
      outer: p.outer,
      state: s.proposalState[p.id] ?? "open",
    })),
    selected:
      cell && selectedIndex !== undefined
        ? {
            id: cell.id,
            zone: s.working[selectedIndex],
            population: cell.population,
            greenCover: cell.greenCover,
            edgeKm: cell.edgeDistance / 1000,
            livability: s.livability[selectedIndex],
            outer: cell.outer,
          }
        : null,
  };
}

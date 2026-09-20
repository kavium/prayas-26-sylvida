# Sylvida — design direction

**Binding.** Anything that creates or changes UI in this folder follows this
file. If a request conflicts with it, say so before building.

## The direction: field atlas

A planner's drafting table after hours. The chrome is warm charcoal so nothing
competes with the one bright plane in the product — the map, which is white
paper carrying gouache zone washes, the way a printed zoning plan looks. The
interface is an argument laid out left to right: here is what to change, here
is the city, here is what that change does, and here is someone to ask.

What it is not: dashboard-blue, neon-on-black, glassmorphism, purple gradient,
Inter. No card has a drop shadow it did not earn.

## Typography

| Role | Face | Where |
|---|---|---|
| Display | **Fraunces** var. (`SOFT 20, WONK 1`) | wordmark, panel headlines, big figures |
| Text | **Archivo** | every sentence, every control |
| Numbers | **Azeret Mono**, tabular, `ss01` | scores, deltas, cell ids, populations |

Rule: anything you read once gets the serif; anything you read twice — because
it is a measurement — gets the mono. Body text sits at 13px, captions 10.5px,
figures 19px. Section labels use `.eyebrow` (10px / 0.14em / uppercase), never
a bold sentence.

## Color

Chrome — `ground #14161a`, `shell #1a1d23`, `raised #212630`, `sunken #101216`,
separated by `hairline #23272f` and `line #2c313b`. Hairlines, not borders: one
pixel of a slightly lighter charcoal, never a box.

Ink — `#eef0f3` → `#bcc3ce` → `#9ba3b0` → `#868e9b`. All four clear 4.5:1 on
`raised`, because all four carry real text somewhere in the shell. Do not add a
fifth tier below `ink-4`.

Signal — `flag #e4746c` (a cell asking for attention), `gain #7fb98a`,
`loss #d4796f`, `hold #d9b26a`. Signal colors mean change. They are never
decoration, never a background, never a brand accent.

Zone washes — nine muted gouache tints (`--color-z-*`). Muted on purpose: nine
of them share one white page, and the page has to stay legible under all of
them. The wash thins as the map zooms in, because up close the streets are the
information.

Accent — user-chosen: periwinkle `#93b7dd` (default), clay `#d59b6e`, sage
`#9dbf95`. Accent drives focus rings, selection, links and the one primary
button per panel. Nothing else.

The canvas cannot read Tailwind, so `lib/zoning/palette.ts` mirrors these
values. **Change one, change the other.**

## Geometry

Four regions on CSS variables: `--top-h`, `--rail-left`, `--rail-right`,
`--dock-h`. Radii 3 / 5 / 7 / 10px — small, because everything is a plate or a
hairline-separated column, not a floating card. Below 1024px the three panels
collapse into a Worklist / Map / Sylvy switcher; the map is never the thing
that gets dropped.

## Motion

Motion explains state changes and nothing else. Durations live in
`palette.ts → duration`: `micro 140`, `control 190`, `panel 280`,
`flagPulse 500`, `flagHold 2000`, `dive 1700`. Easing is
`--ease-out-soft` / `cubic-bezier(0.16, 1, 0.3, 1)`.

The one set-piece: picking a change flags its cell in `signal.flag` for two
seconds of cosine-driven pulses, then flies the camera down to the single cell
at `easeLinearity: 0.12` — slow out, fast through, hard stop. Settings → Motion
→ Calm and `prefers-reduced-motion` both skip the pulse and cut the flight.

## Map ground

Esri **World Light Gray Canvas** (base + reference labels, both keyless).
White roads on near-white land, no vegetation and no terrain. CARTO's
`light_all` is not an option: it now serves an "API KEY REQUIRED" watermark to
anonymous callers. Labels render in their own pane above the washes so a
recoloured cell never buries a street name.

## Non-negotiables

- Real focus states, keyboard paths, AA contrast, semantic elements. Part of
  "done", not a follow-up.
- Real copy. No lorem ipsum, and no number in the interface that the pipeline
  did not produce.
- Responsive from the first pass.

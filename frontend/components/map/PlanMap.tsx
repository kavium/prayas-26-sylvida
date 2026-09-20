"use client";

/**
 * The plan surface.
 *
 * Leaflet is driven directly rather than through react-leaflet: the grid is
 * one canvas rather than thousands of layers, and the flag-then-dive camera
 * needs to sequence imperatively. React owns the props; Leaflet owns the DOM
 * inside this one element.
 *
 * Cell geometry is projected once, at a fixed reference zoom, and cached in a
 * flat array. Web Mercator is linear in scale, so every other zoom is that
 * array times a power of two — panning costs one subtraction per cell and the
 * dive costs one multiply, instead of 10,000 reprojections a frame.
 */

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import { buildLocator, cellBounds } from "@/lib/zoning/city";
import {
  accents,
  chrome,
  duration,
  rgba,
  sampleRamp,
  signal,
  zoneColor,
  zoneStroke,
} from "@/lib/zoning/palette";
import type { ProposalState } from "@/lib/zoning/types";
import { useStudio } from "@/store/useStudio";

import { setMap } from "./handle";

/** Leaflet's zoom-animation hooks are internal but are what L.Renderer itself uses. */
interface ZoomAnimMap extends L.Map {
  _getCenterOffset: (center: L.LatLng) => L.Point;
  _getMapPanePos: () => L.Point;
}

/* Esri's Light Gray Canvas: white roads on near-white land, no vegetation and
   no terrain — the printed-plan ground the zone washes need underneath them.
   It is keyless, unlike CARTO's light_all, which now serves an "API KEY
   REQUIRED" watermark tile to anonymous callers. Ground and labels are two
   services, so the labels can be drawn back on top of the washes. */
const BASE_TILES =
  "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}";
const LABEL_TILES =
  "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}";
/** Both services stop at z16; Leaflet upscales the last tiles beyond that. */
const MAX_NATIVE_ZOOM = 16;
const ATTRIBUTION =
  'Tiles &copy; <a href="https://www.esri.com/">Esri</a> &middot; HERE, Garmin, OpenStreetMap &middot; GHSL, Overture';

const DIVE_ZOOM = 14;
/** How far the camera must rip back on a switch, even between neighbours. */
const MIN_ASCENT = 2.6;
/** Cell geometry is cached at this zoom and scaled to whatever is on screen. */
const REFERENCE_ZOOM = 14;

export function PlanMap() {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  /** [x, y, w, h] per cell in projected pixels at REFERENCE_ZOOM. */
  const boxes = useRef<Float64Array>(new Float64Array(0));
  const locator = useRef<((lat: number, lon: number) => number | null) | null>(null);
  const frame = useRef<number>(0);
  const pulseStart = useRef<number>(0);
  const blink = useRef<HTMLDivElement>(null);
  /** Latest store snapshot, read by the draw loop without re-subscribing. */
  const view = useRef(useStudio.getState());

  useEffect(() => useStudio.subscribe((s) => {
    view.current = s;
  }), []);

  /* --- Map lifecycle ------------------------------------------------------ */

  useEffect(() => {
    if (!host.current || map.current) return;

    const instance = L.map(host.current, {
      zoomControl: false,
      attributionControl: true,
      preferCanvas: true,
      zoomSnap: 0.25,
      wheelPxPerZoomLevel: 110,
      minZoom: 3,
      maxZoom: 17,
      // Leaflet refuses to accept layers before it has a view; the real one
      // arrives the moment a city finishes loading.
      center: [20, 0],
      zoom: 3,
    });

    L.tileLayer(BASE_TILES, {
      attribution: ATTRIBUTION,
      maxZoom: 17,
      maxNativeZoom: MAX_NATIVE_ZOOM,
      // The dive crosses several zoom levels in 1.7s; without this Leaflet
      // requests a full tile set for each one and aborts them all but the last.
      updateWhenZooming: false,
      keepBuffer: 3,
    }).addTo(instance);

    instance.createPane("cells");
    const pane = instance.getPane("cells");
    if (pane) {
      pane.style.zIndex = "350";
      pane.style.pointerEvents = "none";
    }

    // leaflet-layer pins the canvas to the pane origin; leaflet-zoom-animated
    // sets transform-origin to 0 0 and opts it into Leaflet's zoom transition.
    const el = L.DomUtil.create(
      "canvas",
      "leaflet-layer leaflet-zoom-animated",
      pane,
    ) as HTMLCanvasElement;
    el.setAttribute("aria-hidden", "true");
    canvas.current = el;

    // Street and place names ride above the washes; without this every
    // recoloured cell would bury the labels under it.
    instance.createPane("labels");
    const labelPane = instance.getPane("labels");
    if (labelPane) {
      labelPane.style.zIndex = "360";
      labelPane.style.pointerEvents = "none";
    }
    L.tileLayer(LABEL_TILES, {
      pane: "labels",
      maxZoom: 17,
      maxNativeZoom: MAX_NATIVE_ZOOM,
      updateWhenZooming: false,
      keepBuffer: 3,
    }).addTo(instance);

    map.current = instance;
    setMap(instance);

    const resize = () => {
      const size = instance.getSize();
      const dpr = window.devicePixelRatio || 1;
      el.width = Math.round(size.x * dpr);
      el.height = Math.round(size.y * dpr);
      el.style.width = `${size.x}px`;
      el.style.height = `${size.y}px`;
      reposition();
    };

    const reposition = () => {
      L.DomUtil.setTransform(el, instance.containerPointToLayerPoint([0, 0]), 1);
      draw();
    };

    const onZoomAnim = (e: L.ZoomAnimEvent) => {
      const m = instance as ZoomAnimMap;
      const scale = instance.getZoomScale(e.zoom, instance.getZoom());
      const offset = m
        ._getCenterOffset(e.center)
        .multiplyBy(-scale)
        .subtract(m._getMapPanePos());
      L.DomUtil.setTransform(el, offset, scale);
    };

    instance.on("move viewreset zoomend moveend", reposition);
    instance.on("zoomanim", onZoomAnim);
    instance.on("resize", resize);

    const toCell = (latlng: L.LatLng): string | null => {
      const city = view.current.city;
      if (!city || !locator.current) return null;
      const i = locator.current(latlng.lat, latlng.lng);
      return i === null ? null : city.cells[i].id;
    };

    instance.on("mousemove", (e: L.LeafletMouseEvent) => {
      const id = toCell(e.latlng);
      useStudio.getState().hover(id);
      instance.getContainer().style.cursor = id ? "pointer" : "";
    });
    instance.on("mouseout", () => useStudio.getState().hover(null));
    instance.on("click", (e: L.LeafletMouseEvent) => {
      const id = toCell(e.latlng);
      if (id) useStudio.getState().select(id);
    });

    resize();

    return () => {
      cancelAnimationFrame(frame.current);
      instance.remove();
      setMap(null);
      map.current = null;
      canvas.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* --- City changes ------------------------------------------------------- */

  const city = useStudio((s) => s.city);

  useEffect(() => {
    const instance = map.current;
    if (!instance || !city) return;
    locator.current = buildLocator(city);
    instance.fitBounds(L.latLngBounds(city.bounds[0], city.bounds[1]), {
      padding: [56, 56],
      animate: false,
    });
    project();
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city]);

  /* --- Redraw triggers ---------------------------------------------------- */

  const mode = useStudio((s) => s.mode);
  const working = useStudio((s) => s.working);
  const selected = useStudio((s) => s.selected);
  const hovered = useStudio((s) => s.hovered);
  const proposals = useStudio((s) => s.proposals);
  const proposalState = useStudio((s) => s.proposalState);
  const livability = useStudio((s) => s.livability);
  const filter = useStudio((s) => s.filter);
  const settings = useStudio((s) => s.settings);

  useEffect(() => {
    draw();
  }, [mode, working, selected, hovered, proposals, proposalState, livability, filter, settings]);

  /* --- Flag, then dive ---------------------------------------------------- */

  const focus = useStudio((s) => s.focus);

  useEffect(() => {
    const instance = map.current;
    const current = view.current.city;
    if (!instance || !focus || !current) return;

    const i = current.index.get(focus.cellId);
    if (i === undefined) return;
    const cell = current.cells[i];

    if (focus.phase === "ascending") {
      cancelAnimationFrame(frame.current);
      const from = current.index.get(focus.from ?? "");
      const leaving =
        from === undefined
          ? instance.getCenter()
          : L.latLng(current.cells[from].lat, current.cells[from].lon);
      const arriving = L.latLng(cell.lat, cell.lon);

      // Climb until both cells are in frame, and never less than MIN_ASCENT —
      // two neighbours still get the full rip back out.
      const pair = L.latLngBounds([leaving, arriving]).pad(0.4);
      const zoom = Math.max(
        instance.getMinZoom(),
        Math.min(instance.getBoundsZoom(pair, false), instance.getZoom() - MIN_ASCENT),
      );

      punch("fov-ascend", duration.ascend);
      instance.flyTo(pair.getCenter(), zoom, {
        duration: duration.ascend / 1000,
        easeLinearity: 0.42,
      });

      // moveend is the truth, but a flight that is interrupted never fires it,
      // so the timer is the floor under the sequence.
      let done = false;
      const land = () => {
        if (done) return;
        done = true;
        flash();
        useStudio.getState().advanceFocus("flagging");
      };
      instance.once("moveend", land);
      const guard = setTimeout(land, duration.ascend + 140);
      return () => {
        clearTimeout(guard);
        instance.off("moveend", land);
      };
    }

    if (focus.phase === "flagging") {
      // Bring the cell on screen without changing scale, so the pulse is
      // visible before the camera commits to the dive.
      if (!instance.getBounds().pad(-0.18).contains([cell.lat, cell.lon])) {
        instance.panTo([cell.lat, cell.lon], { duration: 0.45 });
      }
      pulseStart.current = performance.now();
      const tick = () => {
        draw();
        if (useStudio.getState().focus?.phase === "flagging") {
          frame.current = requestAnimationFrame(tick);
        }
      };
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(frame.current);
    }

    if (focus.phase === "diving") {
      cancelAnimationFrame(frame.current);
      const calm = useStudio.getState().settings.motion === "calm";
      const target = L.latLng(cell.lat, cell.lon);
      if (calm) {
        instance.setView(target, DIVE_ZOOM, { animate: false });
        useStudio.getState().advanceFocus("held");
      } else {
        // easeLinearity this low makes the flight hang wide, then rush the
        // last third — the lens change reads on the way down, not as a pan.
        punch("fov-dive", duration.dive);
        instance.flyTo(target, DIVE_ZOOM, {
          duration: duration.dive / 1000,
          easeLinearity: 0.08,
        });
        instance.once("moveend", () => useStudio.getState().advanceFocus("held"));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.token, focus?.phase]);

  /* --- Projection and painting -------------------------------------------- */

  function project() {
    const instance = map.current;
    const current = view.current.city;
    if (!instance || !current) return;
    const out = new Float64Array(current.cells.length * 4);
    for (let i = 0; i < current.cells.length; i += 1) {
      const [[s, w], [n, e]] = cellBounds(current, i);
      const a = instance.project([n, w], REFERENCE_ZOOM);
      const b = instance.project([s, e], REFERENCE_ZOOM);
      out[i * 4] = a.x;
      out[i * 4 + 1] = a.y;
      out[i * 4 + 2] = b.x - a.x;
      out[i * 4 + 3] = b.y - a.y;
    }
    boxes.current = out;
  }

  function draw() {
    const instance = map.current;
    const el = canvas.current;
    const state = view.current;
    const current = state.city;
    if (!instance || !el || !current) return;

    const zoom = instance.getZoom();
    if (boxes.current.length !== current.cells.length * 4) project();

    const ctx = el.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const size = instance.getSize();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.x, size.y);

    const origin = instance.getPixelOrigin();
    const shift = instance.containerPointToLayerPoint([0, 0]);
    const ox = origin.x + shift.x;
    const oy = origin.y + shift.y;
    // Mercator scales linearly between zooms, so one multiplier converts the
    // cached geometry to the zoom on screen — fractional zooms included.
    const k = 2 ** (zoom - REFERENCE_ZOOM);

    const { mode: m, working: plan, settings: s, hovered: hov, selected: sel } = state;
    const scores = state.livability;
    const baseScores = state.baseLivability;
    const accent = accents[s.accent].hex;
    const boxArr = boxes.current;

    // The rim filter narrows what the map argues about, not what the plan
    // contains: an accepted interior change keeps its colour in every mode,
    // it simply stops being ringed and called out while the filter is on.
    const rimOnly = state.filter === "outer";
    const shown = state.proposals.filter((p) => !rimOnly || p.outer);

    // Which cells carry a live proposal, and what it would make them.
    const flagged = new Map<string, { to: string; state: ProposalState }>();
    for (const p of shown) {
      const st = state.proposalState[p.id] ?? "open";
      // A dismissed change is no longer part of the argument, so it stops
      // being drawn as one.
      if (st === "dismissed") continue;
      flagged.set(p.cellId, { to: p.to, state: st });
    }

    // Impact is signed and unbounded, so the ramp needs a scale before the
    // loop. Taking it from the largest move on the plan keeps the midpoint at
    // zero — grey means a cell nobody's change reached.
    let impactScale = 1;
    if (m === "impact" && scores && baseScores) {
      for (let i = 0; i < current.cells.length; i += 1) {
        const v = Math.abs(current.cells[i].population * (scores[i] - baseScores[i]));
        if (v > impactScale) impactScale = v;
      }
    }

    // Up close the ground is the point: the streets and blocks under a cell are
    // what tell you whether the zoning fits. So the wash thins out as the map
    // dives in, and the cell outline takes over the job of drawing the grid.
    const closeness = Math.min(1, Math.max(0, (zoom - 12.2) / 2.6));
    const wash = s.wash * (1 - closeness * 0.62);
    const strokeAlpha = 0.22 + closeness * 0.34;
    const lineWidth = zoom >= 13 ? 1 : zoom >= 12 ? 0.6 : 0.3;
    ctx.lineJoin = "miter";

    let selBox: number[] | null = null;

    for (let i = 0; i < current.cells.length; i += 1) {
      const x = boxArr[i * 4] * k - ox;
      const y = boxArr[i * 4 + 1] * k - oy;
      const w = boxArr[i * 4 + 2] * k;
      const h = boxArr[i * 4 + 3] * k;
      if (x + w < -8 || y + h < -8 || x > size.x + 8 || y > size.y + 8) continue;

      const cell = current.cells[i];
      const zone = plan[i];
      let fill: string;
      let alpha = wash;

      if (m === "zoning") {
        fill = zoneColor[zone];
      } else if (m === "proposed") {
        const f = flagged.get(cell.id);
        fill = f ? zoneColor[f.to as keyof typeof zoneColor] : zoneColor[zone];
        // Everything that is not changing steps back so the moves stand out.
        alpha = f ? Math.min(1, wash + 0.22) : wash * 0.35;
      } else if (m === "livability") {
        fill = sampleRamp("livability", scores ? scores[i] : 0.5);
      } else if (m === "impact") {
        // I_s = P_s (L_after - L_before), mapped onto a ramp whose middle is
        // no change. A cell can sit left of centre: rezoning has losers.
        const iS =
          scores && baseScores ? cell.population * (scores[i] - baseScores[i]) : 0;
        fill = sampleRamp("impact", 0.5 + 0.5 * (iS / impactScale));
        alpha = Math.abs(iS) < 1 ? wash * 0.4 : Math.min(1, wash + 0.2);
      } else if (m === "density") {
        fill = sampleRamp("density", Math.min(1, Math.log10(1 + cell.population) / 4.4));
      } else if (m === "green") {
        fill = sampleRamp("green", cell.greenCover / 100);
      } else {
        fill = sampleRamp("edge", cell.edgeness);
      }

      ctx.fillStyle = rgba(fill, alpha);
      ctx.fillRect(x, y, w + 0.5, h + 0.5);

      if (zoom >= 11) {
        ctx.strokeStyle = rgba(m === "zoning" ? zoneStroke(zone) : "#6b7280", strokeAlpha);
        ctx.lineWidth = lineWidth;
        ctx.strokeRect(x + 0.25, y + 0.25, w, h);
      }

      if (cell.id === sel) selBox = [x, y, w, h];
    }

    /* Proposal rings. Drawn after the wash so they are never overpainted. */
    if (m !== "proposed") ctx.globalAlpha = 0.9;
    for (const p of shown) {
      const st = state.proposalState[p.id] ?? "open";
      if (st === "dismissed") continue;
      const i = current.index.get(p.cellId);
      if (i === undefined) continue;
      const x = boxArr[i * 4] * k - ox;
      const y = boxArr[i * 4 + 1] * k - oy;
      const w = boxArr[i * 4 + 2] * k;
      const h = boxArr[i * 4 + 3] * k;
      if (x + w < 0 || y + h < 0 || x > size.x || y > size.y) continue;
      ctx.strokeStyle = st === "applied" ? signal.gain : signal.flag;
      ctx.lineWidth = st === "applied" ? 1.6 : 1.2;
      ctx.setLineDash(st === "applied" ? [] : [3, 2]);
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      ctx.setLineDash([]);
    }
    ctx.globalAlpha = 1;

    /* The flagged cell: four red pulses filling the two-second hold. */
    const f = state.focus;
    if (f && f.phase === "flagging") {
      const i = current.index.get(f.cellId);
      if (i !== undefined) {
        const t = (performance.now() - pulseStart.current) / duration.flagPulse;
        const wave = 0.5 - 0.5 * Math.cos(t * Math.PI * 2);
        const x = boxArr[i * 4] * k - ox;
        const y = boxArr[i * 4 + 1] * k - oy;
        const w = boxArr[i * 4 + 2] * k;
        const h = boxArr[i * 4 + 3] * k;
        ctx.fillStyle = rgba(signal.flag, 0.18 + wave * 0.5);
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = rgba(signal.flag, 0.5 + wave * 0.5);
        ctx.lineWidth = 1.5 + wave * 2.5;
        ctx.strokeRect(x, y, w, h);
        // A halo that breathes outward, so the cell is findable at low zoom.
        ctx.strokeStyle = rgba(signal.flag, 0.32 * (1 - wave));
        ctx.lineWidth = 1;
        const grow = 6 + wave * 16;
        ctx.strokeRect(x - grow, y - grow, w + grow * 2, h + grow * 2);
      }
    }

    /* Hover and selection, topmost. */
    if (hov && hov !== sel) {
      const i = current.index.get(hov);
      if (i !== undefined) {
        ctx.strokeStyle = rgba(chrome.ground, 0.55);
        ctx.lineWidth = 1.25;
        ctx.strokeRect(
          boxArr[i * 4] * k - ox + 0.5,
          boxArr[i * 4 + 1] * k - oy + 0.5,
          boxArr[i * 4 + 2] * k - 1,
          boxArr[i * 4 + 3] * k - 1,
        );
      }
    }

    if (selBox) {
      const [x, y, w, h] = selBox;
      ctx.strokeStyle = rgba(chrome.ground, 0.9);
      ctx.lineWidth = 3;
      ctx.strokeRect(x - 1, y - 1, w + 2, h + 2);
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.75;
      ctx.strokeRect(x - 1, y - 1, w + 2, h + 2);

      if (s.labels && zoom >= 12.5) {
        const label = view.current.selected ?? "";
        ctx.font = "600 10px var(--font-azeret), monospace";
        const tw = ctx.measureText(label).width;
        ctx.fillStyle = rgba(chrome.ground, 0.88);
        ctx.fillRect(x - 1, y - 17, tw + 10, 15);
        ctx.fillStyle = "#eef0f3";
        ctx.fillText(label, x + 4, y - 6);
      }
    }
  }

  /**
   * Runs one camera move on the Leaflet container.
   *
   * The class is stripped on animationend so the container goes back to an
   * untransformed box; Leaflet maps pointer positions through
   * getBoundingClientRect, and a lingering transform would skew every click.
   */
  function punch(kind: "fov-ascend" | "fov-dive", ms: number) {
    const el = host.current;
    if (!el || useStudio.getState().settings.motion === "calm") return;
    el.classList.remove("fov", "fov-ascend", "fov-dive");
    // Reading offsetWidth restarts the animation when the same class is
    // re-applied inside one frame, as a fast second click does.
    void el.offsetWidth;
    el.style.setProperty("--fov-ms", `${ms}ms`);
    el.classList.add("fov", kind);
    const clear = () => {
      el.classList.remove("fov", "fov-ascend", "fov-dive");
      el.style.removeProperty("--fov-ms");
    };
    el.addEventListener("animationend", clear, { once: true });
  }

  /** The cut at the top of the arc. */
  function flash() {
    const el = blink.current;
    if (!el || useStudio.getState().settings.motion === "calm") return;
    el.classList.remove("blink");
    void el.offsetWidth;
    el.style.setProperty("--blink-ms", `${duration.blink}ms`);
    el.classList.add("blink");
  }

  return (
    <div className="absolute inset-0 overflow-hidden bg-ground">
      <div
        ref={host}
        className="absolute inset-0 paper"
        role="application"
        aria-label="City grid. Arrow keys pan, plus and minus zoom. Use the worklist to move between proposed cells."
      />
      <div
        ref={blink}
        className="pointer-events-none absolute inset-0 opacity-0"
        style={{ zIndex: 450, background: chrome.ink }}
        aria-hidden="true"
      />
    </div>
  );
}

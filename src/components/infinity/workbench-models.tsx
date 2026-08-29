"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { RotateCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { HoloModelMesh } from "./holo-model-mesh";
import { InspectorHud } from "./inspector-hud";
import { MeasureHud } from "./measure-hud";
import { ColorWheel, type WheelApi } from "./color-wheel";
import { blockName, FACES_HINT_KEY } from "./workbench-sculpt";
import { useInfinity } from "@/lib/infinity/settings";
import { ASSEMBLE_MS } from "@/lib/infinity/holo-library";
import { dominantColor, HOLO_HOME_ROT, MAX_MODELS, normalizeHoloSpec, SPAWN_SETTLE_MS } from "@/lib/infinity/holo";
import {
  extrudeBlock,
  extrudeContext,
  extrudeLength,
  extrudePreview,
  faceAtPoint,
  facesForCanvasRect,
  facesForModel,
  modelCanvasRect,
  snapFaces,
  snapTargets,
  type ExtrudeCtx,
  type ExtrudePreview,
  type FaceSnap,
  type ModelFaces,
  type Pt,
} from "@/lib/infinity/snap";
import { HOLO_SCALE_MAX, HOLO_SCALE_MIN } from "@/lib/infinity/types";
import type { HoloModel } from "@/lib/infinity/types";
import { specStats } from "@/lib/infinity/workbench-vision";

/* ------------------------------------------------------------------ */
/* Progress bar — driven by REAL generation events                      */
/* (the bar eases toward the real assembly target — never invents       */
/*  only ever eases toward real targets, never invents completion)      */
/* ------------------------------------------------------------------ */

function BuildProgress({ building }: { building: BuildingState }) {
  const [disp, setDisp] = useState(2);
  const targetRef = useRef(building.progress);
  const phaseRef = useRef(building.phase);

  useEffect(() => {
    targetRef.current = building.progress;
    phaseRef.current = building.phase;
  }, [building.progress, building.phase]);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (t: number) => {
      const dt = Math.min(0.1, (t - last) / 1000);
      last = t;
      setDisp((prev) => {
        const target = targetRef.current * 100;
        if (prev >= target) return prev;
        // ease toward the real target; small linear floor so it always moves
        const speed = phaseRef.current === "done" ? 6 : 3.2;
        return Math.min(target, prev + Math.max((target - prev) * dt * speed, dt * 6));
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const failed = building.phase === "error";
  const done = building.phase === "done";
  const pct = Math.round(disp);
  const meta = failed
    ? ""
    : building.note
      ? `${building.note} · ${pct}%`
      : building.count !== null
        ? `${Math.min(building.partsDone, building.count)}/${building.count} PARTS · ${pct}%`
        : `${pct}%`;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.5 }}
      className="pointer-events-none absolute left-1/2 top-1/2 z-30 w-72 -translate-x-1/2 -translate-y-1/2 sm:w-80"
      role="status"
      aria-live="polite"
    >
      <p
        className={`mb-3 text-center text-[10px] font-light uppercase tracking-[0.4em] ${
          failed ? "text-red-400/80" : "text-sky-300/70"
        }`}
      >
        {failed
          ? "BUILD FAILED"
          : done
            ? `${building.name.toUpperCase()} READY`
            : `BUILDING ${building.name.toUpperCase()}`}
      </p>
      <div className="h-[3px] w-full overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full rounded-full ${
            failed
              ? "bg-red-400/70"
              : "bg-gradient-to-r from-sky-500/60 via-sky-300 to-cyan-200"
          }`}
          style={{ width: `${disp}%`, boxShadow: "0 0 12px rgba(103, 232, 249, 0.45)" }}
        />
      </div>
      {!failed && (
        <p className="mt-2 text-center font-mono text-[10px] tracking-widest text-sky-200/40">
          {meta}
        </p>
      )}
      {failed && building.message && (
        <p className="mt-2 px-2 text-center text-[10px] leading-relaxed text-red-300/70">
          {building.message}
        </p>
      )}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Model card — controls hug the ACTUAL hologram via a projected        */
/* bounds frame (see holo-model-mesh): drag to move (whole 3D faces     */
/* magnet-snap flush), shift-drag or the dial to rotate, L-corner to    */
/* resize, red button to delete, label above.                           */
/*                                                                      */
/* Block gestures, all one finger, all on the hologram itself:          */
/*   • double-tap + hold or drag on a face → grow a NEW block out of    */
/*     that face, lego-style;                                           */
/*   • press and hold (still) → the color wheel blooms under your       */
/*     finger — slide to a swatch, let go to repaint.                   */
/* ------------------------------------------------------------------ */

const scaleChip = (v: number) => Math.round(v * 100) / 100;

/** Max gap between the two taps of a double-tap on a block. */
const TAP_GAP_MS = 340;
/** Max distance between the two taps. */
const TAP_RADIUS_PX = 46;
/** Hold this long after the second tap → grow a block from the face. */
const HOLD_MS = 170;
/** …or move this far while holding → grow (fast double-click-drag). */
const MOVE_START_PX = 14;
/** Hold a block this long, still, → the color wheel blooms. */
const WHEEL_MS = 500;
/** A press that drifts this far is a drag, not a hold. */
const TAP_DRIFT_PX = 10;

type GestureKind =
  | "idle"
  | "press"
  | "armed"
  | "tap2"
  | "extrude"
  | "wheel"
  | "wheelIdle";

interface GestureState {
  kind: GestureKind;
  pid: number;
  downX: number;
  downY: number;
  downAt: number;
  moved: boolean;
  origPos: { x: number; y: number };
  /** My own face quads at drag start (translated by the drag delta). */
  base: ModelFaces | null;
  /** The neighbours' face quads — the magnetic context, read once per drag. */
  targets: Array<{ id: string; faces: ModelFaces }>;
  tapX: number;
  tapY: number;
  tapAt: number;
  /** The live extrusion being grown out of one of my faces. */
  ex: ExtrudeCtx | null;
}

const ptsAttr = (pts: ReadonlyArray<Pt>) =>
  pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

const fmtUnit = (v: number) => v.toFixed(1);

/** Cosmetic width/height pair naming an extruded block (Cube/Slab/Pillar). */
function extrudeLabelDims(ctx: ExtrudeCtx, L: number): { w: number; h: number } {
  const a = ctx.face >> 1;
  const eu = ctx.eU * 2;
  const ev = ctx.eV * 2;
  return {
    w: a === 1 ? Math.max(eu, ev) : a === 0 ? Math.max(L, ev) : Math.max(eu, L),
    h: a === 1 ? L : a === 0 ? eu : ev,
  };
}

function ModelCard({ model }: { model: HoloModel }) {
  const updateModel = useInfinity((s) => s.updateModel);
  const removeModel = useInfinity((s) => s.removeModel);
  const arranging = useInfinity((s) => s.arranging);
  const blueprint = useInfinity((s) => s.blueprint);
  const inspectId = useInfinity((s) => s.inspectId);
  const focusedId = useInfinity((s) => s.focusedId);
  const setInspect = useInfinity((s) => s.setInspect);
  const rootRef = useRef<HTMLDivElement>(null);
  /** Tracks the hologram's true projected bounds — controls live inside it. */
  const frameRef = useRef<HTMLDivElement>(null);

  /* ---- the one-finger gesture machine ---- */
  const g = useRef<GestureState>({
    kind: "idle",
    pid: -1,
    downX: 0,
    downY: 0,
    downAt: 0,
    moved: false,
    origPos: { x: 0, y: 0 },
    base: null,
    targets: [],
    tapX: 0,
    tapY: 0,
    tapAt: 0,
    ex: null,
  });
  const tWheel = useRef(0);
  const tExtrude = useRef(0);
  const tArm = useRef(0);
  /** Rotate drags (shift / right button / ctrl) ride here, outside the machine. */
  const rotDrag = useRef<{ pid: number; startX: number; startY: number; origRot: { x: number; y: number } } | null>(null);

  const [dragging, setDragging] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [rotating, setRotating] = useState(false);
  /** The shared face where I'm magnet-joined (its quad glows on the target). */
  const [snap, setSnap] = useState<{ pts: [Pt, Pt, Pt, Pt]; key: string } | null>(null);
  const snapRef = useRef<typeof snap>(null);
  const snapKey = useRef<string | null>(null);
  const setSnapSynced = useCallback((v: { pts: [Pt, Pt, Pt, Pt]; key: string } | null) => {
    snapRef.current = v;
    setSnap(v);
  }, []);
  /** One-shot fading flash of the shared face when a joined drag lets go. */
  const [flash, setFlash] = useState<[Pt, Pt, Pt, Pt] | null>(null);
  /** The block being grown out of one of my faces (live ghost + length). */
  const [ex, setEx] = useState<{ ctx: ExtrudeCtx; L: number; preview: ExtrudePreview } | null>(null);
  const exRef = useRef<typeof ex>(null);
  const setExSynced = useCallback(
    (v: { ctx: ExtrudeCtx; L: number; preview: ExtrudePreview } | null) => {
      exRef.current = v;
      setEx(v);
    },
    []
  );
  /** The color wheel's origin while open. */
  const [wheel, setWheel] = useState<Pt | null>(null);
  const wheelApi = useRef<WheelApi | null>(null);
  /** Mount the 3D canvas only after the spawn animation settles — R3F sizes
   *  the canvas with a transform-aware measurement and would otherwise catch
   *  the mid-animation scale (see holo-model-mesh CameraRig). */
  const [meshReady, setMeshReady] = useState(false);
  /** Fixed overlays render through a portal — the card root is transformed,
   *  which would otherwise re-anchor position:fixed children to the card. */
  const [portal] = useState<HTMLElement | null>(() =>
    typeof document === "undefined" ? null : document.body
  );

  useEffect(() => {
    const t = window.setTimeout(() => setMeshReady(true), SPAWN_SETTLE_MS);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(
    () => () => {
      window.clearTimeout(tWheel.current);
      window.clearTimeout(tExtrude.current);
      window.clearTimeout(tArm.current);
      wheelApi.current = null;
    },
    []
  );

  const scale = model.scale ?? 1;
  const showHandles = hovered || resizing || rotating || dragging;
  const pct = Math.round(scale * 100);
  // Focus mode: the star model scales up + showcase-spins, everything else
  // dims and stops catching pointers.
  const focused = focusedId === model.id;
  const dimmed = focusedId !== null && !focused;
  const inspecting = inspectId === model.id;
  const stats = model.measure ? specStats(model.spec, scale) : null;

  /* ---- grow a new block out of one of my faces (lego building) ---- */

  const beginExtrude = useCallback(
    (ax: number, ay: number, curX: number, curY: number) => {
      const s = g.current;
      const store = useInfinity.getState();
      if (store.models.length >= MAX_MODELS) {
        toast.error("The workbench is full — delete a model first.");
        s.kind = "idle";
        return;
      }
      const rect = modelCanvasRect(model.id);
      if (!rect) {
        s.kind = "idle";
        return;
      }
      const faces = facesForCanvasRect(model.spec, model.rot, model.scale ?? 1, rect);
      const face = faceAtPoint(faces, { x: ax, y: ay });
      const ctx = extrudeContext(
        model.spec,
        model.rot,
        model.scale ?? 1,
        rect,
        face,
        { x: ax, y: ay }
      );
      if (!ctx) {
        s.kind = "idle";
        return;
      }
      window.clearTimeout(tWheel.current);
      s.kind = "extrude";
      s.ex = ctx;
      const L = extrudeLength(ctx, { x: curX, y: curY });
      setExSynced({ ctx, L, preview: extrudePreview(ctx, L) });
    },
    [model.id, model.spec, model.rot, model.scale, setExSynced]
  );

  const commitExtrude = useCallback(() => {
    const s = g.current;
    const ctx = s.ex;
    const cur = exRef.current;
    s.kind = "idle";
    s.ex = null;
    setExSynced(null);
    setDragging(false);
    if (!ctx || !cur) return;

    const store = useInfinity.getState();
    if (store.models.length >= MAX_MODELS) {
      toast.error("The workbench is full — delete a model first.");
      return;
    }

    // The new block inherits the parent's color — one hold away from any
    // other via the wheel.
    const color = dominantColor(model.spec);
    const { part, centerScreen, dims } = extrudeBlock(ctx, cur.L, color);
    const count = store.models.filter((m) => m.hand).length + 1;
    const ld = extrudeLabelDims(ctx, cur.L);
    const name = blockName(ld.w, ld.h, count);
    const spec = normalizeHoloSpec(name, [part]);
    const nextScale = Math.max(dims[0], dims[1], dims[2]) / 2.3;

    store.addModel({
      id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name,
      spec,
      pos: {
        x: (centerScreen.x / window.innerWidth) * 100,
        y: (centerScreen.y / window.innerHeight) * 100,
      },
      rot: { ...ctx.rot },
      scale: Math.round(nextScale * 100) / 100,
      bornAt: Date.now(),
      hand: true,
    });

    if ("vibrate" in navigator) {
      try {
        navigator.vibrate(8);
      } catch {
        /* unsupported */
      }
    }
    try {
      localStorage.setItem(FACES_HINT_KEY, "1");
    } catch {
      /* private mode */
    }
  }, [model.spec, setExSynced]);

  /* ---- the color wheel ---- */

  const openWheel = useCallback((x: number, y: number) => {
    const s = g.current;
    window.clearTimeout(tWheel.current);
    // Best effort — the held finger keeps driving the wheel through
    // api.move/up even if the capture sticks.
    try {
      frameRef.current?.releasePointerCapture(s.pid);
    } catch {
      /* already gone */
    }
    s.kind = "wheel";
    setDragging(false);
    setWheel({ x, y });
  }, []);

  const closeWheel = useCallback(() => {
    setWheel(null);
    g.current.kind = "idle";
  }, []);

  const recolor = useCallback(
    (hex: string, name: string) => {
      // Same rule as the voice command: swap the dominant color, keep accents.
      const dominant = dominantColor(model.spec);
      const parts = model.spec.parts.map((p) =>
        p.color === dominant ? { ...p, color: hex } : p
      );
      updateModel(model.id, { spec: { ...model.spec, parts } });
      toast(`${model.name} → ${name}`);
    },
    [model.id, model.name, model.spec, updateModel]
  );

  /* ---- pointer pipeline ---- */

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!e.isPrimary) return;
      const now = performance.now();

      const rotate = e.shiftKey || e.button === 2 || e.ctrlKey || e.metaKey;
      if (rotate) {
        g.current.pid = -1;
        rotDrag.current = {
          pid: e.pointerId,
          startX: e.clientX,
          startY: e.clientY,
          origRot: { ...model.rot },
        };
        try {
          frameRef.current?.setPointerCapture(e.pointerId);
        } catch {
          /* stale/synthetic pointer */
        }
        setDragging(true);
        return;
      }

      window.clearTimeout(tArm.current);
      window.clearTimeout(tWheel.current);
      window.clearTimeout(tExtrude.current);
      const s = g.current;

      if (
        s.kind === "armed" &&
        Math.hypot(e.clientX - s.tapX, e.clientY - s.tapY) <= TAP_RADIUS_PX &&
        now - s.tapAt <= TAP_GAP_MS
      ) {
        // Second tap of a double-tap on this hologram → build on the face.
        s.kind = "tap2";
        s.pid = e.pointerId;
        s.downX = e.clientX;
        s.downY = e.clientY;
        s.downAt = now;
        s.moved = false;
        try {
          frameRef.current?.setPointerCapture(e.pointerId);
        } catch {
          /* stale/synthetic pointer */
        }
        tExtrude.current = window.setTimeout(() => {
          const g2 = g.current;
          if (g2.kind === "tap2") beginExtrude(g2.downX, g2.downY, g2.downX, g2.downY);
        }, HOLD_MS);
      } else {
        // First tap: a plain drag until proven otherwise. If it stays put for
        // WHEEL_MS, the color wheel blooms instead.
        s.kind = "press";
        s.pid = e.pointerId;
        s.downX = e.clientX;
        s.downY = e.clientY;
        s.downAt = now;
        s.moved = false;
        s.origPos = { ...model.pos };
        s.ex = null;
        s.base = facesForModel(model);
        s.targets = s.base
          ? snapTargets(
              useInfinity.getState().models.filter((m) => m.id !== model.id)
            )
          : [];
        try {
          frameRef.current?.setPointerCapture(e.pointerId);
        } catch {
          /* stale/synthetic pointer */
        }
        tWheel.current = window.setTimeout(() => {
          const g2 = g.current;
          if (g2.kind === "press" && !g2.moved) openWheel(g2.downX, g2.downY);
        }, WHEEL_MS);
      }
      setDragging(true);
    },
    [beginExtrude, model.id, model.pos, model.rot, model.scale, model.spec, openWheel]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const r = rotDrag.current;
      if (r) {
        if (e.pointerId !== r.pid) return;
        updateModel(model.id, {
          rot: {
            x: Math.max(-1.35, Math.min(1.35, r.origRot.x + (e.clientY - r.startY) * 0.006)),
            y: r.origRot.y + (e.clientX - r.startX) * 0.008,
          },
        });
        return;
      }
      const s = g.current;
      if (e.pointerId !== s.pid) return;
      const dx = e.clientX - s.downX;
      const dy = e.clientY - s.downY;

      if (s.kind === "press") {
        if (Math.abs(dx) + Math.abs(dy) > 2) s.moved = true;
        if (s.moved && Math.hypot(dx, dy) > TAP_DRIFT_PX) {
          window.clearTimeout(tWheel.current);
        }
        if (!s.moved) return;

        // Magnetic faces: my whole face pulls flush onto a neighbour's
        // opposing face — stack, tuck under, or click onto any side.
        let snap: FaceSnap | null = null;
        if (s.base) snap = snapFaces(s.base, { x: dx, y: dy }, s.targets);
        const ax = dx + (snap?.dx ?? 0);
        const ay = dy + (snap?.dy ?? 0);
        updateModel(model.id, {
          pos: {
            x: Math.max(6, Math.min(94, s.origPos.x + (ax / window.innerWidth) * 100)),
            y: Math.max(8, Math.min(92, s.origPos.y + (ay / window.innerHeight) * 100)),
          },
        });
        if (snap) {
          const key = `${snap.targetId}:${snap.targetFace}`;
          if (snapKey.current !== key) {
            snapKey.current = key;
            setSnapSynced({ pts: snap.seam, key });
            if ("vibrate" in navigator) {
              try {
                navigator.vibrate(8);
              } catch {
                /* unsupported */
              }
            }
          }
        } else if (snapKey.current) {
          snapKey.current = null;
          setSnapSynced(null);
        }
      } else if (s.kind === "tap2") {
        if (Math.hypot(dx, dy) > MOVE_START_PX) {
          window.clearTimeout(tExtrude.current);
          beginExtrude(s.downX, s.downY, e.clientX, e.clientY);
        }
      } else if (s.kind === "extrude" && s.ex) {
        const L = extrudeLength(s.ex, { x: e.clientX, y: e.clientY });
        setExSynced({ ctx: s.ex, L, preview: extrudePreview(s.ex, L) });
      } else if (s.kind === "wheel") {
        wheelApi.current?.move({ x: e.clientX, y: e.clientY });
      }
    },
    [beginExtrude, model.id, setExSynced, setSnapSynced, updateModel]
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const r = rotDrag.current;
      if (r) {
        if (e.pointerId !== r.pid) return;
        rotDrag.current = null;
        setDragging(false);
        return;
      }
      const s = g.current;
      if (e.pointerId !== s.pid) return;
      window.clearTimeout(tWheel.current);
      window.clearTimeout(tExtrude.current);
      const now = performance.now();
      const still = Math.hypot(e.clientX - s.downX, e.clientY - s.downY) <= TAP_DRIFT_PX;

      if (s.kind === "press") {
        // Letting go while face-joined → the shared face flashes once.
        const cur = snapRef.current;
        if (snapKey.current && cur) {
          const pts = cur.pts;
          setFlash(pts);
          window.setTimeout(() => setFlash((f) => (f === pts ? null : f)), 750);
        }
        snapKey.current = null;
        setSnapSynced(null);

        if (now - s.downAt < TAP_GAP_MS && still) {
          // A quick tap — remember it for a possible double-tap.
          s.kind = "armed";
          s.tapX = s.downX;
          s.tapY = s.downY;
          s.tapAt = now;
          tArm.current = window.setTimeout(() => {
            if (g.current.kind === "armed") g.current.kind = "idle";
          }, TAP_GAP_MS + 80);
        } else {
          s.kind = "idle";
        }
        setDragging(false);
      } else if (s.kind === "tap2") {
        // Plain double-tap without hold or drag — nothing to do.
        s.kind = "idle";
        setDragging(false);
      } else if (s.kind === "extrude") {
        commitExtrude();
      } else if (s.kind === "wheel") {
        wheelApi.current?.up({ x: e.clientX, y: e.clientY });
        s.kind = "wheelIdle"; // the wheel stays open until closed
      }
    },
    [commitExtrude, setSnapSynced]
  );

  const onPointerCancel = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const r = rotDrag.current;
      if (r && e.pointerId === r.pid) {
        rotDrag.current = null;
        setDragging(false);
        return;
      }
      const s = g.current;
      if (e.pointerId !== s.pid) return;
      window.clearTimeout(tWheel.current);
      window.clearTimeout(tExtrude.current);
      window.clearTimeout(tArm.current);
      if (s.kind === "wheel" || s.kind === "wheelIdle") {
        wheelApi.current?.cancel();
      } else {
        s.kind = "idle";
      }
      s.ex = null;
      setExSynced(null);
      snapKey.current = null;
      setSnapSynced(null);
      setDragging(false);
    },
    [setExSynced, setSnapSynced]
  );

  /* ---- resize: drag the L corner — pull away from the object to grow.
   * Double-tap the corner to reset to 100%. */

  const lastHandleDown = useRef(0);

  const startResize = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // never let the card drag fire from the handle
      e.stopPropagation();
      e.preventDefault();
      // double-tap/double-click the corner → reset size (OS-like threshold)
      const now = performance.now();
      if (now - lastHandleDown.current < 450) {
        lastHandleDown.current = 0;
        updateModel(model.id, { scale: 1 });
        return;
      }
      lastHandleDown.current = now;
      const rect = frameRef.current?.getBoundingClientRect();
      if (!rect) return;
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const startDist = Math.max(24, Math.hypot(e.clientX - cx, e.clientY - cy));
      const startScale = model.scale ?? 1;
      setResizing(true);

      const onMove = (ev: PointerEvent) => {
        const dist = Math.hypot(ev.clientX - cx, ev.clientY - cy);
        const next = (startScale * dist) / startDist;
        updateModel(model.id, {
          scale: scaleChip(Math.max(HOLO_SCALE_MIN, Math.min(HOLO_SCALE_MAX, next))),
        });
      };
      const stop = () => {
        setResizing(false);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", stop);
        window.removeEventListener("pointercancel", stop);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", stop);
      window.addEventListener("pointercancel", stop);
    },
    [model.id, model.scale, updateModel]
  );

  /* ---- rotate dial: drag to turn the hologram (touch-friendly — no
   *   shift key needed), double-tap to level it back to the home tilt. */

  const lastDialDown = useRef(0);

  const startRotate = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // never let the card drag fire from the dial
      e.stopPropagation();
      e.preventDefault();
      const now = performance.now();
      if (now - lastDialDown.current < 450) {
        lastDialDown.current = 0;
        updateModel(model.id, { rot: { ...HOLO_HOME_ROT } });
        return;
      }
      lastDialDown.current = now;
      setRotating(true);
      const startX = e.clientX;
      const startY = e.clientY;
      const orig = { ...model.rot };
      const onMove = (ev: PointerEvent) => {
        updateModel(model.id, {
          rot: {
            x: Math.max(-1.35, Math.min(1.35, orig.x + (ev.clientY - startY) * 0.006)),
            y: orig.y + (ev.clientX - startX) * 0.008,
          },
        });
      };
      const stop = () => {
        setRotating(false);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", stop);
        window.removeEventListener("pointercancel", stop);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", stop);
      window.addEventListener("pointercancel", stop);
    },
    [model.id, model.rot, updateModel]
  );

  const onDialKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const step = e.shiftKey ? 0.3 : 0.15;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        updateModel(model.id, { rot: { x: model.rot.x, y: model.rot.y + step } });
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        updateModel(model.id, { rot: { x: model.rot.x, y: model.rot.y - step } });
      } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        const dir = e.key === "ArrowUp" ? 1 : -1;
        updateModel(model.id, {
          rot: {
            x: Math.max(-1.35, Math.min(1.35, model.rot.x + dir * 0.1)),
            y: model.rot.y,
          },
        });
      }
    },
    [model.id, model.rot, updateModel]
  );

  const resetRot = useCallback(() => {
    updateModel(model.id, { rot: { ...HOLO_HOME_ROT } });
  }, [model.id, updateModel]);

  /* ---- resize via keyboard (handle is a slider) + double-click reset */

  const onHandleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const step = e.shiftKey ? 0.25 : 0.1;
      if (e.key === "ArrowUp" || e.key === "ArrowRight") {
        e.preventDefault();
        updateModel(model.id, {
          scale: scaleChip(Math.min(HOLO_SCALE_MAX, scale + step)),
        });
      } else if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
        e.preventDefault();
        updateModel(model.id, {
          scale: scaleChip(Math.max(HOLO_SCALE_MIN, scale - step)),
        });
      }
    },
    [model.id, scale, updateModel]
  );

  const resetScale = useCallback(() => {
    updateModel(model.id, { scale: 1 });
  }, [model.id, updateModel]);

  const onDeleteClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      removeModel(model.id);
    },
    [model.id, removeModel]
  );

  const labelText = pct !== 100 ? `${model.name} · ${pct}%` : model.name;

  /* Fixed overlays live in a portal (the card root is transformed). */
  const overlays = portal
    ? createPortal(
        <>
          {/* ---- magnetic faces: the shared face itself, glowing on the
               target while the join holds ---- */}
          {snap && (
            <svg aria-hidden className="pointer-events-none fixed inset-0 z-[14] h-full w-full">
              <motion.polygon
                points={ptsAttr(snap.pts)}
                fill="rgba(103,232,249,0.10)"
                stroke="#67e8f9"
                strokeWidth={1.5}
                style={{ filter: "drop-shadow(0 0 6px rgba(103,232,249,0.85))" }}
                animate={{ opacity: [0.6, 1, 0.6] }}
                transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
              />
            </svg>
          )}
          {/* …and flashing out when the drag lets go */}
          {flash && (
            <svg aria-hidden className="pointer-events-none fixed inset-0 z-[14] h-full w-full">
              <motion.polygon
                points={ptsAttr(flash)}
                fill="rgba(103,232,249,0.18)"
                stroke="#67e8f9"
                strokeWidth={2}
                style={{ filter: "drop-shadow(0 0 8px rgba(103,232,249,0.9))" }}
                initial={{ opacity: 0.95 }}
                animate={{ opacity: 0 }}
                transition={{ duration: 0.7, ease: "easeOut" }}
              />
            </svg>
          )}

          {/* ---- the lego ghost: a new block growing out of one of my faces ---- */}
          {ex && (
            <>
              <motion.svg
                aria-hidden
                className="pointer-events-none fixed inset-0 z-[14] h-full w-full"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.15 }}
              >
                {/* the face being built on */}
                <polygon
                  points={ptsAttr(ex.ctx.faceQuad)}
                  fill="rgba(103,232,249,0.10)"
                  stroke="#a5f3fc"
                  strokeWidth={1.5}
                  style={{ filter: "drop-shadow(0 0 5px rgba(103,232,249,0.7))" }}
                />
                {/* the growing block — faces far → near */}
                {ex.preview.quads.map((q, i) => (
                  <polygon
                    key={i}
                    points={ptsAttr(q.pts)}
                    fill="rgba(103,232,249,0.055)"
                    stroke="rgba(103,232,249,0.45)"
                    strokeWidth={1}
                  />
                ))}
                {/* the join — where the new face meets the parent */}
                <polygon
                  points={ptsAttr(ex.preview.attach)}
                  fill="rgba(103,232,249,0.12)"
                  stroke="#67e8f9"
                  strokeWidth={1.5}
                  style={{ filter: "drop-shadow(0 0 6px rgba(103,232,249,0.9))" }}
                />
              </motion.svg>
              <div
                aria-hidden
                className="pointer-events-none fixed z-[14] -translate-x-1/2 -translate-y-full whitespace-nowrap rounded border border-cyan-300/25 bg-black/75 px-2 py-1 font-mono text-[9px] tracking-[0.2em] text-cyan-200/90 backdrop-blur-sm"
                style={{ left: ex.preview.outer.x, top: ex.preview.outer.y - 8 }}
              >
                {`${blockName(extrudeLabelDims(ex.ctx, ex.L).w, extrudeLabelDims(ex.ctx, ex.L).h, 1)
                  .split(" ")[0]
                  .toUpperCase()} · ${fmtUnit(ex.ctx.eU * 2)} × ${fmtUnit(ex.ctx.eV * 2)} × ${fmtUnit(ex.L)}`}
              </div>
            </>
          )}

          {/* ---- the color wheel ---- */}
          {wheel && (
            <ColorWheel
              origin={wheel}
              modelName={model.name}
              currentColor={dominantColor(model.spec)}
              apiRef={wheelApi}
              onPick={recolor}
              onClose={closeWheel}
            />
          )}
        </>,
        portal
      )
    : null;

  return (
    <div
      ref={rootRef}
      data-model-id={model.id}
      className={`holo-card pointer-events-none absolute h-44 w-44 -translate-x-1/2 -translate-y-1/2 select-none sm:h-56 sm:w-56 ${
        focused ? "z-30" : ""
      }`}
      style={{
        left: `${model.pos.x}%`,
        top: `${model.pos.y}%`,
        // Auto-arrange glides cards to their new slots (drag stays instant —
        // the transition is mounted only while the arrange flag is up).
        transition: arranging ? "left 700ms cubic-bezier(0.22,1,0.36,1), top 700ms cubic-bezier(0.22,1,0.36,1)" : undefined,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onContextMenu={(e) => e.preventDefault()}
    >
      {overlays}
      <motion.div
        className="relative h-full w-full"
        initial={{ opacity: 0, scale: 0.85 }}
        animate={
          focused
            ? { opacity: 1, scale: 1.16 }
            : dimmed
              ? { opacity: 0.1, scale: 0.96 }
              : { opacity: 1, scale: 1 }
        }
        exit={{
          opacity: 0,
          scale: 0.5,
          filter: "blur(3px)",
          transition: { duration: 0.28, ease: "easeIn" },
        }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      >
        {meshReady && (
          <HoloModelMesh
            spec={model.spec}
            rot={model.rot}
            scale={scale}
            spin={model.spin}
            exploded={model.exploded}
            xray={model.xray}
            solid={model.solid}
            blueprint={blueprint}
            showcase={focused}
            assembleMs={
              // Fresh local builds assemble part-by-part. Pending AI builds
              // assemble LIVE as the design streams in (no timer).
              !model.pending &&
              model.bornAt &&
              Date.now() - model.bornAt < ASSEMBLE_MS + 800
                ? ASSEMBLE_MS
                : undefined
            }
            frameRef={frameRef}
          />
        )}

        {/* ---- the object frame: positioned every frame to the hologram's
             true projected bounds — everything below hugs the object ---- */}
        <div
          ref={frameRef}
          role="img"
          aria-label={`Holographic model: ${model.name}. Drag to move — whole faces snap together. Double-tap a face and drag to build a new block on it. Press and hold for the color wheel. Drag the corner dial or shift-drag to rotate. Hover for resize and delete controls.`}
          tabIndex={0}
          className={`pointer-events-auto absolute cursor-grab touch-none rounded-lg outline-none transition-shadow duration-200 focus-visible:ring-1 focus-visible:ring-sky-300/50 active:cursor-grabbing ${
            dimmed ? "pointer-events-none" : ""
          } ${snap ? "ring-1 ring-cyan-300/60" : ""}`}
          style={{ left: "15%", top: "15%", width: "70%", height: "70%" }}
          onPointerEnter={() => setHovered(true)}
          onPointerLeave={() => setHovered(false)}
          onFocus={() => setHovered(true)}
          onBlur={() => setHovered(false)}
        >
          {/* projector glow — sized to the object, grows with it */}
          <div
            aria-hidden
            className="pointer-events-none absolute -bottom-[4%] left-[10%] right-[10%] h-[12%] rounded-[50%] bg-sky-400/10 blur-md"
          />

          {/* label — just above the object */}
          <span
            aria-hidden
            className={`pointer-events-none absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap text-[9px] font-light uppercase tracking-[0.3em] transition-opacity ${
              dragging || resizing || hovered
                ? "text-sky-300/80 opacity-100"
                : "text-sky-300/50 opacity-85"
            }`}
          >
            {labelText}
          </span>

          {/* ---- one small L-style corner: drag to resize the hologram ---- */}
          <div
            role="slider"
            aria-label={`Resize ${model.name} hologram`}
            aria-valuemin={Math.round(HOLO_SCALE_MIN * 100)}
            aria-valuemax={Math.round(HOLO_SCALE_MAX * 100)}
            aria-valuenow={pct}
            aria-valuetext={`${pct} percent size`}
            tabIndex={showHandles ? 0 : -1}
            title="Drag to resize · double-click to reset"
            onPointerDown={startResize}
            onKeyDown={onHandleKeyDown}
            onDoubleClick={resetScale}
            className={`absolute bottom-0 right-0 flex h-10 w-10 cursor-nwse-resize touch-none items-end justify-end rounded-tl-lg p-[5px] outline-none transition-opacity duration-200 focus-visible:ring-1 focus-visible:ring-sky-300/70 ${
              showHandles ? "opacity-100" : "pointer-events-none opacity-0"
            }`}
          >
            <svg
              width="17"
              height="17"
              viewBox="0 0 17 17"
              fill="none"
              aria-hidden="true"
              className={`transition-colors duration-150 ${
                resizing
                  ? "text-cyan-200 drop-shadow-[0_0_6px_rgba(103,232,249,1)]"
                  : "text-sky-300/90 drop-shadow-[0_0_5px_rgba(125,211,252,0.85)]"
              }`}
            >
              <path
                d="M16 5.5V16H5.5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M16 10V16H10"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity="0.55"
              />
            </svg>
          </div>

          {/* live size readout while resizing */}
          {resizing && (
            <span className="pointer-events-none absolute bottom-11 right-1 rounded border border-sky-300/30 bg-sky-500/10 px-1.5 py-0.5 font-mono text-[9px] tracking-wider text-sky-200/90 backdrop-blur-sm">
              {pct}%
            </span>
          )}

          {/* ---- rotate dial: drag to turn (touch-friendly), double-click
               to level back to the home tilt ---- */}
          <div
            role="slider"
            aria-label={`Rotate ${model.name} hologram`}
            aria-valuemin={-180}
            aria-valuemax={180}
            aria-valuenow={Math.round((model.rot.y * 180) / Math.PI) % 360}
            aria-valuetext={`${Math.round((model.rot.y * 180) / Math.PI) % 360} degrees`}
            tabIndex={showHandles ? 0 : -1}
            title="Drag to rotate · double-click to level"
            onPointerDown={startRotate}
            onKeyDown={onDialKeyDown}
            onDoubleClick={resetRot}
            className={`absolute bottom-0 left-0 flex h-10 w-10 cursor-grab touch-none items-end justify-start rounded-tr-lg p-[5px] outline-none transition-opacity duration-200 focus-visible:ring-1 focus-visible:ring-sky-300/70 active:cursor-grabbing ${
              showHandles ? "opacity-100" : "pointer-events-none opacity-0"
            }`}
          >
            <RotateCw
              className={`h-4 w-4 transition-colors duration-150 ${
                rotating
                  ? "text-cyan-200 drop-shadow-[0_0_6px_rgba(103,232,249,1)]"
                  : "text-sky-300/90 drop-shadow-[0_0_5px_rgba(125,211,252,0.85)]"
              }`}
              strokeWidth={2.2}
              aria-hidden="true"
            />
          </div>

          {/* live rotation readout while turning */}
          {rotating && (
            <span className="pointer-events-none absolute bottom-11 left-1 rounded border border-sky-300/30 bg-sky-500/10 px-1.5 py-0.5 font-mono text-[9px] tracking-wider text-sky-200/90 backdrop-blur-sm">
              {`${Math.round((model.rot.y * 180) / Math.PI) % 360}°`}
            </span>
          )}

          {/* ---- measure HUD: dimension lines hugging the object ---- */}
          <AnimatePresence>
            {model.measure && stats && <MeasureHud key="measure" stats={stats} />}
          </AnimatePresence>

          {/* ---- red holographic delete button ---- */}
          <button
            type="button"
            aria-label={`Delete ${model.name} hologram`}
            aria-hidden={!showHandles}
            tabIndex={showHandles ? 0 : -1}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onDeleteClick}
            className={`absolute -right-3 -top-3 flex h-8 w-8 items-center justify-center rounded-full border border-red-400/60 bg-red-500/15 text-red-300 shadow-[0_0_16px_rgba(248,113,113,0.35)] backdrop-blur-sm transition-all duration-200 hover:scale-110 hover:border-red-300/90 hover:bg-red-500/30 hover:text-red-100 hover:shadow-[0_0_24px_rgba(248,113,113,0.55)] active:scale-90 ${
              showHandles
                ? "scale-100 opacity-100"
              : "pointer-events-none scale-75 opacity-0"
            }`}
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden="true" />
          </button>
        </div>

        {/* ---- inspector HUD: floating spec readout for this model ---- */}
        <AnimatePresence>
          {inspecting && (
            <InspectorHud key="inspector" model={model} onClose={() => setInspect(null)} />
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Layer: models + build progress (rendered only while grid is visible) */
/* ------------------------------------------------------------------ */

export function WorkbenchModels({ building }: { building: BuildingState | null }) {
  const models = useInfinity((s) => s.models);
  const focusedId = useInfinity((s) => s.focusedId);
  const focused = models.find((m) => m.id === focusedId);

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      {/* Focus mode: a soft spotlight pool under the star model + a chip so
          the mode (and how to leave it) is always legible. */}
      <AnimatePresence>
        {focused && (
          <motion.div
            key="spotlight"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6 }}
            className="pointer-events-none absolute inset-0"
            style={{
              background: `radial-gradient(circle at ${focused.pos.x}% ${focused.pos.y}%, rgba(56,189,248,0.10) 0%, rgba(56,189,248,0.04) 30%, transparent 52%)`,
            }}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {focused && (
          <motion.div
            key="presenting"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.35 }}
            className="absolute left-1/2 top-6 z-40 -translate-x-1/2"
          >
            <span className="rounded-full border border-cyan-300/25 bg-black/70 px-4 py-1.5 text-[9px] font-light uppercase tracking-[0.4em] text-cyan-200/90 backdrop-blur-sm">
              Presenting · {focused.name} · esc
            </span>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {models.map((m) => (
          <ModelCard key={m.id} model={m} />
        ))}
      </AnimatePresence>
      <AnimatePresence>
        {building && <BuildProgress key="progress" building={building} />}
      </AnimatePresence>
    </div>
  );
}

export type BuildPhase = "building" | "done" | "error";

export interface BuildingState {
  name: string;
  phase: BuildPhase;
  /** Real completion target 0..1, synced to the on-screen part-by-part assembly. */
  progress: number;
  /** Parts assembled so far. */
  partsDone: number;
  /** Total parts in the model. */
  count: number | null;
  /** While the AI designs: "DESIGNING" or "N PARTS" (shown in the meta line). */
  note?: string;
  /** On failure: the human-readable reason (shown under BUILD FAILED). */
  message?: string;
}

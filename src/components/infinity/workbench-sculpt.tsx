"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import { Box } from "lucide-react";
import { useInfinity } from "@/lib/infinity/settings";
import { HOLO_HOME_ROT, MAX_MODELS, normalizeHoloSpec } from "@/lib/infinity/holo";
import { facesAtCenter, snapFaces, snapTargets, type Pt } from "@/lib/infinity/snap";
import type { HoloPart } from "@/lib/infinity/types";

/**
 * Workbench sculpt — hand-drawn hologram blocks.
 *
 * Double-tap (or double-click) anywhere on the open bench, keep holding,
 * and drag: a square grows from the exact point you touched — the anchor
 * corner stays put while the drag defines the opposite corner, so the
 * block is sized exactly the way you draw it. Let go, and the square
 * materializes into a real rotatable 3D hologram — cube, slab, or pillar —
 * with the proportions you drew.
 *
 * Blocks land FACE-TO-FACE with their neighbours: draw near a stack and the
 * target face lights up while you draw; on release the block settles with
 * its whole face flush on it and the shared face pulses once. (Building
 * directly ON a face — double-tap-drag on the face itself — lives in
 * workbench-models.tsx, with the color wheel.)
 */

/* ------------------------------ tuning ------------------------------ */

/** Max gap between the two taps of the double-tap. */
const TAP_GAP_MS = 340;
/** Max distance between the two taps. */
const TAP_RADIUS_PX = 46;
/** Hold this long after the second tap → sculpting. */
const HOLD_MS = 170;
/** …or move this far while holding → sculpting (fast double-click-drag). */
const MOVE_START_PX = 14;
/** A first tap that drifts this far is a drag, not a tap. */
const TAP_DRIFT_PX = 12;
/** Rects smaller than this on release are discarded (accidental). */
const MIN_SIDE_PX = 28;
/** Side cap: the block must never outgrow its canvas headroom
 *  (see holo-model-mesh — the canvas is 3× the card, camera pulled back). */
const MAX_SIDE_FACTOR = 1.45;
/** Where "seen the hint" is remembered. */
const HINT_KEY = "infinity-sculpt-hint-seen";
/** Where "seen the face-building hint" is remembered. */
export const FACES_HINT_KEY = "infinity-faces-hint-seen";
/** Fresh blocks are bright hologram cyan — distinct from the AI palette,
 *  and one hold-and-slide away from any color the user wants. */
const BLOCK_COLOR = "#67e8f9";

/** px→world mapping from the mesh camera (fov 38, ~11.78 units out): the
 *  3×-card canvas spans ~8.11 units → 1 world unit ≈ 0.3697 × card px.
 *  A square drag makes a true cube: depth = min(width, height). */
const cardPx = () => (window.innerWidth >= 640 ? 224 : 176);
const pxPerUnit = () => 0.3697 * cardPx();

/** Cube / Slab / Pillar from the drawn aspect ratio — plain words the
 *  voice engine already understands ("delete the pillar"). */
export function blockName(w: number, h: number, count: number): string {
  const r = w / h;
  const shape = r >= 0.75 && r <= 1.34 ? "Cube" : r > 1.34 ? "Slab" : "Pillar";
  return `${shape} ${count}`;
}

/* --------------------------- gesture machine --------------------------- */

type Phase = "idle" | "down1" | "armed" | "down2" | "sculpt";

interface GestureState {
  phase: Phase;
  pointerId: number;
  downX: number;
  downY: number;
  downAt: number;
  tapX: number;
  tapY: number;
  tapAt: number;
  holdTimer: number;
  armTimer: number;
}

interface DrawRect {
  /** The fixed anchor corner (where the double-tap landed). */
  ax: number;
  ay: number;
  /** The dragging opposite corner. */
  cx: number;
  cy: number;
}

/** Normalized + side-clamped rectangle in px. */
function normRect(d: DrawRect) {
  const max = MAX_SIDE_FACTOR * cardPx();
  const clampSide = (a: number, c: number) =>
    c > a ? Math.min(c, a + max) : Math.max(c, a - max);
  const cx = clampSide(d.ax, d.cx);
  const cy = clampSide(d.ay, d.cy);
  return {
    left: Math.min(d.ax, cx),
    top: Math.min(d.ay, cy),
    w: Math.abs(cx - d.ax),
    h: Math.abs(cy - d.ay),
  };
}

/** The block a drawn rectangle would become (null while too small). */
function blockGeometry(d: DrawRect) {
  const { left, top, w, h } = normRect(d);
  if (w < MIN_SIDE_PX || h < MIN_SIDE_PX) return null;
  const ppu = pxPerUnit();
  const worldW = w / ppu;
  const worldH = h / ppu;
  const worldD = Math.min(worldW, worldH);
  const part: HoloPart = {
    type: "box",
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [worldW / 2, worldH / 2, worldD / 2],
    color: BLOCK_COLOR,
  };
  // normalizeHoloSpec rescales to a 2.3-unit max; scale puts the block
  // back at exactly the drawn on-screen size.
  const spec = normalizeHoloSpec(blockName(w, h, 1), [part]);
  const scale = Math.max(worldW, worldH, worldD) / 2.3;
  return { left, top, w, h, worldW, worldH, worldD, spec, scale };
}

const ptsAttr = (pts: ReadonlyArray<Pt>) =>
  pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

/* ------------------------------ face pulse ------------------------------ */

/** The shared face flashing once when a fresh block lands on it. */
function FacePulse({ pts }: { pts: [Pt, Pt, Pt, Pt] }) {
  return (
    <motion.svg
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[14] h-full w-full"
      initial={{ opacity: 0.95 }}
      animate={{ opacity: 0 }}
      transition={{ duration: 0.8, ease: "easeOut" }}
    >
      <polygon
        points={ptsAttr(pts)}
        fill="rgba(103,232,249,0.18)"
        stroke="#67e8f9"
        strokeWidth={2}
        style={{ filter: "drop-shadow(0 0 8px rgba(103,232,249,0.9))" }}
      />
    </motion.svg>
  );
}

/* ------------------------------ the layer ------------------------------ */

export function WorkbenchSculpt() {
  const drawing = useInfinity((s) => s.drawing);

  const layerRef = useRef<HTMLDivElement>(null);
  const g = useRef<GestureState>({
    phase: "idle",
    pointerId: -1,
    downX: 0,
    downY: 0,
    downAt: 0,
    tapX: 0,
    tapY: 0,
    tapAt: 0,
    holdTimer: 0,
    armTimer: 0,
  });
  /** The in-flight rectangle (state drives the preview render). */
  const [draw, setDraw] = useState<DrawRect | null>(null);
  const drawRef = useRef<DrawRect | null>(null);
  const setDrawSynced = useCallback((next: DrawRect | null) => {
    drawRef.current = next;
    setDraw(next);
  }, []);
  /** Neighbours' face quads, cached for the whole draw (nothing moves
   *  while a single finger is down). */
  const targetsRef = useRef<Array<{ id: string; faces: ReturnType<typeof snapTargets>[number]["faces"] }>>([]);
  /** The face the block would land on — glows while in range. */
  const [attach, setAttach] = useState<{ pts: [Pt, Pt, Pt, Pt]; key: string } | null>(null);
  const attachKey = useRef<string | null>(null);
  /** One-shot face pulse when a fresh block lands snapped. */
  const [pulse, setPulse] = useState<[Pt, Pt, Pt, Pt] | null>(null);

  useEffect(
    () => () => {
      window.clearTimeout(g.current.holdTimer);
      window.clearTimeout(g.current.armTimer);
    },
    []
  );

  const updateAttach = useCallback(() => {
    const geo = blockGeometry(drawRef.current ?? ({ ax: 0, ay: 0, cx: 0, cy: 0 } as DrawRect));
    const targets = targetsRef.current;
    if (!geo || targets.length === 0) {
      if (attachKey.current) {
        attachKey.current = null;
        setAttach(null);
      }
      return;
    }
    // Would this block land flush on someone's face? The target face
    // glows so the landing is no surprise.
    const hyp = facesAtCenter(
      geo.spec,
      HOLO_HOME_ROT,
      geo.scale,
      { x: geo.left + geo.w / 2, y: geo.top + geo.h / 2 },
      3 * cardPx()
    );
    const snap = snapFaces(hyp, { x: 0, y: 0 }, targets, 46);
    if (snap) {
      const key = `${snap.targetId}:${snap.targetFace}`;
      if (attachKey.current !== key) {
        attachKey.current = key;
        setAttach({ pts: snap.seam, key });
      }
    } else if (attachKey.current) {
      attachKey.current = null;
      setAttach(null);
    }
  }, []);

  const beginSculpt = useCallback(
    (id: number, x: number, y: number) => {
      g.current.phase = "sculpt";
      targetsRef.current = snapTargets(useInfinity.getState().models);
      try {
        layerRef.current?.setPointerCapture?.(id);
      } catch {
        /* synthetic / stale pointers — the gesture still works */
      }
      setDrawSynced({ ax: x, ay: y, cx: x, cy: y });
    },
    [setDrawSynced]
  );

  const commit = useCallback(() => {
    const s = g.current;
    s.phase = "idle";
    const d = drawRef.current;
    setDrawSynced(null);
    attachKey.current = null;
    setAttach(null);
    if (!d) return;

    const geo = blockGeometry(d);
    if (!geo) return; // accidental flick

    const store = useInfinity.getState();
    if (store.models.length >= MAX_MODELS) {
      toast.error("The workbench is full — delete a model first.");
      return;
    }

    const count = store.models.filter((m) => m.hand).length + 1;
    const name = blockName(geo.w, geo.h, count);
    const spec = { ...geo.spec, name };

    // Face snap: settle flush onto a neighbour's whole face — exact math
    // against the mounted canvases, so there is no settle pass; the shared
    // face itself pulses once.
    let cx = geo.left + geo.w / 2;
    let cy = geo.top + geo.h / 2;
    const targets = targetsRef.current;
    if (targets.length > 0) {
      const hyp = facesAtCenter(spec, HOLO_HOME_ROT, geo.scale, { x: cx, y: cy }, 3 * cardPx());
      const snap = snapFaces(hyp, { x: 0, y: 0 }, targets, 46);
      if (snap) {
        cx += snap.dx;
        cy += snap.dy;
        setPulse(snap.seam);
        window.setTimeout(() => setPulse(null), 800);
      }
    }

    store.addModel({
      id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name,
      spec,
      pos: { x: (cx / window.innerWidth) * 100, y: (cy / window.innerHeight) * 100 },
      rot: { ...HOLO_HOME_ROT },
      scale: Math.round(geo.scale * 100) / 100,
      bornAt: Date.now(),
      hand: true,
    });

    try {
      localStorage.setItem(HINT_KEY, "1");
    } catch {
      /* private mode — hint just reappears someday */
    }
  }, [setDrawSynced]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!e.isPrimary) return;
      if (useInfinity.getState().drawing) return;
      const s = g.current;
      const now = performance.now();

      if (s.phase === "idle") {
        s.phase = "down1";
        s.pointerId = e.pointerId;
        s.downX = e.clientX;
        s.downY = e.clientY;
        s.downAt = now;
      } else if (s.phase === "armed") {
        const near = Math.hypot(e.clientX - s.tapX, e.clientY - s.tapY) <= TAP_RADIUS_PX;
        window.clearTimeout(s.armTimer);
        if (near && now - s.tapAt <= TAP_GAP_MS) {
          // Second tap of the double-tap — hold (or drag) to sculpt.
          s.phase = "down2";
          s.pointerId = e.pointerId;
          s.downX = e.clientX;
          s.downY = e.clientY;
          s.downAt = now;
          const { clientX, clientY, pointerId } = e;
          s.holdTimer = window.setTimeout(() => beginSculpt(pointerId, clientX, clientY), HOLD_MS);
        } else {
          // Too late or too far — this is a fresh first tap.
          s.phase = "down1";
          s.pointerId = e.pointerId;
          s.downX = e.clientX;
          s.downY = e.clientY;
          s.downAt = now;
        }
      }
    },
    [beginSculpt]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const s = g.current;
      if (e.pointerId !== s.pointerId) return;

      if (s.phase === "down1") {
        if (Math.hypot(e.clientX - s.downX, e.clientY - s.downY) > TAP_DRIFT_PX) {
          s.phase = "idle"; // a plain drag — not ours
        }
      } else if (s.phase === "down2") {
        if (Math.hypot(e.clientX - s.downX, e.clientY - s.downY) > MOVE_START_PX) {
          window.clearTimeout(s.holdTimer);
          beginSculpt(e.pointerId, s.downX, s.downY);
        }
      } else if (s.phase === "sculpt") {
        const d = drawRef.current;
        if (d) {
          setDrawSynced({ ...d, cx: e.clientX, cy: e.clientY });
          updateAttach();
        }
      }
    },
    [beginSculpt, setDrawSynced, updateAttach]
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const s = g.current;
      if (e.pointerId !== s.pointerId) return;
      const now = performance.now();

      if (s.phase === "down1") {
        const quick = now - s.downAt < TAP_GAP_MS;
        const still =
          Math.hypot(e.clientX - s.downX, e.clientY - s.downY) <= TAP_DRIFT_PX;
        if (quick && still) {
          s.phase = "armed";
          s.tapX = s.downX;
          s.tapY = s.downY;
          s.tapAt = now;
          s.armTimer = window.setTimeout(() => {
            if (g.current.phase === "armed") g.current.phase = "idle";
          }, TAP_GAP_MS + 80);
        } else {
          s.phase = "idle";
        }
      } else if (s.phase === "down2") {
        // Plain double-tap without hold — nothing to do.
        window.clearTimeout(s.holdTimer);
        s.phase = "idle";
      } else if (s.phase === "sculpt") {
        commit();
      }
    },
    [commit]
  );

  const onPointerCancel = useCallback(() => {
    const s = g.current;
    window.clearTimeout(s.holdTimer);
    window.clearTimeout(s.armTimer);
    s.phase = "idle";
    attachKey.current = null;
    setAttach(null);
    setDrawSynced(null);
  }, [setDrawSynced]);

  /* ------------------------------ preview ------------------------------ */

  let preview: React.ReactNode = null;
  if (draw) {
    const { left, top, w, h } = normRect(draw);
    if (w >= 8 && h >= 8) {
      const ppu = pxPerUnit();
      const worldW = w / ppu;
      const worldH = h / ppu;
      const worldD = Math.min(worldW, worldH);
      const name = blockName(w, h, 1); // shape word only for the label
      const d = Math.min(w, h); // preview depth in px
      const labelBelow = top + h + 34 < window.innerHeight - 120;

      preview = (
        <motion.div
          key="sculpt-preview"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, scale: 0.94, filter: "blur(3px)" }}
          transition={{ duration: 0.16 }}
        >
          {/* the square — anchored at the double-tap point */}
          <div
            aria-hidden
            className="pointer-events-none fixed z-[12] rounded-[3px] border border-cyan-300/70"
            style={{
              left,
              top,
              width: w,
              height: h,
              background:
                "linear-gradient(135deg, rgba(103,232,249,0.10), rgba(56,189,248,0.04))",
              boxShadow:
                "0 0 22px rgba(103,232,249,0.25), inset 0 0 18px rgba(103,232,249,0.07)",
            }}
          >
            {/* corner brackets */}
            {[
              "left-[-2px] top-[-2px] border-l-2 border-t-2 rounded-tl",
              "right-[-2px] top-[-2px] border-r-2 border-t-2 rounded-tr",
              "left-[-2px] bottom-[-2px] border-l-2 border-b-2 rounded-bl",
              "right-[-2px] bottom-[-2px] border-r-2 border-b-2 rounded-br",
            ].map((cls) => (
              <span
                key={cls}
                className={`absolute h-3.5 w-3.5 border-cyan-200/90 ${cls}`}
              />
            ))}
          </div>

          {/* the anchor — the fixed corner the square grows from */}
          <motion.span
            aria-hidden
            className="pointer-events-none fixed z-[13] block h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-cyan-100 bg-cyan-300/50 shadow-[0_0_12px_rgba(103,232,249,0.9)]"
            style={{ left: draw.ax, top: draw.ay }}
          />

          {/* live 3D read: the block you are about to make */}
          {w >= 34 && h >= 34 && (
            <div
              aria-hidden
              className="pointer-events-none fixed z-[12]"
              style={{
                left: left + w / 2,
                top: top + h / 2,
                width: w,
                height: h,
                transform:
                  "translate(-50%, -50%) perspective(900px) rotateX(-16deg) rotateY(28deg)",
                transformStyle: "preserve-3d",
              }}
            >
              {/* front + back */}
              <div
                className="absolute inset-0 border border-cyan-300/50 bg-cyan-400/[0.07]"
                style={{ transform: `translateZ(${d / 2}px)`, boxShadow: "inset 0 0 24px rgba(103,232,249,0.10)" }}
              />
              <div
                className="absolute inset-0 border border-cyan-300/25 bg-cyan-400/[0.03]"
                style={{ transform: `rotateY(180deg) translateZ(${d / 2}px)` }}
              />
              {/* left + right */}
              <div
                className="absolute top-0 border border-cyan-300/40 bg-cyan-400/[0.05]"
                style={{ height: "100%", width: d, left: (w - d) / 2, transform: `rotateY(-90deg) translateZ(${w / 2}px)` }}
              />
              <div
                className="absolute top-0 border border-cyan-300/40 bg-cyan-400/[0.05]"
                style={{ height: "100%", width: d, left: (w - d) / 2, transform: `rotateY(90deg) translateZ(${w / 2}px)` }}
              />
              {/* top + bottom */}
              <div
                className="absolute left-0 border border-cyan-200/60 bg-cyan-300/[0.14]"
                style={{ width: "100%", height: d, top: (h - d) / 2, transform: `rotateX(90deg) translateZ(${h / 2}px)` }}
              />
              <div
                className="absolute left-0 border border-cyan-300/25 bg-cyan-400/[0.03]"
                style={{ width: "100%", height: d, top: (h - d) / 2, transform: `rotateX(-90deg) translateZ(${h / 2}px)` }}
              />
            </div>
          )}

          {/* live readout: what it will be, and how big */}
          <div
            aria-hidden
            className={`pointer-events-none fixed z-[13] -translate-x-1/2 whitespace-nowrap rounded border border-cyan-300/25 bg-black/75 px-2 py-1 font-mono text-[9px] tracking-[0.2em] text-cyan-200/90 backdrop-blur-sm ${
              labelBelow ? "" : "-translate-y-full"
            }`}
            style={{
              left: left + w / 2,
              top: labelBelow ? top + h + 10 : top - 10,
            }}
          >
            {`${name.split(" ")[0].toUpperCase()} · ${worldW.toFixed(1)} × ${worldH.toFixed(1)} × ${worldD.toFixed(1)}`}
          </div>
        </motion.div>
      );
    }
  }

  return (
    <>
      {/* gesture surface — under the models, above the grid */}
      <div
        ref={layerRef}
        data-wb-sculpt
        aria-hidden
        className="fixed inset-0 z-[5] touch-none"
        style={{ cursor: draw ? "crosshair" : undefined }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onContextMenu={(e) => e.preventDefault()}
      />
      <AnimatePresence>{preview}</AnimatePresence>

      {/* the face this block will land on — glowing while in range */}
      {attach && (
        <svg aria-hidden className="pointer-events-none fixed inset-0 z-[12] h-full w-full">
          <motion.polygon
            points={ptsAttr(attach.pts)}
            fill="rgba(103,232,249,0.07)"
            stroke="rgba(165,243,252,0.8)"
            strokeWidth={1.5}
            style={{ filter: "drop-shadow(0 0 6px rgba(103,232,249,0.6))" }}
            animate={{ opacity: [0.55, 1, 0.55] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
          />
        </svg>
      )}
      {pulse && <FacePulse pts={pulse} />}

      {!drawing && <SculptHint />}
      <FacesHint />
    </>
  );
}

/* ------------------------------ the hints ------------------------------ */

function SculptHint() {
  const [show, setShow] = useState(false);
  const anyHand = useInfinity((s) => s.models.some((m) => m.hand));

  useEffect(() => {
    if (anyHand) return;
    let seen = false;
    try {
      seen = localStorage.getItem(HINT_KEY) === "1";
    } catch {
      /* private mode */
    }
    if (seen) return;
    const t = window.setTimeout(() => setShow(true), 1800);
    return () => window.clearTimeout(t);
  }, [anyHand]);

  useEffect(() => {
    if (!show) return;
    const t = window.setTimeout(() => {
      setShow(false);
      try {
        localStorage.setItem(HINT_KEY, "1");
      } catch {
        /* private mode */
      }
    }, 9000);
    return () => window.clearTimeout(t);
  }, [show]);

  if (anyHand) return null;

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="pointer-events-none fixed inset-x-0 top-14 z-20 flex justify-center px-6"
        >
          <div className="flex items-center gap-2.5 rounded-full border border-cyan-300/20 bg-black/70 px-4 py-2 backdrop-blur-sm">
            <Box className="h-3.5 w-3.5 text-cyan-300/80" strokeWidth={2} aria-hidden />
            <span className="text-[9px] font-light uppercase tracking-[0.3em] text-cyan-200/80">
              Double-tap &amp; drag to sculpt a block
            </span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** The follow-up: once a first block exists, teach the lego moves. */
function FacesHint() {
  const drawing = useInfinity((s) => s.drawing);
  const anyHand = useInfinity((s) => s.models.some((m) => m.hand));
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!anyHand) return;
    let seen = false;
    try {
      seen = localStorage.getItem(FACES_HINT_KEY) === "1";
    } catch {
      /* private mode */
    }
    if (seen) return;
    const t = window.setTimeout(() => setShow(true), 2200);
    return () => window.clearTimeout(t);
  }, [anyHand]);

  useEffect(() => {
    if (!show) return;
    const t = window.setTimeout(() => {
      setShow(false);
      try {
        localStorage.setItem(FACES_HINT_KEY, "1");
      } catch {
        /* private mode */
      }
    }, 9000);
    return () => window.clearTimeout(t);
  }, [show]);

  if (!anyHand || drawing) return null;

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="pointer-events-none fixed inset-x-0 top-14 z-20 flex justify-center px-6"
        >
          <div className="flex items-center gap-2.5 rounded-full border border-cyan-300/20 bg-black/70 px-4 py-2 backdrop-blur-sm">
            <Box className="h-3.5 w-3.5 text-cyan-300/80" strokeWidth={2} aria-hidden />
            <span className="text-[9px] font-light uppercase tracking-[0.3em] text-cyan-200/80">
              Double-tap a face to build on it · hold for color
            </span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

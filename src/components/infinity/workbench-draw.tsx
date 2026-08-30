"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Highlighter, Pencil, Trash2, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useInfinity } from "@/lib/infinity/settings";
import { MARKER_COLORS } from "@/lib/infinity/types";
import type { Annotation, DrawPoint } from "@/lib/infinity/types";

/**
 * Workbench marker — annotate and draw on the bench.
 *
 * One floating Highlighter button (top-right, where Settings lives outside
 * the workbench) opens an expandable tool menu: color swatches, a draw
 * toggle (highlighted while drawing is on), undo and clear. While draw mode
 * is ON, a full-screen canvas above the holograms (below the typing bar)
 * catches pointer input and records smooth glowing strokes; while OFF, the
 * canvas is click-through so models stay draggable. Strokes are stored
 * viewport-normalized and persist with the models.
 */

/** Minimum screen distance (px) before a point is added to a stroke. */
const MIN_POINT_DIST = 3;
/** Hard cap of points per stroke (safety for pathological drags). */
const MAX_POINTS_PER_STROKE = 800;

/* ------------------------------ rendering ------------------------------ */

function pathThrough(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[]) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  if (pts.length === 1) return;
  // Quadratic smoothing through segment midpoints.
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2;
    const my = (pts[i].y + pts[i + 1].y) / 2;
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(last.x, last.y);
}

function drawStroke(ctx: CanvasRenderingContext2D, a: Annotation, w: number, h: number) {
  const pts = a.points.map((p) => ({ x: p.x * w, y: p.y * h }));
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = a.color;
  ctx.fillStyle = a.color;
  if (pts.length === 1) {
    // A tap → a glowing dot.
    ctx.globalAlpha = 0.3;
    ctx.beginPath();
    ctx.arc(pts[0].x, pts[0].y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(pts[0].x, pts[0].y, 2.6, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  // Glow pass (wide, translucent) + core pass (thin, solid).
  ctx.globalAlpha = 0.22;
  ctx.lineWidth = 9;
  pathThrough(ctx, pts);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.lineWidth = 3;
  pathThrough(ctx, pts);
  ctx.stroke();
}

/* -------------------------------- canvas ------------------------------- */

function DrawCanvas() {
  const annotations = useInfinity((s) => s.annotations);
  const drawing = useInfinity((s) => s.drawing);
  const drawColor = useInfinity((s) => s.drawColor);
  const addAnnotation = useInfinity((s) => s.addAnnotation);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** The stroke currently being drawn (session-only, not in the store). */
  const strokeRef = useRef<Annotation | null>(null);
  const rafRef = useRef(0);

  /** Full redraw: committed annotations + the in-progress stroke. */
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    for (const a of annotations) drawStroke(ctx, a, w, h);
    if (strokeRef.current) drawStroke(ctx, strokeRef.current, w, h);
  }, [annotations]);

  useEffect(() => {
    redraw();
  }, [redraw]);

  useEffect(() => {
    const onResize = () => redraw();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [redraw]);

  /* ---- pointer capture (only active in draw mode) ---- */

  const toNorm = (e: React.PointerEvent<HTMLCanvasElement>): DrawPoint => ({
    x: e.clientX / window.innerWidth,
    y: e.clientY / window.innerHeight,
  });

  const scheduleRedraw = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      redraw();
    });
  }, [redraw]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!drawing) return;
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      strokeRef.current = { color: drawColor, points: [toNorm(e)] };
      scheduleRedraw();
    },
    [drawColor, drawing, scheduleRedraw]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const s = strokeRef.current;
      if (!s) return;
      const last = s.points[s.points.length - 1];
      const dx = (e.clientX / window.innerWidth - last.x) * window.innerWidth;
      const dy = (e.clientY / window.innerHeight - last.y) * window.innerHeight;
      if (Math.hypot(dx, dy) < MIN_POINT_DIST) return;
      if (s.points.length >= MAX_POINTS_PER_STROKE) return;
      s.points.push(toNorm(e));
      scheduleRedraw();
    },
    [scheduleRedraw]
  );

  const commitStroke = useCallback(() => {
    const s = strokeRef.current;
    strokeRef.current = null;
    if (s && s.points.length > 0) addAnnotation(s);
    // addAnnotation updates the store → annotations identity changes → redraw.
    if (s && s.points.length === 0) scheduleRedraw();
  }, [addAnnotation, scheduleRedraw]);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={cn(
        "fixed inset-0 z-[15] touch-none",
        drawing ? "pointer-events-auto cursor-crosshair" : "pointer-events-none"
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={commitStroke}
      onPointerCancel={commitStroke}
    />
  );
}

/* ------------------------------- toolbar ------------------------------- */

const COLOR_NAMES: Record<string, string> = {
  "#f87171": "Red",
  "#fb923c": "Orange",
  "#facc15": "Yellow",
  "#4ade80": "Green",
  "#22d3ee": "Cyan",
  "#f472b6": "Pink",
  "#f4f4f5": "White",
};

function MarkerToolbar() {
  const drawing = useInfinity((s) => s.drawing);
  const drawColor = useInfinity((s) => s.drawColor);
  const setDrawing = useInfinity((s) => s.setDrawing);
  const setDrawColor = useInfinity((s) => s.setDrawColor);
  const undoAnnotation = useInfinity((s) => s.undoAnnotation);
  const clearAnnotations = useInfinity((s) => s.clearAnnotations);
  const annotationCount = useInfinity((s) => s.annotations.length);

  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Click / tap anywhere outside the toolbar closes the menu.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const pickColor = useCallback(
    (c: string) => {
      setDrawColor(c);
      setOpen(false); // pick-and-go: color closes the menu
    },
    [setDrawColor]
  );

  const toggleDraw = useCallback(() => {
    setDrawing(!drawing);
    setOpen(false); // the toggle closes the menu so you can draw right away
  }, [drawing, setDrawing]);

  return (
    <motion.div
      ref={rootRef}
      data-wb-draw-toolbar
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6, transition: { duration: 0.25 } }}
      transition={{ duration: 0.5, delay: 0.35, ease: [0.16, 1, 0.3, 1] }}
      className="absolute right-5 top-5 z-30 flex flex-col items-end"
    >
      {/* ---- expandable tool menu ---- */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: -4, transition: { duration: 0.16 } }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            role="menu"
            aria-label="Marker tools"
            className="mb-2 w-60 origin-top-right rounded-2xl border border-white/10 bg-zinc-950/85 p-3 shadow-[0_8px_40px_rgba(0,0,0,0.55)] backdrop-blur-xl"
          >
            <p className="px-1 pb-2 text-[9px] font-light uppercase tracking-[0.35em] text-zinc-500">
              Marker
            </p>

            {/* color swatches */}
            <div className="flex items-center justify-between gap-1.5 px-0.5">
              {MARKER_COLORS.map((c) => {
                const active = c === drawColor;
                return (
                  <button
                    key={c}
                    type="button"
                    role="menuitemradio"
                    aria-checked={active}
                    aria-label={`${COLOR_NAMES[c] ?? c} marker`}
                    title={`${COLOR_NAMES[c] ?? c} marker`}
                    onClick={() => pickColor(c)}
                    className={cn(
                      "flex h-9 w-9 items-center justify-center rounded-full transition-transform duration-150 hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/60 active:scale-95",
                      active && "bg-white/[0.08] ring-1 ring-white/25"
                    )}
                  >
                    <span
                      className={cn(
                        "block rounded-full transition-shadow",
                        active ? "h-6 w-6" : "h-4.5 w-4.5"
                      )}
                      style={{
                        backgroundColor: c,
                        boxShadow: active ? `0 0 12px ${c}99, 0 0 3px ${c}` : "none",
                      }}
                    />
                  </button>
                );
              })}
            </div>

            {/* draw toggle — highlighted while drawing */}
            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={drawing}
              onClick={toggleDraw}
              className={cn(
                "mt-3 flex w-full items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-[11px] font-medium uppercase tracking-[0.25em] transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/60 active:scale-[0.98]",
                drawing
                  ? "border-sky-300/40 bg-sky-400/15 text-sky-200 shadow-[0_0_18px_rgba(56,189,248,0.25)]"
                  : "border-white/10 bg-white/[0.05] text-zinc-400 hover:border-white/20 hover:bg-white/[0.09] hover:text-zinc-200"
              )}
            >
              <Pencil className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden="true" />
              {drawing ? "Drawing on" : "Draw"}
            </button>

            {/* undo + clear */}
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                role="menuitem"
                aria-label="Undo last stroke"
                title="Undo last stroke"
                disabled={annotationCount === 0}
                onClick={() => undoAnnotation()}
                className="flex h-10 flex-1 items-center justify-center rounded-xl border border-white/10 bg-white/[0.05] text-zinc-400 transition-all duration-200 hover:border-white/20 hover:bg-white/[0.09] hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/60 active:scale-95 disabled:pointer-events-none disabled:opacity-30"
              >
                <Undo2 className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
              </button>
              <button
                type="button"
                role="menuitem"
                aria-label="Clear all annotations"
                title="Clear all annotations"
                disabled={annotationCount === 0}
                onClick={() => clearAnnotations()}
                className="flex h-10 flex-1 items-center justify-center rounded-xl border border-red-400/25 bg-red-500/[0.07] text-red-300/80 transition-all duration-200 hover:border-red-400/50 hover:bg-red-500/15 hover:text-red-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300/50 active:scale-95 disabled:pointer-events-none disabled:opacity-30"
              >
                <Trash2 className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ---- the single Marker button ---- */}
      <button
        type="button"
        aria-label={open ? "Close marker tools" : "Marker tools — annotate the bench"}
        aria-expanded={open}
        title="Marker — annotate the bench"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "relative flex h-11 w-11 items-center justify-center rounded-full border backdrop-blur-md transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/60 active:scale-90",
          drawing
            ? "border-sky-300/50 bg-sky-400/15 text-sky-200 shadow-[0_0_24px_rgba(56,189,248,0.35)]"
            : "border-white/10 bg-white/[0.06] text-zinc-400 hover:border-white/20 hover:bg-white/10 hover:text-zinc-200"
        )}
      >
        <Highlighter className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
        {/* selected color dot — always shows the active marker color */}
        <span
          aria-hidden
          className="absolute -bottom-0.5 -right-0.5 block h-3 w-3 rounded-full border border-zinc-950/80"
          style={{ backgroundColor: drawColor, boxShadow: `0 0 8px ${drawColor}aa` }}
        />
        {/* pulse while actively drawing */}
        {drawing && (
          <motion.span
            aria-hidden
            className="absolute inset-0 rounded-full border border-sky-300/50"
            animate={{ scale: [1, 1.25, 1], opacity: [0.6, 0, 0.6] }}
            transition={{ duration: 2.2, repeat: Infinity, ease: "easeOut" }}
          />
        )}
      </button>
    </motion.div>
  );
}

/* ------------------------------- exported ------------------------------ */

export function WorkbenchDraw() {
  return (
    <>
      <DrawCanvas />
      <MarkerToolbar />
    </>
  );
}

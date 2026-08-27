"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Trash2 } from "lucide-react";
import { HoloModelMesh, type StressView } from "./holo-model-mesh";
import { useInfinity } from "@/lib/infinity/settings";
import { ASSEMBLE_MS } from "@/lib/infinity/holo-library";
import { SPAWN_SETTLE_MS } from "@/lib/infinity/holo";
import { HOLO_SCALE_MAX, HOLO_SCALE_MIN } from "@/lib/infinity/types";
import type { HoloModel } from "@/lib/infinity/types";

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
/* bounds frame (see holo-model-mesh): drag to move / shift-drag to     */
/* rotate, L-corner to resize, red button to delete, label above.       */
/* ------------------------------------------------------------------ */

const scaleChip = (v: number) => Math.round(v * 100) / 100;

function ModelCard({ model }: { model: HoloModel }) {
  const updateModel = useInfinity((s) => s.updateModel);
  const removeModel = useInfinity((s) => s.removeModel);
  /** Live stress test on THIS model (null = normal hologram). */
  const stressSession = useInfinity((s) =>
    s.stress && s.stress.modelId === model.id ? s.stress : null
  );
  const stressView: StressView | null = stressSession
    ? { phase: stressSession.phase, ratios: stressSession.ratios }
    : null;
  const rootRef = useRef<HTMLDivElement>(null);
  /** Tracks the hologram's true projected bounds — controls live inside it. */
  const frameRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{
    mode: "move" | "rotate";
    startX: number;
    startY: number;
    origPos: { x: number; y: number };
    origRot: { x: number; y: number };
    moved: boolean;
  } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [resizing, setResizing] = useState(false);
  /** Mount the 3D canvas only after the spawn animation settles — R3F sizes
   * the canvas with a transform-aware measurement and would otherwise catch
   * the mid-animation scale (see holo-model-mesh CameraRig). */
  const [meshReady, setMeshReady] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setMeshReady(true), SPAWN_SETTLE_MS);
    return () => window.clearTimeout(t);
  }, []);

  const scale = model.scale ?? 1;
  const showHandles = hovered || resizing;
  const pct = Math.round(scale * 100);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const rotate = e.shiftKey || e.button === 2 || e.ctrlKey || e.metaKey;
      dragState.current = {
        mode: rotate ? "rotate" : "move",
        startX: e.clientX,
        startY: e.clientY,
        origPos: { ...model.pos },
        origRot: { ...model.rot },
        moved: false,
      };
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      setDragging(true);
    },
    [model.pos, model.rot]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const d = dragState.current;
      if (!d) return;
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      if (Math.abs(dx) + Math.abs(dy) > 2) d.moved = true;
      if (d.mode === "move") {
        const xPct = (dx / window.innerWidth) * 100;
        const yPct = (dy / window.innerHeight) * 100;
        updateModel(model.id, {
          pos: {
            x: Math.max(6, Math.min(94, d.origPos.x + xPct)),
            y: Math.max(8, Math.min(92, d.origPos.y + yPct)),
          },
        });
      } else {
        updateModel(model.id, {
          rot: {
            x: Math.max(-1.35, Math.min(1.35, d.origRot.x + dy * 0.006)),
            y: d.origRot.y + dx * 0.008,
          },
        });
      }
    },
    [model.id, updateModel]
  );

  const onPointerUp = useCallback(() => {
    dragState.current = null;
    setDragging(false);
  }, []);

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

  const labelText =
    pct !== 100
      ? `${model.name} · ${pct}%`
      : stressSession?.score != null
        ? `${model.name} · ${stressSession.score}/100`
        : model.name;

  return (
    <div
      ref={rootRef}
      className="holo-card pointer-events-none absolute h-44 w-44 -translate-x-1/2 -translate-y-1/2 select-none sm:h-56 sm:w-56"
      style={{ left: `${model.pos.x}%`, top: `${model.pos.y}%` }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onContextMenu={(e) => e.preventDefault()}
    >
      <motion.div
        className="relative h-full w-full"
        initial={{ opacity: 0, scale: 0.85 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{
          opacity: 0,
          scale: 0.5,
          filter: "blur(3px)",
          transition: { duration: 0.28, ease: "easeIn" },
        }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      >
        {meshReady && (
          <HoloModelMesh
            spec={model.spec}
            rot={model.rot}
            scale={scale}
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
            stress={stressView}
          />
        )}

        {/* ---- the object frame: positioned every frame to the hologram's
             true projected bounds — everything below hugs the object ---- */}
        <div
          ref={frameRef}
          role="img"
          aria-label={`Holographic model: ${model.name}. Drag to move, shift-drag to rotate. Hover for resize and delete controls.`}
          tabIndex={0}
          className="pointer-events-auto absolute cursor-grab touch-none rounded-lg outline-none transition-shadow duration-200 focus-visible:ring-1 focus-visible:ring-sky-300/50 active:cursor-grabbing"
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
      </motion.div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Layer: models + build progress (rendered only while grid is visible) */
/* ------------------------------------------------------------------ */

export function WorkbenchModels({ building }: { building: BuildingState | null }) {
  const models = useInfinity((s) => s.models);

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
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
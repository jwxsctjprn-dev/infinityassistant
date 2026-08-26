"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { HoloModelMesh } from "./holo-model-mesh";
import { useInfinity } from "@/lib/infinity/settings";
import type { HoloModel } from "@/lib/infinity/types";

export type BuildPhase = "building" | "done" | "error";

export interface BuildingState {
  name: string;
  phase: BuildPhase;
}

/* ------------------------------------------------------------------ */
/* Progress bar                                                         */
/* ------------------------------------------------------------------ */

function BuildProgress({ building }: { building: BuildingState }) {
  const [pct, setPct] = useState(3);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (t: number) => {
      const dt = Math.min(0.1, (t - last) / 1000);
      last = t;
      setPct((prev) => {
        if (building.phase === "done") return Math.min(100, prev + dt * 140);
        if (building.phase === "error") return prev;
        const target = 90;
        // ease-out crawl toward 90 while the AI is generating
        const next = prev + Math.max(dt * 9, (target - prev) * dt * 0.55);
        return Math.min(target, next);
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [building.phase]);

  const failed = building.phase === "error";

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
        {failed ? "BUILD FAILED" : `BUILDING ${building.name.toUpperCase()}`}
      </p>
      <div className="h-[3px] w-full overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full rounded-full transition-none ${
            failed
              ? "bg-red-400/70"
              : "bg-gradient-to-r from-sky-500/60 via-sky-300 to-cyan-200"
          }`}
          style={{ width: `${pct}%`, boxShadow: "0 0 12px rgba(103, 232, 249, 0.45)" }}
        />
      </div>
      {!failed && (
        <p className="mt-2 text-center font-mono text-[10px] text-sky-200/40">
          {Math.round(pct)}%
        </p>
      )}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Draggable / rotatable model card                                     */
/* ------------------------------------------------------------------ */

function ModelCard({ model }: { model: HoloModel }) {
  const updateModel = useInfinity((s) => s.updateModel);
  const dragState = useRef<{
    mode: "move" | "rotate";
    startX: number;
    startY: number;
    origPos: { x: number; y: number };
    origRot: { x: number; y: number };
    moved: boolean;
  } | null>(null);
  const [dragging, setDragging] = useState(false);

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

  return (
    <div
      className="holo-card pointer-events-auto absolute h-44 w-44 -translate-x-1/2 -translate-y-1/2 touch-none select-none sm:h-56 sm:w-56"
      style={{ left: `${model.pos.x}%`, top: `${model.pos.y}%` }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onContextMenu={(e) => e.preventDefault()}
      role="img"
      aria-label={`Holographic model: ${model.name}. Drag to move, shift-drag to rotate.`}
    >
      {/* projector glow under the model */}
      <div
        aria-hidden
        className="absolute inset-x-[8%] bottom-[6%] h-[14%] rounded-[50%] bg-sky-400/10 blur-md"
      />
      <HoloModelMesh spec={model.spec} rot={model.rot} />
      <span
        aria-hidden
        className={`absolute -bottom-1 left-1/2 -translate-x-1/2 whitespace-nowrap text-[9px] font-light uppercase tracking-[0.3em] transition-opacity ${
          dragging ? "text-sky-300/60 opacity-100" : "text-sky-300/30 opacity-70"
        }`}
      >
        {model.name}
      </span>
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
      {models.map((m) => (
        <ModelCard key={m.id} model={m} />
      ))}
      <AnimatePresence>
        {building && <BuildProgress key="progress" building={building} />}
      </AnimatePresence>
    </div>
  );
}

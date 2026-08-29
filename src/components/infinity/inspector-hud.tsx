"use client";

import { motion } from "framer-motion";
import { X } from "lucide-react";
import type { HoloModel } from "@/lib/infinity/types";
import { specStats } from "@/lib/infinity/workbench-vision";

/**
 * Inspector HUD — the floating engineering readout for one model.
 *
 * Part count, shape mix, color swatches, dimensions (× the user's resize),
 * position on the bench, and every live state (spinning, exploded, x-ray,
 * solid, measured). It re-derives from the model on every render, so
 * recolors, resizes and toggles update the numbers live.
 *
 * Voice: "inspect the rocket" / "close the inspector". Placed above the
 * card when the model sits low on screen so it never clips.
 */

const fmt = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-[3px]">
      <span className="shrink-0 text-[8px] uppercase tracking-[0.25em] text-sky-300/50">{label}</span>
      <span className="text-right font-mono text-[10px] leading-relaxed text-zinc-200/90">{children}</span>
    </div>
  );
}

export function InspectorHud({ model, onClose }: { model: HoloModel; onClose: () => void }) {
  const stats = specStats(model.spec, model.scale ?? 1);
  const scalePct = Math.round((model.scale ?? 1) * 100);

  const status: string[] = [];
  if (model.hand) status.push("hand-sculpted");
  if (model.spin) status.push("spinning");
  if (model.exploded) status.push("exploded");
  if (model.xray) status.push("x-ray");
  if (model.solid) status.push("solid");
  if (model.measure) status.push("measured");

  // Low models get the panel ABOVE the card; edge models pin the panel
  // inward so it never leaves the screen.
  const above = model.pos.y > 58;
  const pin =
    model.pos.x < 28 ? "left-0" : model.pos.x > 72 ? "right-0" : "left-1/2 -translate-x-1/2";

  return (
    <motion.div
      initial={{ opacity: 0, y: above ? 6 : -6, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: above ? 6 : -6, scale: 0.96 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      role="status"
      aria-label={`Inspector: ${model.name}`}
      className={`pointer-events-auto absolute z-20 w-60 border border-sky-300/20 bg-black/85 p-3 shadow-[0_0_28px_rgba(56,189,248,0.12)] backdrop-blur-md ${
        above ? "bottom-full mb-3" : "top-full mt-3"
      } ${pin}`}
    >
      {/* header */}
      <div className="mb-1.5 flex items-center justify-between gap-2 border-b border-sky-300/15 pb-1.5">
        <span className="truncate text-[10px] font-light uppercase tracking-[0.3em] text-sky-200/90">
          {model.name}
        </span>
        <button
          type="button"
          aria-label="Close inspector"
          onClick={onClose}
          className="rounded-full p-1 text-zinc-500 transition-colors hover:bg-white/10 hover:text-zinc-200"
        >
          <X className="h-3 w-3" strokeWidth={2.4} aria-hidden />
        </button>
      </div>

      <div className="divide-y divide-white/[0.05]">
        <Row label="Parts">{stats.parts}</Row>
        <Row label="Shapes">
          {stats.shapes.map((s) => `${s.count} ${s.type}${s.count > 1 ? "s" : ""}`).join(" · ")}
        </Row>
        <Row label="Dims">
          {fmt(stats.dims.w)} × {fmt(stats.dims.h)} × {fmt(stats.dims.d)} u
          {scalePct !== 100 ? ` · ${scalePct}%` : ""}
        </Row>
        <Row label="Colors">
          <span className="flex flex-wrap items-center justify-end gap-1.5">
            {stats.colors.slice(0, 6).map((c) => (
              <span key={c.name} className="flex items-center gap-1">
                <span
                  aria-hidden
                  className="inline-block h-2.5 w-2.5 rounded-full border border-white/25"
                  style={{ backgroundColor: c.hex }}
                />
                <span className="text-zinc-400">
                  {c.name}
                  {c.count > 1 ? `×${c.count}` : ""}
                </span>
              </span>
            ))}
          </span>
        </Row>
        <Row label="Status">
          {status.length > 0 ? (
            <span className="text-cyan-200/90">{status.join(" · ")}</span>
          ) : (
            <span className="text-zinc-500">idle</span>
          )}
        </Row>
      </div>
    </motion.div>
  );
}

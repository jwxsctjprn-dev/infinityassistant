"use client";

import { motion } from "framer-motion";
import type { SpecStats } from "@/lib/infinity/workbench-vision";

/**
 * Measure HUD — engineering dimension lines around a hologram.
 *
 * Mounted INSIDE the object frame (which tracks the hologram's true
 * projected bounds every frame), so the ruler hugs the actual object:
 * a width line under it, a height line beside it, and a depth diagonal
 * at the corner — each with tick ends and a live readout chip.
 *
 * Voice: "measure the rocket" / "hide the measurements".
 */

const fmt = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

/** Plus-shaped tick end. */
function TickMark({ className }: { className?: string }) {
  return (
    <svg
      width="9"
      height="9"
      viewBox="0 0 9 9"
      aria-hidden
      className={`absolute text-cyan-200/80 ${className ?? ""}`}
    >
      <path d="M4.5 0.5v8M0.5 4.5h8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

/** One dimension line: animated rule + tick ends + centered value chip. */
function DimLine({ vertical, value, delay }: { vertical?: boolean; value: string; delay: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.85 }}
      transition={{ duration: 0.3, delay, ease: [0.16, 1, 0.3, 1] }}
      className={`absolute text-cyan-200/80 ${
        vertical ? "left-full top-0 ml-2.5 h-full w-3" : "inset-x-0 top-full mt-2.5 h-3"
      }`}
    >
      {/* the rule itself draws open */}
      <motion.span
        initial={{ scaleX: vertical ? 1 : 0, scaleY: vertical ? 0 : 1 }}
        animate={{ scaleX: 1, scaleY: 1 }}
        transition={{ duration: 0.55, delay: delay + 0.05, ease: [0.16, 1, 0.3, 1] }}
        className="absolute bg-cyan-300/55 shadow-[0_0_6px_rgba(103,232,249,0.35)]"
        style={
          vertical
            ? { left: "50%", top: 4, bottom: 4, width: 1, transformOrigin: "top" }
            : { top: "50%", left: 4, right: 4, height: 1, transformOrigin: "left" }
        }
      />
      {/* tick ends at both extremes */}
      {vertical ? (
        <>
          <TickMark className="left-1/2 top-0 -translate-x-1/2" />
          <TickMark className="bottom-0 left-1/2 -translate-x-1/2" />
        </>
      ) : (
        <>
          <TickMark className="left-0 top-1/2 -translate-y-1/2" />
          <TickMark className="right-0 top-1/2 -translate-y-1/2" />
        </>
      )}
      {/* live value chip */}
      <span
        className={`absolute z-10 whitespace-nowrap rounded border border-cyan-300/30 bg-black/80 px-1.5 py-0.5 font-mono text-[9px] leading-none tracking-[0.15em] text-cyan-100/90 backdrop-blur-sm ${
          vertical ? "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" : "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
        }`}
      >
        {value}
      </span>
    </motion.div>
  );
}

/** Depth readout — a small corner diagonal with the third dimension
 *  (bottom-LEFT, clear of the resize handle in the bottom-right). */
function DepthChip({ value, delay }: { value: string; delay: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 4 }}
      transition={{ duration: 0.3, delay }}
      className="absolute -bottom-7 left-0 flex items-center gap-1.5 text-cyan-200/80"
    >
      <svg width="26" height="13" viewBox="0 0 26 13" aria-hidden>
        <path d="M25 0 8 12" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.6" />
        <path d="M1 12h7M8 12V5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.6" />
      </svg>
      <span className="whitespace-nowrap rounded border border-cyan-300/30 bg-black/80 px-1.5 py-0.5 font-mono text-[9px] leading-none tracking-[0.15em] text-cyan-100/90 backdrop-blur-sm">
        {value}
      </span>
    </motion.div>
  );
}

export function MeasureHud({ stats }: { stats: SpecStats }) {
  const { w, h, d } = stats.dims;
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      <DimLine value={`W ${fmt(w)}`} delay={0} />
      <DimLine vertical value={`H ${fmt(h)}`} delay={0.08} />
      <DepthChip value={`D ${fmt(d)}`} delay={0.16} />
    </div>
  );
}

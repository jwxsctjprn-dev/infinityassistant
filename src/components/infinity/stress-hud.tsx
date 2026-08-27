"use client";

import { AnimatePresence, motion } from "framer-motion";
import { X, Zap } from "lucide-react";
import { useInfinity } from "@/lib/infinity/settings";
import type { StressSession } from "@/lib/infinity/types";

/* ------------------------------------------------------------------ */
/* Score ring                                                           */
/* ------------------------------------------------------------------ */

const R = 30;
const CIRC = 2 * Math.PI * R;

function scoreColor(score: number): string {
  if (score >= 70) return "#4ade80";
  if (score >= 55) return "#a3e635";
  if (score >= 40) return "#facc15";
  if (score >= 25) return "#fb923c";
  return "#f87171";
}

function ScoreRing({ score, verdict }: { score: number; verdict: string }) {
  const color = scoreColor(score);
  const target = Math.max(0, Math.min(100, score));
  return (
    <div className="flex items-center gap-3.5">
      <div className="relative h-[74px] w-[74px] shrink-0">
        <svg viewBox="0 0 74 74" className="h-full w-full -rotate-90">
          <circle cx="37" cy="37" r={R} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="5" />
          <motion.circle
            cx="37"
            cy="37"
            r={R}
            fill="none"
            stroke={color}
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray={CIRC}
            initial={{ strokeDashoffset: CIRC }}
            animate={{ strokeDashoffset: CIRC * (1 - target / 100) }}
            transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
            style={{ filter: `drop-shadow(0 0 5px ${color}66)` }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <motion.span
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.25, duration: 0.4 }}
            className="text-xl font-light tabular-nums"
            style={{ color }}
          >
            {score}
          </motion.span>
          <span className="text-[7px] uppercase tracking-[0.2em] text-zinc-500">/ 100</span>
        </div>
      </div>
      <div className="min-w-0">
        <p className="text-[8px] font-light uppercase tracking-[0.35em] text-zinc-500">
          Durability
        </p>
        <p className="text-lg font-light capitalize leading-tight" style={{ color }}>
          {verdict}
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Category bars                                                        */
/* ------------------------------------------------------------------ */

function CategoryBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-14 shrink-0 text-[8px] uppercase tracking-[0.15em] text-zinc-500">
        {label}
      </span>
      <div className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/10">
        <motion.div
          className="h-full rounded-full"
          style={{ background: scoreColor(value), boxShadow: `0 0 6px ${scoreColor(value)}55` }}
          initial={{ width: 0 }}
          animate={{ width: `${Math.max(3, Math.min(100, value))}%` }}
          transition={{ duration: 0.9, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
        />
      </div>
      <span className="w-6 shrink-0 text-right font-mono text-[9px] tabular-nums text-zinc-400">
        {value}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Weak point row                                                       */
/* ------------------------------------------------------------------ */

function riskStyle(risk: number): { dot: string; text: string; label: string } {
  if (risk >= 0.72) {
    return {
      dot: "bg-red-400 shadow-[0_0_8px_rgba(248,113,113,0.8)]",
      text: "text-red-300",
      label: "CRITICAL",
    };
  }
  if (risk >= 0.42) {
    return {
      dot: "bg-orange-400 shadow-[0_0_8px_rgba(251,146,60,0.7)]",
      text: "text-orange-300",
      label: "WEAK",
    };
  }
  return { dot: "bg-yellow-300/80", text: "text-yellow-200/80", label: "WATCH" };
}

function fmtKg(kg: number): string {
  if (kg >= 10000) return `${Math.round(kg / 100) / 10} t`;
  if (kg >= 1000) return `${Math.round(kg / 100) / 10} t`;
  if (kg >= 20) return `${Math.round(kg)} kg`;
  if (kg >= 0.1) return `${Math.round(kg * 10) / 10} kg`;
  return `${Math.round(kg * 1000)} g`;
}

function fmtLen(m: number): string {
  if (m >= 1000) return `${Math.round(m)} m`;
  if (m >= 1) return `${Math.round(m * 10) / 10} m`;
  if (m >= 0.02) return `${Math.round(m * 100)} cm`;
  return `${Math.round(m * 1000)} mm`;
}

const MODE_LABEL: Record<string, string> = {
  buckling: "buckles",
  compression: "crushes",
  bending: "snaps",
  static: "yields",
  impact: "shatters first on impact",
};

function WeakPointRow({
  wp,
  rank,
}: {
  wp: StressSession["weakPoints"][number];
  rank: number;
}) {
  const style = riskStyle(wp.risk);
  return (
    <li className="flex items-start gap-2 py-1">
      <span
        className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${style.dot} ${rank === 0 ? "animate-pulse" : ""}`}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[11px] leading-snug text-zinc-200">
          {wp.role}
          <span className={`ml-1.5 text-[8px] font-semibold tracking-wider ${style.text}`}>
            {style.label}
          </span>
        </p>
        <p className="text-[9.5px] leading-snug text-zinc-500">
          {wp.material} ·{" "}
          {wp.mode === "impact"
            ? MODE_LABEL.impact
            : `${MODE_LABEL[wp.mode] ?? "fails"} at ~${fmtKg(wp.failsKg)}`}
        </p>
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* The HUD                                                              */
/* ------------------------------------------------------------------ */

export function StressHud() {
  const stress = useInfinity((s) => s.stress);
  const clearStress = useInfinity((s) => s.setStress);

  return (
    <AnimatePresence>
      {stress && (
        <motion.aside
          key="stress-hud"
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 24 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          role="status"
          aria-live="polite"
          aria-label={`Stress test results for ${stress.name}`}
          className="infinity-scroll pointer-events-auto absolute bottom-[5.5rem] right-3 z-30 max-h-[calc(100dvh-11.5rem)] w-[calc(100%-1.5rem)] max-w-[19rem] overflow-y-auto overscroll-contain rounded-2xl border border-white/10 bg-zinc-950/85 p-4 shadow-[0_8px_40px_rgba(0,0,0,0.6)] backdrop-blur-md sm:right-6 sm:w-80"
        >
          {/* header */}
          <div className="mb-3 flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-[8px] font-light uppercase tracking-[0.35em] text-orange-300/70">
                <Zap className="h-2.5 w-2.5" aria-hidden />
                Reality stress test
              </p>
              <p className="truncate text-[13px] font-medium text-zinc-100">
                {stress.name}
              </p>
            </div>
            <button
              type="button"
              aria-label="Close stress test results"
              onClick={() => clearStress(null)}
              className="-mr-1 -mt-1 rounded-full p-1.5 text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-200"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>

          {stress.phase === "scanning" ? (
            /* ---- analyzing ---- */
            <div aria-live="polite">
              <p className="mb-2 text-[10px] uppercase tracking-[0.2em] text-orange-200/70">
                Analyzing real materials…
              </p>
              <div className="h-[3px] w-full overflow-hidden rounded-full bg-white/10">
                <motion.div
                  className="h-full rounded-full bg-gradient-to-r from-orange-500/70 to-red-400"
                  animate={{ x: ["-100%", "100%"] }}
                  transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }}
                  style={{ width: "55%" }}
                />
              </div>
              <p className="mt-2 font-mono text-[9px] tracking-wider text-zinc-500">
                {stress.partCount > 0
                  ? `${Math.min(stress.partsAnalyzed, stress.partCount)}/${stress.partCount} PARTS IDENTIFIED`
                  : "SCANNING GEOMETRY"}
              </p>
            </div>
          ) : (
            /* ---- results ---- */
            <div className="space-y-3">
              <ScoreRing score={stress.score ?? 0} verdict={stress.verdict ?? ""} />

              <div className="space-y-1.5">
                <CategoryBar label="Structure" value={stress.structScore ?? 0} />
                <CategoryBar label="Impact" value={stress.impactScore ?? 0} />
                <CategoryBar label="Thermal" value={stress.thermalScore ?? 0} />
              </div>

              {/* materials + real stats */}
              <div className="flex flex-wrap gap-1">
                {stress.materialsUsed.slice(0, 4).map((m) => (
                  <span
                    key={m}
                    className="rounded-full border border-white/10 bg-white/[0.05] px-2 py-0.5 text-[9px] text-zinc-300"
                  >
                    {m}
                  </span>
                ))}
              </div>
              {(stress.massKg !== null || stress.heightM !== null) && (
                <p className="font-mono text-[9px] tracking-wide text-zinc-500">
                  {stress.massKg !== null && `≈ ${fmtKg(stress.massKg)}`}
                  {stress.massKg !== null && stress.heightM !== null && " · "}
                  {stress.heightM !== null && `${fmtLen(stress.heightM)} tall`}
                  {stress.loadKg ? ` · load rated ${fmtKg(stress.loadKg)}` : ""}
                </p>
              )}

              {/* weak points */}
              {stress.weakPoints.length > 0 && (
                <div>
                  <p className="mb-0.5 text-[8px] font-light uppercase tracking-[0.3em] text-zinc-500">
                    Weak points
                  </p>
                  <ul className="infinity-scroll max-h-32 divide-y divide-white/[0.05] overflow-y-auto pr-1">
                    {stress.weakPoints.map((wp, i) => (
                      <WeakPointRow key={`${wp.role}-${i}`} wp={wp} rank={i} />
                    ))}
                  </ul>
                </div>
              )}

              {/* drop + thermal verdicts */}
              <div className="space-y-1 border-t border-white/[0.07] pt-2">
                {stress.dropNote && (
                  <p className="text-[10px] leading-relaxed text-zinc-400">
                    <span className="text-orange-300/80">Drop ·</span> {stress.dropNote}
                  </p>
                )}
                {stress.thermalNote && (
                  <p className="text-[10px] leading-relaxed text-zinc-400">
                    <span className="text-orange-300/80">Heat ·</span> {stress.thermalNote}
                  </p>
                )}
              </div>

              <p className="border-t border-white/[0.07] pt-2 text-[8px] leading-relaxed text-zinc-600">
                Computed from published material property tables with real
                mechanics — σ = F/A, Euler buckling π²E/λ², drop energy mgh,
                allowable-stress design factors. Engineering estimate of the
                hologram's geometry.
              </p>
            </div>
          )}
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import type { Pt } from "@/lib/infinity/snap";

/**
 * Infinity — the color wheel.
 *
 * Press and hold any hologram and this blooms under your finger: twelve
 * swatches in a ring around the color it wears now. Slide (still one
 * finger, still holding) onto a swatch and let go to repaint the model —
 * or release empty and the wheel stays open for a deliberate tap. The hub
 * shows the current color; tapping it or anywhere outside closes.
 *
 * While the opening finger is still down, the wheel is driven through
 * `api` (the model card owns that pointer's capture and delegates move/up),
 * so slide-to-pick works even though the finger never touched this layer.
 */

export interface WheelApi {
  /** The held finger moved. */
  move(p: Pt): void;
  /** The held finger lifted — pick if it's on a swatch, else stay open. */
  up(p: Pt): void;
  /** The gesture was cancelled — close silently. */
  cancel(): void;
}

interface Swatch {
  hex: string;
  name: string;
}

const SWATCHES: readonly Swatch[] = [
  { hex: "#f87171", name: "red" },
  { hex: "#fb923c", name: "orange" },
  { hex: "#fbbf24", name: "amber" },
  { hex: "#a3e635", name: "lime" },
  { hex: "#34d399", name: "emerald" },
  { hex: "#2dd4bf", name: "teal" },
  { hex: "#22d3ee", name: "cyan" },
  { hex: "#38bdf8", name: "sky" },
  { hex: "#818cf8", name: "indigo" },
  { hex: "#a78bfa", name: "violet" },
  { hex: "#e879f9", name: "fuchsia" },
  { hex: "#f1f5f9", name: "white" },
];

/** Swatch hit radius (px) — generous for fingertips. */
const HIT_R = 27;
/** The hub (current color) — releasing here keeps the color. */
const HUB_R = 26;

export function ColorWheel({
  origin,
  modelName,
  currentColor,
  apiRef,
  onPick,
  onClose,
}: {
  /** Where the press-and-hold landed (screen px). */
  origin: Pt;
  modelName: string;
  currentColor: string;
  /** The model card registers its delegation hooks here. */
  apiRef: React.MutableRefObject<WheelApi | null>;
  onPick: (hex: string, name: string) => void;
  onClose: () => void;
}) {
  const [hot, setHot] = useState<number | null>(null);
  const [gone, setGone] = useState(false);
  const hotRef = useRef<number | null>(null);
  /** Ref + state in one — the ref keeps rapid moves from re-firing. */
  const applyHot = (h: number | null) => {
    if (h === hotRef.current) return;
    hotRef.current = h;
    setHot(h);
  };

  // Responsive ring, clamped so the wheel always fits the viewport.
  const r = useMemo(
    () =>
      Math.max(
        72,
        Math.min(
          108,
          Math.min(
            (typeof window === "undefined" ? 400 : window.innerWidth) * 0.26,
            (typeof window === "undefined" ? 700 : window.innerHeight) * 0.22
          )
        )
      ),
    []
  );
  const center = useMemo(() => {
    const vw = typeof window === "undefined" ? 400 : window.innerWidth;
    const vh = typeof window === "undefined" ? 700 : window.innerHeight;
    const m = r + 34;
    return {
      x: Math.max(m, Math.min(vw - m, origin.x)),
      y: Math.max(m, Math.min(vh - m, origin.y)),
    };
  }, [origin, r]);

  const centers = useMemo(
    () =>
      SWATCHES.map((_, i) => {
        const ang = -Math.PI / 2 + (i * 2 * Math.PI) / SWATCHES.length;
        return { x: center.x + r * Math.cos(ang), y: center.y + r * Math.sin(ang) };
      }),
    [center, r]
  );

  const hit = (p: Pt): number | null => {
    if (Math.hypot(p.x - center.x, p.y - center.y) <= HUB_R) return null;
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < centers.length; i++) {
      const d = Math.hypot(p.x - centers[i].x, p.y - centers[i].y);
      if (d <= HIT_R && d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best >= 0 ? best : null;
  };

  const close = () => {
    setGone(true);
    window.setTimeout(onClose, 130);
  };

  const pick = (i: number) => {
    const s = SWATCHES[i];
    setGone(true);
    window.setTimeout(() => {
      onPick(s.hex, s.name);
      onClose();
    }, 130);
  };

  // Register the delegation hooks the model card drives while the opening
  // finger is still down (it owns that pointer's capture).
  useLayoutEffect(() => {
    apiRef.current = {
      move: (p) => {
        const h = hit(p);
        applyHot(h);
        if (h !== null && "vibrate" in navigator) {
          try {
            navigator.vibrate(6);
          } catch {
            /* unsupported */
          }
        }
      },
      up: (p) => {
        const h = hit(p);
        if (h !== null) pick(h);
        // Released on the hub / between swatches → stay open for a tap.
      },
      cancel: () => close(),
    };
    return () => {
      apiRef.current = null;
    };
  });

  // Esc always closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <motion.div
      role="dialog"
      aria-label={`Recolor ${modelName}`}
      className="fixed inset-0 z-50 touch-none"
      initial={{ opacity: 0 }}
      animate={{ opacity: gone ? 0 : 1 }}
      transition={{ duration: 0.16 }}
      onPointerDown={(e) => {
        // A fresh tap: on a swatch → pick; anywhere else → close.
        const h = hit({ x: e.clientX, y: e.clientY });
        if (h !== null) pick(h);
        else close();
      }}
      onPointerMove={(e) => {
        // Mouse hover in the tap phase previews too.
        if (e.pointerType === "mouse") {
          applyHot(hit({ x: e.clientX, y: e.clientY }));
        }
      }}
    >
      {/* dim the bench so the wheel reads */}
      <div className="absolute inset-0 bg-black/25 backdrop-blur-[2px]" />

      {/* the disc */}
      <motion.div
        aria-hidden
        className="absolute rounded-full border border-white/10 bg-black/45 shadow-[0_0_60px_rgba(0,0,0,0.55)] backdrop-blur-md"
        style={{
          left: center.x - r - 34,
          top: center.y - r - 34,
          width: 2 * r + 68,
          height: 2 * r + 68,
          background:
            "radial-gradient(circle, rgba(10,14,20,0.30) 0%, rgba(8,11,16,0.55) 62%, rgba(6,9,13,0.72) 100%)",
        }}
        initial={{ scale: 0.55, opacity: 0 }}
        animate={{ scale: gone ? 0.85 : 1, opacity: gone ? 0 : 1 }}
        transition={{ type: "spring", stiffness: 480, damping: 30 }}
      />

      {/* the hub — the color it wears now */}
      <motion.div
        aria-hidden
        className="absolute"
        style={{ left: center.x, top: center.y }}
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: gone ? 0.5 : 1, opacity: gone ? 0 : 1 }}
        transition={{ type: "spring", stiffness: 480, damping: 26, delay: 0.05 }}
      >
        <div className="-translate-x-1/2 -translate-y-1/2">
          <div
            className="h-9 w-9 rounded-full border border-white/25 shadow-[0_0_18px_rgba(255,255,255,0.18)]"
            style={{ background: currentColor }}
          />
        </div>
        <div
          className={`absolute left-1/2 top-full mt-2 -translate-x-1/2 whitespace-nowrap text-center text-[9px] font-light uppercase tracking-[0.25em] transition-opacity duration-150 ${
            hot !== null ? "text-white/80 opacity-100" : "text-white/35 opacity-100"
          }`}
        >
          {hot !== null ? SWATCHES[hot].name : "hold"}
        </div>
      </motion.div>

      {/* the swatches */}
      {SWATCHES.map((s, i) => {
        const isHot = hot === i;
        return (
          <motion.button
            key={s.hex}
            type="button"
            aria-label={`Recolor ${modelName} ${s.name}`}
            className="absolute flex h-14 w-14 items-center justify-center outline-none"
            style={{ left: centers[i].x - 28, top: centers[i].y - 28 }}
            initial={{ scale: 0, opacity: 0 }}
            animate={{
              scale: gone ? 0.4 : isHot ? 1.32 : 1,
              opacity: gone ? 0 : 1,
            }}
            transition={{
              type: "spring",
              stiffness: 520,
              damping: 24,
              delay: gone ? 0 : 0.03 + i * 0.016,
            }}
            tabIndex={-1}
          >
            <span
              className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{
                width: isHot ? 32 : 26,
                height: isHot ? 32 : 26,
                background: s.hex,
                boxShadow: isHot
                  ? `0 0 20px 3px ${s.hex}aa, 0 0 4px 1px ${s.hex}`
                  : `0 0 10px 1px ${s.hex}55`,
              }}
            />
            {isHot && (
              <span
                aria-hidden
                className="pointer-events-none absolute left-1/2 top-1/2 h-9 w-9 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white/80"
              />
            )}
          </motion.button>
        );
      })}
    </motion.div>
  );
}

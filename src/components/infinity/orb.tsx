"use client";

import { useEffect, useRef } from "react";
import type { AgentState } from "@/lib/infinity/types";

interface OrbProps {
  state: AgentState;
  /** Mutable 0..1 loudness, written by the agent hook every frame. */
  levelRef: React.MutableRefObject<number>;
  onClick: () => void;
}

const STATE_PARAMS: Record<
  AgentState,
  { base: number; amp: number; glowBase: number; glowAmp: number; bright: number }
> = {
  idle: { base: 1, amp: 0.02, glowBase: 0.22, glowAmp: 0.08, bright: 0 },
  listening: { base: 1.02, amp: 0.3, glowBase: 0.34, glowAmp: 0.5, bright: 0.3 },
  thinking: { base: 1, amp: 0.03, glowBase: 0.4, glowAmp: 0.25, bright: 0.15 },
  speaking: { base: 1.02, amp: 0.34, glowBase: 0.42, glowAmp: 0.55, bright: 0.35 },
};

export function Orb({ state, levelRef, onClick }: OrbProps) {
  const coreRef = useRef<HTMLButtonElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<AgentState>(state);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    let raf = 0;
    let scale = 1;
    const frame = (t: number) => {
      const p = STATE_PARAMS[stateRef.current];
      const level = Math.max(0, Math.min(1, levelRef.current));
      let target = p.base + p.amp * level;
      if (stateRef.current === "thinking") {
        target += 0.028 * Math.sin(t * 0.006) + 0.028;
      }
      scale += (target - scale) * 0.35;
      if (coreRef.current) {
        coreRef.current.style.transform = `scale3d(${scale.toFixed(4)}, ${scale.toFixed(4)}, 1)`;
        coreRef.current.style.filter = `brightness(${(1 + p.bright * level).toFixed(3)})`;
      }
      if (glowRef.current) {
        const glow = p.glowBase + p.glowAmp * level;
        glowRef.current.style.opacity = glow.toFixed(3);
        glowRef.current.style.transform = `scale(${(1 + level * 0.35).toFixed(3)})`;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [levelRef]);

  const active = state === "listening" || state === "speaking";

  return (
    <div
      className={`relative flex items-center justify-center ${state === "idle" ? "orb-breathe" : ""}`}
    >
      {/* ambient glow */}
      <div
        ref={glowRef}
        aria-hidden
        className="absolute h-64 w-64 rounded-full bg-blue-500/30 blur-[70px] will-change-transform sm:h-80 sm:w-80"
        style={{ opacity: 0.22 }}
      />

      {/* ripple rings while voice is active */}
      {active &&
        [0, 1, 2].map((i) => (
          <span
            key={`${state}-${i}`}
            aria-hidden
            className="orb-ripple pointer-events-none absolute h-40 w-40 rounded-full border border-sky-400/30 sm:h-48 sm:w-48"
            style={{ animationDelay: `${i * 0.9}s` }}
          />
        ))}

      {/* the sphere */}
      <button
        ref={coreRef}
        type="button"
        onClick={onClick}
        aria-label={`Infinity — ${state === "idle" ? "tap to start talking" : state}`}
        className="group relative h-40 w-40 cursor-pointer rounded-full border-0 bg-transparent p-0 outline-none will-change-transform focus-visible:ring-2 focus-visible:ring-sky-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-black sm:h-48 sm:w-48"
      >
        {/* base sphere */}
        <span
          aria-hidden
          className="absolute inset-0 rounded-full"
          style={{
            background:
              "radial-gradient(circle at 32% 26%, #e0f2fe 0%, #93c5fd 16%, #3b82f6 44%, #1d4ed8 68%, #111f4e 100%)",
            boxShadow:
              "inset -10px -16px 44px rgba(2, 6, 23, 0.8), inset 8px 12px 34px rgba(255, 255, 255, 0.16), 0 0 60px rgba(59, 130, 246, 0.25)",
          }}
        />
        {/* specular highlight */}
        <span
          aria-hidden
          className="absolute left-[20%] top-[14%] h-[24%] w-[34%] rounded-full bg-white/70 blur-[6px]"
          style={{ transform: "rotate(-20deg)" }}
        />
        {/* inner core light */}
        <span
          aria-hidden
          className="absolute left-1/2 top-1/2 h-1/2 w-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-sky-200/25 blur-xl transition-opacity duration-500"
          style={{ opacity: active ? 0.9 : 0.25 }}
        />
        {/* fine rim */}
        <span aria-hidden className="absolute -inset-[3px] rounded-full ring-1 ring-sky-300/25" />

        {/* thinking shimmer */}
        {state === "thinking" && (
          <span
            aria-hidden
            className="absolute inset-0 rounded-full mix-blend-screen"
            style={{
              background:
                "conic-gradient(from 0deg, transparent 0deg, rgba(186, 230, 253, 0.6) 45deg, transparent 100deg, transparent 180deg, rgba(147, 197, 253, 0.45) 225deg, transparent 280deg)",
              animation: "orb-spin 1.5s linear infinite",
            }}
          />
        )}
      </button>
    </div>
  );
}

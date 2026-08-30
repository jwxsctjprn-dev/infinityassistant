/**
 * HologramOS — SUIT MAKER state.
 *
 * The Iron Man armor fabricator. Config (mark / tint / repulsor) persists to
 * localStorage; the build phase is per-session — you assemble the suit every
 * session, piece by piece, like the movies.
 *
 * Per-frame animation state deliberately lives in the suit LAYER, not here:
 * this store only changes on user actions and at the ~7 clamp moments.
 */

import { create } from "zustand";
import { sound } from "./sound";

export type SuitMark = "MK-1" | "MK-3" | "MK-7";
export type SuitTint = "cyan" | "ice" | "gold" | "crimson";
export type SuitPhase = "idle" | "building" | "worn" | "removing";

export const SUIT_PIECES = 7;

/** Per-mark geometry character (radial segments, plate thickness, stagger). */
export const SUIT_MARKS: Record<
  SuitMark,
  { label: string; seg: number; thick: number; stagger: number; opacity: number }
> = {
  "MK-1": { label: "MARK I — HEAVY FOUNDRY PLATING", seg: 6, thick: 1.28, stagger: 0.5, opacity: 0.2 },
  "MK-3": { label: "MARK III — COMBAT SPEC", seg: 8, thick: 1.0, stagger: 0.42, opacity: 0.16 },
  "MK-7": { label: "MARK VII — SLEEK PROTOTYPE", seg: 12, thick: 0.82, stagger: 0.34, opacity: 0.13 },
};

export const SUIT_TINTS: Record<SuitTint, { label: string; color: string; edge: string }> = {
  cyan: { label: "CLASSIC", color: "#22d3ee", edge: "#67e8f9" },
  ice: { label: "STEALTH ICE", color: "#7dd3fc", edge: "#e0f2fe" },
  gold: { label: "HOTROD", color: "#fbbf24", edge: "#fde68a" },
  crimson: { label: "WAR MACHINE", color: "#f87171", edge: "#fca5a5" },
};

const SUIT_KEY = "hologramos.suit.v1";

interface SuitConfig {
  mark: SuitMark;
  tint: SuitTint;
  repulsor: boolean;
}

function loadConfig(): SuitConfig {
  const fallback: SuitConfig = { mark: "MK-3", tint: "cyan", repulsor: true };
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(SUIT_KEY);
    if (!raw) return fallback;
    const p = JSON.parse(raw) as Partial<SuitConfig>;
    return {
      mark: p.mark && p.mark in SUIT_MARKS ? p.mark : "MK-3",
      tint: p.tint && p.tint in SUIT_TINTS ? p.tint : "cyan",
      repulsor: typeof p.repulsor === "boolean" ? p.repulsor : true,
    };
  } catch {
    return fallback;
  }
}

interface SuitState extends SuitConfig {
  phase: SuitPhase;
  /** pieces clamped so far this build (0..7) — bumped at clamp events only */
  clamped: number;
  build: () => void;
  disassemble: () => void;
  pieceClamped: () => void;
  buildDone: () => void;
  removeDone: () => void;
  setMark: (m: SuitMark) => void;
  setTint: (t: SuitTint) => void;
  setRepulsor: (on: boolean) => void;
}

function persist(s: SuitState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      SUIT_KEY,
      JSON.stringify({ mark: s.mark, tint: s.tint, repulsor: s.repulsor })
    );
  } catch {
    /* private mode — config just won't persist */
  }
}

export const useSuit = create<SuitState>((set, get) => {
  const initial = loadConfig();
  return {
    ...initial,
    phase: "idle",
    clamped: 0,

    build: () => {
      const { phase } = get();
      if (phase === "building" || phase === "removing") return;
      sound.deploy();
      set({ phase: "building", clamped: 0 });
    },

    disassemble: () => {
      const { phase } = get();
      if (phase !== "worn" && phase !== "building") return;
      sound.disarm();
      set({ phase: "removing" });
    },

    pieceClamped: () => {
      const { phase, clamped } = get();
      if (phase !== "building") return;
      set({ clamped: Math.min(SUIT_PIECES, clamped + 1) });
    },

    buildDone: () => set({ phase: "worn", clamped: SUIT_PIECES }),

    removeDone: () => set({ phase: "idle", clamped: 0 }),

    setMark: (mark) => {
      set({ mark });
      persist(get());
    },

    setTint: (tint) => {
      set({ tint });
      persist(get());
    },

    setRepulsor: (repulsor) => {
      set({ repulsor });
      persist(get());
    },
  };
});

/**
 * HologramOS — E2E bridge.
 *
 * A tiny debug surface mirrored onto window.__holo (dev + any build, but it
 * exposes read-only state — harmless in production, indispensable for the
 * agent-browser verification loop):
 *
 *   window.__holo.state → { build, phase, windows, fps, hands, hover,
 *                           lastAction, sessionUptimeMs }
 */

import { useOs } from "./store";
import { rt } from "./runtime";
import { useSuit } from "./suit";

export const HOLOGRAMOS_BUILD = "hologramos-2.2.0-suitmaker";

export const holoBridge = {
  build: HOLOGRAMOS_BUILD,
  phase: "boot" as string,
  windows: [] as string[],
  fps: 0,
  hands: 0,
  hover: null as string | null,
  lastAction: null as null | { type: string; target: string; at: number },
  suit: null as null | { phase: string; clamped: number; mark: string; tint: string; repulsor: boolean },
};

let installed = false;

export function installHoloBridge(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  (window as { __holo?: unknown }).__holo = {
    get state() {
      return {
        build: holoBridge.build,
        phase: holoBridge.phase,
        windows: [...holoBridge.windows],
        fps: Math.round(holoBridge.fps),
        hands: holoBridge.hands,
        hover: holoBridge.hover,
        lastAction: holoBridge.lastAction,
        suit: holoBridge.suit
          ? { ...holoBridge.suit }
          : null,
        sessionUptimeMs: rt.sessionAt ? Math.round(performance.now() - rt.sessionAt) : 0,
      };
    },
  };
  // mirror store changes into the bridge
  useOs.subscribe((s) => {
    holoBridge.phase = s.phase;
    holoBridge.windows = s.windows.map((w) => w.app);
  });
  useSuit.subscribe((s) => {
    holoBridge.suit = {
      phase: s.phase,
      clamped: s.clamped,
      mark: s.mark,
      tint: s.tint,
      repulsor: s.repulsor,
    };
  });
  holoBridge.phase = useOs.getState().phase;
  holoBridge.windows = useOs.getState().windows.map((w) => w.app);
  const s0 = useSuit.getState();
  holoBridge.suit = {
    phase: s0.phase,
    clamped: s0.clamped,
    mark: s0.mark,
    tint: s0.tint,
    repulsor: s0.repulsor,
  };
}

/** Record a user interaction for the E2E loop (and dev debugging). */
export function recordAction(type: string, target: string): void {
  const action = { type, target, at: performance.now() };
  rt.lastAction = action;
  holoBridge.lastAction = action;
}

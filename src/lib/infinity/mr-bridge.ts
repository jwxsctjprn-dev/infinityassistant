/**
 * Infinity — mixed-reality bridge (v2.3.0 "The Workshop Window").
 *
 * The WebXR scene runs inside a three.js render loop that must never
 * re-render React on every frame; this tiny mutable singleton is the
 * hand-off point between the DOM world (mr-mode) and the XR world
 * (mr-scene):
 *   - the scene writes render/input diagnostics here every frame
 *     (the stall watchdog on the DOM side reads them)
 *   - mr-mode sends commands IN (clearParts counter)
 *   - dev-only E2E reads the live scene snapshot
 *
 * There is deliberately NO agent/AI state here: mixed reality is the
 * AI-free sandbox — floating holograms and nothing else.
 */

/** Live input/rendering diagnostics — powers the stall watchdog. */
export interface MrDiag {
  /** Heartbeat: increments on EVERY rendered frame. A frozen number = dead loop. */
  frame: number;
  /** performance.now() of the last rendered frame (stall watchdog). */
  frameAt: number;
  /** Frames per second (rolling, updated ~2Hz). */
  fps: number;
  /** Human summary of session.inputSources, e.g. "R:pointer L:hand". */
  inputs: string;
  /** Joints read per hand this frame (0 = hand not tracked / joints unreadable). */
  joints: { left: number; right: number };
  /** Input event counters. */
  events: { select: number; squeeze: number; pinch: number; sources: number };
  /** First input event ever received (0 = none — likely the reason nothing works). */
  firstEventAt: number;
  /** Last frame-loop/render error ("section: message"), if any. */
  lastError: string | null;
  /** performance.now() when the stall watchdog ended the session (0 = never). */
  stallAt: number;
}

export interface MrBridge {
  /** performance.now() of the first rendered XR frame (0 = none yet). */
  firstFrameAt: number;
  diag: MrDiag;
  /** Commands INTO the scene. Counters — the scene applies each change once. */
  commands: { clearParts: number; toggleWindow: number };
  /** DEV-ONLY live scene snapshot for automated E2E assertions. */
  debug?: {
    /** build marker (grep live bundles for deployment verification) */
    build: string;
    parts: number;
    clusters: number;
    partsList: Array<{ id: number; type: string; pos: [number, number, number] }>;
    /** per-cluster bodies: part count, two-hand scale, tint index, velocity */
    clustersList: Array<{
      id: number;
      parts: number;
      scale: number;
      tint: number;
      dying: boolean;
      summoned: boolean;
      pos: [number, number, number];
      vel: [number, number, number];
      angVel: [number, number, number];
    }>;
    /** two-hand scale & twist gesture state */
    twoHand: { active: boolean; scale: number };
    /** holo window state + world position */
    winOpen: boolean;
    winPos: [number, number, number];
    /** hands-only ☰ summon pill visible */
    pillUp: boolean;
    held: { left: boolean; right: boolean };
    window: { open: boolean; openT: number };
    /** world positions of the 8 window shape slots */
    slots: Array<[number, number, number]>;
    closePos: [number, number, number];
    exitPos: [number, number, number];
    gestures: {
      pinchL: boolean;
      pinchR: boolean;
      fistL: boolean;
      fistR: boolean;
      scissorsL: boolean;
      scissorsR: boolean;
      pointL: boolean;
      pointR: boolean;
      openL: boolean;
      openR: boolean;
    };
    lastSpawnAt: number;
    lastSnapAt: number;
    lastRipAt: number;
    lastSpinAt: number;
    lastPushAt: number;
    lastPullAt: number;
    lastFlickAt: number;
    lastCloneAt: number;
    lastCrushAt: number;
    lastStabAt: number;
    lastTintAt: number;
    lastTumbleAt: number;
    lastYeetAt: number;
    grabTrace: string;
    diag: {
      frame: number;
      fps: number;
      inputs: string;
      jointsL: number;
      jointsR: number;
      select: number;
      squeeze: number;
      pinch: number;
      errors: string[];
    };
  };
}

export const mrBridge: MrBridge = {
  firstFrameAt: 0,
  diag: {
    frame: 0,
    frameAt: 0,
    fps: 0,
    inputs: "",
    joints: { left: 0, right: 0 },
    events: { select: 0, squeeze: 0, pinch: 0, sources: 0 },
    firstEventAt: 0,
    lastError: null,
    stallAt: 0,
  },
  commands: { clearParts: 0, toggleWindow: 0 },
};

/* ------------------------------------------------------------------ */
/* Palette shared by every MR hologram (matches the 2D workbench)      */
/* ------------------------------------------------------------------ */

export const MR_SKY = "#38bdf8";
export const MR_CYAN = "#7dd3fc";
export const MR_ICE = "#e0f2fe";

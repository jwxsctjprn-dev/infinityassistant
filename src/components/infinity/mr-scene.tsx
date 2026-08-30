"use client";

/**
 * Infinity — Mixed Reality scene, v2.2.0 "The Gesture Update".
 *
 * A zero-gravity hologram playground in passthrough. No desk, no grid,
 * no AI — just you and whatever you build, floating in your room:
 *
 *   • PALM PALETTE — a holographic panel hovers ~10cm above your
 *     (left) palm with a HOLOGRAMS tab of shapes. Reach out with the
 *     other hand, pinch a shape and physically RIP it out of the panel.
 *   • ZERO-G PHYSICS — every hologram floats with real momentum.
 *     Graze one with a fingertip and it drifts; slap it and it flies.
 *     Pinch (or close a fist around) a part to hold it with a spring;
 *     let go mid-air and it stays there. Throw it and it sails.
 *   • LEGO SNAPPING — bring a held hologram face-to-face with another
 *     and they click flush and aligned, becoming ONE rigid piece.
 *     Grab any piece of a build and physically RIP it back apart.
 *
 * THE GESTURE PACK (twenty ways to touch the holograms):
 *   • SCISSORS SPIN — ✌ + swipe left/right: set quarter-turn of drift.
 *   • SCISSORS TUMBLE — ✌ + swipe up/down: forward/backward tumble.
 *   • FORCE PUSH — open palm thrust: a shockwave shoves everything in
 *     a cone in front of the hand.
 *   • FORCE PULL — open palm snapped back toward you: the nearest
 *     build flies over and hovers just off the palm (catchable).
 *   • POINT & FLICK — point at a hologram and flick: precision
 *     telekinesis nudge at range, with a live targeting ray.
 *   • TWO-HAND SCALE & TWIST — grab one build with both fists: pull
 *     the hands apart to grow it, together to shrink it, and rotate
 *     them like a steering wheel to turn the whole build.
 *   • DOUBLE-TAP CLONE — tap a hologram twice with a free index
 *     finger: a perfect copy pops out beside it.
 *   • CLAP-CRUSH — sandwich a build between both palms and clap: it
 *     implodes into sparks.
 *   • STABILIZE — hold a still, open palm near a drifting build: it
 *     calms down to a perfect stop.
 *   • SHAKE TO RECOLOR — shake a held build: it cycles through the
 *     hologram tints.
 *   • HARD-THROW DESPAWN — hurl a hologram hard: it sails off in a
 *     spark trail and dissolves.
 *   • EXIT — the only UI is the palette itself: pinch & hold EXIT.
 *
 * Everything that made v2.0.2–v2.1 resilient is kept: the immortal XR
 * loop (guarded render + sectioned frame errors), the press latch, the
 * select-gesture pinch fallback, the viewer-pose camera, and the
 * frame/stall diagnostics that feed the DOM-side watchdogs.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import {
  forceBaseLayerPath,
  requestMrSession,
  sessionHasDomOverlay,
} from "@/lib/infinity/webxr";
import { MR_CYAN, MR_ICE, MR_SKY, mrBridge } from "@/lib/infinity/mr-bridge";

/** Deployment verification marker (grep live bundles for this). */
const SANDBOX_BUILD = "v2.2.0-gesture-pack";

/* ------------------------------------------------------------------ */
/* Tuning constants                                                     */
/* ------------------------------------------------------------------ */

/** Physics — zero gravity, gentle damping so things drift then settle. */
const LIN_DAMP = 0.55;
const ANG_DAMP = 1.7;
const MAX_VEL = 4;
const MAX_ANG = 6;
/** Holograms beyond this radius get a soft spring pull back to the user. */
const KEEP_RADIUS = 1.9;
const KEEP_PULL = 2.2;

/** Held-part spring (accel units, mass-independent). */
const HOLD_KP = 170;
const HOLD_KD = 17;
const HOLD_MAX_ACC = 60;
/** Pull a part this far past its cluster's grip before it TEARS OFF. */
const RIP_DIST = 0.11;

/** Gesture thresholds (metres, from XR hand joints). */
const PINCH_CLOSE = 0.025;
const PINCH_OPEN = 0.045;
const FIST_CLOSE = 0.055;
const FIST_OPEN = 0.068;
const SCISS_EXT = 0.07; // index+middle extended from wrist
const SCISS_CURL = 0.062; // ring+pinky curled to wrist
/** Scissors swipe: net sideways travel / peak speed inside the window. */
const SWIPE_DIST = 0.13;
const SWIPE_SPEED = 1.0;
const SWIPE_WINDOW = 0.26;
const SWIPE_COOLDOWN = 0.5;
/** Spin impulse for a swipe (rad/s ≈ a quarter turn with drift settle). */
const SPIN_IMPULSE = 3.4;
/** Scissors tumble: vertical swipe impulse (rad/s, around camera-right). */
const TUMBLE_DIST = 0.16;
const TUMBLE_IMPULSE = 3.8;

/** Point ☝ (index out, the rest curled). */
const POINT_EXT = 0.07;
const POINT_CURL = 0.062;
/** Point & flick telekinesis. */
const FLICK_SPEED = 1.65;
const FLICK_COOLDOWN = 0.38;
const FLICK_RANGE = 3.2;

/** Force push: open-palm thrust along the palm normal. */
const PUSH_SPEED = 1.35;
const PUSH_RANGE = 1.8;
const PUSH_CONE = 0.72;
const PUSH_COOLDOWN = 0.65;
/** Force pull: open palm snapped back toward the chest. */
const PULL_SPEED = 1.05;
const PULL_RANGE = 2.4;
const PULL_COOLDOWN = 0.9;
const PULL_HOVER = 0.3; // summoned build hovers this far off the palm
const PULL_MS = 1100; // summon steering duration

/** Two-hand scale & twist (both fists on ONE build). */
const SCALE_MIN = 0.35;
const SCALE_MAX = 2.6;

/** Double-tap clone (free index fingertip). */
const TAP_RADIUS = 0.075;
const TAP_GAP_MS = 800;
const TAP_MAX_SPEED = 1.0;

/** Clap-crush: sandwich a build between both palms and clap. */
const CLAP_NEAR = 0.22;
const CLAP_MID = 0.17;
const CLAP_CLOSE = 0.9; // converging speed (m/s)
const CLAP_COOLDOWN = 0.7;

/** Stabilize: a still, open palm calms a nearby drifting build. */
const STAB_DIST = 0.14;
const STAB_HOLD_S = 0.4;
const STAB_COOLDOWN = 0.8;

/** Shake-to-recolor a held build. */
const SHAKE_WINDOW_MS = 700;
const SHAKE_FLIPS = 3;
const SHAKE_SPEED = 0.55;

/** Hard-throw despawn (release speed above this = dissolve in flight). */
const YEET_SPEED = 3.3;
const YEET_MS = 0.45;
/** Clap-crush implode duration. */
const CRUSH_MS = 0.26;

/** Magnetic snap assist (acceleration toward a near-flush face). */
const MAGNET_ACC = 5.5;

/** Hologram tints (shake a held build to cycle). */
const TINTS = ["#67e8f9", "#f472b6", "#fbbf24", "#4ade80", "#a78bfa", "#e2e8f0"];

/** Grab spheres. */
const GRAB_R_PINCH = 0.055;
const GRAB_R_FIST = 0.07;
const GRAB_R_CTRL = 0.06;

/** Snap search (face-centre space, metres). */
const SNAP_DOT = -0.82;
const SNAP_ALONG = 0.052;
const SNAP_LAT = 0.034;
const SNAP_TIGHT_ALONG = 0.04;
const SNAP_TIGHT_LAT = 0.028;
/** Snap engages instantly when this close while held. */
const SNAP_ENGAGE_LAT = 0.02;
const SNAP_ENGAGE_ALONG = 0.032;

/** Palette geometry (metres, panel-local). */
const PAL_W = 0.16;
const PAL_H = 0.125;
const PAL_SLOT = 0.032;
const PAL_GAP = 0.006;
const PAL_LIFT = 0.105; // hover height above the palm
const SLOT_GRAB_R = 0.036;
const EXIT_POS = new THREE.Vector3(0.058, -0.049, 0.004);
const EXIT_W = 0.04;
const EXIT_H = 0.02;
const EXIT_HOLD_S = 0.7;

/** Palette hand selection hysteresis. */
const PAL_MIN_JOINTS = 5;
const PAL_SWITCH_MS = 400;

/** Snap settle animation (ms). */
const SETTLE_MS = 140;

/** Hard cap so a long session can never tank the framerate. */
const MAX_PARTS = 80;

/** Particle pool. */
const PARTICLE_N = 64;

/** Preview: where the interaction plane sits (world). */
const PREVIEW_ANCHOR = new THREE.Vector3(0, 1.3, -0.3);

/* ------------------------------------------------------------------ */
/* Shape catalog                                                        */
/* ------------------------------------------------------------------ */

export type ShapeId =
  | "cube"
  | "brick"
  | "slab"
  | "cylinder"
  | "sphere"
  | "pyramid"
  | "cone"
  | "torus";

export interface ShapeFace {
  /** outward face normal (local) */
  n: THREE.Vector3;
  /** face centre (local) */
  c: THREE.Vector3;
}

export interface ShapeDef {
  id: ShapeId;
  label: string;
  geo: THREE.BufferGeometry;
  wire: THREE.BufferGeometry;
  /** bounding-sphere radius (local, unscaled) */
  bound: number;
  faces: ShapeFace[];
  /** twist-locked snapping (boxes) vs free (round) */
  twist: boolean;
  /** palette miniature scale */
  mini: number;
}

function boxFaces(hx: number, hy: number, hz: number): ShapeFace[] {
  return [
    { n: new THREE.Vector3(1, 0, 0), c: new THREE.Vector3(hx, 0, 0) },
    { n: new THREE.Vector3(-1, 0, 0), c: new THREE.Vector3(-hx, 0, 0) },
    { n: new THREE.Vector3(0, 1, 0), c: new THREE.Vector3(0, hy, 0) },
    { n: new THREE.Vector3(0, -1, 0), c: new THREE.Vector3(0, -hy, 0) },
    { n: new THREE.Vector3(0, 0, 1), c: new THREE.Vector3(0, 0, hz) },
    { n: new THREE.Vector3(0, 0, -1), c: new THREE.Vector3(0, 0, -hz) },
  ];
}

function makeShapes(): ShapeDef[] {
  const defs: Array<{
    id: ShapeId;
    label: string;
    make: () => THREE.BufferGeometry;
    faces: () => ShapeFace[];
    bound: number;
    twist: boolean;
  }> = [
    {
      id: "cube",
      label: "CUBE",
      make: () => new THREE.BoxGeometry(0.07, 0.07, 0.07),
      faces: () => boxFaces(0.035, 0.035, 0.035),
      bound: 0.0606,
      twist: true,
    },
    {
      id: "brick",
      label: "BRICK",
      make: () => new THREE.BoxGeometry(0.14, 0.07, 0.07),
      faces: () => boxFaces(0.07, 0.035, 0.035),
      bound: 0.0866,
      twist: true,
    },
    {
      id: "slab",
      label: "SLAB",
      make: () => new THREE.BoxGeometry(0.14, 0.035, 0.14),
      faces: () => boxFaces(0.07, 0.0175, 0.07),
      bound: 0.0824,
      twist: true,
    },
    {
      id: "cylinder",
      label: "TUBE",
      make: () => new THREE.CylinderGeometry(0.035, 0.035, 0.07, 20),
      faces: () => [
        { n: new THREE.Vector3(0, 1, 0), c: new THREE.Vector3(0, 0.035, 0) },
        { n: new THREE.Vector3(0, -1, 0), c: new THREE.Vector3(0, -0.035, 0) },
      ],
      bound: 0.0495,
      twist: false,
    },
    {
      id: "sphere",
      label: "ORB",
      make: () => new THREE.SphereGeometry(0.04, 20, 14),
      faces: () => [],
      bound: 0.04,
      twist: false,
    },
    {
      id: "pyramid",
      label: "PEAK",
      make: () => {
        const g = new THREE.ConeGeometry(0.052, 0.075, 4, 1);
        g.rotateY(Math.PI / 4);
        return g;
      },
      faces: () => [{ n: new THREE.Vector3(0, -1, 0), c: new THREE.Vector3(0, -0.0375, 0) }],
      bound: 0.054,
      twist: true,
    },
    {
      id: "cone",
      label: "CONE",
      make: () => new THREE.ConeGeometry(0.038, 0.075, 20),
      faces: () => [{ n: new THREE.Vector3(0, -1, 0), c: new THREE.Vector3(0, -0.0375, 0) }],
      bound: 0.0475,
      twist: false,
    },
    {
      id: "torus",
      label: "RING",
      make: () => {
        const g = new THREE.TorusGeometry(0.038, 0.013, 10, 24);
        g.rotateX(Math.PI / 2);
        return g;
      },
      faces: () => [],
      bound: 0.051,
      twist: false,
    },
  ];
  return defs.map((d) => {
    const geo = d.make();
    return {
      id: d.id,
      label: d.label,
      geo,
      wire: new THREE.EdgesGeometry(geo, 24),
      bound: d.bound,
      faces: d.faces(),
      twist: d.twist,
      mini: 0.0125 / d.bound,
    };
  });
}

/** Module-level shared shape assets (built once, page-lifetime). */
const SHAPES: ShapeDef[] = makeShapes();
const SHAPE_BY_ID = new Map(SHAPES.map((s) => [s.id, s]));

/** Slot layout: 4×2 grid on the panel (panel-local). */
const SLOT_LOCAL: THREE.Vector3[] = [];
for (let cy = 0; cy < 2; cy++) {
  for (let cx = 0; cx < 4; cx++) {
    SLOT_LOCAL.push(
      new THREE.Vector3(
        (cx - 1.5) * (PAL_SLOT + PAL_GAP),
        0.01 + (0.5 - cy) * (PAL_SLOT + PAL_GAP),
        0.005
      )
    );
  }
}

/** The hologram colour — identical to the flat workbench blocks. */
const HOLO_COLOR = "#67e8f9";

const tmpColor = new THREE.Color();
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);

function easeOutBack(x: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

function dampK(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt);
}

/* ------------------------------------------------------------------ */
/* Types                                                                */
/* ------------------------------------------------------------------ */

export interface MrSessionInfo {
  session: XRSession;
  /** true when the browser granted dom-overlay (rare in immersive-ar) */
  domOverlay: boolean;
}

export interface MrSceneEvents {
  /** in-world EXIT (or session end) — leave mixed reality */
  onExit: () => void;
  /** the number of floating holograms changed */
  onParts: (count: number) => void;
}

export interface PreviewInput {
  ndc: THREE.Vector2;
  has: boolean;
  pressed: boolean;
  wheel: number;
  keys: Set<string>;
}

interface Part {
  id: number;
  type: ShapeId;
  cluster: Cluster;
  /** offset inside the cluster body frame (physics truth) */
  off: THREE.Vector3;
  offQ: THREE.Quaternion;
  /** render-time offsets (settle animation lerps here) */
  rOff: THREE.Vector3;
  rOffQ: THREE.Quaternion;
  group: THREE.Group;
  fill: THREE.MeshStandardMaterial;
  wire: THREE.MeshBasicMaterial;
  glow: number;
  glowTarget: number;
  held: boolean;
  born: number;
  /** cannot snap again until this time (post-rip flight clearance) */
  snapCooldownUntil: number;
  settle: { fromOff: THREE.Vector3; fromOffQ: THREE.Quaternion; t: number } | null;
}

interface Cluster {
  id: number;
  parts: Part[];
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  quat: THREE.Quaternion;
  angVel: THREE.Vector3;
  mass: number;
  /** settle animation freezes motion briefly after a snap */
  settleT: number;
  /** uniform body scale (two-hand scale gesture) */
  scale: number;
  /** shake-to-recolor state */
  tintIdx: number;
  tintMix: number;
  tintFrom: THREE.Color;
  tintTo: THREE.Color;
  /** stabilize charge (fed by a still palm, decays otherwise) */
  stabT: number;
  stabCdUntil: number;
  /** imploding / dissolving — removed when the timer runs out */
  dying: { t: number; dur: number; thrown: boolean } | null;
  /** force-pull steering target (hand palm + PULL_HOVER) */
  summon: { target: THREE.Vector3; until: number; side: HandSide } | null;
}

type SandboxEvent =
  | "spawn"
  | "snap"
  | "rip"
  | "spin"
  | "release"
  | "full"
  | "push"
  | "pull"
  | "flick"
  | "clone"
  | "crush"
  | "stab"
  | "tint"
  | "tumble"
  | "yeet";
type HandSide = "left" | "right";

interface Hold {
  part: Part | null;
  mode: "pinch" | "fist" | "select" | "controller" | "mouse";
  anchor: THREE.Vector3;
  prevAnchor: THREE.Vector3;
  anchorVel: THREE.Vector3;
  anchorSeen: boolean;
  cooldownUntil: number;
  /** the part released most recently (colliders leave it alone briefly) */
  recent: Part | null;
  recentUntil: number;
  /** holding the palette EXIT button */
  exit: boolean;
  /** shake-to-recolor recognizer */
  shake: { lastDir: number; flips: number[] };
  tintCdUntil: number;
}

interface HandRt {
  seen: boolean;
  joints: number;
  pinch: { active: boolean; point: THREE.Vector3; selectActive: boolean };
  fist: boolean;
  scissors: boolean;
  /** ☝ index out, the rest curled */
  point: boolean;
  /** nothing pinched, curled, scissored or pointed — a free open hand */
  open: boolean;
  palm: { center: THREE.Vector3; normal: THREE.Vector3; fwd: THREE.Vector3; valid: boolean };
  grabActive: boolean;
  grabPoint: THREE.Vector3;
  /** collider spheres: palm + fingertip cluster */
  colPalm: { pos: THREE.Vector3; prev: THREE.Vector3; vel: THREE.Vector3; seen: boolean };
  colTip: { pos: THREE.Vector3; prev: THREE.Vector3; vel: THREE.Vector3; seen: boolean };
  /** index fingertip tracker (flicks + clone taps) */
  tip: { pos: THREE.Vector3; prev: THREE.Vector3; vel: THREE.Vector3; seen: boolean };
  swipe: { samples: Array<{ t: number; x: number; y: number; z: number }>; cooldownUntil: number };
  pushCdUntil: number;
  pullCdUntil: number;
  flickCdUntil: number;
  /** double-tap clone recognizer */
  taps: { cluster: Cluster | null; inside: boolean; at: number };
}

interface PaletteRt {
  side: "left" | "right" | "virtual" | "ctrl" | null;
  candidate: "left" | "right" | null;
  candidateSince: number;
  handsEver: boolean;
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  targetPos: THREE.Vector3;
  targetQuat: THREE.Quaternion;
  scale: number;
  opacity: number;
  hoverSlot: number;
  exitProgress: number;
  exitSide: HandSide | null;
  exited: boolean;
  exitTickAt: number;
  slotPulse: number[];
  texKey: string;
  group: THREE.Group | null;
  panelMat: THREE.MeshBasicMaterial | null;
  exitMat: THREE.MeshBasicMaterial | null;
  strutMat: THREE.LineBasicMaterial | null;
  strutGeo: THREE.BufferGeometry | null;
  panelCanvas: HTMLCanvasElement | null;
  panelTex: THREE.CanvasTexture | null;
  exitCanvas: HTMLCanvasElement | null;
  exitTex: THREE.CanvasTexture | null;
  slots: Array<{ group: THREE.Group; fill: THREE.MeshStandardMaterial; wire: THREE.MeshBasicMaterial }>;
}

interface Rt {
  holds: { left: Hold; right: Hold };
  hands: { left: HandRt; right: HandRt };
  ctrl: {
    left: { pos: THREE.Vector3; prev: THREE.Vector3; vel: THREE.Vector3; seen: boolean };
    right: { pos: THREE.Vector3; prev: THREE.Vector3; vel: THREE.Vector3; seen: boolean };
  };
  pressQueue: Array<{ type: "begin" | "end"; side: HandSide }>;
  /** dedupes double press-begins (joint pinch + select event firing together) */
  pressLatch: Set<unknown>;
  palette: PaletteRt;
  sandbox: Sandbox | null;
  sources: { left: XRInputSource | null; right: XRInputSource | null };
  camPos: THREE.Vector3;
  camQuat: THREE.Quaternion;
  time: number;
  firstFrame: boolean;
  fpsAt: number;
  fpsFrames: number;
  cmdSeen: number;
  last: {
    spawn: number;
    snap: number;
    rip: number;
    spin: number;
    push: number;
    pull: number;
    flick: number;
    clone: number;
    crush: number;
    stab: number;
    tint: number;
    tumble: number;
    yeet: number;
  };
  /** two-hand scale & twist state */
  twoHand: {
    active: boolean;
    cluster: Cluster | null;
    startDist: number;
    startScale: number;
    startDir: THREE.Vector3;
    startQuat: THREE.Quaternion;
    startPos: THREE.Vector3;
    startMid: THREE.Vector3;
    midPrev: THREE.Vector3;
    midVel: THREE.Vector3;
  };
  clapCdUntil: number;
  /** dev trace of the last attemptGrab decision */
  grabTrace: string;
  debugAt: number;
  /** preview virtual hand */
  vPoint: { pos: THREE.Vector3; prev: THREE.Vector3; vel: THREE.Vector3; seen: boolean };
  vPrevPressed: boolean;
  vPrevX: boolean;
}

function makeHold(): Hold {
  return {
    part: null,
    mode: "pinch",
    anchor: new THREE.Vector3(),
    prevAnchor: new THREE.Vector3(),
    anchorVel: new THREE.Vector3(),
    anchorSeen: false,
    cooldownUntil: 0,
    recent: null,
    recentUntil: 0,
    exit: false,
    shake: { lastDir: 0, flips: [] },
    tintCdUntil: 0,
  };
}

function makeHandRt(): HandRt {
  return {
    seen: false,
    joints: 0,
    pinch: { active: false, point: new THREE.Vector3(), selectActive: false },
    fist: false,
    scissors: false,
    point: false,
    open: false,
    palm: {
      center: new THREE.Vector3(),
      normal: new THREE.Vector3(0, 1, 0),
      fwd: new THREE.Vector3(0, 0, -1),
      valid: false,
    },
    grabActive: false,
    grabPoint: new THREE.Vector3(),
    colPalm: { pos: new THREE.Vector3(), prev: new THREE.Vector3(), vel: new THREE.Vector3(), seen: false },
    colTip: { pos: new THREE.Vector3(), prev: new THREE.Vector3(), vel: new THREE.Vector3(), seen: false },
    tip: { pos: new THREE.Vector3(), prev: new THREE.Vector3(), vel: new THREE.Vector3(), seen: false },
    swipe: { samples: [], cooldownUntil: 0 },
    pushCdUntil: 0,
    pullCdUntil: 0,
    flickCdUntil: 0,
    taps: { cluster: null, inside: false, at: 0 },
  };
}

function makeRt(): Rt {
  return {
    holds: { left: makeHold(), right: makeHold() },
    hands: { left: makeHandRt(), right: makeHandRt() },
    ctrl: {
      left: { pos: new THREE.Vector3(), prev: new THREE.Vector3(), vel: new THREE.Vector3(), seen: false },
      right: { pos: new THREE.Vector3(), prev: new THREE.Vector3(), vel: new THREE.Vector3(), seen: false },
    },
    pressQueue: [],
    pressLatch: new Set<unknown>(),
    palette: {
      side: null,
      candidate: null,
      candidateSince: 0,
      handsEver: false,
      pos: new THREE.Vector3(0, 1.3, -0.4),
      quat: new THREE.Quaternion(),
      targetPos: new THREE.Vector3(0, 1.3, -0.4),
      targetQuat: new THREE.Quaternion(),
      scale: 1,
      opacity: 0,
      hoverSlot: -1,
      exitProgress: 0,
      exitSide: null,
      exited: false,
      exitTickAt: 0,
      slotPulse: SLOT_LOCAL.map(() => 0),
      texKey: "",
      group: null,
      panelMat: null,
      exitMat: null,
      strutMat: null,
      strutGeo: null,
      panelCanvas: null,
      panelTex: null,
      exitCanvas: null,
      exitTex: null,
      slots: [],
    },
    sandbox: null,
    sources: { left: null, right: null },
    camPos: new THREE.Vector3(0, 1.6, 0),
    camQuat: new THREE.Quaternion(),
    time: 0,
    firstFrame: false,
    fpsAt: 0,
    fpsFrames: 0,
    cmdSeen: 0,
    last: {
      spawn: 0,
      snap: 0,
      rip: 0,
      spin: 0,
      push: 0,
      pull: 0,
      flick: 0,
      clone: 0,
      crush: 0,
      stab: 0,
      tint: 0,
      tumble: 0,
      yeet: 0,
    },
    twoHand: {
      active: false,
      cluster: null,
      startDist: 1,
      startScale: 1,
      startDir: new THREE.Vector3(1, 0, 0),
      startQuat: new THREE.Quaternion(),
      startPos: new THREE.Vector3(),
      startMid: new THREE.Vector3(),
      midPrev: new THREE.Vector3(),
      midVel: new THREE.Vector3(),
    },
    clapCdUntil: 0,
    grabTrace: "",
    debugAt: 0,
    vPoint: { pos: new THREE.Vector3(0, 1.3, -0.3), prev: new THREE.Vector3(), vel: new THREE.Vector3(), seen: false },
    vPrevPressed: false,
    vPrevX: false,
  };
}

/* ------------------------------------------------------------------ */
/* Hand joint pools (module-level scratch, allocation-free)             */
/* ------------------------------------------------------------------ */

const handPools = {
  left: { vecs: [] as THREE.Vector3[], names: [] as string[], count: 0 },
  right: { vecs: [] as THREE.Vector3[], names: [] as string[], count: 0 },
};

function poolVec(arr: THREE.Vector3[], i: number): THREE.Vector3 {
  return arr[i] ?? (arr[i] = new THREE.Vector3());
}

/** Joint lookup tolerant of pinky/little naming across runtimes. */
function jointAt(side: HandSide, ...names: string[]): THREE.Vector3 | null {
  const pool = handPools[side];
  for (const n of names) {
    const i = pool.names.indexOf(n);
    if (i >= 0 && i < pool.count) return pool.vecs[i];
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Error capture (feeds the stall watchdog + dev debug)                 */
/* ------------------------------------------------------------------ */

function recordFrameError(section: string, err: unknown): void {
  const msg = `${section}: ${err instanceof Error ? err.message : String(err)}`;
  if (mrBridge.diag.lastError !== msg) {
    mrBridge.diag.lastError = msg;
    const ring = frameErrorRing;
    if (ring[ring.length - 1] !== msg) {
      ring.push(msg);
      while (ring.length > 3) ring.shift();
    }
  }
}

const frameErrorRing: string[] = [];

const guardedRenderers = new WeakSet<THREE.WebGLRenderer>();

/** Wrap `renderer.render` so a per-frame render throw is recorded instead of
 *  propagating into three's XR animation loop (which cannot recover). */
function guardRenderer(gl: THREE.WebGLRenderer): void {
  if (guardedRenderers.has(gl)) return;
  guardedRenderers.add(gl);
  const orig = gl.render.bind(gl);
  gl.render = (scene: THREE.Scene, camera: THREE.Camera) => {
    try {
      return orig(scene, camera);
    } catch (err) {
      recordFrameError("render", err);
      return undefined;
    }
  };
}

/* ------------------------------------------------------------------ */
/* Audio — tiny synthesized UI sounds (no assets)                       */
/* ------------------------------------------------------------------ */

const mrAudio = {
  ctx: null as AudioContext | null,
  master: null as GainNode | null,
  noiseBuf: null as AudioBuffer | null,

  ensure(): AudioContext | null {
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume().catch(() => undefined);
      return this.ctx;
    }
    try {
      const AC =
        (globalThis as { AudioContext?: typeof AudioContext }).AudioContext ??
        (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.14;
      this.master.connect(this.ctx.destination);
      const len = Math.floor(this.ctx.sampleRate * 0.25);
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch {
      this.ctx = null;
    }
    return this.ctx;
  },

  blip(
    f0: number,
    f1: number,
    dur: number,
    type: OscillatorType = "sine",
    gain = 0.5,
    delay = 0
  ): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    try {
      const t = ctx.currentTime + delay;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(f0, t);
      osc.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g).connect(this.master);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    } catch {
      /* audio is decorative */
    }
  },

  noise(dur: number, f0: number, f1: number, gain = 0.4): void {
    const ctx = this.ensure();
    if (!ctx || !this.master || !this.noiseBuf) return;
    try {
      const t = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.Q.value = 1.1;
      bp.frequency.setValueAtTime(f0, t);
      bp.frequency.exponentialRampToValueAtTime(Math.max(60, f1), t + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(bp).connect(g).connect(this.master);
      src.start(t);
      src.stop(t + dur + 0.02);
    } catch {
      /* decorative */
    }
  },

  grab(): void {
    this.blip(470, 560, 0.05, "triangle", 0.4);
  },
  release(): void {
    this.blip(520, 380, 0.06, "triangle", 0.28);
  },
  spawn(): void {
    this.blip(300, 760, 0.1, "sawtooth", 0.3);
    this.noise(0.09, 900, 2400, 0.22);
  },
  rip(): void {
    this.blip(220, 640, 0.12, "sawtooth", 0.38);
    this.noise(0.14, 500, 2600, 0.4);
  },
  snap(): void {
    this.blip(660, 660, 0.035, "sine", 0.5);
    this.blip(990, 990, 0.05, "sine", 0.42, 0.025);
    this.blip(120, 80, 0.09, "sine", 0.5);
  },
  spin(): void {
    this.noise(0.2, 380, 1500, 0.3);
  },
  push(): void {
    this.blip(140, 60, 0.18, "sine", 0.55);
    this.noise(0.16, 300, 90, 0.35);
  },
  pull(): void {
    this.blip(180, 520, 0.22, "sine", 0.4);
  },
  flick(): void {
    this.blip(900, 1400, 0.05, "square", 0.2);
  },
  clone(): void {
    this.blip(520, 660, 0.05, "triangle", 0.4);
    this.blip(780, 990, 0.06, "triangle", 0.35, 0.06);
  },
  crush(): void {
    this.noise(0.28, 2200, 120, 0.6);
    this.blip(320, 60, 0.22, "sawtooth", 0.4);
  },
  stab(): void {
    this.blip(700, 700, 0.08, "sine", 0.3);
    this.blip(1050, 1050, 0.1, "sine", 0.22, 0.05);
  },
  tint(): void {
    this.blip(440, 880, 0.12, "triangle", 0.32);
  },
  tumble(): void {
    this.noise(0.24, 300, 900, 0.32);
  },
  yeet(): void {
    this.noise(0.3, 600, 1800, 0.35);
    this.blip(600, 200, 0.25, "sawtooth", 0.3);
  },
  exitTick(p: number): void {
    this.blip(620 + p * 420, 620 + p * 420, 0.03, "square", 0.16);
  },
  exit(): void {
    this.blip(880, 220, 0.35, "triangle", 0.4);
  },
};

/* ------------------------------------------------------------------ */
/* Haptics                                                              */
/* ------------------------------------------------------------------ */

function hapticPulse(src: XRInputSource | null, value: number, ms: number): void {
  try {
    const gamepad = src?.gamepad as
      | { hapticActuators?: Array<{ pulse?: (v: number, d: number) => void }> }
      | null
      | undefined;
    gamepad?.hapticActuators?.[0]?.pulse?.(value, ms);
  } catch {
    /* haptics are decorative */
  }
}

/* ------------------------------------------------------------------ */
/* Canvas-texture helpers (holographic panels without font deps)        */
/* ------------------------------------------------------------------ */

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** panel-local (m) → palette canvas px (512×400) */
function palPx(x: number, y: number): [number, number] {
  return [(x / PAL_W + 0.5) * 512, (0.5 - y / PAL_H) * 400];
}

function drawPaletteTexture(
  canvas: HTMLCanvasElement,
  hoverSlot: number,
  slotPulse: number[]
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  // glass body
  ctx.fillStyle = "rgba(3, 9, 20, 0.62)";
  roundRect(ctx, 6, 6, W - 12, H - 12, 26);
  ctx.fill();
  ctx.strokeStyle = MR_CYAN;
  ctx.lineWidth = 2.5;
  ctx.shadowColor = MR_CYAN;
  ctx.shadowBlur = 12;
  roundRect(ctx, 6, 6, W - 12, H - 12, 26);
  ctx.stroke();
  ctx.shadowBlur = 0;

  // tab row
  const [tx, ty] = palPx(-PAL_W / 2 + 0.004, PAL_H / 2 - 0.004);
  const tabW = 132;
  const tabH = 30;
  ctx.fillStyle = "rgba(56, 189, 248, 0.16)";
  roundRect(ctx, tx, ty, tabW, tabH, 8);
  ctx.fill();
  ctx.strokeStyle = "rgba(125, 211, 252, 0.9)";
  ctx.lineWidth = 2;
  roundRect(ctx, tx, ty, tabW, tabH, 8);
  ctx.stroke();
  ctx.fillStyle = "rgba(224, 242, 254, 0.96)";
  ctx.font = "600 17px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("HOLOGRAMS", tx + 14, ty + tabH / 2 + 1);

  // ghost tab (future tabs hint)
  ctx.strokeStyle = "rgba(125, 211, 252, 0.28)";
  ctx.lineWidth = 2;
  roundRect(ctx, tx + tabW + 10, ty, 46, tabH, 8);
  ctx.stroke();
  ctx.fillStyle = "rgba(125, 211, 252, 0.4)";
  ctx.font = "600 17px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText("· · ·", tx + tabW + 20, ty + tabH / 2 + 1);

  // ∞ mark
  ctx.fillStyle = "rgba(125, 211, 252, 0.55)";
  ctx.font = "600 26px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textAlign = "right";
  ctx.fillText("∞", W - 24, ty + tabH / 2 + 1);

  // slot frames + labels
  ctx.textAlign = "center";
  for (let i = 0; i < SLOT_LOCAL.length && i < SHAPES.length; i++) {
    const [cx, cy] = palPx(SLOT_LOCAL[i].x, SLOT_LOCAL[i].y);
    const s = (PAL_SLOT / PAL_W) * 512;
    const pulse = slotPulse[i] ?? 0;
    const hot = i === hoverSlot;
    ctx.fillStyle = hot
      ? "rgba(56, 189, 248, 0.22)"
      : pulse > 0
        ? `rgba(56, 189, 248, ${0.08 + 0.2 * pulse})`
        : "rgba(56, 189, 248, 0.07)";
    roundRect(ctx, cx - s / 2, cy - s / 2, s, s, 12);
    ctx.fill();
    ctx.strokeStyle = hot
      ? "rgba(224, 242, 254, 0.95)"
      : pulse > 0
        ? `rgba(125, 211, 252, ${0.5 + 0.5 * pulse})`
        : "rgba(125, 211, 252, 0.42)";
    ctx.lineWidth = hot ? 3 : 2;
    roundRect(ctx, cx - s / 2, cy - s / 2, s, s, 12);
    ctx.stroke();
    ctx.fillStyle = "rgba(148, 197, 224, 0.75)";
    ctx.font = "500 13px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillText(SHAPES[i].label, cx, cy + s / 2 + 13);
  }

  // hint
  const [hx, hy] = palPx(-PAL_W / 2 + 0.01, -0.046);
  ctx.fillStyle = "rgba(148, 197, 224, 0.62)";
  ctx.font = "500 14px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textAlign = "left";
  ctx.fillText("PINCH & PULL", hx, hy);
}

function drawExitTexture(canvas: HTMLCanvasElement, progress: number): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "rgba(3, 9, 20, 0.72)";
  roundRect(ctx, 5, 5, W - 10, H - 10, 14);
  ctx.fill();
  const hot = progress > 0;
  ctx.strokeStyle = hot ? MR_ICE : "rgba(125, 211, 252, 0.75)";
  ctx.lineWidth = 2.5;
  ctx.shadowColor = MR_CYAN;
  ctx.shadowBlur = hot ? 14 : 8;
  roundRect(ctx, 5, 5, W - 10, H - 10, 14);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(224, 242, 254, 0.96)";
  ctx.font = "600 34px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText("EXIT", W / 2, H / 2 - 6);
  // hold-progress bar
  ctx.fillStyle = "rgba(125, 211, 252, 0.18)";
  roundRect(ctx, 26, H - 24, W - 52, 8, 4);
  ctx.fill();
  if (progress > 0) {
    ctx.fillStyle = MR_ICE;
    roundRect(ctx, 26, H - 24, (W - 52) * Math.min(1, progress), 8, 4);
    ctx.fill();
  }
}

/* ------------------------------------------------------------------ */
/* Particles — pooled additive sparks                                   */
/* ------------------------------------------------------------------ */

class ParticleSystem {
  mesh: THREE.InstancedMesh;
  private slots: Array<{
    pos: THREE.Vector3;
    vel: THREE.Vector3;
    life: number;
    max: number;
    size: number;
  }>;
  private dummy = new THREE.Object3D();
  private color = new THREE.Color();

  constructor(scene: THREE.Object3D) {
    const geo = new THREE.IcosahedronGeometry(1, 0);
    const mat = new THREE.MeshBasicMaterial({
      color: MR_ICE,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, PARTICLE_N);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    scene.add(this.mesh);
    this.slots = [];
    for (let i = 0; i < PARTICLE_N; i++) {
      this.slots.push({
        pos: new THREE.Vector3(0, -100, 0),
        vel: new THREE.Vector3(),
        life: 0,
        max: 1,
        size: 0.001,
      });
      this.dummy.position.set(0, -100, 0);
      this.dummy.scale.setScalar(0.0001);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      this.color.setHSL(0.52 + Math.random() * 0.05, 0.9, 0.75);
      this.mesh.setColorAt(i, this.color);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  burst(at: THREE.Vector3, count: number, speed: number, size = 0.0035): void {
    let spawned = 0;
    for (const s of this.slots) {
      if (spawned >= count) break;
      if (s.life > 0) continue;
      s.pos.copy(at);
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      const v = speed * (0.4 + Math.random() * 0.6);
      s.vel.set(
        Math.sin(ph) * Math.cos(th) * v,
        Math.cos(ph) * v,
        Math.sin(ph) * Math.sin(th) * v
      );
      s.max = 0.35 + Math.random() * 0.3;
      s.life = s.max;
      s.size = size * (0.6 + Math.random() * 0.8);
      spawned++;
    }
  }

  update(dt: number): void {
    let dirty = false;
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (s.life <= 0) continue;
      s.life -= dt;
      s.vel.multiplyScalar(Math.exp(-3.2 * dt));
      s.pos.addScaledVector(s.vel, dt);
      const k = Math.max(0, s.life / s.max);
      this.dummy.position.copy(s.pos);
      this.dummy.scale.setScalar(s.life > 0 ? s.size * (0.3 + 0.7 * k) : 0.0001);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      dirty = true;
    }
    if (dirty) this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

/* ------------------------------------------------------------------ */
/* Ring effects — pooled expanding/imploding holo rings                 */
/* ------------------------------------------------------------------ */

const ringFxGeo = new THREE.TorusGeometry(1, 0.02, 8, 40);

class RingFx {
  private slots: Array<{
    mesh: THREE.Mesh;
    mat: THREE.MeshBasicMaterial;
    life: number;
    dur: number;
    from: number;
    to: number;
  }>;

  constructor(scene: THREE.Object3D, n = 7) {
    this.slots = [];
    for (let i = 0; i < n; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: MR_ICE,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(ringFxGeo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 6;
      scene.add(mesh);
      this.slots.push({ mesh, mat, life: 0, dur: 1, from: 0.05, to: 0.5 });
    }
  }

  spawn(
    at: THREE.Vector3,
    quat: THREE.Quaternion,
    from: number,
    to: number,
    dur: number,
    color: string = MR_ICE
  ): void {
    let slot = this.slots.find((s) => s.life <= 0);
    if (!slot) slot = this.slots[0];
    slot.life = dur;
    slot.dur = dur;
    slot.from = from;
    slot.to = to;
    slot.mesh.position.copy(at);
    slot.mesh.quaternion.copy(quat);
    slot.mesh.scale.setScalar(Math.max(0.001, from));
    slot.mesh.visible = true;
    slot.mat.color.set(color);
  }

  update(dt: number): void {
    for (const s of this.slots) {
      if (s.life <= 0) continue;
      s.life -= dt;
      if (s.life <= 0) {
        s.mesh.visible = false;
        continue;
      }
      const k = 1 - s.life / s.dur;
      const e = 1 - Math.pow(1 - k, 3);
      s.mesh.scale.setScalar(Math.max(0.001, s.from + (s.to - s.from) * e));
      s.mat.opacity = 0.85 * (1 - k);
    }
  }

  dispose(): void {
    for (const s of this.slots) {
      s.mesh.removeFromParent();
      s.mat.dispose();
    }
  }
}

/* ------------------------------------------------------------------ */
/* Sandbox — parts, clusters, zero-G physics, snapping                  */
/* ------------------------------------------------------------------ */

interface SnapCandidate {
  moving: Part;
  target: Part;
  mf: ShapeFace;
  tf: ShapeFace;
  score: number;
  lat: number;
  along: number;
}

class Sandbox {
  clusters: Cluster[] = [];
  parts: Part[] = [];
  root: THREE.Group;
  particles: ParticleSystem;
  onEvent: (kind: SandboxEvent, at: THREE.Vector3, side?: HandSide) => void = () => undefined;
  onCount: (n: number) => void = () => undefined;
  private seq = 0;
  private clusterSeq = 0;

  // dedicated scratch (NEVER alias between uses inside one expression)
  private sv1 = new THREE.Vector3();
  private sv2 = new THREE.Vector3();
  private sv3 = new THREE.Vector3();
  private sv4 = new THREE.Vector3();
  private sv5 = new THREE.Vector3();
  private sv6 = new THREE.Vector3();
  private sv7 = new THREE.Vector3();
  private sv8 = new THREE.Vector3();
  private sq1 = new THREE.Quaternion();
  private sq2 = new THREE.Quaternion();
  private sq3 = new THREE.Quaternion();
  private sq4 = new THREE.Quaternion();

  constructor(scene: THREE.Object3D) {
    this.root = new THREE.Group();
    scene.add(this.root);
    this.particles = new ParticleSystem(scene);
  }

  get count(): number {
    return this.parts.length;
  }

  partWorld(part: Part, outPos: THREE.Vector3, outQuat: THREE.Quaternion): void {
    const c = part.cluster;
    outQuat.copy(c.quat).multiply(part.offQ);
    outPos.copy(part.off).multiplyScalar(c.scale).applyQuaternion(c.quat).add(c.pos);
  }

  spawn(
    type: ShapeId,
    pos: THREE.Vector3,
    quat: THREE.Quaternion | null,
    side?: HandSide
  ): Part | null {
    if (this.parts.length >= MAX_PARTS) {
      this.onEvent("full", pos, side);
      return null;
    }
    const shape = SHAPE_BY_ID.get(type);
    if (!shape) return null;
    const cluster: Cluster = {
      id: ++this.clusterSeq,
      parts: [],
      pos: pos.clone(),
      vel: new THREE.Vector3(),
      quat: quat ? quat.clone() : new THREE.Quaternion(),
      angVel: new THREE.Vector3(),
      mass: 1,
      settleT: 0,
      scale: 1,
      tintIdx: 0,
      tintMix: 1,
      tintFrom: new THREE.Color(HOLO_COLOR),
      tintTo: new THREE.Color(HOLO_COLOR),
      stabT: 0,
      stabCdUntil: 0,
      dying: null,
      summon: null,
    };
    const group = new THREE.Group();
    const fill = new THREE.MeshStandardMaterial({
      color: HOLO_COLOR,
      emissive: HOLO_COLOR,
      emissiveIntensity: 0.32,
      transparent: true,
      opacity: 0.15,
      roughness: 0.35,
      metalness: 0.1,
      depthWrite: false,
    });
    const wire = new THREE.MeshBasicMaterial({
      color: HOLO_COLOR,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const solid = new THREE.Mesh(shape.geo, fill);
    const shell = new THREE.LineSegments(shape.wire, wire);
    shell.scale.setScalar(1.004);
    group.add(solid, shell);
    group.scale.setScalar(0.001);
    this.root.add(group);
    const part: Part = {
      id: ++this.seq,
      type,
      cluster,
      off: new THREE.Vector3(0, 0, 0),
      offQ: new THREE.Quaternion(),
      rOff: new THREE.Vector3(),
      rOffQ: new THREE.Quaternion(),
      group,
      fill,
      wire,
      glow: 0,
      glowTarget: 0,
      held: false,
      born: performance.now(),
      snapCooldownUntil: 0,
      settle: null,
    };
    cluster.parts.push(part);
    this.clusters.push(cluster);
    this.parts.push(part);
    this.onCount(this.parts.length);
    this.onEvent("spawn", pos, side);
    return part;
  }

  private disposePart(part: Part): void {
    const i = this.parts.indexOf(part);
    if (i >= 0) this.parts.splice(i, 1);
    part.group.removeFromParent();
    part.fill.dispose();
    part.wire.dispose();
  }

  clear(): void {
    while (this.parts.length) this.disposePart(this.parts[0]);
    this.clusters.length = 0;
    this.onCount(0);
  }

  /** Nearest part whose grab sphere contains `point`. */
  tryGrab(point: THREE.Vector3, radius: number): Part | null {
    let best: Part | null = null;
    let bestD = Infinity;
    for (const p of this.parts) {
      if (p.cluster.dying) continue;
      this.partWorld(p, this.sv1, this.sq1);
      const d = this.sv1.distanceTo(point) - SHAPE_BY_ID.get(p.type)!.bound * p.cluster.scale;
      if (d < radius && d < bestD) {
        best = p;
        bestD = d;
      }
    }
    return best;
  }

  /** Spring the held part's cluster toward the anchor; rip when yanked. */
  holdUpdate(
    dt: number,
    part: Part,
    anchor: THREE.Vector3,
    anchorVel: THREE.Vector3,
    side: HandSide
  ): "held" | "ripped" {
    const c = part.cluster;
    this.partWorld(part, this.sv1, this.sq1);
    this.sv2.copy(anchor).sub(this.sv1); // stretch vector
    const stretch = this.sv2.length();
    if (c.parts.length > 1 && stretch > RIP_DIST) {
      const dir = this.sv2.clone().normalize();
      this.ripPart(part, dir, anchorVel, side);
      return "ripped";
    }
    // velocity of the grab point on the body
    this.sv3.copy(this.sv1).sub(c.pos); // r
    this.sv5.copy(c.angVel).cross(this.sv3).add(c.vel); // point velocity
    // spring acceleration (critically damped-ish):
    //   a = kP·(anchor − point) − kD·(anchorVel − pointVel)
    this.sv4
      .copy(anchorVel)
      .sub(this.sv5)
      .multiplyScalar(HOLD_KD)
      .addScaledVector(this.sv2, HOLD_KP);
    if (this.sv4.length() > HOLD_MAX_ACC) this.sv4.setLength(HOLD_MAX_ACC);
    c.vel.addScaledVector(this.sv4, dt);
    // torque from the off-centre pull point
    this.sv3.copy(this.sv1).sub(c.pos);
    this.sv2.copy(this.sv3).cross(this.sv4).multiplyScalar(0.25 / 0.006);
    c.angVel.addScaledVector(this.sv2, dt);
    if (c.angVel.length() > MAX_ANG) c.angVel.setLength(MAX_ANG);
    return "held";
  }

  /** Tear `part` out of its cluster (if multi-part) and hand it momentum. */
  ripPart(part: Part, dir: THREE.Vector3, anchorVel: THREE.Vector3, side: HandSide): void {
    const old = part.cluster;
    this.partWorld(part, this.sv1, this.sq1);
    if (old.parts.length <= 1) {
      old.vel.copy(anchorVel).addScaledVector(dir, 0.8);
      return;
    }
    const j = old.parts.indexOf(part);
    if (j >= 0) old.parts.splice(j, 1);
    old.mass = old.parts.length;
    old.vel.addScaledVector(dir, -0.35); // reaction kick on the rest
    const fresh: Cluster = {
      id: ++this.clusterSeq,
      parts: [part],
      pos: this.sv1.clone(),
      vel: anchorVel.clone().addScaledVector(dir, 1.4),
      quat: this.sq1.clone(),
      angVel: new THREE.Vector3(
        (Math.random() - 0.5) * 1.5,
        (Math.random() - 0.5) * 1.5,
        (Math.random() - 0.5) * 1.5
      ),
      mass: 1,
      settleT: 0,
      scale: old.scale,
      tintIdx: old.tintIdx,
      tintMix: 1,
      tintFrom: old.tintTo.clone(),
      tintTo: old.tintTo.clone(),
      stabT: 0,
      stabCdUntil: 0,
      dying: null,
      summon: null,
    };
    part.cluster = fresh;
    part.off.set(0, 0, 0);
    part.offQ.identity();
    part.settle = null;
    part.snapCooldownUntil = performance.now() + 650;
    this.clusters.push(fresh);
    this.onEvent("rip", this.sv1, side);
  }

  release(part: Part, anchorVel: THREE.Vector3, side: HandSide): void {
    part.cluster.vel.addScaledVector(anchorVel, 0.85);
    this.onEvent("release", part.cluster.pos, side);
  }

  /** Clone an entire cluster (double-tap gesture). */
  cloneCluster(c: Cluster, pos: THREE.Vector3, side?: HandSide): Cluster | null {
    if (this.parts.length + c.parts.length > MAX_PARTS) {
      this.onEvent("full", pos, side);
      return null;
    }
    if (c.dying) return null;
    const fresh: Cluster = {
      id: ++this.clusterSeq,
      parts: [],
      pos: pos.clone(),
      vel: new THREE.Vector3(),
      quat: c.quat.clone(),
      angVel: new THREE.Vector3(
        (Math.random() - 0.5) * 0.8,
        (Math.random() - 0.5) * 0.8,
        (Math.random() - 0.5) * 0.8
      ),
      mass: c.parts.length,
      settleT: 0,
      scale: c.scale,
      tintIdx: c.tintIdx,
      tintMix: 1,
      tintFrom: c.tintTo.clone(),
      tintTo: c.tintTo.clone(),
      stabT: 0,
      stabCdUntil: 0,
      dying: null,
      summon: null,
    };
    for (const p of c.parts) {
      const shape = SHAPE_BY_ID.get(p.type)!;
      const group = new THREE.Group();
      const fill = new THREE.MeshStandardMaterial({
        color: p.fill.color.clone(),
        emissive: p.fill.emissive.clone(),
        emissiveIntensity: 0.32,
        transparent: true,
        opacity: 0.15,
        roughness: 0.35,
        metalness: 0.1,
        depthWrite: false,
      });
      const wire = new THREE.MeshBasicMaterial({
        color: p.wire.color.clone(),
        transparent: true,
        opacity: 0.6,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const solid = new THREE.Mesh(shape.geo, fill);
      const shell = new THREE.LineSegments(shape.wire, wire);
      shell.scale.setScalar(1.004);
      group.add(solid, shell);
      group.scale.setScalar(0.001);
      this.root.add(group);
      const np: Part = {
        id: ++this.seq,
        type: p.type,
        cluster: fresh,
        off: p.off.clone(),
        offQ: p.offQ.clone(),
        rOff: p.off.clone(),
        rOffQ: p.offQ.clone(),
        group,
        fill,
        wire,
        glow: 0,
        glowTarget: 0,
        held: false,
        born: performance.now(),
        snapCooldownUntil: 0,
        settle: null,
      };
      fresh.parts.push(np);
      this.parts.push(np);
    }
    this.clusters.push(fresh);
    this.onCount(this.parts.length);
    this.onEvent("clone", pos, side);
    return fresh;
  }

  /** Start a cluster dying (clap-crush or hard-throw). */
  killCluster(c: Cluster, thrown: boolean): void {
    if (c.dying) return;
    const dur = thrown ? YEET_MS : CRUSH_MS;
    c.dying = { t: dur, dur, thrown };
    c.summon = null;
    c.stabT = 0;
    c.angVel.add(
      new THREE.Vector3(
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 2
      )
    );
    this.onEvent(thrown ? "yeet" : "crush", c.pos);
  }

  /** Advance a cluster's hologram tint (shake gesture). */
  recolorCluster(c: Cluster, side?: HandSide): void {
    c.tintIdx = (c.tintIdx + 1) % TINTS.length;
    c.tintFrom.copy(c.tintTo);
    c.tintTo.set(TINTS[c.tintIdx]);
    c.tintMix = 0;
    this.onEvent("tint", c.pos, side);
  }

  /** Force push: cone impulse away from an open palm. */
  forcePush(from: THREE.Vector3, dir: THREE.Vector3, side?: HandSide): number {
    let hits = 0;
    for (const c of this.clusters) {
      if (c.dying) continue;
      this.sv1.copy(c.pos).sub(from);
      const d = this.sv1.length();
      if (d > PUSH_RANGE || d < 1e-4) continue;
      this.sv1.multiplyScalar(1 / d);
      const facing = this.sv1.dot(dir);
      if (facing < PUSH_CONE) continue;
      const power = (1 - d / PUSH_RANGE) * 2.6 + 0.35;
      c.vel.addScaledVector(dir, power * 0.75);
      c.vel.addScaledVector(this.sv1, power * 0.35);
      c.angVel.x += (Math.random() - 0.5) * 1.2;
      c.angVel.y += (Math.random() - 0.5) * 1.2;
      if (c.vel.length() > MAX_VEL) c.vel.setLength(MAX_VEL);
      if (c.angVel.length() > MAX_ANG) c.angVel.setLength(MAX_ANG);
      hits++;
    }
    this.onEvent("push", from, side);
    return hits;
  }

  /** Force pull: summon the nearest in-cone cluster toward the palm. */
  forcePullNearest(
    from: THREE.Vector3,
    dir: THREE.Vector3,
    target: THREE.Vector3,
    side?: HandSide
  ): Cluster | null {
    let best: Cluster | null = null;
    let bestScore = -1;
    for (const c of this.clusters) {
      if (c.dying || c.summon) continue;
      this.sv1.copy(c.pos).sub(from);
      const d = this.sv1.length();
      if (d > PULL_RANGE || d < 0.25) continue;
      this.sv1.multiplyScalar(1 / d);
      const facing = this.sv1.dot(dir);
      if (facing < 0.55) continue;
      const score = facing * 2 - d / PULL_RANGE;
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    if (!best) return null;
    best.summon = { target: target.clone(), until: performance.now() + PULL_MS, side: side ?? "right" };
    best.stabT = 0;
    this.onEvent("pull", best.pos, side);
    return best;
  }

  /** Point & flick telekinesis: impulse at the ray-hit point. */
  flick(c: Cluster, tipVel: THREE.Vector3, hit: THREE.Vector3, side?: HandSide): void {
    const speed = tipVel.length();
    if (speed < 1e-4) return;
    this.sv1.copy(tipVel).multiplyScalar(1 / speed);
    const power = 1.15 * Math.min(1.4, speed / FLICK_SPEED);
    c.vel.addScaledVector(this.sv1, power);
    this.sv2.copy(hit).sub(c.pos);
    this.sv3.crossVectors(this.sv2, this.sv1).multiplyScalar(2.2);
    c.angVel.add(this.sv3);
    if (c.vel.length() > MAX_VEL) c.vel.setLength(MAX_VEL);
    if (c.angVel.length() > MAX_ANG) c.angVel.setLength(MAX_ANG);
    c.summon = null;
    this.onEvent("flick", hit, side);
  }

  /** Stabilize: calm a cluster to a dead stop. */
  stabilize(c: Cluster, side?: HandSide): void {
    c.vel.multiplyScalar(0.04);
    c.angVel.multiplyScalar(0.03);
    c.summon = null;
    c.stabCdUntil = performance.now() + STAB_COOLDOWN * 1000;
    this.onEvent("stab", c.pos, side);
  }

  /**
   * Best face-pair snap candidate for `part` against every other cluster.
   * Also writes snap-proximity glow onto near target parts.
   */
  snapSearch(part: Part, tight: boolean): SnapCandidate | null {
    const mShape = SHAPE_BY_ID.get(part.type)!;
    if (mShape.faces.length === 0) return null;
    if (part.cluster.dying) return null;
    // a freshly ripped part must fly clear before it can snap again
    if (performance.now() < part.snapCooldownUntil) return null;
    const mc = part.cluster;
    // moving part world transform
    const mp = this.sv1;
    const mq = this.sq1;
    this.partWorld(part, mp, mq);
    let best: SnapCandidate | null = null;
    const maxLat = tight ? SNAP_TIGHT_LAT : SNAP_LAT;
    const maxAlong = tight ? SNAP_TIGHT_ALONG : SNAP_ALONG;
    let bestScore = maxLat * 2 + maxAlong;
    for (const tc of this.clusters) {
      if (tc === mc) continue;
      if (tc.dying) continue;
      for (const t of tc.parts) {
        const tShape = SHAPE_BY_ID.get(t.type)!;
        if (tShape.faces.length === 0) continue;
        const tp = this.sv2;
        const tq = this.sq2;
        this.partWorld(t, tp, tq);
        for (const tf of tShape.faces) {
          // target face world centre + normal (sv3/sv4 persist over mf loop)
          const tfc = this.sv3.copy(tf.c).multiplyScalar(tc.scale).applyQuaternion(tq).add(tp);
          const tfn = this.sv4.copy(tf.n).applyQuaternion(tq);
          for (const mf of mShape.faces) {
            const mfc = this.sv5.copy(mf.c).multiplyScalar(mc.scale).applyQuaternion(mq).add(mp);
            const mfn = this.sv6.copy(mf.n).applyQuaternion(mq);
            const dot = mfn.dot(tfn);
            if (dot > SNAP_DOT) continue;
            const d = this.sv7.copy(mfc).sub(tfc);
            const along = d.dot(tfn);
            const latSq = Math.max(0, d.lengthSq() - along * along);
            const lat = Math.sqrt(latSq);
            // proximity glow even when not accepted
            if (dot < -0.6 && Math.abs(along) < 0.09 && lat < 0.07) {
              const prox = 1 - lat / 0.07;
              if (prox > t.glowTarget) t.glowTarget = prox;
            }
            if (Math.abs(along) > maxAlong || lat > maxLat) continue;
            const score = lat * 2.2 + Math.abs(along) + (1 + dot) * 0.35;
            if (score < bestScore) {
              best = { moving: part, target: t, mf, tf, score, lat, along };
              bestScore = score;
            }
          }
        }
      }
    }
    return best;
  }

  /** Execute a snap: rotate/translate the moving cluster flush onto the
   *  target face, then merge the two clusters into one rigid body. */
  doSnap(cand: SnapCandidate, side: HandSide | null): boolean {
    const m = cand.moving;
    const t = cand.target;
    const mc = m.cluster;
    const tc = t.cluster;
    if (mc === tc) return false;
    const mShape = SHAPE_BY_ID.get(m.type)!;
    // world transforms
    const mp = this.sv1.clone();
    const mq = this.sq1.clone();
    this.partWorld(m, mp, mq);
    const tp = this.sv2.clone();
    const tq = this.sq2.clone();
    this.partWorld(t, tp, tq);
    // target face world
    const tfc = this.sv3.copy(cand.tf.c).multiplyScalar(tc.scale).applyQuaternion(tq).add(tp);
    const tfn = this.sv4.copy(cand.tf.n).applyQuaternion(tq);
    // align: rotate m so mf.n → -tfn
    const mfn = this.sv5.copy(cand.mf.n).applyQuaternion(mq);
    const wantN = this.sv6.copy(tfn).negate();
    const qAlign = this.sq3.setFromUnitVectors(mfn, wantN);
    let bestQ = qAlign.clone().multiply(mq); // qAlign * mq
    // twist: try 4 quarter-turns around the target normal
    if (mShape.twist) {
      let bestErr = Infinity;
      for (let k = 0; k < 4; k++) {
        const qk = this.sq4
          .setFromAxisAngle(tfn, (k * Math.PI) / 2)
          .clone()
          .multiply(bestQ);
        const err = this.twistErr(qk, tq, tfn);
        if (err < bestErr) {
          bestErr = err;
          bestQ = qk.clone();
        }
      }
    }
    // desired m world position: face centres coincide, flush
    const mPos = this.sv7
      .copy(tfc)
      .sub(this.sv8.copy(cand.mf.c).multiplyScalar(mc.scale).applyQuaternion(bestQ));
    // whole-cluster transform: rotate around pivot tfc by R = bestQ * mq⁻¹
    const R = bestQ.clone().multiply(mq.clone().invert());
    const delta = this.sv8
      .copy(mPos)
      .sub(tfc)
      .sub(this.sv5.copy(mp).sub(tfc).applyQuaternion(R));
    // tc-frame inverse rotation (persist)
    const invTQ = tq.clone().invert();
    const oldMass = tc.mass;
    const movMass = mc.mass;
    for (const p of mc.parts) {
      const pPos = this.sv5.clone();
      const pQuat = this.sq3.clone();
      this.partWorld(p, pPos, pQuat);
      // old world pose in tc frame (settle "from")
      const fromOff = pPos.clone().sub(tp).applyQuaternion(invTQ).divideScalar(tc.scale);
      const fromOffQ = invTQ.clone().multiply(pQuat);
      // new world pose: rotate around pivot + delta
      const newPos = this.sv6.copy(pPos).sub(tfc).applyQuaternion(R).add(tfc).add(delta);
      const newQuat = R.clone().multiply(pQuat);
      p.off.copy(newPos).sub(tp).applyQuaternion(invTQ).divideScalar(tc.scale);
      p.offQ.copy(invTQ).multiply(newQuat);
      p.cluster = tc;
      p.settle = { fromOff, fromOffQ, t: SETTLE_MS };
    }
    const movParts = mc.parts.slice();
    mc.parts.length = 0;
    tc.parts.push(...movParts);
    tc.mass = tc.parts.length;
    // conserve momentum (weighted), damped
    const wT = oldMass / (oldMass + movMass);
    const wM = movMass / (oldMass + movMass);
    tc.vel.multiplyScalar(wT).addScaledVector(mc.vel, wM).multiplyScalar(0.7);
    tc.angVel.multiplyScalar(wT).addScaledVector(mc.angVel, wM).multiplyScalar(0.5);
    tc.settleT = SETTLE_MS / 1000;
    const k = this.clusters.indexOf(mc);
    if (k >= 0) this.clusters.splice(k, 1);
    this.onEvent("snap", tfc, side ?? undefined);
    return true;
  }

  /** Angle error (rad) between the moving part's local X/Z axes and the
   *  target's, projected onto the face plane — for twist selection. */
  private twistErr(qk: THREE.Quaternion, tq: THREE.Quaternion, tfn: THREE.Vector3): number {
    const axX = this.sv5.set(1, 0, 0).applyQuaternion(qk);
    const axZ = this.sv6.set(0, 0, 1).applyQuaternion(qk);
    const tx = this.sv7.set(1, 0, 0).applyQuaternion(tq);
    const tz = this.sv8.set(0, 0, 1).applyQuaternion(tq);
    // project onto the face plane
    const proj = (v: THREE.Vector3, out: THREE.Vector3) => {
      out.copy(v).addScaledVector(tfn, -v.dot(tfn));
      const l = out.length();
      if (l < 1e-6) out.set(0, 0, 0);
      else out.multiplyScalar(1 / l);
      return out;
    };
    // scratch reuse inside: use two temp vectors carefully (sv5/sv6 hold axX/axZ!)
    // → use fresh locals instead (called 4× per snap — negligible cost)
    const px = new THREE.Vector3();
    const pz = new THREE.Vector3();
    const qx = new THREE.Vector3();
    const qz = new THREE.Vector3();
    proj(axX, px);
    proj(axZ, pz);
    proj(tx, qx);
    proj(tz, qz);
    const minAng = (a: THREE.Vector3) => {
      let m = Math.PI;
      for (const b of [qx, qx.clone().negate(), qz, qz.clone().negate()]) {
        const d = Math.acos(Math.max(-1, Math.min(1, a.dot(b))));
        if (d < m) m = d;
      }
      return m;
    };
    return minAng(px) + minAng(pz);
  }

  /** A hand/controller sphere pushes holograms around (graze / slap). */
  pushSphere(
    pos: THREE.Vector3,
    vel: THREE.Vector3,
    radius: number,
    skipPart: Part | null,
    softSkip: Part | null = null
  ): void {
    for (const c of this.clusters) {
      if (skipPart && c === skipPart.cluster) continue;
      if (softSkip && c === softSkip.cluster) continue;
      if (c.dying) continue;
      for (const p of c.parts) {
        this.partWorld(p, this.sv1, this.sq1);
        const bound = SHAPE_BY_ID.get(p.type)!.bound * c.scale;
        this.sv2.copy(this.sv1).sub(pos);
        const d = this.sv2.length();
        const rr = radius + bound * 0.85;
        if (d >= rr || d < 1e-6) continue;
        this.sv2.multiplyScalar(1 / d); // push normal
        const overlap = rr - d;
        // positional correction moves the whole cluster (rigid), clamped
        // so a deep overlap can never catapult a part
        const corr = Math.min(overlap * 0.5, 0.02);
        c.pos.addScaledVector(this.sv2, corr);
        // impulse relative to collider motion
        this.sv3.copy(this.sv1).sub(c.pos);
        this.sv4.copy(c.angVel).cross(this.sv3).add(c.vel); // point velocity
        this.sv4.sub(vel); // relative
        const vn = this.sv4.dot(this.sv2);
        if (vn < 0) c.vel.addScaledVector(this.sv2, -vn * 1.35);
        c.vel.addScaledVector(vel, 0.22);
        // a little spin from off-centre contact
        this.sv3.copy(this.sv1).sub(c.pos).cross(this.sv2).multiplyScalar(0.05);
        c.angVel.add(this.sv3);
        if (c.angVel.length() > MAX_ANG) c.angVel.setLength(MAX_ANG);
        if (c.vel.length() > MAX_VEL) c.vel.setLength(MAX_VEL);
      }
    }
  }

  /** Spin/tumble the nearest cluster to `point` around `axis`. */
  rotateNearest(
    point: THREE.Vector3,
    axis: THREE.Vector3,
    impulse: number,
    maxDist = 0.85,
    side?: HandSide,
    kind: "spin" | "tumble" = "spin"
  ): boolean {
    let best: Cluster | null = null;
    let bestD = maxDist;
    for (const c of this.clusters) {
      if (c.dying) continue;
      const d = c.pos.distanceTo(point);
      if (d < bestD) {
        best = c;
        bestD = d;
      }
    }
    if (!best) return false;
    best.angVel.addScaledVector(axis, impulse);
    best.angVel.x += (Math.random() - 0.5) * 0.5;
    best.angVel.z += (Math.random() - 0.5) * 0.5;
    if (best.angVel.length() > MAX_ANG) best.angVel.setLength(MAX_ANG);
    this.onEvent(kind, best.pos, side);
    return true;
  }

  /** Semi-implicit Euler step for every cluster (zero gravity). */
  integrate(dt: number, headPos: THREE.Vector3): void {
    const linK = Math.exp(-LIN_DAMP * dt);
    const angK = Math.exp(-ANG_DAMP * dt);
    const nowMs = performance.now();
    const dead: Cluster[] = [];
    for (const c of this.clusters) {
      // tint sweep (shake-to-recolor)
      if (c.tintMix < 1) c.tintMix = Math.min(1, c.tintMix + dt * 4);
      if (c.dying) {
        c.dying.t -= dt;
        if (c.dying.thrown && Math.random() < dt * 30) {
          this.particles.burst(c.pos, 1, 0.1, 0.0022);
        }
        if (c.dying.t <= 0) {
          dead.push(c);
          continue;
        }
      } else if (c.summon) {
        if (nowMs > c.summon.until) {
          c.summon = null;
        } else {
          // velocity steering: glide to the palm hover point, no overshoot
          this.sv1.copy(c.summon.target).sub(c.pos);
          const d = this.sv1.length();
          if (d > 1e-4) this.sv1.multiplyScalar(1 / d);
          const want = Math.min(d * 3.5, 3.0);
          this.sv2.copy(this.sv1).multiplyScalar(want);
          c.vel.lerp(this.sv2, 1 - Math.exp(-9 * dt));
          c.angVel.multiplyScalar(Math.exp(-5 * dt));
        }
      }
      c.vel.multiplyScalar(linK);
      c.angVel.multiplyScalar(angK);
      // soft keep-in-play spring toward the user
      this.sv1.copy(c.pos).sub(headPos);
      const L = this.sv1.length();
      if (L > KEEP_RADIUS && L > 1e-6) {
        this.sv1.multiplyScalar(1 / L);
        c.vel.addScaledVector(this.sv1, -(L - (KEEP_RADIUS - 0.3)) * KEEP_PULL * dt);
      }
      if (c.settleT > 0) {
        c.settleT -= dt;
        c.vel.multiplyScalar(0.55);
        c.angVel.multiplyScalar(0.3);
      }
      if (c.vel.length() > MAX_VEL) c.vel.setLength(MAX_VEL);
      if (c.angVel.length() > MAX_ANG) c.angVel.setLength(MAX_ANG);
      c.pos.addScaledVector(c.vel, dt);
      const w = c.angVel.length();
      if (w > 1e-5) {
        this.sv1.copy(c.angVel).multiplyScalar(1 / w);
        this.sq1.setFromAxisAngle(this.sv1, w * dt);
        c.quat.premultiply(this.sq1).normalize();
      }
    }
    // fully dissolved clusters leave the world
    if (dead.length) {
      for (const c of dead) {
        for (const p of c.parts.slice()) this.disposePart(p);
        const k = this.clusters.indexOf(c);
        if (k >= 0) this.clusters.splice(k, 1);
      }
      this.onCount(this.parts.length);
    }
  }

  /** Push render transforms + material glow from physics state. */
  syncRender(nowMs: number, dt: number): void {
    for (const p of this.parts) {
      const c = p.cluster;
      if (p.settle) {
        p.settle.t -= dt * 1000;
        const k = 1 - Math.max(0, p.settle.t) / SETTLE_MS;
        if (k >= 1) {
          p.settle = null;
          p.rOff.copy(p.off);
          p.rOffQ.copy(p.offQ);
        } else {
          const e = 1 - Math.pow(1 - k, 3);
          p.rOff.lerpVectors(p.settle.fromOff, p.off, e);
          p.rOffQ.copy(p.settle.fromOffQ).slerp(p.offQ, e);
        }
      } else {
        p.rOff.copy(p.off);
        p.rOffQ.copy(p.offQ);
      }
      p.group.position.copy(p.rOff).multiplyScalar(c.scale).applyQuaternion(c.quat).add(c.pos);
      p.group.quaternion.copy(c.quat).multiply(p.rOffQ);
      // spawn pop
      const age = (nowMs - p.born) / 180;
      const sc = age < 1 ? Math.max(0.001, easeOutBack(age)) : 1;
      // held pulse
      const pulse = p.held ? 1 + 0.02 * Math.sin(nowMs * 0.008 + p.id) : 1;
      let visScale = sc * pulse * c.scale;
      if (c.dying) {
        const k = Math.max(0.001, c.dying.t / c.dying.dur);
        visScale *= c.dying.thrown ? Math.min(1, k * 2.2) : Math.pow(k, 0.8);
      }
      p.group.scale.setScalar(visScale);
      // tint sweep
      tmpColor.copy(c.tintFrom).lerp(c.tintTo, c.tintMix);
      p.fill.color.copy(tmpColor);
      p.fill.emissive.copy(tmpColor);
      p.wire.color.copy(tmpColor);
      // glow
      const target = p.held ? 1 : p.glowTarget;
      const rate = target > p.glow ? 18 : 6;
      p.glow += (target - p.glow) * Math.min(1, dt * rate);
      p.wire.opacity = Math.min(1, 0.55 + 0.45 * p.glow);
      p.fill.opacity = 0.14 + 0.12 * p.glow;
      p.fill.emissiveIntensity = 0.3 + 0.55 * p.glow;
      p.glowTarget = 0; // recomputed next frame by callers
    }
    this.particles.update(dt);
  }

  dispose(): void {
    this.clear();
    this.root.removeFromParent();
    this.particles.dispose();
  }
}

/* ------------------------------------------------------------------ */
/* Session requester (inside the Canvas — needs the WebGL renderer)     */
/* ------------------------------------------------------------------ */

/** Module-level single-flight cache: survives React strict-mode double
 *  mounts and hands the same session to a remounted requester. */
let mrSessionCache: MrSessionInfo | null = null;

function SessionRequester({
  onReady,
  onFailed,
}: {
  onReady: (info: MrSessionInfo) => void;
  onFailed: (reason: string) => void;
}) {
  const gl = useThree((s) => s.gl);

  useEffect(() => {
    let alive = true;
    (async () => {
      let session: XRSession | null = null;
      try {
        if (mrSessionCache) {
          onReady(mrSessionCache);
          return;
        }
        mrBridge.firstFrameAt = 0;
        mrBridge.diag.frame = 0;
        mrBridge.diag.frameAt = 0;
        mrBridge.diag.fps = 0;
        mrBridge.diag.inputs = "";
        mrBridge.diag.joints = { left: 0, right: 0 };
        mrBridge.diag.events = { select: 0, squeeze: 0, pinch: 0, sources: 0 };
        mrBridge.diag.firstEventAt = 0;
        mrBridge.diag.lastError = null;
        mrBridge.diag.stallAt = 0;
        frameErrorRing.length = 0;
        session = await requestMrSession();
        // Quest 3 fix: three r185 prefers an XRProjectionLayer whenever
        // XRWebGLBinding exists — on Meta Quest Browser that path can throw
        // or present nothing. Pin three to the classic XRWebGLLayer path.
        const restoreLayers = forceBaseLayerPath();
        try {
          gl.xr.enabled = true;
          await gl.xr.setSession(session);
        } finally {
          restoreLayers();
        }
        // IMMORTAL XR LOOP: wrap gl.render so a render-time throw is
        // recorded instead of killing the loop forever.
        guardRenderer(gl);
        const info: MrSessionInfo = {
          session,
          domOverlay: sessionHasDomOverlay(session),
        };
        mrSessionCache = info;
        session.addEventListener(
          "end",
          () => {
            if (mrSessionCache?.session === session) mrSessionCache = null;
          },
          { once: true }
        );
        if (alive) onReady(info);
      } catch (err) {
        // Never leave the user trapped inside a passthrough session with a
        // DOM dialog they can't see: end the session so the browser returns
        // to the flat page, then report the failure where it's visible.
        if (session) {
          try {
            await session.end();
          } catch {
            /* already ended */
          }
        }
        const msg =
          err instanceof Error && err.message
            ? err.message
            : "The mixed-reality session couldn't start.";
        if (alive) onFailed(msg);
      }
    })();
    return () => {
      alive = false;
    };
  }, [gl, onFailed, onReady]);

  return null;
}

/* ------------------------------------------------------------------ */
/* Session lifecycle listeners (press latch + input events)             */
/* ------------------------------------------------------------------ */

function useSessionEvents(
  session: XRSession | null,
  onEnd: () => void,
  rt: Rt
) {
  useEffect(() => {
    if (!session) return;
    const end = () => onEnd();

    const sideOf = (src: XRInputSource | null): HandSide =>
      src?.handedness === "left" ? "left" : "right";

    // Press-latch: one live press per input source. A Quest hand pinch can
    // surface BOTH as a select event and (a frame later) as a joint-distance
    // pinch — the latch guarantees exactly one press begins, and that a
    // begin can never double-fire before its end arrives.
    const beginPress = (src: XRInputSource) => {
      const d = mrBridge.diag;
      if (!d.firstEventAt) d.firstEventAt = performance.now();
      if (rt.pressLatch.has(src)) return; // already pressed
      rt.pressLatch.add(src);
      if (src.hand) {
        // Hand: a select/squeeze gesture IS a pinch on Quest. Surface it as
        // the hand's selectActive pinch so grabbing still works when joint
        // poses are unreadable.
        const side = sideOf(src);
        const pc = rt.hands[side].pinch;
        pc.selectActive = true;
      } else {
        rt.pressQueue.push({ type: "begin", side: sideOf(src) });
      }
    };
    const endPress = (src: XRInputSource) => {
      if (!rt.pressLatch.has(src)) return;
      rt.pressLatch.delete(src);
      if (src.hand) {
        const side = sideOf(src);
        rt.hands[side].pinch.selectActive = false;
      } else {
        rt.pressQueue.push({ type: "end", side: sideOf(src) });
      }
    };

    const onSelectStart = (e: XRInputSourceEvent) => {
      mrBridge.diag.events.select++;
      beginPress(e.inputSource);
    };
    const onSelectEnd = (e: XRInputSourceEvent) => {
      endPress(e.inputSource);
    };
    // Some runtimes deliver only the transient 'select' — treat it as a
    // begin if no begin is latched (the end still arrives via selectend).
    const onSelect = (e: XRInputSourceEvent) => {
      mrBridge.diag.events.select++;
      beginPress(e.inputSource);
    };
    const onSqueezeStart = (e: XRInputSourceEvent) => {
      mrBridge.diag.events.squeeze++;
      beginPress(e.inputSource);
    };
    const onSqueezeEnd = (e: XRInputSourceEvent) => {
      endPress(e.inputSource);
    };
    const onSourcesChange = (e?: XRInputSourcesChangeEvent) => {
      mrBridge.diag.events.sources++;
      // a source that vanished mid-press must release its latch
      for (const src of e?.removed ?? []) {
        if (!rt.pressLatch.has(src)) continue;
        rt.pressLatch.delete(src);
        if (src.hand) {
          rt.hands[sideOf(src)].pinch.selectActive = false;
        } else {
          rt.pressQueue.push({ type: "end", side: sideOf(src) });
        }
      }
      // refresh the side→source map (haptics)
      rt.sources.left = null;
      rt.sources.right = null;
      const parts: string[] = [];
      for (const s of session.inputSources) {
        if (s.handedness === "left") rt.sources.left = s;
        else if (s.handedness === "right") rt.sources.right = s;
        parts.push(
          `${s.handedness === "left" ? "L" : s.handedness === "right" ? "R" : "?"}:${s.hand ? "hand" : (s.targetRayMode ?? "?")}`
        );
      }
      mrBridge.diag.inputs = parts.join(" ");
    };

    session.addEventListener("end", end);
    session.addEventListener("selectstart", onSelectStart);
    session.addEventListener("selectend", onSelectEnd);
    session.addEventListener("select", onSelect);
    session.addEventListener("squeezestart", onSqueezeStart);
    session.addEventListener("squeezeend", onSqueezeEnd);
    session.addEventListener("inputsourceschange", onSourcesChange);
    onSourcesChange(); // baseline snapshot
    return () => {
      session.removeEventListener("end", end);
      session.removeEventListener("selectstart", onSelectStart);
      session.removeEventListener("selectend", onSelectEnd);
      session.removeEventListener("select", onSelect);
      session.removeEventListener("squeezestart", onSqueezeStart);
      session.removeEventListener("squeezeend", onSqueezeEnd);
      session.removeEventListener("inputsourceschange", onSourcesChange);
    };
  }, [session, onEnd, rt]);
}

/* ------------------------------------------------------------------ */
/* Shared visual assets (module-level, page-lifetime)                   */
/* ------------------------------------------------------------------ */

const dotsGeo = new THREE.SphereGeometry(0.0048, 8, 6);
const dotsMat = new THREE.MeshBasicMaterial({
  color: MR_SKY,
  transparent: true,
  opacity: 0.55,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});
const ringGeo = new THREE.TorusGeometry(0.016, 0.0016, 8, 24);

/* ------------------------------------------------------------------ */
/* MrWorld — the iron man sandbox                                        */
/* ------------------------------------------------------------------ */

function MrWorld({
  mode,
  sessionInfo,
  events,
  previewInput,
  onSessionEnd,
}: {
  mode: "xr" | "preview";
  sessionInfo: MrSessionInfo | null;
  events: MrSceneEvents;
  previewInput: React.RefObject<PreviewInput>;
  onSessionEnd: () => void;
}) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const eventsRef = useRef(events);
  eventsRef.current = events;

  const rtRef = useRef<Rt | null>(null);
  if (!rtRef.current) rtRef.current = makeRt();
  const rt = rtRef.current;

  const session = sessionInfo?.session ?? null;

  const dotsRef = useRef<THREE.InstancedMesh | null>(null);
  const ringLRef = useRef<THREE.Mesh | null>(null);
  const ringRRef = useRef<THREE.Mesh | null>(null);
  const ringMouseRef = useRef<THREE.Mesh | null>(null);
  const pointLineRef = useRef<THREE.Line | null>(null);
  const stabRingRef = useRef<THREE.Mesh | null>(null);
  const ringFxRef = useRef<RingFx | null>(null);

  useSessionEvents(session, mode === "xr" ? onSessionEnd : () => undefined, rt);

  /* ---- scratch objects (allocation-free loop) ---- */
  const tmp = useMemo(
    () => ({
      v1: new THREE.Vector3(),
      v2: new THREE.Vector3(),
      v3: new THREE.Vector3(),
      v4: new THREE.Vector3(),
      v5: new THREE.Vector3(),
      v6: new THREE.Vector3(),
      q1: new THREE.Quaternion(),
      m4: new THREE.Matrix4(),
      up: new THREE.Vector3(0, 1, 0),
      camRight: new THREE.Vector3(),
      camFwd: new THREE.Vector3(),
      ray: new THREE.Raycaster(),
      dotDummy: new THREE.Object3D(),
      slotWorld: new THREE.Vector3(),
      exitWorld: new THREE.Vector3(),
      grabA: new THREE.Vector3(),
      instant: new THREE.Vector3(),
    }),
    []
  );

  const getCameraPose = useCallback(
    (frame?: XRFrame | null, refSpace?: XRReferenceSpace | null) => {
      let done = false;
      if (mode === "xr" && gl.xr.isPresenting && frame && refSpace) {
        // The viewer pose is the authoritative, THIS-frame camera transform.
        try {
          const vp = frame.getViewerPose?.(refSpace);
          if (vp) {
            const p = vp.transform.position;
            const o = vp.transform.orientation;
            tmp.v1.set(p.x, p.y, p.z);
            tmp.q1.set(o.x, o.y, o.z, o.w);
            done = true;
          }
        } catch {
          /* fall through to the XR camera matrix */
        }
        if (!done) {
          const xrCam = gl.xr.getCamera();
          tmp.v1.setFromMatrixPosition(xrCam.matrixWorld);
          tmp.q1.setFromRotationMatrix(xrCam.matrixWorld);
          done = true;
        }
      }
      if (!done) {
        tmp.v1.setFromMatrixPosition(camera.matrixWorld);
        tmp.q1.setFromRotationMatrix(camera.matrixWorld);
      }
      rt.camPos.copy(tmp.v1);
      rt.camQuat.copy(tmp.q1);
    },
    [camera, gl, mode, rt, tmp]
  );

  /** Ray → sphere: entry distance t, or -1 when the ray misses. */
  const raySphereDist = useCallback(
    (o: THREE.Vector3, d: THREE.Vector3, c: THREE.Vector3, r: number): number => {
      tmp.v6.copy(c).sub(o);
      const tca = tmp.v6.dot(d);
      if (tca < 0) return -1;
      const d2 = tmp.v6.lengthSq() - tca * tca;
      const r2 = r * r;
      if (d2 > r2) return -1;
      return tca - Math.sqrt(Math.max(0, r2 - d2));
    },
    [tmp]
  );

  /** Track a collider sphere's velocity from its positions. */
  const updateCollider = useCallback(
    (
      col: { pos: THREE.Vector3; prev: THREE.Vector3; vel: THREE.Vector3; seen: boolean },
      pos: THREE.Vector3 | null,
      dt: number
    ) => {
      if (!pos) {
        col.seen = false;
        col.vel.set(0, 0, 0);
        return;
      }
      if (!col.seen) {
        col.pos.copy(pos);
        col.prev.copy(pos);
        col.vel.set(0, 0, 0);
        col.seen = true;
        return;
      }
      col.prev.copy(col.pos);
      col.pos.copy(pos);
      if (dt > 1e-4) {
        tmp.instant.copy(col.pos).sub(col.prev).multiplyScalar(1 / dt);
        if (tmp.instant.length() > 5) tmp.instant.setLength(5);
        col.vel.lerp(tmp.instant, 0.6);
      }
    },
    [tmp]
  );

  /* ---- grab / release ---- */

  const releaseHold = useCallback(
    (side: HandSide, opts?: { silent?: boolean; cooldown?: number; noImpulse?: boolean }) => {
      const hold = rt.holds[side];
      hold.exit = false;
      const part = hold.part;
      if (!part) return;
      hold.part = null;
      hold.anchorSeen = false;
      hold.cooldownUntil = performance.now() + (opts?.cooldown ?? 120);
      // the releasing hand's colliders must not shove the part it just
      // let go of (the pinch point sits inside it) — grace period long
      // enough for natural finger retraction
      hold.recent = part;
      hold.recentUntil = performance.now() + 900;
      const sandbox = rt.sandbox;
      if (!sandbox) return;
      part.held = false;
      // a snap engage lets go with ZERO impulse — the part clicked home
      if (opts?.noImpulse) return;
      // hard throw: the build sails off in a spark trail and dissolves
      const yeet = hold.anchorVel.length() > YEET_SPEED;
      // drop-near-face: a tight candidate snaps immediately on release
      const cand = sandbox.snapSearch(part, true);
      if (cand && !yeet) {
        sandbox.doSnap(cand, side);
      } else {
        sandbox.release(part, hold.anchorVel, side);
        if (yeet) sandbox.killCluster(part.cluster, true);
      }
    },
    [rt]
  );

  const attemptGrab = useCallback(
    (side: HandSide, point: THREE.Vector3, grabMode: Hold["mode"]) => {
      const sandbox = rt.sandbox;
      if (!sandbox) return;
      const hold = rt.holds[side];
      if (hold.part || performance.now() < hold.cooldownUntil) {
        rt.grabTrace = `blocked:${hold.part ? "holding" : "cooldown"}`;
        return;
      }
      mrAudio.ensure();
      const pal = rt.palette;
      if (pal.opacity > 0.6) {
        // EXIT button first (deliberate small target)
        tmp.exitWorld
          .copy(EXIT_POS)
          .multiplyScalar(pal.scale)
          .applyQuaternion(pal.quat)
          .add(pal.pos);
        if (point.distanceTo(tmp.exitWorld) < 0.032) {
          rt.grabTrace = "exit";
          hold.exit = true;
          pal.exitSide = side;
          return;
        }
        // shape slots
        let slot = -1;
        let bestD = SLOT_GRAB_R;
        for (let i = 0; i < SLOT_LOCAL.length; i++) {
          tmp.slotWorld
            .copy(SLOT_LOCAL[i])
            .multiplyScalar(pal.scale)
            .applyQuaternion(pal.quat)
            .add(pal.pos);
          const d = point.distanceTo(tmp.slotWorld);
          if (d < bestD) {
            bestD = d;
            slot = i;
          }
        }
        if (slot >= 0) {
          rt.grabTrace = `slot:${slot}`;
          tmp.slotWorld
            .copy(SLOT_LOCAL[slot])
            .multiplyScalar(pal.scale)
            .applyQuaternion(pal.quat)
            .add(pal.pos);
          const part = sandbox.spawn(SHAPES[slot].id, tmp.slotWorld, pal.quat, side);
          if (part) {
            pal.slotPulse[slot] = 1;
            hold.part = part;
            hold.mode = grabMode;
            hold.anchorSeen = false;
            hapticPulse(rt.sources[side], 0.6, 90);
          }
          return;
        }
      }
      // floating holograms
      const radius =
        grabMode === "fist" ? GRAB_R_FIST : grabMode === "controller" ? GRAB_R_CTRL : GRAB_R_PINCH;
      const part = sandbox.tryGrab(point, radius);
      if (part) {
        rt.grabTrace = `part:${part.id}:${grabMode}`;
        hold.part = part;
        hold.mode = grabMode;
        hold.anchorSeen = false;
        part.cluster.summon = null; // caught a summoned build
        part.cluster.stabT = 0;
        mrAudio.grab();
        hapticPulse(rt.sources[side], 0.45, 50);
        sandbox.partWorld(part, tmp.v1, tmp.q1);
        sandbox.particles.burst(tmp.v1, 3, 0.25);
      } else {
        let where = "none";
        if (sandbox.parts.length > 0) {
          sandbox.partWorld(sandbox.parts[0], tmp.v1, tmp.q1);
          where = `n=${sandbox.parts.length}@${tmp.v1.x.toFixed(2)},${tmp.v1.y.toFixed(2)},${tmp.v1.z.toFixed(2)}`;
        }
        rt.grabTrace = `miss:${grabMode}@${point.x.toFixed(2)},${point.y.toFixed(2)},${point.z.toFixed(2)}|${where}`;
      }
    },
    [rt, tmp]
  );

  /** Preview (mouse) grab: ray-picking against palette + parts. */
  const previewAttemptGrab = useCallback(() => {
    const sandbox = rt.sandbox;
    const pi = previewInput.current;
    if (!sandbox || !pi || !pi.has) return;
    mrAudio.ensure();
    tmp.ray.setFromCamera(pi.ndc, camera);
    const ro = tmp.ray.ray.origin;
    const rd = tmp.ray.ray.direction;
    const pal = rt.palette;
    if (pal.opacity > 0.6) {
      tmp.exitWorld
        .copy(EXIT_POS)
        .multiplyScalar(pal.scale)
        .applyQuaternion(pal.quat)
        .add(pal.pos);
      if (raySphereDist(ro, rd, tmp.exitWorld, 0.02) >= 0) {
        rt.holds.right.exit = true;
        pal.exitSide = "right";
        return;
      }
      let slot = -1;
      let best = 0.024;
      for (let i = 0; i < SLOT_LOCAL.length; i++) {
        tmp.slotWorld
          .copy(SLOT_LOCAL[i])
          .multiplyScalar(pal.scale)
          .applyQuaternion(pal.quat)
          .add(pal.pos);
        const d = raySphereDist(ro, rd, tmp.slotWorld, 0.024);
        if (d >= 0 && d < best) {
          best = d;
          slot = i;
        }
      }
      if (slot >= 0) {
        tmp.slotWorld
          .copy(SLOT_LOCAL[slot])
          .multiplyScalar(pal.scale)
          .applyQuaternion(pal.quat)
          .add(pal.pos);
        const part = sandbox.spawn(SHAPES[slot].id, tmp.slotWorld, pal.quat, "right");
        if (part) {
          pal.slotPulse[slot] = 1;
          rt.holds.right.part = part;
          rt.holds.right.mode = "mouse";
          rt.holds.right.anchorSeen = false;
        }
        return;
      }
    }
    let bestPart: Part | null = null;
    let bestT = Infinity;
    for (const p of sandbox.parts) {
      if (p.cluster.dying) continue;
      sandbox.partWorld(p, tmp.v1, tmp.q1);
      const t = raySphereDist(ro, rd, tmp.v1, SHAPE_BY_ID.get(p.type)!.bound * p.cluster.scale + 0.012);
      if (t >= 0 && t < bestT) {
        bestT = t;
        bestPart = p;
      }
    }
    if (bestPart) {
      sandbox.partWorld(bestPart, tmp.v1, tmp.q1);
      sandbox.particles.burst(tmp.v1, 3, 0.25);
      rt.holds.right.part = bestPart;
      rt.holds.right.mode = "mouse";
      rt.holds.right.anchorSeen = false;
      mrAudio.grab();
    }
  }, [camera, previewInput, raySphereDist, rt, tmp]);

  /* ---- world setup (sandbox + palette), imperative ---- */

  useEffect(() => {
    const sandbox = new Sandbox(scene);
    sandbox.onEvent = (kind, at, side) => {
      const src = side ? rt.sources[side] : null;
      switch (kind) {
        case "spawn":
          mrAudio.spawn();
          sandbox.particles.burst(at, 10, 0.55);
          rt.last.spawn = performance.now();
          break;
        case "release":
          mrAudio.release();
          break;
        case "snap":
          mrAudio.snap();
          sandbox.particles.burst(at, 14, 0.8);
          hapticPulse(rt.sources.left, 0.55, 60);
          hapticPulse(rt.sources.right, 0.55, 60);
          rt.last.snap = performance.now();
          break;
        case "rip":
          mrAudio.rip();
          sandbox.particles.burst(at, 16, 1.2);
          if (src) hapticPulse(src, 0.85, 110);
          rt.last.rip = performance.now();
          break;
        case "spin":
          mrAudio.spin();
          sandbox.particles.burst(at, 6, 0.4);
          if (src) hapticPulse(src, 0.45, 60);
          rt.last.spin = performance.now();
          break;
        case "tumble":
          mrAudio.tumble();
          sandbox.particles.burst(at, 6, 0.4);
          if (src) hapticPulse(src, 0.45, 60);
          rt.last.tumble = performance.now();
          break;
        case "push":
          mrAudio.push();
          if (src) hapticPulse(src, 0.8, 140);
          rt.last.push = performance.now();
          break;
        case "pull":
          mrAudio.pull();
          if (src) hapticPulse(src, 0.5, 90);
          sandbox.particles.burst(at, 8, 0.5);
          ringFxRef.current?.spawn(at, rt.camQuat, 0.18, 0.04, 0.4, MR_SKY);
          rt.last.pull = performance.now();
          break;
        case "flick":
          mrAudio.flick();
          if (src) hapticPulse(src, 0.35, 50);
          sandbox.particles.burst(at, 5, 0.5, 0.0026);
          ringFxRef.current?.spawn(at, rt.camQuat, 0.02, 0.09, 0.22, MR_ICE);
          rt.last.flick = performance.now();
          break;
        case "clone":
          mrAudio.clone();
          hapticPulse(rt.sources.left, 0.5, 70);
          hapticPulse(rt.sources.right, 0.5, 70);
          sandbox.particles.burst(at, 12, 0.7);
          ringFxRef.current?.spawn(at, rt.camQuat, 0.03, 0.22, 0.35, MR_ICE);
          rt.last.clone = performance.now();
          break;
        case "crush":
          mrAudio.crush();
          hapticPulse(rt.sources.left, 0.9, 160);
          hapticPulse(rt.sources.right, 0.9, 160);
          sandbox.particles.burst(at, 26, 1.7);
          ringFxRef.current?.spawn(at, rt.camQuat, 0.24, 0.03, 0.3, MR_ICE);
          ringFxRef.current?.spawn(at, rt.camQuat, 0.16, 0.32, 0.34, MR_CYAN);
          rt.last.crush = performance.now();
          break;
        case "stab":
          mrAudio.stab();
          if (src) hapticPulse(src, 0.3, 60);
          ringFxRef.current?.spawn(at, rt.camQuat, 0.07, 0.2, 0.4, MR_SKY);
          rt.last.stab = performance.now();
          break;
        case "tint":
          mrAudio.tint();
          if (src) hapticPulse(src, 0.4, 60);
          ringFxRef.current?.spawn(at, rt.camQuat, 0.1, 0.26, 0.45, MR_SKY);
          rt.last.tint = performance.now();
          break;
        case "yeet":
          mrAudio.yeet();
          if (src) hapticPulse(src, 0.55, 90);
          rt.last.yeet = performance.now();
          break;
        case "full":
          mrAudio.blip(220, 180, 0.08, "square", 0.2);
          break;
      }
    };
    sandbox.onCount = (n) => eventsRef.current.onParts(n);
    rt.sandbox = sandbox;

    // ---- palette ----
    const group = new THREE.Group();
    const panelCanvas = document.createElement("canvas");
    panelCanvas.width = 512;
    panelCanvas.height = 400;
    drawPaletteTexture(panelCanvas, -1, rt.palette.slotPulse);
    const panelTex = new THREE.CanvasTexture(panelCanvas);
    panelTex.colorSpace = THREE.SRGBColorSpace;
    const panelMat = new THREE.MeshBasicMaterial({
      map: panelTex,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(PAL_W, PAL_H), panelMat);
    panel.renderOrder = 3;
    group.add(panel);

    const slots: PaletteRt["slots"] = [];
    SHAPES.forEach((shape) => {
      const g = new THREE.Group();
      g.position.copy(SLOT_LOCAL[slots.length]);
      const fill = new THREE.MeshStandardMaterial({
        color: HOLO_COLOR,
        emissive: HOLO_COLOR,
        emissiveIntensity: 0.35,
        transparent: true,
        opacity: 0.18,
        roughness: 0.35,
        metalness: 0.1,
        depthWrite: false,
      });
      const wire = new THREE.MeshBasicMaterial({
        color: HOLO_COLOR,
        transparent: true,
        opacity: 0.6,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const mini = new THREE.Mesh(shape.geo, fill);
      mini.scale.setScalar(shape.mini);
      const shell = new THREE.LineSegments(shape.wire, wire);
      shell.scale.setScalar(shape.mini * 1.004);
      g.add(mini, shell);
      group.add(g);
      slots.push({ group: g, fill, wire });
    });

    const exitCanvas = document.createElement("canvas");
    exitCanvas.width = 256;
    exitCanvas.height = 128;
    drawExitTexture(exitCanvas, 0);
    const exitTex = new THREE.CanvasTexture(exitCanvas);
    exitTex.colorSpace = THREE.SRGBColorSpace;
    const exitMat = new THREE.MeshBasicMaterial({
      map: exitTex,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const exitBtn = new THREE.Mesh(new THREE.PlaneGeometry(EXIT_W, EXIT_H), exitMat);
    exitBtn.position.copy(EXIT_POS);
    exitBtn.renderOrder = 3;
    group.add(exitBtn);
    group.visible = false;
    scene.add(group);

    // palm→panel strut
    const strutGeo = new THREE.BufferGeometry();
    strutGeo.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
    const strutMat = new THREE.LineBasicMaterial({
      color: MR_SKY,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const strut = new THREE.LineSegments(strutGeo, strutMat);
    strut.frustumCulled = false;
    strut.visible = false;
    scene.add(strut);

    const pal = rt.palette;
    pal.group = group;
    pal.panelMat = panelMat;
    pal.exitMat = exitMat;
    pal.strutMat = strutMat;
    pal.strutGeo = strutGeo;
    pal.panelCanvas = panelCanvas;
    pal.panelTex = panelTex;
    pal.exitCanvas = exitCanvas;
    pal.exitTex = exitTex;
    pal.slots = slots;
    const strutObj = strut;

    // ---- gesture-pack visuals: targeting ray, stabilize ring, fx rings ----
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, -1], 3));
    const lineMat = new THREE.LineBasicMaterial({
      color: MR_SKY,
      transparent: true,
      opacity: 0.45,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const pointLine = new THREE.Line(lineGeo, lineMat);
    pointLine.frustumCulled = false;
    pointLine.visible = false;
    pointLine.renderOrder = 4;
    scene.add(pointLine);
    pointLineRef.current = pointLine;

    const stabRing = new THREE.Mesh(
      new THREE.TorusGeometry(1, 0.02, 8, 40),
      new THREE.MeshBasicMaterial({
        color: MR_SKY,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );
    stabRing.visible = false;
    stabRing.frustumCulled = false;
    stabRing.renderOrder = 5;
    scene.add(stabRing);
    stabRingRef.current = stabRing;

    const ringFx = new RingFx(scene);
    ringFxRef.current = ringFx;

    return () => {
      sandbox.dispose();
      rt.sandbox = null;
      group.removeFromParent();
      panel.geometry.dispose();
      panelMat.dispose();
      panelTex.dispose();
      exitBtn.geometry.dispose();
      exitMat.dispose();
      exitTex.dispose();
      for (const s of slots) {
        s.fill.dispose();
        s.wire.dispose();
      }
      strutObj.removeFromParent();
      strutGeo.dispose();
      strutMat.dispose();
      pointLine.removeFromParent();
      lineGeo.dispose();
      lineMat.dispose();
      pointLineRef.current = null;
      stabRing.removeFromParent();
      stabRing.geometry.dispose();
      (stabRing.material as THREE.Material).dispose();
      stabRingRef.current = null;
      ringFx.dispose();
      ringFxRef.current = null;
      pal.group = null;
      pal.panelMat = null;
      pal.exitMat = null;
      pal.strutMat = null;
      pal.strutGeo = null;
      pal.panelCanvas = null;
      pal.panelTex = null;
      pal.exitCanvas = null;
      pal.exitTex = null;
      pal.slots = [];
    };
  }, [scene, rt]);

  /* ---- THE frame loop (immortal, sectioned) ---- */

  useFrame((state, delta) => {
    if (!rt.firstFrame) {
      rt.firstFrame = true;
      if (mode === "xr") mrBridge.firstFrameAt = performance.now();
    }
    // Heartbeat FIRST, outside every try: the DOM-side stall watchdog reads it.
    mrBridge.diag.frame++;
    mrBridge.diag.frameAt = performance.now();
    rt.fpsFrames++;
    if (mrBridge.diag.frameAt - rt.fpsAt > 500) {
      mrBridge.diag.fps = Math.round(
        (rt.fpsFrames * 1000) / (mrBridge.diag.frameAt - rt.fpsAt)
      );
      rt.fpsAt = mrBridge.diag.frameAt;
      rt.fpsFrames = 0;
    }
    const safe = (section: string, fn: () => void) => {
      try {
        fn();
      } catch (err) {
        recordFrameError(section, err);
      }
    };
    try {
      const dt = Math.min(0.05, Math.max(0.001, delta));
      const now = performance.now();
      rt.time = state.clock.elapsedTime;
      const frame = mode === "xr" ? gl.xr.getFrame() : null;
      const refSpace = mode === "xr" ? gl.xr.getReferenceSpace() : null;
      const sandbox = rt.sandbox;
      if (!sandbox) return;
      const sides: HandSide[] = ["left", "right"];
      safe("camera", () => getCameraPose(frame, refSpace));

      /* ---- preview virtual hand point ---- */
      if (mode === "preview") {
        safe("preview-input", () => {
          const pi = previewInput.current;
          if (pi && pi.has) {
            tmp.ray.setFromCamera(pi.ndc, camera);
            const ro = tmp.ray.ray.origin;
            const rd = tmp.ray.ray.direction;
            tmp.v1.set(0, 0, -1).applyQuaternion(rt.camQuat);
            tmp.v2.copy(PREVIEW_ANCHOR).sub(ro);
            const denom = rd.dot(tmp.v1);
            const t =
              Math.abs(denom) > 1e-5
                ? THREE.MathUtils.clamp(tmp.v2.dot(tmp.v1) / denom, 0.15, 3)
                : 0.7;
            tmp.v3.copy(ro).addScaledVector(rd, t);
            if (!rt.vPoint.seen) {
              rt.vPoint.pos.copy(tmp.v3);
              rt.vPoint.prev.copy(tmp.v3);
              rt.vPoint.vel.set(0, 0, 0);
              rt.vPoint.seen = true;
            } else {
              rt.vPoint.prev.copy(rt.vPoint.pos);
              rt.vPoint.pos.copy(tmp.v3);
              tmp.instant.copy(rt.vPoint.pos).sub(rt.vPoint.prev).multiplyScalar(1 / dt);
              if (tmp.instant.length() > 5) tmp.instant.setLength(5);
              rt.vPoint.vel.lerp(tmp.instant, 0.6);
            }
          } else {
            rt.vPoint.seen = false;
            rt.vPoint.vel.set(0, 0, 0);
          }
        });
      }

      /* ---- hands: joints → gestures + colliders ---- */
      if (frame && refSpace && session) {
        safe("hands", () => {
          handPools.left.count = 0;
          handPools.right.count = 0;
          rt.hands.left.seen = false;
          rt.hands.right.seen = false;
          rt.hands.left.joints = 0;
          rt.hands.right.joints = 0;
          for (const src of session.inputSources) {
            const hand = src.hand;
            if (!hand) continue;
            const side: HandSide = src.handedness === "left" ? "left" : "right";
            const pool = handPools[side];
            let thumb: THREE.Vector3 | null = null;
            let index: THREE.Vector3 | null = null;
            const entries: Array<[string, XRJointSpace]> = [];
            try {
              for (const [name, joint] of hand.entries()) entries.push([name, joint]);
            } catch {
              for (const joint of hand.values()) {
                entries.push([
                  (joint as XRJointSpace & { jointName?: string }).jointName ?? "",
                  joint,
                ]);
              }
            }
            for (const [name, joint] of entries) {
              let pose: XRJointPose | null = null;
              try {
                pose = frame.getJointPose?.(joint, refSpace) ?? null;
              } catch {
                pose = null;
              }
              if (!pose) continue;
              const p = pose.transform.position;
              const v = poolVec(pool.vecs, pool.count);
              v.set(p.x, p.y, p.z);
              pool.names[pool.count] = name;
              pool.count++;
              if (pool.count > 50) break;
              if (name === "thumb-tip") thumb = v;
              if (name === "index-finger-tip") index = v;
            }
            const h = rt.hands[side];
            mrBridge.diag.joints[side] = pool.count;
            h.joints = pool.count;
            h.seen = pool.count >= 5;
            if (h.seen) rt.palette.handsEver = true;

            // pinch (joint-distance, hysteresis)
            if (thumb && index) {
              const d = thumb.distanceTo(index);
              const pc = h.pinch;
              if (!pc.active && !pc.selectActive && d < PINCH_CLOSE) {
                pc.active = true;
                pc.point.copy(thumb).add(index).multiplyScalar(0.5);
                mrBridge.diag.events.pinch++;
                if (!mrBridge.diag.firstEventAt) mrBridge.diag.firstEventAt = performance.now();
              } else if (pc.active) {
                if (d > PINCH_OPEN) {
                  pc.active = false;
                } else {
                  pc.point.copy(thumb).add(index).multiplyScalar(0.5);
                }
              }
            } else if (h.pinch.active) {
              h.pinch.active = false; // tracking lost mid-pinch
            }

            // palm basis
            const wrist = jointAt(side, "wrist");
            const iMcp = jointAt(side, "index-finger-metacarpal");
            const mMcp = jointAt(side, "middle-finger-metacarpal");
            const pMcp = jointAt(
              side,
              "pinky-finger-metacarpal",
              "little-finger-metacarpal"
            );
            if (wrist && iMcp && mMcp && pMcp) {
              h.palm.center
                .copy(wrist)
                .add(iMcp)
                .add(mMcp)
                .add(pMcp)
                .multiplyScalar(0.25);
              tmp.v1.subVectors(iMcp, wrist);
              tmp.v2.subVectors(pMcp, wrist);
              tmp.v3.crossVectors(tmp.v1, tmp.v2);
              if (side === "right") tmp.v3.negate();
              const nlen = tmp.v3.length();
              if (nlen > 1e-5) h.palm.normal.copy(tmp.v3).multiplyScalar(1 / nlen);
              tmp.v4.subVectors(mMcp, wrist);
              const flen = tmp.v4.length();
              if (flen > 1e-5) h.palm.fwd.copy(tmp.v4).multiplyScalar(1 / flen);
              h.palm.valid = true;
            } else {
              h.palm.valid = false;
            }

            // fist (mean fingertip distance to palm centre)
            const iTip = jointAt(side, "index-finger-tip");
            const mTip = jointAt(side, "middle-finger-tip");
            const rTip = jointAt(side, "ring-finger-tip");
            const pTip = jointAt(side, "pinky-finger-tip", "little-finger-tip");
            if (iTip && mTip && rTip && pTip && h.palm.valid) {
              const mean =
                (iTip.distanceTo(h.palm.center) +
                  mTip.distanceTo(h.palm.center) +
                  rTip.distanceTo(h.palm.center) +
                  pTip.distanceTo(h.palm.center)) /
                4;
              if (!h.fist && mean < FIST_CLOSE) h.fist = true;
              else if (h.fist && mean > FIST_OPEN) h.fist = false;
            } else {
              h.fist = false;
            }

            // scissors ✌ (index+middle out, ring+pinky curled)
            if (wrist && iTip && mTip && rTip && pTip) {
              h.scissors =
                iTip.distanceTo(wrist) > SCISS_EXT &&
                mTip.distanceTo(wrist) > SCISS_EXT &&
                rTip.distanceTo(wrist) < SCISS_CURL &&
                pTip.distanceTo(wrist) < SCISS_CURL;
            } else {
              h.scissors = false;
            }

            // point ☝ (index out, the rest curled, thumb clear of the index)
            if (wrist && iTip && mTip && rTip && pTip) {
              const thumbClear = !thumb || thumb.distanceTo(iTip) > 0.04;
              h.point =
                thumbClear &&
                iTip.distanceTo(wrist) > POINT_EXT &&
                mTip.distanceTo(wrist) < POINT_CURL &&
                rTip.distanceTo(wrist) < POINT_CURL &&
                pTip.distanceTo(wrist) < POINT_CURL;
            } else {
              h.point = false;
            }

            // a free OPEN hand (nothing pinched, curled, scissored, pointed)
            h.open =
              h.seen &&
              h.palm.valid &&
              !h.pinch.active &&
              !h.pinch.selectActive &&
              !h.fist &&
              !h.scissors &&
              !h.point;

            // index fingertip tracker (flicks + clone taps)
            updateCollider(h.tip, iTip, dt);

            // collider spheres
            updateCollider(h.colPalm, h.palm.valid ? h.palm.center : null, dt);
            const tipPt =
              thumb && index
                ? tmp.v5.copy(thumb).add(index).multiplyScalar(0.5)
                : (mTip ?? null);
            updateCollider(h.colTip, tipPt, dt);

            // select-fallback pinch point from the grip pose
            if (h.pinch.selectActive) {
              try {
                const gs = src.gripSpace;
                if (gs) {
                  const pose = frame.getPose(gs, refSpace);
                  if (pose) {
                    const p = pose.transform.position;
                    h.pinch.point.set(p.x, p.y, p.z);
                  }
                }
              } catch {
                /* unreadable */
              }
            }
          }
          // controller grab points (non-hand sources)
          for (const src of session.inputSources) {
            if (src.hand) continue;
            const side: HandSide = src.handedness === "left" ? "left" : "right";
            const cp = rt.ctrl[side];
            let got = false;
            try {
              const gs = src.gripSpace ?? src.targetRaySpace;
              if (gs) {
                const pose = frame.getPose(gs, refSpace);
                if (pose) {
                  const p = pose.transform.position;
                  cp.pos.set(p.x, p.y, p.z);
                  got = true;
                }
              }
            } catch {
              got = false;
            }
            if (!got && src.targetRaySpace) {
              try {
                const pose = frame.getPose(src.targetRaySpace, refSpace);
                if (pose) {
                  const p = pose.transform.position;
                  const o = pose.transform.orientation;
                  tmp.q1.set(o.x, o.y, o.z, o.w);
                  tmp.v1.set(0, 0, -0.12).applyQuaternion(tmp.q1);
                  cp.pos.set(p.x + tmp.v1.x, p.y + tmp.v1.y, p.z + tmp.v1.z);
                  got = true;
                }
              } catch {
                got = false;
              }
            }
            updateCollider(cp, got ? cp.pos : null, dt);
          }
          // hands that vanished entirely must not keep stale gesture state
          for (const side of sides) {
            const h = rt.hands[side];
            if (!h.seen) {
              h.pinch.active = false;
              h.fist = false;
              h.scissors = false;
              h.point = false;
              h.open = false;
              h.palm.valid = false;
            }
          }
        });
      } else {
        handPools.left.count = 0;
        handPools.right.count = 0;
        for (const side of sides) {
          rt.hands[side].seen = false;
          rt.hands[side].joints = 0;
          rt.hands[side].pinch.active = false;
          rt.hands[side].fist = false;
          rt.hands[side].scissors = false;
          rt.hands[side].point = false;
          rt.hands[side].open = false;
          rt.hands[side].grabActive = false;
        }
      }

      /* ---- palette: side selection, pose, hover, exit-hold ---- */
      safe("palette", () => {
        const pal = rt.palette;
        const wantLeft = handPools.left.count >= PAL_MIN_JOINTS;
        const wantRight = handPools.right.count >= PAL_MIN_JOINTS;
        let side: PaletteRt["side"] = null;
        if (mode === "preview") {
          side = "virtual";
        } else if (pal.side === "left" || pal.side === "right") {
          const curOk = pal.side === "left" ? wantLeft : wantRight;
          if (curOk) {
            side = pal.side;
          } else {
            const other: HandSide = pal.side === "left" ? "right" : "left";
            const otherOk = other === "left" ? wantLeft : wantRight;
            if (otherOk && pal.candidate !== other) {
              pal.candidate = other;
              pal.candidateSince = now;
            }
            if (
              otherOk &&
              pal.candidate === other &&
              now - pal.candidateSince > PAL_SWITCH_MS
            ) {
              side = other;
            }
          }
        } else {
          if (wantLeft) side = "left";
          else if (wantRight) side = "right";
          else if (!pal.handsEver && rt.ctrl.left.seen) side = "ctrl";
        }
        if (side === "left" || side === "right") pal.candidate = null;
        pal.side = side;

        // target pose
        let havePose = false;
        if (side === "virtual") {
          pal.targetPos.set(-0.3, -0.16, -0.52).applyQuaternion(rt.camQuat).add(rt.camPos);
          tmp.m4.lookAt(rt.camPos, pal.targetPos, tmp.up);
          pal.targetQuat.setFromRotationMatrix(tmp.m4);
          havePose = true;
        } else if (side === "ctrl") {
          pal.targetPos.copy(rt.ctrl.left.pos).add(tmp.v1.set(0, 0.13, 0));
          tmp.m4.lookAt(rt.camPos, pal.targetPos, tmp.up);
          pal.targetQuat.setFromRotationMatrix(tmp.m4);
          havePose = true;
        } else if (side) {
          const h = rt.hands[side];
          if (h.palm.valid) {
            pal.targetPos.copy(h.palm.center).addScaledVector(h.palm.normal, PAL_LIFT);
            tmp.v1.copy(h.palm.fwd);
            tmp.v2.copy(h.palm.normal);
            tmp.v1.addScaledVector(tmp.v2, -tmp.v1.dot(tmp.v2));
            if (tmp.v1.lengthSq() < 1e-6) tmp.v1.set(1, 0, 0);
            tmp.v1.normalize();
            tmp.v3.crossVectors(tmp.v1, tmp.v2).normalize();
            tmp.m4.makeBasis(tmp.v3, tmp.v1, tmp.v2);
            pal.targetQuat.setFromRotationMatrix(tmp.m4);
            havePose = true;
          }
        }
        const k = dampK(14, dt);
        if (havePose || pal.opacity > 0.02) {
          pal.pos.lerp(pal.targetPos, k);
          pal.quat.slerp(pal.targetQuat, k);
        }
        pal.opacity += ((havePose ? 1 : 0) - pal.opacity) * dampK(8, dt);
        pal.scale = 0.92 + 0.08 * pal.opacity;
        if (pal.group) {
          pal.group.position.copy(pal.pos);
          pal.group.quaternion.copy(pal.quat);
          pal.group.scale.setScalar(pal.scale);
          pal.group.visible = pal.opacity > 0.03;
        }
        if (pal.panelMat) pal.panelMat.opacity = 0.95 * pal.opacity;
        if (pal.exitMat) pal.exitMat.opacity = 0.95 * pal.opacity;
        if (pal.strutMat) pal.strutMat.opacity = 0.35 * pal.opacity;
        if (pal.strutGeo) {
          const attr = pal.strutGeo.getAttribute("position") as THREE.BufferAttribute;
          if (side === "left" || side === "right") {
            const h = rt.hands[side];
            attr.setXYZ(0, h.palm.center.x, h.palm.center.y, h.palm.center.z);
          } else if (side === "ctrl") {
            attr.setXYZ(0, rt.ctrl.left.pos.x, rt.ctrl.left.pos.y, rt.ctrl.left.pos.z);
          } else {
            attr.setXYZ(0, pal.pos.x, pal.pos.y, pal.pos.z);
          }
          attr.setXYZ(1, pal.pos.x, pal.pos.y, pal.pos.z);
          attr.needsUpdate = true;
          pal.strutGeo.computeBoundingSphere();
        }

        // slot pulse decay + hover
        for (let i = 0; i < pal.slotPulse.length; i++) {
          pal.slotPulse[i] = Math.max(0, pal.slotPulse[i] - dt * 3.5);
        }
        pal.hoverSlot = -1;
        if (pal.opacity > 0.6) {
          if (mode === "xr") {
            let bestD = SLOT_GRAB_R;
            const testPoint = (pt: THREE.Vector3) => {
              for (let i = 0; i < SLOT_LOCAL.length; i++) {
                tmp.slotWorld
                  .copy(SLOT_LOCAL[i])
                  .multiplyScalar(pal.scale)
                  .applyQuaternion(pal.quat)
                  .add(pal.pos);
                const d = pt.distanceTo(tmp.slotWorld);
                if (d < bestD) {
                  bestD = d;
                  pal.hoverSlot = i;
                }
              }
            };
            for (const s2 of sides) {
              const h = rt.hands[s2];
              if (h.seen) testPoint(h.grabPoint);
              if (rt.ctrl[s2].seen) testPoint(rt.ctrl[s2].pos);
            }
          } else {
            const pi = previewInput.current;
            if (pi && pi.has) {
              tmp.ray.setFromCamera(pi.ndc, camera);
              const ro = tmp.ray.ray.origin;
              const rd = tmp.ray.ray.direction;
              let best = 0.024;
              for (let i = 0; i < SLOT_LOCAL.length; i++) {
                tmp.slotWorld
                  .copy(SLOT_LOCAL[i])
                  .multiplyScalar(pal.scale)
                  .applyQuaternion(pal.quat)
                  .add(pal.pos);
                const d = raySphereDist(ro, rd, tmp.slotWorld, 0.024);
                if (d >= 0 && d < best) {
                  best = d;
                  pal.hoverSlot = i;
                }
              }
            }
          }
        }

        // exit hold
        let holdingExit = false;
        if (pal.exitSide && rt.holds[pal.exitSide].exit && !rt.holds[pal.exitSide].part) {
          holdingExit = true;
          pal.exitProgress += dt / EXIT_HOLD_S;
          if (now - pal.exitTickAt > 120) {
            pal.exitTickAt = now;
            mrAudio.exitTick(pal.exitProgress);
            hapticPulse(rt.sources[pal.exitSide], 0.25, 30);
          }
          if (pal.exitProgress >= 1 && !pal.exited) {
            pal.exited = true;
            mrAudio.exit();
            eventsRef.current.onExit();
          }
        }
        if (!holdingExit) pal.exitProgress = Math.max(0, pal.exitProgress - dt * 2.5);

        // texture redraws (keyed)
        const pulsesKey = pal.slotPulse.map((p) => (p > 0.35 ? 1 : 0)).join("");
        const key = `${pal.hoverSlot}:${Math.round(pal.exitProgress * 12)}:${pulsesKey}`;
        if (key !== pal.texKey) {
          pal.texKey = key;
          if (pal.panelCanvas && pal.panelTex) {
            drawPaletteTexture(pal.panelCanvas, pal.hoverSlot, pal.slotPulse);
            pal.panelTex.needsUpdate = true;
          }
          if (pal.exitCanvas && pal.exitTex) {
            drawExitTexture(pal.exitCanvas, pal.exitProgress);
            pal.exitTex.needsUpdate = true;
          }
        }

        // miniature hover glow
        for (let i = 0; i < pal.slots.length; i++) {
          const s = pal.slots[i];
          const g = Math.max(i === pal.hoverSlot ? 0.9 : 0, pal.slotPulse[i]);
          s.fill.opacity = (0.15 + 0.15 * g) * pal.opacity;
          s.wire.opacity = (0.55 + 0.4 * g) * pal.opacity;
          s.fill.emissiveIntensity = 0.3 + 0.5 * g;
          const wob = 1 + (g > 0 ? 0.06 * Math.sin(rt.time * 6 + i) * g : 0);
          s.group.scale.setScalar(wob);
        }
      });

      /* ---- grab edges (hands, controllers, preview mouse) ---- */
      safe("grabs", () => {
        for (const side of sides) {
          const h = rt.hands[side];
          const pinchy = h.pinch.active || h.pinch.selectActive;
          const fisty = h.fist && h.palm.valid;
          if (pinchy) {
            h.grabPoint.copy(h.pinch.point);
          } else if (fisty) {
            h.grabPoint.copy(h.palm.center);
          } else {
            // open hand: the reach point is the fingertip cluster — this
            // is also what a slow hand will grab next (soft-skip target)
            h.grabPoint.copy(h.colTip.seen ? h.colTip.pos : h.palm.center);
          }
          const active = pinchy || fisty;
          const wasActive = h.grabActive;
          h.grabActive = active;
          if (active && !wasActive) {
            attemptGrab(
              side,
              h.grabPoint,
              pinchy ? (h.pinch.active ? "pinch" : "select") : "fist"
            );
          } else if (!active && wasActive) {
            releaseHold(side);
          }
        }
        // controller press events
        while (rt.pressQueue.length) {
          const ev = rt.pressQueue.shift()!;
          if (ev.type === "begin") {
            const cp = rt.ctrl[ev.side];
            if (cp.seen) attemptGrab(ev.side, cp.pos, "controller");
          } else {
            releaseHold(ev.side);
          }
        }
        // preview mouse
        if (mode === "preview") {
          const pi = previewInput.current;
          if (pi) {
            if (pi.pressed && !rt.vPrevPressed) previewAttemptGrab();
            else if (!pi.pressed && rt.vPrevPressed) releaseHold("right");
            rt.vPrevPressed = pi.pressed;
            const x = pi.keys.has("x");
            if (x && !rt.vPrevX) {
              sandbox.rotateNearest(rt.vPoint.pos, Y_AXIS, SPIN_IMPULSE, 0.8, "right");
            }
            rt.vPrevX = x;
            if (Math.abs(pi.wheel) > 26) {
              sandbox.rotateNearest(
                rt.vPoint.pos,
                Y_AXIS,
                (pi.wheel > 0 ? 1 : -1) * SPIN_IMPULSE,
                0.8,
                "right"
              );
            }
            pi.wheel = 0;
          }
        }
      });

      /* ---- telekinesis: point targeting ray, flick, double-tap clone ---- */
      safe("telekinesis", () => {
        const line = pointLineRef.current;
        let rayFrom: THREE.Vector3 | null = null;
        let rayTo: THREE.Vector3 | null = null;
        let rayBright = false;
        if (mode === "xr") {
          for (const side of sides) {
            const h = rt.hands[side];
            if (!h.seen || !h.tip.seen) continue;
            const speed = h.tip.vel.length();
            // ---- targeting ray + flick (point pose) ----
            if (h.point) {
              const w = jointAt(side, "wrist");
              if (w) {
                tmp.v1.copy(h.tip.pos).sub(w);
                if (tmp.v1.lengthSq() > 1e-6) {
                  tmp.v1.normalize();
                  let bestT = FLICK_RANGE;
                  let bestPart: Part | null = null;
                  for (const p of sandbox.parts) {
                    if (p.cluster.dying) continue;
                    sandbox.partWorld(p, tmp.v2, tmp.q1);
                    const r = SHAPE_BY_ID.get(p.type)!.bound * p.cluster.scale + 0.015;
                    const t = raySphereDist(w, tmp.v1, tmp.v2, r);
                    if (t >= 0 && t < bestT) {
                      bestT = t;
                      bestPart = p;
                    }
                  }
                  if (bestPart) {
                    tmp.v3.copy(w).addScaledVector(tmp.v1, bestT);
                    for (const p of bestPart.cluster.parts) {
                      p.glowTarget = Math.max(p.glowTarget, 0.55);
                    }
                    if (speed > FLICK_SPEED && now > h.flickCdUntil) {
                      h.flickCdUntil = now + FLICK_COOLDOWN * 1000;
                      sandbox.flick(bestPart.cluster, h.tip.vel, tmp.v3, side);
                    }
                    rayFrom = h.tip.pos;
                    rayTo = tmp.v3.clone();
                    rayBright = true;
                  } else {
                    rayFrom = h.tip.pos;
                    rayTo = tmp.v3.copy(h.tip.pos).addScaledVector(tmp.v1, 0.9).clone();
                  }
                }
              }
            }
            // ---- double-tap clone (a free index fingertip) ----
            if (!h.grabActive && !h.point) {
              const tapPart = speed < TAP_MAX_SPEED ? sandbox.tryGrab(h.tip.pos, TAP_RADIUS) : null;
              const tp = h.taps;
              if (tapPart && !tapPart.cluster.dying && !tapPart.cluster.summon) {
                const cl = tapPart.cluster;
                if (!tp.inside) {
                  tp.inside = true;
                  if (tp.cluster !== cl) {
                    tp.cluster = cl;
                    tp.at = now;
                  } else if (now - tp.at < TAP_GAP_MS) {
                    // DOUBLE TAP → a perfect copy pops out beside it
                    tmp.v4.set(0.17, 0.02, 0).applyQuaternion(rt.camQuat);
                    const fresh = sandbox.cloneCluster(cl, tmp.v5.copy(cl.pos).add(tmp.v4), side);
                    if (fresh) {
                      tp.cluster = null;
                      tp.at = 0;
                    }
                  } else {
                    tp.at = now;
                  }
                }
              } else if (!tapPart) {
                tp.inside = false;
                if (tp.cluster && now - tp.at > TAP_GAP_MS * 2) tp.cluster = null;
              }
            }
          }
        }
        if (line) {
          if (rayFrom && rayTo) {
            const attr = line.geometry.getAttribute("position") as THREE.BufferAttribute;
            attr.setXYZ(0, rayFrom.x, rayFrom.y, rayFrom.z);
            attr.setXYZ(1, rayTo.x, rayTo.y, rayTo.z);
            attr.needsUpdate = true;
            line.computeLineDistances?.();
            line.geometry.computeBoundingSphere();
            line.visible = true;
            (line.material as THREE.LineBasicMaterial).opacity = rayBright ? 0.55 : 0.16;
          } else {
            line.visible = false;
          }
        }
      });

      /* ---- force gestures: push, pull, stabilize ---- */
      safe("force", () => {
        if (mode !== "xr") return;
        tmp.camFwd.set(0, 0, -1).applyQuaternion(rt.camQuat);
        let charged: Cluster | null = null;
        let chargeK = 0;
        // stabilize charges decay when no still palm is feeding them
        // (charged clusters get +dt below, so they still climb)
        for (const c of sandbox.clusters) {
          if (c.stabT > 0) c.stabT = Math.max(0, c.stabT - dt * 1.6);
        }
        for (const side of sides) {
          const h = rt.hands[side];
          if (!h.seen || !h.palm.valid) continue;
          // an active summon keeps following its hand's palm
          for (const c of sandbox.clusters) {
            if (c.summon && c.summon.side === side && h.open && h.colPalm.seen) {
              c.summon.target.copy(h.palm.center).addScaledVector(h.palm.normal, PULL_HOVER);
            }
          }
          if (!h.open || !h.colPalm.seen) continue;
          const dir = h.palm.normal;
          const facingAway = dir.dot(tmp.camFwd) > 0.45;
          const thrust = h.colPalm.vel.dot(dir);
          // FORCE PUSH: open palm thrust along the palm normal
          if (facingAway && thrust > PUSH_SPEED && now > h.pushCdUntil) {
            h.pushCdUntil = now + PUSH_COOLDOWN * 1000;
            tmp.v1.copy(dir).multiplyScalar(0.8);
            if (h.colPalm.vel.lengthSq() > 1e-4) {
              tmp.v1
                .addScaledVector(tmp.v2.copy(h.colPalm.vel).normalize(), 0.2)
                .normalize();
            }
            sandbox.forcePush(h.palm.center, tmp.v1, side);
            tmp.v3.copy(h.palm.center).addScaledVector(dir, 0.06);
            tmp.q1.setFromUnitVectors(Z_AXIS, dir);
            ringFxRef.current?.spawn(tmp.v3, tmp.q1, 0.07, 0.55, 0.32, MR_CYAN);
          }
          // FORCE PULL: open palm snapped back toward the chest
          if (facingAway && thrust < -PULL_SPEED && now > h.pullCdUntil) {
            h.pullCdUntil = now + PULL_COOLDOWN * 1000;
            tmp.v3.copy(h.palm.center).addScaledVector(dir, PULL_HOVER);
            sandbox.forcePullNearest(h.palm.center, dir, tmp.v3, side);
          }
          // STABILIZE: a still palm facing a nearby build calms it
          if (h.colPalm.vel.length() < 0.3) {
            for (const c of sandbox.clusters) {
              if (c.dying || c.summon) continue;
              if (now < c.stabCdUntil) continue;
              tmp.v4.copy(c.pos).sub(h.palm.center);
              const d = tmp.v4.length();
              if (d > STAB_DIST || d < 1e-4) continue;
              tmp.v4.multiplyScalar(1 / d);
              if (tmp.v4.dot(dir) < 0.45) continue;
              c.stabT += dt * 2.5;
              for (const p of c.parts) {
                p.glowTarget = Math.max(p.glowTarget, Math.min(1, (c.stabT / STAB_HOLD_S)) * 0.8);
              }
              if (c.stabT >= STAB_HOLD_S) {
                sandbox.stabilize(c, side);
              } else if (c.stabT > chargeK) {
                chargeK = c.stabT;
                charged = c;
              }
            }
          }
        }
        // stabilize charge ring (billboarded on the strongest charging build)
        const stabRing = stabRingRef.current;
        if (stabRing) {
          if (charged && !charged.dying) {
            const k = Math.min(1, charged.stabT / STAB_HOLD_S);
            stabRing.visible = true;
            stabRing.position.copy(charged.pos);
            stabRing.quaternion.copy(rt.camQuat);
            stabRing.scale.setScalar(0.09 + 0.05 * k + 0.012 * Math.sin(rt.time * 10));
            (stabRing.material as THREE.MeshBasicMaterial).opacity = 0.25 + 0.5 * k;
          } else {
            stabRing.visible = false;
          }
        }
      });

      /* ---- clap-crush: sandwich a build between both palms ---- */
      safe("clap", () => {
        if (mode !== "xr") return;
        if (now < rt.clapCdUntil) return;
        const hl = rt.hands.left;
        const hr = rt.hands.right;
        if (!hl.open || !hr.open) return;
        if (!hl.palm.valid || !hr.palm.valid) return;
        if (!hl.colPalm.seen || !hr.colPalm.seen) return;
        tmp.v1.copy(hl.palm.center).add(hr.palm.center).multiplyScalar(0.5);
        let victim: Cluster | null = null;
        for (const c of sandbox.clusters) {
          if (c.dying) continue;
          if (c.pos.distanceTo(tmp.v1) < CLAP_MID) {
            victim = c;
            break;
          }
        }
        if (!victim) return;
        if (victim.pos.distanceTo(hl.palm.center) > CLAP_NEAR) return;
        if (victim.pos.distanceTo(hr.palm.center) > CLAP_NEAR) return;
        if (hl.palm.normal.dot(hr.palm.normal) > -0.25) return;
        tmp.v2.copy(hr.palm.center).sub(hl.palm.center);
        const sep = tmp.v2.length();
        if (sep < 1e-4) return;
        tmp.v2.multiplyScalar(1 / sep);
        tmp.v3.copy(hr.colPalm.vel).sub(hl.colPalm.vel);
        const closing = -tmp.v3.dot(tmp.v2);
        if (closing < CLAP_CLOSE) return;
        rt.clapCdUntil = now + CLAP_COOLDOWN * 1000;
        sandbox.killCluster(victim, false);
      });

      /* ---- holds: two-hand scale/twist, spring follow, shake, snap ---- */
      safe("holds", () => {
        // ---- two-hand scale & twist (both hands on ONE build) ----
        const th = rt.twoHand;
        const lp = rt.holds.left.part;
        const rp = rt.holds.right.part;
        const sameCluster = !!(lp && rp && lp.cluster === rp.cluster && !lp.cluster.dying);
        if (sameCluster) {
          const c = lp!.cluster;
          const la =
            rt.holds.left.mode === "controller"
              ? rt.ctrl.left.seen
                ? rt.ctrl.left.pos
                : null
              : rt.holds.left.mode === "mouse"
                ? rt.vPoint.seen
                  ? rt.vPoint.pos
                  : null
                : rt.hands.left.grabActive
                  ? rt.hands.left.grabPoint
                  : null;
          const ra =
            rt.holds.right.mode === "controller"
              ? rt.ctrl.right.seen
                ? rt.ctrl.right.pos
                : null
              : rt.holds.right.mode === "mouse"
                ? rt.vPoint.seen
                  ? rt.vPoint.pos
                  : null
                : rt.hands.right.grabActive
                  ? rt.hands.right.grabPoint
                  : null;
          if (la && ra) {
            if (!th.active || th.cluster !== c) {
              th.active = true;
              th.cluster = c;
              th.startDist = Math.max(0.05, la.distanceTo(ra));
              th.startScale = c.scale;
              th.startDir.copy(ra).sub(la).normalize();
              th.startQuat.copy(c.quat);
              th.startPos.copy(c.pos);
              th.startMid.copy(la).add(ra).multiplyScalar(0.5);
              th.midPrev.copy(th.startMid);
              th.midVel.set(0, 0, 0);
            } else {
              tmp.v1.copy(la).add(ra).multiplyScalar(0.5);
              if (dt > 1e-4) {
                tmp.v2.copy(tmp.v1).sub(th.midPrev).multiplyScalar(1 / dt);
                if (tmp.v2.length() > 5) tmp.v2.setLength(5);
                th.midVel.lerp(tmp.v2, 0.5);
              }
              th.midPrev.copy(tmp.v1);
              tmp.v3.copy(ra).sub(la);
              const dist = Math.max(0.05, tmp.v3.length());
              tmp.v3.multiplyScalar(1 / dist);
              c.scale = THREE.MathUtils.clamp(
                (th.startScale * dist) / th.startDist,
                SCALE_MIN,
                SCALE_MAX
              );
              tmp.q1.setFromUnitVectors(th.startDir, tmp.v3);
              c.quat.copy(tmp.q1).multiply(th.startQuat).normalize();
              c.pos.copy(th.startPos).add(tmp.v1).sub(th.startMid);
              c.vel.copy(th.midVel);
              c.angVel.multiplyScalar(Math.exp(-8 * dt));
              c.settleT = 0;
            }
          }
        } else if (th.active) {
          th.active = false;
          if (th.cluster) th.cluster.vel.copy(th.midVel);
          th.cluster = null;
          // re-latch the remaining hold's spring where the build now is
          for (const s of sides) {
            if (rt.holds[s].part) rt.holds[s].anchorSeen = false;
          }
        }

        for (const side of sides) {
          const hold = rt.holds[side];
          const part = hold.part;
          if (!part) continue;
          if (part.cluster.dying) {
            releaseHold(side, { silent: true, noImpulse: true });
            continue;
          }
          let anchor: THREE.Vector3 | null = null;
          if (hold.mode === "controller") {
            if (rt.ctrl[side].seen) anchor = rt.ctrl[side].pos;
          } else if (hold.mode === "mouse") {
            const pi = previewInput.current;
            if (pi && pi.has) {
              tmp.ray.setFromCamera(pi.ndc, camera);
              sandbox.partWorld(part, tmp.v1, tmp.q1);
              tmp.v2.copy(tmp.v1).sub(tmp.ray.ray.origin);
              const t = THREE.MathUtils.clamp(
                tmp.v2.dot(tmp.ray.ray.direction),
                0.25,
                2.5
              );
              tmp.grabA.copy(tmp.ray.ray.origin).addScaledVector(tmp.ray.ray.direction, t);
              anchor = tmp.grabA;
            }
          } else {
            const h = rt.hands[side];
            if (h.grabActive) anchor = h.grabPoint;
          }
          if (!anchor) {
            releaseHold(side);
            continue;
          }
          if (!hold.anchorSeen) {
            hold.prevAnchor.copy(anchor);
            hold.anchorVel.set(0, 0, 0);
            hold.anchorSeen = true;
          } else if (dt > 1e-4) {
            tmp.instant.copy(anchor).sub(hold.prevAnchor).multiplyScalar(1 / dt);
            if (tmp.instant.length() > 6) tmp.instant.setLength(6);
            hold.anchorVel.lerp(tmp.instant, 0.6);
            hold.prevAnchor.copy(anchor);
          }
          hold.anchor.copy(anchor);
          part.held = true;
          part.glowTarget = 1;
          // the two-hand gesture drives the build directly — no spring
          if (th.active && part.cluster === th.cluster) continue;
          sandbox.holdUpdate(dt, part, hold.anchor, hold.anchorVel, side);
          // snap while held: magnetic assist + click into place when flush
          const cand = sandbox.snapSearch(part, false);
          if (cand) {
            sandbox.partWorld(cand.target, tmp.v1, tmp.q1);
            sandbox.partWorld(part, tmp.v2, tmp.q1);
            tmp.v3.copy(tmp.v1).sub(tmp.v2);
            const dl = tmp.v3.length();
            if (dl > 0.004) {
              part.cluster.vel.addScaledVector(
                tmp.v3.multiplyScalar(1 / dl),
                Math.min(1.6, MAGNET_ACC * dt)
              );
            }
            if (cand.lat < SNAP_ENGAGE_LAT && Math.abs(cand.along) < SNAP_ENGAGE_ALONG) {
              sandbox.doSnap(cand, side);
              releaseHold(side, { silent: true, cooldown: 350, noImpulse: true });
              continue;
            }
          }
          // ---- shake-to-recolor ----
          const sh = hold.shake;
          const sp = hold.anchorVel.length();
          if (sp > SHAKE_SPEED && now > hold.tintCdUntil) {
            const axv = hold.anchorVel;
            const absX = Math.abs(axv.x);
            const absY = Math.abs(axv.y);
            const absZ = Math.abs(axv.z);
            const axis = absX > absY && absX > absZ ? 0 : absY > absZ ? 1 : 2;
            const dir = Math.sign(axis === 0 ? axv.x : axis === 1 ? axv.y : axv.z);
            if (dir !== 0) {
              if (sh.lastDir !== 0 && dir !== sh.lastDir) {
                sh.flips.push(now);
                while (sh.flips.length && now - sh.flips[0] > SHAKE_WINDOW_MS) sh.flips.shift();
                if (sh.flips.length >= SHAKE_FLIPS) {
                  sh.flips.length = 0;
                  sh.lastDir = 0;
                  hold.tintCdUntil = now + 650;
                  sandbox.recolorCluster(part.cluster, side);
                }
              } else if (sh.lastDir === 0) {
                sh.flips.length = 0;
              }
              sh.lastDir = dir;
            }
          } else if (sp < 0.22) {
            sh.lastDir = 0;
          }
        }
      });

      /* ---- physical hand interaction: graze & slap ---- */
      safe("colliders", () => {
        const skipFor = (side: HandSide): Part | null => {
          const hold = rt.holds[side];
          if (hold.part) return hold.part;
          if (hold.recent && performance.now() < hold.recentUntil) return hold.recent;
          return null;
        };
        if (mode === "xr") {
          for (const side of sides) {
            const skip = skipFor(side);
            const h = rt.hands[side];
            // A CLOSED hand (pinch/fist/holding) is compact and busy — it
            // does not shove things. Only an OPEN hand grazes (fingertips)
            // and slaps (flat palm). A SLOW open hand is REACHING for the
            // hologram nearest its fingertips — that one is left alone so
            // grabbing is always possible; a fast hand slaps everything.
            if (!h.grabActive) {
              const speed = Math.max(
                h.colPalm.seen ? h.colPalm.vel.length() : 0,
                h.colTip.seen ? h.colTip.vel.length() : 0
              );
              let soft: Part | null = null;
              if (speed < 0.8 && h.palm.valid) {
                // reach-protection zone centred on the palm — engages
                // BEFORE any collider can touch the reached-for part
                soft = sandbox.tryGrab(h.palm.center, 0.08);
              }
              if (h.colPalm.seen)
                sandbox.pushSphere(h.colPalm.pos, h.colPalm.vel, 0.05, skip, soft);
              if (h.colTip.seen)
                sandbox.pushSphere(h.colTip.pos, h.colTip.vel, 0.03, skip, soft);
            }
            const cp = rt.ctrl[side];
            if (cp.seen) sandbox.pushSphere(cp.pos, cp.vel, 0.05, skip);
          }
        } else if (rt.vPoint.seen && !rt.holds.right.part) {
          sandbox.pushSphere(rt.vPoint.pos, rt.vPoint.vel, 0.045, skipFor("right"));
        }
      });

      /* ---- scissors swipe → drift spin / tumble ---- */
      safe("swipe", () => {
        if (mode !== "xr") return;
        tmp.camRight.set(1, 0, 0).applyQuaternion(rt.camQuat);
        for (const side of sides) {
          const h = rt.hands[side];
          if (h.scissors && h.palm.valid) {
            const s = h.swipe.samples;
            s.push({ t: now, x: h.palm.center.x, y: h.palm.center.y, z: h.palm.center.z });
            while (s.length && now - s[0].t > SWIPE_WINDOW * 1000) s.shift();
            if (now < h.swipe.cooldownUntil) continue;
            if (s.length >= 3) {
              const a = s[0];
              const b = s[s.length - 1];
              const dx = b.x - a.x;
              const dy = b.y - a.y;
              const dz = b.z - a.z;
              const dispR = dx * tmp.camRight.x + dy * tmp.camRight.y + dz * tmp.camRight.z;
              const path = Math.hypot(dx, dy, dz);
              let maxV = 0;
              for (let i = 1; i < s.length; i++) {
                const p = s[i];
                const q = s[i - 1];
                const dms = Math.max(1, p.t - q.t);
                const v = (Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) * 1000) / dms;
                if (v > maxV) maxV = v;
              }
              if (Math.abs(dispR) > SWIPE_DIST && path > SWIPE_DIST * 1.15 && maxV > SWIPE_SPEED) {
                const sign = dispR < 0 ? 1 : -1; // swipe LEFT → +Y spin
                const ok = sandbox.rotateNearest(h.palm.center, Y_AXIS, sign * SPIN_IMPULSE, 0.85, side);
                if (ok) {
                  h.swipe.cooldownUntil = now + SWIPE_COOLDOWN * 1000;
                  s.length = 0;
                }
              } else if (
                Math.abs(dy) > TUMBLE_DIST &&
                Math.abs(dy) > Math.abs(dispR) * 1.35 &&
                path > TUMBLE_DIST * 1.2 &&
                maxV > SWIPE_SPEED
              ) {
                // vertical ✌ swipe → forward/backward tumble around camera-right
                const sign = dy > 0 ? 1 : -1;
                const ok = sandbox.rotateNearest(
                  h.palm.center,
                  tmp.camRight,
                  sign * TUMBLE_IMPULSE,
                  0.85,
                  side,
                  "tumble"
                );
                if (ok) {
                  h.swipe.cooldownUntil = now + SWIPE_COOLDOWN * 1000;
                  s.length = 0;
                }
              }
            }
          } else {
            h.swipe.samples.length = 0;
          }
        }
      });

      /* ---- physics ---- */
      safe("physics", () => sandbox.integrate(dt, rt.camPos));

      /* ---- render sync + effects + debug ---- */
      safe("render", () => {
        // gesture fx rings live here so they always advance
        ringFxRef.current?.update(dt);
        // grab-proximity glow for free parts
        for (const p of sandbox.parts) {
          if (p.held) continue;
          let g = 0;
          sandbox.partWorld(p, tmp.v1, tmp.q1);
          if (mode === "xr") {
            for (const side of sides) {
              const h = rt.hands[side];
              if (!h.seen) continue;
              const d = Math.max(
                h.grabPoint.distanceTo(tmp.v1) - SHAPE_BY_ID.get(p.type)!.bound * p.cluster.scale,
                0
              );
              const gg = 1 - Math.min(1, d / 0.09);
              if (gg > g) g = gg;
            }
          } else if (rt.vPoint.seen) {
            const d = Math.max(
              rt.vPoint.pos.distanceTo(tmp.v1) - SHAPE_BY_ID.get(p.type)!.bound * p.cluster.scale,
              0
            );
            g = 1 - Math.min(1, d / 0.09);
          }
          if (g > p.glowTarget) p.glowTarget = g;
        }
        sandbox.syncRender(now, dt);

        // hand constellation dots
        const dots = dotsRef.current;
        if (dots) {
          if (mode === "xr") {
            let n = 0;
            for (const side of sides) {
              const pool = handPools[side];
              for (let i = 0; i < pool.count && n < 60; i++, n++) {
                tmp.dotDummy.position.copy(pool.vecs[i]);
                tmp.dotDummy.scale.setScalar(1);
                tmp.dotDummy.updateMatrix();
                dots.setMatrixAt(n, tmp.dotDummy.matrix);
              }
            }
            for (; n < 60; n++) {
              tmp.dotDummy.position.set(0, -100, 0);
              tmp.dotDummy.scale.setScalar(0.0001);
              tmp.dotDummy.updateMatrix();
              dots.setMatrixAt(n, tmp.dotDummy.matrix);
            }
            dots.instanceMatrix.needsUpdate = true;
            dots.visible = true;
          } else {
            dots.visible = false;
          }
        }

        // pinch rings (billboarded feedback at grab points)
        if (mode === "xr") {
          for (const side of sides) {
            const ring = side === "left" ? ringLRef.current : ringRRef.current;
            if (!ring) continue;
            const h = rt.hands[side];
            if (h.grabActive && h.seen) {
              ring.visible = true;
              ring.position.copy(h.grabPoint);
              ring.quaternion.copy(rt.camQuat);
              ring.scale.setScalar(1 + 0.08 * Math.sin(rt.time * 9));
              (ring.material as THREE.MeshBasicMaterial).opacity = 0.85;
            } else {
              ring.visible = false;
            }
          }
        } else {
          const ring = ringMouseRef.current;
          if (ring) {
            if (rt.vPoint.seen) {
              ring.visible = true;
              ring.position.copy(rt.vPoint.pos);
              ring.quaternion.copy(rt.camQuat);
              const pressed = rt.holds.right.part !== null;
              ring.scale.setScalar(pressed ? 0.7 : 1);
              (ring.material as THREE.MeshBasicMaterial).opacity = pressed ? 0.95 : 0.6;
            } else {
              ring.visible = false;
            }
          }
        }

        // DOM-side commands
        if (mrBridge.commands.clearParts !== rt.cmdSeen) {
          rt.cmdSeen = mrBridge.commands.clearParts;
          sandbox.clear();
        }

        // debug snapshot (~7Hz) for the watchdogs + dev E2E
        if (now - rt.debugAt > 140) {
          rt.debugAt = now;
          const pal = rt.palette;
          const slotsOut: Array<[number, number, number]> = [];
          for (let i = 0; i < SLOT_LOCAL.length; i++) {
            tmp.slotWorld
              .copy(SLOT_LOCAL[i])
              .multiplyScalar(pal.scale)
              .applyQuaternion(pal.quat)
              .add(pal.pos);
            slotsOut.push([tmp.slotWorld.x, tmp.slotWorld.y, tmp.slotWorld.z]);
          }
          tmp.exitWorld
            .copy(EXIT_POS)
            .multiplyScalar(pal.scale)
            .applyQuaternion(pal.quat)
            .add(pal.pos);
          const partsList: Array<{ id: number; type: string; pos: [number, number, number] }> =
            [];
          for (const p of sandbox.parts) {
            sandbox.partWorld(p, tmp.v1, tmp.q1);
            partsList.push({
              id: p.id,
              type: p.type,
              pos: [tmp.v1.x, tmp.v1.y, tmp.v1.z],
            });
          }
          const clustersList = sandbox.clusters.map((c) => ({
            id: c.id,
            parts: c.parts.length,
            scale: +c.scale.toFixed(3),
            tint: c.tintIdx,
            dying: !!c.dying,
            summoned: !!c.summon,
            pos: [c.pos.x, c.pos.y, c.pos.z] as [number, number, number],
            vel: [
              +c.vel.x.toFixed(3),
              +c.vel.y.toFixed(3),
              +c.vel.z.toFixed(3),
            ] as [number, number, number],
            angVel: [
              +c.angVel.x.toFixed(3),
              +c.angVel.y.toFixed(3),
              +c.angVel.z.toFixed(3),
            ] as [number, number, number],
          }));
          tmp.v1.set(0, 1, 0).applyQuaternion(pal.quat);
          mrBridge.debug = {
            build: SANDBOX_BUILD,
            parts: sandbox.parts.length,
            clusters: sandbox.clusters.length,
            partsList,
            clustersList,
            twoHand: { active: rt.twoHand.active, scale: rt.twoHand.cluster?.scale ?? 1 },
            palUp: [tmp.v1.x, tmp.v1.y, tmp.v1.z],
            held: { left: rt.holds.left.part !== null, right: rt.holds.right.part !== null },
            palette: { side: pal.side, visible: pal.opacity > 0.5 },
            slots: slotsOut,
            exitPos: [tmp.exitWorld.x, tmp.exitWorld.y, tmp.exitWorld.z],
            gestures: {
              pinchL: rt.hands.left.pinch.active || rt.hands.left.pinch.selectActive,
              pinchR: rt.hands.right.pinch.active || rt.hands.right.pinch.selectActive,
              fistL: rt.hands.left.fist,
              fistR: rt.hands.right.fist,
              scissorsL: rt.hands.left.scissors,
              scissorsR: rt.hands.right.scissors,
              pointL: rt.hands.left.point,
              pointR: rt.hands.right.point,
              openL: rt.hands.left.open,
              openR: rt.hands.right.open,
            },
            lastSpawnAt: rt.last.spawn,
            lastSnapAt: rt.last.snap,
            lastRipAt: rt.last.rip,
            lastSpinAt: rt.last.spin,
            lastPushAt: rt.last.push,
            lastPullAt: rt.last.pull,
            lastFlickAt: rt.last.flick,
            lastCloneAt: rt.last.clone,
            lastCrushAt: rt.last.crush,
            lastStabAt: rt.last.stab,
            lastTintAt: rt.last.tint,
            lastTumbleAt: rt.last.tumble,
            lastYeetAt: rt.last.yeet,
            grabTrace: rt.grabTrace,
            diag: {
              frame: mrBridge.diag.frame,
              fps: mrBridge.diag.fps,
              inputs: mrBridge.diag.inputs,
              jointsL: mrBridge.diag.joints.left,
              jointsR: mrBridge.diag.joints.right,
              select: mrBridge.diag.events.select,
              squeeze: mrBridge.diag.events.squeeze,
              pinch: mrBridge.diag.events.pinch,
              errors: [...frameErrorRing],
            },
          };
        }
      });
    } catch (err) {
      recordFrameError("frame", err);
    }
  });

  return (
    <>
      <ambientLight intensity={0.55} />
      <directionalLight position={[2, 4, 2]} intensity={0.7} color={MR_CYAN} />

      {/* hand constellation dots + pinch rings (XR only) */}
      {mode === "xr" && (
        <>
          <instancedMesh
            ref={(o) => {
              dotsRef.current = o as THREE.InstancedMesh | null;
            }}
            args={[dotsGeo, dotsMat, 60]}
            frustumCulled={false}
          />
          <mesh
            ref={(o) => {
              ringLRef.current = o as THREE.Mesh | null;
            }}
            geometry={ringGeo}
            visible={false}
            frustumCulled={false}
          >
            <meshBasicMaterial
              color={MR_ICE}
              transparent
              opacity={0.85}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
          <mesh
            ref={(o) => {
              ringRRef.current = o as THREE.Mesh | null;
            }}
            geometry={ringGeo}
            visible={false}
            frustumCulled={false}
          >
            <meshBasicMaterial
              color={MR_ICE}
              transparent
              opacity={0.85}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
        </>
      )}

      {/* preview: the mouse-point reticle */}
      {mode === "preview" && (
        <mesh
          ref={(o) => {
            ringMouseRef.current = o as THREE.Mesh | null;
          }}
          geometry={ringGeo}
          visible={false}
          frustumCulled={false}
        >
          <meshBasicMaterial
            color={MR_ICE}
            transparent
            opacity={0.7}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* MrScene — the exported wrapper (canvas + preview input plumbing)     */
/* ------------------------------------------------------------------ */

export interface MrSceneProps {
  mode: "xr" | "preview";
  sessionInfo: MrSessionInfo | null;
  onSessionReady: (info: MrSessionInfo) => void;
  onSessionFailed: (reason: string) => void;
  onSessionEnd: () => void;
  events: MrSceneEvents;
}

export function MrScene({
  mode,
  sessionInfo,
  onSessionReady,
  onSessionFailed,
  onSessionEnd,
  events,
}: MrSceneProps) {
  const previewInput = useRef<PreviewInput>({
    ndc: new THREE.Vector2(),
    has: false,
    pressed: false,
    wheel: 0,
    keys: new Set<string>(),
  });
  const wrapRef = useRef<HTMLDivElement>(null);

  // preview keyboard (X = scissors spin)
  useEffect(() => {
    if (mode !== "preview") return;
    const keys = previewInput.current.keys;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "x") {
        keys.add("x");
        e.preventDefault();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "x") keys.delete("x");
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      keys.clear();
    };
  }, [mode]);

  const setNdc = useCallback((e: React.PointerEvent) => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    previewInput.current.ndc.set(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      -((e.clientY - r.top) / r.height) * 2 + 1
    );
    previewInput.current.has = true;
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!e.isPrimary) return;
      setNdc(e);
      previewInput.current.pressed = true;
    },
    [setNdc]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!e.isPrimary) return;
      setNdc(e);
    },
    [setNdc]
  );

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (!e.isPrimary) return;
    previewInput.current.pressed = false;
  }, []);

  const onWheel = useCallback((e: React.WheelEvent) => {
    previewInput.current.wheel += e.deltaY;
  }, []);

  const ready = mode === "preview" || !!sessionInfo;

  return (
    <div
      ref={wrapRef}
      className="absolute inset-0 touch-none"
      style={{ background: mode === "preview" ? "#01040a" : "transparent" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
      onContextMenu={(e) => e.preventDefault()}
    >
      <Canvas
        gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }}
        dpr={[1, 1.5]}
        camera={{ fov: 55, near: 0.02, far: 60, position: [0, 1.55, 0.55] }}
        onCreated={({ camera }) => camera.lookAt(0, 1.28, -0.35)}
        style={{ background: "transparent", position: "absolute", inset: 0 }}
      >
        {mode === "xr" && !sessionInfo ? (
          <SessionRequester onReady={onSessionReady} onFailed={onSessionFailed} />
        ) : null}
        {ready ? (
          <MrWorld
            mode={mode}
            sessionInfo={sessionInfo}
            events={events}
            previewInput={previewInput}
            onSessionEnd={onSessionEnd}
          />
        ) : null}
      </Canvas>
    </div>
  );
}

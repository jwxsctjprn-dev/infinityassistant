/**
 * HologramOS — runtime singleton.
 *
 * Per-frame mutable state shared by every part of the OS (head pose, hand
 * joints, pointers, battery, fps). Deliberately OUTSIDE React: the frame
 * loop writes plain numbers/vectors here so hover/pinch/drag never trigger
 * a re-render. React components read it inside useFrame or on low-frequency
 * ticks (1–2 Hz) only.
 */

import * as THREE from "three";

export interface RtHand {
  /** joints seen this frame (of 25) */
  count: number;
  /** thumb-tip ↔ index-tip distance in meters */
  pinchDist: number;
  /** hysteresis pinch state */
  pinch: boolean;
  /** last frame (rt.frame) this hand reported joints */
  lastSeenAt: number;
  /** index fingertip world position (valid when count > 0) */
  tip: THREE.Vector3;
  /** thumb-index midpoint world position */
  mid: THREE.Vector3;
  /** raw joint pool: name → world position (filled by the input manager) */
  joints: Map<string, THREE.Vector3>;
}

function makeHand(): RtHand {
  return {
    count: 0,
    pinchDist: 1,
    pinch: false,
    lastSeenAt: -1e9,
    tip: new THREE.Vector3(),
    mid: new THREE.Vector3(),
    joints: new Map(),
  };
}

export const rt = {
  /** head pose, written every frame from the XR viewer pose */
  headPos: new THREE.Vector3(0, 1.6, 0),
  headQuat: new THREE.Quaternion(),
  headFwd: new THREE.Vector3(0, 0, -1),
  /** monotonically increasing frame counter */
  frame: 0,
  /** exponential moving average fps (for HUD + vitals + terminal) */
  fps: 0,
  /** performance.now() when the XR session became active */
  sessionAt: 0,
  hands: {
    left: makeHand(),
    right: makeHand(),
  },
  battery: { level: null as number | null, charging: false },
  /** home view anchor (position + facing yaw), set at boot + on recenter */
  homeAnchor: {
    pos: new THREE.Vector3(0, 1.45, -2.1),
    yaw: 0,
    set: false,
  },
  /** live window groups keyed by window key — dragged/recentered imperatively */
  windowNodes: new Map<number, THREE.Group>(),
  /** last user interaction (mirrored to the E2E bridge) */
  lastAction: null as null | { type: string; target: string; at: number },
  /** cleared when a new session starts */
  resetForSession() {
    rt.frame = 0;
    rt.fps = 0;
    rt.sessionAt = performance.now();
    rt.hands.left.count = 0;
    rt.hands.right.count = 0;
    rt.hands.left.pinch = false;
    rt.hands.right.pinch = false;
    rt.hands.left.lastSeenAt = -1e9;
    rt.hands.right.lastSeenAt = -1e9;
    rt.windowNodes.clear();
    rt.lastAction = null;
    rt.homeAnchor.set = false;
  },
};

export type HandSide = "left" | "right";

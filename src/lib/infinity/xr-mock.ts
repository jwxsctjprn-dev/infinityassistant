/**
 * Infinity — DEV-ONLY WebXR mock (`?xrmock=1`).
 *
 * Simulates a Meta Quest 3 immersive-ar session closely enough to exercise
 * the REAL XR code path in a desktop browser (and in automated E2E):
 *   - navigator.xr.requestSession('immersive-ar') with local-floor + hit-test
 *   - three.js r185's classic XRWebGLLayer path (frames render to the visible
 *     canvas via a null framebuffer, so screenshots work)
 *   - two hand-tracked input sources with all 25 XR joints each
 *   - hit-test results at a controllable aim point
 *   - anchors, select-free joint pinching, session end events
 *
 * It is completely inert unless the URL has ?xrmock=1 AND the build is a
 * development build. Production never activates it.
 *
 * E2E driver: window.__xrMock
 *   .aim(x,y,z)        move the hit-test point (and both hand rays)
 *   .setHitValid(bool) toggle hit-test results
 *   .pinch('right'|'left', bool) open/close a joint pinch (fires scene press logic)
 *   .pose('right'|'left', name) set the whole hand pose preset:
 *                      'open' | 'pinch' | 'fist' | 'scissors' | 'point' —
 *                      drives the scene's gesture recognizers (fist grabs,
 *                      ✌ swipes, ☝ flicks/taps)
 *   .handSelect('right'|'left', bool) pinch that surfaces ONLY as select
 *                      events (joints stay open) — exercises the fallback
 *   .trigger('right'|'left', bool) controller select events
 *   .squeeze('right'|'left', bool) controller squeeze events
 *   .setControllers(bool) hold/release controllers (inputsourceschange)
 *   .setJointsReadable(bool) null out getJointPose (joints unreadable)
 *   .handAt(side,x,y,z) move a hand
 *   .controllerAt(side,x,y,z) move a controller (e.g. resting on a desk)
 *   .setHead(x,y,z,yawDeg) move the head/view
 *   .setDomOverlay(bool) pretend dom-overlay was granted
 *   .endSession()      end the XR session (fires 'end')
 */

import * as THREE from "three";

interface MockDriver {
  headPos: THREE.Vector3;
  headQuat: THREE.Quaternion;
  aim: THREE.Vector3;
  hitValid: boolean;
  domOverlay: boolean;
  /** controllers "held" (adds controller input sources + fires inputsourceschange) */
  controllers: boolean;
  /** when false, getJointPose returns null — hand joints unreadable (select fallback still works) */
  jointsReadable: boolean;
  hands: {
    left: { visible: boolean; pos: THREE.Vector3; pinch: number; curl: number; scissors: number; point: number };
    right: { visible: boolean; pos: THREE.Vector3; pinch: number; curl: number; scissors: number; point: number };
  };
  /** controller positions (moved via controllerAt — e.g. resting on a desk) */
  controllerPos: {
    left: THREE.Vector3;
    right: THREE.Vector3;
  };
}

interface MockTransform {
  position: { x: number; y: number; z: number };
  orientation: { x: number; y: number; z: number; w: number };
  matrix: Float32Array;
  inverse: { matrix: Float32Array };
}

const XR_JOINTS = [
  "wrist",
  "thumb-metacarpal",
  "thumb-phalanx-proximal",
  "thumb-phalanx-distal",
  "thumb-tip",
  "index-finger-metacarpal",
  "index-finger-phalanx-proximal",
  "index-finger-phalanx-intermediate",
  "index-finger-phalanx-distal",
  "index-finger-tip",
  "middle-finger-metacarpal",
  "middle-finger-phalanx-proximal",
  "middle-finger-phalanx-intermediate",
  "middle-finger-phalanx-distal",
  "middle-finger-tip",
  "ring-finger-metacarpal",
  "ring-finger-phalanx-proximal",
  "ring-finger-phalanx-intermediate",
  "ring-finger-phalanx-distal",
  "ring-finger-tip",
  "little-finger-metacarpal",
  "little-finger-phalanx-proximal",
  "little-finger-phalanx-intermediate",
  "little-finger-phalanx-distal",
  "little-finger-tip",
] as const;

function makeTransform(pos: THREE.Vector3, quat: THREE.Quaternion): MockTransform {
  const m = new THREE.Matrix4().compose(pos, quat, new THREE.Vector3(1, 1, 1));
  const inv = m.clone().invert();
  return {
    position: { x: pos.x, y: pos.y, z: pos.z },
    orientation: { x: quat.x, y: quat.y, z: quat.z, w: quat.w },
    matrix: new Float32Array(m.elements),
    inverse: { matrix: new Float32Array(inv.elements) },
  };
}

/** Position of a mock joint relative to its hand root.
 *  pinch: 0..1 closes thumb+index tips together.
 *  curl:  0..1 pulls all four fingertips toward the palm (fist).
 *  scissors: 0..1 extends index+middle, curls ring+pinky (✌).
 *  point: 0..1 extends the index alone (☝). */
function jointOffset(
  name: string,
  pinch: number,
  curl: number,
  scissors: number,
  point: number
): THREE.Vector3 {
  if (name === "wrist") return new THREE.Vector3(0, 0, 0);
  const idx = XR_JOINTS.indexOf(name as (typeof XR_JOINTS)[number]);
  if (idx <= 0) return new THREE.Vector3(0, 0.02, 0.02);
  const f = Math.floor((idx - 1) / 4); // finger 0..4
  const j = (idx - 1) % 4; // joint depth 0..3
  const lat = (f - 2) * 0.022;
  if (name === "thumb-tip") {
    return new THREE.Vector3(0, 0.1, 0.05).lerp(new THREE.Vector3(0, 0.08, 0.03), pinch);
  }
  // All five metacarpals sit in ONE flat knuckle row (same height/depth,
  // spread only sideways) — the fake hand reads PALM-DOWN-ish, which is
  // what the app's palm-basis code expects.
  if (name.endsWith("-metacarpal")) {
    return new THREE.Vector3(lat, 0.03, 0.02);
  }
  // default open-pose joint position
  let base = new THREE.Vector3(lat, 0.03 + j * 0.022, 0.02 - j * 0.006);
  if (name === "index-finger-tip") base = new THREE.Vector3(lat, 0.096, 0.002);
  if (name === "middle-finger-tip") base = new THREE.Vector3(lat, 0.096, 0.002);
  if (name === "ring-finger-tip") base = new THREE.Vector3(lat, 0.096, 0.002);
  if (name === "little-finger-tip") base = new THREE.Vector3(lat, 0.096, 0.002);
  // pinch closes thumb+index (index tip toward the thumb)
  if (name === "index-finger-tip") {
    base = base.clone().lerp(new THREE.Vector3(0, 0.08, 0.03), pinch);
  }
  // fist: all four fingertips curl toward the palm centre
  if (name.endsWith("-tip") && f >= 1) {
    base = base.clone().lerp(new THREE.Vector3(lat * 0.6, 0.045, 0.03), curl);
  }
  // scissors: index+middle straight up, ring+pinky curled
  if (name === "index-finger-tip" || name === "middle-finger-tip") {
    base = base.clone().lerp(new THREE.Vector3(lat, 0.105, 0.0), scissors);
  }
  if (name === "ring-finger-tip" || name === "little-finger-tip") {
    base = base.clone().lerp(new THREE.Vector3(lat * 0.5, 0.032, 0.02), scissors);
  }
  // point: index straight up, the rest curled (thumb stays clear)
  if (name === "index-finger-tip") {
    base = base.clone().lerp(new THREE.Vector3(lat, 0.108, 0.0), point);
  }
  if (name === "middle-finger-tip" || name === "ring-finger-tip" || name === "little-finger-tip") {
    base = base.clone().lerp(new THREE.Vector3(lat * 0.6, 0.045, 0.03), point);
  }
  return base;
}

let installed = false;

export function ensureXrMockInstalled(): void {
  if (installed) return;
  if (process.env.NODE_ENV === "production") return;
  if (typeof window === "undefined" || typeof navigator === "undefined") return;
  if (!window.location.search.includes("xrmock=1")) return;
  installed = true;
  installXrMock();
}

function installXrMock(): void {
  const driver: MockDriver = {
    headPos: new THREE.Vector3(0, 1.6, 0),
    headQuat: new THREE.Quaternion(),
    aim: new THREE.Vector3(0, 0.74, -0.9),
    hitValid: true,
    domOverlay: false,
    controllers: false,
    jointsReadable: true,
    hands: {
      // defaults are HELD at chest height — the palm palette floats above
      // the LEFT hand by default (handAt moves either hand anywhere)
      left: { visible: true, pos: new THREE.Vector3(-0.25, 1.3, -0.45), pinch: 0, curl: 0, scissors: 0, point: 0 },
      right: { visible: true, pos: new THREE.Vector3(0.25, 1.3, -0.45), pinch: 0, curl: 0, scissors: 0, point: 0 },
    },
    controllerPos: {
      left: new THREE.Vector3(-0.22, 1.18, -0.38),
      right: new THREE.Vector3(0.22, 1.18, -0.38),
    },
  };

  const listeners: Record<string, Set<(e: { type: string }) => void>> = {};
  const fire = (type: string, extra?: Record<string, unknown>) => {
    const ev = { type, ...(extra ?? {}) } as { type: string };
    for (const fn of listeners[type] ?? []) fn(ev);
  };
  const fireInput = (type: string, inputSource: unknown) => {
    fire(type, { inputSource, frame: null });
  };

  const refSpace = { type: "local-floor", getOffsetReferenceSpace: () => refSpace };
  const viewerSpace = { type: "viewer", getOffsetReferenceSpace: () => viewerSpace };

  // ---- input sources: two hands (joints) + toggleable controllers ----
  const makeHand = (side: "left" | "right") => {
    const joints = new Map<string, { jointName: string }>();
    for (const name of XR_JOINTS) joints.set(name, { jointName: name });
    return joints;
  };

  const identityQuat = new THREE.Quaternion();
  const flipQuat = new THREE.Quaternion();

  const handSources = [
    {
      handedness: "left",
      targetRayMode: "tracked-pointer",
      gripSpace: {},
      targetRaySpace: {},
      hand: makeHand("left"),
    },
    {
      handedness: "right",
      targetRayMode: "tracked-pointer",
      gripSpace: {},
      targetRaySpace: {},
      hand: makeHand("right"),
    },
  ];
  // controller sources appear when "held" (Quest adds them on wake)
  const controllerSources = (["left", "right"] as const).map((side) => ({
    handedness: side,
    targetRayMode: "tracked-pointer",
    gripSpace: {},
    targetRaySpace: {},
    hand: null,
  }));
  const inputSources: Array<{
    handedness: string;
    targetRayMode: string;
    gripSpace: unknown;
    targetRaySpace: { __pose?: MockTransform };
    hand: Map<string, { jointName: string }> | null;
  }> = [...handSources];

  // ---- the XRFrame built fresh for every rAF tick ----
  const projCamera = new THREE.PerspectiveCamera(60, 1, 0.02, 60);
  const makeFrame = () => {
    const headTransform = makeTransform(driver.headPos, driver.headQuat);
    const viewerPose = {
      views: [
        {
          eye: "none",
          viewSpace: {},
          projectionMatrix: new Float32Array(projCamera.projectionMatrix.elements),
          transform: headTransform,
        },
      ],
    };

    // hand ray: from the hand toward the aim point
    const handRayQuat = (side: "left" | "right") => {
      const h = driver.hands[side];
      const dir = driver.aim.clone().sub(h.pos).normalize();
      return flipQuat.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
    };
    (handSources[0].targetRaySpace as { __pose?: MockTransform }).__pose = makeTransform(
      driver.hands.left.pos,
      handRayQuat("left")
    );
    (handSources[1].targetRaySpace as { __pose?: MockTransform }).__pose = makeTransform(
      driver.hands.right.pos,
      handRayQuat("right")
    );
    // controllers (when held) also aim at the aim point from their positions
    for (const [i, side] of (["left", "right"] as const).entries()) {
      const held = driver.controllers;
      const cs = controllerSources[i];
      const pos = driver.controllerPos[side];
      const dir = driver.aim.clone().sub(pos).normalize();
      (cs.targetRaySpace as { __pose?: MockTransform }).__pose = makeTransform(
        pos,
        new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir)
      );
      if (held && !inputSources.includes(cs as never)) {
        inputSources.push(cs as never);
      } else if (!held) {
        const idx = inputSources.indexOf(cs as never);
        if (idx >= 0) inputSources.splice(idx, 1);
      }
    }

    const hitTransform = makeTransform(driver.aim, identityQuat);

    const frame = {
      session: null as unknown,
      getViewerPose: () => viewerPose,
      getPose: (space: { __pose?: MockTransform }) =>
        space && (space as { __pose?: MockTransform }).__pose
          ? { transform: (space as { __pose?: MockTransform }).__pose }
          : null,
      getJointPose: (joint: { jointName: string }, _ref: unknown) => {
        if (!driver.jointsReadable) return null;
        // which hand? both hands may share joint objects in theory — find
        // by scanning sources whose hand contains this joint
        for (const src of inputSources) {
          const hand = src.hand as Map<string, { jointName: string }> | null;
          if (!hand) continue; // controller sources have no joints
          let owns = false;
          for (const j of hand.values()) if (j === joint) owns = true;
          if (!owns) continue;
          const side = src.handedness as "left" | "right";
          const h = driver.hands[side];
          if (!h.visible) return null;
          const pos = h.pos.clone().add(jointOffset(joint.jointName, h.pinch, h.curl, h.scissors, h.point));
          return { transform: makeTransform(pos, identityQuat) };
        }
        return null;
      },
      getHitTestResults: () =>
        driver.hitValid
          ? [{ getPose: (_ref: unknown) => ({ transform: hitTransform }) }]
          : [],
      createAnchor: (pose: { position: unknown; orientation: unknown }) =>
        Promise.resolve({ anchorSpace: { __pose: pose as MockTransform } }),
      detectedPlanes: new Set(),
    };
    return frame;
  };

  // ---- the session ----
  let rafId = 0;
  // A real XR runtime stops delivering frames the moment session.end() is
  // called — even for callbacks re-registered from INSIDE the last frame
  // (which three.js does: it requests the next frame after the loop body
  // returns). Without this gate, ending the session from inside a frame
  // callback (e.g. the in-world EXIT button press) lets one more frame run
  // against three's torn-down XR state → uncaught
  // "Cannot read properties of null (reading 'getViewSubImage')".
  let ended = false;
  const session = {
    environmentBlendMode: "alpha-blend",
    interactionMode: "world-space",
    visibilityState: "visible",
    enabledFeatures: ["local-floor", "hit-test", "hand-tracking", "anchors"],
    renderState: {},
    inputSources,
    get domOverlayState() {
      return driver.domOverlay ? { type: "screen" } : undefined;
    },
    requestReferenceSpace: async (type: string) =>
      type === "viewer" ? viewerSpace : refSpace,
    requestHitTestSource: async () => ({ cancel: () => undefined }),
    updateRenderState: () => undefined,
    requestAnimationFrame: (cb: (t: number, frame: unknown) => void) => {
      if (ended) return 0; // real runtimes deliver no frames after end()
      rafId = window.requestAnimationFrame(() => cb(performance.now(), makeFrame()));
      return rafId;
    },
    cancelAnimationFrame: (id: number) => window.cancelAnimationFrame(id),
    end: async () => {
      ended = true;
      if (rafId) window.cancelAnimationFrame(rafId);
      fire("end");
    },
    addEventListener: (type: string, fn: (e: { type: string }) => void) => {
      (listeners[type] ??= new Set()).add(fn);
    },
    removeEventListener: (type: string, fn: (e: { type: string }) => void) => {
      listeners[type]?.delete(fn);
    },
  };

  // ---- XRWebGLLayer mock: null framebuffer → three renders to the visible
  //      canvas, so E2E screenshots actually show the headset's view ----
  (globalThis as { XRWebGLLayer?: unknown }).XRWebGLLayer = class XRWebGLLayerMock {
    framebuffer = null;
    framebufferWidth = 2048;
    framebufferHeight = 2048;
    ignoreDepthValues = false;
    constructor(
      _session: unknown,
      _gl: unknown,
      _init?: unknown
    ) {
      /* the default framebuffer is already XR-compatible here */
    }
    getViewport(_view: unknown) {
      return { x: 0, y: 0, width: 2048, height: 2048 };
    }
  };

  // three calls gl.makeXRCompatible() when the context wasn't created with
  // xrCompatible — resolve it (no XR device on desktop)
  const gl2Proto = (
    globalThis as unknown as {
      WebGL2RenderingContext?: { prototype: Record<string, unknown> };
    }
  ).WebGL2RenderingContext?.prototype;
  if (gl2Proto) gl2Proto.makeXRCompatible = () => Promise.resolve();

  const xrSystem = {
    isSessionSupported: async (mode: string) => mode === "immersive-ar",
    requestSession: async (mode: string) => {
      if (mode !== "immersive-ar") throw new Error("mock: only immersive-ar");
      // a new request is a new session lifecycle (the mock reuses one
      // session object; a real runtime would mint a fresh one)
      ended = false;
      rafId = 0;
      return session;
    },
  };
  Object.defineProperty(navigator, "xr", {
    configurable: true,
    get: () => xrSystem,
  });

  // ---- E2E driver ----
  const setControllers = (held: boolean) => {
    if (driver.controllers === held) return;
    driver.controllers = held;
    // sync the source list immediately (frames also keep it in sync) and
    // fire inputsourceschange like a real runtime
    for (const [i, cs] of controllerSources.entries()) {
      const idx = inputSources.indexOf(cs as never);
      if (held && idx < 0) inputSources.push(cs as never);
      if (!held && idx >= 0) inputSources.splice(idx, 1);
    }
    fire("inputsourceschange", {
      added: held ? controllerSources : [],
      removed: held ? [] : controllerSources,
    });
  };
  const controllerOf = (side: "left" | "right") =>
    controllerSources[side === "left" ? 0 : 1];
  const handOf = (side: "left" | "right") => handSources[side === "left" ? 0 : 1];

  (window as { __xrMock?: unknown }).__xrMock = {
    aim: (x: number, y: number, z: number) => driver.aim.set(x, y, z),
    setHitValid: (b: boolean) => {
      driver.hitValid = b;
    },
    pinch: (side: "left" | "right", closed: boolean) => {
      driver.hands[side].pinch = closed ? 1 : 0;
    },
    // whole-hand pose presets driving the scene's gesture recognizers
    pose: (side: "left" | "right", name: "open" | "pinch" | "fist" | "scissors" | "point") => {
      const h = driver.hands[side];
      h.pinch = name === "pinch" ? 1 : 0;
      h.curl = name === "fist" ? 1 : 0;
      h.scissors = name === "scissors" ? 1 : 0;
      h.point = name === "point" ? 1 : 0;
    },
    handAt: (side: "left" | "right", x: number, y: number, z: number) => {
      driver.hands[side].pos.set(x, y, z);
    },
    setHandVisible: (side: "left" | "right", b: boolean) => {
      driver.hands[side].visible = b;
    },
    controllerAt: (side: "left" | "right", x: number, y: number, z: number) => {
      driver.controllerPos[side].set(x, y, z);
    },
    setHead: (x: number, y: number, z: number, yawDeg = 0) => {
      driver.headPos.set(x, y, z);
      driver.headQuat.setFromEuler(new THREE.Euler(0, THREE.MathUtils.degToRad(yawDeg), 0));
    },
    setDomOverlay: (b: boolean) => {
      driver.domOverlay = b;
    },
    // controller trigger: selectstart → select → selectend (spec order)
    trigger: (side: "left" | "right", pressed: boolean) => {
      const src = controllerOf(side);
      if (pressed) {
        fireInput("selectstart", src);
      } else {
        fireInput("select", src);
        fireInput("selectend", src);
      }
    },
    // hand pinch that surfaces ONLY as select events (joints stay open) —
    // exercises the select-gesture pinch fallback
    handSelect: (side: "left" | "right", pressed: boolean) => {
      const src = handOf(side);
      if (pressed) {
        fireInput("selectstart", src);
      } else {
        fireInput("select", src);
        fireInput("selectend", src);
      }
    },
    // controller grip: squeezestart → squeeze → squeezeend
    squeeze: (side: "left" | "right", pressed: boolean) => {
      const src = controllerOf(side);
      if (pressed) {
        fireInput("squeezestart", src);
      } else {
        fireInput("squeeze", src);
        fireInput("squeezeend", src);
      }
    },
    setControllers: (b: boolean) => setControllers(b),
    setJointsReadable: (b: boolean) => {
      driver.jointsReadable = b;
    },
    endSession: () => session.end(),
    state: driver,
  };

  console.info(
    "[xr-mock] installed — window.__xrMock drives head/aim/pinch/trigger/handSelect/squeeze; frames render to the visible canvas"
  );
}

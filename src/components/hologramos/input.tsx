/**
 * HologramOS — spatial input system.
 *
 * One frame-loop manager owns ALL input:
 *  - reads the XR viewer pose (head) into rt every frame
 *  - reads hand joints for both hands (25 joints each) into rt
 *  - recognizes pinches (thumb-tip ↔ index-tip, hysteresis) per hand
 *  - builds pointers: hand rays (eye-through-fingertip) + direct-touch
 *    proximity (visionOS style) + a gaze/mouse fallback when no hands
 *    are tracked
 *  - drives hover (reticle glow, control scale-up) + press/release → click
 *  - drags whole windows by their title bar
 *  - renders the aiming reticle
 *
 * Interactables register themselves via useInteractable()/HoloButton.
 * Everything is imperative — no React re-renders in the frame loop.
 */

import {
  useEffect,
  useLayoutEffect,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { rt, type HandSide } from "@/lib/hologramos/runtime";
import { sound } from "@/lib/hologramos/sound";
import { recordAction, holoBridge } from "@/lib/hologramos/bridge";
import { HOLO, useSurface, holoText, panel } from "@/lib/hologramos/holo-canvas";

/* ------------------------------------------------------------------ */
/* Interactable registry                                               */
/* ------------------------------------------------------------------ */

export interface HoloHandlers {
  /** stable id used for the E2E bridge + hover bookkeeping */
  id: string;
  /** proximity radius in meters (direct touch) */
  hitRadius?: number;
  /** set by the input manager while a pointer aims at this control */
  hovered?: boolean;
  onClick?: (mesh: THREE.Mesh) => void;
  onDown?: (mesh: THREE.Mesh) => void;
  onEnter?: (mesh: THREE.Mesh) => void;
  onExit?: (mesh: THREE.Mesh) => void;
  /** set on title bars → pinching drags that window instead of clicking */
  dragWindow?: number;
}

const interactables = new Set<THREE.Mesh>();

/** Register a mesh as a hologram control. Handlers refresh every render. */
export function useInteractable(
  ref: RefObject<THREE.Mesh | null>,
  handlers: HoloHandlers
): void {
  const mounted = useRef(false);

  // refresh the live handlers after every render (never during render)
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    mesh.userData.holo = { ...mesh.userData.holo, ...handlers };
  });

  // registry membership is mount-scoped
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    mounted.current = true;
    interactables.add(mesh);
    return () => {
      interactables.delete(mesh);
      delete mesh.userData.holo;
    };
  }, []);
}

/* ------------------------------------------------------------------ */
/* HoloButton — the universal hologram control                         */
/* ------------------------------------------------------------------ */

export type ButtonVariant = "default" | "primary" | "danger" | "ghost";

export function HoloButton(props: {
  label: string;
  sub?: string;
  w: number;
  h: number;
  position: [number, number, number];
  onClick: () => void;
  variant?: ButtonVariant;
  active?: boolean;
  fontSize?: number;
  children?: ReactNode;
}): ReactNode {
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshBasicMaterial>(null);
  const PX = 460; // px per meter — crisp at arm's length
  const cw = Math.max(24, Math.round(props.w * PX));
  const ch = Math.max(24, Math.round(props.h * PX));

  const tex = useSurface(
    cw,
    ch,
    (ctx, w, h) => {
      const accent =
        props.variant === "danger"
          ? HOLO.danger
          : props.variant === "primary"
            ? HOLO.ice
            : HOLO.cyan;
      const on = props.active;
      panel(ctx, 3, 3, w - 6, h - 6, Math.min(w, h) * 0.22, {
        fill: on ? "rgba(34,211,238,0.16)" : "rgba(8,20,36,0.42)",
        stroke: on ? accent : HOLO.dim,
        lw: 2,
        glow: on ? 12 : 4,
      });
      const fs = props.fontSize ?? Math.round(h * 0.34);
      holoText(ctx, props.label, w / 2, props.sub ? h * 0.4 : h / 2, {
        size: fs,
        align: "center",
        color: on ? HOLO.ice : props.variant === "danger" ? HOLO.danger : HOLO.pale,
        spacing: 0.08,
        glow: on ? 8 : 2,
      });
      if (props.sub) {
        holoText(ctx, props.sub, w / 2, h * 0.72, {
          size: Math.round(h * 0.2),
          align: "center",
          color: HOLO.dim,
          spacing: 0.12,
        });
      }
    },
    [props.label, props.sub, props.variant, props.active]
  );

  useInteractable(meshRef, {
    id: `btn:${props.label.toLowerCase()}`,
    hitRadius: Math.max(props.w, props.h) / 2 + 0.038,
    onClick: () => {
      recordAction("click", `btn:${props.label.toLowerCase()}`);
      props.onClick();
    },
  });

  useFrame((_, dt) => {
    const mesh = meshRef.current;
    const mat = matRef.current;
    if (!mesh || !mat) return;
    const hovered = !!mesh.userData.holo?.hovered;
    const target = hovered ? 1.08 : 1;
    const k = 1 - Math.exp(-14 * dt);
    mesh.scale.x += (target - mesh.scale.x) * k;
    mesh.scale.y += (target - mesh.scale.y) * k;
    const targetOpacity = hovered ? 1 : 0.88;
    mat.opacity += (targetOpacity - mat.opacity) * k;
  });

  return (
    <mesh ref={meshRef} position={props.position} renderOrder={6}>
      <planeGeometry args={[props.w, props.h]} />
      {tex && (
        <meshBasicMaterial
          ref={matRef}
          map={tex}
          transparent
          opacity={0.88}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      )}
      {props.children}
    </mesh>
  );
}

/* ------------------------------------------------------------------ */
/* The frame-loop input manager                                         */
/* ------------------------------------------------------------------ */

interface PointerState {
  id: string;
  origin: THREE.Vector3;
  dir: THREE.Vector3;
  tip: THREE.Vector3 | null;
  pinchPoint: THREE.Vector3 | null;
  pinching: boolean;
  hit: THREE.Mesh | null;
  hitPoint: THREE.Vector3;
  pressed: THREE.Mesh | null;
  drag: { key: number; offset: THREE.Vector3 } | null;
}

function makePointer(id: string): PointerState {
  return {
    id,
    origin: new THREE.Vector3(),
    dir: new THREE.Vector3(0, 0, -1),
    tip: null,
    pinchPoint: null,
    pinching: false,
    hit: null,
    hitPoint: new THREE.Vector3(),
    pressed: null,
    drag: null,
  };
}

const PINCH_ON = 0.022; // meters thumb↔index → pressed
const PINCH_OFF = 0.042;
const RAY_MAX = 6;

export function InputManager({ session }: { session: XRSession }): ReactNode {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const pointers = useRef(new Map<string, PointerState>());
  const mouse = useRef({ x: 0, y: 0, down: false, seen: false });
  const selectFallback = useRef({ left: false, right: false });
  const reticleRef = useRef<THREE.Group>(null);
  const hoverSoundAt = useRef(0);
  const scratch = useRef({
    v1: new THREE.Vector3(),
    v2: new THREE.Vector3(),
    v3: new THREE.Vector3(),
    wp: new THREE.Vector3(),
    ray: new THREE.Raycaster(),
    meshes: [] as THREE.Mesh[],
  });

  /* mouse tracking for the gaze fallback pointer */
  useEffect(() => {
    const el = gl.domElement;
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      mouse.current.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      mouse.current.y = -(((e.clientY - r.top) / r.height) * 2 - 1);
      mouse.current.seen = true;
    };
    const down = () => {
      mouse.current.down = true;
    };
    const up = () => {
      mouse.current.down = false;
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointerup", up);
    return () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointerup", up);
    };
  }, [gl]);

  /* select/squeeze fallback for hands whose joints can't be read */
  useEffect(() => {
    const latch = (e: Event, pressed: boolean) => {
      const src = (e as Event & { inputSource?: XRInputSource }).inputSource;
      if (!src || !src.hand) return;
      const side: HandSide = src.handedness === "left" ? "left" : "right";
      selectFallback.current[side] = pressed;
    };
    const onStart = (e: Event) => latch(e, true);
    const onEnd = (e: Event) => latch(e, false);
    session.addEventListener("selectstart", onStart as EventListener);
    session.addEventListener("selectend", onEnd as EventListener);
    session.addEventListener("squeezestart", onStart as EventListener);
    session.addEventListener("squeezeend", onEnd as EventListener);
    return () => {
      session.removeEventListener("selectstart", onStart as EventListener);
      session.removeEventListener("selectend", onEnd as EventListener);
      session.removeEventListener("squeezestart", onStart as EventListener);
      session.removeEventListener("squeezeend", onEnd as EventListener);
    };
  }, [session]);

  useFrame((state, dt) => {
    const sc = scratch.current;
    const dtc = Math.min(dt, 0.1);
    rt.frame++;

    /* 1 — head pose -------------------------------------------------- */
    const frame = gl.xr.isPresenting ? gl.xr.getFrame() : null;
    const refSpace = gl.xr.getReferenceSpace();
    let headDone = false;
    if (frame && refSpace) {
      try {
        const vp = frame.getViewerPose(refSpace);
        if (vp) {
          const p = vp.transform.position;
          const o = vp.transform.orientation;
          rt.headPos.set(p.x, p.y, p.z);
          rt.headQuat.set(o.x, o.y, o.z, o.w);
          headDone = true;
        }
      } catch {
        /* fall through */
      }
    }
    if (!headDone) {
      rt.headPos.setFromMatrixPosition(camera.matrixWorld);
      rt.headQuat.setFromRotationMatrix(camera.matrixWorld);
    }
    rt.headFwd.set(0, 0, -1).applyQuaternion(rt.headQuat);

    if (rt.frame > 5 && dtc > 0) {
      rt.fps = rt.fps * 0.95 + (1 / dtc) * 0.05;
    }

    /* 2 — hand joints + pinch ---------------------------------------- */
    let handsSeen = 0;
    const now = performance.now();
    if (frame && refSpace) {
      for (const src of session.inputSources) {
        if (!src.hand) continue;
        const side: HandSide = src.handedness === "left" ? "left" : "right";
        const hand = rt.hands[side];
        let count = 0;
        let thumbTip: THREE.Vector3 | null = null;
        let indexTip: THREE.Vector3 | null = null;
        try {
          // XRHand is Map<XRHandJoint(name), XRJointSpace>
          for (const [jointName, jointSpace] of src.hand as unknown as Iterable<
            [string, XRJointSpace]
          >) {
            if (typeof jointName !== "string" || !jointName) continue;
            const pose = frame.getJointPose?.(jointSpace, refSpace) ?? null;
            if (!pose) continue;
            let v = hand.joints.get(jointName);
            if (!v) {
              v = new THREE.Vector3();
              hand.joints.set(jointName, v);
            }
            v.set(pose.transform.position.x, pose.transform.position.y, pose.transform.position.z);
            count++;
            if (jointName === "thumb-tip") thumbTip = v;
            if (jointName === "index-finger-tip") indexTip = v;
          }
        } catch {
          count = 0;
        }
        hand.count = count;
        if (count > 0) {
          handsSeen++;
          hand.lastSeenAt = rt.frame;
        }
        // pinch recognition with hysteresis (+ select fallback when no joints)
        const jointPinch =
          thumbTip !== null && indexTip !== null
            ? sc.v1.copy(thumbTip).sub(indexTip).length()
            : 1;
        hand.pinchDist = jointPinch;
        if (!hand.pinch && jointPinch < PINCH_ON) hand.pinch = true;
        else if (hand.pinch && jointPinch > PINCH_OFF) hand.pinch = false;
        if (count === 0 && selectFallback.current[side]) hand.pinch = true;
        if (count > 0) {
          if (indexTip) hand.tip.copy(indexTip);
          if (thumbTip && indexTip) hand.mid.copy(thumbTip).add(indexTip).multiplyScalar(0.5);
        }
      }
    }
    holoBridge.hands = handsSeen;
    holoBridge.fps = rt.fps;

    /* 3 — build the active pointer list -------------------------------- */
    const active: PointerState[] = [];
    let anyHandJoints = false;
    for (const side of ["left", "right"] as const) {
      const hand = rt.hands[side];
      if (hand.count > 0) {
        anyHandJoints = true;
        const p = pointers.current.get(`hand:${side}`) ?? makePointer(`hand:${side}`);
        pointers.current.set(`hand:${side}`, p);
        p.tip = hand.tip;
        p.pinchPoint = hand.mid;
        p.pinching = hand.pinch;
        p.origin.copy(hand.tip);
        // eye-through-fingertip aiming ray
        sc.v1.copy(hand.tip).sub(rt.headPos);
        if (sc.v1.lengthSq() < 0.0025) p.dir.copy(rt.headFwd);
        else p.dir.copy(sc.v1).normalize();
        active.push(p);
      } else {
        const p = pointers.current.get(`hand:${side}`);
        if (p) {
          p.tip = null;
          p.pinching = false;
        }
      }
    }
    // gaze/mouse fallback when hands haven't been seen for a while
    const handsLive = rt.frame - Math.max(rt.hands.left.lastSeenAt, rt.hands.right.lastSeenAt) < 120;
    if (!anyHandJoints && !handsLive) {
      const p = pointers.current.get("gaze") ?? makePointer("gaze");
      pointers.current.set("gaze", p);
      p.tip = null;
      p.pinchPoint = null;
      p.pinching = mouse.current.down;
      p.origin.copy(rt.headPos);
      // head-forward rotated by the mouse offset (simulated gaze)
      const yaw = -mouse.current.x * 0.55;
      const pitch = mouse.current.y * 0.38;
      p.dir.set(0, 0, -1);
      if (yaw !== 0) p.dir.applyAxisAngle(sc.v2.set(0, 1, 0), yaw);
      if (pitch !== 0) p.dir.applyAxisAngle(sc.v2.set(1, 0, 0), pitch);
      p.dir.applyQuaternion(rt.headQuat).normalize();
      active.push(p);
    }

    /* 4 — hit testing (proximity first, then ray) ---------------------- */
    sc.meshes.length = 0;
    for (const m of interactables) sc.meshes.push(m);
    for (const p of active) {
      let hitMesh: THREE.Mesh | null = null;
      let hitPoint: THREE.Vector3 | null = null;
      let hitDist = RAY_MAX;
      // direct touch: fingertip within the control's bubble
      if (p.tip) {
        let best = Infinity;
        for (const m of sc.meshes) {
          const h = m.userData.holo as HoloHandlers | undefined;
          if (!h) continue;
          const r = h.hitRadius ?? 0.06;
          m.getWorldPosition(sc.wp);
          const d2 = sc.wp.distanceToSquared(p.tip);
          if (d2 < r * r && d2 < best) {
            best = d2;
            hitMesh = m;
            hitPoint = sc.v3.copy(p.tip);
            hitDist = Math.sqrt(d2);
          }
        }
      }
      // ray (eye-through-finger or gaze)
      if (sc.meshes.length > 0) {
        sc.ray.set(p.origin, p.dir);
        sc.ray.far = RAY_MAX;
        const hits = sc.ray.intersectObjects(sc.meshes, false);
        const first = hits.find((h) => h.object instanceof THREE.Mesh);
        if (first && (!hitMesh || first.distance < hitDist + 0.05)) {
          hitMesh = first.object as THREE.Mesh;
          hitPoint = first.point.clone();
        }
      }
      // hover transitions
      const prevHit = p.hit;
      if (prevHit !== hitMesh) {
        if (prevHit) {
          const h = prevHit.userData.holo as HoloHandlers | undefined;
          if (h) {
            h.hovered = false;
            h.onExit?.(prevHit);
          }
        }
        if (hitMesh) {
          const h = hitMesh.userData.holo as HoloHandlers | undefined;
          if (h) {
            h.hovered = true;
            h.onEnter?.(hitMesh);
            if (now - hoverSoundAt.current > 90) {
              hoverSoundAt.current = now;
              sound.hover();
            }
          }
        }
      }
      p.hit = hitMesh;
      if (hitPoint) p.hitPoint.copy(hitPoint);
    }

    /* 5 — press / release edges ---------------------------------------- */
    for (const p of active) {
      if (p.pinching && !p.pressed) {
        // press begins
        const target = p.hit;
        if (target) {
          const h = target.userData.holo as HoloHandlers | undefined;
          if (h) {
            p.pressed = target;
            h.onDown?.(target);
            if (h.dragWindow !== undefined && p.pinchPoint) {
              const node = rt.windowNodes.get(h.dragWindow);
              if (node) {
                p.drag = {
                  key: h.dragWindow,
                  offset: node.position.clone().sub(p.pinchPoint),
                };
              }
            }
          }
        } else {
          p.pressed = null;
        }
      } else if (!p.pinching && p.pressed) {
        // release: click when the press target is still hovered
        const target = p.pressed;
        const h = target.userData.holo as HoloHandlers | undefined;
        if (h && p.hit === target && !p.drag) {
          recordAction("activate", h.id);
          h.onClick?.(target);
          if (h.onClick) sound.click();
        }
        if (p.drag) {
          recordAction("drop", `window:${p.drag.key}`);
          p.drag = null;
        }
        p.pressed = null;
      }
      // window dragging (imperative, no React)
      if (p.drag && p.pinchPoint) {
        const node = rt.windowNodes.get(p.drag.key);
        if (node) {
          sc.v1.copy(p.pinchPoint).add(p.drag.offset);
          sc.v2.copy(sc.v1).sub(rt.headPos);
          const dist = sc.v2.length();
          if (dist > 3.2) sc.v1.copy(rt.headPos).addScaledVector(sc.v2.normalize(), 3.2);
          else if (dist < 0.45) sc.v1.copy(rt.headPos).addScaledVector(sc.v2.normalize(), 0.45);
          sc.v1.y = THREE.MathUtils.clamp(sc.v1.y, 0.3, 2.4);
          node.position.lerp(sc.v1, 0.55);
        } else {
          p.drag = null;
        }
      }
    }

    /* 6 — bridge + reticle --------------------------------------------- */
    // the DOMINANT pointer is whichever hand is actually aiming at a control
    const primary = active.find((p) => p.hit) ?? active[0] ?? null;
    holoBridge.hover = primary?.hit
      ? ((primary.hit.userData.holo as HoloHandlers | undefined)?.id ?? null)
      : null;
    const reticle = reticleRef.current;
    if (reticle) {
      if (primary) {
        if (primary.hit) reticle.position.copy(primary.hitPoint);
        else reticle.position.copy(primary.origin).addScaledVector(primary.dir, 2.2);
      } else {
        reticle.position.copy(rt.headPos).addScaledVector(rt.headFwd, 2.2);
      }
      reticle.quaternion.copy(rt.headQuat);
      const hovered = !!primary?.hit;
      const pinching = !!primary?.pinching;
      const k = 1 - Math.exp(-16 * dtc);
      const target = pinching ? 0.6 : hovered ? 1.5 : 1;
      reticle.scale.x += (target - reticle.scale.x) * k;
      reticle.scale.y += (target - reticle.scale.y) * k;
      reticle.visible = true;
    }
  });

  return (
    <group ref={reticleRef} renderOrder={20}>
      <mesh renderOrder={20}>
        <ringGeometry args={[0.0125, 0.0165, 32]} />
        <meshBasicMaterial
          color={HOLO.cyan}
          transparent
          opacity={0.9}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      <mesh renderOrder={21}>
        <circleGeometry args={[0.004, 16]} />
        <meshBasicMaterial
          color={HOLO.ice}
          transparent
          opacity={0.95}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </group>
  );
}

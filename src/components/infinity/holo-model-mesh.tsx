"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { HoloPart, HoloSpec } from "@/lib/infinity/types";

function geometryFor(type: HoloPartType): THREE.BufferGeometry {
  switch (type) {
    case "sphere":
      return new THREE.SphereGeometry(1, 20, 14);
    case "cylinder":
      return new THREE.CylinderGeometry(1, 1, 2, 18);
    case "cone":
      return new THREE.ConeGeometry(1, 2, 18);
    case "torus":
      return new THREE.TorusGeometry(1, 0.4, 12, 28);
    case "capsule":
      return new THREE.CapsuleGeometry(0.7, 1.2, 6, 14);
    case "box":
    default:
      return new THREE.BoxGeometry(2, 2, 2);
  }
}
type HoloPartType = HoloPart["type"];

function PartMesh({ part }: { part: HoloPart }) {
  const geometry = useMemo(() => geometryFor(part.type), [part.type]);
  const color = useMemo(() => new THREE.Color(part.color), [part.color]);

  return (
    <group position={part.position} rotation={part.rotation} scale={part.scale}>
      {/* volumetric fill */}
      <mesh geometry={geometry}>
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.85}
          transparent
          opacity={0.16}
          roughness={0.35}
          metalness={0.1}
          depthWrite={false}
        />
      </mesh>
      {/* wireframe shell — the holographic read */}
      <mesh geometry={geometry} scale={1.003}>
        <meshBasicMaterial
          color={color}
          wireframe
          transparent
          opacity={0.5}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* True object bounds → screen-space overlay frame                      */
/* ------------------------------------------------------------------ */

/** The canvas is oversized to N× the card so resized holograms never crop. */
const CANVAS_OVERSIZE = 3;
/** NDC (-1..1 spans the canvas) → percentage of the CARD (canvas is centered). */
const NDC_TO_PCT = 50 * CANVAS_OVERSIZE;

/** Half extents of each unit geometry BEFORE part.scale is applied. */
const UNIT_HALF_EXTENTS: Record<HoloPartType, readonly [number, number, number]> = {
  box: [1, 1, 1],
  sphere: [1, 1, 1],
  cylinder: [1, 1, 1],
  cone: [1, 1, 1],
  torus: [1.4, 1.4, 0.4],
  capsule: [0.7, 1.3, 0.7],
};

/** Axis-aligned bounds of the whole spec in model space (all parts). */
function specCorners(spec: HoloSpec): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  const euler = new THREE.Euler();
  const quat = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const p = new THREE.Vector3();
  for (const part of spec.parts) {
    const h = UNIT_HALF_EXTENTS[part.type] ?? [1, 1, 1];
    euler.set(part.rotation[0], part.rotation[1], part.rotation[2]);
    quat.setFromEuler(euler);
    p.set(part.position[0], part.position[1], part.position[2]);
    for (let i = 0; i < 8; i++) {
      v.set(
        (i & 1 ? h[0] : -h[0]) * Math.abs(part.scale[0]),
        (i & 2 ? h[1] : -h[1]) * Math.abs(part.scale[1]),
        (i & 4 ? h[2] : -h[2]) * Math.abs(part.scale[2])
      )
        .applyQuaternion(quat)
        .add(p);
      out.push(v.clone());
    }
  }
  if (out.length === 0) {
    for (let i = 0; i < 8; i++) {
      out.push(
        new THREE.Vector3(i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1)
      );
    }
  }
  return out;
}

/** Deterministic centering + defensive canvas fill.
 *
 * R3F sizes the canvas via a transform-aware getBoundingClientRect ~50ms
 * after mount — if the card is mid-spawn-animation (framer-motion scale),
 * the canvas would be sized to the transient scale and anchored top-left,
 * offsetting the hologram. We delay mounting until the animation is done
 * (in ModelCard) and force the canvas to fill its container here as a
 * second line of defense.
 */
function CameraRig() {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    camera.lookAt(0, 0, 0);
    const c = gl.domElement;
    c.style.setProperty("width", "100%");
    c.style.setProperty("height", "100%");
  }, [camera, gl]);
  return null;
}

function SpecGroup({
  spec,
  rot,
  subtle,
  assembleMs,
  scale = 1,
  frameRef,
}: {
  spec: HoloSpec;
  rot: { x: number; y: number };
  subtle: boolean;
  assembleMs?: number;
  scale?: number;
  /** Overlay div that tracks the hologram's projected bounds (card-relative %). */
  frameRef?: RefObject<HTMLDivElement | null>;
}) {
  const group = useRef<THREE.Group>(null);
  // Timed assembly (fresh local builds) reveals parts one-by-one via state;
  // progressive AI builds GROW the spec live — their visible count is
  // derived directly (reveal starts at ∞ → everything present shows).
  const [reveal, setReveal] = useState(assembleMs ? 1 : Infinity);
  const visible = Math.min(reveal, spec.parts.length);

  // All part corners (model space) — projecting these each frame yields the
  // TIGHT silhouette bounds of the hologram, so the overlay frame hugs it.
  const corners = useMemo(() => specCorners(spec), [spec]);

  const tmp = useRef(new THREE.Vector3());
  const lastFrame = useRef({ l: -999, t: -999, w: -999, h: -999 });

  // Fresh builds assemble part-by-part: real, watchable construction.
  useEffect(() => {
    if (!assembleMs) return;
    const per = Math.max(40, assembleMs / spec.parts.length);
    const iv = setInterval(() => {
      setReveal((v) => {
        if (v >= spec.parts.length) {
          clearInterval(iv);
          return v;
        }
        return v + 1;
      });
    }, per);
    return () => clearInterval(iv);
  }, [assembleMs, spec.parts.length]);

  useFrame((state) => {
    if (!group.current) return;
    // user rotation + gentle idle bob (doesn't move the locked position)
    group.current.rotation.x = rot.x;
    group.current.rotation.y = rot.y;
    group.current.scale.setScalar(scale);
    group.current.position.y = subtle ? Math.sin(state.clock.elapsedTime * 0.8) * 0.035 : 0;

    // Project the model's true bounds through the camera → position the
    // overlay frame so controls always hug the ACTUAL object (they track
    // rotation and resize live).
    const el = frameRef?.current;
    if (el) {
      group.current.updateWorldMatrix(true, false);
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const c of corners) {
        tmp.current.copy(c).applyMatrix4(group.current.matrixWorld).project(state.camera);
        if (tmp.current.x < minX) minX = tmp.current.x;
        if (tmp.current.x > maxX) maxX = tmp.current.x;
        if (tmp.current.y < minY) minY = tmp.current.y;
        if (tmp.current.y > maxY) maxY = tmp.current.y;
      }
      const clamp = (v: number) => Math.max(-90, Math.min(190, v));
      let l = clamp(50 + NDC_TO_PCT * minX);
      let r = clamp(50 + NDC_TO_PCT * maxX);
      let t = clamp(50 - NDC_TO_PCT * maxY);
      let b = clamp(50 - NDC_TO_PCT * minY);
      if (r - l < 6) {
        const c = (l + r) / 2;
        l = c - 3;
        r = c + 3;
      }
      if (b - t < 6) {
        const c = (t + b) / 2;
        t = c - 3;
        b = c + 3;
      }
      const q = (x: number) => Math.round(x * 4) / 4;
      const lf = lastFrame.current;
      if (
        Math.abs(q(l) - lf.l) + Math.abs(q(t) - lf.t) +
          Math.abs(q(r - l) - lf.w) + Math.abs(q(b - t) - lf.h) >
        0.05
      ) {
        el.style.setProperty("left", `${q(l)}%`);
        el.style.setProperty("top", `${q(t)}%`);
        el.style.setProperty("width", `${q(r - l)}%`);
        el.style.setProperty("height", `${q(b - t)}%`);
        lastFrame.current = { l: q(l), t: q(t), w: q(r - l), h: q(b - t) };
      }
    }
  });
  return (
    <group ref={group}>
      {spec.parts.slice(0, visible).map((p, i) => (
        <PartMesh key={i} part={p} />
      ))}
    </group>
  );
}

/** One holographic model inside its own small transparent canvas.
 *
 * The canvas is oversized to 3× the card (inset -100%) with the camera
 * pulled back 3× (same fov) — so the hologram renders at its natural size
 * with plenty of headroom: even at the 2.5× resize limit (≈212% of the
 * card) nothing is ever cropped. The overhang stays pointer-events:none.
 * A default model fills ~85% of the card height.
 */
export function HoloModelMesh({
  spec,
  rot,
  scale = 1,
  subtleBob = true,
  assembleMs,
  frameRef,
}: {
  spec: HoloSpec;
  rot: { x: number; y: number };
  /** Uniform hologram scale (corner-handle resize). */
  scale?: number;
  subtleBob?: boolean;
  /** When set, parts appear one-by-one over this duration (fresh builds). */
  assembleMs?: number;
  /** Overlay div that tracks the hologram's projected bounds. */
  frameRef?: RefObject<HTMLDivElement | null>;
}) {
  return (
    <Canvas
      gl={{ alpha: true, antialias: true }}
      dpr={[1, 1.75]}
      camera={{ fov: 38, position: [0, 1.77, 11.65] }}
      style={{
        background: "transparent",
        position: "absolute",
        // Oversized 3× canvas centered on the card. Width/height must be
        // explicit — R3F's own width/height:100% defaults would otherwise
        // over-constrain the absolute box and defeat the inset.
        inset: "-100%",
        width: "300%",
        height: "300%",
        pointerEvents: "none",
      }}
    >
      <CameraRig />
      <ambientLight intensity={0.5} />
      <directionalLight position={[3, 5, 4]} intensity={1.1} color="#bfe3ff" />
      <SpecGroup
        spec={spec}
        rot={rot}
        subtle={subtleBob}
        assembleMs={assembleMs}
        scale={scale}
        frameRef={frameRef}
      />
    </Canvas>
  );
}

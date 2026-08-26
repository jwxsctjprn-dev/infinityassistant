"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
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

function SpecGroup({
  spec,
  rot,
  subtle,
  assembleMs,
}: {
  spec: HoloSpec;
  rot: { x: number; y: number };
  subtle: boolean;
  assembleMs?: number;
}) {
  const group = useRef<THREE.Group>(null);
  const [visible, setVisible] = useState(assembleMs ? 1 : spec.parts.length);

  // Fresh builds assemble part-by-part: real, watchable construction.
  useEffect(() => {
    if (!assembleMs) return;
    const per = Math.max(40, assembleMs / spec.parts.length);
    const iv = setInterval(() => {
      setVisible((v) => {
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
    group.current.position.y = subtle ? Math.sin(state.clock.elapsedTime * 0.8) * 0.035 : 0;
  });
  return (
    <group ref={group}>
      {spec.parts.slice(0, visible).map((p, i) => (
        <PartMesh key={i} part={p} />
      ))}
    </group>
  );
}

/** One holographic model inside its own small transparent canvas. */
export function HoloModelMesh({
  spec,
  rot,
  subtleBob = true,
  assembleMs,
}: {
  spec: HoloSpec;
  rot: { x: number; y: number };
  subtleBob?: boolean;
  /** When set, parts appear one-by-one over this duration (fresh builds). */
  assembleMs?: number;
}) {
  return (
    <Canvas
      gl={{ alpha: true, antialias: true }}
      dpr={[1, 1.75]}
      camera={{ fov: 38, position: [0, 0.7, 4.6] }}
      style={{ background: "transparent" }}
    >
      <ambientLight intensity={0.5} />
      <directionalLight position={[3, 5, 4]} intensity={1.1} color="#bfe3ff" />
      <SpecGroup spec={spec} rot={rot} subtle={subtleBob} assembleMs={assembleMs} />
    </Canvas>
  );
}

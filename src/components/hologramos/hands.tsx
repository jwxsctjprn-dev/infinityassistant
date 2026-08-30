/**
 * HologramOS — hand skeleton visualization.
 *
 * Draws each tracked hand as a glowing cyan wireframe (25 joints, 25 bones)
 * straight from the runtime joint pools the input manager fills every frame.
 * Purely visual — input works even when the skeleton is hidden in Settings.
 */

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, type ReactNode } from "react";
import * as THREE from "three";
import { rt } from "@/lib/hologramos/runtime";
import { useOs } from "@/lib/hologramos/store";
import { HOLO } from "@/lib/hologramos/holo-canvas";

/** Bone connections: wrist → metacarpals → finger chains. */
const BONES: Array<[string, string]> = [
  ["wrist", "thumb-metacarpal"],
  ["thumb-metacarpal", "thumb-phalanx-proximal"],
  ["thumb-phalanx-proximal", "thumb-phalanx-distal"],
  ["thumb-phalanx-distal", "thumb-tip"],
  ["wrist", "index-finger-metacarpal"],
  ["index-finger-metacarpal", "index-finger-phalanx-proximal"],
  ["index-finger-phalanx-proximal", "index-finger-phalanx-intermediate"],
  ["index-finger-phalanx-intermediate", "index-finger-phalanx-distal"],
  ["index-finger-phalanx-distal", "index-finger-tip"],
  ["wrist", "middle-finger-metacarpal"],
  ["middle-finger-metacarpal", "middle-finger-phalanx-proximal"],
  ["middle-finger-phalanx-proximal", "middle-finger-phalanx-intermediate"],
  ["middle-finger-phalanx-intermediate", "middle-finger-phalanx-distal"],
  ["middle-finger-phalanx-distal", "middle-finger-tip"],
  ["wrist", "ring-finger-metacarpal"],
  ["ring-finger-metacarpal", "ring-finger-phalanx-proximal"],
  ["ring-finger-phalanx-proximal", "ring-finger-phalanx-intermediate"],
  ["ring-finger-phalanx-intermediate", "ring-finger-phalanx-distal"],
  ["ring-finger-phalanx-distal", "ring-finger-tip"],
  ["wrist", "little-finger-metacarpal"],
  ["little-finger-metacarpal", "little-finger-phalanx-proximal"],
  ["little-finger-phalanx-proximal", "little-finger-phalanx-intermediate"],
  ["little-finger-phalanx-intermediate", "little-finger-phalanx-distal"],
  ["little-finger-phalanx-distal", "little-finger-tip"],
];

const JOINTS = [
  "wrist",
  "thumb-metacarpal", "thumb-phalanx-proximal", "thumb-phalanx-distal", "thumb-tip",
  "index-finger-metacarpal", "index-finger-phalanx-proximal", "index-finger-phalanx-intermediate", "index-finger-phalanx-distal", "index-finger-tip",
  "middle-finger-metacarpal", "middle-finger-phalanx-proximal", "middle-finger-phalanx-intermediate", "middle-finger-phalanx-distal", "middle-finger-tip",
  "ring-finger-metacarpal", "ring-finger-phalanx-proximal", "ring-finger-phalanx-intermediate", "ring-finger-phalanx-distal", "ring-finger-tip",
  "little-finger-metacarpal", "little-finger-phalanx-proximal", "little-finger-phalanx-intermediate", "little-finger-phalanx-distal", "little-finger-tip",
];

function HandSkeleton({ side }: { side: "left" | "right" }): ReactNode {
  const skeleton = useOs((s) => s.settings.skeleton);
  const lineRef = useRef<THREE.LineSegments>(null);
  const pointsRef = useRef<THREE.Points>(null);
  const pinchRef = useRef<THREE.Mesh>(null);

  const lineGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(BONES.length * 6), 3));
    return g;
  }, []);
  const pointGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(JOINTS.length * 3), 3));
    return g;
  }, []);

  useFrame(() => {
    const hand = rt.hands[side];
    const lines = lineRef.current;
    const pts = pointsRef.current;
    const live = hand.count > 0 && skeleton;
    if (lines) lines.visible = live;
    if (pts) pts.visible = live;
    if (!live) {
      if (pinchRef.current) pinchRef.current.visible = false;
      return;
    }
    const lp = lineGeo.getAttribute("position") as THREE.BufferAttribute;
    BONES.forEach(([a, b], i) => {
      const va = hand.joints.get(a);
      const vb = hand.joints.get(b);
      const o = i * 6;
      if (va && vb) {
        lp.array[o] = va.x; lp.array[o + 1] = va.y; lp.array[o + 2] = va.z;
        lp.array[o + 3] = vb.x; lp.array[o + 4] = vb.y; lp.array[o + 5] = vb.z;
      } else {
        lp.array[o] = lp.array[o + 1] = lp.array[o + 2] = 0;
        lp.array[o + 3] = lp.array[o + 4] = lp.array[o + 5] = 0;
      }
    });
    lp.needsUpdate = true;
    const pp = pointGeo.getAttribute("position") as THREE.BufferAttribute;
    JOINTS.forEach((name, i) => {
      const v = hand.joints.get(name);
      const o = i * 3;
      if (v) {
        pp.array[o] = v.x; pp.array[o + 1] = v.y; pp.array[o + 2] = v.z;
      } else {
        pp.array[o] = pp.array[o + 1] = pp.array[o + 2] = 0;
      }
    });
    pp.needsUpdate = true;
    // pinch point flash
    const pinch = pinchRef.current;
    if (pinch) {
      pinch.visible = hand.pinch;
      if (hand.pinch) {
        pinch.position.copy(hand.mid);
        const s = 1 + Math.sin(performance.now() * 0.02) * 0.15;
        pinch.scale.setScalar(s);
      }
    }
  });

  return (
    <group>
      <lineSegments ref={lineRef} geometry={lineGeo} renderOrder={15} frustumCulled={false}>
        <lineBasicMaterial
          color={HOLO.cyan}
          transparent
          opacity={0.42}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </lineSegments>
      <points ref={pointsRef} geometry={pointGeo} renderOrder={16} frustumCulled={false}>
        <pointsMaterial
          color={HOLO.ice}
          size={0.0075}
          sizeAttenuation
          transparent
          opacity={0.8}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
      <mesh ref={pinchRef} visible={false} renderOrder={17}>
        <sphereGeometry args={[0.013, 12, 12]} />
        <meshBasicMaterial
          color={HOLO.ice}
          transparent
          opacity={0.85}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </group>
  );
}

export function HandsLayer(): ReactNode {
  return (
    <group>
      <HandSkeleton side="left" />
      <HandSkeleton side="right" />
    </group>
  );
}

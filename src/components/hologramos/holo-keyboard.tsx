/**
 * HologramOS — holographic keyboard.
 *
 * A compact QWERTY (digits + 3 letter rows + utility row) floating inside
 * the host window. Keys fire on pinch-DOWN (instruments feel immediate),
 * with the shared key click sound and press ripples.
 */

import { useRef, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { sound } from "@/lib/hologramos/sound";
import { recordAction } from "@/lib/hologramos/bridge";
import { HOLO, useSurface, holoText, panel } from "@/lib/hologramos/holo-canvas";
import { useInteractable } from "./input";

export type HoloKey = string; // a char, or "BACK" | "ENTER"

const ROWS: string[][] = [
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
  ["z", "x", "c", "v", "b", "n", "m"],
];

function Key({
  label,
  display,
  position,
  w,
  h,
  onKey,
  variant,
}: {
  label: HoloKey;
  display?: string;
  position: [number, number, number];
  w: number;
  h: number;
  onKey: (k: HoloKey) => void;
  variant?: "util" | "wide";
}): ReactNode {
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshBasicMaterial>(null);
  const pressAt = useRef(0);
  const PX = 460;
  const cw = Math.round(w * PX);
  const chh = Math.round(h * PX);

  const tex = useSurface(
    cw,
    chh,
    (ctx, w2, h2) => {
      const util = variant !== undefined;
      panel(ctx, 2, 2, w2 - 4, h2 - 4, Math.min(w2, h2) * 0.2, {
        fill: util ? "rgba(34,211,238,0.08)" : "rgba(8,20,36,0.4)",
        stroke: util ? HOLO.dim : HOLO.ghost,
        lw: 2,
      });
      holoText(ctx, display ?? label, w2 / 2, h2 / 2, {
        size: Math.round(h2 * (util ? 0.3 : 0.42)),
        align: "center",
        color: util ? HOLO.cyan : HOLO.ice,
        spacing: 0.06,
      });
    },
    [label, variant]
  );

  useInteractable(meshRef, {
    id: `key:${label}`,
    hitRadius: Math.max(w, h) / 2 + 0.028,
    onDown: () => {
      pressAt.current = performance.now();
      sound.key();
      recordAction("key", label);
      onKey(label);
    },
  });

  useFrame(() => {
    const mesh = meshRef.current;
    const mat = matRef.current;
    if (!mesh || !mat) return;
    const pressed = performance.now() - pressAt.current < 140;
    const hovered = !!mesh.userData.holo?.hovered;
    const target = pressed ? 0.86 : hovered ? 1.08 : 1;
    const k = 0.25;
    mesh.scale.x += (target - mesh.scale.x) * k;
    mesh.scale.y += (target - mesh.scale.y) * k;
    mat.opacity += ((pressed ? 1 : hovered ? 0.98 : 0.85) - mat.opacity) * 0.2;
  });

  return (
    <mesh ref={meshRef} position={position} renderOrder={6}>
      <planeGeometry args={[w, h]} />
      {tex && (
        <meshBasicMaterial
          ref={matRef}
          map={tex}
          transparent
          opacity={0.85}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      )}
    </mesh>
  );
}

/** Total keyboard height for a given host window content width (meters). */
export function keyboardHeight(cw: number): number {
  const keyW = Math.min(0.058, (cw - 0.02) / 10 - 0.007);
  return 5 * (keyW * 0.86) + 4 * 0.008 + 0.002;
}

export function HoloKeyboard({
  cw,
  yTop,
  onKey,
}: {
  /** host window content width in meters */
  cw: number;
  /** top edge of the keyboard area (window-local, content group coords) */
  yTop: number;
  onKey: (k: HoloKey) => void;
}): ReactNode {
  const keyW = Math.min(0.058, (cw - 0.02) / 10 - 0.007);
  const keyH = keyW * 0.86;
  const gapX = 0.007;
  const gapY = 0.008;
  const utilH = keyH * 0.82;

  const rows = ROWS.map((row) => {
    const n = row.length;
    const width = n * keyW + (n - 1) * gapX;
    const x0 = -width / 2 + keyW / 2;
    return row.map((k, i) => ({ k, x: x0 + i * (keyW + gapX) }));
  });

  const y0 = yTop - keyH / 2;
  const y1 = y0 - (keyH + gapY);
  const y2 = y1 - (keyH + gapY);
  const y3 = y2 - (keyH + gapY);
  const y4 = y3 - (keyH + gapY) - 0.002;

  return (
    <group>
      {rows[0].map(({ k, x }) => (
        <Key key={k} label={k} position={[x, y0, 0]} w={keyW} h={keyH} onKey={onKey} />
      ))}
      {rows[1].map(({ k, x }) => (
        <Key key={k} label={k} position={[x, y1, 0]} w={keyW} h={keyH} onKey={onKey} />
      ))}
      {rows[2].map(({ k, x }) => (
        <Key key={k} label={k} position={[x, y2, 0]} w={keyW} h={keyH} onKey={onKey} />
      ))}
      {rows[3].map(({ k, x }) => (
        <Key key={k} label={k} position={[x, y3, 0]} w={keyW} h={keyH} onKey={onKey} />
      ))}
      {/* utility row: DEL · SPACE · . , - · ENTER */}
      <Key
        label="BACK"
        display="DEL"
        position={[-cw / 2 + 0.058, y4, 0]}
        w={0.088}
        h={utilH}
        onKey={onKey}
        variant="util"
      />
      <Key
        label=" "
        display="SPACE"
        position={[-0.012, y4, 0]}
        w={0.214}
        h={utilH}
        onKey={onKey}
        variant="wide"
      />
      {[".", ",", "-"].map((k, i) => (
        <Key
          key={k}
          label={k}
          position={[0.124 + i * 0.055, y4, 0]}
          w={0.048}
          h={utilH}
          onKey={onKey}
          variant="util"
        />
      ))}
      <Key
        label="ENTER"
        position={[cw / 2 - 0.062, y4, 0]}
        w={0.098}
        h={utilH}
        onKey={onKey}
        variant="util"
      />
    </group>
  );
}

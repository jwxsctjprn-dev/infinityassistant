/**
 * HologramOS — SONICS app.
 *
 * A real playable holographic instrument: eight pentatonic keys (WebAudio
 * oscillators with envelopes + harmonic layer), waveform selector, and
 * expanding ripple rings on every press.
 */

import { useRef, useState, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { sound } from "@/lib/hologramos/sound";
import { recordAction } from "@/lib/hologramos/bridge";
import { HOLO, useSurface, holoText } from "@/lib/hologramos/holo-canvas";
import { HoloButton, useInteractable } from "../input";
import type { AppProps } from "./registry";

const NOTES = [
  { label: "C", freq: 261.63 },
  { label: "D", freq: 293.66 },
  { label: "E", freq: 329.63 },
  { label: "G", freq: 392.0 },
  { label: "A", freq: 440.0 },
  { label: "C²", freq: 523.25 },
  { label: "D²", freq: 587.33 },
  { label: "E²", freq: 659.26 },
];

const WAVES: Array<{ id: OscillatorType; label: string }> = [
  { id: "sine", label: "SIN" },
  { id: "triangle", label: "TRI" },
  { id: "square", label: "SQR" },
];

function Ripple({ x }: { x: number }): ReactNode {
  const ref = useRef<THREE.Mesh>(null);
  const born = useRef(performance.now());
  useFrame(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const t = (performance.now() - born.current) / 600;
    if (t >= 1) {
      mesh.visible = false;
      return;
    }
    mesh.visible = true;
    const s = 0.5 + t * 2.2;
    mesh.scale.setScalar(s);
    (mesh.material as THREE.MeshBasicMaterial).opacity = 0.55 * (1 - t);
  });
  return (
    <mesh ref={ref} position={[x, 0, 0.004]} renderOrder={7}>
      <ringGeometry args={[0.052, 0.06, 40]} />
      <meshBasicMaterial
        color={HOLO.cyan}
        transparent
        opacity={0.5}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  );
}

function Pad({
  note,
  x,
  wave,
  onPlay,
}: {
  note: { label: string; freq: number };
  x: number;
  wave: OscillatorType;
  onPlay: () => void;
}): ReactNode {
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshBasicMaterial>(null);
  const pressAt = useRef(0);

  useInteractable(meshRef, {
    id: `pad:${note.label}`,
    hitRadius: 0.06,
    onDown: () => {
      pressAt.current = performance.now();
      sound.note(note.freq, 0.85, wave);
      recordAction("note", note.label);
      onPlay();
    },
  });

  useFrame(() => {
    const mesh = meshRef.current;
    const mat = matRef.current;
    if (!mesh || !mat) return;
    const pressed = performance.now() - pressAt.current < 160;
    const hovered = !!mesh.userData.holo?.hovered;
    const target = pressed ? 0.88 : hovered ? 1.07 : 1;
    const k = 0.28;
    mesh.scale.x += (target - mesh.scale.x) * k;
    mesh.scale.y += (target - mesh.scale.y) * k;
    mat.opacity += ((pressed ? 1 : hovered ? 0.95 : 0.8) - mat.opacity) * 0.25;
  });

  const PX = 460;
  const tex = useSurface(
    Math.round(0.062 * PX),
    Math.round(0.16 * PX),
    (ctx, w, h) => {
      // vertical key
      ctx.strokeStyle = HOLO.dim;
      ctx.lineWidth = 3;
      ctx.shadowColor = HOLO.cyan;
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.moveTo(10, 6);
      ctx.lineTo(w - 10, 6);
      ctx.lineTo(w - 8, h - 12);
      ctx.lineTo(8, h - 12);
      ctx.closePath();
      ctx.stroke();
      ctx.fillStyle = "rgba(8,20,36,0.4)";
      ctx.fill();
      ctx.shadowBlur = 0;
      holoText(ctx, note.label, w / 2, h * 0.2, {
        size: Math.round(h * 0.14),
        align: "center",
        color: HOLO.ice,
        spacing: 0.08,
      });
      holoText(ctx, `${Math.round(note.freq)}`, w / 2, h * 0.82, {
        size: Math.round(h * 0.09),
        align: "center",
        color: HOLO.dim,
        spacing: 0.05,
      });
      // center line
      ctx.strokeStyle = HOLO.ghost;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(w / 2, h * 0.32);
      ctx.lineTo(w / 2, h * 0.68);
      ctx.stroke();
    },
    [note.label]
  );

  return (
    <mesh ref={meshRef} position={[x, -0.01, 0]} renderOrder={6}>
      <planeGeometry args={[0.062, 0.16]} />
      {tex && (
        <meshBasicMaterial
          ref={matRef}
          map={tex}
          transparent
          opacity={0.8}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      )}
    </mesh>
  );
}

export function SonicsApp({ cw, ch }: AppProps): ReactNode {
  const [wave, setWave] = useState<OscillatorType>("sine");
  const [ripples, setRipples] = useState<number[]>([]);
  const rippleSeq = useRef(0);

  const play = () => {
    const id = rippleSeq.current++;
    setRipples((r) => [...r.slice(-5), id]);
  };

  const tex = useSurface(
    Math.round(cw * 1800),
    Math.round(ch * 1800),
    (ctx, w, h) => {
      holoText(ctx, "SONICS", 30, 30, { size: 26, color: HOLO.ice, spacing: 0.4, glow: 6 });
      holoText(ctx, wave.toUpperCase(), w - 30, 30, {
        size: 22,
        align: "right",
        color: HOLO.dim,
        spacing: 0.24,
      });
      // faint waveform backdrop
      ctx.strokeStyle = HOLO.ghost;
      ctx.lineWidth = 3;
      ctx.beginPath();
      const midY = h * 0.5;
      for (let x = 24; x < w - 24; x += 6) {
        const y =
          midY +
          Math.sin((x / w) * Math.PI * 8) * h * 0.16 * Math.sin((x / w) * Math.PI);
        if (x === 24) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    },
    [wave]
  );

  const keyXs = NOTES.map((_, i) => (i - (NOTES.length - 1) / 2) * 0.072);

  return (
    <group>
      {tex && (
        <mesh renderOrder={3}>
          <planeGeometry args={[cw, ch]} />
          <meshBasicMaterial
            map={tex}
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      )}
      {NOTES.map((note, i) => (
        <Pad key={note.label} note={note} x={keyXs[i]} wave={wave} onPlay={play} />
      ))}
      {ripples.map((id) => (
        <Ripple key={id} x={keyXs[id % NOTES.length]} />
      ))}
      {/* waveform selector */}
      {WAVES.map((wd, i) => (
        <HoloButton
          key={wd.id}
          label={wd.label}
          w={0.056}
          h={0.036}
          position={[-cw / 2 + 0.045 + i * 0.066, ch / 2 - 0.026, 0.004]}
          active={wave === wd.id}
          onClick={() => setWave(wd.id)}
        />
      ))}
    </group>
  );
}

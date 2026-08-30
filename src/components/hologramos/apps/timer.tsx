/**
 * HologramOS — TIMER app.
 *
 * A real countdown: depleting holographic ring, big mm:ss readout, presets,
 * start/pause/reset. Completion fires the chime and a flashing ring.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { sound } from "@/lib/hologramos/sound";
import { recordAction } from "@/lib/hologramos/bridge";
import { HOLO, useSurface, holoText, gauge } from "@/lib/hologramos/holo-canvas";
import { HoloButton } from "../input";
import type { AppProps } from "./registry";

type Phase = "idle" | "running" | "paused" | "done";

export function TimerApp({ cw, ch }: AppProps): ReactNode {
  const [phase, setPhase] = useState<Phase>("idle");
  const [duration, setDuration] = useState(5 * 60); // seconds
  const [rem, setRem] = useState(5 * 60); // seconds remaining
  const endAt = useRef(0);
  const [, forceTick] = useState(0);
  const chimed = useRef(false);

  useEffect(() => {
    if (phase !== "running") return;
    const iv = window.setInterval(() => {
      const left = Math.max(0, (endAt.current - performance.now()) / 1000);
      setRem(left);
      if (left <= 0) {
        setPhase("done");
        if (!chimed.current) {
          chimed.current = true;
          sound.chime();
          recordAction("timer", "complete");
        }
      }
      forceTick((t) => t + 1);
    }, 100);
    return () => window.clearInterval(iv);
  }, [phase]);

  const start = () => {
    if (phase === "running") {
      setPhase("paused");
      return;
    }
    const left = phase === "paused" ? rem : duration;
    endAt.current = performance.now() + left * 1000;
    setPhase("running");
  };

  const reset = () => {
    setPhase("idle");
    setRem(duration);
    chimed.current = false;
  };
  const setPreset = (m: number) => {
    setDuration(m * 60);
    setRem(m * 60);
    setPhase("idle");
    chimed.current = false;
  };

  const frac = duration > 0 ? rem / duration : 0;

  const mm = String(Math.floor(rem / 60)).padStart(2, "0");
  const ss = String(Math.floor(rem % 60)).padStart(2, "0");

  const PX = 1800;
  const tex = useSurface(
    Math.round(cw * PX),
    Math.round(ch * PX),
    (ctx, w, h) => {
      const cx = w / 2;
      const cy = h * 0.36;
      const r = Math.min(w, h) * 0.28;
      // track
      ctx.strokeStyle = HOLO.faint;
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      // remaining arc
      const from = -Math.PI / 2;
      const to = from + frac * Math.PI * 2;
      const col = phase === "done" ? HOLO.green : HOLO.cyan;
      if (frac > 0.002) gauge(ctx, cx, cy, r, from, to, col, 10, 14);
      // ticks
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
        ctx.strokeStyle = HOLO.ghost;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * (r + 22), cy + Math.sin(a) * (r + 22));
        ctx.lineTo(cx + Math.cos(a) * (r + 34), cy + Math.sin(a) * (r + 34));
        ctx.stroke();
      }
      // readout
      holoText(ctx, `${mm}:${ss}`, cx, cy - 8, {
        size: 84,
        align: "center",
        color: phase === "done" ? HOLO.green : HOLO.ice,
        spacing: 0.06,
        glow: 18,
      });
      holoText(
        ctx,
        phase === "idle"
          ? "READY"
          : phase === "running"
            ? "RUNNING"
            : phase === "paused"
              ? "PAUSED"
              : "COMPLETE",
        cx,
        cy + 46,
        { size: 24, align: "center", color: phase === "done" ? HOLO.green : HOLO.dim, spacing: 0.4, glow: phase === "done" ? 10 : 0 }
      );
    },
    [mm, ss, frac, phase]
  );

  // done-state ring pulse (imperative)
  const ringRef = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    const ring = ringRef.current;
    if (!ring) return;
    ring.visible = phase === "done";
    if (phase === "done") {
      const p = 0.5 + 0.5 * Math.sin(state.clock.elapsedTime * 6);
      const m = ring.material as THREE.MeshBasicMaterial;
      m.opacity = 0.25 + 0.35 * p;
      ring.scale.setScalar(1 + p * 0.12);
    }
  });

  const presets = [1, 3, 5, 10, 25];
  const btnY = -ch / 2 + 0.052;
  const rowY = -0.1;

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
      {/* done flash ring (aligned to the canvas dial) */}
      <mesh ref={ringRef} visible={false} position={[0, ch / 2 - ch * 0.36, 0.001]} renderOrder={4}>
        <ringGeometry args={[Math.min(cw, ch) * 0.265, Math.min(cw, ch) * 0.295, 48]} />
        <meshBasicMaterial
          color={HOLO.green}
          transparent
          opacity={0.3}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      {/* presets */}
      {presets.map((m, i) => (
        <HoloButton
          key={m}
          label={`${m}`}
          sub="MIN"
          w={0.058}
          h={0.062}
          position={[(-0.16 + i * 0.08) * (cw / 0.54), rowY, 0.004]}
          active={duration === m * 60 && phase === "idle"}
          onClick={() => setPreset(m)}
        />
      ))}
      {/* controls */}
      <HoloButton
        label={phase === "running" ? "PAUSE" : "START"}
        w={0.12}
        h={0.055}
        position={[-0.075, btnY, 0.004]}
        variant="primary"
        active={phase === "running"}
        onClick={start}
      />
      <HoloButton
        label="RESET"
        w={0.12}
        h={0.055}
        position={[0.075, btnY, 0.004]}
        onClick={reset}
      />
    </group>
  );
}

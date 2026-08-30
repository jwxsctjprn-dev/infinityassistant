/**
 * HologramOS — boot sequence.
 *
 * Arc-reactor spin-up: counter-rotating rings snap in around a pulsing core,
 * the wordmark resolves, boot lines tick through, then the OS hands control
 * to the home view. ~3.4s, skippable by pinching (tapping) anywhere.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useOs } from "@/lib/hologramos/store";
import { rt } from "@/lib/hologramos/runtime";
import { sound } from "@/lib/hologramos/sound";
import { HOLO, useSurface, holoText } from "@/lib/hologramos/holo-canvas";
import { useInteractable } from "./input";

const BOOT_MS = 3400;
const LINES = ["OPTICS ONLINE", "HAND TELEMETRY LINKED", "SPATIAL CORE STABLE", "WELCOME BACK"];

function Wordmark(): ReactNode {
  const tex = useSurface(
    1024,
    300,
    (ctx, w, h) => {
      holoText(ctx, "HOLOGRAM OS", w / 2, h * 0.38, {
        size: 74,
        align: "center",
        color: HOLO.ice,
        spacing: 0.42,
        glow: 18,
      });
      holoText(ctx, "SYSTEM 2.2 · SUIT FORGE", w / 2, h * 0.68, {
        size: 22,
        align: "center",
        color: HOLO.dim,
        spacing: 0.5,
      });
    },
    []
  );
  if (!tex) return null;
  return (
    <mesh position={[0, 0.14, 0.004]} renderOrder={7}>
      <planeGeometry args={[0.62, 0.181]} />
      <meshBasicMaterial
        map={tex}
        transparent
        opacity={0.95}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  );
}

function BootLines({ tick }: { tick: number }): ReactNode {
  const tex = useSurface(
    700,
    200,
    (ctx, w, h) => {
      const shown = Math.min(LINES.length, Math.max(0, Math.floor(tick) + 1));
      for (let i = 0; i < shown; i++) {
        const alpha = i === shown - 1 ? HOLO.pale : HOLO.dim;
        holoText(ctx, `▸ ${LINES[i]}`, w / 2, 26 + i * 44, {
          size: 21,
          align: "center",
          color: alpha,
          spacing: 0.24,
          glow: i === shown - 1 ? 8 : 0,
        });
      }
    },
    [tick]
  );
  if (!tex) return null;
  return (
    <mesh position={[0, -0.235, 0.004]} renderOrder={7}>
      <planeGeometry args={[0.42, 0.12]} />
      <meshBasicMaterial
        map={tex}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  );
}

function Progress({ frac }: { frac: number }): ReactNode {
  const tex = useSurface(
    640,
    24,
    (ctx, w, h) => {
      ctx.fillStyle = HOLO.faint;
      ctx.fillRect(0, h / 2 - 1.5, w, 3);
      if (frac > 0.005) {
        ctx.fillStyle = HOLO.cyan;
        ctx.shadowColor = HOLO.cyan;
        ctx.shadowBlur = 10;
        ctx.fillRect(0, h / 2 - 1.5, w * frac, 3);
        ctx.shadowBlur = 0;
      }
    },
    [Math.round(frac * 60)]
  );
  if (!tex) return null;
  return (
    <mesh position={[0, -0.335, 0.004]} renderOrder={7}>
      <planeGeometry args={[0.38, 0.014]} />
      <meshBasicMaterial
        map={tex}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  );
}

export function BootSequence(): ReactNode {
  const bootDone = useOs((s) => s.bootDone);
  const [tick, setTick] = useState(0);
  const [frac, setFrac] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const [gone, setGone] = useState(false);
  const groupRef = useRef<THREE.Group>(null);
  const ringA = useRef<THREE.Mesh>(null);
  const ringB = useRef<THREE.Mesh>(null);
  const ringC = useRef<THREE.Mesh>(null);
  const core = useRef<THREE.Mesh>(null);
  const skipRef = useRef<THREE.Mesh>(null);
  const t0 = useRef(performance.now());
  const leavingAt = useRef(0);
  const anchored = useRef(false);

  const finish = () => {
    if (leaving || gone) return;
    leavingAt.current = performance.now();
    setLeaving(true);
    window.setTimeout(() => setGone(true), 330);
    window.setTimeout(() => bootDone(), 120);
  };

  useEffect(() => {
    sound.boot();
    const iv = window.setInterval(() => {
      const t = performance.now() - t0.current;
      setTick(Math.floor(t / (BOOT_MS / LINES.length)));
      setFrac(Math.min(1, t / BOOT_MS));
    }, 60);
    const to = window.setTimeout(finish, BOOT_MS);
    return () => {
      window.clearInterval(iv);
      window.clearTimeout(to);
    };
  }, []);

  // anchor the boot composition in front of the head — on the FIRST frame,
  // after the input manager has written the real viewer pose into rt.
  useFrame((_, dt) => {
    const g = groupRef.current;
    if (g && !anchored.current) {
      anchored.current = true;
      const fwd = rt.headFwd;
      g.position.set(rt.headPos.x + fwd.x * 1.55, rt.headPos.y - 0.02, rt.headPos.z + fwd.z * 1.55);
      g.rotation.y = Math.atan2(rt.headPos.x - g.position.x, rt.headPos.z - g.position.z);
    }
    const t = (performance.now() - t0.current) / 1000;
    if (ringA.current) ringA.current.rotation.z += dt * 1.4;
    if (ringB.current) ringB.current.rotation.z -= dt * 0.9;
    if (ringC.current) ringC.current.rotation.z += dt * 0.45;
    if (g) {
      // snap-in scale, then slow breathing, then leave fade
      const inS = Math.min(1, t / 0.45);
      const ease = 1 - Math.pow(1 - inS, 3);
      const breathe = 1 + Math.sin(t * 2.1) * 0.006;
      let s = ease * breathe;
      let op = 1;
      if (leaving) {
        const f = Math.max(0, 1 - (performance.now() - leavingAt.current) / 300);
        s *= f;
        op = f;
      }
      g.scale.setScalar(Math.max(0.0001, s));
      g.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | undefined;
        if (m && "opacity" in m) {
          (m as THREE.MeshBasicMaterial).opacity = 0.95 * op;
        }
      });
    }
    if (core.current) {
      const p = 1 + Math.sin(t * 6.5) * 0.14;
      core.current.scale.setScalar(p);
    }
  });

  // pinch anywhere to skip
  useInteractable(skipRef, {
    id: "boot:skip",
    hitRadius: 0.6,
    onClick: finish,
  });

  if (gone) return null;

  return (
    <group ref={groupRef}>
      {/* skip zone — invisible but raycastable */}
      <mesh ref={skipRef} position={[0, -0.05, -0.01]} renderOrder={0}>
        <planeGeometry args={[1.6, 1.1]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {/* arc-reactor rings */}
      <mesh ref={ringA} position={[0, 0.02, 0]} renderOrder={5}>
        <torusGeometry args={[0.145, 0.0032, 8, 72]} />
        <meshBasicMaterial
          color={HOLO.cyan}
          transparent
          opacity={0.9}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      <mesh ref={ringB} position={[0, 0.02, 0]} renderOrder={5}>
        <torusGeometry args={[0.185, 0.002, 8, 72]} />
        <meshBasicMaterial
          color={HOLO.cyanSoft}
          transparent
          opacity={0.55}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      <mesh ref={ringC} position={[0, 0.02, 0]} renderOrder={5}>
        <torusGeometry args={[0.235, 0.0014, 8, 72]} />
        <meshBasicMaterial
          color={HOLO.cyan}
          transparent
          opacity={0.3}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      <mesh ref={core} position={[0, 0.02, 0]} renderOrder={6}>
        <circleGeometry args={[0.052, 32]} />
        <meshBasicMaterial
          color={HOLO.ice}
          transparent
          opacity={0.5}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      <Wordmark />
      <BootLines tick={tick} />
      <Progress frac={frac} />
    </group>
  );
}

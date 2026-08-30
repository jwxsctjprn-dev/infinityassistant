/**
 * HologramOS — HUD chrome.
 *
 *  - StatusBar : head-following (damped) top strip — wordmark, clock,
 *                battery, hand-tracking state. Redraws 1 Hz.
 *  - HomeOrb   : the visionOS-style home control — an arc-reactor ring at
 *                the bottom of view; pinching it closes all windows and
 *                returns to the app grid. Glows brighter while apps run.
 *  - Ambient   : a faint field of drifting dust motes around the user
 *                (toggle in Settings). Depth cue + Iron Man lab feel.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { rt } from "@/lib/hologramos/runtime";
import { useOs } from "@/lib/hologramos/store";
import { sound } from "@/lib/hologramos/sound";
import { recordAction } from "@/lib/hologramos/bridge";
import { HOLO, useSurface, holoText, fmtUptime } from "@/lib/hologramos/holo-canvas";
import { useInteractable } from "./input";

/* ------------------------------------------------------------------ */
/* Status bar                                                          */
/* ------------------------------------------------------------------ */

function StatusBar(): ReactNode {
  const groupRef = useRef<THREE.Group>(null);
  const [tick, setTick] = useState(0);
  const windowsOpen = useOs((s) => s.windows.length > 0);

  useEffect(() => {
    const iv = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(iv);
  }, []);

  const tex = useSurface(
    1280,
    120,
    (ctx, w, h) => {
      const now = new Date();
      const time = now.toLocaleTimeString([], { hour12: false });
      holoText(ctx, "HOLOGRAM OS", 30, h / 2, {
        size: 26,
        color: HOLO.dim,
        spacing: 0.38,
      });
      holoText(ctx, time, w / 2, h / 2, {
        size: 44,
        align: "center",
        color: HOLO.ice,
        spacing: 0.12,
        glow: 10,
      });
      // battery
      const b = rt.battery;
      const btxt = b.level === null ? "PWR —" : `PWR ${Math.round(b.level * 100)}%`;
      holoText(ctx, btxt, w - 30, h / 2 - 14, {
        size: 24,
        align: "right",
        color: HOLO.pale,
        spacing: 0.1,
      });
      const bw = 84;
      const bx = w - 30 - bw;
      ctx.strokeStyle = HOLO.dim;
      ctx.lineWidth = 2;
      ctx.strokeRect(bx, h / 2 + 6, bw, 12);
      const lvl = b.level ?? 0.5;
      ctx.fillStyle = lvl < 0.2 ? HOLO.danger : HOLO.cyan;
      ctx.fillRect(bx + 2, h / 2 + 8, (bw - 4) * lvl, 8);
      // hands state
      const hands = rt.hands.left.count > 0 || rt.hands.right.count > 0;
      holoText(ctx, hands ? "HANDS LOCKED" : "NO HANDS", w - 30 - bw - 24, h / 2 - 14, {
        size: 24,
        align: "right",
        color: hands ? HOLO.cyan : HOLO.amber,
        spacing: 0.14,
      });
      holoText(ctx, fmtUptime(performance.now() - rt.sessionAt), w - 30 - bw - 24, h / 2 + 14, {
        size: 20,
        align: "right",
        color: HOLO.dim,
        spacing: 0.12,
      });
      // center underline tick
      ctx.fillStyle = windowsOpen ? HOLO.cyan : HOLO.faint;
      ctx.fillRect(w / 2 - 26, h - 16, 52, 2);
    },
    [tick, windowsOpen]
  );

  useFrame((_, dt) => {
    const g = groupRef.current;
    if (!g) return;
    // damped head-follow: always comfortably in view, never snappy
    const fwd = rt.headFwd;
    const tx = rt.headPos.x + fwd.x * 1.5;
    const ty = rt.headPos.y + 0.42;
    const tz = rt.headPos.z + fwd.z * 1.5;
    const k = 1 - Math.exp(-7 * Math.min(dt, 0.1));
    g.position.x += (tx - g.position.x) * k;
    g.position.y += (ty - g.position.y) * k;
    g.position.z += (tz - g.position.z) * k;
    g.rotation.y = Math.atan2(rt.headPos.x - g.position.x, rt.headPos.z - g.position.z);
  });

  if (!tex) return null;
  return (
    <group ref={groupRef} position={[0, 2.02, -1.5]}>
      <mesh renderOrder={8}>
        <planeGeometry args={[0.66, 0.062]} />
        <meshBasicMaterial
          map={tex}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Home orb                                                            */
/* ------------------------------------------------------------------ */

function HomeOrb(): ReactNode {
  const closeAll = useOs((s) => s.closeAll);
  const windowsOpen = useOs((s) => s.windows.length > 0);
  const groupRef = useRef<THREE.Group>(null);
  const hitRef = useRef<THREE.Mesh>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const coreRef = useRef<THREE.Mesh>(null);
  const labelRef = useRef<THREE.Mesh>(null);
  const labelMat = useRef<THREE.MeshBasicMaterial>(null);

  const labelTex = useSurface(
    360,
    110,
    (ctx, w, h) => {
      holoText(ctx, windowsOpen ? "HOME" : "HOME VIEW", w / 2, h / 2, {
        size: 34,
        align: "center",
        color: HOLO.dim,
        spacing: 0.4,
      });
    },
    [windowsOpen]
  );

  useInteractable(hitRef, {
    id: "hud:home",
    hitRadius: 0.085,
    onClick: () => {
      recordAction("click", "hud:home");
      closeAll();
    },
  });

  useFrame((state, dt) => {
    const g = groupRef.current;
    if (!g) return;
    const fwd = rt.headFwd;
    const tx = rt.headPos.x + fwd.x * 1.32;
    const ty = rt.headPos.y - 0.5;
    const tz = rt.headPos.z + fwd.z * 1.32;
    const k = 1 - Math.exp(-7 * Math.min(dt, 0.1));
    g.position.x += (tx - g.position.x) * k;
    g.position.y += (ty - g.position.y) * k;
    g.position.z += (tz - g.position.z) * k;
    g.rotation.y = Math.atan2(rt.headPos.x - g.position.x, rt.headPos.z - g.position.z);

    const t = state.clock.elapsedTime;
    const hovered = !!hitRef.current?.userData.holo?.hovered;
    // breathe + brighten when apps are open or hovered
    const target = windowsOpen || hovered ? 1.5 : 1;
    if (ringRef.current) {
      ringRef.current.rotation.z += dt * (windowsOpen ? 0.8 : 0.25);
      const s = (1 + Math.sin(t * 2.4) * 0.05) * (hovered ? 1.25 : 1);
      ringRef.current.scale.setScalar(s);
      const m = ringRef.current.material as THREE.MeshBasicMaterial;
      m.opacity = 0.45 * target;
    }
    if (coreRef.current) {
      const m = coreRef.current.material as THREE.MeshBasicMaterial;
      m.opacity = 0.25 + 0.2 * (0.5 + 0.5 * Math.sin(t * 3.1)) * target;
      coreRef.current.scale.setScalar(1 + Math.sin(t * 3.1) * 0.08);
    }
    if (labelMat.current) {
      labelMat.current.opacity += ((windowsOpen || hovered ? 0.95 : 0.55) - labelMat.current.opacity) * k;
    }
  });

  return (
    <group ref={groupRef} position={[0, 1.1, -1.32]}>
      {/* generous invisible hit zone */}
      <mesh ref={hitRef} renderOrder={9}>
        <circleGeometry args={[0.052, 24]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <mesh ref={ringRef} renderOrder={9}>
        <torusGeometry args={[0.042, 0.0035, 8, 48]} />
        <meshBasicMaterial
          color={HOLO.cyan}
          transparent
          opacity={0.45}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      <mesh ref={coreRef} renderOrder={9}>
        <circleGeometry args={[0.022, 24]} />
        <meshBasicMaterial
          color={HOLO.ice}
          transparent
          opacity={0.4}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      {labelTex && (
        <mesh ref={labelRef} position={[0, -0.075, 0]} renderOrder={9}>
          <planeGeometry args={[0.14, 0.043]} />
          <meshBasicMaterial
            ref={labelMat}
            map={labelTex}
            transparent
            opacity={0.55}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      )}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Ambient particles                                                   */
/* ------------------------------------------------------------------ */

function Ambient(): ReactNode {
  const on = useOs((s) => s.settings.particles);
  const ref = useRef<THREE.Points>(null);
  const geo = useRef<THREE.BufferGeometry | null>(null);

  if (!geo.current) {
    const N = 140;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      // shell around the head: 0.7–2.4 m, mostly in front/above
      const r = 0.7 + Math.random() * 1.7;
      const a = Math.random() * Math.PI * 2;
      const y = 0.4 + Math.random() * 1.8;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = Math.sin(a) * r * 0.7 - 0.5;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.current = g;
  }

  useFrame((state) => {
    const pts = ref.current;
    if (!pts) return;
    pts.visible = on;
    if (!on) return;
    // slow drift around the user
    const t = state.clock.elapsedTime;
    pts.rotation.y = t * 0.012;
    pts.position.set(rt.headPos.x, 0, rt.headPos.z);
    const m = pts.material as THREE.PointsMaterial;
    m.opacity = 0.16 + 0.08 * Math.sin(t * 0.7);
  });

  return (
    <points ref={ref} geometry={geo.current} renderOrder={0} frustumCulled={false}>
      <pointsMaterial
        color={HOLO.cyan}
        size={0.009}
        sizeAttenuation
        transparent
        opacity={0.2}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

export function Hud(): ReactNode {
  return (
    <group>
      <StatusBar />
      <HomeOrb />
      <Ambient />
    </group>
  );
}

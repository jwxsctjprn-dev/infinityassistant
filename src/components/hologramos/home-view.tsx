/**
 * HologramOS — home view (the visionOS app grid, holographic).
 *
 * A large clock widget floats above a grid of app icons. Opening any app
 * fades the grid away; closing all windows brings it back. The whole view
 * anchors to rt.homeAnchor (set at boot, re-centered from Settings).
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { rt } from "@/lib/hologramos/runtime";
import { useOs } from "@/lib/hologramos/store";
import { sound } from "@/lib/hologramos/sound";
import { recordAction } from "@/lib/hologramos/bridge";
import { HOLO, useSurface, holoText, gauge } from "@/lib/hologramos/holo-canvas";
import { useInteractable } from "./input";
import { APPS, type AppDef } from "./apps/registry";

/* ------------------------------------------------------------------ */
/* Clock widget                                                        */
/* ------------------------------------------------------------------ */

function ClockWidget(): ReactNode {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const iv = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(iv);
  }, []);

  const tex = useSurface(
    1200,
    300,
    (ctx, w, h) => {
      const now = new Date();
      // analog dial
      const cx = 150;
      const cy = h / 2;
      const r = 108;
      ctx.strokeStyle = HOLO.dim;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
        const major = i % 3 === 0;
        ctx.strokeStyle = major ? HOLO.cyan : HOLO.ghost;
        ctx.lineWidth = major ? 4 : 2;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * (r - 16), cy + Math.sin(a) * (r - 16));
        ctx.lineTo(cx + Math.cos(a) * (r - (major ? 30 : 22)), cy + Math.sin(a) * (r - (major ? 30 : 22)));
        ctx.stroke();
      }
      const hh = (now.getHours() % 12) + now.getMinutes() / 60;
      const mm = now.getMinutes() + now.getSeconds() / 60;
      const ss = now.getSeconds();
      const hand = (angle: number, len: number, color: string, lw: number) => {
        const a = angle * Math.PI * 2 - Math.PI / 2;
        ctx.strokeStyle = color;
        ctx.lineWidth = lw;
        ctx.lineCap = "round";
        ctx.shadowColor = color;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
        ctx.stroke();
        ctx.shadowBlur = 0;
      };
      hand(hh / 12, r * 0.48, HOLO.ice, 7);
      hand(mm / 60, r * 0.72, HOLO.cyan, 5);
      hand(ss / 60, r * 0.8, HOLO.pale, 2);
      ctx.fillStyle = HOLO.ice;
      ctx.beginPath();
      ctx.arc(cx, cy, 5, 0, Math.PI * 2);
      ctx.fill();
      // seconds progress arc
      gauge(ctx, cx, cy, r + 10, -Math.PI / 2, -Math.PI / 2 + (ss / 60) * Math.PI * 2, HOLO.cyanSoft, 3, 8);

      // digital block
      const time = now.toLocaleTimeString([], { hour12: false });
      const date = now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
      holoText(ctx, time, 330, h * 0.34, {
        size: 96,
        color: HOLO.ice,
        spacing: 0.06,
        glow: 16,
      });
      holoText(ctx, date.toUpperCase(), 334, h * 0.68, {
        size: 30,
        color: HOLO.dim,
        spacing: 0.3,
      });
      // right-side frame ticks
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = HOLO.ghost;
        ctx.fillRect(w - 30 - i * 14, h / 2 - 26, 5, 52);
      }
    },
    [tick]
  );

  if (!tex) return null;
  return (
    <mesh position={[0, 0.44, 0]} renderOrder={4}>
      <planeGeometry args={[0.72, 0.18]} />
      <meshBasicMaterial
        map={tex}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  );
}

/* ------------------------------------------------------------------ */
/* App icon                                                            */
/* ------------------------------------------------------------------ */

function AppIcon({
  app,
  position,
  delay,
}: {
  app: AppDef;
  position: [number, number, number];
  delay: number;
}): ReactNode {
  const openApp = useOs((s) => s.openApp);
  const meshRef = useRef<THREE.Mesh>(null);
  const groupRef = useRef<THREE.Group>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const born = useRef(performance.now() + delay);
  const phase = useRef(Math.random() * Math.PI * 2);
  const baseY = useRef(position[1]);

  const S = 320;
  const tex = useSurface(
    S,
    S,
    (ctx, w) => {
      // glass rounded square
      const r = w * 0.24;
      const m = 14;
      ctx.beginPath();
      ctx.moveTo(m + r, m);
      ctx.arcTo(w - m, m, w - m, w - m, r);
      ctx.arcTo(w - m, w - m, m, w - m, r);
      ctx.arcTo(m, w - m, m, m, r);
      ctx.arcTo(m, m, w - m, m, r);
      ctx.closePath();
      ctx.fillStyle = "rgba(10,24,44,0.55)";
      ctx.fill();
      ctx.strokeStyle = HOLO.dim;
      ctx.lineWidth = 3;
      ctx.stroke();
      // inner glow
      ctx.strokeStyle = HOLO.ghost;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(m + r, m + 9);
      ctx.lineTo(w - m - r, m + 9);
      ctx.stroke();
      // glyph
      app.glyph(ctx, w);
    },
    [app.id]
  );

  const labelTex = useSurface(
    420,
    90,
    (ctx, w, h) => {
      holoText(ctx, app.name, w / 2, h / 2, {
        size: 34,
        align: "center",
        color: HOLO.dim,
        spacing: 0.34,
      });
    },
    [app.id]
  );

  useInteractable(meshRef, {
    id: `app:${app.id}`,
    hitRadius: 0.13,
    onClick: () => {
      recordAction("openApp", app.id);
      openApp(app.id as never);
    },
  });

  useFrame((state) => {
    const g = groupRef.current;
    const mesh = meshRef.current;
    if (!g || !mesh) return;
    const t = state.clock.elapsedTime;
    // staggered entry (easeOutBack) + gentle bob
    const since = performance.now() - born.current;
    let s = 1;
    if (since < 0) {
      s = 0.0001;
    } else if (since < 420) {
      const p = since / 420;
      const c = 1.34;
      s = 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2);
    }
    const hovered = !!mesh.userData.holo?.hovered;
    const targetS = s * (hovered ? 1.14 : 1);
    const k = 0.16;
    g.scale.x += (targetS - g.scale.x) * k;
    g.scale.y += (targetS - g.scale.y) * k;
    g.position.y = baseY.current + Math.sin(t * 0.8 + phase.current) * 0.006;
    const m = mesh.material as THREE.MeshBasicMaterial;
    m.opacity += ((hovered ? 1 : 0.92) - m.opacity) * 0.18;
    if (ringRef.current) {
      const rm = ringRef.current.material as THREE.MeshBasicMaterial;
      rm.opacity += ((hovered ? 0.85 : 0) - rm.opacity) * 0.2;
      ringRef.current.rotation.z = t * 0.6;
    }
  });

  return (
    <group ref={groupRef} position={position}>
      {/* hover reticle ring behind the tile */}
      <mesh ref={ringRef} position={[0, 0, -0.004]} renderOrder={3}>
        <ringGeometry args={[0.105, 0.113, 48, 1, 0, Math.PI * 1.65]} />
        <meshBasicMaterial
          color={HOLO.cyan}
          transparent
          opacity={0}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      <mesh ref={meshRef} renderOrder={4}>
        <planeGeometry args={[0.152, 0.152]} />
        {tex && (
          <meshBasicMaterial
            map={tex}
            transparent
            opacity={0.92}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        )}
      </mesh>
      {labelTex && (
        <mesh position={[0, -0.108, 0]} renderOrder={4}>
          <planeGeometry args={[0.19, 0.041]} />
          <meshBasicMaterial
            map={labelTex}
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      )}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Home view                                                           */
/* ------------------------------------------------------------------ */

export function HomeView(): ReactNode {
  const groupRef = useRef<THREE.Group>(null);
  const windowsOpen = useOs((s) => s.windows.length > 0);
  const scaleSetting = useOs((s) => s.settings.scale);
  const anchored = useRef(false);
  const vis = useRef(1);

  useFrame((_, dt) => {
    const g = groupRef.current;
    if (!g) return;
    // anchor once the real head pose exists (first frame after mount)
    if (!anchored.current && !rt.homeAnchor.set) {
      anchored.current = true;
      const fwd = rt.headFwd;
      rt.homeAnchor.pos.set(
        rt.headPos.x + fwd.x * 2.1,
        Math.max(0.9, rt.headPos.y - 0.1),
        rt.headPos.z + fwd.z * 2.1
      );
      rt.homeAnchor.yaw = Math.atan2(
        rt.headPos.x - rt.homeAnchor.pos.x,
        rt.headPos.z - rt.homeAnchor.pos.z
      );
      rt.homeAnchor.set = true;
    }
    if (anchored.current) {
      g.position.copy(rt.homeAnchor.pos);
      g.rotation.y = rt.homeAnchor.yaw;
    }
    // fade the grid away while any window is open
    const target = windowsOpen ? 0 : 1;
    vis.current += (target - vis.current) * (1 - Math.exp(-8 * Math.min(dt, 0.1)));
    const s = scaleSetting * (0.94 + 0.06 * vis.current);
    g.scale.setScalar(s);
    g.visible = vis.current > 0.02;
  });

  // grid geometry: 4 columns × 2 rows (bottom row centered, 3 apps)
  const cols = 4;
  const gapX = 0.235;
  const gapY = 0.27;
  const topRow = APPS.slice(0, 4);
  const bottomRow = APPS.slice(4);

  return (
    <group ref={groupRef} position={[0, 1.45, -2.1]}>
      <ClockWidget />
      {topRow.map((app, i) => (
        <AppIcon
          key={app.id}
          app={app}
          position={[(i - (cols - 1) / 2) * gapX, 0.05, 0]}
          delay={i * 70}
        />
      ))}
      {bottomRow.map((app, i) => (
        <AppIcon
          key={app.id}
          app={app}
          position={[(i - (bottomRow.length - 1) / 2) * gapX, 0.05 - gapY, 0]}
          delay={350 + i * 70}
        />
      ))}
    </group>
  );
}

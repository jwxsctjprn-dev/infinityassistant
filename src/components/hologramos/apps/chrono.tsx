/**
 * HologramOS — CHRONO app.
 *
 * A large holographic analog dial (glow hands, second arc) with digital
 * time, date and the session mission clock. Pure canvas, redrawn at 5 Hz.
 */

import * as THREE from "three";
import { useEffect, useState, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import { rt } from "@/lib/hologramos/runtime";
import { HOLO, useSurface, holoText, gauge } from "@/lib/hologramos/holo-canvas";
import type { AppProps } from "./registry";

export function ChronoApp({ cw, ch }: AppProps): ReactNode {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const iv = window.setInterval(() => setTick((t) => t + 1), 200);
    return () => window.clearInterval(iv);
  }, []);

  const PX = 1800; // px per meter
  const tex = useSurface(
    Math.round(cw * PX),
    Math.round(ch * PX),
    (ctx, w, h) => {
      const now = new Date();
      const cx = w / 2;
      const cy = h * 0.42;
      const r = Math.min(w, h) * 0.34;

      // dial face
      ctx.strokeStyle = HOLO.ghost;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(cx, cy, r + 26, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = HOLO.dim;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();

      // ticks + numerals
      for (let i = 0; i < 60; i++) {
        const a = (i / 60) * Math.PI * 2 - Math.PI / 2;
        const major = i % 5 === 0;
        ctx.strokeStyle = major ? HOLO.cyan : HOLO.ghost;
        ctx.lineWidth = major ? 4 : 2;
        const r1 = r - (major ? 34 : 20);
        const r2 = r - (major ? 46 : 28);
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
        ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
        ctx.stroke();
      }
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 - Math.PI / 2;
        holoText(ctx, String(i === 0 ? 12 : i * 3), cx + Math.cos(a) * (r - 78), cy + Math.sin(a) * (r - 78), {
          size: 30,
          align: "center",
          color: HOLO.pale,
          spacing: 0,
        });
      }

      // hands
      const hh = (now.getHours() % 12) + now.getMinutes() / 60;
      const mm = now.getMinutes() + now.getSeconds() / 60;
      const ss = now.getSeconds() + now.getMilliseconds() / 1000;
      const hand = (angle: number, len: number, color: string, lw: number, tail = 0) => {
        const a = angle * Math.PI * 2 - Math.PI / 2;
        ctx.strokeStyle = color;
        ctx.lineWidth = lw;
        ctx.lineCap = "round";
        ctx.shadowColor = color;
        ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.moveTo(cx - Math.cos(a) * tail, cy - Math.sin(a) * tail);
        ctx.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
        ctx.stroke();
        ctx.shadowBlur = 0;
      };
      hand(hh / 12, r * 0.5, HOLO.ice, 13, r * 0.1);
      hand(mm / 60, r * 0.74, HOLO.cyan, 9, r * 0.12);
      hand(ss / 60, r * 0.84, HOLO.pale, 3.5, r * 0.18);
      ctx.fillStyle = HOLO.ice;
      ctx.shadowColor = HOLO.cyan;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(cx, cy, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // second progress arc
      gauge(ctx, cx, cy, r + 26, -Math.PI / 2, -Math.PI / 2 + (ss / 60) * Math.PI * 2, HOLO.cyanSoft, 5, 12);

      // digital + date + mission time
      holoText(ctx, now.toLocaleTimeString([], { hour12: false }), cx, h * 0.785, {
        size: 56,
        align: "center",
        color: HOLO.ice,
        spacing: 0.1,
        glow: 14,
      });
      holoText(
        ctx,
        now.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }).toUpperCase(),
        cx,
        h * 0.875,
        { size: 22, align: "center", color: HOLO.dim, spacing: 0.3 }
      );
      holoText(
        ctx,
        `MISSION ${Math.floor((performance.now() - rt.sessionAt) / 60000)}M ${Math.floor(
          ((performance.now() - rt.sessionAt) / 1000) % 60
        )}S`,
        w - 24,
        26,
        { size: 19, align: "right", color: HOLO.dim, spacing: 0.18 }
      );
    },
    [tick]
  );

  // keep the frame loop alive so the app re-renders smoothly with the OS
  useFrame(() => undefined);

  if (!tex) return null;
  return (
    <mesh renderOrder={3}>
      <planeGeometry args={[cw, ch]} />
      <meshBasicMaterial
        map={tex}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  );
}

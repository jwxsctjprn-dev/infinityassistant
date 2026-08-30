/**
 * HologramOS — VITALS app.
 *
 * Live system diagnostics read straight from the renderer, battery API and
 * runtime: FPS (EMA), draw calls, triangles, GPU resources, battery, hand
 * tracking state, session uptime, view resolution and build. 2 Hz redraw.
 */

import * as THREE from "three";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { rt } from "@/lib/hologramos/runtime";
import { HOLOGRAMOS_BUILD } from "@/lib/hologramos/bridge";
import { HOLO, useSurface, holoText, meter } from "@/lib/hologramos/holo-canvas";
import type { AppProps } from "./registry";

interface Row {
  label: string;
  value: string;
  bar?: number;
}

export function VitalsApp({ cw, ch }: AppProps): ReactNode {
  const gl = useThree((s) => s.gl);
  const [rows, setRows] = useState<Row[]>([]);
  const fpsRef = useRef(0);

  useFrame((_, dt) => {
    if (dt > 0) fpsRef.current = fpsRef.current * 0.92 + (1 / dt) * 0.08;
  });

  useEffect(() => {
    const read = () => {
      const info = gl.info;
      const b = rt.battery;
      const fps = Math.round(fpsRef.current || rt.fps);
      setRows([
        { label: "FRAME RATE", value: `${fps} FPS`, bar: Math.min(1, fps / 90) },
        { label: "DRAW CALLS", value: String(info.render.calls) },
        { label: "TRIANGLES", value: info.render.triangles.toLocaleString() },
        { label: "GEOMETRIES", value: String(info.memory.geometries) },
        { label: "TEXTURES", value: String(info.memory.textures) },
        {
          label: "POWER CELL",
          value: b.level === null ? "READING…" : `${Math.round(b.level * 100)}%${b.charging ? " ⚡" : ""}`,
          bar: b.level ?? 0.5,
        },
        {
          label: "HAND TRACKING",
          value:
            rt.hands.left.count > 0 && rt.hands.right.count > 0
              ? "BOTH LOCKED"
              : rt.hands.left.count > 0 || rt.hands.right.count > 0
                ? "ONE HAND"
                : "SEARCHING",
        },
        {
          label: "SESSION",
          value: `T+${Math.floor((performance.now() - rt.sessionAt) / 1000)}S`,
        },
        { label: "VIEW", value: `${gl.domElement.width}×${gl.domElement.height}` },
      ]);
    };
    read();
    const iv = window.setInterval(read, 500);
    return () => window.clearInterval(iv);
  }, [gl]);

  const PX = 1800;
  const tex = useSurface(
    Math.round(cw * PX),
    Math.round(ch * PX),
    (ctx, w, h) => {
      holoText(ctx, "SYSTEM VITALS", 30, 34, {
        size: 30,
        color: HOLO.ice,
        spacing: 0.36,
        glow: 8,
      });
      // live dot
      const blink = 0.5 + 0.5 * Math.sin(performance.now() * 0.005);
      ctx.fillStyle = HOLO.green;
      ctx.shadowColor = HOLO.green;
      ctx.shadowBlur = 10 * blink;
      ctx.beginPath();
      ctx.arc(w - 40, 34, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      const y0 = 78;
      const rowH = (h - y0 - 46) / rows.length;
      rows.forEach((row, i) => {
        const y = y0 + i * rowH + rowH / 2;
        ctx.fillStyle = i % 2 === 0 ? "rgba(103,232,249,0.03)" : "transparent";
        ctx.fillRect(18, y - rowH / 2 + 4, w - 36, rowH - 8);
        holoText(ctx, row.label, 38, y, {
          size: 22,
          color: HOLO.dim,
          spacing: 0.22,
        });
        holoText(ctx, row.value, w - 38, y, {
          size: 25,
          align: "right",
          color: row.label === "POWER CELL" && (rt.battery.level ?? 1) < 0.2 ? HOLO.danger : HOLO.pale,
          spacing: 0.08,
          glow: 4,
        });
        if (row.bar !== undefined) {
          meter(ctx, 38, y + rowH / 2 - 12, w - 76, 5, row.bar, HOLO.cyanSoft);
        }
      });
      holoText(ctx, `BUILD ${HOLOGRAMOS_BUILD}`, w - 30, h - 22, {
        size: 16,
        align: "right",
        color: HOLO.ghost,
        spacing: 0.18,
      });
    },
    [rows]
  );

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

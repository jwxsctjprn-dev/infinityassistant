/**
 * HologramOS — app windows.
 *
 * visionOS-style floating window: dark holographic glass, additive chrome
 * (title bar, targeting brackets, close control), spring-open animation,
 * pinch-drag repositioning via the title bar, graceful close. Content is
 * the app component rendered into a positioned group.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { rt } from "@/lib/hologramos/runtime";
import { useOs, type OsWindow } from "@/lib/hologramos/store";
import { recordAction } from "@/lib/hologramos/bridge";
import { HOLO, useSurface, holoText, cornerBrackets } from "@/lib/hologramos/holo-canvas";
import { useInteractable } from "./input";
import { appById } from "./apps/registry";

const TITLE_H = 0.052;
const PAD_X = 0.026;
const PAD_BOTTOM = 0.026;

export function AppWindow({ win }: { win: OsWindow }): ReactNode {
  const app = appById(win.app);
  const closeWindow = useOs((s) => s.closeWindow);
  const brightness = useOs((s) => s.settings.brightness);
  const scaleSetting = useOs((s) => s.settings.scale);
  const groupRef = useRef<THREE.Group>(null);
  const dragRef = useRef<THREE.Mesh>(null);
  const closeRef = useRef<THREE.Mesh>(null);
  const [closing, setClosing] = useState(false);
  const closedAt = useRef(0);

  const cw = app?.w ?? 0.6;
  const ch = app?.h ?? 0.45;
  const totalW = cw + PAD_X * 2;
  const totalH = ch + TITLE_H + PAD_BOTTOM;
  const contentY = totalH / 2 - TITLE_H - ch / 2;

  /* register the window node for imperative dragging/recentering */
  useEffect(() => {
    const g = groupRef.current;
    if (!g) return;
    g.position.set(win.pos[0], win.pos[1], win.pos[2]);
    g.rotation.set(0, win.yaw, 0);
    rt.windowNodes.set(win.key, g);
    return () => {
      rt.windowNodes.delete(win.key);
    };
  }, [win.key, win.pos, win.yaw]);

  /* title-bar drag zone */
  useInteractable(dragRef, {
    id: `win-drag:${win.app}`,
    hitRadius: 0.09,
    dragWindow: win.key,
  });

  const doClose = () => {
    if (closing) return;
    recordAction("closeWindow", win.app);
    setClosing(true);
    closedAt.current = performance.now();
  };

  /* close control */
  useInteractable(closeRef, {
    id: `win-close:${win.app}`,
    hitRadius: 0.045,
    onClick: doClose,
  });

  useEffect(() => {
    if (!closing) return;
    const t = window.setTimeout(() => closeWindow(win.key), 210);
    return () => window.clearTimeout(t);
  }, [closing, closeWindow, win.key]);

  /* open/close + idle animation */
  useFrame((state, dt) => {
    const g = groupRef.current;
    if (!g) return;
    const t = (performance.now() - win.bornAt) / 1000;
    let s: number;
    if (closing) {
      const f = Math.max(0, 1 - (performance.now() - closedAt.current) / 200);
      s = 0.55 + 0.45 * f * f;
    } else if (t < 0.3) {
      // easeOutBack spring
      const p = t / 0.3;
      const c = 1.5;
      s = 0.55 + 0.45 * (1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2));
    } else {
      s = 1 + Math.sin(state.clock.elapsedTime * 0.9 + win.key) * 0.003;
    }
    const target = s * scaleSetting;
    const k = 1 - Math.exp(-18 * Math.min(dt, 0.1));
    g.scale.x += (target - g.scale.x) * k;
    g.scale.y += (target - g.scale.y) * k;
    g.scale.z = 1;
  });

  /* chrome texture: title bar + brackets + border */
  const chromeTex = useSurface(
    Math.round(totalW * 900),
    Math.round(totalH * 900),
    (ctx, w, h) => {
      const px = 900;
      // title bar rule
      ctx.fillStyle = HOLO.dim;
      ctx.fillRect(w * 0.1, TITLE_H * px, w * 0.8, 2);
      // title
      holoText(ctx, app?.name ?? "APP", w / 2, (TITLE_H * px) / 2, {
        size: 17,
        align: "center",
        color: HOLO.pale,
        spacing: 0.42,
        glow: 4,
      });
      // outer border
      ctx.strokeStyle = HOLO.ghost;
      ctx.lineWidth = 2;
      ctx.strokeRect(2, 2, w - 4, h - 4);
      // targeting brackets
      cornerBrackets(ctx, 6, 6, w - 12, h - 12, Math.min(w, h) * 0.09, HOLO.dim, 3);
      // close glyph (top-left)
      const cx = 30;
      const cy = (TITLE_H * px) / 2;
      const r = 12;
      ctx.strokeStyle = HOLO.pale;
      ctx.lineWidth = 2.5;
      ctx.shadowColor = HOLO.cyan;
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.moveTo(cx - r * 0.42, cy - r * 0.42);
      ctx.lineTo(cx + r * 0.42, cy + r * 0.42);
      ctx.moveTo(cx + r * 0.42, cy - r * 0.42);
      ctx.lineTo(cx - r * 0.42, cy + r * 0.42);
      ctx.stroke();
      ctx.shadowBlur = 0;
      // drag hint dots at title center
      ctx.fillStyle = HOLO.ghost;
      for (let i = -1; i <= 1; i++) ctx.fillRect(w / 2 + i * 10 - 1.5, cy - 1.5, 3, 3);
    },
    [win.app, totalW, totalH]
  );

  if (!app) return null;

  const glassOpacity = brightness === 0 ? 0.34 : brightness === 1 ? 0.5 : 0.66;

  return (
    <group ref={groupRef}>
      {/* dark holographic glass backing */}
      <mesh renderOrder={1}>
        <planeGeometry args={[totalW, totalH]} />
        <meshBasicMaterial
          color="#04101f"
          transparent
          opacity={glassOpacity}
          depthWrite={false}
        />
      </mesh>
      {/* chrome */}
      {chromeTex && (
        <mesh position={[0, 0, 0.001]} renderOrder={2}>
          <planeGeometry args={[totalW, totalH]} />
          <meshBasicMaterial
            map={chromeTex}
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      )}
      {/* app content */}
      <group position={[0, contentY, 0.002]}>
        <app.Component cw={cw} ch={ch} win={win} />
      </group>
      {/* title-bar drag zone (invisible but raycastable) */}
      <mesh ref={dragRef} position={[0, totalH / 2 - TITLE_H / 2, 0.003]} renderOrder={5}>
        <planeGeometry args={[totalW * 0.86, TITLE_H]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {/* close hit zone */}
      <mesh ref={closeRef} position={[-(totalW / 2 - 0.033), totalH / 2 - TITLE_H / 2, 0.003]} renderOrder={5}>
        <planeGeometry args={[0.045, 0.045]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  );
}

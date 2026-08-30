/**
 * HologramOS — SETTINGS app.
 *
 * Every control here is real: UI scale resizes panels, brightness changes
 * the glass, particles/skeleton/sound toggle live systems, RECENTER
 * re-anchors the whole OS in front of the user. Settings persist to
 * localStorage.
 */

import * as THREE from "three";
import type { ReactNode } from "react";
import { useOs } from "@/lib/hologramos/store";
import { sound } from "@/lib/hologramos/sound";
import { recordAction } from "@/lib/hologramos/bridge";
import { HOLOGRAMOS_BUILD } from "@/lib/hologramos/bridge";
import { HOLO, useSurface, holoText } from "@/lib/hologramos/holo-canvas";
import { HoloButton } from "../input";
import type { AppProps } from "./registry";

export function SettingsApp({ cw, ch }: AppProps): ReactNode {
  const settings = useOs((s) => s.settings);
  const setSetting = useOs((s) => s.setSetting);
  const recenter = useOs((s) => s.recenter);

  const rows: Array<{ label: string; y: number }> = [
    { label: "UI SCALE", y: ch / 2 - 0.075 },
    { label: "BRIGHTNESS", y: ch / 2 - 0.155 },
    { label: "PARTICLES", y: ch / 2 - 0.235 },
    { label: "SOUND", y: ch / 2 - 0.315 },
  ];
  const skeletonY = -ch / 2 + 0.115;
  const actionsY = -ch / 2 + 0.045;

  const tex = useSurface(
    Math.round(cw * 1800),
    Math.round(ch * 1800),
    (ctx, w, h) => {
      holoText(ctx, "SETTINGS", 30, 30, { size: 26, color: HOLO.ice, spacing: 0.4, glow: 6 });
      ctx.fillStyle = HOLO.ghost;
      ctx.fillRect(20, 50, w - 40, 2);
      rows.forEach((row) => {
        holoText(ctx, row.label, 34, (ch / 2 - row.y) * 1800, {
          size: 21,
          color: HOLO.dim,
          spacing: 0.22,
        });
      });
      holoText(ctx, "HAND SKELETON", 34, (ch / 2 - skeletonY) * 1800, {
        size: 21,
        color: HOLO.dim,
        spacing: 0.22,
      });
      holoText(ctx, `HOLOGRAM OS 2.2 · ${HOLOGRAMOS_BUILD}`, w / 2, h - 24, {
        size: 16,
        align: "center",
        color: HOLO.ghost,
        spacing: 0.14,
      });
    },
    [settings]
  );

  const toggle = (fn: () => void) => () => {
    sound.toggle();
    recordAction("setting", "toggle");
    fn();
  };

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

      {/* UI scale */}
      <group position={[cw / 2 - 0.145, rows[0].y, 0.004]}>
        {(["S", "M", "L"] as const).map((v, i) => (
          <HoloButton
            key={v}
            label={v}
            w={0.042}
            h={0.042}
            position={[i * 0.048, 0, 0]}
            active={
              settings.scale === (v === "S" ? 0.85 : v === "M" ? 1 : 1.15)
            }
            onClick={toggle(() => setSetting({ scale: v === "S" ? 0.85 : v === "M" ? 1 : 1.15 }))}
          />
        ))}
      </group>

      {/* brightness */}
      <group position={[cw / 2 - 0.145, rows[1].y, 0.004]}>
        {(["LOW", "MED", "HIGH"] as const).map((v, i) => (
          <HoloButton
            key={v}
            label={v}
            w={0.062}
            h={0.042}
            position={[i * 0.068, 0, 0]}
            active={settings.brightness === (i as 0 | 1 | 2)}
            onClick={toggle(() => setSetting({ brightness: i as 0 | 1 | 2 }))}
          />
        ))}
      </group>

      {/* particles */}
      <group position={[cw / 2 - 0.09, rows[2].y, 0.004]}>
        {(["OFF", "ON"] as const).map((v, i) => (
          <HoloButton
            key={v}
            label={v}
            w={0.058}
            h={0.042}
            position={[i * 0.064, 0, 0]}
            active={settings.particles === (i === 1)}
            onClick={toggle(() => setSetting({ particles: i === 1 }))}
          />
        ))}
      </group>

      {/* sound */}
      <group position={[cw / 2 - 0.09, rows[3].y, 0.004]}>
        {(["OFF", "ON"] as const).map((v, i) => (
          <HoloButton
            key={v}
            label={v}
            w={0.058}
            h={0.042}
            position={[i * 0.064, 0, 0]}
            active={settings.sound === (i === 1)}
            onClick={toggle(() => setSetting({ sound: i === 1 }))}
          />
        ))}
      </group>

      {/* hand skeleton */}
      <group position={[cw / 2 - 0.09, skeletonY, 0.004]}>
        {(["OFF", "ON"] as const).map((v, i) => (
          <HoloButton
            key={v}
            label={v}
            w={0.058}
            h={0.042}
            position={[i * 0.064, 0, 0]}
            active={settings.skeleton === (i === 1)}
            onClick={toggle(() => setSetting({ skeleton: i === 1 }))}
          />
        ))}
      </group>

      {/* actions */}
      <HoloButton
        label="RECENTER UI"
        w={0.16}
        h={0.048}
        position={[0, actionsY, 0.004]}
        variant="primary"
        onClick={() => {
          sound.click();
          recenter();
        }}
      />
    </group>
  );
}

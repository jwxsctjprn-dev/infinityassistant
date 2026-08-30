/**
 * HologramOS — SUIT MAKER app.
 *
 * The Iron Man fabricator control surface: live arm-tracking telemetry, mark
 * selection (plating style), tint, repulsor toggle and the BUILD control that
 * runs the cinematic piece-by-piece assembly onto your tracked arms.
 */

import { useEffect, useState, type ReactNode } from "react";
import * as THREE from "three";
import { rt } from "@/lib/hologramos/runtime";
import { recordAction } from "@/lib/hologramos/bridge";
import {
  useSuit,
  SUIT_MARKS,
  SUIT_TINTS,
  SUIT_PIECES,
  type SuitMark,
  type SuitTint,
} from "@/lib/hologramos/suit";
import { sound } from "@/lib/hologramos/sound";
import { HOLO, useSurface, holoText, meter, panel } from "@/lib/hologramos/holo-canvas";
import { HoloButton } from "../input";
import type { AppProps } from "./registry";

const MARK_IDS: SuitMark[] = ["MK-1", "MK-3", "MK-7"];
const TINT_IDS: SuitTint[] = ["cyan", "ice", "gold", "crimson"];
const TINT_LABEL: Record<SuitTint, string> = {
  cyan: "CYAN",
  ice: "ICE",
  gold: "GOLD",
  crimson: "RED",
};

export function SuitMakerApp({ cw, ch }: AppProps): ReactNode {
  const phase = useSuit((s) => s.phase);
  const clamped = useSuit((s) => s.clamped);
  const mark = useSuit((s) => s.mark);
  const tint = useSuit((s) => s.tint);
  const repulsor = useSuit((s) => s.repulsor);
  const build = useSuit((s) => s.build);
  const disassemble = useSuit((s) => s.disassemble);
  const setMark = useSuit((s) => s.setMark);
  const setTint = useSuit((s) => s.setTint);
  const setRepulsor = useSuit((s) => s.setRepulsor);

  /* 2 Hz telemetry redraw */
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const iv = window.setInterval(() => setTick((t) => t + 1), 500);
    return () => window.clearInterval(iv);
  }, []);

  const building = phase === "building";
  const worn = phase === "worn";
  const buildingLabel = building ? `FORGING ${clamped}/${SUIT_PIECES}` : "BUILD ARMOR";

  const PX = 1800;
  const tex = useSurface(
    Math.round(cw * PX),
    Math.round(ch * PX),
    (ctx, w, h) => {
      const tintC = SUIT_TINTS[tint].edge;
      holoText(ctx, "MARK SUIT FABRICATOR", 30, 36, {
        size: 28,
        color: HOLO.ice,
        spacing: 0.32,
        glow: 8,
      });
      // status dot
      const blink = 0.5 + 0.5 * Math.sin(performance.now() * 0.006);
      ctx.fillStyle = worn ? HOLO.green : building ? HOLO.amber : HOLO.dim;
      ctx.shadowColor = worn ? HOLO.green : building ? HOLO.amber : HOLO.cyan;
      ctx.shadowBlur = 10 * blink;
      ctx.beginPath();
      ctx.arc(w - 44, 36, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // arm telemetry
      const l = rt.hands.left.count;
      const r = rt.hands.right.count;
      const arms =
        l > 0 && r > 0
          ? `BOTH ARMS LOCKED · L${l} R${r} JOINTS`
          : l > 0 || r > 0
            ? `ONE ARM LOCKED · RAISE THE OTHER HAND`
            : `ARM TRACKING… RAISE YOUR HANDS`;
      holoText(ctx, arms, 30, 74, {
        size: 19,
        color: l > 0 || r > 0 ? HOLO.cyanSoft : HOLO.amber,
        spacing: 0.14,
      });

      // mark readout under the mark row
      holoText(ctx, SUIT_MARKS[mark].label, w / 2, h * 0.405, {
        size: 17,
        align: "center",
        color: HOLO.dim,
        spacing: 0.26,
      });

      // assembly block
      const by = h * 0.66;
      holoText(ctx, "ASSEMBLY", 30, by, {
        size: 17,
        color: HOLO.dim,
        spacing: 0.24,
      });
      holoText(ctx, worn ? "SUIT ONLINE — ALL SYSTEMS" : building ? "FORGING…" : "STANDBY", w - 30, by, {
        size: 18,
        align: "right",
        color: worn ? HOLO.green : building ? HOLO.amber : HOLO.dim,
        spacing: 0.12,
        glow: 4,
      });
      meter(ctx, 30, by + 22, w - 60, 8, clamped / SUIT_PIECES, worn ? HOLO.green : tintC);
      holoText(ctx, `PIECES CLAMPED ${clamped}/${SUIT_PIECES} PER ARM`, 30, by + 52, {
        size: 15,
        color: HOLO.dim,
        spacing: 0.18,
      });

      // hint
      holoText(ctx, "OPEN PALM TO CHARGE · SNAP TO FIRE REPULSOR", 30, h - 26, {
        size: 14,
        color: HOLO.ghost,
        spacing: 0.22,
      });
      // left rail detail
      ctx.fillStyle = "rgba(103,232,249,0.16)";
      ctx.fillRect(12, h * 0.16, 2, h * 0.62);
      ctx.fillStyle = tintC;
      ctx.globalAlpha = 0.5;
      ctx.fillRect(11, h * 0.16 + (h * 0.62 * clamped) / SUIT_PIECES - 6, 4, 12);
      ctx.globalAlpha = 1;
      void panel;
    },
    [tick, phase, clamped, mark, tint]
  );

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

      {/* mark row */}
      {MARK_IDS.map((m, i) => (
        <HoloButton
          key={m}
          label={m}
          w={0.15}
          h={0.075}
          position={[(i - 1) * 0.21, ch / 2 - 0.185, 0.004]}
          fontSize={15}
          active={mark === m}
          onClick={() => {
            setMark(m);
            sound.toggle();
          }}
        />
      ))}

      {/* tint row */}
      {TINT_IDS.map((t, i) => (
        <HoloButton
          key={t}
          label={TINT_LABEL[t]}
          w={0.115}
          h={0.062}
          position={[-0.24 + i * 0.16, ch / 2 - 0.3, 0.004]}
          fontSize={12}
          active={tint === t}
          onClick={() => {
            setTint(t);
            sound.toggle();
          }}
        />
      ))}

      {/* repulsor toggle */}
      <HoloButton
        label="REPULSOR"
        sub={repulsor ? "ARMED" : "OFF"}
        w={0.19}
        h={0.082}
        position={[-0.155, -ch / 2 + 0.235, 0.004]}
        fontSize={13}
        active={repulsor}
        onClick={() => {
          setRepulsor(!repulsor);
          sound.toggle();
        }}
      />

      {/* build / disassemble */}
      <HoloButton
        label={worn ? "DISASSEMBLE" : buildingLabel}
        w={0.24}
        h={0.082}
        position={[0.15, -ch / 2 + 0.235, 0.004]}
        fontSize={14}
        variant={worn ? "danger" : "primary"}
        onClick={() => {
          if (worn || building) {
            recordAction("suitDisassemble", "btn");
            disassemble();
          } else {
            recordAction("suitBuild", "btn");
            build();
          }
        }}
      />
    </group>
  );
}

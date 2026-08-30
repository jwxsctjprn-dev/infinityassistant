/**
 * HologramOS — TERMINAL app.
 *
 * A working command console with a little JARVIS personality. Everything is
 * real: time/date/uptime/battery/fps/hands read live runtime state, open/
 * close/home drive the actual OS, sysinfo dumps renderer facts. Typed on
 * the holographic keyboard.
 */

import * as THREE from "three";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useThree } from "@react-three/fiber";
import { rt } from "@/lib/hologramos/runtime";
import { useOs, type AppId } from "@/lib/hologramos/store";
import { HOLOGRAMOS_BUILD } from "@/lib/hologramos/bridge";
import { sound } from "@/lib/hologramos/sound";
import { HOLO, useSurface, holoText } from "@/lib/hologramos/holo-canvas";
import { HoloKeyboard, keyboardHeight, type HoloKey } from "../holo-keyboard";
import type { AppProps } from "./registry";

interface Line {
  text: string;
  kind: "in" | "out" | "sys" | "err";
}

const HELP: string[] = [
  "COMMANDS — time · date · uptime · battery · fps",
  "            hands · sysinfo · echo <t> · whoami",
  "            open <app> · close · home · clear",
];

export function TerminalApp({ cw, ch }: AppProps): ReactNode {
  const gl = useThree((s) => s.gl);
  const openApp = useOs((s) => s.openApp);
  const closeAll = useOs((s) => s.closeAll);
  const [lines, setLines] = useState<Line[]>([
    { text: "HOLOGRAM OS TERMINAL · J.A.R.V.I.S CORE", kind: "sys" },
    { text: 'TYPE "HELP" FOR COMMANDS', kind: "sys" },
  ]);
  const [input, setInput] = useState("");
  const [caret, setCaret] = useState(true);
  const inputRef = useRef("");

  useEffect(() => {
    inputRef.current = input;
  });

  useEffect(() => {
    const iv = window.setInterval(() => setCaret((c) => !c), 530);
    return () => window.clearInterval(iv);
  }, []);

  const push = (...ls: Line[]) => setLines((prev) => [...prev, ...ls].slice(-40));

  const run = (raw: string) => {
    const cmd = raw.trim();
    if (!cmd) return;
    push({ text: `> ${cmd}`, kind: "in" });
    const [head, ...rest] = cmd.toLowerCase().split(/\s+/);
    const arg = rest.join(" ");
    switch (head) {
      case "help":
        push(...HELP.map((t) => ({ text: t, kind: "out" as const })));
        break;
      case "clear":
        setLines([]);
        break;
      case "time":
        push({ text: new Date().toLocaleTimeString([], { hour12: false }), kind: "out" });
        break;
      case "date":
        push({
          text: new Date().toLocaleDateString([], {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
          }),
          kind: "out",
        });
        break;
      case "uptime":
        push({
          text: `SESSION ${Math.floor((performance.now() - rt.sessionAt) / 1000)}S · ${
            Math.round(rt.fps) || 0
          } FPS`,
          kind: "out",
        });
        break;
      case "battery": {
        const b = rt.battery;
        push({
          text: b.level === null ? "POWER CELL: NO READING" : `POWER CELL ${Math.round(b.level * 100)}%${b.charging ? " · CHARGING" : ""}`,
          kind: "out",
        });
        break;
      }
      case "fps":
        push({ text: `${Math.round(rt.fps) || 0} FPS (EMA)`, kind: "out" });
        break;
      case "hands": {
        const l = rt.hands.left.count > 0;
        const r = rt.hands.right.count > 0;
        push({
          text: `LEFT ${l ? `LOCKED (${rt.hands.left.count} JOINTS)` : "SEARCHING"} · RIGHT ${
            r ? `LOCKED (${rt.hands.right.count} JOINTS)` : "SEARCHING"
          }`,
          kind: "out",
        });
        break;
      }
      case "sysinfo":
        push(
          { text: `BUILD ${HOLOGRAMOS_BUILD}`, kind: "out" },
          { text: `RENDER ${gl.info.render.calls} CALLS · ${gl.info.render.triangles.toLocaleString()} TRIS`, kind: "out" },
          { text: `VIEW ${gl.domElement.width}×${gl.domElement.height}`, kind: "out" },
          { text: `AGENT ${navigator.userAgent.slice(0, 72)}`, kind: "out" }
        );
        break;
      case "echo":
        push({ text: arg || "", kind: "out" });
        break;
      case "whoami":
        push({ text: "GUEST@HOLOGRAMOS — PRIMARY OPERATOR", kind: "out" });
        break;
      case "open": {
        const apps: AppId[] = ["notes", "terminal", "vitals", "timer", "chrono", "sonics", "settings"];
        if (apps.includes(arg as AppId)) {
          openApp(arg as AppId);
          push({ text: `OPENING ${arg.toUpperCase()}…`, kind: "sys" });
        } else {
          push({ text: `UNKNOWN APP: ${arg || "(NONE)"} — TRY ${apps.join(" · ")}`, kind: "err" });
          sound.error();
        }
        break;
      }
      case "close":
      case "home":
        closeAll();
        push({ text: "ALL WINDOWS CLOSED — HOME VIEW", kind: "sys" });
        break;
      default:
        push({ text: `UNKNOWN COMMAND: ${head} — TRY "HELP"`, kind: "err" });
        sound.error();
    }
  };

  const onKey = (k: HoloKey) => {
    if (k === "ENTER") {
      const v = inputRef.current;
      setInput("");
      run(v);
      return;
    }
    if (k === "BACK") {
      setInput((v) => v.slice(0, -1));
      return;
    }
    if (inputRef.current.length < 64) setInput((v) => v + k);
  };

  const kbH = keyboardHeight(cw);
  const kbTop = -ch / 2 + 0.012 + kbH;
  const textH = ch / 2 - kbTop - 0.006;
  const textY = (ch / 2 + kbTop) / 2 - 0.003;

  const PX = 1800;
  const visible = lines.slice(-6);
  const tex = useSurface(
    Math.round(cw * PX),
    Math.round(textH * PX),
    (ctx, w, h) => {
      holoText(ctx, "J.A.R.V.I.S CONSOLE", 30, 28, {
        size: 24,
        color: HOLO.ice,
        spacing: 0.3,
        glow: 6,
      });
      ctx.fillStyle = HOLO.ghost;
      ctx.fillRect(20, 46, w - 40, 2);
      const colorOf = (kind: Line["kind"]) =>
        kind === "in" ? HOLO.pale : kind === "err" ? HOLO.danger : kind === "sys" ? HOLO.cyanSoft : HOLO.dim;
      visible.forEach((line, i) => {
        holoText(ctx, line.text.slice(0, 46), 30, 74 + i * 36, {
          size: 20,
          color: colorOf(line.kind),
          spacing: 0.04,
        });
      });
      // input line with caret
      const iy = 74 + visible.length * 36 + 4;
      holoText(ctx, "> ", 30, iy, { size: 20, color: HOLO.cyan, spacing: 0.04 });
      holoText(ctx, input, 60, iy, { size: 20, color: HOLO.ice, spacing: 0.04, glow: 4 });
      if (caret) {
        const wl = ctx.measureText(input).width;
        ctx.fillStyle = HOLO.cyan;
        ctx.fillRect(62 + wl, iy - 9, 10, 19);
      }
    },
    [visible, input, caret]
  );

  return (
    <group>
      {tex && (
        <mesh position={[0, textY, 0]} renderOrder={3}>
          <planeGeometry args={[cw, textH]} />
          <meshBasicMaterial
            map={tex}
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      )}
      <HoloKeyboard cw={cw} yTop={kbTop} onKey={onKey} />
    </group>
  );
}

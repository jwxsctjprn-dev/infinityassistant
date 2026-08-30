/**
 * HologramOS — app registry.
 *
 * Every installed app: id, name, home-grid glyph, window + canvas dims and
 * the component that renders its content inside a HoloWindow. This is the
 * single source of truth for the home grid AND the window manager.
 */

import type { ComponentType, ReactNode } from "react";
import type { OsWindow } from "@/lib/hologramos/store";
import { HOLO } from "@/lib/hologramos/holo-canvas";

import { NotesApp } from "./notes";
import { TerminalApp } from "./terminal";
import { VitalsApp } from "./vitals";
import { TimerApp } from "./timer";
import { ChronoApp } from "./chrono";
import { SonicsApp } from "./sonics";
import { SettingsApp } from "./settings-app";

export interface AppProps {
  /** content area size in meters */
  cw: number;
  ch: number;
  win: OsWindow;
}

export interface GlyphFn {
  (ctx: CanvasRenderingContext2D, s: number): void;
}

export interface AppDef {
  id: string;
  name: string;
  glyph: GlyphFn;
  /** content area meters */
  w: number;
  h: number;
  Component: ComponentType<AppProps>;
}

/* ---- glyphs: minimal cyan line art, drawn in a s×s box ---- */

const glyphNotes: GlyphFn = (ctx, s) => {
  const m = s * 0.2;
  ctx.strokeStyle = HOLO.cyan;
  ctx.lineWidth = s * 0.045;
  ctx.lineJoin = "round";
  ctx.shadowColor = HOLO.cyan;
  ctx.shadowBlur = s * 0.08;
  const r = s * 0.08;
  const w = s - m * 2;
  const h = s - m * 2;
  ctx.beginPath();
  ctx.moveTo(m + r, m);
  ctx.arcTo(m + w, m, m + w, m + h, r);
  ctx.arcTo(m + w, m + h, m, m + h, r);
  ctx.arcTo(m, m + h, m, m, r);
  ctx.arcTo(m, m, m + w, m, r);
  ctx.stroke();
  ctx.beginPath();
  for (let i = 0; i < 3; i++) {
    const y = m + h * (0.32 + i * 0.18);
    ctx.moveTo(m + w * 0.22, y);
    ctx.lineTo(m + w * (i === 2 ? 0.6 : 0.78), y);
  }
  ctx.stroke();
  ctx.shadowBlur = 0;
};

const glyphTerminal: GlyphFn = (ctx, s) => {
  ctx.strokeStyle = HOLO.cyan;
  ctx.lineWidth = s * 0.055;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.shadowColor = HOLO.cyan;
  ctx.shadowBlur = s * 0.08;
  ctx.beginPath();
  ctx.moveTo(s * 0.22, s * 0.32);
  ctx.lineTo(s * 0.4, s * 0.5);
  ctx.lineTo(s * 0.22, s * 0.68);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(s * 0.48, s * 0.7);
  ctx.lineTo(s * 0.78, s * 0.7);
  ctx.stroke();
  ctx.shadowBlur = 0;
};

const glyphVitals: GlyphFn = (ctx, s) => {
  ctx.strokeStyle = HOLO.cyan;
  ctx.lineWidth = s * 0.05;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.shadowColor = HOLO.cyan;
  ctx.shadowBlur = s * 0.08;
  ctx.beginPath();
  ctx.moveTo(s * 0.14, s * 0.5);
  ctx.lineTo(s * 0.34, s * 0.5);
  ctx.lineTo(s * 0.44, s * 0.26);
  ctx.lineTo(s * 0.56, s * 0.74);
  ctx.lineTo(s * 0.66, s * 0.5);
  ctx.lineTo(s * 0.86, s * 0.5);
  ctx.stroke();
  ctx.shadowBlur = 0;
};

const glyphTimer: GlyphFn = (ctx, s) => {
  ctx.strokeStyle = HOLO.cyan;
  ctx.lineWidth = s * 0.05;
  ctx.lineCap = "round";
  ctx.shadowColor = HOLO.cyan;
  ctx.shadowBlur = s * 0.08;
  const c = s / 2;
  const r = s * 0.3;
  ctx.beginPath();
  ctx.arc(c, c + s * 0.02, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(c, c + s * 0.02 - r);
  ctx.lineTo(c, c + s * 0.02 - r * 0.45);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(c, c + s * 0.02 - r);
  ctx.lineTo(c + r * 0.5, c + s * 0.02 - r * 0.2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(c - r * 0.22, c - r - s * 0.06);
  ctx.lineTo(c + r * 0.22, c - r - s * 0.06);
  ctx.stroke();
  ctx.shadowBlur = 0;
};

const glyphChrono: GlyphFn = (ctx, s) => {
  ctx.strokeStyle = HOLO.cyan;
  ctx.lineWidth = s * 0.05;
  ctx.lineCap = "round";
  ctx.shadowColor = HOLO.cyan;
  ctx.shadowBlur = s * 0.08;
  const c = s / 2;
  const r = s * 0.32;
  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(c, c);
  ctx.lineTo(c, c - r * 0.62);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(c, c);
  ctx.lineTo(c + r * 0.48, c + r * 0.18);
  ctx.stroke();
  ctx.shadowBlur = 0;
};

const glyphSonics: GlyphFn = (ctx, s) => {
  ctx.strokeStyle = HOLO.cyan;
  ctx.lineWidth = s * 0.055;
  ctx.lineCap = "round";
  ctx.shadowColor = HOLO.cyan;
  ctx.shadowBlur = s * 0.08;
  const bars = [0.3, 0.55, 0.85, 0.6, 0.95, 0.45, 0.7, 0.35];
  const bw = s * 0.075;
  const gap = s * 0.055;
  const total = bars.length * bw + (bars.length - 1) * gap;
  let x = (s - total) / 2;
  ctx.beginPath();
  for (const b of bars) {
    const bh = s * 0.6 * b;
    ctx.moveTo(x, s / 2 - bh / 2);
    ctx.lineTo(x, s / 2 + bh / 2);
    x += bw + gap;
  }
  ctx.stroke();
  ctx.shadowBlur = 0;
};

const glyphSettings: GlyphFn = (ctx, s) => {
  ctx.strokeStyle = HOLO.cyan;
  ctx.lineWidth = s * 0.045;
  ctx.lineCap = "round";
  ctx.shadowColor = HOLO.cyan;
  ctx.shadowBlur = s * 0.08;
  const c = s / 2;
  const r = s * 0.26;
  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    ctx.moveTo(c + Math.cos(a) * (r + s * 0.05), c + Math.sin(a) * (r + s * 0.05));
    ctx.lineTo(c + Math.cos(a) * (r + s * 0.13), c + Math.sin(a) * (r + s * 0.13));
  }
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(c, c, r * 0.34, 0, Math.PI * 2);
  ctx.stroke();
  ctx.shadowBlur = 0;
};

export const APPS: AppDef[] = [
  {
    id: "notes",
    name: "NOTES",
    glyph: glyphNotes,
    w: 0.74,
    h: 0.62,
    Component: NotesApp,
  },
  {
    id: "terminal",
    name: "TERMINAL",
    glyph: glyphTerminal,
    w: 0.66,
    h: 0.58,
    Component: TerminalApp,
  },
  {
    id: "vitals",
    name: "VITALS",
    glyph: glyphVitals,
    w: 0.64,
    h: 0.46,
    Component: VitalsApp,
  },
  {
    id: "timer",
    name: "TIMER",
    glyph: glyphTimer,
    w: 0.54,
    h: 0.46,
    Component: TimerApp,
  },
  {
    id: "chrono",
    name: "CHRONO",
    glyph: glyphChrono,
    w: 0.56,
    h: 0.48,
    Component: ChronoApp,
  },
  {
    id: "sonics",
    name: "SONICS",
    glyph: glyphSonics,
    w: 0.64,
    h: 0.36,
    Component: SonicsApp,
  },
  {
    id: "settings",
    name: "SETTINGS",
    glyph: glyphSettings,
    w: 0.6,
    h: 0.46,
    Component: SettingsApp,
  },
];

export function appById(id: string): AppDef | undefined {
  return APPS.find((a) => a.id === id);
}

export type AppNode = ReactNode;

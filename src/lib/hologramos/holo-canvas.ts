/**
 * HologramOS — holographic canvas engine.
 *
 * Every panel, icon, button and readout is drawn onto a 2D canvas and used
 * as an (additive) texture on a plane. That keeps the whole OS dependency-
 * free, pixel-crisp at any DPI, and perfectly consistent: one style system,
 * cyan-on-glass, everywhere.
 */

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

export const HOLO = {
  cyan: "#67e8f9",
  cyanSoft: "#22d3ee",
  ice: "#cffafe",
  pale: "#a5f3fc",
  dim: "rgba(103,232,249,0.38)",
  ghost: "rgba(103,232,249,0.14)",
  faint: "rgba(103,232,249,0.07)",
  bg: "rgba(6,14,26,0.55)",
  bgDeep: "rgba(3,9,18,0.72)",
  danger: "#f87171",
  amber: "#fbbf24",
  green: "#34d399",
  mono: "ui-monospace, 'SF Mono', 'Cascadia Mono', Menlo, Consolas, monospace",
};

export interface Surface {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  tex: THREE.CanvasTexture;
  w: number;
  h: number;
}

/** Create an offscreen canvas + canvas texture ready for hologram drawing. */
export function createSurface(w: number, h: number): Surface {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  return { canvas, ctx, tex, w, h };
}

/**
 * React hook: a canvas texture that redraws whenever deps change.
 * draw() runs inside an effect with a cleared context (never during render).
 */
export function useSurface(
  w: number,
  h: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  deps: unknown[]
): THREE.CanvasTexture | null {
  // client-only by construction: these components render inside R3F <Canvas>
  const surface = useMemo<Surface>(() => createSurface(w, h), [w, h]);
  const drawRef = useRef(draw);

  useEffect(() => {
    drawRef.current = draw;
  });

  // dispose when the surface is replaced or unmounted
  useEffect(() => {
    return () => {
      surface.tex.dispose();
    };
  }, [surface]);

  // redraw whenever the surface or any dep changes
  useEffect(() => {
    surface.ctx.clearRect(0, 0, surface.w, surface.h);
    drawRef.current(surface.ctx, surface.w, surface.h);
    // three.js CanvasTexture API: flag the GPU upload after a canvas redraw.
    // The immutability rule can't see past the texture object boundary.
    // eslint-disable-next-line react-hooks/immutability
    surface.tex.needsUpdate = true;
  }, [surface, ...deps]);

  return surface.tex;
}

/* ------------------------------------------------------------------ */
/* Drawing primitives                                                  */
/* ------------------------------------------------------------------ */

export interface TextStyle {
  size?: number;
  color?: string;
  weight?: string;
  align?: CanvasTextAlign;
  baseline?: CanvasTextBaseline;
  /** letter spacing in em (drawn manually — works everywhere) */
  spacing?: number;
  glow?: number;
  font?: string;
}

function setFont(ctx: CanvasRenderingContext2D, s: TextStyle): void {
  ctx.font = `${s.weight ?? "400"} ${s.size ?? 24}px ${s.font ?? HOLO.mono}`;
}

/** Measure text including manual letter spacing. */
export function measureSpaced(
  ctx: CanvasRenderingContext2D,
  str: string,
  spacing = 0
): number {
  if (!spacing) return ctx.measureText(str).width;
  let w = 0;
  for (const ch of str) w += ctx.measureText(ch).width + spacing;
  return w - spacing;
}

/** Text with manual letter spacing + soft glow. Returns the drawn width. */
export function holoText(
  ctx: CanvasRenderingContext2D,
  str: string,
  x: number,
  y: number,
  style: TextStyle = {}
): number {
  const spacing = (style.spacing ?? 0) * (style.size ?? 24);
  setFont(ctx, style);
  ctx.textAlign = "left";
  ctx.textBaseline = style.baseline ?? "middle";
  const total = measureSpaced(ctx, str, spacing);
  let startX = x;
  if (style.align === "center") startX = x - total / 2;
  else if (style.align === "right") startX = x - total;
  ctx.fillStyle = style.color ?? HOLO.cyan;
  if (style.glow) {
    ctx.shadowColor = style.color ?? HOLO.cyan;
    ctx.shadowBlur = style.glow;
  }
  let cx = startX;
  for (const ch of str) {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + spacing;
  }
  ctx.shadowBlur = 0;
  return total;
}

/** Rounded glass panel. */
export function panel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  opts: { fill?: string; stroke?: string; lw?: number; glow?: number } = {}
): void {
  const k = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + k, y);
  ctx.arcTo(x + w, y, x + w, y + h, k);
  ctx.arcTo(x + w, y + h, x, y + h, k);
  ctx.arcTo(x, y + h, x, y, k);
  ctx.arcTo(x, y, x + w, y, k);
  ctx.closePath();
  if (opts.fill) {
    ctx.fillStyle = opts.fill;
    ctx.fill();
  }
  if (opts.stroke) {
    ctx.strokeStyle = opts.stroke;
    ctx.lineWidth = opts.lw ?? 2;
    if (opts.glow) {
      ctx.shadowColor = opts.stroke;
      ctx.shadowBlur = opts.glow;
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
}

/** Iron-Man targeting corner brackets on a rect. */
export function cornerBrackets(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  len: number,
  color: string,
  lw = 3
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.lineCap = "round";
  ctx.beginPath();
  // tl
  ctx.moveTo(x, y + len);
  ctx.lineTo(x, y);
  ctx.lineTo(x + len, y);
  // tr
  ctx.moveTo(x + w - len, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + len);
  // br
  ctx.moveTo(x + w, y + h - len);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x + w - len, y + h);
  // bl
  ctx.moveTo(x + len, y + h);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + h - len);
  ctx.stroke();
}

/** Subtle horizontal scanlines over a rect (hologram texture). */
export function scanlines(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  alpha = 0.05,
  step = 5
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = `rgba(103,232,249,${alpha})`;
  for (let sy = y; sy < y + h; sy += step) ctx.fillRect(x, sy, w, 1);
  ctx.restore();
}

/** Arc gauge (timer ring, boot progress, dial arcs). */
export function gauge(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  from: number,
  to: number,
  color: string,
  lw = 6,
  glow = 10
): void {
  ctx.beginPath();
  ctx.arc(cx, cy, r, from, to);
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.lineCap = "round";
  ctx.shadowColor = color;
  ctx.shadowBlur = glow;
  ctx.stroke();
  ctx.shadowBlur = 0;
}

/** Horizontal meter bar. */
export function meter(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  frac: number,
  color: string
): void {
  const f = Math.max(0, Math.min(1, frac));
  ctx.fillStyle = HOLO.faint;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;
  ctx.fillRect(x, y, w * f, h);
  ctx.shadowBlur = 0;
}

/** Word-wrapped text block. Returns the number of lines drawn. */
export function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxW: number,
  lineH: number,
  maxLines: number,
  style: TextStyle = {}
): number {
  setFont(ctx, style);
  ctx.fillStyle = style.color ?? HOLO.ice;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  const words = text.split(/\s+/).filter(Boolean);
  let line = "";
  let lines = 0;
  const flush = () => {
    if (lines >= maxLines) return;
    ctx.fillText(line, x, y + lines * lineH);
    lines++;
    line = "";
  };
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxW && line) {
      flush();
      line = word;
    } else {
      line = test;
    }
  }
  if (line && lines < maxLines) flush();
  return lines;
}

/** format seconds → "MM:SS" or "H:MM:SS" */
export function fmtDur(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

/** "T+MM:SS" session uptime */
export function fmtUptime(ms: number): string {
  return `T+${fmtDur(ms / 1000)}`;
}

/**
 * Infinity — procedural hologram generator.
 *
 * When an asked-for object isn't in the hand-authored library, we build it
 * here: a deterministic, seeded composition of three.js primitives. The same
 * ask always produces the same model, it runs instantly, offline, and cannot
 * fail — no AI, no API key, no network.
 */
import type { HoloPart, HoloPartType, HoloSpec } from "./types";
import { normalizeHoloSpec } from "./holo";

/* ------------------------------------------------------------------ */
/* Seeded randomness (mulberry32 + FNV-1a)                             */
/* ------------------------------------------------------------------ */

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rand = () => number;
/** range helper: r(a, b) → uniform in [a, b) */
const r = (rand: Rand, a: number, b: number) => a + rand() * (b - a);
/** pick helper */
const pick = <T,>(rand: Rand, arr: readonly T[]): T => arr[Math.floor(rand() * arr.length) % arr.length];

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Compact part factory — rounds everything to 2 decimals. */
const p = (
  type: HoloPartType,
  position: [number, number, number],
  rotation: [number, number, number],
  scale: [number, number, number],
  color: string,
): HoloPart => ({
  type,
  position: [round2(position[0]), round2(position[1]), round2(position[2])],
  rotation: [round2(rotation[0]), round2(rotation[1]), round2(rotation[2])],
  scale: [round2(scale[0]), round2(scale[1]), round2(scale[2])],
  color,
});

/* Palettes — hologram-friendly families. */
const PALETTES = [
  ["#7dd3fc", "#38bdf8", "#0ea5e9", "#bae6fd"],
  ["#a5b4fc", "#818cf8", "#6366f1", "#c7d2fe"],
  ["#6ee7b7", "#34d399", "#10b981", "#a7f3d0"],
  ["#fcd34d", "#fbbf24", "#d97706", "#fde68a"],
  ["#fda4af", "#fb7185", "#e11d48", "#fecdd3"],
  ["#c4b5fd", "#a78bfa", "#7c3aed", "#ddd6fe"],
] as const;

/* ------------------------------------------------------------------ */
/* Archetype builders (raw coordinates; normalized at the end)         */
/* ------------------------------------------------------------------ */

interface CreatureMods {
  legH?: number; // leg height multiplier
  neck?: number; // neck length (0 = head on shoulders)
  body?: number; // body length multiplier
  head?: number; // head size multiplier
  ears?: number; // ear length multiplier
  tail?: number; // tail length multiplier
  spikes?: boolean; // dorsal spikes (dragon, dino)
  wings?: boolean; // membrane wings
  horn?: boolean; // unicorn horn
  shell?: boolean; // turtle shell dome
  fat?: boolean; // chunky legs
}

function creature(rand: Rand, m: CreatureMods, pal: string[]): HoloPart[] {
  const parts: HoloPart[] = [];
  const legH = 0.4 * (m.legH ?? 1);
  const bodyLen = 0.85 * (m.body ?? 1);
  const bodyR = 0.3 * (m.body ?? 1) * (m.fat ? 1.25 : 1);
  const neck = 0.34 * (m.neck ?? 1);
  const headR = 0.24 * (m.head ?? 1);
  const y0 = legH + bodyR; // body center height
  const [cBody, cAcc, cDark, cLight] = pal;

  // torso (capsule lying along Z)
  parts.push(p("capsule", [0, y0, 0], [Math.PI / 2, 0, 0], [bodyR, bodyLen / 2, bodyR], cBody));

  // head (+ optional neck)
  const headZ = bodyLen / 2 + (neck > 0.05 ? neck * 0.55 : headR * 0.7);
  const headY = y0 + bodyR * 0.35 + (neck > 0.05 ? neck * 0.85 : headR * 0.5);
  if (neck > 0.05) {
    parts.push(p("cylinder", [0, (y0 + headY) / 2 - 0.02, (bodyLen / 2 + headZ) / 2 - 0.12], [0.5, 0, 0], [headR * 0.5, neck * 0.62, headR * 0.5], cBody));
  }
  parts.push(p("sphere", [0, headY, headZ], [0, 0, 0], [headR, headR, headR], cLight));
  // snout
  parts.push(p("box", [0, headY - headR * 0.25, headZ + headR * 0.8], [0, 0, 0], [headR * 0.45, headR * 0.3, headR * 0.45], cAcc));
  // eyes
  for (const s of [-1, 1]) {
    parts.push(p("sphere", [s * headR * 0.55, headY + headR * 0.25, headZ + headR * 0.62], [0, 0, 0], [0.045, 0.045, 0.045], "#67e8f9"));
  }
  // ears
  const earLen = 0.16 * (m.ears ?? 1);
  for (const s of [-1, 1]) {
    if (earLen > 0.3) {
      parts.push(p("capsule", [s * headR * 0.5, headY + headR + earLen * 0.5, headZ - headR * 0.15], [0.15 * s, 0, -0.25 * s], [0.05, earLen, 0.05], cBody));
    } else {
      parts.push(p("cone", [s * headR * 0.55, headY + headR * 0.9, headZ - headR * 0.2], [0, 0, 0], [0.07, earLen * 0.6, 0.07], cBody));
    }
  }
  if (m.horn) {
    parts.push(p("cone", [0, headY + headR * 1.05, headZ], [0, 0, 0], [0.05, 0.4, 0.05], "#fcd34d"));
  }
  // legs
  const legR = m.fat ? 0.11 : 0.07;
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]] as const) {
    parts.push(p("cylinder", [sx * bodyR * 0.72, legH / 2, sz * bodyLen * 0.36], [0, 0, 0], [legR, legH / 2, legR], cDark));
  }
  // tail
  const tail = 0.35 * (m.tail ?? 1);
  if (tail > 0.08) {
    parts.push(p("cone", [0, y0 + 0.08, -bodyLen / 2 - tail * 0.45], [1.9, 0, 0], [0.06, tail * 0.55, 0.06], cAcc));
  }
  if (m.shell) {
    parts.push(p("sphere", [0, y0 + bodyR * 0.42, 0], [0, 0, 0], [bodyR * 1.25, bodyR * 0.75, bodyLen * 0.62], cAcc));
  }
  if (m.spikes) {
    const n = 5;
    for (let i = 0; i < n; i++) {
      const z = bodyLen / 2 - 0.12 - (i * (bodyLen - 0.2)) / (n - 1);
      parts.push(p("cone", [0, y0 + bodyR * 0.95, z], [0, 0, 0], [0.05, 0.14, 0.05], cLight));
    }
  }
  if (m.wings) {
    for (const s of [-1, 1]) {
      parts.push(p("box", [s * (bodyR + 0.42), y0 + bodyR * 0.6, -0.05], [0, 0.3 * s, 0.5 * s], [0.42, 0.04, 0.34], cLight));
    }
  }
  return parts;
}

function bird(rand: Rand, pal: string[]): HoloPart[] {
  const [cBody, cAcc, cDark, cLight] = pal;
  return [
    p("sphere", [0, 0.1, 0], [0, 0, 0], [0.3, 0.34, 0.42], cBody),
    p("sphere", [0, 0.42, 0.28], [0, 0, 0], [0.2, 0.2, 0.2], cLight),
    p("cone", [0, 0.4, 0.5], [1.5708, 0, 0], [0.06, 0.16, 0.06], cAcc), // beak +Z
    p("sphere", [-0.11, 0.48, 0.4], [0, 0, 0], [0.04, 0.04, 0.04], "#67e8f9"),
    p("sphere", [0.11, 0.48, 0.4], [0, 0, 0], [0.04, 0.04, 0.04], "#67e8f9"),
    p("cone", [0, 0.08, -0.5], [-1.8, 0, 0], [0.22, 0.34, 0.04], cAcc), // tail
    p("box", [-0.4, 0.22, 0], [0, 0.35, 0.45], [0.36, 0.04, 0.26], cLight),
    p("box", [0.4, 0.22, 0], [0, -0.35, 0.45], [0.36, 0.04, 0.26], cLight),
    p("cylinder", [-0.09, -0.3, 0.05], [0, 0, 0], [0.025, 0.16, 0.025], cDark),
    p("cylinder", [0.09, -0.3, 0.05], [0, 0, 0], [0.025, 0.16, 0.025], cDark),
    p("box", [-0.09, -0.44, 0.12], [0, 0, 0], [0.09, 0.025, 0.14], cDark),
    p("box", [0.09, -0.44, 0.12], [0, 0, 0], [0.09, 0.025, 0.14], cDark),
    p("cone", [0, 0.63, 0.26], [r(rand, -0.2, 0.2), 0, 0], [0.05, r(rand, 0.1, 0.2), 0.05], cAcc), // crest
  ];
}

function insect(rand: Rand, pal: string[]): HoloPart[] {
  const [cBody, cAcc, , cLight] = pal;
  const parts: HoloPart[] = [
    p("capsule", [0, 0, 0], [1.5708, 0, 0], [0.08, 0.32, 0.08], cBody),
    p("sphere", [0, 0.03, 0.4], [0, 0, 0], [0.13, 0.13, 0.13], cLight),
    p("cylinder", [-0.05, 0.17, 0.48], [0.5, 0, 0.4], [0.015, 0.14, 0.015], cAcc),
    p("cylinder", [0.05, 0.17, 0.48], [0.5, 0, -0.4], [0.015, 0.14, 0.015], cAcc),
  ];
  for (const s of [-1, 1]) {
    parts.push(p("sphere", [s * 0.42, 0.16, 0.05], [0, 0.4 * s, 0.25 * s], [r(rand, 0.3, 0.38), 0.03, r(rand, 0.2, 0.27)], cLight));
    parts.push(p("sphere", [s * 0.34, 0.14, -0.18], [0, 0.5 * s, 0.35 * s], [r(rand, 0.2, 0.27), 0.03, r(rand, 0.14, 0.19)], cBody));
  }
  return parts;
}

interface FigureMods {
  snowman?: boolean;
  hat?: boolean;
  crown?: boolean;
  cape?: boolean;
}

function figure(rand: Rand, m: FigureMods, pal: string[]): HoloPart[] {
  const [cBody, cAcc, cDark, cLight] = pal;
  const parts: HoloPart[] = [];
  if (m.snowman) {
    parts.push(
      p("sphere", [0, -0.55, 0], [0, 0, 0], [0.52, 0.52, 0.52], cLight),
      p("sphere", [0, 0.15, 0], [0, 0, 0], [0.38, 0.38, 0.38], cLight),
      p("sphere", [0, 0.62, 0], [0, 0, 0], [0.27, 0.27, 0.27], cLight),
      p("cone", [0, 0.6, 0.26], [1.5708, 0, 0], [0.045, 0.2, 0.045], "#fb923c"),
      p("sphere", [-0.09, 0.68, 0.22], [0, 0, 0], [0.035, 0.035, 0.035], "#0f172a"),
      p("sphere", [0.09, 0.68, 0.22], [0, 0, 0], [0.035, 0.035, 0.035], "#0f172a"),
      p("cylinder", [0, 0.98, 0], [0, 0, 0], [0.24, 0.03, 0.24], cDark),
      p("cylinder", [0, 1.14, 0], [0, 0, 0], [0.15, 0.14, 0.15], cDark),
      p("cylinder", [0, -0.05, 0], [1.5708, 0, 0], [0.05, 0.3, 0.05], cDark),
    );
    return parts;
  }
  parts.push(
    // legs
    p("capsule", [-0.13, -0.55, 0], [0.1, 0, 0], [0.085, 0.3, 0.085], cDark),
    p("capsule", [0.13, -0.55, 0], [-0.1, 0, 0], [0.085, 0.3, 0.085], cDark),
    // torso + pelvis
    p("capsule", [0, 0.08, 0], [0, 0, 0], [0.21, 0.3, 0.15], cBody),
    p("box", [0, -0.28, 0], [0, 0, 0], [0.19, 0.1, 0.13], cDark),
    // arms
    p("capsule", [-0.32, 0.12, 0], [0, 0, r(rand, 0.7, 1)], [0.06, r(rand, 0.24, 0.32), 0.06], cBody),
    p("capsule", [0.32, 0.12, 0], [0, 0, -r(rand, 0.7, 1)], [0.06, r(rand, 0.24, 0.32), 0.06], cBody),
    // head + face
    p("sphere", [0, 0.62, 0], [0, 0, 0], [0.19, 0.21, 0.19], cLight),
    p("sphere", [-0.07, 0.66, 0.16], [0, 0, 0], [0.03, 0.03, 0.03], "#67e8f9"),
    p("sphere", [0.07, 0.66, 0.16], [0, 0, 0], [0.03, 0.03, 0.03], "#67e8f9"),
  );
  if (m.hat) {
    parts.push(p("cone", [0, 0.92, -0.02], [-0.3, 0, 0], [0.22, 0.34, 0.22], cAcc));
  }
  if (m.crown) {
    parts.push(p("cylinder", [0, 0.82, 0], [0, 0, 0], [0.16, 0.06, 0.16], "#fcd34d"));
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      parts.push(p("cone", [Math.cos(a) * 0.15, 0.94, Math.sin(a) * 0.15], [0, 0, 0], [0.035, 0.09, 0.035], "#fcd34d"));
    }
  }
  if (m.cape) {
    parts.push(p("box", [0, 0.1, -0.17], [0.15, 0, 0], [0.24, 0.42, 0.03], cAcc));
  }
  return parts;
}

function fish(rand: Rand, big: boolean, pal: string[]): HoloPart[] {
  const [cBody, cAcc, cDark, cLight] = pal;
  const L = (big ? 1.05 : 0.72) * r(rand, 0.9, 1.1);
  return [
    p("sphere", [0, 0, 0], [0, 0, 0], [L * 0.42, L * 0.3, L], cBody),
    p("cone", [0, 0.05, -L - 0.1], [0, 1.5708, 0], [L * 0.3, 0.28, 0.05], cAcc), // tail fin
    p("cone", [0, L * 0.32, 0], [0, 0, 0], [L * 0.16, L * 0.22, 0.045], cAcc), // dorsal
    p("sphere", [-L * 0.5, -0.08, 0.05], [0, 0, 0.5], [L * 0.2, 0.035, L * 0.1], cLight), // left fin
    p("sphere", [L * 0.5, -0.08, 0.05], [0, 0, -0.5], [L * 0.2, 0.035, L * 0.1], cLight), // right fin
    p("sphere", [-L * 0.32, L * 0.12, L * 0.55], [0, 0, 0], [0.05, 0.05, 0.05], "#67e8f9"),
    p("sphere", [L * 0.32, L * 0.12, L * 0.55], [0, 0, 0], [0.05, 0.05, 0.05], "#67e8f9"),
    p("cone", [0, L * 0.05, L * 0.98], [1.5708, 0, 0], [0.04, 0.09, 0.04], cDark), // nose
  ];
}

function octopus(rand: Rand, pal: string[]): HoloPart[] {
  const [cBody, cAcc, cDark, cLight] = pal;
  const parts: HoloPart[] = [
    p("sphere", [0, 0.42, 0], [0, 0, 0], [0.5, 0.45, 0.5], cBody),
    p("sphere", [-0.16, 0.5, 0.42], [0, 0, 0], [0.07, 0.09, 0.05], "#67e8f9"),
    p("sphere", [0.16, 0.5, 0.42], [0, 0, 0], [0.07, 0.09, 0.05], "#67e8f9"),
  ];
  const n = 7;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x = Math.cos(a), z = Math.sin(a);
    parts.push(p("capsule", [x * 0.42, -0.28, z * 0.42], [x * 0.55, 0, z * 0.35], [0.075, 0.4, 0.075], i % 2 ? cAcc : cLight));
  }
  return parts;
}

function flower(rand: Rand, pal: string[]): HoloPart[] {
  const [cBody, cAcc, , cLight] = pal;
  const parts: HoloPart[] = [
    p("cylinder", [0, -0.3, 0], [0, 0, 0], [0.035, 0.5, 0.035], "#34d399"),
    p("sphere", [-0.24, -0.32, 0.08], [0, 0, 0.5], [0.2, 0.04, 0.1], "#10b981"),
    p("sphere", [0.24, -0.42, -0.06], [0, 0, -0.5], [0.2, 0.04, 0.1], "#10b981"),
  ];
  const petals = 7 + Math.floor(rand() * 3);
  for (let i = 0; i < petals; i++) {
    const a = (i / petals) * Math.PI * 2;
    parts.push(p("capsule", [Math.cos(a) * 0.3, 0.32, Math.sin(a) * 0.3], [0, -a, 0], [0.11, 0.2, 0.045], i % 2 ? cAcc : cLight));
  }
  parts.push(p("sphere", [0, 0.34, 0], [0, 0, 0], [0.14, 0.12, 0.14], "#fcd34d"));
  return parts;
}

interface VehicleMods {
  heli?: boolean;
  train?: boolean;
  tank?: boolean;
}

function vehicle(rand: Rand, m: VehicleMods, pal: string[]): HoloPart[] {
  const [cBody, cAcc, cDark, cLight] = pal;
  const parts: HoloPart[] = [];
  if (m.heli) {
    parts.push(
      p("capsule", [0, 0, 0], [0, 1.5708, 0], [0.26, 0.55, 0.24], cBody),
      p("sphere", [0.5, 0.1, 0], [0, 0, 0], [0.22, 0.2, 0.22], cLight), // cockpit
      p("cylinder", [-0.75, 0.12, 0], [0, 0, 1.5708], [0.05, 0.35, 0.05], cDark), // tail boom
      p("box", [-1.05, 0.24, 0], [0, 0, 0], [0.09, 0.16, 0.03], cAcc), // tail fin
      p("cylinder", [0, 0.34, 0], [0, 0, 0], [0.04, 0.06, 0.04], cDark), // rotor mast
      p("box", [0, 0.42, 0], [0, rand() * 3, 0], [1.15, 0.02, 0.07], cAcc), // blade A
      p("box", [0, 0.42, 0], [0, rand() * 3, 0], [0.07, 0.02, 1.15], cAcc), // blade B
      p("cylinder", [-0.35, -0.3, -0.3], [0, 0, 1.5708], [0.03, 0.3, 0.03], cDark), // skid L
      p("cylinder", [-0.35, -0.3, 0.3], [0, 0, 1.5708], [0.03, 0.3, 0.03], cDark), // skid R
    );
    return parts;
  }
  if (m.tank) {
    parts.push(
      p("box", [0, -0.1, 0], [0, 0, 0], [0.5, 0.16, 0.75], cDark),
      p("cylinder", [0, 0.16, 0], [0, 0, 0], [0.34, 0.14, 0.34], cBody),
      p("cylinder", [0, 0.2, 0.65], [1.5708, 0, 0], [0.055, 0.45, 0.055], cAcc), // barrel
      p("sphere", [0.24, 0.3, 0.05], [0, 0, 0], [0.06, 0.06, 0.06], cLight),
    );
    for (const s of [-1, 1]) {
      parts.push(p("cylinder", [s * 0.42, -0.16, 0], [0, 0, 1.5708], [0.16, 0.75, 0.16], cDark));
    }
    return parts;
  }
  // truck / bus / train / tractor — cab-over layout
  const long = m.train ? 1.0 : 0.8;
  parts.push(
    p("box", [0, -0.12, -long * 0.15], [0, 0, 0], [0.34, 0.16, long * 0.52], cBody), // bed
    p("box", [0, 0.14, long * 0.32], [0, 0, 0], [0.32, 0.24, long * 0.2], cAcc), // cab
    p("box", [0, 0.16, long * 0.48], [0, 0, 0], [0.26, 0.14, 0.03], "#67e8f9"), // windshield
  );
  if (m.train) {
    parts.push(
      p("cylinder", [0, 0.42, long * 0.18], [0, 0, 0], [0.07, 0.14, 0.07], cDark), // chimney
      p("cone", [0, 0.3, -long * 0.75], [0, 1.5708, 0], [0.12, 0.18, 0.1], cDark), // cow catcher
    );
  }
  const wz = [long * 0.38, 0, -long * 0.38];
  for (const z of wz) {
    for (const s of [-1, 1]) {
      parts.push(p("cylinder", [s * 0.3, -0.36, z], [0, 0, 1.5708], [m.train ? 0.14 : 0.17, 0.07, m.train ? 0.14 : 0.07], cDark));
    }
  }
  return parts;
}

/* ---- abstract archetypes (default for truly unknown asks) ---- */

function crystal(rand: Rand, pal: string[]): HoloPart[] {
  const [cBody, cAcc, , cLight] = pal;
  const parts: HoloPart[] = [p("cylinder", [0, -0.85, 0], [0, 0, 0], [0.55, 0.08, 0.55], cAcc)];
  const n = 6 + Math.floor(rand() * 3);
  parts.push(p("cone", [0, -0.1, 0], [0, 0, 0], [0.3, 0.75, 0.3], cBody));
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rand() * 0.5;
    const rad = r(rand, 0.25, 0.62);
    const h = r(rand, 0.3, 0.95);
    parts.push(p("cone", [Math.cos(a) * rad, -0.65 + h * 0.4, Math.sin(a) * rad], [r(rand, -0.35, 0.35), 0, r(rand, -0.35, 0.35)], [r(rand, 0.08, 0.18), h, r(rand, 0.08, 0.18)], i % 2 ? cLight : cAcc));
  }
  return parts;
}

function totem(rand: Rand, pal: string[]): HoloPart[] {
  const [cBody, cAcc, cDark, cLight] = pal;
  const parts: HoloPart[] = [];
  const types: HoloPartType[] = ["box", "cylinder", "sphere", "box"];
  let y = -0.9;
  for (let i = 0; i < 6; i++) {
    const t = types[i % types.length];
    const s = r(rand, 0.18, 0.3) * (i === 0 ? 1.35 : 1);
    const c = [cBody, cAcc, cDark, cLight][i % 4];
    if (t === "sphere") parts.push(p(t, [0, y + s, 0], [0, 0, 0], [s, s, s], c));
    else parts.push(p(t, [0, y + 0.14, 0], [0, rand(), 0], [s, 0.15, s * (i % 2 ? 0.7 : 1)], c));
    y += 0.3;
  }
  parts.push(p("torus", [0, y + 0.12, 0], [1.5708, 0, 0], [0.3, 0.3, 0.08], cLight));
  return parts;
}

function orbiter(rand: Rand, pal: string[]): HoloPart[] {
  const [cBody, cAcc, , cLight] = pal;
  const parts: HoloPart[] = [p("sphere", [0, 0, 0], [0, 0, 0], [0.42, 0.42, 0.42], cBody)];
  const ringN = 2 + Math.floor(rand() * 2);
  for (let i = 0; i < ringN; i++) {
    const tilt = r(rand, 0.3, 1.2) * (i % 2 ? 1 : -1);
    parts.push(p("torus", [0, 0, 0], [tilt, i * 1.2, 0], [0.75 + i * 0.22, 0.75 + i * 0.22, 0.04], i % 2 ? cAcc : cLight));
  }
  const moons = 3 + Math.floor(rand() * 3);
  for (let i = 0; i < moons; i++) {
    const a = r(rand, 0, Math.PI * 2);
    const rad = 0.75 + (i % ringN) * 0.22;
    parts.push(p("sphere", [Math.cos(a) * rad, r(rand, -0.35, 0.35), Math.sin(a) * rad], [0, 0, 0], [0.07, 0.07, 0.07], cAcc));
  }
  return parts;
}

function obelisk(rand: Rand, pal: string[]): HoloPart[] {
  const [cBody, cAcc, cDark, cLight] = pal;
  const parts: HoloPart[] = [
    p("box", [0, -0.95, 0], [0, 0, 0], [0.5, 0.07, 0.5], cDark),
    p("box", [0, -0.6, 0], [0, 0, 0], [0.3, 0.3, 0.3], cBody),
    p("box", [0, -0.12, 0], [0, 0, 0], [0.24, 0.24, 0.24], cBody),
    p("box", [0, 0.28, 0], [0, 0, 0], [0.18, 0.19, 0.18], cAcc),
    p("cone", [0, 0.62, 0], [0, 0, 0], [0.15, 0.28, 0.15], cLight),
  ];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.7;
    parts.push(p("sphere", [Math.cos(a) * 0.55, r(rand, -0.4, 0.45), Math.sin(a) * 0.55], [0, 0, 0], [0.06, 0.09, 0.06], cLight));
  }
  return parts;
}

function bloom(rand: Rand, pal: string[]): HoloPart[] {
  const [cBody, cAcc, cDark, cLight] = pal;
  const parts: HoloPart[] = [p("cylinder", [0, -0.75, 0], [0, 0, 0], [0.5, 0.06, 0.5], cDark)];
  const n = 9 + Math.floor(rand() * 3);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const tilt = 0.6 + (i % 3) * 0.25;
    parts.push(p("capsule", [Math.cos(a) * 0.5, -0.4, Math.sin(a) * 0.5], [tilt * Math.sin(a), 0, -tilt * Math.cos(a)], [0.06, 0.42, 0.06], i % 2 ? cAcc : cLight));
  }
  parts.push(p("sphere", [0, 0.25, 0], [0, 0, 0], [0.28, 0.28, 0.28], cBody));
  parts.push(p("torus", [0, -0.55, 0], [1.5708, 0, 0], [0.42, 0.42, 0.05], cLight));
  return parts;
}

/* ------------------------------------------------------------------ */
/* Keyword routing                                                      */
/* ------------------------------------------------------------------ */

const CREATURE_WORDS = new Set([
  "dog", "puppy", "cat", "kitten", "bear", "cub", "horse", "pony", "cow", "pig", "goat",
  "sheep", "deer", "fox", "wolf", "lion", "tiger", "zebra", "giraffe", "elephant", "rhino",
  "hippo", "dinosaur", "dragon", "turtle", "frog", "monkey", "gorilla", "panda", "bunny",
  "rabbit", "kangaroo", "camel", "llama", "unicorn", "cow", "moose", "bison", "leopard",
  "cheetah", "jaguar", "hyena", "boar", "donkey", "mule", "ferret", "otter", "beaver",
  "hedgehog", "raccoon", "skunk", "squirrel", "hamster", "mouse", "rat", "bat",
]);

const CREATURE_MODS: Record<string, CreatureMods> = {
  giraffe: { neck: 1.9, legH: 1.35, body: 1.05, head: 0.85, tail: 1.1 },
  elephant: { body: 1.35, legH: 0.85, head: 1.25, tail: 0.7, fat: true, ears: 1.7 },
  bunny: { ears: 2.6, legH: 0.55, body: 0.8, tail: 0.3 },
  rabbit: { ears: 2.6, legH: 0.55, body: 0.8, tail: 0.3 },
  dragon: { wings: true, spikes: true, neck: 1.3, tail: 1.5, body: 1.05 },
  dinosaur: { spikes: true, tail: 1.6, body: 1.15, legH: 0.8, head: 0.9 },
  unicorn: { horn: true, tail: 1.3, neck: 0.9 },
  kangaroo: { tail: 1.8, legH: 0.9, ears: 1.8 },
  turtle: { shell: true, legH: 0.45, tail: 0.4, body: 0.9 },
  frog: { legH: 0.35, body: 0.9, ears: 0.4, tail: 0.1, head: 1.1 },
  wolf: { tail: 1.1, ears: 1.2 },
  fox: { tail: 1.3, ears: 1.4 },
  horse: { tail: 1.2, neck: 1.1, legH: 1.1 },
  pony: { neck: 0.9, legH: 0.8 },
  panda: { body: 1.3, ears: 1.3, legH: 0.7, fat: true },
  gorilla: { body: 1.3, legH: 0.6, head: 0.9, fat: true, ears: 0.5 },
};

const BIRD_WORDS = new Set(["bird", "eagle", "hawk", "falcon", "owl", "parrot", "crow", "raven", "swan", "duck", "goose", "flamingo", "penguin", "chicken", "rooster", "sparrow", "phoenix", "dove", "pigeon", "stork", "crane", "heron", "peacock", "toucan"]);
const INSECT_WORDS = new Set(["butterfly", "moth", "bee", "dragonfly", "ladybug", "beetle", "bug", "ant", "firefly", "wasp", "hornet"]);
const FIGURE_WORDS = new Set(["person", "man", "woman", "boy", "girl", "kid", "child", "baby", "human", "knight", "astronaut", "hero", "warrior", "wizard", "witch", "king", "queen", "prince", "princess", "alien", "zombie", "monster", "giant", "yeti", "bigfoot", "ogre", "elf", "fairy", "snowman", "santa", "pirate", "soldier", "ninja", "samurai", "viking", "cowboy", "mermaid", "angel"]);
const FIGURE_MODS: Record<string, FigureMods> = {
  snowman: { snowman: true },
  wizard: { hat: true, cape: true },
  witch: { hat: true, cape: true },
  king: { crown: true, cape: true },
  queen: { crown: true, cape: true },
  prince: { crown: true },
  princess: { crown: true },
  knight: { cape: true },
  santa: { hat: true },
  pirate: { hat: true },
  ninja: { cape: true },
  samurai: { cape: true },
  viking: { hat: true },
  mermaid: { cape: true },
  angel: { cape: true },
};
const FISH_WORDS = new Set(["fish", "shark", "whale", "dolphin", "salmon", "tuna", "orca", "goldfish", "piranha", "eel", "seahorse", "stingray", "manta ray", "ray"]);
const OCTOPUS_WORDS = new Set(["octopus", "squid", "jellyfish", "jelly fish", "kraken"]);
const FLOWER_WORDS = new Set(["flower", "rose", "tulip", "sunflower", "daisy", "lily", "orchid", "blossom", "carnation", "lotus"]);
const VEHICLE_WORDS = new Set(["truck", "bus", "van", "train", "tractor", "tank", "submarine", "jeep", "bulldozer", "crane", "forklift", "locomotive", "pickup", "pickup truck", "fire truck", "monster truck", "helicopter", "chopper", "gyrocopter"]);
const VEHICLE_MODS: Record<string, VehicleMods> = {
  helicopter: { heli: true }, chopper: { heli: true }, gyrocopter: { heli: true },
  train: { train: true }, locomotive: { train: true },
  tank: { tank: true },
};
const ABSTRACTS = [crystal, totem, orbiter, obelisk, bloom];

function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Deterministically turn any object description into a hologram spec.
 * Never throws, never touches the network.
 */
export function generateModel(object: string): HoloSpec {
  const clean = object.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  const words = clean.split(" ").filter(Boolean);
  const seed = hashString(clean || "hologram");
  const rand = mulberry32(seed);
  const pal = [...pick(rand, PALETTES)];

  const has = (set: Set<string>) => words.some((w) => set.has(w));
  const keyOf = (set: Set<string>): string | null => words.find((w) => set.has(w)) ?? null;

  let parts: HoloPart[];
  try {
    if (has(CREATURE_WORDS)) {
      const key = keyOf(CREATURE_WORDS) ?? "";
      parts = creature(rand, CREATURE_MODS[key] ?? jitterMods(rand), pal);
    } else if (has(BIRD_WORDS)) {
      parts = bird(rand, pal);
    } else if (has(INSECT_WORDS)) {
      parts = insect(rand, pal);
    } else if (has(FIGURE_WORDS)) {
      const key = keyOf(FIGURE_WORDS) ?? "";
      parts = figure(rand, FIGURE_MODS[key] ?? {}, pal);
    } else if (has(FISH_WORDS)) {
      parts = fish(rand, words.some((w) => ["whale", "orca", "shark"].includes(w)), pal);
    } else if (has(OCTOPUS_WORDS)) {
      parts = octopus(rand, pal);
    } else if (has(FLOWER_WORDS)) {
      parts = flower(rand, pal);
    } else if (has(VEHICLE_WORDS)) {
      const key = keyOf(VEHICLE_WORDS) ?? "";
      parts = vehicle(rand, VEHICLE_MODS[key] ?? {}, pal);
    } else {
      parts = pick(rand, ABSTRACTS)(rand, pal);
    }
  } catch {
    parts = crystal(rand, [...PALETTES[0]]);
  }

  if (!parts || parts.length === 0) parts = crystal(rand, [...PALETTES[0]]);
  return normalizeHoloSpec(titleCase(clean) || "Hologram", parts);
}

/** Slight per-name variation so two different animals don't look identical. */
function jitterMods(rand: Rand): CreatureMods {
  return {
    legH: r(rand, 0.85, 1.2),
    body: r(rand, 0.9, 1.15),
    neck: r(rand, 0.7, 1.3),
    head: r(rand, 0.9, 1.15),
    ears: r(rand, 0.8, 1.4),
    tail: r(rand, 0.8, 1.4),
  };
}

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
/* Parametric families — everyday objects built accurately             */
/* ------------------------------------------------------------------ */

type V3 = [number, number, number];
/** Shorthand part factories (same conventions as the mesh renderer). */
const cyl = (x: number, y: number, z: number, r: number, h: number, c: string, rot: V3 = [0, 0, 0]): HoloPart =>
  p("cylinder", [x, y, z], rot, [r, h, r], c);
const boxP = (x: number, y: number, z: number, hx: number, hy: number, hz: number, c: string, rot: V3 = [0, 0, 0]): HoloPart =>
  p("box", [x, y, z], rot, [hx, hy, hz], c);
const sph = (x: number, y: number, z: number, r: number, c: string, sy = r, sz = r): HoloPart =>
  p("sphere", [x, y, z], [0, 0, 0], [r, sy, sz], c);
const coneP = (x: number, y: number, z: number, r: number, h: number, c: string, rot: V3 = [0, 0, 0]): HoloPart =>
  p("cone", [x, y, z], rot, [r, h, r], c);
const flat = (x: number, y: number, z: number, ringR: number, tube: number, c: string, rot: V3 = [0, 0, 0]): HoloPart =>
  p("torus", [x, y, z], rot, [ringR, ringR, tube], c);

const C = {
  wood: "#c89666", woodD: "#8d6e63", woodDD: "#5d4037", woodL: "#e6cfb5",
  metal: "#9fb3c8", metalD: "#5d6d7e", dark: "#34495e",
  white: "#eef3f8", cyan: "#7ee8fa", gold: "#f6c453",
  red: "#e2483d", green: "#2ecc71", yellow: "#f4d03f", orange: "#e67e22",
  brown: "#8d5524", tan: "#d9a05b", pink: "#f78fb3", cream: "#f5e6c8",
  gray: "#95a5a6", slate: "#7f8c8d",
} as const;

/* ---- seating: stool / chair / armchair / sofa / bench / throne ---- */
interface SeatMods { back?: boolean; arms?: boolean; wide?: number; cushion?: boolean; throne?: boolean; }
function seating(rand: Rand, m: SeatMods, pal: string[]): HoloPart[] {
  const [cBody, cAcc, cDark] = pal;
  const w = 0.42 * (m.wide ?? 1), d = 0.38, seatY = 0.46;
  const parts: HoloPart[] = [];
  const legXs = (m.wide ?? 1) > 1.3 ? [-w + 0.09, 0, w - 0.09] : [-w + 0.09, w - 0.09];
  for (const lx of legXs) for (const sz of [-1, 1]) {
    parts.push(cyl(lx, seatY / 2, sz * (d - 0.06), 0.04, seatY / 2, cDark));
  }
  parts.push(boxP(0, seatY, 0, w + (m.cushion ? 0.05 : 0), m.cushion ? 0.08 : 0.04, d + 0.03,
    m.cushion ? cAcc : C.wood, [r(rand, -0.015, 0.015), 0, 0]));
  if (m.back) {
    const backH = m.throne ? 1.15 : 0.8;
    for (const sx of [-1, 1]) {
      parts.push(cyl(sx * (w - 0.09), seatY + backH / 2, -(d - 0.05), 0.035, backH / 2, cDark));
    }
    const slats = m.throne ? 4 : 3;
    for (let i = 0; i < slats; i++) {
      parts.push(boxP(0, seatY + 0.18 + (i * (backH - 0.32)) / Math.max(1, slats - 1), -(d - 0.05),
        w - 0.12, 0.07, 0.025, m.throne ? C.gold : m.cushion ? cAcc : C.woodD));
    }
    if (m.throne) {
      for (const sx of [-1, 1]) parts.push(coneP(sx * (w - 0.09), seatY + backH + 0.09, -(d - 0.05), 0.05, 0.09, C.gold));
      parts.push(sph(0, seatY + backH - 0.12, -(d - 0.05), 0.06, C.cyan, 0.06, 0.03));
    }
  }
  if (m.arms) {
    for (const sx of [-1, 1]) {
      parts.push(boxP(sx * (w + 0.07), seatY + 0.24, 0.02, 0.055, 0.045, d + 0.02, m.cushion ? cAcc : C.wood));
      parts.push(boxP(sx * (w + 0.07), seatY + 0.12, d - 0.08, 0.05, 0.12, 0.04, cDark));
    }
  }
  return parts;
}

/* ---- tables / desks / nightstands ---- */
function tableFam(rand: Rand, kind: "table" | "desk" | "night"): HoloPart[] {
  const h = kind === "night" ? 0.5 : 0.72;
  const tw = kind === "night" ? 0.44 : 0.85, td = kind === "night" ? 0.34 : 0.5;
  const parts: HoloPart[] = [
    boxP(0, h, 0, tw, 0.035, td, C.wood),
  ];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    parts.push(cyl(sx * (tw - 0.09), h / 2 - 0.03, sz * (td - 0.08), 0.035, h / 2 - 0.03, C.woodD));
  }
  if (kind !== "table") {
    const rows = kind === "night" ? 2 : 3;
    for (let i = 0; i < rows; i++) {
      const y = h - 0.16 - i * 0.2;
      parts.push(boxP(tw - 0.32, y, td - 0.05, 0.24, 0.07, 0.012, C.woodD, [0, 0, 0]));
      parts.push(sph(tw - 0.32, y, td + 0.01, 0.025, C.gold));
    }
  }
  // grain detail line so `rand` shapes the wood tone subtly
  parts.push(boxP(r(rand, -0.2, 0.2), h + 0.037, r(rand, -0.2, 0.2), tw * 0.3, 0.002, 0.02, C.woodL));
  return parts;
}

/* ---- beds ---- */
function bedFam(rand: Rand, pal: string[]): HoloPart[] {
  const [cAcc] = pal;
  return [
    boxP(0, 0.55, -0.62, 0.95, 0.4, 0.035, C.woodD),            // headboard
    boxP(0, 0.22, 0, 0.95, 0.1, 0.62, C.woodDD),                // frame
    boxP(0, 0.36, 0, 0.9, 0.09, 0.56, C.white),                 // mattress
    boxP(0, 0.45, -0.42, 0.32, 0.07, 0.2, C.cream, [r(rand, -0.06, 0.06), 0, 0]), // pillow
    boxP(0, 0.43, 0.16, 0.92, 0.05, 0.36, cAcc),                // blanket
    boxP(0, 0.47, -0.02, 0.92, 0.02, 0.06, cAcc),               // blanket fold
  ];
}

/* ---- storage: shelf / bookcase / dresser / cabinet / chest ---- */
interface StoreMods { books?: boolean; drawers?: boolean; doors?: boolean; chest?: boolean; }
function storageFam(rand: Rand, m: StoreMods): HoloPart[] {
  const parts: HoloPart[] = [];
  if (m.chest) {
    parts.push(
      boxP(0, 0.22, 0, 0.6, 0.22, 0.35, C.woodD),
      cyl(0, 0.44, 0, 0.35, 0.6, C.wood, [0, 0, 1.5708]), // rounded lid
      boxP(-0.25, 0.24, 0, 0.02, 0.26, 0.37, C.gold),
      boxP(0.25, 0.24, 0, 0.02, 0.26, 0.37, C.gold),
      boxP(0, 0.3, 0.36, 0.05, 0.06, 0.02, C.gold),
      sph(0, 0.44, 0.37, 0.03, C.cyan),
    );
    return parts;
  }
  if (m.drawers) {
    parts.push(boxP(0, 0.45, 0, 0.6, 0.45, 0.3, C.wood));
    for (let i = 0; i < 3; i++) {
      const y = 0.2 + i * 0.25;
      parts.push(boxP(0, y, 0.31, 0.52, 0.1, 0.012, C.woodD));
      parts.push(cyl(0, y, 0.33, 0.02, 0.02, C.gold, [1.5708, 0, 0]));
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      parts.push(boxP(sx * 0.5, 0.04, sz * 0.22, 0.03, 0.05, 0.03, C.woodDD));
    }
    return parts;
  }
  if (m.doors) {
    parts.push(
      boxP(0, 0.55, 0, 0.6, 0.55, 0.3, C.wood),
      boxP(-0.29, 0.55, 0.31, 0.27, 0.48, 0.012, C.woodD),
      boxP(0.29, 0.55, 0.31, 0.27, 0.48, 0.012, C.woodD),
      cyl(-0.06, 0.55, 0.33, 0.015, 0.07, C.gold),
      cyl(0.06, 0.55, 0.33, 0.015, 0.07, C.gold),
      boxP(0, 1.12, 0, 0.64, 0.03, 0.32, C.woodD),
    );
    return parts;
  }
  // open shelf / bookcase
  for (const sx of [-1, 1]) parts.push(boxP(sx * 0.55, 0.55, 0, 0.03, 0.55, 0.28, C.woodD));
  parts.push(boxP(0, 0.55, -0.26, 0.55, 0.55, 0.012, C.woodDD));
  for (let i = 0; i < 4; i++) {
    parts.push(boxP(0, 0.06 + i * 0.33, 0, 0.53, 0.02, 0.28, C.wood));
  }
  if (m.books) {
    const bookCols = ["#e2483d", "#3498db", "#f4d03f", "#2ecc71", "#9b59b6", "#e67e22"];
    for (let shelf = 0; shelf < 3; shelf++) {
      const y = 0.09 + shelf * 0.33;
      let x = -0.42;
      let k = Math.floor(r(rand, 0, bookCols.length));
      while (x < 0.3) {
        const w = r(rand, 0.03, 0.055), h = r(rand, 0.2, 0.27);
        parts.push(boxP(x + w, y + h / 2, 0, w, h / 2, 0.17, bookCols[k % bookCols.length]));
        x += w * 2 + r(rand, 0.005, 0.03);
        k++;
      }
    }
  }
  return parts;
}

/* ---- screens: tv / monitor / phone / tablet / laptop / computer ---- */
function screens(rand: Rand, kind: string): HoloPart[] {
  const parts: HoloPart[] = [];
  if (kind === "phone" || kind === "tablet") {
    const s = kind === "phone" ? 1 : 1.9;
    parts.push(
      boxP(0, 0.3 * s, 0, 0.14 * s, 0.3 * s, 0.016 * s, C.dark),
      boxP(0, 0.3 * s, 0.012 * s, 0.125 * s, 0.27 * s, 0.004 * s, "#101820"),
      boxP(0, 0.3 * s, 0.017 * s, 0.115 * s, 0.23 * s, 0.003 * s, C.cyan),
      sph(0, 0.52 * s, -0.012 * s, 0.014 * s, "#0b1116"),
    );
    return parts;
  }
  if (kind === "laptop") {
    return [
      boxP(0, 0.03, 0, 0.42, 0.018, 0.3, "#aebfd0"),
      boxP(0, 0.05, -0.03, 0.36, 0.004, 0.2, "#3d4a5c"),
      boxP(0, 0.05, 0.1, 0.11, 0.004, 0.075, "#7f8c8d"),
      boxP(0, 0.2, -0.31, 0.42, 0.27, 0.014, C.dark, [-0.32, 0, 0]),
      boxP(0, 0.21, -0.29, 0.37, 0.22, 0.005, C.cyan, [-0.32, 0, 0]),
    ];
  }
  // tv / monitor / computer
  parts.push(
    boxP(0, 0.95, 0, 0.85, 0.5, 0.03, C.dark),
    boxP(0, 0.95, 0.025, 0.78, 0.43, 0.008, C.cyan),
    cyl(0, 0.6, 0, 0.035, 0.15, "#7f8c8d"),
    boxP(0, 0.12, 0, 0.28, 0.02, 0.18, "#7f8c8d"),
  );
  if (kind === "computer") {
    parts.push(
      boxP(0.85, 0.28, 0.1, 0.16, 0.28, 0.4, C.slate),
      boxP(0.85, 0.56, 0.1, 0.12, 0.005, 0.3, "#3d4a5c"),
      sph(0.85, 0.06, 0.55, 0.06, C.dark, 0.045, 0.09),
      boxP(-0.35, 0.02, 0.62, 0.32, 0.012, 0.12, "#aebfd0", [r(rand, -0.04, 0.04), 0, 0]),
    );
  }
  return parts;
}

/* ---- stringed instruments ---- */
function strings(rand: Rand, kind: string): HoloPart[] {
  const scale = kind === "cello" ? 1.45 : kind === "violin" ? 0.72 : kind === "bass" ? 1.25 : 1;
  const bodyC = kind === "violin" || kind === "cello" ? "#8b4513" : kind === "banjo" ? "#e8eef4" : "#a0622d";
  const r1 = 0.42 * scale, r2 = 0.29 * scale, neckLen = 0.72 * scale;
  const parts: HoloPart[] = [
    cyl(0, -r1 * 0.6, 0, r1, 0.045, bodyC, [1.5708, 0, 0]),          // lower bout
    cyl(0, r1 * 0.55, 0, r2, 0.045, bodyC, [1.5708, 0, 0]),           // upper bout
    cyl(0, -r1 * 0.35, 0.05, r1 * 0.22, 0.008, "#241a10", [1.5708, 0, 0]), // sound hole
    boxP(0, r1 * 0.85 + neckLen / 2, 0, 0.085 * scale, neckLen / 2, 0.03, "#3e2b1c"), // neck
    boxP(0, r1 * 0.85 + neckLen + 0.1 * scale, 0, 0.12 * scale, 0.09 * scale, 0.025, "#241a10"), // head
    boxP(0, -r1 * 0.75, 0.05, 0.13 * scale, 0.015, 0.012, "#241a10"), // bridge
  ];
  for (const sx of [-0.09, -0.03, 0.03, 0.09]) {
    parts.push(cyl(sx * scale, r1 * 0.4 + neckLen / 2 - 0.1, 0.055, 0.006, neckLen / 2 + 0.25, C.cyan, [0, 0, 0]));
  }
  for (const sx of [-1, 1]) parts.push(sph(sx * 0.1 * scale, r1 * 0.85 + neckLen + 0.14, 0.03, 0.02, C.gold));
  if (kind === "violin") {
    parts.push(cyl(0.28, 0.35, 0.22, 0.008, 0.42, C.woodL, [0, 0, 0.9]));
  }
  if (kind === "cello") {
    parts.push(cyl(0, -1.05, 0, 0.012, 0.25, C.dark));
  }
  if (kind === "banjo") {
    parts.push(flat(0, -r1 * 0.6, 0.01, r1 * 0.85, 0.012, C.white, [0, 1.5708, 0]));
  }
  parts.push(sph(0, r1 * 0.6, 0.04, r(rand, 0.015, 0.025), C.gold)); // strap pin detail
  return parts;
}

/* ---- piano ---- */
function pianoFam(rand: Rand): HoloPart[] {
  const parts: HoloPart[] = [
    boxP(0, 0.82, 0, 0.95, 0.05, 0.5, "#141a22"),                   // rim
    boxP(0, 0.92, -0.1, 0.9, 0.012, 0.46, "#1e2733", [-0.55, 0, 0]), // open lid
    boxP(0, 0.78, 0.48, 0.5, 0.028, 0.09, C.white),                 // keys
    boxP(0, 0.81, 0.44, 0.46, 0.006, 0.05, "#141a22"),
  ];
  for (let i = 0; i < 7; i++) {
    parts.push(boxP(-0.36 + i * 0.12, 0.82, 0.5, 0.014, 0.012, 0.045, "#0b0f14"));
  }
  for (const [x, z] of [[-0.75, 0.35], [0.75, 0.35], [0, -0.55]] as const) {
    parts.push(cyl(x, 0.4, z, 0.045, 0.4, "#1e2733"));
  }
  parts.push(boxP(0.2, 0.32, 0.3, 0.14, 0.015, 0.1, C.gold, [r(rand, -0.06, 0.06), 0, 0])); // pedal
  return parts;
}

/* ---- drums ---- */
function drumFam(rand: Rand, kit: boolean): HoloPart[] {
  const parts: HoloPart[] = [
    cyl(0, 0.95, 0, 0.38, 0.14, C.red),
    cyl(0, 1.1, 0, 0.38, 0.006, C.white),
    cyl(0, 0.8, 0, 0.38, 0.006, C.white),
  ];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    parts.push(boxP(Math.cos(a) * 0.4, 0.95, Math.sin(a) * 0.4, 0.02, 0.06, 0.02, C.metal));
  }
  for (const sx of [-1, 0, 1]) {
    parts.push(cyl(sx * 0.26, 0.38, 0.16, 0.012, 0.38, C.metal, [sx * 0.16, 0, 0]));
  }
  parts.push(cyl(0.12, 1.13, 0.05, 0.008, 0.22, C.woodL, [0, 0, 0.7 + r(rand, -0.1, 0.1)]));
  parts.push(cyl(-0.12, 1.13, -0.05, 0.008, 0.22, C.woodL, [0, 0.5, -0.7]));
  if (kit) {
    parts.push(
      cyl(-0.75, 0.5, 0, 0.48, 0.24, "#22303f", [1.5708, 0, 0]),     // kick
      cyl(0.75, 0.9, -0.1, 0.015, 0.55, C.metal),
      cyl(0.75, 1.2, -0.1, 0.34, 0.012, C.gold, [0.2, 0, 0.15]),     // cymbal
      sph(0.75, 0.87, -0.1, 0.05, C.metal),
    );
  }
  return parts;
}

/* ---- wind instruments ---- */
function windFam(rand: Rand, kind: string): HoloPart[] {
  if (kind === "trumpet" || kind === "horn") {
    const parts: HoloPart[] = [
      cyl(0, 1.0, -0.1, 0.045, 0.35, C.gold, [1.5708, 0, 0]),        // main tube
      coneP(0, 1.0, 0.38, 0.17, 0.2, C.gold, [1.5708, 0, 0]),        // bell (flare +Z)
      coneP(0, 1.0, -0.52, 0.05, 0.04, C.gold, [-1.5708, 0, 0]),     // mouthpiece
    ];
    for (let i = 0; i < 3; i++) {
      parts.push(cyl(-0.12 + i * 0.12, 1.11, -0.18, 0.018, 0.07, "#d9b23c"));
      parts.push(sph(-0.12 + i * 0.12, 1.16, -0.18, 0.022, "#fff3c4"));
    }
    return parts;
  }
  // flute / clarinet
  const isClar = kind === "clarinet";
  const col = isClar ? "#241a10" : C.metal;
  const parts: HoloPart[] = [
    cyl(0, 0.95, 0, isClar ? 0.04 : 0.03, 0.5, col, [1.5708, 0, 0]),
    coneP(0, 0.95, 0.55, isClar ? 0.055 : 0.035, 0.05, col, [1.5708, 0, 0]),
    boxP(-0.18, 0.99, -0.3, 0.05, 0.008, 0.03, col),
  ];
  for (let i = 0; i < 6; i++) {
    parts.push(cyl(-0.25 + i * 0.13, 1.0 + (isClar ? 0.045 : 0.033), 0.1 - i * 0.05, 0.011, 0.004, "#10151c", [1.5708, 0, 0]));
  }
  parts.push(sph(0.45, 0.95, 0.3, 0.012, col, 0.012, 0.012)); // tone pin detail
  return parts;
}

/* ---- microphone ---- */
function micFam(rand: Rand): HoloPart[] {
  return [
    cyl(0, 0.03, 0, 0.28, 0.025, C.dark),
    cyl(0, 0.55, 0, 0.016, 0.52, C.metal),
    cyl(0.12, 1.16, 0.05, 0.014, 0.18, C.metal, [0, 0, -0.5]),
    p("capsule", [0.22, 1.28, 0.05], [0.35, 0, 0], [0.09, 0.11, 0.09], "#b8c6d6"),
    sph(0.22, 1.28, 0.14, 0.075, C.metal, 0.09, 0.03),
    sph(0.05, 0.9 + r(rand, -0.05, 0.05), 0.1, 0.018, C.gold),
  ];
}

/* ---- hand tools ---- */
function toolFam(rand: Rand, kind: string): HoloPart[] {
  switch (kind) {
    case "hammer":
      return [
        cyl(0, 0.28, 0, 0.035, 0.28, C.woodD),
        boxP(0, 0.6, 0, 0.055, 0.05, 0.19, C.metal),
        boxP(0, 0.6, 0.22, 0.03, 0.04, 0.06, C.metal, [0, 0, 0]),
        boxP(0, 0.6, -0.21, 0.03, 0.045, 0.05, C.metal, [0.35, 0, 0]),
      ];
    case "axe": case "hatchet":
      return [
        cyl(0, 0.3, 0, 0.03, 0.3, C.woodD),
        boxP(0.1, 0.62, 0, 0.09, 0.07, 0.02, C.metal),
        coneP(0.2, 0.62, 0, 0.07, 0.1, C.metal, [0, 1.5708, 0]),
        boxP(-0.05, 0.62, 0, 0.03, 0.05, 0.04, C.woodDD),
        sph(0, 0.9 + r(rand, -0.02, 0.02), 0, 0.026, C.woodL),
      ];
    case "screwdriver":
      return [
        cyl(0, 0.11, 0, 0.055, 0.11, C.red),
        cyl(0, 0.31, 0, 0.013, 0.17, C.metal),
        coneP(0, 0.5, 0, 0.018, 0.02, C.metal),
        flat(0, 0.16, 0, 0.05, 0.008, C.white, [1.5708, 0, 0]),
      ];
    case "wrench":
      return [
        boxP(0, 0.3, 0, 0.032, 0.28, 0.015, C.metal),
        boxP(-0.024, 0.6, 0, 0.016, 0.055, 0.015, C.metal),
        boxP(0.024, 0.6, 0, 0.016, 0.055, 0.015, C.metal),
        flat(0, 0.6, 0.012, 0.035, 0.006, C.metal, [1.5708, 0, 0]),
        flat(0, 0.05, 0, 0.05, 0.016, C.metal),
        sph(0, 0.62 + r(rand, -0.01, 0.01), 0, 0.014, C.metal),
      ];
    case "saw":
      return [
        boxP(0.06, 0.5, 0, 0.38, 0.09, 0.006, C.metal, [0, 0, 0.08]),
        boxP(-0.32, 0.58, 0, 0.05, 0.07, 0.02, C.woodDD),
        ...[-0.24, -0.08, 0.08, 0.24, 0.38].map((x) => boxP(x, 0.41 + r(rand, 0, 0.01), 0, 0.02, 0.02, 0.004, C.metal)),
      ];
    case "shovel": case "spade":
      return [
        cyl(0, 0.5, 0, 0.02, 0.42, C.woodL),
        flat(0, 0.95, 0, 0.05, 0.012, C.woodDD),
        coneP(0, 0.16, 0, 0.15, 0.2, C.metal, [Math.PI, 0, 0]),
        sph(0, 0.05, 0, 0.14, C.metal, 0.02, 0.08),
      ];
    case "broom":
      return [
        cyl(0, 0.55, 0, 0.018, 0.4, C.woodL),
        coneP(0, 0.22, 0, 0.11, 0.2, "#c9a227", [Math.PI, 0, 0]),
        flat(0, 0.34, 0, 0.1, 0.012, C.woodDD),
        sph(0, 0.95, 0, 0.02, C.woodD),
        boxP(0.02, 0.4 + r(rand, -0.02, 0.02), 0, 0.02, 0.02, 0.02, C.woodDD),
      ];
    default: // drill
      return [
        boxP(0, 0.55, -0.02, 0.08, 0.1, 0.2, "#e8b21a"),
        cyl(0, 0.55, 0.2, 0.035, 0.06, C.dark, [1.5708, 0, 0]),
        cyl(0, 0.55, 0.32, 0.009, 0.08, C.metal, [1.5708, 0, 0]),
        boxP(0, 0.4, -0.05, 0.035, 0.12, 0.05, C.dark),
        boxP(0, 0.31, -0.12, 0.06, 0.05, 0.09, "#2c3e50"),
        sph(0.06, 0.48, 0.05, 0.015, C.red, 0.02, 0.012),
      ];
  }
}

/* ---- ladder ---- */
function ladderFam(rand: Rand): HoloPart[] {
  const parts: HoloPart[] = [];
  for (const sx of [-1, 1]) {
    parts.push(boxP(sx * 0.24, 0.55, 0, 0.028, 0.55, 0.022, C.woodD, [sx * r(rand, 0.04, 0.08), 0, 0]));
  }
  for (let i = 0; i < 7; i++) {
    parts.push(cyl(0, 0.12 + i * 0.15, 0.01, 0.016, 0.24, C.woodL, [0, 0, 1.5708]));
  }
  return parts;
}

/* ---- kitchenware ---- */
function kitchenFam(rand: Rand, kind: string): HoloPart[] {
  switch (kind) {
    case "plate": case "dish":
      return [
        cyl(0, 0.02, 0, 0.55, 0.014, C.white),
        flat(0, 0.035, 0, 0.55, 0.014, C.cyan),
        cyl(0, 0.04, 0, 0.42, 0.004, "#cfe6f5"),
      ];
    case "bowl":
      return [
        sph(0, 0.22, 0, 0.42, C.cyan, 0.2, 0.42),
        flat(0, 0.4, 0, 0.42, 0.016, C.white),
        cyl(0, 0.015, 0, 0.16, 0.015, C.white),
        sph(0.24, 0.34, 0.18, 0.05, "#f78fb3", 0.02, 0.05),
      ];
    case "bottle":
      return [
        cyl(0, 0.16, 0, 0.15, 0.16, "#4a8f5c"),
        coneP(0, 0.36, 0, 0.15, 0.07, "#4a8f5c"),
        cyl(0, 0.48, 0, 0.045, 0.08, "#4a8f5c"),
        cyl(0, 0.57, 0, 0.05, 0.018, C.gold),
        boxP(0, 0.16, 0.152, 0.1, 0.08, 0.004, C.cream),
      ];
    case "glass":
      return [
        cyl(0, 0.012, 0, 0.14, 0.012, C.cyan),
        cyl(0, 0.14, 0, 0.12, 0.1, "#a5e8f5", [0, 0, 0]),
        cyl(0, 0.26, 0, 0.145, 0.05, "#a5e8f5"),
        flat(0, 0.31, 0, 0.145, 0.008, C.white, [0, 0, 0]),
        sph(0, 0.2 + r(rand, -0.05, 0.05), 0, 0.06, C.cyan, 0.06, 0.06),
      ];
    case "spoon":
      return [
        boxP(-0.2, 0.03, 0, 0.18, 0.014, 0.014, C.metal),
        sph(0.14, 0.045, 0, 0.1, C.metal, 0.025, 0.13),
      ];
    case "fork":
      return [
        boxP(-0.2, 0.03, 0, 0.16, 0.013, 0.012, C.metal),
        boxP(-0.02, 0.035, 0, 0.03, 0.014, 0.014, C.metal),
        ...[-0.03, -0.01, 0.01, 0.03].map((z) => boxP(0.08, 0.045, z, 0.07, 0.008, 0.004, C.metal)),
      ];
    case "knife":
      return [
        boxP(-0.22, 0.03, 0, 0.1, 0.02, 0.014, C.woodDD),
        boxP(0.08, 0.035, 0, 0.19, 0.018, 0.006, C.metal),
        coneP(0.3, 0.035, 0, 0.018, 0.05, C.metal, [0, -1.5708, 0]),
      ];
    case "teapot": case "kettle":
      return [
        sph(0, 0.34, 0, 0.33, "#dfe8ef", 0.27, 0.33),
        cyl(0.38, 0.4, 0, 0.032, 0.15, "#dfe8ef", [0, 0, -0.85]),
        coneP(0.5, 0.44, 0, 0.045, 0.05, "#dfe8ef", [0, 0, -1.5708]),
        cyl(0, 0.62, 0, 0.11, 0.014, "#c7d3dd"),
        sph(0, 0.66, 0, 0.035, C.gold),
        flat(-0.36, 0.38, 0, 0.11, 0.016, "#c7d3dd", [0, 1.5708, 0]),
        cyl(0, 0.05, 0, 0.2, 0.02, "#c7d3dd"),
      ];
    case "pan": case "skillet":
      return [
        cyl(0, 0.04, 0, 0.4, 0.028, "#2c333d"),
        cyl(0, 0.07, 0, 0.34, 0.004, "#3d4654"),
        boxP(0.58, 0.055, 0, 0.2, 0.016, 0.04, C.woodDD),
        flat(0.78, 0.055, 0, 0.026, 0.007, C.woodDD, [1.5708, 0, 0]),
      ];
    case "pot":
      return [
        cyl(0, 0.16, 0, 0.38, 0.16, "#95a8b8"),
        flat(0, 0.32, 0, 0.38, 0.014, C.metal, [0, 0, 0]),
        cyl(0, 0.34, 0, 0.4, 0.014, "#7f929f"),
        sph(0, 0.38, 0, 0.05, C.dark),
        boxP(-0.46, 0.27, 0, 0.045, 0.012, 0.03, C.dark),
        boxP(0.46, 0.27, 0, 0.045, 0.012, 0.03, C.dark),
      ];
    default: // vase / jug / pitcher
      return [
        sph(0, 0.28, 0, 0.32, "#8ecae6", 0.3, 0.32),
        cyl(0, 0.62, 0, 0.13, 0.1, "#8ecae6"),
        flat(0, 0.72, 0, 0.14, 0.012, "#8ecae6", [0, 0, 0]),
        cyl(0.3, 0.45, 0, 0.03, 0.1, "#8ecae6", [0, 0, -0.7]),
        cyl(0, 0.03, 0, 0.24, 0.02, "#6fb3d0"),
        coneP(0.06, 0.85, 0, 0.018, 0.12, C.pink, [r(rand, -0.1, 0.1), 0, 0.1]),
      ];
  }
}

/* ---- food ---- */
function foodFam(rand: Rand, kind: string): HoloPart[] {
  switch (kind) {
    case "pizza": {
      const parts: HoloPart[] = [
        cyl(0, 0.02, 0, 0.6, 0.022, C.tan),
        cyl(0, 0.042, 0, 0.53, 0.004, "#c0392b"),
        cyl(0, 0.048, 0, 0.5, 0.004, "#f5d78e"),
        flat(0, 0.05, 0, 0.58, 0.034, "#b8834a", [1.5708, 0, 0]),
      ];
      for (let i = 0; i < 6; i++) {
        const a = r(rand, 0, Math.PI * 2), rad = r(rand, 0.12, 0.4);
        parts.push(cyl(Math.cos(a) * rad, 0.056, Math.sin(a) * rad, 0.065, 0.006, "#a93226", [0, 0, 0]));
      }
      for (let i = 0; i < 3; i++) {
        const a = r(rand, 0, Math.PI * 2), rad = r(rand, 0.15, 0.42);
        parts.push(boxP(Math.cos(a) * rad, 0.055, Math.sin(a) * rad, 0.03, 0.004, 0.03, C.green));
      }
      return parts;
    }
    case "burger":
      return [
        sph(0, 0.13, 0, 0.42, "#e0a95e", 0.1, 0.42),
        cyl(0, 0.25, 0, 0.4, 0.024, "#6b3e1e"),
        boxP(0, 0.29, 0, 0.4, 0.005, 0.4, "#f7c948", [0, 0.78, 0]),
        flat(0, 0.33, 0, 0.4, 0.02, "#7cb342", [1.5708, 0, 0]),
        cyl(0, 0.36, 0, 0.36, 0.008, "#e74c3c"),
        sph(0, 0.47, 0, 0.42, "#eda660", 0.12, 0.42),
        ...[-0.15, 0, 0.15].map((x) => sph(x, 0.56, 0.05, 0.018, "#fdebd0")),
        ...[-0.08, 0.08].map((x) => sph(x, 0.56, -0.1, 0.015, "#fdebd0")),
      ];
    case "cake": {
      const parts: HoloPart[] = [
        cyl(0, 0.012, 0, 0.55, 0.012, C.white),
        cyl(0, 0.14, 0, 0.45, 0.09, C.pink),
        flat(0, 0.23, 0, 0.45, 0.016, C.cream, [1.5708, 0, 0]),
        cyl(0, 0.33, 0, 0.34, 0.07, "#f8bbd0"),
        flat(0, 0.4, 0, 0.34, 0.014, C.cream, [1.5708, 0, 0]),
      ];
      for (let i = 0; i < 3; i++) {
        const x = -0.16 + i * 0.16;
        parts.push(cyl(x, 0.5, 0, 0.012, 0.07, "#81d4fa"));
        parts.push(coneP(x, 0.6, 0, 0.015, 0.035, C.orange, [Math.PI, 0, 0]));
      }
      parts.push(sph(0.3, 0.46, 0.12, 0.025, C.red, 0.02, 0.025));
      return parts;
    }
    case "donut": case "doughnut": {
      const parts: HoloPart[] = [
        flat(0, 0.18, 0, 0.4, 0.16, "#c98a4b", [1.5708, 0, 0]),
        flat(0, 0.21, 0, 0.41, 0.15, C.pink, [1.5708, 0, 0]),
      ];
      const sprink = ["#fff", "#f4d03f", "#7ee8fa", "#2ecc71"];
      for (let i = 0; i < 8; i++) {
        const a = r(rand, 0, Math.PI * 2), rad = r(rand, 0.22, 0.55);
        parts.push(p("capsule", [Math.cos(a) * rad, 0.37, Math.sin(a) * rad], [0, r(rand, 0, 3), 1.5708], [0.011, 0.02, 0.011], sprink[i % 4]));
      }
      return parts;
    }
    case "icecream":
      return [
        coneP(0, 0.21, 0, 0.16, 0.21, "#d9a05b", [Math.PI, 0, 0]),
        sph(0, 0.62, 0, 0.2, "#f8bbd0"),
        sph(0.1, 0.82, 0.03, 0.15, "#b3e5fc"),
        sph(-0.1, 0.84, -0.02, 0.14, "#f5e6c8"),
        sph(0, 1.0, 0, 0.04, C.red),
      ];
    case "apple":
      return [
        sph(0, 0.42, 0, 0.42, "#e2483d"),
        cyl(0.01, 0.88, 0, 0.018, 0.07, C.woodDD, [0, 0, 0.12]),
        sph(0.1, 0.9, 0, 0.08, C.green, 0.012, 0.045),
        sph(0.3, 0.44, 0.28, 0.05, "#f1948a", 0.04, 0.05),
      ];
    case "banana":
      return [
        p("capsule", [-0.24, 0.18, 0], [0, 0, 0.7], [0.055, 0.16, 0.055], "#f4d03f"),
        p("capsule", [0, 0.38, 0], [0, 0, 0], [0.055, 0.16, 0.055], "#f4d03f"),
        p("capsule", [0.24, 0.18, 0], [0, 0, -0.7], [0.055, 0.16, 0.055], "#f4d03f"),
        sph(-0.37, 0.1, 0, 0.028, "#8d6e63"),
        sph(0.37, 0.1, 0, 0.028, "#8d6e63"),
      ];
    case "orange":
      return [
        sph(0, 0.4, 0, 0.4, C.orange),
        cyl(0, 0.82, 0, 0.016, 0.03, C.green),
        sph(0.06, 0.86, 0, 0.06, "#58d68d", 0.01, 0.03),
        sph(-0.2, 0.46, 0.32, 0.045, "#f5b041", 0.04, 0.045),
      ];
    case "carrot":
      return [
        coneP(0, 0.24, 0, 0.13, 0.24, C.orange, [Math.PI, 0, 0]),
        cyl(0, 0.52, 0, 0.026, 0.04, C.green),
        ...[-0.35, 0, 0.35].map((a) => coneP(Math.sin(a) * 0.05, 0.62, 0, 0.02, 0.09, "#58d68d", [0.2, 0, a])),
      ];
    case "pumpkin":
      return [
        sph(0, 0.38, 0, 0.5, C.orange, 0.4, 0.5),
        flat(0, 0.38, 0, 0.5, 0.008, "#c96a1e", [0, 0, 0]),
        flat(0, 0.38, 0, 0.5, 0.008, "#c96a1e", [0, 1.5708, 0]),
        flat(0, 0.38, 0, 0.5, 0.008, "#c96a1e", [0, 0.78, 0]),
        cyl(0.02, 0.82, 0, 0.045, 0.06, "#6b4f2a", [0, 0, 0.15]),
      ];
    case "watermelon": case "melon": {
      const parts: HoloPart[] = [sph(0, 0.45, 0, 0.5, "#2e8b57")];
      for (let i = 0; i < 4; i++) {
        parts.push(flat(0, 0.45, 0, 0.5, 0.007, "#1c5e3a", [0, i * 0.78, 0]));
      }
      parts.push(coneP(0.04, 0.98, 0, 0.02, 0.08, "#58d68d", [r(rand, -0.1, 0.1), 0, 0.2]));
      return parts;
    }
    case "egg":
      return [
        sph(0, 0.3, 0, 0.26, "#f5efe0", 0.34, 0.26),
        sph(0.32, 0.22, 0.1, 0.22, "#f0e8d4", 0.29, 0.22),
        flat(0, 0.03, 0, 0.4, 0.006, "#d5cdb8", [1.5708, 0, 0]),
      ];
    case "sushi":
      return [
        boxP(-0.18, 0.05, 0, 0.09, 0.045, 0.17, C.white),
        boxP(-0.18, 0.11, 0, 0.1, 0.012, 0.18, "#ff8c69"),
        boxP(-0.18, 0.07, 0, 0.105, 0.05, 0.02, "#1a2b1a"),
        boxP(0.18, 0.05, 0.02, 0.09, 0.045, 0.17, C.white),
        boxP(0.18, 0.11, 0.02, 0.1, 0.012, 0.18, "#ff8c69"),
        boxP(0.18, 0.07, 0.02, 0.105, 0.05, 0.02, "#1a2b1a"),
        flat(0, 0.005, 0, 0.34, 0.005, "#2c3e50", [1.5708, 0, 0]),
      ];
    case "hotdog":
      return [
        p("capsule", [-0.08, 0.09, 0], [1.5708, 0, 0], [0.085, 0.22, 0.085], "#e0a95e"),
        p("capsule", [0.08, 0.09, 0], [1.5708, 0, 0], [0.085, 0.22, 0.085], "#e0a95e"),
        p("capsule", [0, 0.2, 0], [1.5708, 0.05, 0], [0.07, 0.25, 0.07], "#b5651d"),
        boxP(-0.06, 0.27, 0.04, 0.09, 0.007, 0.008, "#f4d03f", [0, 0.3, 0]),
        boxP(0.07, 0.27, -0.03, 0.08, 0.007, 0.008, "#c0392b", [0, -0.2, 0]),
      ];
    case "candy":
      return [
        sph(0, 0.35, 0, 0.28, pick(rand, ["#e2483d", "#9b59b6", "#2ecc71", "#f4d03f"])),
        coneP(-0.4, 0.35, 0, 0.11, 0.18, "#f5c6de", [0, 0, 1.5708]),
        coneP(0.4, 0.35, 0, 0.11, 0.18, "#f5c6de", [0, 0, -1.5708]),
        flat(0, 0.62, 0, 0.12, 0.006, C.cyan, [0, 0, 0]),
        flat(0, 0.08, 0, 0.12, 0.006, C.cyan, [0, 0, 0]),
      ];
    case "popcorn": {
      const parts: HoloPart[] = [
        boxP(0, 0.18, 0, 0.24, 0.18, 0.17, C.red),
        boxP(0, 0.18, 0.171, 0.08, 0.16, 0.005, C.white),
        boxP(0, 0.18, -0.171, 0.08, 0.16, 0.005, C.white),
        flat(0, 0.36, 0, 0.24, 0.012, "#f7e6c4", [0, 0, 0]),
      ];
      for (let i = 0; i < 6; i++) {
        parts.push(sph(r(rand, -0.15, 0.15), 0.42 + r(rand, 0, 0.1), r(rand, -0.1, 0.1), r(rand, 0.05, 0.08), "#fbf5e6"));
      }
      return parts;
    }
    case "strawberry":
      return [
        sph(0, 0.26, 0, 0.3, "#e2483d", 0.34, 0.3),
        ...[[0, 0.14], [0.16, 0.3], [-0.15, 0.32], [0.05, 0.44], [-0.1, 0.18]].map(([x, y]) => sph(x, y, 0.27, 0.014, "#f9e79f")),
        ...[-0.3, -0.1, 0.1, 0.3].map((x) => coneP(x, 0.6, 0, 0.05, 0.06, "#27ae60", [0, 0, x * 2])),
        cyl(0, 0.66, 0, 0.014, 0.05, C.green),
      ];
    case "cherry":
      return [
        sph(-0.15, 0.25, 0, 0.16, "#c0392b"),
        sph(0.16, 0.2, 0.03, 0.15, "#c0392b"),
        cyl(-0.15, 0.5, 0, 0.012, 0.14, "#6b4f2a", [0, 0, 0.16]),
        cyl(0.16, 0.46, 0.01, 0.012, 0.14, "#6b4f2a", [0, 0, -0.14]),
        sph(0.01, 0.66, 0, 0.06, C.green, 0.015, 0.03),
      ];
    default: { // pineapple
      const parts: HoloPart[] = [
        cyl(0, 0.45, 0, 0.32, 0.45, "#d4a017"),
        ...Array.from({ length: 5 }, (_, i) => flat(0, 0.45, 0, 0.33, 0.006, "#b8860b", [0, i * 0.63, 0])),
        ...Array.from({ length: 5 }, (_, i) => flat(0, 0.45, 0, 0.33, 0.006, "#b8860b", [1.5708, i * 0.63, 0])),
      ];
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        parts.push(coneP(Math.cos(a) * 0.12, 1.02, Math.sin(a) * 0.12, 0.05, 0.22, "#58d68d", [Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35]));
      }
      return parts;
    }
  }
}

/* ---- wearables ---- */
function wearFam(rand: Rand, kind: string): HoloPart[] {
  switch (kind) {
    case "tophat":
      return [
        cyl(0, 0.04, 0, 0.44, 0.016, "#141a22"),
        cyl(0, 0.3, 0, 0.28, 0.25, "#141a22"),
        flat(0, 0.1, 0, 0.29, 0.02, C.red, [0, 0, 0]),
        sph(0, 0.56, 0, 0.02, C.cyan),
      ];
    case "cap":
      return [
        sph(0, 0.28, 0, 0.34, "#2c3e50", 0.22, 0.34),
        cyl(0, 0.14, 0.3, 0.28, 0.012, "#22303f", [1.5708, 0, 0]),
        cyl(0, 0.14, 0.32, 0.26, 0.01, "#1a252f", [1.5708, 0.2, 0]),
        sph(0, 0.51, 0, 0.026, C.gold),
        boxP(0, 0.3, -0.3, 0.1, 0.05, 0.02, C.gold),
      ];
    case "shoe": case "sneaker": case "boot": {
      const tall = kind === "boot" ? 1.5 : 1;
      return [
        boxP(0, 0.035, 0, 0.14, 0.03, 0.32, C.white),
        boxP(0, 0.13 * tall, -0.03, 0.12, 0.07 * tall, 0.24, pick(rand, ["#e2483d", "#2c3e50", "#2980b9"])),
        sph(0, 0.11, 0.22, 0.11, "#e8eef4", 0.07, 0.1),
        ...[0.02, 0.1, 0.18].map((z) => boxP(0, 0.13 * tall + 0.07 * tall, z - 0.04, 0.1, 0.008, 0.012, C.white)),
        boxP(0, 0.1, -0.22, 0.12, 0.09 * tall, 0.02, C.dark),
      ];
    }
    case "glasses":
      return [
        flat(-0.2, 0.9, 0, 0.16, 0.014, C.cyan, [0, 0, 0]),
        flat(0.2, 0.9, 0, 0.16, 0.014, C.cyan, [0, 0, 0]),
        boxP(0, 0.92, 0, 0.05, 0.012, 0.012, C.metal),
        boxP(-0.34, 0.9, -0.16, 0.012, 0.012, 0.16, C.metal, [0, 0.5, 0]),
        boxP(0.34, 0.9, -0.16, 0.012, 0.012, 0.16, C.metal, [0, -0.5, 0]),
      ];
    case "watch":
      return [
        cyl(0, 0.5, 0, 0.17, 0.025, "#141a22"),
        flat(0, 0.5, 0.028, 0.17, 0.015, C.metal, [0, 0, 0]),
        boxP(0, 0.53, 0.032, 0.07, 0.008, 0.004, C.cyan, [0, 0, 0]),
        boxP(0.005, 0.505, 0.032, 0.045, 0.005, 0.004, C.cyan, [0, 0, 0.5]),
        boxP(0, 0.82, 0, 0.09, 0.14, 0.025, "#5d6d7e"),
        boxP(0, 0.18, 0, 0.09, 0.14, 0.025, "#5d6d7e"),
      ];
    case "ring":
      return [
        flat(0, 0.24, 0, 0.2, 0.035, C.gold, [0, 0, 0]),
        coneP(0, 0.47, 0, 0.05, 0.045, C.cyan),
        coneP(0, 0.38, 0, 0.05, 0.045, C.cyan, [Math.PI, 0, 0]),
        sph(0.18, 0.2, 0.05, 0.012, C.white),
      ];
    case "crown": {
      const parts: HoloPart[] = [
        cyl(0, 0.2, 0, 0.3, 0.09, C.gold),
        flat(0, 0.12, 0, 0.31, 0.012, "#d9b23c", [1.5708, 0, 0]),
      ];
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        parts.push(coneP(Math.cos(a) * 0.3, 0.38, Math.sin(a) * 0.3, 0.035, 0.11, C.gold));
      }
      parts.push(sph(0, 0.24, 0.3, 0.035, C.cyan));
      parts.push(sph(0.3, 0.24, 0, 0.035, C.red));
      parts.push(sph(-0.21, 0.24, -0.21, 0.035, C.red));
      return parts;
    }
    default: // helmet
      return [
        sph(0, 0.5, 0, 0.42, pick(rand, ["#e2483d", "#2c3e50", "#f4d03f"]), 0.34, 0.42),
        boxP(0, 0.42, 0.4, 0.3, 0.12, 0.02, "#10151c"),
        flat(0, 0.14, 0, 0.4, 0.02, "#d5d8dc", [1.5708, 0, 0]),
        sph(0, 0.84, 0, 0.03, C.metal),
      ];
  }
}

/* ---- structures & outdoor ---- */
function structFam(rand: Rand, kind: string): HoloPart[] {
  switch (kind) {
    case "bridge":
      return [
        boxP(0, 0.35, 0, 1.1, 0.03, 0.2, "#7f8c8d"),
        boxP(-0.45, 0.6, -0.12, 0.025, 0.28, 0.025, C.metal),
        boxP(-0.45, 0.6, 0.12, 0.025, 0.28, 0.025, C.metal),
        boxP(-0.45, 0.88, 0, 0.025, 0.02, 0.16, C.metal),
        boxP(0.45, 0.6, -0.12, 0.025, 0.28, 0.025, C.metal),
        boxP(0.45, 0.6, 0.12, 0.025, 0.28, 0.025, C.metal),
        boxP(0.45, 0.88, 0, 0.025, 0.02, 0.16, C.metal),
        boxP(-0.75, 0.6, 0, 0.32, 0.008, 0.008, C.cyan, [0, 0, 0.55]),
        boxP(-0.15, 0.6, 0, 0.32, 0.008, 0.008, C.cyan, [0, 0, -0.55]),
        boxP(0.15, 0.6, 0, 0.32, 0.008, 0.008, C.cyan, [0, 0, 0.55]),
        boxP(0.75, 0.6, 0, 0.32, 0.008, 0.008, C.cyan, [0, 0, -0.55]),
        cyl(0, 0.5, 0.08, 0.006, 0.12, C.cyan),
      ];
    case "stairs": case "staircase": case "stairway": {
      const parts: HoloPart[] = [];
      for (let i = 0; i < 6; i++) {
        parts.push(boxP(0, 0.05 + i * 0.11, i * 0.17, 0.4, 0.028, 0.085, C.wood));
      }
      parts.push(boxP(0.42, 0.35, 0.42, 0.02, 0.38, 0.06, C.woodD, [0.72, 0, 0]));
      return parts;
    }
    case "fence":
      return [
        ...[-0.5, 0, 0.5].map((x) => boxP(x, 0.3, 0, 0.03, 0.3, 0.025, C.woodD)),
        ...[-0.5, 0, 0.5].map((x) => coneP(x, 0.64, 0, 0.03, 0.045, C.woodD)),
        boxP(0, 0.28, 0, 0.56, 0.035, 0.014, C.wood),
        boxP(0, 0.46, 0, 0.56, 0.035, 0.014, C.wood),
      ];
    case "door":
      return [
        boxP(-0.42, 0.5, 0, 0.04, 0.5, 0.04, C.woodDD),
        boxP(0.42, 0.5, 0, 0.04, 0.5, 0.04, C.woodDD),
        boxP(0, 1.02, 0, 0.46, 0.045, 0.045, C.woodDD),
        boxP(0, 0.5, 0.01, 0.36, 0.46, 0.018, C.wood),
        boxP(0, 0.72, 0.03, 0.24, 0.2, 0.008, C.woodD),
        boxP(0, 0.32, 0.03, 0.24, 0.2, 0.008, C.woodD),
        sph(0.28, 0.5, 0.04, 0.032, C.gold),
        boxP(0.28, 0.44, 0.035, 0.012, 0.06, 0.004, C.gold),
      ];
    case "window":
      return [
        boxP(0, 0.55, 0, 0.48, 0.045, 0.04, C.cream),
        boxP(0, 0.05, 0, 0.48, 0.045, 0.04, C.cream),
        boxP(-0.44, 0.3, 0, 0.04, 0.21, 0.04, C.cream),
        boxP(0.44, 0.3, 0, 0.04, 0.21, 0.04, C.cream),
        boxP(0, 0.3, 0, 0.44, 0.21, 0.014, C.cyan),
        boxP(0, 0.3, 0.012, 0.008, 0.2, 0.006, C.cream),
        boxP(0, 0.3, 0.012, 0.42, 0.008, 0.006, C.cream),
        boxP(0, -0.02, 0.05, 0.56, 0.025, 0.05, C.cream),
      ];
    case "tent":
      return [
        boxP(-0.26, 0.32, 0, 0.03, 0.42, 0.5, "#e67e22", [0, 0, 0.72]),
        boxP(0.26, 0.32, 0, 0.03, 0.42, 0.5, "#e67e22", [0, 0, -0.72]),
        boxP(0, 0.32, -0.48, 0.28, 0.42, 0.02, "#d35400"),
        boxP(0, 0.012, 0, 0.55, 0.008, 0.55, "#5d4037"),
        boxP(0.12, 0.28, 0.3, 0.03, 0.35, 0.25, "#a04000", [0, 0, -0.68]),
        cyl(0, 0.62, 0, 0.015, 0.35, C.woodDD, [1.5708, 0, 0]),
      ];
    case "campfire": case "fire": {
      const parts: HoloPart[] = [];
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        parts.push(sph(Math.cos(a) * 0.38, 0.07, Math.sin(a) * 0.38, 0.09, "#7f8c8d"));
      }
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI;
        parts.push(cyl(0, 0.1, 0, 0.04, 0.24, C.woodDD, [1.5708, a, 0]));
      }
      parts.push(
        coneP(0, 0.28, 0, 0.11, 0.24, C.orange),
        coneP(0.03, 0.36, 0, 0.07, 0.3, C.yellow),
        coneP(-0.03, 0.42, 0.02, 0.045, 0.2, "#fde68a"),
        sph(0.15, 0.12 + r(rand, 0, 0.1), 0.1, 0.02, C.yellow),
      );
      return parts;
    }
    case "well":
      return [
        cyl(0, 0.18, 0, 0.5, 0.18, "#8a8f98"),
        flat(0, 0.37, 0, 0.5, 0.02, "#6b7178", [1.5708, 0, 0]),
        cyl(-0.42, 0.7, 0, 0.035, 0.35, C.woodD),
        cyl(0.42, 0.7, 0, 0.035, 0.35, C.woodD),
        boxP(-0.24, 1.12, 0, 0.03, 0.02, 0.55, C.woodDD, [0, 0, 0.55]),
        boxP(0.24, 1.12, 0, 0.03, 0.02, 0.55, C.woodDD, [0, 0, -0.55]),
        cyl(0, 1.06, 0, 0.018, 0.42, C.wood, [0, 0, 1.5708]),
        cyl(0, 0.8, 0, 0.006, 0.18, "#b8a03e"),
        cyl(0, 0.62, 0, 0.08, 0.07, C.woodD),
      ];
    case "streetlight":
      return [
        cyl(0, 0.05, 0, 0.1, 0.05, "#5d6d7e"),
        cyl(0, 0.72, 0, 0.028, 0.62, "#5d6d7e"),
        boxP(0.18, 1.36, 0, 0.18, 0.02, 0.02, "#5d6d7e", [0, 0, -0.12]),
        boxP(0.38, 1.3, 0, 0.09, 0.05, 0.07, "#3d4a5c"),
        sph(0.38, 1.22, 0, 0.055, C.cyan, 0.04, 0.055),
        sph(0.38, 1.12, 0, 0.03, "#f7f3c8", 0.02, 0.03),
      ];
    case "sign":
      return [
        cyl(0, 0.45, 0, 0.022, 0.45, C.metal),
        boxP(0, 0.95, 0, 0.42, 0.28, 0.014, pick(rand, ["#2c3e50", "#1e6091", "#5d4037"])),
        boxP(0, 1.0, 0.012, 0.28, 0.03, 0.004, C.white),
        boxP(0, 0.9, 0.012, 0.2, 0.02, 0.004, C.white),
        sph(0, 0.62, 0.015, 0.012, C.metal),
      ];
    case "barrel":
      return [
        cyl(0, 0.28, 0, 0.4, 0.28, C.wood),
        cyl(0, 0.55, 0, 0.34, 0.02, C.woodD),
        cyl(0, 0.02, 0, 0.34, 0.02, C.woodD),
        flat(0, 0.15, 0, 0.41, 0.014, "#3d4a5c", [1.5708, 0, 0]),
        flat(0, 0.42, 0, 0.41, 0.014, "#3d4a5c", [1.5708, 0, 0]),
        cyl(0, 0.57, 0, 0.3, 0.008, C.woodDD),
      ];
    case "bucket":
      return [
        cyl(0, 0.17, 0, 0.27, 0.16, C.metal),
        cyl(0, 0.33, 0, 0.23, 0.006, C.cyan),
        flat(0, 0.34, 0, 0.27, 0.012, C.metalD, [1.5708, 0, 0]),
        flat(0, 0.5, 0, 0.26, 0.01, C.metal, [0, 0, 0]),
        cyl(0.02, 0.02, 0, 0.2, 0.012, C.metalD),
      ];
    default: { // crate / box / mailbox handled by caller extra
      const parts: HoloPart[] = [
        boxP(0, 0.4, 0, 0.4, 0.4, 0.4, C.wood),
        boxP(-0.4, 0.4, 0.4, 0.41, 0.02, 0.02, C.woodDD),
        boxP(0.4, 0.4, 0.4, 0.41, 0.02, 0.02, C.woodDD),
        boxP(-0.4, 0.4, -0.4, 0.41, 0.02, 0.02, C.woodDD),
        boxP(0.4, 0.4, -0.4, 0.41, 0.02, 0.02, C.woodDD),
        boxP(0, 0.4, 0.405, 0.36, 0.03, 0.008, C.woodD),
        boxP(0, 0.4, 0.405, 0.36, 0.03, 0.008, C.woodD, [0, 0, 0.75]),
      ];
      parts.push(boxP(r(rand, -0.1, 0.1), 0.4, 0.41, 0.2, 0.025, 0.006, "#8a6f4d"));
      return parts;
    }
  }
}

/* ---- toys ---- */
function toyFam(rand: Rand, kind: string): HoloPart[] {
  switch (kind) {
    case "soccer": {
      const parts: HoloPart[] = [sph(0, 0.45, 0, 0.48, C.white)];
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        parts.push(sph(Math.cos(a) * 0.26, 0.45 + Math.sin(a) * 0.26, 0.42, 0.07, "#141a22", 0.07, 0.04));
      }
      parts.push(flat(0, 0.45, 0, 0.48, 0.006, "#141a22", [1.5708, 0, 0]));
      return parts;
    }
    case "basket":
      return [
        sph(0, 0.45, 0, 0.48, C.orange),
        flat(0, 0.45, 0, 0.48, 0.007, "#141a22", [0, 0, 0]),
        flat(0, 0.45, 0, 0.48, 0.007, "#141a22", [0, 1.5708, 0]),
        flat(0, 0.45, 0, 0.48, 0.007, "#141a22", [1.5708, 0, 0]),
      ];
    case "football":
      return [
        sph(0, 0.35, 0, 0.42, "#8d5524", 0.26, 0.26),
        boxP(0, 0.62, 0, 0.09, 0.008, 0.18, C.white, [0, 0.2, 0]),
        ...[-0.05, 0, 0.05].map((x) => boxP(x, 0.615, 0, 0.012, 0.008, 0.05, C.white)),
        flat(0, 0.35, 0, 0.42, 0.005, "#5d4037", [0, 0, 0]),
      ];
    case "baseball":
      return [
        sph(0, 0.4, 0, 0.4, C.white),
        flat(0.05, 0.4, 0, 0.4, 0.006, C.red, [0.2, 0, 0.3]),
        flat(-0.05, 0.4, 0, 0.4, 0.006, C.red, [0.2, 0, -0.3]),
      ];
    case "ball":
      return [
        sph(0, 0.45, 0, 0.48, pick(rand, ["#e2483d", "#f4d03f", "#2ecc71", "#e67e22"])),
        flat(0, 0.45, 0, 0.48, 0.008, C.white, [1.5708, 0, 0]),
        flat(0, 0.45, 0, 0.48, 0.008, C.white, [0, 0, 0]),
        flat(0, 0.45, 0, 0.48, 0.008, C.white, [0, 1.5708, 0]),
        sph(0, 0.95, 0, 0.028, C.cyan),
      ];
    case "dice": case "die": {
      const parts: HoloPart[] = [boxP(0, 0.4, 0, 0.38, 0.38, 0.38, "#f7f9fb")];
      parts.push(sph(0, 0.79, 0, 0.05, "#141a22"));
      parts.push(sph(0.79, 0.4, 0.28, 0.045, "#141a22"), sph(0.79, 0.4, -0.28, 0.045, "#141a22"));
      for (const [x, z] of [[0.24, 0.24], [-0.24, -0.24], [0.24, -0.24], [-0.24, 0.24], [0, 0]] as const) {
        parts.push(sph(x, 0.4, z + 0.39, 0.045, "#141a22"));
      }
      parts.push(sph(0.15, 0.79 + r(rand, -0.02, 0.02), 0.15, 0.02, "#7ee8fa"));
      return parts;
    }
    case "balloon":
      return [
        sph(0, 0.62, 0, 0.42, pick(rand, ["#e2483d", "#f4d03f", "#9b59b6", "#2ecc71"]), 0.5, 0.42),
        coneP(0, 0.16, 0, 0.035, 0.03, "#b03a2e", [Math.PI, 0, 0]),
        cyl(0, 0.08, 0, 0.005, 0.06, "#d5d8dc", [0, 0, 0.12]),
        cyl(0.015, 0.0, 0.005, 0.005, 0.05, "#d5d8dc", [0, 0, -0.18]),
        sph(0.28, 0.75, 0.1, 0.045, C.white, 0.03, 0.045),
      ];
    case "kite":
      return [
        boxP(0, 1.05, 0, 0.3, 0.42, 0.008, pick(rand, ["#e2483d", "#2ecc71", "#f4d03f"]), [0, 0, 0.78]),
        boxP(0, 1.05, 0.006, 0.028, 0.4, 0.004, C.woodDD, [0, 0, 0.78]),
        boxP(0, 1.05, 0.006, 0.3, 0.025, 0.004, C.woodDD, [0, 0, 0.78]),
        ...[0, 1, 2].map((i) => boxP(r(rand, -0.08, 0.08), 0.48 - i * 0.14, 0, 0.04, 0.02, 0.006, C.cyan, [0, 0, 0.4])),
        cyl(0.35, 0.15, 0.2, 0.004, 0.4, "#d5d8dc", [0, 0, 1.2]),
      ];
    default: { // skateboard
      const parts: HoloPart[] = [
        boxP(0, 0.13, 0, 0.55, 0.014, 0.16, pick(rand, ["#e2483d", "#2c3e50", "#2980b9", "#e67e22"])),
        boxP(-0.48, 0.16, 0, 0.09, 0.012, 0.15, C.woodDD, [0, 0, 0.35]),
        boxP(0.48, 0.16, 0, 0.09, 0.012, 0.15, C.woodDD, [0, 0, -0.35]),
      ];
      for (const sx of [-1, 1]) {
        parts.push(boxP(sx * 0.35, 0.085, 0, 0.03, 0.02, 0.13, "#7f8c8d"));
        for (const sz of [-1, 1]) {
          parts.push(cyl(sx * 0.35, 0.06, sz * 0.08, 0.045, 0.018, C.cream, [0, 0, 1.5708]));
        }
      }
      return parts;
    }
  }
}

/* ---- nature & sky ---- */
function natureFam(rand: Rand, kind: string): HoloPart[] {
  switch (kind) {
    case "sun": {
      const parts: HoloPart[] = [sph(0, 0.75, 0, 0.45, "#f6c453", 0.45, 0.45)];
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        parts.push(coneP(Math.cos(a) * 0.72, 0.75 + Math.sin(a) * 0.72, 0, 0.05, 0.16, "#f4d03f", [0, 0, a - 1.5708]));
      }
      return parts;
    }
    case "moon":
      return [
        sph(0, 0.55, 0, 0.5, "#e8e4d8"),
        sph(-0.15, 0.72, 0.42, 0.09, "#c9c4b4", 0.09, 0.05),
        sph(0.2, 0.45, 0.45, 0.07, "#c9c4b4", 0.07, 0.04),
        sph(0.02, 0.3, 0.46, 0.05, "#c9c4b4", 0.05, 0.03),
        sph(-0.3, 0.5, 0.38, 0.05, "#c9c4b4", 0.05, 0.03),
      ];
    case "star": {
      const parts: HoloPart[] = [sph(0, 0.7, 0, 0.12, "#fde68a")];
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        parts.push(boxP(Math.cos(a) * 0.32, 0.7 + Math.sin(a) * 0.32, 0, 0.045, 0.17, 0.045, "#fde68a", [0, 0, a]));
      }
      parts.push(sph(0.12, 0.86, 0.1, 0.035, C.white));
      return parts;
    }
    case "cloud":
      return [
        sph(-0.42, 0.48, 0, 0.3, "#eef3f8"),
        sph(-0.1, 0.58, 0.05, 0.36, "#f7fafc"),
        sph(0.28, 0.52, -0.04, 0.32, "#eef3f8"),
        sph(0.55, 0.44, 0.03, 0.24, "#f7fafc"),
        sph(0.05, 0.4, 0.08, 0.26, "#e2e9f0"),
        sph(0.6, 0.55, 0.1, 0.045, C.cyan, 0.03, 0.045),
      ];
    case "mountain": case "hill":
      return [
        coneP(0, 0.42, 0, 0.72, 0.5, "#6b7a8f"),
        coneP(0, 0.85, 0, 0.22, 0.2, C.white),
        coneP(-0.6, 0.22, 0.15, 0.36, 0.26, "#7f8c9b"),
        coneP(0.58, 0.25, -0.1, 0.32, 0.22, "#7f8c9b"),
        sph(0, 0.35, 0.6, 0.09, C.white, 0.02, 0.09),
      ];
    case "island": {
      const parts: HoloPart[] = [
        sph(0, 0.08, 0, 0.8, "#e6cf9a", 0.2, 0.8),
        cyl(0, 0.02, 0, 1.05, 0.008, "#64d2e8"),
        cyl(-0.02, 0.45, 0, 0.045, 0.22, C.woodD, [0, 0, 0.12]),
        cyl(0.04, 0.72, 0, 0.04, 0.18, C.woodD, [0, 0, -0.14]),
      ];
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        parts.push(p("capsule", [0.04 + Math.cos(a) * 0.22, 0.9, Math.sin(a) * 0.22], [Math.cos(a) * 1.2, 0, -Math.sin(a) * 1.2], [0.05, 0.16, 0.012], "#27ae60"));
      }
      parts.push(sph(0.1, 0.82, 0.06, 0.05, C.woodDD));
      return parts;
    }
    case "mushroom":
      return [
        cyl(0, 0.18, 0, 0.09, 0.18, "#e8dcc8"),
        sph(0, 0.42, 0, 0.4, "#e2483d", 0.2, 0.4),
        sph(-0.18, 0.5, 0.24, 0.045, C.white, 0.015, 0.045),
        sph(0.16, 0.52, 0.2, 0.04, C.white, 0.014, 0.04),
        sph(0.02, 0.55, -0.3, 0.035, C.white, 0.012, 0.035),
        flat(0, 0.32, 0, 0.32, 0.015, "#d8c7b0", [1.5708, 0, 0]),
      ];
    case "cactus":
      return [
        p("capsule", [0, 0.55, 0], [0, 0, 0], [0.14, 0.42, 0.14], "#2ecc71"),
        boxP(-0.2, 0.45, 0, 0.1, 0.07, 0.07, "#2ecc71"),
        p("capsule", [-0.3, 0.62, 0], [0, 0, 0], [0.08, 0.17, 0.08], "#2ecc71"),
        boxP(0.2, 0.3, 0, 0.09, 0.06, 0.06, "#2ecc71"),
        p("capsule", [0.29, 0.44, 0], [0, 0, 0], [0.07, 0.13, 0.07], "#2ecc71"),
        sph(0, 1.02, 0, 0.05, C.pink, 0.04, 0.05),
        cyl(0, 0.04, 0, 0.2, 0.03, "#b8875a"),
      ];
    case "sunflower":
      return [
        cyl(0, 0.35, 0, 0.03, 0.35, "#27ae60"),
        sph(-0.18, 0.28, 0, 0.13, "#2ecc71", 0.02, 0.07),
        sph(0.16, 0.42, 0, 0.12, "#2ecc71", 0.02, 0.07),
      ].concat(
        (() => {
          const head: HoloPart[] = [
            cyl(0, 0.74, 0.06, 0.2, 0.035, "#6b4f2a", [1.2, 0, 0]),
          ];
          for (let i = 0; i < 10; i++) {
            const a = (i / 10) * Math.PI * 2;
            head.push(p("capsule",
              [Math.cos(a) * 0.26, 0.74 + Math.sin(a) * 0.26, 0.09],
              [0, 0, a], [0.035, 0.11, 0.012], "#f4d03f"));
          }
          return head;
        })(),
      );
    case "rainbow": {
      const colors = ["#e2483d", "#e67e22", "#f4d03f", "#2ecc71", "#3498db"];
      return colors.map((c, i) =>
        flat(0, 0.55 - i * 0.05, 0, 0.55 - i * 0.05, 0.022, c, [0, 0, 0]),
      );
    }
    default: { // earth
      const parts: HoloPart[] = [sph(0, 0.55, 0, 0.52, "#2e6fb0")];
      parts.push(
        sph(-0.18, 0.72, 0.42, 0.16, "#3fa05c", 0.13, 0.1),
        sph(0.28, 0.5, 0.4, 0.13, "#3fa05c", 0.11, 0.08),
        sph(0.05, 0.3, 0.48, 0.11, "#3fa05c", 0.09, 0.07),
        sph(-0.3, 0.42, -0.4, 0.14, C.white, 0.05, 0.14),
        sph(0.85, 0.95, -0.3, 0.12, "#d5d8dc"),
      );
      parts.push(flat(0, 0.55, 0, 0.52, 0.005, C.cyan, [0, 0, 0]));
      return parts;
    }
  }
}

/* ---- mailbox (structure + box hybrid) ---- */
function mailboxFam(): HoloPart[] {
  return [
    boxP(0, 0.25, 0, 0.025, 0.25, 0.025, C.woodDD),
    boxP(0, 0.56, 0, 0.11, 0.09, 0.2, "#95a5a6"),
    p("cylinder", [0, 0.56, 0], [0, 0, 1.5708], [0.11, 0.2, 0.11], "#aab7c4"),
    boxP(0, 0.56, 0.21, 0.09, 0.07, 0.008, "#7f8c8d"),
    boxP(0.13, 0.68, 0, 0.008, 0.07, 0.02, C.red),
    sph(0, 0.56, -0.21, 0.012, C.gold),
  ];
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

/* ------------------------------------------------------------------ */
/* Word sets for the parametric families                               */
/* ------------------------------------------------------------------ */

const SEATING_WORDS = new Set(["chair", "seat", "stool", "bench", "sofa", "couch", "armchair", "recliner", "loveseat", "throne", "pew"]);
const SEAT_MODS: Record<string, SeatMods> = {
  chair: { back: true }, seat: {}, stool: {}, bench: { wide: 1.7 },
  sofa: { back: true, arms: true, wide: 1.6, cushion: true },
  couch: { back: true, arms: true, wide: 1.6, cushion: true },
  armchair: { back: true, arms: true, cushion: true },
  recliner: { back: true, arms: true, cushion: true },
  loveseat: { back: true, arms: true, wide: 1.25, cushion: true },
  throne: { back: true, arms: true, throne: true },
  pew: { back: true, wide: 1.8 },
};
const TABLE_WORDS = new Set(["table", "desk", "nightstand"]);
const BED_WORDS = new Set(["bed", "crib"]);
const STORAGE_WORDS = new Set(["shelf", "bookshelf", "bookcase", "dresser", "drawer", "drawers", "cabinet", "cupboard", "chest", "wardrobe", "bureau"]);
const STORAGE_MODS: Record<string, StoreMods> = {
  shelf: {}, bookshelf: { books: true }, bookcase: { books: true },
  dresser: { drawers: true }, drawer: { drawers: true }, drawers: { drawers: true },
  cabinet: { doors: true }, cupboard: { doors: true }, wardrobe: { doors: true },
  chest: { chest: true }, bureau: { drawers: true },
};
const SCREEN_WORDS = new Set(["tv", "television", "monitor", "screen", "phone", "smartphone", "telephone", "iphone", "tablet", "ipad", "laptop", "computer", "pc", "desktop", "macbook"]);
const SCREEN_KIND: Record<string, string> = {
  tv: "tv", television: "tv", monitor: "monitor", screen: "monitor",
  phone: "phone", smartphone: "phone", telephone: "phone", iphone: "phone",
  tablet: "tablet", ipad: "tablet", laptop: "laptop", macbook: "laptop",
  computer: "computer", pc: "computer", desktop: "computer",
};
const STRING_WORDS = new Set(["guitar", "bass", "violin", "fiddle", "cello", "banjo", "ukulele", "electric"]);
const PIANO_WORDS = new Set(["piano"]);
const DRUM_WORDS = new Set(["drum", "drums", "snare"]);
const WIND_WORDS = new Set(["trumpet", "flute", "clarinet", "bugle", "horn"]);
const MIC_WORDS = new Set(["microphone", "mic"]);
const TOOL_WORDS = new Set(["hammer", "axe", "hatchet", "screwdriver", "wrench", "spanner", "saw", "shovel", "spade", "broom", "drill"]);
const LADDER_WORDS = new Set(["ladder"]);
const KITCHEN_WORDS = new Set(["plate", "dish", "bowl", "bottle", "glass", "fork", "spoon", "knife", "teapot", "kettle", "pan", "skillet", "pot", "vase", "jug", "pitcher", "mug"]);
const KITCHEN_KIND: Record<string, string> = {
  plate: "plate", dish: "plate", bowl: "bowl", bottle: "bottle", glass: "glass",
  fork: "fork", spoon: "spoon", knife: "knife", teapot: "teapot", kettle: "kettle",
  pan: "pan", skillet: "pan", pot: "pot", vase: "vase", jug: "vase", pitcher: "vase",
  mug: "teapot",
};
const FOOD_WORDS = new Set(["pizza", "burger", "hamburger", "cheeseburger", "cake", "donut", "doughnut", "icecream", "apple", "banana", "orange", "carrot", "pumpkin", "watermelon", "melon", "egg", "eggs", "sushi", "hotdog", "candy", "popcorn", "strawberry", "cherry", "cherries", "pineapple"]);
const FOOD_KIND: Record<string, string> = {
  pizza: "pizza", burger: "burger", hamburger: "burger", cheeseburger: "burger",
  cake: "cake", donut: "donut", doughnut: "donut", icecream: "icecream",
  apple: "apple", banana: "banana", orange: "orange", carrot: "carrot",
  pumpkin: "pumpkin", watermelon: "watermelon", melon: "watermelon",
  egg: "egg", eggs: "egg", sushi: "sushi", hotdog: "hotdog", candy: "candy",
  popcorn: "popcorn", strawberry: "strawberry", cherry: "cherry", cherries: "cherry",
  pineapple: "pineapple",
};
const WEAR_WORDS = new Set(["hat", "cap", "shoe", "shoes", "sneaker", "sneakers", "boot", "boots", "glasses", "sunglasses", "watch", "ring", "rings", "crown", "helmet"]);
const WEAR_KIND: Record<string, string> = {
  hat: "tophat", cap: "cap", shoe: "shoe", shoes: "shoe", sneaker: "shoe", sneakers: "shoe",
  boot: "boot", boots: "boot", glasses: "glasses", sunglasses: "glasses",
  watch: "watch", ring: "ring", rings: "ring", crown: "crown", helmet: "helmet",
};
const STRUCT_WORDS = new Set(["bridge", "stairs", "staircase", "stairway", "fence", "door", "window", "tent", "campfire", "fire", "well", "streetlight", "sign", "barrel", "bucket", "crate", "box", "mailbox"]);
const TOY_WORDS = new Set(["ball", "football", "soccer", "basketball", "baseball", "dice", "die", "balloon", "kite", "skateboard"]);
const TOY_KIND: Record<string, string> = {
  ball: "ball", football: "football", soccer: "soccer", basketball: "basket",
  baseball: "baseball", dice: "dice", die: "dice", balloon: "balloon",
  kite: "kite", skateboard: "skateboard",
};
const NATURE_WORDS = new Set(["sun", "moon", "star", "cloud", "mountain", "hill", "island", "mushroom", "cactus", "sunflower", "rainbow", "earth", "planet-earth"]);

/** naive singularizer: "chairs" → "chair" (guarded against glasses/ss/us/is) */
function sing(w: string): string {
  if (w.length > 3 && w.endsWith("s") && !/(ss|us|is)$/.test(w)) return w.slice(0, -1);
  return w;
}

/**
 * Exact multi-word phrases that must beat both the library and single-word
 * routing ("hot dog" is food, not a dog; "lamp post" is a streetlight).
 */
const PHRASE_MAP: Record<string, () => HoloPart[]> = {
  "hot dog": () => foodFam(mulberry32(99), "hotdog"),
  "ice cream": () => foodFam(mulberry32(7), "icecream"),
  "treasure chest": () => storageFam(mulberry32(11), { chest: true }),
  "top hat": () => wearFam(mulberry32(13), "tophat"),
  "soccer ball": () => toyFam(mulberry32(17), "soccer"),
  "street light": () => structFam(mulberry32(19), "streetlight"),
  "street lamp": () => structFam(mulberry32(19), "streetlight"),
  "lamp post": () => structFam(mulberry32(19), "streetlight"),
  "streetlight post": () => structFam(mulberry32(19), "streetlight"),
  "book shelf": () => storageFam(mulberry32(23), { books: true }),
  "book case": () => storageFam(mulberry32(23), { books: true }),
  "night stand": () => tableFam(mulberry32(29), "night"),
  "bed side table": () => tableFam(mulberry32(29), "night"),
};

function normalizeAsk(object: string): string {
  return object.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Exact-phrase match for high-confidence multiword objects. Checked BEFORE
 * the library so "lamp post" doesn't become the desk lamp, etc.
 */
export function matchPhraseModel(object: string): HoloSpec | null {
  const clean = normalizeAsk(object);
  const make = PHRASE_MAP[clean];
  if (!make) return null;
  let parts: HoloPart[] = [];
  try {
    parts = make();
  } catch {
    return null;
  }
  if (!parts.length) return null;
  return normalizeHoloSpec(titleCase(clean), parts);
}

function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * The family-routing chain shared by matchFamilyModel/generateModel.
 * Returns the family's parts, or null when no real family matches —
 * the caller decides what that means (AI design vs abstract fallback).
 * Deterministic: same seed → same rand consumption → same parts.
 */
function routeFamily(rand: Rand, words: string[], pal: string[]): HoloPart[] | null {
  /** match a word set using raw then singularized tokens */
  const keyOf = (set: Set<string>): string | null =>
    words.find((w) => set.has(w) || set.has(sing(w))) ?? null;
  const has = (set: Set<string>) => keyOf(set) !== null;
  const key = (set: Set<string>) => keyOf(set) ?? "";

  if (has(SCREEN_WORDS)) {
    return screens(rand, SCREEN_KIND[key(SCREEN_WORDS)]);
  } else if (has(SEATING_WORDS)) {
    return seating(rand, SEAT_MODS[key(SEATING_WORDS)] ?? { back: true }, WOODISH());
  } else if (has(FOOD_WORDS)) {
    return foodFam(rand, FOOD_KIND[key(FOOD_WORDS)]);
  } else if (has(KITCHEN_WORDS)) {
    return kitchenFam(rand, KITCHEN_KIND[key(KITCHEN_WORDS)]);
  } else if (has(WEAR_WORDS)) {
    return wearFam(rand, WEAR_KIND[key(WEAR_WORDS)]);
  } else if (has(TOOL_WORDS)) {
    return toolFam(rand, key(TOOL_WORDS));
  } else if (has(LADDER_WORDS)) {
    return ladderFam(rand);
  } else if (has(TABLE_WORDS)) {
    return tableFam(rand, key(TABLE_WORDS) === "desk" ? "desk" : key(TABLE_WORDS) === "nightstand" ? "night" : "table");
  } else if (has(BED_WORDS)) {
    return bedFam(rand, pal);
  } else if (has(STORAGE_WORDS)) {
    return storageFam(rand, STORAGE_MODS[key(STORAGE_WORDS)] ?? {});
  } else if (has(STRING_WORDS)) {
    const k = key(STRING_WORDS);
    return strings(rand, k === "electric" ? "guitar" : k);
  } else if (has(PIANO_WORDS)) {
    return pianoFam(rand);
  } else if (has(DRUM_WORDS)) {
    return drumFam(rand, key(DRUM_WORDS) === "drums");
  } else if (has(WIND_WORDS)) {
    return windFam(rand, key(WIND_WORDS));
  } else if (has(MIC_WORDS)) {
    return micFam(rand);
  } else if (has(VEHICLE_WORDS)) {
    return vehicle(rand, VEHICLE_MODS[key(VEHICLE_WORDS)] ?? {}, pal);
  } else if (has(STRUCT_WORDS)) {
    const k = key(STRUCT_WORDS);
    return k === "mailbox" ? mailboxFam() : structFam(rand, k === "box" ? "crate" : k);
  } else if (has(TOY_WORDS)) {
    return toyFam(rand, TOY_KIND[key(TOY_WORDS)]);
  } else if (has(NATURE_WORDS)) {
    const k = key(NATURE_WORDS);
    return natureFam(rand, k === "planet-earth" ? "earth" : k);
  } else if (has(CREATURE_WORDS)) {
    return creature(rand, CREATURE_MODS[key(CREATURE_WORDS)] ?? jitterMods(rand), pal);
  } else if (has(BIRD_WORDS)) {
    return bird(rand, pal);
  } else if (has(INSECT_WORDS)) {
    return insect(rand, pal);
  } else if (has(FIGURE_WORDS)) {
    return figure(rand, FIGURE_MODS[key(FIGURE_WORDS)] ?? {}, pal);
  } else if (has(FISH_WORDS)) {
    return fish(rand, words.some((w) => ["whale", "orca", "shark"].includes(w)), pal);
  } else if (has(OCTOPUS_WORDS)) {
    return octopus(rand, pal);
  } else if (has(FLOWER_WORDS)) {
    return flower(rand, pal);
  }
  return null; // nothing the local builders recognize
}

/**
 * Match a REAL local family for the object (word-set routing; exact phrases
 * and the hand-authored library are checked separately by the caller).
 * Returns null when the object isn't something the local builders know —
 * i.e. generateModel() would fall back to abstract archetypes for it.
 * Deterministic: same ask → same model, byte-for-byte.
 */
export function matchFamilyModel(object: string): HoloSpec | null {
  const clean = normalizeAsk(object);
  if (!clean) return null;
  const words = clean.split(" ").filter(Boolean);
  const seed = hashString(clean);
  const rand = mulberry32(seed);
  const pal = [...pick(rand, PALETTES)];

  let parts: HoloPart[] | null = null;
  try {
    parts = routeFamily(rand, words, pal);
  } catch {
    return null; // a family builder glitched — treat as unknown
  }
  if (!parts || parts.length === 0) return null;
  return normalizeHoloSpec(titleCase(clean), parts);
}

/**
 * Deterministically turn any object description into a hologram spec.
 * Never throws, never touches the network. Unknown objects get a seeded
 * abstract archetype (crystal/totem/orbiter/obelisk/bloom) so a model
 * ALWAYS spawns — but prefer matchFamilyModel() when the caller wants to
 * know whether the object was actually recognized locally.
 */
export function generateModel(object: string): HoloSpec {
  const clean = normalizeAsk(object);
  const words = clean.split(" ").filter(Boolean);
  const seed = hashString(clean || "hologram");
  const rand = mulberry32(seed);
  const pal = [...pick(rand, PALETTES)];

  let parts: HoloPart[] | null = null;
  try {
    parts = routeFamily(rand, words, pal);
  } catch {
    /* fall through to the abstract fallback */
  }
  if (!parts || parts.length === 0) parts = pick(rand, ABSTRACTS)(rand, pal);
  return normalizeHoloSpec(titleCase(clean) || "Hologram", parts);
}

/** Furniture gets a warm wood palette regardless of the seeded palette. */
function WOODISH(): string[] {
  return ["#c89666", "#b98a5e", "#5d4037", "#e6cfb5"];
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

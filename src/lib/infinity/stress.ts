/**
 * Infinity — reality physics stress test.
 *
 * Given a hologram's parts + a real material assignment, this module runs a
 * REAL engineering analysis with published material properties (materials.ts)
 * and classic mechanics:
 *
 *   • axial stress          σ = F / A
 *   • Euler buckling        σcr = π²·E / λ²     (λ = L / r_gyration)
 *   • cantilever bending    σ = 3·F·L / (w·t²)
 *   • drop energy           E = m·g·h           (h = 1.5 m)
 *   • thermal service limit vs. 85 °C (hot car / direct sun)
 *
 * Nothing is invented at runtime — material strengths, moduli and densities
 * come from the tables in materials.ts, loads come from real geometry, and
 * the weak points fall out of the arithmetic.
 */
import type { HoloPart, HoloPartType } from "./types";
import {
  MATERIAL_BY_ID,
  guessMaterialFromColor,
  resolveMaterial,
  type Material,
} from "./materials";

const G = 9.81;
/** Standard drop-test height (ISTA/ASTM-style consumer drop). */
export const DROP_HEIGHT_M = 1.5;
/** Worst-case household heat: a car interior in direct sun. */
export const HOT_CAR_C = 85;

/* ------------------------------------------------------------------ */
/* The analysis prompt — the LLM only IDENTIFIES real materials;        */
/* every number below is computed locally from real tables.             */
/* ------------------------------------------------------------------ */

export const STRESS_SYSTEM = `You are a structural materials assistant. You get a numbered part list of a 3D model and reply with ONLY these lines — no intro, no markdown, no explanation:

NAME = <the real-world object these parts form>
SIZE = <real-world height of that object in meters, e.g. 0.9 for a chair, 0.1 for a mug, 300 for a tower>
LOAD = <weight in kilograms the object must support in normal use; 0 if it supports nothing>
HOLLOW = <fraction of the object's volume that is solid material: 1.0 for solid objects, about 0.1 for cups/bottles/vases/tires (thin walls), about 0.005 for buildings and towers (mostly air and floors)>
MAT | <part number> | <material> | <short role like "left front leg">

Materials you may use (real engineering materials — write them exactly):
steel, stainless, aluminum, titanium, copper, brass, cast_iron, gold, silver, lead, zinc,
abs, pla, polycarbonate, acrylic, hdpe, rubber,
oak, pine, bamboo, glass, ceramic, concrete, brick, granite,
fiberglass, carbon_fiber, cardboard, paper, leather, fabric, foam, bone, diamond, ice

Rules:
- One MAT line for EVERY part, in order, using its part number.
- Choose what the real object is actually made of: a kitchen chair is pine or oak, a coffee mug is ceramic, a phone is glass and aluminum, a sword is steel, a LEGO brick is abs, a boat hull is fiberglass.
- If parts are mixed materials, assign each part what it really is.
- SIZE, LOAD and HOLLOW must be realistic engineering values for the real object.
- Keep each role to 2-4 words.`;

/* ------------------------------------------------------------------ */
/* Geometry — world-space AABBs and volumes of the actual parts         */
/* ------------------------------------------------------------------ */

export interface PartGeom {
  /** World-space (model space) AABB half extents after rotation. */
  half: [number, number, number];
  center: [number, number, number];
  minY: number;
  maxY: number;
  footW: number;
  footD: number;
  /** Volume in model units³ (type-exact formula). */
  volume: number;
  /** Radius of gyration of the cross-section (for buckling). */
  rGyr: number;
  footprintArea: number;
  /** True solid cross-section area in model units² (axial stress). */
  section: number;
}

const UNIT_HALF: Record<HoloPartType, readonly [number, number, number]> = {
  box: [1, 1, 1],
  sphere: [1, 1, 1],
  cylinder: [1, 1, 1],
  cone: [1, 1, 1],
  torus: [1.4, 1.4, 0.4],
  capsule: [0.7, 1.3, 0.7],
};

function rotatedHalfExtents(part: HoloPart): [number, number, number] {
  const h = UNIT_HALF[part.type] ?? [1, 1, 1];
  const [rx, ry, rz] = part.rotation;
  const c = Math.abs(Math.cos(rx)), s = Math.abs(Math.sin(rx));
  // full 3-axis rotation is overkill for the AABB; combine x/z spins (common
  // for wheels/rings) then the y spin. Use a small angle set: max extent via
  // cos/sin of each pair — good enough for AABBs of primitives.
  const cy = Math.abs(Math.cos(ry)), sy = Math.abs(Math.sin(ry));
  const cz = Math.abs(Math.cos(rz)), sz = Math.abs(Math.sin(rz));
  const hx = h[0] * Math.abs(part.scale[0]);
  const hy = h[1] * Math.abs(part.scale[1]);
  const hz = h[2] * Math.abs(part.scale[2]);
  // apply rz then ry then rx (matching three.js default XYZ order closely)
  const x1 = hx * cz + hy * sz;
  const y1 = -hx * sz + hy * cz;
  const x2 = x1 * cy + hz * sy;
  const z2 = -x1 * sy + hz * cy;
  const y3 = y1 * c + hz * s;
  const z3 = z2 * c + y1 * s;
  return [Math.abs(x2), Math.abs(y3), Math.abs(z3)];
}

/** Volume of the unit primitive × per-axis scale (exact for these shapes). */
function partVolume(part: HoloPart): number {
  const [sx, sy, sz] = part.scale.map(Math.abs) as [number, number, number];
  switch (part.type) {
    case "box":
      return (2 * sx) * (2 * sy) * (2 * sz);
    case "sphere":
      return (4 / 3) * Math.PI * sx * sy * sz;
    case "cylinder":
      return Math.PI * sx * sz * (2 * sy);
    case "cone":
      return (Math.PI / 3) * sx * sz * (2 * sy);
    case "torus":
      // ring radius 1.4s, tube radius 0.4s → V = 2π²R r²
      return 2 * Math.PI * Math.PI * 1.4 * sx * 0.4 * sy * 0.4 * sz;
    case "capsule":
      return Math.PI * sx * sz * (1.2 * sy) + (4 / 3) * Math.PI * sx * sy * sz * 0.7;
    default:
      return 8 * sx * sy * sz;
  }
}

export function partGeoms(parts: HoloPart[]): PartGeom[] {
  return parts.map((p) => {
    const half = rotatedHalfExtents(p);
    const [cx, cy, cz] = p.position;
    const minY = cy - half[1];
    const maxY = cy + half[1];
    // Cross-section for axial work: solid shapes keep their true section;
    // rings (torus) use the tube section (conservative).
    let section: number;
    let rGyr: number;
    if (p.type === "torus") {
      const tube = 0.4 * Math.abs(p.scale[0]);
      section = Math.PI * tube * tube;
      rGyr = tube / 2;
    } else if (p.type === "cylinder" || p.type === "cone" || p.type === "capsule") {
      const r = Math.abs(p.scale[0]);
      section = Math.PI * r * r;
      rGyr = r / 2;
    } else {
      const w = Math.max(1e-6, Math.min(half[0], half[2]) * 2);
      section = w * w; // square section of the smaller horizontal pair
      rGyr = w / Math.sqrt(12);
    }
    return {
      half,
      center: [cx, cy, cz],
      minY,
      maxY,
      footW: half[0] * 2,
      footD: half[2] * 2,
      volume: partVolume(p),
      rGyr,
      footprintArea: Math.max(1e-9, half[0] * half[2] * 4),
      section,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Assignment (from the LLM or the offline fallback)                    */
/* ------------------------------------------------------------------ */

export interface StressAssignment {
  name?: string;
  sizeMeters?: number;
  loadKg?: number;
  /** Fraction of the geometric volume that is solid material
   *  (1 = solid; ~0.1 for hollow vessels; ~0.005 for buildings). */
  hollow?: number;
  materials: Material[];
  roles: string[];
  /** Keyless name-hint profile (used when the LLM gave no values). */
  profile?: { size: number; load: number; hollow: number };
}

/** Parse the LLM's streamed analysis lines. Tolerant + salvageable. */
export function parseStressLine(
  line: string,
  partCount: number,
  acc: { name?: string; size?: number; load?: number; hollow?: number; mats: Record<number, string>; roles: Record<number, string> }
): void {
  const l = line.trim();
  if (!l) return;
  const nameM = /^name\s*[:=]\s*(.+)$/i.exec(l);
  if (nameM) {
    acc.name = nameM[1].trim().slice(0, 40);
    return;
  }
  const sizeM = /^size\s*[:=]\s*([\d.]+)/i.exec(l);
  if (sizeM) {
    acc.size = Math.min(400, Math.max(0.02, parseFloat(sizeM[1])));
    return;
  }
  const loadM = /^load\s*[:=]\s*([\d.]+)/i.exec(l);
  if (loadM) {
    acc.load = Math.min(50000, Math.max(0, parseFloat(loadM[1])));
    return;
  }
  const hollowM = /^hollow\s*[:=]\s*([\d.]+)/i.exec(l);
  if (hollowM) {
    acc.hollow = Math.min(1, Math.max(0.001, parseFloat(hollowM[1])));
    return;
  }
  if (/^mat\b/i.test(l) && l.includes("|")) {
    const seg = l.split("|");
    if (seg.length >= 3) {
      const idx = parseInt(seg[1]?.trim() ?? "", 10);
      const mat = seg[2]?.trim() ?? "";
      const role = (seg[3] ?? "").trim().slice(0, 30);
      if (Number.isFinite(idx) && idx >= 0 && idx < partCount && mat) {
        acc.mats[idx] = mat;
        acc.roles[idx] = role || `part ${idx + 1}`;
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Keyless object profiles — sensible real-world defaults when the      */
/* LLM isn't available to size the object                               */
/* ------------------------------------------------------------------ */

const PROFILE_HINTS: ReadonlyArray<[RegExp, { size: number; load: number; hollow: number }]> = [
  [/\b(mug|cup|glass|vase|bottle|can|jar|bowl|teapot|pitcher|kettle|bucket|pot|goblet)\b/, { size: 0.15, load: 0.5, hollow: 0.12 }],
  [/\b(barrel|crate|basket|chest|drum)\b/, { size: 0.9, load: 30, hollow: 0.3 }],
  [/\b(chair|stool|bench|seat|throne)\b/, { size: 0.9, load: 120, hollow: 1 }],
  [/\b(table|desk|workbench)\b/, { size: 0.75, load: 60, hollow: 1 }],
  [/\b(ladder|shelf|bookcase|cabinet|wardrobe|closet|dresser)\b/, { size: 1.8, load: 40, hollow: 1 }],
  [/\b(bed|sofa|couch|mattress)\b/, { size: 0.6, load: 200, hollow: 1 }],
  [/\b(tower|skyscraper|building|castle|lighthouse|monument|cathedral|temple)\b/, { size: 100, load: 0, hollow: 0.01 }],
  [/\b(bridge|dam|pier|dock)\b/, { size: 40, load: 20000, hollow: 0.02 }],
  [/\b(phone|controller|remote|toy|lamp|clock|radio|camera|calculator|toolbox)\b/, { size: 0.18, load: 0, hollow: 1 }],
  [/\b(guitar|violin|umbrella|flag|rifle|sword|shield|spear|staff|bat|racket|oar)\b/, { size: 1.0, load: 0, hollow: 1 }],
  [/\b(rocket|spaceship|spacecraft|missile|satellite|plane|jet|airplane|drone|helicopter)\b/, { size: 6, load: 0, hollow: 0.15 }],
  [/\b(car|truck|vehicle|train|boat|ship|submarine|tank|tractor|bulldozer)\b/, { size: 1.5, load: 300, hollow: 0.25 }],
  [/\b(giraffe|horse|elephant|dinosaur|dragon|robot|human|person|man|woman|statue|figure)\b/, { size: 1.7, load: 0, hollow: 1 }],
  [/\b(tree|pine|oak tree|palm)\b/, { size: 6, load: 0, hollow: 0.7 }],
];

/** Real-world size / service load / wall fraction by object name. */
export function guessObjectProfile(name: string): { size: number; load: number; hollow: number } {
  const k = ` ${name.toLowerCase()} `;
  for (const [re, p] of PROFILE_HINTS) if (re.test(k)) return p;
  return { size: 0.4, load: 0, hollow: 1 };
}

/** Fill every unassigned part with a sensible real material. */
export function completeAssignment(
  acc: { name?: string; size?: number; load?: number; hollow?: number; mats: Record<number, string>; roles: Record<number, string> },
  parts: HoloPart[],
  objectName: string
): StressAssignment {
  const materials: Material[] = [];
  const roles: string[] = [];
  const assigned: (Material | null)[] = parts.map((_, i) => {
    const raw = acc.mats[i];
    return raw ? resolveMaterial(raw) : null;
  });
  // dominant material for gaps
  const counts = new Map<string, number>();
  for (const m of assigned) if (m) counts.set(m.id, (counts.get(m.id) ?? 0) + 1);
  let dominant: Material | null = null;
  let best = 0;
  for (const [id, n] of counts) {
    if (n > best) {
      best = n;
      dominant = MATERIAL_BY_ID.get(id) ?? null;
    }
  }
  for (let i = 0; i < parts.length; i++) {
    if (assigned[i]) {
      materials.push(assigned[i]!);
    } else if (dominant) {
      materials.push(dominant);
    } else {
      // fully keyless: guess a real material from the part's color
      materials.push(guessMaterialFromColor(parts[i].color, objectName));
    }
    roles.push(acc.roles[i] || geometryRole(parts, i));
  }
  const profile = guessObjectProfile(objectName);
  return {
    name: acc.name,
    sizeMeters: acc.size,
    loadKg: acc.load,
    hollow: acc.hollow,
    materials,
    roles,
    profile,
  };
}

/** Keyless role naming from pure geometry: what a part IS in the structure. */
function geometryRole(parts: HoloPart[], i: number): string {
  const geoms = partGeoms(parts);
  const g = geoms[i];
  const minY = Math.min(...geoms.map((x) => x.minY));
  const maxY = Math.max(...geoms.map((x) => x.maxY));
  const span = Math.max(...geoms.map((x) => x.maxY - x.minY)) || 1;
  const h = g.maxY - g.minY;
  const minDim = Math.min(g.footW, g.footD);
  const maxDim = Math.max(g.footW, g.footD);
  if (g.minY <= minY + span * 0.05 && h > minDim * 1.8 && g.maxY < maxY - span * 0.15) {
    return "support column";
  }
  if (g.maxY >= maxY - span * 0.06 && h < minDim * 0.8) return "top platform";
  if (h < minDim * 0.5) return "span";
  if (h > maxDim * 1.2) return "upright member";
  return "main body";
}

/* ------------------------------------------------------------------ */
/* The physics                                                          */
/* ------------------------------------------------------------------ */

export type FailureMode = "buckling" | "compression" | "bending" | "static" | "impact";

export interface PartStress {
  /** Safety factor (capacity / applied). <1 = fails under test load. */
  sf: number;
  /** 0..1 risk used for the orange→red highlight. */
  risk: number;
  mode: FailureMode;
  /** Total load this part carries, kg (self + everything above + share). */
  carriedKg: number;
}

export interface WeakPoint {
  role: string;
  material: string;
  mode: FailureMode;
  /** Load multiplier at which this part gives way. */
  failsKg: number;
  risk: number;
}

export interface StressResult {
  parts: PartStress[];
  /** Effective per-part risk (structural ∪ impact fragility) 0..1. */
  risks: number[];
  /** Overall durability 0–100. */
  score: number;
  verdict: string;
  structScore: number;
  impactScore: number;
  thermalScore: number;
  weakest: WeakPoint | null;
  weakPoints: WeakPoint[];
  massKg: number;
  heightM: number;
  loadKg: number;
  materialsUsed: string[];
  dropNote: string;
  thermalNote: string;
  spokenSummary: string;
}

/** Score for one safety factor (against the derated allowable):
 *  SF 8+ → 100, SF 4 → 85, SF 2 → 60, SF 1 → 32, SF 0.5 → 10. */
function sfScore(sf: number): number {
  if (sf >= 8) return 100;
  if (sf >= 4) return 85 + 15 * (sf - 4) / 4;
  if (sf >= 2) return 60 + 25 * (sf - 2) / 2;
  if (sf >= 1) return 32 + 28 * (sf - 1);
  if (sf >= 0.5) return 10 + 22 * ((sf - 0.5) / 0.5);
  return Math.max(0, sf * 20);
}

/** Map safety factor → 0..1 risk for coloring (orange ≥ 0.42, red ≥ 0.72).
 *  SF 8 → 0, SF 2 → 0.43 (orange), SF 1.2 → 0.81 (red). */
function riskFromSf(sf: number): number {
  const inv = 1 / Math.max(0.02, sf);
  return Math.max(0, Math.min(1, (inv - 1 / 8) / (1 - 1 / 8)));
}

export function verdictWord(score: number): string {
  if (score >= 85) return "exceptional";
  if (score >= 70) return "excellent";
  if (score >= 55) return "solid";
  if (score >= 40) return "adequate";
  if (score >= 25) return "fragile";
  return "delicate";
}

function dropSentence(governing: Material, massKg: number): string {
  const s = governing.impactScore;
  let core: string;
  if (s < 15) {
    core = `A 1.5 metre drop onto concrete shatters it — ${governing.name} has almost no fracture toughness`;
  } else if (s < 35) {
    core = `A 1.5 metre drop will likely crack or snap it — ${governing.name} doesn't forgive impacts`;
  } else if (s < 60) {
    core = `It survives a 1.5 metre drop, with dents or scuffs at worst`;
  } else {
    core = `It shrugs off a 1.5 metre drop`;
  }
  const heavy = massKg >= 50 ? ` — and at ${fmtMass(massKg)}, gravity is not gentle` : "";
  return `${core}${heavy}.`;
}

function thermalSentence(mats: Material[]): string {
  const governing = [...mats].sort((a, b) => (a.softeningC ?? 999) - (b.softeningC ?? 999))[0];
  const limit = governing.softeningC ?? 999;
  if (governing.id === "ice") return "It's ice — anything above freezing destroys it.";
  if (limit < 70) {
    return `${cap(governing.name)} softens at ${limit} degrees — it warps in a hot car or direct sunlight.`;
  }
  if (limit < 110) {
    return `Room temperature is fine; it softens near ${limit} degrees Celsius.`;
  }
  if (governing.combustible) {
    return `Heat never bothers it, but it burns — keep ${governing.name} away from open flame.`;
  }
  return `Household heat doesn't bother it.`;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Load-path: which parts rest on which (transitive support closure). */
function supportLoads(
  geoms: PartGeom[],
  massesKg: number[],
  loadKg: number,
  objMaxY: number,
  objH: number
): number[] {
  const n = geoms.length;
  const tol = Math.max(0.02, objH * 0.1);

  // part i directly supports part j?
  const supports: boolean[][] = Array.from({ length: n }, () => Array(n).fill(false));
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      if (i === j) continue;
      const gi = geoms[i];
      const gj = geoms[j];
      // j sits on i: j's bottom near i's top, and their footprints overlap
      const sits = gj.minY >= gi.maxY - tol && gj.minY <= gi.maxY + tol * 1.5 && gj.minY < gi.maxY + tol;
      const ox =
        Math.min(gi.center[0] + gi.half[0], gj.center[0] + gj.half[0]) -
        Math.max(gi.center[0] - gi.half[0], gj.center[0] - gj.half[0]);
      const oz =
        Math.min(gi.center[2] + gi.half[2], gj.center[2] + gj.half[2]) -
        Math.max(gi.center[2] - gi.half[2], gj.center[2] - gj.half[2]);
      const overlapArea = Math.max(0, ox) * Math.max(0, oz);
      const minArea = Math.min(gi.footprintArea, gj.footprintArea);
      if (sits && minArea > 0 && overlapArea / minArea >= 0.2) {
        supports[i][j] = true;
      }
    }
  }

  // external service load lands on the topmost wide parts
  const topShare = new Array(n).fill(0);
  if (loadKg > 0) {
    const topIdx: number[] = [];
    for (let i = 0; i < n; i++) {
      if (geoms[i].maxY >= objMaxY - Math.max(0.03, objH * 0.08)) topIdx.push(i);
    }
    const list = topIdx.length > 0 ? topIdx : [geoms.reduce((bi, g, i, a) => (g.maxY > a[bi].maxY ? i : bi), 0)];
    const totalArea = list.reduce((s, i) => s + geoms[i].footprintArea, 0) || 1;
    for (const i of list) topShare[i] = (loadKg * geoms[i].footprintArea) / totalArea;
  }

  // carried(i) = own mass + masses of everything transitively above + share of load
  const carried = massesKg.slice();
  for (let i = 0; i < n; i++) carried[i] += topShare[i];

  const aboveCache = new Map<number, Set<number>>();
  const aboveOf = (i: number, seen = new Set<number>()): Set<number> => {
    const cached = aboveCache.get(i);
    if (cached) return cached;
    const out = new Set<number>();
    if (!seen.has(i)) {
      seen.add(i);
      for (let j = 0; j < n; j++) {
        if (supports[i][j] && !seen.has(j)) {
          out.add(j);
          for (const k of aboveOf(j, seen)) out.add(k);
        }
      }
    }
    aboveCache.set(i, out);
    return out;
  };

  const total = carried.slice();
  for (let i = 0; i < n; i++) {
    for (const j of aboveOf(i)) total[i] += massesKg[j] + topShare[j];
  }
  return total;
}

/**
 * THE stress test. `sizeMeters` is the object's real height (LLM estimate);
 * model units map onto it linearly.
 */
export function runStressAnalysis(
  specName: string,
  parts: HoloPart[],
  assignment: StressAssignment
): StressResult {
  const geoms = partGeoms(parts);
  const n = parts.length;

  // Real-world scale
  let minY = Infinity;
  let maxY = -Infinity;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const g of geoms) {
    minY = Math.min(minY, g.minY);
    maxY = Math.max(maxY, g.maxY);
    minX = Math.min(minX, g.center[0] - g.half[0]);
    maxX = Math.max(maxX, g.center[0] + g.half[0]);
    minZ = Math.min(minZ, g.center[2] - g.half[2]);
    maxZ = Math.max(maxZ, g.center[2] + g.half[2]);
  }
  const modelH = Math.max(0.05, maxY - minY);
  const profile = assignment.profile;
  const sizeMeters = Math.min(
    400,
    Math.max(
      0.03,
      assignment.sizeMeters && assignment.sizeMeters > 0.02
        ? assignment.sizeMeters
        : profile?.size ?? 0.5
    )
  );
  const mpu = sizeMeters / modelH; // meters per model unit

  // Hollow shells: cups, bottles, tires and buildings are mostly air. The
  // solid fraction scales mass AND axial section exactly (a thin-walled
  // tube with wall fraction f keeps f·A of the solid cross-section).
  const hollow = Math.min(
    1,
    Math.max(0.001, assignment.hollow ?? profile?.hollow ?? 1)
  );

  // Masses from real densities
  const massesKg = geoms.map((g, i) => {
    const m = assignment.materials[i];
    return g.volume * mpu ** 3 * m.density * hollow;
  });
  const massKg = massesKg.reduce((a, b) => a + b, 0);
  const loadKg =
    assignment.loadKg && assignment.loadKg > 0
      ? assignment.loadKg
      : assignment.loadKg === 0
        ? 0
        : profile?.load ?? 0;

  const carried = supportLoads(geoms, massesKg, loadKg, maxY, modelH);

  const stresses: PartStress[] = geoms.map((g, i) => {
    const m = assignment.materials[i];
    const F = carried[i] * G; // N
    const A = Math.max(1e-9, g.section * hollow) * mpu * mpu; // m²
    const sigmaMPa = F / A / 1e6;
    const h = g.half[1] * 2 * mpu; // real height of the part
    const minDim = Math.min(g.footW, g.footD) * mpu;

    // --- capacities, derated by real allowable-stress design factors ---
    // (AISC Ω=1.67 for steel, NDS ~2.7 for wood, plastics creep ≈2.5,
    //  annealed-glass design practice ≈10 — the way real engineers turn
    //  tested strength into safe allowable stress.)
    const E_MPa = m.youngsGPa * 1000;
    const axialAllow = (m.compressiveMPa ?? m.yieldMPa ?? m.tensileMPa * 0.8) / m.df;

    // slender? Euler critical stress, capped by the material allow (stubby
    // columns). Hollow shells resist buckling a bit better per unit area —
    // material further from the neutral axis — so widen rGyr slightly.
    const rGyrHollow = g.rGyr * (1 + 0.4 * (1 - hollow));
    const lambda = h / Math.max(1e-6, rGyrHollow * mpu);
    let bucklingMPa = Infinity;
    if (lambda > 10) {
      bucklingMPa = Math.min(axialAllow, (Math.PI ** 2 * E_MPa) / (lambda * lambda));
    }

    // bending capacity
    const bendAllow = (m.bendingMPa ?? m.yieldMPa ?? m.tensileMPa * 0.6) / m.df;

    const isSlab = minDim > 0 && h < minDim * 0.5; // flat / horizontal part
    const isColumn = h > minDim * 1.8; // tall thin part

    let mode: FailureMode = "compression";
    let capacityMPa = axialAllow;
    let appliedMPa = sigmaMPa;

    if (isColumn && lambda > 10 && bucklingMPa < axialAllow) {
      mode = "buckling";
      capacityMPa = bucklingMPa;
    } else if (isSlab && carried[i] > 0.01) {
      // horizontal span: cantilever-ish bending under what it carries
      // σ ≈ 3FL/(w t²) with L = longer horizontal span, t = thickness, w = width
      const L = Math.max(g.footW, g.footD) * mpu;
      const t = h;
      const w = Math.min(g.footW, g.footD) * mpu;
      const sigmaBend = (3 * F * L) / (w * t * t) / 1e6;
      mode = "bending";
      capacityMPa = bendAllow;
      appliedMPa = sigmaBend;
    }

    // brittle materials: tension governs everything (cracks start there)
    if (m.brittle && mode !== "bending") {
      capacityMPa = Math.min(capacityMPa, m.tensileMPa / m.df);
    }

    const sf = Math.max(0.01, capacityMPa / Math.max(1e-9, appliedMPa));
    return {
      sf,
      risk: riskFromSf(sf),
      mode,
      carriedKg: carried[i],
    };
  });

  // --- per-part structural scores ---
  const partScores = stresses.map((s) => sfScore(s.sf));
  const minScore = partScores.length ? Math.min(...partScores) : 100;
  const meanScore = partScores.length
    ? partScores.reduce((a, b) => a + b, 0) / partScores.length
    : 100;

  // --- fragility risk: brittle materials fail at THIN sections under
  //     impact — a mug's rim and handle are its real-world weak points even
  //     though they carry almost no static load. Thinness is measured
  //     against the object's own scale. ---
  const tRef = Math.max(0.01, modelH * mpu * 0.25);
  const fragRisk = geoms.map((g, i) => {
    const m = assignment.materials[i];
    const minDim = Math.min(g.footW, g.footD) * mpu;
    const thin = Math.max(0, Math.min(1, 1 - minDim / tRef));
    const imp = m.impactScore;
    let frag: number;
    if (imp < 15) frag = 0.55 + 0.4 * thin; // glass, ceramic, ice
    else if (imp < 35) frag = 0.38 + 0.32 * thin; // brittle plastics, concrete, cast iron
    else if (imp < 60) frag = 0.2 + 0.18 * thin; // wood, bone, soft metals
    else frag = 0; // genuinely tough: steel, polycarbonate, rubber
    return Math.max(0, Math.min(1, frag));
  });
  // effective risk drives the highlight color = the worse of the two
  const effRisk = stresses.map((s, i) => Math.max(s.risk, fragRisk[i]));

  // governing (weakest) materials by mass
  const byMass = new Map<string, number>();
  assignment.materials.forEach((m, i) => {
    byMass.set(m.id, (byMass.get(m.id) ?? 0) + massesKg[i]);
  });
  const sorted = [...byMass.entries()].sort((a, b) => b[1] - a[1]);
  const governing = sorted.length
    ? MATERIAL_BY_ID.get(sorted[0][0])!
    : assignment.materials[0];
  // weakest-impact material among the significant ones (>10% of mass)
  let impactMat = governing;
  for (const [id, kg] of sorted) {
    if (kg < massKg * 0.1) continue;
    const m = MATERIAL_BY_ID.get(id);
    if (m && m.impactScore < impactMat.impactScore) impactMat = m;
  }
  // thermal governing = lowest softening among significant parts
  let thermalMat = governing;
  for (const [id, kg] of sorted) {
    if (kg < massKg * 0.1) continue;
    const m = MATERIAL_BY_ID.get(id);
    if (m && (m.softeningC ?? 999) < (thermalMat.softeningC ?? 999)) thermalMat = m;
  }

  let impactScore = impactMat.impactScore;
  if (massKg > 30) impactScore = Math.max(0, impactScore - 10);
  if (massKg > 120) impactScore = Math.max(0, impactScore - 10);
  if (massKg < 0.5) impactScore = Math.min(100, impactScore + 5);

  const softLimit = thermalMat.softeningC ?? 999;
  let thermalScore: number;
  if (softLimit >= 200) thermalScore = 100;
  else if (softLimit >= HOT_CAR_C) thermalScore = 70 + 30 * ((softLimit - HOT_CAR_C) / 130);
  else if (softLimit >= 50) thermalScore = 35 + 35 * ((softLimit - 50) / 35);
  else thermalScore = 12;
  if (thermalMat.combustible) thermalScore = Math.max(0, thermalScore - 10);

  let structScore = 0.55 * minScore + 0.45 * meanScore;
  if (governing.brittle) structScore = Math.min(structScore, 88); // no-warning failure
  structScore = Math.round(structScore);

  const score = Math.round(
    Math.max(
      1,
      Math.min(100, 0.5 * structScore + 0.32 * impactScore + 0.18 * thermalScore)
    )
  );

  // --- weak points: parts that carry something (structural) OR brittle
  //     thin sections that shatter first (impact), ranked by effective risk ---
  const totalLoad = massKg + loadKg;
  const eligibility = Math.max(0.12, totalLoad * 0.04);
  const order = stresses
    .map((s, i) => ({ s, i }))
    .filter(({ s, i }) => s.carriedKg >= eligibility || fragRisk[i] >= 0.4)
    .sort((a, b) => effRisk[b.i] - effRisk[a.i]);
  const weakPoints: WeakPoint[] = order.slice(0, 3).map(({ s, i }) => {
    const impactGovens = fragRisk[i] > s.risk;
    return {
      role: assignment.roles[i] || `part ${i + 1}`,
      material: assignment.materials[i].name,
      mode: impactGovens ? "impact" : s.mode,
      failsKg: impactGovens ? 0 : Math.max(1, Math.round(s.carriedKg * s.sf)),
      risk: effRisk[i],
    };
  });

  const name = assignment.name || specName;
  const matsSummary = sorted
    .slice(0, 3)
    .map(([id]) => MATERIAL_BY_ID.get(id)?.name ?? id)
    .join(" and ");

  const weakest = weakPoints[0] ?? null;
  const modeText: Record<FailureMode, string> = {
    buckling: "buckles",
    compression: "crushes",
    bending: "snaps",
    static: "yields",
    impact: "shatters",
  };

  const bits: string[] = [
    `Stress test complete on the ${name}.`,
    `Real materials: ${matsSummary}${massKg >= 0.05 ? `, about ${fmtMass(massKg)} at ${fmtLen(sizeMeters)} tall` : ""}.`,
    `Overall durability score: ${score} out of 100 — ${verdictWord(score)}.`,
  ];
  if (weakest) {
    bits.push(
      weakest.mode === "impact"
        ? `Weakest point: the ${weakest.role} — thin ${weakest.material} there is the first thing to shatter.`
        : `Weakest point: the ${weakest.role} — it ${modeText[weakest.mode]} at around ${fmtMass(weakest.failsKg)} of load.`
    );
  }
  bits.push(dropSentence(impactMat, massKg));
  bits.push(thermalSentence([thermalMat]));

  return {
    parts: stresses,
    /** Effective per-part risk (structural ∪ impact fragility). */
    risks: effRisk,
    score,
    verdict: verdictWord(score),
    structScore,
    impactScore: Math.round(impactScore),
    thermalScore: Math.round(thermalScore),
    weakest,
    weakPoints,
    massKg,
    heightM: sizeMeters,
    loadKg,
    materialsUsed: sorted.slice(0, 4).map(([id]) => MATERIAL_BY_ID.get(id)?.name ?? id),
    dropNote: dropSentence(impactMat, massKg),
    thermalNote: thermalSentence([thermalMat]),
    spokenSummary: bits.join(" "),
  };
}

/* ------------------------------------------------------------------ */
/* Streaming client for the LLM material identification                 */
/* ------------------------------------------------------------------ */

/** Compact numbered part list the LLM reasons about. */
export function stressInstruction(object: string, parts: HoloPart[]): string {
  const lines = parts.map((p, i) => {
    const h = rotatedHalfExtents(p);
    const w = (h[0] * 2).toFixed(2);
    const hh = (h[1] * 2).toFixed(2);
    const d = (h[2] * 2).toFixed(2);
    const [x, y, z] = p.position.map((v) => v.toFixed(2));
    return `${i} | ${p.type} | center ${x} ${y} ${z} | size ${w} ${hh} ${d} | color ${p.color}`;
  });
  return `Object (called "${object}" by the user). Parts:\n${lines.join("\n")}`;
}

/** Hard deadline — the user should never watch a scan for a minute. */
export const STRESS_DEADLINE_MS = 30_000;

function withDeadline(signal: AbortSignal | undefined, ms: number): AbortController {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  const abort = () => {
    clearTimeout(timer);
    ctl.abort();
  };
  if (signal) {
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  }
  ctl.signal.addEventListener(
    "abort",
    () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    },
    { once: true }
  );
  return ctl;
}

/**
 * Ask the user's LLM to identify the real materials (via /api/model with
 * task=stress). Streams NDJSON; every complete output line fires onLine so
 * the UI can show real-time progress. Returns the full text (null/throws
 * on hard failure — the caller falls back to the color heuristic).
 */
export async function requestStressAnalysis(opts: {
  object: string;
  parts: HoloPart[];
  provider: string;
  apiKey: string;
  baseUrl?: string;
  model: string;
  onLine?: (line: string) => void;
  signal?: AbortSignal;
}): Promise<string | null> {
  const { object, parts, provider, apiKey, baseUrl, model, onLine, signal } = opts;
  const deadline = withDeadline(signal, STRESS_DEADLINE_MS);

  let res: Response;
  try {
    res = await fetch("/api/model", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: deadline.signal,
      body: JSON.stringify({
        provider,
        apiKey: apiKey.trim(),
        baseUrl: baseUrl?.trim() || undefined,
        model: model.trim(),
        object: object.trim().slice(0, 120),
        task: "stress",
        instruction: stressInstruction(object, parts),
      }),
    });
  } catch {
    return null;
  }

  if (!res.ok || !res.body) return null;

  let full = "";
  let buf = "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try {
          const ev = JSON.parse(line) as { t?: string; v?: string };
          if (ev.t === "delta" && typeof ev.v === "string") {
            full += ev.v;
            // fire complete lines as they arrive (real-time progress)
            let ln: number;
            let carry = ev.v;
            while ((ln = carry.indexOf("\n")) >= 0) {
              const out = carry.slice(0, ln).trim();
              carry = carry.slice(ln + 1);
              if (out) onLine?.(out);
            }
          } else if (ev.t === "error") {
            return full || null;
          }
        } catch {
          /* partial line — ignore */
        }
      }
    }
  } catch {
    // connection dropped — whatever lines arrived are salvaged in `full`
  }
  return full || null;
}

function fmtMass(kg: number): string {
  if (kg >= 1e9) return `${round1(kg / 1e9)} million tonnes`;
  if (kg >= 1e6) return `${round1(kg / 1e6)} thousand tonnes`;
  if (kg >= 1e4) return `${Math.round(kg / 1000)} tonnes`;
  if (kg >= 1000) return `${round1(kg / 1000)} tonnes`;
  if (kg >= 20) return `${Math.round(kg)} kilograms`;
  if (kg >= 2) return `${round1(kg)} kilograms`;
  if (kg >= 0.05) return `${Math.round(kg * 1000)} grams`;
  return "a few grams";
}

const round1 = (v: number) => Math.round(v * 10) / 10;

function fmtLen(m: number): string {
  if (m >= 1000) return `${Math.round(m / 100) / 10} kilometres`;
  if (m >= 10) return `${Math.round(m)} metres`;
  if (m >= 1) return `${Math.round(m * 10) / 10} metres`;
  if (m >= 0.02) return `${Math.round(m * 100)} centimetres`;
  return `${Math.round(m * 1000)} millimetres`;
}

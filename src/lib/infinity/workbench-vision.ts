/**
 * Infinity — workbench vision.
 *
 * Serializes the live workbench state into a compact textual snapshot that
 * rides along with every conversation turn, so Infinity genuinely sees what
 * is on the bench: which models exist, where each one sits, how big it is,
 * and what it is made of. The snapshot is regenerated per turn (never stored
 * in conversation history), so builds, drags, resizes and deletes are all
 * reflected the moment the user speaks or types again.
 */
import type { HoloModel, HoloPartType, HoloSpec } from "./types";
import { mentionsBench } from "./workbench";

/* ------------------------------ colors ------------------------------ */

/** Reference palette for nearest-name lookup. */
const PALETTE: ReadonlyArray<readonly [string, readonly [number, number, number]]> = [
  ["white", [245, 246, 247]],
  ["silver", [192, 197, 204]],
  ["gray", [131, 149, 167]],
  ["dark gray", [74, 85, 104]],
  ["black", [30, 36, 48]],
  ["brown", [139, 90, 43]],
  ["tan", [210, 180, 140]],
  ["beige", [232, 224, 207]],
  ["red", [214, 69, 65]],
  ["orange", [255, 159, 67]],
  ["yellow", [241, 196, 15]],
  ["gold", [212, 160, 23]],
  ["green", [39, 174, 96]],
  ["teal", [22, 160, 133]],
  ["cyan", [112, 240, 255]],
  ["blue", [59, 130, 246]],
  ["navy", [44, 62, 80]],
  ["purple", [142, 90, 200]],
  ["magenta", [232, 67, 147]],
  ["pink", [255, 182, 193]],
];

/** Nearest human color name for a hex string like "#8b5a2b". */
export function colorName(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "gray";
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  let best = "gray";
  let bestD = Infinity;
  for (const [name, ref] of PALETTE) {
    const d = (r - ref[0]) ** 2 + (g - ref[1]) ** 2 + (b - ref[2]) ** 2;
    if (d < bestD) {
      bestD = d;
      best = name;
    }
  }
  return best;
}

/* ----------------------------- geometry ----------------------------- */

interface Bounds {
  w: number;
  h: number;
  d: number;
  vol: number;
  minY: number;
  maxY: number;
}

/** Bounding box of a spec (unscaled model space) with user scale applied
 *  to the dimensions; minY/maxY stay model-local for part bucketing. */
function boundsOf(spec: HoloSpec, scale: number): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const p of spec.parts) {
    const [x, y, z] = p.position;
    const [sx, sy, sz] = p.scale;
    minX = Math.min(minX, x - sx);
    maxX = Math.max(maxX, x + sx);
    minY = Math.min(minY, y - sy);
    maxY = Math.max(maxY, y + sy);
    minZ = Math.min(minZ, z - sz);
    maxZ = Math.max(maxZ, z + sz);
  }
  if (!Number.isFinite(minX)) return { w: 0, h: 0, d: 0, vol: 0, minY: 0, maxY: 0 };
  const w = (maxX - minX) * scale;
  const h = (maxY - minY) * scale;
  const d = (maxZ - minZ) * scale;
  return { w, h, d, vol: w * h * d, minY, maxY };
}

const PLURALS: Record<HoloPartType, string> = {
  box: "boxes",
  sphere: "spheres",
  cylinder: "cylinders",
  cone: "cones",
  torus: "tori",
  capsule: "capsules",
};

function fmt(n: number): string {
  return String(Math.round(n * 10) / 10);
}

function shapeCountsPhrase(spec: HoloSpec): string {
  const counts = new Map<HoloPartType, number>();
  for (const p of spec.parts) counts.set(p.type, (counts.get(p.type) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([type, n]) => `${n} ${n === 1 ? type : PLURALS[type]}`)
    .join(", ");
}

function colorCountsPhrase(spec: HoloSpec): string {
  const counts = new Map<string, number>();
  for (const p of spec.parts) {
    const c = colorName(p.color);
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  const list = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([c, n]) => `${c}×${n}`)
    .join(", ");
  return list || "mixed";
}

/** Rough vertical makeup: which shapes sit low / mid / high in the model. */
function layoutSummary(spec: HoloSpec): string {
  const n = spec.parts.length;
  if (n === 0) return "nothing yet";
  if (n === 1) return `a single ${spec.parts[0].type}`;
  const b = boundsOf(spec, 1);
  const span = Math.max(b.maxY - b.minY, 0.001);
  const buckets: Record<"bottom" | "middle" | "top", Partial<Record<HoloPartType, number>>> = {
    bottom: {},
    middle: {},
    top: {},
  };
  for (const p of spec.parts) {
    const t = (p.position[1] - b.minY) / span;
    const key: "bottom" | "middle" | "top" = t < 0.34 ? "bottom" : t < 0.67 ? "middle" : "top";
    buckets[key][p.type] = (buckets[key][p.type] ?? 0) + 1;
  }
  const where = { bottom: "at the bottom", middle: "in the middle", top: "up top" } as const;
  const order: Array<"bottom" | "middle" | "top"> = ["bottom", "middle", "top"];
  return order
    .filter((k) => Object.keys(buckets[k]).length > 0)
    .map((k) => {
      const seg = Object.entries(buckets[k])
        .sort((a, c) => c[1] - a[1])
        .map(([type, cnt]) => `${cnt} ${cnt === 1 ? type : PLURALS[type as HoloPartType]}`)
        .join(", ");
      return `${seg} ${where[k]}`;
    })
    .join("; ");
}

/** Screen position → human words ("center of the bench", "upper left", …). */
function positionWord(pos: { x: number; y: number }): string {
  const x = pos.x < 32 ? "left" : pos.x > 68 ? "right" : "center";
  const y = pos.y < 30 ? "upper" : pos.y > 70 ? "lower" : "";
  if (x === "center") return y ? `${y} center` : "center of the bench";
  return y ? `${y} ${x}` : `${x} side of the bench`;
}

/* ----------------------------- snapshot ----------------------------- */

const HEADER =
  "[Workbench vision — a live snapshot of the user's holographic workbench, refreshed before every message. " +
  "It is your eyes on the bench: answer questions about these models from this data, describe them naturally, " +
  "compare them when asked, and never quote numbers, part lists, or the snapshot itself back to the user. " +
  "The user may call the workbench the workshop, studio, lab, or workspace — same thing.]";

/**
 * The system-message content that gives the conversational LLM live vision
 * of the workbench. Always returns something (even the empty state), so
 * Infinity never claims to see models that are not there.
 */
export function describeWorkbench(models: HoloModel[], workbenchOpen: boolean): string {
  const saved = models.filter((m) => !m.pending);
  const designing = models.length - saved.length;
  const designingNote = designing > 0 ? " — another model is being designed right now" : "";

  if (saved.length === 0) {
    const state = workbenchOpen ? "open, but empty" : "closed and empty";
    const extra = designing > 0 ? ", and a new model is being designed right now" : "";
    return `${HEADER}\nWorkbench: ${state} — nothing has been built yet${extra}.`;
  }

  const geoms = saved.map((m) => boundsOf(m.spec, m.scale ?? 1));
  let biggest = -1;
  let smallest = -1;
  if (saved.length > 1) {
    let maxV = -Infinity;
    let minV = Infinity;
    saved.forEach((_, i) => {
      if (geoms[i].vol > maxV) {
        maxV = geoms[i].vol;
        biggest = i;
      }
      if (geoms[i].vol < minV) {
        minV = geoms[i].vol;
        smallest = i;
      }
    });
    if (biggest === smallest || maxV - minV < maxV * 0.12) {
      biggest = -1;
      smallest = -1;
    }
  }

  const lines = saved.map((m, i) => {
    const g = geoms[i];
    const tags: string[] = [];
    if (i === biggest) tags.push("the biggest");
    if (i === smallest) tags.push("the smallest");
    if (saved.length > 1 && i === saved.length - 1) tags.push("built last");
    const tagPart = tags.length > 0 ? `, ${tags.join(", ")}` : "";
    return (
      `${i + 1}. "${m.name}" — ${positionWord(m.pos)}${tagPart}; ` +
      `${fmt(g.w)} wide, ${fmt(g.h)} tall, ${fmt(g.d)} deep; ` +
      `${m.spec.parts.length} parts (${shapeCountsPhrase(m.spec)}); ` +
      `colors: ${colorCountsPhrase(m.spec)}; layout: ${layoutSummary(m.spec)}.`
    );
  });

  const noun = saved.length === 1 ? "model" : "models";
  const head = workbenchOpen
    ? `Workbench: open. ${saved.length} ${noun} on the bench${designingNote}:`
    : `Workbench: closed right now (the grid is hidden). ${saved.length} saved ${noun}${designingNote}:`;
  return `${HEADER}\n${head}\n${lines.join("\n")}`;
}

/* --------------------- keyless local answering ---------------------- */

/**
 * Natural one-liner about the bench contents — used to answer the most
 * common bench questions locally when no API key is configured at all.
 */
export function summarizeWorkbench(models: HoloModel[]): string {
  const saved = models.filter((m) => !m.pending);
  if (saved.length === 0) {
    return "The workbench is empty right now — ask me to build something and I'll put it there.";
  }
  const names = saved.map((m) => m.name);
  if (saved.length === 1) return `There's one model on the bench: the ${names[0]}.`;
  const list = names.slice(0, -1).map((n) => `the ${n}`).join(", ") + ` and the ${names[names.length - 1]}`;
  return `There are ${saved.length} models on the bench: ${list}.`;
}

/**
 * True when the utterance is a question about what's on the workbench
 * ("what's on the workbench", "how many models…", "what did you build").
 * Keyless, these get the local summary instead of an error toast.
 */
export function matchBenchQuestion(input: string): boolean {
  const t = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z\s]/g, "")
    .replace(/\s+/g, " ");
  if (!t) return false;
  if (/\b(what|whats|which|how)\b/.test(t) && mentionsBench(t)) return true;
  if (/\bhow many\b/.test(t) && /\b(models?|holograms?|things?|objects?|items?)\b/.test(t)) return true;
  if (/\bwhat\b/.test(t) && /\bdid you\b/.test(t) && /\b(build|make|create|design|construct)\b/.test(t)) {
    return true;
  }
  return false;
}

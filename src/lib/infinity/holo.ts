import type { HoloPart, HoloPartType, HoloSpec } from "./types";

/**
 * System prompt that turns the chat model into a 3D asset generator.
 * v2: `count` is emitted BEFORE `parts` so the client can compute real
 * streaming progress (each completed part object bumps the bar).
 */
export const MODEL_GEN_SYSTEM =
  "You are a 3D asset generator for a holographic workbench. " +
  "Given an object description, respond with ONLY one valid JSON object — no markdown fences, no commentary, no trailing text. " +
  'Schema (field order matters): {"name":"<short display name, 1-3 words>","count":<total number of parts>,' +
  '"parts":[{"type":"box"|"sphere"|"cylinder"|"cone"|"torus"|"capsule",' +
  '"position":[x,y,z],"rotation":[rx,ry,rz],"scale":[sx,sy,sz],"color":"#rrggbb"}]} ' +
  "Rules: count must exactly equal the number of items in parts and must appear before parts. " +
  "Build a recognizable, detailed likeness of the object using 10 to 26 primitives (48 absolute maximum). " +
  "Orient with +Y up. Keep all coordinates within -4..4. " +
  "Cylinders, cones and capsules default to height along Y. " +
  "Rotations are in radians. Use at most 2 decimal places in every number to keep the output compact. " +
  "Choose colors thoughtfully for the object. Output JSON only.";

const VALID_TYPES: HoloPartType[] = ["box", "sphere", "cylinder", "cone", "torus", "capsule"];
const MAX_PARTS = 60;

function num(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : fallback;
  return Math.max(min, Math.min(max, n));
}

function vec3(v: unknown, min: number, max: number, fallback: [number, number, number] = [0, 0, 0]) {
  if (!Array.isArray(v)) return [...fallback] as [number, number, number];
  return [
    num(v[0], fallback[0], min, max),
    num(v[1], fallback[1], min, max),
    num(v[2], fallback[2], min, max),
  ] as [number, number, number];
}

function color(v: unknown): string {
  return typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim() : "#5bb8ff";
}

function tryParse(s: string): { name?: unknown; parts?: unknown } | null {
  try {
    return JSON.parse(s) as { name?: unknown; parts?: unknown };
  } catch {
    return null;
  }
}

/** Strip markdown fences / surrounding prose and return the raw JSON candidate. */
function stripToJsonCandidate(raw: string): string {
  let t = raw.trim();
  t = t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
  const first = t.indexOf("{");
  const last = t.lastIndexOf("}");
  if (first === -1) return "";
  return last > first ? t.slice(first, last + 1) : t.slice(first);
}

/* ------------------------------------------------------------------ */
/* Incremental stream scanner — real-time progress from live tokens    */
/* ------------------------------------------------------------------ */

export interface SpecScan {
  /** Completed part objects seen so far in the stream. */
  partsSeen: number;
  /** Declared total ("count":N), once it has streamed in. */
  count: number | null;
  /** Declared model name, once it has streamed in. */
  name: string | null;
  /** Total characters received. */
  chars: number;
}

/**
 * Walks the streamed text as it grows and reports how many complete
 * part objects ({...} sitting inside the parts array, containing
 * "type" and "position") have arrived. Used for honest progress.
 */
function countCompletedParts(t: string): number {
  let depth = 0;
  let partStart = -1;
  let inStr = false;
  let esc = false;
  let n = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === "{") {
      depth++;
      if (depth === 2) partStart = i; // outer object is depth 1; parts are depth 2
    } else if (c === "}") {
      if (depth === 2 && partStart >= 0) {
        const seg = t.slice(partStart, i + 1);
        if (/"type"\s*:/.test(seg) && /"position"\s*:/.test(seg)) n++;
        partStart = -1;
      }
      depth = Math.max(0, depth - 1);
    }
  }
  return n;
}

/** Live scanner fed with provider deltas while the spec streams in. */
export function createSpecStreamScanner() {
  let text = "";
  let partsSeen = 0;
  let count: number | null = null;
  let name: string | null = null;

  return {
    feed(chunk: string) {
      text += chunk;
      if (name === null) {
        const m = text.match(/"name"\s*:\s*"((?:[^"\\]|\\.){1,32})"/);
        if (m) name = m[1];
      }
      if (count === null) {
        const m = text.match(/"count"\s*:\s*(\d{1,3})/);
        if (m) count = Math.max(1, Math.min(60, parseInt(m[1], 10)));
      }
      partsSeen = countCompletedParts(text);
    },
    get(): SpecScan {
      return { partsSeen, count, name, chars: text.length };
    },
  };
}

/* ------------------------------------------------------------------ */
/* Parsing (with repair for truncated output)                          */
/* ------------------------------------------------------------------ */

/** Cut a truncated spec at the last complete part and close the JSON. */
function repairTruncated(t: string): string {
  let depth = 0;
  let inStr = false;
  let esc = false;
  let lastPartEnd = -1;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      if (depth === 2) lastPartEnd = i + 1; // just closed a part object
      depth = Math.max(0, depth - 1);
    }
  }
  if (lastPartEnd <= 0) return "";
  return `${t.slice(0, lastPartEnd)}]}`;
}

/** Last resort: collect every individually-complete part object. */
function salvageParts(t: string): HoloPart[] {
  const out: HoloPart[] = [];
  let depth = 0;
  let start = -1;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === "{") {
      depth++;
      if (depth === 2) start = i;
    } else if (c === "}") {
      if (depth === 2 && start >= 0) {
        const seg = t.slice(start, i + 1);
        if (/"type"\s*:/.test(seg) && /"position"\s*:/.test(seg)) {
          const p = tryParse(seg) as Record<string, unknown> | null;
          if (p && VALID_TYPES.includes(p.type as HoloPartType)) {
            out.push({
              type: p.type as HoloPartType,
              position: vec3(p.position, -8, 8),
              rotation: vec3(p.rotation, -Math.PI * 2, Math.PI * 2),
              scale: vec3(p.scale, 0.02, 10, [1, 1, 1]) as [number, number, number],
              color: color(p.color),
            });
          }
        }
        start = -1;
      }
      depth = Math.max(0, depth - 1);
    }
  }
  return out;
}

/**
 * Parse + sanitize an LLM model plan into a normalized HoloSpec:
 * centered on the origin and scaled so the largest dimension ≈ 2.3 units.
 * Tolerates fences, prose, and output truncated by a token limit.
 */
export function parseHoloSpec(raw: string, fallbackName: string): HoloSpec {
  const candidate = stripToJsonCandidate(raw);

  let parsed: { name?: unknown; parts?: unknown } | null = null;
  let salvaged: HoloPart[] = [];

  if (candidate) {
    parsed = tryParse(candidate);
    if (!parsed) parsed = tryParse(repairTruncated(candidate));
    if (!parsed) salvaged = salvageParts(candidate);
  } else {
    salvaged = salvageParts(raw);
  }

  let name = "";
  let rawParts: unknown[] = [];

  if (parsed && Array.isArray(parsed.parts)) {
    name = typeof parsed.name === "string" && parsed.name.trim() ? parsed.name.trim() : fallbackName;
    rawParts = parsed.parts;
  } else if (salvaged.length > 0) {
    const m = raw.match(/"name"\s*:\s*"((?:[^"\\]|\\.){1,32})"/);
    name = m ? m[1] : fallbackName;
    rawParts = salvaged;
  } else {
    throw new Error("The model plan came back incomplete — try building it again.");
  }

  name = name.replace(/[".#]/g, "").slice(0, 32);

  const parts: HoloPart[] = [];
  for (const p of rawParts.slice(0, MAX_PARTS)) {
    if (!p || typeof p !== "object") continue;
    const obj = p as Record<string, unknown>;
    const type = VALID_TYPES.includes(obj.type as HoloPartType)
      ? (obj.type as HoloPartType)
      : "box";
    parts.push({
      type,
      position: vec3(obj.position, -8, 8),
      rotation: vec3(obj.rotation, -Math.PI * 2, Math.PI * 2),
      scale: vec3(obj.scale, 0.02, 10, [1, 1, 1]).map((n) =>
        Math.max(0.02, n)
      ) as [number, number, number],
      color: color(obj.color),
    });
  }
  if (parts.length === 0) throw new Error("The model plan had no usable parts.");

  // --- normalize: center + uniform fit --------------------------------------
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const p of parts) {
    const [x, y, z] = p.position;
    const [sx, sy, sz] = p.scale;
    minX = Math.min(minX, x - sx); maxX = Math.max(maxX, x + sx);
    minY = Math.min(minY, y - sy); maxY = Math.max(maxY, y + sy);
    minZ = Math.min(minZ, z - sz); maxZ = Math.max(maxZ, z + sz);
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const cz = (minZ + maxZ) / 2;
  const maxDim = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 0.001);
  const fit = 2.3 / maxDim;

  return {
    name,
    parts: parts.map((p) => ({
      ...p,
      position: [
        (p.position[0] - cx) * fit,
        (p.position[1] - cy) * fit,
        (p.position[2] - cz) * fit,
      ] as [number, number, number],
      scale: [p.scale[0] * fit, p.scale[1] * fit, p.scale[2] * fit] as [number, number, number],
    })),
  };
}

/** Placement slots for new models (screen percentages, center-anchored). */
export function nextSlot(count: number): { x: number; y: number } {
  const slots = [
    { x: 50, y: 46 },
    { x: 24, y: 34 },
    { x: 76, y: 34 },
    { x: 24, y: 66 },
    { x: 76, y: 66 },
    { x: 50, y: 80 },
    { x: 50, y: 16 },
    { x: 12, y: 50 },
  ];
  return slots[count % slots.length];
}

export const MAX_MODELS = 8;

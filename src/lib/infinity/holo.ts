import type { HoloPart, HoloPartType, HoloSpec } from "./types";

/** System prompt that turns the chat model into a 3D asset generator. */
export const MODEL_GEN_SYSTEM =
  "You are a 3D asset generator for a holographic workbench. " +
  "Given an object description, respond with ONLY one valid JSON object — no markdown fences, no commentary. " +
  'Schema: {"name":"<short display name, 1-3 words>","parts":[{"type":"box"|"sphere"|"cylinder"|"cone"|"torus"|"capsule",' +
  '"position":[x,y,z],"rotation":[rx,ry,rz],"scale":[sx,sy,sz],"color":"#rrggbb"}]} ' +
  "Rules: build a recognizable, detailed likeness of the object using at most 48 primitives. " +
  "Orient with +Y up. Keep all coordinates within -4..4. " +
  "Cylinders, cones and capsules default to height along Y. " +
  "Rotations are in radians. Choose colors thoughtfully for the object. Output JSON only.";

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

/** Extract the outermost JSON object from an LLM reply (strips fences/prose). */
function extractJson(raw: string): unknown {
  let t = raw.trim();
  t = t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
  const first = t.indexOf("{");
  const last = t.lastIndexOf("}");
  if (first === -1 || last <= first) throw new Error("No JSON object in the model plan.");
  return JSON.parse(t.slice(first, last + 1));
}

/**
 * Parse + sanitize an LLM model plan into a normalized HoloSpec:
 * centered on the origin and scaled so the largest dimension ≈ 2.3 units.
 */
export function parseHoloSpec(raw: string, fallbackName: string): HoloSpec {
  const parsed = extractJson(raw) as {
    name?: unknown;
    parts?: unknown;
  };

  let name =
    typeof parsed.name === "string" && parsed.name.trim() ? parsed.name.trim() : fallbackName;
  name = name.replace(/[".#]/g, "").slice(0, 32);

  const rawParts = Array.isArray(parsed.parts) ? parsed.parts : [];
  if (rawParts.length === 0) throw new Error("The model plan had no parts.");

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

/**
 * Infinity — AI hologram design.
 *
 * The user can ask for ANY object in the world. When an API key is
 * configured, the model is DESIGNED by the user's LLM as a compact,
 * line-oriented part list (one part per line — trivially streamable and
 * salvageable: every complete line is a usable part), then normalized into
 * the same HoloSpec the local builders produce. Specs are cached so the
 * same ask always rebuilds the identical model, instantly.
 */
import { normalizeHoloSpec } from "./holo";
import type { HoloPart, HoloPartType, HoloSpec } from "./types";

/* ------------------------------------------------------------------ */
/* The design prompt                                                    */
/* ------------------------------------------------------------------ */

export const DESIGN_SYSTEM = `You design holographic 3D models as lists of simple parts. Reply with ONLY the part list — no intro, no markdown, no code fences, no explanation.

FIRST LINE: NAME = <short display name>
Then one line per part, pipe-separated:
type | x y z | size | rx ry rz | #hexcolor

Types and what "size" means for each:
- box — width height depth (full dimensions)
- sphere — diameter
- cylinder — diameter height
- cone — diameter height
- torus — ring outer diameter (stands upright; rotate x by 1.57 to lay it flat)
- capsule — diameter height (rounded ends; good for limbs and handles)

x y z is the part CENTER position. rx ry rz is rotation in radians (usually 0 0 0). Colors are hex like #8b5a2b.

Rules:
- Use 8 to 16 parts TOTAL — never more than 16, no matter how complex the object. Count your lines before answering. Prefer fewer, larger parts over many tiny ones (railings, windows, teeth: suggest them with 1-2 parts, not many).
- Capture the object's real shape, proportions, and true-to-life colors.
- Capture the 3D SILHOUETTE: vary part sizes and positions to trace the object's outline (animals have bodies and limbs, vehicles have wheels). Tall objects taper GRADUALLY — the top stays at least a quarter of the base width; use a cone for pointed tips instead of shrinking boxes to nothing. No dimension below 0.05.
- Most parts should be between 0.2 and 2 units in size.
- Parts must connect with no floating gaps; symmetric parts go in symmetric positions.
- Order the parts bottom-to-top so the model assembles nicely.

Example — a wooden chair:
NAME = Chair
box | 0 0.9 0 | 1.4 0.16 1.4 | 0 0 0 | #b07a45
box | -0.55 0.41 -0.55 | 0.18 0.82 0.18 | 0 0 0 | #8b5a2b
box | 0.55 0.41 -0.55 | 0.18 0.82 0.18 | 0 0 0 | #8b5a2b
box | -0.55 0.41 0.55 | 0.18 0.82 0.18 | 0 0 0 | #8b5a2b
box | 0.55 0.41 0.55 | 0.18 0.82 0.18 | 0 0 0 | #8b5a2b
box | -0.55 1.44 -0.62 | 0.16 0.92 0.16 | 0 0 0 | #8b5a2b
box | 0.55 1.44 -0.62 | 0.16 0.92 0.16 | 0 0 0 | #8b5a2b
box | 0 1.25 -0.62 | 1.26 0.18 0.14 | 0 0 0 | #b07a45
box | 0 1.72 -0.62 | 1.26 0.18 0.14 | 0 0 0 | #b07a45

Example — a coffee mug:
NAME = Coffee Mug
cylinder | 0 0.5 0 | 0.9 1.0 | 0 0 0 | #f2efe9
cylinder | 0 1.03 0 | 0.78 0.06 | 0 0 0 | #5a3b28
torus | 0.62 0.5 0 | 0.5 | 0 0 0 | #f2efe9

Example — a pine tree (cones taper to the tip; never shrink boxes to nothing):
NAME = Pine Tree
cylinder | 0 0.3 0 | 0.24 0.6 | 0 0 0 | #6b4423
cone | 0 0.95 0 | 1.1 0.9 | 0 0 0 | #2e7d46
cone | 0 1.45 0 | 0.85 0.8 | 0 0 0 | #2e7d46
cone | 0 1.9 0 | 0.6 0.7 | 0 0 0 | #35a05a
cone | 0 2.3 0 | 0.38 0.6 | 0 0 0 | #35a05a`;

/* ------------------------------------------------------------------ */
/* Parsing                                                              */
/* ------------------------------------------------------------------ */

const PART_TYPES: readonly HoloPartType[] = ["box", "sphere", "cylinder", "cone", "torus", "capsule"];

const DEFAULT_COLOR = "#7dd3fc";

/** Geometry multipliers: model-space scale = (user size) / DIV per axis,
 * where "user size" is the intuitive full dimension from the LLM.
 * Parts with any dimension < 0.03 are degenerate (LLM taper artifacts) —
 * rejected by the caller. */
function sizeToScale(type: HoloPartType, n: number[]): [number, number, number] | null {
  const g = (i: number, d: number) => {
    const v = n[i];
    return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.min(6, v) / d : d === 1 ? 1 : 0.5;
  };
  let scale: [number, number, number];
  switch (type) {
    case "sphere":
      scale = [g(0, 2), g(0, 2), g(0, 2)];
      break;
    case "cylinder":
    case "cone":
      scale = [g(0, 2), g(1, 2), g(0, 2)];
      break;
    case "torus":
      scale = [g(0, 2.8), g(0, 2.8), g(0, 2.8)];
      break;
    case "capsule":
      scale = [g(0, 1.4), g(1, 2.6), g(0, 1.4)];
      break;
    case "box":
    default:
      scale = [g(0, 2), g(1, 2), g(2, 2)];
      break;
  }
  if (scale.some((v) => !Number.isFinite(v) || v <= 0)) return null;
  return scale;
}

function nums(s: string): number[] {
  const out: number[] = [];
  const re = /-?\d+(?:\.\d+)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out.push(parseFloat(m[0]));
  return out;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Does this look like a part line? (used to count parts while streaming) */
export function isPartLine(line: string): boolean {
  const t = line.split("|")[0]?.trim().toLowerCase() ?? "";
  return PART_TYPES.includes(t as HoloPartType) && line.includes("|");
}

/** Parse a complete line into a part, or null if it isn't one. */
function parsePartLine(line: string): HoloPart | null {
  const seg = line.split("|");
  if (seg.length < 3) return null;
  const type = seg[0].trim().toLowerCase() as HoloPartType;
  if (!PART_TYPES.includes(type)) return null;

  const p = nums(seg[1] ?? "");
  const s = nums(seg[2] ?? "");
  const r = seg.length > 3 ? nums(seg[3] ?? "") : [];

  const scale = sizeToScale(type, s);
  if (!scale) return null;
  // Reject degenerate taper artifacts (dimensions that collapsed to ~0).
  const dims: Record<HoloPartType, number[]> = {
    box: s,
    sphere: [s[0], s[0], s[0]],
    cylinder: [s[0], s[1], s[0]],
    cone: [s[0], s[1], s[0]],
    torus: [s[0]],
    capsule: [s[0], s[1], s[0]],
  };
  if ((dims[type] ?? []).some((v) => typeof v === "number" && Number.isFinite(v) && v < 0.03)) {
    return null;
  }

  const colorSeg = seg[seg.length - 1]?.trim() ?? "";
  const color = /^#[0-9a-f]{6}$/i.test(colorSeg) ? colorSeg.toLowerCase() : DEFAULT_COLOR;

  return {
    type,
    position: [
      clamp(p[0] ?? 0, -6, 6),
      clamp(p[1] ?? 0, -6, 6),
      clamp(p[2] ?? 0, -6, 6),
    ],
    rotation: [
      clamp(r[0] ?? 0, -6.28, 6.28),
      clamp(r[1] ?? 0, -6.28, 6.28),
      clamp(r[2] ?? 0, -6.28, 6.28),
    ],
    scale,
    color,
  };
}

export interface ParsedDesign {
  name: string;
  parts: HoloPart[];
}

/**
 * Tolerant parser for the LLM's design text. Strips fences, skips junk
 * lines, keeps every line that parses — so a stream that died mid-output
 * still yields its completed parts (salvage).
 */
export function parseDesignText(text: string): ParsedDesign | null {
  let t = text.trim();
  // strip markdown fences if the model added them anyway
  t = t.replace(/^```[a-z]*\s*/i, "").replace(/```\s*$/, "");
  const lines = t.split(/\r?\n/);

  let name = "";
  const parts: HoloPart[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const nameMatch = /^name\s*[:=]\s*(.+)$/i.exec(line);
    if (nameMatch) {
      if (!name) name = nameMatch[1].trim().slice(0, 40);
      continue;
    }
    if (line.startsWith("#") || line.startsWith("//")) continue;
    const part = parsePartLine(line);
    if (part) parts.push(part);
    if (parts.length >= 24) break;
  }

  if (parts.length < 3) return null;
  return {
    name: name || "Hologram",
    parts,
  };
}

/** Turn parsed design text into a normalized, render-ready spec.
 * Rejects degenerate silhouettes (needles/pancakes — LLM artifacts like a
 * "tower" collapsed into a thin pole) so the caller can fall back to the
 * local builders, which handle common objects better. */
export function designTextToSpec(text: string, fallbackName: string): HoloSpec | null {
  const parsed = parseDesignText(text);
  if (!parsed) return null;
  if (isDegenerateSpec(parsed.parts)) return null;
  return normalizeHoloSpec(parsed.name || fallbackName, parsed.parts);
}

/** True when two of the three bbox dimensions collapsed (< 5% of the
 * largest) — the model would render as a needle or a flat line. */
export function isDegenerateSpec(parts: HoloPart[]): boolean {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const p of parts) {
    const [x, y, z] = p.position;
    const [sx, sy, sz] = p.scale;
    minX = Math.min(minX, x - sx); maxX = Math.max(maxX, x + sx);
    minY = Math.min(minY, y - sy); maxY = Math.max(maxY, y + sy);
    minZ = Math.min(minZ, z - sz); maxZ = Math.max(maxZ, z + sz);
  }
  const dims = [maxX - minX, maxY - minY, maxZ - minZ];
  const max = Math.max(...dims);
  if (max <= 0.001) return true;
  const tiny = dims.filter((d) => d / max < 0.05).length;
  return tiny >= 2;
}

/* ------------------------------------------------------------------ */
/* Streaming scanner — real progress while the LLM designs              */
/* ------------------------------------------------------------------ */

/**
 * Feed deltas; emits each complete line as it arrives (used to count
 * designed parts in real time).
 */
export function createDesignScanner(onLine: (line: string) => void): (delta: string) => void {
  let buf = "";
  return (delta: string) => {
    buf += delta;
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) onLine(line);
    }
  };
}

/* ------------------------------------------------------------------ */
/* Spec cache — same ask → same model, instantly                        */
/* ------------------------------------------------------------------ */

const CACHE_KEY = "infinity-holo-specs";
const CACHE_MAX = 48;

interface CacheShape {
  [objectKey: string]: { spec: HoloSpec; at: number };
}

function readCache(): CacheShape {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as CacheShape;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function cacheGetSpec(object: string): HoloSpec | null {
  if (typeof window === "undefined") return null;
  const hit = readCache()[object.trim().toLowerCase()];
  return hit ? hit.spec : null;
}

export function cachePutSpec(object: string, spec: HoloSpec): void {
  if (typeof window === "undefined") return;
  try {
    const cache = readCache();
    cache[object.trim().toLowerCase()] = { spec, at: Date.now() };
    const keys = Object.keys(cache);
    if (keys.length > CACHE_MAX) {
      keys
        .sort((a, b) => cache[a].at - cache[b].at)
        .slice(0, keys.length - CACHE_MAX)
        .forEach((k) => delete cache[k]);
    }
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* storage full/broken — cache is best-effort */
  }
}

/* ------------------------------------------------------------------ */
/* The streaming design call                                            */
/* ------------------------------------------------------------------ */

export interface DesignProgress {
  /** "thinking" — provider is reasoning before output. */
  phase: "thinking" | "designing";
  /** Completed part lines received so far. */
  partsDesigned: number;
  /** Rough progress target 0..0.45 while designing. */
  progress: number;
}

/**
 * Ask the configured provider to DESIGN the object via /api/model.
 * Streams NDJSON; every complete part line updates progress; if the
 * connection dies mid-stream, whatever lines already arrived are
 * salvaged into a spec instead of failing.
 */
export async function designHoloSpec(opts: {
  object: string;
  provider: string;
  apiKey: string;
  baseUrl?: string;
  model: string;
  onProgress?: (p: DesignProgress) => void;
  signal?: AbortSignal;
}): Promise<{ spec: HoloSpec; salvaged: boolean } | null> {
  const { object, provider, apiKey, baseUrl, model, onProgress, signal } = opts;

  const res = await fetch("/api/model", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      provider,
      apiKey: apiKey.trim(),
      baseUrl: baseUrl?.trim() || undefined,
      model: model.trim(),
      object: object.trim().slice(0, 120),
    }),
  });

  if (!res.ok || !res.body) {
    // Pre-stream validation error — plain JSON body.
    let msg = `The design service failed (${res.status}).`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data?.error) msg = data.error;
    } catch {
      /* keep generic */
    }
    throw new Error(msg);
  }

  let full = "";
  let partsDesigned = 0;
  const scan = createDesignScanner((line) => {
    if (isPartLine(line)) {
      partsDesigned++;
      onProgress?.({
        phase: "designing",
        partsDesigned,
        progress: Math.min(0.45, 0.1 + 0.35 * Math.min(1, partsDesigned / 10)),
      });
    }
  });

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let sawDone = false;
  let streamError: string | null = null;

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
            scan(ev.v);
          } else if (ev.t === "phase") {
            onProgress?.({ phase: "thinking", partsDesigned, progress: 0.08 });
          } else if (ev.t === "done") {
            sawDone = true;
          } else if (ev.t === "error") {
            streamError = typeof ev.v === "string" ? ev.v : "The design stream failed.";
          }
          // open/ping — ignore
        } catch {
          /* partial line — ignore */
        }
      }
    }
  } catch {
    // Connection dropped mid-stream — salvage what arrived below.
    streamError = streamError ?? "The connection was interrupted.";
  }

  // Prefer a full parse; otherwise salvage completed lines.
  const spec = designTextToSpec(full, object);
  if (spec && sawDone) return { spec, salvaged: false };
  if (spec) return { spec, salvaged: true }; // partial text, still enough parts
  if (streamError) throw new Error(streamError);
  return null; // completed but unparseable — caller falls back
}

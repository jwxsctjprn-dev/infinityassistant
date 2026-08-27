import type { HoloPart, HoloSpec } from "./types";

/**
 * Infinity — hologram spec math.
 *
 * Models are built from three.js primitives (see holo-library.ts for the
 * hand-authored catalog and holo-generator.ts for procedural generation).
 * Everything is normalized here so any spec renders centered and sized
 * consistently on the workbench.
 */

/** Center on the origin and scale so the largest dimension ≈ 2.3 units. */
export function normalizeHoloSpec(name: string, parts: HoloPart[]): HoloSpec {
  if (parts.length === 0) throw new Error("A model needs at least one part.");

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

/**
 * The 3D canvas mounts this long after a model card appears — the card's
 * framer-motion spawn animation must finish first, because R3F sizes its
 * canvas with a transform-aware measurement (see holo-model-mesh.tsx).
 * The build progress bar and part-assembly stay synced to this delay.
 */
export const SPAWN_SETTLE_MS = 520;

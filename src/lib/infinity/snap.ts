/**
 * Infinity — magnetic faces: 3D face-to-face snapping for the workbench.
 *
 * Every hologram's bounds form an oriented box in 3D (holo-model-mesh
 * projects its true silhouette for the overlay frame). Here that same box's
 * six faces are projected to screen-space quads, and models snap
 * FACE-TO-FACE: drag a block toward another and entire faces pull flush —
 * a cube set on a slab lands with its whole bottom face on the slab's whole
 * top face, like real building blocks. There is no border or edge
 * alignment; the glowing seam IS the shared face.
 *
 * The camera math mirrors holo-model-mesh.tsx exactly (fov 38 vertical,
 * square 3×-card canvas, eye at (0, 1.77, 11.65) aimed at the origin), so
 * everything computed here lands pixel-perfect on the rendered holograms.
 */
import * as THREE from "three";
import type { HoloModel, HoloPart, HoloSpec } from "./types";

/* ------------------------- camera (mirrors the mesh) ------------------------- */

const CAM_EYE = new THREE.Vector3(0, 1.77, 11.65);
const TAN_HALF_FOV = Math.tan(((38 / 2) * Math.PI) / 180);
const CAM_Z = CAM_EYE.clone().normalize();
const CAM_X = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), CAM_Z).normalize();
const CAM_Y = new THREE.Vector3().crossVectors(CAM_Z, CAM_X);

export interface Pt {
  x: number;
  y: number;
}

/** A model canvas rect in screen px (the visual 3× card, center + size). */
export interface CanvasRect {
  cx: number;
  cy: number;
  w: number;
  h: number;
}

/** World offset (relative to a model's center) → screen px + view depth. */
export function projectWorld(rect: CanvasRect, p: THREE.Vector3): Pt & { depth: number } {
  const vx = p.x - CAM_EYE.x;
  const vy = p.y - CAM_EYE.y;
  const vz = p.z - CAM_EYE.z;
  // The camera looks down −Z_view, so depth in front = −z_view.
  const depth = Math.max(0.05, -(vx * CAM_Z.x + vy * CAM_Z.y + vz * CAM_Z.z));
  const ndcX = (vx * CAM_X.x + vy * CAM_X.y + vz * CAM_X.z) / (depth * TAN_HALF_FOV);
  const ndcY = (vx * CAM_Y.x + vy * CAM_Y.y + vz * CAM_Y.z) / (depth * TAN_HALF_FOV);
  return { x: rect.cx + (ndcX * rect.w) / 2, y: rect.cy - (ndcY * rect.h) / 2, depth };
}

/* ------------------------------ local AABB ------------------------------ */

/** Half extents of each unit geometry BEFORE part.scale is applied
 *  (must stay in sync with holo-model-mesh.tsx). */
const UNIT_HALF: Record<string, readonly [number, number, number]> = {
  box: [1, 1, 1],
  sphere: [1, 1, 1],
  cylinder: [1, 1, 1],
  cone: [1, 1, 1],
  torus: [1.4, 1.4, 0.4],
  capsule: [0.7, 1.3, 0.7],
};

const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();

/** Axis-aligned bounds of the whole spec in model space — the oriented box
 *  whose six faces do the snapping. */
function specAABB(spec: HoloSpec): { c: [number, number, number]; h: [number, number, number] } {
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  for (const part of spec.parts) {
    const h = UNIT_HALF[part.type] ?? [1, 1, 1];
    _e.set(part.rotation[0], part.rotation[1], part.rotation[2]);
    _q.setFromEuler(_e);
    for (let i = 0; i < 8; i++) {
      _v
        .set(
          (i & 1 ? h[0] : -h[0]) * Math.abs(part.scale[0]),
          (i & 2 ? h[1] : -h[1]) * Math.abs(part.scale[1]),
          (i & 4 ? h[2] : -h[2]) * Math.abs(part.scale[2])
        )
        .applyQuaternion(_q);
      const x = _v.x + part.position[0];
      const y = _v.y + part.position[1];
      const z = _v.z + part.position[2];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
  }
  if (!isFinite(minX)) return { c: [0, 0, 0], h: [0.5, 0.5, 0.5] };
  return {
    c: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2],
    h: [(maxX - minX) / 2, (maxY - minY) / 2, (maxZ - minZ) / 2],
  };
}

/* ------------------------------ face quads ------------------------------ */

/**
 * Face index convention: 0 = +X, 1 = −X, 2 = +Y, 3 = −Y, 4 = +Z, 5 = −Z.
 * Faces i and i^1 are opposing.
 */
export const faceAxis = (idx: number) => idx >> 1;
export const faceSign = (idx: number) => ((idx & 1) === 0 ? 1 : -1);

const COMBOS: ReadonlyArray<readonly [number, number]> = [
  [1, 1],
  [1, -1],
  [-1, -1],
  [-1, 1],
];

/** The two in-plane axes of a face's plane, in (u, v) order. */
const LATERAL: ReadonlyArray<readonly [number, number]> = [
  [1, 2],
  [0, 2],
  [0, 1],
];

/** One box face projected to screen px. */
export interface FaceQuad {
  idx: number;
  pts: [Pt, Pt, Pt, Pt];
  center: Pt;
  /** Average view distance — smaller means closer to the camera. */
  depth: number;
}

export interface ModelFaces {
  faces: FaceQuad[];
}

/** Project all six faces of a model's oriented bounding box to screen px. */
export function facesForCanvasRect(
  spec: HoloSpec,
  rot: { x: number; y: number },
  scale: number,
  rect: CanvasRect
): ModelFaces {
  const aabb = specAABB(spec);
  _e.set(rot.x, rot.y, 0);
  _q.setFromEuler(_e);
  const faces: FaceQuad[] = [];
  for (let idx = 0; idx < 6; idx++) {
    const a = faceAxis(idx);
    const s = faceSign(idx);
    const [u, v] = LATERAL[a];
    const pts = [] as unknown as [Pt, Pt, Pt, Pt];
    let cx = 0;
    let cy = 0;
    let depth = 0;
    for (const [su, sv] of COMBOS) {
      const local = [aabb.c[0], aabb.c[1], aabb.c[2]];
      local[a] += s * aabb.h[a];
      local[u] += su * aabb.h[u];
      local[v] += sv * aabb.h[v];
      const pr = projectWorld(
        rect,
        _v.set(local[0], local[1], local[2]).multiplyScalar(scale).applyQuaternion(_q)
      );
      pts.push({ x: pr.x, y: pr.y });
      cx += pr.x;
      cy += pr.y;
      depth += pr.depth;
    }
    faces.push({ idx, pts, center: { x: cx / 4, y: cy / 4 }, depth: depth / 4 });
  }
  return { faces };
}

/** Visual canvas rect of a mounted model (transform-aware — focus/spawn
 *  scales are included), or null while the mesh is not mounted yet. */
export function modelCanvasRect(id: string): CanvasRect | null {
  if (typeof document === "undefined") return null;
  const r = document.querySelector(`[data-model-id="${id}"] canvas`)?.getBoundingClientRect();
  if (!r || r.width < 8 || r.height < 8) return null;
  return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height };
}

/** Faces of a mounted, live model (null when its mesh is not ready). */
export function facesForModel(m: HoloModel): ModelFaces | null {
  const rect = modelCanvasRect(m.id);
  return rect ? facesForCanvasRect(m.spec, m.rot, m.scale ?? 1, rect) : null;
}

/** Faces for a block that does not exist yet — centered at `center` with a
 *  hypothetical canvas of `canvasSize` px (3 × the bench card). */
export function facesAtCenter(
  spec: HoloSpec,
  rot: { x: number; y: number },
  scale: number,
  center: Pt,
  canvasSize: number
): ModelFaces {
  return facesForCanvasRect(spec, rot, scale, {
    cx: center.x,
    cy: center.y,
    w: canvasSize,
    h: canvasSize,
  });
}

/** Models whose faces can be snapped to right now. */
export function snapEligible(m: HoloModel): boolean {
  return !m.pending && !m.spin && !m.exploded;
}

/** Live face quads of every eligible neighbour (DOM read, one-shot). */
export function snapTargets(
  models: ReadonlyArray<HoloModel>
): Array<{ id: string; faces: ModelFaces }> {
  const out: Array<{ id: string; faces: ModelFaces }> = [];
  for (const m of models) {
    if (!snapEligible(m)) continue;
    const faces = facesForModel(m);
    if (faces) out.push({ id: m.id, faces });
  }
  return out;
}

/* --------------------------- convex polygon math --------------------------- */

function signedArea(pts: ReadonlyArray<Pt>): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    s += p.x * q.y - q.x * p.y;
  }
  return s / 2;
}

function polygonArea(pts: ReadonlyArray<Pt>): number {
  return Math.abs(signedArea(pts));
}

function pointInQuad(pts: ReadonlyArray<Pt>, p: Pt): boolean {
  let pos = 0;
  let neg = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (cross > 0) pos++;
    else if (cross < 0) neg++;
  }
  return pos === 0 || neg === 0;
}

function lineIntersect(a: Pt, b: Pt, c: Pt, d: Pt): Pt {
  const d1x = b.x - a.x;
  const d1y = b.y - a.y;
  const d2x = d.x - c.x;
  const d2y = d.y - c.y;
  const den = d1x * d2y - d1y * d2x;
  if (Math.abs(den) < 1e-9) return { x: b.x, y: b.y };
  const t = ((c.x - a.x) * d2y - (c.y - a.y) * d2x) / den;
  return { x: a.x + t * d1x, y: a.y + t * d1y };
}

/** Intersection area of two convex quads (Sutherland–Hodgman). */
function overlapArea(p1: ReadonlyArray<Pt>, p2Raw: ReadonlyArray<Pt>): number {
  if (p1.length < 3 || p2Raw.length < 3) return 0;
  const p2 = signedArea(p2Raw) < 0 ? [...p2Raw].reverse() : p2Raw;
  let out: Pt[] = p1 as Pt[];
  for (let i = 0; i < p2.length; i++) {
    const a = p2[i];
    const b = p2[(i + 1) % p2.length];
    const input = out;
    out = [];
    if (input.length === 0) break;
    const side = (p: Pt) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    for (let j = 0; j < input.length; j++) {
      const cur = input[j];
      const nxt = input[(j + 1) % input.length];
      const sc = side(cur);
      const sn = side(nxt);
      if (sc >= 0) {
        out.push(cur);
        if (sn < 0) out.push(lineIntersect(cur, nxt, a, b));
      } else if (sn >= 0) {
        out.push(lineIntersect(cur, nxt, a, b));
      }
    }
  }
  return out.length >= 3 ? polygonArea(out) : 0;
}

/** The face of `faces` whose projected quad contains p (nearest to the
 *  camera wins when several tile over the point); falls back to the face
 *  with the nearest center. */
export function faceAtPoint(faces: ModelFaces, p: Pt): number {
  let inside = -1;
  let insideDepth = Infinity;
  let near = -1;
  let nearD = Infinity;
  for (const f of faces.faces) {
    if (pointInQuad(f.pts, p) && f.depth < insideDepth) {
      insideDepth = f.depth;
      inside = f.idx;
    }
    const dd = Math.hypot(f.center.x - p.x, f.center.y - p.y);
    if (dd < nearD) {
      nearD = dd;
      near = f.idx;
    }
  }
  return inside >= 0 ? inside : near;
}

/* ------------------------------ face snapping ------------------------------ */

/** The correction that makes one of my faces land flush on a neighbour's
 *  opposing face — plus the shared face quad (the seam). */
export interface FaceSnap {
  dx: number;
  dy: number;
  /** My face index. */
  face: number;
  /** The neighbour's opposing face index. */
  targetFace: number;
  targetId: string;
  /** The neighbour's face quad in screen px — where the seam glows. */
  seam: [Pt, Pt, Pt, Pt];
}

/**
 * Best face-to-face snap for the dragged model. `mine` was computed at drag
 * start; `delta` is the intended screen translation since. A pair is
 * eligible when the face centers are nearly flush (≤ threshold) OR the
 * projected faces overlap substantially (the lego drop — bring a block over
 * a face at roughly the right height and it clicks into place). The snap
 * always aligns the face CENTERS, so flush contact is exact for equal
 * rotations and centered otherwise.
 */
export function snapFaces(
  mine: ModelFaces,
  delta: Pt,
  targets: ReadonlyArray<{ id: string; faces: ModelFaces }>,
  threshold = 42
): FaceSnap | null {
  let best: FaceSnap | null = null;
  let bestScore = Infinity;
  for (const t of targets) {
    for (let i = 0; i < 6; i++) {
      const a = mine.faces[i];
      const b = t.faces.faces[i ^ 1];
      const ax = a.center.x + delta.x;
      const ay = a.center.y + delta.y;
      const d = Math.hypot(ax - b.center.x, ay - b.center.y);
      // Building upward is the common intent — the bottom-on-top magnet
      // reaches further, so drawing or dropping over a stack lands ON it.
      const thr = i === 3 ? threshold * 2.1 : threshold;
      if (d > thr) {
        // Lego drop: overlapping face quads at the right height.
        if (d > 160) continue;
        const shifted = a.pts.map((p) => ({ x: p.x + delta.x, y: p.y + delta.y }));
        const minArea = Math.min(polygonArea(shifted), polygonArea(b.pts));
        if (minArea < 200) continue;
        if (overlapArea(shifted, b.pts) / minArea < 0.22) continue;
      }
      const dx = b.center.x - ax;
      const dy = b.center.y - ay;
      const slide = Math.abs(dx) + Math.abs(dy);
      if (slide > 140) continue; // never yank a model across the bench
      // Class first, distance second: ANY eligible bottom-on-top candidate
      // beats every other pair — building upward is the intent. Then
      // tucking under, then the sides.
      const prio = i === 3 ? 0 : i === 2 ? 1 : 2;
      const score = prio * 1000 + d * 2 + slide * 0.3;
      if (score < bestScore) {
        bestScore = score;
        best = { dx, dy, face: i, targetFace: i ^ 1, targetId: t.id, seam: b.pts };
      }
    }
  }
  return best;
}

/* ------------------------- building on a face (lego) ------------------------- */

export const MIN_EXTRUDE = 0.45;
export const MAX_EXTRUDE = 3.4;

/** Everything needed to grow a new block out of one face of a model. */
export interface ExtrudeCtx {
  /** The parent's face being built on. */
  face: number;
  /** Where the second tap landed (screen px) — extrusion is measured from here. */
  anchor: Pt;
  /** Unit screen direction the face points. */
  dir: Pt;
  /** Screen px per world unit along the normal, at the face. */
  ppu: number;
  /** The parent's canvas rect — projections for ghost + commit. */
  rect: CanvasRect;
  /** The parent's face quad — highlighted while building. */
  faceQuad: [Pt, Pt, Pt, Pt];
  attachWorld: THREE.Vector3;
  nWorld: THREE.Vector3;
  uWorld: THREE.Vector3;
  vWorld: THREE.Vector3;
  /** Lateral world half extents of the face (the new block's footprint). */
  eU: number;
  eV: number;
  /** Face plane offset along its axis in parent-local units × parent scale. */
  faceOffset: number;
  scale: number;
  rot: { x: number; y: number };
}

/** Prepares extrusion from `face` of a model (null when the face is
 *  edge-on to the camera and cannot be grown from). `anchor` is where the
 *  second tap landed — the extrusion length is measured from there. */
export function extrudeContext(
  spec: HoloSpec,
  rot: { x: number; y: number },
  scale: number,
  rect: CanvasRect,
  face: number,
  anchor: Pt
): ExtrudeCtx | null {
  const aabb = specAABB(spec);
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rot.x, rot.y, 0, "XYZ"));
  const a = faceAxis(face);
  const s = faceSign(face);
  const [u, v] = LATERAL[a];

  const f = [aabb.c[0], aabb.c[1], aabb.c[2]];
  f[a] += s * aabb.h[a];
  const attachWorld = new THREE.Vector3(f[0], f[1], f[2]).multiplyScalar(scale).applyQuaternion(q);
  const fc0 = projectWorld(rect, attachWorld);

  const axisVec = (axis: number, sign: number) => {
    const e = [0, 0, 0];
    e[axis] = sign;
    return new THREE.Vector3(e[0], e[1], e[2]).applyQuaternion(q);
  };
  const nWorld = axisVec(a, s);
  const uWorld = axisVec(u, 1);
  const vWorld = axisVec(v, 1);

  const p1 = projectWorld(rect, attachWorld.clone().add(nWorld));
  const ppu = Math.hypot(p1.x - fc0.x, p1.y - fc0.y);
  if (ppu < 6) return null;
  const dir = { x: (p1.x - fc0.x) / ppu, y: (p1.y - fc0.y) / ppu };

  const faceQuad = facesForCanvasRect(spec, rot, scale, rect).faces[face].pts;

  return {
    face,
    anchor: { x: anchor.x, y: anchor.y },
    dir,
    ppu,
    rect,
    faceQuad,
    attachWorld,
    nWorld,
    uWorld,
    vWorld,
    eU: aabb.h[u] * scale,
    eV: aabb.h[v] * scale,
    faceOffset: s * aabb.h[a] * scale,
    scale,
    rot,
  };
}

/** Extrusion length (world units) for the current pointer position. */
export function extrudeLength(ctx: ExtrudeCtx, pointer: Pt): number {
  const along =
    (pointer.x - ctx.anchor.x) * ctx.dir.x + (pointer.y - ctx.anchor.y) * ctx.dir.y;
  return Math.max(MIN_EXTRUDE, Math.min(MAX_EXTRUDE, along / ctx.ppu));
}

/** The growing block's ghost — six face quads sorted far → near, plus the
 *  face touching the parent and the far face's center (label anchor). */
export interface ExtrudePreview {
  quads: Array<{ pts: Pt[]; depth: number }>;
  attach: Pt[];
  outer: Pt;
}

export function extrudePreview(ctx: ExtrudeCtx, L: number): ExtrudePreview {
  const center = ctx.attachWorld.clone().add(ctx.nWorld.clone().multiplyScalar(L / 2));
  const corners: Array<{ pr: Pt & { depth: number }; bits: number }> = [];
  for (let i = 0; i < 8; i++) {
    const p = center
      .clone()
      .add(ctx.uWorld.clone().multiplyScalar((i & 1 ? 1 : -1) * ctx.eU))
      .add(ctx.vWorld.clone().multiplyScalar((i & 2 ? 1 : -1) * ctx.eV))
      .add(ctx.nWorld.clone().multiplyScalar((i & 4 ? 1 : -1) * (L / 2)));
    corners.push({ pr: projectWorld(ctx.rect, p), bits: i });
  }
  const at = (su: number, sv: number, sn: number) =>
    corners[(su > 0 ? 1 : 0) | (sv > 0 ? 2 : 0) | (sn > 0 ? 4 : 0)].pr;

  const quads: Array<{ pts: Pt[]; depth: number }> = [];
  const push = (list: Array<Pt & { depth: number }>) => {
    quads.push({
      pts: list.map((p) => ({ x: p.x, y: p.y })),
      depth: list.reduce((s, p) => s + p.depth, 0) / list.length,
    });
  };
  for (const su of [1, -1]) push(COMBOS.map(([sv, sn]) => at(su, sv, sn)));
  for (const sv of [1, -1]) push(COMBOS.map(([su, sn]) => at(su, sv, sn)));
  const outerCorners = COMBOS.map(([su, sv]) => at(su, sv, 1));
  const attachCorners = COMBOS.map(([su, sv]) => at(su, sv, -1));
  push(outerCorners);
  push(attachCorners);
  quads.sort((x, y) => y.depth - x.depth); // painter's order: far first

  return {
    quads,
    attach: attachCorners.map((p) => ({ x: p.x, y: p.y })),
    outer: {
      x: outerCorners.reduce((s, p) => s + p.x, 0) / 4,
      y: outerCorners.reduce((s, p) => s + p.y, 0) / 4,
    },
  };
}

/** The finished block as a pre-normalization part (in the parent's rotated
 *  frame) + the screen px its center should spawn at. */
export function extrudeBlock(
  ctx: ExtrudeCtx,
  L: number,
  color: string
): { part: HoloPart; centerScreen: Pt; dims: [number, number, number] } {
  const a = faceAxis(ctx.face);
  const s = faceSign(ctx.face);
  const [u, v] = LATERAL[a];
  const position: [number, number, number] = [0, 0, 0];
  const scaleArr: [number, number, number] = [0, 0, 0];
  position[a] = ctx.faceOffset + s * (L / 2);
  scaleArr[a] = L / 2;
  scaleArr[u] = ctx.eU;
  scaleArr[v] = ctx.eV;
  const centerWorld = ctx.attachWorld.clone().add(ctx.nWorld.clone().multiplyScalar(L / 2));
  const centerScreen = projectWorld(ctx.rect, centerWorld);
  return {
    part: { type: "box", position, rotation: [0, 0, 0], scale: scaleArr, color },
    centerScreen: { x: centerScreen.x, y: centerScreen.y },
    dims: [scaleArr[0] * 2, scaleArr[1] * 2, scaleArr[2] * 2],
  };
}

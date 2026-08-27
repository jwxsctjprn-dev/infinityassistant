/**
 * Infinity — built-in holographic model library.
 *
 * Hand-authored three.js primitive specs for common objects. These build
 * instantly, offline, with zero network/AI dependency — the AI generator
 * is only consulted for objects not in this library.
 */
import type { HoloPart, HoloPartType, HoloSpec } from "./types";
import { normalizeHoloSpec } from "./holo";

/** How long a freshly-built model takes to assemble part-by-part on screen. */
export const ASSEMBLE_MS = 1800;

type RawPart = [
  type: HoloPartType,
  position: [number, number, number],
  rotation: [number, number, number],
  scale: [number, number, number],
  color: string,
];

function spec(name: string, raw: RawPart[]): HoloSpec {
  return normalizeHoloSpec(
    name,
    raw.map(([type, position, rotation, scale, color]) => ({
      type,
      position,
      rotation,
      scale,
      color,
    }) as HoloPart)
  );
}

/* Geometry conventions (see holo-model-mesh.tsx):
 *   box      scale = half-extents
 *   cylinder scale.x/z = radius, scale.y = half-height (axis Y)
 *   cone     radius / half-height, apex +Y
 *   sphere   radius
 *   torus    lies in XY plane (hole along Z), scale.x/y = ring radius
 *   capsule  axis Y
 */

const ROCKET = (): HoloSpec =>
  spec("Rocket Ship", [
    // fuselage
    ["cylinder", [0, 0.35, 0], [0, 0, 0], [0.42, 0.95, 0.42], "#eef2f7"],
    ["cylinder", [0, 1.06, 0], [0, 0, 0], [0.43, 0.12, 0.43], "#e74c3c"],
    ["cylinder", [0, -0.4, 0], [0, 0, 0], [0.43, 0.12, 0.43], "#8395a7"],
    // nose
    ["cone", [0, 1.5, 0], [0, 0, 0], [0.42, 0.55, 0.42], "#e74c3c"],
    ["sphere", [0, 2.02, 0], [0, 0, 0], [0.1, 0.1, 0.1], "#f1c40f"],
    // engine + nozzle + flame
    ["cylinder", [0, -0.85, 0], [0, 0, 0], [0.3, 0.18, 0.3], "#57606f"],
    ["cone", [0, -1.12, 0], [Math.PI, 0, 0], [0.34, 0.3, 0.34], "#37424e"],
    ["cone", [0, -1.6, 0], [Math.PI, 0, 0], [0.3, 0.55, 0.3], "#ff9f43"],
    ["cone", [0, -1.47, 0], [Math.PI, 0, 0], [0.16, 0.34, 0.16], "#ffe58a"],
    // fins at 90° / 210° / 330°
    ["box", [0, -0.62, 0.55], [0, 0, 0], [0.07, 0.55, 0.3], "#e74c3c"],
    ["box", [-0.476, -0.62, -0.275], [0, -2.0944, 0], [0.07, 0.55, 0.3], "#e74c3c"],
    ["box", [0.476, -0.62, -0.275], [0, 2.0944, 0], [0.07, 0.55, 0.3], "#e74c3c"],
    // side boosters
    ["cylinder", [-0.58, -0.1, 0], [0, 0, 0], [0.14, 0.7, 0.14], "#d5dbe3"],
    ["cone", [-0.58, 0.35, 0], [0, 0, 0], [0.14, 0.18, 0.14], "#8395a7"],
    ["cylinder", [0.58, -0.1, 0], [0, 0, 0], [0.14, 0.7, 0.14], "#d5dbe3"],
    ["cone", [0.58, 0.35, 0], [0, 0, 0], [0.14, 0.18, 0.14], "#8395a7"],
    // windows + hatch ring
    ["sphere", [0, 0.55, 0.4], [0, 0, 0], [0.09, 0.09, 0.05], "#70f0ff"],
    ["sphere", [0, 0.22, 0.4], [0, 0, 0], [0.07, 0.07, 0.05], "#70f0ff"],
    ["torus", [0, 0.55, 0.41], [0, 0, 0], [0.14, 0.14, 0.14], "#9fb3c8"],
  ]);

const LIGHTHOUSE = (): HoloSpec =>
  spec("Lighthouse", [
    ["cylinder", [0, -1.1, 0], [0, 0, 0], [0.9, 0.25, 0.9], "#6b7a8f"],
    ["cylinder", [0, -0.75, 0], [0, 0, 0], [0.7, 0.15, 0.7], "#9aa5b1"],
    ["cylinder", [0, -0.1, 0], [0, 0, 0], [0.55, 0.5, 0.55], "#e8eef4"],
    ["cylinder", [0, 0.6, 0], [0, 0, 0], [0.42, 0.25, 0.42], "#e8eef4"],
    ["cylinder", [0, 0.95, 0], [0, 0, 0], [0.3, 0.12, 0.3], "#c0392b"],
    ["box", [0, -0.1, 0.56], [0, 0, 0], [0.18, 0.3, 0.04], "#2c3e50"],
    ["sphere", [0, 1.28, 0], [0, 0, 0], [0.26, 0.26, 0.26], "#ffe9a8"],
    ["cylinder", [0, 1.28, 0], [0, 0, 0], [0.34, 0.4, 0.34], "#bfe8ff"],
    ["cone", [0, 1.62, 0], [0, 0, 0], [0.4, 0.28, 0.4], "#c0392b"],
    ["sphere", [0, 1.86, 0], [0, 0, 0], [0.06, 0.06, 0.06], "#ffd700"],
    ["torus", [0, 1.05, 0], [1.5708, 0, 0], [0.36, 0.36, 0.36], "#9aa5b1"],
    ["box", [0.85, -0.95, 0.4], [0.3, 0.4, 0.2], [0.3, 0.18, 0.3], "#7f8c8d"],
    ["sphere", [-0.8, -1.0, 0.3], [0, 0, 0], [0.24, 0.2, 0.24], "#7f8c8d"],
    ["cylinder", [0.55, 1.05, 0.55], [0.5, 0, 0.5], [0.05, 0.5, 0.05], "#bfe8ff"],
  ]);

const CASTLE = (): HoloSpec => {
  const parts: RawPart[] = [
    ["cylinder", [0, -1.0, 0], [0, 0, 0], [1.2, 0.2, 1.2], "#6b7a8f"],
    ["cylinder", [0, 0.0, 0], [0, 0, 0], [0.45, 0.7, 0.45], "#cfd8e3"],
    ["cylinder", [0, 0.78, 0], [0, 0, 0], [0.55, 0.09, 0.55], "#8395a7"],
    ["cone", [0, 1.15, 0], [0, 0, 0], [0.5, 0.25, 0.5], "#c0392b"],
    ["cylinder", [0, 1.5, 0], [0, 0, 0], [0.03, 0.25, 0.03], "#95a5b8"],
    ["box", [0.14, 1.55, 0], [0, 0, 0], [0.1, 0.08, 0.015], "#e74c3c"],
    ["box", [0, -0.55, 0.85], [0, 0, 0], [0.7, 0.25, 0.06], "#cfd8e3"],
    ["box", [0, -0.55, -0.85], [0, 0, 0], [0.7, 0.25, 0.06], "#cfd8e3"],
    ["box", [0.85, -0.55, 0], [0, 0, 0], [0.06, 0.25, 0.7], "#cfd8e3"],
    ["box", [-0.85, -0.55, 0], [0, 0, 0], [0.06, 0.25, 0.7], "#cfd8e3"],
    ["box", [0, -0.7, 0.87], [0, 0, 0], [0.15, 0.21, 0.03], "#37424e"],
  ];
  for (const [x, z] of [
    [0.85, 0.85],
    [-0.85, 0.85],
    [0.85, -0.85],
    [-0.85, -0.85],
  ] as const) {
    parts.push(["cylinder", [x, -0.1, z], [0, 0, 0], [0.28, 0.55, 0.28], "#cfd8e3"]);
    parts.push(["cone", [x, 0.62, z], [0, 0, 0], [0.3, 0.23, 0.3], "#c0392b"]);
  }
  return spec("Castle", parts);
};

const PINE_TREE = (): HoloSpec =>
  spec("Pine Tree", [
    ["cylinder", [0, -0.9, 0], [0, 0, 0], [0.14, 0.28, 0.14], "#6b4a2f"],
    ["cone", [0, -0.25, 0], [0, 0, 0], [0.75, 0.3, 0.75], "#2ecc71"],
    ["cone", [0, 0.25, 0], [0, 0, 0], [0.6, 0.28, 0.6], "#27ae60"],
    ["cone", [0, 0.7, 0], [0, 0, 0], [0.42, 0.25, 0.42], "#2ecc71"],
    ["sphere", [0, 1.05, 0], [0, 0, 0], [0.09, 0.09, 0.09], "#f1c40f"],
  ]);

const HOUSE = (): HoloSpec =>
  spec("House", [
    ["box", [0, -0.35, 0], [0, 0, 0], [0.9, 0.28, 0.75], "#e8d9b0"],
    ["box", [-0.38, 0.32, 0], [0, 0, 0.6], [0.5, 0.03, 0.85], "#a0522d"],
    ["box", [0.38, 0.32, 0], [0, 0, -0.6], [0.5, 0.03, 0.85], "#a0522d"],
    ["box", [0.35, 0.45, 0.2], [0, 0, 0], [0.06, 0.15, 0.06], "#8395a7"],
    ["box", [0, -0.5, 0.76], [0, 0, 0], [0.11, 0.17, 0.02], "#6b4a2f"],
    ["box", [-0.4, -0.25, 0.76], [0, 0, 0], [0.1, 0.08, 0.02], "#70f0ff"],
    ["box", [0.4, -0.25, 0.76], [0, 0, 0], [0.1, 0.08, 0.02], "#70f0ff"],
    ["box", [0, -0.72, 0.85], [0, 0, 0], [0.17, 0.03, 0.1], "#95a5b8"],
  ]);

const CAR = (): HoloSpec => {
  const parts: RawPart[] = [
    ["box", [0, -0.1, 0], [0, 0, 0], [0.95, 0.11, 0.42], "#e74c3c"],
    ["box", [-0.05, 0.12, 0], [0, 0, 0], [0.5, 0.09, 0.38], "#cfd8e3"],
    ["sphere", [0.93, -0.08, 0.14], [0, 0, 0], [0.05, 0.05, 0.05], "#ffe9a8"],
    ["sphere", [0.93, -0.08, -0.14], [0, 0, 0], [0.05, 0.05, 0.05], "#ffe9a8"],
    ["sphere", [-0.93, -0.08, 0.14], [0, 0, 0], [0.05, 0.05, 0.05], "#ff6b6b"],
    ["sphere", [-0.93, -0.08, -0.14], [0, 0, 0], [0.05, 0.05, 0.05], "#ff6b6b"],
  ];
  for (const [x, z] of [
    [0.5, 0.24],
    [0.5, -0.24],
    [-0.5, 0.24],
    [-0.5, -0.24],
  ] as const) {
    parts.push(["cylinder", [x, -0.36, z], [Math.PI / 2, 0, 0], [0.16, 0.05, 0.16], "#21252b"]);
  }
  return spec("Car", parts);
};

const AIRPLANE = (): HoloSpec =>
  spec("Airplane", [
    ["capsule", [0, 0, 0], [0, 0, Math.PI / 2], [0.2, 0.55, 0.2], "#eef2f7"],
    ["cone", [0.75, 0, 0], [0, 0, -Math.PI / 2], [0.14, 0.18, 0.14], "#e74c3c"],
    ["box", [0, 0, 0], [0, 0, 0], [0.18, 0.03, 1.5], "#eef2f7"],
    ["box", [-0.72, 0.02, 0], [0, 0, 0], [0.1, 0.02, 0.5], "#eef2f7"],
    ["box", [-0.75, 0.2, 0], [0, 0, 0], [0.1, 0.17, 0.04], "#e74c3c"],
    ["cylinder", [0.1, -0.12, 0.4], [0, 0, Math.PI / 2], [0.14, 0.12, 0.14], "#8395a7"],
    ["cylinder", [0.1, -0.12, -0.4], [0, 0, Math.PI / 2], [0.14, 0.12, 0.14], "#8395a7"],
    ["sphere", [0.55, 0.08, 0], [0, 0, 0], [0.1, 0.08, 0.06], "#70f0ff"],
  ]);

const SAILBOAT = (): HoloSpec =>
  spec("Sailboat", [
    ["box", [0, -0.45, 0], [0, 0, 0], [0.95, 0.09, 0.3], "#a06a35"],
    ["cone", [0.68, -0.45, 0], [0, 0, -Math.PI / 2], [0.15, 0.2, 0.3], "#a06a35"],
    ["cone", [-0.68, -0.45, 0], [0, 0, Math.PI / 2], [0.15, 0.2, 0.3], "#a06a35"],
    ["box", [0, -0.34, 0], [0, 0, 0], [0.8, 0.02, 0.26], "#c9b48a"],
    ["cylinder", [0, 0.15, 0], [0, 0, 0], [0.03, 0.75, 0.03], "#5c3a1e"],
    ["box", [0.25, 0.3, 0], [0, 0, 0], [0.22, 0.28, 0.01], "#f5f0e6"],
    ["box", [-0.28, 0.22, 0], [0, 0, 0], [0.15, 0.2, 0.01], "#f5f0e6"],
    ["box", [0.1, 0.95, 0], [0, 0, 0], [0.06, 0.04, 0.005], "#e74c3c"],
  ]);

const ROBOT = (): HoloSpec =>
  spec("Robot", [
    ["box", [0, 0.1, 0], [0, 0, 0], [0.55, 0.33, 0.35], "#cfd8e3"],
    ["sphere", [0, 0.18, 0.32], [0, 0, 0], [0.12, 0.12, 0.12], "#70f0ff"],
    ["box", [0, 0.62, 0], [0, 0, 0], [0.16, 0.14, 0.15], "#eef2f7"],
    ["sphere", [-0.07, 0.66, 0.15], [0, 0, 0], [0.045, 0.045, 0.045], "#70f0ff"],
    ["sphere", [0.07, 0.66, 0.15], [0, 0, 0], [0.045, 0.045, 0.045], "#70f0ff"],
    ["cylinder", [0, 0.85, 0], [0, 0, 0], [0.02, 0.08, 0.02], "#95a5b8"],
    ["sphere", [0, 0.95, 0], [0, 0, 0], [0.05, 0.05, 0.05], "#e74c3c"],
    ["sphere", [-0.38, 0.35, 0], [0, 0, 0], [0.12, 0.12, 0.12], "#8395a7"],
    ["sphere", [0.38, 0.35, 0], [0, 0, 0], [0.12, 0.12, 0.12], "#8395a7"],
    ["capsule", [-0.42, -0.05, 0], [0, 0, 0], [0.07, 0.22, 0.07], "#cfd8e3"],
    ["capsule", [0.42, -0.05, 0], [0, 0, 0], [0.07, 0.22, 0.07], "#cfd8e3"],
    ["sphere", [-0.42, -0.42, 0], [0, 0, 0], [0.09, 0.09, 0.09], "#8395a7"],
    ["sphere", [0.42, -0.42, 0], [0, 0, 0], [0.09, 0.09, 0.09], "#8395a7"],
    ["capsule", [-0.18, -0.6, 0], [0, 0, 0], [0.09, 0.25, 0.09], "#8395a7"],
    ["capsule", [0.18, -0.6, 0], [0, 0, 0], [0.09, 0.25, 0.09], "#8395a7"],
    ["box", [-0.18, -0.95, 0.04], [0, 0, 0], [0.08, 0.04, 0.12], "#37424e"],
    ["box", [0.18, -0.95, 0.04], [0, 0, 0], [0.08, 0.04, 0.12], "#37424e"],
  ]);

const SWORD = (): HoloSpec =>
  spec("Sword", [
    ["box", [0, 0.35, 0], [0, 0, 0], [0.045, 0.65, 0.015], "#d5dde6"],
    ["cone", [0, 1.12, 0], [0, 0, 0], [0.05, 0.16, 0.015], "#d5dde6"],
    ["box", [0, -0.32, 0], [0, 0, 0], [0.17, 0.035, 0.04], "#c9a227"],
    ["cylinder", [0, -0.5, 0], [0, 0, 0], [0.05, 0.14, 0.05], "#6b4a2f"],
    ["sphere", [0, -0.68, 0], [0, 0, 0], [0.08, 0.08, 0.08], "#c9a227"],
  ]);

const MUG = (): HoloSpec =>
  spec("Coffee Mug", [
    ["cylinder", [0, 0, 0], [0, 0, 0], [0.45, 0.5, 0.45], "#eef2f7"],
    ["torus", [0, 0.5, 0], [Math.PI / 2, 0, 0], [0.45, 0.45, 0.2], "#d5dde6"],
    ["torus", [0.58, 0.05, 0], [0, Math.PI / 2, 0], [0.3, 0.3, 0.12], "#eef2f7"],
    ["cylinder", [0, 0.44, 0], [0, 0, 0], [0.38, 0.015, 0.38], "#4a2f1e"],
  ]);

const LAMP = (): HoloSpec =>
  spec("Desk Lamp", [
    ["cylinder", [0, -0.85, 0], [0, 0, 0], [0.5, 0.04, 0.5], "#37424e"],
    ["cylinder", [0, -0.3, 0], [0, 0, 0], [0.05, 0.5, 0.05], "#8395a7"],
    ["box", [0.25, 0.35, 0], [0, 0, 0.8], [0.22, 0.03, 0.03], "#8395a7"],
    ["cone", [0.52, 0.5, 0], [Math.PI, 0, 0], [0.3, 0.14, 0.3], "#e74c3c"],
    ["sphere", [0.52, 0.3, 0], [0, 0, 0], [0.12, 0.12, 0.12], "#ffe9a8"],
    ["sphere", [0.52, 0.12, 0], [0, 0, 0], [0.2, 0.06, 0.2], "#ffe9a8"],
  ]);

const WINDMILL = (): HoloSpec => {
  const parts: RawPart[] = [
    ["cylinder", [0, -0.2, 0], [0, 0, 0], [0.42, 0.45, 0.42], "#cfd8e3"],
    ["cone", [0, 0.8, 0], [0, 0, 0], [0.46, 0.18, 0.46], "#8395a7"],
    ["sphere", [0, 0.35, 0.52], [0, 0, 0], [0.12, 0.12, 0.12], "#37424e"],
    ["box", [0, -0.75, 0.43], [0, 0, 0], [0.08, 0.15, 0.02], "#6b4a2f"],
    ["box", [0, 0.15, 0.43], [0, 0, 0], [0.05, 0.05, 0.02], "#70f0ff"],
  ];
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    parts.push([
      "box",
      [Math.cos(a) * 0.42, 0.35 + Math.sin(a) * 0.42, 0.55],
      [0, 0, a - Math.PI / 2],
      [0.04, 0.42, 0.015],
      "#eef2f7",
    ]);
  }
  return spec("Windmill", parts);
};

const SATELLITE = (): HoloSpec =>
  spec("Satellite", [
    ["box", [0, 0, 0], [0, 0, 0], [0.25, 0.3, 0.2], "#cfd8e3"],
    ["cylinder", [-0.42, 0.1, 0], [0, 0, Math.PI / 2], [0.04, 0.15, 0.04], "#8395a7"],
    ["cylinder", [0.42, 0.1, 0], [0, 0, Math.PI / 2], [0.04, 0.15, 0.04], "#8395a7"],
    ["box", [-0.85, 0.1, 0], [0, 0, 0], [0.45, 0.21, 0.015], "#2c5f2d"],
    ["box", [0.85, 0.1, 0], [0, 0, 0], [0.45, 0.21, 0.015], "#2c5f2d"],
    ["cone", [0, 0.62, 0], [Math.PI, 0, 0], [0.35, 0.14, 0.35], "#eef2f7"],
    ["cylinder", [0, 0.85, 0], [0, 0, 0], [0.02, 0.1, 0.02], "#8395a7"],
    ["sphere", [0, 0.98, 0], [0, 0, 0], [0.05, 0.05, 0.05], "#e74c3c"],
    ["cylinder", [0, -0.55, 0], [0, 0, 0], [0.02, 0.15, 0.02], "#8395a7"],
  ]);

const UFO = (): HoloSpec => {
  const parts: RawPart[] = [
    ["sphere", [0, 0, 0], [0, 0, 0], [1.1, 0.18, 1.1], "#aebfd0"],
    ["sphere", [0, 0.25, 0], [0, 0, 0], [0.45, 0.3, 0.45], "#bfe8ff"],
    ["torus", [0, 0, 0], [Math.PI / 2, 0, 0], [1.0, 1.0, 0.25], "#8395a7"],
    ["cone", [0, -0.55, 0], [Math.PI, 0, 0], [0.7, 0.3, 0.7], "#bfe8ff"],
  ];
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    parts.push([
      "sphere",
      [Math.cos(a) * 0.7, -0.02, Math.sin(a) * 0.7],
      [0, 0, 0],
      [0.06, 0.06, 0.06],
      "#ffe9a8",
    ]);
  }
  return spec("UFO", parts);
};

const SATURN = (): HoloSpec =>
  spec("Saturn", [
    ["sphere", [0, 0, 0], [0, 0, 0], [1.0, 1.0, 1.0], "#e8c98a"],
    ["torus", [0, 0, 0], [1.9, 0, 0.35], [1.6, 1.6, 0.35], "#d8b47a"],
    ["torus", [0, 0, 0], [1.9, 0, 0.35], [2.0, 2.0, 0.15], "#c9a870"],
    ["sphere", [1.5, 0.6, -0.5], [0, 0, 0], [0.15, 0.15, 0.15], "#cfd8e3"],
  ]);

const TOWER = (): HoloSpec => {
  const parts: RawPart[] = [
    ["box", [1.3, 0.1, 1.3], [0, 0, 0], [0.65, 0.04, 0.65], "#aebfd0"],
    ["box", [0.7, 1.0, 0.7], [0, 0, 0], [0.35, 0.035, 0.35], "#aebfd0"],
    ["cone", [0, 1.45, 0], [0, 0, 0], [0.18, 0.45, 0.18], "#8395a7"],
    ["cylinder", [0, 2.0, 0], [0, 0, 0], [0.02, 0.15, 0.02], "#aebfd0"],
  ];
  for (const [x, z] of [
    [0.55, 0.55],
    [-0.55, 0.55],
    [0.55, -0.55],
    [-0.55, -0.55],
  ] as const) {
    parts.push([
      "box",
      [x, -0.5, z],
      [-z * 0.55, 0, x * 0.55],
      [0.05, 0.55, 0.05],
      "#8395a7",
    ]);
  }
  for (const [x, z] of [
    [0.28, 0.28],
    [-0.28, 0.28],
    [0.28, -0.28],
    [-0.28, -0.28],
  ] as const) {
    parts.push([
      "box",
      [x, 0.55, z],
      [-z * 0.35, 0, x * 0.35],
      [0.035, 0.45, 0.035],
      "#8395a7",
    ]);
  }
  return spec("Tower", parts);
};

/* ------------------------------------------------------------------ */
/* Catalog + matching                                                  */
/* ------------------------------------------------------------------ */

interface LibraryEntry {
  name: string;
  aliases: string[];
  build: () => HoloSpec;
}

export const LIBRARY: LibraryEntry[] = [
  {
    name: "Rocket Ship",
    aliases: ["rocket", "rocket ship", "rocketship", "spaceship", "space ship", "spacecraft", "space rocket", "missile"],
    build: ROCKET,
  },
  {
    name: "Lighthouse",
    aliases: ["lighthouse", "light house", "beacon tower"],
    build: LIGHTHOUSE,
  },
  { name: "Castle", aliases: ["castle", "fortress", "fort", "palace", "keep"], build: CASTLE },
  { name: "Pine Tree", aliases: ["pine tree", "tree", "christmas tree", "pine", "fir", "evergreen"], build: PINE_TREE },
  { name: "House", aliases: ["house", "home", "cottage", "cabin", "hut"], build: HOUSE },
  { name: "Car", aliases: ["car", "automobile", "vehicle", "sedan", "sports car"], build: CAR },
  { name: "Airplane", aliases: ["airplane", "plane", "aircraft", "jet", "jet plane", "aeroplane"], build: AIRPLANE },
  { name: "Sailboat", aliases: ["sailboat", "sail boat", "boat", "ship", "yacht", "sailing ship"], build: SAILBOAT },
  { name: "Robot", aliases: ["robot", "android", "droid", "mech", "bot"], build: ROBOT },
  { name: "Sword", aliases: ["sword", "blade", "katana", "longsword"], build: SWORD },
  { name: "Coffee Mug", aliases: ["coffee mug", "mug", "cup", "coffee cup", "tea cup", "teacup"], build: MUG },
  { name: "Desk Lamp", aliases: ["desk lamp", "lamp", "light", "table lamp"], build: LAMP },
  { name: "Windmill", aliases: ["windmill", "wind mill", "turbine", "wind turbine"], build: WINDMILL },
  { name: "Satellite", aliases: ["satellite", "space probe", "probe", "orbiter"], build: SATELLITE },
  { name: "UFO", aliases: ["ufo", "flying saucer", "alien ship", "ufo spacecraft"], build: UFO },
  { name: "Saturn", aliases: ["saturn", "planet", "ringed planet", "planet saturn"], build: SATURN },
  { name: "Tower", aliases: ["tower", "eiffel tower", "radio tower", "spire"], build: TOWER },
];

const normTokens = (s: string): string[] =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);

const cache = new Map<string, HoloSpec>();

/**
 * Find a library model matching the asked-for object (alias tokens ⊆ ask
 * tokens, longest alias wins — so "rocket ship" beats the sailboat's "ship").
 * Returns a fresh normalized spec, or null when nothing matches.
 */
export function matchLibraryModel(object: string): HoloSpec | null {
  const ask = new Set(normTokens(object));
  if (ask.size === 0) return null;

  let best: { entry: LibraryEntry; aliasTokens: number } | null = null;
  for (const entry of LIBRARY) {
    for (const alias of entry.aliases) {
      const tokens = normTokens(alias);
      if (tokens.length === 0) continue;
      if (tokens.every((t) => ask.has(t))) {
        if (!best || tokens.length > best.aliasTokens) {
          best = { entry, aliasTokens: tokens.length };
        }
      }
    }
  }
  if (!best) return null;

  const name = best.entry.name;
  const cached = cache.get(name);
  if (cached) {
    // return a copy so callers can never mutate the cached spec
    return { name: cached.name, parts: cached.parts.map((p) => ({ ...p })) };
  }
  const built = best.entry.build();
  cache.set(name, built);
  return { name: built.name, parts: built.parts.map((p) => ({ ...p })) };
}

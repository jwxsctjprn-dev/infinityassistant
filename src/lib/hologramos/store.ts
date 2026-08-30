/**
 * HologramOS — OS state (zustand).
 *
 * Low-frequency OS state only: boot phase, open windows, settings. Anything
 * per-frame (head, hands, hover, drag) lives in lib/hologramos/runtime.ts.
 *
 * Window positions: the store carries the SPAWN transform; live dragging and
 * recentering move the window groups imperatively (rt.windowNodes) without
 * touching React state.
 */

import { create } from "zustand";
import { rt } from "./runtime";
import { sound } from "./sound";

export type AppId =
  | "notes"
  | "terminal"
  | "vitals"
  | "timer"
  | "chrono"
  | "sonics"
  | "settings";

export interface OsWindow {
  key: number;
  app: AppId;
  pos: [number, number, number];
  yaw: number;
  bornAt: number;
}

export type Brightness = 0 | 1 | 2;

export interface OsSettings {
  /** visual scale of panels (0.85 / 1 / 1.15) */
  scale: number;
  brightness: Brightness;
  particles: boolean;
  sound: boolean;
  skeleton: boolean;
}

const SETTINGS_KEY = "hologramos.settings.v2";

function loadSettings(): OsSettings {
  const fallback: OsSettings = {
    scale: 1,
    brightness: 1,
    particles: true,
    sound: true,
    skeleton: true,
  };
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<OsSettings>;
    return {
      scale:
        typeof parsed.scale === "number" && parsed.scale >= 0.8 && parsed.scale <= 1.2
          ? parsed.scale
          : 1,
      brightness: parsed.brightness === 0 || parsed.brightness === 2 ? parsed.brightness : 1,
      particles: typeof parsed.particles === "boolean" ? parsed.particles : true,
      sound: typeof parsed.sound === "boolean" ? parsed.sound : true,
      skeleton: typeof parsed.skeleton === "boolean" ? parsed.skeleton : true,
    };
  } catch {
    return fallback;
  }
}

function saveSettings(s: OsSettings): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* private mode etc. — settings just won't persist */
  }
}

/** Max simultaneous app windows — keeps the room uncluttered. */
export const MAX_WINDOWS = 2;

let windowSeq = 1;

interface OsState {
  phase: "boot" | "home";
  windows: OsWindow[];
  settings: OsSettings;
  bootDone: () => void;
  openApp: (app: AppId) => void;
  closeWindow: (key: number) => void;
  closeAll: () => void;
  setSetting: (patch: Partial<OsSettings>) => void;
  recenter: () => void;
}

/** Spawn transform for a new window given the live head pose. */
function spawnTransform(index: number): { pos: [number, number, number]; yaw: number } {
  const fwd = rt.headFwd;
  const side = index % 2 === 0 ? -1 : 1;
  const dist = 1.14;
  const x = rt.headPos.x + fwd.x * dist + -fwd.z * side * 0.42 * index;
  const z = rt.headPos.z + fwd.z * dist + fwd.x * side * 0.42 * index;
  const y = Math.max(0.7, rt.headPos.y - 0.08);
  const yaw = Math.atan2(rt.headPos.x - x, rt.headPos.z - z);
  return { pos: [x, y, z], yaw };
}

export const useOs = create<OsState>((set, get) => {
  const initialSettings = loadSettings();
  sound.enabled = initialSettings.sound;

  return {
    phase: "boot",
    windows: [],
    settings: initialSettings,

    bootDone: () => set({ phase: "home" }),

    openApp: (app) => {
      const { windows } = get();
      // already open → nothing to do (windows are singletons per app)
      if (windows.some((w) => w.app === app)) return;
      let list = windows;
      if (windows.length >= MAX_WINDOWS) {
        // close the oldest — the room stays clean
        list = windows.slice(windows.length - (MAX_WINDOWS - 1));
      }
      const { pos, yaw } = spawnTransform(list.length);
      const win: OsWindow = {
        key: windowSeq++,
        app,
        pos,
        yaw,
        bornAt: performance.now(),
      };
      sound.open();
      set({ windows: [...list, win] });
    },

    closeWindow: (key) => {
      const { windows } = get();
      if (!windows.some((w) => w.key === key)) return;
      sound.close();
      set({ windows: windows.filter((w) => w.key !== key) });
    },

    closeAll: () => {
      const { windows } = get();
      if (windows.length === 0) return;
      sound.close();
      set({ windows: [] });
    },

    setSetting: (patch) => {
      const settings = { ...get().settings, ...patch };
      if (patch.sound !== undefined) sound.enabled = patch.sound;
      saveSettings(settings);
      set({ settings });
    },

    recenter: () => {
      // home anchor snaps in front of the current head pose
      const fwd = rt.headFwd;
      rt.homeAnchor.pos.set(
        rt.headPos.x + fwd.x * 2.1,
        Math.max(0.9, rt.headPos.y - 0.12),
        rt.headPos.z + fwd.z * 2.1
      );
      rt.homeAnchor.yaw = Math.atan2(
        rt.headPos.x - rt.homeAnchor.pos.x,
        rt.headPos.z - rt.homeAnchor.pos.z
      );
      rt.homeAnchor.set = true;
      // windows re-lay out relative to the head
      const wins = get().windows;
      wins.forEach((w, i) => {
        const { pos, yaw } = spawnTransform(i);
        const node = rt.windowNodes.get(w.key);
        if (node) {
          node.position.set(pos[0], pos[1], pos[2]);
          node.rotation.set(0, yaw, 0);
        }
        w.pos = pos;
        w.yaw = yaw;
      });
      set({ windows: [...wins] });
    },
  };
});

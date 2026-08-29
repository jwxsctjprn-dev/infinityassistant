"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Annotation, HoloModel, SceneSlot, Settings } from "./types";
import { DEFAULT_MARKER_COLOR, SCENE_SLOTS } from "./types";
import { PROVIDERS } from "./providers";
import { ARRANGE_LAYOUTS, MAX_MODELS } from "./holo";

export const DEFAULT_SETTINGS: Settings = {
  provider: "zai",
  apiKey: "",
  baseUrl: "",
  model: PROVIDERS.zai.defaultModel,
  voice: "en-US-AriaNeural",
  rate: 1,
  captions: true,
  systemPrompt: "",
};

interface InfinityStore {
  settings: Settings;
  /** Holographic build-table overlay (session state — not persisted) */
  workbench: boolean;
  /** Models placed on the workbench (persisted) */
  models: HoloModel[];
  /** Marker strokes drawn on the bench (persisted, viewport-normalized) */
  annotations: Annotation[];
  /** Selected marker color (persisted) */
  drawColor: string;
  /** True while the user is in draw mode — the canvas catches pointer
   *  events instead of the models (session state — not persisted). */
  drawing: boolean;
  /** Blueprint engineering view for the WHOLE bench (voice: "blueprint
   *  mode") — persisted so a reload keeps the look. */
  blueprint: boolean;
  /** Model under the floating inspector HUD (voice: "inspect the rocket").
   *  One at a time — session state. */
  inspectId: string | null;
  /** Model presented in focus mode (voice: "focus on the rocket") —
   *  everything else dims. Session state. */
  focusedId: string | null;
  /** True for ~0.8s after an auto-arrange — cards get a CSS transition so
   *  they GLIDE to their new slots instead of teleporting. */
  arranging: boolean;
  /** Saved bench layouts (voice: "save the scene" / "load scene two").
   *  Persisted. */
  scenes: (SceneSlot | null)[];
  /** Models removed by delete/clear — the "bring it back" undo source.
   *  Session only (a reload forgets, like every undo buffer). */
  lastDeleted: HoloModel[];
  /** Mixed-reality takeover is active (session state — not persisted).
   *  While true the whole app renders inside a WebXR passthrough session. */
  mrActive: boolean;
  setSettings: (patch: Partial<Settings>) => void;
  setMrActive: (v: boolean) => void;
  resetSettings: () => void;
  setWorkbench: (v: boolean) => void;
  addModel: (m: HoloModel) => void;
  removeModel: (id: string) => void;
  clearModels: () => void;
  updateModel: (
    id: string,
    patch: Partial<
      Pick<
        HoloModel,
        "pos" | "rot" | "scale" | "spec" | "name" | "pending" | "spin" | "exploded" | "xray" | "solid" | "measure"
      >
    >
  ) => void;
  setDrawing: (v: boolean) => void;
  setDrawColor: (c: string) => void;
  addAnnotation: (a: Annotation) => void;
  undoAnnotation: () => void;
  clearAnnotations: () => void;
  setBlueprint: (v: boolean) => void;
  setInspect: (id: string | null) => void;
  setFocused: (id: string | null) => void;
  setArranging: (v: boolean) => void;
  /** Glide every model into a clean presentation grid. */
  arrangeModels: () => void;
  /** Save the current bench into a slot (0-based). Returns the scene name. */
  saveScene: (slot: number) => string;
  /** Restore a slot onto the bench. False when the slot is empty. */
  loadScene: (slot: number) => boolean;
  /** Restore the last deleted models ("bring it back"). Returns how many
   *  models actually came back (the MAX_MODELS cap may trim). */
  undoDelete: () => number;
}

export const useInfinity = create<InfinityStore>()(
  persist(
    (set) => ({
      settings: DEFAULT_SETTINGS,
      workbench: false,
      models: [],
      annotations: [],
      drawColor: DEFAULT_MARKER_COLOR,
      drawing: false,
      blueprint: false,
      inspectId: null,
      focusedId: null,
      arranging: false,
      scenes: Array.from({ length: SCENE_SLOTS }, () => null),
      lastDeleted: [],
      mrActive: false,
      setSettings: (patch) =>
        set((state) => ({ settings: { ...state.settings, ...patch } })),
      resetSettings: () => set({ settings: DEFAULT_SETTINGS }),
      setMrActive: (v) => set({ mrActive: v }),
      setWorkbench: (v) => set({ workbench: v }),
      addModel: (m) => set((state) => ({ models: [...state.models, m] })),
      removeModel: (id) =>
        set((state) => {
          const gone = state.models.find((x) => x.id === id);
          return {
            models: state.models.filter((x) => x.id !== id),
            // "bring it back" undo source — the freshest deletion wins.
            lastDeleted: gone ? [gone] : state.lastDeleted,
            inspectId: state.inspectId === id ? null : state.inspectId,
            focusedId: state.focusedId === id ? null : state.focusedId,
          };
        }),
      clearModels: () =>
        set((state) => ({
          models: [],
          lastDeleted: state.models.length > 0 ? state.models : state.lastDeleted,
          inspectId: null,
          focusedId: null,
        })),
      updateModel: (id, patch) =>
        set((state) => ({
          models: state.models.map((x) => (x.id === id ? { ...x, ...patch } : x)),
        })),
      setDrawing: (v) => set({ drawing: v }),
      setDrawColor: (c) => set({ drawColor: c }),
      addAnnotation: (a) =>
        set((state) => {
          const next = [...state.annotations, a];
          // Keep localStorage bounded — drop the oldest strokes past 120.
          return { annotations: next.length > 120 ? next.slice(-120) : next };
        }),
      undoAnnotation: () =>
        set((state) => ({ annotations: state.annotations.slice(0, -1) })),
      clearAnnotations: () => set({ annotations: [] }),
      setBlueprint: (v) => set({ blueprint: v }),
      setInspect: (id) => set({ inspectId: id }),
      setFocused: (id) => set({ focusedId: id }),
      setArranging: (v) => set({ arranging: v }),
      arrangeModels: () =>
        set((state) => {
          const layout = ARRANGE_LAYOUTS[Math.max(0, Math.min(state.models.length, ARRANGE_LAYOUTS.length) - 1)];
          return {
            models: state.models.map((m, i) => ({ ...m, pos: layout[i] ?? m.pos })),
            arranging: true,
          };
        }),
      saveScene: (slot) => {
        const models = useInfinity.getState().models.filter((m) => !m.pending);
        const name =
          models.length === 0
            ? "Empty bench"
            : models.length === 1
              ? models[0].name
              : `${models[0].name} + ${models.length - 1} more`;
        const scene: SceneSlot = { name, savedAt: Date.now(), models };
        set((state) => {
          const scenes = [...state.scenes];
          scenes[slot] = scene;
          return { scenes };
        });
        return name;
      },
      loadScene: (slot) => {
        const scene = useInfinity.getState().scenes[slot];
        if (!scene || scene.models.length === 0) return false;
        set({
          models: scene.models.map((m) => ({ ...m, pending: undefined })),
          workbench: true,
          inspectId: null,
          focusedId: null,
        });
        return true;
      },
      undoDelete: () => {
        const restore = useInfinity.getState().lastDeleted;
        if (restore.length === 0) return 0;
        let restored = 0;
        set((state) => {
          // The bench cap may trim a big "clear workbench" undo — always
          // bring back at least one model.
          const room = Math.max(1, MAX_MODELS - state.models.length);
          const back = restore.slice(0, room);
          restored = back.length;
          return {
            models: [...state.models, ...back.map((m) => ({ ...m, bornAt: Date.now() }))],
            lastDeleted: [],
            workbench: true,
          };
        });
        return restored;
      },
    }),
    {
      name: "infinity-settings",
      version: 4,
      partialize: (state) => ({
        settings: state.settings,
        // Models mid-design (progressive AI build) are session-only — a
        // reload must never resurrect a half-designed hologram.
        models: state.models.filter((m) => !m.pending),
        annotations: state.annotations,
        drawColor: state.drawColor,
        blueprint: state.blueprint,
        scenes: state.scenes.map((s) => (s ? { ...s, models: s.models.filter((m) => !m.pending) } : null)),
      }),
      migrate: (state) => {
        const s = state as {
          settings?: Settings;
          models?: HoloModel[];
          annotations?: Annotation[];
          drawColor?: string;
          blueprint?: boolean;
          scenes?: (SceneSlot | null)[];
        };
        const settings = s.settings ?? DEFAULT_SETTINGS;
        // v3: the conversation default moved to the much faster flash model.
        // Migrate anyone still on the OLD default (explicit choices of other
        // models are left alone; glm-4.6 is one click away in Settings).
        if (settings.provider === "zai" && settings.model === "glm-4.6") {
          settings.model = PROVIDERS.zai.defaultModel;
        }
        // v4: engineer's toolkit — blueprint flag + scene slots join the
        // persisted shape (both with safe defaults for old data).
        return {
          settings,
          models: s.models ?? [],
          annotations: s.annotations ?? [],
          drawColor: s.drawColor ?? DEFAULT_MARKER_COLOR,
          blueprint: s.blueprint ?? false,
          scenes:
            s.scenes && s.scenes.length === SCENE_SLOTS
              ? s.scenes
              : Array.from({ length: SCENE_SLOTS }, () => null),
        };
      },
    }
  )
);

/** True when the current settings are enough to start a conversation. */
export function isConfigured(s: Settings): boolean {
  const key = s.apiKey.trim().length > 0;
  const model = s.model.trim().length > 0;
  if (s.provider === "custom") {
    return model && s.baseUrl.trim().length > 0;
  }
  return key && model;
}

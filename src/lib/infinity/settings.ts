"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Annotation, HoloModel, Settings, StressSession } from "./types";
import { DEFAULT_MARKER_COLOR } from "./types";
import { PROVIDERS } from "./providers";

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
  /** Live reality-physics stress test on one bench model (session state). */
  stress: StressSession | null;
  setSettings: (patch: Partial<Settings>) => void;
  resetSettings: () => void;
  setWorkbench: (v: boolean) => void;
  addModel: (m: HoloModel) => void;
  removeModel: (id: string) => void;
  clearModels: () => void;
  updateModel: (
    id: string,
    patch: Partial<Pick<HoloModel, "pos" | "rot" | "scale" | "spec" | "name" | "pending">>
  ) => void;
  setStress: (s: StressSession | null) => void;
  updateStress: (patch: Partial<StressSession>) => void;
  setDrawing: (v: boolean) => void;
  setDrawColor: (c: string) => void;
  addAnnotation: (a: Annotation) => void;
  undoAnnotation: () => void;
  clearAnnotations: () => void;
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
      stress: null,
      setSettings: (patch) =>
        set((state) => ({ settings: { ...state.settings, ...patch } })),
      resetSettings: () => set({ settings: DEFAULT_SETTINGS }),
      setWorkbench: (v) =>
        set((state) => ({ workbench: v, ...(v ? {} : { stress: null }) })),
      addModel: (m) => set((state) => ({ models: [...state.models, m] })),
      removeModel: (id) =>
        set((state) => ({
          models: state.models.filter((x) => x.id !== id),
          // a stress test dies with its model
          stress: state.stress?.modelId === id ? null : state.stress,
        })),
      clearModels: () => set({ models: [], stress: null }),
      updateModel: (id, patch) =>
        set((state) => ({
          models: state.models.map((x) => (x.id === id ? { ...x, ...patch } : x)),
        })),
      setStress: (s) => set({ stress: s }),
      updateStress: (patch) =>
        set((state) =>
          state.stress ? { stress: { ...state.stress, ...patch } } : state
        ),
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
    }),
    {
      name: "infinity-settings",
      version: 2,
      partialize: (state) => ({
        settings: state.settings,
        // Models mid-design (progressive AI build) are session-only — a
        // reload must never resurrect a half-designed hologram.
        models: state.models.filter((m) => !m.pending),
        annotations: state.annotations,
        drawColor: state.drawColor,
      }),
      migrate: (state) => {
        const s = state as {
          settings?: Settings;
          models?: HoloModel[];
          annotations?: Annotation[];
          drawColor?: string;
        };
        return {
          settings: s.settings ?? DEFAULT_SETTINGS,
          models: s.models ?? [],
          annotations: s.annotations ?? [],
          drawColor: s.drawColor ?? DEFAULT_MARKER_COLOR,
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

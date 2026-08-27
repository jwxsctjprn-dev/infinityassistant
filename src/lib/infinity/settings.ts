"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { HoloModel, Settings } from "./types";
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
  setSettings: (patch: Partial<Settings>) => void;
  resetSettings: () => void;
  setWorkbench: (v: boolean) => void;
  addModel: (m: HoloModel) => void;
  removeModel: (id: string) => void;
  clearModels: () => void;
  updateModel: (
    id: string,
    patch: Partial<Pick<HoloModel, "pos" | "rot" | "scale">>
  ) => void;
}

export const useInfinity = create<InfinityStore>()(
  persist(
    (set) => ({
      settings: DEFAULT_SETTINGS,
      workbench: false,
      models: [],
      setSettings: (patch) =>
        set((state) => ({ settings: { ...state.settings, ...patch } })),
      resetSettings: () => set({ settings: DEFAULT_SETTINGS }),
      setWorkbench: (v) => set({ workbench: v }),
      addModel: (m) => set((state) => ({ models: [...state.models, m] })),
      removeModel: (id) =>
        set((state) => ({ models: state.models.filter((x) => x.id !== id) })),
      clearModels: () => set({ models: [] }),
      updateModel: (id, patch) =>
        set((state) => ({
          models: state.models.map((x) => (x.id === id ? { ...x, ...patch } : x)),
        })),
    }),
    {
      name: "infinity-settings",
      version: 2,
      partialize: (state) => ({ settings: state.settings, models: state.models }),
      migrate: (state) => {
        const s = state as { settings?: Settings; models?: HoloModel[] };
        return { settings: s.settings ?? DEFAULT_SETTINGS, models: s.models ?? [] };
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

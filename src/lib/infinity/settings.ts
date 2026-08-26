"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Settings } from "./types";
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
  setSettings: (patch: Partial<Settings>) => void;
  resetSettings: () => void;
  setWorkbench: (v: boolean) => void;
}

export const useInfinity = create<InfinityStore>()(
  persist(
    (set) => ({
      settings: DEFAULT_SETTINGS,
      workbench: false,
      setSettings: (patch) =>
        set((state) => ({ settings: { ...state.settings, ...patch } })),
      resetSettings: () => set({ settings: DEFAULT_SETTINGS }),
      setWorkbench: (v) => set({ workbench: v }),
    }),
    {
      name: "infinity-settings",
      version: 1,
      partialize: (state) => ({ settings: state.settings }),
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

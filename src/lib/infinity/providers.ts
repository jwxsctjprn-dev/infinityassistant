import type { ProviderId } from "./types";

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  /** OpenAI-compatible chat completions base URL (no trailing slash) */
  baseUrl: string;
  models: string[];
  defaultModel: string;
  keyHint: string;
  keyUrl: string;
}

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  zai: {
    id: "zai",
    label: "Z.AI",
    baseUrl: "https://api.z.ai/api/paas/v4",
    models: ["glm-4.6", "glm-4.5", "glm-4.5-air", "glm-4.5-flash", "glm-4-flash"],
    defaultModel: "glm-4.6",
    keyHint: "Z.AI API key",
    keyUrl: "https://z.ai/manage/apikey",
  },
  groq: {
    id: "groq",
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    models: [
      "llama-3.3-70b-versatile",
      "llama-3.1-8b-instant",
      "openai/gpt-oss-120b",
      "openai/gpt-oss-20b",
      "qwen/qwen3-32b",
    ],
    defaultModel: "llama-3.3-70b-versatile",
    keyHint: "gsk_...",
    keyUrl: "https://console.groq.com/keys",
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    models: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1"],
    defaultModel: "gpt-4o-mini",
    keyHint: "sk-...",
    keyUrl: "https://platform.openai.com/api-keys",
  },
  custom: {
    id: "custom",
    label: "Custom (OpenAI-compatible)",
    baseUrl: "",
    models: [],
    defaultModel: "",
    keyHint: "Provider API key (optional)",
    keyUrl: "",
  },
};

export interface VoiceInfo {
  name: string;
  label: string;
  gender: "Female" | "Male";
}

/** Microsoft Edge neural voices (subset — the natural-sounding ones) */
export const MS_VOICES: VoiceInfo[] = [
  { name: "en-US-AriaNeural", label: "Aria · US", gender: "Female" },
  { name: "en-US-JennyNeural", label: "Jenny · US", gender: "Female" },
  { name: "en-US-MichelleNeural", label: "Michelle · US", gender: "Female" },
  { name: "en-US-AnaNeural", label: "Ana · US (child)", gender: "Female" },
  { name: "en-US-GuyNeural", label: "Guy · US", gender: "Male" },
  { name: "en-US-RogerNeural", label: "Roger · US", gender: "Male" },
  { name: "en-US-SteffanNeural", label: "Steffan · US", gender: "Male" },
  { name: "en-US-AndrewNeural", label: "Andrew · US", gender: "Male" },
  { name: "en-US-BrianNeural", label: "Brian · US", gender: "Male" },
  { name: "en-GB-SoniaNeural", label: "Sonia · UK", gender: "Female" },
  { name: "en-GB-LibbyNeural", label: "Libby · UK", gender: "Female" },
  { name: "en-GB-RyanNeural", label: "Ryan · UK", gender: "Male" },
  { name: "en-GB-ThomasNeural", label: "Thomas · UK", gender: "Male" },
  { name: "en-AU-NatashaNeural", label: "Natasha · AU", gender: "Female" },
  { name: "en-AU-WilliamNeural", label: "William · AU", gender: "Male" },
  { name: "en-IE-EmilyNeural", label: "Emily · IE", gender: "Female" },
  { name: "en-IN-NeerjaNeural", label: "Neerja · IN", gender: "Female" },
  { name: "en-IN-PrabhatNeural", label: "Prabhat · IN", gender: "Male" },
];

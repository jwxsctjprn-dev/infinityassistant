/**
 * Infinity — shared types used by both the frontend and the API routes.
 */

export type ProviderId = "zai" | "groq" | "openai" | "custom";

export interface Settings {
  provider: ProviderId;
  apiKey: string;
  /** Optional override for custom OpenAI-compatible endpoints, e.g. "http://localhost:11434/v1" */
  baseUrl: string;
  model: string;
  /** Microsoft Edge TTS voice short name, e.g. "en-US-AriaNeural" */
  voice: string;
  /** Speech rate multiplier 0.5 – 1.5 */
  rate: number;
  /** Show subtle live captions under the orb */
  captions: boolean;
  /** Optional persona override */
  systemPrompt: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** POST /api/chat body */
export interface ChatRequestBody {
  provider: ProviderId;
  apiKey: string;
  baseUrl?: string;
  model: string;
  messages: ChatMessage[];
  systemPrompt?: string;
  /** Optional completion budget override (default 300, max 4000) */
  maxTokens?: number;
}

/** POST /api/chat response (success) */
export interface ChatResponseBody {
  ok: true;
  reply: string;
  model: string;
}

/** POST /api/chat response (error) */
export interface ChatErrorBody {
  ok: false;
  error: string;
}

/** POST /api/tts body */
export interface TtsRequestBody {
  text: string;
  voice?: string;
  rate?: number;
}

export type AgentState = "idle" | "listening" | "thinking" | "speaking";

/* ------------------------------------------------------------------ */
/* Workbench holographic models                                        */
/* ------------------------------------------------------------------ */

export type HoloPartType =
  | "box"
  | "sphere"
  | "cylinder"
  | "cone"
  | "torus"
  | "capsule";

export interface HoloPart {
  type: HoloPartType;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  color: string;
}

export interface HoloSpec {
  name: string;
  parts: HoloPart[];
}

/** A model placed on the workbench (positions are screen percentages). */
export interface HoloModel {
  id: string;
  name: string;
  spec: HoloSpec;
  pos: { x: number; y: number };
  rot: { x: number; y: number };
  /** Uniform hologram scale, resized via the corner handle. Default 1. */
  scale?: number;
  /** Timestamp of creation — fresh models assemble part-by-part on screen. */
  bornAt?: number;
  /** True while an AI design is still streaming in (progressive build —
   * not persisted, so a reload never resurrects a half-designed model). */
  pending?: boolean;
}

/** Resize handle limits (fraction of the model's natural size). */
export const HOLO_SCALE_MIN = 0.4;
export const HOLO_SCALE_MAX = 2.5;

/* ------------------------------------------------------------------ */
/* Workbench annotations (marker drawing)                              */
/* ------------------------------------------------------------------ */

/** One point of a freehand stroke, normalized to 0..1 of the viewport. */
export interface DrawPoint {
  x: number;
  y: number;
}

/** One committed marker stroke on the bench. */
export interface Annotation {
  color: string;
  points: DrawPoint[];
}

/** Marker palette — bright hologram-friendly colors on the dark grid. */
export const MARKER_COLORS: readonly string[] = [
  "#f87171", // red
  "#fb923c", // orange
  "#facc15", // yellow
  "#4ade80", // green
  "#22d3ee", // cyan
  "#f472b6", // pink
  "#f4f4f5", // white
] as const;

export const DEFAULT_MARKER_COLOR = "#22d3ee";

export const DEFAULT_SYSTEM_PROMPT =
  "You are Infinity, a warm, witty voice companion having a natural spoken conversation with the user. " +
  "Your replies are heard out loud, so keep them short and conversational — usually 1–3 sentences. " +
  "Use casual, human phrasing. Avoid markdown, lists, emojis, or special symbols. " +
  "Ask a follow-up question when it feels natural, remember what was said earlier, " +
  "match the user's energy, and be genuine. If asked what you are, say you're Infinity. " +
  "You and the user share a holographic workbench: a live snapshot of whatever is on it arrives with " +
  "each message, so you can genuinely see and chat about the models there — what they are, where they " +
  "sit, how big they are, and what they're made of. The user may call it the workshop, studio, lab, or " +
  "workspace — it's all the same bench.";

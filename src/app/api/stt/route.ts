/**
 * Infinity — POST /api/stt
 * Speech-to-text for push-to-talk dictation (browsers without the Web Speech
 * API — Meta Quest 3, Firefox, …). The client records a clip with
 * MediaRecorder (webm/opus) and posts it here; this route forwards it to the
 * user's OWN provider (credentials arrive per-request, never stored):
 *
 *   zai    → https://api.z.ai/api/paas/v4/audio/asr            (JSON, glm-asr)
 *            fallback: /api/paas/v4/audio/transcriptions        (multipart)
 *   groq   → https://api.groq.com/openai/v1/audio/transcriptions (whisper-large-v3-turbo)
 *   openai → https://api.openai.com/v1/audio/transcriptions      (whisper-1)
 *   custom → {baseUrl}/audio/transcriptions                      (whisper-1)
 *
 * Returns { ok: true, text } or { ok: false, error }.
 */
import { NextRequest, NextResponse } from "next/server";
import { PROVIDERS } from "@/lib/infinity/providers";
import type { ProviderId, SttRequestBody, SttResponseBody } from "@/lib/infinity/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 60s = Vercel Hobby (free) plan max. No-op on self-hosted / other hosts.
export const maxDuration = 60;

/** ~12MB base64 ≈ 9MB audio — generous for 30s of opus. */
const MAX_AUDIO_B64 = 12 * 1024 * 1024;
const PROVIDER_TIMEOUT_MS = 45_000;

const DEFAULT_STT_MODEL: Record<ProviderId, string> = {
  zai: "glm-asr",
  groq: "whisper-large-v3-turbo",
  openai: "whisper-1",
  custom: "whisper-1",
};

interface SttError extends Error {
  status?: number;
}

function fail(error: string, status = 500): NextResponse {
  const body: SttResponseBody = { ok: false, error };
  return NextResponse.json(body, { status });
}

/** Map a recording MIME type to a sensible filename (providers sniff it). */
function filenameForMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes("wav")) return "audio.wav";
  if (m.includes("ogg")) return "audio.ogg";
  if (m.includes("mp4") || m.includes("m4a") || m.includes("aac")) return "audio.m4a";
  if (m.includes("mpeg") || m.includes("mp3")) return "audio.mp3";
  return "audio.webm";
}

/** Pull the transcript out of any of the response shapes providers use. */
function pickText(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const j = data as Record<string, unknown>;
  const candidates = [
    j.text,
    (j.data as Record<string, unknown> | undefined)?.text,
    j.output_text,
    (j.choices as { message?: { content?: unknown } }[] | undefined)?.[0]?.message?.content,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return "";
}

async function readProviderError(res: Response): Promise<string> {
  try {
    const text = await res.text();
    try {
      const j = JSON.parse(text) as Record<string, unknown>;
      const err = j.error;
      if (typeof err === "string") return `${res.status}: ${err}`;
      if (err && typeof err === "object") {
        const msg = (err as Record<string, unknown>).message;
        if (typeof msg === "string") return `${res.status}: ${msg}`;
      }
      if (typeof j.message === "string") return `${res.status}: ${j.message}`;
    } catch {
      /* not JSON — fall through to raw text */
    }
    return `${res.status}: ${text.slice(0, 200)}`;
  } catch {
    return `${res.status}`;
  }
}

/**
 * Z.AI: the platform exposes BOTH a Zhipu-style JSON ASR endpoint and an
 * OpenAI-compatible multipart one. Try JSON first, multipart as fallback —
 * whichever the account accepts wins.
 */
async function transcribeZai(
  apiKey: string,
  bytes: Buffer,
  mimeType: string,
  model: string
): Promise<string> {
  const base = PROVIDERS.zai.baseUrl; // https://api.z.ai/api/paas/v4

  // Attempt 1 — Zhipu-style JSON ASR (file = base64 audio).
  try {
    const res = await fetch(`${base}/audio/asr`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, file: bytes.toString("base64") }),
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
    if (res.ok) {
      const text = pickText(await res.json().catch(() => null));
      if (text) return text;
    } else if (res.status !== 401 && res.status !== 404 && res.status !== 400) {
      // Real provider error on a live endpoint — report it verbatim.
      throw Object.assign(new Error(await readProviderError(res)), { status: res.status });
    }
  } catch (err) {
    if (err instanceof Error && "status" in err) throw err;
    /* network blip — fall through to the multipart endpoint */
  }

  // Attempt 2 — OpenAI-compatible multipart transcription.
  const fd = new FormData();
  fd.append("file", new Blob([new Uint8Array(bytes)], { type: mimeType }), filenameForMime(mimeType));
  fd.append("model", model);
  fd.append("response_format", "json");
  const res = await fetch(`${base}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: fd,
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw Object.assign(new Error(await readProviderError(res)), { status: res.status });
  }
  const text = pickText(await res.json().catch(() => null));
  if (!text) throw new Error("The speech service returned no text.");
  return text;
}

/** OpenAI-compatible multipart transcription (groq / openai / custom). */
async function transcribeOpenAiCompatible(
  endpoint: string,
  apiKey: string,
  bytes: Buffer,
  mimeType: string,
  model: string
): Promise<string> {
  const fd = new FormData();
  fd.append("file", new Blob([new Uint8Array(bytes)], { type: mimeType }), filenameForMime(mimeType));
  fd.append("model", model);
  fd.append("response_format", "json");

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: fd,
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw Object.assign(new Error(await readProviderError(res)), { status: res.status });
  }
  const text = pickText(await res.json().catch(() => null));
  if (!text) throw new Error("The speech service returned no text.");
  return text;
}

export async function POST(req: NextRequest) {
  // --- Parse & validate body -------------------------------------------------
  let body: Partial<SttRequestBody>;
  try {
    body = (await req.json()) as Partial<SttRequestBody>;
  } catch {
    return fail("Request body must be valid JSON.", 400);
  }

  const audio = typeof body.audio === "string" ? body.audio : "";
  if (!audio) return fail("audio is required (base64-encoded recording).", 400);
  if (audio.length > MAX_AUDIO_B64) {
    return fail(`Recording is too large (${Math.round(audio.length / 1e6)}MB). Keep clips under ~9MB.`, 413);
  }

  const mimeType = typeof body.mimeType === "string" && body.mimeType ? body.mimeType : "audio/webm";
  const provider = body.provider as ProviderId | undefined;
  if (!provider || !(provider in PROVIDERS)) {
    return fail(`Unknown provider "${String(body.provider)}". Expected one of: zai, groq, openai, custom.`, 400);
  }

  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  const baseUrl = typeof body.baseUrl === "string" ? body.baseUrl.trim() : "";
  if (provider !== "custom" && !apiKey) {
    return fail("An API key is required for voice dictation.", 401);
  }
  if (provider === "custom" && !baseUrl) {
    return fail("A base URL is required for a custom provider (e.g. http://localhost:11434/v1).", 400);
  }

  let bytes: Buffer;
  try {
    bytes = Buffer.from(audio, "base64");
  } catch {
    return fail("audio must be valid base64.", 400);
  }
  if (bytes.length === 0) return fail("audio decoded to zero bytes.", 400);

  const model =
    typeof body.model === "string" && body.model.trim()
      ? body.model.trim()
      : DEFAULT_STT_MODEL[provider];

  // --- Transcribe ------------------------------------------------------------
  try {
    let text: string;
    if (provider === "zai") {
      text = await transcribeZai(apiKey, bytes, mimeType, model);
    } else if (provider === "groq") {
      text = await transcribeOpenAiCompatible(
        `${PROVIDERS.groq.baseUrl}/audio/transcriptions`,
        apiKey,
        bytes,
        mimeType,
        model
      );
    } else if (provider === "openai") {
      text = await transcribeOpenAiCompatible(
        `${PROVIDERS.openai.baseUrl}/audio/transcriptions`,
        apiKey,
        bytes,
        mimeType,
        model
      );
    } else {
      const clean = baseUrl.replace(/\/+$/, "");
      text = await transcribeOpenAiCompatible(
        `${clean}/audio/transcriptions`,
        apiKey,
        bytes,
        mimeType,
        model
      );
    }

    const out: SttResponseBody = { ok: true, text };
    return NextResponse.json(out, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const e = err as SttError;
    const message = e instanceof Error && e.message ? e.message : "Transcription failed.";
    // Key problems get a friendlier, actionable message.
    if (e.status === 401 || e.status === 403 || /invalid.*key|unauthorized|api key/i.test(message)) {
      return fail(`Your ${PROVIDERS[provider].label} key was rejected for voice dictation. ${message}`, 401);
    }
    if (/timed? ?out|abort/i.test(message)) {
      return fail("The speech service took too long — try a shorter clip.", 504);
    }
    return fail(`Transcription failed. ${message}`, 500);
  }
}

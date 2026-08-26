/**
 * Infinity — POST /api/tts
 * Microsoft Edge neural TTS ("Read Aloud") via the msedge-tts package.
 * Returns raw mp3 bytes (audio/mpeg) that the client plays directly.
 */
import { NextRequest, NextResponse } from "next/server";
import { MsEdgeTTS, OUTPUT_FORMAT, PITCH, RATE, VOLUME } from "msedge-tts";
import type { TtsRequestBody } from "@/lib/infinity/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_VOICE = "en-US-AriaNeural";
const MAX_TEXT_LENGTH = 3_000;
const STREAM_TIMEOUT_MS = 30_000;

/** Escape XML special characters so user/LLM text can be embedded in SSML. */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Map a rate multiplier (1.0 = normal) to an SSML relative percentage:
 * 1.0 → "default", 1.25 → "+25%", 0.75 → "-25%".
 * msedge-tts renders this straight into `<prosody rate="...">`.
 */
function rateToProsody(rate: number): string {
  const pct = Math.round((rate - 1) * 100);
  if (pct === 0) return RATE.DEFAULT;
  return `${pct > 0 ? "+" : ""}${pct}%`;
}

function jsonError(error: string, status: number) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function POST(req: NextRequest) {
  // --- Parse & validate body -------------------------------------------------
  let body: Partial<TtsRequestBody>;
  try {
    body = (await req.json()) as Partial<TtsRequestBody>;
  } catch {
    return jsonError("Request body must be valid JSON.", 400);
  }

  const text = typeof body.text === "string" ? body.text : "";
  if (!text.trim()) {
    return jsonError("text is required and must be a non-empty string.", 400);
  }
  if (text.length > MAX_TEXT_LENGTH) {
    return jsonError(`text is too long (${text.length} chars). Maximum is ${MAX_TEXT_LENGTH}.`, 400);
  }

  const voice =
    typeof body.voice === "string" && body.voice.trim() ? body.voice.trim() : DEFAULT_VOICE;

  let rate = typeof body.rate === "number" && Number.isFinite(body.rate) ? body.rate : 1.0;
  rate = Math.min(1.5, Math.max(0.5, rate)); // clamp to [0.5, 1.5]

  // --- Synthesize ------------------------------------------------------------
  const tts = new MsEdgeTTS();
  try {
    // Opens the WebSocket and locks in voice + output format.
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

    // toStream() returns { audioStream, metadataStream } synchronously (not a Promise).
    const { audioStream } = tts.toStream(escapeXml(text), {
      rate: rateToProsody(rate),
      pitch: PITCH.DEFAULT,
      volume: VOLUME.DEFAULT,
    });

    const chunks: Buffer[] = [];
    const timer = setTimeout(() => {
      audioStream.destroy(new Error("Microsoft TTS stream timed out."));
    }, STREAM_TIMEOUT_MS);

    try {
      // for-await ends when the stream closes (turn.end) and throws if it errors.
      for await (const chunk of audioStream) {
        chunks.push(Buffer.from(chunk as Buffer));
      }
    } finally {
      clearTimeout(timer);
    }

    const audio = Buffer.concat(chunks);
    if (audio.length === 0) {
      return jsonError("Microsoft TTS returned no audio data. Try a different voice.", 500);
    }

    return new NextResponse(new Uint8Array(audio), {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/403|token|unauthorized|refused/i.test(message)) {
      return jsonError(`Microsoft TTS service refused the request. ${message}`, 500);
    }
    return jsonError(`Speech synthesis failed: ${message}`, 500);
  } finally {
    // Always drop the WebSocket connection — one request, one connection.
    try {
      tts.close();
    } catch {
      // best effort
    }
  }
}

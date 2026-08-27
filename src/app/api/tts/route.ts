/**
 * Infinity — POST /api/tts
 * Microsoft Edge neural TTS ("Read Aloud") via the msedge-tts package.
 * Returns raw mp3 bytes (audio/mpeg) that the client plays directly.
 *
 * Latency: connections are POOLED and kept warm between requests — each
 * fresh MsEdgeTTS would otherwise pay a WebSocket handshake + voice config
 * (~0.5-1s) before the first audio byte. Idle connections are reused, and
 * a broken one transparently falls back to a fresh instance.
 */
import { NextRequest, NextResponse } from "next/server";
import { MsEdgeTTS, OUTPUT_FORMAT, PITCH, RATE, VOLUME } from "msedge-tts";
import type { TtsRequestBody } from "@/lib/infinity/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_VOICE = "en-US-AriaNeural";
const MAX_TEXT_LENGTH = 3_000;
const STREAM_TIMEOUT_MS = 30_000;
const FORMAT = OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3;

/* ------------------------------------------------------------------ */
/* Warm connection pool                                                 */
/* ------------------------------------------------------------------ */

interface Pooled {
  tts: MsEdgeTTS;
  voice: string;
  busy: boolean;
  bornAt: number;
}

const pool: Pooled[] = [];
/** Idle connections kept warm for the next request. */
const MAX_IDLE = 2;
/** Recycle after 10 minutes — Microsoft drops long-lived sockets anyway. */
const MAX_AGE_MS = 10 * 60 * 1000;

function prunePool() {
  const now = Date.now();
  for (let i = pool.length - 1; i >= 0; i--) {
    const p = pool[i];
    if (!p.busy && now - p.bornAt > MAX_AGE_MS) {
      try {
        p.tts.close();
      } catch {
        /* already dead */
      }
      pool.splice(i, 1);
    }
  }
}

async function acquire(voice: string): Promise<Pooled | null> {
  prunePool();
  let p = pool.find((x) => !x.busy);
  if (p) {
    p.busy = true;
    if (p.voice !== voice) {
      // Reconfigure the open socket for a different voice (no new handshake).
      await p.tts.setMetadata(voice, FORMAT);
      p.voice = voice;
      p.bornAt = Date.now();
    }
    return p;
  }
  try {
    const tts = new MsEdgeTTS();
    await tts.setMetadata(voice, FORMAT);
    p = { tts, voice, busy: true, bornAt: Date.now() };
    pool.push(p);
    return p;
  } catch {
    return null;
  }
}

function release(p: Pooled, broken = false) {
  if (broken) {
    const i = pool.indexOf(p);
    if (i >= 0) pool.splice(i, 1);
    try {
      p.tts.close();
    } catch {
      /* already dead */
    }
    return;
  }
  p.busy = false;
  // Keep the pool small: at most MAX_IDLE idle warm connections.
  const idle = pool.filter((x) => !x.busy);
  while (idle.length > MAX_IDLE) {
    const x = idle.shift()!;
    const i = pool.indexOf(x);
    if (i >= 0) pool.splice(i, 1);
    try {
      x.tts.close();
    } catch {
      /* already dead */
    }
  }
}

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

/** Drain one synthesis into a Buffer (throws on timeout / stream error). */
async function collect(tts: MsEdgeTTS, text: string, rate: number): Promise<Buffer> {
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
    throw new Error("Microsoft TTS returned no audio data.");
  }
  return audio;
}

/** Synthesize with pool reuse; one retry on a FRESH instance if the pooled
 *  socket misbehaves (stale keepalive, mid-stream drop, …). */
async function synthesize(voice: string, text: string, rate: number): Promise<Buffer> {
  const pooled = await acquire(voice);
  if (pooled) {
    try {
      const audio = await collect(pooled.tts, text, rate);
      release(pooled);
      return audio;
    } catch {
      release(pooled, true); // broken — drop it and retry fresh
    }
  }

  const tts = new MsEdgeTTS();
  try {
    await tts.setMetadata(voice, FORMAT);
    return await collect(tts, text, rate);
  } finally {
    try {
      tts.close();
    } catch {
      /* best effort */
    }
  }
}

// Prewarm one connection shortly after the module first loads, so the first
// real request skips the WebSocket handshake entirely.
setTimeout(() => {
  void acquire(DEFAULT_VOICE)
    .then((p) => {
      if (p) release(p);
    })
    .catch(() => {
      /* prewarm is best-effort */
    });
}, 50);

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
  try {
    const audio = await synthesize(voice, text, rate);
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
  }
}

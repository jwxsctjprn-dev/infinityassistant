/**
 * Infinity — POST /api/model
 * Streaming AI hologram DESIGNER. Proxies the provider's SSE stream as
 * newline-delimited JSON events so the client can show REAL design
 * progress and long generations never hit a fixed-timeout wall.
 *
 * Event lines (one JSON object per line):
 *   {"t":"open"}                      — stream established (sent immediately)
 *   {"t":"ping"}                      — keepalive every 5s (proxies stay warm)
 *   {"t":"phase","v":"designing"}     — provider is reasoning before output
 *   {"t":"delta","v":"..."}           — a piece of the design text
 *   {"t":"done","finish":"stop"}      — provider finished ("stop"|"length"|…)
 *   {"t":"error","v":"message"}       — any failure before/while streaming
 *
 * Resilience:
 *   - keepalive pings every 5s so no gateway can idle-kill the connection
 *   - 45s budget for the provider's FIRST byte (queue/slow-start time —
 *     thinking is disabled for GLM reasoning models, so this is generous)
 *   - 25s idle watchdog DURING the stream (reset by every provider chunk)
 *   - 120s absolute cap (the client aborts at 35s anyway — this is the
 *     backstop for abandoned tabs)
 *   - up to 3 attempts on transient failures (network, 429/5xx, empty
 *     streams) — only retried while nothing has been forwarded
 *   - every attempt + outcome is logged server-side ([model] … in dev.log)
 *
 * Pre-stream validation failures respond with normal JSON {ok:false,error}.
 * Credentials arrive per-request and are never stored.
 */
import { NextRequest, NextResponse } from "next/server";
import { PROVIDERS } from "@/lib/infinity/providers";
import { DESIGN_SYSTEM } from "@/lib/infinity/holo-ai";
import type { ProviderId } from "@/lib/infinity/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 60s = Vercel Hobby (free) plan max. No-op on self-hosted / other hosts.
export const maxDuration = 60;

interface ProviderDelta {
  content?: unknown;
  reasoning_content?: unknown;
}
interface ProviderStreamChunk {
  choices?: {
    delta?: ProviderDelta;
    finish_reason?: unknown;
  }[];
  error?: { message?: unknown };
}

/** Abort when EITHER the client disconnects or a timeout expires. */
function timeoutOrAbort(clientSignal: AbortSignal, ms: number): AbortSignal {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  const onClientAbort = () => {
    clearTimeout(timer);
    ctl.abort();
  };
  if (clientSignal.aborted) {
    clearTimeout(timer);
    ctl.abort();
  } else {
    clientSignal.addEventListener("abort", onClientAbort, { once: true });
  }
  ctl.signal.addEventListener(
    "abort",
    () => {
      clearTimeout(timer);
      clientSignal.removeEventListener("abort", onClientAbort);
    },
    { once: true }
  );
  return ctl.signal;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Server-side diagnostics: every [model] line lands in dev.log. */
const log = (msg: string) => {
  console.log(`[model] ${msg}`);
};

/** GLM models that reason by default (10-60s of hidden thinking before a
 * single output token). Designing a part list is a formatting task — the
 * thinking adds latency without adding quality, so it is switched off.
 * Older/non-reasoning models never receive the parameter (their APIs may
 * reject unknown fields). */
const THINKING_BY_DEFAULT = /^glm-4\.[56]/i;

function designRequestBody(model: string, object: string, instruction?: string): Record<string, unknown> {
  const user = instruction ?? `Design a model of: ${object}`;
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: DESIGN_SYSTEM },
      { role: "user", content: user },
    ],
    temperature: 0.6,
    // A 14-part design is ~600 tokens; 3000 is generous headroom and keeps
    // a pathological loop from streaming for minutes.
    max_tokens: 3000,
    stream: true,
  };
  if (THINKING_BY_DEFAULT.test(model.trim())) {
    body.thinking = { type: "disabled" };
  }
  return body;
}

export async function POST(req: NextRequest): Promise<Response> {
  // --- Parse body -----------------------------------------------------------
  let body: Partial<{
    provider: unknown;
    apiKey: unknown;
    baseUrl: unknown;
    model: unknown;
    object: unknown;
    instruction: unknown;
  }>;
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Request body must be valid JSON." }, { status: 400 });
  }

  const provider = body.provider as string | undefined;
  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  const baseUrlOverride = typeof body.baseUrl === "string" ? body.baseUrl.trim() : "";
  const model = typeof body.model === "string" ? body.model.trim() : "";
  const object = typeof body.object === "string" ? body.object.trim().slice(0, 120) : "";
  const instruction =
    typeof body.instruction === "string" ? body.instruction.slice(0, 6000) : undefined;

  // --- Validate -------------------------------------------------------------
  if (!provider || !(provider in PROVIDERS)) {
    return NextResponse.json(
      { ok: false, error: `Unknown provider "${String(provider)}". Expected one of: zai, groq, openai, custom.` },
      { status: 400 }
    );
  }
  if (provider !== "custom" && !apiKey) {
    return NextResponse.json({ ok: false, error: "An API key is required for this provider." }, { status: 400 });
  }
  if (!model) {
    return NextResponse.json(
      { ok: false, error: "A model id is required (e.g. glm-4.6, llama-3.3-70b-versatile, gpt-4o-mini)." },
      { status: 400 }
    );
  }
  if (!object) {
    return NextResponse.json({ ok: false, error: "An object description is required." }, { status: 400 });
  }

  // --- Resolve base URL -----------------------------------------------------
  const info = PROVIDERS[provider as ProviderId];
  let baseUrl: string;
  if (provider === "custom" || baseUrlOverride) {
    baseUrl = baseUrlOverride.replace(/\/+$/, "");
  } else {
    baseUrl = info.baseUrl;
  }
  if (!baseUrl) {
    return NextResponse.json(
      { ok: false, error: "A base URL is required for a custom provider (e.g. http://localhost:11434/v1)." },
      { status: 400 }
    );
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let idleTimer: ReturnType<typeof setTimeout> | null = null;
      let hardTimer: ReturnType<typeof setTimeout> | null = null;
      let keepAlive: ReturnType<typeof setInterval> | null = null;
      let forwarded = false; // has any design text been sent to the client?
      const readerRef: { current: ReadableStreamDefaultReader<Uint8Array> | null } = { current: null };
      const t0 = Date.now();

      const send = (obj: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
        } catch {
          closed = true;
        }
      };
      const cleanup = () => {
        if (idleTimer) clearTimeout(idleTimer);
        if (hardTimer) clearTimeout(hardTimer);
        if (keepAlive) clearInterval(keepAlive);
        idleTimer = null;
        hardTimer = null;
        keepAlive = null;
      };
      const close = () => {
        if (closed) return;
        closed = true;
        cleanup();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      const fail = (msg: string) => {
        if (closed) return;
        log(`FAIL (${((Date.now() - t0) / 1000).toFixed(1)}s): ${msg}`);
        send({ t: "error", v: msg });
        try {
          readerRef.current?.cancel().catch(() => undefined);
        } catch {
          /* noop */
        }
        close();
      };
      const armIdle = () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(
          () => fail(`${info.label} stopped sending data mid-design. Try again.`),
          25_000
        );
      };

      const extractDetail = async (res: Response): Promise<string> => {
        const raw = await res.text().catch(() => "");
        let detail = raw.slice(0, 300);
        try {
          const parsed = JSON.parse(raw) as ProviderStreamChunk;
          if (parsed.error && typeof parsed.error.message === "string") {
            detail = parsed.error.message.slice(0, 300);
          }
        } catch {
          /* keep raw snippet */
        }
        return detail;
      };

      // Whisper every 5s so no proxy/gateway can idle-timeout this response
      // while the provider thinks, queues, or retries.
      keepAlive = setInterval(() => send({ t: "ping" }), 5_000);
      hardTimer = setTimeout(() => fail("The design took too long and was cancelled."), 120_000);

      const RETRYABLE = new Set([429, 500, 502, 503, 504]);
      const MAX_ATTEMPTS = 3;

      log(`start provider=${provider} model=${model} object="${object}"`);
      try {
        send({ t: "open" });

        let succeeded = false;
        for (let attempt = 1; attempt <= MAX_ATTEMPTS && !succeeded && !closed; attempt++) {
          if (attempt > 1) {
            log(`retry attempt ${attempt}/${MAX_ATTEMPTS}`);
            send({ t: "ping" });
            await sleep(700 * attempt);
            if (closed || req.signal.aborted) return;
          }

          let providerRes: Response;
          try {
            providerRes = await fetch(`${baseUrl}/chat/completions`, {
              method: "POST",
              headers,
              body: JSON.stringify(designRequestBody(model, object, instruction)),
              // 45s for the provider's first byte — thinking is off for GLM
              // reasoning models, so this only covers queueing and slow starts.
              signal: timeoutOrAbort(req.signal, 45_000),
            });
          } catch (err) {
            if (req.signal.aborted) {
              log("client disconnected before response");
              return;
            }
            if (err instanceof DOMException && err.name === "AbortError") {
              log(`attempt ${attempt}: no first byte within 45s`);
              if (attempt < MAX_ATTEMPTS) continue;
              fail(`${info.label} took too long to start responding. Try again.`);
              return;
            }
            log(`attempt ${attempt}: network error reaching ${baseUrl}`);
            if (attempt < MAX_ATTEMPTS) continue;
            fail(
              `Could not reach ${info.label} at ${baseUrl}. Check the base URL and your network, then try again.`
            );
            return;
          }

          if (!providerRes.ok) {
            const status = providerRes.status;
            const detail = await extractDetail(providerRes);
            log(`attempt ${attempt}: HTTP ${status}${detail ? ` — ${detail}` : ""}`);
            if (RETRYABLE.has(status) && attempt < MAX_ATTEMPTS) continue;
            if (status === 401 || status === 403) {
              fail(
                `${info.label} rejected the API key (HTTP ${status}) — the key looks invalid or unauthorized.` +
                  (info.keyUrl ? ` Get a valid key at ${info.keyUrl}.` : "") +
                  (detail ? ` ${info.label} says: ${detail}` : "")
              );
            } else {
              fail(
                `${info.label} request failed (HTTP ${status}).` +
                  (detail ? ` ${info.label} says: ${detail}` : "")
              );
            }
            return;
          }

          if (!providerRes.body) {
            log(`attempt ${attempt}: 200 but no body`);
            if (attempt < MAX_ATTEMPTS) continue;
            fail(`${info.label} returned no stream. Try again or switch models.`);
            return;
          }

          const reader = providerRes.body.getReader();
          readerRef.current = reader;
          armIdle();

          let buf = "";
          let finish = "stop";
          let sawOutput = false;
          let sentDesigning = false;
          let contentChars = 0;
          let reasoningChars = 0;
          let firstByteAt = 0;

          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              if (!firstByteAt) firstByteAt = Date.now() - t0;
              armIdle(); // every provider chunk proves it's alive
              buf += decoder.decode(value, { stream: true });

              let nl: number;
              while ((nl = buf.indexOf("\n")) >= 0) {
                const line = buf.slice(0, nl).trim();
                buf = buf.slice(nl + 1);
                if (!line.startsWith("data:")) continue;
                const payload = line.slice(5).trim();
                if (!payload || payload === "[DONE]") continue;
                try {
                  const chunk = JSON.parse(payload) as ProviderStreamChunk;
                  const choice = chunk.choices?.[0];
                  const reasoning = choice?.delta?.reasoning_content;
                  if (typeof reasoning === "string" && reasoning) {
                    reasoningChars += reasoning.length;
                    if (!sentDesigning) {
                      sentDesigning = true;
                      send({ t: "phase", v: "designing" }); // still thinking, alive
                    }
                  }
                  const content = choice?.delta?.content;
                  if (typeof content === "string" && content) {
                    sawOutput = true;
                    forwarded = true;
                    contentChars += content.length;
                    send({ t: "delta", v: content });
                  }
                  if (choice && typeof choice.finish_reason === "string" && choice.finish_reason) {
                    finish = choice.finish_reason;
                  }
                } catch {
                  /* keepalive / partial line — ignore */
                }
              }
            }
          } catch {
            if (closed) return; // idle watchdog already reported
            log(
              `attempt ${attempt}: stream interrupted after ${contentChars} content chars / ${reasoningChars} reasoning chars`
            );
            if (forwarded) {
              // real content reached the client — closing the NDJSON stream now
              // lets the client's salvage parser keep what it got
              close();
              return;
            }
            fail(`The connection to ${info.label} was interrupted mid-design. Try again.`);
            return;
          } finally {
            if (idleTimer) {
              clearTimeout(idleTimer);
              idleTimer = null;
            }
          }

          log(
            `attempt ${attempt}: done finish=${finish} content=${contentChars} reasoning=${reasoningChars}` +
              ` firstByte=${firstByteAt ? `${(firstByteAt / 1000).toFixed(1)}s` : "never"}`
          );

          if (sawOutput) {
            send({ t: "done", finish });
            succeeded = true;
            break;
          }
          // 200 but zero content → usually a transient gateway blip
          if (attempt < MAX_ATTEMPTS) continue;
          fail(`${info.label} returned an empty stream. Try again or switch models.`);
          return;
        }

        if (succeeded) {
          log(`OK (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
        }
      } finally {
        close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}

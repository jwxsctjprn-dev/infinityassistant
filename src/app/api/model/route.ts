/**
 * Infinity — POST /api/model
 * Streaming 3D model-spec generator. Proxies the provider's SSE stream as
 * newline-delimited JSON events so the client can show REAL build progress
 * and long generations never hit a fixed-timeout wall.
 *
 * Event lines (one JSON object per line):
 *   {"t":"open"}                     — stream established (sent immediately)
 *   {"t":"delta","v":"..."}          — a piece of the model spec text
 *   {"t":"done","finish":"stop"}     — provider finished ("stop" | "length" | ...)
 *   {"t":"error","v":"message"}      — any failure before/while streaming
 *
 * Pre-stream validation failures respond with normal JSON {ok:false,error}.
 * Credentials arrive per-request and are never stored.
 */
import { NextRequest, NextResponse } from "next/server";
import { PROVIDERS } from "@/lib/infinity/providers";
import { MODEL_GEN_SYSTEM } from "@/lib/infinity/holo";
import type { ProviderId } from "@/lib/infinity/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ProviderStreamChunk {
  choices?: {
    delta?: { content?: unknown };
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

export async function POST(req: NextRequest): Promise<Response> {
  // --- Parse body -----------------------------------------------------------
  let body: Partial<{
    provider: unknown;
    apiKey: unknown;
    baseUrl: unknown;
    model: unknown;
    object: unknown;
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

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let idleTimer: ReturnType<typeof setTimeout> | null = null;
      let hardTimer: ReturnType<typeof setTimeout> | null = null;
      const readerRef: { current: ReadableStreamDefaultReader<Uint8Array> | null } = { current: null };

      const cleanup = () => {
        if (idleTimer) clearTimeout(idleTimer);
        if (hardTimer) clearTimeout(hardTimer);
        idleTimer = null;
        hardTimer = null;
      };
      const send = (obj: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
        } catch {
          closed = true;
        }
      };
      const fail = (msg: string) => {
        if (closed) return;
        send({ t: "error", v: msg });
        closed = true;
        cleanup();
        try {
          readerRef.current?.cancel().catch(() => undefined);
        } catch {
          /* noop */
        }
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      const armIdle = () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(
          () => fail(`${info.label} stopped sending data mid-build. Try again.`),
          35_000
        );
      };

      // Hard budget for the whole generation (very generous — real builds
      // stream continuously, so this only guards true zombies).
      hardTimer = setTimeout(() => fail("The build took too long and was cancelled."), 300_000);

      try {
        // First byte leaves immediately — proxies/gateways never idle-timeout.
        send({ t: "open" });

        const providerRes = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: MODEL_GEN_SYSTEM },
              { role: "user", content: `Build a holographic model of: ${object}` },
            ],
            temperature: 0.7,
            max_tokens: 4000,
            stream: true,
          }),
          // 60s to first byte (provider queue), then the idle watchdog rules.
          signal: timeoutOrAbort(req.signal, 60_000),
        }).catch((err: unknown) => {
          if (req.signal.aborted) throw new DOMException("Aborted", "AbortError");
          throw err;
        });

        if (!providerRes.ok) {
          const raw = await providerRes.text().catch(() => "");
          let detail = raw.slice(0, 300);
          try {
            const parsed = JSON.parse(raw) as ProviderStreamChunk;
            if (parsed.error && typeof parsed.error.message === "string") {
              detail = parsed.error.message.slice(0, 300);
            }
          } catch {
            /* keep raw snippet */
          }
          if (providerRes.status === 401 || providerRes.status === 403) {
            fail(
              `${info.label} rejected the API key (HTTP ${providerRes.status}) — the key looks invalid or unauthorized.` +
                (info.keyUrl ? ` Get a valid key at ${info.keyUrl}.` : "") +
                (detail ? ` ${info.label} says: ${detail}` : "")
            );
          } else {
            fail(
              `${info.label} request failed (HTTP ${providerRes.status}).` +
                (detail ? ` ${info.label} says: ${detail}` : "")
            );
          }
          return;
        }

        if (!providerRes.body) {
          fail(`${info.label} returned no stream. Try again or switch models.`);
          return;
        }

        const reader = providerRes.body.getReader();
        readerRef.current = reader;
        armIdle();

        let buf = "";
        let finish = "stop";
        let sawContent = false;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          armIdle(); // every chunk proves the provider is alive
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
              const content = choice?.delta?.content;
              if (typeof content === "string" && content) {
                sawContent = true;
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

        if (!sawContent) {
          fail(`${info.label} returned an empty stream. Try again or switch models.`);
          return;
        }
        send({ t: "done", finish });
      } catch (err) {
        if (!closed) {
          if (req.signal.aborted) {
            closed = true; // client went away — nothing to report
          } else if (err instanceof DOMException && err.name === "AbortError") {
            fail(`${info.label} took too long to start responding. Try again.`);
          } else {
            fail(
              `Could not reach ${info.label} at ${baseUrl}. Check the base URL and your network, then try again.`
            );
          }
        }
      } finally {
        cleanup();
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
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

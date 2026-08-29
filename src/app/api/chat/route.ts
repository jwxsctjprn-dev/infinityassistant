/**
 * Infinity — POST /api/chat
 * OpenAI-compatible LLM proxy. The client sends its own provider credentials
 * per-request; nothing is stored server-side.
 *
 * Two response modes:
 *   stream: false (default) → JSON {ok, reply, model}
 *   stream: true            → NDJSON event stream (same contract as /api/model):
 *       {"t":"open"}                    — stream established
 *       {"t":"ping"}                    — keepalive every 5s
 *       {"t":"delta","v":"…"}           — a piece of the reply
 *       {"t":"done","model":"…"}        — reply finished
 *       {"t":"error","v":"message"}     — any failure mid-stream
 *
 * Latency: GLM 4.5/4.6 reasoning ("thinking") is disabled for conversation —
 * a spoken companion needs the first sentence in ~1s, not 10-60s of hidden
 * chain-of-thought before a single output token.
 */
import { NextRequest, NextResponse } from "next/server";
import { PROVIDERS } from "@/lib/infinity/providers";
import {
  DEFAULT_SYSTEM_PROMPT,
  type ChatErrorBody,
  type ChatRequestBody,
  type ChatResponseBody,
  type ProviderId,
} from "@/lib/infinity/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 60s = Vercel Hobby (free) plan max. No-op on self-hosted / other hosts.
export const maxDuration = 60;

interface ProviderChatResponse {
  choices?: { message?: { content?: unknown } }[];
  model?: unknown;
  error?: { message?: unknown };
}

interface ProviderStreamChunk {
  choices?: {
    delta?: { content?: unknown };
    finish_reason?: unknown;
  }[];
  error?: { message?: unknown };
}

/** GLM models that reason by default — thinking is switched off for chat
 *  (10-60s of hidden reasoning before the first token is fatal for a voice
 *  companion; conversational quality is unaffected). */
const THINKING_BY_DEFAULT = /^glm-4\.[56]/i;

function jsonError(error: string, status: number): NextResponse<ChatErrorBody> {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function POST(req: NextRequest): Promise<NextResponse<ChatResponseBody | ChatErrorBody> | Response> {
  // --- Parse body -----------------------------------------------------------
  let body: Partial<ChatRequestBody & { stream?: unknown }>;
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonError("Request body must be valid JSON.", 400);
  }

  const provider = body.provider;
  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  const baseUrlOverride = typeof body.baseUrl === "string" ? body.baseUrl.trim() : "";
  const model = typeof body.model === "string" ? body.model.trim() : "";
  const maxTokensRaw = typeof body.maxTokens === "number" ? body.maxTokens : 300;
  const maxTokens = Math.max(64, Math.min(4000, Math.round(maxTokensRaw)));
  const systemPrompt = typeof body.systemPrompt === "string" ? body.systemPrompt.trim() : "";
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const stream = body.stream === true;

  // --- Validate -------------------------------------------------------------
  if (!provider || !(provider in PROVIDERS)) {
    return jsonError(
      `Unknown provider "${String(provider)}". Expected one of: zai, groq, openai, custom.`,
      400
    );
  }
  if (provider !== "custom" && !apiKey) {
    return jsonError("An API key is required for this provider.", 400);
  }
  if (!model) {
    return jsonError("A model id is required (e.g. glm-4.6, llama-3.3-70b-versatile, gpt-4o-mini).", 400);
  }
  if (messages.length === 0) {
    return jsonError("messages must be a non-empty array of {role, content} objects.", 400);
  }
  for (const msg of messages) {
    if (
      !msg ||
      typeof msg.content !== "string" ||
      !["system", "user", "assistant"].includes(msg.role)
    ) {
      return jsonError(
        "Every message must be an object with role (system|user|assistant) and string content.",
        400
      );
    }
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
    return jsonError(
      "A base URL is required for a custom provider (e.g. http://localhost:11434/v1).",
      400
    );
  }

  // --- Call provider --------------------------------------------------------
  const outboundMessages = [
    { role: "system", content: systemPrompt || DEFAULT_SYSTEM_PROMPT },
    ...messages.map((msg) => ({ role: msg.role, content: msg.content })),
  ];

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const payload: Record<string, unknown> = {
    model,
    messages: outboundMessages,
    temperature: 0.8,
    max_tokens: maxTokens,
    stream,
  };
  if (THINKING_BY_DEFAULT.test(model)) {
    payload.thinking = { type: "disabled" };
  }

  let providerRes: Response;
  try {
    providerRes = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    return jsonError(
      `Could not reach ${info.label} at ${baseUrl}. Check the base URL and your network, then try again.`,
      502
    );
  }

  // --- Handle provider errors (mirror the provider's status code) ------------
  if (!providerRes.ok) {
    const raw = await providerRes.text().catch(() => "");
    let detail = raw.slice(0, 300);
    try {
      const parsed = JSON.parse(raw) as ProviderChatResponse;
      if (parsed.error && typeof parsed.error.message === "string") {
        detail = parsed.error.message.slice(0, 300);
      }
    } catch {
      // keep the raw text snippet (or empty string)
    }

    if (providerRes.status === 401 || providerRes.status === 403) {
      return jsonError(
        `${info.label} rejected the API key (HTTP ${providerRes.status}) — the key looks invalid or unauthorized.` +
          (info.keyUrl ? ` Get a valid key at ${info.keyUrl}.` : "") +
          (detail ? ` ${info.label} says: ${detail}` : ""),
        providerRes.status
      );
    }
    return jsonError(
      `${info.label} request failed (HTTP ${providerRes.status}).` +
        (detail ? ` ${info.label} says: ${detail}` : ""),
      providerRes.status
    );
  }

  // --- Non-streaming: parse the complete reply ------------------------------
  if (!stream) {
    let data: ProviderChatResponse;
    try {
      data = (await providerRes.json()) as ProviderChatResponse;
    } catch {
      return jsonError(`${info.label} returned a non-JSON response (HTTP 200).`, 502);
    }

    const reply = data.choices?.[0]?.message?.content;
    if (typeof reply !== "string" || !reply.trim()) {
      return jsonError(
        `${info.label} returned an empty reply. Try again or switch models.`,
        502
      );
    }

    return NextResponse.json({
      ok: true,
      reply: reply.trim(),
      model: typeof data.model === "string" && data.model ? data.model : model,
    });
  }

  // --- Streaming: proxy the provider's SSE as NDJSON events ------------------
  if (!providerRes.body) {
    return jsonError(`${info.label} returned no stream. Try again or switch models.`, 502);
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const out = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const t0 = Date.now();
      const send = (obj: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
        } catch {
          closed = true;
        }
      };
      const keepAlive = setInterval(() => send({ t: "ping" }), 5_000);
      const stop = () => {
        if (closed) return;
        closed = true;
        clearInterval(keepAlive);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      const reader = providerRes.body!.getReader();
      let chars = 0;
      try {
        send({ t: "open" });
        let buf = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line.startsWith("data:")) continue;
            const payloadLine = line.slice(5).trim();
            if (!payloadLine || payloadLine === "[DONE]") continue;
            try {
              const chunk = JSON.parse(payloadLine) as ProviderStreamChunk;
              const choice = chunk.choices?.[0];
              const content = choice?.delta?.content;
              if (typeof content === "string" && content) {
                chars += content.length;
                send({ t: "delta", v: content });
              }
            } catch {
              /* keepalive / partial line — ignore */
            }
          }
        }
        if (chars === 0) {
          send({ t: "error", v: `${info.label} returned an empty reply. Try again or switch models.` });
        } else {
          send({ t: "done", model });
        }
        console.log(`[chat] OK stream (${((Date.now() - t0) / 1000).toFixed(1)}s, ${chars} chars)`);
      } catch {
        if (chars > 0) {
          send({ t: "done", model }); // client keeps what it got
        } else {
          send({ t: "error", v: `The connection to ${info.label} was interrupted. Try again.` });
        }
      } finally {
        stop();
      }
    },
  });

  return new Response(out, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}

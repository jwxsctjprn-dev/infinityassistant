/**
 * Infinity — POST /api/chat
 * OpenAI-compatible LLM proxy. The client sends its own provider credentials
 * per-request; nothing is stored server-side.
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

interface ProviderChatResponse {
  choices?: { message?: { content?: unknown } }[];
  model?: unknown;
  error?: { message?: unknown };
}

function jsonError(error: string, status: number): NextResponse<ChatErrorBody> {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function POST(req: NextRequest): Promise<NextResponse<ChatResponseBody | ChatErrorBody>> {
  // --- Parse body -----------------------------------------------------------
  let body: Partial<ChatRequestBody>;
  try {
    body = (await req.json()) as Partial<ChatRequestBody>;
  } catch {
    return jsonError("Request body must be valid JSON.", 400);
  }

  const provider = body.provider;
  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  const baseUrlOverride = typeof body.baseUrl === "string" ? body.baseUrl.trim() : "";
  const model = typeof body.model === "string" ? body.model.trim() : "";
  const systemPrompt = typeof body.systemPrompt === "string" ? body.systemPrompt.trim() : "";
  const messages = Array.isArray(body.messages) ? body.messages : [];

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

  let providerRes: Response;
  try {
    providerRes = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        messages: outboundMessages,
        temperature: 0.8,
        max_tokens: 300,
        stream: false,
      }),
      signal: AbortSignal.timeout(45_000),
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

  // --- Parse success --------------------------------------------------------
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

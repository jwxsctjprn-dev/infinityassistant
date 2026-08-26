# Infinity — Worklog

Project: "Infinity" — minimal macOS-style voice chat app. Black background, one reactive blue orb in the middle, one settings button. Real back-and-forth AI conversation: user speaks (Web Speech API STT) → LLM (user's own API key: Z.AI / Groq / OpenAI / custom OpenAI-compatible) → Microsoft TTS (Edge neural voices) speaks the reply → auto-resume listening. Loop.

Key architecture decisions:
- Route: only `/` page (src/app/page.tsx). Backend via API routes: `/api/chat`, `/api/tts`.
- BYO-key: frontend stores settings in localStorage; key is sent per-request to our API route which proxies to the provider (never stored server-side).
- Microsoft TTS: `msedge-tts` npm package in /api/tts (Node runtime), returns mp3 bytes.
- STT: browser Web Speech API (webkitSpeechRecognition), continuous with interim results.
- Orb reactivity: mic input level + TTS output level via Web Audio AnalyserNode → CSS variable --level drives scale/glow.

---
Task ID: 1
Agent: main (Z.ai Code)
Task: Define shared types, provider registry, and settings storage contract.

Work Log:
- Created /home/z/my-project/worklog.md
- Writing src/lib/infinity/types.ts (settings + shared API types)
- Writing src/lib/infinity/providers.ts (Z.AI, Groq, OpenAI, custom base URLs + default models + MS Edge TTS voice catalog)

Stage Summary:
- Contracts below in these files; backend subagent must implement /api/chat and /api/tts to match them exactly.

---
Task ID: 2
Agent: full-stack-developer
Task: Build backend APIs for "Infinity" voice chat app — /api/chat (OpenAI-compatible LLM proxy for zai/groq/openai/custom, BYO-key) and /api/tts (Microsoft Edge neural TTS via msedge-tts, returns mp3) — plus curl verification and lint.

Work Log:
- Installed msedge-tts@2.0.7 via `bun add msedge-tts` (first try, latest version worked)
- Read node_modules/msedge-tts dist/*.d.ts + MsEdgeTTS.js to confirm exact API: `new MsEdgeTTS()`, `await setMetadata(voice, OUTPUT_FORMAT)`, `toStream(input, ProsodyOptions)` returns `{audioStream: Readable, metadataStream}` SYNCHRONOUSLY (not a Promise, despite JSDoc), `close()` drops the WebSocket. Text is interpolated raw into `<prosody>` inside its SSML template → must XML-escape & < > myself. `ProsodyOptions.rate` accepts RATE enum | number | "+25%"-style string, rendered directly as `rate="..."`.
- Created src/app/api/chat/route.ts — nodejs runtime, force-dynamic, POST only. Validates provider/apiKey/model/messages; resolves baseUrl from PROVIDERS (body.baseUrl override for custom, trailing slashes trimmed, 400 if empty); prepends `{role:"system", content: systemPrompt || DEFAULT_SYSTEM_PROMPT}`; POSTs `{baseUrl}/chat/completions` with temperature 0.8 / max_tokens 300 / stream false + 45s AbortSignal.timeout. Success → `{ok:true, reply (trimmed), model}`. Provider errors → SAME status code with provider-labelled message (401/403 → "API key looks invalid", includes provider's error.message snippet + keyUrl). Fetch/network failure → 502 "Could not reach <label> ...". Authorization header omitted when apiKey empty (custom/local endpoints like ollama).
- Created src/app/api/tts/route.ts — nodejs runtime, force-dynamic, POST only. Defaults voice "en-US-AriaNeural", rate 1.0 (clamped 0.5–1.5); validates text non-empty & ≤3000 chars (400s). setMetadata with AUDIO_24KHZ_48KBITRATE_MONO_MP3, toStream(escapeXml(text), {rate: rateToProsody(rate), pitch: PITCH.DEFAULT, volume: VOLUME.DEFAULT}), collects chunks via for-await with 30s stream timeout, responds 200 audio/mpeg + Cache-Control: no-store. 403/token errors → "Microsoft TTS service refused the request". tts.close() in finally.
- Rate control: multiplier → SSML relative percentage via ProsodyOptions (1.25→"+25%", 0.75→"-25%", 1.0→RATE.DEFAULT "default"). VERIFIED working: same text at rate 0.6 → 74,448 bytes vs rate 1.4 → 32,112 bytes (constant 48kbps bitrate ⇒ ~2.3× duration difference).
- Curl verification against running dev server: TTS 200 audio/mpeg /tmp/tts-test.mp3 = 12,672 bytes, `file` = "MPEG ADTS, layer III, v2, 48 kbps, 24 kHz, Monaural". XML-special-chars text (Fish & chips <delicious> > everything) also synthesizes 200 (23,616 bytes).
- Chat error paths: groq/gsk_invalid → HTTP 403 clean JSON "...Groq rejected the API key... Groq says: Forbidden"; zai/badkey → HTTP 401 clean JSON "...Z.AI rejected the API key... Z.AI says: token expired or incorrect". Also verified: custom+no baseUrl/model → 400; unreachable custom baseUrl → 502 "Could not reach Custom..."; empty/oversized TTS text → 400. No crashes/HTML error pages in dev.log.
- Ran `bun run lint` → clean, zero errors.

Stage Summary:
- Files created: src/app/api/chat/route.ts, src/app/api/tts/route.ts (no other files touched; page.tsx/layout.tsx/components/lib untouched)
- msedge-tts@2.0.7. Exact calls: `new MsEdgeTTS()` → `await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3)` → `const {audioStream} = tts.toStream(escapedText, {rate, pitch, volume})` (sync return) → collect Readable Buffers → `tts.close()`
- Rate control WORKS via ProsodyOptions percentage strings ("+25%"/"-25%", "default" at 1.0); XML escaping of & < > applied before toStream
- Verification: /tmp/tts-test.mp3 = 12,672 bytes, MPEG layer III 24kHz mono; chat groq→403 & zai→401 clean JSON with provider-named helpful errors; lint clean

---
Task ID: 3-7
Agent: main (Z.ai Code)
Task: Frontend build (orb, settings dialog, agent loop, page assembly) + end-to-end verification.

Work Log:
- src/lib/infinity/settings.ts — zustand persist store + isConfigured() helper.
- src/hooks/use-infinity-agent.ts — full voice loop: Web Speech API STT (continuous, interim, 850ms final-debounce) → POST /api/chat (history capped 16) → POST /api/tts → WebAudio decode + AnalyserNode playback → auto-resume listening. Mic RMS + playback RMS feed levelRef (attack/decay smoothing). Handles: mic denied, no-speech restarts, barge-out via click, decode fallback to HTMLAudio with synthetic level.
- src/components/infinity/orb.tsx — blue 3D sphere (radial gradient, specular, inset shadows), rAF-driven scale/glow/brightness from levelRef; states: idle breathe, listening ripples+mic reactive, thinking conic shimmer pulse, speaking audio reactive.
- src/components/infinity/settings-dialog.tsx — provider select (Z.AI/Groq/OpenAI/Custom), masked API key + get-key links, model chips, base URL, MS voice select (grouped by region) + preview button, rate slider, captions switch, persona textarea, Test connection with inline status.
- src/app/page.tsx — black fullscreen, macOS traffic dots, gear top-right (⌘,), INFINITY wordmark, orb center, tiny state label, first-run hint, subtle captions (toggleable), Space toggles session, Esc stops. Fixed: dialog auto-open now fires only once.
- layout.tsx metadata → "Infinity" + /orb.svg favicon; globals.css orb keyframes + slim scrollbar.
- Verification (agent-browser + VLM): settings renders all fields, auto-opens once on first run; voice preview → /api/tts 200; Test button surfaces clean provider errors (Z.AI 401, Groq 403); localStorage persists; provider switch updates models; orb click paths (unconfigured toast, mic-denied) clean; mobile 390px + desktop layouts verified; zero console/page errors. Reset localStorage for clean user first-run.

Stage Summary:
- App complete and browser-verified. Not verifiable in sandbox (no mic hardware / no real key): live STT capture, real LLM reply playback — all their code paths proxy-verified via curl + browser.

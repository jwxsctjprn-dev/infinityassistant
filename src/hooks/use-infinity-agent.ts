"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { AgentState, ChatMessage } from "@/lib/infinity/types";
import { isConfigured, useInfinity } from "@/lib/infinity/settings";
import {
  matchBuildCommand,
  matchDeleteCommand,
  matchWorkbenchCommand,
  type WorkbenchAction,
} from "@/lib/infinity/workbench";
import {
  describeWorkbench,
  matchBenchQuestion,
  summarizeWorkbench,
} from "@/lib/infinity/workbench-vision";
import { MAX_MODELS, nextSlot, normalizeHoloSpec, SPAWN_SETTLE_MS } from "@/lib/infinity/holo";
import { ASSEMBLE_MS, matchLibraryModel } from "@/lib/infinity/holo-library";
import { generateModel, matchFamilyModel, matchPhraseModel } from "@/lib/infinity/holo-generator";
import { cacheGetSpec, cachePutSpec, designHoloSpec } from "@/lib/infinity/holo-ai";
import type { HoloPart, HoloSpec } from "@/lib/infinity/types";
import type { BuildingState } from "@/components/infinity/workbench-models";

/**
 * Never blind-`res.json()`: a gateway/proxy error page is HTML, and
 * WebKit's raw rejection for that is the cryptic
 * "The string did not match the pattern expected." Read text, parse safely.
 */
async function safeJson<T>(res: Response): Promise<T | null> {
  try {
    const text = await res.text();
    if (!text) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Minimal ambient types for the Web Speech API                        */
/* ------------------------------------------------------------------ */

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  0: SpeechRecognitionAlternativeLike;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function rms(analyser: AnalyserNode, data: Uint8Array<ArrayBuffer>): number {
  analyser.getByteTimeDomainData(data);
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    const v = (data[i] - 128) / 128;
    sum += v * v;
  }
  return Math.min(1, Math.sqrt(sum / data.length) * 3.4);
}

/* ------------------------------------------------------------------ */

export type AgentMode = "voice" | "text";

/** One line of the visible conversation log (typing mode). */
export interface TranscriptEntry {
  id: number;
  role: "user" | "infinity";
  text: string;
}

interface VoiceSession {
  stopped: boolean;
  micStream: MediaStream | null;
  micAnalyser: AnalyserNode | null;
  micData: Uint8Array<ArrayBuffer> | null;
  rec: SpeechRecognitionLike | null;
  recCtor: SpeechRecognitionCtor;
  finalBuf: string;
  lastInterim: string;
  interimTimer: ReturnType<typeof setTimeout> | null;
  debounce: ReturnType<typeof setTimeout> | null;
  lastRestart: number;
}

export interface UseInfinityAgent {
  state: AgentState;
  mode: AgentMode | null;
  sessionActive: boolean;
  interim: string;
  lastUser: string;
  lastReply: string;
  error: string | null;
  micBlocked: boolean;
  /** Visible conversation log (typing mode shows it as chat bubbles). */
  transcript: TranscriptEntry[];
  /** Live workbench build progress (null when idle). */
  building: BuildingState | null;
  /** 0..1 smoothed audio loudness for the orb (read imperatively each frame) */
  levelRef: React.MutableRefObject<number>;
  start: () => void;
  stop: () => void;
  toggle: () => void;
  sendText: (text: string) => void;
}

export function useInfinityAgent(onNeedSettings: () => void): UseInfinityAgent {
  const [state, setState] = useState<AgentState>("idle");
  const [mode, setMode] = useState<AgentMode | null>(null);
  const [sessionActive, setSessionActive] = useState(false);
  const [interim, setInterim] = useState("");
  const [lastUser, setLastUser] = useState("");
  const [lastReply, setLastReply] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [micBlocked, setMicBlocked] = useState(false);
  const [building, setBuilding] = useState<BuildingState | null>(null);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const transcriptIdRef = useRef(0);

  const levelRef = useRef(0);
  const stateRef = useRef<AgentState>("idle");
  const modeRef = useRef<AgentMode | null>(null);
  const activeRef = useRef(false);
  const sessionRef = useRef<VoiceSession | null>(null);
  const historyRef = useRef<ChatMessage[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  // playback machinery shared by voice + text modes
  const ctxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const playbackAnalyserRef = useRef<AnalyserNode | null>(null);
  const playbackDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const fallbackRef = useRef<HTMLAudioElement | null>(null);
  const syntheticUntilRef = useRef(0);

  const onNeedSettingsRef = useRef(onNeedSettings);
  useEffect(() => {
    onNeedSettingsRef.current = onNeedSettings;
  }, [onNeedSettings]);

  /**
   * CRITICAL: state ref must update in the SAME tick as React state,
   * so guards in callbacks (onended / onend / beginListening) see the
   * fresh value immediately. Updating the ref only in an effect caused
   * the "never listens again after first reply" bug.
   */
  const setAgentState = useCallback((s: AgentState) => {
    stateRef.current = s;
    setState(s);
  }, []);

  /* ---------------------------- teardown ---------------------------- */

  const teardownVoice = useCallback(() => {
    const sess = sessionRef.current;
    if (!sess) return;
    sess.stopped = true;
    if (sess.debounce) clearTimeout(sess.debounce);
    if (sess.interimTimer) clearTimeout(sess.interimTimer);
    try {
      sess.rec?.abort();
    } catch {
      /* already stopped */
    }
    sess.micStream?.getTracks().forEach((t) => t.stop());
    sess.micAnalyser = null;
    sess.micData = null;
    sess.rec = null;
    sessionRef.current = null;
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    teardownVoice();
    try {
      sourceRef.current?.stop();
    } catch {
      /* already stopped */
    }
    sourceRef.current = null;
    playbackAnalyserRef.current = null;
    const fb = fallbackRef.current;
    if (fb) {
      fb.pause();
      fb.removeAttribute("src");
      fallbackRef.current = null;
    }
    syntheticUntilRef.current = 0;
    activeRef.current = false;
    modeRef.current = null;
    setSessionActive(false);
    setMode(null);
    setAgentState("idle");
    setInterim("");
    setTranscript([]);
    historyRef.current = [];
  }, [setAgentState, teardownVoice]);

  const stopRef = useRef(stop);
  useEffect(() => {
    stopRef.current = stop;
  }, [stop]);

  /** Kill the voice half but keep the conversation alive in text mode. */
  const fallbackToText = useCallback(
    (reason: string) => {
      teardownVoice();
      setMicBlocked(true);
      setError(reason);
      if (!activeRef.current) {
        activeRef.current = true;
        setSessionActive(true);
        setLastUser("");
        setLastReply("");
        historyRef.current = [];
      }
      modeRef.current = "text";
      setMode("text");
      setAgentState("idle");
      setInterim("");
    },
    [setAgentState, teardownVoice]
  );

  /* ------------------------- recognition ---------------------------- */

  const beginListeningRef = useRef<(s: VoiceSession) => void>(() => {});
  const beginListening = useCallback((sess: VoiceSession) => {
    if (sess.stopped || !activeRef.current) return;
    if (stateRef.current !== "listening" || modeRef.current !== "voice") return;
    const now = performance.now();
    if (now - sess.lastRestart < 350) {
      window.setTimeout(() => beginListeningRef.current(sess), 400);
      return;
    }
    sess.lastRestart = now;
    try {
      sess.rec?.start();
    } catch {
      /* InvalidStateError: already running — onend will handle restart */
    }
  }, []);
  useEffect(() => {
    beginListeningRef.current = beginListening;
  }, [beginListening]);

  /* ----------------------------- chat ------------------------------- */

  const askChat = useCallback(async (userText: string): Promise<string> => {
    const s = useInfinity.getState().settings;
    const history = [...historyRef.current, { role: "user" as const, content: userText }];
    // WORKBENCH VISION — a fresh snapshot of the bench rides along with
    // every turn, right before the user's message, so the LLM sees the
    // models as they are RIGHT NOW. It is never persisted into history;
    // each turn re-sends the current state (builds, drags, resizes, deletes
    // are all reflected immediately).
    const wb = useInfinity.getState();
    const outbound = [
      ...history.slice(0, -1),
      { role: "system" as const, content: describeWorkbench(wb.models, wb.workbench) },
      history[history.length - 1],
    ];
    const ac = new AbortController();
    abortRef.current?.abort();
    abortRef.current = ac;
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ac.signal,
        body: JSON.stringify({
          provider: s.provider,
          apiKey: s.apiKey.trim(),
          baseUrl: s.baseUrl.trim() || undefined,
          model: s.model.trim(),
          messages: outbound.slice(-18),
          systemPrompt: s.systemPrompt.trim() || undefined,
        }),
      });
      const data = await safeJson<{ ok: true; reply: string } | { ok: false; error: string }>(res);
      if (!res.ok || !data || !data.ok) {
        throw new Error(
          data && !data.ok ? data.error : `The AI service failed (${res.status}).`
        );
      }
      historyRef.current = [...history, { role: "assistant" as const, content: data.reply }].slice(
        -17
      );
      return data.reply;
    } catch (err) {
      if (ac.signal.aborted) throw new DOMException("Aborted", "AbortError");
      if (err instanceof TypeError) {
        throw new Error("Could not reach the chat service. Check your connection.");
      }
      throw err;
    }
  }, []);

  /* ----------------------------- speak ------------------------------ */

  const speak = useCallback(
    async (text: string): Promise<void> => {
      setAgentState("speaking");
      const s = useInfinity.getState().settings;
      const ac = abortRef.current;
      let buf: ArrayBuffer;
      try {
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: ac?.signal,
          body: JSON.stringify({ text, voice: s.voice, rate: s.rate }),
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(j?.error || "Voice synthesis failed.");
        }
        buf = await res.arrayBuffer();
      } catch (err) {
        if (ac?.signal.aborted) throw new DOMException("Aborted", "AbortError");
        if (err instanceof TypeError) throw new Error("Could not reach the voice service.");
        throw err;
      }

      let ctx = ctxRef.current;
      if (!ctx) {
        ctx = new AudioContext();
        ctxRef.current = ctx;
      }
      try {
        await ctx.resume();
      } catch {
        /* will fall back to <audio> if blocked */
      }
      const ctx2 = ctx;

      const playBuffer = () =>
        new Promise<void>((resolve, reject) => {
          let settled = false;
          let watchdog = 0;
          const finish = () => {
            if (settled) return;
            settled = true;
            if (watchdog) window.clearTimeout(watchdog);
            sourceRef.current = null;
            playbackAnalyserRef.current = null;
            resolve();
          };
          void (async () => {
            try {
              const audio = await ctx2.decodeAudioData(buf);
              const src = ctx2.createBufferSource();
              src.buffer = audio;
              const an = ctx2.createAnalyser();
              an.fftSize = 512;
              src.connect(an);
              an.connect(ctx2.destination);
              sourceRef.current = src;
              playbackAnalyserRef.current = an;
              playbackDataRef.current = new Uint8Array(new ArrayBuffer(an.fftSize));
              src.onended = finish;
              watchdog = window.setTimeout(
                finish,
                Math.max(1500, (audio.duration || 2) * 1000 + 1200)
              );
              src.start();
            } catch (e) {
              finish();
              reject(e instanceof Error ? e : new Error("Audio decoding failed."));
            }
          })();
        });

      const playFallback = () =>
        new Promise<void>((resolve) => {
          const url = URL.createObjectURL(new Blob([buf], { type: "audio/mpeg" }));
          const el = new Audio(url);
          fallbackRef.current = el;
          syntheticUntilRef.current = Number.MAX_SAFE_INTEGER;
          let settled = false;
          let watchdog = 0;
          const finish = () => {
            if (settled) return;
            settled = true;
            if (watchdog) window.clearTimeout(watchdog);
            URL.revokeObjectURL(url);
            fallbackRef.current = null;
            syntheticUntilRef.current = 0;
            resolve();
          };
          watchdog = window.setTimeout(finish, 60000);
          el.onended = finish;
          el.onerror = finish;
          void el.play().catch(() => {
            // Autoplay blocked — end the turn so the loop still continues.
            finish();
          });
        });

      await playBuffer().catch(() => playFallback());
    },
    [setAgentState]
  );

  /* ------------------- respond / transcript ------------------------ */

  /** Append a line to the visible conversation log. */
  const pushTranscript = useCallback((role: "user" | "infinity", text: string) => {
    const id = ++transcriptIdRef.current;
    setTranscript((prev) => {
      const next = [...prev, { id, role, text }];
      return next.length > 40 ? next.slice(-40) : next;
    });
  }, []);

  /** Infinity's side of the conversation: SPOKEN in voice mode, shown as
   *  silent text in typing mode — a typed session never plays any sound. */
  const respond = useCallback(
    async (text: string): Promise<void> => {
      if (modeRef.current === "voice") {
        await speak(text);
        return;
      }
      setLastReply(text);
      pushTranscript("infinity", text);
    },
    [pushTranscript, speak]
  );

  /** The user's side: caption line + transcript entry (both modes log; only
   *  typing mode displays the transcript). */
  const noteUser = useCallback(
    (text: string) => {
      setLastUser(text);
      pushTranscript("user", text);
    },
    [pushTranscript]
  );

  /* -------------------------- workbench ----------------------------- */

  /** Execute a workbench command: toggle the grid, confirm out loud,
   *  then resume the conversation loop (never hits the LLM). */
  const applyWorkbench = useCallback(
    async (action: WorkbenchAction) => {
      const opening = action === "open";
      useInfinity.getState().setWorkbench(opening);

      // Stop recognition first so Infinity never hears its own confirmation.
      const sess = sessionRef.current;
      if (sess) {
        try {
          sess.rec?.stop();
        } catch {
          /* noop */
        }
        if (sess.debounce) clearTimeout(sess.debounce);
        if (sess.interimTimer) clearTimeout(sess.interimTimer);
        sess.finalBuf = "";
        sess.lastInterim = "";
      }

      if (activeRef.current) {
        const confirmText = opening ? "Workbench online." : "Workbench closed.";
        setLastReply(confirmText);
        try {
          await respond(confirmText);
        } catch {
          /* confirmation is best-effort */
        }
        if (!activeRef.current) return;
        const s2 = sessionRef.current;
        if (s2 && !s2.stopped) {
          window.setTimeout(() => {
            const s3 = sessionRef.current;
            if (s3 === s2 && !s3.stopped && activeRef.current) {
              setAgentState("listening");
              beginListeningRef.current(s3);
            }
          }, 300);
        } else {
          setAgentState("idle");
        }
      }
    },
    [respond, setAgentState]
  );

  /** Returns true when the text was a workbench command (already handled). */
  const tryWorkbench = useCallback(
    (raw: string): boolean => {
      const action = matchWorkbenchCommand(raw);
      if (!action) return false;
      setInterim("");
      noteUser(raw.trim());
      setError(null);
      void applyWorkbench(action);
      return true;
    },
    [applyWorkbench, noteUser]
  );

  /** Pause mic + clear buffers so Infinity never hears its own voice. */
  const pauseMic = useCallback(() => {
    const sess = sessionRef.current;
    if (!sess) return;
    try {
      sess.rec?.stop();
    } catch {
      /* noop */
    }
    if (sess.debounce) clearTimeout(sess.debounce);
    if (sess.interimTimer) clearTimeout(sess.interimTimer);
    sess.finalBuf = "";
    sess.lastInterim = "";
    setInterim("");
  }, []);

  /** Back to listening (voice) or idle (text) after a workbench action. */
  const resumeAfterAction = useCallback(() => {
    if (!activeRef.current) return;
    const sess = sessionRef.current;
    if (sess && !sess.stopped) {
      window.setTimeout(() => {
        const s3 = sessionRef.current;
        if (s3 === sess && !s3.stopped && activeRef.current) {
          setAgentState("listening");
          beginListeningRef.current(s3);
        }
      }, 300);
    } else {
      setAgentState("idle");
    }
  }, [setAgentState]);

  /* --------------------- build & delete models --------------------- */

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  /** Intercept "build a model of X" — LOCAL builders first (instant, offline,
   *  keyless); the user's AI only designs objects the local system doesn't
   *  know (or when explicitly asked to design/invent). A model always spawns.
   *  Speaks, shows progress, persists. */
  const tryBuild = useCallback(
    (raw: string): boolean => {
      const cmd = matchBuildCommand(raw, useInfinity.getState().workbench);
      if (!cmd) return false;

      setInterim("");
      noteUser(raw.trim());
      setError(null);

      const models = useInfinity.getState().models;
      if (models.length >= MAX_MODELS) {
        toast.error("The workbench is full — delete a model first.");
        return true;
      }

      useInfinity.getState().setWorkbench(true);
      pauseMic();

      void (async () => {
        const settings = useInfinity.getState().settings;
        const keyReady = isConfigured(settings);

        // 1) LOCAL FIRST — phrases → library → families. Instant, offline,
        //    deterministic. Skipped only when the user explicitly asks the
        //    AI to design it AND a key is configured.
        let spec: HoloSpec | null = null;
        if (!cmd.forceDesign || !keyReady) {
          spec =
            matchPhraseModel(cmd.object) ??
            matchLibraryModel(cmd.object) ??
            matchFamilyModel(cmd.object);
        }

        // 2) Cached AI designs — an object the locals DON'T know, asked for
        //    before: identical model, instantly, zero API calls.
        if (!spec) spec = cacheGetSpec(cmd.object);

        let designed = false;
        let salvagedDesign = false;
        let designFailed = false;
        const willDesign = !spec && keyReady;

        const spoken = respond(willDesign ? "OK, designing that now." : "OK, building that now.").catch(
          () => {
            /* best effort */
          }
        );

        // 3) AI design — the user's LLM invents the object from scratch.
        //    Only reached for objects the local builders don't recognize
        //    (or when explicitly forced with "design a …"). The model card
        //    spawns IMMEDIATELY and fills in part-by-part as the design
        //    streams — you watch the object being invented, live.
        let liveId: string | null = null;
        if (willDesign) {
          const startName = cmd.object
            .split(/\s+/)
            .slice(0, 3)
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(" ");
          const spawnStore = useInfinity.getState();
          const cardId = `m-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          liveId = cardId;
          spawnStore.addModel({
            id: cardId,
            name: startName,
            spec: { name: startName, parts: [] },
            pos: nextSlot(spawnStore.models.length),
            rot: { x: 0.12, y: -0.55 },
            bornAt: Date.now(),
            pending: true,
          });

          setBuilding({
            name: cmd.object,
            phase: "building",
            progress: 0.06,
            partsDone: 0,
            count: null,
            note: "DESIGNING",
          });
          // Gentle crawl while the model thinks (caps at 30%).
          const crawl = window.setInterval(() => {
            setBuilding((b) =>
              b && b.note ? { ...b, progress: Math.min(0.3, b.progress + 0.005) } : b
            );
          }, 500);
          try {
            const out = await designHoloSpec({
              object: cmd.object,
              provider: settings.provider,
              apiKey: settings.apiKey,
              baseUrl: settings.baseUrl,
              model: settings.model,
              onProgress: (p) =>
                setBuilding((b) =>
                  b
                    ? {
                        ...b,
                        note: p.phase === "thinking" ? "DESIGNING" : `${p.partsDesigned} PARTS`,
                        progress: Math.max(b.progress, Math.min(0.45, p.progress)),
                      }
                    : b
                ),
              onPart: (_part, soFar) => {
                // Progressive assembly: every parsed line becomes a visible
                // part immediately (re-normalized so the hologram stays
                // centered and sized while it grows).
                const partial = normalizeHoloSpec(startName, soFar);
                useInfinity.getState().updateModel(cardId, { spec: partial });
                setBuilding((b) =>
                  b
                    ? {
                        ...b,
                        note: `${soFar.length} PARTS`,
                        progress: Math.min(0.82, 0.1 + soFar.length * 0.06),
                      }
                    : b
                );
              },
            });
            if (out?.spec) {
              spec = out.spec;
              designed = true;
              salvagedDesign = out.salvaged;
              if (!out.salvaged) cachePutSpec(cmd.object, out.spec);
            }
          } catch {
            /* fall through to local builders */
          } finally {
            window.clearInterval(crawl);
          }
          if (!spec) designFailed = true;
          // A salvaged partial design stays on screen (already visible);
          // on hard failure the card is repurposed by the fallback below.
        }

        // 4) Abstract archetypes guarantee a model — no key, no network,
        //    nothing recognized: still spawns a seeded hologram.
        if (!spec) {
          spec = generateModel(cmd.object);
        }

        const finalSpec = spec;
        const progressive = liveId !== null;
        const from = designed ? 0.82 : 0.08;

        setBuilding({
          name: finalSpec.name,
          phase: "building",
          progress: from,
          partsDone: progressive ? finalSpec.parts.length : 0,
          count: finalSpec.parts.length,
        });

        if (progressive && liveId) {
          // The live card adopts the final spec (exact name + geometry).
          // Salvaged partials (stream died mid-design) stay session-only:
          // never persisted, never cached — a reload must not resurrect a
          // half-designed hologram. Complete designs persist normally.
          useInfinity.getState().updateModel(liveId, {
            spec: finalSpec,
            name: finalSpec.name,
            pending: salvagedDesign || undefined,
          });
        } else if (!progressive) {
          const store = useInfinity.getState();
          store.addModel({
            id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            name: finalSpec.name,
            spec: finalSpec,
            pos: nextSlot(store.models.length),
            rot: { x: 0.12, y: -0.55 },
            bornAt: Date.now(),
          });
        }

        // Progress tracks the actual on-screen part-by-part assembly.
        const t0 = performance.now();
        const iv = window.setInterval(() => {
          // Assembly starts once the card's spawn animation has settled
          // (the 3D canvas mounts then — see SPAWN_SETTLE_MS).
          const frac = Math.min(
            1,
            Math.max(0, (performance.now() - t0 - SPAWN_SETTLE_MS) / ASSEMBLE_MS)
          );
          setBuilding((b) =>
            b
              ? {
                  ...b,
                  progress: from + (1 - from) * frac,
                  partsDone: progressive
                    ? finalSpec.parts.length
                    : Math.round(frac * finalSpec.parts.length),
                }
              : b
          );
          if (frac >= 1) window.clearInterval(iv);
        }, 90);

        await spoken;
        if (!activeRef.current && !sessionRef.current) {
          setAgentState("idle");
        }
        await sleep(
          Math.max(0, SPAWN_SETTLE_MS + ASSEMBLE_MS + 400 - (performance.now() - t0))
        );
        window.clearInterval(iv);

        setBuilding((b) => (b ? { ...b, phase: "done", progress: 1 } : b));
        await sleep(650);
        setBuilding(null);
        try {
          await respond(`${finalSpec.name} ready.`);
        } catch {
          /* best effort */
        }
        if (designed) {
          toast.success(`${finalSpec.name} — designed by AI`);
        } else if (designFailed) {
          toast("AI design unavailable — built a local model instead");
        }
        resumeAfterAction();
      })().catch((err) => {
        // Unreachable in practice — local geometry + speech can't fail.
        // Keep it quiet and visible instead of ever saying "couldn't build".
        console.error("build failed", err);
        setBuilding(null);
        toast.error("Something went wrong showing that model.");
        resumeAfterAction();
      });
      return true;
    },
    [noteUser, pauseMic, respond, resumeAfterAction, setAgentState]
  );

  /** Intercept "delete the X" / "clear the workbench" while in workbench. */
  const tryDelete = useCallback(
    (raw: string): boolean => {
      const store = useInfinity.getState();
      if (!store.workbench || store.models.length === 0) return false;
      const cmd = matchDeleteCommand(
        raw,
        store.models.map((m) => m.name)
      );
      if (!cmd) return false;

      setInterim("");
      noteUser(raw.trim());
      setError(null);
      pauseMic();

      if ("all" in cmd) {
        const names = store.models.map((m) => m.name);
        store.clearModels();
        void (async () => {
          try {
            await respond(
              names.length === 1
                ? `Removed the ${names[0]}.`
                : `Cleared ${names.length} models from the workbench.`
            );
          } catch {
            /* best effort */
          }
          resumeAfterAction();
        })();
        return true;
      }

      const target = store.models.find(
        (m) => m.name.toLowerCase() === cmd.name.toLowerCase()
      ) ?? store.models.find((m) => m.name.toLowerCase().includes(cmd.name.toLowerCase()));
      if (!target) return false; // mentioned nothing we have → normal chat
      store.removeModel(target.id);
      void (async () => {
        try {
          await respond(`Removed the ${target.name}.`);
        } catch {
          /* best effort */
        }
        resumeAfterAction();
      })();
      return true;
    },
    [noteUser, pauseMic, respond, resumeAfterAction]
  );

  /* ---------------------------- one turn ---------------------------- */

  const runTurn = useCallback(
    async (userText: string) => {
      if (stateRef.current === "thinking" || stateRef.current === "speaking") return;
      if (tryWorkbench(userText)) return;
      if (tryDelete(userText)) return;
      if (tryBuild(userText)) return;
      setError(null);
      noteUser(userText);
      setInterim("");
      setAgentState("thinking");

      const sessNow = sessionRef.current;
      if (sessNow?.rec) {
        try {
          sessNow.rec.stop();
        } catch {
          /* noop */
        }
      }

      let reply = "";
      try {
        reply = await askChat(userText);
      } catch (err) {
        if (!activeRef.current || abortRef.current?.signal.aborted) return;
        const msg =
          err instanceof Error && err.message ? err.message : "The AI service failed.";
        setError(msg);
        toast.error(msg, {
          action: { label: "Settings", onClick: () => onNeedSettingsRef.current() },
        });
        const s2 = sessionRef.current;
        if (s2 && !s2.stopped) {
          setAgentState("listening");
          beginListeningRef.current(s2);
        } else {
          setAgentState("idle");
        }
        return;
      }

      if (!activeRef.current) return;
      setLastReply(reply);

      try {
        await respond(reply);
      } catch (err) {
        if (!activeRef.current || abortRef.current?.signal.aborted) return;
        const msg = err instanceof Error && err.message ? err.message : "Voice playback failed.";
        setError(msg);
        toast.error(msg);
      }
      if (!activeRef.current) return;

      // Resume: voice sessions go back to listening; text sessions wait for input.
      const sess = sessionRef.current;
      if (sess && !sess.stopped) {
        const delay = window.setTimeout(() => {
          const s3 = sessionRef.current;
          if (s3 === sess && !s3.stopped && activeRef.current) {
            setAgentState("listening");
            beginListeningRef.current(s3);
          }
        }, 350);
        void delay;
      } else {
        setAgentState("idle");
      }
    },
    [askChat, noteUser, respond, setAgentState, tryBuild, tryDelete, tryWorkbench]
  );

  /* --------------------- recognition wiring ------------------------- */

  const setupRecognition = useCallback(
    (mySess: VoiceSession) => {
      const rec = new mySess.recCtor();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = "en-US";

      const submitVoice = (text: string) => {
        const t = text.trim();
        if (!t) return;
        if (mySess.interimTimer) {
          clearTimeout(mySess.interimTimer);
          mySess.interimTimer = null;
        }
        if (mySess.debounce) {
          clearTimeout(mySess.debounce);
          mySess.debounce = null;
        }
        mySess.finalBuf = "";
        mySess.lastInterim = "";
        setInterim("");
        try {
          mySess.rec?.stop();
        } catch {
          /* noop */
        }
        void runTurn(t);
      };

      rec.onresult = (event) => {
        if (sessionRef.current !== mySess || mySess.stopped) return;
        if (stateRef.current !== "listening") return;
        let interimText = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const r = event.results[i];
          if (r.isFinal) mySess.finalBuf += r[0].transcript + " ";
          else interimText += r[0].transcript;
        }
        if (interimText) setInterim(interimText);
        if (mySess.interimTimer) {
          clearTimeout(mySess.interimTimer);
          mySess.interimTimer = null;
        }
        mySess.lastInterim = interimText;

        if (mySess.finalBuf.trim()) {
          if (mySess.debounce) clearTimeout(mySess.debounce);
          // Small pause after final words → send.
          mySess.debounce = setTimeout(() => submitVoice(mySess.finalBuf), 850);
        } else if (interimText.trim()) {
          // Safety net: some browsers stall before emitting a final result.
          mySess.interimTimer = setTimeout(
            () => submitVoice(mySess.lastInterim),
            1700
          );
        }
      };

      rec.onerror = (event) => {
        if (sessionRef.current !== mySess || mySess.stopped) return;
        const kind = event.error;
        if (kind === "no-speech" || kind === "aborted") return;
        if (kind === "not-allowed" || kind === "service-not-allowed") {
          fallbackToText(
            "Microphone access was blocked — open this app in its own browser tab to talk out loud, or type below."
          );
          return;
        }
        if (kind === "network") {
          fallbackToText(
            "Speech recognition lost its connection — keep talking by typing below."
          );
        }
      };

      rec.onend = () => {
        if (sessionRef.current !== mySess || mySess.stopped) return;
        if (stateRef.current === "listening" && modeRef.current === "voice") {
          beginListeningRef.current(mySess);
        }
      };

      mySess.rec = rec;
    },
    [fallbackToText, runTurn]
  );

  /* ------------------------------ start ----------------------------- */

  const start = useCallback(() => {
    if (activeRef.current) return;
    const s = useInfinity.getState().settings;
    if (!isConfigured(s)) {
      toast("Add your API key in Settings to start talking to Infinity.", {
        action: { label: "Settings", onClick: () => onNeedSettingsRef.current() },
      });
      onNeedSettingsRef.current();
      return;
    }
    const recCtor = getSpeechRecognitionCtor();
    if (!recCtor) {
      toast("Voice input isn't supported in this browser — type instead (press /).");
      fallbackToText(
        "Voice input isn't supported in this browser — type below and Infinity will answer out loud."
      );
      return;
    }

    const sess: VoiceSession = {
      stopped: false,
      micStream: null,
      micAnalyser: null,
      micData: null,
      rec: null,
      recCtor,
      finalBuf: "",
      lastInterim: "",
      interimTimer: null,
      debounce: null,
      lastRestart: 0,
    };
    sessionRef.current = sess;
    activeRef.current = true;
    modeRef.current = "voice";
    setMode("voice");
    setSessionActive(true);
    setMicBlocked(false);
    setError(null);
    setLastUser("");
    setLastReply("");
    historyRef.current = [];

    void (async () => {
      try {
        let ctx = ctxRef.current;
        if (!ctx) {
          ctx = new AudioContext();
          ctxRef.current = ctx;
        }
        try {
          await ctx.resume();
        } catch {
          /* noop */
        }
        sess.micStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        if (sessionRef.current !== sess) {
          sess.micStream.getTracks().forEach((t) => t.stop());
          return;
        }
        const micSrc = ctx.createMediaStreamSource(sess.micStream);
        const an = ctx.createAnalyser();
        an.fftSize = 512;
        micSrc.connect(an); // deliberately not connected to destination
        sess.micAnalyser = an;
        sess.micData = new Uint8Array(new ArrayBuffer(an.fftSize));

        setupRecognition(sess);
        setAgentState("listening");
        beginListening(sess);
      } catch {
        if (sessionRef.current !== sess) return;
        fallbackToText(
          "Microphone unavailable — open this app in its own browser tab and allow the mic, or type below."
        );
        toast.error("Microphone unavailable — you can type instead.");
      }
    })();
  }, [beginListening, fallbackToText, setAgentState, setupRecognition]);

  /* ----------------------------- typing ----------------------------- */

  const sendText = useCallback(
    (text: string) => {
      const t = text.trim();
      if (!t) return;
      // TYPING MODE: sending text always implies a silent text session —
      // no mic, no sound, replies appear as text. If a VOICE session is
      // already running, the typed text joins it instead (barge-in, spoken).
      if (!activeRef.current) {
        activeRef.current = true;
        modeRef.current = "text";
        setMode("text");
        setSessionActive(true);
        setMicBlocked(false);
        setError(null);
        setLastUser("");
        setLastReply("");
        setTranscript([]);
        historyRef.current = [];
        setAgentState("idle");
      }
      // Workbench commands are local — they work even without an API key.
      if (tryWorkbench(t)) return;
      if (tryDelete(t)) return;
      if (tryBuild(t)) return;
      // Keyless: the most common bench questions still get a real answer
      // from the local snapshot instead of an error toast.
      const s = useInfinity.getState().settings;
      if (!isConfigured(s) && matchBenchQuestion(t)) {
        setInterim("");
        noteUser(t);
        setError(null);
        void (async () => {
          try {
            await respond(summarizeWorkbench(useInfinity.getState().models));
          } catch {
            /* best effort */
          }
        })();
        return;
      }
      if (!isConfigured(s)) {
        toast("Add your API key in Settings first.", {
          action: { label: "Settings", onClick: () => onNeedSettingsRef.current() },
        });
        onNeedSettingsRef.current();
        return;
      }
      void runTurn(t);
    },
    [runTurn, setAgentState, tryBuild, tryDelete, tryWorkbench]
  );

  const toggle = useCallback(() => {
    if (activeRef.current) stop();
    else start();
  }, [start, stop]);

  /* --------------------------- level loop --------------------------- */

  useEffect(() => {
    let raf = 0;
    const frame = (t: number) => {
      const st = stateRef.current;
      let target = 0;
      const sess = sessionRef.current;
      if (st === "listening" && sess?.micAnalyser && sess.micData) {
        target = rms(sess.micAnalyser, sess.micData);
      } else if (st === "speaking") {
        if (playbackAnalyserRef.current && playbackDataRef.current) {
          target = rms(playbackAnalyserRef.current, playbackDataRef.current);
        } else if (syntheticUntilRef.current > Date.now()) {
          target = 0.32 + 0.28 * Math.sin(t * 0.012);
        }
      }
      const prev = levelRef.current;
      levelRef.current = prev + (target - prev) * (target > prev ? 0.55 : 0.12);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  // stop everything on unmount
  useEffect(() => () => stopRef.current(), []);

  return {
    state,
    mode,
    sessionActive,
    interim,
    lastUser,
    lastReply,
    error,
    micBlocked,
    transcript,
    building,
    levelRef,
    start,
    stop,
    toggle,
    sendText,
  };
}

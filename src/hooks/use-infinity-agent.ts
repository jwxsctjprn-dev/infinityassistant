"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { AgentState, ChatMessage, SttResponseBody } from "@/lib/infinity/types";
import { isConfigured, useInfinity } from "@/lib/infinity/settings";
import {
  matchBenchTool,
  matchBuildCommand,
  matchDeleteCommand,
  matchModelAction,
  matchWorkbenchCommand,
  type WorkbenchAction,
} from "@/lib/infinity/workbench";
import {
  describeWorkbench,
  hexForColorName,
  matchBenchQuestion,
  summarizeWorkbench,
} from "@/lib/infinity/workbench-vision";
import { dominantColor, MAX_MODELS, nextSlot, normalizeHoloSpec, SPAWN_SETTLE_MS } from "@/lib/infinity/holo";
import { HOLO_SPIN_SPEED } from "@/lib/infinity/types";
import { captureWorkbenchSnapshot } from "@/lib/infinity/snapshot";
import { ASSEMBLE_MS, matchLibraryModel } from "@/lib/infinity/holo-library";
import { generateModel, matchFamilyModel, matchPhraseModel } from "@/lib/infinity/holo-generator";
import { cacheGetSpec, cachePutSpec, designHoloSpec } from "@/lib/infinity/holo-ai";
import type { HoloModel, HoloSpec } from "@/lib/infinity/types";
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

/** Blob → base64 (no data: URL prefix) via FileReader. */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result);
      resolve(s.slice(s.indexOf(",") + 1));
    };
    r.onerror = () => reject(new Error("Could not read the recording."));
    r.readAsDataURL(blob);
  });
}

/** Best audio MIME this browser's MediaRecorder supports (opus webm first). */
function pickRecorderMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  for (const m of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(m)) return m;
    } catch {
      /* keep probing */
    }
  }
  return undefined;
}

/** True when this browser can capture audio for push-to-talk dictation. */
function supportsDictation(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.MediaRecorder !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia
  );
}

/* ------------------------------------------------------------------ */

/** Split streamed text into speakable sentences: a terminator (. ! ? …)
 *  followed by whitespace (or end of buffer) ends a sentence; decimals like
 *  3.5 never split. Returns complete sentences + the remaining tail. */
function splitSentences(pending: string): { sentences: string[]; rest: string } {
  const sentences: string[] = [];
  let start = 0;
  for (let i = 0; i < pending.length; i++) {
    const c = pending[i];
    if (c !== "." && c !== "!" && c !== "?" && c !== "…") continue;
    // closing quotes/brackets belong to the finished sentence
    let j = i + 1;
    while (j < pending.length && /["')\]]/.test(pending[j])) j++;
    const next = pending[j];
    if (next === undefined || /\s/.test(next)) {
      // "3.5" — digit on both sides of the dot is a decimal, not a sentence
      if (c === "." && i > 0 && /\d/.test(pending[i - 1]) && next !== undefined && /\d/.test(next)) continue;
      const chunk = pending.slice(start, j).trim();
      if (chunk) sentences.push(chunk);
      start = j;
      i = j - 1;
    }
  }
  return { sentences, rest: pending.slice(start) };
}

/** Normalize speech text for comparison (echo guard). */
function normalizeSpeech(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when a transcript is Infinity's own spoken voice picked back up by
 *  the always-on mic (echo), not the user talking: either the whole
 *  utterance sits inside what was just spoken, or (for 3+ words) most
 *  words overlap with it. Mis-heard TTS still shares most words — a real
 *  user interrupting rarely does. */
function isSpeechEcho(transcript: string, spoken: string): boolean {
  const nt = normalizeSpeech(transcript);
  const ns = normalizeSpeech(spoken);
  if (!nt || !ns) return false;
  if (ns.includes(nt)) return true;
  const words = nt.split(" ");
  if (words.length >= 3) {
    const sw = new Set(ns.split(" "));
    const hits = words.filter((w) => sw.has(w)).length;
    if (hits / words.length >= 0.75) return true;
  }
  return false;
}

/** Push-ended async queue — LLM sentences stream in, the speech pipeline
 *  consumes them the moment each arrives. */
function createSentenceQueue() {
  const q: string[] = [];
  let finished = false;
  let notify: (() => void) | null = null;
  return {
    push(s: string) {
      q.push(s);
      notify?.();
    },
    end() {
      finished = true;
      notify?.();
    },
    stream(): AsyncIterable<string> {
      return {
        async *[Symbol.asyncIterator]() {
          while (true) {
            while (q.length > 0) yield q.shift()!;
            if (finished) return;
            await new Promise<void>((r) => {
              notify = r;
            });
            notify = null;
          }
        },
      };
    },
  };
}

export type AgentMode = "voice" | "text" | "dictation";

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
  recCtor: SpeechRecognitionCtor | null;
  finalBuf: string;
  lastInterim: string;
  interimTimer: ReturnType<typeof setTimeout> | null;
  debounce: ReturnType<typeof setTimeout> | null;
  lastRestart: number;
  /* Push-to-talk dictation (browsers without the Web Speech API):
     input is a MediaRecorder clip transcribed by /api/stt instead of
     continuous on-device recognition. */
  dictation: boolean;
  recorder: MediaRecorder | null;
  recording: boolean;
  /** performance.now() when the current clip started. */
  recStart: number;
  /** True once the mic peaked above the speech threshold this clip. */
  speechHeard: boolean;
  /** performance.now() of the last frame above the speech threshold. */
  lastVoiceAt: number;
  /** Drop the in-flight clip (e.g. the user typed while recording). */
  discardNext: boolean;
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
  /** True while the session runs in push-to-talk mode (no Web Speech API). */
  dictation: boolean;
  /** True while capturing a dictation clip. */
  recording: boolean;
  start: () => void;
  stop: () => void;
  toggle: () => void;
  /** Push-to-talk: begin / end+send a dictation clip. */
  toggleRecording: () => void;
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
  const [recording, setRecording] = useState(false);
  const [building, setBuilding] = useState<BuildingState | null>(null);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const transcriptIdRef = useRef(0);

  const levelRef = useRef(0);
  const stateRef = useRef<AgentState>("idle");
  const modeRef = useRef<AgentMode | null>(null);
  const activeRef = useRef(false);
  const recordingRef = useRef(false);
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

  /** Everything Infinity has said out loud recently — the ECHO GUARD for the
   *  always-on mic: recognition results matching this text are Infinity
   *  hearing its own voice through the speakers, not the user. */
  const spokenRef = useRef<{ text: string; at: number }>({ text: "", at: 0 });
  /** The last thing the user submitted by voice — trailing duplicate finals
   *  for the SAME utterance must never read as a barge-in. */
  const lastSubmittedRef = useRef<{ text: string; at: number }>({ text: "", at: 0 });

  const noteSpoken = useCallback((text: string) => {
    const n = normalizeSpeech(text);
    if (!n) return;
    const cur = spokenRef.current;
    spokenRef.current = {
      text: Date.now() - cur.at < 3000 ? `${cur.text} ${n}`.trim() : n,
      at: Date.now(),
    };
  }, []);

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
    // A live dictation clip dies with the session (onstop sees stopped=true).
    try {
      if (sess.recorder && sess.recorder.state !== "inactive") sess.recorder.stop();
    } catch {
      /* already stopped */
    }
    sess.recorder = null;
    sess.recording = false;
    sess.micStream?.getTracks().forEach((t) => t.stop());
    sess.micAnalyser = null;
    sess.micData = null;
    sess.rec = null;
    sessionRef.current = null;
  }, []);

  /** Hard-stop any audio playing right now (barge-in / session stop). */
  const killAudio = useCallback(() => {
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
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    teardownVoice();
    recordingRef.current = false;
    setRecording(false);
    killAudio();
    activeRef.current = false;
    modeRef.current = null;
    setSessionActive(false);
    setMode(null);
    setAgentState("idle");
    setInterim("");
    setTranscript([]);
    historyRef.current = [];
  }, [killAudio, setAgentState, teardownVoice]);

  const stopRef = useRef(stop);
  useEffect(() => {
    stopRef.current = stop;
  }, [stop]);

  /** Kill the voice half but keep the conversation alive in text mode. */
  const fallbackToText = useCallback(
    (reason: string) => {
      teardownVoice();
      setMicBlocked(true);
      recordingRef.current = false;
      setRecording(false);
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
  /** ALWAYS-ON MIC: recognition is (re)started in ANY active state — it
   *  keeps running while Infinity thinks and even while it speaks (the
   *  barge-in channel in onresult listens through the reply). */
  const beginListening = useCallback((sess: VoiceSession) => {
    if (sess.stopped || !activeRef.current) return;
    if (modeRef.current !== "voice") return;
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

  /**
   * STREAMED chat. The reply arrives as NDJSON deltas; every complete
   * sentence fires onSentence immediately (voice mode pipes it straight
   * into TTS — time-to-first-audio is one sentence + one TTS call, not the
   * whole reply). Returns the full reply text.
   */
  const askChatStream = useCallback(
    async (
      userText: string,
      onSentence?: (sentence: string, fullSoFar: string) => void,
      signal?: AbortSignal
    ): Promise<string> => {
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
        {
          role: "system" as const,
          content: describeWorkbench(wb.models, wb.workbench, wb.blueprint, wb.focusedId, wb.scenes),
        },
        history[history.length - 1],
      ];
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal,
          body: JSON.stringify({
            provider: s.provider,
            apiKey: s.apiKey.trim(),
            baseUrl: s.baseUrl.trim() || undefined,
            model: s.model.trim(),
            messages: outbound.slice(-18),
            systemPrompt: s.systemPrompt.trim() || undefined,
            stream: true,
          }),
        });
        if (!res.ok || !res.body) {
          const data = await safeJson<{ ok: false; error: string }>(res);
          throw new Error(
            data && !data.ok ? data.error : `The AI service failed (${res.status}).`
          );
        }

        let full = "";
        let pending = "";
        let streamError: string | null = null;

        const emit = (sentence: string) => {
          if (!onSentence) return;
          const clean = sentence
            .replace(/^[-*•]\s*/, "")
            .replace(/\*\*/g, "")
            .replace(/\*([^*]+)\*/g, "$1")
            .replace(/^#+\s*/, "")
            .trim();
          if (clean) onSentence(clean, full);
        };

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line) continue;
            let ev: { t?: string; v?: string };
            try {
              ev = JSON.parse(line) as { t?: string; v?: string };
            } catch {
              continue;
            }
            if (ev.t === "delta" && typeof ev.v === "string") {
              full += ev.v;
              pending += ev.v;
              const split = splitSentences(pending);
              pending = split.rest;
              for (const sentence of split.sentences) emit(sentence);
              // Long stretch with no punctuation → flush at the last pause so
              // the first audio starts as early as it naturally can.
              if (pending.length > 170) {
                const cut = Math.max(pending.lastIndexOf(" "), pending.lastIndexOf(","));
                if (cut > 70) {
                  emit(pending.slice(0, cut + 1));
                  pending = pending.slice(cut + 1);
                } else {
                  emit(pending);
                  pending = "";
                }
              }
            } else if (ev.t === "error" && typeof ev.v === "string") {
              streamError = ev.v;
            }
          }
        }
        if (pending.trim()) emit(pending);

        if (!full.trim()) {
          throw new Error(streamError || "The AI service returned an empty reply.");
        }
        historyRef.current = [...history, { role: "assistant" as const, content: full }].slice(
          -17
        );
        return full;
      } catch (err) {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        if (err instanceof TypeError) {
          throw new Error("Could not reach the chat service. Check your connection.");
        }
        throw err;
      }
    },
    []
  );

  /* ----------------------------- speak ------------------------------ */

  /** Fetch synthesized audio for one text chunk (mp3 bytes). */
  const fetchTtsAudio = useCallback(
    async (text: string, signal?: AbortSignal): Promise<ArrayBuffer> => {
      const s = useInfinity.getState().settings;
      const sig = signal ?? abortRef.current?.signal;
      try {
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: sig,
          body: JSON.stringify({ text, voice: s.voice, rate: s.rate }),
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(j?.error || "Voice synthesis failed.");
        }
        return await res.arrayBuffer();
      } catch (err) {
        if (sig?.aborted) throw new DOMException("Aborted", "AbortError");
        if (err instanceof TypeError) throw new Error("Could not reach the voice service.");
        throw err;
      }
    },
    []
  );

  /** Decode + play one audio buffer through the shared AudioContext with
   *  the playback analyser (orb reacts), falling back to <audio>. */
  const playAudio = useCallback(async (buf: ArrayBuffer): Promise<void> => {
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
  }, []);

  const speak = useCallback(
    async (text: string): Promise<void> => {
      setAgentState("speaking");
      noteSpoken(text); // echo guard: this is about to come out of the speakers
      const buf = await fetchTtsAudio(text);
      await playAudio(buf);
    },
    [fetchTtsAudio, noteSpoken, playAudio, setAgentState]
  );

  /**
   * Speak a LIVE stream of sentences. Sentence n+1's audio is fetched and
   * decoded WHILE sentence n is still playing — so Infinity starts talking
   * after roughly one sentence of LLM output + one TTS round-trip, instead
   * of waiting for the entire reply. State stays "thinking" until the first
   * audio actually plays.
   */
  const speakStreamed = useCallback(
    async (sentences: AsyncIterable<string>, signal?: AbortSignal): Promise<void> => {
      let firstError: unknown = null;
      let startedSpeaking = false;
      let prev: Promise<void> = Promise.resolve();
      const aborted = () => signal?.aborted ?? abortRef.current?.signal.aborted === true;

      for await (const sentence of sentences) {
        if (aborted() || firstError) break;
        // SNAPSHOT the previous task BEFORE starting this one. Reading the
        // outer `prev` inside the async body races: when several sentences
        // flush into the queue in the same tick (fast LLM burst), every task
        // would await the SAME latest task — and the last one would await
        // ITSELF. Circular await = permanent deadlock (stuck on "thinking").
        const before = prev;
        const task = (async () => {
          if (aborted() || firstError) return;
          let buf: ArrayBuffer;
          try {
            buf = await fetchTtsAudio(sentence, signal);
          } catch (err) {
            firstError = err;
            return;
          }
          if (aborted() || firstError) return;
          await before; // wait for the previous sentence to finish playing
          if (aborted() || firstError) return;
          if (!startedSpeaking) {
            startedSpeaking = true;
            setAgentState("speaking");
          }
          noteSpoken(sentence); // echo guard: about to hit the speakers
          try {
            await playAudio(buf);
          } catch (err) {
            firstError = err;
          }
        })();
        prev = task;
      }
      await prev;
      if (firstError) throw firstError;
    },
    [fetchTtsAudio, noteSpoken, playAudio, setAgentState]
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
      if (modeRef.current === "voice" || modeRef.current === "dictation") {
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
   *  then resume the conversation loop (never hits the LLM). The mic never
   *  stops for this — the echo guard filters Infinity's own confirmation. */
  const applyWorkbench = useCallback(
    async (action: WorkbenchAction) => {
      const opening = action === "open";
      useInfinity.getState().setWorkbench(opening);

      // Drop anything half-captured so the confirmation can't be spoken over.
      const sess = sessionRef.current;
      if (sess) {
        if (sess.debounce) clearTimeout(sess.debounce);
        if (sess.interimTimer) clearTimeout(sess.interimTimer);
        sess.finalBuf = "";
        sess.lastInterim = "";
        setInterim("");
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
        if (s2 && !s2.stopped && !s2.dictation) {
          setAgentState("listening");
          beginListeningRef.current(s2); // already running → no-op
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
      }, 220);
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

        const spoken = respond(willDesign ? "Designing it now." : "Building it now.").catch(
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
    [noteUser, respond, resumeAfterAction]
  );

  /** Intercept whole-bench tool commands — blueprint view, auto-arrange,
   *  PNG snapshot, scene save/load, and "bring it back" delete undo. All
   *  local (no LLM round-trip), so every one of them works without an API
   *  key. Runs after delete ("clear the workbench" stays a delete) and
   *  before the per-model actions. */
  const tryBenchTool = useCallback(
    (raw: string): boolean => {
      const tool = matchBenchTool(raw);
      if (!tool) return false;

      setInterim("");
      noteUser(raw.trim());
      setError(null);

      const store = useInfinity.getState();
      const speak = (line: string) =>
        void (async () => {
          try {
            await respond(line);
          } catch {
            /* best effort */
          }
          resumeAfterAction();
        })();

      switch (tool.kind) {
        case "undo-delete": {
          if (store.lastDeleted.length === 0) {
            speak("Nothing to bring back just now.");
            return true;
          }
          const back = store.undoDelete();
          const names = useInfinity
            .getState()
            .models.slice(-back)
            .map((m) => m.name);
          speak(
            back === 1
              ? `Brought back the ${names[0] ?? "model"}.`
              : `Brought back ${back} models.`
          );
          return true;
        }
        case "scene-save": {
          const saved = store.models.filter((m) => !m.pending);
          if (saved.length === 0) {
            speak("There's nothing on the bench to save yet.");
            return true;
          }
          const slot =
            tool.slot ??
            store.scenes.findIndex((s) => s === null) >= 0
              ? store.scenes.findIndex((s) => s === null)
              : 0;
          const name = store.saveScene(slot);
          toast.success(`Scene saved · slot ${["one", "two", "three"][slot]}`);
          speak(`Scene saved to slot ${["one", "two", "three"][slot]} — ${name}.`);
          return true;
        }
        case "scene-load": {
          const filled = store.scenes
            .map((s, i) => (s ? { slot: i, savedAt: s.savedAt, count: s.models.length } : null))
            .filter((x): x is { slot: number; savedAt: number; count: number } => x !== null);
          if (filled.length === 0) {
            speak("No saved scenes yet — say save the scene first.");
            return true;
          }
          const slot =
            tool.slot ??
            filled.reduce((a, b) => (b.savedAt > a.savedAt ? b : a)).slot;
          const scene = store.scenes[slot];
          if (!scene || scene.models.length === 0) {
            speak(`Scene slot ${["one", "two", "three"][slot]} is empty.`);
            return true;
          }
          store.loadScene(slot);
          speak(
            scene.models.length === 1
              ? `Scene loaded — the ${scene.models[0].name}.`
              : `Scene loaded — ${scene.models.length} models on the bench.`
          );
          return true;
        }
        case "blueprint": {
          store.setBlueprint(tool.on);
          speak(tool.on ? "Blueprint mode on." : "Blueprint mode off.");
          return true;
        }
        case "tidy": {
          if (store.models.length === 0) {
            speak("Nothing on the bench to arrange yet.");
            return true;
          }
          store.arrangeModels();
          // Cards glide for ~0.8s, then normal (instant) dragging resumes.
          window.setTimeout(() => useInfinity.getState().setArranging(false), 850);
          const n = store.models.length;
          speak(
            n === 1 ? "Centered it on the bench." : `Tidied up — ${n} models arranged.`
          );
          return true;
        }
        case "snapshot": {
          if (!store.workbench) {
            speak("Open the workbench first, then I'll snapshot it.");
            return true;
          }
          const result = captureWorkbenchSnapshot();
          if (result.ok) toast.success("Snapshot saved to your downloads");
          speak(result.spoken);
          return true;
        }
      }
    },
    [noteUser, respond, resumeAfterAction]
  );

  /** Intercept style & motion commands for models on the bench — "make it
   *  spin", "take the rocket apart", "copy it", "make it red". All local
   *  (no LLM round-trip), so they work without an API key, like every
   *  workbench command. Runs BEFORE build ("make another one" duplicates,
   *  it doesn't design a thing called "another one"). */
  const tryModelAction = useCallback(
    (raw: string): boolean => {
      const store = useInfinity.getState();
      if (!store.workbench) return false;
      const models = store.models;
      if (models.length === 0) return false;
      const action = matchModelAction(raw, models.map((m) => m.name));
      if (!action) return false;
      if (action.kind === "recolor" && !hexForColorName(action.color)) return false;

      // Resolve the target: a named model, else the most recently built
      // ("make it spin" / "paint it red" with several models → the newest).
      let target: HoloModel | undefined;
      if (action.name) {
        const needle = action.name.toLowerCase();
        target =
          models.find((m) => m.name.toLowerCase() === needle) ??
          models.find((m) => m.name.toLowerCase().includes(needle));
      } else if (action.kind === "spin" && !action.on) {
        // "stop spinning" → the model that is actually spinning.
        target = models.findLast((m) => !!m.spin) ?? models[models.length - 1];
      } else if (action.kind === "explode" && !action.on) {
        // "put it back together" → the model that is actually exploded.
        target = models.findLast((m) => !!m.exploded) ?? models[models.length - 1];
      } else if (action.kind === "xray" && !action.on) {
        // "turn off the x-ray" → the model actually in x-ray.
        target = models.findLast((m) => !!m.xray) ?? models[models.length - 1];
      } else if (action.kind === "solid" && !action.on) {
        // "make it a hologram again" → the model actually rendered solid.
        target = models.findLast((m) => !!m.solid) ?? models[models.length - 1];
      } else if (action.kind === "measure" && !action.on) {
        // "hide the measurements" → the model actually being measured.
        target = models.findLast((m) => !!m.measure) ?? models[models.length - 1];
      } else if (action.kind === "focus" && !action.on) {
        // "stop focusing" → the model actually presented.
        target = models.find((m) => m.id === store.focusedId) ?? models[models.length - 1];
      } else if (action.kind === "inspect" && !action.on) {
        // "close the inspector" → whatever is under inspection.
        target = models.find((m) => m.id === store.inspectId) ?? models[models.length - 1];
      } else {
        target = models[models.length - 1];
      }
      if (!target) return false; // named something we don't have → normal chat

      setInterim("");
      noteUser(raw.trim());
      setError(null);

      let spoken = "";
      switch (action.kind) {
        case "recolor": {
          const hex = hexForColorName(action.color)!;
          // Default: swap the DOMINANT color and keep accents (windows,
          // flames…). "make it ALL red" repaints every part.
          const dominant = dominantColor(target.spec);
          const parts = target.spec.parts.map((p) =>
            action.all || p.color === dominant ? { ...p, color: hex } : p
          );
          store.updateModel(target.id, { spec: { ...target.spec, parts } });
          spoken = action.all
            ? `Painted the ${target.name} ${action.color}, every part.`
            : `The ${target.name} is ${action.color} now.`;
          break;
        }
        case "spin":
          store.updateModel(target.id, { spin: action.on ? HOLO_SPIN_SPEED : 0 });
          spoken = action.on ? `Setting the ${target.name} spinning.` : "Stopped the spin.";
          break;
        case "explode":
          store.updateModel(target.id, { exploded: action.on });
          spoken = action.on
            ? `Taking the ${target.name} apart.`
            : `Putting the ${target.name} back together.`;
          break;
        case "duplicate": {
          if (models.length >= MAX_MODELS) {
            toast.error("The workbench is full — delete a model first.");
            return true;
          }
          const src = target;
          store.addModel({
            id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            name: src.name,
            spec: src.spec,
            pos: {
              x: Math.max(8, Math.min(92, src.pos.x + (src.pos.x > 55 ? -18 : 18))),
              y: Math.max(10, Math.min(90, src.pos.y + (src.pos.y > 60 ? -12 : 12))),
            },
            rot: { ...src.rot },
            scale: src.scale,
            bornAt: Date.now(), // replays the part-by-part assembly
          });
          spoken = `Made a second ${src.name}.`;
          break;
        }
        case "xray":
          store.updateModel(target.id, { xray: action.on });
          spoken = action.on
            ? `X-raying the ${target.name} — shells off, skeleton on.`
            : "X-ray off.";
          break;
        case "solid":
          store.updateModel(target.id, { solid: action.on });
          spoken = action.on
            ? `Rendering the ${target.name} solid.`
            : `The ${target.name} is hologram glass again.`;
          break;
        case "measure":
          store.updateModel(target.id, { measure: action.on });
          spoken = action.on
            ? `Measuring the ${target.name}.`
            : "Measurements off.";
          break;
        case "inspect":
          // One inspector at a time — a new "inspect the X" switches it.
          store.setInspect(action.on ? target.id : null);
          spoken = action.on
            ? `Inspecting the ${target.name}.`
            : "Inspector closed.";
          break;
        case "focus":
          store.setFocused(action.on ? target.id : null);
          spoken = action.on
            ? `Presenting the ${target.name}.`
            : "Back to the full bench.";
          break;
      }

      void (async () => {
        try {
          await respond(spoken);
        } catch {
          /* best effort */
        }
        resumeAfterAction();
      })();
      return true;
    },
    [noteUser, respond, resumeAfterAction]
  );

  /* ---------------------------- one turn ---------------------------- */

  const runTurn = useCallback(
    async (userText: string, opts?: { fromDictation?: boolean; interrupt?: boolean }) => {
      // The guard blocks a NEW turn while one is in flight. Dictation and
      // barge-ins are the exceptions: dictation's "thinking" IS this turn's
      // own state, and an interrupt deliberately REPLACES the in-flight turn.
      if (!opts?.fromDictation && !opts?.interrupt) {
        if (stateRef.current === "thinking" || stateRef.current === "speaking") return;
      }
      if (tryWorkbench(userText)) return;
      if (tryDelete(userText)) return;
      if (tryBenchTool(userText)) return;
      if (tryModelAction(userText)) return;
      if (tryBuild(userText)) return;
      setError(null);
      noteUser(userText);
      setInterim("");

      // An interrupt cuts off whatever the old turn was doing — audio FIRST
      // (instant silence), then the old turn is aborted below.
      if (opts?.interrupt) killAudio();
      setAgentState("thinking");

      // This turn's OWN abort handle. A barge-in (or stop) aborts exactly
      // this turn — never whatever turn happens to be current later on.
      const ac = new AbortController();
      try {
        abortRef.current?.abort();
      } catch {
        /* noop */
      }
      abortRef.current = ac;

      const sessNow = sessionRef.current;
      // A live dictation clip is discarded — the typed/spoken turn that is
      // starting now supersedes it (and we never record our own reply).
      if (sessNow?.dictation && sessNow.recording) {
        sessNow.discardNext = true;
        sessNow.recording = false;
        recordingRef.current = false;
        setRecording(false);
        try {
          sessNow.recorder?.stop();
        } catch {
          /* noop */
        }
      }

      // VOICE + DICTATION: pipe each streamed sentence straight into TTS —
      // Infinity starts speaking after the FIRST sentence, not the whole
      // reply. TEXT: sentences are ignored; the full reply lands at the end.
      // The mic NEVER stops for this: recognition keeps running through
      // thinking + speaking (the barge-in channel in onresult).
      const isVoice = modeRef.current === "voice" || modeRef.current === "dictation";
      const queue = isVoice ? createSentenceQueue() : null;
      const speaking = queue ? speakStreamed(queue.stream(), ac.signal) : null;

      const resumeAfterReply = () => {
        if (!activeRef.current) return;
        const sess = sessionRef.current;
        if (sess && !sess.stopped) {
          const delay = window.setTimeout(() => {
            const s3 = sessionRef.current;
            if (s3 === sess && !s3.stopped && activeRef.current) {
              if (s3.dictation) {
                // Push-to-talk: re-arm for the next tap (no auto-listening).
                recordingRef.current = false;
                setRecording(false);
                setAgentState("idle");
              } else {
                setAgentState("listening");
                beginListeningRef.current(s3);
              }
            }
          }, 220);
          void delay;
        } else {
          setAgentState("idle");
        }
      };

      let reply = "";
      try {
        reply = await askChatStream(userText, (sentence, fullSoFar) => {
          setLastReply(fullSoFar);
          queue?.push(sentence);
        }, ac.signal);
      } catch (err) {
        queue?.end();
        if (!activeRef.current || ac.signal.aborted) return;
        const msg =
          err instanceof Error && err.message ? err.message : "The AI service failed.";
        setError(msg);
        toast.error(msg, {
          action: { label: "Settings", onClick: () => onNeedSettingsRef.current() },
        });
        // let any already-queued audio finish before listening again
        if (speaking) {
          try {
            await speaking;
          } catch {
            /* best effort */
          }
        }
        resumeAfterReply();
        return;
      }

      if (!activeRef.current || ac.signal.aborted) {
        queue?.end();
        return;
      }
      // The chat stream is complete — no more sentences can ever arrive.
      // End the queue so the speak pipeline's for-await can finish after the
      // last sentence plays (without this, the turn hangs on "speaking"
      // forever waiting for a next sentence that will never come).
      queue?.end();
      setLastReply(reply);

      if (speaking) {
        try {
          await speaking;
        } catch (err) {
          if (!activeRef.current || ac.signal.aborted) return;
          const msg = err instanceof Error && err.message ? err.message : "Voice playback failed.";
          setError(msg);
          toast.error(msg);
        }
      } else {
        // typing mode: silent reply in the transcript
        pushTranscript("infinity", reply);
      }
      if (!activeRef.current || ac.signal.aborted) return;

      resumeAfterReply();
    },
    [askChatStream, killAudio, noteUser, pushTranscript, setAgentState, speakStreamed, tryBenchTool, tryBuild, tryDelete, tryModelAction, tryWorkbench]
  );

  /** The user talked over Infinity — drop the in-flight turn (LLM stream +
   *  audio) and start a fresh one with the captured words. */
  const bargeIn = useCallback(
    (text: string) => {
      const t = text.trim();
      if (!t) return;
      setInterim("");
      void runTurn(t, { interrupt: true });
    },
    [runTurn]
  );
  const bargeInRef = useRef(bargeIn);
  useEffect(() => {
    bargeInRef.current = bargeIn;
  }, [bargeIn]);

  /* ------------------------ push-to-talk ---------------------------- */
  /* Browsers without the Web Speech API (Meta Quest 3, Firefox, …) still
     get REAL voice: MediaRecorder captures the clip, /api/stt transcribes
     it with the user's provider, and the transcript enters the exact same
     conversation pipeline as recognized speech. */

  const stopRecordingRef = useRef<() => void>(() => {});

  /** Send one finished clip through /api/stt and into the conversation. */
  const sendDictation = useCallback(
    async (mySess: VoiceSession, blob: Blob) => {
      mySess.recording = false;
      recordingRef.current = false;
      setRecording(false);

      // A near-empty blob is a stray tap, not speech — re-arm quietly.
      // (Quiet speakers are NOT filtered here — a manual tap always sends.)
      if (blob.size < 1500) {
        setAgentState("idle");
        return;
      }

      setAgentState("thinking"); // transcribing counts as thinking
      try {
        const b64 = await blobToBase64(blob);
        const s = useInfinity.getState().settings;
        const res = await fetch("/api/stt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            audio: b64,
            mimeType: blob.type || "audio/webm",
            provider: s.provider,
            apiKey: s.apiKey,
            baseUrl: s.baseUrl || undefined,
          }),
        });
        const data = await safeJson<SttResponseBody>(res);
        if (sessionRef.current !== mySess || mySess.stopped) return;
        if (!res.ok || !data || !data.ok) {
          throw new Error(data?.error || "Transcription failed.");
        }
        const text = (data.text || "").trim();
        if (!text) {
          toast("Didn't catch that — tap the mic and speak again.");
          setAgentState("idle");
          return;
        }
        void runTurn(text, { fromDictation: true });
      } catch (err) {
        if (sessionRef.current !== mySess || mySess.stopped) return;
        const msg =
          err instanceof Error && err.message ? err.message : "Transcription failed.";
        setError(msg);
        toast.error(msg);
        setAgentState("idle");
      }
    },
    [runTurn, setAgentState]
  );

  /** Begin capturing a clip on the session's live mic stream. */
  const beginDictation = useCallback(
    (mySess: VoiceSession) => {
      if (mySess.stopped || !activeRef.current) return;
      if (mySess.recording) return;
      if (stateRef.current === "thinking" || stateRef.current === "speaking") return;
      if (!mySess.micStream) return;

      const mime = pickRecorderMime();
      let rec: MediaRecorder;
      try {
        rec = mime
          ? new MediaRecorder(mySess.micStream, { mimeType: mime })
          : new MediaRecorder(mySess.micStream);
      } catch {
        toast.error("This browser can't record audio — type below instead.");
        return;
      }

      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };
      rec.onstop = () => {
        if (sessionRef.current !== mySess || mySess.stopped) return;
        mySess.recorder = null;
        if (mySess.discardNext) {
          mySess.discardNext = false;
          return;
        }
        const blob = new Blob(chunks, { type: rec.mimeType || mime || "audio/webm" });
        void sendDictation(mySess, blob);
      };

      try {
        rec.start(250); // steady chunks so nothing is lost on stop
      } catch {
        toast.error("Could not start the microphone recording.");
        return;
      }
      mySess.recorder = rec;
      mySess.recording = true;
      mySess.recStart = performance.now();
      mySess.speechHeard = false;
      mySess.lastVoiceAt = performance.now();
      recordingRef.current = true;
      setRecording(true);
      setError(null);
      setAgentState("listening");
    },
    [sendDictation, setAgentState]
  );

  /** End the clip and send it (tap-to-send; silence detection calls this too). */
  const stopRecording = useCallback(() => {
    const sess = sessionRef.current;
    if (!sess || !sess.recording) return;
    sess.recording = false;
    recordingRef.current = false;
    setRecording(false);
    try {
      sess.recorder?.stop(); // onstop assembles + sends
    } catch {
      setAgentState("idle");
    }
  }, [setAgentState]);

  useEffect(() => {
    stopRecordingRef.current = stopRecording;
  }, [stopRecording]);

  const toggleRecording = useCallback(() => {
    const sess = sessionRef.current;
    if (!sess || !sess.dictation) return;
    if (sess.recording) {
      stopRecording();
      return;
    }
    if (stateRef.current === "idle") beginDictation(sess);
  }, [beginDictation, stopRecording]);

  /* --------------------- recognition wiring ------------------------- */

  const setupRecognition = useCallback(
    (mySess: VoiceSession) => {
      if (!mySess.recCtor) return;
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
        // Remember what was just sent: recognition often emits trailing
        // duplicate finals for the SAME utterance right after — those must
        // never be mistaken for a barge-in.
        lastSubmittedRef.current = { text: t, at: Date.now() };
        // The mic KEEPS RUNNING — recognition stays up through the whole
        // turn (barge-in channel below).
        void runTurn(t);
      };

      rec.onresult = (event) => {
        if (sessionRef.current !== mySess || mySess.stopped) return;
        const st = stateRef.current;

        // ---- BARGE-IN CHANNEL — the mic never stops ----
        // While Infinity is thinking or speaking, recognized finals are
        // either the user interrupting (→ abort the turn, start a new one)
        // or Infinity hearing its OWN voice through the speakers (→ echo,
        // ignored by the guard).
        if (st === "thinking" || st === "speaking") {
          if (modeRef.current !== "voice") return;
          let finals = "";
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const r = event.results[i];
            if (r.isFinal) finals += r[0].transcript + " ";
          }
          const text = finals.trim();
          if (!text) return;
          // Echo of Infinity's own speech?
          const spoken = spokenRef.current;
          if (Date.now() - spoken.at < 3000 && isSpeechEcho(text, spoken.text)) return;
          // Trailing duplicate of what was JUST submitted?
          const sub = lastSubmittedRef.current;
          if (Date.now() - sub.at < 2500 && isSpeechEcho(text, sub.text)) return;
          // A single stray word is never an intentional interrupt.
          const words = text.split(/\s+/).filter(Boolean).length;
          if (words < 2 && text.length < 8) return;
          bargeInRef.current(text);
          return;
        }

        if (st !== "listening") return;
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
          // Small pause after final words → send. Kept short: every
          // millisecond here is added latency before the reply.
          mySess.debounce = setTimeout(() => submitVoice(mySess.finalBuf), 480);
        } else if (interimText.trim()) {
          // Safety net: some browsers stall before emitting a final result.
          mySess.interimTimer = setTimeout(
            () => submitVoice(mySess.lastInterim),
            1500
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
        // ALWAYS-ON: restart recognition in ANY state (listening, thinking,
        // speaking) — it only ever stays down when the session stops.
        if (modeRef.current === "voice" && activeRef.current) {
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
    if (!recCtor && !supportsDictation()) {
      toast("Voice input isn't supported in this browser — type instead (press /).");
      fallbackToText(
        "Voice input isn't supported in this browser — type below and Infinity will answer out loud."
      );
      return;
    }
    // No Web Speech API (Meta Quest 3, Firefox, …) but MediaRecorder works →
    // run the session as push-to-talk dictation instead of auto-listening.
    const dictation = !recCtor;

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
      dictation,
      recorder: null,
      recording: false,
      recStart: 0,
      speechHeard: false,
      lastVoiceAt: 0,
      discardNext: false,
    };
    sessionRef.current = sess;
    activeRef.current = true;
    modeRef.current = dictation ? "dictation" : "voice";
    setMode(dictation ? "dictation" : "voice");
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

        if (sess.dictation) {
          // Push-to-talk: armed and waiting for the first mic tap.
          setAgentState("idle");
        } else {
          setupRecognition(sess);
          setAgentState("listening");
          beginListening(sess);
        }
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
      if (tryBenchTool(t)) return;
      if (tryModelAction(t)) return;
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
      void runTurn(t, { interrupt: true });
    },
    [runTurn, setAgentState, tryBenchTool, tryBuild, tryDelete, tryModelAction, tryWorkbench]
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
        const v = rms(sess.micAnalyser, sess.micData);
        target = v;
        // Push-to-talk auto-send: REAL mic-level silence detection. The clip
        // ends when speech was heard and the mic has been quiet for 1.2s
        // (or at a 30s hard cap). Never a timer pretending to be listening.
        if (sess.dictation && sess.recording) {
          const now = performance.now();
          if (v > 0.055) {
            sess.speechHeard = true;
            sess.lastVoiceAt = now;
          }
          const elapsed = now - sess.recStart;
          // Auto-send ONLY after real speech was heard — never on ambient
          // noise alone (a silent room must not fire off empty clips).
          if (sess.speechHeard && elapsed > 900 && now - sess.lastVoiceAt > 1200) {
            stopRecordingRef.current();
          } else if (elapsed > 30000) {
            // 30s hard cap.
            stopRecordingRef.current();
          }
        }
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
    dictation: mode === "dictation" && sessionActive,
    recording,
    start,
    stop,
    toggle,
    toggleRecording,
    sendText,
  };
}

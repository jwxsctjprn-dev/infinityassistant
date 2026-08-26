"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { AgentState, ChatMessage } from "@/lib/infinity/types";
import { isConfigured, useInfinity } from "@/lib/infinity/settings";

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
          messages: history.slice(-16),
          systemPrompt: s.systemPrompt.trim() || undefined,
        }),
      });
      const data = (await res.json()) as
        | { ok: true; reply: string }
        | { ok: false; error: string };
      if (!res.ok || !data.ok) {
        throw new Error(data.ok ? "" : data.error || `The AI service failed (${res.status}).`);
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

  /* ---------------------------- one turn ---------------------------- */

  const runTurn = useCallback(
    async (userText: string) => {
      if (stateRef.current === "thinking" || stateRef.current === "speaking") return;
      setError(null);
      setLastUser(userText);
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
        await speak(reply);
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
    [askChat, setAgentState, speak]
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
      const s = useInfinity.getState().settings;
      if (!isConfigured(s)) {
        toast("Add your API key in Settings first.", {
          action: { label: "Settings", onClick: () => onNeedSettingsRef.current() },
        });
        onNeedSettingsRef.current();
        return;
      }
      if (!activeRef.current) {
        activeRef.current = true;
        modeRef.current = "text";
        setMode("text");
        setSessionActive(true);
        setMicBlocked(false);
        setError(null);
        setLastUser("");
        setLastReply("");
        historyRef.current = [];
        setAgentState("idle");
      }
      void runTurn(t);
    },
    [runTurn, setAgentState]
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
    levelRef,
    start,
    stop,
    toggle,
    sendText,
  };
}

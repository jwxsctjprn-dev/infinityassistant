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

/* ------------------------------------------------------------------ */
/* Session internals                                                   */
/* ------------------------------------------------------------------ */

interface Session {
  stopped: boolean;
  ctx: AudioContext | null;
  micStream: MediaStream | null;
  micAnalyser: AnalyserNode | null;
  playbackAnalyser: AnalyserNode | null;
  micData: Uint8Array<ArrayBuffer> | null;
  playbackData: Uint8Array<ArrayBuffer> | null;
  rec: SpeechRecognitionLike | null;
  recCtor: SpeechRecognitionCtor;
  abort: AbortController | null;
  currentSource: AudioBufferSourceNode | null;
  fallbackAudio: HTMLAudioElement | null;
  syntheticUntil: number;
  finalBuf: string;
  debounce: ReturnType<typeof setTimeout> | null;
  lastRestart: number;
  raf: number;
  startedAt: number;
}

export interface UseInfinityAgent {
  state: AgentState;
  sessionActive: boolean;
  interim: string;
  lastUser: string;
  lastReply: string;
  /** 0..1 smoothed audio loudness for the orb (read imperatively each frame) */
  levelRef: React.MutableRefObject<number>;
  start: () => void;
  stop: () => void;
  toggle: () => void;
}

function rms(analyser: AnalyserNode, data: Uint8Array<ArrayBuffer>): number {
  analyser.getByteTimeDomainData(data);
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    const v = (data[i] - 128) / 128;
    sum += v * v;
  }
  const rmsVal = Math.sqrt(sum / data.length);
  // Speech RMS is small; scale it up into a usable 0..1 visual range.
  return Math.min(1, rmsVal * 3.4);
}

export function useInfinityAgent(onNeedSettings: () => void): UseInfinityAgent {
  const [state, setState] = useState<AgentState>("idle");
  const [sessionActive, setSessionActive] = useState(false);
  const [interim, setInterim] = useState("");
  const [lastUser, setLastUser] = useState("");
  const [lastReply, setLastReply] = useState("");

  const levelRef = useRef(0);
  const stateRef = useRef<AgentState>("idle");
  const sessionRef = useRef<Session | null>(null);
  const historyRef = useRef<ChatMessage[]>([]);
  const onNeedSettingsRef = useRef(onNeedSettings);
  onNeedSettingsRef.current = onNeedSettings;

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const snapshotSettings = () => useInfinity.getState().settings;

  /* ---------------------------- teardown ---------------------------- */

  const teardown = useCallback(() => {
    const sess = sessionRef.current;
    if (!sess) return;
    sess.stopped = true;
    if (sess.debounce) clearTimeout(sess.debounce);
    sess.abort?.abort();
    try {
      sess.rec?.abort();
    } catch {
      /* already stopped */
    }
    try {
      sess.currentSource?.stop();
    } catch {
      /* already stopped */
    }
    if (sess.fallbackAudio) {
      sess.fallbackAudio.pause();
      sess.fallbackAudio.src = "";
    }
    sess.micStream?.getTracks().forEach((t) => t.stop());
    if (sess.raf) cancelAnimationFrame(sess.raf);
    sess.ctx?.close().catch(() => undefined);
    sessionRef.current = null;
    levelRef.current = 0;
  }, []);

  const stop = useCallback(() => {
    teardown();
    setSessionActive(false);
    setState("idle");
    setInterim("");
    historyRef.current = [];
  }, [teardown]);

  /* ------------------------- recognition ---------------------------- */

  const beginListening = useCallback((sess: Session) => {
    if (sess.stopped || stateRef.current !== "listening") return;
    const now = performance.now();
    if (now - sess.lastRestart < 350) {
      setTimeout(() => beginListening(sess), 400);
      return;
    }
    sess.lastRestart = now;
    try {
      sess.rec?.start();
    } catch {
      /* InvalidStateError: already started — fine */
    }
  }, []);

  const handleUtterance = useCallback(
    async (sess: Session, text: string) => {
      if (sess.stopped || stateRef.current !== "listening") return;
      setState("thinking");
      setLastUser(text);
      setInterim("");
      try {
        sess.rec?.stop();
      } catch {
        /* noop */
      }

      const s = snapshotSettings();
      const history = [...historyRef.current, { role: "user", content: text }];
      const abort = new AbortController();
      sess.abort = abort;

      let reply = "";
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: abort.signal,
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
        reply = data.reply;
      } catch (err) {
        if (sess.stopped || abort.signal.aborted) return;
        const msg =
          err instanceof TypeError
            ? "Could not reach the chat service. Check your connection."
            : err instanceof Error && err.message
              ? err.message
              : "The AI service failed.";
        toast.error(msg, {
          action: { label: "Settings", onClick: () => onNeedSettingsRef.current() },
        });
        stop();
        return;
      }

      if (sess.stopped) return;
      historyRef.current = [...history, { role: "assistant", content: reply }].slice(-17);
      setLastReply(reply);

      /* ---------------------- speak the reply ----------------------- */
      setState("speaking");
      try {
        const ttsRes = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: sess.abort?.signal,
          body: JSON.stringify({ text: reply, voice: s.voice, rate: s.rate }),
        });
        if (!ttsRes.ok) {
          const j = (await ttsRes.json().catch(() => null)) as { error?: string } | null;
          throw new Error(j?.error || "Voice synthesis failed.");
        }
        const buf = await ttsRes.arrayBuffer();
        if (sess.stopped) return;

        const playViaContext = async () => {
          if (!sess.ctx) throw new Error("No audio context");
          const audio = await sess.ctx.decodeAudioData(buf);
          return new Promise<void>((resolve) => {
            const src = sess.ctx!.createBufferSource();
            src.buffer = audio;
            const an = sess.ctx!.createAnalyser();
            an.fftSize = 512;
            src.connect(an);
            an.connect(sess.ctx!.destination);
            sess.currentSource = src;
            sess.playbackAnalyser = an;
            sess.playbackData = new Uint8Array(new ArrayBuffer(an.fftSize));
            src.onended = () => {
              sess.currentSource = null;
              sess.playbackAnalyser = null;
              if (!sess.stopped) {
                setState("listening");
                beginListening(sess);
              }
              resolve();
            };
            src.start();
          });
        };

        const playFallback = () =>
          new Promise<void>((resolve) => {
            const blob = new Blob([buf], { type: "audio/mpeg" });
            const url = URL.createObjectURL(blob);
            const el = new Audio(url);
            el.onended = () => {
              URL.revokeObjectURL(url);
              sess.syntheticUntil = 0;
              if (!sess.stopped) {
                setState("listening");
                beginListening(sess);
              }
              resolve();
            };
            sess.fallbackAudio = el;
            sess.syntheticUntil = Number.MAX_SAFE_INTEGER;
            void el.play().catch(() => {
              sess.syntheticUntil = 0;
              resolve();
            });
          });

        await playViaContext().catch(() => playFallback());
      } catch (err) {
        if (sess.stopped || sess.abort?.signal.aborted) return;
        const msg = err instanceof Error && err.message ? err.message : "Voice playback failed.";
        toast.error(msg);
        stop();
      }
    },
    [beginListening, stop]
  );

  const setupRecognition = useCallback(
    (sess: Session) => {
      const rec = new sess.recCtor();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = "en-US";

      rec.onresult = (event) => {
        if (sess.stopped || stateRef.current !== "listening") return;
        let interimText = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const r = event.results[i];
          if (r.isFinal) sess.finalBuf += r[0].transcript + " ";
          else interimText += r[0].transcript;
        }
        setInterim(interimText);
        if (sess.finalBuf.trim()) {
          if (sess.debounce) clearTimeout(sess.debounce);
          sess.debounce = setTimeout(() => {
            const text = sess.finalBuf.trim();
            sess.finalBuf = "";
            if (text) void handleUtterance(sess, text);
          }, 850);
        }
      };

      rec.onerror = (event) => {
        if (sess.stopped) return;
        const kind = event.error;
        if (kind === "no-speech" || kind === "aborted") return;
        if (kind === "not-allowed" || kind === "service-not-allowed") {
          toast.error("Microphone access was blocked. Allow the mic and try again.");
          stop();
          return;
        }
        if (kind === "network") {
          toast.error("Speech recognition lost its network connection.");
          stop();
        }
      };

      rec.onend = () => {
        if (sess.stopped) return;
        if (stateRef.current === "listening") beginListening(sess);
      };

      sess.rec = rec;
    },
    [beginListening, handleUtterance, stop]
  );

  /* --------------------------- level loop --------------------------- */

  const levelLoop = useCallback((sess: Session) => {
    const frame = () => {
      if (sess.stopped || sessionRef.current !== sess) {
        levelRef.current = 0;
        return;
      }
      const st = stateRef.current;
      let target = 0;
      if (st === "listening" && sess.micAnalyser && sess.micData) {
        target = rms(sess.micAnalyser, sess.micData);
      } else if (st === "speaking") {
        if (sess.playbackAnalyser && sess.playbackData) {
          target = rms(sess.playbackAnalyser, sess.playbackData);
        } else if (sess.syntheticUntil > Date.now()) {
          target = 0.32 + 0.28 * Math.sin(performance.now() * 0.012);
        }
      }
      const prev = levelRef.current;
      levelRef.current = prev + (target - prev) * (target > prev ? 0.55 : 0.12);
      sess.raf = requestAnimationFrame(frame);
    };
    sess.raf = requestAnimationFrame(frame);
  }, []);

  /* ------------------------------ start ----------------------------- */

  const start = useCallback(() => {
    if (sessionRef.current) return;
    const s = snapshotSettings();
    if (!isConfigured(s)) {
      toast("Add your API key in Settings to start talking to Infinity.", {
        action: { label: "Settings", onClick: () => onNeedSettingsRef.current() },
      });
      onNeedSettingsRef.current();
      return;
    }
    const recCtor = getSpeechRecognitionCtor();
    if (!recCtor) {
      toast.error("This browser doesn't support speech recognition. Try Chrome, Edge, or Safari.");
      return;
    }

    const sess: Session = {
      stopped: false,
      ctx: null,
      micStream: null,
      micAnalyser: null,
      playbackAnalyser: null,
      micData: null,
      playbackData: null,
      rec: null,
      recCtor,
      abort: null,
      currentSource: null,
      fallbackAudio: null,
      syntheticUntil: 0,
      finalBuf: "",
      debounce: null,
      lastRestart: 0,
      raf: 0,
      startedAt: Date.now(),
    };
    sessionRef.current = sess;
    setSessionActive(true);
    setLastUser("");
    setLastReply("");
    historyRef.current = [];

    void (async () => {
      try {
        sess.ctx = new AudioContext();
        await sess.ctx.resume().catch(() => undefined);
        sess.micStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        const micSrc = sess.ctx.createMediaStreamSource(sess.micStream);
        const an = sess.ctx.createAnalyser();
        an.fftSize = 512;
        micSrc.connect(an); // deliberately not connected to destination
        sess.micAnalyser = an;
        sess.micData = new Uint8Array(new ArrayBuffer(an.fftSize));

        setupRecognition(sess);
        setState("listening");
        beginListening(sess);
        levelLoop(sess);
      } catch (err) {
        const denied =
          err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "SecurityError");
        toast.error(
          denied
            ? "Microphone permission denied. Enable it in your browser settings."
            : "Could not access the microphone.",
          { action: { label: "Settings", onClick: () => onNeedSettingsRef.current() } }
        );
        stop();
      }
    })();
  }, [beginListening, levelLoop, setupRecognition, stop]);

  const toggle = useCallback(() => {
    if (sessionRef.current) stop();
    else start();
  }, [start, stop]);

  /* --------------------------- unmount ------------------------------ */

  useEffect(() => () => teardown(), [teardown]);

  return { state, sessionActive, interim, lastUser, lastReply, levelRef, start, stop, toggle };
}

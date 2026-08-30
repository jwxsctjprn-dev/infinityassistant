"use client";

/**
 * Infinity — Mixed Reality mode orchestrator, v2.2.0 "The Gesture Update".
 *
 * Owns the WebXR session lifecycle (request → active → end), the slim DOM
 * bar shown on flat screens (status + CLEAR + EXIT), and the fallback
 * landing dialog for devices without passthrough XR (with a desktop
 * preview of the same zero-gravity sandbox).
 *
 * Mixed reality is the AI-free sandbox: no orb, no conversation, no
 * captions — just floating holograms you pull out of your palm and
 * sculpt with twenty hand gestures.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { LogOut, Orbit, Square, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MrScene, type MrSceneEvents, type MrSessionInfo } from "./mr-scene";
import { mrBridge } from "@/lib/infinity/mr-bridge";
import { ensureXrMockInstalled } from "@/lib/infinity/xr-mock";

/* ------------------------------------------------------------------ */
/* VR headset icon (Quest-style goggles) — shared with the main screen   */
/* ------------------------------------------------------------------ */

export function VrHeadsetIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {/* goggles body */}
      <path d="M2.5 9.2a2.7 2.7 0 0 1 2.7-2.7h13.6a2.7 2.7 0 0 1 2.7 2.7v4.1a4 4 0 0 1-4 4h-2.3a2.3 2.3 0 0 1-1.9-1l-.8-1.25a1.5 1.5 0 0 0-2.5 0l-.8 1.25a2.3 2.3 0 0 1-1.9 1h-2.3a4 4 0 0 1-4-4z" />
      {/* lenses */}
      <circle cx="7.6" cy="11.3" r="1.7" opacity="0.75" />
      <circle cx="16.4" cy="11.3" r="1.7" opacity="0.75" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* MrMode                                                              */
/* ------------------------------------------------------------------ */

type MrStatus = "requesting" | "active" | "failed";

export function MrMode({ onExit }: { onExit: () => void }) {
  // DEV-ONLY (?xrmock=1): install the fake Quest 3 WebXR runtime before the
  // scene mounts so the real XR code path can run in a desktop browser.
  ensureXrMockInstalled();
  const [mode, setMode] = useState<"xr" | "preview">("xr");
  const [status, setStatus] = useState<MrStatus>("requesting");
  const [failReason, setFailReason] = useState<string>("");
  const [sessionInfo, setSessionInfo] = useState<MrSessionInfo | null>(null);
  const [partCount, setPartCount] = useState(0);

  // DEV-ONLY: expose the bridge for automated E2E assertions
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      (window as { __mr?: typeof mrBridge }).__mr = mrBridge;
    }
  }, []);

  // ---- session lifecycle ----
  const exitRef = useRef(onExit);
  useEffect(() => {
    exitRef.current = onExit;
  }, [onExit]);

  const statusRef = useRef<MrStatus>("requesting");
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const handleSessionEnd = useCallback(() => {
    // A failure path ended the session on purpose — stay mounted so the
    // fallback dialog (now visible on the flat page) takes over.
    if (statusRef.current === "failed") {
      setSessionInfo(null);
      return;
    }
    exitRef.current();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (sessionInfo?.session) {
          sessionInfo.session.end().catch(() => exitRef.current());
        } else {
          exitRef.current();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sessionInfo]);

  const onSessionReady = useCallback((info: MrSessionInfo) => {
    setSessionInfo(info);
    setStatus("active");
  }, []);

  const onSessionFailed = useCallback((reason: string) => {
    statusRef.current = "failed";
    setFailReason(reason);
    setStatus("failed");
  }, []);

  // Session watchdog: if the XR session is active but not a single frame
  // ever rendered (a broken compositor / layer path), end it — never leave
  // the user trapped in empty passthrough — and offer the desktop preview.
  useEffect(() => {
    if (mode !== "xr" || status !== "active" || !sessionInfo) return;
    const t = setTimeout(() => {
      if (mrBridge.firstFrameAt === 0) {
        statusRef.current = "failed";
        setFailReason(
          "The headset compositor never rendered the scene. Your browser's WebXR may not support passthrough sessions yet — the desktop preview below shows the same sandbox."
        );
        setStatus("failed");
        sessionInfo.session.end().catch(() => undefined);
      }
    }, 5000);
    return () => clearTimeout(t);
  }, [mode, status, sessionInfo]);

  // STALL watchdog: frames rendered at first, then the render loop died.
  // Detect the freeze and bounce the user back to this page (with the
  // recorded error) instead of leaving them trapped in it.
  useEffect(() => {
    if (mode !== "xr" || status !== "active" || !sessionInfo) return;
    const iv = setInterval(() => {
      if (mrBridge.firstFrameAt === 0 || mrBridge.diag.stallAt) return;
      const since = performance.now() - mrBridge.diag.frameAt;
      if (since > 4000) {
        mrBridge.diag.stallAt = performance.now();
        statusRef.current = "failed";
        const err = mrBridge.diag.lastError;
        setFailReason(
          `The mixed-reality engine froze mid-session${err ? ` (${err})` : ""}. ` +
            "This is a rendering fault, not a lost connection — re-entering usually works. " +
            "The desktop preview below shows the same sandbox."
        );
        setStatus("failed");
        sessionInfo.session.end().catch(() => undefined);
      }
    }, 1000);
    return () => clearInterval(iv);
  }, [mode, status, sessionInfo]);

  const startPreview = useCallback(() => {
    setMode("preview");
    setStatus("active");
    setPartCount(0);
  }, []);

  const exitMr = useCallback(() => {
    if (sessionInfo?.session) {
      sessionInfo.session
        .end()
        .catch(() => undefined)
        .finally(() => exitRef.current());
    } else {
      exitRef.current();
    }
  }, [sessionInfo]);

  const clearAll = useCallback(() => {
    mrBridge.commands.clearParts++;
  }, []);

  const toggleWindow = useCallback(() => {
    mrBridge.commands.toggleWindow++;
  }, []);

  const events: MrSceneEvents = {
    onExit: exitMr,
    onParts: setPartCount,
  };

  // The slim DOM bar: flat screens (preview) and browsers that granted
  // dom-overlay. Inside the headset the holo window carries everything.
  const domOverlay = !!sessionInfo?.domOverlay;
  const showDomUi = mode === "preview" || (mode === "xr" && domOverlay && status === "active");

  const statusText =
    mode === "preview"
      ? "CLICK A SHAPE TO GRAB · CLICK A HOLOGRAM TO HOLD · X / WHEEL SPINS"
      : "PRESS X / Y / A / B FOR THE HOLO WINDOW · 20 GESTURES: PINCH & RIP · FIST GRAB · ✌ SWIPE SPIN · PALM THRUST PUSH · SNAP-PULL SUMMON · ☝ FLICK · TWO-HAND SCALE · TAP-TAP CLONE · PALM CLAP CRUSH · STABILIZE · SHAKE RECOLOR · HURL TO DESPAWN";

  return (
    <div className="fixed inset-0 z-50 select-none overflow-hidden bg-black text-zinc-100">
      {/* the 3D world (passthrough in XR / simulated void in preview) */}
      {status !== "failed" && (
        <MrScene
          mode={mode}
          sessionInfo={sessionInfo}
          onSessionReady={onSessionReady}
          onSessionFailed={onSessionFailed}
          onSessionEnd={handleSessionEnd}
          events={events}
        />
      )}

      {/* ---- the one DOM bar (preview / dom-overlay only) ---- */}
      <div
        id="mr-overlay"
        className="pointer-events-none absolute inset-0 z-10"
        aria-live="polite"
      >
        <AnimatePresence>
          {showDomUi && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8, transition: { duration: 0.2 } }}
              transition={{ duration: 0.35 }}
              className="absolute left-1/2 top-4 flex max-w-[92vw] -translate-x-1/2 items-center gap-2"
            >
              <span className="rounded-full border border-sky-300/20 bg-black/45 px-4 py-2 text-[10px] font-light uppercase tracking-[0.26em] text-sky-200/80 backdrop-blur-md">
                {statusText}
              </span>
              <button
                type="button"
                onClick={toggleWindow}
                aria-label="Toggle the holograms window"
                title="Toggle the holograms window"
                className="pointer-events-auto flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-white/10 bg-black/45 px-3.5 text-[11px] font-light uppercase tracking-[0.2em] text-zinc-300 backdrop-blur-md transition-colors hover:border-sky-300/40 hover:text-zinc-100"
              >
                <span className="text-[13px] leading-none tracking-[0.1em]" aria-hidden="true">
                  ☰
                </span>
                WINDOW
              </button>
              <button
                type="button"
                onClick={clearAll}
                disabled={partCount === 0}
                aria-label="Clear all holograms"
                title="Clear all holograms"
                className="pointer-events-auto flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-white/10 bg-black/45 px-3.5 text-[11px] font-light uppercase tracking-[0.2em] text-zinc-300 backdrop-blur-md transition-colors hover:border-sky-300/40 hover:text-zinc-100 disabled:pointer-events-none disabled:opacity-35"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                CLEAR
              </button>
              <button
                type="button"
                onClick={exitMr}
                aria-label="Exit mixed reality (Esc)"
                title="Exit mixed reality (Esc)"
                className="pointer-events-auto flex h-9 shrink-0 items-center gap-2 rounded-full border border-white/10 bg-black/45 px-3.5 text-[11px] font-light uppercase tracking-[0.2em] text-zinc-300 backdrop-blur-md transition-colors hover:border-sky-300/40 hover:text-zinc-100"
              >
                <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                EXIT
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* requesting veil */}
        <AnimatePresence>
          {status === "requesting" && mode === "xr" && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 flex flex-col items-center justify-center gap-6 bg-black"
            >
              <motion.div
                animate={{ scale: [1, 1.06, 1], opacity: [0.7, 1, 0.7] }}
                transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                className="text-sky-300/80"
              >
                <VrHeadsetIcon className="h-16 w-16" />
              </motion.div>
              <div className="text-center">
                <p className="text-[12px] font-light uppercase tracking-[0.45em] text-zinc-300">
                  Entering the sandbox
                </p>
                <p className="mt-3 max-w-xs text-[11px] leading-relaxed text-zinc-500">
                  Allow passthrough and hand tracking when your headset asks.
                  Press X on your controller for the holograms window.
                </p>
              </div>
              <span className="block h-6 w-6 animate-spin rounded-full border-2 border-sky-300/30 border-t-sky-300/90" />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ---- fallback landing dialog (no passthrough XR here) ---- */}
      <Dialog
        open={status === "failed"}
        onOpenChange={(open) => {
          if (!open) exitMr();
        }}
      >
        <DialogContent className="max-w-md border-white/10 bg-zinc-950/95 backdrop-blur-xl sm:rounded-2xl">
          <DialogHeader>
            <div className="mb-1 flex h-11 w-11 items-center justify-center rounded-xl border border-sky-300/25 bg-sky-400/10 text-sky-300">
              <VrHeadsetIcon className="h-6 w-6" />
            </div>
            <DialogTitle className="text-left text-lg font-light tracking-wide text-zinc-100">
              Infinity · Holo Sandbox MR
            </DialogTitle>
            <DialogDescription className="text-left text-[13px] leading-relaxed text-zinc-400">
              A zero-gravity hologram playground in your room. Summon a big
              holograms window with a controller button, rip shapes out of
              it, snap them together face-to-face like LEGO, and sculpt
              everything with twenty hand gestures — force pushes, flicks,
              two-hand scaling, clones and more. No AI, just you and
              whatever you build.
            </DialogDescription>
          </DialogHeader>

          <ul className="space-y-2 text-[12.5px] leading-relaxed text-zinc-300">
            <li className="flex gap-2.5">
              <Square className="mt-0.5 h-3 w-3 shrink-0 text-sky-300/70" aria-hidden="true" />
              Open this page in the <span className="text-zinc-100">Meta Quest Browser</span> on a
              Quest 2, 3 or Pro, then tap the headset button.
            </li>
            <li className="flex gap-2.5">
              <Square className="mt-0.5 h-3 w-3 shrink-0 text-sky-300/70" aria-hidden="true" />
              Press <span className="text-zinc-100">X / Y / A / B</span> to summon the
              holograms window — pinch a shape and pull it out, then build
              with twenty hand gestures (bare hands get a ☰ pill on the
              palm).
            </li>
            <li className="flex gap-2.5">
              <Square className="mt-0.5 h-3 w-3 shrink-0 text-sky-300/70" aria-hidden="true" />
              No headset handy? Try the same sandbox in the preview.
            </li>
          </ul>

          {failReason && (
            <p className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-[11px] leading-relaxed text-zinc-500">
              {failReason}
            </p>
          )}

          <div className="flex flex-col gap-2.5 pt-1 sm:flex-row">
            <button
              type="button"
              onClick={startPreview}
              className="flex flex-1 items-center justify-center gap-2 rounded-full border border-sky-300/40 bg-sky-400/10 px-4 py-2.5 text-[12px] font-medium uppercase tracking-[0.18em] text-sky-200 transition-all hover:border-sky-300/70 hover:bg-sky-400/20"
            >
              <Orbit className="h-3.5 w-3.5" aria-hidden="true" />
              Desktop preview
            </button>
            <button
              type="button"
              onClick={exitMr}
              className="flex-1 rounded-full border border-white/10 px-4 py-2.5 text-[12px] font-light uppercase tracking-[0.18em] text-zinc-400 transition-colors hover:border-white/25 hover:text-zinc-200"
            >
              Not now
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

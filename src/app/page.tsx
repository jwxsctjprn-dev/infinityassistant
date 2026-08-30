"use client";

/**
 * HologramOS — the gate.
 *
 * The desktop (any non-XR device) shows the wordmark and a pointer to Meta
 * Quest; a Quest headset gets the ENTER control that starts the passthrough
 * OS. The dev Quest simulator (?xrmock=1) makes the ENTER path testable in
 * a desktop browser.
 */

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { checkPassthroughSupport } from "@/lib/hologramos/webxr";
import { ensureXrMockInstalled } from "@/lib/hologramos/xr-mock";
import { sound } from "@/lib/hologramos/sound";
import { Passthrough } from "@/components/hologramos/passthrough";

type Support = "checking" | "quest" | "other";

function HoloMark({ size = 88 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      aria-hidden="true"
      className="text-cyan-300"
    >
      <circle cx="50" cy="50" r="46" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.5" />
      <circle cx="50" cy="50" r="30" stroke="currentColor" strokeOpacity="0.6" strokeWidth="2" />
      <circle cx="50" cy="50" r="12" stroke="currentColor" strokeWidth="2.5" />
      <circle cx="50" cy="50" r="3" fill="currentColor" />
    </svg>
  );
}

export default function Gate() {
  const [support, setSupport] = useState<Support>("checking");
  const [failReason, setFailReason] = useState<string | null>(null);
  const [inSession, setInSession] = useState(false);

  useEffect(() => {
    ensureXrMockInstalled();
    let alive = true;
    (async () => {
      const s = await checkPassthroughSupport();
      if (!alive) return;
      setSupport(s.supported ? "quest" : "other");
      if (!s.supported && s.reason) setFailReason(s.reason);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const enter = useCallback(() => {
    // a real user gesture — unlock the audio context for the whole OS
    sound.init();
    setInSession(true);
  }, []);

  if (inSession) {
    return (
      <Passthrough
        onEnded={() => setInSession(false)}
        onFailed={(reason) => {
          setFailReason(reason);
          setInSession(false);
        }}
      />
    );
  }

  const isQuest = support === "quest";

  return (
    <main className="fixed inset-0 flex select-none flex-col items-center justify-center overflow-hidden bg-black text-cyan-100">
      {/* faint radial glow + horizon grid */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 70% 55% at 50% 42%, rgba(34,211,238,0.08), transparent 70%)",
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-40 opacity-30"
        style={{
          background:
            "repeating-linear-gradient(90deg, rgba(103,232,249,0.10) 0 1px, transparent 1px 64px)",
          maskImage: "linear-gradient(to top, black, transparent)",
          WebkitMaskImage: "linear-gradient(to top, black, transparent)",
        }}
      />

      <motion.div
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10 flex flex-col items-center gap-8 px-6"
      >
        <div className="relative">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 24, repeat: Infinity, ease: "linear" }}
            className="absolute -inset-4 rounded-full border border-dashed border-cyan-300/20"
          />
          <HoloMark />
        </div>

        <div className="flex flex-col items-center gap-3">
          <h1 className="text-lg font-light tracking-[0.65em] text-cyan-50">
            HOLOGRAM&nbsp;OS
          </h1>
          <p className="text-[10px] font-light uppercase tracking-[0.45em] text-cyan-300/50">
            system 2.1 · vision
          </p>
        </div>

        <div className="flex min-h-24 flex-col items-center gap-4">
          {support === "checking" && (
            <p className="text-[11px] font-light tracking-[0.35em] text-cyan-200/40">
              CALIBRATING…
            </p>
          )}

          {support === "other" && (
            <>
              <p className="text-center text-[12px] font-light tracking-[0.3em] text-cyan-100/80">
                PLEASE CONTINUE ON META QUEST
              </p>
              <p className="max-w-xs text-center text-[10px] font-light leading-relaxed tracking-[0.14em] text-cyan-200/40">
                Hologram OS runs in passthrough on Meta Quest 2 · 3 · Pro, in the
                Meta Quest Browser.
              </p>
            </>
          )}

          {isQuest && (
            <motion.button
              type="button"
              onClick={enter}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.35, duration: 0.6 }}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.97 }}
              className="rounded-full border border-cyan-300/40 bg-cyan-400/10 px-12 py-3.5 text-[12px] font-light tracking-[0.5em] text-cyan-50 shadow-[0_0_36px_rgba(34,211,238,0.25)] backdrop-blur-sm transition-colors hover:border-cyan-200/70 hover:bg-cyan-300/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
            >
              ENTER
            </motion.button>
          )}

          {isQuest && (
            <p className="text-[10px] font-light uppercase tracking-[0.4em] text-cyan-300/40">
              hand tracking ready
            </p>
          )}

          {failReason && (
            <p className="max-w-sm text-center text-[10px] leading-relaxed text-amber-300/60">
              {failReason}
            </p>
          )}
        </div>
      </motion.div>

      <p className="absolute bottom-6 z-10 text-[9px] font-light uppercase tracking-[0.4em] text-cyan-200/25">
        hologram os · mixed reality
      </p>
    </main>
  );
}

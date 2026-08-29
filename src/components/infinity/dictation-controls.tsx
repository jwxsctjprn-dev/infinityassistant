"use client";

import { motion } from "framer-motion";
import { Mic, Send, X } from "lucide-react";

/**
 * Push-to-talk controls for dictation mode (browsers without the Web Speech
 * API — Meta Quest 3, Firefox, …). Big touch targets: on a Quest the pointer
 * is a controller ray, so everything is ≥44px and centered.
 */
export function DictationControls({
  recording,
  onToggle,
  onEnd,
}: {
  recording: boolean;
  onToggle: () => void;
  onEnd: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-2.5">
      <div className="flex items-center gap-4">
        {/* End the voice session entirely (Quest has no Esc key). */}
        <button
          type="button"
          aria-label="End voice session"
          title="End voice session"
          onClick={onEnd}
          className="flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-zinc-500 transition-all hover:bg-white/10 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/50"
        >
          <X className="h-4.5 w-4.5" />
        </button>

        {/* The mic: tap to speak, tap again to send. */}
        <button
          type="button"
          aria-label={recording ? "Stop recording and send" : "Start talking"}
          title={recording ? "Tap to send" : "Tap to speak"}
          onClick={onToggle}
          className={`relative flex h-16 w-16 items-center justify-center rounded-full border transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60 ${
            recording
              ? "border-rose-400/40 bg-rose-500/15 text-rose-300"
              : "border-white/15 bg-white/[0.06] text-zinc-200 hover:border-sky-400/40 hover:bg-sky-400/10 hover:text-sky-200"
          }`}
        >
          {recording && (
            <>
              {/* live pulse ring — echoes the orb's reaction to your voice */}
              <motion.span
                aria-hidden
                className="absolute inset-0 rounded-full border border-rose-400/50"
                initial={{ scale: 1, opacity: 0.7 }}
                animate={{ scale: [1, 1.45], opacity: [0.7, 0] }}
                transition={{ duration: 1.3, repeat: Infinity, ease: "easeOut" }}
              />
              <motion.span
                aria-hidden
                className="absolute inset-0 rounded-full border border-rose-400/30"
                initial={{ scale: 1, opacity: 0.5 }}
                animate={{ scale: [1, 1.45], opacity: [0.5, 0] }}
                transition={{ duration: 1.3, repeat: Infinity, ease: "easeOut", delay: 0.45 }}
              />
              {/* recording dot */}
              <motion.span
                aria-hidden
                className="absolute right-3.5 top-3.5 h-2.5 w-2.5 rounded-full bg-rose-400"
                animate={{ opacity: [1, 0.25, 1] }}
                transition={{ duration: 1.1, repeat: Infinity }}
              />
            </>
          )}
          {recording ? (
            <Send className="h-6 w-6" />
          ) : (
            <Mic className="h-6 w-6" />
          )}
        </button>
      </div>

      <motion.p
        key={recording ? "send" : "speak"}
        initial={{ opacity: 0, y: 3 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className={`text-[10px] font-light uppercase tracking-[0.28em] ${
          recording ? "text-rose-300/80" : "text-zinc-500"
        }`}
      >
        {recording ? "Listening · tap to send" : "Tap the mic to speak"}
      </motion.p>
    </div>
  );
}

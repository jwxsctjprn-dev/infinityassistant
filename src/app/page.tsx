"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Settings2 } from "lucide-react";
import { Orb } from "@/components/infinity/orb";
import { SettingsDialog } from "@/components/infinity/settings-dialog";
import { Toaster } from "@/components/ui/sonner";
import { useInfinityAgent } from "@/hooks/use-infinity-agent";
import { isConfigured, useInfinity } from "@/lib/infinity/settings";

const STATE_LABEL: Record<string, string> = {
  idle: "",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
};

export default function Home() {
  const [mounted, setMounted] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const captions = useInfinity((s) => s.settings.captions);

  const onNeedSettings = useCallback(() => setSettingsOpen(true), []);
  const agent = useInfinityAgent(onNeedSettings);

  useEffect(() => {
    setMounted(true);
  }, []);

  // First run: gently open settings once when no key is configured yet
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    if (
      mounted &&
      !autoOpenedRef.current &&
      !settingsOpen &&
      !isConfigured(useInfinity.getState().settings)
    ) {
      autoOpenedRef.current = true;
      const t = setTimeout(() => setSettingsOpen(true), 600);
      return () => clearTimeout(t);
    }
  }, [mounted, settingsOpen]);

  const handleToggle = useCallback(() => {
    if (agent.sessionActive) setHasStarted(true);
    agent.toggle();
  }, [agent]);

  // Keyboard: ⌘,/Ctrl+, opens settings · Space toggles conversation · Esc stops
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        setSettingsOpen(true);
        return;
      }
      if (e.key === "Escape" && agent.sessionActive) {
        agent.stop();
        return;
      }
      if (e.code === "Space" && !e.repeat) {
        const el = document.activeElement;
        const typing =
          el instanceof HTMLElement &&
          (el.tagName === "INPUT" ||
            el.tagName === "TEXTAREA" ||
            el.tagName === "BUTTON" ||
            el.isContentEditable);
        if (typing || settingsOpen || document.querySelector('[role="dialog"]')) return;
        e.preventDefault();
        handleToggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [agent, handleToggle, settingsOpen]);

  const configured = mounted ? isConfigured(useInfinity.getState().settings) : false;
  const showHint = !agent.sessionActive && !hasStarted;
  const stateLabel = STATE_LABEL[agent.state];

  return (
    <div className="fixed inset-0 select-none overflow-hidden bg-black text-zinc-100">
      {/* macOS window dots */}
      <div aria-hidden className="absolute left-5 top-5 flex items-center gap-2">
        <span className="h-3 w-3 rounded-full bg-[#ff5f57]/90" />
        <span className="h-3 w-3 rounded-full bg-[#febc2e]/90" />
        <span className="h-3 w-3 rounded-full bg-[#28c840]/90" />
      </div>

      {/* Settings */}
      <button
        type="button"
        aria-label="Settings (⌘,)"
        title="Settings (⌘,)"
        onClick={() => setSettingsOpen(true)}
        className="absolute right-5 top-5 rounded-full p-2.5 text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/50"
      >
        <Settings2 className="h-5 w-5" />
      </button>

      {/* Wordmark */}
      <p className="absolute left-1/2 top-6 -translate-x-1/2 text-[13px] font-light tracking-[0.45em] text-zinc-600">
        INFINITY
      </p>

      {/* Orb */}
      <main className="flex h-full w-full items-center justify-center">
        <div className="flex flex-col items-center gap-10">
          <Orb state={agent.state} levelRef={agent.levelRef} onClick={handleToggle} />

          <div className="flex h-4 items-center justify-center" aria-live="polite">
            <AnimatePresence mode="wait">
              {stateLabel ? (
                <motion.span
                  key={stateLabel}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.25 }}
                  className="text-[11px] font-light uppercase tracking-[0.35em] text-sky-300/60"
                >
                  {stateLabel}
                </motion.span>
              ) : showHint ? (
                <motion.span
                  key="hint"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.4 }}
                  className="text-[11px] font-light tracking-[0.2em] text-zinc-500"
                >
                  {configured
                    ? "CLICK THE ORB TO TALK"
                    : "OPEN SETTINGS TO ADD YOUR API KEY"}
                </motion.span>
              ) : null}
            </AnimatePresence>
          </div>
        </div>
      </main>

      {/* Captions */}
      {mounted && captions && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center px-6 pb-8">
          <div className="max-w-xl space-y-1.5 text-center" aria-live="polite">
            <AnimatePresence>
              {agent.sessionActive && agent.state === "listening" && agent.interim && (
                <motion.p
                  key="interim"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="text-sm italic leading-relaxed text-zinc-500"
                >
                  {agent.interim}
                </motion.p>
              )}
              {agent.state === "thinking" && agent.lastUser && (
                <motion.p
                  key="you"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="text-sm leading-relaxed text-zinc-500"
                >
                  {agent.lastUser}
                </motion.p>
              )}
              {(agent.state === "speaking" || agent.state === "listening") &&
                agent.lastReply && (
                  <motion.p
                    key={agent.lastReply}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="line-clamp-2 text-[15px] leading-relaxed text-zinc-300/90"
                  >
                    {agent.lastReply}
                  </motion.p>
                )}
            </AnimatePresence>
          </div>
        </div>
      )}

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />

      <Toaster
        position="top-center"
        toastOptions={{
          style: {
            background: "rgba(9, 9, 11, 0.95)",
            border: "1px solid rgba(255, 255, 255, 0.1)",
            color: "#e4e4e7",
          },
        }}
      />
    </div>
  );
}

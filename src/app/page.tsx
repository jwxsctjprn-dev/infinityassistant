"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Settings2 } from "lucide-react";
import { Orb } from "@/components/infinity/orb";
import { SettingsDialog } from "@/components/infinity/settings-dialog";
import { WorkbenchGrid } from "@/components/infinity/workbench-grid";
import { WorkbenchModels } from "@/components/infinity/workbench-models";
import { WorkbenchDraw } from "@/components/infinity/workbench-draw";
import { StressHud } from "@/components/infinity/stress-hud";
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
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const captions = useInfinity((s) => s.settings.captions);
  const workbench = useInfinity((s) => s.workbench);
  const setWorkbench = useInfinity((s) => s.setWorkbench);

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

  // Workbench entry: fade everything to black first, THEN reveal the grid
  const [gridVisible, setGridVisible] = useState(false);
  useEffect(() => {
    if (workbench) {
      const t = setTimeout(() => setGridVisible(true), 1000);
      return () => clearTimeout(t);
    }
    setGridVisible(false);
  }, [workbench]);

  // Keep the newest transcript message in view (typing mode).
  useEffect(() => {
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [agent.transcript]);

  const handleToggle = useCallback(() => {
    agent.toggle();
  }, [agent]);

  const submitText = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const v = inputValue.trim();
      if (!v) return;
      // A turn is already in flight — keep the text so it isn't lost.
      if (agent.state === "thinking" || agent.state === "speaking") return;
      setInputValue("");
      agent.sendText(v);
    },
    [agent, inputValue]
  );

  // Keyboard: ⌘, settings · / focus typing · Space toggles voice · Esc stops
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const active = document.activeElement;
      const inInput = active === inputRef.current;
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        setSettingsOpen(true);
        return;
      }
      if (e.key === "Escape") {
        // The typing bar is universal — Esc never hides it, only blurs.
        if (inInput) {
          inputRef.current?.blur();
          return;
        }
        // Drawing mode peels off first, then the workbench closes.
        if (useInfinity.getState().drawing) {
          useInfinity.getState().setDrawing(false);
          return;
        }
        // Stress results peel off before the bench itself.
        if (useInfinity.getState().stress) {
          useInfinity.getState().setStress(null);
          return;
        }
        if (workbench) {
          setWorkbench(false);
          return;
        }
        if (agent.sessionActive) {
          agent.stop();
          return;
        }
        return;
      }
      if (
        e.key === "/" &&
        !inInput &&
        !settingsOpen &&
        !document.querySelector('[role="dialog"]')
      ) {
        e.preventDefault();
        inputRef.current?.focus();
        return;
      }
      if (
        e.code === "Space" &&
        !e.repeat &&
        !inInput &&
        !settingsOpen &&
        !document.querySelector('[role="dialog"]')
      ) {
        if (
          active instanceof HTMLElement &&
          (active.tagName === "BUTTON" ||
            active.tagName === "INPUT" ||
            active.tagName === "TEXTAREA" ||
            active.isContentEditable)
        )
          return;
        e.preventDefault();
        handleToggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [agent, handleToggle, setWorkbench, settingsOpen, workbench]);

  const configured = mounted ? isConfigured(useInfinity.getState().settings) : false;
  const stateLabel = STATE_LABEL[agent.state];

  // Typing mode = silent text session (no mic, no sound)
  const textMode = agent.mode === "text" && agent.sessionActive;

  let hint = "";
  if (!agent.sessionActive) {
    hint = configured ? "CLICK THE ORB TO TALK · OR TYPE BELOW" : "OPEN SETTINGS TO ADD YOUR API KEY";
  } else if (textMode && agent.state === "idle" && agent.transcript.length === 0) {
    hint = "TYPE BELOW · ENTER TO SEND";
  }

  return (
    <div className="fixed inset-0 select-none overflow-hidden bg-black text-zinc-100">
      {/* Workbench: flat grid only after everything has faded to black */}
      <AnimatePresence>{gridVisible && <WorkbenchGrid key="wb" />}</AnimatePresence>
      {gridVisible && <WorkbenchModels building={agent.building} />}
      {/* Marker annotations + the floating marker tool (workbench only) */}
      {gridVisible && <WorkbenchDraw />}
      {/* Reality physics stress-test results panel */}
      {gridVisible && <StressHud />}

      {/* Settings */}
      <button
        type="button"
        aria-label="Settings (⌘,)"
        title="Settings (⌘,)"
        onClick={() => setSettingsOpen(true)}
        className={`absolute right-5 top-5 z-20 rounded-full p-2.5 text-zinc-500 transition-all duration-700 hover:bg-white/5 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/50 ${
          workbench ? "pointer-events-none opacity-0" : "opacity-100"
        }`}
      >
        <Settings2 className="h-5 w-5" />
      </button>

      {/* Wordmark */}
      <p
        className={`absolute left-1/2 top-6 z-20 -translate-x-1/2 text-[13px] font-light tracking-[0.45em] text-zinc-600 transition-opacity duration-700 ${
          workbench ? "opacity-0" : "opacity-100"
        }`}
      >
        INFINITY
      </p>

      {/* Orb + status (fades fully away in workbench) */}
      <main
        className={`relative z-10 flex h-full w-full items-center justify-center transition-opacity duration-700 ${
          workbench ? "pointer-events-none opacity-0" : "opacity-100"
        }`}
      >
        <div className="flex flex-col items-center gap-10">
          <Orb state={agent.state} levelRef={agent.levelRef} onClick={handleToggle} />

          <div className="flex min-h-10 max-w-md flex-col items-center gap-2" aria-live="polite">
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
              ) : hint ? (
                <motion.span
                  key={hint}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.4 }}
                  className="text-center text-[11px] font-light tracking-[0.2em] text-zinc-500"
                >
                  {hint}
                </motion.span>
              ) : null}
            </AnimatePresence>

            {agent.error && (
              <motion.p
                key={agent.error}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="max-w-sm text-center text-[11px] leading-relaxed text-red-400/80"
              >
                {agent.error}
              </motion.p>
            )}
          </div>
        </div>
      </main>

      {/* Typing-mode transcript — the silent conversation log */}
      {mounted && textMode && !workbench && (
        <div className="pointer-events-none absolute inset-x-0 bottom-[5.75rem] z-10 flex justify-center px-6">
          <div
            ref={transcriptRef}
            role="log"
            aria-live="polite"
            aria-label="Conversation with Infinity"
            className="infinity-scroll pointer-events-auto flex max-h-[30vh] w-full max-w-md flex-col justify-end gap-2.5 overflow-y-auto overscroll-contain pb-1"
          >
            <AnimatePresence initial={false}>
              {agent.transcript.map((m) => (
                <motion.div
                  key={m.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.22 }}
                  className={
                    m.role === "user"
                      ? "ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-white/[0.07] px-3.5 py-2 text-[13px] leading-relaxed text-zinc-400"
                      : "mr-auto max-w-[85%] rounded-2xl rounded-bl-md border border-white/[0.06] bg-white/[0.03] px-3.5 py-2 text-[13px] leading-relaxed text-zinc-200/90"
                  }
                >
                  {m.text}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
      )}

      {/* Workbench + typing mode: latest reply as a single dim line */}
      {mounted && workbench && textMode && agent.lastReply && (
        <p className="pointer-events-none absolute inset-x-0 bottom-[4.5rem] z-20 truncate px-10 text-center text-[11px] tracking-wide text-zinc-500">
          {agent.lastReply}
        </p>
      )}

      {/* Captions — voice mode only (typing mode has the transcript) */}
      {mounted && captions && agent.mode !== "text" && (
        <div
          className={`pointer-events-none absolute inset-x-0 bottom-24 z-10 flex justify-center px-6 transition-opacity duration-700 ${
            workbench ? "opacity-0" : "opacity-100"
          }`}
        >
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
              {(agent.state === "speaking" || agent.state === "listening") && agent.lastReply && (
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

      {/* Universal typing bar — ALWAYS on screen (mic optional, sound optional).
           Dimmed but usable in the workbench; "/" focuses it from anywhere. */}
      <form
        onSubmit={submitText}
        className={`absolute inset-x-0 bottom-0 z-20 flex justify-center px-6 pb-[max(1.75rem,env(safe-area-inset-bottom))] transition-opacity duration-700 ${
          workbench ? "opacity-40" : "opacity-100"
        }`}
      >
        <input
          ref={inputRef}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          maxLength={500}
          autoComplete="off"
          spellCheck={false}
          placeholder={
            workbench ? "Ask me what's here · or build something" : "Type to Infinity · Enter to send"
          }
          aria-label="Type a message to Infinity"
          className="w-full max-w-sm rounded-full border border-white/10 bg-white/[0.06] px-5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-sky-500/40 focus:outline-none"
        />
      </form>

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

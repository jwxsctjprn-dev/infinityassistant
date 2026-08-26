"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Settings2 } from "lucide-react";
import { Orb } from "@/components/infinity/orb";
import { SettingsDialog } from "@/components/infinity/settings-dialog";
import { WorkbenchGrid } from "@/components/infinity/workbench-grid";
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
  const [inputVisible, setInputVisible] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
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
      setInputVisible(false);
      const t = setTimeout(() => setGridVisible(true), 1000);
      return () => clearTimeout(t);
    }
    setGridVisible(false);
  }, [workbench]);

  // Text sessions keep the input visible; voice listening hides it
  useEffect(() => {
    if (workbench) return; // workbench controls its own visibility
    if (!agent.sessionActive) {
      setInputVisible(false);
    } else if (agent.mode === "text") {
      setInputVisible(true);
    } else if (agent.mode === "voice" && agent.state === "listening") {
      setInputVisible(false);
    }
  }, [agent.mode, agent.sessionActive, agent.state, workbench]);

  useEffect(() => {
    if (inputVisible) inputRef.current?.focus();
  }, [inputVisible]);

  const handleToggle = useCallback(() => {
    agent.toggle();
  }, [agent]);

  const submitText = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const v = inputValue.trim();
      if (!v) return;
      setInputValue("");
      agent.sendText(v);
    },
    [agent, inputValue]
  );

  // Keyboard: ⌘, settings · / type · Space toggles voice · Esc stops/hides
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
        if (inInput) {
          inputRef.current?.blur();
          if (agent.mode !== "text") setInputVisible(false);
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
        setInputVisible(false);
        return;
      }
      if (
        e.key === "/" &&
        !inInput &&
        !settingsOpen &&
        !document.querySelector('[role="dialog"]')
      ) {
        e.preventDefault();
        setInputVisible(true);
        return;
      }
      if (
        e.code === "Space" &&
        !e.repeat &&
        !inInput &&
        !inputVisible &&
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
  }, [agent, handleToggle, inputVisible, setWorkbench, settingsOpen, workbench]);

  const configured = mounted ? isConfigured(useInfinity.getState().settings) : false;
  const stateLabel = STATE_LABEL[agent.state];

  let hint = "";
  if (!agent.sessionActive && !inputVisible) {
    hint = configured ? "CLICK THE ORB TO TALK · PRESS / TO TYPE" : "OPEN SETTINGS TO ADD YOUR API KEY";
  } else if (agent.mode === "text" && agent.state === "idle") {
    hint = "TYPE BELOW · ENTER TO SEND";
  }

  return (
    <div className="fixed inset-0 select-none overflow-hidden bg-black text-zinc-100">
      {/* Workbench: flat grid only after everything has faded to black */}
      <AnimatePresence>{gridVisible && <WorkbenchGrid key="wb" />}</AnimatePresence>

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

      {/* Captions */}
      {mounted && captions && (
        <div
          className={`pointer-events-none absolute inset-x-0 z-10 flex justify-center px-6 transition-opacity duration-700 ${
            workbench ? "opacity-0" : "opacity-100"
          } ${inputVisible ? "bottom-24" : "bottom-8"}`}
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
              {(agent.state === "speaking" ||
                agent.state === "listening" ||
                (agent.mode === "text" && agent.state === "idle")) &&
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

      {/* Text input (press / anytime, or automatic when mic is unavailable) */}
      <AnimatePresence>
        {inputVisible && (
          <motion.form
            key="textinput"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.2 }}
            onSubmit={submitText}
            className="absolute inset-x-0 bottom-0 z-20 flex justify-center px-6 pb-7"
          >
            <input
              ref={inputRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              maxLength={500}
              autoComplete="off"
              spellCheck={false}
              placeholder="Type to Infinity · Enter to send"
              aria-label="Type a message to Infinity"
              className="w-full max-w-sm rounded-full border border-white/10 bg-white/[0.06] px-5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-sky-500/40 focus:outline-none"
            />
          </motion.form>
        )}
      </AnimatePresence>

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

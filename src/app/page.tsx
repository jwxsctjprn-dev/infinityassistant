"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Settings2 } from "lucide-react";
import { Orb } from "@/components/infinity/orb";
import { MrMode, VrHeadsetIcon } from "@/components/infinity/mr-mode";
import { SettingsDialog } from "@/components/infinity/settings-dialog";
import { DictationControls } from "@/components/infinity/dictation-controls";
import { VersionBadge } from "@/components/infinity/whats-new";
import { WorkbenchGrid } from "@/components/infinity/workbench-grid";
import { WorkbenchModels } from "@/components/infinity/workbench-models";
import { WorkbenchDraw } from "@/components/infinity/workbench-draw";
import { WorkbenchSculpt } from "@/components/infinity/workbench-sculpt";
import { Toaster } from "@/components/ui/sonner";
import { useInfinityAgent } from "@/hooks/use-infinity-agent";
import { isConfigured, useInfinity } from "@/lib/infinity/settings";

const STATE_LABEL: Record<string, string> = {
  idle: "",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
};

/** Auto-open settings at most ONCE per page load — the main screen
 *  remounts every time mixed reality exits, and a per-component ref would
 *  re-open the dialog after each MR session. */
let settingsAutoOpened = false;

export default function Home() {
  const [mounted, setMounted] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const captions = useInfinity((s) => s.settings.captions);
  const workbench = useInfinity((s) => s.workbench);
  const setWorkbench = useInfinity((s) => s.setWorkbench);
  const blueprint = useInfinity((s) => s.blueprint);
  const mrActive = useInfinity((s) => s.mrActive);
  const setMrActive = useInfinity((s) => s.setMrActive);

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
      !settingsAutoOpened &&
      !autoOpenedRef.current &&
      !settingsOpen &&
      !isConfigured(useInfinity.getState().settings)
    ) {
      settingsAutoOpened = true;
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
    // Push-to-talk browsers (Quest 3, Firefox, …): the orb toggles a clip.
    if (agent.mode === "dictation") {
      agent.toggleRecording();
      return;
    }
    agent.toggle();
  }, [agent]);

  const submitText = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const v = inputValue.trim();
      if (!v) return;
      // Typed text always sends — even mid-turn it interrupts (barge-in),
      // so the keyboard keeps the same quick back-and-forth as voice.
      setInputValue("");
      agent.sendText(v);
    },
    [agent, inputValue]
  );

  // Keyboard: ⌘, settings · / focus typing · Space toggles voice · Esc stops
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Mixed reality owns the whole screen (and its own keys) while active.
      if (useInfinity.getState().mrActive) return;
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
        // Drawing mode peels off first, then focus mode and the inspector,
        // then the workbench closes, then the session stops.
        if (useInfinity.getState().drawing) {
          useInfinity.getState().setDrawing(false);
          return;
        }
        if (useInfinity.getState().focusedId) {
          useInfinity.getState().setFocused(null);
          return;
        }
        if (useInfinity.getState().inspectId) {
          useInfinity.getState().setInspect(null);
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
  // Push-to-talk session (no Web Speech API): the orb + mic button toggle
  // a clip; "listening" means actively recording one.
  const dictMode = agent.mode === "dictation" && agent.sessionActive;
  const stateLabel =
    dictMode && agent.state === "listening" ? "Listening · tap to send" : STATE_LABEL[agent.state];

  // Typing mode = silent text session (no mic, no sound)
  const textMode = agent.mode === "text" && agent.sessionActive;

  // Mixed reality takeover — the AI-free workbench lives inside the XR
  // session; any live conversation on the flat page stops first.
  if (mounted && mrActive) {
    return <MrMode onExit={() => {
      setMrActive(false);
      useInfinity.getState().setWorkbench(false);
    }} />;
  }

  let hint = "";
  if (!agent.sessionActive) {
    hint = configured ? "CLICK THE ORB TO TALK · OR TYPE BELOW" : "OPEN SETTINGS TO ADD YOUR API KEY";
  } else if (dictMode && agent.state === "idle" && !agent.recording) {
    hint = "TAP THE MIC TO SPEAK · TAP AGAIN TO SEND";
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
      {/* Hand-sculpting: double-tap-hold-drag on the bench draws blocks */}
      {gridVisible && <WorkbenchSculpt />}

      {/* Mixed reality — the AI-free hologram sandbox (Meta Quest 3) */}
      <button
        type="button"
        aria-label="Enter the hologram sandbox in mixed reality (Quest 3)"
        title="Holo Sandbox MR — build with 20 hand gestures (Quest 3)"
        onClick={() => {
          if (agent.sessionActive) agent.stop();
          setMrActive(true);
        }}
        className={`absolute right-[4.5rem] top-5 z-20 rounded-full p-2.5 text-zinc-500 transition-all duration-700 hover:bg-white/5 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/50 ${
          workbench ? "pointer-events-none opacity-0" : "opacity-100"
        }`}
      >
        <VrHeadsetIcon className="h-5 w-5" />
      </button>

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

      {/* Version badge + release notes */}
      <VersionBadge />

      {/* Blueprint mode tag — visible whenever the bench is in engineering
          view (voice: "blueprint mode"). Sits in the settings spot, which is
          hidden while the workbench is open. */}
      {gridVisible && blueprint && (
        <motion.span
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.35 }}
          aria-label="Blueprint mode active"
          className="absolute right-5 top-5 z-20 rounded-full border border-cyan-300/30 bg-black/70 px-3.5 py-1.5 text-[9px] font-light uppercase tracking-[0.4em] text-cyan-200/90 backdrop-blur-sm"
        >
          Blueprint
        </motion.span>
      )}

      {/* Workbench: the orb re-materializes in the bottom-left corner and
          cuts a circular hole out of the grid (mask geometry lives in
          globals.css — keep the two in sync). */}
      <AnimatePresence>
        {gridVisible && (
          <motion.div
            key="corner-orb"
            initial={{ opacity: 0, scale: 0.75, y: 14 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.75, transition: { duration: 0.3 } }}
            transition={{ delay: 0.55, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            className="absolute bottom-[calc(env(safe-area-inset-bottom)+5rem)] left-6 z-20 sm:bottom-10 sm:left-10"
          >
            <div className="flex items-center gap-3">
              <Orb state={agent.state} levelRef={agent.levelRef} onClick={handleToggle} compact />
              {agent.sessionActive && stateLabel && (
                <span className="pb-1.5 text-[10px] font-light uppercase tracking-[0.35em] text-sky-300/60">
                  {stateLabel}
                </span>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

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

      {/* Push-to-talk controls (Quest 3 / Firefox — no Web Speech API) */}
      {mounted && dictMode && (
        <div
          className={`absolute inset-x-0 bottom-[5.75rem] z-20 flex justify-center px-6 transition-opacity duration-700 ${
            workbench ? "opacity-40" : "opacity-100"
          }`}
        >
          <DictationControls
            recording={agent.recording}
            onToggle={agent.toggleRecording}
            onEnd={agent.stop}
          />
        </div>
      )}

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

      {/* Captions — voice mode only (typing mode has the transcript).
          In the workbench they anchor just above the corner orb. */}
      {mounted && captions && agent.mode !== "text" && (
        <div
          className={`pointer-events-none absolute z-10 flex px-6 transition-all duration-700 sm:px-10 ${
            workbench
              ? "bottom-[calc(env(safe-area-inset-bottom)+10.6rem)] left-0 justify-start opacity-100 sm:bottom-[9.1rem]"
              : dictMode
                ? "inset-x-0 bottom-[13rem] justify-center opacity-100"
                : "inset-x-0 bottom-24 justify-center opacity-100"
          }`}
        >
          <div
            className={`max-w-xl space-y-1.5 ${workbench ? "max-w-[15rem] space-y-1 text-left sm:max-w-xs" : "text-center"}`}
            aria-live="polite"
          >
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

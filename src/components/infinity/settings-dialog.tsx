"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useInfinity } from "@/lib/infinity/settings";
import { MS_VOICES, PROVIDERS } from "@/lib/infinity/providers";
import { DEFAULT_SYSTEM_PROMPT, type Settings } from "@/lib/infinity/types";
import {
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  ExternalLink,
  Loader2,
  Play,
  RotateCcw,
  X,
} from "lucide-react";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const VOICE_REGIONS: Array<{ region: string; label: string }> = [
  { region: "en-US", label: "United States" },
  { region: "en-GB", label: "United Kingdom" },
  { region: "en-AU", label: "Australia" },
  { region: "en-IE", label: "Ireland" },
  { region: "en-IN", label: "India" },
];

type TestStatus = "idle" | "testing" | "ok" | "error";

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const settings = useInfinity((s) => s.settings);
  const setSettings = useInfinity((s) => s.setSettings);
  const resetSettings = useInfinity((s) => s.resetSettings);

  const [draft, setDraft] = useState<Settings>(settings);
  const [showKey, setShowKey] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(true);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [test, setTest] = useState<TestStatus>("idle");
  const [testMsg, setTestMsg] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const previewRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (open) {
      setDraft(useInfinity.getState().settings);
      setTest("idle");
      setTestMsg("");
      setShowKey(false);
    }
  }, [open]);

  // stop preview audio when dialog closes
  useEffect(() => {
    if (!open && previewRef.current) {
      previewRef.current.pause();
      previewRef.current = null;
      setPreviewing(false);
    }
  }, [open]);

  const patch = (p: Partial<Settings>) => setDraft((d) => ({ ...d, ...p }));

  const onProviderChange = (value: string) => {
    const id = value as Settings["provider"];
    const info = PROVIDERS[id];
    setDraft((d) => ({
      ...d,
      provider: id,
      model: info.defaultModel || d.model,
      baseUrl: id === "custom" ? d.baseUrl : "",
    }));
    setTest("idle");
  };

  const runTest = async () => {
    if (draft.provider !== "custom" && !draft.apiKey.trim()) {
      setTest("error");
      setTestMsg("Enter an API key first.");
      return;
    }
    if (!draft.model.trim() || (draft.provider === "custom" && !draft.baseUrl.trim())) {
      setTest("error");
      setTestMsg("Model and base URL are required.");
      return;
    }
    setTest("testing");
    setTestMsg("");
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: draft.provider,
          apiKey: draft.apiKey.trim(),
          baseUrl: draft.baseUrl.trim() || undefined,
          model: draft.model.trim(),
          messages: [{ role: "user", content: "Reply with exactly: connected" }],
        }),
      });
      const data = (await res.json()) as
        | { ok: true; reply: string }
        | { ok: false; error: string };
      if (!res.ok || !data.ok) throw new Error(data.ok ? "" : data.error);
      setTest("ok");
      setTestMsg(data.reply.slice(0, 80) || "Connected.");
    } catch (err) {
      setTest("error");
      setTestMsg(err instanceof Error && err.message ? err.message : "Connection failed.");
    }
  };

  const previewVoice = useCallback(async () => {
    if (previewing) {
      previewRef.current?.pause();
      previewRef.current = null;
      setPreviewing(false);
      return;
    }
    setPreviewing(true);
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: "Hey, I'm Infinity. It's good to hear you.",
          voice: draft.voice,
          rate: draft.rate,
        }),
      });
      if (!res.ok) throw new Error("Voice preview failed.");
      const buf = await res.arrayBuffer();
      const url = URL.createObjectURL(new Blob([buf], { type: "audio/mpeg" }));
      const el = new Audio(url);
      previewRef.current = el;
      el.onended = () => {
        URL.revokeObjectURL(url);
        setPreviewing(false);
        previewRef.current = null;
      };
      await el.play();
    } catch {
      setPreviewing(false);
      toast.error("Could not play the voice preview.");
    }
  }, [draft.voice, draft.rate, previewing]);

  const save = () => {
    if (draft.provider !== "custom" && !draft.apiKey.trim()) {
      toast.error("Please enter your API key.");
      return;
    }
    if (!draft.model.trim()) {
      toast.error("Please choose a model.");
      return;
    }
    if (draft.provider === "custom" && !draft.baseUrl.trim()) {
      toast.error("Custom providers need a base URL.");
      return;
    }
    setSettings(draft);
    onOpenChange(false);
    toast.success("Settings saved.");
  };

  const providerInfo = PROVIDERS[draft.provider];
  const selectedVoice = MS_VOICES.find((v) => v.name === draft.voice) ?? MS_VOICES[0];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] gap-0 overflow-y-auto border-white/10 bg-zinc-950/95 p-0 text-zinc-100 backdrop-blur-xl sm:max-w-lg infinity-scroll">
        <DialogHeader className="border-b border-white/5 px-6 pb-4 pt-5">
          <DialogTitle className="flex items-center gap-2 text-base font-semibold tracking-tight">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-blue-500 shadow-[0_0_12px_rgba(59,130,246,0.9)]" />
            Infinity Settings
          </DialogTitle>
          <DialogDescription className="text-xs text-zinc-400">
            Bring your own key — it stays in this browser and is only used for your
            conversations.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 px-6 py-5">
          {/* Provider */}
          <div className="space-y-2">
            <Label htmlFor="provider" className="text-xs font-medium text-zinc-300">
              AI Provider
            </Label>
            <Select value={draft.provider} onValueChange={onProviderChange}>
              <SelectTrigger
                id="provider"
                className="w-full border-white/10 bg-white/5 text-sm focus:ring-sky-500/40"
              >
                <SelectValue placeholder="Choose a provider" />
              </SelectTrigger>
              <SelectContent className="border-white/10 bg-zinc-950 text-zinc-100">
                {Object.values(PROVIDERS).map((p) => (
                  <SelectItem key={p.id} value={p.id} className="text-sm focus:bg-white/10">
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* API key */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="apiKey" className="text-xs font-medium text-zinc-300">
                API Key <span className="text-red-400">*</span>
              </Label>
              {providerInfo.keyUrl && (
                <a
                  href={providerInfo.keyUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] text-sky-400 hover:text-sky-300"
                >
                  Get a key <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
            <div className="relative">
              <Input
                id="apiKey"
                type={showKey ? "text" : "password"}
                value={draft.apiKey}
                onChange={(e) => {
                  patch({ apiKey: e.target.value });
                  setTest("idle");
                }}
                placeholder={providerInfo.keyHint}
                autoComplete="off"
                spellCheck={false}
                className="border-white/10 bg-white/5 pr-10 font-mono text-sm placeholder:font-sans focus:ring-sky-500/40"
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                aria-label={showKey ? "Hide API key" : "Show API key"}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-zinc-500 hover:bg-white/5 hover:text-zinc-300"
              >
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-[11px] leading-relaxed text-zinc-500">
              Placeholder for now — paste any Z.AI, Groq, or OpenAI key here later.
            </p>
          </div>

          {/* Model */}
          <div className="space-y-2">
            <Label htmlFor="model" className="text-xs font-medium text-zinc-300">
              Model
            </Label>
            <Input
              id="model"
              value={draft.model}
              onChange={(e) => patch({ model: e.target.value })}
              placeholder={providerInfo.defaultModel || "model name"}
              className="border-white/10 bg-white/5 font-mono text-sm placeholder:font-sans focus:ring-sky-500/40"
            />
            {providerInfo.models.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {providerInfo.models.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => patch({ model: m })}
                    className={`rounded-full border px-2.5 py-1 font-mono text-[11px] transition-colors ${
                      draft.model === m
                        ? "border-sky-500/60 bg-sky-500/15 text-sky-300"
                        : "border-white/10 bg-white/5 text-zinc-400 hover:border-white/20 hover:text-zinc-200"
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Base URL */}
          <div className="space-y-2">
            <Label htmlFor="baseUrl" className="text-xs font-medium text-zinc-300">
              Base URL {draft.provider === "custom" ? <span className="text-red-400">*</span> : "(override, optional)"}
            </Label>
            <Input
              id="baseUrl"
              value={draft.baseUrl}
              onChange={(e) => patch({ baseUrl: e.target.value })}
              placeholder={providerInfo.baseUrl || "https://your-host/v1"}
              className="border-white/10 bg-white/5 font-mono text-sm placeholder:font-sans focus:ring-sky-500/40"
            />
          </div>

          {/* Voice & speech */}
          <Collapsible open={voiceOpen} onOpenChange={setVoiceOpen}>
            <CollapsibleTrigger className="flex w-full items-center justify-between py-1 text-xs font-medium text-zinc-300 hover:text-zinc-100">
              Voice &amp; Speech — Microsoft TTS
              <ChevronDown
                className={`h-4 w-4 text-zinc-500 transition-transform ${voiceOpen ? "" : "-rotate-90"}`}
              />
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-4 pt-3">
              <div className="flex items-end gap-2">
                <div className="flex-1 space-y-2">
                  <Label className="text-xs text-zinc-400">Voice</Label>
                  <Select value={draft.voice} onValueChange={(v) => patch({ voice: v })}>
                    <SelectTrigger className="w-full border-white/10 bg-white/5 text-sm focus:ring-sky-500/40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="max-h-72 border-white/10 bg-zinc-950 text-zinc-100 infinity-scroll">
                      {VOICE_REGIONS.map(({ region, label }) => (
                        <SelectGroup key={region}>
                          <SelectLabel className="text-[11px] uppercase tracking-wide text-zinc-500">
                            {label}
                          </SelectLabel>
                          {MS_VOICES.filter((v) => v.name.startsWith(region)).map((v) => (
                            <SelectItem
                              key={v.name}
                              value={v.name}
                              className="text-sm focus:bg-white/10"
                            >
                              {v.label} · {v.gender}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={previewVoice}
                  className="h-9 border border-white/10 bg-white/5 px-3 text-zinc-200 hover:bg-white/10"
                >
                  {previewing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                  <span className="sr-only">Preview {selectedVoice.label}</span>
                </Button>
              </div>

              <div className="space-y-2 rounded-lg border border-white/5 bg-white/[0.03] p-3">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-zinc-400">Speaking rate</Label>
                  <span className="font-mono text-xs text-sky-300">
                    {draft.rate.toFixed(2)}×
                  </span>
                </div>
                <Slider
                  value={[draft.rate]}
                  min={0.5}
                  max={1.5}
                  step={0.05}
                  onValueChange={([v]) => patch({ rate: v })}
                  aria-label="Speaking rate"
                />
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* Advanced */}
          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <CollapsibleTrigger className="flex w-full items-center justify-between py-1 text-xs font-medium text-zinc-300 hover:text-zinc-100">
              Advanced
              <ChevronDown
                className={`h-4 w-4 text-zinc-500 transition-transform ${advancedOpen ? "" : "-rotate-90"}`}
              />
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-4 pt-3">
              <div className="flex items-center justify-between rounded-lg border border-white/5 bg-white/[0.03] p-3">
                <div>
                  <p className="text-xs font-medium text-zinc-200">Live captions</p>
                  <p className="text-[11px] text-zinc-500">
                    Show a faint transcript under the orb.
                  </p>
                </div>
                <Switch
                  checked={draft.captions}
                  onCheckedChange={(v) => patch({ captions: v })}
                  aria-label="Live captions"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="persona" className="text-xs text-zinc-400">
                  Persona / system prompt (optional)
                </Label>
                <Textarea
                  id="persona"
                  value={draft.systemPrompt}
                  onChange={(e) => patch({ systemPrompt: e.target.value })}
                  placeholder={DEFAULT_SYSTEM_PROMPT}
                  className="min-h-[72px] border-white/10 bg-white/5 text-xs leading-relaxed focus:ring-sky-500/40"
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  resetSettings();
                  setDraft(useInfinity.getState().settings);
                  setTest("idle");
                }}
                className="h-8 px-2 text-[11px] text-zinc-500 hover:text-zinc-200"
              >
                <RotateCcw className="mr-1 h-3 w-3" /> Reset all settings
              </Button>
            </CollapsibleContent>
          </Collapsible>
        </div>

        <DialogFooter className="flex items-center gap-2 border-t border-white/5 px-6 py-4">
          <div className="flex min-w-0 flex-1 items-center gap-2 text-[11px]">
            {test === "testing" && (
              <>
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-sky-400" />
                <span className="truncate text-zinc-400">Testing connection…</span>
              </>
            )}
            {test === "ok" && (
              <>
                <Check className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                <span className="truncate text-emerald-400">{testMsg}</span>
              </>
            )}
            {test === "error" && (
              <>
                <X className="h-3.5 w-3.5 shrink-0 text-red-400" />
                <span className="truncate text-red-400">{testMsg}</span>
              </>
            )}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={runTest}
            disabled={test === "testing"}
            className="border-white/10 bg-transparent text-zinc-200 hover:bg-white/10"
          >
            {test === "testing" ? "Testing…" : "Test"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="text-zinc-400 hover:bg-white/10 hover:text-zinc-100"
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={save}
            className="bg-sky-600 text-white hover:bg-sky-500"
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
